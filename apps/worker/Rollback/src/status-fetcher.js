// apps/worker/src/status-fetcher.js

import Parser from "rss-parser";
import { getEnabledStatusSources } from "./status-sources.js";

const STATUS_USER_AGENT = "StratOps Status Worker/1.0";
const DEFAULT_STATUS_FETCH_TIMEOUT_MS = 15000;
const DEFAULT_STATUS_FETCH_CONCURRENCY = 4;

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const STATUS_FETCH_TIMEOUT_MS = readPositiveInteger(
  process.env.STATUS_FETCH_TIMEOUT_MS,
  DEFAULT_STATUS_FETCH_TIMEOUT_MS
);

const STATUS_FETCH_CONCURRENCY = Math.max(
  1,
  readPositiveInteger(process.env.STATUS_FETCH_CONCURRENCY, DEFAULT_STATUS_FETCH_CONCURRENCY)
);

const parser = new Parser({
  headers: {
    "User-Agent": STATUS_USER_AGENT
  }
});

async function runWithConcurrency(items = [], concurrency = STATUS_FETCH_CONCURRENCY, worker) {
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

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(STATUS_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": STATUS_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }

  return response.text();
}

async function fetchJson(url, options = {}) {
  const headers = {
    "User-Agent": STATUS_USER_AGENT,
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    signal: AbortSignal.timeout(STATUS_FETCH_TIMEOUT_MS),
    headers
  });

  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }

  return response.json();
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

function normalizeOoniIncident(item = {}, source = {}) {
  const slug = String(item.slug || "").trim();
  const url = slug ? `https://ooni.org/post/${slug}/` : source.attribution_url || source.url;
  const summary = cleanHtml(item.short_description || item.description || "");
  const country = Array.isArray(item.CCs) && item.CCs.length ? item.CCs[0] : null;

  return {
    source_id: source.id,
    source_name: source.name,
    source_type: source.type,
    source_category: source.category,
    title: cleanHtml(item.title || "Untitled"),
    summary,
    url,
    guid: item.id ? `ooni-incident:${item.id}` : url,
    published_at: item.start_time || item.create_time || item.update_time || null,
    fetched_at: new Date().toISOString(),
    country,
    raw: item
  };
}

async function fetchRssSource(source) {
  const xml = await fetchText(source.url);
  const feed = await parser.parseString(xml);
  const items = (feed.items || [])
    .map((item) => normalizeRssItem(item, source))
    .filter((item) => item.title && (item.url || item.guid));

  return {
    fetched_count: items.length,
    items
  };
}

async function fetchOoniIncidentsSource(source) {
  const payload = await fetchJson(source.url);
  const incidents = Array.isArray(payload?.incidents) ? payload.incidents : [];
  const items = incidents
    .map((incident) => normalizeOoniIncident(incident, source))
    .filter((item) => item.title && (item.url || item.guid));

  return {
    fetched_count: incidents.length,
    items
  };
}

async function fetchStubSource(source) {
  return {
    skipped: true,
    fetched_count: 0,
    items: [],
    note: source.note || "Source kept disabled pending approved public access."
  };
}

async function fetchSingleStatusSource(source) {
  try {
    console.log(`[status] fetching source: ${source.name}`);

    let result = null;
    switch (String(source.adapter || source.type || "").toLowerCase()) {
      case "rss":
        result = await fetchRssSource(source);
        break;
      case "ooni_incidents":
        result = await fetchOoniIncidentsSource(source);
        break;
      case "cloudflare_radar_stub":
      case "ioda_stub":
      case "gpsjam_stub":
      case "aviation_stub":
        result = await fetchStubSource(source);
        break;
      default:
        throw new Error(`Unsupported source adapter: ${source.adapter || source.type}`);
    }

    return {
      source,
      ok: true,
      skipped: result?.skipped || false,
      fetched_count: result?.fetched_count || 0,
      count: (result?.items || []).length,
      items: result?.items || [],
      note: result?.note || null
    };
  } catch (error) {
    console.warn(`[status] source failed: ${source.name}`);
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

async function fetchAllStatusItems(options = {}) {
  const sources = options.sources || getEnabledStatusSources();
  const results = await runWithConcurrency(
    sources,
    options.concurrency || STATUS_FETCH_CONCURRENCY,
    (source) => fetchSingleStatusSource(source)
  );

  const items = results.flatMap((result) => result.items || []);

  return {
    fetched_at: new Date().toISOString(),
    source_count: sources.length,
    success_count: results.filter((result) => result.ok).length,
    failed_count: results.filter((result) => !result.ok).length,
    fetched_item_count: results.reduce((total, result) => total + (result.fetched_count || 0), 0),
    item_count: items.length,
    results,
    items
  };
}

export {
  fetchSingleStatusSource,
  fetchAllStatusItems
};
