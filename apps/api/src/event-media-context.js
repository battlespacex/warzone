import { buildPublicIntelWireMedia, getPublicSourceLabel } from "./intel-source-sanitizer.js";

function sanitizeText(value = "", maxLength = 240) {
    const clean = String(value ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
    return clean ? clean.slice(0, maxLength) : null;
}

function dedupeByKey(items = [], getKey) {
    const out = [];
    const seen = new Set();
    for (const item of Array.isArray(items) ? items : []) {
        const key = String(getKey(item) || "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function classifyImageType(event = {}, item = {}) {
    if (event?.satellite_context?.status === "available") return "Satellite Observation";
    const sourceType = String(item.source_type || "").toLowerCase();
    const sourceName = String(item.source_name || "").toLowerCase();
    if (sourceType === "telegram" || sourceName.includes("telegram") || sourceName.includes("intel slava")) {
        return "OSINT Image";
    }
    if (
        sourceName.includes("ministry") ||
        sourceName.includes("defence") ||
        sourceName.includes("defense") ||
        sourceName.includes("army") ||
        sourceName.includes("navy") ||
        sourceName.includes("air force")
    ) {
        return "Official Image";
    }
    return "News Image";
}

function buildEventMediaPayload(event = {}, item = {}, mediaBaseUrl = "") {
    const media = buildPublicIntelWireMedia(item, mediaBaseUrl);
    if (!media) return null;

    const images = dedupeByKey(media.images || [], (entry) => entry?.fullUrl || entry?.thumbUrl);
    const videos = dedupeByKey(media.videos || [], (entry) => entry?.videoUrl || entry?.embedUrl || entry?.thumbUrl);
    const sourceMeta = getPublicSourceLabel(item);
    const imageType = classifyImageType(event, item);
    const primaryImage = images[0]
        ? {
            thumb_url: images[0].thumbUrl || null,
            preview_url: images[0].thumbUrl || images[0].fullUrl || null,
            full_url: images[0].fullUrl || null,
            alt: sanitizeText(images[0].alt || event.title || item.title || "", 240),
            width: Number.isFinite(Number(images[0].width)) ? Number(images[0].width) : null,
            height: Number.isFinite(Number(images[0].height)) ? Number(images[0].height) : null,
        }
        : null;
    const additionalImages = images.slice(1).map((entry) => ({
        thumb_url: entry.thumbUrl || null,
        preview_url: entry.thumbUrl || entry.fullUrl || null,
        full_url: entry.fullUrl || null,
        alt: sanitizeText(entry.alt || event.title || item.title || "", 240),
        width: Number.isFinite(Number(entry.width)) ? Number(entry.width) : null,
        height: Number.isFinite(Number(entry.height)) ? Number(entry.height) : null,
    }));

    if (!primaryImage && !additionalImages.length && !videos.length) return null;

    return {
        media: {
            images,
            videos,
        },
        primary_image: primaryImage,
        additional_images: additionalImages,
        image_source: sanitizeText(item.source_name || "", 120) || sourceMeta?.sourceLabel || null,
        image_caption: sanitizeText(event.title || item.title || "", 240),
        image_credit: sourceMeta?.sourceLabel || sanitizeText(item.source_name || "", 120) || null,
        image_type: imageType,
    };
}

async function fetchConflictItemsByUrl(supabase, urls = []) {
    const uniqueUrls = [...new Set((urls || []).filter((value) => /^https?:\/\//i.test(String(value || "").trim())))];
    if (!uniqueUrls.length) return new Map();

    const out = new Map();
    const batchSize = 150;
    for (let index = 0; index < uniqueUrls.length; index += batchSize) {
        const batch = uniqueUrls.slice(index, index + batchSize);
        const { data, error } = await supabase
            .from("conflict_feed_items")
            .select("id, url, source_id, source_name, source_type, source_category, title, summary, published_at, fetched_at, raw")
            .in("url", batch);
        if (error) continue;
        for (const row of data || []) {
            if (!row?.url || out.has(row.url)) continue;
            out.set(row.url, row);
        }
    }

    return out;
}

async function attachEventMediaToEvents(supabase, events = [], options = {}) {
    const source = Array.isArray(events) ? events : [];
    if (!source.length) return source;

    const mediaBaseUrl = options.mediaBaseUrl || "";
    const conflictByUrl = await fetchConflictItemsByUrl(
        supabase,
        source.map((event) => event?.source_url).filter(Boolean)
    );

    return source.map((event) => {
        const conflictItem = event?.source_url ? conflictByUrl.get(event.source_url) : null;
        const mediaPayload = conflictItem
            ? buildEventMediaPayload(event, conflictItem, mediaBaseUrl)
            : null;
        if (!mediaPayload) return event;
        return {
            ...event,
            ...mediaPayload,
        };
    });
}

export {
    attachEventMediaToEvents,
    buildEventMediaPayload,
};
