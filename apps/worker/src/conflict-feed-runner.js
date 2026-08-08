// apps/worker/src/conflict-feed-runner.js

import { fetchAllRssConflictItems } from "./conflict-rss-fetcher.js";
import { fetchAllLiveHtmlConflictItems } from "./conflict-live-fetcher.js";
import { fetchAllTelegramConflictItems } from "./conflict-telegram-fetcher.js";
import { fetchReliefWebConflictItems } from "./conflict-reliefweb-fetcher.js";
import { resolveEventLocation } from "./intelligence-normalizer.js";
import { aggregateEventQuality } from "./event-quality.js";
import { resolveSourceProfile } from "../../shared/source-quality-policy.js";

const DEDUPE_STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "after", "into", "over",
  "under", "amid", "amidst", "near", "new", "says", "say", "report", "reports",
  "reported", "update", "updates", "news", "live", "latest", "analysis", "defense",
  "defence", "military", "official", "global"
]);

const resolvedLocationCache = new WeakMap();

function safeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeUrl(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    parsed.hash = "";
    const blocked = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
    blocked.forEach((key) => parsed.searchParams.delete(key));
    const query = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`.replace(/\/+$/, "");
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function tokenize(value = "") {
  return safeText(value)
    .split(" ")
    .map((token) => ({
      blast: "explosion",
      blasts: "explosion",
      exploded: "explosion",
      explosions: "explosion",
      attacked: "attack",
      attacks: "attack",
      strikes: "strike",
      struck: "strike",
    })[token.trim()] || token.trim())
    .filter((token) => token && token.length >= 3 && !DEDUPE_STOP_WORDS.has(token));
}

function makeTokenSet(value = "") {
  return new Set(tokenize(value));
}

function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function safeTimestamp(value) {
  const parsed = new Date(value || "").getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLocationBucket(item = {}) {
  let location = resolvedLocationCache.get(item);
  if (!location) {
    location = resolveEventLocation(item);
    resolvedLocationCache.set(item, location);
  }
  const country = safeText(location.country || "");
  const place = safeText(location.place || location.city || location.region || "");
  if (place) return `${location.precision || "location"}:${country}:${place}`;
  if (country) return `country:${country}`;
  return "";
}

function getIncidentAction(item = {}) {
  const text = safeText([item.title, item.summary, item.category].filter(Boolean).join(" "));
  if (/\b(?:deny|denies|denied|dispute|disputed|false report)\b/.test(text)) return "denial";
  if (/\b(?:air defense|air defence|intercept|shot down)\b/.test(text)) return "air_defence";
  if (/\b(?:explosion|blast|detonation)\b/.test(text)) return "explosion";
  if (/\b(?:airstrike|air strike|strike|struck|attack|attacked|hit)\b/.test(text)) return "strike";
  if (/\b(?:missile|rocket)\b/.test(text)) return "missile";
  if (/\b(?:drone|uav|shahed)\b/.test(text)) return "drone";
  if (/\b(?:artillery|shelling|bombardment)\b/.test(text)) return "artillery";
  if (/\b(?:cyber|malware|ransomware|network outage)\b/.test(text)) return "cyber";
  return safeText(item.category || "event") || "event";
}

function getEntityTokenSet(item = {}) {
  const text = [
    item.title,
    item.summary,
    item.country,
    item.region,
    item.category,
  ].filter(Boolean).join(" ");
  return new Set(
    tokenize(text).filter((token) =>
      token.length >= 5 ||
      /^(iran|iraq|israel|lebanon|syria|ukraine|russia|taiwan|china|yemen|gaza|faa|mod|navy|airforce|aircraft|missile|drone|notam|cyber)$/.test(token)
    )
  );
}

function getSourceReliability(item = {}) {
  return resolveSourceProfile(item).source_reliability;
}

function comparePrimaryItem(a = {}, b = {}) {
  const reliabilityDiff = getSourceReliability(b) - getSourceReliability(a);
  if (reliabilityDiff !== 0) return reliabilityDiff;
  const confidenceDiff = Number(b.confidence_score || 0) - Number(a.confidence_score || 0);
  if (confidenceDiff !== 0) return confidenceDiff;
  const summaryDiff = String(b.summary || "").length - String(a.summary || "").length;
  if (summaryDiff !== 0) return summaryDiff;
  return safeTimestamp(b.published_at || b.fetched_at) - safeTimestamp(a.published_at || a.fetched_at);
}

function areNearDuplicateItems(a = {}, b = {}) {
  const canonicalUrlA = canonicalizeUrl(a.url || a.guid || "");
  const canonicalUrlB = canonicalizeUrl(b.url || b.guid || "");
  if (canonicalUrlA && canonicalUrlA === canonicalUrlB) return true;

  const titleTokensA = makeTokenSet(a.title || "");
  const titleTokensB = makeTokenSet(b.title || "");
  const titleSimilarity = jaccardSimilarity(titleTokensA, titleTokensB);
  if (titleSimilarity === 0) return false;

  const summaryTokensA = makeTokenSet(a.summary || "");
  const summaryTokensB = makeTokenSet(b.summary || "");
  const summarySimilarity = jaccardSimilarity(summaryTokensA, summaryTokensB);
  const entitySimilarity = jaccardSimilarity(getEntityTokenSet(a), getEntityTokenSet(b));
  const locationA = getLocationBucket(a);
  const locationB = getLocationBucket(b);
  const locationCompatible = !locationA || !locationB || locationA === locationB;
  const actionA = getIncidentAction(a);
  const actionB = getIncidentAction(b);
  const actionCompatible = actionA === actionB || actionA === "denial" || actionB === "denial";
  const timeDeltaMs = Math.abs(safeTimestamp(a.published_at || a.fetched_at) - safeTimestamp(b.published_at || b.fetched_at));
  const within6Hours = timeDeltaMs <= 6 * 60 * 60 * 1000;
  const within12Hours = timeDeltaMs <= 12 * 60 * 60 * 1000;
  const within18Hours = timeDeltaMs <= 18 * 60 * 60 * 1000;

  if (!actionCompatible) return false;
  if (titleSimilarity >= 0.96 && within18Hours && locationCompatible) return true;
  if (titleSimilarity >= 0.84 && summarySimilarity >= 0.56 && within12Hours && locationCompatible) return true;
  if (titleSimilarity >= 0.72 && locationA && locationA === locationB && within6Hours) return true;
  if (titleSimilarity >= 0.72 && entitySimilarity >= 0.68 && within6Hours && locationCompatible) return true;
  return false;
}

function mergeDuplicateGroup(items = []) {
  const ordered = [...items].sort(comparePrimaryItem);
  const quality = aggregateEventQuality(ordered);
  const primary = {
    ...ordered[0],
  };
  const supporting = ordered.slice(1).map((item) => ({
    source_id: item.source_id || null,
    source_name: item.source_name || null,
    source_type: item.source_type || null,
    source_category: item.source_category || null,
    source_family: resolveSourceProfile(item).source_family,
    source_tier: resolveSourceProfile(item).source_tier,
    url: item.url || null,
    published_at: item.published_at || null,
  }));
  const existingRaw = primary.raw && typeof primary.raw === "object" && !Array.isArray(primary.raw)
    ? primary.raw
    : {};
  primary.raw = {
    ...existingRaw,
    _event_quality: quality,
    _dedupe: {
      merged: supporting.length > 0,
      supporting_source_count: supporting.length,
      supporting_sources: supporting,
      raw_report_count: quality.raw_report_count,
      independent_source_family_count: quality.independent_source_family_count,
    },
  };
  const primaryProfile = resolveSourceProfile(primary);
  primary.source_class = primaryProfile.source_class;
  primary.source_tier = primaryProfile.source_tier;
  primary.source_reliability = primaryProfile.source_reliability;
  primary.source_family = primaryProfile.source_family;
  primary.official_status = primaryProfile.official_status;
  primary.corroboration_state = quality.corroboration_state;
  primary.confidence_score = quality.confidence;
  primary.supporting_source_count = supporting.length;
  primary.source_count = quality.raw_report_count;
  primary.raw_report_count = quality.raw_report_count;
  primary.independent_source_family_count = quality.independent_source_family_count;
  return primary;
}

function dedupeConflictItems(items = []) {
  const ordered = [...(Array.isArray(items) ? items : [])].sort(comparePrimaryItem);
  const groups = [];

  for (const item of ordered) {
    const group = groups.find((candidate) => areNearDuplicateItems(candidate[0], item));
    if (group) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group) => mergeDuplicateGroup(group));
}

function summarizeSourceHealth(resultGroups = []) {
  const entries = resultGroups.flatMap((group) => group?.results || []).map((result) => ({
    source_id: result.source?.id || null,
    source_name: result.source?.name || null,
    status: result.health?.status || (result.ok ? "healthy" : "failing"),
    reason: result.health?.reason || result.error || null,
    last_success: result.health?.last_success || null,
    retry_after: result.health?.retry_after || null,
  }));
  const counts = entries.reduce((out, entry) => {
    out[entry.status] = (out[entry.status] || 0) + 1;
    return out;
  }, {});
  return { counts, entries };
}

async function runConflictFeedFetch(options = {}) {
  const includeReliefWeb = options.includeReliefWeb ?? false;

  const rssResult = await fetchAllRssConflictItems();
  const liveHtmlResult = await fetchAllLiveHtmlConflictItems();
  const telegramResult = await fetchAllTelegramConflictItems();

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

  const items = dedupeConflictItems([
    ...rssResult.items,
    ...liveHtmlResult.items,
    ...telegramResult.items,
    ...reliefWebResult.items
  ]);
  const sourceHealth = summarizeSourceHealth([rssResult, liveHtmlResult, telegramResult]);

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

    live_html: {
      source_count: liveHtmlResult.source_count,
      success_count: liveHtmlResult.success_count,
      failed_count: liveHtmlResult.failed_count,
      fetched_item_count: liveHtmlResult.fetched_item_count || 0,
      filtered_item_count: liveHtmlResult.filtered_item_count || liveHtmlResult.item_count,
      item_count: liveHtmlResult.item_count
    },

    telegram: {
      source_count: telegramResult.source_count,
      success_count: telegramResult.success_count,
      failed_count: telegramResult.failed_count,
      fetched_item_count: telegramResult.fetched_item_count || 0,
      filtered_item_count: telegramResult.filtered_item_count || telegramResult.item_count,
      item_count: telegramResult.item_count
    },

    reliefweb: {
      ok: reliefWebResult.ok,
      skipped: reliefWebResult.skipped || false,
      fetched_item_count: reliefWebResult.fetched_count || 0,
      item_count: reliefWebResult.count || 0,
      error: reliefWebResult.error || null
    },

    source_count: rssResult.source_count + liveHtmlResult.source_count + telegramResult.source_count + (includeReliefWeb ? 1 : 0),
    failed_source_count: rssResult.failed_count + liveHtmlResult.failed_count + telegramResult.failed_count + reliefWebFailedCount,
    fetched_item_count:
      (rssResult.fetched_item_count || 0)
      + (liveHtmlResult.fetched_item_count || 0)
      + (telegramResult.fetched_item_count || 0)
      + (reliefWebResult.fetched_count || 0),
    filtered_item_count: items.length,
    total_items: items.length,
    source_health: sourceHealth,
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
    logger.log(`[conflict] Live HTML source count: ${fetchResult.live_html.source_count}`);
    logger.log(`[conflict] Telegram source count: ${fetchResult.telegram.source_count}`);
    logger.log(`[conflict] fetched item count: ${fetchResult.fetched_item_count}`);
    logger.log(`[conflict] filtered item count: ${fetchResult.filtered_item_count}`);
    logger.log(`[conflict] failed source count: ${fetchResult.failed_source_count}`);
    logger.log(`[conflict] source health: ${JSON.stringify(fetchResult.source_health?.counts || {})}`);

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
  areNearDuplicateItems,
  dedupeConflictItems,
  mergeDuplicateGroup,
  summarizeSourceHealth,
  runConflictFeedFetch,
  runConflictFeedSync
};
