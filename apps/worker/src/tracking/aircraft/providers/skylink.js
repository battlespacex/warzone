import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

import { fetchJson, ProviderRequestError } from "../../http.js";

const DEFAULT_BASE_URL = "https://data.skylinkapi.com/v3.1";
const DEFAULT_MINIMUM_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MONTHLY_BUDGET = 1000;
const DEFAULT_MIN_REMAINING = 50;
const DEFAULT_CACHE_MAX_ENTRIES = 2000;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_FILE = path.resolve(moduleDirectory, "../../../../.cache/skylink-aircraft-identity.json");

function currentMonth(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 7);
}

function emptyState(now = Date.now()) {
    return {
        month: currentMonth(now),
        requests: 0,
        totalCalls: 0,
        cacheHits: 0,
        cacheMisses: 0,
        skippedExistingMetadata: 0,
        skippedNonMilitary: 0,
        enrichmentSuccesses: 0,
        failures: 0,
        rateLimited: 0,
        quotaRemaining: null,
        quotaResetAt: null,
        lastRequestAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureStatus: null,
        entries: {},
    };
}

function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function quotaResetTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeState(value, now = Date.now()) {
    const source = value && typeof value === "object" ? value : {};
    const state = { ...emptyState(now), ...source };
    if (state.month !== currentMonth(now)) {
        state.month = currentMonth(now);
        state.requests = 0;
        state.quotaRemaining = null;
        state.quotaResetAt = null;
        state.rateLimited = 0;
    }
    for (const key of [
        "requests", "totalCalls", "cacheHits", "cacheMisses", "skippedExistingMetadata",
        "skippedNonMilitary", "enrichmentSuccesses", "failures", "rateLimited",
    ]) {
        state[key] = Math.max(0, Number(state[key]) || 0);
    }
    state.quotaRemaining = finiteOrNull(state.quotaRemaining);
    state.lastRequestAt = finiteOrNull(state.lastRequestAt);
    state.entries = state.entries && typeof state.entries === "object" ? state.entries : {};
    return state;
}

export function createSkyLinkStateStore({ filePath = DEFAULT_CACHE_FILE, initialState } = {}) {
    let memory = initialState ? normalizeState(initialState) : null;
    return {
        load(now = Date.now()) {
            if (memory) return normalizeState(memory, now);
            try {
                memory = normalizeState(JSON.parse(fs.readFileSync(filePath, "utf8")), now);
            } catch {
                memory = emptyState(now);
            }
            return normalizeState(memory, now);
        },
        save(state) {
            memory = normalizeState(state);
            if (!filePath) return;
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const temporaryPath = `${filePath}.tmp`;
            fs.writeFileSync(temporaryPath, JSON.stringify(memory), "utf8");
            fs.renameSync(temporaryPath, filePath);
        },
    };
}

export function normalizeIcao24(value) {
    const clean = String(value || "").trim().replace(/^0x/i, "").toLowerCase();
    if (!/^[0-9a-f]{4,6}$/.test(clean)) return "";
    return clean.padStart(6, "0");
}

function cleanText(value) {
    return String(value ?? "").trim();
}

export function hasSufficientAircraftMetadata(aircraft = {}) {
    const registration = cleanText(aircraft.registration || aircraft.reg);
    const type = cleanText(aircraft.aircraft_type || aircraft.typeCode || aircraft.type_code);
    const model = cleanText(aircraft.model || aircraft.modelName || aircraft.model_name);
    const operator = cleanText(aircraft.operator || aircraft.owner);
    return Boolean(registration && (type || model || operator));
}

export function normalizeSkyLinkAircraftResponse(payload = {}, { requestedIcao24 = "", now = Date.now() } = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.found !== "boolean") {
        throw new ProviderRequestError("malformed SkyLink aircraft response", { code: "EBADRESPONSE" });
    }
    if (payload.found === false) return null;
    const aircraft = payload.aircraft;
    if (!aircraft || typeof aircraft !== "object" || Array.isArray(aircraft)) {
        throw new ProviderRequestError("malformed SkyLink aircraft response", { code: "EBADRESPONSE" });
    }
    const icao24 = normalizeIcao24(aircraft.icao24 || requestedIcao24);
    if (!icao24) throw new ProviderRequestError("SkyLink response omitted a valid ICAO24", { code: "EBADRESPONSE" });
    const observedAt = new Date(now).toISOString();
    return {
        domain: "aircraft",
        source: "skylink",
        provider: "skylink",
        observed_at: observedAt,
        icao24,
        registration: cleanText(aircraft.registration).toUpperCase(),
        callsign: "",
        aircraft_type: cleanText(aircraft.icao_type).toUpperCase(),
        model: cleanText(aircraft.type_name || aircraft.manufacturer_and_model),
        operator: cleanText(aircraft.owner_operator),
        country: "",
        latitude: null,
        longitude: null,
        military_hint: false,
        provider_military_flag: false,
        metadata_sources: ["skylink"],
        metadata: {
            identity_source: "skylink",
            identity_fetched_at: observedAt,
            manufacturer: cleanText(aircraft.manufacturer),
            manufacturer_and_model: cleanText(aircraft.manufacturer_and_model),
            airline_code: cleanText(aircraft.airline_code),
            is_private_operator: aircraft.is_private_operator === true,
            serial_number: cleanText(aircraft.serial_number),
            year_built: cleanText(aircraft.year_built),
        },
    };
}

function headerNumber(headers, names) {
    for (const name of names) {
        const number = Number(headers?.get?.(name));
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function headerText(headers, names) {
    for (const name of names) {
        const value = headers?.get?.(name);
        if (value) return String(value);
    }
    return null;
}

function cachedObservation(entry, now) {
    if (!entry?.observation) return null;
    return {
        ...entry.observation,
        observed_at: new Date(now).toISOString(),
        metadata: {
            ...(entry.observation.metadata || {}),
            identity_fetched_at: new Date(entry.cachedAt).toISOString(),
            identity_cache_hit: true,
        },
    };
}

export function createSkyLinkProvider({
    enabled,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    minimumIntervalMs = DEFAULT_MINIMUM_INTERVAL_MS,
    identityCacheTtlMs = DEFAULT_CACHE_TTL_MS,
    negativeCacheTtlMs = DEFAULT_NEGATIVE_CACHE_TTL_MS,
    monthlyRequestBudget = DEFAULT_MONTHLY_BUDGET,
    minRemainingRequests = DEFAULT_MIN_REMAINING,
    cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    requestTimeoutMs = 15_000,
    stateStore = createSkyLinkStateStore(),
    fetchImpl,
    logger = console,
} = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && apiKey && baseUrl);
    const effectiveMinimumIntervalMs = Math.max(DEFAULT_MINIMUM_INTERVAL_MS, Number(minimumIntervalMs) || DEFAULT_MINIMUM_INTERVAL_MS);
    let lastQuotaLog = null;
    let runtimeCacheHits = 0;

    function loadState(now = Date.now()) {
        const state = normalizeState(stateStore.load(now), now);
        const resetAt = quotaResetTimestamp(state.quotaResetAt);
        if (state.quotaRemaining != null && state.quotaRemaining <= 0 && resetAt != null && resetAt <= now) {
            state.quotaRemaining = null;
            state.quotaResetAt = null;
        }
        const positiveTtl = Math.max(60_000, Number(identityCacheTtlMs) || DEFAULT_CACHE_TTL_MS);
        const negativeTtl = Math.max(60_000, Number(negativeCacheTtlMs) || DEFAULT_NEGATIVE_CACHE_TTL_MS);
        for (const [icao24, entry] of Object.entries(state.entries)) {
            const ttl = entry?.notFound ? negativeTtl : positiveTtl;
            if (now - Number(entry?.cachedAt || 0) >= ttl) delete state.entries[icao24];
        }
        return state;
    }

    function saveState(state) {
        const maxEntries = Math.max(1, Number(cacheMaxEntries) || DEFAULT_CACHE_MAX_ENTRIES);
        const ordered = Object.entries(state.entries)
            .sort((a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0));
        state.entries = Object.fromEntries(ordered.slice(0, maxEntries));
        stateStore.save(state);
    }

    function quotaStatus(state) {
        const budget = Math.max(1, Number(monthlyRequestBudget) || DEFAULT_MONTHLY_BUDGET);
        const reserve = Math.max(0, Number(minRemainingRequests) || DEFAULT_MIN_REMAINING);
        const estimatedRemaining = Math.max(0, budget - state.requests);
        const upstreamExhausted = state.quotaRemaining != null && state.quotaRemaining <= 0;
        return {
            blocked: estimatedRemaining <= reserve || upstreamExhausted,
            estimatedRemaining,
            upstreamRemaining: state.quotaRemaining,
        };
    }

    function logQuota(quota, status = "HEALTHY") {
        const signature = `${status}:${quota.estimatedRemaining}:${quota.upstreamRemaining}`;
        if (lastQuotaLog === signature) return;
        lastQuotaLog = signature;
        const method = status === "HEALTHY" ? "log" : "warn";
        logger?.[method]?.(`[adsb:skylink] ${status} monthly_estimated_remaining=${quota.estimatedRemaining} upstream_remaining=${quota.upstreamRemaining ?? "unknown"}`);
    }

    function diagnostics(state, extra = {}) {
        const quota = quotaStatus(state);
        return {
            ...extra,
            calls_made: state.totalCalls,
            calls_this_month: state.requests,
            cache_hits: state.cacheHits + runtimeCacheHits,
            cache_misses: state.cacheMisses,
            skipped_existing_metadata: state.skippedExistingMetadata,
            skipped_non_military: state.skippedNonMilitary,
            enrichment_successes: state.enrichmentSuccesses,
            failures: state.failures,
            rate_limited: state.rateLimited,
            monthly_estimated_remaining: quota.estimatedRemaining,
            quota_remaining: quota.upstreamRemaining,
            quota_reset_at: state.quotaResetAt,
            quota_blocked: quota.blocked,
            last_success_at: state.lastSuccessAt,
            last_failure_at: state.lastFailureAt,
            last_failure_status: state.lastFailureStatus,
        };
    }

    async function lookupAircraft(icaoValue, { now = Date.now(), automatic = true } = {}) {
        const icao24 = normalizeIcao24(icaoValue);
        if (!icao24) return { observation: null, diagnostics: { cached: false, skipped: "invalid_icao24" } };
        const state = loadState(now);
        const entry = state.entries[icao24];
        if (entry) {
            state.cacheHits += 1;
            saveState(state);
            return {
                observation: cachedObservation(entry, now),
                diagnostics: diagnostics(state, { cached: true, not_found: entry.notFound === true }),
            };
        }
        state.cacheMisses += 1;
        const quota = quotaStatus(state);
        if (automatic && state.lastRequestAt != null && now - state.lastRequestAt < effectiveMinimumIntervalMs) {
            saveState(state);
            return {
                observation: null,
                diagnostics: diagnostics(state, {
                    cached: false,
                    interval_blocked: true,
                    next_lookup_at: new Date(state.lastRequestAt + effectiveMinimumIntervalMs).toISOString(),
                }),
            };
        }
        if (automatic && quota.blocked) {
            saveState(state);
            logQuota(quota, "DEGRADED");
            return { observation: null, diagnostics: diagnostics(state, { cached: false }) };
        }

        const url = new URL(`/v3.1/aircraft/icao24/${encodeURIComponent(icao24)}`, baseUrl);
        if (/\/v3\.1\/?$/i.test(new URL(baseUrl).pathname)) {
            url.pathname = `${new URL(baseUrl).pathname.replace(/\/$/, "")}/aircraft/icao24/${encodeURIComponent(icao24)}`;
        }
        url.searchParams.set("photos", "false");
        let responseHeaders = null;
        const actualFetch = fetchImpl || fetch;
        const wrappedFetch = async (...args) => {
            const response = await actualFetch(...args);
            responseHeaders = response.headers;
            return response;
        };
        state.requests += 1;
        state.totalCalls += 1;
        state.lastRequestAt = now;
        saveState(state);
        try {
            const payload = await fetchJson(url.toString(), {
                headers: { Accept: "application/json", "x-api-key": apiKey },
            }, { timeoutMs: Math.max(1, Number(requestTimeoutMs) || 15_000), fetchImpl: wrappedFetch });
            const upstreamRemaining = headerNumber(responseHeaders, [
                "x-ratelimit-requests-remaining", "x-ratelimit-remaining",
            ]);
            if (upstreamRemaining != null) state.quotaRemaining = upstreamRemaining;
            state.quotaResetAt = headerText(responseHeaders, ["x-ratelimit-requests-reset", "x-ratelimit-reset"]);
            const observation = normalizeSkyLinkAircraftResponse(payload, { requestedIcao24: icao24, now });
            state.entries[icao24] = observation
                ? { cachedAt: now, observation }
                : { cachedAt: now, notFound: true };
            state.lastSuccessAt = new Date(now).toISOString();
            state.lastFailureStatus = null;
            if (observation) state.enrichmentSuccesses += 1;
            saveState(state);
            const updatedQuota = quotaStatus(state);
            logQuota(updatedQuota, updatedQuota.blocked ? "DEGRADED" : "HEALTHY");
            return {
                observation,
                diagnostics: diagnostics(state, { cached: false, not_found: observation == null }),
            };
        } catch (error) {
            const upstreamRemaining = headerNumber(responseHeaders, [
                "x-ratelimit-requests-remaining", "x-ratelimit-remaining",
            ]);
            if (upstreamRemaining != null) state.quotaRemaining = upstreamRemaining;
            state.quotaResetAt = headerText(responseHeaders, ["x-ratelimit-requests-reset", "x-ratelimit-reset"]);
            state.failures += 1;
            state.lastFailureAt = new Date(now).toISOString();
            state.lastFailureStatus = Number(error?.status || 0) || error?.code || "request_failed";
            if (Number(error?.status) === 429) state.rateLimited += 1;
            saveState(state);
            throw error;
        }
    }

    return {
        id: "skylink",
        enabled: configured,
        enrichmentOnly: true,
        disabledReason: requested && !apiKey ? "MISSING_CREDENTIALS" : (requested && !baseUrl ? "INCOMPLETE_CONFIGURATION" : "DISABLED_BY_CONFIG"),
        minimumIntervalMs: effectiveMinimumIntervalMs,
        lookupAircraftByIcao24(icao24, options) {
            return lookupAircraft(icao24, options);
        },
        getCachedObservations(icaoValues = [], { now = Date.now() } = {}) {
            const state = loadState(now);
            const cached = [...new Set(icaoValues.map(normalizeIcao24).filter(Boolean))]
                .map((icao24) => cachedObservation(state.entries[icao24], now))
                .filter(Boolean);
            runtimeCacheHits += cached.length;
            return cached;
        },
        getDiagnostics({ now = Date.now() } = {}) {
            return diagnostics(loadState(now));
        },
        async fetchObservations({ candidates = [], now = Date.now() } = {}) {
            const state = loadState(now);
            const candidate = candidates.find((item) => {
                if (item?.military_candidate !== true) {
                    state.skippedNonMilitary += 1;
                    return false;
                }
                if (hasSufficientAircraftMetadata(item)) {
                    state.skippedExistingMetadata += 1;
                    return false;
                }
                const icao24 = normalizeIcao24(item.icao24 || item.icao);
                return Boolean(icao24 && !state.entries[icao24]);
            });
            saveState(state);
            if (!candidate) return { observations: [], diagnostics: diagnostics(state, { skipped: "no_candidate" }) };
            const result = await lookupAircraft(candidate.icao24 || candidate.icao, { now, automatic: true });
            return { observations: result.observation ? [result.observation] : [], diagnostics: result.diagnostics };
        },
    };
}
