import express from "express";
import { query } from "./db.js";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

export function eventsRouter({ broadcast }) {
    const router = express.Router();

    // ── Events — initial load ──────────────────────────────────────
    router.get("/", async (req, res) => {
        try {
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .order("occurred_at", { ascending: false })
                .limit(500);
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ events: data || [] });
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    // ── Events — polling for new ones ──────────────────────────────
    router.get("/since", async (req, res) => {
        try {
            const since = req.query.t;
            if (!since) return res.status(400).json({ error: "Missing t param" });
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .gt("occurred_at", since)
                .order("occurred_at", { ascending: false })
                .limit(25);
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ events: data || [] });
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    // ── Active alerts ──────────────────────────────────────────────
    router.get("/alerts", async (req, res) => {
        try {
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("active_alerts")
                .select("*")
                .eq("status", "active")
                .order("updated_at", { ascending: false });
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ alerts: data || [] });
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    // ── Aircraft tracks ────────────────────────────────────────────
    router.get("/aircraft", async (req, res) => {
        try {
            const supabase = getSupabase();
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from("aircraft_tracks_log")
                .select("track_key,callsign,subtype,lat,lon,altitude_ft,speed_kts,heading_deg,status,last_seen_at,ended_at,created_at")
                .gte("last_seen_at", cutoff)
                .order("last_seen_at", { ascending: false })
                .limit(500);
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ tracks: data || [] });
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    // ── Admin event insert (existing, keep as-is) ──────────────────
    router.post("/", express.json(), async (req, res) => {
        try {
            const adminKey = process.env.ADMIN_API_KEY || "";
            if (!adminKey || req.headers["x-admin-key"] !== adminKey) {
                return res.status(403).json({ error: "Forbidden" });
            }
            const e = req.body || {};
            if (!e.title || !e.occurred_at || typeof e.lat !== "number" || typeof e.lon !== "number") {
                return res.status(400).json({ error: "Missing required fields" });
            }
            const sql = `
                INSERT INTO events (category, title, summary, source_name, source_url,
                occurred_at, lat, lon, location_label, confidence, dedupe_key)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                RETURNING id, category, title, summary, source_name, source_url,
                occurred_at, lat, lon, location_label, confidence
            `;
            const vals = [
                e.category || "strike", e.title, e.summary || null,
                e.source_name || null, e.source_url || null,
                new Date(e.occurred_at), e.lat, e.lon,
                e.location_label || null,
                Number.isFinite(e.confidence) ? e.confidence : 50,
                e.dedupe_key || null
            ];
            const inserted = (await query(sql, vals)).rows[0];
            broadcast({ type: "event:new", event: inserted });
            res.json({ event: inserted });
        } catch (err) {
            if (String(err?.message || "").includes("dedupe_key")) {
                return res.status(409).json({ error: "Duplicate event" });
            }
            res.status(500).json({ error: "Failed to create event" });
        }
    });

    return router;
}