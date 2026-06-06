// apps/worker/src/conflict-rss-fetcher.js

import Parser from "rss-parser";
import { getRssSources } from "./conflict-sources.js";
import { enrichConflictItem } from "./conflict-filter.js";

const parser = new Parser({
  headers: {
    "User-Agent": "StratOps Conflict Feed Worker/1.0"
  }
});

const RSS_USER_AGENT = "StratOps Conflict Feed Worker/1.0";
const DEFAULT_RSS_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_RSS_FETCH_CONCURRENCY = 6;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const RSS_FETCH_TIMEOUT_MS = readPositiveInteger(
  process.env.CONFLICT_RSS_FETCH_TIMEOUT_MS,
  DEFAULT_RSS_FETCH_TIMEOUT_MS
);

const RSS_FETCH_CONCURRENCY = Math.max(
  1,
  readPositiveInteger(process.env.CONFLICT_RSS_FETCH_CONCURRENCY, DEFAULT_RSS_FETCH_CONCURRENCY)
);

async function fetchRssXml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(RSS_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": RSS_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }

  return response.text();
}

async function runWithConcurrency(items = [], concurrency = RSS_FETCH_CONCURRENCY, worker) {
  const sourceItems = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency || 1), sourceItems.length || 1));
  const results = new Array(sourceItems.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < sourceItems.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(sourceItems[currentIndex], currentIndex);
    }
  }));

  return results;
}

function cleanHtml(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRssItem(item = {}, source = {}) {
  const summary =
    item.contentSnippet ||
    item.summary ||
    item.content ||
    item.description ||
    "";

  return {
    source_id: source.id,
    source_name: source.name,
    source_type: source.type,
    source_category: source.category,

    title: cleanHtml(item.title || "Untitled"),
    summary: cleanHtml(summary),
    url: item.link || item.guid || null,
    guid: item.guid || item.link || null,

    published_at: item.isoDate || item.pubDate || null,
    fetched_at: new Date().toISOString(),

    raw: item
  };
}

async function fetchSingleRssSource(source) {
  try {
    console.log(`Fetching RSS: ${source.name}`);

    const xml = await fetchRssXml(source.url);
    const feed = await parser.parseString(xml);

    const normalizedItems = (feed.items || [])
      .map(item => normalizeRssItem(item, source))
      .filter(item => item.url);

    const items = normalizedItems
      .map(item => enrichConflictItem(item, { minimumScore: 30 }))
      .filter(item => item.is_conflict_relevant);

    return {
      source,
      ok: true,
      fetched_count: normalizedItems.length,
      count: items.length,
      items
    };
  } catch (error) {
    console.warn(`RSS failed: ${source.name}`);
    console.warn(error.message);

    return {
      source,
      ok: false,
      fetched_count: 0,
      count: 0,
      items: [],
      error: error.message
    };
  }
}

async function fetchAllRssConflictItems(options = {}) {
  const sources = options.sources || getRssSources();

  const results = await runWithConcurrency(
    sources,
    options.concurrency || RSS_FETCH_CONCURRENCY,
    (source) => fetchSingleRssSource(source)
  );

  const items = results.flatMap(result => result.items);

  return {
    fetched_at: new Date().toISOString(),
    source_count: sources.length,
    success_count: results.filter(result => result.ok).length,
    failed_count: results.filter(result => !result.ok).length,
    fetched_item_count: results.reduce((total, result) => total + (result.fetched_count || 0), 0),
    filtered_item_count: items.length,
    item_count: items.length,
    results,
    items
  };
}

export {
  fetchSingleRssSource,
  fetchAllRssConflictItems
};
