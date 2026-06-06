// apps/worker/src/conflict-feed-runner.js

import { fetchAllRssConflictItems } from "./conflict-rss-fetcher.js";
import { fetchReliefWebConflictItems } from "./conflict-reliefweb-fetcher.js";

function dedupeByUrl(items = []) {
  const seen = new Set();

  return items.filter(item => {
    const key = item.url || item.guid || item.title;

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function runConflictFeedFetch(options = {}) {
  const includeReliefWeb = options.includeReliefWeb ?? false;

  const rssResult = await fetchAllRssConflictItems();

  let reliefWebResult = {
    ok: false,
    count: 0,
    items: [],
    skipped: true,
    error: null
  };

  if (includeReliefWeb) {
    reliefWebResult = await fetchReliefWebConflictItems({
      limit: 50,
      minimumScore: 10
    });
  }

  const items = dedupeByUrl([
    ...rssResult.items,
    ...reliefWebResult.items
  ]);

  const reliefWebFailedCount =
    reliefWebResult.skipped || reliefWebResult.ok ? 0 : 1;

  return {
    fetched_at: new Date().toISOString(),

    rss: {
      source_count: rssResult.source_count,
      success_count: rssResult.success_count,
      failed_count: rssResult.failed_count,
      fetched_item_count: rssResult.fetched_item_count || 0,
      filtered_item_count: rssResult.filtered_item_count || rssResult.item_count,
      item_count: rssResult.item_count
    },

    reliefweb: {
      ok: reliefWebResult.ok,
      skipped: reliefWebResult.skipped || false,
      fetched_item_count: reliefWebResult.fetched_count || 0,
      item_count: reliefWebResult.count || 0,
      error: reliefWebResult.error || null
    },

    source_count: rssResult.source_count + (includeReliefWeb ? 1 : 0),
    failed_source_count: rssResult.failed_count + reliefWebFailedCount,
    fetched_item_count:
      (rssResult.fetched_item_count || 0) + (reliefWebResult.fetched_count || 0),
    filtered_item_count: items.length,
    total_items: items.length,
    items
  };
}

async function runConflictFeedSync(options = {}) {
  const logger = options.logger || console;
  const startedAt = Date.now();

  try {
    logger.log("[conflict] conflict feed sync started");

    const fetchResult = await runConflictFeedFetch(options);

    logger.log(`[conflict] RSS source count: ${fetchResult.rss.source_count}`);
    logger.log(`[conflict] fetched item count: ${fetchResult.fetched_item_count}`);
    logger.log(`[conflict] filtered item count: ${fetchResult.filtered_item_count}`);
    logger.log(`[conflict] failed source count: ${fetchResult.failed_source_count}`);

    const { upsertConflictFeedItems } = await import("./conflict-supabase-writer.js");
    const writeResult = await upsertConflictFeedItems(fetchResult.items);
    const insertedCount = writeResult.inserted_count || 0;

    logger.log(`[conflict] inserted/updated count: ${insertedCount}`);

    if (!writeResult.ok) {
      logger.error(`[conflict] Supabase write failed: ${writeResult.error || "unknown error"}`);
    }

    let promotionResult = {
      ok: true,
      skipped: true,
      promoted_count: 0
    };

    if (options.promoteEvents !== false) {
      const { promoteConflictFeedItemsToEvents } = await import("./conflict-event-promoter.js");
      promotionResult = await promoteConflictFeedItemsToEvents(fetchResult.items, { logger });

      logger.log(`[conflict] promoted event count: ${promotionResult.promoted_count || 0}`);
      logger.log(`[conflict] operational candidate count: ${promotionResult.candidate_count || 0}`);
    }

    logger.log(`[conflict] conflict feed sync finished in ${Date.now() - startedAt}ms`);

    return {
      ok: writeResult.ok && promotionResult.ok !== false,
      fetched_at: fetchResult.fetched_at,
      fetched_item_count: fetchResult.fetched_item_count,
      filtered_item_count: fetchResult.filtered_item_count,
      failed_source_count: fetchResult.failed_source_count,
      inserted_count: insertedCount,
      promoted_event_count: promotionResult.promoted_count || 0,
      fetch: fetchResult,
      write: writeResult,
      promotion: promotionResult
    };
  } catch (error) {
    logger.error("[conflict] Conflict feed sync failed:", error?.stack || error?.message || error);

    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

export {
  runConflictFeedFetch,
  runConflictFeedSync
};
