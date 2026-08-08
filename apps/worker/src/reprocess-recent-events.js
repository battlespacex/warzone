import { loadWorkerEnv } from "./env.js";
import { supabase } from "./supabase.js";
import {
  NORMALIZATION_VERSION,
  normalizeEventRowForStorage
} from "./intelligence-normalizer.js";
import {
  MAP_EVENT_HISTORY_WINDOW_HOURS,
  applyGeneralEventDeliveryFilters,
  applyMapEventHistoricalQueryFilter
} from "../../shared/map-event-policy.js";

loadWorkerEnv();

const DEFAULT_WINDOW_HOURS = MAP_EVENT_HISTORY_WINDOW_HOURS;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const ALLOW_NULL_COORDINATE_WRITES = hasFlag("null-coordinates");

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => String(arg || "").startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stableJson(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableJson);
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableJson(value[key]);
    return out;
  }, {});
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") {
    const aa = Number(a);
    const bb = Number(b);
    return Number.isFinite(aa) && Number.isFinite(bb) && Math.abs(aa - bb) < 0.000001;
  }
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(stableJson(a)) === JSON.stringify(stableJson(b));
  }
  return String(a ?? "") === String(b ?? "");
}

function hasManualOverride(row = {}) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return (
    row.manual_override === true ||
    row.manual_corrected === true ||
    metadata.manual_override === true ||
    metadata.manualOverride === true ||
    metadata.trusted_manual_override === true ||
    metadata.trustedManualOverride === true
  );
}

function mergeNormalizationMetadata(row = {}, normalized = {}) {
  const existing = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {};
  const previousNormalization = existing.normalization && typeof existing.normalization === "object"
    ? existing.normalization
    : {};

  return {
    ...existing,
    normalization: {
      ...previousNormalization,
      version: NORMALIZATION_VERSION,
      reprocessed_at: new Date().toISOString(),
      reprocess_source: "worker:reprocess-recent-events",
      map_eligible: Number.isFinite(Number(normalized.lat)) && Number.isFinite(Number(normalized.lon)),
      cleaned_display_fields: true
    }
  };
}

function buildEventPatch(row = {}) {
  if (hasManualOverride(row)) {
    return { skipped: true, reason: "manual_override" };
  }

  const normalized = normalizeEventRowForStorage(row);
  if (!normalized) {
    return { skipped: true, reason: "normalizer_rejected" };
  }

  const candidate = {
    category: normalized.category,
    title: normalized.title,
    summary: normalized.summary,
    source_name: normalized.source_name,
    lat: normalized.lat,
    lon: normalized.lon,
    location_label: normalized.location_label,
    impact_label: normalized.impact_label,
    origin_label: normalized.origin_label,
    severity: normalized.severity,
    confidence: normalized.confidence
  };

  if (!ALLOW_NULL_COORDINATE_WRITES && normalized.lat == null && normalized.lon == null) {
    delete candidate.lat;
    delete candidate.lon;
  }

  if (!Number.isFinite(Date.parse(row.occurred_at || ""))) {
    candidate.occurred_at = normalized.occurred_at;
  }

  const patch = {};
  const changedFields = [];
  for (const [key, value] of Object.entries(candidate)) {
    if (valuesEqual(row[key], value)) continue;
    patch[key] = value;
    changedFields.push(key);
  }

  if (!changedFields.length) {
    return { skipped: true, reason: "unchanged" };
  }

  patch.metadata = mergeNormalizationMetadata(row, normalized);
  changedFields.push("metadata");

  return {
    skipped: false,
    patch,
    changedFields
  };
}

function summarizeChange(row = {}, patchInfo = {}) {
  const patch = patchInfo.patch || {};
  const afterValue = (key) => Object.prototype.hasOwnProperty.call(patch, key)
    ? patch[key]
    : row[key];

  return {
    id: row.id,
    title: afterValue("title"),
    changedFields: patchInfo.changedFields,
    before: {
      title: row.title,
      source_name: row.source_name,
      location_label: row.location_label,
      severity: row.severity,
      lat: row.lat,
      lon: row.lon
    },
    after: {
      title: afterValue("title"),
      source_name: afterValue("source_name"),
      location_label: afterValue("location_label"),
      severity: afterValue("severity"),
      lat: afterValue("lat"),
      lon: afterValue("lon")
    }
  };
}

async function fetchRecentEvents({ hours, limit }) {
  const cutoffIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  let eventsQuery = supabase
    .from("events")
    .select("*")
    .gte("occurred_at", cutoffIso);
  eventsQuery = applyGeneralEventDeliveryFilters(eventsQuery);
  eventsQuery = applyMapEventHistoricalQueryFilter(eventsQuery);
  const { data, error } = await eventsQuery
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`events fetch failed: ${error.message}`);
  }

  return Array.isArray(data) ? data : [];
}

async function applyEventPatch(row, patch) {
  const { error } = await supabase
    .from("events")
    .update(patch)
    .eq("id", row.id);

  if (error) {
    throw new Error(`event ${row.id} update failed: ${error.message}`);
  }
}

async function resetSatelliteErrorsForEvents(eventIds = []) {
  if (!eventIds.length) return { attempted: 0, updated: 0 };
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .update({
      status: "pending",
      error_code: null,
      error_message_sanitized: null,
      next_retry_at: null,
      updated_at: new Date().toISOString()
    })
    .in("event_id", eventIds)
    .in("status", ["retryable_error", "permanent_error"])
    .select("id");

  if (error) {
    throw new Error(`satellite observation reset failed: ${error.message}`);
  }

  return {
    attempted: eventIds.length,
    updated: Array.isArray(data) ? data.length : 0
  };
}

async function main() {
  const apply = hasFlag("apply");
  const resetSatelliteErrors = hasFlag("reset-satellite-errors");
  const hours = clampInt(
    readArg("hours", DEFAULT_WINDOW_HOURS),
    DEFAULT_WINDOW_HOURS,
    1,
    MAP_EVENT_HISTORY_WINDOW_HOURS
  );
  const limit = clampInt(readArg("limit", DEFAULT_LIMIT), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const events = await fetchRecentEvents({ hours, limit });
  const changes = [];
  const skipped = {};
  let applied = 0;

  for (const row of events) {
    const patchInfo = buildEventPatch(row);
    if (patchInfo.skipped) {
      skipped[patchInfo.reason] = (skipped[patchInfo.reason] || 0) + 1;
      continue;
    }

    changes.push(summarizeChange(row, patchInfo));
    if (apply) {
      await applyEventPatch(row, patchInfo.patch);
      applied += 1;
    }
  }

  const changedIds = changes.map((change) => change.id).filter(Boolean);
  const satelliteReset = apply && resetSatelliteErrors
    ? await resetSatelliteErrorsForEvents(changedIds)
    : { attempted: resetSatelliteErrors ? changedIds.length : 0, updated: 0, dry_run: !apply };

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry_run",
    hours,
    limit,
    considered: events.length,
    changed: changes.length,
    applied,
    skipped,
    satelliteReset,
    sampleChanges: changes.slice(0, 12)
  }, null, 2));
}

main().catch((error) => {
  console.error("[reprocess] failed:", error?.message || error);
  process.exitCode = 1;
});
