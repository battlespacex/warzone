// apps/worker/src/conflict-supabase-writer.js

import { supabase } from "./supabase.js";

function safeDate(value) {
  if (!value) return null;

  const cleaned = String(value)
    .replace(" - ", " ")
    .replace(/\s+/g, " ")
    .trim();

  const parsed = new Date(cleaned);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function prepareConflictItemForDb(item = {}) {
  return {
    source_id: item.source_id || null,
    source_name: item.source_name || "Unknown Source",
    source_type: item.source_type || null,
    source_category: item.source_category || null,

    title: item.title || "Untitled",
    summary: item.summary || null,
    url: item.url,
    guid: item.guid || item.url || null,

    published_at: safeDate(item.published_at),
    fetched_at: safeDate(item.fetched_at) || new Date().toISOString(),

    region: item.region || null,
    country: item.country || null,

    lat: item.lat ?? null,
    lon: item.lon ?? null,

    category: item.category || "general",
    confidence_score: item.confidence_score || 0,
    is_conflict_relevant: item.is_conflict_relevant || false,

    raw: item.raw || item
  };
}

async function upsertConflictFeedItems(items = []) {
  const cleanItems = items
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
      .select("id, title, source_name, category, confidence_score");

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
