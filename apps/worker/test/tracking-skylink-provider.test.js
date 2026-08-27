import test from "node:test";
import assert from "node:assert/strict";

import {
    createSkyLinkProvider,
    createSkyLinkStateStore,
    hasSufficientAircraftMetadata,
    normalizeIcao24,
} from "../src/tracking/aircraft/providers/skylink.js";
import {
    getProviderHealth,
    PROVIDER_HEALTH_STATES,
    resetProviderHealth,
    runConfiguredProviders,
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

function memoryStore(initialState) {
    return createSkyLinkStateStore({ filePath: "", initialState });
}

function aircraftPayload(overrides = {}) {
    return {
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
            airline_code: null,
            is_private_operator: false,
            serial_number: "P-123",
            year_built: "2002",
            ...overrides,
        },
    };
}

test("SkyLink ICAO24 lookup uses direct v3.1 x-api-key authentication and normalizes metadata", async () => {
    let request;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "secret-test-key",
        stateStore: memoryStore(),
        fetchImpl: async (url, options) => {
            request = { url: String(url), apiKey: options.headers["x-api-key"] };
            return response(200, aircraftPayload(), { "X-RateLimit-Requests-Remaining": "997" });
        },
        logger: { log() {}, warn() {} },
    });

    const result = await provider.lookupAircraftByIcao24("Ae1234");

    assert.match(request.url, /^https:\/\/data\.skylinkapi\.com\/v3\.1\/aircraft\/icao24\/ae1234\?photos=false$/);
    assert.equal(request.apiKey, "secret-test-key");
    assert.equal(result.observation.icao24, "ae1234");
    assert.equal(result.observation.registration, "82-1234");
    assert.equal(result.observation.aircraft_type, "C17");
    assert.equal(result.observation.model, "C-17A Globemaster III");
    assert.equal(result.observation.operator, "United States Air Force");
    assert.equal(result.observation.latitude, null);
    assert.deepEqual(result.observation.metadata_sources, ["skylink"]);
    assert.equal(result.diagnostics.quota_remaining, 997);
    assert.equal(result.diagnostics.calls_this_month, 1);
});

test("SkyLink remains disabled when SKYLINK_API_KEY is absent", async () => {
    let calls = 0;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "",
        fetchImpl: async () => { calls += 1; return response(200, aircraftPayload()); },
    });
    assert.equal(provider.enabled, false);
    assert.equal(provider.disabledReason, "MISSING_CREDENTIALS");
    assert.equal(calls, 0);
});

test("SkyLink cache prevents repeated requests for the same normalized ICAO24", async () => {
    let calls = 0;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => { calls += 1; return response(200, aircraftPayload()); },
        logger: { log() {}, warn() {} },
    });
    const first = await provider.lookupAircraftByIcao24("AE1234");
    const second = await provider.lookupAircraftByIcao24("ae1234");
    assert.equal(first.diagnostics.cached, false);
    assert.equal(first.diagnostics.cache_misses, 1);
    assert.equal(second.diagnostics.cached, true);
    assert.equal(second.diagnostics.cache_hits, 1);
    assert.equal(calls, 1);
});

test("SkyLink unknown-aircraft response is negative-cached and is not retried", async () => {
    let calls = 0;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => { calls += 1; return response(200, { query: "AE9999", found: false, aircraft: null }); },
        logger: { log() {}, warn() {} },
    });
    const first = await provider.lookupAircraftByIcao24("AE9999");
    const second = await provider.lookupAircraftByIcao24("ae9999");
    assert.equal(first.observation, null);
    assert.equal(first.diagnostics.not_found, true);
    assert.equal(second.observation, null);
    assert.equal(second.diagnostics.cached, true);
    assert.equal(calls, 1);
});

for (const status of [401, 403, 404, 429, 500]) {
    test(`SkyLink handles HTTP ${status} without returning an aircraft`, async () => {
        const provider = createSkyLinkProvider({
            enabled: true,
            apiKey: "key",
            stateStore: memoryStore(),
            fetchImpl: async () => response(status, { detail: "upstream failure" }, status === 429 ? { "Retry-After": "30" } : {}),
            logger: { log() {}, warn() {} },
        });
        await assert.rejects(provider.lookupAircraftByIcao24("AE1234"), (error) => {
            assert.equal(error.status, status);
            if (status === 429) assert.equal(error.retryAfterMs, 30_000);
            return true;
        });
        assert.equal(provider.getDiagnostics().failures, 1);
        assert.equal(provider.getDiagnostics().rate_limited, status === 429 ? 1 : 0);
    });
}

test("SkyLink timeout is isolated as ETIMEDOUT", async () => {
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        requestTimeoutMs: 10,
        fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            });
        }),
        logger: { log() {}, warn() {} },
    });
    await assert.rejects(provider.lookupAircraftByIcao24("AE1234"), (error) => error.code === "ETIMEDOUT");
});

test("SkyLink rejects malformed successful responses", async () => {
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => response(200, { found: true, aircraft: null }),
        logger: { log() {}, warn() {} },
    });
    await assert.rejects(provider.lookupAircraftByIcao24("AE1234"), (error) => error.code === "EBADRESPONSE");
});

test("SkyLink skips civilian candidates and aircraft with sufficient fresh metadata", async () => {
    let calls = 0;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => { calls += 1; return response(200, aircraftPayload()); },
        logger: { log() {}, warn() {} },
    });
    const result = await provider.fetchObservations({ candidates: [
        { icao24: "a00001", military_candidate: false },
        { icao24: "ae1234", military_candidate: true, registration: "82-1234", aircraft_type: "C17" },
    ] });
    assert.equal(result.observations.length, 0);
    assert.equal(result.diagnostics.skipped_non_military, 1);
    assert.equal(result.diagnostics.skipped_existing_metadata, 1);
    assert.equal(calls, 0);
    assert.equal(hasSufficientAircraftMetadata({ registration: "N1", model: "Gulfstream" }), true);
});

test("confirmed military candidate missing metadata can be enriched once", async () => {
    let calls = 0;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => { calls += 1; return response(200, aircraftPayload()); },
        logger: { log() {}, warn() {} },
    });
    const result = await provider.fetchObservations({ candidates: [
        { icao24: "AE1234", military_candidate: true },
    ] });
    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].operator, "United States Air Force");
    assert.equal(calls, 1);
});

test("SkyLink monthly reserve blocks automatic calls before exhausting 1,000 requests", async () => {
    let calls = 0;
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        monthlyRequestBudget: 1000,
        minRemainingRequests: 50,
        stateStore: memoryStore({ month: new Date().toISOString().slice(0, 7), requests: 950, entries: {} }),
        fetchImpl: async () => { calls += 1; return response(200, aircraftPayload()); },
        logger: { log() {}, warn() {} },
    });
    const result = await provider.fetchObservations({ candidates: [{ icao24: "AE1234", military_candidate: true }] });
    assert.equal(result.observations.length, 0);
    assert.equal(result.diagnostics.quota_blocked, true);
    assert.equal(result.diagnostics.monthly_estimated_remaining, 50);
    assert.equal(calls, 0);
});

test("expired upstream quota reset header releases the upstream block", async () => {
    let calls = 0;
    const now = Date.parse("2026-08-27T12:00:00Z");
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore({
            month: "2026-08",
            requests: 1,
            quotaRemaining: 0,
            quotaResetAt: String((now - 60_000) / 1000),
            lastRequestAt: now - (2 * 60 * 60 * 1000),
            entries: {},
        }),
        fetchImpl: async () => { calls += 1; return response(200, aircraftPayload()); },
        logger: { log() {}, warn() {} },
    });
    const result = await provider.fetchObservations({
        candidates: [{ icao24: "AE1234", military_candidate: true }],
        now,
    });
    assert.equal(result.observations.length, 1);
    assert.equal(calls, 1);
});

test("SkyLink 429 uses shared provider-health Retry-After backoff", async () => {
    resetProviderHealth();
    const provider = createSkyLinkProvider({
        enabled: true,
        apiKey: "key",
        stateStore: memoryStore(),
        fetchImpl: async () => response(429, { detail: "rate limited" }, { "Retry-After": "30" }),
        logger: { log() {}, warn() {} },
    });
    const scheduled = { ...provider, fetchObservations: () => provider.fetchObservations({ candidates: [{ icao24: "AE1234", military_candidate: true }] }) };
    await runConfiguredProviders("adsb", [scheduled], { logger: { log() {}, warn() {} } });
    assert.equal(getProviderHealth("adsb", "skylink").status, PROVIDER_HEALTH_STATES.BACKOFF);
});

test("ICAO24 normalization canonicalizes case and leading zeros", () => {
    assert.equal(normalizeIcao24("Ae1234"), "ae1234");
    assert.equal(normalizeIcao24("ABC1"), "00abc1");
    assert.equal(normalizeIcao24("not-hex"), "");
});
