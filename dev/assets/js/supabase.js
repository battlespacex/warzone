// File Path: /assets/js/supabase.js
import { createClient } from "@supabase/supabase-js";

// Supabase — realtime WebSocket subscriptions only
export const supabase = createClient(
    "https://orlwfqmbeplzunqbvzjy.supabase.co",
    "sb_publishable_PVVrl582oR3izZLSO-dnxA_MoPoeARN"
);

// Dev = direct Supabase | Production = your EC2 API (Supabase hidden)
const isLocalhost = window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const API_BASE = isLocalhost ? null : "https://api.battlespacex.com";

export const api = {
    async getEvents() {
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("events").select("*")
                .order("occurred_at", { ascending: false }).limit(500);
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events`);
        if (!res.ok) throw new Error("Events fetch failed");
        const json = await res.json();
        return { data: json.events || [], error: null };
    },

    async getEventsSince(since) {
        if (!API_BASE) {
            const { data, error } = await supabase
                .from("events").select("*")
                .gt("occurred_at", since)
                .order("occurred_at", { ascending: false }).limit(25);
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events/since?t=${encodeURIComponent(since)}`);
        if (!res.ok) throw new Error("Events since fetch failed");
        const json = await res.json();
        return { data: json.events || [], error: null };
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

    async getAircraftTracks() {
        if (!API_BASE) {
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from("aircraft_tracks_log")
                .select("track_key,callsign,subtype,lat,lon,altitude_ft,speed_kts,heading_deg,status,last_seen_at,ended_at,created_at")
                .gte("last_seen_at", cutoff)
                .order("last_seen_at", { ascending: false }).limit(500);
            return { data: data || [], error };
        }
        const res = await fetch(`${API_BASE}/events/aircraft`);
        if (!res.ok) throw new Error("Aircraft fetch failed");
        const json = await res.json();
        return { data: json.tracks || [], error: null };
    },
};
