import express from "express";
import { query } from "./db.js";
import { createClient } from "@supabase/supabase-js";
import { getIntelWireMediaAsset, toPublicIntelWireItem } from "./intel-source-sanitizer.js";
import { getPublicGnssInterferenceCells } from "./gnss-interference-public.js";
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
const DEFAULT_INTEL_FEED_LIMIT = 120;
const MAX_INTEL_FEED_LIMIT = 300;
const DEFAULT_GNSS_CELL_LIMIT = 240;
const MAX_GNSS_CELL_LIMIT = 600;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

function getRequestBaseUrl(req) {
    const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
    if (!host) return "";
    const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
    const proto = forwardedProto || req.protocol || "http";
    return `${proto}://${host}/`;
}

function toAirspaceStatusRow(event = {}) {
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
                .from("events")
                .select("id, created_at, occurred_at, location_label, country_code, airspace_status, title, summary, source_name, source_url, fir_code, lat, lon")
                .not("airspace_status", "is", null)
                .neq("airspace_status", "unknown")
                .order("occurred_at", { ascending: false })
                .limit(500);
            if (error) return res.status(500).json({ error: "Failed" });
            res.json({ statuses: (data || []).map(toAirspaceStatusRow).filter(Boolean) });
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

    // ── Intel Wire feed items ─────────────────────────────────────
    router.get("/intel-feed", async (req, res) => {
        try {
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isFinite(requestedLimit)
                ? clamp(Math.floor(requestedLimit), 25, MAX_INTEL_FEED_LIMIT)
                : DEFAULT_INTEL_FEED_LIMIT;
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("conflict_feed_items")
                .select("id, source_id, source_name, source_type, source_category, title, summary, url, published_at, fetched_at, region, country, category, confidence_score, is_conflict_relevant, raw")
                .eq("is_conflict_relevant", true)
                .order("published_at", { ascending: false, nullsFirst: false })
                .order("fetched_at", { ascending: false })
                .limit(limit);
            if (error) return res.status(500).json({ error: "Failed" });
            const mediaBaseUrl = getRequestBaseUrl(req);
            res.json({ items: (data || []).map((item) => toPublicIntelWireItem(item, { mediaBaseUrl })) });
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    router.get("/intel-feed/media/:itemId/:kind/:index/:variant", async (req, res) => {
        try {
            const itemId = String(req.params.itemId || "").trim();
            const kind = String(req.params.kind || "").trim().toLowerCase();
            const variant = String(req.params.variant || "").trim().toLowerCase();
            const index = Math.max(0, Number(req.params.index) || 0);
            if (!itemId || !["image", "video"].includes(kind)) {
                return res.status(404).end();
            }
            const allowedVariants = kind === "image"
                ? new Set(["thumb", "full"])
                : new Set(["thumb", "stream"]);
            if (!allowedVariants.has(variant)) {
                return res.status(404).end();
            }
            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("conflict_feed_items")
                .select("id, raw")
                .eq("id", itemId)
                .maybeSingle();
            if (error || !data) return res.status(404).end();
            const asset = getIntelWireMediaAsset(data, kind, index, variant);
            if (!asset?.url || !asset?.type) return res.status(404).end();
            const upstream = await fetch(asset.url, {
                redirect: "follow",
                headers: {
                    "user-agent": "StratOpsMediaProxy/1.0",
                    "accept": asset.type === "video"
                        ? "video/*,application/octet-stream;q=0.8,*/*;q=0.5"
                        : "image/*,*/*;q=0.5",
                },
            });
            if (!upstream.ok || !upstream.body) return res.status(404).end();
            const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
            if (asset.type === "image" && !contentType.startsWith("image/")) {
                return res.status(404).end();
            }
            if (asset.type === "video" && !contentType.startsWith("video/")) {
                return res.status(404).end();
            }
            res.setHeader("Content-Type", contentType || (asset.type === "video" ? "video/mp4" : "image/jpeg"));
            res.setHeader("Cache-Control", "public, max-age=900, stale-while-revalidate=3600");
            const contentLength = upstream.headers.get("content-length");
            if (contentLength) res.setHeader("Content-Length", contentLength);
            const lastModified = upstream.headers.get("last-modified");
            if (lastModified) res.setHeader("Last-Modified", lastModified);
            const etag = upstream.headers.get("etag");
            if (etag) res.setHeader("ETag", etag);
            if (typeof upstream.body.pipeTo === "function") {
                const writer = new WritableStream({
                    write(chunk) {
                        res.write(Buffer.from(chunk));
                    },
                    close() {
                        res.end();
                    },
                    abort() {
                        res.end();
                    },
                });
                await upstream.body.pipeTo(writer);
                return;
            }
            const arrayBuffer = await upstream.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
        } catch {
            res.status(500).json({ error: "Failed" });
        }
    });

    // ── GNSS interference cells (sanitized public payload) ─────────
    router.get("/gnss-interference", async (req, res) => {
        try {
            const requestedLimit = Number(req.query.limit);
            const limit = Number.isFinite(requestedLimit)
                ? clamp(Math.floor(requestedLimit), 12, MAX_GNSS_CELL_LIMIT)
                : DEFAULT_GNSS_CELL_LIMIT;
            const payload = await getPublicGnssInterferenceCells({
                supabase: getSupabase(),
                limit,
            });
            res.json(payload);
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
