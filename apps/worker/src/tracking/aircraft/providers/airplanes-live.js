import { fetchJson, ProviderRequestError } from "../../http.js";
import { observationsFromReadsb } from "./readsb.js";
import { normalizeIcao24 } from "../../../../../shared/aircraft-identifiers.js";

export function createAirplanesLiveProvider({ enabled = true, baseUrl = "https://api.airplanes.live", fetchImpl,
    minimumIntervalMs = 180000, cacheTtlMs = 180000, timeoutMs = 15000, dailyBudget = 480,
    now = Date.now, openApi = null, credential = "" } = {}) {
    const site = new URL(baseUrl);
    if (site.protocol !== "https:" || site.username || site.password || site.search || site.hash || !["/", "/v2", "/v2/", "/v2/mil"].includes(site.pathname)) throw new Error("Expected HTTPS provider origin or legacy /v2/mil URL");
    const cache = new Map(), pending = new Map();
    const interval = Math.max(1000, Number(minimumIntervalMs) || 180000);
    let next = 0, blocked = 0, failures = 0, calls = 0, day = "", status = null, hits = 0, deduplicated = 0;
    const scheme = Object.values(openApi?.components?.securitySchemes || {}).find(s => s.type === "apiKey" && s.in === "header");
    if (credential && (!scheme || !/^[A-Za-z0-9-]+$/.test(scheme.name))) throw new Error("Credential requires the published provider header security scheme");
    const headers = { Accept: "application/json", "User-Agent": "stratops-warzone/1.0", ...(credential ? { [scheme.name]: credential } : {}) };
    async function request(path, ttl = cacheTtlMs) {
        if (!enabled) throw new ProviderRequestError("Provider disabled", { code: "DISABLED" });
        const at = now(), cached = cache.get(path);
        if (cached && at < cached.until) { hits++; return structuredClone(cached.data); }
        if (pending.has(path)) { deduplicated++; return structuredClone(await pending.get(path)); }
        const today = new Date(at).toISOString().slice(0, 10);
        if (day !== today) { day = today; calls = 0; }
        if (at < blocked || at < next || pending.size || calls >= dailyBudget) throw new ProviderRequestError("Provider local budget/backoff active", { code: "LOCAL_BACKOFF" });
        next = at + interval; calls++;
        const task = (async () => {
            try {
                const data = await fetchJson(site.origin + path, { headers, redirect: "error" }, { fetchImpl, timeoutMs: Math.max(1000,Math.min(60000,Number(timeoutMs)||15000)) });
                if (!data || typeof data !== "object" || data.error || (data.msg && data.msg !== "No error")) throw new ProviderRequestError("Invalid provider response", { code: "EBADRESPONSE" });
                if (path.startsWith('/v2/') && !Array.isArray(data.ac) && !Array.isArray(data.aircraft) && !data.hex) throw new ProviderRequestError("Missing aircraft collection",{code:"EBADRESPONSE"});
                if (!data.now && (data.ac || data.aircraft)) data.now = at / 1000;
                failures = 0; status = 200;
                cache.delete(path); cache.set(path, { data: structuredClone(data), until: now() + Math.max(0, ttl) });
                while (cache.size > 128) cache.delete(cache.keys().next().value);
                return data;
            } catch (error) {
                status = error.status || null; failures++;
                blocked = now() + Math.max([401,403].includes(status) ? 86400000 : Math.min(900000, 30000 * 2 ** Math.min(failures - 1, 5)), error.retryAfterMs || 0);
                throw new ProviderRequestError(`Airplanes.live ${status ? `HTTP ${status}` : "request failed"}`, { status, code: error.code, retryAfterMs: blocked - now() });
            }
        })();
        pending.set(path, task);
        try { return structuredClone(await task); } finally { pending.delete(path); }
    }
    function normalize(data, militaryHint = false) {
        const ac = Array.isArray(data.ac) ? data.ac : Array.isArray(data.aircraft) ? data.aircraft : data.hex ? [data] : null;
        if (!ac) throw new ProviderRequestError("Missing aircraft collection", { code: "EBADRESPONSE" });
        const stamp = Number(data.now);
        return observationsFromReadsb({ ac: ac.filter(row=>row && typeof row==='object') }, { source: "airplanes_live", militaryHint,
            now: Number.isFinite(stamp) && stamp > 0 ? (stamp < 1e12 ? stamp * 1000 : stamp) : now() }).filter(row => row.icao24)
            .map(row => ({ ...row, metadata: { attribution: "Airplanes.live", military_endpoint: militaryHint } }));
    }
    const identifier = (value, pattern) => { const text = String(value || "").trim().toUpperCase(); if (!pattern.test(text)) throw new TypeError("Invalid lookup identifier"); return encodeURIComponent(text); };
    const api = {
        id: "airplanes_live",
        enabled, minimumIntervalMs: interval,
        async fetchObservations({ region } = {}) {
            const observations = region ? await api.discoverPoint(region) : normalize(await request("/v2/mil"), true);
            return { observations, diagnostics: { ...api.getDiagnostics(), fetched: observations.length, normalized: observations.length,
                valid: observations.filter(row => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)).length } };
        },
        async discoverPoint({ lat, lon, radius, bounds } = {}) {
            if (bounds && (![bounds.minLat,bounds.maxLat,bounds.minLon,bounds.maxLon].every(Number.isFinite)
                || bounds.minLat>bounds.maxLat || bounds.minLat < -90 || bounds.maxLat>90 || bounds.minLon < -180 || bounds.maxLon>180)) throw new TypeError("Invalid region bounds");
            if (bounds) { lat = (bounds.minLat + bounds.maxLat) / 2; lon = (bounds.minLon + bounds.maxLon) / 2;
                radius = Math.ceil(60 * Math.hypot((bounds.maxLat - bounds.minLat) / 2, (bounds.maxLon - bounds.minLon) / 2)); }
            if (![lat,lon,radius].every(Number.isFinite) || Math.abs(lat)>90 || Math.abs(lon)>180 || radius<=0 || radius>250 || (bounds && bounds.minLon>bounds.maxLon)) throw new TypeError("Use one valid point/radius <=250 NM; large/dateline regions require an approved query plan");
            return normalize(await request(`/v2/point/${lat}/${lon}/${radius}`));
        },
        async lookupHex(hex, mode = "") {
            const id = normalizeIcao24(hex); if (!id || !["","live","last"].includes(mode)) throw new TypeError("Invalid ICAO24/lookup mode");
            return normalize(await request(`/v2/hex/${id}${mode ? `/${mode}` : ""}`)).map(row => ({...row,metadata:{...row.metadata,historical_lookup:mode==='last'}}));
        },
        async lookupRegistration(value) { return normalize(await request(`/v2/reg/${identifier(value,/^[A-Z0-9-]{1,16}$/)}`)); },
        async lookupCallsign(value) { return normalize(await request(`/v2/callsign/${identifier(value,/^[A-Z0-9]{1,12}$/)}`)); },
        async lookupSquawk(value) { return normalize(await request(`/v2/squawk/${identifier(value,/^[0-7]{4}$/)}`)); },
        async reference(path, query = {}) {
            const operation = openApi?.paths?.[path]?.get;
            if (!operation || !path.startsWith('/') || path.startsWith('//') || /[{}?#]/.test(path) || path.includes('..')) throw new Error("Reference/feed requires published OpenAPI GET contract");
            const parameters = (operation.parameters || []).filter(p=>p.in==='query');
            if (Object.keys(query).some(key=>!parameters.some(p=>p.name===key)) || parameters.some(p=>p.required && query[p.name]==null)) throw new Error("Invalid documented query parameters");
            return request(path+(Object.keys(query).length?`?${new URLSearchParams(query)}`:''),86400000);
        },
        getDiagnostics() { return { calls_today:calls,cache_hits:hits,deduplicated,cached_responses:cache.size,last_status_code:status,
            next_retry_at:new Date(Math.max(next,blocked)).toISOString(),daily_budget:dailyBudget,authentication_configured:Boolean(credential) }; },
    };
    return api;
}

