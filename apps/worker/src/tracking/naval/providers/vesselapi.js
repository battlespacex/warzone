import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";

import { fetchJson } from "../../http.js";
import {
    navalDigits,
    navalNumber,
    navalText,
    navalValue,
    normalizeNavalObservation,
} from "../normalize.js";

const DEFAULT_BASE_URL = "https://api.vesselapi.com";
const DEFAULT_MINIMUM_INTERVAL_MS = 5 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MONTHLY_BUDGET = 150;
const DEFAULT_MIN_REMAINING = 10;
const DEFAULT_CACHE_MAX_ENTRIES = 500;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CACHE_FILE = path.resolve(moduleDirectory, "../../../../.cache/vesselapi-identity.json");

function currentMonth(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 7);
}

function emptyState(now = Date.now()) {
    return { month: currentMonth(now), requests: 0, quotaRemaining: null, lastRequestAt: null, entries: {} };
}

function normalizeState(value, now = Date.now()) {
    const state = value && typeof value === "object" ? value : emptyState(now);
    if (state.month !== currentMonth(now)) return emptyState(now);
    return {
        month: state.month,
        requests: Math.max(0, Number(state.requests) || 0),
        quotaRemaining: state.quotaRemaining !== null
            && state.quotaRemaining !== undefined
            && state.quotaRemaining !== ""
            && Number.isFinite(Number(state.quotaRemaining))
            ? Number(state.quotaRemaining)
            : null,
        lastRequestAt: Number.isFinite(Number(state.lastRequestAt)) && state.lastRequestAt !== null
            ? Number(state.lastRequestAt)
            : null,
        entries: state.entries && typeof state.entries === "object" ? state.entries : {},
    };
}

export function createVesselApiStateStore({ filePath = DEFAULT_CACHE_FILE, initialState } = {}) {
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

function unwrapVessel(payload = {}) {
    return payload.vessel || payload.data?.vessel || payload.data || payload;
}

function countryText(value) {
    if (value && typeof value === "object") return navalText(value.name || value.country || value.code);
    return navalText(value);
}

function militaryDescriptor(value) {
    return /\b(?:military|naval|navy|warship|frigate|destroyer|corvette|submarine|carrier|patrol)\b/i.test(navalText(value));
}

export function normalizeVesselApiResponse(payload = {}, { requestedMmsi = "", now = Date.now() } = {}) {
    const vessel = unwrapVessel(payload);
    const vesselType = navalValue(vessel, "vessel_type", "vesselType", "type");
    const vesselName = navalValue(vessel, "name", "name_ais", "nameAis", "vessel_name", "vesselName");
    const operatingStatus = navalValue(vessel, "operating_status", "operatingStatus", "status");
    const mmsi = navalDigits(navalValue(vessel, "mmsi", "MMSI") || requestedMmsi);
    const observedAt = new Date(now).toISOString();
    return normalizeNavalObservation("vesselapi", {
        observed_at: observedAt,
        mmsi,
        imo: navalValue(vessel, "imo", "IMO", "imo_number", "imoNumber"),
        callsign: navalValue(vessel, "call_sign", "callsign", "callSign"),
        vessel_name: vesselName,
        ship_type: vesselType,
        operator: navalValue(vessel, "operator", "owner", "manager"),
        country: countryText(navalValue(vessel, "country", "flag", "flag_state", "flagState")),
        operating_status: operatingStatus,
        // This static lookup strengthens a live AIS contact after merging. It
        // cannot create a positioned vessel or qualify one by itself.
        provider_military_flag: false,
        metadata: {
            identity_fetched_at: observedAt,
            operating_status: navalText(operatingStatus),
            vessel_type: navalText(vesselType),
            military_descriptor: militaryDescriptor(`${vesselName || ""} ${vesselType || ""}`),
            speed_calculated_avg: navalNumber(navalValue(vessel, "speed_calculated_avg", "speedCalculatedAvg")),
            speed_observed_max: navalNumber(navalValue(vessel, "speed_observed_max", "speedObservedMax")),
        },
    }, { now });
}

function headerNumber(headers, name) {
    const value = headers?.get?.(name);
    if (String(value || "").toLowerCase() === "unlimited") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
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

export function createVesselApiProvider({
    enabled,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    minimumIntervalMs = DEFAULT_MINIMUM_INTERVAL_MS,
    identityCacheTtlMs = DEFAULT_CACHE_TTL_MS,
    monthlyRequestBudget = DEFAULT_MONTHLY_BUDGET,
    minRemainingRequests = DEFAULT_MIN_REMAINING,
    cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
    stateStore = createVesselApiStateStore(),
    fetchImpl,
    logger = console,
} = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && apiKey && baseUrl);
    const effectiveMinimumIntervalMs = Math.max(DEFAULT_MINIMUM_INTERVAL_MS, Number(minimumIntervalMs) || DEFAULT_MINIMUM_INTERVAL_MS);
    let lastQuotaLog = null;

    function loadState(now = Date.now()) {
        const state = normalizeState(stateStore.load(now), now);
        const ttl = Math.max(60_000, Number(identityCacheTtlMs) || DEFAULT_CACHE_TTL_MS);
        for (const [mmsi, entry] of Object.entries(state.entries)) {
            if (now - Number(entry?.cachedAt || 0) >= ttl) delete state.entries[mmsi];
        }
        return state;
    }

    function saveState(state) {
        const maxEntries = Math.max(1, Number(cacheMaxEntries) || DEFAULT_CACHE_MAX_ENTRIES);
        const ordered = Object.entries(state.entries).sort((a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0));
        state.entries = Object.fromEntries(ordered.slice(0, maxEntries));
        stateStore.save(state);
    }

    function quotaStatus(state) {
        const budget = Math.max(1, Number(monthlyRequestBudget) || DEFAULT_MONTHLY_BUDGET);
        const reserve = Math.max(0, Number(minRemainingRequests) || DEFAULT_MIN_REMAINING);
        const estimatedRemaining = state.quotaRemaining == null ? Math.max(0, budget - state.requests) : state.quotaRemaining;
        return { blocked: estimatedRemaining <= reserve, remaining: estimatedRemaining };
    }

    function logQuota(remaining, status = "HEALTHY") {
        const signature = `${status}:${remaining}`;
        if (lastQuotaLog === signature) return;
        lastQuotaLog = signature;
        const method = status === "HEALTHY" ? "log" : "warn";
        logger?.[method]?.(`[ais:vesselapi] ${status} quota_remaining=${remaining}`);
    }

    async function lookupVessel(identifier, idType = "mmsi", { now = Date.now(), automatic = true } = {}) {
        const cleanIdentifier = navalDigits(identifier);
        if (!cleanIdentifier) return { observation: null, diagnostics: { cached: false, skipped: "invalid_identifier" } };
        const state = loadState(now);
        if (idType === "mmsi") {
            const cached = cachedObservation(state.entries[cleanIdentifier], now);
            if (cached) return { observation: cached, diagnostics: { cached: true, quota_remaining: quotaStatus(state).remaining } };
        }
        const quota = quotaStatus(state);
        if (automatic && state.lastRequestAt != null && now - state.lastRequestAt < effectiveMinimumIntervalMs) {
            return {
                observation: null,
                diagnostics: {
                    cached: false,
                    interval_blocked: true,
                    quota_remaining: quota.remaining,
                    next_lookup_at: new Date(state.lastRequestAt + effectiveMinimumIntervalMs).toISOString(),
                },
            };
        }
        if (automatic && quota.blocked) {
            logQuota(quota.remaining, "DEGRADED");
            return { observation: null, diagnostics: { cached: false, quota_blocked: true, quota_remaining: quota.remaining } };
        }

        const url = new URL(`/v1/vessel/${encodeURIComponent(cleanIdentifier)}`, baseUrl);
        url.searchParams.set("filter.idType", idType);
        let responseHeaders = null;
        const actualFetch = fetchImpl || fetch;
        const wrappedFetch = async (...args) => {
            const response = await actualFetch(...args);
            responseHeaders = response.headers;
            return response;
        };
        state.requests += 1;
        state.lastRequestAt = now;
        saveState(state);
        let payload;
        try {
            payload = await fetchJson(url.toString(), {
                headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
            }, { fetchImpl: wrappedFetch });
        } catch (error) {
            const failedRemaining = headerNumber(responseHeaders, "x-ratelimit-remaining");
            if (failedRemaining != null) state.quotaRemaining = failedRemaining;
            saveState(state);
            throw error;
        }
        const headerRemaining = headerNumber(responseHeaders, "x-ratelimit-remaining");
        if (headerRemaining != null) state.quotaRemaining = headerRemaining;
        const observation = normalizeVesselApiResponse(payload, { requestedMmsi: idType === "mmsi" ? cleanIdentifier : "", now });
        if (observation.mmsi) state.entries[observation.mmsi] = { cachedAt: now, observation };
        saveState(state);
        const updatedQuota = quotaStatus(state);
        logQuota(updatedQuota.remaining, updatedQuota.blocked ? "DEGRADED" : "HEALTHY");
        return { observation, diagnostics: { cached: false, quota_remaining: updatedQuota.remaining, quota_blocked: updatedQuota.blocked } };
    }

    return {
        id: "vesselapi",
        enabled: configured,
        enrichmentOnly: true,
        disabledReason: requested && !apiKey ? "MISSING_CREDENTIALS" : (requested && !baseUrl ? "INCOMPLETE_CONFIGURATION" : "DISABLED_BY_CONFIG"),
        minimumIntervalMs: effectiveMinimumIntervalMs,
        lookupVesselByMmsi(mmsi, options) {
            return lookupVessel(mmsi, "mmsi", options);
        },
        lookupVesselByImo(imo, options) {
            return lookupVessel(imo, "imo", options);
        },
        getCachedObservations(mmsiValues = [], { now = Date.now() } = {}) {
            const state = loadState(now);
            return [...new Set(mmsiValues.map(navalDigits).filter(Boolean))]
                .map((mmsi) => cachedObservation(state.entries[mmsi], now))
                .filter(Boolean);
        },
        async fetchObservations({ mmsis = [], now = Date.now() } = {}) {
            const mmsi = [...new Set(mmsis.map(navalDigits).filter(Boolean))][0];
            if (!mmsi) return { observations: [], diagnostics: { skipped: "no_candidate" } };
            const result = await lookupVessel(mmsi, "mmsi", { now, automatic: true });
            return { observations: result.observation ? [result.observation] : [], diagnostics: result.diagnostics };
        },
    };
}
