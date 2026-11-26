// Promotes strict live operational conflict-feed items into map events.
// Broad defense/procurement items remain in conflict_feed_items for Intel Wire only.

import { supabase } from "./supabase.js";
import {
  hasOperationalEventSignal,
  isIntelWireOnlyNewsText,
  normalizeConflictItemToEventPayload,
  safeDate
} from "./intelligence-normalizer.js";
import { isActiveConflictItem, earliestConflictDate, originalConflictTimestamp, CONFLICT_EVENT_LOOKUP_FILTER } from "../../shared/conflict-retention.js";
import { mergeEventQuality, readEventQuality } from "./event-quality.js";
import { CORROBORATION_STATES } from "../../shared/source-quality-policy.js";

const DEFAULT_PROMOTION_LIMIT = 40;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const PROMOTION_LIMIT = readPositiveInteger(
  process.env.CONFLICT_EVENT_PROMOTION_LIMIT,
  DEFAULT_PROMOTION_LIMIT
);

function getItemText(item = {}) {
  return [item.title, item.summary, item.source_category]
    .filter(Boolean)
    .join(" ");
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

async function findExistingEvent(payload = {}, db = supabase) {
  const selection = "id, occurred_at, metadata, confidence, status, source_count, dedupe_key, source_url, country_code";
  const dedupeKey = payload.dedupe_key;
  if (dedupeKey) {
    const { data, error } = await db
      .from("events")
      .select(selection)
      .or(CONFLICT_EVENT_LOOKUP_FILTER)
      .eq("dedupe_key", dedupeKey)
      .limit(1);
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) return data[0];
  }

  if (payload.source_url) {
    const { data, error } = await db
      .from("events")
      .select(selection)
      .or(CONFLICT_EVENT_LOOKUP_FILTER)
      .eq("source_url", payload.source_url)
      .limit(1);
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) return data[0];
  }

  const fingerprint = readEventQuality(payload).event_fingerprint;
  if (fingerprint) {
    const { data, error } = await db
      .from("events")
      .select(selection)
      .or(CONFLICT_EVENT_LOOKUP_FILTER)
      .eq("metadata->event_quality->>event_fingerprint", fingerprint)
      .limit(1);
    if (error) throw error;
    if (Array.isArray(data) && data.length > 0) return data[0];
  }

  return null;
}

async function mergePromotedEvent(existing = {}, incoming = {}, db = supabase) {
  const quality = mergeEventQuality(existing, incoming, {
    event_fingerprint: readEventQuality(existing).event_fingerprint || readEventQuality(incoming).event_fingerprint,
  });
  const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const confidence = quality.corroboration_state === CORROBORATION_STATES.DISPUTED
    ? quality.confidence
    : Math.min(96, Math.max(Number(existing.confidence || 0), Number(incoming.confidence || 0), quality.confidence));
  const status = quality.corroboration_state === CORROBORATION_STATES.CONFIRMED
    ? "verified"
    : quality.corroboration_state === CORROBORATION_STATES.UNVERIFIED || quality.corroboration_state === CORROBORATION_STATES.DISPUTED
      ? "signal"
      : "developing";
  const occurredAt = earliestConflictDate(existing.occurred_at, incoming.occurred_at);
  if (JSON.stringify(quality) === JSON.stringify(readEventQuality(existing)) &&
      confidence === existing.confidence && status === existing.status &&
      quality.raw_report_count === existing.source_count && occurredAt === existing.occurred_at &&
      (!incoming.country_code || existing.country_code)) {
    return { error: null, quality, unchanged: true };
  }
  const updateResult = await db
    .from("events")
    .update({
      metadata: {
        ...metadata, intelligence_pipeline: "conflict", event_quality: quality,
        timeline: { ...incoming.metadata?.timeline, ...metadata.timeline, occurred_at: occurredAt },
      },
      confidence,
      status,
      source_count: quality.raw_report_count,
      occurred_at: occurredAt,
      ...(incoming.country_code && !existing.country_code ? { country_code: incoming.country_code } : {}),
    })
    .eq("id", existing.id);
  return { ...updateResult, quality };
}

async function insertPromotedEvent(payload = {}, db = supabase) {
  let result = await db.from("events").insert([payload]);
  if (result.error && isSchemaColumnError(result.error)) {
    result = await db.from("events").insert([pickCoreEventPayload(payload)]);
  }
  return result;
}

async function promoteConflictFeedItemsToEvents(items = [], options = {}) {
  const logger = options.logger || console;
  const db = options.db || supabase;
  const now = options.now ?? Date.now();
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
    skipped_future_count: 0,
    skipped_missing_timestamp_count: 0,
    deferred_count: 0,
    updated_count: 0,
    eligible_event_count: 0,
    failed_normalization_count: 0,
    insufficient_evidence_count: 0,
    rejection_reasons: {},
    eligible_report_regions: {},
    skipped_low_relevance_count: 0,
    skipped_no_location_count: 0,
    error_count: 0,
    errors: []
  };

  const sourceItems = Array.isArray(items) ? items : [];
  const reject = (reason) => { result.rejection_reasons[reason] = (result.rejection_reasons[reason] || 0) + 1; };

  for (const item of sourceItems) {
    result.considered_count += 1;

    if (!isPromotableOperationalItem(item)) {
      result.skipped_non_operational_count += 1;
      result.insufficient_evidence_count += 1;
      reject(item?.is_conflict_relevant === false ? "not_conflict_relevant"
        : !item?.title || !item?.url ? "missing_title_or_url"
        : isIntelWireOnlyNewsText(getItemText(item)) ? "intel_wire_only_news" : "not_operational_incident");
      continue;
    }

    if (!safeDate(item.occurred_at || item.raw?._original_occurred_at || item.published_at)) {
      result.skipped_missing_timestamp_count += 1;
      reject("missing_original_timestamp");
      continue;
    }
    if (!isActiveConflictItem(item, now)) {
      if (originalConflictTimestamp(item) > now) { result.skipped_future_count += 1; reject("future_timestamp"); }
      else { result.skipped_old_count += 1; reject("expired"); }
      continue;
    }

    result.candidate_count += 1;

    let normalized;
    try {
      normalized = normalizeConflictItemToEventPayload(item);
    } catch {
      result.failed_normalization_count += 1;
      result.error_count += 1;
      reject("normalization_failed");
      continue;
    }
    if (!normalized.map_eligible) {
      if (normalized.reason === "unreliable_location") result.skipped_no_location_count += 1;
      else result.insufficient_evidence_count += 1;
      reject(normalized.reason);
      logger.debug?.(
        `[conflict] event promotion skipped reason=${normalized.reason} title=${String(item.title || "").slice(0, 80)}`
      );
      continue;
    }

    const payload = normalized.event;
    if (!isActiveConflictItem(payload, now)) {
      result.skipped_low_relevance_count += 1;
      reject("expired_original_occurrence");
      continue;
    }
    result.eligible_event_count += 1;
    const region = payload.metadata?.normalization?.event_region || "unassigned";
    result.eligible_report_regions[region] = (result.eligible_report_regions[region] || 0) + 1;

    try {
      const existing = await findExistingEvent(payload, db);
      if (existing) {
        const beforeCount = Number(readEventQuality(existing).raw_report_count || 0);
        const mergeResult = await mergePromotedEvent(existing, payload, db);
        if (mergeResult.error) {
          result.error_count += 1;
          result.errors.push(mergeResult.error.message || String(mergeResult.error));
        } else if (Number(mergeResult.quality?.raw_report_count || 0) > beforeCount) {
          result.updated_count += 1;
          result.merged_count += 1;
        } else {
          if (!mergeResult.unchanged) result.updated_count += 1;
          result.duplicate_count += 1;
        }
        continue;
      }

      if (result.promoted_count >= limit) {
        result.deferred_count += 1;
        continue;
      }
      const { error } = await insertPromotedEvent(payload, db);
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
