// Promotes strict live operational conflict-feed items into map events.
// Broad defense/procurement items remain in conflict_feed_items for Intel Wire only.

import { supabase } from "./supabase.js";
import {
  hasOperationalEventSignal,
  isIntelWireOnlyNewsText,
  normalizeConflictItemToEventPayload,
  safeDate
} from "./intelligence-normalizer.js";
import {
  MAP_EVENT_HISTORY_WINDOW_HOURS,
  isMapEventHistoricallyRelevant
} from "../../shared/map-event-policy.js";
import { mergeEventQuality, readEventQuality } from "./event-quality.js";
import { CORROBORATION_STATES } from "../../shared/source-quality-policy.js";

const DEFAULT_PROMOTION_LIMIT = 40;
const DEFAULT_MAX_AGE_HOURS = MAP_EVENT_HISTORY_WINDOW_HOURS;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PROMOTION_LIMIT = readPositiveInteger(
  process.env.CONFLICT_EVENT_PROMOTION_LIMIT,
  DEFAULT_PROMOTION_LIMIT
);

const MAX_AGE_HOURS = Math.max(
  DEFAULT_MAX_AGE_HOURS,
  readPositiveInteger(process.env.CONFLICT_EVENT_MAX_AGE_HOURS, DEFAULT_MAX_AGE_HOURS)
);

function getItemText(item = {}) {
  return [item.title, item.summary, item.source_category]
    .filter(Boolean)
    .join(" ");
}

function isRecentEnough(item = {}) {
  if (!MAX_AGE_HOURS) return true;
  const occurredAt = safeDate(item.published_at || item.fetched_at);
  if (!occurredAt) return true;
  return Date.now() - Date.parse(occurredAt) <= MAX_AGE_HOURS * 60 * 60 * 1000;
}

function isPromotableOperationalItem(item = {}) {
  if (!item || item.is_conflict_relevant === false) return false;
  if (!item.title || !item.url) return false;
  const text = getItemText(item);
  if (isIntelWireOnlyNewsText(text)) return false;
  return hasOperationalEventSignal(text);
}

function pickCoreEventPayload(payload = {}) {
  return {
    category: payload.category || "strike",
    title: payload.title,
    summary: payload.summary || null,
    source_name: payload.source_name || null,
    source_url: payload.source_url || null,
    occurred_at: payload.occurred_at,
    lat: payload.lat,
    lon: payload.lon,
    location_label: payload.location_label || null,
    confidence: Number.isFinite(payload.confidence) ? payload.confidence : 50,
    dedupe_key: payload.dedupe_key || null
  };
}

function isSchemaColumnError(error) {
  const message = String(error?.message || error || "");
  return /column|schema cache|priority_score|metadata|tags|weapon_type|subcategory|severity|report_type/i.test(message);
}

async function findExistingEvent(payload = {}) {
  const selection = "id, metadata, confidence, status, source_count, dedupe_key, source_url";
  const dedupeKey = payload.dedupe_key;
  if (dedupeKey) {
    const { data, error } = await supabase
      .from("events")
      .select(selection)
      .eq("dedupe_key", dedupeKey)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return data[0];
  }

  if (payload.source_url) {
    const { data, error } = await supabase
      .from("events")
      .select(selection)
      .eq("source_url", payload.source_url)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return data[0];
  }

  const fingerprint = readEventQuality(payload).event_fingerprint;
  if (fingerprint) {
    const { data, error } = await supabase
      .from("events")
      .select(selection)
      .eq("metadata->event_quality->>event_fingerprint", fingerprint)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) return data[0];
  }

  return null;
}

async function mergePromotedEvent(existing = {}, incoming = {}) {
  const quality = mergeEventQuality(existing, incoming);
  const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const confidence = quality.corroboration_state === CORROBORATION_STATES.DISPUTED
    ? quality.confidence
    : Math.min(96, Math.max(Number(existing.confidence || 0), Number(incoming.confidence || 0), quality.confidence));
  const status = quality.corroboration_state === CORROBORATION_STATES.CONFIRMED
    ? "verified"
    : quality.corroboration_state === CORROBORATION_STATES.UNVERIFIED || quality.corroboration_state === CORROBORATION_STATES.DISPUTED
      ? "signal"
      : "developing";
  const updateResult = await supabase
    .from("events")
    .update({
      metadata: { ...metadata, event_quality: quality },
      confidence,
      status,
      source_count: quality.raw_report_count,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  return { ...updateResult, quality };
}

async function insertPromotedEvent(payload = {}) {
  let result = await supabase.from("events").insert([payload]);
  if (result.error && isSchemaColumnError(result.error)) {
    result = await supabase.from("events").insert([pickCoreEventPayload(payload)]);
  }
  return result;
}

async function promoteConflictFeedItemsToEvents(items = [], options = {}) {
  const logger = options.logger || console;
  const limit = readPositiveInteger(options.limit, PROMOTION_LIMIT);
  const result = {
    ok: true,
    considered_count: 0,
    candidate_count: 0,
    promoted_count: 0,
    merged_count: 0,
    duplicate_count: 0,
    skipped_non_operational_count: 0,
    skipped_old_count: 0,
    skipped_low_relevance_count: 0,
    skipped_no_location_count: 0,
    error_count: 0,
    errors: []
  };

  const sourceItems = Array.isArray(items) ? items : [];

  for (const item of sourceItems) {
    result.considered_count += 1;

    if (!isPromotableOperationalItem(item)) {
      result.skipped_non_operational_count += 1;
      continue;
    }

    if (!isRecentEnough(item)) {
      result.skipped_old_count += 1;
      continue;
    }

    result.candidate_count += 1;
    if (result.promoted_count >= limit) continue;

    const normalized = normalizeConflictItemToEventPayload(item);
    if (!normalized.map_eligible) {
      result.skipped_no_location_count += 1;
      logger.debug?.(
        `[conflict] event promotion skipped reason=${normalized.reason} title=${String(item.title || "").slice(0, 80)}`
      );
      continue;
    }

    const payload = normalized.event;
    if (!isMapEventHistoricallyRelevant(payload)) {
      result.skipped_low_relevance_count += 1;
      continue;
    }

    try {
      const existing = await findExistingEvent(payload);
      if (existing) {
        const beforeCount = Number(readEventQuality(existing).raw_report_count || 0);
        const mergeResult = await mergePromotedEvent(existing, payload);
        if (mergeResult.error) {
          result.error_count += 1;
          result.errors.push(mergeResult.error.message || String(mergeResult.error));
        } else if (Number(mergeResult.quality?.raw_report_count || 0) > beforeCount) {
          result.merged_count += 1;
        } else {
          result.duplicate_count += 1;
        }
        continue;
      }

      const { error } = await insertPromotedEvent(payload);
      if (error) {
        result.error_count += 1;
        result.errors.push(error.message || String(error));
        logger.warn?.(`[conflict] event promotion insert failed: ${error.message || error}`);
        continue;
      }

      result.promoted_count += 1;
    } catch (error) {
      result.error_count += 1;
      result.errors.push(error?.message || String(error));
      logger.warn?.(`[conflict] event promotion failed: ${error?.message || error}`);
    }
  }

  if (result.error_count > 0) result.ok = false;
  return result;
}

export {
  hasOperationalEventSignal,
  isIntelWireOnlyNewsText,
  isPromotableOperationalItem,
  promoteConflictFeedItemsToEvents
};
