// apps/worker/src/conflict-rss-fetcher.js

import Parser from "rss-parser";
import { getRssSources } from "./conflict-sources.js";
import { enrichConflictItem } from "./conflict-filter.js";
import { enrichConflictItemsWithArticleMetadata } from "./conflict-media-enricher.js";

const parser = new Parser({
  headers: {
    "User-Agent": "StratOps Conflict Feed Worker/1.0"
  },
  customFields: {
    item: [
      ["content:encoded", "content:encoded"],
      ["dc:creator", "dc:creator"],
      ["media:content", "media:content", { keepArray: true }],
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ["media:group", "media:group", { keepArray: true }],
      ["enclosure", "enclosure", { keepArray: true }],
    ]
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

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
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

function extractTextValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(extractTextValue).filter(Boolean).join(" ").trim();
  }
  if (typeof value === "object") {
    const direct = extractTextValue(value._ || value["#text"] || value.title || value.value || "");
    if (direct) return direct;
    return Object.values(value).map(extractTextValue).filter(Boolean).join(" ").trim();
  }
  return "";
}

function toNonEmptyArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function extractItemCategories(item = {}) {
  const values = [
    ...toNonEmptyArray(item.categories),
    ...toNonEmptyArray(item.category),
    ...toNonEmptyArray(item["dc:subject"])
  ];
  const seen = new Set();
  return values
    .map((entry) => cleanHtml(extractTextValue(entry)))
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractPrimaryMedia(item = {}) {
  const mediaContent = toNonEmptyArray(item["media:content"]);
  const mediaThumbnail = toNonEmptyArray(item["media:thumbnail"]);
  const enclosure = toNonEmptyArray(item.enclosure);
  const mediaGroup = toNonEmptyArray(item["media:group"]);

  const firstContent =
    mediaContent.find((entry) => entry?.url) ||
    mediaGroup.flatMap((group) => toNonEmptyArray(group?.["media:content"] || group?.content)).find((entry) => entry?.url) ||
    enclosure.find((entry) => entry?.url) ||
    null;
  const firstThumb =
    mediaThumbnail.find((entry) => entry?.url) ||
    mediaGroup.flatMap((group) => toNonEmptyArray(group?.["media:thumbnail"] || group?.thumbnail)).find((entry) => entry?.url) ||
    null;

  return {
    image_url: firstThumb?.url || firstContent?.url || null,
    thumbnail_url: firstThumb?.url || firstContent?.url || null,
    media: {
      enclosure,
      media_content: mediaContent,
      media_thumbnail: mediaThumbnail,
      media_group: mediaGroup,
    }
  };
}

function normalizeRssItem(item = {}, source = {}) {
  const summary =
    extractTextValue(item.contentSnippet) ||
    extractTextValue(item.summary) ||
    extractTextValue(item.content) ||
    extractTextValue(item.description) ||
    "";

  const categories = extractItemCategories(item);
  const media = extractPrimaryMedia(item);
  const author = cleanHtml(extractTextValue(item.creator || item.author || item["dc:creator"] || "")) || null;

  return {
    source_id: source.id,
    source_name: source.name,
    source_type: source.type,
    source_category: source.category,
    source_base_url: source.base_url || null,
    allowPublicUrl: true,

    title: cleanHtml(extractTextValue(item.title) || "Untitled"),
    summary: cleanHtml(summary),
    url: item.link || item.guid || null,
    guid: item.guid || item.link || null,
    canonical_url: item.link || item.guid || null,
    author,
    categories,
    image_url: media.image_url,
    thumbnail_url: media.thumbnail_url,

    published_at: item.isoDate || item.pubDate || null,
    fetched_at: new Date().toISOString(),

    raw: {
      ...item,
      author,
      categories,
      image_url: media.image_url,
      thumbnail_url: media.thumbnail_url,
      source_id: source.id,
      source_name: source.name,
      source_type: source.type,
      source_category: source.category,
      source_base_url: source.base_url || null,
      allowPublicUrl: true,
      ...media.media
    }
  };
}

async function fetchSingleRssSource(source) {
  const retryAttempts = Math.max(0, Number(source?.retry_attempts) || 0);
  const retryBackoffMs = Math.max(0, Number(source?.retry_backoff_ms) || 0);
  const minimumScore = Number.isFinite(Number(source?.minimumScore))
    ? Number(source.minimumScore)
    : 30;

  let lastError = null;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      if (attempt === 0) {
        console.log(`Fetching RSS: ${source.name}`);
      } else {
        console.log(`Retrying RSS: ${source.name} (${attempt}/${retryAttempts})`);
      }

      const xml = await fetchRssXml(source.url);
      const feed = await parser.parseString(xml);

      const normalizedItems = (feed.items || [])
        .map(item => normalizeRssItem(item, source))
        .filter(item => item.url);

      const relevantItems = normalizedItems
        .map(item => enrichConflictItem(item, { minimumScore }))
        .filter(item => item.is_conflict_relevant);

      const items = await enrichConflictItemsWithArticleMetadata(relevantItems);

      return {
        source,
        ok: true,
        fetched_count: normalizedItems.length,
        count: items.length,
        items
      };
    } catch (error) {
      lastError = error;
      if (attempt < retryAttempts) {
        await sleep(retryBackoffMs * (attempt + 1));
        continue;
      }
    }
  }

  try {
    console.warn(`RSS failed: ${source.name}`);
    console.warn(lastError?.message || "Unknown RSS error");

    return {
      source,
      ok: false,
      fetched_count: 0,
      count: 0,
      items: [],
      error: lastError?.message || "Unknown RSS error"
    };
  } catch {
    return {
      source,
      ok: false,
      fetched_count: 0,
      count: 0,
      items: [],
      error: "Unknown RSS error"
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
