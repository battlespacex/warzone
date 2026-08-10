// File Path: /assets/js/warzone-hotspots.js
import * as Cesium from "cesium";
import { isEventVisible } from "./warzone-layers.js";
import {
    getPlatformCategoryClass,
    getPlatformCategoryLabel,
    getPlatformSeverityClass,
    getPlatformSeverityLabel,
} from "./warzone-taxonomy.js";
import {
    buildSpatialEventClusters,
    getClusterDistanceKm,
    scoreToRadius,
} from "./warzone-event-cluster-model.js";
import {
    ZOOM_UX_STATES,
    buildLocalActivityStackModel,
    chooseStackSide,
    getClusterBucketForZoomState,
    getZoomUxState,
    selectActiveClusterGroup,
    selectClusterLocalityLabel,
    selectCollisionSafeLabels,
} from "./warzone-map-zoom-ux.js";
const HOTSPOT_CAMERA_NORMAL = new Cesium.Cartesian3();
const HOTSPOT_POINT_NORMAL = new Cesium.Cartesian3();
// ─── tiny helpers ─────────────────────────────────────────────────────────────
function sanitizeText(v) {
    if (!v) return "";
    let t = String(v);
    for (let index = 0; index < 3; index += 1) {
        const next = t
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&quot;/gi, "\"")
            .replace(/&#39;|&#x27;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">");
        if (next === t) break;
        t = next;
    }
    t = t
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ");
    t = t.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    t = t.replace(/https?:\/\/\S+/gi, " ");
    t = t.replace(/t\.me\/\S+/gi, " ");
    t = t.replace(/@[A-Za-z0-9_]+/g, " ");
    t = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "");
    t = t.replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, " ");
    t = t.replace(/[\u200E\u200F\u202A-\u202E]/g, " ");
    t = t.replace(/[،؛ـ]+/g, " ");
    t = t.replace(/[^\x20-\x7E]/g, " ");
    t = t.replace(/[^A-Za-z0-9\s.,:;!?()\-\/&%'"]/g, " ");
    t = t.replace(/\s+/g, " ").trim();
    return t;
}
function isUnknownDisplayValue(v) {
    const clean = sanitizeText(v).toLowerCase();
    return !clean || /^(unknown|unknown source|unknown location|unknown origin|reported location|untitled|untitled event|n\/a|null|undefined|-)+$/.test(clean);
}
function escapeHtml(value = "") {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function norm(v) {
    return sanitizeText(v);
}
function cssNumber(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function areHotspotCardsEnabled() {
    return cssNumber("--wzhs-cards-enabled", 0) >= 0.5;
}
function cssLengthToPx(name, fallbackPx) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!raw) return fallbackPx;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallbackPx;
    if (raw.endsWith("rem")) {
        const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        return parsed * rootPx;
    }
    if (raw.endsWith("em")) {
        const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        return parsed * rootPx;
    }
    return parsed;
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function getHotspotPerspectiveTilt(viewer) {
    if (viewer?.scene?.mode === Cesium.SceneMode.SCENE2D) return "0deg";
    const pitch = Math.abs(Number(viewer?.camera?.pitch ?? (-Math.PI / 2)));
    const topDownPitch = Math.PI / 2;
    const horizonRatio = clamp01(1 - (pitch / topDownPitch));
    const maxTilt = cssNumber("--wzhs-perspective-max-tilt", 46);
    return `${(horizonRatio * maxTilt).toFixed(2)}deg`;
}
function getProjectedMetersToPixels(scene, lon, lat, meters = 100000) {
    if (!scene || !(meters > 0)) return 0;
    const center = toScreen(scene, lon, lat);
    if (!center) return 0;
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos((lat * Math.PI) / 180) * 111320);
    const eastPoint = toScreen(scene, lon + (meters / lonMeters), lat);
    const northPoint = toScreen(scene, lon, lat + (meters / latMeters));
    const distances = [];
    if (eastPoint) distances.push(Math.hypot(eastPoint.x - center.x, eastPoint.y - center.y));
    if (northPoint) distances.push(Math.hypot(northPoint.x - center.x, northPoint.y - center.y));
    if (!distances.length) return 0;
    return distances.reduce((sum, value) => sum + value, 0) / distances.length;
}
function compactPlaceLabel(v) {
    const clean = sanitizeText(v);
    if (!clean) return "";
    const parts = clean.split(",").map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return "";
    const first = parts[0] || "";
    const last = parts[parts.length - 1] || "";
    if (/[a-z]/i.test(first) && !/\d/.test(first)) return first;
    if (/[a-z]/i.test(last) && !/\d/.test(last)) return last;
    return clean;
}
function timeAgo(d) {
    try {
        const m = Math.floor((Date.now() - new Date(d)) / 60000);
        if (m < 1) return "just now";
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    } catch {
        return "";
    }
}
function truncateText(v, max = 90) {
    const clean = sanitizeText(v);
    if (!clean) return "";
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max).trim()}…`;
}
function isRecentActivity(occurredAt, windowMs = 60 * 60 * 1000) {
    const ts = new Date(occurredAt || 0).getTime();
    return Number.isFinite(ts) && (Date.now() - ts) <= windowMs;
}
function englishRatio(text) {
    const clean = sanitizeText(text);
    if (!clean) return 0;
    const letters = (clean.match(/[A-Za-z]/g) || []).length;
    return letters / Math.max(clean.length, 1);
}
function tokenCount(text) {
    const clean = sanitizeText(text);
    if (!clean) return 0;
    return clean.split(/\s+/).filter(Boolean).length;
}
function genericNoiseScore(text) {
    const clean = sanitizeText(text);
    const t = clean.toLowerCase();
    let score = 0;
    if (!clean) return 100;
    if (clean.length < 14) score += 3;
    if (tokenCount(clean) < 3) score += 3;
    if (englishRatio(clean) < 0.45) score += 3;
    const weakPhrases = [
        "live news",
        "breaking",
        "update",
        "updates",
        "open source intel",
        "osint",
        "telegram",
        "combat footage",
        "wartranslated",
        "enemy media",
        "media",
        "video",
        "photos",
        "photo",
        "footage",
        "source",
        "channel",
        "war military news",
        "war and military news",
        "news",
    ];
    for (const phrase of weakPhrases) {
        if (t === phrase || t.includes(phrase)) score += 2;
    }
    if (!/[a-z]/i.test(clean)) score += 4;
    if (/^(https?:\/\/|t\.me\/|telegram\.me\/)/i.test(clean)) score += 6;
    return score;
}
function containsSignalWords(text) {
    const t = sanitizeText(text).toLowerCase();
    return /(strike|missile|drone|uav|rocket|launch|attack|aircraft|fighter|awacs|helicopter|bomber|alert|siren|explosion|intercept|raid|airspace|recon|military|troops|naval|ship|radar|defense|sam|closure|patrol|surveillance|fire|blast)/.test(t);
}
function looksUsefulText(v) {
    const clean = sanitizeText(v);
    if (!clean) return false;
    if (clean.length < 18) return false;
    if (!/[a-z]/i.test(clean)) return false;
    if (/^(https?:\/\/|t\.me\/|telegram\.me\/)/i.test(clean)) return false;
    const score = genericNoiseScore(clean);
    const useful = containsSignalWords(clean);
    if (score >= 7) return false;
    if (score >= 5 && !useful) return false;
    return true;
}
function cleanSourceName(v) {
    const clean = sanitizeText(v);
    if (isUnknownDisplayValue(clean)) return "";
    const s = clean.toLowerCase();
    if (/reddit/i.test(clean)) return "Community Report";
    if (/twitter|x\.com/i.test(clean)) return "Social Feed";
    if (/facebook|instagram|threads|youtube/i.test(clean)) return "Social Feed";
    if (
        s.includes("telegram") ||
        s.includes("t.me") ||
        s.includes("wartranslated") ||
        s.includes("osint") ||
        s.includes("combatfootage") ||
        s.includes("enemy media") ||
        s.includes("war military news") ||
        s.includes("war and military news") ||
        s.includes("open source intel")
    ) {
        return "OSINT Feed";
    }
    return truncateText(clean, 24);
}
const ICONS = {
    strike: "stratops-ico-assets-strike-1",
    military: "stratops-ico-assets-army-1",
    air_activity: "stratops-ico-assets-air-1",
    naval_activity: "stratops-ico-assets-naval-1",
    ground_activity: "stratops-ico-assets-army-1",
    recon: "stratops-ico-assets-recon-intel-1",
    recon_intel: "stratops-ico-assets-recon-intel-1",
    alert: "stratops-ico-assets-alert-1",
    airspace: "stratops-ico-assets-airspace-1",
    cyber: "stratops-ico-assets-cyber-1",
    thermal: "stratops-ico-assets-signal-thermal-1",
    signal: "stratops-ico-assets-signal-thermal-1",
    unknown_activity: "stratops-ico-assets-unknown-1",
    default: "stratops-ico-assets-unknown-1",
};
function icon(cat) {
    const key = String(cat || "").toLowerCase();
    return ICONS[key] || ICONS.default;
}
function label(input) {
    return getPlatformCategoryLabel(input, {
        surface: "hotspot",
        uppercase: true,
        fallback: "ACTIVITY",
    });
}
function categoryDataValue(input) {
    return getPlatformCategoryClass(input, { surface: "hotspot" }) || "unknown";
}
function sevWeight(s) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[String(s || "").toLowerCase()] || 1;
}
const AIR_ACTIVITY_SUBTYPES = new Set([
    "aircraft",
    "fighter",
    "awacs",
    "recon",
    "isr",
    "tanker",
    "refueler",
    "transport",
    "bomber",
    "vip",
    "helicopter",
    "air_defense",
    "air-defense",
    "sam",
]);
const NAVAL_ACTIVITY_SUBTYPES = new Set([
    "carrier",
    "amphibious",
    "cruiser",
    "destroyer",
    "frigate",
    "corvette",
    "submarine",
    "ssbn",
    "ssn",
    "ssk",
    "aip_submarine",
    "missile_boat",
    "naval",
    "patrol",
    "minesweeper",
]);
const GROUND_ACTIVITY_SUBTYPES = new Set([
    "troops",
    "tank",
    "tanks",
    "armor",
    "armored",
    "armour",
    "armoured",
    "convoy",
    "ground",
    "army",
    "border",
    "deployment",
]);
function inferHotspotCategoryFromText(category, subcategory, signalText) {
    if (
        category === "fire_thermal" ||
        category === "fire" ||
        category === "thermal_anomaly" ||
        /\b(fire|burning|thermal|heat anomaly|hotspot|oil depot fire|wildfire)\b/.test(signalText)
    ) {
        return "thermal";
    }
    if (
        category === "signal_sensor" ||
        category === "sensor" ||
        /\b(seismic|sensor|waveform|radar anomaly|blast sensor|early warning|unconfirmed detection|detected signal)\b/.test(signalText)
    ) {
        return "signal";
    }
    if (
        NAVAL_ACTIVITY_SUBTYPES.has(subcategory) ||
        /\b(carrier|destroyer|frigate|corvette|cruiser|submarine|warship|naval|fleet|vessel|maritime patrol|patrol ship)\b/.test(signalText)
    ) {
        return "naval_activity";
    }
    if (
        AIR_ACTIVITY_SUBTYPES.has(subcategory) ||
        /\b(aircraft|fighter|jet|awacs|recon aircraft|isr|tanker|refueler|bomber|helicopter|air defense|air-defense|sam|intercept|air patrol)\b/.test(signalText)
    ) {
        return "air_activity";
    }
    if (
        GROUND_ACTIVITY_SUBTYPES.has(subcategory) ||
        /\b(troops?|soldiers?|tanks?|armou?red vehicles?|convoys?|army movement|ground buildup|border deployment|land forces?)\b/.test(signalText)
    ) {
        return "ground_activity";
    }
    return "";
}
function hotspotCategory(e = {}) {
    const category = String(e.category || "default").toLowerCase();
    const subcategory = String(e.subcategory || "").toLowerCase();
    const signalText = [
        e.title,
        e.summary,
        e.description,
        e.weapon_type,
        e.target_type,
        e.report_type,
        Array.isArray(e.tags) ? e.tags.join(" ") : e.tags,
    ].filter(Boolean).join(" ").toLowerCase();

    if (category === "strike") return "strike";

    const inferredCategory = inferHotspotCategoryFromText(category, subcategory, signalText);
    if (inferredCategory) return inferredCategory;
    if (category === "default" || category === "activity" || category === "unknown") return "unknown_activity";
    if (category === "recon") {
        if (NAVAL_ACTIVITY_SUBTYPES.has(subcategory) || /\b(carrier|destroyer|frigate|corvette|cruiser|submarine|warship|naval|fleet|vessel)\b/.test(signalText)) {
            return "naval_activity";
        }
        if (AIR_ACTIVITY_SUBTYPES.has(subcategory) || /\b(aircraft|fighter|awacs|recon aircraft|isr|tanker|refueler|bomber|helicopter|air defense|air-defense|sam)\b/.test(signalText)) {
            return "air_activity";
        }
        return "recon_intel";
    }
    if (category === "military") {
        if (NAVAL_ACTIVITY_SUBTYPES.has(subcategory) || /\b(carrier|destroyer|frigate|corvette|cruiser|submarine|warship|naval|fleet|vessel)\b/.test(signalText)) {
            return "naval_activity";
        }
        if (AIR_ACTIVITY_SUBTYPES.has(subcategory) || /\b(aircraft|fighter|awacs|recon aircraft|isr|tanker|refueler|bomber|helicopter|air defense|air-defense|sam)\b/.test(signalText)) {
            return "air_activity";
        }
        return "ground_activity";
    }

    return category;
}
function dominantCat(items) {
    const sc = new Map();
    for (const e of items) {
        const k = hotspotCategory(e);
        sc.set(k, (sc.get(k) || 0) + 1 + sevWeight(e.severity));
    }
    let best = "default";
    let top = -1;
    for (const [k, v] of sc) {
        if (v > top) {
            best = k;
            top = v;
        }
    }
    return best;
}
function dominantSev(items) {
    for (const s of ["critical", "high", "medium", "low"]) {
        if (items.some((e) => String(e.severity || "").toLowerCase() === s)) return s;
    }
    return "medium";
}
function latestEvt(items) {
    return [...items].sort((a, b) =>
        new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0)
    )[0];
}
function buildFallbackHeadline(e = {}) {
    const cat = label(e.category);
    const place = compactPlaceLabel(
        e.display_location_label ||
        e.location_label ||
        e.impact_label ||
        e.origin_label ||
        e.place ||
        ""
    );
    if (String(e.category || "").toLowerCase() === "strike") {
        return place ? `Strike activity detected near ${place}` : "Strike activity detected";
    }
    if (String(e.category || "").toLowerCase() === "military") {
        return place ? `Military activity detected near ${place}` : "Military activity detected";
    }
    if (String(e.category || "").toLowerCase() === "alert") {
        return place ? `Alert activity detected in ${place}` : "Alert activity detected";
    }
    if (String(e.category || "").toLowerCase() === "recon") {
        return place ? `Recon activity detected near ${place}` : "Recon activity detected";
    }
    if (place) return `${cat} near ${place}`;
    return `${cat} detected`;
}
const HOTSPOT_HEADLINE_MAX_CHARS = 220;
function eventHeadline(e = {}) {
    const candidates = [
        e.display_title,
        e.title,
        e.summary,
        e.display_summary,
        e.description,
        e.text,
        e.message,
        e.headline,
    ];
    let best = "";
    let bestScore = -Infinity;
    for (const candidate of candidates) {
        const clean = sanitizeText(candidate);
        if (!clean) continue;
        const useful = looksUsefulText(clean);
        const score = (useful ? 10 : 0)
            + (containsSignalWords(clean) ? 3 : 0)
            - genericNoiseScore(clean)
            + Math.min(tokenCount(clean), 12) * 0.2;
        if (useful && score > bestScore) {
            best = clean;
            bestScore = score;
        }
    }
    if (best) return truncateText(best, HOTSPOT_HEADLINE_MAX_CHARS);
    return buildFallbackHeadline(e);
}
function eventSubline(e = {}) {
    const place = compactPlaceLabel(
        e.display_location_label ||
        e.location_label ||
        e.impact_label ||
        e.origin_label ||
        e.place ||
        ""
    );
    const source = cleanSourceName(e.display_source_name || e.source_name || e.source || "");
    const bits = [place, source].filter(Boolean);
    return bits.join(" • ");
}
function normalizeEventForDisplay(e = {}) {
    return {
        ...e,
        __displayTitle: eventHeadline(e),
        __displaySubline: eventSubline(e),
    };
}
function makeDisplayDuplicateKey(e = {}) {
    const title = sanitizeText(e.__displayTitle || eventHeadline(e)).toLowerCase();
    const source = sanitizeText(e.source_name || e.source || "").toLowerCase();
    const category = sanitizeText(e.category || "").toLowerCase();
    const place = compactPlaceLabel(
        e.display_location_label ||
        e.location_label ||
        e.impact_label ||
        e.origin_label ||
        e.place ||
        ""
    ).toLowerCase();
    return [category, source, place, title].filter(Boolean).join("|");
}
function dedupeDisplayItems(items = []) {
    const ordered = [...items].sort((a, b) =>
        new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0)
    );
    const seen = new Set();
    const out = [];
    for (const item of ordered) {
        const key = makeDisplayDuplicateKey(item);
        if (!key) {
            out.push(item);
            continue;
        }
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}
function buildHotspotEventPopupDetail(event = {}) {
    return {
        entityId: "",
        id: String(event?.id || ""),
        title: String(event?.display_title || event?.title || ""),
        displayTitle: String(event?.display_title || event?.title || ""),
        summary: String(event?.display_summary || event?.summary || ""),
        displaySummary: String(event?.display_summary || event?.summary || ""),
        sourceName: String(event?.display_source_name || event?.source_name || ""),
        category: String(event?.category || ""),
        severity: String(event?.severity || ""),
        clusterCount: 1,
        lat: Number(event?.lat),
        lon: Number(event?.lon),
        locationLabel: String(
            event?.display_location_label
            || event?.location_label
            || event?.impact_label
            || event?.country
            || ""
        ),
        occurredAt: String(event?.occurred_at || ""),
        confidence: event?.confidence ?? null,
        weaponType: String(event?.weapon_type || ""),
        sourceUrl: String(event?.source_url || ""),
        satelliteContext: event?.satellite_context || null,
        satelliteAvailable: event?.satellite_available === true,
        media: event?.media || null,
        primaryImage: event?.primary_image || null,
        additionalImages: Array.isArray(event?.additional_images) ? event.additional_images : [],
        imageSource: String(event?.image_source || ""),
        imageCaption: String(event?.image_caption || ""),
        imageCredit: String(event?.image_credit || ""),
        imageType: String(event?.image_type || ""),
        clusterEvents: [],
        anchorCartesian: null,
        screenPosition: null,
    };
}
function dispatchHotspotEventSelection(event = {}) {
    document.dispatchEvent(new CustomEvent("wz:event-marker-selected", {
        detail: buildHotspotEventPopupDetail(event),
    }));
}
function dispatchHotspotClusterSelection(cluster = {}, screenPosition = null) {
    const items = dedupeDisplayItems(cluster?.items || []);
    const primary = items[0] || {};
    const detail = buildHotspotEventPopupDetail(primary);
    const count = Math.max(1, Number(cluster?.actual_event_count || cluster?.event_count || cluster?.count || items.length || 1));
    detail.clusterCount = count;
    detail.clusterEvents = items;
    detail.lat = Number(cluster?.lat);
    detail.lon = Number(cluster?.lon);
    detail.locationLabel = String(
        cluster?.location_label
        || cluster?.label
        || detail.locationLabel
        || ""
    );
    detail.screenPosition = screenPosition;
    document.dispatchEvent(new CustomEvent("wz:event-marker-selected", { detail }));
}
function makeHotspotEventSignature(events = []) {
    const arr = Array.isArray(events) ? events : [];
    if (!arr.length) return "0";
    let hash = 2166136261 >>> 0;
    for (const event of arr) {
        const idLen = String(event?.id || "").length;
        const ts = Date.parse(event?.occurred_at || event?.updated_at || "") || 0;
        const lat = Number(event?.lat);
        const lon = Number(event?.lon);
        const latKey = Number.isFinite(lat) ? Math.round(lat * 1000) : 0;
        const lonKey = Number.isFinite(lon) ? Math.round(lon * 1000) : 0;
        const qualityKey = [
            event?.category,
            event?.severity,
            event?.confidence,
            event?.corroboration_state,
            event?.independent_source_family_count,
            event?.location_precision,
            event?.map_eligible,
        ].join("|");
        hash ^= idLen;
        hash = Math.imul(hash, 16777619);
        hash ^= ts;
        hash = Math.imul(hash, 16777619);
        hash ^= latKey;
        hash = Math.imul(hash, 16777619);
        hash ^= lonKey;
        hash = Math.imul(hash, 16777619);
        for (let index = 0; index < qualityKey.length; index += 1) {
            hash ^= qualityKey.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
    }
    const first = arr[0];
    const last = arr[arr.length - 1];
    return `${arr.length}:${String(first?.id || "")}:${String(last?.id || "")}:${(hash >>> 0).toString(16)}`;
}
// ─── hemisphere cull + Cesium projection ──────────────────────────────────────
function projectWorldPosition(scene, cart) {
    try {
        if (!scene || !cart) return null;
        if (scene.mode !== Cesium.SceneMode.SCENE2D) {
            const camNorm = Cesium.Cartesian3.normalize(scene.camera.position, HOTSPOT_CAMERA_NORMAL);
            const ptNorm = Cesium.Cartesian3.normalize(cart, HOTSPOT_POINT_NORMAL);
            const cameraMagnitude = Cesium.Cartesian3.magnitude(scene.camera.position);
            const ellipsoidRadius = Number(scene.globe?.ellipsoid?.minimumRadius || Cesium.Ellipsoid.WGS84.minimumRadius || 6378137);
            const horizonDot = Number.isFinite(cameraMagnitude) && cameraMagnitude > ellipsoidRadius
                ? ellipsoidRadius / cameraMagnitude
                : 0.92;
            const frontSideThreshold = clamp01(horizonDot - 0.04);
            if (Cesium.Cartesian3.dot(camNorm, ptNorm) < frontSideThreshold) return null;
        }
        const fn = Cesium.SceneTransforms.worldToWindowCoordinates
            || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
        if (!fn) return null;
        const p = fn(scene, cart);
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        return { x: p.x, y: p.y };
    } catch {
        return null;
    }
}
function toScreen(scene, lon, lat) {
    try {
        return projectWorldPosition(scene, Cesium.Cartesian3.fromDegrees(lon, lat, 0));
    } catch {
        return null;
    }
}
function createHotspotWorldAnchor(lon, lat) {
    const longitude = Number(lon);
    const latitude = Number(lat);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    const metersSample = Math.max(1200, cssNumber("--wzhs-surface-sample-meters", 24000));
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos((latitude * Math.PI) / 180) * 111320);
    return {
        longitude,
        latitude,
        center: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
        east: Cesium.Cartesian3.fromDegrees(longitude + (metersSample / lonMeters), latitude, 0),
        north: Cesium.Cartesian3.fromDegrees(longitude, latitude + (metersSample / latMeters), 0),
    };
}
function projectHotspotWorldAnchor(scene, anchor) {
    const center = projectWorldPosition(scene, anchor?.center);
    if (!center) return null;
    if (scene?.mode === Cesium.SceneMode.SCENE2D) return { ...center, matrix: "" };
    const east = projectWorldPosition(scene, anchor?.east);
    const north = projectWorldPosition(scene, anchor?.north);
    if (!east || !north) return { ...center, matrix: "" };
    const ex = { x: east.x - center.x, y: east.y - center.y };
    const ny = { x: north.x - center.x, y: north.y - center.y };
    const avg = (Math.hypot(ex.x, ex.y) + Math.hypot(ny.x, ny.y)) * 0.5;
    if (!(avg > 0.0001)) return { ...center, matrix: "" };
    return {
        ...center,
        matrix: `matrix(${(ex.x / avg).toFixed(5)}, ${(ex.y / avg).toFixed(5)}, ${(ny.x / avg).toFixed(5)}, ${(ny.y / avg).toFixed(5)}, 0, 0)`,
    };
}
function getCameraHeight(viewer) {
    try {
        return Number(viewer?.camera?.positionCartographic?.height || 0);
    } catch {
        return 0;
    }
}
function getZoomAwareHotspotConfig(viewer, cfg) {
    const height = getCameraHeight(viewer);
    if (height > 12000000) {
        return {
            key: "world",
            radiusScale: cssNumber("--wzhs-radius-zoom-scale-world", 0.58),
            clusterDistanceLat: Math.max(cfg.clusterDistanceLat, 3.4),
            clusterDistanceLon: Math.max(cfg.clusterDistanceLon, 4.2),
            maxCards: 28,
            maxVisiblePerHotspot: 2,
            stackDistancePx: Math.max(cfg.stackDistancePx, 120),
            edgePad: 260,
        };
    }
    if (height > 7000000) {
        return {
            key: "theater",
            radiusScale: cssNumber("--wzhs-radius-zoom-scale-theater", 0.76),
            clusterDistanceLat: Math.max(cfg.clusterDistanceLat, 2.2),
            clusterDistanceLon: Math.max(cfg.clusterDistanceLon, 2.8),
            maxCards: 42,
            maxVisiblePerHotspot: 3,
            stackDistancePx: Math.max(cfg.stackDistancePx, 106),
            edgePad: 230,
        };
    }
    if (height > 3500000) {
        return {
            key: "regional",
            radiusScale: cssNumber("--wzhs-radius-zoom-scale-regional", 1),
            clusterDistanceLat: Math.min(cfg.clusterDistanceLat, 1.25),
            clusterDistanceLon: Math.min(cfg.clusterDistanceLon, 1.5),
            maxCards: Math.max(cfg.maxCards, 64),
            maxVisiblePerHotspot: Math.max(cfg.maxVisiblePerHotspot, 5),
            stackDistancePx: Math.max(cfg.stackDistancePx, 90),
            edgePad: 190,
        };
    }
    if (height > 1600000) {
        return {
            key: "local",
            radiusScale: cssNumber("--wzhs-radius-zoom-scale-local", 1.28),
            clusterDistanceLat: Math.min(cfg.clusterDistanceLat, 0.72),
            clusterDistanceLon: Math.min(cfg.clusterDistanceLon, 0.9),
            maxCards: Math.max(cfg.maxCards, 88),
            maxVisiblePerHotspot: Math.max(cfg.maxVisiblePerHotspot, 6),
            stackDistancePx: Math.max(cfg.stackDistancePx, 78),
            edgePad: 160,
        };
    }
    return {
        key: "street",
        radiusScale: cssNumber("--wzhs-radius-zoom-scale-street", 1.55),
        clusterDistanceLat: Math.min(cfg.clusterDistanceLat, 0.34),
        clusterDistanceLon: Math.min(cfg.clusterDistanceLon, 0.42),
        maxCards: Math.max(cfg.maxCards, 128),
        maxVisiblePerHotspot: Math.max(cfg.maxVisiblePerHotspot, 8),
        stackDistancePx: Math.max(cfg.stackDistancePx, 68),
        edgePad: 140,
    };
}
// ─── geo clustering ────────────────────────────────────────────────────────────
function geoCluster(events, zoomBucket, minCount, maxCards) {
    const key = String(zoomBucket || "regional").toLowerCase();
    const fallbackDistance = getClusterDistanceKm(key);
    const distanceKm = Math.max(0, cssNumber(`--hotspot-cluster-distance-${key}-km`, fallbackDistance));
    return buildSpatialEventClusters(events, {
        zoomBucket: key,
        distanceKm,
        dominanceThreshold: cssNumber("--hotspot-dominance-threshold", 0.48),
        dominanceMargin: cssNumber("--hotspot-dominance-margin", 0.12),
        pulseCap: cssNumber("--hotspot-pulse-cap", 12),
    })
        .filter((cluster) => cluster.event_count >= minCount)
        .slice(0, maxCards)
        .map((cluster) => {
            const cat = String(cluster.dominant_domain || "MIXED").toLowerCase();
            return {
                ...cluster,
                id: cluster.cluster_id,
                count: cluster.event_count,
                cat,
                sev: cluster.severity,
                icon: icon(cat),
                label: cat.replace(/_/g, " ").toUpperCase(),
                latest: cluster,
                items: cluster._clusterEvents,
            };
        });
}
function getHotspotZoomState(viewer) {
    return getZoomUxState(getCameraHeight(viewer), {
        regionalMinHeight: cssNumber("--hotspot-zoom-regional-min-height", 5200000),
        localStackMinHeight: cssNumber("--hotspot-zoom-local-stack-min-height", 2600000),
        localityMinHeight: cssNumber("--hotspot-zoom-locality-min-height", 620000),
    });
}
// ─── screen stacking ──────────────────────────────────────────────────────────
const STACK_OFF = [
    { x: 0, y: 0 },
    { x: -18, y: -14 },
    { x: 18, y: 14 },
];
const HOTSPOT_LABEL_OFFSET = { x: 86, y: -52 };
const HOTSPOT_RADIUS_OFFSET = { x: 0, y: 0 };
function createHotspotRadiusEl(cluster) {
    const el = document.createElement("div");
    applyHotspotRadiusModel(el, cluster);
    el.innerHTML = `<div class="wzhs-radius__ring" aria-hidden="true"></div>`;
    el.setAttribute("aria-hidden", "true");
    return el;
}
function applyHotspotRadiusModel(el, cluster) {
    if (!el) return;
    const domain = String(cluster?.cat || cluster?.dominant_domain || "mixed").toLowerCase();
    const severity = getPlatformSeverityClass(cluster?.sev || cluster?.severity || "medium");
    el.className = [
        "wzhs-radius",
        `wzhs-radius--${domain}`,
        `wzhs-radius--sev-${severity}`,
        cluster?.pulse_eligible ? `wzhs-radius--pulse-${cluster.pulse_mode || "subtle"}` : "",
    ].filter(Boolean).join(" ");
    el.dataset.category = domain;
    el.dataset.severity = severity;
    const colorKey = domain === "air_defence" ? "airdefence" : domain;
    el.style.setProperty("--wzhs-radius-color", `var(--activity-${colorKey})`);
    el.style.setProperty("--wzhs-radius-severity-color", `var(--hotspot-severity-${severity}-color)`);
    el.style.setProperty("--wzhs-radius-severity-width", `var(--hotspot-severity-${severity}-width)`);
}
function removeHotspotNode(node) {
    if (!node) return;
    node.el?.classList.add("wzhs--leaving");
    node.radiusEl?.classList.add("wzhs-radius--leaving");
    node.uxLabelEl?.classList.add("wzhs-cluster-label--leaving");
    const el = node.el;
    const radiusEl = node.radiusEl;
    const uxLabelEl = node.uxLabelEl;
    window.setTimeout(() => {
        el?.remove?.();
        radiusEl?.remove?.();
        uxLabelEl?.remove?.();
    }, 280);
}
function markHotspotNodeEntered(node) {
    if (!node) return;
    node.el?.classList.add("wzhs--entering");
    node.radiusEl?.classList.add("wzhs-radius--entering");
    node.uxLabelEl?.classList.add("wzhs-cluster-label--entering");
    requestAnimationFrame(() => {
        node.el?.classList.remove("wzhs--entering");
        node.radiusEl?.classList.remove("wzhs-radius--entering");
        node.uxLabelEl?.classList.remove("wzhs-cluster-label--entering");
    });
}
function isHotspotRadiusSplitHidden(viewer, zoomCfg, cluster) {
    const count = Math.max(1, Number(cluster?.count || cluster?.items?.length || 1));
    if (count < 2) return false;
    const eventBucket = viewer?.__warzone?.getEventClusterBucket?.();
    const bucket = String(eventBucket || zoomCfg?.key || "").toLowerCase();
    return bucket === "street";
}
function syncHotspotRadiusSplitState(radiusEl, hidden) {
    if (!radiusEl) return;
    radiusEl.classList.toggle("wzhs-radius--split-hidden", !!hidden);
}
function getHotspotRadiusDiameterPx(viewer, cluster, zoomCfg) {
    const zoomScale = Math.max(0.15, Number(zoomCfg?.radiusScale || 1));
    const minDiameter = Math.max(16, cssNumber("--hotspot-overlay-size-min", 58));
    const maxDiameter = Math.max(minDiameter, cssNumber("--hotspot-overlay-size-max", 168));
    return scoreToRadius(cluster?.weighted_activity_score || cluster?._activityScore || 0, {
        min: minDiameter,
        max: maxDiameter,
        scoreAtMax: cssNumber("--hotspot-score-at-max", 80),
    }) * zoomScale;
}
function createClusterUxLabelEl() {
    const el = document.createElement("div");
    el.className = "wzhs-cluster-label";
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    const selectCluster = (event) => {
        const cluster = el.__wzCluster;
        if (!cluster) return;
        event.preventDefault();
        event.stopPropagation();
        const screenPosition = Number.isFinite(Number(event.clientX)) && Number.isFinite(Number(event.clientY))
            ? { x: Number(event.clientX), y: Number(event.clientY), space: "viewport" }
            : null;
        dispatchHotspotClusterSelection(cluster, screenPosition);
    };
    el.addEventListener("click", selectCluster);
    el.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") selectCluster(event);
    });
    return el;
}
function renderClusterUxLabel(el, cluster, zoomState, number = "") {
    if (!el) return;
    const count = Math.max(1, Number(cluster?.actual_event_count || cluster?.event_count || cluster?.count || 1));
    el.__wzCluster = cluster;
    el.setAttribute("aria-label", `Open ${count} ${count === 1 ? "event" : "events"}`);
    if (zoomState === ZOOM_UX_STATES.LOCAL_STACK) {
        const signature = `${zoomState}:${number || count}`;
        if (el.__wzLabelSignature === signature) return;
        el.__wzLabelSignature = signature;
        el.className = `wzhs-cluster-label wzhs-cluster-label--number${number ? "" : " wzhs-cluster-label--unlisted"}`;
        el.innerHTML = `<strong>${escapeHtml(number || count)}</strong>`;
        return;
    }
    if (zoomState === ZOOM_UX_STATES.LOCALITY) {
        const locality = sanitizeText(selectClusterLocalityLabel(cluster));
        const signature = `${zoomState}:${locality}:${count}`;
        if (el.__wzLabelSignature === signature) return;
        el.__wzLabelSignature = signature;
        el.className = "wzhs-cluster-label wzhs-cluster-label--locality";
        el.innerHTML = `<strong>${escapeHtml(locality)}</strong><span>${escapeHtml(count)} ${count === 1 ? "EVENT" : "EVENTS"}</span>`;
        return;
    }
    const signature = `${zoomState}:${count}`;
    if (el.__wzLabelSignature === signature) return;
    el.__wzLabelSignature = signature;
    el.className = "wzhs-cluster-label wzhs-cluster-label--regional";
    el.innerHTML = `<strong>${escapeHtml(count)}</strong>`;
}
function createActivityStackElements(rootEl) {
    const lineEl = document.createElement("div");
    lineEl.className = "wzhs-stack-line";
    lineEl.hidden = true;
    rootEl.appendChild(lineEl);
    const stackEl = document.createElement("aside");
    stackEl.className = "wzhs-activity-stack";
    stackEl.setAttribute("aria-label", "Local activity summary");
    stackEl.hidden = true;
    rootEl.appendChild(stackEl);
    return { stackEl, lineEl, signature: "", height: 0, side: "", groupIds: [] };
}
function hideActivityStack(stackNode) {
    if (!stackNode) return;
    stackNode.stackEl.hidden = true;
    stackNode.lineEl.hidden = true;
    stackNode.signature = "";
}
export function computeActivityStackLeaderGeometry(anchor, panel, minLineLength = 24) {
    if (!anchor || !panel) return { hidden: true };
    const anchorX = Number(anchor.x);
    const anchorY = Number(anchor.y);
    const left = Number(panel.left);
    const top = Number(panel.top);
    const width = Number(panel.width);
    const height = Number(panel.height);
    if (![anchorX, anchorY, left, top, width, height].every(Number.isFinite)) return { hidden: true };
    const targetX = panel.side === "left" ? left + width : left;
    const targetY = Math.max(top + 20, Math.min(top + height - 20, anchorY));
    const distance = Math.hypot(targetX - anchorX, targetY - anchorY);
    if (distance <= minLineLength) return { hidden: true };
    return {
        hidden: false,
        left: anchorX,
        top: anchorY,
        width: distance,
        rotation: Math.atan2(targetY - anchorY, targetX - anchorX),
    };
}
function updateActivityStackLeader(stackNode, anchor) {
    if (!stackNode?.lineEl || stackNode.stackEl?.hidden) return;
    const geometry = computeActivityStackLeaderGeometry(
        anchor,
        stackNode.panel,
        cssLengthToPx("--hotspot-stack-line-min-length", 24)
    );
    stackNode.lineEl.hidden = geometry.hidden;
    if (geometry.hidden) return;
    stackNode.lineEl.style.left = `${geometry.left}px`;
    stackNode.lineEl.style.top = `${geometry.top}px`;
    stackNode.lineEl.style.width = `${geometry.width}px`;
    stackNode.lineEl.style.transform = `rotate(${geometry.rotation}rad)`;
}
function renderActivityStack(stackNode, model, group, viewport) {
    if (!stackNode || !model || !group?.bounds || !model.entries?.length) {
        hideActivityStack(stackNode);
        return;
    }
    const signature = JSON.stringify({
        area: model.area_label,
        total: model.total_event_count,
        latest: model.latest_event_time,
        verified: model.verified_count,
        trend: model.trend?.state || "",
        entries: model.entries,
    });
    const stackEl = stackNode.stackEl;
    if (signature !== stackNode.signature) {
        const trendArrow = model.trend?.state === "INCREASING" ? "↑" : model.trend?.state === "DECREASING" ? "↓" : "→";
        stackEl.innerHTML = `
            <header class="wzhs-activity-stack__header">
                <span>${escapeHtml(sanitizeText(model.area_label))}</span>
                <strong>${escapeHtml(model.total_event_count)} ACTIVE ${model.total_event_count === 1 ? "EVENT" : "EVENTS"}</strong>
            </header>
            <div class="wzhs-activity-stack__entries">
                ${model.entries.map((entry) => `
                    <div class="wzhs-activity-stack__entry" data-severity="${escapeHtml(entry.severity)}">
                        <span class="wzhs-activity-stack__number">${escapeHtml(entry.number)}</span>
                        <div class="wzhs-activity-stack__entry-copy">
                            <strong>${escapeHtml(sanitizeText(entry.locality))}</strong>
                            <span>${escapeHtml(entry.event_count)} ${entry.event_count === 1 ? "EVENT" : "EVENTS"}${entry.domains.length ? ` · ${escapeHtml(entry.domains.join(" / "))}` : ""}</span>
                            ${entry.latest_event_time ? `<small>Latest ${escapeHtml(timeAgo(entry.latest_event_time))}</small>` : ""}
                        </div>
                    </div>`).join("")}
            </div>
            <footer class="wzhs-activity-stack__footer">
                ${model.trend ? `<span>TREND <strong>${escapeHtml(model.trend.state)} ${trendArrow}</strong></span>` : ""}
                <span><strong>${escapeHtml(model.verified_count)} / ${escapeHtml(model.total_event_count)}</strong> ${escapeHtml(model.verification_label)}</span>
            </footer>`;
        stackNode.signature = signature;
        stackNode.height = 0;
    }
    stackEl.hidden = false;
    const panelWidth = Math.min(
        viewport.width - 24,
        viewport.width <= 720
            ? cssLengthToPx("--hotspot-stack-width-small", 270)
            : cssLengthToPx("--hotspot-stack-width", 320)
    );
    if (stackNode.viewportWidth !== viewport.width) {
        stackNode.viewportWidth = viewport.width;
        stackNode.height = 0;
    }
    const offset = cssLengthToPx("--hotspot-stack-offset", 34);
    const viewportPad = cssLengthToPx("--hotspot-stack-viewport-pad", 18);
    const topInset = cssLengthToPx("--hotspot-stack-top-inset", 92);
    const bottomInset = cssLengthToPx("--hotspot-stack-bottom-inset", 78);
    const leftInset = cssLengthToPx("--hotspot-stack-left-inset", 80);
    const rightInset = cssLengthToPx("--hotspot-stack-right-inset", 28);
    const side = chooseStackSide(group.bounds, {
        viewportWidth: viewport.width,
        leftInset,
        rightInset,
        currentSide: stackNode.side,
        hysteresisPx: cssLengthToPx("--hotspot-stack-side-hysteresis", 64),
    });
    stackNode.side = side;
    stackEl.dataset.side = side;
    const maxLeft = Math.max(viewportPad, viewport.width - panelWidth - viewportPad - rightInset);
    const desiredLeft = side === "left"
        ? group.bounds.left - offset - panelWidth
        : group.bounds.right + offset;
    const left = Math.max(leftInset, Math.min(maxLeft, desiredLeft));
    if (!stackNode.height) stackNode.height = stackEl.offsetHeight || 260;
    const maxTop = Math.max(topInset, viewport.height - stackNode.height - bottomInset);
    const top = Math.max(topInset, Math.min(maxTop, group.bounds.centerY - stackNode.height / 2));
    stackEl.style.left = `${left}px`;
    stackEl.style.top = `${top}px`;
    stackNode.panel = { side, left, top, width: panelWidth, height: stackNode.height };
    updateActivityStackLeader(stackNode, { x: group.bounds.centerX, y: group.bounds.centerY });
}
function stackVisible(clusters, overlapPx, maxPer) {
    const stacks = [];
    for (const c of clusters) {
        let found = null;
        for (const s of stacks) {
            const dx = s.x - c.screen.x;
            const dy = s.y - c.screen.y;
            if (Math.sqrt(dx * dx + dy * dy) <= overlapPx) {
                found = s;
                break;
            }
        }
        if (found) found.items.push(c);
        else stacks.push({ x: c.screen.x, y: c.screen.y, items: [c] });
    }
    const out = [];
    for (const s of stacks) {
        [...s.items]
            .sort((a, b) => b.count - a.count)
            .slice(0, maxPer)
            .forEach((c, i) => {
                out.push({ ...c, stackIdx: i });
            });
    }
    return out;
}
// ─── DOM builders ─────────────────────────────────────────────────────────────
function buildExpandedHTML(cluster) {
    const items = dedupeDisplayItems(cluster?.items || []);
    if (!items.length) {
        return `<div class="wzhs-item wzhs-item--headline"><strong class="wzhs-item__title">No current headlines</strong></div>`;
    }
    return items.map((e, index) => {
        const title = sanitizeText(e.__displayTitle || eventHeadline(e));
        const severityClass = getPlatformSeverityClass(e.severity || "medium");
        const severityLabel = sanitizeText(getPlatformSeverityLabel(e.severity, "Medium"));
        const subline = sanitizeText(e.__displaySubline || eventSubline(e));
        const itemTime = sanitizeText(timeAgo(e.occurred_at));
        return `<button type="button" class="wzhs-item wzhs-item--headline wzhs-item--button" data-hotspot-event-index="${index}">
            <div class="wzhs-item__row">
                <span class="wzhs-item__sev wzhs-item__sev--${escapeHtml(severityClass)}" data-severity="${escapeHtml(severityClass)}">${escapeHtml(severityLabel)}</span>
                ${itemTime ? `<span class="wzhs-item__time">${escapeHtml(itemTime)}</span>` : ""}
            </div>
            <strong class="wzhs-item__title">${escapeHtml(title)}</strong>
            ${subline ? `<span class="wzhs-item__loc">${escapeHtml(subline)}</span>` : ""}
        </button>`;
    }).join("");
}
function createCardEl(cluster, onToggle) {
    const root = document.createElement("div");
    let activeCluster = cluster;
    root.dataset.clusterId = cluster.id;
    root.__clusterItems = dedupeDisplayItems(cluster?.items || []);
    function refreshContent(isExpanded) {
        const cluster = activeCluster;
        const loc = compactPlaceLabel(
            cluster.latest?.display_location_label ||
            cluster.latest?.location_label ||
            cluster.latest?.impact_label ||
            cluster.latest?.origin_label ||
            cluster.latest?.place ||
            ""
        );
        const time = sanitizeText(timeAgo(cluster.latest?.occurred_at));
        const label = sanitizeText(cluster.label || "Hotspot");
        const isFresh = cluster.items.some((item) => isRecentActivity(item?.occurred_at));
        root.__clusterItems = dedupeDisplayItems(cluster?.items || []);
        root.className = [
            "wzhs",
            `wzhs--${cluster.cat}`,
            `wzhs--sev-${cluster.sev}`,
            isFresh ? "wzhs--fresh" : "",
            cluster.stackIdx === 1 ? "wzhs--s2" : "",
            cluster.stackIdx === 2 ? "wzhs--s3" : "",
            isExpanded ? "wzhs--open" : "",
        ].filter(Boolean).join(" ");
        root.dataset.category = categoryDataValue(cluster.cat);
        root.dataset.severity = getPlatformSeverityClass(cluster.sev);
        root.innerHTML = `
            <div class="wzhs__body">
                <button type="button" class="wzhs__top" data-hotspot-toggle>
                    <div class="wzhs__title">
                        <div class="wzhs__icon static-icon">
                            <span class="${cluster.icon}" aria-hidden="true"></span>
                        </div>
                        <span class="wzhs__count">${escapeHtml(cluster.count)}</span>
                        <span class="wzhs__label">${escapeHtml(label)}</span>
                    </div>
                    <span class="wzhs__arr static-icon">
                        <span class="stratops-ico-close-1" aria-hidden="true"></span>
                    </span>
                </button>
                ${isExpanded ? `
                <div class="wzhs__detail">
                    <div class="wzhs__header">
                        ${loc ? `<span class="wzhs__loc">${escapeHtml(loc)}</span>` : ""}
                        <span class="wzhs__time">${escapeHtml(time)}</span>
                    </div>
                    <div class="wzhs__items">${buildExpandedHTML(cluster)}</div>
                </div>` : ""}
            </div>`;
    }
    refreshContent(false);
    root._refreshContent = refreshContent;
    root.render = (nextCluster, isExpanded) => {
        activeCluster = nextCluster || activeCluster;
        root.dataset.clusterId = activeCluster.id;
        refreshContent(isExpanded);
    };
    root.addEventListener("click", (e) => {
        const eventButton = e.target?.closest?.("[data-hotspot-event-index]");
        if (eventButton) {
            e.preventDefault();
            e.stopPropagation();
            const index = Number(eventButton.getAttribute("data-hotspot-event-index"));
            const selected = Array.isArray(root.__clusterItems) ? root.__clusterItems[index] : null;
            if (selected) dispatchHotspotEventSelection(selected);
            return;
        }
        const toggleButton = e.target?.closest?.("[data-hotspot-toggle]");
        if (!toggleButton) return;
        e.preventDefault();
        e.stopPropagation();
        onToggle(cluster.id, root);
    });
    return root;
}
function setAnchorCssPosition(el, x, y) {
    if (!el?.style) return;
    if (el._wzhsAnchorX !== x) {
        el.style.setProperty("--wzhs-anchor-x", `${x}px`);
        el._wzhsAnchorX = x;
    }
    if (el._wzhsAnchorY !== y) {
        el.style.setProperty("--wzhs-anchor-y", `${y}px`);
        el._wzhsAnchorY = y;
    }
}
function setElementHidden(el, hidden) {
    if (el && el.hidden !== hidden) el.hidden = hidden;
}
export function applyHotspotNodeAnchorPosition(node, projected, viewport) {
    if (!node) return false;
    const x = Number(projected?.x) + Number(viewport?.offsetX || 0);
    const y = Number(projected?.y) + Number(viewport?.offsetY || 0);
    const edgePad = Math.max(0, Number(viewport?.edgePad || 0));
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    const visible = Number.isFinite(x) && Number.isFinite(y)
        && Number.isFinite(width) && Number.isFinite(height)
        && x >= -edgePad && x <= width + edgePad
        && y >= -edgePad && y <= height + edgePad;
    node.anchorVisible = visible;
    setElementHidden(node.radiusEl, !visible);
    setElementHidden(node.el, !visible);
    setElementHidden(node.uxLabelEl, !visible || node.uxLabelEligible === false);
    if (!visible) return false;

    const off = node.stackOffset || STACK_OFF[0];
    setAnchorCssPosition(node.el, x + HOTSPOT_LABEL_OFFSET.x + Number(off.x || 0), y + HOTSPOT_LABEL_OFFSET.y + Number(off.y || 0));
    setAnchorCssPosition(node.uxLabelEl, x + HOTSPOT_RADIUS_OFFSET.x, y + HOTSPOT_RADIUS_OFFSET.y);
    if (node.radiusEl?.style) {
        const diameter = Math.max(0, Number(node.radiusSize || 0));
        const renderPadding = Math.max(0, Number(node.radiusRenderPadding || 0));
        setAnchorCssPosition(
            node.radiusEl,
            x + HOTSPOT_RADIUS_OFFSET.x - diameter * 0.5 - renderPadding,
            y + HOTSPOT_RADIUS_OFFSET.y - diameter * 0.5 - renderPadding
        );
        const surfaceMatrix = projected?.matrix || "matrix(1, 0, 0, 1, 0, 0)";
        if (node.surfaceMatrix !== surfaceMatrix) {
            node.radiusEl.style.setProperty("--wzhs-surface-matrix", surfaceMatrix);
            node.surfaceMatrix = surfaceMatrix;
        }
    }
    node.screenX = x;
    node.screenY = y;
    return true;
}
export function isHotspotReconciliationDue(now, lastReconcile, throttleMs) {
    const current = Number(now);
    const previous = Number(lastReconcile);
    const throttle = Math.max(0, Number(throttleMs || 0));
    return Number.isFinite(current) && Number.isFinite(previous) && (current - previous) >= throttle;
}
// ─── main export ──────────────────────────────────────────────────────────────
export function createWarzoneHotspotLayer(viewer, rootEl, options = {}) {
    if (!viewer || !rootEl) return null;
    let allEvents = [];
    let devInspectionPreview = null;
    let expandedId = null;
    let destroyed = false;
    let clustersDirty = true;
    let cachedClusters = [];
    let lastZoomConfigKey = "";
    let lastEventsSignature = "";
    const nodeMap = new Map();
    let rafPending = false;
    let lastRenderMs = 0;
    let lastMoveRenderMs = 0;
    let cameraMoving = false;
    let moveEndTimer = 0;
    let anchorViewport = null;
    const activityStack = createActivityStackElements(rootEl);
    const hotspotPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    const cfg = {
        maxCards: options.maxCards ?? 52,
        maxEvents: options.maxEvents ?? 1800,
        clusterDistanceLat: options.clusterDistanceLat ?? 2.6,
        clusterDistanceLon: options.clusterDistanceLon ?? 3.2,
        stackDistancePx: options.stackDistancePx ?? 100,
        maxVisiblePerHotspot: options.maxVisiblePerHotspot ?? 4,
        minItemsForCluster: options.minItemsForCluster ?? 2,
        throttleIdle: options.throttleIdle ?? 100,
        throttleMove: options.throttleMove ?? 90,
    };
    function handleToggle(id, el) {
        if (!areHotspotCardsEnabled()) return;
        const wasOpen = expandedId === id;
        expandedId = wasOpen ? null : id;
        if (!wasOpen) {
            for (const [nid, node] of nodeMap) {
                if (nid !== id && node.el?.classList.contains("wzhs--open")) {
                    node.el._refreshContent(false);
                    node.el.classList.remove("wzhs--open");
                }
            }
        }
        el._refreshContent(!wasOpen);
    }
    function syncNodeWorldAnchor(node, cluster) {
        const longitude = Number(cluster?.lon);
        const latitude = Number(cluster?.lat);
        if (!node || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
        if (node.anchorLongitude === longitude && node.anchorLatitude === latitude && node.worldAnchor) return;
        node.anchorLongitude = longitude;
        node.anchorLatitude = latitude;
        node.worldAnchor = createHotspotWorldAnchor(longitude, latitude);
    }
    function updateActivityStackLeaderAnchor() {
        if (activityStack.stackEl.hidden || !activityStack.groupIds.length) return;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        let pointCount = 0;
        for (const id of activityStack.groupIds) {
            const node = nodeMap.get(String(id));
            if (!node?.anchorVisible || !Number.isFinite(node.screenX) || !Number.isFinite(node.screenY)) continue;
            minX = Math.min(minX, node.screenX);
            maxX = Math.max(maxX, node.screenX);
            minY = Math.min(minY, node.screenY);
            maxY = Math.max(maxY, node.screenY);
            pointCount += 1;
        }
        if (!pointCount) {
            activityStack.lineEl.hidden = true;
            return;
        }
        updateActivityStackLeader(activityStack, {
            x: (minX + maxX) * 0.5,
            y: (minY + maxY) * 0.5,
        });
    }
    function updateCurrentAnchorPositions() {
        if (destroyed || !anchorViewport || !viewer.scene) return;
        for (const [, node] of nodeMap) {
            const projected = projectHotspotWorldAnchor(viewer.scene, node.worldAnchor);
            applyHotspotNodeAnchorPosition(node, projected, anchorViewport);
        }
        updateActivityStackLeaderAnchor();
    }
    function getHotspotNodeAtCanvasPosition(position) {
        if (!position || !anchorViewport) return null;
        const x = Number(position.x) + Number(anchorViewport.offsetX || 0);
        const y = Number(position.y) + Number(anchorViewport.offsetY || 0);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        let closest = null;
        let closestRatio = Infinity;
        for (const [, node] of nodeMap) {
            if (!node?.cluster || !node.anchorVisible || node.radiusEl?.hidden) continue;
            const radius = Math.max(12, Number(node.radiusSize || 0) * 0.5);
            const distance = Math.hypot(x - Number(node.screenX), y - Number(node.screenY));
            const ratio = distance / radius;
            if (ratio <= 1 && ratio < closestRatio) {
                closest = node;
                closestRatio = ratio;
            }
        }
        return closest;
    }
    hotspotPickHandler.setInputAction((movement) => {
        const node = getHotspotNodeAtCanvasPosition(movement?.position);
        if (!node?.cluster) return;
        const canvasRect = viewer.scene.canvas.getBoundingClientRect();
        dispatchHotspotClusterSelection(node.cluster, {
            x: canvasRect.left + Number(movement.position.x),
            y: canvasRect.top + Number(movement.position.y),
            space: "viewport",
        });
        viewer.scene.requestRender?.();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    function render(fromPostRender) {
        if (!fromPostRender) rafPending = false;
        if (destroyed || !viewer.scene || !rootEl) return;
        if (!fromPostRender) {
            const now = performance.now();
            if (now - lastRenderMs < cfg.throttleIdle) {
                scheduleRender(cfg.throttleIdle - (now - lastRenderMs));
                return;
            }
            lastRenderMs = now;
        }
        const canvas = viewer.scene.canvas;
        if (!canvas) return;
        const canvasRect = canvas.getBoundingClientRect();
        const overlayRect = rootEl.getBoundingClientRect();
        if (!canvasRect.width || !canvasRect.height) return;
        const offX = canvasRect.left - overlayRect.left;
        const offY = canvasRect.top - overlayRect.top;
        rootEl.style.setProperty("--wzhs-perspective-tilt", getHotspotPerspectiveTilt(viewer));
        const zoomCfg = getZoomAwareHotspotConfig(viewer, cfg);
        const zoomState = devInspectionPreview?.zoomState || getHotspotZoomState(viewer);
        const renderedEvents = devInspectionPreview?.events || allEvents;
        const clusterBucket = getClusterBucketForZoomState(zoomState, zoomCfg.key);
        anchorViewport = {
            offsetX: offX,
            offsetY: offY,
            width: overlayRect.width,
            height: overlayRect.height,
            edgePad: zoomCfg.edgePad,
        };
        rootEl.dataset.zoomBucket = zoomCfg.key || "default";
        rootEl.dataset.zoomState = zoomState;
        const clusterCacheKey = `${zoomState}:${clusterBucket}`;
        if (clustersDirty || lastZoomConfigKey !== clusterCacheKey) {
            cachedClusters = zoomState === ZOOM_UX_STATES.EVENT
                ? []
                : geoCluster(renderedEvents, clusterBucket, cfg.minItemsForCluster, zoomCfg.maxCards);
            clustersDirty = false;
            lastZoomConfigKey = clusterCacheKey;
        }
        const projected = [];
        for (const c of cachedClusters) {
            const s = toScreen(viewer.scene, c.lon, c.lat);
            if (!s) continue;
            const x = s.x + offX;
            const y = s.y + offY;
            if (x < -zoomCfg.edgePad || x > overlayRect.width + zoomCfg.edgePad) continue;
            if (y < -zoomCfg.edgePad || y > overlayRect.height + zoomCfg.edgePad) continue;
            projected.push({ ...c, screen: { x, y } });
        }
        const visible = stackVisible(projected, zoomCfg.stackDistancePx, zoomCfg.maxVisiblePerHotspot);
        const activeGroup = zoomState === ZOOM_UX_STATES.LOCAL_STACK
            ? selectActiveClusterGroup(visible, {
                viewportWidth: overlayRect.width,
                viewportHeight: overlayRect.height,
                maxGapPx: cssLengthToPx("--hotspot-stack-group-gap", 340),
                preferredClusterIds: activityStack.groupIds,
                switchMargin: cssNumber("--hotspot-stack-selection-hysteresis", 0.55),
            })
            : null;
        activityStack.groupIds = activeGroup
            ? activeGroup.clusters.map((cluster) => String(cluster.cluster_id || cluster.id))
            : [];
        const stackEntryLimit = overlayRect.width <= 720
            ? cssNumber("--hotspot-stack-entry-limit-small", 4)
            : cssNumber("--hotspot-stack-entry-limit", 6);
        const stackModel = activeGroup
            ? buildLocalActivityStackModel(activeGroup.clusters, { maxEntries: stackEntryLimit })
            : null;
        const clusterNumbers = new Map((stackModel?.entries || []).map((entry) => [entry.cluster_id, entry.number]));
        const localityLabelIds = zoomState === ZOOM_UX_STATES.LOCALITY
            ? selectCollisionSafeLabels(visible.map((cluster) => {
                const locality = selectClusterLocalityLabel(cluster);
                const count = Math.max(1, Number(cluster.actual_event_count || cluster.event_count || cluster.count || 1));
                return {
                    id: cluster.id,
                    screen: cluster.screen,
                    width: Math.max(90, Math.min(180, 34 + locality.length * 8)),
                    height: 48,
                    priority: Number(cluster.weighted_activity_score || cluster._activityScore || 0) * 10 + Math.log1p(count),
                };
            }), {
                viewportWidth: overlayRect.width,
                viewportHeight: overlayRect.height,
                viewportPad: cssLengthToPx("--hotspot-stack-viewport-pad", 18),
                gapPx: cssLengthToPx("--hotspot-local-label-collision-gap", 10),
                maxVisible: overlayRect.width <= 720
                    ? cssNumber("--hotspot-local-label-max-visible-small", 16)
                    : cssNumber("--hotspot-local-label-max-visible", 30),
            })
            : null;
        renderActivityStack(activityStack, stackModel, activeGroup, {
            width: overlayRect.width,
            height: overlayRect.height,
        });
        const visibleIds = new Set(visible.map((v) => v.id));
        for (const [id, node] of nodeMap) {
            if (!visibleIds.has(id)) {
                removeHotspotNode(node);
                nodeMap.delete(id);
            }
        }
        const cardsEnabled = areHotspotCardsEnabled();
        if (!cardsEnabled && expandedId) expandedId = null;
        for (const cluster of visible) {
            const off = STACK_OFF[cluster.stackIdx] || STACK_OFF[0];
            const hotspotDiameter = getHotspotRadiusDiameterPx(viewer, cluster, zoomCfg);
            const hotspotRenderPadding = Math.max(0, cssNumber("--hotspot-render-padding", 24));
            const hotspotRenderSize = hotspotDiameter + hotspotRenderPadding * 2;
            const radiusSplitHidden = isHotspotRadiusSplitHidden(viewer, zoomCfg, cluster);
            const zi = 25 - cluster.stackIdx;
            if (nodeMap.has(cluster.id)) {
                const node = nodeMap.get(cluster.id);
                if (!node.radiusEl) {
                    node.radiusEl = createHotspotRadiusEl(cluster);
                    node.radiusEl.style.position = "absolute";
                    node.radiusEl.style.left = "0";
                    node.radiusEl.style.top = "0";
                    rootEl.appendChild(node.radiusEl);
                }
                if (!node.uxLabelEl) {
                    node.uxLabelEl = createClusterUxLabelEl();
                    rootEl.appendChild(node.uxLabelEl);
                }
                node.stackOffset = off;
                node.cluster = cluster;
                node.radiusRenderPadding = hotspotRenderPadding;
                node.uxLabelEligible = localityLabelIds ? localityLabelIds.has(String(cluster.id)) : true;
                syncNodeWorldAnchor(node, cluster);
                applyHotspotRadiusModel(node.radiusEl, cluster);
                syncHotspotRadiusSplitState(node.radiusEl, radiusSplitHidden);
                renderClusterUxLabel(node.uxLabelEl, cluster, zoomState, clusterNumbers.get(cluster.id) || "");
                if (node.el && !cardsEnabled) {
                    node.el.remove();
                    node.el = null;
                }
                if (cardsEnabled && !node.el) {
                    node.el = createCardEl(cluster, handleToggle);
                    node.el.style.left = "0";
                    node.el.style.top = "0";
                    rootEl.appendChild(node.el);
                }
                if (node.radiusRenderSize !== hotspotRenderSize) {
                    node.radiusEl.style.width = `${hotspotRenderSize}px`;
                    node.radiusEl.style.height = `${hotspotRenderSize}px`;
                    node.radiusSize = hotspotDiameter;
                    node.radiusRenderSize = hotspotRenderSize;
                }
                node.radiusEl.style.zIndex = zi - 1;
                node.uxLabelEl.style.zIndex = zi;
                if (node.el) node.el.style.zIndex = zi;
                if (cardsEnabled && node.el) {
                    node.el.classList.toggle("wzhs--s2", cluster.stackIdx === 1);
                    node.el.classList.toggle("wzhs--s3", cluster.stackIdx === 2);
                    node.el.__clusterItems = dedupeDisplayItems(cluster?.items || []);
                    node.el.render?.(cluster, expandedId === cluster.id);
                }
            } else {
                const radiusEl = createHotspotRadiusEl(cluster);
                syncHotspotRadiusSplitState(radiusEl, radiusSplitHidden);
                radiusEl.style.cssText = `position:absolute;left:0;top:0;z-index:${zi - 1};width:${hotspotRenderSize}px;height:${hotspotRenderSize}px;`;
                rootEl.appendChild(radiusEl);
                const uxLabelEl = createClusterUxLabelEl();
                renderClusterUxLabel(uxLabelEl, cluster, zoomState, clusterNumbers.get(cluster.id) || "");
                uxLabelEl.style.cssText = `left:0;top:0;z-index:${zi};`;
                rootEl.appendChild(uxLabelEl);
                const el = cardsEnabled ? createCardEl(cluster, handleToggle) : null;
                if (el) {
                    el.style.cssText = `position:absolute;left:0;top:0;z-index:${zi};`;
                    rootEl.appendChild(el);
                }
                const node = {
                    el,
                    radiusEl,
                    uxLabelEl,
                    stackOffset: off,
                    uxLabelEligible: localityLabelIds ? localityLabelIds.has(String(cluster.id)) : true,
                    radiusSize: hotspotDiameter,
                    radiusRenderPadding: hotspotRenderPadding,
                    radiusRenderSize: hotspotRenderSize,
                    cluster,
                };
                syncNodeWorldAnchor(node, cluster);
                nodeMap.set(cluster.id, node);
                markHotspotNodeEntered(node);
            }
        }
        updateCurrentAnchorPositions();
    }
    function scheduleRender(delay = 0) {
        if (destroyed || rafPending) return;
        rafPending = true;
        if (delay <= 0) {
            requestAnimationFrame(() => render());
        } else {
            setTimeout(() => {
                rafPending = false;
                scheduleRender(0);
            }, delay);
        }
    }
    function onPostRender() {
        updateCurrentAnchorPositions();
        if (!cameraMoving) return;
        const now = performance.now();
        const moveThrottle = allEvents.length > 2000
            ? Math.max(cfg.throttleMove, 96)
            : allEvents.length > 1000
                ? Math.max(cfg.throttleMove, 72)
                : cfg.throttleMove;
        if (!isHotspotReconciliationDue(now, lastMoveRenderMs, moveThrottle)) return;
        lastMoveRenderMs = now;
        render(true);
    }
    function onCameraMoveStart() {
        cameraMoving = true;
        clearTimeout(moveEndTimer);
        scheduleRender(0);
    }
    function onCameraMoveEnd() {
        clearTimeout(moveEndTimer);
        moveEndTimer = setTimeout(() => {
            cameraMoving = false;
            scheduleRender(0);
        }, 60);
    }
    function onResize() {
        scheduleRender(0);
    }
    function onSceneModeChanged() {
        clustersDirty = true;
        scheduleRender(0);
    }
    viewer.scene.postRender.addEventListener(onPostRender);
    viewer.camera.moveStart.addEventListener(onCameraMoveStart);
    viewer.camera.moveEnd.addEventListener(onCameraMoveEnd);
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("wz:scene-mode-changed", onSceneModeChanged);
    return {
        setEvents(next = []) {
            const arr = Array.isArray(next) ? next : [];
            const nextSignature = makeHotspotEventSignature(arr);
            if (nextSignature === lastEventsSignature) {
                return;
            }
            const normalized = arr
                .filter((evt) => evt && Number.isFinite(Number(evt.lat)) && Number.isFinite(Number(evt.lon)))
                .map((evt) => normalizeEventForDisplay(evt))
                .slice(0, Math.max(120, Number(cfg.maxEvents || 1800)));
            allEvents = normalized;
            lastEventsSignature = nextSignature;
            clustersDirty = true;
            viewer.scene.requestRender();
            scheduleRender(0);
        },
        setDevInspectionPreview({ events = [], zoomState = ZOOM_UX_STATES.REGIONAL } = {}) {
            const allowedStates = new Set(Object.values(ZOOM_UX_STATES));
            const normalizedState = allowedStates.has(zoomState) ? zoomState : ZOOM_UX_STATES.REGIONAL;
            const normalizedEvents = (Array.isArray(events) ? events : [])
                .filter((evt) => evt && Number.isFinite(Number(evt.lat)) && Number.isFinite(Number(evt.lon)))
                .map((evt) => normalizeEventForDisplay(evt))
                .slice(0, Math.max(12, Number(cfg.maxEvents || 1800)));
            devInspectionPreview = { events: normalizedEvents, zoomState: normalizedState };
            rootEl.dataset.devInspectionPreview = "1";
            clustersDirty = true;
            lastZoomConfigKey = "";
            viewer.scene.requestRender();
            scheduleRender(0);
        },
        clearDevInspectionPreview() {
            devInspectionPreview = null;
            delete rootEl.dataset.devInspectionPreview;
            clustersDirty = true;
            lastZoomConfigKey = "";
            viewer.scene.requestRender();
            scheduleRender(0);
        },
        addEvent(evt) {
            if (!evt) return;
            if (!isEventVisible(evt)) return;
            if (!Number.isFinite(Number(evt.lat)) || !Number.isFinite(Number(evt.lon))) return;
            if (allEvents.some((e) => String(e.id) === String(evt.id))) return;
            allEvents.unshift(normalizeEventForDisplay(evt));
            const maxEvents = Math.max(120, Number(cfg.maxEvents || 1800));
            if (allEvents.length > maxEvents) {
                allEvents.length = maxEvents;
            }
            clustersDirty = true;
            viewer.scene.requestRender();
            scheduleRender(0);
        },
        clear() {
            for (const [, node] of nodeMap) {
                node.el?.remove?.();
                node.radiusEl?.remove?.();
                node.uxLabelEl?.remove?.();
            }
            nodeMap.clear();
            hideActivityStack(activityStack);
        },
        destroy() {
            destroyed = true;
            clearTimeout(moveEndTimer);
            for (const [, node] of nodeMap) {
                node.el?.remove?.();
                node.radiusEl?.remove?.();
                node.uxLabelEl?.remove?.();
            }
            nodeMap.clear();
            activityStack.stackEl.remove();
            activityStack.lineEl.remove();
            hotspotPickHandler.destroy();
            viewer.scene.postRender.removeEventListener(onPostRender);
            viewer.camera.moveStart.removeEventListener(onCameraMoveStart);
            viewer.camera.moveEnd.removeEventListener(onCameraMoveEnd);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("wz:scene-mode-changed", onSceneModeChanged);
        },
    };
}
