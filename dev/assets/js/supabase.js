// File Path: /assets/js/supabase.js
import { createClient } from "@supabase/supabase-js";
import {
    MAP_EVENT_HISTORY_WINDOW_HOURS,
    applyGeneralEventDeliveryFilters,
    applyMapEventHistoricalQueryFilter,
} from "../../../apps/shared/map-event-policy.js";

// Supabase — realtime WebSocket subscriptions only
export const supabase = createClient(
    "https://orlwfqmbeplzunqbvzjy.supabase.co",
    "sb_publishable_PVVrl582oR3izZLSO-dnxA_MoPoeARN",
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        }
    }
);

// Dev = same-origin API proxy | Production = public API service (Supabase hidden).
// The production frontend is static-hosted and does not expose a same-origin /api proxy.
const isLocalhost = window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.hostname === "[::1]";

const LOCAL_PROXY_API_BASE = "/api";
const CONFIG_API_BASE = window.__stratopsConfig?.apiBase || "";
const API_BASE = CONFIG_API_BASE || (isLocalhost ? LOCAL_PROXY_API_BASE : "https://api.battlespacex.com");
const INTEL_FEED_API_BASE =
    window.__stratopsConfig?.intelFeedApiBase ||
    window.__stratopsConfig?.apiBase ||
    (isLocalhost ? LOCAL_PROXY_API_BASE : "https://api.battlespacex.com");
const GNSS_API_BASE =
    window.__stratopsConfig?.gnssApiBase ||
    window.__stratopsConfig?.apiBase ||
    INTEL_FEED_API_BASE;
const REPORTS_API_BASE =
    window.__stratopsConfig?.reportsApiBase ||
    window.__stratopsConfig?.apiBase ||
    (isLocalhost ? LOCAL_PROXY_API_BASE : "https://api.battlespacex.com");
const EVENTS_HISTORY_WINDOW_HOURS = MAP_EVENT_HISTORY_WINDOW_HOURS;
const EVENTS_HISTORY_WINDOW_MS = EVENTS_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const EVENTS_INITIAL_LIMIT = 2000;
export const MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS = 48;
export const MAP_EVENTS_BOOTSTRAP_LIMIT = 800;
const MAP_EVENTS_CACHE_TTL_MS = 2 * 60 * 1000;
const MAP_EVENTS_SELECT_COLUMNS = [
    "id", "created_at", "occurred_at", "category", "subcategory", "report_type",
    "title", "summary", "source_name", "location_label", "country_code", "severity",
    "confidence", "lat", "lon", "weapon_type", "source_count", "priority_score",
    "is_breaking", "dedupe_key", "tags", "metadata",
].join(", ");
const EVENTS_SINCE_LIMIT = 200;
const INTEL_FEED_LIMIT = 120;
const GNSS_CELL_LIMIT = 240;
const AIRCRAFT_HISTORY_WINDOW_HOURS = 72;
const AIRCRAFT_HISTORY_WINDOW_MS = AIRCRAFT_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const AIRCRAFT_HISTORY_LIMIT = 1000;
let __warnedActiveAlertsUnavailable = false;
let __warnedGnssUnavailable = false;
const __activeApiRequests = new Map();
const __mapEventsRegionCache = new Map();

function normalizeMapRegion(region = {}) {
    const bounds = region?.bounds || {};
    const normalized = {
        id: String(region?.id || "").trim(),
        bounds: {
            minLat: Number(bounds.minLat),
            maxLat: Number(bounds.maxLat),
            minLon: Number(bounds.minLon),
            maxLon: Number(bounds.maxLon),
        },
    };
    if (!normalized.id || !Object.values(normalized.bounds).every(Number.isFinite)) return null;
    return normalized;
}

function getMapEventsCacheKey(region = {}) {
    const bounds = region.bounds || {};
    return [
        region.id,
        bounds.minLat,
        bounds.maxLat,
        bounds.minLon,
        bounds.maxLon,
        MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS,
    ].join(":");
}

function mergeMapEventRows(rows = [], incoming = null) {
    const incomingId = String(incoming?.id || "").trim();
    if (!incomingId) return rows.slice(0, MAP_EVENTS_BOOTSTRAP_LIMIT);
    return [incoming, ...rows.filter((row) => String(row?.id || "").trim() !== incomingId)]
        .slice(0, MAP_EVENTS_BOOTSTRAP_LIMIT);
}

function filterLegacyMapEventsToRegion(rows = [], region = {}) {
    const bounds = region.bounds || {};
    return rows.filter((event) => {
        const lat = Number(event?.lat);
        const lon = Number(event?.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) &&
            lat >= bounds.minLat && lat <= bounds.maxLat &&
            lon >= bounds.minLon && lon <= bounds.maxLon;
    }).slice(0, MAP_EVENTS_BOOTSTRAP_LIMIT);
}

function toAbsoluteApiUrl(value = "", apiBase = REPORTS_API_BASE) {
    const url = String(value || "").trim();
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    const normalizedBase = String(apiBase || "").replace(/\/+$/, "");
    const normalizedPath = url.replace(/^\/+/, "");
    if (/^https?:\/\//i.test(normalizedBase)) {
        return `${normalizedBase}/${normalizedPath}`;
    }
    return new URL(`${normalizedBase}/${normalizedPath}`, window.location.origin).href;
}

function isLocalNetworkUrl(value = "") {
    try {
        const url = new URL(String(value || "").trim(), window.location.href);
        const host = url.hostname.toLowerCase();
        if (host === "localhost" || host === "::1" || host === "[::1]") return true;
        if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
        return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    } catch {
        return false;
    }
}

function isUsablePublicUrl(value = "") {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) return false;
    if (!isLocalhost && isLocalNetworkUrl(url)) return false;
    if (!isLocalhost && window.location.protocol === "https:" && !/^https:\/\//i.test(url)) return false;
    return true;
}

async function fetchLatest(key, url, options = {}) {
    const requestKey = String(key || url);
    __activeApiRequests.get(requestKey)?.abort();
    const controller = new AbortController();
    const externalSignal = options?.signal;
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) {
        controller.abort();
    } else {
        externalSignal?.addEventListener?.("abort", abortFromExternal, { once: true });
    }
    __activeApiRequests.set(requestKey, controller);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        externalSignal?.removeEventListener?.("abort", abortFromExternal);
        if (__activeApiRequests.get(requestKey) === controller) {
            __activeApiRequests.delete(requestKey);
        }
    }
}

function abortPendingApiRequests(prefix = "") {
    const requestPrefix = String(prefix || "");
    for (const [key, controller] of __activeApiRequests.entries()) {
        if (requestPrefix && !key.startsWith(requestPrefix)) continue;
        controller.abort();
        __activeApiRequests.delete(key);
    }
}

async function readJsonResponse(res, label = "API") {
    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`${label} failed (${res.status})`);
    }
    if (!contentType.includes("application/json")) {
        const preview = text.slice(0, 80).replace(/\s+/g, " ").trim();
        throw new Error(`${label} returned non-JSON response${preview ? `: ${preview}` : ""}`);
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${label} returned invalid JSON: ${error.message}`);
    }
}

function getEventsHistoryCutoffIso() {
    return new Date(Date.now() - EVENTS_HISTORY_WINDOW_MS).toISOString();
}

function mapEventToAirspaceStatusRow(event = {}) {
    const status = String(event.airspace_status || "").toLowerCase();
    if (!status || status === "unknown") return null;
    return {
        id: event.id,
        region: event.location_label || "",
        country_code: event.country_code || "",
        status,
        title: event.title || "",
        summary: event.summary || "",
        source_name: event.source_name || "",
        source_url: event.source_url || "",
        fir_code: event.fir_code || "",
        updated_at: event.occurred_at || event.created_at || new Date().toISOString(),
        expires_at: null,
        lat: event.lat,
        lon: event.lon
    };
}

async function getAirspaceStatusesFromSupabase() {
    const { data, error } = await supabase
        .from("events").select("id, created_at, occurred_at, location_label, country_code, airspace_status, title, summary, source_name, source_url, fir_code, lat, lon")
        .not("airspace_status", "is", null)
        .neq("airspace_status", "unknown")
        .order("occurred_at", { ascending: false })
        .limit(500);
    return { data: (data || []).map(mapEventToAirspaceStatusRow).filter(Boolean), error };
}

export const api = {
    abortPendingRequests(prefix = "") {
        abortPendingApiRequests(prefix);
    },

    async getEvents(options = {}) {
        const cutoffIso = getEventsHistoryCutoffIso();
        if (!API_BASE) {
            let eventsQuery = supabase
                .from("events").select("*")
                .gte("occurred_at", cutoffIso);
            eventsQuery = applyGeneralEventDeliveryFilters(eventsQuery);
            eventsQuery = applyMapEventHistoricalQueryFilter(eventsQuery);
            const { data, error } = await eventsQuery
                .order("occurred_at", { ascending: false })
                .limit(EVENTS_INITIAL_LIMIT);
            return { data: data || [], error };
        }
        const res = await fetchLatest(
            "events:full",
            `${API_BASE}/events?window_hours=${EVENTS_HISTORY_WINDOW_HOURS}&limit=${EVENTS_INITIAL_LIMIT}`,
            options
        );
        if (!res.ok) throw new Error("Events fetch failed");
        const json = await res.json();
        return { data: json.events || [], error: null };
    },

    async getEventsSince(since, options = {}) {
        if (!API_BASE) {
            let eventsQuery = supabase
                .from("events").select("*")
                .gt("occurred_at", since);
            eventsQuery = applyGeneralEventDeliveryFilters(eventsQuery);
            eventsQuery = applyMapEventHistoricalQueryFilter(eventsQuery);
            const { data, error } = await eventsQuery
                .order("occurred_at", { ascending: false })
                .limit(EVENTS_SINCE_LIMIT);
            return { data: data || [], error };
        }
        const res = await fetchLatest(
            "events:since",
            `${API_BASE}/events/since?t=${encodeURIComponent(since)}&limit=${EVENTS_SINCE_LIMIT}`,
            options
        );
        if (!res.ok) throw new Error("Events since fetch failed");
        const json = await res.json();
        return { data: json.events || [], error: null };
    },

    async getIntelFeedItems() {
        const res = await fetch(`${INTEL_FEED_API_BASE}/events/intel-feed?limit=${INTEL_FEED_LIMIT}`);
        const json = await readJsonResponse(res, "Intel feed fetch");
        return { data: json.items || [], error: null };
    },

    async getGnssInterferenceCells() {
        try {
            const res = await fetch(`${GNSS_API_BASE}/events/gnss-interference?limit=${GNSS_CELL_LIMIT}`);
            const json = await readJsonResponse(res, "GNSS Jamming fetch");
            return {
                data: json.cells || [],
                error: null,
                meta: {
                    demoMode: json.demoMode === true,
                    updatedAt: json.updatedAt || null,
                    sourceMode: json.sourceMode || "unavailable",
                    liveAvailable: json.liveAvailable === true,
                    tableAvailable: json.tableAvailable === true,
                    message: json.message || "",
                },
            };
        } catch (error) {
            __warnedGnssUnavailable = true;
            return {
                data: [],
                error: null,
                meta: {
                    demoMode: false,
                    updatedAt: null,
                    sourceMode: "unavailable",
                    liveAvailable: false,
                    tableAvailable: false,
                    message: error?.message || "GNSS Jamming endpoint is unavailable.",
                },
            };
        }
    },

    async getOperationalReports(type = "daily", scopeType = "global") {
        const reportType = String(type || "daily").trim().toLowerCase();
        const params = new URLSearchParams({
            type: reportType === "weekly" ? "weekly" : "daily",
            scope_type: scopeType || "global",
        });
        if (isLocalhost) {
            try {
                const localResponse = await fetch(`/generated-reports/history?${params.toString()}`, {
                    cache: "no-store",
                    headers: { Accept: "application/json" },
                });
                const localJson = await readJsonResponse(localResponse, "Local reports fetch");
                if (Array.isArray(localJson.reports) && localJson.reports.length) {
                    return {
                        data: localJson.reports,
                        error: null,
                        meta: {
                            historyLimit: Number(localJson.history_limit || 0),
                            source: "local",
                        },
                    };
                }
            } catch (error) {
                console.warn("[reports] local report history unavailable; using API history", error);
            }
        }
        const res = await fetch(`${REPORTS_API_BASE}/stratops/reports?${params.toString()}`);
        const json = await readJsonResponse(res, "Reports fetch");
        return {
            data: json.reports || [],
            error: null,
            meta: { historyLimit: Number(json.history_limit || 0), source: "api" },
        };
    },

    async getLatestOperationalReport(type = "daily", scopeType = "global") {
        const reportType = String(type || "daily").trim().toLowerCase();
        const params = new URLSearchParams({
            type: reportType === "weekly" ? "weekly" : "daily",
            scope_type: scopeType || "global",
        });
        const res = await fetch(`${REPORTS_API_BASE}/stratops/reports/latest?${params.toString()}`);
        const json = await readJsonResponse(res, "Latest report fetch");
        return { data: json, error: null };
    },

    getOperationalReportDownloadUrl(report = {}) {
        const directUrl = String(report?.download_url || report?.pdf_url || "").trim();
        if (isUsablePublicUrl(directUrl)) return directUrl;
        const publicUrl = String(report?.public_url || "").trim();
        if (isUsablePublicUrl(publicUrl)) return publicUrl;
        const id = String(report?.id || "").trim();
        const token = String(report?.download_token || "").trim();
        if (!id || !token) return "";
        return toAbsoluteApiUrl(`/stratops/reports/${encodeURIComponent(id)}/download?token=${encodeURIComponent(token)}`);
    },

    getOperationalReportViewerUrl(report = {}) {
        const previewUrl = String(report?.preview_url || "").trim();
        if (isUsablePublicUrl(previewUrl)) return previewUrl;
        if (report?.local_preview !== true) return "";
        const localPdfUrl = String(report?.public_url || report?.download_url || report?.pdf_url || "").trim();
        if (!isUsablePublicUrl(localPdfUrl)) return "";
        try {
            const parsed = new URL(localPdfUrl, window.location.href);
            return parsed.origin === window.location.origin && parsed.pathname.endsWith("/report.pdf")
                ? parsed.href
                : "";
        } catch {
            return "";
        }
    },

    getOperationalReportHtmlUrl(report = {}) {
        const htmlUrl = String(report?.html_url || "").trim();
        if (isUsablePublicUrl(htmlUrl)) return htmlUrl;
        const pdfUrl = this.getOperationalReportDownloadUrl(report);
        if (!isUsablePublicUrl(pdfUrl)) return "";
        try {
            const parsed = new URL(pdfUrl, window.location.href);
            if (!parsed.pathname.endsWith("/report.pdf")) return "";
            parsed.pathname = parsed.pathname.slice(0, -"report.pdf".length) + "report.html";
            parsed.search = "";
            parsed.hash = "";
            return isUsablePublicUrl(parsed.href) ? parsed.href : "";
        } catch {
            return "";
        }
    },

    async getActiveAlerts(options = {}) {
        const alertsApiBase = isLocalhost
            ? LOCAL_PROXY_API_BASE
            : (window.__stratopsConfig?.apiBase || API_BASE);
        if (alertsApiBase) {
            try {
                const res = await fetch(`${alertsApiBase}/events/alerts`, options);
                const json = await readJsonResponse(res, "Alerts fetch");
                return { data: json.alerts || [], error: null };
            } catch (error) {
                __warnedActiveAlertsUnavailable = true;
                return { data: null, error, unavailable: true };
            }
        }
        try {
            const { data, error } = await supabase
                .from("active_alerts").select("*")
                .eq("status", "active")
                .order("updated_at", { ascending: false });
            return { data: data || [], error };
        } catch (error) {
            __warnedActiveAlertsUnavailable = true;
            return { data: null, error, unavailable: true };
        }
    },

    async getMapEvents(regionInput = {}, options = {}) {
        const region = normalizeMapRegion(regionInput);
        if (!region) throw new Error("Map events require valid region bounds");
        const cacheKey = getMapEventsCacheKey(region);
        const cached = __mapEventsRegionCache.get(cacheKey);
        if (options.force !== true && cached && (Date.now() - cached.storedAt) < MAP_EVENTS_CACHE_TTL_MS) {
            return { data: cached.rows, error: null, meta: { ...cached.meta, cached: true } };
        }
        const cutoffIso = new Date(Date.now() - (MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS * 60 * 60 * 1000)).toISOString();
        if (!API_BASE) {
            let eventsQuery = supabase
                .from("events")
                .select(MAP_EVENTS_SELECT_COLUMNS)
                .gte("occurred_at", cutoffIso)
                .gte("lat", region.bounds.minLat)
                .lte("lat", region.bounds.maxLat)
                .gte("lon", region.bounds.minLon)
                .lte("lon", region.bounds.maxLon);
            eventsQuery = applyGeneralEventDeliveryFilters(eventsQuery);
            const { data, error } = await eventsQuery
                .order("is_breaking", { ascending: false })
                .order("priority_score", { ascending: false, nullsFirst: false })
                .order("occurred_at", { ascending: false })
                .limit(MAP_EVENTS_BOOTSTRAP_LIMIT);
            const rows = data || [];
            if (!error) {
                __mapEventsRegionCache.set(cacheKey, {
                    rows,
                    storedAt: Date.now(),
                    meta: { region_id: region.id, window_hours: MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS, limit: MAP_EVENTS_BOOTSTRAP_LIMIT },
                });
            }
            return { data: rows, error, meta: { region_id: region.id } };
        }
        const params = new URLSearchParams({
            region_id: region.id,
            min_lat: String(region.bounds.minLat),
            max_lat: String(region.bounds.maxLat),
            min_lon: String(region.bounds.minLon),
            max_lon: String(region.bounds.maxLon),
            window_hours: String(MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS),
            limit: String(MAP_EVENTS_BOOTSTRAP_LIMIT),
        });
        let res = await fetchLatest("events:map", `${API_BASE}/events/map?${params.toString()}`, options);
        let json;
        if (res.status === 404) {
            if (isLocalhost) {
                console.warn("[map-events] /events/map is unavailable; using legacy /events compatibility path");
            }
            res = await fetchLatest(
                "events:map-legacy",
                `${API_BASE}/events?window_hours=${MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS}&limit=${EVENTS_INITIAL_LIMIT}`,
                options
            );
            const legacyJson = await readJsonResponse(res, "Legacy map events fetch");
            json = {
                events: filterLegacyMapEventsToRegion(legacyJson.events || [], region),
                meta: {
                    region_id: region.id,
                    window_hours: MAP_EVENTS_BOOTSTRAP_WINDOW_HOURS,
                    limit: MAP_EVENTS_BOOTSTRAP_LIMIT,
                    compatibility_fallback: true,
                },
            };
        } else {
            json = await readJsonResponse(res, "Map events fetch");
        }
        const rows = Array.isArray(json.events) ? json.events : [];
        const meta = { ...(json.meta || {}), cached: false };
        __mapEventsRegionCache.set(cacheKey, { rows, meta, storedAt: Date.now() });
        return { data: rows, error: null, meta };
    },

    mergeRealtimeMapEvent(event = {}) {
        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        for (const [key, cached] of __mapEventsRegionCache.entries()) {
            const parts = key.split(":");
            const minLat = Number(parts[1]);
            const maxLat = Number(parts[2]);
            const minLon = Number(parts[3]);
            const maxLon = Number(parts[4]);
            if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
            __mapEventsRegionCache.set(key, {
                ...cached,
                rows: mergeMapEventRows(cached.rows, event),
            });
        }
    },

    async getEventById(eventId, options = {}) {
        const id = String(eventId || "").trim();
        if (!id) throw new Error("Event detail requires an id");
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .eq("id", id)
                .maybeSingle();
            return { data: data || null, error };
        }
        const res = await fetchLatest(`events:detail:${id}`, `${API_BASE}/events/${encodeURIComponent(id)}`, options);
        const json = await readJsonResponse(res, "Event detail fetch");
        return { data: json.event || null, error: null };
    },

    async getAirspaceStatuses(options = {}) {
        if (API_BASE) {
            const res = await fetch(`${API_BASE}/events/airspace-status`, options);
            if (!res.ok) return { data: [], error: new Error("Airspace status fetch failed") };
            const json = await res.json();
            return { data: json.statuses || [], error: null };
        }
        if (window.__stratopsConfig?.enableLocalAirspaceStatusRead !== true) {
            return { data: [], error: null };
        }
        return getAirspaceStatusesFromSupabase();
    },

    async getAircraftTracks() {
        if (!API_BASE) {
            const cutoff = new Date(Date.now() - AIRCRAFT_HISTORY_WINDOW_MS).toISOString();
            const { data, error } = await supabase
                .from("tracks")
                .select("*")
                .eq("track_type", "aircraft")
                .eq("category", "military")
                .gte("updated_at", cutoff)
                .order("updated_at", { ascending: false }).limit(AIRCRAFT_HISTORY_LIMIT);
            return { data: data || [], error };
        }
        try {
            const res = await fetch(`${API_BASE}/events/aircraft`);
            if (!res.ok) {
                return { data: [], error: new Error("Aircraft fetch failed") };
            }
            const json = await res.json();
            return { data: json.tracks || [], error: null };
        } catch (error) {
            return { data: [], error };
        }
    },
    async lookupAircraft(identifier, options = {}) {
        const response = await fetch(
            `${API_BASE}/events/aircraft/lookup?identifier=${encodeURIComponent(identifier)}`,
            { signal: options.signal, headers: { Accept: "application/json" } }
        );
        if (!/\bapplication\/json\b/i.test(response.headers.get("content-type") || "")) {
            throw new Error("Aircraft lookup service unavailable.");
        }
        const result = await response.json().catch(() => {
            throw new Error("Aircraft lookup service unavailable.");
        });
        if (response.status === 404) throw new Error(`No live aircraft found for ${identifier}.`);
        if (!response.ok) throw new Error(result.error || "Aircraft lookup failed");
        if (result.track && result.meta) result.track.__lookupMeta = result.meta;
        return result.track || null;
    },
    async getAircraftTrackHistory(identifier, options = {}) {
        if (!API_BASE) return { points: [], meta: { source: "unavailable", count: 0 } };
        const response = await fetch(
            `${API_BASE}/events/aircraft/${encodeURIComponent(identifier)}/history`,
            { signal: options.signal, headers: { Accept: "application/json" } }
        );
        if (!response.ok) return { points: [], meta: { source: "aircraft_tracks_log", count: 0 } };
        const result = await response.json();
        return {
            points: Array.isArray(result.points) ? result.points : [],
            meta: result.meta || { source: "aircraft_tracks_log", count: 0 },
        };
    },
};
