// apps/worker/src/conflict-reliefweb-fetcher.js

import { enrichConflictItem } from "./conflict-filter.js";

const RELIEFWEB_API_URL =
  "https://api.reliefweb.int/v2/reports?appname=battlespacex-stratops-conflict-feed";

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

function normalizeReliefWebItem(row = {}) {
  const fields = row.fields || {};

  const sourceName =
    fields.source?.[0]?.name ||
    "ReliefWeb";

  const country =
    fields.country?.[0]?.name ||
    null;

  return {
    source_id: "reliefweb-reports",
    source_name: sourceName,
    source_type: "api",
    source_category: "humanitarian-conflict",

    title: cleanHtml(fields.title || "Untitled ReliefWeb Report"),
    summary: cleanHtml(fields.body || fields["body-html"] || ""),
    url: fields.url || null,
    guid: row.id ? `reliefweb-${row.id}` : fields.url || null,

    country,
    region: null,

    published_at: fields.date?.created || null,
    fetched_at: new Date().toISOString(),

    raw: row
  };
}

async function fetchReliefWebConflictItems(options = {}) {
  const limit = options.limit || 50;
  const minimumScore = options.minimumScore || 10;

  const body = {
    limit,
    sort: ["date:desc"],
    query: {
      value: [
        "conflict",
        "war",
        "military",
        "airstrike",
        "shelling",
        "missile",
        "drone",
        "troops",
        "border",
        "ceasefire",
        "clashes",
        "armed group"
      ].join(" OR ")
    },
    fields: {
      include: [
        "title",
        "url",
        "date.created",
        "source.name",
        "country.name",
        "body"
      ]
    }
  };

  try {
    console.log("Fetching API: ReliefWeb Reports");

    const response = await fetch(RELIEFWEB_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "StratOps Conflict Feed Worker/1.0"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`ReliefWeb API failed: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();

    const normalizedItems = (json.data || [])
      .map(normalizeReliefWebItem)
      .filter(item => item.url);

    const items = normalizedItems
      .map(item => enrichConflictItem(item, { minimumScore }))
      .filter(item => item.is_conflict_relevant);

    return {
      source: {
        id: "reliefweb-reports",
        name: "ReliefWeb Reports",
        type: "api"
      },
      ok: true,
      fetched_count: normalizedItems.length,
      count: items.length,
      items
    };
  } catch (error) {
    console.warn("ReliefWeb fetch failed");
    console.warn(error.message);

    return {
      source: {
        id: "reliefweb-reports",
        name: "ReliefWeb Reports",
        type: "api"
      },
      ok: false,
      fetched_count: 0,
      count: 0,
      items: [],
      error: error.message
    };
  }
}

export {
  fetchReliefWebConflictItems
};
