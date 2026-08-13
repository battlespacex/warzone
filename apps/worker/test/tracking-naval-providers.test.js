import test from "node:test";
import assert from "node:assert/strict";

import { createAisHubProvider, normalizeAisHubRow } from "../src/tracking/naval/providers/aishub.js";
import { normalizeSpireRow } from "../src/tracking/naval/providers/spire.js";
import { normalizeMarineTrafficRow } from "../src/tracking/naval/providers/marinetraffic.js";
import { normalizeVesselFinderRow } from "../src/tracking/naval/providers/vesselfinder.js";
import { createNavalProviders } from "../src/tracking/naval/registry.js";
import { resetProviderHealth, runConfiguredProviders } from "../src/tracking/provider-health.js";

function response(payload) {
    return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async json() { return payload; },
        async text() { return JSON.stringify(payload); },
    };
}

test("AISHub normalizes documented human-readable fields and epoch timestamps", () => {
    const item = normalizeAisHubRow({
        MMSI: 368123456, IMO: 9876543, NAME: "USS EXAMPLE", CALLSIGN: "NAVY1",
        LAT: 36, LON: -72, SPEED: 12.5, COURSE: 91, HEADING: 90,
        TYPE: 35, TIME: 1_786_622_400, NAVSTAT: 0, DESTINATION: "NORFOLK",
    });
    assert.equal(item.mmsi, "368123456");
    assert.equal(item.observed_at, "2026-08-13T12:00:00.000Z");
    assert.equal(item.speed_kts, 12.5);
    assert.equal(item.provider_military_flag, true);
});

test("Spire, MarineTraffic and VesselFinder normalize to the same naval shape", () => {
    const rows = [
        normalizeSpireRow({ staticData: { mmsi: 368123456, imo: 9876543, name: "USS EXAMPLE", shipType: 35 }, lastPositionUpdate: { latitude: 36, longitude: -72, timestamp: "2026-08-13T12:00:00Z", speed: 12 } }),
        normalizeMarineTrafficRow({ MMSI: 368123456, IMO: 9876543, SHIPNAME: "USS EXAMPLE", LAT: 36, LON: -72, SPEED: 12, SHIPTYPE: 35, TIMESTAMP: "2026-08-13T12:00:00Z" }),
        normalizeVesselFinderRow({ AIS: { MMSI: 368123456, IMO: 9876543, NAME: "USS EXAMPLE", LATITUDE: 36, LONGITUDE: -72, SPEED: 12, TYPE: 35, TIMESTAMP: "2026-08-13T12:00:00Z" } }),
    ];
    assert.deepEqual(rows.map((row) => row.source), ["spire", "marinetraffic", "vesselfinder"]);
    assert.ok(rows.every((row) => row.domain === "naval" && row.mmsi === "368123456" && row.latitude === 36));
});

test("AISHub provider cannot run more often than its 60-second minimum", async () => {
    resetProviderHealth();
    let calls = 0;
    const provider = createAisHubProvider({
        enabled: true,
        username: "member",
        minimumIntervalMs: 1000,
        fetchImpl: async () => {
            calls += 1;
            return response([{ ERROR: false }, []]);
        },
    });
    const now = Date.parse("2026-08-13T12:00:00Z");
    await runConfiguredProviders("ais", [provider], { now, logger: { log() {}, warn() {} } });
    await runConfiguredProviders("ais", [provider], { now: now + 59_000, logger: { log() {}, warn() {} } });
    assert.equal(provider.minimumIntervalMs, 60_000);
    assert.equal(calls, 1);
});

test("all naval providers are disabled cleanly when credentials are absent", () => {
    const providers = createNavalProviders({
        AISSTREAM_ENABLED: "true",
        AISHUB_ENABLED: "true",
        SPIRE_AIS_ENABLED: "true",
        MARINETRAFFIC_ENABLED: "true",
        VESSELFINDER_ENABLED: "true",
    });
    assert.deepEqual(providers.map((provider) => provider.id), ["aisstream", "vesselapi", "aishub", "spire", "marinetraffic", "vesselfinder"]);
    assert.ok(providers.every((provider) => provider.enabled === false));
});

test("MarineTraffic and Spire require explicit customer endpoints", () => {
    const providers = createNavalProviders({
        MARINETRAFFIC_ENABLED: "true", MARINETRAFFIC_API_KEY: "key",
        SPIRE_AIS_ENABLED: "true", SPIRE_AIS_TOKEN: "token",
    });
    assert.equal(providers.find((provider) => provider.id === "marinetraffic").disabledReason, "INCOMPLETE_CONFIGURATION");
    assert.equal(providers.find((provider) => provider.id === "spire").disabledReason, "INCOMPLETE_CONFIGURATION");
});
