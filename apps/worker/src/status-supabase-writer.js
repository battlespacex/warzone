// apps/worker/src/status-supabase-writer.js

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

function prepareStatusItemForDb(item = {}) {
  return {
    source_id: item.source_id || null,
    source_name: item.source_name || "Unknown Source",
    source_type: item.source_type || null,
    source_category: item.source_category || null,
    title: item.title || "Untitled",
    summary: item.summary || null,
    url: item.url || null,
    guid: item.guid || null,
    published_at: safeDate(item.published_at),
    fetched_at: safeDate(item.fetched_at) || new Date().toISOString(),
    region: item.region || null,
    country: item.country || null,
    lat: item.lat ?? null,
    lon: item.lon ?? null,
    severity: item.severity || "unknown",
    category: item.category || "general",
    confidence_score: Number(item.confidence_score || 0) || 0,
    is_status_relevant: item.is_status_relevant === true,
    raw: item.raw || item
  };
}

async function runUpsert(cleanItems = [], onConflict = "guid") {
  if (!cleanItems.length) {
    return {
      ok: true,
      inserted_count: 0,
      items: []
    };
  }

  let data = null;
  let error = null;

  try {
    const result = await supabase
      .from("status_feed_items")
      .upsert(cleanItems, {
        onConflict,
        ignoreDuplicates: false
      })
      .select("id, title, source_name, category, severity, confidence_score");

    data = result.data;
    error = result.error;
  } catch (err) {
    error = err;
  }

  if (error) {
    return {
      ok: false,
      inserted_count: 0,
      items: [],
      error: error.message || String(error)
    };
  }

  return {
    ok: true,
    inserted_count: data?.length || 0,
    items: data || []
  };
}

async function upsertStatusFeedItems(items = []) {
  const cleanItems = (Array.isArray(items) ? items : [])
    .filter((item) => item.title && (item.guid || item.url))
    .map(prepareStatusItemForDb);

  if (!cleanItems.length) {
    return {
      ok: true,
      inserted_count: 0,
      skipped: true
    };
  }

  const withGuid = cleanItems.filter((item) => item.guid);
  const withoutGuid = cleanItems.filter((item) => !item.guid && item.url);

  const guidResult = await runUpsert(withGuid, "guid");
  if (!guidResult.ok) {
    console.error("[status] Supabase guid upsert failed:", guidResult.error || "unknown error");
    return guidResult;
  }

  const urlResult = await runUpsert(withoutGuid, "url");
  if (!urlResult.ok) {
    console.error("[status] Supabase url upsert failed:", urlResult.error || "unknown error");
    return {
      ok: false,
      inserted_count: guidResult.inserted_count || 0,
      error: urlResult.error
    };
  }

  return {
    ok: true,
    inserted_count: (guidResult.inserted_count || 0) + (urlResult.inserted_count || 0),
    items: [...(guidResult.items || []), ...(urlResult.items || [])]
  };
}

function uniqueValues(values = []) {
  return Array.from(new Set(
    values
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

async function markStatusFeedItemsIrrelevant(items = []) {
  const candidates = (Array.isArray(items) ? items : [])
    .filter((item) => item && (item.guid || item.url));
  const guids = uniqueValues(candidates.map((item) => item.guid));
  const urls = uniqueValues(candidates.filter((item) => !item.guid).map((item) => item.url));
  let updatedCount = 0;

  async function runUpdate(column, values) {
    if (!values.length) return { ok: true, count: 0 };
    const { data, error } = await supabase
      .from("status_feed_items")
      .update({
        is_status_relevant: false,
        updated_at: new Date().toISOString()
      })
      .in(column, values)
      .select("id");

    if (error) {
      return {
        ok: false,
        count: 0,
        error: error.message || String(error)
      };
    }

    return {
      ok: true,
      count: Array.isArray(data) ? data.length : 0
    };
  }

  const guidResult = await runUpdate("guid", guids);
  if (!guidResult.ok) return guidResult;
  updatedCount += guidResult.count || 0;

  const urlResult = await runUpdate("url", urls);
  if (!urlResult.ok) return urlResult;
  updatedCount += urlResult.count || 0;

  return {
    ok: true,
    updated_count: updatedCount
  };
}

export {
  safeDate,
  markStatusFeedItemsIrrelevant,
  upsertStatusFeedItems
};
