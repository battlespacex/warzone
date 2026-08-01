// apps/worker/src/conflict-supabase-writer.js

import { supabase } from "./supabase.js";
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

async function upsertConflictFeedItems(items = []) {
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

  let data = null;
  let error = null;

  try {
    const result = await supabase
      .from("conflict_feed_items")
      .upsert(cleanItems, {
        onConflict: "url",
        ignoreDuplicates: false
      })
      .select("id, title, summary, source_name, region, country, category, confidence_score");

    data = result.data;
    error = result.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    console.error("[conflict] Supabase upsert failed:", error.message || error);

    return {
      ok: false,
      inserted_count: 0,
      error: error.message || String(error)
    };
  }

  return {
    ok: true,
    inserted_count: data?.length || 0,
    items: data || []
  };
}

export {
  upsertConflictFeedItems
};
