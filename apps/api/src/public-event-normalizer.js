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
    { label: "Lebanon", lat: 33.9, lon: 35.8 }
];

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
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/[\u200E\u200F\u202A-\u202E]/g, " ")
        .replace(/[^\x20-\x7E]/g, " ")
        .replace(/[^A-Za-z0-9\s.,:;!?()\-\/&]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (isUnknownText(clean)) return null;
    return clean.slice(0, maxLength);
}

function getCategoryLabel(category = "") {
    const key = String(category || "").toLowerCase();
    return CATEGORY_LABELS[key] || "Activity";
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
    const coordinatesOk = isValidCoordinate(lat, lon) && !isCoarseCountryCentroid(lat, lon, locationLabel);
    const title = cleanPublicText(event.title, 240) || buildFallbackTitle(event);
    const summary = cleanPublicText(event.summary, 1200);
    const sourceName = cleanSourceName(event.source_name);
    const impactLabel = cleanLocationLabel(event.impact_label);
    const originLabel = cleanLocationLabel(event.origin_label);
    const category = cleanPublicText(event.category, 80) || "military";
    const severity = cleanPublicText(event.severity, 40) || "medium";

    return {
        ...event,
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
        map_eligible: coordinatesOk,
        display_title: title,
        display_summary: summary,
        display_source_name: sourceName,
        display_location_label: locationLabel || impactLabel || originLabel,
        display_category_label: getCategoryLabel(category)
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
