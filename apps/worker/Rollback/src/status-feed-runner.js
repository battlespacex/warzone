// apps/worker/src/status-feed-runner.js

import { fetchAllStatusItems } from "./status-fetcher.js";
import { enrichStatusItem } from "./status-filter.js";

const DEFAULT_STATUS_MINIMUM_SCORE = 24;
const DEFAULT_STATUS_MAX_AGE_DAYS = 180;

function safeTimestamp(value) {
  const parsed = new Date(value || "");
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function filterRecentItems(items = [], maxAgeDays = 60) {
  const threshold = Date.now() - (Math.max(1, Number(maxAgeDays || 60)) * 24 * 60 * 60 * 1000);
  return (Array.isArray(items) ? items : []).filter((item) => {
    const publishedAt = safeTimestamp(item.published_at || item.fetched_at);
    return publishedAt >= threshold;
  });
}

function dedupeStatusItems(items = []) {
  const seen = new Set();

  return (Array.isArray(items) ? items : []).filter((item) => {
    const key = item.guid || item.url || `${item.source_name || "unknown"}::${item.title || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runStatusFeedFetch(options = {}) {
  const fetchResult = await fetchAllStatusItems(options);
  const minimumScore = Number.isFinite(Number(options.minimumScore))
    ? Number(options.minimumScore)
    : Number.parseInt(String(process.env.STATUS_FEED_MINIMUM_SCORE || DEFAULT_STATUS_MINIMUM_SCORE), 10) || DEFAULT_STATUS_MINIMUM_SCORE;
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays))
    ? Number(options.maxAgeDays)
    : Number.parseInt(String(process.env.STATUS_FEED_MAX_AGE_DAYS || DEFAULT_STATUS_MAX_AGE_DAYS), 10) || DEFAULT_STATUS_MAX_AGE_DAYS;

  const recentItems = filterRecentItems(fetchResult.items, maxAgeDays);
  const enrichedItems = recentItems.map((item) => enrichStatusItem(item, { minimumScore }));
  const filteredItems = enrichedItems.filter((item) => item.is_status_relevant);
  const rejectedItems = enrichedItems.filter((item) => !item.is_status_relevant);
  const items = dedupeStatusItems(filteredItems);

  return {
    fetched_at: new Date().toISOString(),
    source_count: fetchResult.source_count,
    failed_source_count: fetchResult.failed_count,
    fetched_item_count: fetchResult.fetched_item_count,
    recent_item_count: recentItems.length,
    filtered_item_count: items.length,
    total_items: items.length,
    fetch: fetchResult,
    rejected_items: dedupeStatusItems(rejectedItems),
    items
  };
}

async function runStatusFeedSync(options = {}) {
  const logger = options.logger || console;
  const startedAt = Date.now();

  try {
    logger.log("[status] sync started");

    const fetchResult = await runStatusFeedFetch(options);

    logger.log(`[status] source count: ${fetchResult.source_count}`);
    logger.log(`[status] fetched item count: ${fetchResult.fetched_item_count}`);
    logger.log(`[status] recent item count: ${fetchResult.recent_item_count}`);
    logger.log(`[status] filtered item count: ${fetchResult.filtered_item_count}`);
    logger.log(`[status] failed source count: ${fetchResult.failed_source_count}`);

    const { markStatusFeedItemsIrrelevant, upsertStatusFeedItems } = await import("./status-supabase-writer.js");
    const cleanupResult = await markStatusFeedItemsIrrelevant(fetchResult.rejected_items);
    const writeResult = await upsertStatusFeedItems(fetchResult.items);

    logger.log(`[status] marked irrelevant count: ${cleanupResult.updated_count || 0}`);
    logger.log(`[status] inserted/updated count: ${writeResult.inserted_count || 0}`);

    if (!cleanupResult.ok) {
      logger.error(`[status] Supabase cleanup failed: ${cleanupResult.error || "unknown error"}`);
    }

    if (!writeResult.ok) {
      logger.error(`[status] Supabase write failed: ${writeResult.error || "unknown error"}`);
    }

    logger.log(`[status] sync finished in ${Date.now() - startedAt}ms`);

    return {
      ok: writeResult.ok,
      fetched_at: fetchResult.fetched_at,
      fetched_item_count: fetchResult.fetched_item_count,
      filtered_item_count: fetchResult.filtered_item_count,
      failed_source_count: fetchResult.failed_source_count,
      marked_irrelevant_count: cleanupResult.updated_count || 0,
      inserted_count: writeResult.inserted_count || 0,
      fetch: fetchResult,
      cleanup: cleanupResult,
      write: writeResult
    };
  } catch (error) {
    logger.error("[status] Status feed sync failed:", error?.stack || error?.message || error);

    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

export {
  runStatusFeedFetch,
  runStatusFeedSync
};
