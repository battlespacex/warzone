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
const EVENTS_HISTORY_WINDOW_HOURS = 48;
const EVENTS_HISTORY_WINDOW_MS = EVENTS_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const EVENTS_INITIAL_LIMIT = 2000;
const EVENTS_SINCE_LIMIT = 200;
const INTEL_FEED_LIMIT = 120;
const AIRCRAFT_HISTORY_WINDOW_HOURS = 72;
const AIRCRAFT_HISTORY_WINDOW_MS = AIRCRAFT_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const AIRCRAFT_HISTORY_LIMIT = 1000;

function getEventsHistoryCutoffIso() {
    return new Date(Date.now() - EVENTS_HISTORY_WINDOW_MS).toISOString();
}

async function getAirspaceStatusesFromSupabase() {
    const { data, error } = await supabase
        .from("airspace_status").select("*")
        .order("updated_at", { ascending: false });
    return { data: data || [], error };
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
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("conflict_feed_items")
                .select("id, source_name, source_type, source_category, title, summary, url, guid, published_at, fetched_at, region, country, category, confidence_score, is_conflict_relevant, raw")
                .eq("is_conflict_relevant", true)
                .order("published_at", { ascending: false, nullsFirst: false })
                .order("fetched_at", { ascending: false })
                .limit(INTEL_FEED_LIMIT);
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events/intel-feed?limit=${INTEL_FEED_LIMIT}`);
        if (!res.ok) throw new Error("Intel feed fetch failed");
        const json = await res.json();
        return { data: json.items || [], error: null };
    },

    async getActiveAlerts() {
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("active_alerts").select("*")
                .eq("status", "active")
                .order("updated_at", { ascending: false });
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events/alerts`);
        if (!res.ok) throw new Error("Alerts fetch failed");
        const json = await res.json();
        return { data: json.alerts || [], error: null };
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
