import test from "node:test";
import assert from "node:assert/strict";

import { runAdsbWorker } from "../src/adsb-worker.js";
import { createSkyLinkProvider, createSkyLinkStateStore } from "../src/tracking/aircraft/providers/skylink.js";
import {
    getProviderHealth,
    PROVIDER_HEALTH_STATES,
    resetProviderHealth,
} from "../src/tracking/provider-health.js";

function response(status, payload, headers = {}) {
    const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get(name) { return normalizedHeaders[String(name).toLowerCase()] ?? null; } },
        async json() { return payload; },
        async text() { return JSON.stringify(payload); },
    };
}

function liveMilitaryProvider(id = "adsb_lol") {
    return {
        id,
        enabled: true,
        priority: 0,
        async fetchObservations() {
            return {
                observations: [{
                    source: id,
                    provider: id,
                    observed_at: "2026-08-27T12:00:00.000Z",
                    icao24: "ae1234",
                    latitude: 40,
                    longitude: -70,
                    altitude_ft: 25_000,
                    speed_kts: 420,
                    military_hint: true,
                    provider_military_flag: true,
                }],
                diagnostics: { fetched: 1, normalized: 1, valid: 1 },
            };
        },
    };
}

function persistenceCapture() {
    const batches = { events: [], tracks: [], history: [] };
    return {
        batches,
        persistence: {
            async upsertEvents(rows) { batches.events.push(rows); },
            async upsertTracks(rows) { batches.tracks.push(rows); return rows.length; },
            async upsertHistory(rows) { batches.history.push(rows); },
        },
    };
}

const quietLogger = { log() {}, warn() {}, error() {} };

test("aircraft worker enriches one military track with SkyLink without duplicating persistence", async () => {
    resetProviderHealth();
    let skyLinkCalls = 0;
    const skyLink = createSkyLinkProvider({
        enabled: true,
        apiKey: "test-key",
        stateStore: createSkyLinkStateStore({ filePath: "" }),
        fetchImpl: async () => {
            skyLinkCalls += 1;
            return response(200, {
                query: "AE1234",
                found: true,
                aircraft: {
                    registration: "82-1234",
                    icao24: "AE1234",
                    icao_type: "C17",
                    type_name: "C-17A Globemaster III",
                    manufacturer: "Boeing",
                    manufacturer_and_model: "Boeing C-17A Globemaster III",
                    owner_operator: "United States Air Force",
                },
            }, { "X-RateLimit-Requests-Remaining": "999" });
        },
        logger: quietLogger,
    });
    const capture = persistenceCapture();
    const result = await runAdsbWorker({
        providers: [liveMilitaryProvider(), { ...skyLink, priority: 10 }],
        persistence: capture.persistence,
        logger: quietLogger,
        now: Date.parse("2026-08-27T12:00:00Z"),
    });

    assert.equal(skyLinkCalls, 1);
    assert.equal(result.canonical, 1);
    assert.equal(result.upserted, 1);
    assert.equal(capture.batches.tracks.length, 1);
    assert.equal(capture.batches.tracks[0].length, 1);
    assert.equal(capture.batches.tracks[0][0].track_key, "adsb-ae1234");
    assert.equal(capture.batches.tracks[0][0].metadata.registration, "82-1234");
    assert.equal(capture.batches.tracks[0][0].metadata.operator, "United States Air Force");
    assert.deepEqual(capture.batches.tracks[0][0].metadata.metadata_sources, ["skylink"]);
    assert.equal(capture.batches.history[0].length, 1);
});

test("one failed aircraft provider does not stop another provider or persistence", async () => {
    resetProviderHealth();
    const blocked = {
        id: "airplanes_live",
        enabled: true,
        priority: 1,
        async fetchObservations() {
            const error = new Error("forbidden");
            error.status = 403;
            throw error;
        },
    };
    const capture = persistenceCapture();
    const result = await runAdsbWorker({
        providers: [liveMilitaryProvider(), blocked],
        persistence: capture.persistence,
        logger: quietLogger,
        now: Date.parse("2026-08-27T12:00:00Z"),
    });

    assert.equal(result.canonical, 1);
    assert.equal(result.upserted, 1);
    assert.equal(getProviderHealth("adsb", "airplanes_live").status, PROVIDER_HEALTH_STATES.BACKOFF);
    assert.equal(capture.batches.tracks[0][0].track_key, "adsb-ae1234");
});
