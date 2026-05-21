import express from "express";
import { query } from "./db.js";
import { createClient } from "@supabase/supabase-js";
const DEFAULT_EVENTS_WINDOW_HOURS = 48;
const MIN_EVENTS_WINDOW_HOURS = 6;
const MAX_EVENTS_WINDOW_HOURS = 168;
const DEFAULT_EVENTS_LIMIT = 2000;
const MIN_EVENTS_LIMIT = 200;
const MAX_EVENTS_LIMIT = 4000;
const DEFAULT_EVENTS_SINCE_LIMIT = 200;
const MAX_EVENTS_SINCE_LIMIT = 500;
const AIRCRAFT_HISTORY_WINDOW_HOURS = 72;
const AIRCRAFT_HISTORY_LIMIT = 1000;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

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
            const requestedWindowHours = Number(req.query.window_hours);
            const windowHours = Number.isFinite(requestedWindowHours)
                ? clamp(requestedWindowHours, MIN_EVENTS_WINDOW_HOURS, MAX_EVENTS_WINDOW_HOURS)
                : DEFAULT_EVENTS_WINDOW_HOURS;
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isFinite(requestedLimit)
                ? clamp(Math.floor(requestedLimit), MIN_EVENTS_LIMIT, MAX_EVENTS_LIMIT)
                : DEFAULT_EVENTS_LIMIT;
            const cutoffIso = new Date(Date.now() - (windowHours * 60 * 60 * 1000)).toISOString();
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .gte("occurred_at", cutoffIso)
                .order("occurred_at", { ascending: false })
                .limit(limit);
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
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isFinite(requestedLimit)
                ? clamp(Math.floor(requestedLimit), 25, MAX_EVENTS_SINCE_LIMIT)
                : DEFAULT_EVENTS_SINCE_LIMIT;
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .gt("occurred_at", since)
                .order("occurred_at", { ascending: false })
                .limit(limit);
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

    // ── Airspace status rows for status widgets ────────────────────
    router.get("/airspace-status", async (req, res) => {
        try {
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("airspace_status")
                .select("*")
                .order("updated_at", { ascending: false });
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ statuses: data || [] });
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    // ── Aircraft tracks ────────────────────────────────────────────
    router.get("/aircraft", async (req, res) => {
        try {
            const supabase = getSupabase();
            const cutoff = new Date(Date.now() - AIRCRAFT_HISTORY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from("tracks")
                .select("*")
                .eq("track_type", "aircraft")
                .eq("category", "military")
                .gte("updated_at", cutoff)
                .order("updated_at", { ascending: false })
                .limit(AIRCRAFT_HISTORY_LIMIT);
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
