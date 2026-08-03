import { getTelegramSources } from "./conflict-sources.js";
import { enrichConflictItem } from "./conflict-filter.js";

const TELEGRAM_FETCH_TIMEOUT_MS = Number.parseInt(process.env.CONFLICT_TELEGRAM_FETCH_TIMEOUT_MS || "", 10) || 15000;
const TELEGRAM_FETCH_CONCURRENCY = Math.max(1, Number.parseInt(process.env.CONFLICT_TELEGRAM_FETCH_CONCURRENCY || "", 10) || 2);
const TELEGRAM_FETCH_USER_AGENT = "StratOps Conflict Feed Worker/1.0";

function cleanHtml(value = "") {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
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

async function fetchHtml(url = "") {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TELEGRAM_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": TELEGRAM_FETCH_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
    }
  });

  if (!response.ok) {
    throw new Error(`Status code ${response.status}`);
  }

  return response.text();
}

async function runWithConcurrency(items = [], concurrency = TELEGRAM_FETCH_CONCURRENCY, worker) {
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

function extractTelegramPreviewMessages(html = "", source = {}) {
  const items = [];
  const seen = new Set();
  const blockPattern = /<div class="tgme_widget_message_wrap[\s\S]*?data-post="([^"]+)"[\s\S]*?(?=<div class="tgme_widget_message_wrap|$)/gi;
  let match;
  while ((match = blockPattern.exec(html))) {
    const block = match[0] || "";
    const dataPost = String(match[1] || "").trim();
    const [channelKey, messageIdRaw] = dataPost.split("/");
    const messageId = Number.parseInt(messageIdRaw || "", 10);
    if (!channelKey || !Number.isFinite(messageId)) continue;

    const url = `https://t.me/${channelKey}/${messageId}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
    const titleText = cleanHtml(textMatch ? textMatch[1] : "");
    if (!titleText) continue;
    const firstLine = titleText.split("\n").map((line) => line.trim()).find(Boolean) || titleText;
    const datetime = ((block.match(/<time[^>]+datetime="([^"]+)"/i) || [])[1] || "").trim() || null;
    const author = cleanHtml((block.match(/tgme_widget_message_from_author"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "") || null;
    const photoUrl = toAbsoluteUrl(((block.match(/tgme_widget_message_photo_wrap[^>]+background-image:url\('([^']+)'\)/i) || [])[1] || ""), source.base_url || source.url || "");
    const videoUrl = toAbsoluteUrl(((block.match(/<video[^>]+src="([^"]+)"/i) || [])[1] || ""), source.base_url || source.url || "");
    const videoThumb = toAbsoluteUrl(((block.match(/tgme_widget_message_video_thumb[^>]+background-image:url\('([^']+)'\)/i) || [])[1] || ""), source.base_url || source.url || "");
    const imageUrl = photoUrl || videoThumb || null;

    items.push({
      source_id: source.id,
      source_name: source.name,
      source_type: source.type,
      source_category: source.category,
      source_base_url: source.base_url || null,
      title: firstLine.slice(0, 220),
      summary: titleText.slice(0, 2200),
      url,
      guid: url,
      canonical_url: url,
      published_at: datetime,
      fetched_at: new Date().toISOString(),
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      raw: {
        source_id: source.id,
        source_name: source.name,
        source_type: source.type,
        source_category: source.category,
        source_base_url: source.base_url || null,
        allowPublicUrl: true,
        author,
        channel: channelKey,
        message_id: messageId,
        image_url: imageUrl,
        thumbnail_url: imageUrl,
        media_thumbnail: imageUrl ? [{ url: imageUrl }] : [],
        media_content: videoUrl ? [{ url: videoUrl }] : [],
        video_url: videoUrl || null,
        video_thumbnail: videoThumb || null,
      }
    });
  }

  return items
    .sort((left, right) => String(right.published_at || "").localeCompare(String(left.published_at || "")))
    .slice(0, Math.max(1, Number(source.limit) || 20));
}

async function fetchSingleTelegramSource(source = {}) {
  const retryAttempts = Math.max(0, Number(source.retry_attempts) || 0);
  const retryBackoffMs = Math.max(0, Number(source.retry_backoff_ms) || 0);
  const minimumScore = Number.isFinite(Number(source?.minimumScore))
    ? Number(source.minimumScore)
    : 30;
  let lastError = null;

  for (let attempt = 0; attempt <= retryAttempts; attempt += 1) {
    try {
      const html = await fetchHtml(source.url);
      const parsedItems = extractTelegramPreviewMessages(html, source);
      const items = parsedItems
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

  console.warn(`Telegram preview failed: ${source.name}`);
  console.warn(lastError?.message || "Unknown Telegram error");

  return {
    source,
    ok: false,
    fetched_count: 0,
    count: 0,
    items: [],
    error: lastError?.message || "Unknown Telegram error",
  };
}

async function fetchAllTelegramConflictItems(options = {}) {
  const sources = options.sources || getTelegramSources();
  const results = await runWithConcurrency(
    sources,
    options.concurrency || TELEGRAM_FETCH_CONCURRENCY,
    (source) => fetchSingleTelegramSource(source)
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
  fetchSingleTelegramSource,
  fetchAllTelegramConflictItems,
};
