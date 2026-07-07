// File Path: /assets/js/supabase.js
import { createClient } from "@supabase/supabase-js";

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

// Dev = direct Supabase | Production = public API service (Supabase hidden).
// The production frontend is static-hosted and does not expose a same-origin /api proxy.
const isLocalhost = window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const API_BASE = isLocalhost ? null : "https://api.battlespacex.com";
const LOCAL_PROXY_API_BASE = "/api";
const INTEL_FEED_API_BASE =
    window.__stratopsConfig?.intelFeedApiBase ||
    window.__stratopsConfig?.apiBase ||
    (isLocalhost ? LOCAL_PROXY_API_BASE : "https://api.battlespacex.com");
const GNSS_API_BASE =
    window.__stratopsConfig?.gnssApiBase ||
    window.__stratopsConfig?.apiBase ||
    INTEL_FEED_API_BASE;
const EVENTS_HISTORY_WINDOW_HOURS = 48;
const EVENTS_HISTORY_WINDOW_MS = EVENTS_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const EVENTS_INITIAL_LIMIT = 2000;
const EVENTS_SINCE_LIMIT = 200;
const INTEL_FEED_LIMIT = 120;
const GNSS_CELL_LIMIT = 240;
const AIRCRAFT_HISTORY_WINDOW_HOURS = 72;
const AIRCRAFT_HISTORY_WINDOW_MS = AIRCRAFT_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const AIRCRAFT_HISTORY_LIMIT = 1000;
let __warnedActiveAlertsUnavailable = false;
let __warnedGnssUnavailable = false;

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
    async getEvents() {
        const cutoffIso = getEventsHistoryCutoffIso();
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("events").select("*")
                .gte("occurred_at", cutoffIso)
                .order("occurred_at", { ascending: false })
                .limit(EVENTS_INITIAL_LIMIT);
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events?window_hours=${EVENTS_HISTORY_WINDOW_HOURS}&limit=${EVENTS_INITIAL_LIMIT}`);
        if (!res.ok) throw new Error("Events fetch failed");
        const json = await res.json();
        return { data: json.events || [], error: null };
    },

    async getEventsSince(since) {
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("events").select("*")
                .gt("occurred_at", since)
                .order("occurred_at", { ascending: false })
                .limit(EVENTS_SINCE_LIMIT);
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events/since?t=${encodeURIComponent(since)}&limit=${EVENTS_SINCE_LIMIT}`);
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

    async getActiveAlerts() {
        const alertsApiBase = isLocalhost
            ? LOCAL_PROXY_API_BASE
            : (window.__stratopsConfig?.apiBase || API_BASE);
        if (alertsApiBase) {
            try {
                const res = await fetch(`${alertsApiBase}/events/alerts`);
                const json = await readJsonResponse(res, "Alerts fetch");
                return { data: json.alerts || [], error: null };
            } catch (error) {
                __warnedActiveAlertsUnavailable = true;
                return { data: [], error: null };
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
            return { data: [], error: null };
        }
    },

    async getAirspaceStatuses() {
        if (API_BASE) {
            const res = await fetch(`${API_BASE}/events/airspace-status`);
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
        const res = await fetch(`${API_BASE}/events/aircraft`);
        if (!res.ok) throw new Error("Aircraft fetch failed");
        const json = await res.json();
        return { data: json.tracks || [], error: null };
    },
};
