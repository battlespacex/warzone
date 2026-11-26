// apps/worker/src/conflict-supabase-writer.js

import { supabase } from "./supabase.js";
import { earliestConflictDate, CONFLICT_RETENTION_MS } from "../../shared/conflict-retention.js";
import { mergeEventQuality } from "./event-quality.js";
import { compactConflictPayload, sameConflictPayload } from "./conflict-storage-change.js";
import {
  normalizeConflictFeedItemForStorage,
  safeDate
} from "./intelligence-normalizer.js";

function prepareConflictItemForDb(item = {}) {
  const normalized = normalizeConflictFeedItemForStorage(item);

  return {
    source_id: normalized.source_id || null,
    source_name: normalized.source_name || null,
    source_type: normalized.source_type || null,
    source_category: normalized.source_category || null,

    title: normalized.title,
    summary: normalized.summary || null,
    url: normalized.url,
    guid: normalized.guid || normalized.url || null,

    published_at: safeDate(normalized.published_at),
    fetched_at: safeDate(normalized.fetched_at) || new Date().toISOString(),

    region: normalized.region || null,
    country: normalized.country || null,

    lat: normalized.lat ?? null,
    lon: normalized.lon ?? null,

    category: normalized.category || "general",
    confidence_score: normalized.confidence_score || 0,
    is_conflict_relevant: normalized.is_conflict_relevant || false,

    raw: normalized.raw || item
  };
}

async function upsertConflictFeedItems(items = [], { db = supabase, now = Date.now() } = {}) {
  const cleanItems = items
    .map(normalizeConflictFeedItemForStorage)
    .filter(item => item.url && item.title)
    .map(prepareConflictItemForDb);

  if (!cleanItems.length) {
    return {
      ok: true,
      inserted_count: 0,
      skipped: true
    };
  }

  const data = [];
  let insertedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let freshnessCount = 0;
  try {
    const uniqueItems = [...new Map(cleanItems.map((item) => [item.url, item])).values()];
    for (let offset = 0; offset < uniqueItems.length; offset += 100) {
      const batch = uniqueItems.slice(offset, offset + 100);
      const previous = await db.from("conflict_feed_items").select("*").in("url", batch.map((item) => item.url));
      if (previous.error) throw previous.error; // Fail closed rather than renewing an unknown original age.
      const existing = new Map((previous.data || []).map((item) => [item.url, item]));
      const preserved = batch.map((item) => {
        const old = existing.get(item.url);
        if (!old) return item;
        const publication = earliestConflictDate(old.published_at, item.published_at);
        // Recovering a date must not silently expose historical undated rows to deletion.
        const historicalRecovery = !old.published_at && publication && Date.parse(publication) <= now - CONFLICT_RETENTION_MS;
        return {
          ...item,
          published_at: historicalRecovery ? null : publication,
          raw: {
            ...old.raw, ...item.raw,
            _original_occurred_at: earliestConflictDate(old.raw?._original_occurred_at, item.raw?._original_occurred_at),
            _event_quality: mergeEventQuality(old, item),
            ...(historicalRecovery ? { _historical_publication_recovery: { published_at: publication, review_required: true } } : {}),
          },
        };
      });
      const changed = [];
      const touches = [];
      for (const row of preserved.map(compactConflictPayload)) {
        const old = existing.get(row.url);
        if (old && sameConflictPayload(old, row)) {
          unchangedCount++;
          data.push(old);
          if (!old.fetched_at || now - Date.parse(old.fetched_at) >= 5 * 60 * 1000) touches.push(row.url);
        } else changed.push(row);
      }
      const result = changed.length ? await db.from("conflict_feed_items")
        .upsert(changed, { onConflict: "url", ignoreDuplicates: false }).select("*") : { data: [] };
      if (result.error) throw result.error;
      for (const item of result.data || []) {
        if (existing.has(item.url)) updatedCount += 1;
        else insertedCount += 1;
      }
      data.push(...(result.data || []));
      if (touches.length) {
        const touch = await db.from("conflict_feed_items").update({ fetched_at: new Date(now).toISOString() }).in("url", touches);
        if (touch.error) throw touch.error;
        freshnessCount += touches.length;
      }
    }
    return {
      ok: true, inserted_count: insertedCount, updated_count: updatedCount,
      duplicate_count: cleanItems.length - uniqueItems.length, items: data,
      unchanged_count: unchangedCount, freshness_count: freshnessCount,
    };
  } catch (err) {
    console.error("[conflict] Supabase upsert failed:", err.message || err);

    return {
      ok: false,
      inserted_count: insertedCount,
      updated_count: updatedCount,
      items: data,
      error: err.message || String(err)
    };
  }
}

export {
  upsertConflictFeedItems
};
