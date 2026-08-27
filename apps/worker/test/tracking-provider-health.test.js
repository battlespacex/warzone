import test from "node:test";
import assert from "node:assert/strict";

import {
    getProviderHealth,
    PROVIDER_HEALTH_STATES,
    recordProviderFailure,
    resetProviderHealth,
    runConfiguredProviders,
} from "../src/tracking/provider-health.js";
import { createAircraftProviders } from "../src/tracking/aircraft/registry.js";
import { createNavalProviders } from "../src/tracking/naval/registry.js";

const quietLogger = { log() {}, warn() {} };

test("blocked aircraft provider enters BACKOFF while another provider succeeds", async () => {
    resetProviderHealth();
    const blocked = {
        id: "airplanes_live",
        enabled: true,
        async fetchObservations() {
            const error = new Error("forbidden");
            error.status = 403;
            throw error;
        },
    };
    const blockedAdsbOne = {
        id: "adsb_one",
        enabled: true,
        async fetchObservations() {
            const error = new Error("forbidden");
            error.status = 403;
            throw error;
        },
    };
    const available = {
        id: "opensky",
        enabled: true,
        async fetchObservations() {
            return [{ source: "opensky", icao24: "abc123" }];
        },
    };

    const results = await runConfiguredProviders("adsb", [blocked, blockedAdsbOne, available], { logger: quietLogger });

    assert.equal(results.length, 1);
    assert.equal(results[0].provider.id, "opensky");
    assert.equal(getProviderHealth("adsb", "airplanes_live").status, PROVIDER_HEALTH_STATES.BACKOFF);
    assert.equal(getProviderHealth("adsb", "adsb_one").status, PROVIDER_HEALTH_STATES.BACKOFF);
    assert.equal(getProviderHealth("adsb", "opensky").status, PROVIDER_HEALTH_STATES.HEALTHY);
});

test("credentialed providers stay disabled while OpenSky and Fintraffic can use anonymous access", () => {
    const aircraft = createAircraftProviders({
        ADSB_LOL_ENABLED: "false",
        AIRPLANES_LIVE_ENABLED: "false",
        ADSB_ONE_ENABLED: "false",
        ADSB_EXCHANGE_ENABLED: "true",
        OPENSKY_ENABLED: "true",
    });
    const naval = createNavalProviders({
        AISSTREAM_ENABLED: "true",
        AISHUB_ENABLED: "true",
        MARINETRAFFIC_ENABLED: "true",
        SPIRE_AIS_ENABLED: "true",
    });

    assert.equal(aircraft.find((provider) => provider.id === "adsbx")?.enabled, false);
    assert.equal(aircraft.find((provider) => provider.id === "opensky")?.enabled, true);
    assert.equal(aircraft.find((provider) => provider.id === "plane_alert_db")?.enabled, true);
    assert.ok(aircraft.filter((provider) => !["adsbx", "opensky", "plane_alert_db"].includes(provider.id)).every((provider) => provider.enabled === false));
    assert.equal(naval.find((provider) => provider.id === "fintraffic")?.enabled, true);
    assert.ok(naval.filter((provider) => provider.id !== "fintraffic").every((provider) => provider.enabled === false));
});

test("unavailable AISStream does not stop another naval provider", async () => {
    resetProviderHealth();
    const results = await runConfiguredProviders("ais", [
        {
            id: "aisstream",
            enabled: true,
            async fetchObservations() { throw new Error("socket unavailable"); },
        },
        {
            id: "aishub",
            enabled: true,
            async fetchObservations() { return [{ source: "aishub", mmsi: "123456789" }]; },
        },
    ], { logger: quietLogger });

    assert.equal(results.length, 1);
    assert.equal(results[0].provider.id, "aishub");
    assert.equal(getProviderHealth("ais", "aisstream").status, PROVIDER_HEALTH_STATES.BACKOFF);
});

test("rate limit honors provider Retry-After", () => {
    resetProviderHealth();
    const now = Date.parse("2026-08-13T12:00:00Z");
    const error = new Error("rate limited");
    error.status = 429;
    error.retryAfterMs = 42_000;

    const health = recordProviderFailure("adsb", "opensky", error, { now, logger: quietLogger });

    assert.equal(health.status, PROVIDER_HEALTH_STATES.BACKOFF);
    assert.equal(Date.parse(health.next_retry_at), now + 42_000);
});

test("backoff skips repeated provider calls and identical failure logs", async () => {
    resetProviderHealth();
    const warnings = [];
    const logger = { log() {}, warn(message) { warnings.push(message); } };
    let calls = 0;
    const provider = {
        id: "airplanes_live",
        enabled: true,
        async fetchObservations() {
            calls += 1;
            const error = new Error("forbidden");
            error.status = 403;
            throw error;
        },
    };
    const now = Date.parse("2026-08-13T12:00:00Z");

    await runConfiguredProviders("adsb", [provider], { logger, now });
    await runConfiguredProviders("adsb", [provider], { logger, now: now + 60_000 });

    assert.equal(calls, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /BACKOFF HTTP 403 retry in 900s/);
});

test("preferred ADSB_ONE variables enable the provider and legacy names remain compatible", () => {
    const preferred = createAircraftProviders({
        AIRPLANES_LIVE_ENABLED: "false",
        ADSB_ONE_ENABLED: "true",
        ADSB_ONE_BASE_URL: "https://example.test/v2/mil",
    });
    const legacy = createAircraftProviders({
        AIRPLANES_LIVE_ENABLED: "false",
        ADSBONE_ENABLED: "true",
        ADSBONE_BASE_URL: "https://example.test/v2/mil",
    });

    assert.equal(preferred.find((provider) => provider.id === "adsb_one")?.enabled, true);
    assert.equal(legacy.find((provider) => provider.id === "adsb_one")?.enabled, true);
});

test("aircraft provider priority accepts the documented adsb_exchange name", () => {
    const providers = createAircraftProviders({
        AIRCRAFT_PROVIDER_PRIORITY: "adsb_lol,opensky,airplanes_live,adsb_one,adsb_exchange",
        ADSB_LOL_ENABLED: "true",
        AIRPLANES_LIVE_ENABLED: "true",
        ADSB_ONE_ENABLED: "true",
        ADSB_EXCHANGE_ENABLED: "true",
        ADSB_EXCHANGE_API_KEY: "test-key",
        OPENSKY_ENABLED: "true",
    });

    assert.deepEqual(providers.map((provider) => provider.id), [
        "adsb_lol",
        "opensky",
        "airplanes_live",
        "adsb_one",
        "adsbx",
        "plane_alert_db",
        "skylink",
    ]);
});
