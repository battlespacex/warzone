import { getLiveHtmlSources } from "./conflict-sources.js";
import { enrichConflictItem } from "./conflict-filter.js";
import { enrichConflictItemsWithArticleMetadata } from "./conflict-media-enricher.js";

const LIVE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.CONFLICT_LIVE_FETCH_TIMEOUT_MS || "", 10) || 15000;
const LIVE_FETCH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONFLICT_LIVE_FETCH_CONCURRENCY || "", 10) || 3);
const LIVE_FETCH_USER_AGENT = "StratOps Conflict Feed Worker/1.0";

function cleanHtml(value = "") {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url = "") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": LIVE_FETCH_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
    }
  });

  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }

  return response.text();
}

async function runWithConcurrency(items = [], concurrency = LIVE_FETCH_CONCURRENCY, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency || 1), list.length || 1));
  const results = new Array(list.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < list.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(list[current], current);
    }
  }));

  return results;
}

function toAbsoluteUrl(url = "", baseUrl = "") {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractLiveTopic(url = "") {
  try {
    const parsed = new URL(String(url || "").trim());
    const topic = parsed.searchParams.get("topic") || "";
    return decodeURIComponent(topic).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

function extractMiddleEastEyeLiveItems(html = "", source = {}) {
  const items = [];
  const seen = new Set();
  const pattern = /<a[^>]+href="([^"]*\/live-blog\/live-blog-update\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const url = toAbsoluteUrl(match[1] || "", source.base_url || source.url || "");
    const title = cleanHtml(match[2] || "");
    if (!url || !title) continue;
    const liveTopic = extractLiveTopic(url);
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      source_id: source.id,
      source_name: source.name,
      source_type: source.type,
      source_category: source.category,
      source_base_url: source.base_url || null,
      title,
      summary: liveTopic ? `Live conflict topic: ${liveTopic}` : "",
      url,
      guid: url,
      canonical_url: url,
      published_at: null,
      fetched_at: new Date().toISOString(),
      raw: {
        source_id: source.id,
        source_name: source.name,
        source_type: source.type,
        source_category: source.category,
        source_base_url: source.base_url || null,
        live_topic: liveTopic || null,
        allowPublicUrl: true,
      }
    });
  }
  return items.slice(0, Math.max(1, Number(source.limit) || 20));
}

function parseLiveHtmlSource(html = "", source = {}) {
  if (source.id === "middle-east-eye-live") {
    return extractMiddleEastEyeLiveItems(html, source);
  }
  return [];
}

async function fetchSingleLiveHtmlSource(source = {}) {
  const retryAttempts = Math.max(0, Number(source.retry_attempts) || 0);
  const retryBackoffMs = Math.max(0, Number(source.retry_backoff_ms) || 0);
  const minimumScore = Number.isFinite(Number(source?.minimumScore))
    ? Number(source.minimumScore)
    : 30;
  let lastError = null;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      const html = await fetchHtml(source.url);
      const parsedItems = parseLiveHtmlSource(html, source);
      const enrichedItems = await enrichConflictItemsWithArticleMetadata(parsedItems);
      const items = enrichedItems
        .map((item) => enrichConflictItem(item, { minimumScore }))
        .filter((item) => item.is_conflict_relevant);

      return {
        source,
        ok: true,
        fetched_count: parsedItems.length,
        count: items.length,
        items,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retryAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryBackoffMs * (attempt + 1)));
        continue;
      }
    }
  }

  console.warn(`Live HTML failed: ${source.name}`);
  console.warn(lastError?.message || "Unknown live HTML error");

  return {
    source,
    ok: false,
    fetched_count: 0,
    count: 0,
    items: [],
    error: lastError?.message || "Unknown live HTML error",
  };
}

async function fetchAllLiveHtmlConflictItems(options = {}) {
  const sources = options.sources || getLiveHtmlSources();
  const results = await runWithConcurrency(
    sources,
    options.concurrency || LIVE_FETCH_CONCURRENCY,
    (source) => fetchSingleLiveHtmlSource(source)
  );
  const items = results.flatMap((result) => result.items || []);

  return {
    fetched_at: new Date().toISOString(),
    source_count: sources.length,
    success_count: results.filter((result) => result.ok).length,
    failed_count: results.filter((result) => !result.ok).length,
    fetched_item_count: results.reduce((total, result) => total + (result.fetched_count || 0), 0),
    filtered_item_count: items.length,
    item_count: items.length,
    results,
    items,
  };
}

export {
  fetchSingleLiveHtmlSource,
  fetchAllLiveHtmlConflictItems,
};
