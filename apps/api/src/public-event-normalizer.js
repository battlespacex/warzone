import {
    LOCATION_PRECISION,
    hasTrustedMapCoordinates,
    readEventLocation,
} from "../../shared/event-location-policy.js";
import { getPublicEventQuality } from "./public-event-quality.js";

const UNKNOWN_TEXT_RE =
    /^(unknown|unknown source|unknown location|unknown origin|reported location|untitled|untitled event|n\/a|null|undefined|-)+$/i;

const CATEGORY_LABELS = {
    strike: "Strike",
    military: "Military activity",
    air_activity: "Air activity",
    naval_activity: "Naval activity",
    ground_activity: "Ground activity",
    alert: "Alert",
    airspace: "Airspace notice",
    cyber: "Cyber signal",
    recon: "Recon activity",
    recon_intel: "Recon activity",
    thermal: "Thermal signal",
    signal: "Signal"
};

const COARSE_COUNTRY_CENTROIDS = [
    { label: "Israel", lat: 31.8, lon: 35.0 },
    { label: "Iran", lat: 32.0, lon: 53.0 },
    { label: "Yemen", lat: 15.5, lon: 47.5 },
    { label: "Syria", lat: 35.0, lon: 38.5 },
    { label: "Iraq", lat: 33.2, lon: 43.7 },
    { label: "Ukraine", lat: 49.0, lon: 32.0 },
    { label: "Russia", lat: 55.0, lon: 38.0 },
    { label: "Taiwan", lat: 23.8, lon: 121.0 },
    { label: "Lebanon", lat: 33.9, lon: 35.8 },
    { label: "Middle East", lat: 29.5, lon: 45.0 },
    { label: "Middle East & Gulf", lat: 27.5, lon: 48.0 },
    { label: "Eastern Europe", lat: 49.0, lon: 30.0 },
    { label: "Europe", lat: 52.0, lon: 15.0 },
    { label: "East Asia", lat: 31.0, lon: 121.0 },
    { label: "Asia Pacific", lat: 24.0, lon: 121.0 },
    { label: "South Asia", lat: 28.0, lon: 78.0 },
    { label: "North America", lat: 39.0, lon: -98.0 },
    { label: "Africa", lat: 12.0, lon: 20.0 },
    { label: "Latin America", lat: 12.0, lon: -75.0 }
];

const RAW_TIMESTAMP_RE =
    /^\s*(?:\d{8}T\d{4,6}Z|\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:?\d{2}(?::?\d{2})?(?:\.\d+)?Z?)?)\s*$/i;
const FRAGMENTARY_SIGNAL_RE =
    /^\s*[:;|,\-]*\s*(?:drones?|uavs?|missiles?|rockets?|strikes?|attacks?|explosions?|blasts?|shelling|artillery|airstrikes?|air strikes?)(?:\s*[-:]\s*\d+)?\s*$/i;

function isUnknownText(value = "") {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim();
    return !clean || UNKNOWN_TEXT_RE.test(clean);
}

function decodeBasicHtmlEntities(value = "") {
    return String(value ?? "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function cleanPublicText(value = "", maxLength = 900) {
    const clean = decodeBasicHtmlEntities(value)
        .replace(/<[^>]*>/g, " ")
        .replace(/\b(?:img|image)\s+width\s*=?\s*["']?\d+["']?\s+height\s*=?\s*["']?\d+["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\b(?:attachment|attachment-featured-img|size|featured|wp-post-image|fetchpriority|decoding|async|max-width|sizes|srcset|class|alt|loading|data-[a-z0-9_-]+)\b\s*=?\s*["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\b(?:float|left|right|high|medium|thumbnail|large|full)\s+sizes\s*=?\s*["']?[^.?!|]*?(?=\s+[A-Z][a-z]|\s+Top reports:|$)/gi, " ")
        .replace(/\(\s*max-width\s*:\s*\d+px\s*\)\s*\d+vw\s*,?\s*\d+px/gi, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/[\u200E\u200F\u202A-\u202E]/g, " ")
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/[^A-Za-z0-9\s.,:;!?()\-\/&%'""]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (isUnknownText(clean)) return null;
    return clean.slice(0, maxLength);
}

function getAvailableSatelliteImageEntry(event = {}, fallbackTitle = "") {
    const context = event?.satellite_context || event?.satelliteContext || null;
    if (!context || typeof context !== "object" || Array.isArray(context)) return null;
    if (String(context.status || "").toLowerCase() !== "available") return null;
    const imageUrl = String(context.imageUrl || context.image_url || "").trim();
    if (!/^https?:\/\//i.test(imageUrl)) return null;
    return {
        thumb_url: imageUrl,
        preview_url: imageUrl,
        full_url: imageUrl,
        alt: cleanPublicText(`Copernicus satellite preview for ${fallbackTitle || "event"}`, 240),
        width: Number.isFinite(Number(context.width)) ? Number(context.width) : null,
        height: Number.isFinite(Number(context.height)) ? Number(context.height) : null,
    };
}

function getCategoryLabel(category = "") {
    const key = String(category || "").toLowerCase();
    return CATEGORY_LABELS[key] || "Activity";
}

function isRawTimestampText(value = "") {
    return RAW_TIMESTAMP_RE.test(String(value || "").trim());
}

function isFragmentarySignalText(value = "") {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (!clean) return false;
    if (FRAGMENTARY_SIGNAL_RE.test(clean)) return true;
    const withoutPrefix = clean.replace(/^[\s:;|,\-]+/, "").trim();
    if (withoutPrefix !== clean && withoutPrefix.split(/\s+/).length <= 5) return true;
    return false;
}

function isGdeltSource(event = {}, sourceName = "") {
    const source = [
        sourceName,
        event.source_name,
        event.feed_name,
        Array.isArray(event.tags) ? event.tags.join(" ") : event.tags,
    ].filter(Boolean).join(" ").toLowerCase();
    return source.includes("gdelt");
}

function isLowInformationGdeltSignal(event = {}, title = "", summary = "", sourceName = "") {
    if (!isGdeltSource(event, sourceName)) return false;
    return isFragmentarySignalText(title) && (!summary || isRawTimestampText(summary));
}

function getSignalFallbackLabel(event = {}, title = "") {
    const text = [
        title,
        event.weapon_type,
        event.target_type,
        event.category,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/\b(drone|drones|uav|uavs)\b/.test(text)) return "Drone activity signal";
    if (/\b(missile|missiles|rocket|rockets)\b/.test(text)) return "Missile activity signal";
    if (/\b(airstrike|air strike)\b/.test(text)) return "Airstrike activity signal";
    if (/\b(shelling|artillery)\b/.test(text)) return "Artillery activity signal";
    return `${getCategoryLabel(event.category)} signal`;
}

function cleanPublicEventTitle(event = {}, title = "", summary = "") {
    if (title && !isFragmentarySignalText(title) && !isRawTimestampText(title)) return title;
    if (title && isFragmentarySignalText(title)) {
        if (summary && !isRawTimestampText(summary) && !isFragmentarySignalText(summary)) {
            return summary.replace(/^[\s.:;|\-]+/, "").slice(0, 240);
        }
        return getSignalFallbackLabel(event, title);
    }
    return buildFallbackTitle(event);
}

function cleanPublicEventSummary(summary = "", title = "") {
    if (!summary || isRawTimestampText(summary)) return null;
    const clean = summary.replace(/^\d{8}T\d{4,6}Z\s+/i, "").trim();
    if (!clean) return null;
    const titleKey = clean.toLowerCase();
    const summaryKey = String(title || "").toLowerCase();
    if (titleKey && summaryKey && titleKey === summaryKey) return null;
    return clean;
}

function cleanSourceName(value = "") {
    const clean = cleanPublicText(value, 120);
    if (!clean) return null;
    const lower = clean.toLowerCase();
    if (
        lower.includes("telegram") ||
        lower.includes("t.me") ||
        lower.includes("wartranslated") ||
        lower.includes("combatfootage") ||
        lower.includes("enemy media") ||
        lower.includes("open source intel")
    ) {
        return "OSINT Feed";
    }
    if (lower === "conflict feed" || lower === "rss feed") return "OSINT Feed";
    return clean;
}

function normalizePublicImageEntry(entry = {}) {
    if (!entry || typeof entry !== "object") return null;
    const thumbUrl = String(entry.thumb_url || entry.thumbUrl || "").trim();
    const previewUrl = String(entry.preview_url || entry.previewUrl || "").trim();
    const fullUrl = String(entry.full_url || entry.fullUrl || "").trim();
    const url = [thumbUrl, previewUrl, fullUrl].find((value) => /^https?:\/\//i.test(String(value || ""))) || null;
    if (!url) return null;
    return {
        thumb_url: /^https?:\/\//i.test(String(thumbUrl || "")) ? thumbUrl : null,
        preview_url: /^https?:\/\//i.test(String(previewUrl || "")) ? previewUrl : null,
        full_url: /^https?:\/\//i.test(String(fullUrl || "")) ? fullUrl : null,
        alt: cleanPublicText(entry.alt || "", 240),
        width: Number.isFinite(Number(entry.width)) ? Number(entry.width) : null,
        height: Number.isFinite(Number(entry.height)) ? Number(entry.height) : null,
    };
}

function normalizePublicMedia(value = null) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const images = Array.isArray(value.images)
        ? value.images.map(normalizePublicImageEntry).filter(Boolean)
        : [];
    const videos = Array.isArray(value.videos)
        ? value.videos
            .map((entry) => {
                if (!entry || typeof entry !== "object") return null;
                const videoUrl = String(entry.videoUrl || entry.video_url || "").trim();
                const thumbUrl = String(entry.thumbUrl || entry.thumb_url || "").trim();
                const embedUrl = String(entry.embedUrl || entry.embed_url || "").trim();
                if (!/^https?:\/\//i.test(videoUrl) && !/^https?:\/\//i.test(embedUrl) && !/^https?:\/\//i.test(thumbUrl)) return null;
                return {
                    thumb_url: /^https?:\/\//i.test(thumbUrl) ? thumbUrl : null,
                    video_url: /^https?:\/\//i.test(videoUrl) ? videoUrl : null,
                    embed_url: /^https?:\/\//i.test(embedUrl) ? embedUrl : null,
                    title: cleanPublicText(entry.title || "", 240),
                    duration: cleanPublicText(entry.duration || "", 80),
                    provider_label: cleanPublicText(entry.providerLabel || entry.provider_label || "", 120),
                };
            })
            .filter(Boolean)
        : [];
    if (!images.length && !videos.length) return null;
    return { images, videos };
}

function cleanLocationLabel(value = "") {
    const clean = cleanPublicText(value, 160);
    if (!clean) return null;
    if (/^coordinates$/i.test(clean)) return null;
    return clean;
}

function isValidCoordinate(latValue, lonValue) {
    const lat = Number(latValue);
    const lon = Number(lonValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
    if (Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001) return false;
    return true;
}

function isCoarseCountryCentroid(latValue, lonValue, labelValue = "") {
    const lat = Number(latValue);
    const lon = Number(lonValue);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const label = cleanLocationLabel(labelValue);
    return COARSE_COUNTRY_CENTROIDS.some((entry) => {
        const coordinateMatch =
            Math.abs(lat - entry.lat) < 0.000001 &&
            Math.abs(lon - entry.lon) < 0.000001;
        if (!coordinateMatch) return false;
        return !label || label.toLowerCase() === entry.label.toLowerCase();
    });
}

function buildFallbackTitle(event = {}) {
    const category = getCategoryLabel(event.category);
    const location = cleanLocationLabel(
        event.location_label ||
        event.impact_label ||
        event.origin_label ||
        event.city ||
        event.country ||
        event.region
    );
    return location ? `${category} near ${location}` : `${category} update`;
}

function toPublicEvent(event = {}) {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const locationLabel = cleanLocationLabel(event.location_label);
    const eventLocation = readEventLocation(event);
    const coordinatesOk =
        isValidCoordinate(lat, lon) &&
        !isCoarseCountryCentroid(lat, lon, locationLabel) &&
        hasTrustedMapCoordinates(event, { lat, lon });
    const sourceName = cleanSourceName(event.source_name);
    const rawTitle = cleanPublicText(event.title, 240);
    const rawSummary = cleanPublicText(event.summary, 1200);
    const lowInformationSignal = isLowInformationGdeltSignal(event, rawTitle, rawSummary, sourceName);
    const title = cleanPublicEventTitle(event, rawTitle, rawSummary);
    const summary = lowInformationSignal
        ? null
        : cleanPublicEventSummary(rawSummary, title);
    const impactLabel = cleanLocationLabel(event.impact_label);
    const originLabel = cleanLocationLabel(event.origin_label);
    const category = cleanPublicText(event.category, 80) || "military";
    const severity = cleanPublicText(event.severity, 40) || "medium";
    const media = normalizePublicMedia(event.media);
    const feedPrimaryImage = normalizePublicImageEntry(event.primary_image);
    const satelliteImage = getAvailableSatelliteImageEntry(event, title);
    const primaryImage = satelliteImage || feedPrimaryImage;
    const additionalImages = Array.isArray(event.additional_images)
        ? event.additional_images.map(normalizePublicImageEntry).filter(Boolean)
        : [];
    if (satelliteImage && feedPrimaryImage) {
        const satelliteKey = String(satelliteImage.full_url || satelliteImage.preview_url || "").toLowerCase();
        const feedKey = String(feedPrimaryImage.full_url || feedPrimaryImage.preview_url || "").toLowerCase();
        if (feedKey && feedKey !== satelliteKey) additionalImages.unshift(feedPrimaryImage);
    }
    const satelliteAvailable = String(event?.satellite_context?.status || "").toLowerCase() === "available";

    const eventQuality = getPublicEventQuality(event);
    const publicMetadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
        ? { ...event.metadata, event_quality: { ...eventQuality } }
        : { event_quality: { ...eventQuality } };

    return {
        ...event,
        metadata: publicMetadata,
        title,
        summary,
        category,
        severity: severity.toLowerCase(),
        source_name: sourceName,
        location_label: locationLabel,
        impact_label: impactLabel,
        origin_label: originLabel,
        lat: coordinatesOk ? lat : null,
        lon: coordinatesOk ? lon : null,
        map_eligible: coordinatesOk && !lowInformationSignal,
        ...eventQuality,
        event_country: eventLocation.event_country,
        event_region: eventLocation.event_region,
        event_city: eventLocation.event_city,
        event_place: eventLocation.event_place,
        source_country: eventLocation.source_country,
        source_region: eventLocation.source_region,
        location_precision: eventLocation.precision || (coordinatesOk ? LOCATION_PRECISION.EXACT : LOCATION_PRECISION.UNKNOWN),
        location_confidence: eventLocation.confidence,
        location_method: eventLocation.method,
        display_title: title,
        display_summary: summary,
        display_source_name: sourceName,
        display_location_label: locationLabel || impactLabel || originLabel,
        display_category_label: getCategoryLabel(category),
        media,
        primary_image: primaryImage,
        additional_images: additionalImages,
        image_source: satelliteImage ? "Copernicus" : cleanPublicText(event.image_source, 120),
        image_caption: satelliteImage ? cleanPublicText(title, 240) : cleanPublicText(event.image_caption, 240),
        image_credit: satelliteImage ? "Copernicus" : cleanPublicText(event.image_credit, 120),
        image_type: satelliteImage ? "Satellite Observation" : cleanPublicText(event.image_type, 80),
        satellite_available: satelliteAvailable,
    };
}

export {
    cleanLocationLabel,
    cleanPublicText,
    cleanSourceName,
    isCoarseCountryCentroid,
    isUnknownText,
    isValidCoordinate,
    toPublicEvent
};
