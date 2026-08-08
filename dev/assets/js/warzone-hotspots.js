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
} from "./warzone-map-zoom-ux.js";
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
function getHotspotSurfaceMatrix(viewer, lon, lat) {
    const scene = viewer?.scene;
    if (scene?.mode === Cesium.SceneMode.SCENE2D) return "";
    const center = scene ? toScreen(scene, lon, lat) : null;
    if (!center) return "";
    const metersSample = Math.max(1200, cssNumber("--wzhs-surface-sample-meters", 24000));
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos((lat * Math.PI) / 180) * 111320);
    const eastPoint = toScreen(scene, lon + (metersSample / lonMeters), lat);
    const northPoint = toScreen(scene, lon, lat + (metersSample / latMeters));
    if (!eastPoint || !northPoint) return "";
    const ex = { x: eastPoint.x - center.x, y: eastPoint.y - center.y };
    const ny = { x: northPoint.x - center.x, y: northPoint.y - center.y };
    const exLen = Math.hypot(ex.x, ex.y);
    const nyLen = Math.hypot(ny.x, ny.y);
    const avg = (exLen + nyLen) * 0.5;
    if (!(avg > 0.0001)) return "";
    return `matrix(${(ex.x / avg).toFixed(5)}, ${(ex.y / avg).toFixed(5)}, ${(ny.x / avg).toFixed(5)}, ${(ny.y / avg).toFixed(5)}, 0, 0)`;
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
function toScreen(scene, lon, lat) {
    try {
        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        if (scene.mode !== Cesium.SceneMode.SCENE2D) {
            const camNorm = Cesium.Cartesian3.normalize(scene.camera.position, new Cesium.Cartesian3());
            const ptNorm = Cesium.Cartesian3.normalize(cart, new Cesium.Cartesian3());
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
    el.setAttribute("aria-hidden", "true");
    return el;
}
function renderClusterUxLabel(el, cluster, zoomState, number = "") {
    if (!el) return;
    const count = Math.max(1, Number(cluster?.actual_event_count || cluster?.event_count || cluster?.count || 1));
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
    return { stackEl, lineEl, signature: "", height: 0 };
}
function hideActivityStack(stackNode) {
    if (!stackNode) return;
    stackNode.stackEl.hidden = true;
    stackNode.lineEl.hidden = true;
    stackNode.signature = "";
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
    });
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

    const anchorX = group.bounds.centerX;
    const anchorY = group.bounds.centerY;
    const targetX = side === "left" ? left + panelWidth : left;
    const targetY = Math.max(top + 20, Math.min(top + stackNode.height - 20, anchorY));
    const distance = Math.hypot(targetX - anchorX, targetY - anchorY);
    const minLineLength = cssLengthToPx("--hotspot-stack-line-min-length", 24);
    if (distance <= minLineLength) {
        stackNode.lineEl.hidden = true;
    } else {
        stackNode.lineEl.hidden = false;
        stackNode.lineEl.style.left = `${anchorX}px`;
        stackNode.lineEl.style.top = `${anchorY}px`;
        stackNode.lineEl.style.width = `${distance}px`;
        stackNode.lineEl.style.transform = `rotate(${Math.atan2(targetY - anchorY, targetX - anchorX)}rad)`;
    }
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
// ─── main export ──────────────────────────────────────────────────────────────
export function createWarzoneHotspotLayer(viewer, rootEl, options = {}) {
    if (!viewer || !rootEl) return null;
    let allEvents = [];
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
    const activityStack = createActivityStackElements(rootEl);
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
        const zoomState = getHotspotZoomState(viewer);
        const clusterBucket = getClusterBucketForZoomState(zoomState, zoomCfg.key);
        rootEl.dataset.zoomBucket = zoomCfg.key || "default";
        rootEl.dataset.zoomState = zoomState;
        const clusterCacheKey = `${zoomState}:${clusterBucket}`;
        if (clustersDirty || lastZoomConfigKey !== clusterCacheKey) {
            cachedClusters = zoomState === ZOOM_UX_STATES.EVENT
                ? []
                : geoCluster(allEvents, clusterBucket, cfg.minItemsForCluster, zoomCfg.maxCards);
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
            })
            : null;
        const stackEntryLimit = overlayRect.width <= 720
            ? cssNumber("--hotspot-stack-entry-limit-small", 4)
            : cssNumber("--hotspot-stack-entry-limit", 6);
        const stackModel = activeGroup
            ? buildLocalActivityStackModel(activeGroup.clusters, { maxEntries: stackEntryLimit })
            : null;
        const clusterNumbers = new Map((stackModel?.entries || []).map((entry) => [entry.cluster_id, entry.number]));
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
            const tx = cluster.screen.x + HOTSPOT_LABEL_OFFSET.x + off.x;
            const ty = cluster.screen.y + HOTSPOT_LABEL_OFFSET.y + off.y;
            const rx = cluster.screen.x + HOTSPOT_RADIUS_OFFSET.x;
            const ry = cluster.screen.y + HOTSPOT_RADIUS_OFFSET.y;
            const hotspotDiameter = getHotspotRadiusDiameterPx(viewer, cluster, zoomCfg);
            const hotspotMatrix = getHotspotSurfaceMatrix(viewer, cluster.lon, cluster.lat);
            const radiusSplitHidden = isHotspotRadiusSplitHidden(viewer, zoomCfg, cluster);
            const zi = 25 - cluster.stackIdx;
            if (nodeMap.has(cluster.id)) {
                const node = nodeMap.get(cluster.id);
                if (!node.radiusEl) {
                    node.radiusEl = createHotspotRadiusEl(cluster);
                    rootEl.appendChild(node.radiusEl);
                }
                if (!node.uxLabelEl) {
                    node.uxLabelEl = createClusterUxLabelEl();
                    rootEl.appendChild(node.uxLabelEl);
                }
                applyHotspotRadiusModel(node.radiusEl, cluster);
                syncHotspotRadiusSplitState(node.radiusEl, radiusSplitHidden);
                renderClusterUxLabel(node.uxLabelEl, cluster, zoomState, clusterNumbers.get(cluster.id) || "");
                if (node.el && !cardsEnabled) {
                    node.el.remove();
                    node.el = null;
                    node.x = null;
                    node.y = null;
                }
                if (cardsEnabled && !node.el) {
                    node.el = createCardEl(cluster, handleToggle);
                    rootEl.appendChild(node.el);
                }
                if (cardsEnabled && node.el && (node.x !== tx || node.y !== ty)) {
                    node.el.style.left = `${tx}px`;
                    node.el.style.top = `${ty}px`;
                    node.el.style.zIndex = zi;
                    node.x = tx;
                    node.y = ty;
                }
                if (node.rx !== rx || node.ry !== ry || node.radiusSize !== hotspotDiameter) {
                    node.radiusEl.style.left = `${rx - hotspotDiameter * 0.5}px`;
                    node.radiusEl.style.top = `${ry - hotspotDiameter * 0.5}px`;
                    node.rx = rx;
                    node.ry = ry;
                }
                if (node.radiusSize !== hotspotDiameter) {
                    node.radiusEl.style.width = `${hotspotDiameter}px`;
                    node.radiusEl.style.height = `${hotspotDiameter}px`;
                    node.radiusSize = hotspotDiameter;
                }
                if (node.radiusMatrix !== hotspotMatrix) {
                    node.radiusEl.style.transform = hotspotMatrix || "none";
                    node.radiusMatrix = hotspotMatrix;
                }
                node.radiusEl.style.zIndex = zi - 1;
                node.uxLabelEl.style.left = `${rx}px`;
                node.uxLabelEl.style.top = `${ry}px`;
                node.uxLabelEl.style.zIndex = zi;
                if (cardsEnabled && node.el) {
                    node.el.classList.toggle("wzhs--s2", cluster.stackIdx === 1);
                    node.el.classList.toggle("wzhs--s3", cluster.stackIdx === 2);
                    node.el.__clusterItems = dedupeDisplayItems(cluster?.items || []);
                    node.el.render?.(cluster, expandedId === cluster.id);
                }
            } else {
                const radiusEl = createHotspotRadiusEl(cluster);
                syncHotspotRadiusSplitState(radiusEl, radiusSplitHidden);
                radiusEl.style.cssText = `position:absolute;left:${rx - hotspotDiameter * 0.5}px;top:${ry - hotspotDiameter * 0.5}px;z-index:${zi - 1};width:${hotspotDiameter}px;height:${hotspotDiameter}px;transform:${hotspotMatrix || "none"};`;
                rootEl.appendChild(radiusEl);
                const uxLabelEl = createClusterUxLabelEl();
                renderClusterUxLabel(uxLabelEl, cluster, zoomState, clusterNumbers.get(cluster.id) || "");
                uxLabelEl.style.cssText = `left:${rx}px;top:${ry}px;z-index:${zi};`;
                rootEl.appendChild(uxLabelEl);
                const el = cardsEnabled ? createCardEl(cluster, handleToggle) : null;
                if (el) {
                    el.style.cssText = `position:absolute;left:${tx}px;top:${ty}px;z-index:${zi};`;
                    rootEl.appendChild(el);
                }
                const node = { el, radiusEl, uxLabelEl, x: el ? tx : null, y: el ? ty : null, rx, ry, radiusSize: hotspotDiameter, radiusMatrix: hotspotMatrix };
                nodeMap.set(cluster.id, node);
                markHotspotNodeEntered(node);
            }
        }
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
        if (!cameraMoving) return;
        const now = performance.now();
        const moveThrottle = allEvents.length > 2000
            ? Math.max(cfg.throttleMove, 96)
            : allEvents.length > 1000
                ? Math.max(cfg.throttleMove, 72)
                : cfg.throttleMove;
        if ((now - lastMoveRenderMs) < moveThrottle) return;
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
            viewer.scene.postRender.removeEventListener(onPostRender);
            viewer.camera.moveStart.removeEventListener(onCameraMoveStart);
            viewer.camera.moveEnd.removeEventListener(onCameraMoveEnd);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("wz:scene-mode-changed", onSceneModeChanged);
        },
    };
}
