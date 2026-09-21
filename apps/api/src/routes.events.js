import express from "express";
import { query } from "./db.js";
import { createClient } from "@supabase/supabase-js";
import { getIntelWireMediaAsset, toPublicIntelWireItem } from "./intel-source-sanitizer.js";
import { getPublicGnssInterferenceCells } from "./gnss-interference-public.js";
import { attachEventMediaToEvents } from "./event-media-context.js";
import { attachSatelliteContextToEvents } from "./satellite-context.js";
import { toPublicEvent, toPublicMapEvent } from "./public-event-normalizer.js";
import {
    MAP_EVENT_HISTORY_WINDOW_HOURS,
    applyGeneralEventDeliveryFilters,
    applyMapEventHistoricalQueryFilter,
} from "../../shared/map-event-policy.js";
const DEFAULT_EVENTS_WINDOW_HOURS = MAP_EVENT_HISTORY_WINDOW_HOURS;
const MIN_EVENTS_WINDOW_HOURS = 6;
const MAX_EVENTS_WINDOW_HOURS = MAP_EVENT_HISTORY_WINDOW_HOURS;
const DEFAULT_EVENTS_LIMIT = 2000;
const MIN_EVENTS_LIMIT = 200;
const MAX_EVENTS_LIMIT = 4000;
export const MAP_EVENTS_WINDOW_HOURS = 48;
export const MAP_EVENTS_MAX_WINDOW_HOURS = 72;
export const MAP_EVENTS_LIMIT = 800;
export const MAP_EVENTS_SELECT_COLUMNS = [
    "id",
    "created_at",
    "occurred_at",
    "category",
    "subcategory",
    "report_type",
    "title",
    "summary",
    "source_name",
    "location_label",
    "country_code",
    "severity",
    "confidence",
    "lat",
    "lon",
    "weapon_type",
    "source_count",
    "priority_score",
    "is_breaking",
    "dedupe_key",
    "tags",
    "metadata",
].join(", ");
const DEFAULT_EVENTS_SINCE_LIMIT = 200;
const MAX_EVENTS_SINCE_LIMIT = 500;
const AIRCRAFT_HISTORY_WINDOW_HOURS = 72;
const AIRCRAFT_HISTORY_LIMIT = 1000;
const DEFAULT_INTEL_FEED_LIMIT = 120;
const MAX_INTEL_FEED_LIMIT = 300;
const DEFAULT_GNSS_CELL_LIMIT = 240;
const MAX_GNSS_CELL_LIMIT = 600;
const DEFAULT_PUBLIC_API_BASE_URL = "https://api.battlespacex.com/";

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

function normalizeBaseUrl(value = "") {
    try {
        const url = new URL(String(value || "").trim());
        return `${url.origin}/`;
    } catch {
        return "";
    }
}

function isLocalNetworkHost(hostname = "") {
    const host = String(hostname || "").trim().toLowerCase();
    if (!host) return false;
    if (host === "localhost" || host === "::1" || host === "[::1]") return true;
    if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;
    const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    return private172;
}

function getPublicMediaBaseUrl(req) {
    const configured = normalizeBaseUrl(
        process.env.EVENTS_MEDIA_PUBLIC_URL ||
        process.env.STRATOPS_API_PUBLIC_URL ||
        process.env.API_PUBLIC_URL ||
        ""
    );
    if (configured) return configured;

    const requestBase = normalizeBaseUrl(getRequestBaseUrl(req));
    if (!requestBase) return DEFAULT_PUBLIC_API_BASE_URL;

    try {
        const requestUrl = new URL(requestBase);
        const originUrl = new URL(String(req.get("origin") || ""));
        if (!isLocalNetworkHost(originUrl.hostname) && isLocalNetworkHost(requestUrl.hostname)) {
            return DEFAULT_PUBLIC_API_BASE_URL;
        }
    } catch {
        // No Origin header or malformed Origin: fall back to the request base below.
    }

    if (process.env.NODE_ENV === "production" && isLocalNetworkHost(new URL(requestBase).hostname)) {
        return DEFAULT_PUBLIC_API_BASE_URL;
    }

    return requestBase;
}

function toAirspaceStatusRow(event = {}) {
    const status = String(event.airspace_status || "").toLowerCase();
    if (!status || status === "unknown") return null;
    const publicEvent = toPublicEvent(event);
    return {
        id: publicEvent.id,
        region: publicEvent.display_location_label || "",
        country_code: publicEvent.country_code || "",
        status,
        title: publicEvent.display_title || "",
        summary: publicEvent.display_summary || "",
        source_name: publicEvent.display_source_name || "",
        source_url: publicEvent.source_url || "",
        fir_code: publicEvent.fir_code || "",
        updated_at: publicEvent.occurred_at || publicEvent.created_at || new Date().toISOString(),
        expires_at: null,
        lat: publicEvent.lat,
        lon: publicEvent.lon
    };
}

export function buildGeneralEventsQuery(supabase, options = {}) {
    let eventsQuery = supabase.from("events").select("*");
    if (options.cutoffIso) {
        eventsQuery = eventsQuery.gte("occurred_at", options.cutoffIso);
    }
    if (options.sinceIso) {
        eventsQuery = eventsQuery.gt("occurred_at", options.sinceIso);
    }
    eventsQuery = applyGeneralEventDeliveryFilters(eventsQuery);
    eventsQuery = applyMapEventHistoricalQueryFilter(eventsQuery, { now: options.now });
    return eventsQuery
        .order("occurred_at", { ascending: false })
        .limit(options.limit);
}

function readMapBounds(queryParams = {}) {
    const bounds = {
        minLat: Number(queryParams.min_lat),
        maxLat: Number(queryParams.max_lat),
        minLon: Number(queryParams.min_lon),
        maxLon: Number(queryParams.max_lon),
    };
    if (!Object.values(bounds).every(Number.isFinite)) return null;
    if (bounds.minLat < -90 || bounds.maxLat > 90 || bounds.minLon < -180 || bounds.maxLon > 180) return null;
    if (bounds.minLat > bounds.maxLat || bounds.minLon > bounds.maxLon) return null;
    return bounds;
}

export function parseMapEventsRequest(queryParams = {}, now = Date.now()) {
    const regionId = String(queryParams.region_id || "").trim().slice(0, 64);
    const bounds = readMapBounds(queryParams);
    if (!regionId || !bounds) return null;
    const requestedWindowHours = Number(queryParams.window_hours);
    const windowHours = Number.isFinite(requestedWindowHours)
        ? clamp(requestedWindowHours, MIN_EVENTS_WINDOW_HOURS, MAP_EVENTS_MAX_WINDOW_HOURS)
        : MAP_EVENTS_WINDOW_HOURS;
    const requestedLimit = Number(queryParams.limit);
    const limit = Number.isFinite(requestedLimit)
        ? clamp(Math.floor(requestedLimit), 50, MAP_EVENTS_LIMIT)
        : MAP_EVENTS_LIMIT;
    return {
        regionId,
        bounds,
        windowHours,
        limit,
        cutoffIso: new Date(now - (windowHours * 60 * 60 * 1000)).toISOString(),
    };
}

export function buildMapEventsQuery(supabase, options = {}) {
    const bounds = options.bounds || {};
    let eventsQuery = supabase
        .from("events")
        .select(MAP_EVENTS_SELECT_COLUMNS)
        .gte("occurred_at", options.cutoffIso)
        .gte("lat", bounds.minLat)
        .lte("lat", bounds.maxLat)
        .gte("lon", bounds.minLon)
        .lte("lon", bounds.maxLon);
    eventsQuery = applyGeneralEventDeliveryFilters(eventsQuery);
    return eventsQuery
        .order("is_breaking", { ascending: false })
        .order("priority_score", { ascending: false, nullsFirst: false })
        .order("occurred_at", { ascending: false })
        .limit(options.limit);
}

export function createMapEventsHandler({
    getSupabaseClient = getSupabase,
    clock = () => Date.now(),
    logger = console,
} = {}) {
    return async (req, res) => {
        const requestStartedAt = clock();
        try {
            const options = parseMapEventsRequest(req.query, requestStartedAt);
            if (!options) return res.status(400).json({ error: "Valid region bounds are required" });
            const supabase = getSupabaseClient();
            const databaseStartedAt = clock();
            const { data, error } = await buildMapEventsQuery(supabase, options);
            const databaseDurationMs = Math.max(0, clock() - databaseStartedAt);
            if (error) return res.status(500).json({ error: "Failed" });

            const serializationStartedAt = clock();
            const events = (data || []).map(toPublicMapEvent);
            const payload = JSON.stringify({
                events,
                meta: {
                    region_id: options.regionId,
                    window_hours: options.windowHours,
                    limit: options.limit,
                    rows: events.length,
                },
            });
            const serializationDurationMs = Math.max(0, clock() - serializationStartedAt);
            const totalDurationMs = Math.max(0, clock() - requestStartedAt);
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader(
                "Server-Timing",
                `db;dur=${databaseDurationMs}, serialize;dur=${serializationDurationMs}, total;dur=${totalDurationMs}`
            );
            if (process.env.NODE_ENV !== "production") {
                logger.info?.("[events/map]", {
                    regionId: options.regionId,
                    rows: events.length,
                    databaseDurationMs,
                    serializationDurationMs,
                    totalDurationMs,
                });
            }
            return res.send(payload);
        } catch {
            return res.status(500).json({ error: "Failed" });
        }
    };
}

export function createEventDetailHandler({
    getSupabaseClient = getSupabase,
    attachSatellite = attachSatelliteContextToEvents,
    attachMedia = attachEventMediaToEvents,
} = {}) {
    return async (req, res) => {
        try {
            const eventId = String(req.params.id || "").trim();
            if (!eventId || eventId.length > 200) return res.status(400).json({ error: "Invalid event id" });
            const supabase = getSupabaseClient();
            const { data, error } = await supabase
                .from("events")
                .select("*")
                .eq("id", eventId)
                .maybeSingle();
            if (error) return res.status(500).json({ error: "Failed" });
            if (!data) return res.status(404).json({ error: "Not found" });
            const mediaBaseUrl = getPublicMediaBaseUrl(req);
            const [eventWithSatellite] = await attachSatellite(supabase, [data]);
            const [eventWithMedia] = await attachMedia(supabase, [eventWithSatellite], { mediaBaseUrl });
            return res.json({ event: toPublicEvent(eventWithMedia) });
        } catch {
            return res.status(500).json({ error: "Failed" });
        }
    };
}

export function eventsRouter({ broadcast }) {
    const router = express.Router();

    // Region-scoped, non-enriched payload used only for operational map bootstrap.
    router.get("/map", createMapEventsHandler());

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
            const { data, error } = await buildGeneralEventsQuery(supabase, {
                cutoffIso,
                limit,
            });
            if (error) return res.status(500).json({ error: "Failed" });
            const mediaBaseUrl = getPublicMediaBaseUrl(req);
            const eventsWithSatellite = await attachSatelliteContextToEvents(supabase, data || []);
            const eventsWithMedia = await attachEventMediaToEvents(supabase, eventsWithSatellite, { mediaBaseUrl });
            const events = eventsWithMedia.map(toPublicEvent);
            res.json({ events });
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
            const { data, error } = await buildGeneralEventsQuery(supabase, {
                sinceIso: since,
                limit,
            });
            if (error) return res.status(500).json({ error: "Failed" });
            const mediaBaseUrl = getPublicMediaBaseUrl(req);
            const eventsWithSatellite = await attachSatelliteContextToEvents(supabase, data || []);
            const eventsWithMedia = await attachEventMediaToEvents(supabase, eventsWithSatellite, { mediaBaseUrl });
            const events = eventsWithMedia.map(toPublicEvent);
            res.json({ events });
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
    router.get("/aircraft/lookup", async (req, res) => {
        const identifier = String(req.query.identifier || "").trim().toUpperCase().replace(/\s+/g, "");
        if (!/^[A-Z0-9-]{2,24}$/.test(identifier)) {
            return res.status(400).json({ error: "Invalid aircraft identifier" });
        }
        const baseUrl = "https://api.adsb.lol/v2";
        const paths = /^[0-9A-F]{6}$/.test(identifier)
            ? [`hex/${identifier}`, `callsign/${identifier}`, `registration/${identifier}`]
            : [`callsign/${identifier}`, `registration/${identifier}`];
        try {
            const responses = await Promise.allSettled(paths.map(async (path) => {
                const response = await fetch(`${baseUrl}/${path}`, {
                    headers: { Accept: "application/json", "User-Agent": "stratops-warzone/1.0" },
                    signal: AbortSignal.timeout(6000),
                });
                if (!response.ok) return [];
                const data = await response.json();
                return Array.isArray(data?.ac) ? data.ac : [];
            }));
            const matches = responses.flatMap((result) => result.status === "fulfilled" ? result.value : [])
                .filter((aircraft) => [String(aircraft.hex || "").replace(/^~/, ""), aircraft.flight, aircraft.r]
                .some((value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "") === identifier));
            const aircraft = matches.find((item) => {
                const lat = Number(item.lat);
                const lon = Number(item.lon);
                const age = Number(item.seen_pos ?? item.seen ?? Infinity);
                return Number.isFinite(lat) && Number.isFinite(lon) &&
                    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0) &&
                    Number.isFinite(age) && age <= 90;
            });
            if (!aircraft) return res.status(404).json({ error: "No live aircraft position found" });
            const seenSeconds = Number(aircraft.seen_pos ?? aircraft.seen ?? 0);
            res.json({ track: {
                icao24: String(aircraft.hex || "").replace(/^~/, "").toLowerCase(),
                callsign: String(aircraft.flight || "").trim(),
                flight: String(aircraft.flight || "").trim(),
                registration: String(aircraft.r || "").trim(),
                lat: Number(aircraft.lat),
                lon: Number(aircraft.lon),
                altitude_ft: aircraft.alt_baro === "ground" ? 0 : Number(aircraft.alt_baro ?? aircraft.alt_geom ?? 0),
                speed_kts: Number(aircraft.gs || 0),
                heading_deg: Number(aircraft.track ?? aircraft.true_heading ?? aircraft.mag_heading ?? 0),
                on_ground: aircraft.alt_baro === "ground",
                type_code: String(aircraft.t || "").trim(),
                model_name: String(aircraft.desc || "").trim(),
                operator: String(aircraft.ownOp || "").trim(),
                updated_at: new Date(Date.now() - seenSeconds * 1000).toISOString(),
            } });
        } catch {
            res.status(502).json({ error: "Aircraft lookup unavailable" });
        }
    });
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
            const mediaBaseUrl = getPublicMediaBaseUrl(req);
            const items = (data || []).map((item) => toPublicIntelWireItem(item, { mediaBaseUrl }));
            res.json({ items });
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

    // ── GNSS jamming cells (sanitized public payload) ─────────
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

    // Full event enrichment is loaded only when a user opens a marker detail.
    router.get("/:id", createEventDetailHandler());

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
            const event = toPublicEvent(inserted);
            broadcast({ type: "event:new", event });
            res.json({ event });
        } catch (err) {
            if (String(err?.message || "").includes("dedupe_key")) {
                return res.status(409).json({ error: "Duplicate event" });
            }
            res.status(500).json({ error: "Failed to create event" });
        }
    });

    return router;
}
