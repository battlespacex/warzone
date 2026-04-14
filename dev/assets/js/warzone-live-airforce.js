// File Path: /assets/js/warzone-live-airforce.js
import * as Cesium from "cesium";
/* ================= STATE ================= */
let __liveTrackEntities = new Map();
const __devTrackTimers = new Map();
const __liveTrackTrails = new Map();
const __liveTrackLastPositions = new Map();
const __liveTrackVisualState = new Map();
const __liveTrackRegistry = new Map();
const __liveTrackBillboardCache = new Map();
const __liveTrackReplayState = {
    selectedTrackKey: "",
    mode: "", // "focus" | "replay"
    routeEntity: null,
    markerEntity: null,
    markerTimer: null,
    markerIndex: 0,
};
let __liveTrackOverlayRoot = null;
let __liveTrackOverlayBound = false;
let __liveTrackClickBound = false;
let __liveTrackClickHandler = null;
let __liveTrackRegistryDispatchTimer = null;
// True while a programmatic camera.flyTo() is in flight — prevents moveStart
// from clearing the X-lines during the fly-to animation itself.
let __liveTrackIsCameraFlying = false;
let __liveTrackManualCameraIntent = false;
let __liveTrackHardLockEnabled = false;
let __liveTrackFocusInputBound = false;
let __liveTrackFocusRangeMeters = 95000;


const LIVE_TRACK_LABEL_CAMERA_HEIGHT_MAX = 420000;

const LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX = 850000;
const LIVE_TRACK_FOCUS_GUIDE_COLOR = "rgba(24, 226, 219, 0.72)";
const LIVE_TRACK_FOCUS_GUIDE_LENGTH_PX = 92;
const LIVE_TRACK_FOCUS_GUIDE_GAP_PX = 42;
const LIVE_TRACK_FOCUS_GUIDE_THICKNESS_PX = 4;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS = 95000;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG = -89;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS = 12000;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS = 3200000;
let __liveTrackFocusGuideEl = null;


/* ================= CONFIG ================= */
const LIVE_TRACK_MODEL_OFFSETS = {
    fighter: -90,
    awacs: -140,
    recon: -90,
    drone: -90,
    tanker: -90,
    transport: -90,
    vip: -90,
};
const LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS = 800;
const LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE = {
    fighter: 180,
    awacs: 260,
    recon: 160,
    drone: 120,
    vip: 240,
};
const LIVE_TRACK_ENGINE_OFFSET_METERS = 40;
const LIVE_TRACK_MAX_TRAIL_POINTS = 280;
const LIVE_TRACK_TRAIL_MAX_AGE_MS = 30 * 60 * 1000;
const LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS = 80;
const LIVE_TRACK_MIN_ANIM_DISTANCE_METERS = 2;
const LIVE_TRACK_MIN_ANIM_MS = 700;
const LIVE_TRACK_MAX_ANIM_MS = 4400;
const LIVE_TRACK_DEFAULT_ANIM_MS = 3600;
const LIVE_TRACK_HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000;
const LIVE_TRACK_HISTORY_MAX_POINTS = 720;
const LIVE_TRACK_REPLAY_STEP_MS = 180;
const LIVE_TRACK_BILLBOARD_CANVAS_SIZE = 96;
const LIVE_TRACK_BILLBOARD_NEAR_DISTANCE = 150000;
const LIVE_TRACK_BILLBOARD_FAR_DISTANCE = 9000000;
const LIVE_TRACK_MODEL_URI = "/assets/images/models/air/fighter-1.glb";
const LIVE_TRACK_MODEL_BY_SUBTYPE = {
    fighter: "/assets/images/models/air/fighter.glb",
    awacs: "/assets/images/models/air/awacs.glb",
    recon: "/assets/images/models/air/uav.glb",
    isr: "/assets/images/models/air/awacs.glb",
    tanker: "/assets/images/models/air/fighter-1.glb",
    refueler: "/assets/images/models/air/fighter-1.glb",
    transport: "/assets/images/models/air/fighter-1.glb",
    vip: "/assets/images/models/air/fighter-1.glb",
    logistics: "/assets/images/models/air/fighter-1.glb",
    logistic: "/assets/images/models/air/fighter-1.glb",
    bomber: "/assets/images/models/air/bomber.glb",
    trainer: "/assets/images/models/air/fighter.glb",
    drone: "/assets/images/models/air/uav.glb",
    uav: "/assets/images/models/air/uav.glb",
    helicopter: "/assets/images/models/air/fighter-1.glb",
};
const LIVE_TRACK_STALE_TIMEOUT_MS = 90 * 1000;
/* ================= CSS CONFIG ================= */
function getCssNumber(varName, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName);
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function getCssColor(varName, fallback = "rgba(255,255,255,1)") {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}
function getLiveTrackStyleConfig() {
    return {
        trailColor: getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)"),
        trailOpacity: getCssNumber("--warzone-live-track-opacity", 0.95),
        trailWidth: getCssNumber("--warzone-live-track-width", 3.4),
        scale: getCssNumber("--warzone-live-track-scale", 16),
        minimumPixelSize: getCssNumber("--warzone-live-track-min-pixel-size", 140),
        maximumScale: getCssNumber("--warzone-live-track-max-scale", 520),
    };
}
function getLiveTrackSubtypeScale(track = {}, fallbackScale = 16) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackScale;
    return getCssNumber(`--warzone-live-track-scale-${subtype}`, fallbackScale);
}
function getLiveTrackSubtypeMinPixelSize(track = {}, fallbackValue = 140) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackValue;
    return getCssNumber(`--warzone-live-track-min-pixel-size-${subtype}`, fallbackValue);
}
function getLiveTrackSubtypeMaxScale(track = {}, fallbackValue = 520) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackValue;
    return getCssNumber(`--warzone-live-track-max-scale-${subtype}`, fallbackValue);
}
function getLiveTrackSubtypeTrailEnabled(track = {}) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    if (!subtype) return true;
    return getCssNumber(`--warzone-live-track-trail-enabled-${subtype}`, 1) !== 0;
}
function getLiveTrackSubtypeTrailWidth(track = {}, fallbackWidth = 3.4) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackWidth;
    return getCssNumber(`--warzone-live-track-trail-width-${subtype}`, fallbackWidth);
}
function getLiveTrackBillboardScale(track = {}, fallbackMinPixelSize = 96) {
    const minPixelSize = getLiveTrackSubtypeMinPixelSize(track, fallbackMinPixelSize);
    return clamp(minPixelSize / LIVE_TRACK_BILLBOARD_CANVAS_SIZE, 0.58, 1.85);
}
function getLiveTrackBillboardColor(subtype = "") {
    const key = String(subtype || "").trim().toLowerCase();
    const palette = {
        fighter: "#56d80e",
        awacs: "#33d9ff",
        recon: "#7de8ff",
        isr: "#8fb8ff",
        tanker: "#ffd166",
        refueler: "#ffd166",
        transport: "#ff9b54",
        vip: "#ffe36e",
        logistics: "#ff9b54",
        logistic: "#ff9b54",
        bomber: "#ff5876",
        trainer: "#7ee8ff",
        drone: "#b48cff",
        uav: "#b48cff",
        helicopter: "#00d9b2",
        aircraft: getCssColor("--warzone-live-track-color", "#56d80e"),
    };
    return palette[key] || palette.aircraft;
}
function createAircraftBillboardImage(subtype = "aircraft") {
    const key = String(subtype || "aircraft").trim().toLowerCase() || "aircraft";
    if (__liveTrackBillboardCache.has(key)) return __liveTrackBillboardCache.get(key);

    const size = LIVE_TRACK_BILLBOARD_CANVAS_SIZE;
    const half = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const colorCss = getLiveTrackBillboardColor(key);
    const color = Cesium.Color.fromCssColorString(colorCss);
    const toRgba = (alpha) => (
        `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}, ${Math.max(0, Math.min(alpha, 1))})`
    );
    const stroke = "rgba(255,255,255,0.94)";

    ctx.clearRect(0, 0, size, size);

    const glow = ctx.createRadialGradient(half, half, 6, half, half, size * 0.38);
    glow.addColorStop(0, toRgba(0.58));
    glow.addColorStop(0.34, toRgba(0.22));
    glow.addColorStop(1, toRgba(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(half, half, size * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(half, half);
    ctx.fillStyle = colorCss;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";

    if (key === "awacs" || key === "isr" || key === "recon") {
        ctx.beginPath();
        ctx.arc(0, -6, 14, 0, Math.PI * 2);
        ctx.fillStyle = toRgba(0.26);
        ctx.fill();
        ctx.strokeStyle = toRgba(0.88);
        ctx.stroke();
        ctx.fillStyle = colorCss;
        ctx.strokeStyle = stroke;
    }

    if (key === "helicopter") {
        ctx.beginPath();
        ctx.moveTo(0, -22);
        ctx.lineTo(8, -6);
        ctx.lineTo(9, 8);
        ctx.lineTo(4, 18);
        ctx.lineTo(4, 26);
        ctx.lineTo(-4, 26);
        ctx.lineTo(-4, 18);
        ctx.lineTo(-9, 8);
        ctx.lineTo(-8, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-20, -12);
        ctx.lineTo(20, -12);
        ctx.moveTo(0, -19);
        ctx.lineTo(0, -6);
        ctx.moveTo(4, 20);
        ctx.lineTo(16, 28);
        ctx.stroke();
    } else if (key === "uav" || key === "drone") {
        ctx.beginPath();
        ctx.moveTo(0, -24);
        ctx.lineTo(10, -6);
        ctx.lineTo(24, 2);
        ctx.lineTo(10, 8);
        ctx.lineTo(4, 22);
        ctx.lineTo(0, 26);
        ctx.lineTo(-4, 22);
        ctx.lineTo(-10, 8);
        ctx.lineTo(-24, 2);
        ctx.lineTo(-10, -6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (key === "transport" || key === "logistics" || key === "logistic" || key === "tanker" || key === "refueler") {
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.lineTo(7, -10);
        ctx.lineTo(28, -3);
        ctx.lineTo(28, 6);
        ctx.lineTo(8, 6);
        ctx.lineTo(6, 24);
        ctx.lineTo(12, 30);
        ctx.lineTo(12, 34);
        ctx.lineTo(0, 29);
        ctx.lineTo(-12, 34);
        ctx.lineTo(-12, 30);
        ctx.lineTo(-6, 24);
        ctx.lineTo(-8, 6);
        ctx.lineTo(-28, 6);
        ctx.lineTo(-28, -3);
        ctx.lineTo(-7, -10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (key === "bomber") {
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.lineTo(24, 10);
        ctx.lineTo(12, 10);
        ctx.lineTo(4, 28);
        ctx.lineTo(0, 32);
        ctx.lineTo(-4, 28);
        ctx.lineTo(-12, 10);
        ctx.lineTo(-24, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.moveTo(0, -30);
        ctx.lineTo(7, -9);
        ctx.lineTo(23, -4);
        ctx.lineTo(23, 4);
        ctx.lineTo(6, 5);
        ctx.lineTo(2, 22);
        ctx.lineTo(10, 30);
        ctx.lineTo(10, 34);
        ctx.lineTo(0, 28);
        ctx.lineTo(-10, 34);
        ctx.lineTo(-10, 30);
        ctx.lineTo(-2, 22);
        ctx.lineTo(-6, 5);
        ctx.lineTo(-23, 4);
        ctx.lineTo(-23, -4);
        ctx.lineTo(-7, -9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    ctx.restore();
    const dataUrl = canvas.toDataURL("image/png");
    __liveTrackBillboardCache.set(key, dataUrl);
    return dataUrl;
}
function resolveLiveTrackBillboardImage(track = {}) {
    const metadata = getTrackMetadata(track);
    const directImage = [
        track.icon_url,
        track.image_url,
        metadata.icon_url,
        metadata.image_url,
    ]
        .map((value) => String(value || "").trim())
        .find((value) => value && (/^data:image\//i.test(value) || /\.(png|svg|webp|jpe?g)(\?|#|$)/i.test(value)));

    if (directImage) return directImage;
    return createAircraftBillboardImage(resolveTrackSubtype(track));
}
function buildLiveTrackBillboard(track = {}, headingDeg = 0) {
    if (!shouldUseLiveTrackBillboards()) return null;
    const image = resolveLiveTrackBillboardImage(track);
    if (!image) return null;
    const scale = getLiveTrackBillboardScale(track, 96);
    const farScale = Math.max(scale * 0.7, 0.42);
    return {
        image,
        scale,
        rotation: Cesium.Math.toRadians(-normalizeDegrees(headingDeg)),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(
            LIVE_TRACK_BILLBOARD_NEAR_DISTANCE,
            scale,
            LIVE_TRACK_BILLBOARD_FAR_DISTANCE,
            farScale
        ),
    };
}
function shouldUseLiveTrackBillboards() {
    return window.__stratopsConfig?.useAircraftBillboards === true;
}
function buildLiveTrackModelGraphics(modelUri, subtypeScale, subtypeMinPixelSize, subtypeMaxScale) {
    return {
        uri: modelUri,
        scale: subtypeScale,
        minimumPixelSize: subtypeMinPixelSize,
        maximumScale: subtypeMaxScale,
        color: undefined,
        colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
        colorBlendAmount: 0,
    };
}
function applyLiveTrackBillboard(entity, next) {
    if (!next) return false;
    if (!entity.billboard) {
        entity.billboard = { ...next };
        entity.model = undefined;
        entity.orientation = undefined;
        return true;
    }
    entity.billboard.image = next.image;
    entity.billboard.scale = next.scale;
    entity.billboard.rotation = next.rotation;
    entity.billboard.alignedAxis = next.alignedAxis;
    entity.billboard.horizontalOrigin = next.horizontalOrigin;
    entity.billboard.verticalOrigin = next.verticalOrigin;
    entity.billboard.disableDepthTestDistance = next.disableDepthTestDistance;
    entity.billboard.scaleByDistance = next.scaleByDistance;
    entity.model = undefined;
    entity.orientation = undefined;
    return true;
}
function applyLiveTrackModel(entity, track, modelUri, subtypeScale, subtypeMinPixelSize, subtypeMaxScale, lon, lat, alt, attitude) {
    if (!entity.model) {
        entity.model = buildLiveTrackModelGraphics(
            modelUri,
            subtypeScale,
            subtypeMinPixelSize,
            subtypeMaxScale
        );
    } else {
        entity.model.uri = modelUri;
        entity.model.scale = subtypeScale;
        entity.model.minimumPixelSize = subtypeMinPixelSize;
        entity.model.maximumScale = subtypeMaxScale;
        entity.model.color = Cesium.Color.WHITE;
        entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
        entity.model.colorBlendAmount = 0.15;
    }
    entity.billboard = undefined;
    entity.orientation = buildTrackOrientation(
        track,
        lon,
        lat,
        alt,
        attitude.headingDeg,
        attitude.pitchDeg,
        attitude.rollDeg
    );
}
function getLiveLabelStyleConfig() {
    return {
        scale: getCssNumber("--warzone-live-label-scale", 0.42),
        offsetY: getCssNumber("--warzone-live-label-offset-y", -18),
        fill: getCssColor("--warzone-live-label-fill", "#d7dee7"),
        background: getCssColor("--warzone-live-label-background", "rgba(8, 12, 20, 0.84)"),
        paddingX: getCssNumber("--warzone-live-label-padding-x", 6),
        paddingY: getCssNumber("--warzone-live-label-padding-y", 3),
        maxDistance: getCssNumber("--warzone-live-label-distance", 180000),
        animHeightMax: getCssNumber("--warzone-live-track-anim-height-max", 1600000),
    };
}
/* ================= UTILS ================= */
function requestWarzoneRender() {
    window.__warzoneViewer?.scene?.requestRender?.();
}

// Debounced version — batches rapid-fire render requests from upsertLiveTrack
// into a single Cesium render call. When 20 aircraft update in one poll cycle,
// this turns 20 requestRender() calls into 1, reducing render pressure.
let __renderDebounceTimer = null;
function requestWarzoneRenderBatched() {
    if (__renderDebounceTimer) return; // already queued
    __renderDebounceTimer = setTimeout(() => {
        __renderDebounceTimer = null;
        window.__warzoneViewer?.scene?.requestRender?.();
    }, 16); // ~1 frame at 60fps — coalesces all updates in the same tick
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function normalizeDegrees(deg = 0) {
    return ((deg % 360) + 360) % 360;
}
function getShortestAngleDeltaDeg(fromDeg = 0, toDeg = 0) {
    let delta = normalizeDegrees(toDeg) - normalizeDegrees(fromDeg);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
}
function getCartesianDistanceMeters(a, b) {
    if (!a || !b) return 0;
    try {
        return Cesium.Cartesian3.distance(a, b);
    } catch {
        return 0;
    }
}
function getPositionCartesian(positionOrEntity) {
    try {
        const candidate = positionOrEntity?.position?.getValue?.(Cesium.JulianDate.now())
            || positionOrEntity?.getValue?.(Cesium.JulianDate.now())
            || positionOrEntity?.position
            || positionOrEntity
            || null;
        if (!candidate) return null;
        if (
            !Number.isFinite(candidate.x) ||
            !Number.isFinite(candidate.y) ||
            !Number.isFinite(candidate.z)
        ) {
            return null;
        }
        return candidate;
    } catch {
        return null;
    }
}
function sanitizeTrackText(value = "") {
    return String(value || "")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/@[A-Za-z0-9_]+/g, " ")
        .replace(/[^\p{L}\p{N}\s.\-_/()]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isTrackTextUsable(value = "") {
    const clean = sanitizeTrackText(value);
    if (!clean) return false;
    if (/^(unknown|empty|null|n\/a)$/i.test(clean)) return false;
    return /[A-Za-z0-9]/.test(clean);
}
function formatTrackSubtypeLabel(subtype = "") {
    const key = String(subtype || "").trim().toLowerCase();
    if (key === "vip") return "VIP/GOV";
    if (key === "awacs") return "AWACS";
    if (key === "isr") return "ISR";
    if (key === "uav") return "UAV";
    if (!key) return "Aircraft";
    return key.charAt(0).toUpperCase() + key.slice(1);
}
const LIVE_TRACK_SPECIAL_ISR_COMMAND_PATTERNS = [
    /doomsday/i,
    /nightwatch/i,
    /looking glass/i,
    /tacamo/i,
    /mercury/i,
    /\be-?4b?\b/i,
    /\be-?6b?\b/i,
    /\bil-?80\b/i,
    /\bil-?82\b/i,
];
const LIVE_TRACK_SPECIAL_VIP_GOV_PATTERNS = [
    /air force one/i,
    /air force two/i,
    /air india one/i,
    /\bsam\d{2,6}\b/i,
    /\bvenus\d+\b/i,
    /\bexec1[fvp]\b/i,
    /\bvc-?25a?\b/i,
    /\bvc-?32a?\b/i,
    /\bc-?32a?\b/i,
    /\bc-?40b?\b/i,
    /\ba319cj\b/i,
    /\ba320cj\b/i,
    /\bbb[j]\b/i,
    /\bacj\b/i,
    /\bvvip\b/i,
    /vip transport/i,
    /presidential/i,
    /head of state/i,
    /prime minister/i,
    /state flight/i,
    /\bcotam\d+\b/i,
    /slo rossiya/i,
    /\bil-?96-?300pu\b/i,
    /\bil-?96pu\b/i,
    /\btu-?214pu\b/i,
    /konrad adenauer/i,
];
function getTrackSourceTimestamp(track = {}) {
    const ts = Number(track.timestamp || 0);
    if (Number.isFinite(ts) && ts > 0) return ts;
    const occurredAtTs = new Date(track.occurred_at || 0).getTime();
    if (Number.isFinite(occurredAtTs) && occurredAtTs > 0) return occurredAtTs;
    return Date.now();
}
function resolveTrackSubtype(track = {}) {
    const metadata = getTrackMetadata(track);
    const raw = String(track.subcategory || track.subtype || metadata.role || "")
        .trim()
        .toLowerCase();
    if (raw && !["military", "aircraft", "unknown"].includes(raw)) {
        return raw;
    }
    const haystack = [
        track.type_code,
        metadata.type_code,
        track.model_name,
        track.model,
        track.variant,
        metadata.model_name,
        track.description,
        track.title,
        track.callsign,
        track.flight,
        metadata.callsign,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    if (LIVE_TRACK_SPECIAL_ISR_COMMAND_PATTERNS.some((pattern) => pattern.test(haystack))) return "isr";
    if (LIVE_TRACK_SPECIAL_VIP_GOV_PATTERNS.some((pattern) => pattern.test(haystack))) return "vip";
    if (/(awacs|aew|wedgetail|hawkeye|sentry|e-3\b|e3\b|e-7\b|e7\b|a-50\b|a50\b|phalcon|erieye|kj-200\b|kj200\b|kj-500\b|kj500\b|kj-2000\b|kj2000\b)/.test(haystack)) return "awacs";
    if (/(rivet joint|cobra ball|combat sent|recon|reconnaissance|surveillance|poseidon|orion|rc-135\b|rc135\b|ep-3\b|ep3\b|p-8\b|p8\b|p-3\b|p3\b)/.test(haystack)) return "recon";
    if (/(isr\b|global hawk|triton|jstars|e-8\b|e8\b|rq-4\b|rq4\b|special mission)/.test(haystack)) return "isr";
    if (/(tanker|refuel|refueller|pegasus|extender|stratotanker|kc-135\b|kc135\b|kc-46\b|kc46\b|kc-10\b|kc10\b|a330 mrtt\b|mrtt\b|voyager\b|il-78\b|il78\b|yy-20\b|yy20\b)/.test(haystack)) return "tanker";
    if (/(transport|airlift|cargo|logistics|globemaster|hercules|atlas\b|a-?400m\b|c-17\b|c17\b|c-5\b|c5\b|c-130\b|hc-130\b|mc-130\b|c130\b|c-40\b|c40\b|an-124\b|an124\b|an-12\b|an12\b|il-76\b|il76\b|y-20\b|y20\b|cn-235\b|cn235\b|c295\b)/.test(haystack)) return "transport";
    if (/(helicopter|rotary|rotorcraft|black hawk|blackhawk|apache|chinook|osprey|seahawk|super stallion|king stallion|lakota|agusta|sikorsky|leonardo|aw-139\b|aw139\b|aw-119\b|aw119\b|th-73\b|th73\b|uh-72\b|uh72\b|uh-60\b|uh60\b|hh-60\b|hh60\b|mh-60\b|mh60\b|h-60\b|h60\b|ch-47\b|ch47\b|ch-53\b|ch53\b|v-22\b|v22\b|mi-8\b|mi8\b|mi-17\b|mi17\b|mi-24\b|mi24\b|mi-28\b|mi28\b|ka-27\b|ka27\b|ka-52\b|ka52\b)/.test(haystack)) return "helicopter";
    if (/(bomber|b-1\b|b1\b|b-2\b|b2\b|b-52\b|b52\b|tu-95\b|tu95\b|tu-160\b|tu160\b|h-6\b|h6\b|ac-130\b|ac130\b|spectre|spooky)/.test(haystack)) return "bomber";
    if (/(uav\b|drone\b|ucav\b|reaper\b|predator\b|mq-9\b|mq9\b|rq-4\b|rq4\b|tb2\b|bayraktar\b|heron\b|hermes\b)/.test(haystack)) return "uav";
    if (/(trainer\b|t-6\b|t6\b|t-38\b|t38\b|hawk\b|m-346\b|m346\b|yak-130\b|yak130\b|pc-21\b|pc21\b)/.test(haystack)) return "trainer";
    if (/(fighter\b|interceptor\b|multirole\b|hornet\b|super hornet\b|strike eagle\b|raptor\b|lightning ii\b|warthog\b|typhoon\b|eurofighter\b|rafale\b|gripen\b|mirage\b|tomcat\b|f-15\b|f15\b|f-16\b|f16\b|f-18\b|f18\b|fa-18\b|f\/a-18\b|f-22\b|f22\b|f-35\b|f35\b|a-10\b|a10\b|su-27\b|su27\b|su-30\b|su30\b|su-35\b|su35\b|mig-29\b|mig29\b|mig-31\b|mig31\b|j-10\b|j10\b|j-16\b|j16\b|j-20\b|j20\b|tejas\b|jf-17\b|jf17\b)/.test(haystack)) return "fighter";
    if (raw && !["military", "aircraft", "unknown"].includes(raw)) return raw;
    return "aircraft";
}
function getTrackMetadata(track = {}) {
    const raw = track?.metadata;
    if (!raw) return {};
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function getTrackRegistrationLabel(track = {}) {
    const metadata = getTrackMetadata(track);
    const registration = sanitizeTrackText(
        track.registration ||
        track.reg ||
        metadata.registration ||
        ""
    );
    return isTrackTextUsable(registration) ? registration : "";
}
function getTrackModelLabel(track = {}) {
    const metadata = getTrackMetadata(track);
    const model = sanitizeTrackText(
        track.model_name ||
        track.model ||
        track.variant ||
        metadata.model_name ||
        ""
    );
    return isTrackTextUsable(model) ? model : "";
}
function getTrackOperatorLabel(track = {}) {
    const metadata = getTrackMetadata(track);
    const operator = sanitizeTrackText(
        track.operator ||
        track.owner ||
        metadata.operator ||
        ""
    );
    return isTrackTextUsable(operator) ? operator : "";
}
function doesTrackTitleLookRich(rawTitle = "", model = "", identity = "", affiliation = "") {
    const raw = sanitizeTrackText(rawTitle);
    if (!isTrackTextUsable(raw)) return false;
    const normalized = raw.toLowerCase();
    const modelLabel = sanitizeTrackText(model).toLowerCase();
    const identityLabel = sanitizeTrackText(identity).toLowerCase();
    const affiliationLabel = sanitizeTrackText(affiliation).toLowerCase();
    if (modelLabel && normalized.includes(modelLabel)) return true;
    if (identityLabel && normalized !== identityLabel && raw.length >= Math.max(identityLabel.length + 8, 18)) return true;
    if (affiliationLabel && normalized.includes(affiliationLabel) && raw.length >= 18) return true;
    return raw.length >= 26 && raw.split(/\s+/).length >= 3;
}
function getTrackDisplayTitle(track = {}) {
    const metadata = getTrackMetadata(track);
    const rawTitle = sanitizeTrackText(
        track.title ||
        track.name ||
        ""
    );
    const model = getTrackModelLabel(track);
    const callsign = sanitizeTrackText(
        track.callsign ||
        track.flight ||
        metadata.callsign ||
        ""
    );
    const registration = getTrackRegistrationLabel(track);
    const identity = isTrackTextUsable(callsign) ? callsign : registration;
    const operator = getTrackOperatorLabel(track);
    const country = sanitizeTrackText(track.country || metadata.country || "");
    const affiliation = operator || country;
    if (model) {
        if (doesTrackTitleLookRich(rawTitle, model, identity, affiliation)) {
            return rawTitle;
        }
        if (identity && affiliation) {
            return `${model} — ${identity} (${affiliation})`;
        }
        if (identity) {
            return `${model} — ${identity}`;
        }
        if (affiliation) {
            return `${model} (${affiliation})`;
        }
        return model;
    }
    if (isTrackTextUsable(rawTitle)) {
        return rawTitle;
    }
    if (identity && affiliation) {
        return `${identity} (${affiliation})`;
    }
    if (identity) {
        return identity;
    }
    const subtype = formatTrackSubtypeLabel(resolveTrackSubtype(track));
    const shortKey = String(track.track_key || "").slice(-6).toUpperCase();
    return shortKey ? `${subtype} ${shortKey}` : subtype;
}
function isLiveTrackCameraZoomedIn() {
    const viewer = window.__warzoneViewer;

    if (!viewer?.camera) return false;
    try {
        const cartographic = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
        const height = Number(cartographic?.height || 0);
        return Number.isFinite(height) && height <= LIVE_TRACK_LABEL_CAMERA_HEIGHT_MAX;
    } catch {
        return false;
    }
}
function shouldShowTrackLabel(trackKey = "") {
    if (!trackKey) return false;

    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    if (selectedTrackKey && selectedTrackKey === String(trackKey)) {
        return true;
    }

    const cameraHeight = Number(window.__warzoneViewer?.camera?.positionCartographic?.height || 0);
    return cameraHeight > 0 && cameraHeight <= LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX;
}

function buildTrackLabel(track = {}, trackKey = "") {
    const labelStyle = getLiveLabelStyleConfig();
    return {
        text: getTrackDisplayTitle(track),
        show: new Cesium.CallbackProperty(() => shouldShowTrackLabel(trackKey), false),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelStyle.maxDistance),
        scale: labelStyle.scale,
        pixelOffset: new Cesium.Cartesian2(0, labelStyle.offsetY),
        fillColor: Cesium.Color.fromCssColorString(labelStyle.fill).withAlpha(0.98),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(labelStyle.background),
        backgroundPadding: new Cesium.Cartesian2(labelStyle.paddingX, labelStyle.paddingY),
        outlineWidth: 0,
        style: Cesium.LabelStyle.FILL,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
}
function applyTrackLabel(label, track = {}, trackKey = "") {
    if (!label) return;
    const nextConfig = buildTrackLabel(track, trackKey);
    label.text = nextConfig.text;
    label.show = nextConfig.show;
    label.distanceDisplayCondition = nextConfig.distanceDisplayCondition;
    label.scale = nextConfig.scale;
    label.pixelOffset = nextConfig.pixelOffset;
    label.fillColor = nextConfig.fillColor;
    label.showBackground = nextConfig.showBackground;
    label.backgroundColor = nextConfig.backgroundColor;
    label.backgroundPadding = nextConfig.backgroundPadding;
    label.outlineWidth = nextConfig.outlineWidth;
    label.style = nextConfig.style;
    label.horizontalOrigin = nextConfig.horizontalOrigin;
    label.verticalOrigin = nextConfig.verticalOrigin;
    label.disableDepthTestDistance = nextConfig.disableDepthTestDistance;
}

function getViewerContainerElement() {
    const viewer = window.__warzoneViewer;

    const container = viewer?.container || document.getElementById("cesiumContainer");
    return container || null;
}
function isFocusSelectionActive() {
    return Boolean(
        __liveTrackReplayState.selectedTrackKey &&
        String(__liveTrackReplayState.mode || "") === "focus"
    );
}
function applyFocusCameraControllerLock(enabled = false) {
    const controller = window.__warzoneViewer?.scene?.screenSpaceCameraController;
    if (!controller) return;
    void enabled;
    // Keep camera controls available; hard-lock behavior is enforced by
    // maintaining focus target tracking and suppressing unlock clicks.
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = true;
}
function setLiveTrackHardLockInternal(enabled = false, options = {}) {
    const canLock = isFocusSelectionActive();
    const nextValue = Boolean(enabled) && canLock;
    const hasChanged = nextValue !== __liveTrackHardLockEnabled;
    __liveTrackHardLockEnabled = nextValue;
    applyFocusCameraControllerLock(__liveTrackHardLockEnabled);
    if (hasChanged && !options.silent) {
        document.dispatchEvent(new CustomEvent("wz:aircraft-focus-lock-changed", {
            detail: {
                enabled: __liveTrackHardLockEnabled,
                trackKey: String(__liveTrackReplayState.selectedTrackKey || ""),
            },
        }));
    }
    return __liveTrackHardLockEnabled;
}

function getOrCreateFocusGuideElement() {
    if (__liveTrackFocusGuideEl?.isConnected) {
        return __liveTrackFocusGuideEl;
    }

    const container = getViewerContainerElement();
    if (!container) return null;

    const guide = document.createElement("div");
    guide.className = "wz-aircraft-focus-guides";
    guide.setAttribute("aria-hidden", "true");
    guide.innerHTML = `
        <span class="wz-aircraft-focus-guides__line is-top-left"></span>
        <span class="wz-aircraft-focus-guides__line is-top-right"></span>
        <span class="wz-aircraft-focus-guides__line is-bottom-left"></span>
        <span class="wz-aircraft-focus-guides__line is-bottom-right"></span>
    `;
    container.appendChild(guide);
    __liveTrackFocusGuideEl = guide;
    return guide;
}

function hideFocusGuideElement() {
    if (__liveTrackFocusGuideEl) {
        __liveTrackFocusGuideEl.classList.remove("is-visible");
    }
}

function updateFocusGuideElement() {
    const viewer = window.__warzoneViewer;
    const guide = getOrCreateFocusGuideElement();
    const trackKey = String(__liveTrackReplayState.selectedTrackKey || "");

    if (!viewer || !guide || __liveTrackReplayState.mode !== "focus" || !trackKey) {
        hideFocusGuideElement();
        return;
    }

    const entity = viewer.entities.getById(`track-${trackKey}`);
    const position = getPositionCartesian(entity);

    if (!position) {
        hideFocusGuideElement();
        return;
    }

    const __sceneToWindow = Cesium.SceneTransforms.worldToWindowCoordinates ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    const canvasPoint = __sceneToWindow(viewer.scene, position);

    if (!canvasPoint || !Number.isFinite(canvasPoint.x) || !Number.isFinite(canvasPoint.y)) {
        hideFocusGuideElement();
        return;
    }

    guide.style.left = `${canvasPoint.x}px`;
    guide.style.top = `${canvasPoint.y}px`;
    guide.classList.add("is-visible");
}

function bindFocusGuideTracking() {
    const viewer = window.__warzoneViewer;

    if (!viewer || viewer.__wzFocusGuideBound) return;

    viewer.__wzFocusGuideBound = true;
    viewer.scene.preRender.addEventListener(() => {
        updateFocusGuideElement();
    });
}
function bindFocusInteractionTracking(viewer) {
    if (!viewer || __liveTrackFocusInputBound) return;
    __liveTrackFocusInputBound = true;
    const canvas = viewer.scene?.canvas;
    if (!canvas) return;
    const markManualIntent = (event) => {
        if (!isFocusSelectionActive()) return;
        // Double-click is commonly used for zoom gestures; do not treat it as
        // manual "unlock focus" intent.
        if (Number(event?.detail || 0) > 1) {
            __liveTrackManualCameraIntent = false;
            return;
        }
        __liveTrackManualCameraIntent = true;
    };
    const clearManualIntent = () => {
        __liveTrackManualCameraIntent = false;
    };
    canvas.addEventListener("mousedown", markManualIntent, { passive: true });
    canvas.addEventListener("touchstart", markManualIntent, { passive: true });
    canvas.addEventListener("dblclick", clearManualIntent, { passive: true });
    window.addEventListener("mouseup", clearManualIntent, { passive: true });
    window.addEventListener("touchend", clearManualIntent, { passive: true });
}

function buildLiveTrackRegistryEntry(track = {}, entity = null) {
    const metadata = getTrackMetadata(track);
    const subtype = resolveTrackSubtype(track);
    const lat = Number(track.lat);
    const lon = Number(track.lon);
    const altitudeFt = Number(track.altitude_ft || 0);
    const headingDeg = normalizeDegrees(Number(track.heading_deg || 0));
    const speedKts = Number(track.speed_kts || track.ground_speed_kts || 0);
    const currentPosition = getPositionCartesian(entity);
    let altitudeMeters = altitudeFt * 0.3048;
    if (currentPosition) {
        try {
            const cartographic = Cesium.Cartographic.fromCartesian(currentPosition);
            if (cartographic && Number.isFinite(cartographic.height)) {
                altitudeMeters = cartographic.height;
            }
        } catch { }
    }
    return {
        track_key: String(track.track_key || ""),
        icao24: String(track.icao24 || track.icao || metadata.icao || "").trim().toLowerCase(),
        title: getTrackDisplayTitle(track),
        subcategory: subtype,
        country: String(track.country || track.operator_country || metadata.country || "Unknown"),
        operator: getTrackOperatorLabel(track),
        model_name: getTrackModelLabel(track),
        type_code: sanitizeTrackText(track.type_code || metadata.type_code || ""),
        registration: getTrackRegistrationLabel(track),
        metadata,
        region: String(track.region || ""),
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        altitude_ft: Number.isFinite(altitudeFt) ? altitudeFt : 0,
        altitude_m: Number.isFinite(altitudeMeters) ? altitudeMeters : 0,
        heading_deg: headingDeg,
        speed_kts: Number.isFinite(speedKts) ? speedKts : 0,
        active: true,
        ended_at: null,
        last_seen_at: Date.now(),
        entity_id: entity?.id || `track-${track.track_key}`,
        path_history: []
    };
}
function dispatchLiveTrackRegistryUpdate() {
    window.__liveTrackRegistrySize = __liveTrackRegistry.size;
    if (__liveTrackRegistryDispatchTimer) return;
    __liveTrackRegistryDispatchTimer = setTimeout(() => {
        __liveTrackRegistryDispatchTimer = null;
        document.dispatchEvent(new CustomEvent("wz:aircraft-log-updated"));
    }, 120);
}
function pruneHistoryPoints(points = []) {
    const cutoff = Date.now() - LIVE_TRACK_HISTORY_RETENTION_MS;
    const filtered = points.filter((point) => point && Number(point.ts || 0) >= cutoff);
    while (filtered.length > LIVE_TRACK_HISTORY_MAX_POINTS) {
        filtered.shift();
    }
    return filtered;
}
function appendTrackHistoryPoint(trackKey, track = {}) {
    if (!trackKey) return;
    const entry = __liveTrackRegistry.get(trackKey);
    if (!entry) return;
    const lon = Number(track.lon);
    const lat = Number(track.lat);
    const altitudeFt = Number(track.altitude_ft || 0);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const point = {
        lon,
        lat,
        altitude_ft: Number.isFinite(altitudeFt) ? altitudeFt : 0,
        heading_deg: normalizeDegrees(Number(track.heading_deg || entry.heading_deg || 0)),
        ts: Date.now(),
    };
    const pathHistory = pruneHistoryPoints([...(entry.path_history || []), point]);
    entry.path_history = pathHistory;
    entry.last_seen_at = point.ts;
}
function pruneTrackRegistry() {
    const cutoff = Date.now() - LIVE_TRACK_HISTORY_RETENTION_MS;
    for (const [trackKey, entry] of __liveTrackRegistry.entries()) {
        const lastSeenAt = Number(entry?.last_seen_at || 0);
        if (lastSeenAt < cutoff && !entry?.active) {
            __liveTrackRegistry.delete(trackKey);
        } else if (entry?.path_history) {
            entry.path_history = pruneHistoryPoints(entry.path_history);
        }
    }
}
function markStaleTracksAsEnded() {
    const now = Date.now();
    for (const [trackKey, entry] of __liveTrackRegistry.entries()) {
        if (!entry?.active) continue;
        const lastSeen = Number(entry.last_seen_at || 0);
        if (!lastSeen) continue;
        if (now - lastSeen > LIVE_TRACK_STALE_TIMEOUT_MS) {
            entry.active = false;
            entry.ended_at = now;
        }
    }
}
function getRegionalFocusConfig() {
    const root = getComputedStyle(document.documentElement);
    const lon = parseFloat(root.getPropertyValue("--warzone-start-lon")) || 47.8;
    const lat = parseFloat(root.getPropertyValue("--warzone-start-lat")) || 30.2;
    const height = parseFloat(root.getPropertyValue("--warzone-focus-height")) || parseFloat(root.getPropertyValue("--warzone-start-height")) || 2350000;
    const heading = parseFloat(root.getPropertyValue("--warzone-start-heading")) || 0;
    const pitch = parseFloat(root.getPropertyValue("--warzone-start-pitch")) || -82;
    const roll = parseFloat(root.getPropertyValue("--warzone-start-roll")) || 0;
    return { lon, lat, height, heading, pitch, roll };
}
function returnToRegionalFocus(options = {}) {
    const viewer = window.__warzoneViewer;

    if (!viewer) return false;
    const cfg = getRegionalFocusConfig();
    viewer.camera.cancelFlight?.();
    __liveTrackIsCameraFlying = true;
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            cfg.lon,
            cfg.lat,
            Number(options.cameraHeight || cfg.height)
        ),
        orientation: {
            heading: Cesium.Math.toRadians(cfg.heading),
            pitch: Cesium.Math.toRadians(cfg.pitch),
            roll: Cesium.Math.toRadians(cfg.roll),
        },
        duration: Number(options.duration || 1.2),
        complete: () => { __liveTrackIsCameraFlying = false; },
        cancel: () => { __liveTrackIsCameraFlying = false; },
    });
    return true;
}

function ensureLiveTrackOverlayRoot(viewer) {
    if (__liveTrackOverlayRoot?.isConnected) {
        return __liveTrackOverlayRoot;
    }
    const host = viewer?.container || viewer?.cesiumWidget?.container || document.body;
    if (!host) return null;
    if (getComputedStyle(host).position === "static") {
        host.style.position = "relative";
    }

    const root = document.createElement("div");
    root.id = "wz-aircraft-focus-overlay";
    root.setAttribute("aria-hidden", "true");
    root.style.position = "absolute";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "0";
    root.style.height = "0";
    root.style.display = "none";
    root.style.pointerEvents = "none";
    root.style.zIndex = "28";
    root.style.transform = "translate(-50%, -50%)";

    const arms = [
        { cls: "is-top-left", x: -132, y: -88, rotate: 48 },
        { cls: "is-top-right", x: 40, y: -88, rotate: -48 },
        { cls: "is-bottom-left", x: -132, y: 82, rotate: -48 },
        { cls: "is-bottom-right", x: 40, y: 82, rotate: 48 },
    ];

    arms.forEach((item) => {
        const arm = document.createElement("span");
        arm.className = `wz-aircraft-focus-overlay__arm ${item.cls}`;
        arm.style.position = "absolute";
        arm.style.display = "block";
        arm.style.width = `${LIVE_TRACK_FOCUS_GUIDE_LENGTH_PX}px`;
        arm.style.height = `${LIVE_TRACK_FOCUS_GUIDE_THICKNESS_PX}px`;
        arm.style.borderRadius = "999px";
        arm.style.background = LIVE_TRACK_FOCUS_GUIDE_COLOR;
        arm.style.boxShadow = "0 0 10px rgba(24, 226, 219, 0.32)";
        arm.style.transformOrigin = "center";
        arm.style.transform = `translate(${item.x}px, ${item.y}px) rotate(${item.rotate}deg)`;
        arm.style.pointerEvents = "none";
        root.appendChild(arm);
    });

    host.appendChild(root);
    __liveTrackOverlayRoot = root;
    return root;
}

function getScreenPositionForTrack(trackKey = "") {
    const viewer = window.__warzoneViewer;

    if (!viewer || !trackKey) return null;
    const entity = viewer.entities.getById(`track-${trackKey}`);
    const position = getPositionCartesian(entity);
    if (!position) return null;
    try {
        const __sceneToWindow = Cesium.SceneTransforms.worldToWindowCoordinates ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
        const screen = __sceneToWindow(viewer.scene, position);
        if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
        return screen;
    } catch {
        return null;
    }
}
function syncLiveTrackFocusOverlay() {
    const viewer = window.__warzoneViewer;

    if (!viewer) return;
    const root = ensureLiveTrackOverlayRoot(viewer);
    if (!root) return;
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusMode = String(__liveTrackReplayState.mode || "") === "focus";
    if (!selectedTrackKey || !isFocusMode) {
        root.style.display = "none";
        return;
    }
    const screen = getScreenPositionForTrack(selectedTrackKey);
    if (!screen) {
        root.style.display = "none";
        return;
    }
    root.style.display = "block";
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
}
function clearFocusedTrackCameraLock() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    try {
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } catch { }
}
function syncFocusedTrackCamera() {
    const viewer = window.__warzoneViewer;
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusMode = String(__liveTrackReplayState.mode || "") === "focus";
    if (!viewer || !selectedTrackKey || !isFocusMode || __liveTrackIsCameraFlying) return;
    const entity = viewer.entities.getById(`track-${selectedTrackKey}`);
    const position = getPositionCartesian(entity);
    if (!position) return;
    try {
        const measuredRange = getCartesianDistanceMeters(viewer.camera?.positionWC, position);
        if (Number.isFinite(measuredRange) && measuredRange > 0) {
            __liveTrackFocusRangeMeters = clamp(
                measuredRange,
                LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
                LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
            );
        }
        viewer.camera.lookAt(
            position,
            new Cesium.HeadingPitchRange(
                0,
                Cesium.Math.toRadians(LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG),
                __liveTrackFocusRangeMeters
            )
        );
    } catch { }
}
function bindLiveTrackOverlay(viewer) {
    if (!viewer || __liveTrackOverlayBound) return;
    __liveTrackOverlayBound = true;
    ensureLiveTrackOverlayRoot(viewer);
    bindFocusInteractionTracking(viewer);
    viewer.scene.preRender.addEventListener(syncFocusedTrackCamera);
    viewer.scene.postRender.addEventListener(syncLiveTrackFocusOverlay);

    // Clear X-lines when user manually drags/rotates the globe.
    // __liveTrackIsCameraFlying guards against clearing during programmatic flyTo.
    viewer.camera.moveStart.addEventListener(() => {
        const hasSelection = Boolean(__liveTrackReplayState.selectedTrackKey);
        if (!hasSelection || __liveTrackIsCameraFlying) {
            return;
        }
        if (__liveTrackHardLockEnabled) {
            __liveTrackManualCameraIntent = false;
            return;
        }
        if (__liveTrackManualCameraIntent) {
            clearLiveTrackSelection({ animate: false });
        }
        __liveTrackManualCameraIntent = false;
    });
}
function resolvePickedTrackKey(picked) {
    const entity =
        picked?.id ||
        picked?.primitive?.id ||
        picked?.primitive?._id ||
        null;

    if (!entity) return "";
    if (entity.__wzOverlayEntity) return "";

    if (typeof entity.__trackKey === "string" && entity.__trackKey.trim()) {
        return entity.__trackKey.trim();
    }
    if (typeof entity.track_key === "string" && entity.track_key.trim()) {
        return entity.track_key.trim();
    }
    if (typeof entity.id === "string" && entity.id.startsWith("track-")) {
        return entity.id.replace(/^track-/, "").trim();
    }
    return "";
}
function bindLiveTrackPicking(viewer) {
    if (!viewer || __liveTrackClickBound) return;
    __liveTrackClickBound = true;
    let pendingSelectionClearTimer = null;
    const cancelPendingSelectionClear = () => {
        if (pendingSelectionClearTimer) {
            clearTimeout(pendingSelectionClearTimer);
            pendingSelectionClearTimer = null;
        }
    };
    const scheduleSelectionClear = () => {
        cancelPendingSelectionClear();
        pendingSelectionClearTimer = setTimeout(() => {
            pendingSelectionClearTimer = null;
            if (__liveTrackHardLockEnabled && isFocusSelectionActive()) return;
            if (__liveTrackReplayState.selectedTrackKey) {
                clearLiveTrackSelection({ animate: false });
            }
        }, 240);
    };

    __liveTrackClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    viewer.screenSpaceEventHandler?.removeInputAction?.(
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
    viewer.cesiumWidget?.screenSpaceEventHandler?.removeInputAction?.(
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );

    __liveTrackClickHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.endPosition);
        const trackKey = resolvePickedTrackKey(picked);
        viewer.container.style.cursor = trackKey ? "pointer" : "";
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    __liveTrackClickHandler.setInputAction((movement) => {
        if (__liveTrackHardLockEnabled && isFocusSelectionActive()) {
            cancelPendingSelectionClear();
            return;
        }
        const picked = viewer.scene.pick(movement.position);
        const trackKey = resolvePickedTrackKey(picked);
        if (!trackKey) {
            // Clicked empty space — clear X lines and deselect
            if (__liveTrackReplayState.selectedTrackKey) {
                // Defer clear slightly so LEFT_DOUBLE_CLICK can cancel this path.
                scheduleSelectionClear();
            }
            return;
        }
        cancelPendingSelectionClear();
        toggleLiveTrackSelection(trackKey);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    __liveTrackClickHandler.setInputAction(() => {
        // Keep focus lock on double-click interactions.
        cancelPendingSelectionClear();
        __liveTrackManualCameraIntent = false;
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
}


function clearReplayEntities() {
    const viewer = window.__warzoneViewer;

    if (!viewer) return;
    if (__liveTrackReplayState.markerTimer) {
        clearInterval(__liveTrackReplayState.markerTimer);
        __liveTrackReplayState.markerTimer = null;
    }
    if (__liveTrackReplayState.routeEntity) {
        viewer.entities.remove(__liveTrackReplayState.routeEntity);
        __liveTrackReplayState.routeEntity = null;
    }
    if (__liveTrackReplayState.markerEntity) {
        viewer.entities.remove(__liveTrackReplayState.markerEntity);
        __liveTrackReplayState.markerEntity = null;
    }
    __liveTrackReplayState.markerIndex = 0;
}
// ── Widget row highlight ──────────────────────────────────────────────────────
// Finds the aircraft tracker widget and applies/removes the .is-selected class
// on .wz-aircraft-item rows by matching [data-track-key]. Also scrolls the
// selected row into view.
// REQUIREMENT: Each rendered .wz-aircraft-item must have data-track-key="..."
// matching its track_key — set this when building the widget list HTML.
function syncWidgetRowHighlight(trackKey = "") {
    try {
        const widget = document.querySelector('[data-widget-id="aircraft"]');
        if (!widget) return;
        widget.querySelectorAll(".wz-aircraft-item[data-track-key]").forEach(row => {
            const match = row.dataset.trackKey === trackKey;
            row.classList.toggle("is-selected", match);
            if (match) {
                row.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
        });
    } catch {
        // Non-fatal — widget may not be rendered yet
    }
}

function setSelectedTrack(trackKey = "", mode = "") {
    __liveTrackReplayState.selectedTrackKey = trackKey || "";
    __liveTrackReplayState.mode = mode || "";
    if (!__liveTrackReplayState.selectedTrackKey || __liveTrackReplayState.mode !== "focus") {
        setLiveTrackHardLockInternal(false, { silent: true });
        clearFocusedTrackCameraLock();
    }
    document.dispatchEvent(new CustomEvent("wz:aircraft-track-selected", {
        detail: {
            trackKey: __liveTrackReplayState.selectedTrackKey,
            mode: __liveTrackReplayState.mode,
        },
    }));
    syncLiveTrackFocusOverlay();
    dispatchLiveTrackRegistryUpdate();
    // Highlight matching row in Aircraft Tracker widget
    syncWidgetRowHighlight(__liveTrackReplayState.selectedTrackKey);
}

function buildReplayPositions(pathHistory = []) {
    return pathHistory
        .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
        .map((point) => Cesium.Cartesian3.fromDegrees(
            Number(point.lon),
            Number(point.lat),
            Number(point.altitude_ft || 0) * 0.3048 + LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS
        ));
}
function startReplayForTrack(trackKey, options = {}) {
    const viewer = window.__warzoneViewer;

    if (!viewer || !trackKey) return false;
    const entry = __liveTrackRegistry.get(trackKey);
    if (!entry) return false;
    const pathHistory = pruneHistoryPoints(entry.path_history || []);
    if (pathHistory.length < 2) return false;
    clearReplayEntities();
    const positions = buildReplayPositions(pathHistory);
    if (positions.length < 2) return false;
    __liveTrackReplayState.routeEntity = viewer.entities.add({
        id: `track-replay-route-${trackKey}`,
        polyline: {
            positions,
            width: 2.4,
            material: Cesium.Color.fromCssColorString(getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)")).withAlpha(0.95),
            clampToGround: false,
        }
    });
    const firstPoint = pathHistory[0];
    __liveTrackReplayState.markerEntity = viewer.entities.add({
        id: `track-replay-marker-${trackKey}`,
        position: Cesium.Cartesian3.fromDegrees(
            Number(firstPoint.lon),
            Number(firstPoint.lat),
            Number(firstPoint.altitude_ft || 0) * 0.3048 + LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS
        ),
        model: {
            uri: resolveLiveTrackModelUri(entry),
            scale: getLiveTrackSubtypeScale(entry, getLiveTrackStyleConfig().scale),
            minimumPixelSize: getLiveTrackSubtypeMinPixelSize(entry, getLiveTrackStyleConfig().minimumPixelSize),
            maximumScale: getLiveTrackSubtypeMaxScale(entry, getLiveTrackStyleConfig().maximumScale),
        },
        orientation: buildTrackOrientation(
            entry,
            Number(firstPoint.lon),
            Number(firstPoint.lat),
            Number(firstPoint.altitude_ft || 0) * 0.3048 + LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS,
            Number(firstPoint.heading_deg || 0),
            0,
            0
        ),
    });
    __liveTrackReplayState.markerIndex = 0;
    __liveTrackReplayState.markerTimer = setInterval(() => {
        const path = entry.path_history || [];
        if (path.length < 2 || !__liveTrackReplayState.markerEntity) return;
        __liveTrackReplayState.markerIndex = (__liveTrackReplayState.markerIndex + 1) % path.length;
        const point = path[__liveTrackReplayState.markerIndex];
        const alt = Number(point.altitude_ft || 0) * 0.3048 + LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS;
        __liveTrackReplayState.markerEntity.position = Cesium.Cartesian3.fromDegrees(
            Number(point.lon),
            Number(point.lat),
            alt
        );
        __liveTrackReplayState.markerEntity.orientation = buildTrackOrientation(
            entry,
            Number(point.lon),
            Number(point.lat),
            alt,
            Number(point.heading_deg || 0),
            0,
            0
        );
        requestWarzoneRender();
    }, Number(options.stepMs || LIVE_TRACK_REPLAY_STEP_MS));
    const lastPoint = pathHistory[pathHistory.length - 1];
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            Number(lastPoint.lon),
            Number(lastPoint.lat),
            Math.max(Number(lastPoint.altitude_ft || 0) * 0.3048 + 140000, 180000)
        ),
        duration: Number(options.duration || 1.25),
    });
    setSelectedTrack(trackKey, "replay");
    requestWarzoneRender();
    return true;
}
/* ================= GEOMETRY / HEADING ================= */
function getHeadingDegreesFromPoints(lon1, lat1, lon2, lat2) {
    const phi1 = Cesium.Math.toRadians(lat1);
    const phi2 = Cesium.Math.toRadians(lat2);
    const deltaLambda = Cesium.Math.toRadians(lon2 - lon1);
    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    return normalizeDegrees(Cesium.Math.toDegrees(Math.atan2(y, x)));
}
function getTrackSubtypeKey(track = {}) {
    return String(track?.subcategory || track?.subtype || "")
        .trim()
        .toLowerCase();
}
function getLiveTrackModelHeadingOffsetDeg(track = {}) {
    const subtype = getTrackSubtypeKey(track);
    return LIVE_TRACK_MODEL_OFFSETS[subtype] ?? -90;
}
function getLiveTrackTailOffsetMeters(track = {}) {
    const subtype = getTrackSubtypeKey(track);
    return LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE[subtype] ?? 220;
}
function buildTrackOrientation(track, lon, lat, alt, headingDeg, pitchDeg = 0, rollDeg = 0) {
    const headingOffsetDeg = getLiveTrackModelHeadingOffsetDeg(track);
    return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(lon, lat, alt),
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(normalizeDegrees(headingDeg + headingOffsetDeg)),
            Cesium.Math.toRadians(pitchDeg),
            Cesium.Math.toRadians(rollDeg)
        )
    );
}
function getTrackResolvedHeading(track) {
    const previous = __liveTrackLastPositions.get(track.track_key);
    const fallbackHeading = normalizeDegrees(Number(track.heading_deg || 0));
    if (!previous) {
        return fallbackHeading;
    }
    const previousLon = Number(previous.lon);
    const previousLat = Number(previous.lat);
    const nextLon = Number(track.lon);
    const nextLat = Number(track.lat);
    if (
        !Number.isFinite(previousLon) ||
        !Number.isFinite(previousLat) ||
        !Number.isFinite(nextLon) ||
        !Number.isFinite(nextLat)
    ) {
        return fallbackHeading;
    }
    const lonDelta = Math.abs(nextLon - previousLon);
    const latDelta = Math.abs(nextLat - previousLat);
    if (lonDelta < 0.00001 && latDelta < 0.00001) {
        return fallbackHeading;
    }
    return getHeadingDegreesFromPoints(previousLon, previousLat, nextLon, nextLat);
}
/* ================= ATTITUDE ================= */
function getTrackVisualState(trackKey) {
    let state = __liveTrackVisualState.get(trackKey);
    if (!state) {
        state = {
            headingDeg: 0,
            pitchDeg: 0,
            rollDeg: 0,
            initialized: false,
        };
        __liveTrackVisualState.set(trackKey, state);
    }
    return state;
}
function getTrackAttitude(track, resolvedHeadingDeg) {
    const state = getTrackVisualState(track.track_key);
    const targetHeadingDeg = normalizeDegrees(resolvedHeadingDeg);
    if (!state.initialized) {
        state.headingDeg = targetHeadingDeg;
        state.pitchDeg = 0;
        state.rollDeg = 0;
        state.initialized = true;
    }
    const headingDeltaDeg = getShortestAngleDeltaDeg(state.headingDeg, targetHeadingDeg);
    state.headingDeg = normalizeDegrees(state.headingDeg + (headingDeltaDeg * 0.22));
    const targetRollDeg = clamp(headingDeltaDeg * 1.2, -18, 18);
    state.rollDeg = state.rollDeg + ((targetRollDeg - state.rollDeg) * 0.18);
    const previous = __liveTrackLastPositions.get(track.track_key);
    let targetPitchDeg = 0;
    if (previous) {
        const previousAltFt = Number(previous.altitude_ft || 0);
        const nextAltFt = Number(track.altitude_ft || 0);
        const climbDeltaFt = nextAltFt - previousAltFt;
        targetPitchDeg = clamp(climbDeltaFt / 900, -8, 8);
    }
    state.pitchDeg = state.pitchDeg + ((targetPitchDeg - state.pitchDeg) * 0.16);
    return {
        headingDeg: state.headingDeg,
        pitchDeg: state.pitchDeg,
        rollDeg: state.rollDeg,
    };
}
/* ================= TRAILS ================= */
function trimTrailEntries(entries = []) {
    const cutoff = Date.now() - LIVE_TRACK_TRAIL_MAX_AGE_MS;
    const filtered = entries.filter((entry) => entry && entry.ts >= cutoff);
    while (filtered.length > LIVE_TRACK_MAX_TRAIL_POINTS) {
        filtered.shift();
    }
    return filtered;
}
function buildTrackTrailCartesian(track = {}, lon, lat, alt, courseHeadingDeg = 0) {
    if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(alt)
    ) {
        return null;
    }
    const headingRad = Cesium.Math.toRadians(courseHeadingDeg);
    const tailOffsetMeters = getLiveTrackTailOffsetMeters(track);
    const metersPerDegLat = 110540;
    const metersPerDegLon = 111320 * Math.cos(Cesium.Math.toRadians(lat));
    const tailLon =
        lon - ((tailOffsetMeters * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));
    const tailLat =
        lat - ((tailOffsetMeters * Math.cos(headingRad)) / metersPerDegLat);
    const engineLon =
        tailLon - ((LIVE_TRACK_ENGINE_OFFSET_METERS * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));
    const engineLat =
        tailLat - ((LIVE_TRACK_ENGINE_OFFSET_METERS * Math.cos(headingRad)) / metersPerDegLat);
    try {
        return Cesium.Cartesian3.fromDegrees(engineLon, engineLat, alt);
    } catch {
        return null;
    }
}
function pushTrackTrailPoint(trackKey, track = {}, lon, lat, alt, courseHeadingDeg = 0) {
    if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(alt)
    ) {
        return;
    }
    const newPosition = buildTrackTrailCartesian(track, lon, lat, alt, courseHeadingDeg);
    if (!newPosition) return;
    const now = Date.now();
    let trail = trimTrailEntries(__liveTrackTrails.get(trackKey) || []);
    const lastEntry = trail[trail.length - 1];
    const lastPosition = lastEntry?.position || null;
    const movedMeters = getCartesianDistanceMeters(lastPosition, newPosition);
    if (!lastEntry || movedMeters >= LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS) {
        trail.push({
            position: newPosition,
            ts: now,
        });
    } else {
        trail[trail.length - 1] = {
            position: newPosition,
            ts: now,
        };
    }
    trail = trimTrailEntries(trail);
    __liveTrackTrails.set(trackKey, trail);
}
function seedTrackTrailFromHistory(trackKey, track = {}, historyPoints = []) {
    const entries = trimTrailEntries(
        (Array.isArray(historyPoints) ? historyPoints : [])
            .slice(-24)
            .map((point) => {
                const lon = Number(point?.lon);
                const lat = Number(point?.lat);
                const altitudeFt = Number(point?.altitude_ft || 0);
                const altitudeMeters = Number.isFinite(altitudeFt)
                    ? (altitudeFt * 0.3048) + LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS
                    : LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS;
                const headingDeg = normalizeDegrees(Number(point?.heading_deg || track.heading_deg || 0));
                const position = buildTrackTrailCartesian(track, lon, lat, altitudeMeters, headingDeg);
                if (!position) return null;
                return {
                    position,
                    ts: Number(point?.ts || Date.now()),
                };
            })
            .filter(Boolean)
    );
    if (entries.length >= 2) {
        __liveTrackTrails.set(trackKey, entries);
    }
}
function ensureTrackTrailVisible(trackKey, track = {}, lon, lat, alt, headingDeg = 0) {
    let trail = trimTrailEntries(__liveTrackTrails.get(trackKey) || []);
    if (trail.length >= 2) return;
    const historyPoints = __liveTrackRegistry.get(trackKey)?.path_history || [];
    if (historyPoints.length >= 2) {
        seedTrackTrailFromHistory(trackKey, track, historyPoints);
        trail = trimTrailEntries(__liveTrackTrails.get(trackKey) || []);
        if (trail.length >= 2) return;
    }
    const seedDistanceMeters = Math.max(900, getLiveTrackTailOffsetMeters(track) * 2.4);
    const headingRad = Cesium.Math.toRadians(headingDeg);
    const metersPerDegLat = 110540;
    const metersPerDegLon = 111320 * Math.cos(Cesium.Math.toRadians(lat));
    const seedLon =
        lon - ((seedDistanceMeters * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));
    const seedLat =
        lat - ((seedDistanceMeters * Math.cos(headingRad)) / metersPerDegLat);
    const now = Date.now();
    const seedEntries = trimTrailEntries([
        {
            position: buildTrackTrailCartesian(track, seedLon, seedLat, alt, headingDeg),
            ts: now - 6000,
        },
        {
            position: buildTrackTrailCartesian(track, lon, lat, alt, headingDeg),
            ts: now,
        },
    ].filter((entry) => entry.position));
    if (seedEntries.length >= 2) {
        __liveTrackTrails.set(trackKey, seedEntries);
    }
}
function pushTrackTrailPointFromCartesian(trackKey, track = {}, cartesianPosition, headingDeg = 0) {
    const currentPosition = getPositionCartesian(cartesianPosition);
    if (!currentPosition) return;
    let cartographic = null;
    try {
        cartographic = Cesium.Cartographic.fromCartesian(currentPosition);
    } catch {
        return;
    }
    if (
        !cartographic ||
        !Number.isFinite(cartographic.longitude) ||
        !Number.isFinite(cartographic.latitude) ||
        !Number.isFinite(cartographic.height)
    ) {
        return;
    }
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const alt = cartographic.height || 0;
    pushTrackTrailPoint(trackKey, track, lon, lat, alt, headingDeg);
}
function getOrCreateTrackTrailEntity(viewer, trackKey, track = {}) {
    const trailId = `track-trail-${trackKey}`;
    const style = getLiveTrackStyleConfig();
    const trailEnabled = getLiveTrackSubtypeTrailEnabled(track);
    const trailWidth = getLiveTrackSubtypeTrailWidth(track, style.trailWidth);
    let entity = viewer.entities.getById(trailId);
    if (!entity) {
        entity = viewer.entities.add({
            id: trailId,
            polyline: {
                show: trailEnabled,
                positions: new Cesium.CallbackProperty(() => {
                    const entries = trimTrailEntries(__liveTrackTrails.get(trackKey) || []);
                    return entries.map((entry) => entry.position);
                }, false),
                width: trailWidth,
                material: Cesium.Color.fromCssColorString(style.trailColor)
                    .withAlpha(style.trailOpacity),
                clampToGround: false,
            }
        });
    } else if (entity.polyline) {
        entity.polyline.show = trailEnabled;
        entity.polyline.width = trailWidth;
        entity.polyline.material =
            Cesium.Color.fromCssColorString(style.trailColor).withAlpha(style.trailOpacity);
    }
    return entity;
}
/* ================= ANIMATION ================= */
function animateTrackTo(entity, track = {}, nextLon, nextLat, nextAlt = 0, nextSourceTimestamp = Date.now()) {
    if (!entity) return;
    if (entity.__liveTrackAnimFrame) {
        cancelAnimationFrame(entity.__liveTrackAnimFrame);
        entity.__liveTrackAnimFrame = null;
    }
    const startCartesian = getPositionCartesian(entity);
    const nextCartesian = Cesium.Cartesian3.fromDegrees(nextLon, nextLat, nextAlt);
    const trackKey = entity.__trackKey;
    const headingDeg = entity.__currentHeadingDeg ?? Number(track.heading_deg || 0);
    const commitPosition = (cartesianPosition) => {
        entity.position = cartesianPosition;
        if (trackKey) {
            pushTrackTrailPointFromCartesian(trackKey, track, cartesianPosition, headingDeg);
        }
        requestWarzoneRenderBatched();
    };
    if (!startCartesian) {
        commitPosition(nextCartesian);
        return;
    }
    const distanceMeters = getCartesianDistanceMeters(startCartesian, nextCartesian);
    if (distanceMeters <= LIVE_TRACK_MIN_ANIM_DISTANCE_METERS) {
        commitPosition(nextCartesian);
        return;
    }
    const prevSourceTimestamp = Number(entity.__lastSourceTimestamp || 0);
    const sourceTimestamp = Number(nextSourceTimestamp || 0);
    const sourceGapMs =
        Number.isFinite(prevSourceTimestamp) &&
            prevSourceTimestamp > 0 &&
            Number.isFinite(sourceTimestamp) &&
            sourceTimestamp > prevSourceTimestamp
            ? sourceTimestamp - prevSourceTimestamp
            : LIVE_TRACK_DEFAULT_ANIM_MS;
    const cadenceDuration = clamp(sourceGapMs * 0.94, LIVE_TRACK_MIN_ANIM_MS, LIVE_TRACK_MAX_ANIM_MS);
    const distanceDuration = clamp(distanceMeters * 0.07, LIVE_TRACK_MIN_ANIM_MS, LIVE_TRACK_MAX_ANIM_MS);
    const duration = clamp(Math.max(cadenceDuration, distanceDuration), LIVE_TRACK_MIN_ANIM_MS, LIVE_TRACK_MAX_ANIM_MS);
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startAlt = startCartographic.height || 0;
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t;
        const lon = startLon + (nextLon - startLon) * eased;
        const lat = startLat + (nextLat - startLat) * eased;
        const alt = startAlt + (nextAlt - startAlt) * eased;
        const currentCartesian = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
        entity.position = currentCartesian;
        if (trackKey) {
            pushTrackTrailPointFromCartesian(trackKey, track, currentCartesian, headingDeg);
        }
        requestWarzoneRenderBatched();
        if (t < 1) {
            entity.__liveTrackAnimFrame = requestAnimationFrame(step);
        } else {
            entity.__liveTrackAnimFrame = null;
        }
    };
    entity.__liveTrackAnimFrame = requestAnimationFrame(step);
}
/* ================= ROUTE / ORBIT DEV HELPERS ================= */
function interpolateHeadingDegrees(fromDeg = 0, toDeg = 0, t = 0) {
    const a = normalizeDegrees(fromDeg);
    const b = normalizeDegrees(toDeg);
    let delta = b - a;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return normalizeDegrees(a + (delta * t));
}
function interpolateRoutePoint(from, to, t) {
    return {
        lat: from.lat + ((to.lat - from.lat) * t),
        lon: from.lon + ((to.lon - from.lon) * t),
        altitude_ft:
            (from.altitude_ft || 0) +
            (((to.altitude_ft || 0) - (from.altitude_ft || 0)) * t),
        heading_deg: interpolateHeadingDegrees(from.heading_deg || 0, to.heading_deg || 0, t),
    };
}
function metersToLatitudeDegrees(meters) {
    return meters / 110540;
}
function metersToLongitudeDegrees(meters, atLat) {
    const cosLat = Math.cos(Cesium.Math.toRadians(atLat));
    return meters / Math.max(111320 * Math.abs(cosLat), 1);
}
function buildOrbitPoint({
    center,
    radiusMeters = 30000,
    altitude_ft = 32000,
    startAngleDeg = 0,
    turnDirection = "right",
    t = 0,
}) {
    const directionSign = turnDirection === "left" ? -1 : 1;
    const orbitAngleDeg = normalizeDegrees(startAngleDeg + (directionSign * 360 * t));
    const orbitAngleRad = Cesium.Math.toRadians(orbitAngleDeg);
    const latOffsetDeg = metersToLatitudeDegrees(radiusMeters * Math.sin(orbitAngleRad));
    const lonOffsetDeg = metersToLongitudeDegrees(radiusMeters * Math.cos(orbitAngleRad), center.lat);
    const lat = center.lat + latOffsetDeg;
    const lon = center.lon + lonOffsetDeg;
    const headingDeg = normalizeDegrees(orbitAngleDeg + (turnDirection === "left" ? 180 : 0));
    return {
        lat,
        lon,
        altitude_ft,
        heading_deg: headingDeg,
    };
}
function buildWaypointRoutePoint(waypoints, t) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) return null;
    const segments = waypoints.length - 1;
    const scaled = Math.min(segments - 0.000001, Math.max(0, t * segments));
    const index = Math.floor(scaled);
    const localT = scaled - index;
    const from = waypoints[index];
    const to = waypoints[index + 1];
    return interpolateRoutePoint(from, to, localT);
}
/* ================= PUBLIC API ================= */
function resolveLiveTrackModelUri(track = {}) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    return LIVE_TRACK_MODEL_BY_SUBTYPE[subtype] || LIVE_TRACK_MODEL_URI;
}
export function upsertLiveTrack(track) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;
    const viewer = window.__warzoneViewer;

    bindLiveTrackOverlay(viewer);
    bindLiveTrackPicking(viewer);

    const id = `track-${track.track_key}`;
    const style = getLiveTrackStyleConfig();
    const modelUri = resolveLiveTrackModelUri(track);
    const subtypeScale = getLiveTrackSubtypeScale(track, style.scale);
    const subtypeMinPixelSize = getLiveTrackSubtypeMinPixelSize(track, style.minimumPixelSize);
    const subtypeMaxScale = getLiveTrackSubtypeMaxScale(track, style.maximumScale);
    const lat = Number(track.lat);
    const lon = Number(track.lon);
    const alt = (Number(track.altitude_ft || 0) * 0.3048) + LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS;
    const sourceTimestamp = getTrackSourceTimestamp(track);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const resolvedHeadingDeg = getTrackResolvedHeading(track);
    const attitude = getTrackAttitude(track, resolvedHeadingDeg);
    const billboard = shouldUseLiveTrackBillboards()
        ? buildLiveTrackBillboard(track, attitude.headingDeg)
        : null;
    let entity = viewer.entities.getById(id);

    if (!entity) {
        const entitySpec = {
            id,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            label: buildTrackLabel(track, track.track_key)
        };
        if (billboard) {
            entitySpec.billboard = billboard;
        } else {
            entitySpec.model = buildLiveTrackModelGraphics(
                modelUri,
                subtypeScale,
                subtypeMinPixelSize,
                subtypeMaxScale
            );
            entitySpec.orientation = buildTrackOrientation(
                track,
                lon,
                lat,
                alt,
                attitude.headingDeg,
                attitude.pitchDeg,
                attitude.rollDeg
            );
        }
        entity = viewer.entities.add(entitySpec);
        entity.__trackKey = track.track_key;
        entity.__trackPickable = true;
        entity.__currentHeadingDeg = attitude.headingDeg;
        entity.__lastSourceTimestamp = sourceTimestamp;
        __liveTrackEntities.set(id, entity);
    } else {
        entity.__trackKey = track.track_key;
        entity.__trackPickable = true;
        entity.__currentHeadingDeg = attitude.headingDeg;
        animateTrackTo(entity, track, lon, lat, alt, sourceTimestamp);
        entity.__lastSourceTimestamp = sourceTimestamp;
        if (billboard) {
            applyLiveTrackBillboard(entity, billboard);
        } else {
            applyLiveTrackModel(
                entity,
                track,
                modelUri,
                subtypeScale,
                subtypeMinPixelSize,
                subtypeMaxScale,
                lon,
                lat,
                alt,
                attitude
            );
        }
        if (entity.label) {
            applyTrackLabel(entity.label, track, track.track_key);
        }
    }

    if (!entity.billboard && !entity.model) {
        applyLiveTrackModel(
            entity,
            track,
            modelUri,
            subtypeScale,
            subtypeMinPixelSize,
            subtypeMaxScale,
            lon,
            lat,
            alt,
            attitude
        );
    }

    const existingRegistryEntry = __liveTrackRegistry.get(track.track_key);
    const nextRegistryEntry = {
        ...(existingRegistryEntry || {}),
        ...buildLiveTrackRegistryEntry(track, entity),
        active: true,
        ended_at: null,
        path_history: existingRegistryEntry?.path_history || [],
    };
    __liveTrackRegistry.set(track.track_key, nextRegistryEntry);
    appendTrackHistoryPoint(track.track_key, track);
    pruneTrackRegistry();
    dispatchLiveTrackRegistryUpdate();
    ensureTrackTrailVisible(track.track_key, track, lon, lat, alt, attitude.headingDeg);
    getOrCreateTrackTrailEntity(viewer, track.track_key, track);
    __liveTrackLastPositions.set(track.track_key, {
        lon,
        lat,
        altitude_ft: Number(track.altitude_ft || 0),
    });
    syncLiveTrackFocusOverlay();
    requestWarzoneRenderBatched(); // batched — coalesces 20+ aircraft updates into 1 render
}

export function clearLiveTrack(trackKey) {
    const viewer = window.__warzoneViewer;

    if (!trackKey) return;
    const entityId = `track-${trackKey}`;
    const trailId = `track-trail-${trackKey}`;
    if (viewer) {
        const entity = viewer.entities.getById(entityId);
        if (entity) {
            if (entity.__liveTrackAnimFrame) {
                cancelAnimationFrame(entity.__liveTrackAnimFrame);
                entity.__liveTrackAnimFrame = null;
            }
            viewer.entities.remove(entity);
        }
        const trail = viewer.entities.getById(trailId);
        if (trail) viewer.entities.remove(trail);
    }
    __liveTrackEntities.delete(entityId);
    __liveTrackTrails.delete(trackKey);
    __liveTrackLastPositions.delete(trackKey);
    __liveTrackVisualState.delete(trackKey);
    const existingRegistryEntry = __liveTrackRegistry.get(trackKey);
    if (existingRegistryEntry) {
        existingRegistryEntry.active = false;
        existingRegistryEntry.ended_at = Date.now();
        existingRegistryEntry.entity_id = "";
        existingRegistryEntry.path_history = pruneHistoryPoints(existingRegistryEntry.path_history || []);
    }
    if (__liveTrackReplayState.selectedTrackKey === trackKey && __liveTrackReplayState.mode === "focus") {
        setSelectedTrack("", "");
        hideFocusGuideElement();
    }
    pruneTrackRegistry();
    dispatchLiveTrackRegistryUpdate();
    requestWarzoneRenderBatched(); // batched
    if (!trackKey) return null;
    const entry = __liveTrackRegistry.get(trackKey);
    return entry ? { ...entry } : null;
}
export function getAllLiveTrackSnapshots(options = {}) {
    const includePathHistory = options?.includePathHistory === true;
    pruneTrackRegistry();
    markStaleTracksAsEnded();
    return [...__liveTrackRegistry.values()]
        .filter((entry) => Number(entry.last_seen_at || 0) >= Date.now() - LIVE_TRACK_HISTORY_RETENTION_MS)
        .map((entry) => ({
            ...entry,
            path_history: includePathHistory ? [...(entry.path_history || [])] : [],
        }))
        .sort((a, b) => {
            if (Boolean(b.active) !== Boolean(a.active)) return Number(b.active) - Number(a.active);
            return Number(b.last_seen_at || 0) - Number(a.last_seen_at || 0);
        });
}
export function focusLiveTrack(trackKey, options = {}) {
    const viewer = window.__warzoneViewer;

    if (!viewer || !trackKey) return false;
    clearReplayEntities();
    const entity = viewer.entities.getById(`track-${trackKey}`);
    if (!entity || !getPositionCartesian(entity)) return false;
    const focusRange = Math.max(
        LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS,
        Number(options.cameraHeight || 0)
    );
    __liveTrackFocusRangeMeters = clamp(
        focusRange,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
    __liveTrackManualCameraIntent = false;
    viewer.camera.cancelFlight?.();
    __liveTrackIsCameraFlying = true;
    setSelectedTrack(trackKey, "focus");
    bindFocusGuideTracking();
    updateFocusGuideElement();
    viewer.flyTo(entity, {
        duration: Number(options.duration || 1.15),
        offset: new Cesium.HeadingPitchRange(
            0,
            Cesium.Math.toRadians(LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG),
            focusRange
        ),
    }).then(() => {
        __liveTrackIsCameraFlying = false;
        syncFocusedTrackCamera();
    }).catch(() => {
        __liveTrackIsCameraFlying = false;
    });
    return true;
}
export function clearLiveTrackSelection(options = {}) {
    setLiveTrackHardLockInternal(false);
    __liveTrackManualCameraIntent = false;
    __liveTrackFocusRangeMeters = LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS;
    clearReplayEntities();
    setSelectedTrack("", "");
    clearFocusedTrackCameraLock();
    hideFocusGuideElement();
    return true;
}
export function getLiveTrackSelection() {
    return {
        track_key: __liveTrackReplayState.selectedTrackKey || "",
        mode: __liveTrackReplayState.mode || "",
    };
}
export function isLiveTrackHardLockEnabled() {
    return __liveTrackHardLockEnabled === true;
}
export function setLiveTrackHardLock(enabled = false) {
    return setLiveTrackHardLockInternal(enabled);
}
export function toggleLiveTrackHardLock() {
    return setLiveTrackHardLockInternal(!__liveTrackHardLockEnabled);
}
export function toggleLiveTrackSelection(trackKey, options = {}) {
    if (!trackKey) return false;
    if (__liveTrackReplayState.selectedTrackKey === trackKey) {
        return clearLiveTrackSelection(options);
    }
    const snapshot = __liveTrackRegistry.get(trackKey);
    if (!snapshot) return false;
    if (snapshot.active) {
        return focusLiveTrack(trackKey, options);
    }
    return startReplayForTrack(trackKey, options);
}
export function stopDevTrackSimulation(trackKey = "dev-track-fighter-1") {
    const timer = __devTrackTimers.get(trackKey);
    if (timer) {
        clearInterval(timer);
        __devTrackTimers.delete(trackKey);
    }
    if (__liveTrackReplayState.selectedTrackKey === trackKey && __liveTrackReplayState.mode === "replay") {
        clearReplayEntities();
        setSelectedTrack("", "");
    }
    clearLiveTrack(trackKey);
}
export function startDevTrackSimulation({
    track_key = "dev-track-fighter-1",
    title = "F-22 Demo Track",
    source_name = "DEV PANEL",
    category = "military",
    subcategory = "fighter",
    country = "USA",
    region = "Middle East",
    mode = "route", // "route" | "orbit-left" | "orbit-right"
    from,
    to,
    waypoints = null,
    center = null,
    radiusMeters = 30000,
    altitude_ft = 32000,
    startAngleDeg = 0,
    steps = 80,
    intervalMs = 180,
    loop = false,
} = {}) {
    const isOrbitMode = mode === "orbit-left" || mode === "orbit-right";
    const hasRoute = (from && to) || (Array.isArray(waypoints) && waypoints.length >= 2);
    if (!isOrbitMode && !hasRoute) return;
    if (isOrbitMode && !center) return;
    stopDevTrackSimulation(track_key);
    let currentStep = 0;
    let initialPoint = null;
    if (isOrbitMode) {
        initialPoint = buildOrbitPoint({
            center,
            radiusMeters,
            altitude_ft,
            startAngleDeg,
            turnDirection: mode === "orbit-left" ? "left" : "right",
            t: 0,
        });
    } else if (Array.isArray(waypoints) && waypoints.length >= 2) {
        initialPoint = waypoints[0];
    } else {
        initialPoint = from;
    }
    upsertLiveTrack({
        track_key,
        title,
        source_name,
        category,
        subcategory,
        country,
        region,
        lat: initialPoint.lat,
        lon: initialPoint.lon,
        altitude_ft: initialPoint.altitude_ft || altitude_ft,
        heading_deg: initialPoint.heading_deg || 0,
        status: "active",
    });
    const timer = setInterval(() => {
        currentStep += 1;
        let t = currentStep / steps;
        if (loop) {
            t = t % 1;
        } else {
            t = Math.min(1, t);
        }
        let point = null;
        if (isOrbitMode) {
            point = buildOrbitPoint({
                center,
                radiusMeters,
                altitude_ft,
                startAngleDeg,
                turnDirection: mode === "orbit-left" ? "left" : "right",
                t,
            });
        } else if (Array.isArray(waypoints) && waypoints.length >= 2) {
            point = buildWaypointRoutePoint(waypoints, t);
        } else {
            point = interpolateRoutePoint(from, to, t);
        }
        if (!point) return;
        upsertLiveTrack({
            track_key,
            title,
            source_name,
            category,
            subcategory,
            country,
            region,
            lat: point.lat,
            lon: point.lon,
            altitude_ft: Math.round(point.altitude_ft || 0),
            heading_deg: Math.round(point.heading_deg || 0),
            status: "active",
        });
        if (!loop && t >= 1) {
            stopDevTrackSimulation(track_key);
        }
    }, intervalMs);
    __devTrackTimers.set(track_key, timer);
}
