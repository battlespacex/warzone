import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadWorkerEnv } from "./env.js";
import { supabase } from "./supabase.js";
import { runStatusFeedSync } from "./status-feed-runner.js";

loadWorkerEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourcesPath = path.join(__dirname, "sources.json");
const CLUSTER_DISTANCE_DEGREES = 0.5;
const BATCH_SIZE = 500;

function interpolateEnvPlaceholders(str) {
  return String(str || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] || "");
}

function sanitizeTag(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSourceRegistryRows(feeds = []) {
  return (Array.isArray(feeds) ? feeds : [])
    .filter((feed) => feed && (feed.source_name || feed.name))
    .map((feed) => ({
      source_key: sanitizeTag(feed.source_name || feed.name || ""),
      source_name: feed.source_name || feed.name || "Unknown source",
      source_type: feed.type || feed.parser || "feed",
      enabled: feed.enabled !== false,
      trust_score: Number.isFinite(Number(feed.trust_score)) ? Number(feed.trust_score) : 50,
      publish_mode: feed.publish_mode || "normal",
      category_default: feed.category || null,
      tags: Array.isArray(feed.tags) ? feed.tags : null,
      default_confidence: Number.isFinite(Number(feed.default_confidence))
        ? Number(feed.default_confidence)
        : null,
      promotion_mode: feed.promotion_mode || "normal"
    }));
}

function chunk(items = [], size = BATCH_SIZE) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

async function syncSourceRegistry() {
  const rawSources = fs.readFileSync(sourcesPath, "utf-8");
  const sources = JSON.parse(interpolateEnvPlaceholders(rawSources));
  const rows = buildSourceRegistryRows(sources?.feeds);
  if (!rows.length) {
    return { attempted: 0, inserted: 0, skipped: true };
  }

  const { data, error } = await supabase
    .from("source_registry")
    .upsert(rows, { onConflict: "source_name", ignoreDuplicates: false })
    .select("id");

  if (error) {
    throw new Error(`source_registry sync failed: ${error.message}`);
  }

  return {
    attempted: rows.length,
    inserted: Array.isArray(data) ? data.length : 0
  };
}

async function fetchAllRows(table, columns, pageSize = 1000, filters = null) {
  const rows = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);

    if (typeof filters === "function") {
      query = filters(query);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`${table} fetch failed: ${error.message}`);
    }

    if (!Array.isArray(data) || !data.length) {
      break;
    }

    rows.push(...data);
    if (data.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}

async function backfillEventClusters() {
  const { count: existingCount, error: countError } = await supabase
    .from("event_clusters")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`event_clusters count failed: ${countError.message}`);
  }

  if ((existingCount || 0) > 0 && process.env.FORCE_REBUILD_EVENT_CLUSTERS !== "1") {
    return { skipped: true, existing: existingCount };
  }

  if ((existingCount || 0) > 0 && process.env.FORCE_REBUILD_EVENT_CLUSTERS === "1") {
    const { error: truncateError } = await supabase.from("event_clusters").delete().not("id", "is", null);
    if (truncateError) {
      throw new Error(`event_clusters clear failed: ${truncateError.message}`);
    }
  }

  const events = await fetchAllRows(
    "events",
    "id, lat, lon, occurred_at, created_at",
    1000,
    (query) => query.not("lat", "is", null).not("lon", "is", null).order("occurred_at", { ascending: true })
  );

  const clusters = [];
  for (const event of events) {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const stamp = event.occurred_at || event.created_at || new Date().toISOString();
    const match = clusters.find((cluster) =>
      Math.abs(Number(cluster.lat) - lat) < CLUSTER_DISTANCE_DEGREES &&
      Math.abs(Number(cluster.lon) - lon) < CLUSTER_DISTANCE_DEGREES
    );

    if (match) {
      match.event_count += 1;
      match.updated_at = stamp;
      continue;
    }

    clusters.push({
      lat,
      lon,
      event_count: 1,
      created_at: stamp,
      updated_at: stamp
    });
  }

  let inserted = 0;
  for (const batch of chunk(clusters)) {
    const { data, error } = await supabase
      .from("event_clusters")
      .insert(batch)
      .select("id");
    if (error) {
      throw new Error(`event_clusters insert failed: ${error.message}`);
    }
    inserted += Array.isArray(data) ? data.length : 0;
  }

  return {
    skipped: false,
    source_events: events.length,
    inserted
  };
}

async function backfillEventSources() {
  const existingLinks = await fetchAllRows("event_sources", "event_id", 1000);
  const existingIds = new Set(existingLinks.map((row) => String(row.event_id || "")).filter(Boolean));
  const events = await fetchAllRows("events", "id, dedupe_key, source_name, source_url, created_at", 1000);
  const raws = await fetchAllRows("raw_items", "id, external_id, source_name, url, created_at", 1000);

  const rawByExternalId = new Map();
  const rawBySourceUrl = new Map();

  for (const raw of raws) {
    if (raw.external_id && !rawByExternalId.has(raw.external_id)) {
      rawByExternalId.set(raw.external_id, raw);
    }
    const sourceUrlKey = `${raw.source_name || ""}||${raw.url || ""}`;
    if (raw.url && !rawBySourceUrl.has(sourceUrlKey)) {
      rawBySourceUrl.set(sourceUrlKey, raw);
    }
  }

  const rows = [];
  for (const event of events) {
    const eventId = String(event.id || "");
    if (!eventId || existingIds.has(eventId)) continue;

    let raw = null;
    if (event.dedupe_key && rawByExternalId.has(event.dedupe_key)) {
      raw = rawByExternalId.get(event.dedupe_key);
    } else if (event.source_url) {
      raw = rawBySourceUrl.get(`${event.source_name || ""}||${event.source_url || ""}`) || null;
    }

    if (!raw?.id) continue;

    rows.push({
      event_id: event.id,
      raw_item_id: raw.id,
      source_name: event.source_name || raw.source_name || "unknown",
      source_url: event.source_url || raw.url || null,
      created_at: event.created_at || raw.created_at || new Date().toISOString()
    });
  }

  let inserted = 0;
  for (const batch of chunk(rows)) {
    const { data, error } = await supabase
      .from("event_sources")
      .insert(batch)
      .select("id");
    if (error) {
      throw new Error(`event_sources insert failed: ${error.message}`);
    }
    inserted += Array.isArray(data) ? data.length : 0;
  }

  return {
    matched: rows.length,
    inserted
  };
}

async function backfillNavalTracksLog() {
  const events = await fetchAllRows(
    "events",
    "id, source_name, occurred_at, created_at, lat, lon, metadata, title",
    1000,
    (query) => query.eq("source_name", "AIS / AISStream.io").order("occurred_at", { ascending: false })
  );

  const latestByMmsi = new Map();
  for (const event of events) {
    const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
    const mmsi = String(metadata.mmsi || "").trim();
    if (!mmsi || latestByMmsi.has(mmsi)) continue;

    latestByMmsi.set(mmsi, {
      mmsi,
      vessel_name: metadata.vessel_name || event.title || `Military Vessel MMSI:${mmsi}`,
      ship_type: metadata.ship_type ?? null,
      vessel_class: metadata.vessel_class || "naval",
      lat: Number.isFinite(Number(event.lat)) ? Number(event.lat) : null,
      lon: Number.isFinite(Number(event.lon)) ? Number(event.lon) : null,
      speed_kts: Number.isFinite(Number(metadata.speed_kts)) ? Number(metadata.speed_kts) : null,
      heading_deg: Number.isFinite(Number(metadata.heading)) ? Number(metadata.heading) : null,
      status: "active",
      last_seen_at: event.occurred_at || event.created_at || new Date().toISOString(),
      created_at: event.created_at || new Date().toISOString()
    });
  }

  const rows = Array.from(latestByMmsi.values());
  let inserted = 0;
  for (const batch of chunk(rows)) {
    const { data, error } = await supabase
      .from("naval_tracks_log")
      .upsert(batch, { onConflict: "mmsi", ignoreDuplicates: false })
      .select("id");
    if (error) {
      throw new Error(`naval_tracks_log upsert failed: ${error.message}`);
    }
    inserted += Array.isArray(data) ? data.length : 0;
  }

  return {
    source_events: events.length,
    unique_vessels: rows.length,
    inserted
  };
}

async function syncStatusFeed() {
  const maxAgeDays = Number.parseInt(String(process.env.STATUS_FEED_MAX_AGE_DAYS || "180"), 10) || 180;
  const minimumScore = Number.parseInt(String(process.env.STATUS_FEED_MINIMUM_SCORE || "24"), 10) || 24;

  const result = await runStatusFeedSync({ maxAgeDays, minimumScore });
  if (!result.ok && result.error) {
    throw new Error(`status_feed_items sync failed: ${result.error}`);
  }

  return {
    maxAgeDays,
    minimumScore,
    fetched: result.fetched_item_count || 0,
    filtered: result.filtered_item_count || 0,
    inserted: result.inserted_count || 0
  };
}

async function main() {
  const summary = {};

  summary.source_registry = await syncSourceRegistry();
  summary.event_clusters = await backfillEventClusters();
  summary.event_sources = await backfillEventSources();
  summary.naval_tracks_log = await backfillNavalTracksLog();
  summary.status_feed_items = await syncStatusFeed();

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
