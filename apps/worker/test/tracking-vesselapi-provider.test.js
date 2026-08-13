import test from "node:test";
import assert from "node:assert/strict";

import { runAisWorker } from "../src/ais-worker.js";
import { mergeNavalObservations } from "../src/tracking/merge.js";
import {
    getProviderHealth,
    PROVIDER_HEALTH_STATES,
    resetProviderHealth,
    runConfiguredProviders,
} from "../src/tracking/provider-health.js";
import {
    createVesselApiProvider,
    createVesselApiStateStore,
    normalizeVesselApiResponse,
} from "../src/tracking/naval/providers/vesselapi.js";

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

function memoryStore(initialState) {
    return createVesselApiStateStore({ filePath: "", initialState });
}

function vesselPayload(overrides = {}) {
    return {
        vessel: {
            mmsi: 368926275,
            imo: 1234567,
            call_sign: "NAVY1",
            name: "USS EXAMPLE",
            name_ais: "WARSHIP",
            vessel_type: "Military / Warship",
            country: { name: "United States" },
            operating_status: "Active",
            speed_calculated_avg: 14.2,
            ...overrides,
        },
    };
}

test("VesselAPI MMSI lookup uses Bearer authentication and normalizes identity fields", async () => {
    let request;
    const provider = createVesselApiProvider({
        enabled: true,
        apiKey: "secret-test-key",
        stateStore: memoryStore(),
        fetchImpl: async (url, options) => {
            request = { url: String(url), authorization: options.headers.Authorization };
            return response(200, vesselPayload(), { "X-RateLimit-Remaining": "149" });
        },
        logger: { log() {}, warn() {} },
    });

    const result = await provider.lookupVesselByMmsi("368926275");

    assert.match(request.url, /\/v1\/vessel\/368926275\?filter\.idType=mmsi$/);
    assert.equal(request.authorization, "Bearer secret-test-key");
    assert.equal(result.observation.mmsi, "368926275");
    assert.equal(result.observation.imo, "1234567");
    assert.equal(result.observation.callsign, "NAVY1");
    assert.equal(result.observation.vessel_name, "USS EXAMPLE");
    assert.equal(result.observation.ship_type, "Military / Warship");
    assert.equal(result.observation.country, "United States");
    assert.equal(result.observation.operating_status, "Active");
    assert.equal(result.observation.latitude, null);
    assert.equal(result.diagnostics.quota_remaining, 149);
});

test("VesselAPI missing optional fields do not crash normalization", () => {
    const item = normalizeVesselApiResponse({ vessel: { mmsi: 368926275 } });
    assert.equal(item.mmsi, "368926275");
    assert.equal(item.imo, "");
    assert.equal(item.vessel_name, "");
    assert.equal(item.latitude, null);
});

test("AISStream plus VesselAPI same MMSI remains one enriched canonical vessel", () => {
    const live = {
        source: "aisstream", provider: "aisstream", observed_at: "2026-08-13T12:00:04Z",
        mmsi: "368926275", latitude: 36, longitude: -72, speed_kts: 12, priority: 0,
    };
    const enrichment = {
        ...normalizeVesselApiResponse(vesselPayload(), { requestedMmsi: "368926275", now: Date.parse("2026-08-13T12:00:05Z") }),
        priority: 1,
    };
    const canonical = mergeNavalObservations([live, enrichment]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "mmsi:368926275");
    assert.equal(canonical[0].source_count, 2);
    assert.equal(canonical[0].corroboration, "corroborated");
    assert.equal(canonical[0].imo, "1234567");
    assert.equal(canonical[0].vessel_name, "USS EXAMPLE");
    assert.equal(canonical[0].metadata.operating_status, "Active");
    assert.equal(canonical[0].latitude, 36);
    assert.equal(canonical[0].longitude, -72);
});

test("VesselAPI static response cannot overwrite a fresh AISStream position", () => {
    const enrichment = normalizeVesselApiResponse({
        vessel: { mmsi: 368926275, name: "USS EXAMPLE", latitude: 10, longitude: 10 },
    }, { now: Date.parse("2026-08-13T12:00:05Z") });
    const canonical = mergeNavalObservations([{
        source: "aisstream", observed_at: "2026-08-13T12:00:04Z", mmsi: "368926275",
        latitude: 36, longitude: -72, priority: 0,
    }, { ...enrichment, priority: 1 }]);
    assert.equal(canonical[0].latitude, 36);
    assert.equal(canonical[0].longitude, -72);
});

test("VesselAPI enforces five-hour cadence through provider health", async () => {
    resetProviderHealth();
    let calls = 0;
    const provider = createVesselApiProvider({
        enabled: true,
        apiKey: "key",
        minimumIntervalMs: 1000,
        stateStore: memoryStore(),
        fetchImpl: async () => {
            calls += 1;
            return response(200, vesselPayload(), { "X-RateLimit-Remaining": "149" });
        },
        logger: { log() {}, warn() {} },
    });
    const scheduled = { ...provider, fetchObservations: () => provider.fetchObservations({ mmsis: ["368926275"] }) };
    const now = Date.parse("2026-08-13T12:00:00Z");
    await runConfiguredProviders("ais", [scheduled], { now, logger: { log() {}, warn() {} } });
    await runConfiguredProviders("ais", [scheduled], { now: now + 4 * 60 * 60 * 1000, logger: { log() {}, warn() {} } });
    assert.equal(provider.minimumIntervalMs, 18_000_000);
    assert.equal(calls, 1);
});

test("VesselAPI persistent state preserves the five-hour ceiling across provider recreation", async () => {
    const store = memoryStore();
    let calls = 0;
    const options = {
        enabled: true,
        apiKey: "key",
        stateStore: store,
        fetchImpl: async () => {
            calls += 1;
            return response(200, vesselPayload(), { "X-RateLimit-Remaining": "149" });
        },
        logger: { log() {}, warn() {} },
    };
    const firstProvider = createVesselApiProvider(options);
    const started = Date.parse("2026-08-13T12:00:00Z");
    await firstProvider.fetchObservations({ mmsis: ["368926275"], now: started });
    const recreatedProvider = createVesselApiProvider(options);
    const blocked = await recreatedProvider.fetchObservations({ mmsis: ["368000001"], now: started + 60_000 });
    assert.equal(blocked.diagnostics.interval_blocked, true);
    assert.equal(calls, 1);
});

test("VesselAPI cache prevents repeated requests for the same MMSI", async () => {
    let calls = 0;
    const provider = createVesselApiProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => {
            calls += 1;
            return response(200, vesselPayload(), { "X-RateLimit-Remaining": "149" });
        },
        logger: { log() {}, warn() {} },
    });
    const first = await provider.lookupVesselByMmsi("368926275");
    const second = await provider.lookupVesselByMmsi("368926275");
    assert.equal(first.diagnostics.cached, false);
    assert.equal(second.diagnostics.cached, true);
    assert.equal(calls, 1);
});

test("VesselAPI parses remaining quota and stops automatic calls at reserve", async () => {
    let calls = 0;
    const logs = [];
    const provider = createVesselApiProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => {
            calls += 1;
            return response(200, vesselPayload(), { "X-RateLimit-Remaining": "10" });
        },
        logger: { log(message) { logs.push(message); }, warn(message) { logs.push(message); } },
    });
    const started = Date.now();
    const first = await provider.lookupVesselByMmsi("368926275", { now: started });
    const blocked = await provider.fetchObservations({ mmsis: ["368000001"], now: started + 18_000_000 });
    assert.equal(first.diagnostics.quota_remaining, 10);
    assert.equal(blocked.diagnostics.quota_blocked, true);
    assert.equal(blocked.observations.length, 0);
    assert.equal(calls, 1);
    assert.ok(logs.some((message) => /DEGRADED quota_remaining=10/.test(message)));
});

test("VesselAPI never logs its API key", async () => {
    const logs = [];
    const apiKey = "must-never-be-logged";
    const provider = createVesselApiProvider({
        enabled: true,
        apiKey,
        stateStore: memoryStore(),
        fetchImpl: async () => response(200, vesselPayload(), { "X-RateLimit-Remaining": "149" }),
        logger: { log(message) { logs.push(message); }, warn(message) { logs.push(message); } },
    });
    await provider.lookupVesselByMmsi("368926275");
    assert.doesNotMatch(logs.join("\n"), new RegExp(apiKey));
});

for (const status of [401, 403, 429]) {
    test(`VesselAPI HTTP ${status} uses shared provider-health backoff`, async () => {
        resetProviderHealth();
        const provider = createVesselApiProvider({
            enabled: true,
            apiKey: "key",
            stateStore: memoryStore(),
            fetchImpl: async () => response(status, { error: { message: "blocked" } }, status === 429 ? { "Retry-After": "30" } : {}),
            logger: { log() {}, warn() {} },
        });
        const scheduled = { ...provider, fetchObservations: () => provider.fetchObservations({ mmsis: ["368926275"] }) };
        await runConfiguredProviders("ais", [scheduled], { logger: { log() {}, warn() {} } });
        assert.equal(getProviderHealth("ais", "vesselapi").status, PROVIDER_HEALTH_STATES.BACKOFF);
    });
}

test("StratOps naval cycle enriches one live MMSI and performs one canonical track upsert", async () => {
    resetProviderHealth();
    const liveProvider = {
        id: "aisstream", enabled: true, priority: 0,
        async fetchObservations() {
            return [{
                source: "aisstream", provider: "aisstream", observed_at: new Date().toISOString(),
                mmsi: "368926275", vessel_name: "USS EXAMPLE", latitude: 36, longitude: -72,
                ship_type: 35, provider_military_flag: true,
            }];
        },
    };
    const vesselApi = createVesselApiProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => response(200, vesselPayload(), { "X-RateLimit-Remaining": "149" }),
        logger: { log() {}, warn() {} },
    });
    const trackBatches = [];
    const result = await runAisWorker({
        providers: [liveProvider, { ...vesselApi, priority: 1 }],
        logger: { log() {}, warn() {} },
        persistence: {
            async endAliases() {}, async upsertEvents() {}, async upsertHistory() {},
            async upsertTracks(rows) { trackBatches.push(rows); return rows.length; },
        },
    });
    assert.equal(result.canonical, 1);
    assert.equal(result.corroborated, 1);
    assert.equal(trackBatches.length, 1);
    assert.equal(trackBatches[0][0].track_key, "ais-368926275");
    assert.equal(trackBatches[0][0].metadata.source_count, 2);
});
