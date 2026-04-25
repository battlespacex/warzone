// File Path: /assets/js/warzone-live-airforce.js
import * as Cesium from "cesium";
/* ================= STATE ================= */
let __liveTrackEntities = new Map();
const __devTrackTimers = new Map();
const __liveTrackTrails = new Map();
const __liveTrackTrailPositionsCache = new Map();
const __liveTrackLastPositions = new Map();
const __liveTrackVisualState = new Map();
const __liveTrackRegistry = new Map();
const __liveTrackBillboardCache = new Map();
const __liveTrackIconCodeCache = new Map();
const LIVE_TRACK_BILLBOARD_CACHE_MAX_ITEMS = 160;
function setLimitedMapCache(map, key, value, maxItems = LIVE_TRACK_BILLBOARD_CACHE_MAX_ITEMS) {
    if (!(map instanceof Map)) return value;
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    const max = Math.max(24, Number(maxItems || LIVE_TRACK_BILLBOARD_CACHE_MAX_ITEMS));
    while (map.size > max) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
    return value;
}
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
let __liveTrackOverlayLastVisible = false;
let __liveTrackOverlayLastX = Number.NaN;
let __liveTrackOverlayLastY = Number.NaN;
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
let __liveTrackFocusHeadingDeg = 0;
let __liveTrackFocusPitchDeg = -89;
let __liveTrackCtrlTiltDragState = null;
let __liveTrackUserCameraInteracting = false;
let __liveTrackFocusResumeTimer = null;
let __liveTrackLastFocusCameraSyncAt = 0;


const LIVE_TRACK_LABEL_CAMERA_HEIGHT_MAX = 420000;

const LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX = 850000;
const LIVE_TRACK_FOCUS_GUIDE_COLOR = "rgba(24, 226, 219, 0.72)";
const LIVE_TRACK_FOCUS_GUIDE_LENGTH_PX = 92;
const LIVE_TRACK_FOCUS_GUIDE_GAP_PX = 42;
const LIVE_TRACK_FOCUS_GUIDE_THICKNESS_PX = 4;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS = 95000;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG = -89;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG = -89;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG = -20;
const LIVE_TRACK_FOCUS_CAMERA_HEADING_SENSITIVITY_DEG_PER_PX = 0.28;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_SENSITIVITY_DEG_PER_PX = 0.18;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS = 12000;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS = 3200000;
const LIVE_TRACK_FOCUS_CAMERA_SYNC_MIN_MS = 26;
const LIVE_TRACK_FOCUS_CAMERA_RESUME_DELAY_MS = 120;
const LIVE_TRACK_REGISTRY_DISPATCH_DEBOUNCE_MS = 260;
let __liveTrackFocusGuideEl = null;


/* ================= CONFIG ================= */
let LIVE_TRACK_MODEL_HEADING_OFFSET_DEFAULT = -90;
const LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS = 18;
const LIVE_TRACK_FALLBACK_ALTITUDE_FT_BY_SUBTYPE = Object.freeze({
    fighter: 26000,
    awacs: 31000,
    recon: 24000,
    isr: 28000,
    tanker: 30000,
    refueler: 30000,
    transport: 22000,
    logistics: 22000,
    logistic: 22000,
    vip: 18000,
    bomber: 28000,
    trainer: 12000,
    drone: 14000,
    uav: 14000,
    helicopter: 1800,
    aircraft: 16000,
});
const LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE = {
    fighter: 180,
    awacs: 260,
    recon: 160,
    drone: 120,
    vip: 240,
};
const LIVE_TRACK_MAX_TRAIL_POINTS = 280;
const LIVE_TRACK_TRAIL_MAX_AGE_MS = 30 * 60 * 1000;
const LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS = 80;
const LIVE_TRACK_TRAIL_ALTITUDE_OFFSET_METERS = 55;
const LIVE_TRACK_TRAIL_SMOOTHING_DEFAULT = 0.55;
const LIVE_TRACK_TRAIL_SMOOTH_MIN_POINTS = 5;
const LIVE_TRACK_TRAIL_SMOOTH_KEEP_TAIL_POINTS = 2;
const LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS = 520;
const LIVE_TRACK_SEED_HISTORY_MAX_POINTS = 120;
const LIVE_TRACK_HISTORY_MAX_JUMP_METERS = 220000;
const LIVE_TRACK_HISTORY_MAX_SPEED_MPS = 1900;
const LIVE_TRACK_MIN_ANIM_DISTANCE_METERS = 2;
const LIVE_TRACK_MIN_ANIM_MS = 700;
const LIVE_TRACK_MAX_ANIM_MS = 4400;
const LIVE_TRACK_DEFAULT_ANIM_MS = 3600;
const LIVE_TRACK_FOCUS_MIN_ANIM_MS = 140;
const LIVE_TRACK_FOCUS_MAX_ANIM_MS = 1700;
const LIVE_TRACK_FOCUS_DEFAULT_ANIM_MS = 620;
const LIVE_TRACK_ANIMATE_ONLY_SELECTED = true;
const LIVE_TRACK_HISTORY_RETENTION_MS = 12 * 60 * 60 * 1000;
const LIVE_TRACK_HISTORY_MAX_POINTS = 720;
const LIVE_TRACK_REGISTRY_MAX_ITEMS = 900;
const LIVE_TRACK_INACTIVE_HISTORY_MAX_POINTS = 18;
const LIVE_TRACK_REPLAY_STEP_MS = 180;
const LIVE_TRACK_BILLBOARD_CANVAS_SIZE = 96;
const LIVE_AIRCRAFT_MODEL_BASE_PATH = "/assets/images/models/air";
const LIVE_AIRCRAFT_MODEL_FILE_PREFIX = "model-aircraft-";
const LIVE_AIRCRAFT_MODEL_DEFAULT_CODE = "ff-1";
const LIVE_AIRCRAFT_MODEL_CODES = new Set([
    "aw-1", "aw-2", "aw-3",
    "bb-1", "bb-2",
    "dd-1",
    "ff-1", "ff-2", "ff-3", "ff-4", "ff-5",
    "hh-1", "hh-2",
    "rr-1",
    "tn-1", "tn-2",
    "tp-1", "tp-2",
]);
// Dev calibration mapping: model code names mirror live-aircraft PNG codes.
const LIVE_AIRCRAFT_MODEL_CODE_BY_SUBTYPE = Object.freeze({
    bomber: "bb-1",
    fighter: "ff-1",
    awacs: "aw-1",
    recon: "aw-1",
    isr: "aw-1",
    tanker: "tn-2",
    refueler: "tn-2",
    transport: "tp-2",
    logistics: "tp-2",
    logistic: "tp-2",
    drone: "dd-1",
    uav: "dd-1",
    helicopter: "hh-1",
    vip: "tp-2",
    trainer: "ff-1",
    aircraft: "ff-1",
});
const LIVE_TRACK_STALE_TIMEOUT_MS = 90 * 1000;
const LIVE_TRACK_RENDER_MODE = Object.freeze({
    PNG: "png",
    CHAR: "char",
    MODEL: "model",
});
const LIVE_TRACK_MODEL_DEFAULT_MAX_ACTIVE = 16;
const LIVE_TRACK_MODEL_DEFAULT_ZOOM_HEIGHT = 280000;
const LIVE_TRACK_CHAR_FALLBACK_DEFAULT_COUNT = 90;
const LIVE_AIRCRAFT_ICON_BASE_PATH = "/assets/images/live";
const LIVE_AIRCRAFT_ICON_DEFAULT_CODE = "ff-5";
const LIVE_AIRCRAFT_ICON_CODES = new Set([
    "bb-1", "bb-2",
    "ff-1", "ff-2", "ff-3", "ff-4", "ff-5",
    "aw-1", "aw-2", "aw-3",
    "tn-1", "tn-2",
    "tp-1", "tp-2",
    "hh-1", "hh-2",
    "rr-1",
    "dd-1",
]);
const LIVE_AIRCRAFT_US_TOKENS = [
    "united states",
    "united states of america",
    "usa",
    "american",
    "us air force",
    "usaf",
    "u s air force",
    "us navy",
    "u s navy",
    "usn",
    "us marine corps",
    "u s marine corps",
    "usmc",
    "air national guard",
];
const LIVE_AIRCRAFT_PAKISTAN_TOKENS = [
    "pakistan",
    "pakistani",
    "pakistan air force",
];
const LIVE_AIRCRAFT_TURKEY_TOKENS = [
    "turkey",
    "turkish",
];
const LIVE_AIRCRAFT_CHINA_TOKENS = [
    "china",
    "chinese",
    "prc",
    "people s republic of china",
    "people s liberation army",
    "pla",
    "plaf",
];
const LIVE_AIRCRAFT_EUROPEAN_TOKENS = [
    "europe",
    "european",
    "united kingdom",
    "uk",
    "england",
    "great britain",
    "france",
    "french",
    "italy",
    "italian",
    "germany",
    "german",
    "spain",
    "spanish",
    "greece",
    "greek",
    "netherlands",
    "dutch",
    "belgium",
    "belgian",
    "denmark",
    "danish",
    "norway",
    "norwegian",
    "sweden",
    "swedish",
    "finland",
    "finnish",
    "poland",
    "polish",
    "portugal",
    "portuguese",
    "romania",
    "romanian",
    "czech republic",
    "czech",
    "slovakia",
    "hungary",
    "austria",
    "switzerland",
    "croatia",
    "slovenia",
    "serbia",
    "bulgaria",
    "estonia",
    "latvia",
    "lithuania",
    "iceland",
];
const LIVE_AIRCRAFT_NATO_TOKENS = [
    "nato",
    "north atlantic treaty organization",
    "united states",
    "canada",
    "united kingdom",
    "uk",
    "france",
    "germany",
    "italy",
    "spain",
    "portugal",
    "netherlands",
    "belgium",
    "denmark",
    "norway",
    "poland",
    "greece",
    "turkey",
    "romania",
    "czech republic",
    "hungary",
    "slovakia",
    "bulgaria",
    "croatia",
    "slovenia",
    "albania",
    "montenegro",
    "north macedonia",
    "estonia",
    "latvia",
    "lithuania",
    "finland",
    "sweden",
];
const LIVE_AIRCRAFT_GULF_TOKENS = [
    "saudi arabia",
    "united arab emirates",
    "uae",
    "qatar",
    "kuwait",
    "bahrain",
    "oman",
];
const LIVE_AIRCRAFT_MIDDLE_EAST_TOKENS = [
    "middle east",
    "middle eastern",
    "saudi arabia",
    "united arab emirates",
    "uae",
    "qatar",
    "kuwait",
    "bahrain",
    "oman",
    "jordan",
    "lebanon",
    "iraq",
    "syria",
    "yemen",
    "egypt",
];
const LIVE_AIRCRAFT_ISRAEL_TOKENS = [
    "israel",
    "israeli",
];
const LIVE_AIRCRAFT_RUSSIAN_STYLE_TOKENS = [
    "russia",
    "russian",
    "india",
    "indian",
    "malaysia",
    "malaysian",
    "algeria",
    "algerian",
    "syria",
    "syrian",
    "egypt",
    "egyptian",
    "vietnam",
    "vietnamese",
    "iran",
    "iranian",
    "iraq",
    "belarus",
    "belarusian",
    "kazakhstan",
    "armenia",
    "myanmar",
    "ethiopia",
    "angola",
    "venezuela",
    "north korea",
    "dprk",
];
const LIVE_AIRCRAFT_EX_SOVIET_TOKENS = [
    "russia",
    "belarus",
    "kazakhstan",
    "uzbekistan",
    "turkmenistan",
    "tajikistan",
    "kyrgyzstan",
    "armenia",
    "azerbaijan",
    "georgia",
    "ukraine",
    "moldova",
];
const LIVE_AIRCRAFT_DRONE_PATTERNS = [
    /\b(drone|uav|ucav|uas)\b/i,
    /\b(mq ?1|mq ?9|rq ?1|rq ?4|rq ?7|rq ?170|mq ?4c|tb ?2|bayraktar|anka|aksungur|wing loong|wingloong|ch ?4|ch ?5|shahed|mohajer|heron|hermes|switchblade|lancet|orlan|forpost|okhotnik)\b/i,
];
const LIVE_AIRCRAFT_RECON_PATTERNS = [
    /\b(recon|reconnaissance|isr|surveillance|patrol|sigint|elint|maritime patrol)\b/i,
    /\b(rc ?135|ep ?3|p ?3|p ?8|u ?2|il ?20|tu ?214r|rivet joint|cobra ball|combat sent|poseidon|orion|global hawk)\b/i,
];
const LIVE_AIRCRAFT_AWACS_PATTERNS = [
    /\b(awacs|aew|aewc|early warning|wedgetail|sentry|hawkeye|erieye|phalcon|netra|command and control|c2)\b/i,
    /\b(e ?2|e ?3|e ?7|a ?50|a ?100|kj ?200|kj ?500|kj ?2000|saab ?2000)\b/i,
];
const LIVE_AIRCRAFT_TANKER_PATTERNS = [
    /\b(tanker|refuel|refueller|refueling|air to air refuel|boom refuel)\b/i,
    /\b(kc ?10|kc ?46|kc ?135|il ?78|yy ?20|mrtt|voyager)\b/i,
];
const LIVE_AIRCRAFT_TRANSPORT_PATTERNS = [
    /\b(transport|airlift|cargo|airlifter|logistics)\b/i,
    /\b(c ?17|c ?130|hc ?130|mc ?130|c ?5|c ?27j|cn ?235|c ?295|a ?400m|c ?390|an ?12|an ?22|an ?26|an ?72|an ?124|il ?76|y ?8|y ?9|y ?20|globemaster|hercules|atlas|millennium|galaxy|spartan|ruslan)\b/i,
];
const LIVE_AIRCRAFT_HELICOPTER_PATTERNS = [
    /\b(helicopter|rotary|rotorcraft|gunship|utility helicopter|attack helicopter|lift helicopter)\b/i,
    /\b(ah ?1|ah ?64|mi ?8|mi ?17|mi ?24|mi ?25|mi ?28|mi ?35|ka ?52|z ?10|t ?129|uh ?60|s ?70|ch ?47|nh ?90|aw ?101|h ?225|bell)\b/i,
];
const LIVE_AIRCRAFT_BOMBER_PATTERNS = [
    /\b(bomber|strategic bomber|strike bomber|gunship)\b/i,
    /\b(b ?1|b ?2|b ?52|tu ?22|tu ?95|tu ?160|h ?6|h ?6k|ac ?130)\b/i,
];
const LIVE_AIRCRAFT_FIGHTER_PATTERNS = [
    /\b(fighter|interceptor|multirole|air superiority|combat aircraft)\b/i,
    /\b(f ?14|f ?15|f ?16|f ?18|fa ?18|f a 18|f ?22|f ?35|a ?10|su ?24|su ?25|su ?27|su ?30|su ?33|su ?34|su ?35|su ?57|mig ?21|mig ?23|mig ?29|mig ?31|j ?7|j ?8|j ?10|j ?11|j ?15|j ?16|j ?20|jh ?7|jf ?17|fc ?1|tejas|eurofighter|typhoon|rafale|gripen|mirage|tornado)\b/i,
];
const LIVE_AIRCRAFT_US_BOMBER_PATTERNS = [
    /\b(b ?1|b ?2|b ?52)\b/i,
];
const LIVE_AIRCRAFT_US_FIGHTER_PATTERNS = [
    /\b(f ?14|f ?15|f ?16|f ?18|fa ?18|f a 18|f ?22|f ?35|a ?10)\b/i,
];
const LIVE_AIRCRAFT_EU_FIGHTER_PATTERNS = [
    /\b(eurofighter|typhoon|rafale|gripen|tornado|mirage ?2000|mirage ?f ?1|mirage)\b/i,
];
const LIVE_AIRCRAFT_RU_FIGHTER_PATTERNS = [
    /\b(su ?24|su ?25|su ?27|su ?30|su ?33|su ?34|su ?35|su ?57|mig ?21|mig ?23|mig ?29|mig ?31)\b/i,
];
const LIVE_AIRCRAFT_CN_FIGHTER_PATTERNS = [
    /\b(j ?7|j ?8|j ?10|j ?11|j ?15|j ?16|j ?20|jh ?7)\b/i,
];
const LIVE_AIRCRAFT_FF5_FIGHTER_PATTERNS = [
    /\b(jf ?17|fc ?1)\b/i,
];
const LIVE_AIRCRAFT_AWACS_AW1_PATTERNS = [
    /\b(e ?3|e ?7|wedgetail|sentry|hawkeye|saab ?2000|erieye)\b/i,
];
const LIVE_AIRCRAFT_TANKER_TN1_PATTERNS = [
    /\b(kc ?10|kc ?46|kc ?135|stratotanker|extender|pegasus|boom refuel)\b/i,
];
const LIVE_AIRCRAFT_TRANSPORT_TP1_PATTERNS = [
    /\b(c ?130|hc ?130|mc ?130|a ?400m|c ?390|y ?8|y ?9|c ?27j|cn ?235|c ?295|hercules|atlas|millennium|spartan)\b/i,
];
const LIVE_AIRCRAFT_TRANSPORT_TP2_PATTERNS = [
    /\b(c ?17|c ?5|il ?76|y ?20|an ?124|globemaster|galaxy|ruslan)\b/i,
];
const LIVE_AIRCRAFT_TRANSPORT_HEAVY_ROLE_PATTERNS = [
    /\b(strategic|heavy|intercontinental|outsized)\b/i,
    /\b(strategic airlift|heavy airlift|long range airlift)\b/i,
    /\b(size|weight class|payload class)\s*(heavy|strategic)\b/i,
];
const LIVE_AIRCRAFT_TRANSPORT_TACTICAL_ROLE_PATTERNS = [
    /\b(tactical|medium|intra theater|intra theatre)\b/i,
    /\b(short runway|rough runway|short field)\b/i,
];
// Model-only hard overrides (does not change PNG icon classification).
const LIVE_AIRCRAFT_MODEL_FORCE_TP1_PATTERNS = [
    /\b(c[\s-]?130[a-z0-9-]*|ac[\s-]?130[a-z0-9-]*|hc[\s-]?130[a-z0-9-]*|mc[\s-]?130[a-z0-9-]*|hercules)\b/i,
];
const LIVE_AIRCRAFT_MODEL_FORCE_TP2_PATTERNS = [
    /\b(c[\s-]?17[a-z0-9-]*|globemaster)\b/i,
];
const LIVE_AIRCRAFT_HELO_ATTACK_PATTERNS = [
    /\b(ah ?1[a-z]?|ah ?64[a-z]?|apache|mi ?24|mi ?25|mi ?28|mi ?35|ka ?52|z ?10|t ?129|tiger|rooivalk|gunship|attack helicopter)\b/i,
];

function normalizeAircraftIconText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function hasAnyToken(paddedHaystack = " ", tokens = []) {
    return tokens.some((token) => token && paddedHaystack.includes(` ${token} `));
}
function hasAnyPattern(haystack = "", patterns = []) {
    return patterns.some((pattern) => pattern.test(haystack));
}
function buildLiveAircraftIconSignature(track = {}) {
    const metadata = getTrackMetadata(track);
    return [
        track.subcategory,
        track.subtype,
        track.role,
        track.category,
        track.size,
        track.aircraft_role,
        track.aircraft_category,
        track.aircraft_size,
        metadata.role,
        metadata.category,
        metadata.size,
        metadata.aircraft_role,
        metadata.aircraftRole,
        metadata.aircraft_category,
        metadata.aircraftCategory,
        metadata.aircraft_size,
        metadata.aircraftSize,
        metadata.airlift_role,
        metadata.airliftRole,
        metadata.airlift_category,
        metadata.airliftCategory,
        metadata.weight_class,
        metadata.weightClass,
        track.type_code,
        track.icao_type,
        metadata.type_code,
        track.model_name,
        track.model,
        track.variant,
        metadata.model_name,
        track.aircraft_type,
        track.description,
        track.title,
        track.callsign,
        track.flight,
        metadata.callsign,
        track.operator,
        track.owner,
        metadata.operator,
        track.country,
        track.region,
        metadata.country,
        track.origin,
        metadata.origin,
        metadata.platform_origin,
        metadata.country_of_origin,
        metadata.manufacturer,
        metadata.manufacturer_origin,
    ]
        .map((value) => String(value || "").trim().toLowerCase())
        .join("|");
}
function buildLiveAircraftIconContext(track = {}) {
    const metadata = getTrackMetadata(track);
    const subtype = String(resolveTrackSubtype(track) || "")
        .trim()
        .toLowerCase();
    const values = [
        subtype,
        track.subcategory,
        track.subtype,
        track.role,
        track.category,
        track.size,
        track.aircraft_role,
        track.aircraft_category,
        track.aircraft_size,
        metadata.role,
        metadata.category,
        metadata.size,
        metadata.aircraft_role,
        metadata.aircraftRole,
        metadata.aircraft_category,
        metadata.aircraftCategory,
        metadata.aircraft_size,
        metadata.aircraftSize,
        metadata.airlift_role,
        metadata.airliftRole,
        metadata.airlift_category,
        metadata.airliftCategory,
        metadata.weight_class,
        metadata.weightClass,
        track.type_code,
        track.icao_type,
        metadata.type_code,
        track.model_name,
        track.model,
        track.variant,
        metadata.model_name,
        track.aircraft_type,
        track.description,
        track.title,
        track.callsign,
        track.flight,
        metadata.callsign,
        track.operator,
        track.owner,
        metadata.operator,
        track.country,
        track.region,
        metadata.country,
        track.origin,
        metadata.origin,
        metadata.platform_origin,
        metadata.country_of_origin,
        metadata.manufacturer,
        metadata.manufacturer_origin,
    ]
        .map(normalizeAircraftIconText)
        .filter(Boolean);
    const haystack = values.join(" ").trim();
    const paddedHaystack = haystack ? ` ${haystack} ` : " ";
    const country = normalizeAircraftIconText(track.country || metadata.country || track.region || "");
    const operator = normalizeAircraftIconText(track.operator || track.owner || metadata.operator || "");
    const origin = normalizeAircraftIconText(
        track.origin ||
        metadata.origin ||
        metadata.platform_origin ||
        metadata.country_of_origin ||
        metadata.manufacturer_origin
    );
    const affiliation = [country, operator, origin]
        .filter(Boolean)
        .join(" ")
        .trim();
    const paddedAffiliation = affiliation ? ` ${affiliation} ` : " ";
    return {
        subtype,
        haystack,
        paddedHaystack,
        paddedAffiliation,
    };
}
function hasAircraftTokens(context = {}, tokens = []) {
    return (
        hasAnyToken(context.paddedAffiliation || " ", tokens) ||
        hasAnyToken(context.paddedHaystack || " ", tokens)
    );
}
function isUsAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_US_TOKENS);
}
function isPakistanAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_PAKISTAN_TOKENS);
}
function isTurkeyAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_TURKEY_TOKENS);
}
function isChinaAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_CHINA_TOKENS);
}
function isEuropeanAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_EUROPEAN_TOKENS);
}
function isNatoAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_NATO_TOKENS);
}
function isGulfAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_GULF_TOKENS);
}
function isMiddleEastAffiliation(context = {}) {
    return (
        hasAircraftTokens(context, LIVE_AIRCRAFT_MIDDLE_EAST_TOKENS) ||
        isGulfAffiliation(context)
    );
}
function isIsraelAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_ISRAEL_TOKENS);
}
function isRussianStyleAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_RUSSIAN_STYLE_TOKENS);
}
function isExSovietAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_EX_SOVIET_TOKENS);
}
function resolveLiveAircraftRole(context = {}) {
    const subtype = String(context.subtype || "").trim().toLowerCase();
    if (["uav", "drone", "ucav"].includes(subtype)) return "drone";
    if (["recon", "isr", "patrol", "surveillance"].includes(subtype)) return "recon";
    if (["awacs", "aew", "aewc"].includes(subtype)) return "awacs";
    if (["tanker", "refueler", "refueller"].includes(subtype)) return "tanker";
    if (["transport", "airlift", "logistics", "logistic"].includes(subtype)) return "transport";
    if (["helicopter", "rotary"].includes(subtype)) return "helicopter";
    if (["bomber"].includes(subtype)) return "bomber";
    if (["fighter", "interceptor", "multirole"].includes(subtype)) return "fighter";

    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_DRONE_PATTERNS)) return "drone";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_AWACS_PATTERNS)) return "awacs";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TANKER_PATTERNS)) return "tanker";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_PATTERNS)) return "transport";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_HELICOPTER_PATTERNS)) return "helicopter";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_BOMBER_PATTERNS)) return "bomber";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_RECON_PATTERNS)) return "recon";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_FIGHTER_PATTERNS)) return "fighter";
    return "";
}
function resolveBomberIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_US_BOMBER_PATTERNS) || isUsAffiliation(context)) {
        return "bb-1";
    }
    return "bb-2";
}
function resolveFighterIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (isPakistanAffiliation(context) || hasAnyPattern(haystack, LIVE_AIRCRAFT_FF5_FIGHTER_PATTERNS)) {
        return "ff-5";
    }
    // Exact platform family takes priority over operator fallback.
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_CN_FIGHTER_PATTERNS)) return "ff-4";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_US_FIGHTER_PATTERNS)) return "ff-1";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_EU_FIGHTER_PATTERNS)) return "ff-2";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_RU_FIGHTER_PATTERNS)) return "ff-3";

    if (isUsAffiliation(context)) return "ff-1";
    if (isEuropeanAffiliation(context)) return "ff-2";
    if (isChinaAffiliation(context)) return "ff-4";
    if (isRussianStyleAffiliation(context)) return "ff-3";
    return "ff-5";
}
function resolveAwacsIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    // AWACS bucket rules:
    // TR -> aw-3 model (PNG aliases to aw-1 image),
    // RU/CN/IN/IL and Russian-style -> aw-2,
    // US/NATO/EU/ME/PK and AW1 class hints -> aw-1,
    // unknown -> aw-2.
    if (isTurkeyAffiliation(context)) return "aw-3";
    if (
        isChinaAffiliation(context) ||
        isRussianStyleAffiliation(context) ||
        isExSovietAffiliation(context) ||
        isIsraelAffiliation(context)
    ) {
        return "aw-2";
    }
    if (
        hasAnyPattern(haystack, LIVE_AIRCRAFT_AWACS_AW1_PATTERNS) ||
        isUsAffiliation(context) ||
        isPakistanAffiliation(context) ||
        isNatoAffiliation(context) ||
        isEuropeanAffiliation(context) ||
        isMiddleEastAffiliation(context)
    ) {
        return "aw-1";
    }
    return "aw-2";
}
function resolveTankerIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (
        hasAnyPattern(haystack, LIVE_AIRCRAFT_TANKER_TN1_PATTERNS) ||
        isUsAffiliation(context) ||
        isTurkeyAffiliation(context) ||
        isNatoAffiliation(context)
    ) {
        return "tn-1";
    }
    return "tn-2";
}
function resolveTransportIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    // Heavy/strategic transport gets tp-2; otherwise tactical/medium gets tp-1.
    // A400M defaults to tp-1 unless explicitly marked heavy/strategic.
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_HEAVY_ROLE_PATTERNS)) return "tp-2";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_TP2_PATTERNS)) return "tp-2";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_TP1_PATTERNS)) return "tp-1";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_TACTICAL_ROLE_PATTERNS)) return "tp-1";
    return "tp-1";
}
function resolveHelicopterIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_HELO_ATTACK_PATTERNS)) return "hh-1";
    return "hh-2";
}
function resolveForcedAircraftModelCode(track = {}) {
    const context = buildLiveAircraftIconContext(track);
    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_MODEL_FORCE_TP2_PATTERNS)) return "tp-2";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_MODEL_FORCE_TP1_PATTERNS)) return "tp-1";
    return "";
}
function resolveLiveAircraftIconCode(track = {}) {
    const trackCacheKey = String(track.track_key || "").trim();
    const iconSignature = trackCacheKey
        ? buildLiveAircraftIconSignature(track)
        : "";
    if (trackCacheKey && iconSignature) {
        const cached = __liveTrackIconCodeCache.get(trackCacheKey);
        if (cached && cached.signature === iconSignature && LIVE_AIRCRAFT_ICON_CODES.has(cached.iconCode)) {
            return cached.iconCode;
        }
    }

    const context = buildLiveAircraftIconContext(track);
    let iconCode = LIVE_AIRCRAFT_ICON_DEFAULT_CODE;
    const role = resolveLiveAircraftRole(context);
    switch (role) {
        case "bomber":
            iconCode = resolveBomberIconCode(context);
            break;
        case "fighter":
            iconCode = resolveFighterIconCode(context);
            break;
        case "awacs":
            iconCode = resolveAwacsIconCode(context);
            break;
        case "tanker":
            iconCode = resolveTankerIconCode(context);
            break;
        case "transport":
            iconCode = resolveTransportIconCode(context);
            break;
        case "helicopter":
            iconCode = resolveHelicopterIconCode(context);
            break;
        case "recon":
            iconCode = "rr-1";
            break;
        case "drone":
            iconCode = "dd-1";
            break;
        default:
            iconCode = LIVE_AIRCRAFT_ICON_DEFAULT_CODE;
            break;
    }
    const resolvedIconCode = LIVE_AIRCRAFT_ICON_CODES.has(iconCode)
        ? iconCode
        : LIVE_AIRCRAFT_ICON_DEFAULT_CODE;
    if (trackCacheKey && iconSignature) {
        __liveTrackIconCodeCache.set(trackCacheKey, {
            signature: iconSignature,
            iconCode: resolvedIconCode,
        });
    }
    return resolvedIconCode;
}
function getLiveAircraftIconPath(iconCode = LIVE_AIRCRAFT_ICON_DEFAULT_CODE) {
    const safeCode = LIVE_AIRCRAFT_ICON_CODES.has(iconCode)
        ? iconCode
        : LIVE_AIRCRAFT_ICON_DEFAULT_CODE;
    // PNG set has aw-1/aw-2 only; aw-3 model uses aw-1 PNG for display fallback.
    const pngCode = safeCode === "aw-3" ? "aw-1" : safeCode;
    return `${LIVE_AIRCRAFT_ICON_BASE_PATH}/live-aircraft-${pngCode}.png`;
}
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
function getCssText(varName, fallback = "") {
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}
function getLiveAircraftModelTintConfig() {
    const whiteness = getCssNumber("--warzone-live-aircraft-model-whiteness", Number.NaN);
    const legacyBlendAmount = getCssNumber("--warzone-live-aircraft-model-color-blend-amount", 0.42);
    const alpha = clamp(
        getCssNumber("--warzone-live-aircraft-model-color-alpha", 0.96),
        0,
        1
    );
    const blendAmount = clamp(
        Number.isFinite(whiteness) ? whiteness : legacyBlendAmount,
        0,
        1
    );
    return { alpha, blendAmount };
}
function getViewerCameraHeightMeters() {
    const height = Number(window.__warzoneViewer?.camera?.positionCartographic?.height ?? Number.NaN);
    return Number.isFinite(height) ? height : Number.NaN;
}
function getAircraftPngScaleByZoomBand() {
    const baseScale = getCssNumber("--warzone-live-aircraft-png-scale", 0.06);
    const zoomInScale = getCssNumber("--warzone-live-aircraft-png-scale-zoom-in", baseScale);
    const zoomOutScale = getCssNumber("--warzone-live-aircraft-png-scale-zoom-out", baseScale);
    // Single split height for PNG zoom bands: <= split uses zoom-in scale, > split uses zoom-out scale.
    const zoomSplitHeight = Math.max(
        0,
        getCssNumber("--warzone-live-aircraft-png-zoom-split-height", 20000)
    );
    const cameraHeight = getViewerCameraHeightMeters();
    if (Number.isFinite(cameraHeight) && cameraHeight <= zoomSplitHeight) {
        return zoomInScale;
    }
    return zoomOutScale;
}
function getAircraftModelScaleByZoomBand() {
    const baseScale = getCssNumber("--warzone-live-aircraft-model-scale", getCssNumber("--warzone-live-track-scale", 16));
    const zoomInScale = getCssNumber("--warzone-live-aircraft-model-scale-zoom-in", baseScale);
    const zoomOutScale = getCssNumber("--warzone-live-aircraft-model-scale-zoom-out", baseScale);
    const zoomSplitHeight = Math.max(
        0,
        getCssNumber(
            "--warzone-live-aircraft-model-zoom-split-height",
            getCssNumber("--warzone-live-aircraft-png-zoom-split-height", 20000)
        )
    );
    const cameraHeight = getViewerCameraHeightMeters();
    if (Number.isFinite(cameraHeight) && cameraHeight <= zoomSplitHeight) {
        return zoomInScale;
    }
    return zoomOutScale;
}
function getLiveTrackStyleConfig() {
    return {
        trailColor: getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)"),
        trailOpacity: getCssNumber("--warzone-live-track-opacity", 0.95),
        trailWidth: getCssNumber("--warzone-live-track-width", 3.4),
        scale: getAircraftModelScaleByZoomBand(),
        minimumPixelSize: getCssNumber(
            "--warzone-live-aircraft-model-min-pixel-size",
            getCssNumber("--warzone-live-track-min-pixel-size", 140)
        ),
        maximumScale: getCssNumber(
            "--warzone-live-aircraft-model-max-scale",
            getCssNumber("--warzone-live-track-max-scale", 520)
        ),
        depthTestDisableDistance: getCssNumber("--warzone-live-aircraft-depth-test-disable-distance", Number.POSITIVE_INFINITY),
    };
}
function getLiveTrackSubtypeScale(track = {}, fallbackScale = 16) {
    // One shared aircraft model scale band for all GLB types.
    const bandScale = getAircraftModelScaleByZoomBand();
    if (Number.isFinite(bandScale) && bandScale > 0) {
        return clamp(bandScale, 0.01, 3000);
    }
    return clamp(getCssNumber("--warzone-live-aircraft-model-scale", fallbackScale), 0.01, 3000);
}
function getLiveTrackSubtypeMinPixelSize(track = {}, fallbackValue = 140) {
    // One shared aircraft model min-pixel control for all GLB aircraft.
    return Math.max(0, Number(fallbackValue) || 0);
}
function getLiveTrackSubtypeMaxScale(track = {}, fallbackValue = 520) {
    // One shared aircraft model max-scale control for all GLB aircraft.
    return Math.max(1, Number(fallbackValue) || 1);
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
function getLiveTrackBillboardScale(mode = LIVE_TRACK_RENDER_MODE.PNG) {
    if (mode === LIVE_TRACK_RENDER_MODE.CHAR) {
        return clamp(getCssNumber("--warzone-live-aircraft-char-scale", 0.95), 0.14, 2.8);
    }
    // PNG assets can be high-resolution, so allow much smaller global scales.
    return clamp(
        getAircraftPngScaleByZoomBand(),
        0.01,
        2.8
    );
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
function getLiveTrackGlyphIconChar() {
    const raw = getCssText("--warzone-live-aircraft-icon-char", "Δ")
        .replace(/^['"]|['"]$/g, "")
        .trim();
    return raw || "Δ";
}
function getLiveTrackGlyphIconColor(subtype = "") {
    return getCssColor("--warzone-live-aircraft-icon-color", getLiveTrackBillboardColor(subtype));
}
function getLiveTrackGlyphFontSizePx() {
    return clamp(getCssNumber("--warzone-live-aircraft-icon-font-size", 66), 28, 120);
}
function createAircraftPngIcon(track = {}) {
    const iconCode = resolveLiveAircraftIconCode(track);
    const cacheKey = `png|asset|${iconCode}`;
    if (__liveTrackBillboardCache.has(cacheKey)) {
        return __liveTrackBillboardCache.get(cacheKey);
    }
    const iconPath = getLiveAircraftIconPath(iconCode);
    setLimitedMapCache(__liveTrackBillboardCache, cacheKey, iconPath);
    return iconPath;
}
function createAircraftCharIcon(subtype = "aircraft") {
    const key = String(subtype || "aircraft").trim().toLowerCase() || "aircraft";
    const glyphChar = getLiveTrackGlyphIconChar();
    const glyphColorCss = getLiveTrackGlyphIconColor(key);
    const glyphFontPx = getLiveTrackGlyphFontSizePx();
    const cacheKey = `char|${key}|${glyphChar}|${glyphColorCss}|${glyphFontPx}`;
    if (__liveTrackBillboardCache.has(cacheKey)) return __liveTrackBillboardCache.get(cacheKey);

    const size = LIVE_TRACK_BILLBOARD_CANVAS_SIZE;
    const half = size / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);

    ctx.font = `900 ${glyphFontPx}px 'Barlow Condensed', 'Rajdhani', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.fillStyle = glyphColorCss;
    ctx.fillText(glyphChar, half, half + 1);

    const dataUrl = canvas.toDataURL("image/png");
    setLimitedMapCache(__liveTrackBillboardCache, cacheKey, dataUrl);
    return dataUrl;
}
function resolveLiveTrackBillboardImage(track = {}, mode = LIVE_TRACK_RENDER_MODE.PNG) {
    const metadata = getTrackMetadata(track);
    const directImage = [
        track.icon_url,
        track.image_url,
        metadata.icon_url,
        metadata.image_url,
    ]
        .map((value) => String(value || "").trim())
        .find((value) => value && (/^data:image\//i.test(value) || /\.(png|svg|webp|jpe?g)(\?|#|$)/i.test(value)));
    if (mode === LIVE_TRACK_RENDER_MODE.PNG && directImage) return directImage;

    if (mode === LIVE_TRACK_RENDER_MODE.CHAR) {
        return createAircraftCharIcon(resolveTrackSubtype(track));
    }
    return directImage || createAircraftPngIcon(track) || getLiveAircraftIconPath();
}
function getAircraftVisualPolicy() {
    const config = window.__stratopsConfig?.aircraftVisualPolicy;
    return config && typeof config === "object" ? config : {};
}
function normalizeAircraftRenderMode(value = "") {
    const normalized = String(value || "")
        .replace(/^['"]|['"]$/g, "")
        .trim()
        .toLowerCase();
    if (!normalized || normalized === "auto" || normalized === "default" || normalized === "inherit") {
        return "";
    }
    if (
        normalized === "png" ||
        normalized === "img" ||
        normalized === "image" ||
        normalized === "billboard"
    ) {
        return LIVE_TRACK_RENDER_MODE.PNG;
    }
    if (
        normalized === "model" ||
        normalized === "glb" ||
        normalized === "gltf" ||
        normalized === "3d"
    ) {
        return LIVE_TRACK_RENDER_MODE.MODEL;
    }
    if (
        normalized === "char" ||
        normalized === "glyph" ||
        normalized === "text"
    ) {
        return LIVE_TRACK_RENDER_MODE.CHAR;
    }
    return "";
}
function resolveConfiguredAircraftRenderMode(policy = {}, isSelected = false) {
    const defaultCssMode = getCssText("--warzone-live-aircraft-render-mode-default", "");
    const focusedCssMode = getCssText("--warzone-live-aircraft-render-mode-focused", "");
    const defaultPolicyMode = policy.defaultMode ?? policy.defaultRenderMode ?? policy.normalMode ?? policy.baseMode ?? policy.default;
    const focusedPolicyMode = policy.focusedMode ?? policy.focusedRenderMode ?? policy.focusMode ?? policy.selectedMode ?? policy.selectedRenderMode;
    const defaultMode = normalizeAircraftRenderMode(defaultPolicyMode || defaultCssMode);
    const focusedMode = normalizeAircraftRenderMode(focusedPolicyMode || focusedCssMode);
    return isSelected ? (focusedMode || defaultMode) : defaultMode;
}
function isAircraftModelCalibrationEnabled() {
    const policy = getAircraftVisualPolicy();
    if (policy.disableModels === true || policy.forcePng === true) return false;
    if (window.__WZ_AIRCRAFT_MODEL_CALIBRATION === true) return true;
    if (policy.enableModelCalibration === true || policy.modelCalibrationEnabled === true) return true;
    return getCssNumber("--warzone-live-aircraft-model-calibration-enabled", 0) >= 0.5;
}
function isAircraftModelPrimaryEnabled() {
    const policy = getAircraftVisualPolicy();
    if (policy.disableModels === true || policy.forcePng === true) return false;
    if (isAircraftModelCalibrationEnabled()) return true;
    return getCssNumber("--warzone-live-aircraft-model-primary-enabled", 1) >= 0.5;
}
function countActiveAircraftTracks() {
    let count = 0;
    __liveTrackRegistry.forEach((entry) => {
        if (entry?.active) count += 1;
    });
    return count;
}
function resolveAircraftRenderMode(track = {}, modelUri = "") {
    const policy = getAircraftVisualPolicy();
    const forcedMode = normalizeAircraftRenderMode(policy.mode || policy.renderMode || "");
    if (forcedMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
    if (forcedMode === LIVE_TRACK_RENDER_MODE.PNG) return LIVE_TRACK_RENDER_MODE.PNG;
    if (forcedMode === LIVE_TRACK_RENDER_MODE.MODEL) {
        return modelUri ? LIVE_TRACK_RENDER_MODE.MODEL : LIVE_TRACK_RENDER_MODE.PNG;
    }
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const thisTrackKey = String(track.track_key || "");
    const isSelected = Boolean(selectedTrackKey && selectedTrackKey === thisTrackKey);
    const configuredStateMode = resolveConfiguredAircraftRenderMode(policy, isSelected);
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.PNG) return LIVE_TRACK_RENDER_MODE.PNG;
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.MODEL) {
        return modelUri ? LIVE_TRACK_RENDER_MODE.MODEL : LIVE_TRACK_RENDER_MODE.PNG;
    }
    if (!isAircraftModelPrimaryEnabled()) return LIVE_TRACK_RENDER_MODE.PNG;
    if (!modelUri) return LIVE_TRACK_RENDER_MODE.PNG;

    const maxActive = Math.max(
        1,
        Math.floor(
            getCssNumber(
                "--warzone-live-aircraft-model-max-active",
                Number(policy.modelMaxActive ?? LIVE_TRACK_MODEL_DEFAULT_MAX_ACTIVE)
            )
        )
    );
    if (!isSelected && countActiveAircraftTracks() > maxActive) {
        return LIVE_TRACK_RENDER_MODE.PNG;
    }
    const cameraHeight = getViewerCameraHeightMeters();
    const maxZoomHeight = Math.max(
        0,
        getCssNumber(
            "--warzone-live-aircraft-model-max-zoom-height",
            Number(policy.modelMaxZoomHeight ?? LIVE_TRACK_MODEL_DEFAULT_ZOOM_HEIGHT)
        )
    );
    if (!isSelected && Number.isFinite(cameraHeight) && cameraHeight > maxZoomHeight) {
        return LIVE_TRACK_RENDER_MODE.PNG;
    }
    return LIVE_TRACK_RENDER_MODE.MODEL;
}
function buildLiveTrackBillboard(track = {}, headingDeg = 0, mode = LIVE_TRACK_RENDER_MODE.PNG) {
    if (!shouldUseLiveTrackBillboards()) return null;
    const style = getLiveTrackStyleConfig();
    const image = resolveLiveTrackBillboardImage(track, mode);
    if (!image) return null;
    const scale = getLiveTrackBillboardScale(mode);
    return {
        image,
        scale,
        rotation: Cesium.Math.toRadians(-normalizeDegrees(headingDeg)),
        alignedAxis: Cesium.Cartesian3.UNIT_Z,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: style.depthTestDisableDistance,
    };
}
function shouldUseLiveTrackBillboards() {
    // Keep billboard support enabled so PNG/CHAR fallback remains available.
    return true;
}
function buildLiveTrackModelGraphics(modelUri, subtypeScale, subtypeMinPixelSize, subtypeMaxScale) {
    const tint = getLiveAircraftModelTintConfig();
    return {
        uri: modelUri,
        scale: subtypeScale,
        minimumPixelSize: subtypeMinPixelSize,
        maximumScale: subtypeMaxScale,
        color: Cesium.Color.WHITE.withAlpha(tint.alpha),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: tint.blendAmount,
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
    entity.model = undefined;
    entity.orientation = undefined;
    return true;
}
function applyLiveTrackModel(entity, track, modelUri, subtypeScale, subtypeMinPixelSize, subtypeMaxScale, lon, lat, alt, attitude) {
    const tint = getLiveAircraftModelTintConfig();
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
    }
    entity.model.color = Cesium.Color.WHITE.withAlpha(tint.alpha);
    entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
    entity.model.colorBlendAmount = tint.blendAmount;
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
        depthTestDisableDistance: getCssNumber("--warzone-live-label-depth-test-disable-distance", Number.POSITIVE_INFINITY),
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
    __renderDebounceTimer = requestAnimationFrame(() => {
        __renderDebounceTimer = null;
        window.__warzoneViewer?.scene?.requestRender?.();
    }); // coalesces all updates in the same paint frame
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
    if (/(transport|airlift|cargo|logistics|globemaster|hercules|atlas\b|millennium\b|a-?400m\b|c-17\b|c17\b|c-5\b|c5\b|c-130\b|hc-130\b|mc-130\b|c130\b|c-390\b|c390\b|c-40\b|c40\b|an-124\b|an124\b|an-12\b|an12\b|il-76\b|il76\b|y-8\b|y8\b|y-9\b|y9\b|y-20\b|y20\b|cn-235\b|cn235\b|c295\b)/.test(haystack)) return "transport";
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
function parseNonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function feetToMeters(feet = 0) {
    const parsed = Number(feet);
    return Number.isFinite(parsed) ? parsed * 0.3048 : 0;
}
function isGroundState(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "ground" || normalized === "true";
}
function getTrackReportedAltitudeFt(track = {}) {
    const metadata = getTrackMetadata(track);
    return parseNonNegativeNumber(track.altitude_ft ?? metadata.altitude_ft ?? null);
}
function getTrackPointReportedAltitudeFt(point = {}) {
    return parseNonNegativeNumber(point?.altitude_ft ?? null);
}
function isTrackOnGround(track = {}) {
    const metadata = getTrackMetadata(track);
    return isGroundState(track.on_ground) || isGroundState(metadata.on_ground);
}
function isTrackPointOnGround(point = {}) {
    return isGroundState(point?.on_ground);
}
function getTrackFallbackAltitudeFt(track = {}) {
    const subtype = resolveTrackSubtype(track).trim().toLowerCase() || "aircraft";
    return LIVE_TRACK_FALLBACK_ALTITUDE_FT_BY_SUBTYPE[subtype]
        ?? LIVE_TRACK_FALLBACK_ALTITUDE_FT_BY_SUBTYPE.aircraft;
}
function getTrackResolvedAltitudeFt(track = {}) {
    if (isTrackOnGround(track)) return 0;
    const reportedAltitudeFt = getTrackReportedAltitudeFt(track);
    if (reportedAltitudeFt != null) return reportedAltitudeFt;
    return getTrackFallbackAltitudeFt(track);
}
function getTrackPointResolvedAltitudeFt(point = {}, track = {}) {
    if (isTrackPointOnGround(point)) return 0;
    const reportedAltitudeFt = getTrackPointReportedAltitudeFt(point);
    if (reportedAltitudeFt != null) return reportedAltitudeFt;
    return getTrackResolvedAltitudeFt(track);
}
function getRenderAltitudeClearanceMeters(altitudeFt = 0) {
    return Number(altitudeFt || 0) > 0
        ? LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS
        : Math.min(LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS, 8);
}
function getTrackRenderAltitudeMeters(track = {}) {
    const altitudeFt = getTrackResolvedAltitudeFt(track);
    return feetToMeters(altitudeFt) + getRenderAltitudeClearanceMeters(altitudeFt);
}
function getTrackPointRenderAltitudeMeters(point = {}, track = {}) {
    const altitudeFt = getTrackPointResolvedAltitudeFt(point, track);
    return feetToMeters(altitudeFt) + getRenderAltitudeClearanceMeters(altitudeFt);
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
        disableDepthTestDistance: labelStyle.depthTestDisableDistance,
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
    controller.enableInputs = true;
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
    if (!__liveTrackHardLockEnabled) {
        __liveTrackCtrlTiltDragState = null;
        __liveTrackUserCameraInteracting = false;
        __liveTrackLastFocusCameraSyncAt = 0;
        if (__liveTrackFocusResumeTimer) {
            clearTimeout(__liveTrackFocusResumeTimer);
            __liveTrackFocusResumeTimer = null;
        }
        clearFocusedTrackCameraLock();
    }
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

function hideLiveTrackFocusVisuals() {
    hideFocusGuideElement();
    if (__liveTrackOverlayRoot) {
        if (__liveTrackOverlayLastVisible) {
            __liveTrackOverlayRoot.style.display = "none";
        }
    }
    __liveTrackOverlayLastVisible = false;
    __liveTrackOverlayLastX = Number.NaN;
    __liveTrackOverlayLastY = Number.NaN;
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
    const hasFocusCameraModifier = (event) => Boolean(event?.ctrlKey || event?.metaKey);
    const markManualIntent = (event) => {
        if (!isFocusSelectionActive()) return;
        if (__liveTrackHardLockEnabled) {
            __liveTrackManualCameraIntent = false;
            return;
        }
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
    const startCtrlTiltDrag = (event) => {
        if (!isFocusSelectionActive() || !__liveTrackHardLockEnabled) return;
        if (!hasFocusCameraModifier(event) || Number(event.button) !== 0) return;
        __liveTrackCtrlTiltDragState = { active: true };
        __liveTrackManualCameraIntent = false;
        requestWarzoneRender();
    };
    const updateCtrlTiltDrag = (event) => {
        if (!__liveTrackCtrlTiltDragState || !isFocusSelectionActive() || !__liveTrackHardLockEnabled) return;
        const buttons = Number(event?.buttons || 0);
        if (!hasFocusCameraModifier(event) || (buttons & 1) !== 1) {
            stopCtrlTiltDrag();
            return;
        }
        __liveTrackManualCameraIntent = false;
    };
    const stopCtrlTiltDrag = () => {
        __liveTrackCtrlTiltDragState = null;
    };
    canvas.addEventListener("mousedown", startCtrlTiltDrag, { passive: true });
    canvas.addEventListener("mousedown", markManualIntent, { passive: true });
    canvas.addEventListener("touchstart", markManualIntent, { passive: true });
    canvas.addEventListener("dblclick", clearManualIntent, { passive: true });
    window.addEventListener("mousemove", updateCtrlTiltDrag, { passive: true });
    window.addEventListener("mouseup", clearManualIntent, { passive: true });
    window.addEventListener("touchend", clearManualIntent, { passive: true });
    window.addEventListener("mouseup", stopCtrlTiltDrag, { passive: true });
    window.addEventListener("blur", stopCtrlTiltDrag, { passive: true });
    window.addEventListener("keyup", (event) => {
        if (String(event?.key || "") === "Control" || String(event?.key || "") === "Meta") {
            stopCtrlTiltDrag();
        }
    }, { passive: true });
}

function buildLiveTrackRegistryEntry(track = {}, entity = null) {
    const metadata = getTrackMetadata(track);
    const subtype = resolveTrackSubtype(track);
    const lat = Number(track.lat);
    const lon = Number(track.lon);
    const altitudeFt = getTrackReportedAltitudeFt(track);
    const headingDeg = normalizeDegrees(Number(track.heading_deg || 0));
    const speedKts = Number(track.speed_kts || track.ground_speed_kts || 0);
    const currentPosition = getPositionCartesian(entity);
    let altitudeMeters = feetToMeters(getTrackResolvedAltitudeFt(track));
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
        altitude_ft: altitudeFt ?? 0,
        altitude_m: Number.isFinite(altitudeMeters) ? altitudeMeters : 0,
        heading_deg: headingDeg,
        speed_kts: Number.isFinite(speedKts) ? speedKts : 0,
        active: true,
        ended_at: null,
        last_seen_at: Date.now(),
        entity_id: entity?.id || `track-${track.track_key}`,
        on_ground: isTrackOnGround(track),
        path_history: []
    };
}
function dispatchLiveTrackRegistryUpdate() {
    window.__liveTrackRegistrySize = __liveTrackRegistry.size;
    if (__liveTrackRegistryDispatchTimer) return;
    __liveTrackRegistryDispatchTimer = setTimeout(() => {
        __liveTrackRegistryDispatchTimer = null;
        document.dispatchEvent(new CustomEvent("wz:aircraft-log-updated"));
    }, LIVE_TRACK_REGISTRY_DISPATCH_DEBOUNCE_MS);
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
    const altitudeFt = getTrackResolvedAltitudeFt(track);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const point = {
        lon,
        lat,
        altitude_ft: Number.isFinite(altitudeFt) ? altitudeFt : 0,
        heading_deg: normalizeDegrees(Number(track.heading_deg || entry.heading_deg || 0)),
        on_ground: isTrackOnGround(track),
        ts: Date.now(),
    };
    const history = [...(entry.path_history || [])];
    const minTrailDistanceMeters = getTrackTrailMinDistanceMeters(track);
    const previousPoint = history.length ? history[history.length - 1] : null;
    if (previousPoint) {
        try {
            const previousCartesian = Cesium.Cartesian3.fromDegrees(
                Number(previousPoint.lon),
                Number(previousPoint.lat),
                getTrackPointRenderAltitudeMeters(previousPoint, track)
            );
            const nextCartesian = Cesium.Cartesian3.fromDegrees(
                lon,
                lat,
                getTrackPointRenderAltitudeMeters(point, track)
            );
            const movedMeters = getCartesianDistanceMeters(previousCartesian, nextCartesian);
            if (movedMeters < minTrailDistanceMeters) {
                history[history.length - 1] = point;
            } else {
                history.push(point);
            }
        } catch {
            history.push(point);
        }
    } else {
        history.push(point);
    }
    entry.path_history = pruneHistoryPoints(history);
    entry.last_seen_at = point.ts;
}
function pruneTrackRegistry() {
    const cutoff = Date.now() - LIVE_TRACK_HISTORY_RETENTION_MS;
    for (const [trackKey, entry] of __liveTrackRegistry.entries()) {
        const lastSeenAt = Number(entry?.last_seen_at || 0);
        if (lastSeenAt < cutoff && !entry?.active) {
            __liveTrackRegistry.delete(trackKey);
            __liveTrackIconCodeCache.delete(trackKey);
        } else if (entry?.path_history) {
            entry.path_history = pruneHistoryPoints(entry.path_history);
            if (!entry?.active && entry.path_history.length > LIVE_TRACK_INACTIVE_HISTORY_MAX_POINTS) {
                entry.path_history = entry.path_history.slice(-LIVE_TRACK_INACTIVE_HISTORY_MAX_POINTS);
            }
        }
    }
    const overflow = __liveTrackRegistry.size - LIVE_TRACK_REGISTRY_MAX_ITEMS;
    if (overflow > 0) {
        const removable = [...__liveTrackRegistry.entries()]
            .filter(([, entry]) => !entry?.active)
            .sort((a, b) => Number(a?.[1]?.last_seen_at || 0) - Number(b?.[1]?.last_seen_at || 0));
        for (let i = 0; i < overflow && i < removable.length; i += 1) {
            const [trackKey] = removable[i];
            __liveTrackRegistry.delete(trackKey);
            __liveTrackIconCodeCache.delete(trackKey);
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
        if (__liveTrackOverlayLastVisible) {
            root.style.display = "none";
            __liveTrackOverlayLastVisible = false;
            __liveTrackOverlayLastX = Number.NaN;
            __liveTrackOverlayLastY = Number.NaN;
        }
        return;
    }
    const screen = getScreenPositionForTrack(selectedTrackKey);
    if (!screen) {
        if (__liveTrackOverlayLastVisible) {
            root.style.display = "none";
            __liveTrackOverlayLastVisible = false;
            __liveTrackOverlayLastX = Number.NaN;
            __liveTrackOverlayLastY = Number.NaN;
        }
        return;
    }
    if (!__liveTrackOverlayLastVisible) {
        root.style.display = "block";
        __liveTrackOverlayLastVisible = true;
    }
    if (
        !Number.isFinite(__liveTrackOverlayLastX) ||
        Math.abs(screen.x - __liveTrackOverlayLastX) >= 0.5
    ) {
        root.style.left = `${screen.x}px`;
        __liveTrackOverlayLastX = screen.x;
    }
    if (
        !Number.isFinite(__liveTrackOverlayLastY) ||
        Math.abs(screen.y - __liveTrackOverlayLastY) >= 0.5
    ) {
        root.style.top = `${screen.y}px`;
        __liveTrackOverlayLastY = screen.y;
    }
}
function clearFocusedTrackCameraLock() {
    const viewer = window.__warzoneViewer;
    const camera = viewer?.camera;
    if (!viewer || !camera) return;
    const worldPosition = camera.positionWC
        ? Cesium.Cartesian3.clone(camera.positionWC)
        : null;
    const worldDirection = camera.directionWC
        ? Cesium.Cartesian3.clone(camera.directionWC)
        : null;
    const worldUp = camera.upWC
        ? Cesium.Cartesian3.clone(camera.upWC)
        : null;
    try {
        viewer.trackedEntity = undefined;
    } catch { }
    try {
        camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        if (worldPosition && worldDirection && worldUp) {
            camera.setView({
                destination: worldPosition,
                orientation: {
                    direction: worldDirection,
                    up: worldUp,
                },
            });
        }
    } catch {
        try {
            camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        } catch { }
    }
    requestWarzoneRenderBatched();
}
function resetFocusedTrackCameraOrientation() {
    __liveTrackFocusHeadingDeg = 0;
    __liveTrackFocusPitchDeg = LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG;
}
function syncFocusedTrackCameraOrientationFromViewer(position) {
    const viewer = window.__warzoneViewer;
    const camera = viewer?.camera;
    if (!camera || !position) return;
    const headingDeg = Cesium.Math.toDegrees(Number(camera.heading));
    const pitchDeg = Cesium.Math.toDegrees(Number(camera.pitch));
    if (Number.isFinite(headingDeg)) {
        __liveTrackFocusHeadingDeg = normalizeDegrees(headingDeg);
    }
    if (Number.isFinite(pitchDeg)) {
        __liveTrackFocusPitchDeg = clamp(
            pitchDeg,
            LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG,
            LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG
        );
    }
    const measuredRange = getCartesianDistanceMeters(camera.positionWC, position);
    if (Number.isFinite(measuredRange) && measuredRange > 0) {
        __liveTrackFocusRangeMeters = clamp(
            measuredRange,
            LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
            LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
        );
    }
}
function syncFocusedTrackCamera() {
    const viewer = window.__warzoneViewer;
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusMode = String(__liveTrackReplayState.mode || "") === "focus";
    if (viewer?.scene?.mode !== Cesium.SceneMode.SCENE3D) {
        return;
    }
    if (
        !viewer ||
        !selectedTrackKey ||
        !isFocusMode ||
        __liveTrackIsCameraFlying ||
        !__liveTrackHardLockEnabled
    ) return;
    if (__liveTrackUserCameraInteracting) return;
    const now = performance.now();
    if ((now - __liveTrackLastFocusCameraSyncAt) < LIVE_TRACK_FOCUS_CAMERA_SYNC_MIN_MS) {
        return;
    }
    __liveTrackLastFocusCameraSyncAt = now;
    const entity = viewer.entities.getById(`track-${selectedTrackKey}`);
    const position = getPositionCartesian(entity);
    if (!position) return;
    syncFocusedTrackCameraOrientationFromViewer(position);
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
                Cesium.Math.toRadians(__liveTrackFocusHeadingDeg),
                Cesium.Math.toRadians(__liveTrackFocusPitchDeg),
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
            __liveTrackUserCameraInteracting = true;
            if (__liveTrackFocusResumeTimer) {
                clearTimeout(__liveTrackFocusResumeTimer);
                __liveTrackFocusResumeTimer = null;
            }
            __liveTrackManualCameraIntent = false;
            return;
        }
        if (__liveTrackManualCameraIntent) {
            clearLiveTrackSelection({ animate: false });
        }
        __liveTrackManualCameraIntent = false;
    });
    viewer.camera.moveEnd.addEventListener(() => {
        const hasSelection = Boolean(__liveTrackReplayState.selectedTrackKey);
        if (!hasSelection || __liveTrackIsCameraFlying || !__liveTrackHardLockEnabled) {
            __liveTrackUserCameraInteracting = false;
            return;
        }
        if (__liveTrackFocusResumeTimer) {
            clearTimeout(__liveTrackFocusResumeTimer);
        }
        __liveTrackFocusResumeTimer = setTimeout(() => {
            __liveTrackFocusResumeTimer = null;
            __liveTrackUserCameraInteracting = false;
            __liveTrackLastFocusCameraSyncAt = 0;
            syncFocusedTrackCamera();
            requestWarzoneRenderBatched();
        }, LIVE_TRACK_FOCUS_CAMERA_RESUME_DELAY_MS);
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
    let hoverPickFrame = 0;
    let hoverPickPosition = null;
    let hoverTrackKey = "";
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

    const runHoverPick = () => {
        hoverPickFrame = 0;
        if (!hoverPickPosition) return;
        const hasActiveTrackEntities =
            __liveTrackEntities.size > 0 ||
            Boolean(__liveTrackReplayState.selectedTrackKey);
        if (!hasActiveTrackEntities) {
            if (hoverTrackKey) {
                viewer.container.style.cursor = "";
                hoverTrackKey = "";
            }
            return;
        }
        const picked = viewer.scene.pick(hoverPickPosition);
        const trackKey = resolvePickedTrackKey(picked);
        if (trackKey !== hoverTrackKey) {
            viewer.container.style.cursor = trackKey ? "pointer" : "";
            hoverTrackKey = trackKey;
        }
    };

    __liveTrackClickHandler.setInputAction((movement) => {
        if (!movement?.endPosition) return;
        if (!hoverPickPosition) hoverPickPosition = new Cesium.Cartesian2();
        Cesium.Cartesian2.clone(movement.endPosition, hoverPickPosition);
        if (hoverPickFrame) return;
        hoverPickFrame = requestAnimationFrame(runHoverPick);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    __liveTrackClickHandler.setInputAction((movement) => {
        const hasActiveTrackEntities =
            __liveTrackEntities.size > 0 ||
            Boolean(__liveTrackReplayState.selectedTrackKey);
        if (!hasActiveTrackEntities) return;
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
        hideLiveTrackFocusVisuals();
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

function buildReplayPositions(pathHistory = [], track = {}) {
    return pathHistory
        .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
        .map((point) => Cesium.Cartesian3.fromDegrees(
            Number(point.lon),
            Number(point.lat),
            getTrackTrailRenderAltitudeMeters(getTrackPointRenderAltitudeMeters(point, track))
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
    const positions = buildReplayPositions(pathHistory, entry);
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
    const replayBillboard = buildLiveTrackBillboard(
        entry,
        Number(firstPoint.heading_deg || 0),
        LIVE_TRACK_RENDER_MODE.PNG
    );
    __liveTrackReplayState.markerEntity = viewer.entities.add({
        id: `track-replay-marker-${trackKey}`,
        position: Cesium.Cartesian3.fromDegrees(
            Number(firstPoint.lon),
            Number(firstPoint.lat),
            getTrackPointRenderAltitudeMeters(firstPoint, entry)
        ),
        billboard: replayBillboard,
    });
    __liveTrackReplayState.markerIndex = 0;
    __liveTrackReplayState.markerTimer = setInterval(() => {
        const path = entry.path_history || [];
        if (path.length < 2 || !__liveTrackReplayState.markerEntity) return;
        __liveTrackReplayState.markerIndex = (__liveTrackReplayState.markerIndex + 1) % path.length;
        const point = path[__liveTrackReplayState.markerIndex];
        const alt = getTrackPointRenderAltitudeMeters(point, entry);
        __liveTrackReplayState.markerEntity.position = Cesium.Cartesian3.fromDegrees(
            Number(point.lon),
            Number(point.lat),
            alt
        );
        if (__liveTrackReplayState.markerEntity.billboard) {
            __liveTrackReplayState.markerEntity.billboard.rotation = Cesium.Math.toRadians(
                -normalizeDegrees(Number(point.heading_deg || 0))
            );
        }
        requestWarzoneRender();
    }, Number(options.stepMs || LIVE_TRACK_REPLAY_STEP_MS));
    const lastPoint = pathHistory[pathHistory.length - 1];
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            Number(lastPoint.lon),
            Number(lastPoint.lat),
            Math.max(getTrackPointRenderAltitudeMeters(lastPoint, entry) + 140000, 180000)
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
    void track;
    const defaultOffset = getCssNumber("--warzone-live-aircraft-model-heading-offset-default", Number.NaN);
    if (Number.isFinite(defaultOffset)) return defaultOffset;
    return LIVE_TRACK_MODEL_HEADING_OFFSET_DEFAULT;
}
function getLiveTrackModelPitchOffsetDeg(track = {}) {
    void track;
    return getCssNumber("--warzone-live-aircraft-model-pitch-offset-default", 0);
}
function getLiveTrackModelRollOffsetDeg(track = {}) {
    void track;
    return getCssNumber("--warzone-live-aircraft-model-roll-offset-default", 0);
}
export function setAircraftModelHeadingOffset(subtype = "", headingOffsetDeg = -90) {
    void subtype;
    const next = Number(headingOffsetDeg);
    if (!Number.isFinite(next)) return;
    LIVE_TRACK_MODEL_HEADING_OFFSET_DEFAULT = next;
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    __liveTrackEntities.forEach((entity) => {
        if (!entity?.model || !entity?.__trackKey) return;
        const entry = __liveTrackRegistry.get(entity.__trackKey);
        if (!entry) return;
        const lon = Number(entry.lon);
        const lat = Number(entry.lat);
        const alt = getTrackRenderAltitudeMeters(entry);
        const headingDeg = Number(entity.__currentHeadingDeg || entry.heading_deg || 0);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        entity.orientation = buildTrackOrientation(entry, lon, lat, alt, headingDeg, 0, 0);
    });
    requestWarzoneRenderBatched();
}
export function setAircraftModelHeadingOffsets(offsetMap = {}) {
    if (!offsetMap || typeof offsetMap !== "object") return;
    const defaultValue = Number(offsetMap.default);
    if (Number.isFinite(defaultValue)) {
        setAircraftModelHeadingOffset("default", defaultValue);
        return;
    }
    const firstNumericValue = Object.values(offsetMap).find((value) => Number.isFinite(Number(value)));
    if (Number.isFinite(Number(firstNumericValue))) {
        setAircraftModelHeadingOffset("default", Number(firstNumericValue));
    }
}
function getLiveTrackTailOffsetMeters(track = {}) {
    const subtype = getTrackSubtypeKey(track);
    return LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE[subtype] ?? 220;
}
function buildTrackOrientation(track, lon, lat, alt, headingDeg, pitchDeg = 0, rollDeg = 0) {
    const headingOffsetDeg = getLiveTrackModelHeadingOffsetDeg(track);
    const pitchOffsetDeg = getLiveTrackModelPitchOffsetDeg(track);
    const rollOffsetDeg = getLiveTrackModelRollOffsetDeg(track);
    return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(lon, lat, alt),
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(normalizeDegrees(headingDeg + headingOffsetDeg)),
            Cesium.Math.toRadians(pitchDeg + pitchOffsetDeg),
            Cesium.Math.toRadians(rollDeg + rollOffsetDeg)
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
    // Keep live models level by default; enable via root.css only when desired.
    const dynamicBankEnabled = getCssNumber("--warzone-live-aircraft-model-dynamic-bank-enabled", 0) >= 0.5;
    const dynamicPitchEnabled = getCssNumber("--warzone-live-aircraft-model-dynamic-pitch-enabled", 0) >= 0.5;
    if (!state.initialized) {
        state.headingDeg = targetHeadingDeg;
        state.pitchDeg = 0;
        state.rollDeg = 0;
        state.initialized = true;
    }
    const headingDeltaDeg = getShortestAngleDeltaDeg(state.headingDeg, targetHeadingDeg);
    state.headingDeg = normalizeDegrees(state.headingDeg + (headingDeltaDeg * 0.22));
    if (dynamicBankEnabled) {
        const targetRollDeg = clamp(headingDeltaDeg * 1.2, -18, 18);
        state.rollDeg = state.rollDeg + ((targetRollDeg - state.rollDeg) * 0.18);
    } else {
        state.rollDeg = 0;
    }
    if (dynamicPitchEnabled) {
        const previous = __liveTrackLastPositions.get(track.track_key);
        let targetPitchDeg = 0;
        if (previous) {
            const previousAltFt = Number(previous.altitude_ft || 0);
            const nextAltFt = getTrackResolvedAltitudeFt(track);
            const climbDeltaFt = nextAltFt - previousAltFt;
            targetPitchDeg = clamp(climbDeltaFt / 900, -8, 8);
        }
        state.pitchDeg = state.pitchDeg + ((targetPitchDeg - state.pitchDeg) * 0.16);
    } else {
        state.pitchDeg = 0;
    }
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
    try {
        void track;
        void courseHeadingDeg;
        return Cesium.Cartesian3.fromDegrees(
            lon,
            lat,
            getTrackTrailRenderAltitudeMeters(alt)
        );
    } catch {
        return null;
    }
}
function getTrackTrailRenderAltitudeMeters(alt = 0) {
    if (!Number.isFinite(alt)) return 0;
    return Math.max(0, Number(alt) - LIVE_TRACK_TRAIL_ALTITUDE_OFFSET_METERS);
}
function updateTrackTrailPositionsCache(trackKey, trailEntries = []) {
    if (!trackKey) return [];
    const trail = Array.isArray(trailEntries) ? trailEntries : [];
    const lastTs = Number(trail[trail.length - 1]?.ts || 0);
    const cache = __liveTrackTrailPositionsCache.get(trackKey);
    if (cache && cache.lastTs === lastTs && cache.length === trail.length) {
        return cache.positions;
    }
    const rawPositions = trail
        .map((entry) => entry?.position || null)
        .filter(Boolean);
    const positions = smoothTrackTrailPositions(rawPositions);
    __liveTrackTrailPositionsCache.set(trackKey, {
        lastTs,
        length: trail.length,
        positions,
    });
    return positions;
}
function getLiveTrackTrailSmoothingStrength() {
    return clamp(
        getCssNumber("--warzone-live-track-trail-smoothing", LIVE_TRACK_TRAIL_SMOOTHING_DEFAULT),
        0,
        0.92
    );
}
function lerpCartesian3(a, b, t) {
    return new Cesium.Cartesian3(
        Cesium.Math.lerp(a.x, b.x, t),
        Cesium.Math.lerp(a.y, b.y, t),
        Cesium.Math.lerp(a.z, b.z, t)
    );
}
function downsampleTrailPositions(positions = [], maxPoints = LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS) {
    const source = Array.isArray(positions) ? positions : [];
    const max = Math.max(2, Number(maxPoints || LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS));
    if (source.length <= max) return source;
    const interior = max - 2;
    const step = (source.length - 2) / Math.max(interior, 1);
    const out = [source[0]];
    for (let i = 1; i <= interior; i += 1) {
        const rawIndex = Math.round(i * step);
        const idx = clamp(rawIndex, 1, source.length - 2);
        out.push(source[idx]);
    }
    out.push(source[source.length - 1]);
    return out;
}
function chaikinSmoothTrailPositions(positions = [], iterations = 1) {
    let current = Array.isArray(positions) ? positions.slice() : [];
    const steps = Math.max(0, Math.floor(Number(iterations || 0)));
    for (let pass = 0; pass < steps; pass += 1) {
        if (current.length < 3) break;
        const next = [current[0]];
        for (let i = 0; i < current.length - 1; i += 1) {
            const p0 = current[i];
            const p1 = current[i + 1];
            if (!p0 || !p1) continue;
            next.push(lerpCartesian3(p0, p1, 0.25));
            next.push(lerpCartesian3(p0, p1, 0.75));
        }
        next.push(current[current.length - 1]);
        current = downsampleTrailPositions(next, LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS);
    }
    return current;
}
function smoothTrackTrailPositions(rawPositions = []) {
    const positions = Array.isArray(rawPositions) ? rawPositions : [];
    if (positions.length < LIVE_TRACK_TRAIL_SMOOTH_MIN_POINTS) return positions;
    const smoothing = getLiveTrackTrailSmoothingStrength();
    if (!Number.isFinite(smoothing) || smoothing <= 0) return positions;

    const keepTail = Math.max(1, LIVE_TRACK_TRAIL_SMOOTH_KEEP_TAIL_POINTS);
    const bodyEnd = Math.max(2, positions.length - keepTail);
    const body = positions.slice(0, bodyEnd);
    const tail = positions.slice(bodyEnd);
    const averaged = body.slice();
    for (let i = 1; i < body.length - 1; i += 1) {
        const prev = body[i - 1];
        const curr = body[i];
        const next = body[i + 1];
        if (!prev || !curr || !next) continue;
        const avgX = (prev.x + curr.x + next.x) / 3;
        const avgY = (prev.y + curr.y + next.y) / 3;
        const avgZ = (prev.z + curr.z + next.z) / 3;
        averaged[i] = new Cesium.Cartesian3(
            Cesium.Math.lerp(curr.x, avgX, smoothing),
            Cesium.Math.lerp(curr.y, avgY, smoothing),
            Cesium.Math.lerp(curr.z, avgZ, smoothing)
        );
    }
    const chaikinPasses = smoothing >= 0.72 ? 2 : 1;
    const curvedBody = chaikinSmoothTrailPositions(averaged, chaikinPasses);
    const maxBodyPoints = Math.max(2, LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS - tail.length);
    const cappedBody = downsampleTrailPositions(curvedBody, maxBodyPoints);
    return cappedBody.concat(tail);
}
function getTrackTrailPositions(trackKey) {
    return updateTrackTrailPositionsCache(trackKey, __liveTrackTrails.get(trackKey) || []);
}
function getTrackTrailMinDistanceMeters(track = {}) {
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    if (subtype === "helicopter") return 6;
    if (subtype === "drone" || subtype === "uav") return 10;
    if (subtype === "fighter" || subtype === "recon" || subtype === "isr") return 24;
    if (
        subtype === "awacs" ||
        subtype === "tanker" ||
        subtype === "refueler" ||
        subtype === "transport" ||
        subtype === "logistics" ||
        subtype === "logistic" ||
        subtype === "bomber"
    ) {
        return 36;
    }
    return LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS;
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
    if (lastEntry) {
        const dtMs = Math.max(0, now - Number(lastEntry.ts || now));
        if (dtMs > 0 && Number.isFinite(movedMeters)) {
            const speedMps = movedMeters / (dtMs / 1000);
            if (
                movedMeters > LIVE_TRACK_HISTORY_MAX_JUMP_METERS &&
                speedMps > LIVE_TRACK_HISTORY_MAX_SPEED_MPS
            ) {
                // Ignore telemetry spikes that create visibly broken trail segments.
                return;
            }
        }
    }
    const minTrailDistanceMeters = getTrackTrailMinDistanceMeters(track);
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusedTrailTrack =
        selectedTrackKey &&
        selectedTrackKey === String(trackKey || "") &&
        String(__liveTrackReplayState.mode || "") === "focus";
    const effectiveMinTrailDistance = isFocusedTrailTrack
        ? Math.max(6, minTrailDistanceMeters * 0.45)
        : minTrailDistanceMeters;
    if (!lastEntry || movedMeters >= effectiveMinTrailDistance) {
        trail.push({
            position: newPosition,
            ts: now,
        });
    }
    trail = trimTrailEntries(trail);
    __liveTrackTrails.set(trackKey, trail);
    updateTrackTrailPositionsCache(trackKey, trail);
}
function parseTrailPointTimestamp(rawTs) {
    const numeric = Number(rawTs);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric < 1e11 ? numeric * 1000 : numeric;
    }
    const parsed = new Date(rawTs || 0).getTime();
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return Date.now();
}
function sanitizeSeedTrailEntries(entries = []) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    if (safeEntries.length <= 2) return safeEntries;
    const sanitized = [];
    for (const entry of safeEntries) {
        if (!entry?.position || !Number.isFinite(Number(entry?.ts))) continue;
        const next = {
            position: entry.position,
            ts: Number(entry.ts),
        };
        if (!sanitized.length) {
            sanitized.push(next);
            continue;
        }
        const previous = sanitized[sanitized.length - 1];
        const movedMeters = getCartesianDistanceMeters(previous.position, next.position);
        if (!Number.isFinite(movedMeters)) continue;
        const dtMs = Math.max(0, Number(next.ts) - Number(previous.ts));
        if (dtMs === 0) {
            if (movedMeters > LIVE_TRACK_HISTORY_MAX_JUMP_METERS) continue;
            sanitized.push(next);
            continue;
        }
        const speedMps = movedMeters / (dtMs / 1000);
        if (
            movedMeters > LIVE_TRACK_HISTORY_MAX_JUMP_METERS &&
            speedMps > LIVE_TRACK_HISTORY_MAX_SPEED_MPS
        ) {
            continue;
        }
        sanitized.push(next);
    }
    return sanitized;
}
function seedTrackTrailFromHistory(trackKey, track = {}, historyPoints = []) {
    const sortedEntries = (Array.isArray(historyPoints) ? historyPoints : [])
        .map((point) => {
            const lon = Number(point?.lon);
            const lat = Number(point?.lat);
            const altitudeMeters = getTrackPointRenderAltitudeMeters(point, track);
            const headingDeg = normalizeDegrees(Number(point?.heading_deg || track.heading_deg || 0));
            const position = buildTrackTrailCartesian(track, lon, lat, altitudeMeters, headingDeg);
            if (!position) return null;
            return {
                position,
                ts: parseTrailPointTimestamp(point?.ts),
            };
        })
        .filter(Boolean)
        .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
        .slice(-LIVE_TRACK_SEED_HISTORY_MAX_POINTS);
    const entries = trimTrailEntries(sanitizeSeedTrailEntries(sortedEntries));
    if (entries.length >= 2) {
        __liveTrackTrails.set(trackKey, entries);
        updateTrackTrailPositionsCache(trackKey, entries);
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
    // Do not create synthetic "tail anchors". Seed only from real history data.
    if (!trail.length) {
        const position = buildTrackTrailCartesian(track, lon, lat, alt, headingDeg);
        if (!position) return;
        const seedEntries = trimTrailEntries([{ position, ts: Date.now() }]);
        __liveTrackTrails.set(trackKey, seedEntries);
        updateTrackTrailPositionsCache(trackKey, seedEntries);
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
                    return getTrackTrailPositions(trackKey);
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
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusedTrack =
        trackKey &&
        selectedTrackKey &&
        selectedTrackKey === String(trackKey) &&
        String(__liveTrackReplayState.mode || "") === "focus";
    const minAnimMs = isFocusedTrack ? LIVE_TRACK_FOCUS_MIN_ANIM_MS : LIVE_TRACK_MIN_ANIM_MS;
    const maxAnimMs = isFocusedTrack ? LIVE_TRACK_FOCUS_MAX_ANIM_MS : LIVE_TRACK_MAX_ANIM_MS;
    const fallbackAnimMs = isFocusedTrack ? LIVE_TRACK_FOCUS_DEFAULT_ANIM_MS : LIVE_TRACK_DEFAULT_ANIM_MS;
    const prevSourceTimestamp = Number(entity.__lastSourceTimestamp || 0);
    const sourceTimestamp = Number(nextSourceTimestamp || 0);
    const sourceGapMs =
        Number.isFinite(prevSourceTimestamp) &&
            prevSourceTimestamp > 0 &&
            Number.isFinite(sourceTimestamp) &&
            sourceTimestamp > prevSourceTimestamp
            ? sourceTimestamp - prevSourceTimestamp
            : fallbackAnimMs;
    const cadenceDuration = clamp(
        sourceGapMs * (isFocusedTrack ? 0.52 : 0.94),
        minAnimMs,
        maxAnimMs
    );
    const distanceDuration = clamp(
        distanceMeters * (isFocusedTrack ? 0.028 : 0.07),
        minAnimMs,
        maxAnimMs
    );
    const duration = clamp(
        isFocusedTrack
            ? ((cadenceDuration * 0.58) + (distanceDuration * 0.42))
            : Math.max(cadenceDuration, distanceDuration),
        minAnimMs,
        maxAnimMs
    );
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startAlt = startCartographic.height || 0;
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = isFocusedTrack
            ? (t * t * t * ((t * ((t * 6) - 15)) + 10))
            : (t * t * (3 - 2 * t));
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
function resolveLiveTrackModelCode(track = {}) {
    const forcedModelCode = resolveForcedAircraftModelCode(track);
    if (LIVE_AIRCRAFT_MODEL_CODES.has(forcedModelCode)) {
        return forcedModelCode;
    }
    const iconCode = resolveLiveAircraftIconCode(track);
    if (LIVE_AIRCRAFT_MODEL_CODES.has(iconCode)) {
        return iconCode;
    }
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    const subtypeCode = LIVE_AIRCRAFT_MODEL_CODE_BY_SUBTYPE[subtype] || LIVE_AIRCRAFT_MODEL_DEFAULT_CODE;
    if (LIVE_AIRCRAFT_MODEL_CODES.has(subtypeCode)) {
        return subtypeCode;
    }
    return "";
}
function resolveLiveTrackModelUri(track = {}) {
    const modelCode = resolveLiveTrackModelCode(track);
    if (!modelCode) return "";
    return `${LIVE_AIRCRAFT_MODEL_BASE_PATH}/${LIVE_AIRCRAFT_MODEL_FILE_PREFIX}${modelCode}.glb`;
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
    const alt = getTrackRenderAltitudeMeters(track);
    const resolvedAltitudeFt = getTrackResolvedAltitudeFt(track);
    const sourceTimestamp = getTrackSourceTimestamp(track);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const resolvedHeadingDeg = getTrackResolvedHeading(track);
    const attitude = getTrackAttitude(track, resolvedHeadingDeg);
    const renderMode = resolveAircraftRenderMode(track, modelUri);
    const billboard = renderMode === LIVE_TRACK_RENDER_MODE.MODEL
        ? null
        : buildLiveTrackBillboard(track, attitude.headingDeg, renderMode);
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
        entity.__renderMode = renderMode;
        entity.__currentHeadingDeg = attitude.headingDeg;
        entity.__lastSourceTimestamp = sourceTimestamp;
        __liveTrackEntities.set(id, entity);
    } else {
        entity.__trackKey = track.track_key;
        entity.__trackPickable = true;
        entity.__renderMode = renderMode;
        entity.__currentHeadingDeg = attitude.headingDeg;
        const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
        const shouldAnimateTrack =
            !LIVE_TRACK_ANIMATE_ONLY_SELECTED ||
            (selectedTrackKey && selectedTrackKey === String(track.track_key || ""));
        if (shouldAnimateTrack) {
            animateTrackTo(entity, track, lon, lat, alt, sourceTimestamp);
        } else {
            if (entity.__liveTrackAnimFrame) {
                cancelAnimationFrame(entity.__liveTrackAnimFrame);
                entity.__liveTrackAnimFrame = null;
            }
            const nextCartesian = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
            entity.position = nextCartesian;
            pushTrackTrailPointFromCartesian(track.track_key, track, nextCartesian, attitude.headingDeg);
        }
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
        altitude_ft: resolvedAltitudeFt,
    });
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
    __liveTrackTrailPositionsCache.delete(trackKey);
    __liveTrackLastPositions.delete(trackKey);
    __liveTrackVisualState.delete(trackKey);
    __liveTrackIconCodeCache.delete(trackKey);
    const existingRegistryEntry = __liveTrackRegistry.get(trackKey);
    if (existingRegistryEntry) {
        existingRegistryEntry.active = false;
        existingRegistryEntry.ended_at = Date.now();
        existingRegistryEntry.entity_id = "";
        existingRegistryEntry.path_history = pruneHistoryPoints(existingRegistryEntry.path_history || []);
    }
    if (__liveTrackReplayState.selectedTrackKey === trackKey && __liveTrackReplayState.mode === "focus") {
        setSelectedTrack("", "");
        hideLiveTrackFocusVisuals();
    }
    pruneTrackRegistry();
    dispatchLiveTrackRegistryUpdate();
    requestWarzoneRenderBatched(); // batched
    if (!trackKey) return null;
    const entry = __liveTrackRegistry.get(trackKey);
    return entry ? { ...entry } : null;
}
export function clearAllLiveTracks() {
    const viewer = window.__warzoneViewer;

    // Clear focus/replay helpers first so no stale replay marker survives layer-off.
    clearReplayEntities();
    clearLiveTrackSelection();

    const now = Date.now();
    const staleKeys = [];
    for (const [trackKey, entry] of __liveTrackRegistry.entries()) {
        if (trackKey) {
            clearLiveTrack(trackKey);
            continue;
        }
        // Track rows without a stable key cannot be cleared by clearLiveTrack(trackKey).
        // Mark ended and prune their registry key directly.
        if (entry && typeof entry === "object") {
            entry.active = false;
            entry.ended_at = now;
            entry.entity_id = "";
        }
        staleKeys.push(trackKey);
    }
    staleKeys.forEach((trackKey) => __liveTrackRegistry.delete(trackKey));

    if (viewer?.entities?.values) {
        const stray = [];
        for (const entity of viewer.entities.values) {
            const entityId = String(entity?.id || "");
            if (
                entityId.startsWith("track-") ||
                entityId.startsWith("track-trail-") ||
                entityId.startsWith("track-replay-route-") ||
                entityId.startsWith("track-replay-marker-")
            ) {
                stray.push(entity);
            }
        }
        stray.forEach((entity) => viewer.entities.remove(entity));
    }

    __liveTrackEntities.clear();
    __liveTrackTrails.clear();
    __liveTrackTrailPositionsCache.clear();
    __liveTrackLastPositions.clear();
    __liveTrackVisualState.clear();
    __liveTrackIconCodeCache.clear();
    dispatchLiveTrackRegistryUpdate();
    requestWarzoneRenderBatched();
}
export function setAircraftModelCalibrationEnabled(enabled = false) {
    window.__WZ_AIRCRAFT_MODEL_CALIBRATION = Boolean(enabled);
    const activeSnapshots = getAllLiveTrackSnapshots({ includePathHistory: false })
        .filter((entry) => entry?.active && entry?.track_key);
    activeSnapshots.forEach((entry) => {
        upsertLiveTrack(entry);
    });
    requestWarzoneRenderBatched();
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
    __liveTrackUserCameraInteracting = false;
    __liveTrackLastFocusCameraSyncAt = 0;
    if (__liveTrackFocusResumeTimer) {
        clearTimeout(__liveTrackFocusResumeTimer);
        __liveTrackFocusResumeTimer = null;
    }
    viewer.camera.cancelFlight?.();
    __liveTrackIsCameraFlying = true;
    resetFocusedTrackCameraOrientation();
    setSelectedTrack(trackKey, "focus");
    setLiveTrackHardLockInternal(true);
    bindFocusGuideTracking();
    updateFocusGuideElement();
    viewer.flyTo(entity, {
        duration: Number(options.duration || 1.15),
        offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(__liveTrackFocusHeadingDeg),
            Cesium.Math.toRadians(__liveTrackFocusPitchDeg),
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
    const viewer = window.__warzoneViewer;
    if (viewer) {
        viewer.camera.cancelFlight?.();
    }
    __liveTrackIsCameraFlying = false;
    __liveTrackUserCameraInteracting = false;
    __liveTrackLastFocusCameraSyncAt = 0;
    if (__liveTrackFocusResumeTimer) {
        clearTimeout(__liveTrackFocusResumeTimer);
        __liveTrackFocusResumeTimer = null;
    }
    setLiveTrackHardLockInternal(false);
    __liveTrackManualCameraIntent = false;
    __liveTrackFocusRangeMeters = LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS;
    resetFocusedTrackCameraOrientation();
    clearReplayEntities();
    setSelectedTrack("", "");
    clearFocusedTrackCameraLock();
    hideLiveTrackFocusVisuals();
    requestWarzoneRenderBatched();
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
window.__setAircraftModelCalibrationEnabled = setAircraftModelCalibrationEnabled;
