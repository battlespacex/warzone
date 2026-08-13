import test from "node:test";
import assert from "node:assert/strict";

import { createAdsbLolProvider, normalizeAdsbLolAircraft } from "../src/tracking/aircraft/providers/adsb-lol.js";
import { mergeAircraftObservations } from "../src/tracking/merge.js";
import {
    getProviderHealth,
    PROVIDER_HEALTH_STATES,
    resetProviderHealth,
    runConfiguredProviders,
} from "../src/tracking/provider-health.js";

const NOW = Date.parse("2026-08-13T12:00:00Z");

function response(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get() { return null; } },
        async json() { return payload; },
        async text() { return JSON.stringify(payload); },
    };
}

test("ADSB.lol provider fetches and normalizes valid aircraft", async () => {
    let requestedUrl = "";
    const provider = createAdsbLolProvider({
        enabled: true,
        baseUrl: "https://api.adsb.lol",
        fetchImpl: async (url) => {
            requestedUrl = String(url);
            return response(200, {
                msg: "No error",
                total: 1,
                ac: [{ hex: "AE2764", flight: "RCH123 ", lat: 43, lon: -79, seen: 1, seen_pos: 2, alt_baro: 22000, gs: 410, track: 90, dbFlags: 1 }],
            });
        },
    });

    const result = await provider.fetchObservations();

    assert.equal(requestedUrl, "https://api.adsb.lol/v2/mil");
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].icao24, "ae2764");
    assert.equal(result.observations[0].callsign, "RCH123");
    assert.equal(result.diagnostics.valid, 1);
});

test("ADSB.lol hex maps to the existing canonical ICAO identity", () => {
    const observation = normalizeAdsbLolAircraft({ hex: " AE2764 ", lat: 43, lon: -79, seen_pos: 1, dbFlags: 1 }, { now: NOW });
    const canonical = mergeAircraftObservations([observation]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "icao:ae2764");
});

test("ADSB.lol and another provider with the same ICAO create one aircraft", () => {
    const adsbLol = normalizeAdsbLolAircraft({ hex: "ae2764", lat: 43, lon: -79, seen_pos: 2, dbFlags: 1 }, { now: NOW });
    const other = {
        domain: "aircraft",
        source: "opensky",
        observed_at: new Date(NOW - 1000).toISOString(),
        icao24: "AE2764",
        latitude: 43.001,
        longitude: -79.001,
        military_hint: true,
    };
    const canonical = mergeAircraftObservations([adsbLol, other]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].source_count, 2);
    assert.equal(canonical[0].corroboration, "corroborated");
});

test("ADSB.lol receiver reference coordinates are never aircraft coordinates", () => {
    const observation = normalizeAdsbLolAircraft({
        hex: "ae2764",
        rr_lat: 30.3,
        rr_lon: -85.7,
        seen: 1,
        dbFlags: 1,
    }, { now: NOW });

    assert.equal(observation.latitude, null);
    assert.equal(observation.longitude, null);
    assert.equal(observation.position_source, "none");
});

test("ADSB.lol missing optional fields do not crash normalization", () => {
    const observation = normalizeAdsbLolAircraft({ hex: "ae2764", lat: 43, lon: -79 }, { now: NOW });

    assert.equal(observation.icao24, "ae2764");
    assert.equal(observation.latitude, 43);
    assert.equal(observation.registration, "");
    assert.equal(observation.altitude_ft, null);
});

test("ADSB.lol ground altitude is represented safely", () => {
    const observation = normalizeAdsbLolAircraft({ hex: "ae2764", lat: 43, lon: -79, seen_pos: 1, alt_baro: "ground" }, { now: NOW });

    assert.equal(observation.on_ground, true);
    assert.equal(observation.altitude_ft, 0);
});

test("stale ADSB.lol lastPosition is not promoted as a fresh position", () => {
    const observation = normalizeAdsbLolAircraft({
        hex: "ae2764",
        rr_lat: 30.3,
        rr_lon: -85.7,
        lastPosition: { lat: 31.14, lon: -85.75, seen_pos: 124.4 },
    }, { now: NOW, positionMaxAgeSeconds: 90 });

    assert.equal(observation.latitude, null);
    assert.equal(observation.longitude, null);
    assert.equal(observation.position_source, "none");
});

test("failed ADSB.lol request uses existing provider health backoff", async () => {
    resetProviderHealth();
    const provider = createAdsbLolProvider({
        enabled: true,
        fetchImpl: async () => response(503, { error: "unavailable" }),
    });
    const results = await runConfiguredProviders("adsb", [provider], {
        now: NOW,
        logger: { log() {}, warn() {} },
    });

    assert.equal(results.length, 0);
    assert.equal(getProviderHealth("adsb", "adsb_lol").status, PROVIDER_HEALTH_STATES.BACKOFF);
    assert.equal(getProviderHealth("adsb", "adsb_lol").last_status_code, 503);
});
