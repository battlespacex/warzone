// apps/worker/src/status-feed-runner.js

import { fetchAllStatusItems } from "./status-fetcher.js";
import { enrichStatusItem } from "./status-filter.js";

const DEFAULT_STATUS_MINIMUM_SCORE = 24;
const DEFAULT_STATUS_MAX_AGE_DAYS = 7;

function safeTimestamp(value) {
  const parsed = new Date(value || "");
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : 0;
}

function filterRecentItems(items = [], maxAgeDays = 60, vulnerabilityMaxAgeDays = maxAgeDays) {
  const now = Date.now();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const days = item.source_id === 'cisa-kev' && item.raw?.status_signal?.kind === 'vulnerability'
      ? vulnerabilityMaxAgeDays : maxAgeDays;
    const threshold = now - Math.max(1, Number(days || 60)) * 86400000;
    const publishedAt = safeTimestamp(item.published_at);
    return publishedAt >= threshold && publishedAt <= now + 300000;
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

export function normalizeStatusFeedItems(input=[],options={}) {
  const minimumScore = Number.isFinite(Number(options.minimumScore))
    ? Number(options.minimumScore)
    : Number.parseInt(String(process.env.STATUS_FEED_MINIMUM_SCORE || DEFAULT_STATUS_MINIMUM_SCORE), 10) || DEFAULT_STATUS_MINIMUM_SCORE;
  const maxAgeDays = Number.isFinite(Number(options.maxAgeDays))
    ? Number(options.maxAgeDays)
    : Number.parseInt(String(process.env.STATUS_FEED_MAX_AGE_DAYS || DEFAULT_STATUS_MAX_AGE_DAYS), 10) || DEFAULT_STATUS_MAX_AGE_DAYS;

  // Preserve the public advisory contract without overriding an operator's
  // explicitly configured retention window for this worker.
  const explicitAge = Number.isFinite(Number(options.maxAgeDays)) || Number(process.env.STATUS_FEED_MAX_AGE_DAYS) > 0;
  const recentItems = filterRecentItems(input, maxAgeDays, explicitAge ? maxAgeDays : 30);
  const enrichedItems = recentItems.map((item) => enrichStatusItem(item, { minimumScore }));
  const filteredItems = enrichedItems.filter((item) => item.is_status_relevant);
  const rejectedItems = enrichedItems.filter((item) => !item.is_status_relevant);
  const items = dedupeStatusItems(filteredItems);
  return {items,rejected_items:dedupeStatusItems(rejectedItems),recent_item_count:recentItems.length};
}

async function runStatusFeedFetch(options = {}) {
  const fetchResult = await fetchAllStatusItems(options);
  const normalized=normalizeStatusFeedItems(fetchResult.items,options);
  const items=normalized.items;

  return {
    fetched_at: new Date().toISOString(),
    source_count: fetchResult.source_count,
    failed_source_count: fetchResult.failed_count,
    fetched_item_count: fetchResult.fetched_item_count,
    recent_item_count: normalized.recent_item_count,
    filtered_item_count: items.length,
    total_items: items.length,
    fetch: fetchResult,
    rejected_items: normalized.rejected_items,
    items
  };
}

// Local API/preview consumers reuse the worker fetcher and normalization policy.
// A single background refresh serves all clients; no Supabase write is performed.
export function createStatusFeedCache({env=process.env,fetchStatus=runStatusFeedFetch,now=Date.now}={}) {
  let pending=null,until=0,rows=[],state='loading',disposed=false;
  const bySource=new Map();
  function refresh(){
    if(disposed||pending||now()<until)return;
    state=rows.length?'stale':'loading';
    pending=fetchStatus({env,onSourceResult(result){
      if(disposed)return;
      if(result.ok)bySource.set(result.source.id,result.items || []);
      rows=normalizeStatusFeedItems([...bySource.values()].flat()).items;
    }}).then(result=>{
      if(disposed)return;rows=result.items;state=result.failed_source_count?'stale':rows.length?'ready':'empty';until=now()+900000;
    }).catch(()=>{state='unavailable';until=now()+60000;}).finally(()=>pending=null);
  }
  return {async list(){refresh();
    if(pending&&!rows.length){let timer;await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,250);})]);clearTimeout(timer);}
    return {items:rows,state,refreshAfterMs:pending?2000:Math.max(1000,until-now())};
  },dispose(){disposed=true;rows=[];bySource.clear();}};
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
