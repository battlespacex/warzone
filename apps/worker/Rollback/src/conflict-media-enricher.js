import { supabase } from "./supabase.js";

const ARTICLE_FETCH_TIMEOUT_MS = Number.parseInt(process.env.CONFLICT_ARTICLE_FETCH_TIMEOUT_MS || "", 10) || 12000;
const ARTICLE_FETCH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONFLICT_ARTICLE_FETCH_CONCURRENCY || "", 10) || 4);
const ARTICLE_FETCH_USER_AGENT = "StratOps Conflict Feed Worker/1.0";

function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function isPublicHttpUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function normalizeAssetUrl(value = "", baseUrl = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (isPublicHttpUrl(raw)) return raw;
  try {
    if (!baseUrl) return "";
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value = "") {
  return decodeHtml(String(value || ""))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlAttributes(value = "") {
  const attrs = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    attrs[String(match[1] || "").toLowerCase()] = decodeHtml(match[2] || "");
  }
  return attrs;
}

function hasMedia(item = {}) {
  const raw = item?.raw && typeof item.raw === "object" ? item.raw : {};
  const candidates = [
    item.image_url,
    item.thumbnail_url,
    raw.image_url,
    raw.thumbnail_url,
    raw.og_image,
    raw.twitter_image,
    raw.article_image,
    raw.video_url,
    raw.video_thumbnail,
    raw.enclosure,
    raw.media_content,
    raw.media_thumbnail,
    raw["media:content"],
    raw["media:thumbnail"],
  ];
  return candidates.some((entry) => {
    if (!entry) return false;
    if (Array.isArray(entry)) return entry.some((child) => child?.url || child?.src || child?.href || child);
    if (typeof entry === "object") return Boolean(entry.url || entry.src || entry.href || entry.videoUrl);
    return true;
  });
}

async function runWithConcurrency(items = [], concurrency = ARTICLE_FETCH_CONCURRENCY, worker) {
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

async function fetchExistingConflictItemsByUrl(urls = []) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
  if (!uniqueUrls.length) return new Map();

  const out = new Map();
  const batchSize = 150;
  for (let index = 0; index < uniqueUrls.length; index += batchSize) {
    const batch = uniqueUrls.slice(index, index + batchSize);
    const { data, error } = await supabase
      .from("conflict_feed_items")
      .select("url, raw, summary, published_at")
      .in("url", batch);

    if (error) {
      console.warn("[conflict] media cache lookup failed:", error.message || error);
      continue;
    }

    (data || []).forEach((row) => {
      if (row?.url) out.set(row.url, row);
    });
  }

  return out;
}

async function fetchArticleHtml(url = "") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(ARTICLE_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": ARTICLE_FETCH_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
    }
  });

  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }

  return response.text();
}

function extractMetaMap(html = "", baseUrl = "") {
  const meta = {};
  const pattern = /<meta\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const attrs = parseHtmlAttributes(match[1] || "");
    const key = String(attrs.property || attrs.name || "").trim().toLowerCase();
    const content = decodeHtml(attrs.content || "").trim();
    if (!key || !content) continue;
    meta[key] = key.includes("image") || key.includes("video") || key.includes("url")
      ? normalizeAssetUrl(content, baseUrl) || content
      : content;
  }
  return meta;
}

function extractTimeValue(html = "") {
  const timeMatch = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
  return timeMatch ? String(timeMatch[1] || "").trim() : "";
}

function extractInlineMedia(html = "", baseUrl = "") {
  const images = [];
  const videos = [];
  const tagPattern = /<(img|video|source)\b([^>]*)>/gi;
  let match;
  while ((match = tagPattern.exec(html))) {
    const tag = String(match[1] || "").toLowerCase();
    const attrs = parseHtmlAttributes(match[2] || "");
    const src = normalizeAssetUrl(
      attrs.src || attrs["data-src"] || attrs["data-original"] || attrs.poster || "",
      baseUrl
    );
    if (!src) continue;
    if (tag === "img") {
      images.push({
        url: src,
        width: Number(attrs.width) || null,
        height: Number(attrs.height) || null,
        alt: stripHtml(attrs.alt || ""),
      });
      continue;
    }
    videos.push({
      url: src,
      poster: normalizeAssetUrl(attrs.poster || "", baseUrl),
    });
  }
  return { images, videos };
}

function extractLdJsonImages(html = "", baseUrl = "") {
  const images = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const parsed = JSON.parse(String(match[1] || "").trim());
      const stack = [parsed];
      while (stack.length) {
        const current = stack.pop();
        if (!current) continue;
        if (Array.isArray(current)) {
          current.forEach((entry) => stack.push(entry));
          continue;
        }
        if (typeof current !== "object") continue;
        const image = current.image || current.thumbnailUrl || current.thumbnail;
        if (image) {
          toArray(image).forEach((entry) => {
            const url = normalizeAssetUrl(typeof entry === "string" ? entry : entry?.url || entry?.contentUrl || "", baseUrl);
            if (url) images.push({ url });
          });
        }
        Object.values(current).forEach((entry) => stack.push(entry));
      }
    } catch {}
  }
  return images;
}

function buildCachedMediaPatch(item = {}, row = {}) {
  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  return {
    ...item,
    summary: item.summary || row.summary || raw.summary || item.summary,
    published_at: item.published_at || row.published_at || raw.published_at || item.published_at,
    image_url: item.image_url || raw.image_url || raw.thumbnail_url || raw.og_image || raw.twitter_image || raw.article_image || null,
    thumbnail_url: item.thumbnail_url || raw.thumbnail_url || raw.image_url || raw.og_image || raw.twitter_image || raw.article_image || null,
    raw: {
      ...(item.raw && typeof item.raw === "object" ? item.raw : {}),
      ...(raw || {})
    }
  };
}

function buildEnrichedItem(item = {}, html = "") {
  const baseUrl = item.url || item.canonical_url || item.source_base_url || "";
  const meta = extractMetaMap(html, baseUrl);
  const inlineMedia = extractInlineMedia(html, baseUrl);
  const ldImages = extractLdJsonImages(html, baseUrl);
  const summary =
    item.summary ||
    stripHtml(meta.description || meta["og:description"] || meta["twitter:description"] || "");
  const publishedAt =
    item.published_at ||
    meta["article:published_time"] ||
    meta["og:published_time"] ||
    meta["article:modified_time"] ||
    extractTimeValue(html) ||
    null;
  const primaryImage =
    meta["og:image"] ||
    meta["og:image:url"] ||
    meta["twitter:image"] ||
    meta["twitter:image:src"] ||
    inlineMedia.images[0]?.url ||
    ldImages[0]?.url ||
    null;
  const primaryVideo =
    meta["og:video"] ||
    meta["twitter:player"] ||
    inlineMedia.videos[0]?.url ||
    null;
  const videoThumb =
    meta["og:image"] ||
    meta["twitter:image"] ||
    inlineMedia.videos[0]?.poster ||
    inlineMedia.images[0]?.url ||
    null;

  return {
    ...item,
    summary: summary || item.summary,
    published_at: publishedAt || item.published_at,
    image_url: item.image_url || primaryImage,
    thumbnail_url: item.thumbnail_url || primaryImage || videoThumb,
    raw: {
      ...(item.raw && typeof item.raw === "object" ? item.raw : {}),
      summary: summary || item.summary || null,
      published_at: publishedAt || item.published_at || null,
      og_image: primaryImage || null,
      twitter_image: meta["twitter:image"] || meta["twitter:image:src"] || null,
      article_image: inlineMedia.images[0]?.url || ldImages[0]?.url || null,
      video_url: primaryVideo || null,
      video_thumbnail: videoThumb || null,
      media_content: [
        ...toArray((item.raw || {}).media_content),
        ...inlineMedia.videos.filter((entry) => entry.url).map((entry) => ({ url: entry.url })),
      ],
      media_thumbnail: [
        ...toArray((item.raw || {}).media_thumbnail),
        ...[primaryImage, videoThumb, inlineMedia.images[0]?.url].filter(Boolean).map((url) => ({ url })),
      ],
      article_meta: {
        canonical_url: meta["og:url"] || null,
        source_title: meta["og:title"] || null,
        description: meta.description || meta["og:description"] || null,
      }
    }
  };
}

async function enrichConflictItemsWithArticleMetadata(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const existingByUrl = await fetchExistingConflictItemsByUrl(list.map((item) => item.url).filter(Boolean));
  const hydrated = list.map((item) => {
    if (hasMedia(item) && item.summary && item.published_at) return item;
    const cached = item.url ? existingByUrl.get(item.url) : null;
    if (cached && (hasMedia({ raw: cached.raw }) || cached.summary || cached.published_at)) {
      return buildCachedMediaPatch(item, cached);
    }
    return item;
  });

  const toFetch = hydrated
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isPublicHttpUrl(item.url) && item.source_type !== "telegram" && (!hasMedia(item) || !item.summary || !item.published_at));

  if (!toFetch.length) return hydrated;

  const fetched = await runWithConcurrency(toFetch, ARTICLE_FETCH_CONCURRENCY, async ({ item, index }) => {
    try {
      const html = await fetchArticleHtml(item.url);
      return { index, item: buildEnrichedItem(item, html) };
    } catch (error) {
      console.warn("[conflict] article enrich failed:", item.url, error.message || error);
      return { index, item };
    }
  });

  fetched.forEach((result) => {
    if (!result) return;
    hydrated[result.index] = result.item;
  });

  return hydrated;
}

export {
  enrichConflictItemsWithArticleMetadata,
};
