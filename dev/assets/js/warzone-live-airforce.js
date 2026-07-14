// File Path: /assets/js/warzone-live-airforce.js
import * as Cesium from "cesium";
import { isLayerEnabled } from "./warzone-layers.js";
import { flyToRegion, getActiveRegion } from "./warzone-region-selector.js";
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
    routeFadeEntities: [],
    markerEntity: null,
    markerTimer: null,
    markerIndex: 0,
};
function publishLiveTrackSelectionState() {
    window.__warzoneLiveTrackSelection = {
        trackKey: String(__liveTrackReplayState.selectedTrackKey || ""),
        mode: String(__liveTrackReplayState.mode || ""),
    };
}
publishLiveTrackSelectionState();
let __liveTrackOverlayRoot = null;
let __liveTrackOverlayBound = false;
let __liveTrackOverlayLastVisible = false;
let __liveTrackOverlayLastX = Number.NaN;
let __liveTrackOverlayLastY = Number.NaN;
let __liveTrackOriginHoverEntity = null;
let __liveTrackOriginHoverTrackKey = "";
let __liveTrackFocusedRouteGeometryCache = null;
let __liveTrackOriginBasesPromise = null;
let __liveTrackOriginBases = null;
const __liveTrackOriginBaseCache = new Map();
const LIVE_TRACK_ORIGIN_BASE_RADIUS_KM = 120;
const LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS = 6;
const LIVE_TRACK_FOCUS_ROUTE_FADE_ALPHA = 0.92;
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
let __liveTrackFocusBaseRangeMeters = 95000;
let __liveTrackFocusHeadingDeg = 0;
let __liveTrackFocusPitchDeg = -89;
let __liveTrackCtrlTiltDragState = null;
let __liveTrackUserCameraInteracting = false;
let __liveTrackFocusResumeTimer = null;
let __liveTrackFocusEntityRetryTimer = 0;
let __liveTrackLastFocusCameraSyncAt = 0;
let __liveTrackFocusWarningActive = false;
let __liveTrackImageWakeCache = new Set();
let __liveTrackRenderWakeBurstTimer = 0;
let __liveTrackViewRefreshSeq = 0;
let __liveTrackViewRefreshRaf = 0;
let __liveTrackSceneModeBeforeFocus = "";
let __liveTrackContourStateBeforeFocus = null;
let __liveTrackContourAnchorKey = "";
let __liveTrackContourAnchorLon = Number.NaN;
let __liveTrackContourAnchorLat = Number.NaN;
let __liveTrackLastContourFocusSyncAt = 0;
let __liveTrackTerrainDisableTimer = 0;
let __liveTrackTerrainDisableSeq = 0;
let __liveTrackVisualModeRefreshTimer = 0;
let __liveTrackVisualModeRefreshRaf = 0;


const LIVE_TRACK_LABEL_CAMERA_HEIGHT_MAX = 420000;

const LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX = 850000;
const LIVE_TRACK_FOCUS_GUIDE_COLOR = "rgba(24, 226, 219, 0.72)";
const LIVE_TRACK_FOCUS_GUIDE_LENGTH_PX = 92;
const LIVE_TRACK_FOCUS_GUIDE_GAP_PX = 42;
const LIVE_TRACK_FOCUS_GUIDE_THICKNESS_PX = 4;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS = 36000;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG = -89;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG = -89;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG = -8;
const LIVE_TRACK_FOCUS_ZOOM_DELTA_FEET = 72000;
const LIVE_TRACK_FOCUS_WHEEL_ZOOM_STEP_FEET = 8200;
const LIVE_TRACK_FOCUS_CAMERA_HEADING_SENSITIVITY_DEG_PER_PX = 0.28;
const LIVE_TRACK_FOCUS_CAMERA_PITCH_SENSITIVITY_DEG_PER_PX = 0.18;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS = 6000;
const LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS = 3200000;
const LIVE_TRACK_FOCUS_WARNING_RANGE_METERS = 70000;
const LIVE_TRACK_FOCUS_FINAL_RANGE_METERS = 120000;
const LIVE_TRACK_FOCUS_CAMERA_SYNC_MIN_MS = 0;
const LIVE_TRACK_FOCUS_VISIBILITY_RADIUS_METERS = 100000;
const LIVE_TRACK_REGISTRY_DISPATCH_DEBOUNCE_MS = 260;
const LIVE_TRACK_FOCUSED_MODEL_MIN_PIXEL_MAX = 600;
const LIVE_TRACK_FOCUSED_MODEL_SCALE_BASELINE = 1.05;
const LIVE_TRACK_FOCUSED_MODEL_MIN_PIXEL_MAX_BY_SUBTYPE = Object.freeze({
    helicopter: 600,
});
let __liveTrackFocusGuideEl = null;


/* ================= CONFIG ================= */
let LIVE_TRACK_MODEL_HEADING_OFFSET_DEFAULT = 90;
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
const LIVE_TRACK_MAX_TRAIL_POINTS = 900;
const LIVE_TRACK_TRAIL_MAX_AGE_MS = 120 * 60 * 1000;
const LIVE_TRACK_TRAIL_RENDER_HEIGHT_MAX = 420000;
const LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS = 80;
const LIVE_TRACK_TRAIL_ALTITUDE_OFFSET_METERS = 0;
const LIVE_TRACK_TRAIL_SMOOTHING_DEFAULT = 0.55;
const LIVE_TRACK_TRAIL_SMOOTH_MIN_POINTS = 5;
const LIVE_TRACK_TRAIL_SMOOTH_KEEP_TAIL_POINTS = 2;
const LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS = 520;
const LIVE_TRACK_TRAIL_HEAD_INVALIDATION_METERS = 12;
const LIVE_TRACK_FOCUS_ROUTE_HEAD_INVALIDATION_METERS = 24;
const LIVE_TRACK_FOCUS_ROUTE_CAMERA_INVALIDATION_METERS = 40;
const LIVE_TRACK_FOCUS_ROUTE_ANGLE_INVALIDATION_RADIANS = 0.35 * Math.PI / 180;
const LIVE_TRACK_SEED_HISTORY_MAX_POINTS = 480;
const LIVE_TRACK_HISTORY_JUMP_MIN_METERS = 5000;
const LIVE_TRACK_HISTORY_SPEED_GRACE_FACTOR = 1.5;
const LIVE_TRACK_HISTORY_MAX_SPEED_MPS_BY_SUBTYPE = Object.freeze({
    helicopter: 180,
    drone: 350,
    uav: 350,
    awacs: 600,
    tanker: 600,
    refueler: 600,
    transport: 600,
    logistics: 600,
    logistic: 600,
    recon: 650,
    isr: 650,
    vip: 650,
    aircraft: 700,
    bomber: 900,
    fighter: 950,
});
const LIVE_TRACK_TRAIL_SPIKE_MIN_METERS = 900;
const LIVE_TRACK_TRAIL_SPIKE_RATIO = 1.72;
const LIVE_TRACK_MIN_ANIM_DISTANCE_METERS = 2;
const LIVE_TRACK_DUPLICATE_DISTANCE_METERS = 6500;
const LIVE_TRACK_DUPLICATE_HEADING_DELTA_DEG = 18;
const LIVE_TRACK_DUPLICATE_SPEED_DELTA_KTS = 80;
const LIVE_TRACK_FOCUS_COAST_MAX_MS = 12000;
const LIVE_TRACK_FOCUS_COAST_MIN_SPEED_KTS = 60;
const LIVE_TRACK_STALE_UPDATE_TOLERANCE_MS = 250;
const LIVE_TRACK_INSIGNIFICANT_DISTANCE_METERS = 8;
const LIVE_TRACK_INSIGNIFICANT_ALTITUDE_FEET = 20;
const LIVE_TRACK_INSIGNIFICANT_HEADING_DEG = 0.75;
const LIVE_TRACK_INSIGNIFICANT_SPEED_KTS = 1.5;
const LIVE_TRACK_MAJOR_CORRECTION_MIN_METERS = 50000;
const LIVE_TRACK_MAJOR_CORRECTION_SPEED_FACTOR = 8;
const LIVE_TRACK_MIN_ANIM_MS = 700;
const LIVE_TRACK_MAX_ANIM_MS = 4400;
const LIVE_TRACK_DEFAULT_ANIM_MS = 3600;
const LIVE_TRACK_FOCUS_MIN_ANIM_MS = 1100;
const LIVE_TRACK_FOCUS_MAX_ANIM_MS = 2400;
const LIVE_TRACK_FOCUS_DEFAULT_ANIM_MS = 1850;
const LIVE_TRACK_ANIM_TRAIL_SAMPLE_MS = 420;
const LIVE_TRACK_ANIMATE_ONLY_SELECTED = true;
const LIVE_TRACK_HISTORY_RETENTION_MS = 12 * 60 * 60 * 1000;
const LIVE_TRACK_HISTORY_MAX_POINTS = 720;
const LIVE_TRACK_FOCUS_ROUTE_SPIKE_MIN_METERS = 4500;
const LIVE_TRACK_FOCUS_ROUTE_SPIKE_RATIO = 2.15;
const LIVE_TRACK_REGISTRY_MAX_ITEMS = 900;
const LIVE_TRACK_INACTIVE_HISTORY_MAX_POINTS = 18;
const LIVE_TRACK_REPLAY_STEP_MS = 180;
const LIVE_TRACK_BILLBOARD_CANVAS_SIZE = 96;
const LIVE_AIRCRAFT_MODEL_BASE_PATH = "/assets/images/models/air";
const LIVE_AIRCRAFT_MODEL_DEFAULT_CODE = "Fighter-F16";
// Workbook R3 canonical asset registry. Runtime resolution uses Asset Key, then
// reads exact model/icon filenames from here so future Blender exports only need
// a new row and rule/default mapping.
const LIVE_AIRCRAFT_ASSET_FILES = Object.freeze({
    "AWACS-E3": Object.freeze({ category: "awacs", model: "AWACS-E3.glb", icon: "AWACS-E3.png" }),
    "AWACS-E4": Object.freeze({ category: "awacs", classification: "Airborne Command and Control", model: "AWACS-E4.glb", icon: "AWACS-E3.png" }),
    "AWACS-E7": Object.freeze({ category: "awacs", model: "AWACS-E7.glb", icon: "AWACS-E7.png" }),
    "AWACS-Globaleye": Object.freeze({ category: "awacs", model: "AWACS-Globaleye.glb", icon: "AWACS-Globaleye.png" }),
    "AWACS-Phalcon": Object.freeze({ category: "awacs", model: "AWACS-Phalcon.glb", icon: "AWACS-Phalcon.png" }),
    "Transport-C5": Object.freeze({ category: "transport", model: "Transport-C5.glb", icon: "Transport-C5.png" }),
    "Transport-C17": Object.freeze({ category: "transport", model: "Transport-C17.glb", icon: "Transport-C17.png" }),
    "Transport-C130": Object.freeze({ category: "transport", model: "Transport-C130.glb", icon: "Transport-C130.png" }),
    "Transport-IL76": Object.freeze({ category: "transport", model: "Transport-IL76.glb", icon: "Transport-IL76.png" }),
    "Tanker-A330-MRTT": Object.freeze({ category: "tanker", model: "Tanker-A330-MRTT.glb", icon: "Tanker-A330-MRTT.png" }),
    "Tanker-KC135": Object.freeze({ category: "tanker", model: "Tanker-KC135.glb", icon: "Tanker-KC135.png" }),
    "Tanker-IL78": Object.freeze({ category: "tanker", model: "Tanker-IL78.glb", icon: "Tanker-IL78.png" }),
    "Bomber-B1": Object.freeze({ category: "bomber", model: "Bomber-B1.glb", icon: "Bomber-B1.png" }),
    "Bomber-B2": Object.freeze({ category: "bomber", model: "Bomber-B2.glb", icon: "Bomber-B2.png" }),
    "Bomber-B52": Object.freeze({ category: "bomber", model: "Bomber-B52.glb", icon: "Bomber-B52.png" }),
    "Bomber-SU34": Object.freeze({ category: "bomber", model: "Bomber-SU34.glb", icon: "Bomber-SU34.png" }),
    "Heli-412": Object.freeze({ category: "helicopter", model: "Heli-412.glb", icon: "Heli-412.png" }),
    "Heli-Apache": Object.freeze({ category: "helicopter", model: "Heli-Apache.glb", icon: "Heli-Apache.png" }),
    "Heli-Blackhawk": Object.freeze({ category: "helicopter", model: "Heli-Blackhawk.glb", icon: "Heli-Blackhawk.png" }),
    "Heli-CH53": Object.freeze({ category: "helicopter", model: "Heli-CH53.glb", icon: "Heli-CH53.png" }),
    "Heli-Chinook": Object.freeze({ category: "helicopter", model: "Heli-Chinook.glb", icon: "Heli-Chinook.png" }),
    "Heli-Cobra-Zulu": Object.freeze({ category: "helicopter", model: "Heli-Cobra-Zulu.glb", icon: "Heli-Cobra-Zulu.png" }),
    "Heli-KA50": Object.freeze({ category: "helicopter", classification: "Attack Helicopter", model: "Heli-KA50.glb", icon: "Heli-KA50.png" }),
    "Heli-MI17": Object.freeze({ category: "helicopter", model: "Heli-MI17.glb", icon: "Heli-MI17.png" }),
    "Heli-MI17V": Object.freeze({ category: "helicopter", model: "Heli-MI17V.glb", icon: "Heli-MI17V.png" }),
    "Fighter-F15": Object.freeze({ category: "fighter", model: "Fighter-F15.glb", icon: "Fighter-F15.png" }),
    "Fighter-F16": Object.freeze({ category: "fighter", model: "Fighter-F16.glb", icon: "Fighter-F16.png" }),
    "Fighter-F18": Object.freeze({ category: "fighter", model: "Fighter-F18.glb", icon: "Fighter-F18.png" }),
    "Fighter-F22": Object.freeze({ category: "fighter", model: "Fighter-F22.glb", icon: "Fighter-F22.png" }),
    "Fighter-F35": Object.freeze({ category: "fighter", model: "Fighter-F35.glb", icon: "Fighter-F35.png" }),
    "Fighter-Eurofighter": Object.freeze({ category: "fighter", model: "Fighter-Eurofighter.glb", icon: "Fighter-Eurofighter.png" }),
    "Fighter-J10": Object.freeze({ category: "fighter", model: "Fighter-J10.glb", icon: "Fighter-J10.png" }),
    "Fighter-J20": Object.freeze({ category: "fighter", model: "Fighter-J20.glb", icon: "Fighter-J20.png" }),
    "Fighter-J11": Object.freeze({ category: "fighter", model: "Fighter-J11.glb", icon: "Fighter-J11.png" }),
    "Fighter-Rafale": Object.freeze({ category: "fighter", model: "Fighter-Rafale.glb", icon: "Fighter-Rafale.png" }),
    "Fighter-SU30": Object.freeze({ category: "fighter", model: "Fighter-SU30.glb", icon: "Fighter-SU30.png" }),
    "ISR-Gulfstream": Object.freeze({ category: "recon", model: "ISR-Gulfstream.glb", icon: "ISR-Gulfstream.png" }),
    "ISR-RC135": Object.freeze({ category: "recon", model: "ISR-RC135.glb", icon: "ISR-Gulfstream.png" }),
    "ISR-P8": Object.freeze({ category: "recon", model: "ISR-P8.glb", icon: "ISR-P8.png" }),
    "VIP-VC25": Object.freeze({ category: "vip", classification: "Presidential Airlift", model: "VIP-VC25.glb", icon: "Transport-C17.png" }),
    "Drone-Globalhawk": Object.freeze({ category: "drone", model: "Drone-Globalhawk.glb", icon: "Drone-Globalhawk.png" }),
    "Drone-MQ9": Object.freeze({ category: "drone", model: "Drone-MQ9.glb", icon: "Drone-MQ9.png" }),
});
const LIVE_AIRCRAFT_ASSET_KEY_BY_ICON_CODE = Object.freeze({
    "aw-1": "AWACS-E3",
    "aw-2": "AWACS-Phalcon",
    "aw-3": "AWACS-Globaleye",
    "bb-1": "Bomber-B2",
    "bb-2": "Bomber-B1",
    "dd-1": "Drone-MQ9",
    "ff-1": "Fighter-F22",
    "ff-2": "Fighter-Rafale",
    "ff-3": "Fighter-SU30",
    "ff-4": "Fighter-J20",
    "ff-5": "Fighter-F16",
    "hh-1": "Heli-Apache",
    "hh-2": "Heli-412",
    "rr-1": "ISR-Gulfstream",
    "tn-1": "Tanker-KC135",
    "tn-2": "Tanker-IL78",
    "tp-1": "Transport-C130",
    "tp-2": "Transport-C17",
});
const LIVE_AIRCRAFT_ICON_CODE_BY_ASSET_KEY = Object.freeze(
    Object.entries(LIVE_AIRCRAFT_ASSET_KEY_BY_ICON_CODE)
        .reduce((acc, [iconCode, assetKey]) => {
            if (!acc[assetKey]) acc[assetKey] = iconCode;
            return acc;
        }, {})
);
const LIVE_AIRCRAFT_ICON_FALLBACK_CODE_BY_ASSET_KEY = Object.freeze({
    "AWACS-E4": "aw-1",
    "AWACS-E7": "aw-3",
    "Transport-C5": "tp-2",
    "Transport-IL76": "tp-2",
    "Tanker-A330-MRTT": "tn-1",
    "Bomber-B52": "bb-2",
    "Bomber-SU34": "bb-1",
    "Heli-Blackhawk": "hh-2",
    "Heli-CH53": "hh-2",
    "Heli-Chinook": "hh-2",
    "Heli-Cobra-Zulu": "hh-1",
    "Heli-KA50": "hh-1",
    "Heli-MI17": "hh-2",
    "Heli-MI17V": "hh-2",
    "Fighter-F15": "ff-5",
    "Fighter-F18": "ff-5",
    "Fighter-F35": "ff-5",
    "Fighter-Eurofighter": "ff-2",
    "Fighter-J10": "ff-4",
    "Fighter-J11": "ff-3",
    "ISR-P8": "rr-1",
    "VIP-VC25": "tp-2",
    "Drone-Globalhawk": "dd-1",
});
const LIVE_AIRCRAFT_MODEL_CODES = new Set([
    ...Object.keys(LIVE_AIRCRAFT_ASSET_FILES),
    ...Object.keys(LIVE_AIRCRAFT_ASSET_KEY_BY_ICON_CODE),
]);
const LIVE_AIRCRAFT_MODEL_CODE_BY_SUBTYPE = Object.freeze({
    bomber: "Bomber-B1",
    fighter: "Fighter-F16",
    awacs: "AWACS-E3",
    recon: "ISR-Gulfstream",
    isr: "ISR-Gulfstream",
    tanker: "Tanker-KC135",
    refueler: "Tanker-KC135",
    transport: "Transport-C17",
    logistics: "Transport-C17",
    logistic: "Transport-C17",
    drone: "Drone-MQ9",
    uav: "Drone-MQ9",
    helicopter: "Heli-412",
    vip: "ISR-Gulfstream",
    trainer: "Fighter-F16",
    aircraft: "Fighter-F16",
});
const LIVE_TRACK_STALE_TIMEOUT_MS = 90 * 1000;
const LIVE_TRACK_RENDER_MODE = Object.freeze({
    PNG: "png",
    CHAR: "char",
    MODEL: "model",
    POINT: "point",
});
const LIVE_TRACK_MODEL_DEFAULT_MAX_ACTIVE = 16;
const LIVE_TRACK_MODEL_DEFAULT_ZOOM_HEIGHT = 280000;
const LIVE_TRACK_CHAR_FALLBACK_DEFAULT_COUNT = 90;
const LIVE_AIRCRAFT_ICON_BASE_PATH = "/assets/images/live";
const LIVE_AIRCRAFT_ICON_DEFAULT_CODE = "Fighter-F16";
const LIVE_AIRCRAFT_ICON_CODES = new Set([
    ...Object.keys(LIVE_AIRCRAFT_ASSET_FILES),
    "bb-1", "bb-2",
    "ff-1", "ff-2", "ff-3", "ff-4", "ff-5",
    "aw-1", "aw-2", "aw-3",
    "tn-1", "tn-2",
    "tp-1", "tp-2",
    "hh-1", "hh-2",
    "rr-1",
    "dd-1",
]);
const LIVE_AIRCRAFT_ICON_DIMENSIONS = Object.freeze({
    "aw-1": Object.freeze({ width: 450, height: 546 }),
    "aw-2": Object.freeze({ width: 495, height: 483 }),
    "aw-3": Object.freeze({ width: 495, height: 483 }),
    "bb-1": Object.freeze({ width: 540, height: 288 }),
    "bb-2": Object.freeze({ width: 475, height: 567 }),
    "dd-1": Object.freeze({ width: 553, height: 364 }),
    "ff-1": Object.freeze({ width: 347, height: 424 }),
    "ff-2": Object.freeze({ width: 307, height: 440 }),
    "ff-3": Object.freeze({ width: 374, height: 517 }),
    "ff-4": Object.freeze({ width: 373, height: 485 }),
    "ff-5": Object.freeze({ width: 380, height: 456 }),
    "hh-1": Object.freeze({ width: 334, height: 600 }),
    "hh-2": Object.freeze({ width: 340, height: 499 }),
    "rr-1": Object.freeze({ width: 419, height: 517 }),
    "tn-1": Object.freeze({ width: 454, height: 606 }),
    "tn-2": Object.freeze({ width: 456, height: 548 }),
    "tp-1": Object.freeze({ width: 531, height: 436 }),
    "tp-2": Object.freeze({ width: 501, height: 506 }),
});
const LIVE_AIRCRAFT_ICON_REFERENCE_MAX_DIMENSION = Math.max(
    ...Object.values(LIVE_AIRCRAFT_ICON_DIMENSIONS).map((dimensions) => {
        return Math.max(Number(dimensions?.width) || 0, Number(dimensions?.height) || 0);
    })
);
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
    "people s liberation army air force",
    "pla",
    "plaaf",
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
    /\b(general atomic(?:s)?|ga[\s-]?asi|reaper|predator|skyguardian|sky guardian|seaguardian|sea guardian|protector(?:\s+rg[\s-]?1)?)\b/i,
];
const LIVE_AIRCRAFT_RECON_PATTERNS = [
    /\b(recon|reconnaissance|isr|surveillance|patrol|sigint|elint|maritime patrol|maritime isr|naval surveillance|asw|anti-submarine warfare)\b/i,
    /\b(rc ?135|ep ?3|p ?3|p ?8|p ?1|u ?2|il ?20|tu ?214r|rivet joint|cobra ball|combat sent|poseidon|orion|aurora|atlantique|nimrod|global hawk)\b/i,
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
const LIVE_AIRCRAFT_CASA_HC144_PATROL_PATTERNS = [
    /\b(hc ?144b?|c ?144b?|casa 144b?|ocean sentry)\b/i,
    /\b(uscg|u s coast guard|united states coast guard|coast guard)\b.*\b(cn ?235|c ?295|casa)\b/i,
    /\b(cn ?235|c ?295|casa)\b.*\b(uscg|u s coast guard|united states coast guard|coast guard)\b/i,
];
const LIVE_AIRCRAFT_FALCON_7X_PATTERNS = [
    /\b(dassault falcon 7x|falcon 7x|fa7x|f7x)\b/i,
];
const LIVE_AIRCRAFT_FALCON_EXECUTIVE_PATTERNS = [
    /\b(dassault falcon 7x|falcon 7x|fa7x|f7x)\b/i,
    /\b(dassault falcon 8x|falcon 8x|fa8x|f8x)\b/i,
    /\b(dassault falcon 900[a-z]?\b|falcon 900[a-z]?\b|falcon900[a-z]?\b)\b/i,
    /\b(dassault falcon 2000[a-z]?\b|falcon 2000[a-z]?\b|falcon2000[a-z]?\b)\b/i,
    /\b(dassault falcon 50[a-z]?\b|falcon 50[a-z]?\b|falcon50[a-z]?\b)\b/i,
];
const LIVE_AIRCRAFT_HELICOPTER_PATTERNS = [
    /\b(helicopter|rotary|rotorcraft|gunship|utility helicopter|attack helicopter|lift helicopter)\b/i,
    /\b(ah ?1|ah ?64|mi ?8|mi ?17|mi ?24|mi ?25|mi ?28(?:nm|n)?|mi ?35|ka ?50|ka ?52|hokum|hind|havoc|z ?10|t ?129|uh ?60|s ?70|ch ?47|ch ?53|mh ?53|super stallion|king stallion|nh ?90|aw ?101|h ?225|bell)\b/i,
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
const LIVE_AIRCRAFT_EUROFIGHTER_FAMILY_PATTERNS = [
    /\beurofighter(?:\s+typhoon)?\b/i,
    /\btyphoon(?:\s+(?:fgr\.?\s?4|t3|f2|tranche\s*[123]))?\b/i,
    /\bef[\s-]?2000\b/i,
    /\bef\s+typhoon\b/i,
    /\beurofighter\s+ef[\s-]?2000\b/i,
];
const LIVE_AIRCRAFT_RU_FIGHTER_PATTERNS = [
    /\b(su ?24|su ?25|su ?27|su ?30|su ?33|su ?34|su ?35|su ?57|mig ?21|mig ?23|mig ?29|mig ?31)\b/i,
];
const LIVE_AIRCRAFT_SU30_FAMILY_PATTERNS = [
    /\bsu[\s-]?30(?:mki|mkk|mk2|sm2|sm|mka|mkm|mkv|mk2v|kn)?\b/i,
];
const LIVE_AIRCRAFT_J10_FAMILY_PATTERNS = [
    /\bj[\s-]?10(?:a|b|c|s|ce|ay|sy)?\b/i,
    /\bchengdu\s+j[\s-]?10\b/i,
    /\bvigorous dragon\b/i,
    /\bfc[\s-]?20\b/i,
];
const LIVE_AIRCRAFT_J20_FAMILY_PATTERNS = [
    /\bj[\s-]?20(?:a|s)?\b/i,
    /\bmighty dragon\b/i,
];
const LIVE_AIRCRAFT_J35_FAMILY_PATTERNS = [
    /\bj[\s-]?35\b/i,
    /\bfc[\s-]?31\b/i,
    /\bgyrfalcon\b/i,
];
const LIVE_AIRCRAFT_J11_FLANKER_FAMILY_PATTERNS = [
    /\bj[\s-]?11(?:a|b|bs)?\b/i,
    /\bj[\s-]?15b?\b/i,
    /\bj[\s-]?16d?\b/i,
    /\bsu[\s-]?27(?:s|sk)?\b/i,
    /\bsu[\s-]?33\b/i,
    /\bsu[\s-]?35s?\b/i,
    /\bmig[\s-]?29(?:a|s|sm|smt|m|k|kub)?\b/i,
    /\bmig[\s-]?35d?\b/i,
    /\bflanker\b/i,
    /\bfulcrum\b/i,
];
const LIVE_AIRCRAFT_CN_FIGHTER_PATTERNS = [
    /\b(j ?7|j ?8|j ?10|j ?20|j ?35|jh ?7|fc ?31)\b/i,
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
const LIVE_AIRCRAFT_ASSET_SUFFIX_OVERRIDE_RULES = Object.freeze([
    { assetKey: "Bomber-SU34", patterns: [/\bsu[\s-]?34\b/i, /\bfullback\b/i] },
    { assetKey: "Bomber-B2", patterns: [/\bb[\s-]?2\b/i, /\bspirit\b/i] },
    { assetKey: "Bomber-B52", patterns: [/\bb[\s-]?52[gh]?\b/i, /\bstratofortress\b/i, /\bboeing\s+b[\s-]?52\b/i] },
    { assetKey: "Bomber-B1", patterns: [/\bb[\s-]?1\b/i, /\blancer\b/i, /\btu[\s-]?160\b/i, /\bblackjack\b/i, /\btu[\s-]?22m3\b/i, /\bbackfire\b/i, /\btu[\s-]?95\b/i, /\bbear\b/i, /\bh[\s-]?6\b/i] },
    { assetKey: "AWACS-E4", patterns: [/\be[\s-]?4(?:[abc])?\b/i, /\bnightwatch\b/i, /\bdoomsday(?:\s+(?:plane|aircraft))?\b/i, /\bnational airborne operations center\b/i, /\bnaoc\b/i] },
    { assetKey: "VIP-VC25", patterns: [/\bvc[\s-]?25(?:[abc])?\b/i, /\bair force one\b/i, /\bpresidential (?:aircraft|airlift)\b/i, /\bsam[\s-]?(?:28000|29000)\b/i] },
    { assetKey: "AWACS-E3", patterns: [/\be[\s-]?3\b/i, /\bsentry\b/i, /\bawacs e[\s-]?3\b/i] },
    { assetKey: "AWACS-E7", patterns: [/\be[\s-]?7\b/i, /\bwedgetail\b/i, /\b737 aew(?:&c)?\b/i, /\bpeace eagle\b/i] },
    { assetKey: "AWACS-Globaleye", patterns: [/\bglobal\s*eye\b/i, /\bglobaleye\b/i, /\berieye\b/i, /\bsaab (?:340|2000) aew\b/i, /\bemb[\s-]?145 aew\b/i, /\bnetra\b/i] },
    { assetKey: "AWACS-Phalcon", patterns: [/\bkj[\s-]?2000\b/i, /\ba[\s-]?50ei\b/i, /\bphalcon\b/i, /\bil[\s-]?76 phalcon\b/i, /\bkj[\s-]?500\b/i, /\bkj[\s-]?200\b/i, /\bzdk[\s-]?03\b/i, /\by[\s-]?[89] awacs\b/i, /\ba[\s-]?50\b/i, /\ba[\s-]?100\b/i] },
    { assetKey: "Transport-C5", patterns: [/\bc[\s-]?5\b/i, /\bgalaxy\b/i] },
    { assetKey: "Transport-C17", patterns: [/\bc[\s-]?17\b/i, /\bglobemaster\b/i, /\by[\s-]?20\b/i, /\bkunpeng\b/i, /\ba[\s-]?400m?\b/i, /\batlas\b/i, /\bc[\s-]?2 kawasaki\b/i, /\ban[\s-]?70\b/i] },
    { assetKey: "Transport-IL76", patterns: [/\bil[\s-]?76(?:md)?\b/i, /\bil[\s-]?476\b/i, /\ban[\s-]?124\b/i, /\bruslan\b/i, /\ban[\s-]?22\b/i] },
    { assetKey: "Transport-C130", patterns: [/\bc[\s-]?130j?\b/i, /\bhercules\b/i, /\bc[\s-]?27j\b/i, /\bspartan\b/i, /\bc[\s-]?295\b/i, /\bcn[\s-]?235\b/i, /\ban[\s-]?12\b/i, /\ban[\s-]?26\b/i, /\by[\s-]?[89] transport\b/i] },
    { assetKey: "Tanker-A330-MRTT", patterns: [/\ba(?:310|330)\s*mrtt\b/i, /\bairbus\s*a(?:310|330)\b/i, /\bvoyager\b/i, /\bmulti[\s-]?role tanker\b/i, /\bmulti[\s-]?role tanker transport\b/i, /\bmrtt\b/i] },
    { assetKey: "Tanker-KC135", patterns: [/\bkc[\s-]?135\b/i, /\bkc[\s-]?46a?\b/i, /\bkc[\s-]?10\b/i, /\bpegasus\b/i, /\bstratotanker\b/i, /\bextender\b/i] },
    { assetKey: "Tanker-IL78", patterns: [/\bil[\s-]?78\b/i, /\bil[\s-]?76\s*(?:tanker|midas)?\b/i, /\bmki tanker\b/i, /\bh[\s-]?6u\b/i, /\byy[\s-]?20\b/i, /\bmidas\b/i] },
    { assetKey: "Fighter-F22", patterns: [/\bf[\s-]?22\b/i, /\braptor\b/i] },
    { assetKey: "Fighter-F35", patterns: [/\bf[\s-]?35\b/i, /\blightning (?:ii|2)\b/i, ...LIVE_AIRCRAFT_J35_FAMILY_PATTERNS] },
    { assetKey: "Fighter-J20", patterns: LIVE_AIRCRAFT_J20_FAMILY_PATTERNS },
    { assetKey: "Fighter-J10", patterns: LIVE_AIRCRAFT_J10_FAMILY_PATTERNS },
    { assetKey: "Fighter-F15", patterns: [/\bf[\s-]?15\b/i, /\beagle\b/i, /\bstrike eagle\b/i] },
    { assetKey: "Fighter-F18", patterns: [/\bf\/a[\s-]?18\b/i, /\bfa[\s-]?18\b/i, /\bf[\s-]?18\b/i, /\bhornet\b/i, /\bsuper hornet\b/i, /\bgrowler\b/i, /\bea[\s-]?18g\b/i] },
    { assetKey: "Fighter-Eurofighter", patterns: LIVE_AIRCRAFT_EUROFIGHTER_FAMILY_PATTERNS },
    { assetKey: "Fighter-Rafale", patterns: [/\brafale\b/i, /\bmirage[\s-]?2000\b/i, /\bmirage (?:iii|5)\b/i, /\beurofighter\b/i, /\btyphoon\b/i, /\bgripen\b/i, /\bjas[\s-]?39\b/i, /\btornado\b/i, /\bjaguar\b/i] },
    { assetKey: "Fighter-SU30", patterns: LIVE_AIRCRAFT_SU30_FAMILY_PATTERNS },
    { assetKey: "Fighter-J11", patterns: LIVE_AIRCRAFT_J11_FLANKER_FAMILY_PATTERNS },
    { assetKey: "Fighter-SU30", patterns: [/\bsu[\s-]?57\b/i, /\bmig[\s-]?31\b/i, /\bfoxhound\b/i] },
    { assetKey: "Fighter-F16", patterns: [/\bf[\s-]?16\b/i, /\bfighting falcon\b/i, /\bviper\b/i, /\bjf[\s-]?17\b/i, /\bfa[\s-]?50\b/i, /\bt[\s-]?50\b/i, /\btejas\b/i, /\blca\b/i, /\bamx\b/i, /\bkfir\b/i] },
    { assetKey: "Fighter-J20", patterns: [/\bjh[\s-]?7\b/i] },
    { assetKey: "Heli-Apache", patterns: [/\bah[\s-]?64\b/i, /\bapache\b/i] },
    { assetKey: "Heli-Cobra-Zulu", patterns: [/\bah[\s-]?1\b/i, /\bcobra\b/i, /\bviper\b/i, /\bzulu\b/i] },
    { assetKey: "Heli-Chinook", patterns: [/\bch[\s-]?47\b/i, /\bchinook\b/i] },
    { assetKey: "Heli-CH53", patterns: [/\bch[\s-]?53[ek]?\b/i, /\bmh[\s-]?53\b/i, /\bsuper stallion\b/i, /\bking stallion\b/i, /\bstallion\b/i] },
    { assetKey: "Heli-Blackhawk", patterns: [/\buh[\s-]?60\b/i, /\bblack\s*hawk\b/i, /\bs[\s-]?70\b/i, /\bsh[\s-]?60\b/i, /\bseahawk\b/i, /\bmh[\s-]?60\b/i] },
    { assetKey: "Heli-KA50", patterns: [/\bka[\s-]?50\b/i, /\bkamov\s+ka[\s-]?50\b/i, /\bhokum(?:[\s-]?a)?\b/i] },
    { assetKey: "Heli-MI17V", patterns: [/\bmi[\s-]?17v\b/i, /\bmi[\s-]?17v5\b/i, /\bmi[\s-]?17v-?5\b/i, /\bmi[\s-]?171\b/i, /\bmi[\s-]?172\b/i] },
    { assetKey: "Heli-MI17", patterns: [/\bmi[\s-]?8\b/i, /\bmi[\s-]?17\b/i, /\bhip\b/i] },
    { assetKey: "Heli-412", patterns: [/\bbell[\s-]?412\b/i, /\buh[\s-]?1\b/i, /\bhuey\b/i, /\bab[\s-]?212\b/i, /\baw139\b/i, /\baw101\b/i, /\bnh90\b/i, /\bh225m\b/i, /\bcougar\b/i, /\bcaracal\b/i, /\bka[\s-]?27\b/i, /\btiger\b/i, /\bt129\b/i, /\bz[\s-]?(?:10|19)\b/i, /\bdhruv\b/i, /\blch\b/i] },
    { assetKey: "Drone-Globalhawk", patterns: [/\brq[\s-]?4\b/i, /\bglobal\s*hawk\b/i, /\bmq[\s-]?4c\b/i, /\bmq[\s-]?4\b/i, /\btriton\b/i, /\bxianglong\b/i, /\bsoaring dragon\b/i, /\b9sq\b/i] },
    { assetKey: "Drone-MQ9", patterns: [/\bmq[\s-]?9[ab]?\b/i, /\breaper\b/i, /\bpredator\b/i, /\bgeneral atomic(?:s)?\b/i, /\bga[\s-]?asi\b/i, /\bskyguardian\b/i, /\bsky guardian\b/i, /\bseaguardian\b/i, /\bsea guardian\b/i, /\bprotector(?:\s+rg[\s-]?1)?\b/i, /\bmq[\s-]?1\b/i, /\bbayraktar\b/i, /\btb[\s-]?2\b/i, /\bwing loong\b/i, /\bwingloong\b/i, /\bheron\b/i, /\bhermes\b/i, /\borion uav\b/i, /\bforpost\b/i, /\banka\b/i, /\bakinci\b/i, /\baksungur\b/i, /\bch[\s-]?[45]\b/i, /\bmohajer\b/i] },
    { assetKey: "ISR-P8", patterns: [/\bp[\s-]?8a?\b/i, /\bp[\s-]?8i\b/i, /\bposeidon\b/i, /\bboeing\s+p[\s-]?8\b/i, /\bp[\s-]?3\b/i, /\borion\b/i, /\bep[\s-]?3e?\b/i, /\bcp[\s-]?140\b/i, /\baurora\b/i, /\bkawasaki\s+p[\s-]?1\b/i, /\bp[\s-]?1\b/i, /\batlantique\s*2\b/i, /\batl2\b/i, /\bbr[eé]guet\s+atlantique\b/i, /\bnimrod(?:\s+mra4)?\b/i, /\by[\s-]?8q\b/i, /\bkq[\s-]?200\b/i, /\by[\s-]?9q\b/i, /\bmaritime patrol\b/i, /\bmaritime isr\b/i, /\bnaval surveillance\b/i, /\basw\b/i, /\banti[\s-]?submarine warfare\b/i] },
    { assetKey: "ISR-RC135", patterns: [/\brc[\s-]?135[a-z0-9-]*\b/i, /\brivet\s+joint\b/i, /\bcobra\s+ball\b/i, /\bcombat\s+sent\b/i] },
    { assetKey: "ISR-Gulfstream", patterns: [/\bgulfstream\b/i, /\bg(?:280|550|650)\b/i, /\bbombardier\b/i, /\bchallenger\b/i, /\bglobal (?:6000|6500)\b/i, /\blearjet\b/i, /\blj[\s-]?(?:3[15]|4[05]|5[05]|6[05]|7[05])\b/i, /\bbeechcraft\b/i, /\bking air\b/i, ...LIVE_AIRCRAFT_FALCON_EXECUTIVE_PATTERNS, /\brc[\s-]?12\b/i, /\bmc[\s-]?12\b/i, /\bisr\b/i, /\belint\b/i, /\bsigint\b/i, /\bsurveillance\b/i] },
]);
const LIVE_AIRCRAFT_HELO_ATTACK_PATTERNS = [
    /\b(ah ?1[a-z]?|ah ?64[a-z]?|apache|mi ?24|mi ?25|mi ?28|mi ?35|ka ?52|z ?10|t ?129|tiger|rooivalk|gunship|attack helicopter)\b/i,
];
const LIVE_AIRCRAFT_RUSSIAN_ATTACK_HELO_FALLBACK_PATTERNS = [
    /\b(ka[\s-]?52|alligator|mi[\s-]?24|mi[\s-]?35|hind|mi[\s-]?28(?:nm|n)?|havoc|gunship|attack helicopter)\b/i,
];
const LIVE_AIRCRAFT_LEGACY_GENERIC_HELO_PATTERNS = [
    /\b(ka[\s-]?52|mi[\s-]?24|mi[\s-]?35)\b/i,
];
const LIVE_AIRCRAFT_GLOBAL_DEFAULTS = Object.freeze({
    fighter: "Fighter-F16",
    awacs: "AWACS-E3",
    transport: "Transport-C17",
    tanker: "Tanker-KC135",
    refueler: "Tanker-KC135",
    bomber: "Bomber-B1",
    helicopter: "Heli-412",
    recon: "ISR-Gulfstream",
    isr: "ISR-Gulfstream",
    drone: "Drone-MQ9",
    uav: "Drone-MQ9",
    aircraft: "Fighter-F16",
});
const LIVE_AIRCRAFT_COUNTRY_DEFAULTS = Object.freeze([
    { tokens: ["united states", "usa", "us air force", "usaf", "us navy", "usn", "american"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-E3", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["canada", "canadian"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-E7", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["united kingdom", "uk", "great britain", "british", "royal air force"], defaults: { fighter: "Fighter-F35", awacs: "AWACS-E7", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["france", "french"], defaults: { fighter: "Fighter-Rafale", awacs: "AWACS-E3", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-412" } },
    { tokens: ["germany", "german"], defaults: { fighter: "Fighter-Rafale", awacs: "AWACS-E3", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-412" } },
    { tokens: ["italy", "italian"], defaults: { fighter: "Fighter-F35", awacs: "AWACS-Globaleye", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["spain", "spanish"], defaults: { fighter: "Fighter-Rafale", awacs: "AWACS-Phalcon", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-412" } },
    { tokens: ["netherlands", "dutch", "belgium", "belgian", "denmark", "danish", "norway", "norwegian"], defaults: { fighter: "Fighter-F35", awacs: "AWACS-E3", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["poland", "polish", "romania", "romanian", "portugal", "portuguese", "greece", "greek"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-E3", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["turkey", "turkish"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-E7", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-412" } },
    { tokens: ["israel", "israeli"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-Globaleye", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Apache" } },
    { tokens: ["uae", "united arab emirates", "emirati"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-Phalcon", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-Apache" } },
    { tokens: ["saudi arabia", "saudi", "qatar", "qatari", "bahrain", "kuwait", "oman", "jordan"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-E3", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-Apache" } },
    { tokens: ["egypt", "egyptian", "morocco", "moroccan", "tunisia", "tunisian"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-Phalcon", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Apache" } },
    { tokens: ["pakistan", "pakistani"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-Globaleye", transport: "Transport-C130", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["india", "indian"], defaults: { fighter: "Fighter-SU30", awacs: "AWACS-Phalcon", transport: "Transport-C17", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["china", "chinese", "prc", "people s republic of china", "pla", "plaf"], defaults: { fighter: "Fighter-J20", awacs: "AWACS-Phalcon", transport: "Transport-C17", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["japan", "japanese"], defaults: { fighter: "Fighter-F35", awacs: "AWACS-E7", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["south korea", "republic of korea", "rok", "korean"], defaults: { fighter: "Fighter-F35", awacs: "AWACS-E7", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["australia", "australian", "new zealand"], defaults: { fighter: "Fighter-F35", awacs: "AWACS-E7", transport: "Transport-C17", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["singapore", "taiwan", "thailand", "philippines", "indonesia", "malaysia"], defaults: { fighter: "Fighter-F16", awacs: "AWACS-Globaleye", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["russia", "russian"], defaults: { fighter: "Fighter-SU30", awacs: "AWACS-Phalcon", transport: "Transport-IL76", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["ukraine", "belarus", "kazakhstan", "uzbekistan", "armenia"], defaults: { fighter: "Fighter-SU30", awacs: "AWACS-Phalcon", transport: "Transport-IL76", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["iran", "iranian", "syria", "syrian", "iraq", "iraqi"], defaults: { fighter: "Fighter-SU30", awacs: "AWACS-Phalcon", transport: "Transport-IL76", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["algeria", "libya", "sudan", "ethiopia", "angola"], defaults: { fighter: "Fighter-SU30", awacs: "AWACS-Phalcon", transport: "Transport-IL76", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
    { tokens: ["brazil", "chile", "argentina", "colombia", "mexico", "peru"], defaults: { fighter: "Fighter-Rafale", awacs: "AWACS-Globaleye", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-Blackhawk" } },
    { tokens: ["south africa", "nigeria", "kenya"], defaults: { fighter: "Fighter-Rafale", awacs: "AWACS-Phalcon", transport: "Transport-C130", tanker: "Tanker-KC135", helicopter: "Heli-412" } },
    { tokens: ["north korea", "dprk", "myanmar", "bangladesh", "sri lanka", "cambodia", "laos"], defaults: { fighter: "Fighter-SU30", awacs: "AWACS-Phalcon", transport: "Transport-C130", tanker: "Tanker-IL78", helicopter: "Heli-MI17" } },
]);

function normalizeAircraftIconText(value = "") {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function normalizeAircraftAssetKey(value = "") {
    const direct = String(value || "").trim();
    if (!direct) return "";
    if (LIVE_AIRCRAFT_ASSET_FILES[direct]) return direct;
    const lower = direct.toLowerCase();
    const fromIconCode = LIVE_AIRCRAFT_ASSET_KEY_BY_ICON_CODE[lower];
    if (fromIconCode && LIVE_AIRCRAFT_ASSET_FILES[fromIconCode]) return fromIconCode;
    const normalized = normalizeAircraftIconText(direct);
    return Object.keys(LIVE_AIRCRAFT_ASSET_FILES).find((assetKey) => (
        normalizeAircraftIconText(assetKey) === normalized
    )) || "";
}
function getAircraftAssetFile(assetKey = "") {
    const canonical = normalizeAircraftAssetKey(assetKey) || LIVE_AIRCRAFT_MODEL_DEFAULT_CODE;
    return LIVE_AIRCRAFT_ASSET_FILES[canonical] || LIVE_AIRCRAFT_ASSET_FILES[LIVE_AIRCRAFT_MODEL_DEFAULT_CODE];
}
function hasAnyToken(paddedHaystack = " ", tokens = []) {
    return tokens.some((token) => token && paddedHaystack.includes(` ${token} `));
}
function hasAnyPattern(haystack = "", patterns = []) {
    return patterns.some((pattern) => pattern.test(haystack));
}
function appendAircraftAssetOverrideValue(values, value) {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
        value.forEach((item) => appendAircraftAssetOverrideValue(values, item));
        return;
    }
    if (typeof value === "object") return;
    values.push(value);
}
function buildAircraftAssetOverrideHaystack(track = {}) {
    const metadata = getTrackMetadata(track);
    const values = [
        track.aircraft_name,
        track.aircraftName,
        track.name,
        track.type,
        track.type_code,
        track.icao_type,
        track.model_name,
        track.model,
        track.variant,
        track.aircraft_type,
        track.description,
        track.title,
        track.callsign,
        track.flight,
        track.registration,
        track.category,
        track.subcategory,
        track.subtype,
        track.role,
    ];
    Object.values(metadata || {}).forEach((value) => {
        appendAircraftAssetOverrideValue(values, value);
    });
    const haystack = values
        .map(normalizeAircraftIconText)
        .filter(Boolean)
        .join(" ")
        .trim();
    return haystack ? ` ${haystack} ` : " ";
}
function resolveAircraftAssetSuffixOverride(track = {}) {
    const haystack = buildAircraftAssetOverrideHaystack(track);
    const match = LIVE_AIRCRAFT_ASSET_SUFFIX_OVERRIDE_RULES.find((rule) => (
        LIVE_AIRCRAFT_ASSET_FILES[rule.assetKey] &&
        hasAnyPattern(haystack, rule.patterns)
    ));
    return match?.assetKey || "";
}
function resolveAircraftCountryDefaultAssetKey(context = {}, role = "") {
    const normalizedRole = normalizeAircraftCategoryRole(role || context.subtype || "aircraft");
    const group = LIVE_AIRCRAFT_COUNTRY_DEFAULTS.find((entry) => hasAircraftTokens(context, entry.tokens));
    return group?.defaults?.[normalizedRole] || "";
}
function normalizeAircraftCategoryRole(role = "") {
    const normalized = normalizeAircraftIconText(role);
    if (["aew", "aewc"].includes(normalized)) return "awacs";
    if (["refueler", "refueller"].includes(normalized)) return "tanker";
    if (["airlift", "cargo", "logistics", "logistic", "vip"].includes(normalized)) return "transport";
    if (["rotary", "helo"].includes(normalized)) return "helicopter";
    if (["uav", "ucav"].includes(normalized)) return "drone";
    if (["surveillance", "patrol"].includes(normalized)) return "recon";
    if (["interceptor", "multirole", "multirole fighter", "air superiority fighter"].includes(normalized)) return "fighter";
    return normalized || "aircraft";
}
function resolveAircraftFallbackAssetKey(context = {}, role = "") {
    const normalizedRole = normalizeAircraftCategoryRole(role || context.subtype || "aircraft");
    return (
        resolveAircraftCountryDefaultAssetKey(context, normalizedRole) ||
        LIVE_AIRCRAFT_GLOBAL_DEFAULTS[normalizedRole] ||
        LIVE_AIRCRAFT_GLOBAL_DEFAULTS.aircraft
    );
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
    const explicitCountry = normalizeAircraftIconText(track.country || metadata.country || "");
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
        country: explicitCountry,
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
function isRussiaCountry(context = {}) {
    return ["russia", "russian federation"].includes(String(context.country || ""));
}
function isExSovietAffiliation(context = {}) {
    return hasAircraftTokens(context, LIVE_AIRCRAFT_EX_SOVIET_TOKENS);
}
function resolveLiveAircraftRole(context = {}) {
    const subtype = String(context.subtype || "").trim().toLowerCase();
    if (["vip", "executive", "business"].includes(subtype)) return "recon";
    if (["uav", "drone", "ucav"].includes(subtype)) return "drone";
    if (["recon", "isr", "patrol", "surveillance"].includes(subtype)) return "recon";
    if (["awacs", "aew", "aewc"].includes(subtype)) return "awacs";
    if (["tanker", "refueler", "refueller"].includes(subtype)) return "tanker";
    if (["transport", "airlift", "logistics", "logistic"].includes(subtype)) return "transport";
    if (["helicopter", "rotary"].includes(subtype)) return "helicopter";
    if (["bomber"].includes(subtype)) return "bomber";
    if (["fighter", "interceptor", "multirole", "multirole fighter", "air superiority fighter"].includes(subtype)) return "fighter";

    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_FALCON_EXECUTIVE_PATTERNS)) return "recon";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_CASA_HC144_PATROL_PATTERNS)) return "recon";
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
    if (/\bb[\s-]?2\b|\bspirit\b/i.test(haystack)) return "Bomber-B2";
    if (/\bb[\s-]?52[gh]?\b|\bstratofortress\b/i.test(haystack)) return "Bomber-B52";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_US_BOMBER_PATTERNS) || isUsAffiliation(context)) return "Bomber-B1";
    return "";
}
function resolveFighterIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_J35_FAMILY_PATTERNS)) return "Fighter-F35";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_J20_FAMILY_PATTERNS)) return "Fighter-J20";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_J10_FAMILY_PATTERNS)) return "Fighter-J10";
    if (isPakistanAffiliation(context) || hasAnyPattern(haystack, LIVE_AIRCRAFT_FF5_FIGHTER_PATTERNS)) {
        return "Fighter-F16";
    }
    // Exact platform family takes priority over operator fallback.
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_CN_FIGHTER_PATTERNS)) return "Fighter-J20";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_US_FIGHTER_PATTERNS)) return "Fighter-F16";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_EUROFIGHTER_FAMILY_PATTERNS)) return "Fighter-Eurofighter";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_EU_FIGHTER_PATTERNS)) return "Fighter-Rafale";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_SU30_FAMILY_PATTERNS)) return "Fighter-SU30";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_J11_FLANKER_FAMILY_PATTERNS)) return "Fighter-J11";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_RU_FIGHTER_PATTERNS)) return "Fighter-SU30";
    return "";
}
function resolveAwacsIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    // AWACS bucket rules:
    // TR -> aw-3 model (PNG aliases to aw-1 image),
    // RU/CN/IN/IL and Russian-style -> aw-2,
    // US/NATO/EU/ME/PK and AW1 class hints -> aw-1,
    // unknown -> aw-2.
    if (isTurkeyAffiliation(context)) return "AWACS-E7";
    if (
        isChinaAffiliation(context) ||
        isRussianStyleAffiliation(context) ||
        isExSovietAffiliation(context) ||
        isIsraelAffiliation(context)
    ) {
        return "AWACS-Phalcon";
    }
    if (
        hasAnyPattern(haystack, LIVE_AIRCRAFT_AWACS_AW1_PATTERNS) ||
        isUsAffiliation(context) ||
        isPakistanAffiliation(context) ||
        isNatoAffiliation(context) ||
        isEuropeanAffiliation(context) ||
        isMiddleEastAffiliation(context)
    ) {
        return "AWACS-E3";
    }
    return "";
}
function resolveTankerIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (/\ba(?:310|330)\s*mrtt\b|\bairbus\s*a(?:310|330)\b|\bvoyager\b|\bmulti[\s-]?role tanker(?: transport)?\b|\bmrtt\b/i.test(haystack)) {
        return "Tanker-A330-MRTT";
    }
    if (/\bil[\s-]?78\b|\bil[\s-]?76\s*(?:tanker|midas)?\b|\bmki tanker\b|\bmidas\b|\byy[\s-]?20\b|\bh[\s-]?6u\b/i.test(haystack)) {
        return "Tanker-IL78";
    }
    if (
        hasAnyPattern(haystack, LIVE_AIRCRAFT_TANKER_TN1_PATTERNS) ||
        isUsAffiliation(context) ||
        isTurkeyAffiliation(context) ||
        isNatoAffiliation(context)
    ) {
        return "Tanker-KC135";
    }
    return "";
}
function resolveTransportIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    // Heavy/strategic transport gets tp-2; otherwise tactical/medium gets tp-1.
    // A400M defaults to tp-1 unless explicitly marked heavy/strategic.
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_HEAVY_ROLE_PATTERNS)) return "Transport-C17";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_TP2_PATTERNS)) return "Transport-C17";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_TP1_PATTERNS)) return "Transport-C130";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_TRANSPORT_TACTICAL_ROLE_PATTERNS)) return "Transport-C130";
    return "";
}
function resolveHelicopterIconCode(context = {}) {
    const haystack = String(context.haystack || "");
    if (
        isRussiaCountry(context) &&
        hasAnyPattern(haystack, LIVE_AIRCRAFT_RUSSIAN_ATTACK_HELO_FALLBACK_PATTERNS)
    ) {
        return "Heli-KA50";
    }
    // Keep the prior generic representation for these non-Russian gunships.
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_LEGACY_GENERIC_HELO_PATTERNS)) return "Heli-412";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_HELO_ATTACK_PATTERNS)) return "Heli-Apache";
    return "";
}
function resolveForcedAircraftModelCode(track = {}) {
    const context = buildLiveAircraftIconContext(track);
    const haystack = String(context.haystack || "");
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_MODEL_FORCE_TP2_PATTERNS)) return "Transport-C17";
    if (hasAnyPattern(haystack, LIVE_AIRCRAFT_MODEL_FORCE_TP1_PATTERNS)) return "Transport-C130";
    return "";
}
function resolveLiveAircraftIconCode(track = {}) {
    const overrideCode = resolveAircraftAssetSuffixOverride(track);
    if (normalizeAircraftAssetKey(overrideCode)) {
        return overrideCode;
    }

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
    const role = resolveLiveAircraftRole(context);
    let iconCode = resolveAircraftFallbackAssetKey(context, role);
    switch (role) {
        case "bomber":
            iconCode = normalizeAircraftAssetKey(resolveBomberIconCode(context)) || iconCode;
            break;
        case "fighter":
            iconCode = normalizeAircraftAssetKey(resolveFighterIconCode(context)) || iconCode;
            break;
        case "awacs":
            iconCode = normalizeAircraftAssetKey(resolveAwacsIconCode(context)) || iconCode;
            break;
        case "tanker":
            iconCode = normalizeAircraftAssetKey(resolveTankerIconCode(context)) || iconCode;
            break;
        case "transport":
            iconCode = normalizeAircraftAssetKey(resolveTransportIconCode(context)) || iconCode;
            break;
        case "helicopter":
            iconCode = normalizeAircraftAssetKey(resolveHelicopterIconCode(context)) || iconCode;
            break;
        case "recon":
            iconCode = normalizeAircraftAssetKey(resolveAircraftAssetSuffixOverride(track)) || "ISR-Gulfstream";
            break;
        case "drone":
            iconCode = "Drone-MQ9";
            break;
        default:
            iconCode = iconCode || LIVE_AIRCRAFT_ICON_DEFAULT_CODE;
            break;
    }
    const resolvedIconCode = normalizeAircraftAssetKey(iconCode)
        ? normalizeAircraftAssetKey(iconCode)
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
    const assetKey = normalizeAircraftAssetKey(iconCode) || LIVE_AIRCRAFT_MODEL_DEFAULT_CODE;
    const resolvedIconCode =
        LIVE_AIRCRAFT_ICON_CODE_BY_ASSET_KEY[assetKey] ||
        LIVE_AIRCRAFT_ICON_FALLBACK_CODE_BY_ASSET_KEY[assetKey];
    if (resolvedIconCode) {
        return `${LIVE_AIRCRAFT_ICON_BASE_PATH}/live-aircraft-${resolvedIconCode}.png`;
    }
    const defaultIconCode = LIVE_AIRCRAFT_ICON_CODE_BY_ASSET_KEY[LIVE_AIRCRAFT_MODEL_DEFAULT_CODE] || "ff-5";
    return `${LIVE_AIRCRAFT_ICON_BASE_PATH}/live-aircraft-${defaultIconCode}.png`;
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
let __liveTrackGlbMaterialShader = null;
function getLiveGlbMaterialShader() {
    if (typeof Cesium.CustomShader !== "function" || !Cesium.UniformType?.FLOAT) return undefined;
    const roughness = clamp(getCssNumber("--warzone-live-glb-material-roughness", 0.5), 0, 1);
    const metalness = clamp(getCssNumber("--warzone-live-glb-material-metalness", 0.2), 0, 1);
    const anisotropy = clamp(getCssNumber("--warzone-live-glb-texture-anisotropy", 8), 1, 16);
    try {
        if (!__liveTrackGlbMaterialShader) {
            __liveTrackGlbMaterialShader = new Cesium.CustomShader({
                lightingModel: Cesium.LightingModel?.PBR,
                uniforms: {
                    u_wzRoughness: { type: Cesium.UniformType.FLOAT, value: roughness },
                    u_wzMetalness: { type: Cesium.UniformType.FLOAT, value: metalness },
                    u_wzAnisotropy: { type: Cesium.UniformType.FLOAT, value: anisotropy },
                },
                fragmentShaderText: `
                    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
                        material.roughness = clamp(u_wzRoughness, 0.0, 1.0);
                        material.specular = mix(material.specular, material.baseColor.rgb, clamp(u_wzMetalness, 0.0, 1.0));
                        #ifdef USE_ANISOTROPY
                        material.anisotropyStrength = clamp(u_wzAnisotropy / 16.0, 0.0, 1.0);
                        #endif
                    }
                `,
            });
        } else {
            __liveTrackGlbMaterialShader.setUniform("u_wzRoughness", roughness);
            __liveTrackGlbMaterialShader.setUniform("u_wzMetalness", metalness);
            __liveTrackGlbMaterialShader.setUniform("u_wzAnisotropy", anisotropy);
        }
        return __liveTrackGlbMaterialShader;
    } catch {
        return undefined;
    }
}
function getLiveGlbModelQualityConfig(track = {}) {
    const ambient = clamp(
        getCssNumber("--warzone-live-glb-ambient-light-intensity", 0.85),
        0,
        1
    );
    const environment = clamp(
        getCssNumber("--warzone-live-glb-environment-intensity", ambient),
        0,
        1
    );
    const light = clamp(
        getCssNumber("--warzone-live-glb-directional-light-intensity", 2.2),
        0,
        4
    );
    const focused = isTrackInFocusVisualContext(track);
    const lodFallback = clamp(getCssNumber("--warzone-live-glb-lod-distance", 1), 0, 64);
    const lod = clamp(
        getCssNumber(
            focused ? "--warzone-live-glb-lod-distance-focused" : "--warzone-live-glb-lod-distance",
            lodFallback
        ),
        0,
        64
    );
    const shadowEnabled = getCssNumber("--warzone-live-glb-shadow-enabled", 0) >= 0.5;
    return {
        imageBasedLightingFactor: new Cesium.Cartesian2(environment, ambient),
        lightColor: new Cesium.Color(light, light, light, 1),
        maximumScreenSpaceError: lod,
        shadows: shadowEnabled ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED,
    };
}
function applyLiveGlbModelQuality(model, track = {}) {
    if (!model) return;
    const quality = getLiveGlbModelQualityConfig(track);
    model.imageBasedLightingFactor = quality.imageBasedLightingFactor;
    model.lightColor = quality.lightColor;
    model.maximumScreenSpaceError = quality.maximumScreenSpaceError;
    model.shadows = quality.shadows;
    model.customShader = getLiveGlbMaterialShader();
}
function getLiveAircraftModelVisibilityConfig(track = {}) {
    const isFocused = isTrackCurrentlyFocused(track.track_key);
    const alpha = clamp(
        getCssNumber("--warzone-live-aircraft-model-alpha", 1),
        0,
        1
    );
    const whiteness = clamp(
        getCssNumber(
            isFocused
                ? "--warzone-live-aircraft-model-focused-whiteness"
                : "--warzone-live-aircraft-model-whiteness",
            getCssNumber("--warzone-live-aircraft-model-whiteness", 0.18)
        ),
        0,
        1
    );
    return { alpha, whiteness };
}
function isTrackCurrentlyFocused(trackKey = "") {
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    return Boolean(
        selectedTrackKey &&
        selectedTrackKey === String(trackKey || "") &&
        String(__liveTrackReplayState.mode || "") === "focus"
    );
}
function hasFocusedRouteForTrack(trackKey = "") {
    return Boolean(isTrackCurrentlyFocused(trackKey) && __liveTrackReplayState.routeEntity);
}
function isTrackInFocusVisualContext(track = {}) {
    const trackKey = String(track?.track_key || "").trim();
    if (!trackKey || !isFocusSelectionActive()) return false;
    return shouldShowTrackInFocusMode(trackKey, track);
}
function getLiveTrackFocusModelSizeFalloff() {
    if (!isFocusSelectionActive()) return 0;
    const nearRange = Math.max(1, LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS);
    const farRange = Math.max(nearRange + 1, getLiveTrackFocusFinalRangeMeters());
    const range = clamp(
        Number(__liveTrackFocusRangeMeters || nearRange),
        nearRange,
        farRange
    );
    return clamp((range - nearRange) / Math.max(farRange - nearRange, 1), 0, 1);
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
function getAircraftSpeedKts(track = {}) {
    const metadata = getTrackMetadata(track);
    return parseNonNegativeNumber(
        track.speed_kts ??
        track.speed_knots ??
        track.ground_speed_kts ??
        metadata.speed_kts ??
        metadata.speed_knots ??
        metadata.ground_speed_kts ??
        null
    );
}
function isAircraftOnGround(track = {}) {
    const metadata = getTrackMetadata(track);
    const explicit = track.on_ground ?? track.onGround ?? metadata.on_ground ?? metadata.onGround ?? metadata.grounded;
    if (explicit === true || explicit === "true" || explicit === 1 || explicit === "1") return true;
    if (explicit === false || explicit === "false" || explicit === 0 || explicit === "0") return false;
    const reportedAltitudeFt = getTrackReportedAltitudeFt(track);
    const speedKts = getAircraftSpeedKts(track);
    if (Number.isFinite(reportedAltitudeFt) && reportedAltitudeFt <= 250) {
        return !Number.isFinite(speedKts) || speedKts <= 40;
    }
    return false;
}
function smoothZoomRatio(value, nearValue, farValue) {
    const near = Number(nearValue);
    const far = Number(farValue);
    const current = Number(value);
    if (!Number.isFinite(current) || !Number.isFinite(near) || !Number.isFinite(far) || far <= near) {
        return 0;
    }
    const t = clamp((current - near) / (far - near), 0, 1);
    return t * t * (3 - (2 * t));
}
function getAircraftModelScaleByZoomBand(track = {}) {
    const subtype = resolveLiveTrackSizingSubtype(track);
    const sharedBaseScale = getCssNumber(
        "--warzone-live-aircraft-model-scale",
        getCssNumber("--warzone-live-track-scale", 16)
    );
    const baseScale = getSubtypeCssNumber(
        "--warzone-live-aircraft-model-scale",
        subtype,
        sharedBaseScale
    );
    const stateVarName = isAircraftOnGround(track)
        ? "--warzone-live-aircraft-model-ground-scale"
        : "--warzone-live-aircraft-model-airborne-scale";
    const explicitSubtypeStateScale = getDirectSubtypeCssNumber(stateVarName, subtype);
    const sharedStateScale = getCssNumber(stateVarName, sharedBaseScale);
    const aircraftStateScale = isAircraftOnGround(track)
        ? (Number.isFinite(explicitSubtypeStateScale)
            ? explicitSubtypeStateScale
            : baseScale * (sharedStateScale / Math.max(sharedBaseScale, 0.0001)))
        : (Number.isFinite(explicitSubtypeStateScale)
            ? explicitSubtypeStateScale
            : baseScale * (sharedStateScale / Math.max(sharedBaseScale, 0.0001)));
    const sharedZoomInScale = getCssNumber("--warzone-live-aircraft-model-scale-zoom-in", sharedBaseScale);
    const sharedZoomOutScale = getCssNumber("--warzone-live-aircraft-model-scale-zoom-out", sharedBaseScale);
    const explicitSubtypeZoomInScale = getDirectSubtypeCssNumber("--warzone-live-aircraft-model-scale-zoom-in", subtype);
    const explicitSubtypeZoomOutScale = getDirectSubtypeCssNumber("--warzone-live-aircraft-model-scale-zoom-out", subtype);
    const zoomInScale = Number.isFinite(explicitSubtypeZoomInScale)
        ? explicitSubtypeZoomInScale
        : baseScale * (sharedZoomInScale / Math.max(sharedBaseScale, 0.0001));
    const zoomOutScale = Number.isFinite(explicitSubtypeZoomOutScale)
        ? explicitSubtypeZoomOutScale
        : baseScale * (sharedZoomOutScale / Math.max(sharedBaseScale, 0.0001));
    const zoomSplitHeight = Math.max(
        0,
        getCssNumber(
            "--warzone-live-aircraft-model-zoom-split-height",
            getCssNumber("--warzone-live-aircraft-png-zoom-split-height", 20000)
        )
    );
    const cameraHeight = getViewerCameraHeightMeters();
    const nearHeight = Math.max(0, getCssNumber("--warzone-live-aircraft-model-zoom-near-height", zoomSplitHeight * 0.45));
    const farHeight = Math.max(
        nearHeight + 1,
        getCssNumber("--warzone-live-aircraft-model-zoom-far-height", zoomSplitHeight * 3)
    );
    if (Number.isFinite(cameraHeight)) {
        const nearScale = Number.isFinite(zoomInScale) ? zoomInScale : aircraftStateScale;
        const farScale = Number.isFinite(zoomOutScale) ? zoomOutScale : aircraftStateScale;
        const ratio = smoothZoomRatio(cameraHeight, nearHeight, farHeight);
        return Cesium.Math.lerp(nearScale, farScale, ratio) * (aircraftStateScale / Math.max(baseScale, 0.0001));
    }
    return Number.isFinite(zoomOutScale) ? zoomOutScale * (aircraftStateScale / Math.max(baseScale, 0.0001)) : aircraftStateScale;
}
function getLiveTrackStyleConfig(track = {}) {
    const subtype = resolveLiveTrackSizingSubtype(track);
    return {
        trailColor: getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)"),
        trailOpacity: getCssNumber("--warzone-live-track-opacity", 0.96),
        trailWidth: getCssNumber("--warzone-live-track-width", 4.2),
        scale: getAircraftModelScaleByZoomBand(track),
        minimumPixelSize: getSubtypeCssNumber(
            "--warzone-live-aircraft-model-min-pixel-size",
            subtype,
            getCssNumber("--warzone-live-track-min-pixel-size", 140)
        ),
        maximumScale: getSubtypeCssNumber(
            "--warzone-live-aircraft-model-max-scale",
            subtype,
            getCssNumber("--warzone-live-track-max-scale", 520)
        ),
        depthTestDisableDistance: getCssNumber(
            "--warzone-live-aircraft-depth-test-disable-distance",
            0
        ),
    };
}
function resolveLiveTrackSizingSubtype(track = {}) {
    const subtype = resolveTrackSubtype(track).trim().toLowerCase();
    if (subtype === "uav") return "drone";
    return subtype || "aircraft";
}
function getDirectSubtypeCssNumber(baseVarName, subtype = "") {
    const subtypeKey = String(subtype || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!subtypeKey || subtypeKey === "aircraft") return Number.NaN;
    return getCssNumber(`${baseVarName}-${subtypeKey}`, Number.NaN);
}
function getSubtypeCssNumber(baseVarName, subtype = "", fallback) {
    const subtypeValue = getDirectSubtypeCssNumber(baseVarName, subtype);
    if (Number.isFinite(subtypeValue)) return subtypeValue;
    return getCssNumber(baseVarName, fallback);
}
function getLiveTrackSubtypeScale(track = {}, fallbackScale = 16) {
    const subtype = resolveLiveTrackSizingSubtype(track);
    const focusedScale = getSubtypeCssNumber(
        "--warzone-live-aircraft-model-focused-scale",
        subtype,
        Number.NaN
    );
    if (isTrackInFocusVisualContext(track) && Number.isFinite(focusedScale) && focusedScale > 0) {
        const farFactor = clamp(
            getSubtypeCssNumber(
                "--warzone-live-aircraft-model-focused-scale-far-factor",
                subtype,
                getCssNumber("--warzone-live-aircraft-model-focused-scale-far-factor", 0.42)
            ),
            0.12,
            1
        );
        const focusScale = Cesium.Math.lerp(
            focusedScale,
            focusedScale * farFactor,
            getLiveTrackFocusModelSizeFalloff()
        );
        return clamp(focusScale, 0.01, 3000);
    }
    const bandScale = getAircraftModelScaleByZoomBand(track);
    if (Number.isFinite(bandScale) && bandScale > 0) {
        return clamp(bandScale, 0.01, 3000);
    }
    return clamp(getCssNumber("--warzone-live-aircraft-model-scale", fallbackScale), 0.01, 3000);
}
function getLiveTrackSubtypeMinPixelSize(track = {}, fallbackValue = 140) {
    const subtype = resolveLiveTrackSizingSubtype(track);
    const focusedValue = getSubtypeCssNumber(
        "--warzone-live-aircraft-model-focused-min-pixel-size",
        subtype,
        Number.NaN
    );
    if (isTrackInFocusVisualContext(track) && Number.isFinite(focusedValue)) {
        const focusedMax = LIVE_TRACK_FOCUSED_MODEL_MIN_PIXEL_MAX_BY_SUBTYPE[subtype]
            || LIVE_TRACK_FOCUSED_MODEL_MIN_PIXEL_MAX;
        const focusedScale = getSubtypeCssNumber(
            "--warzone-live-aircraft-model-focused-scale",
            subtype,
            LIVE_TRACK_FOCUSED_MODEL_SCALE_BASELINE
        );
        const scaleFactor = Number.isFinite(focusedScale) && focusedScale > 0
            ? focusedScale / LIVE_TRACK_FOCUSED_MODEL_SCALE_BASELINE
            : 1;
        const nearValue = clamp(Math.max(0, focusedValue) * scaleFactor, 0, focusedMax);
        const fallbackMinPixel = Math.max(0, Number(fallbackValue) || 0);
        const farFactor = clamp(
            getSubtypeCssNumber(
                "--warzone-live-aircraft-model-focused-min-pixel-far-factor",
                subtype,
                getCssNumber("--warzone-live-aircraft-model-focused-min-pixel-far-factor", 0.34)
            ),
            0.1,
            1
        );
        const farValue = clamp(
            Math.min(fallbackMinPixel, nearValue * farFactor),
            0,
            nearValue
        );
        return Cesium.Math.lerp(nearValue, farValue, getLiveTrackFocusModelSizeFalloff());
    }
    return Math.max(0, Number(fallbackValue) || 0);
}
function getLiveTrackSubtypeMaxScale(track = {}, fallbackValue = 520) {
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
function shouldRenderLiveTrackTrail(trackKey = "", track = {}) {
    if (!getLiveTrackSubtypeTrailEnabled(track)) return false;
    if (isTrackCurrentlyFocused(trackKey)) return true;
    const maxActiveTrails = Math.floor(getCssNumber("--warzone-live-track-trail-max-active", 36));
    if (maxActiveTrails > 0 && __liveTrackEntities.size > maxActiveTrails) {
        const trailRadius = Math.max(0, getCssNumber("--warzone-live-track-trail-auto-radius", 160000));
        const distanceMeters = getAircraftTrackCameraDistanceMeters(track);
        if (!Number.isFinite(distanceMeters) || (trailRadius > 0 && distanceMeters > trailRadius)) {
            return false;
        }
    }
    const maxHeight = getCssNumber("--warzone-live-track-trail-render-max-height", LIVE_TRACK_TRAIL_RENDER_HEIGHT_MAX);
    if (!Number.isFinite(maxHeight) || maxHeight <= 0) return true;
    const cameraHeight = getViewerCameraHeightMeters();
    return !Number.isFinite(cameraHeight) || cameraHeight <= maxHeight;
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
function getAircraftPngTargetMaxDimensionPx() {
    return clamp(getAircraftPngScaleByZoomBand(), 0.01, 2.8);
}
function getLiveTrackBillboardDimensions(track = {}, mode = LIVE_TRACK_RENDER_MODE.PNG) {
    if (mode !== LIVE_TRACK_RENDER_MODE.PNG) return null;
    const iconCode = resolveLiveAircraftIconCode(track);
    const assetKey = normalizeAircraftAssetKey(iconCode);
    const resolvedIconCode =
        LIVE_AIRCRAFT_ICON_CODE_BY_ASSET_KEY[assetKey] ||
        LIVE_AIRCRAFT_ICON_FALLBACK_CODE_BY_ASSET_KEY[assetKey] ||
        iconCode;
    const defaultIconCode = LIVE_AIRCRAFT_ICON_CODE_BY_ASSET_KEY[LIVE_AIRCRAFT_ICON_DEFAULT_CODE] || "ff-5";
    const dimensions = LIVE_AIRCRAFT_ICON_DIMENSIONS[resolvedIconCode] || LIVE_AIRCRAFT_ICON_DIMENSIONS[defaultIconCode];
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);
    if (!(width > 0) || !(height > 0)) return null;
    const targetMaxDimensionPx = LIVE_AIRCRAFT_ICON_REFERENCE_MAX_DIMENSION * getAircraftPngTargetMaxDimensionPx();
    const scale = targetMaxDimensionPx / Math.max(width, height);
    return {
        width: Math.max(10, Math.round(width * scale)),
        height: Math.max(10, Math.round(height * scale)),
    };
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
    requestRenderWhenTrackImageReady(iconPath);
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
    const overrideCode = resolveAircraftAssetSuffixOverride(track);
    if (mode === LIVE_TRACK_RENDER_MODE.PNG && LIVE_AIRCRAFT_ICON_CODES.has(overrideCode)) {
        const iconPath = getLiveAircraftIconPath(overrideCode);
        requestRenderWhenTrackImageReady(iconPath);
        return iconPath;
    }
    const directImage = [
        track.icon_url,
        track.image_url,
        metadata.icon_url,
        metadata.image_url,
    ]
        .map((value) => String(value || "").trim())
        .find((value) => value && (/^data:image\//i.test(value) || /\.(png|svg|webp|jpe?g)(\?|#|$)/i.test(value)));
    if (mode === LIVE_TRACK_RENDER_MODE.PNG && directImage) {
        requestRenderWhenTrackImageReady(directImage);
        return directImage;
    }

    if (mode === LIVE_TRACK_RENDER_MODE.CHAR) {
        return createAircraftCharIcon(resolveTrackSubtype(track));
    }
    return directImage || createAircraftPngIcon(track) || getLiveAircraftIconPath();
}
function getAircraftVisualPolicy() {
    const config = window.__stratopsConfig?.aircraftVisualPolicy;
    return config && typeof config === "object" ? config : {};
}
function shouldForceProductionAircraftPngMode() {
    const host = String(window?.location?.hostname || "").trim().toLowerCase();
    return !!host && host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]";
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
    if (
        normalized === "point" ||
        normalized === "dot" ||
        normalized === "dots" ||
        normalized === "marker"
    ) {
        return LIVE_TRACK_RENDER_MODE.POINT;
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
function getViewerCameraWorldPosition() {
    const position = window.__warzoneViewer?.camera?.positionWC;
    return position ? Cesium.Cartesian3.clone(position) : null;
}
function getAircraftTrackWorldPosition(track = {}) {
    const lon = Number(track.lon);
    const lat = Number(track.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const alt = getTrackRenderAltitudeMeters(track);
    return Cesium.Cartesian3.fromDegrees(lon, lat, alt);
}
function getAircraftAutoModelRadiusMeters(policy = {}) {
    return Math.max(
        0,
        getCssNumber(
            "--warzone-live-aircraft-model-auto-radius",
            Number(policy.modelAutoRadius ?? 240000)
        )
    );
}
function getAircraftTrackCameraDistanceMeters(track = {}) {
    const cameraPosition = getViewerCameraWorldPosition();
    const trackPosition = getAircraftTrackWorldPosition(track);
    if (!cameraPosition || !trackPosition) return Number.POSITIVE_INFINITY;
    return getCartesianDistanceMeters(cameraPosition, trackPosition);
}
function getAircraftModelPriorityRank(track = {}, radiusMeters = 0) {
    const thisTrackKey = String(track.track_key || "");
    const thisDistance = getAircraftTrackCameraDistanceMeters(track);
    if (!Number.isFinite(thisDistance)) return Number.POSITIVE_INFINITY;
    let closerCount = 0;
    __liveTrackRegistry.forEach((entry, trackKey) => {
        if (!entry?.active) return;
        if (String(trackKey || "") === thisTrackKey) return;
        const otherDistance = getAircraftTrackCameraDistanceMeters(entry);
        if (!Number.isFinite(otherDistance)) return;
        if (radiusMeters > 0 && otherDistance > radiusMeters) return;
        if (otherDistance < thisDistance) {
            closerCount += 1;
        }
    });
    return closerCount;
}
function isAircraftAutoModelEnabled(policy = {}) {
    const cssValue = getCssNumber("--warzone-live-aircraft-model-auto-enabled", Number.NaN);
    if (Number.isFinite(cssValue)) return cssValue >= 0.5;
    if (policy.zoomModel === false || policy.autoModel === false || policy.enableAutoModel === false) return false;
    return policy.zoomModel === true || policy.autoModel === true || policy.enableAutoModel === true;
}
function shouldAutoUseAircraftModel(track = {}, policy = {}) {
    if (!isAircraftAutoModelEnabled(policy)) return false;
    const cameraHeight = getViewerCameraHeightMeters();
    const maxZoomHeight = Math.max(
        0,
        getCssNumber(
            "--warzone-live-aircraft-model-max-zoom-height",
            Number(policy.modelMaxZoomHeight ?? policy.modelZoomHeight ?? LIVE_TRACK_MODEL_DEFAULT_ZOOM_HEIGHT)
        )
    );
    if (!Number.isFinite(cameraHeight) || cameraHeight > maxZoomHeight) {
        return false;
    }
    const radiusMeters = getAircraftAutoModelRadiusMeters(policy);
    const distanceMeters = getAircraftTrackCameraDistanceMeters(track);
    if (!Number.isFinite(distanceMeters) || (radiusMeters > 0 && distanceMeters > radiusMeters)) {
        return false;
    }
    const maxActive = Math.max(
        1,
        Math.floor(
            getCssNumber(
                "--warzone-live-aircraft-model-max-active",
                Number(policy.modelMaxActive ?? LIVE_TRACK_MODEL_DEFAULT_MAX_ACTIVE)
            )
        )
    );
    return getAircraftModelPriorityRank(track, radiusMeters) < maxActive;
}
function shouldUseFocusedContextAircraftModel(track = {}, modelUri = "") {
    if (!modelUri || !isFocusSelectionActive()) return false;
    if (window.__stratopsConfig?.enableFocusedContextModels !== true) return false;
    const trackKey = String(track.track_key || "");
    if (!trackKey || isFocusedTrackKey(trackKey)) return false;
    const focusedTrackKey = getFocusedTrackKey();
    const focusEntry = focusedTrackKey ? __liveTrackRegistry.get(focusedTrackKey) : null;
    const focusedPosition = focusedTrackKey ? getTrackVisibilityCartesian(focusedTrackKey, focusEntry) : null;
    const distanceMeters = getTrackDistanceFromFocusedTrackMeters(trackKey, track, focusedPosition);
    if (!Number.isFinite(distanceMeters) || distanceMeters > getFocusedContextModelRadiusMeters()) return false;
    const maxActive = getFocusedContextModelMaxActive();
    if (maxActive <= 0) return false;
    return getFocusedContextModelPriorityRank(track, focusedPosition) < maxActive;
}
function isAircraftFocusTerrainEnabled() {
    return window.__stratopsConfig?.autoTerrainOnAircraftFocus === true;
}
function enableAircraftFocusTerrain(viewer) {
    if (!viewer || !isAircraftFocusTerrainEnabled()) return;
    try {
        Promise.resolve(viewer.__warzone?.enableFocusedTerrain?.())
            .then(() => {
                if (__liveTrackReplayState.mode !== "focus" || !__liveTrackReplayState.selectedTrackKey) {
                    viewer.__warzone?.disableFocusedTerrain?.();
                }
            })
            .catch((error) => {
                console.warn("Focused aircraft terrain failed to enable:", error);
            });
    } catch (error) {
        console.warn("Focused aircraft terrain failed to enable:", error);
    }
}
function disableAircraftFocusTerrain(viewer) {
    if (!viewer) return;
    if (!isAircraftFocusTerrainEnabled() && viewer.__warzone?.isFocusedTerrainActive?.() !== true) return;
    try {
        viewer.__warzone?.disableFocusedTerrain?.();
    } catch (error) {
        console.warn("Focused aircraft terrain failed to disable:", error);
    }
}
function cancelAircraftFocusTerrainDisable() {
    __liveTrackTerrainDisableSeq += 1;
    if (__liveTrackTerrainDisableTimer) {
        clearTimeout(__liveTrackTerrainDisableTimer);
        __liveTrackTerrainDisableTimer = 0;
    }
}
function scheduleAircraftFocusTerrainDisable(viewer, delayMs = 0) {
    if (!viewer || !isAircraftFocusTerrainEnabled()) return;
    cancelAircraftFocusTerrainDisable();
    const seq = __liveTrackTerrainDisableSeq;
    __liveTrackTerrainDisableTimer = window.setTimeout(() => {
        __liveTrackTerrainDisableTimer = 0;
        if (seq !== __liveTrackTerrainDisableSeq) return;
        if (isFocusSelectionActive()) return;
        disableAircraftFocusTerrain(viewer);
    }, Math.max(0, Number(delayMs) || 0));
}
function resolveAircraftRenderMode(track = {}, modelUri = "") {
    const policy = getAircraftVisualPolicy();
    const forceProductionPng = shouldForceProductionAircraftPngMode();
    const metadata = getTrackMetadata(track);
    const trackMode = normalizeAircraftRenderMode(
        track.render_mode ||
        track.renderMode ||
        track.model_render_mode ||
        track.modelRenderMode ||
        metadata.render_mode ||
        metadata.renderMode ||
        metadata.model_render_mode ||
        metadata.modelRenderMode ||
        ""
    );
    if (trackMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
    if (trackMode === LIVE_TRACK_RENDER_MODE.POINT) return forceProductionPng ? LIVE_TRACK_RENDER_MODE.PNG : LIVE_TRACK_RENDER_MODE.POINT;
    if (trackMode === LIVE_TRACK_RENDER_MODE.PNG) return LIVE_TRACK_RENDER_MODE.PNG;
    if (trackMode === LIVE_TRACK_RENDER_MODE.MODEL) {
        return modelUri ? LIVE_TRACK_RENDER_MODE.MODEL : LIVE_TRACK_RENDER_MODE.PNG;
    }
    const forcedMode = normalizeAircraftRenderMode(policy.mode || policy.renderMode || "");
    if (forcedMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
    if (forcedMode === LIVE_TRACK_RENDER_MODE.POINT) return forceProductionPng ? LIVE_TRACK_RENDER_MODE.PNG : LIVE_TRACK_RENDER_MODE.POINT;
    if (forcedMode === LIVE_TRACK_RENDER_MODE.PNG) return LIVE_TRACK_RENDER_MODE.PNG;
    if (forcedMode === LIVE_TRACK_RENDER_MODE.MODEL) {
        return modelUri ? LIVE_TRACK_RENDER_MODE.MODEL : LIVE_TRACK_RENDER_MODE.PNG;
    }
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const thisTrackKey = String(track.track_key || "");
    const isSelected = Boolean(selectedTrackKey && selectedTrackKey === thisTrackKey);
    const configuredStateMode = resolveConfiguredAircraftRenderMode(policy, isSelected);
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.POINT) return forceProductionPng ? LIVE_TRACK_RENDER_MODE.PNG : LIVE_TRACK_RENDER_MODE.POINT;
    if (isSelected) {
        if (configuredStateMode === LIVE_TRACK_RENDER_MODE.MODEL && modelUri) return LIVE_TRACK_RENDER_MODE.MODEL;
        if (configuredStateMode === LIVE_TRACK_RENDER_MODE.PNG) return LIVE_TRACK_RENDER_MODE.PNG;
    } else if (configuredStateMode === LIVE_TRACK_RENDER_MODE.MODEL && modelUri) {
        return LIVE_TRACK_RENDER_MODE.MODEL;
    }
    if (!isAircraftModelPrimaryEnabled() || !modelUri) {
        if (configuredStateMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
        if (configuredStateMode === LIVE_TRACK_RENDER_MODE.POINT) return forceProductionPng ? LIVE_TRACK_RENDER_MODE.PNG : LIVE_TRACK_RENDER_MODE.POINT;
        return LIVE_TRACK_RENDER_MODE.PNG;
    }
    if (shouldUseFocusedContextAircraftModel(track, modelUri)) {
        return LIVE_TRACK_RENDER_MODE.MODEL;
    }
    if (isSelected || shouldAutoUseAircraftModel(track, policy)) {
        return LIVE_TRACK_RENDER_MODE.MODEL;
    }
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.CHAR) return LIVE_TRACK_RENDER_MODE.CHAR;
    if (configuredStateMode === LIVE_TRACK_RENDER_MODE.POINT) return forceProductionPng ? LIVE_TRACK_RENDER_MODE.PNG : LIVE_TRACK_RENDER_MODE.POINT;
    return LIVE_TRACK_RENDER_MODE.PNG;
}
function buildLiveTrackBillboard(track = {}, headingDeg = 0, mode = LIVE_TRACK_RENDER_MODE.PNG) {
    if (!shouldUseLiveTrackBillboards()) return null;
    const style = getLiveTrackStyleConfig(track);
    const image = resolveLiveTrackBillboardImage(track, mode);
    if (!image) return null;
    const dimensions = getLiveTrackBillboardDimensions(track, mode);
    const scale = mode === LIVE_TRACK_RENDER_MODE.PNG && dimensions ? 1 : getLiveTrackBillboardScale(mode);
    return {
        image,
        scale,
        width: dimensions?.width,
        height: dimensions?.height,
        rotation: getLiveTrackBillboardRotationRadians(headingDeg),
        alignedAxis: Cesium.Cartesian3.ZERO,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: style.depthTestDisableDistance,
    };
}
function getLiveTrackBillboardRotationRadians(headingDeg = 0) {
    return Cesium.Math.toRadians(normalizeDegrees(headingDeg));
}
function buildLiveTrackPoint(track = {}) {
    const subtype = resolveTrackSubtype(track);
    const color = Cesium.Color.fromCssColorString(
        getCssColor("--warzone-live-aircraft-point-color", getLiveTrackBillboardColor(subtype))
    ).withAlpha(clamp(getCssNumber("--warzone-live-aircraft-point-alpha", 0.92), 0, 1));
    const outlineColor = Cesium.Color.fromCssColorString(
        getCssColor("--warzone-live-aircraft-point-outline-color", "rgba(190, 245, 255, 0.9)")
    ).withAlpha(clamp(getCssNumber("--warzone-live-aircraft-point-outline-alpha", 0.74), 0, 1));
    return {
        pixelSize: clamp(getCssNumber("--warzone-live-aircraft-point-size", 8), 2, 28),
        color,
        outlineColor,
        outlineWidth: clamp(getCssNumber("--warzone-live-aircraft-point-outline-width", 1.4), 0, 8),
        disableDepthTestDistance: getCssNumber("--warzone-live-aircraft-point-depth-test-disable-distance", Number.POSITIVE_INFINITY),
    };
}
function shouldUseLiveTrackBillboards() {
    // Keep billboard support enabled so PNG/CHAR fallback remains available.
    return true;
}
function buildLiveTrackModelGraphics(modelUri, subtypeScale, subtypeMinPixelSize, subtypeMaxScale, track = {}) {
    const visibility = getLiveAircraftModelVisibilityConfig(track);
    const modelQuality = getLiveGlbModelQualityConfig(track);
    return {
        uri: modelUri,
        scale: subtypeScale,
        minimumPixelSize: subtypeMinPixelSize,
        maximumScale: subtypeMaxScale,
        color: Cesium.Color.WHITE.withAlpha(visibility.alpha),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: visibility.whiteness,
        imageBasedLightingFactor: modelQuality.imageBasedLightingFactor,
        lightColor: modelQuality.lightColor,
        maximumScreenSpaceError: modelQuality.maximumScreenSpaceError,
        shadows: modelQuality.shadows,
        customShader: getLiveGlbMaterialShader(),
    };
}
function applyLiveTrackBillboard(entity, next) {
    if (!next) return false;
    if (!entity.billboard) {
        entity.billboard = { ...next };
        entity.point = undefined;
        entity.model = undefined;
        entity.orientation = undefined;
        return true;
    }
    entity.billboard.image = next.image;
    entity.billboard.scale = next.scale;
    entity.billboard.width = next.width;
    entity.billboard.height = next.height;
    if (!entity.__liveTrackAnimFrame) {
        entity.billboard.rotation = next.rotation;
    }
    entity.billboard.alignedAxis = next.alignedAxis;
    entity.billboard.horizontalOrigin = next.horizontalOrigin;
    entity.billboard.verticalOrigin = next.verticalOrigin;
    entity.billboard.disableDepthTestDistance = next.disableDepthTestDistance;
    entity.point = undefined;
    entity.model = undefined;
    entity.orientation = undefined;
    return true;
}
function applyLiveTrackPoint(entity, next) {
    if (!next) return false;
    if (!entity.point) {
        entity.point = { ...next };
    } else {
        entity.point.pixelSize = next.pixelSize;
        entity.point.color = next.color;
        entity.point.outlineColor = next.outlineColor;
        entity.point.outlineWidth = next.outlineWidth;
        entity.point.disableDepthTestDistance = next.disableDepthTestDistance;
    }
    entity.billboard = undefined;
    entity.model = undefined;
    entity.orientation = undefined;
    return true;
}
function applyLiveTrackModel(entity, track, modelUri, subtypeScale, subtypeMinPixelSize, subtypeMaxScale, lon, lat, alt, attitude) {
    const hasAnimatedPose = Boolean(entity.__liveTrackAnimFrame && entity.orientation);
    const visibility = getLiveAircraftModelVisibilityConfig(track);
    if (!entity.model) {
        entity.model = buildLiveTrackModelGraphics(
            modelUri,
            subtypeScale,
            subtypeMinPixelSize,
            subtypeMaxScale,
            track
        );
    } else {
        entity.model.uri = modelUri;
        entity.model.scale = subtypeScale;
        entity.model.minimumPixelSize = subtypeMinPixelSize;
        entity.model.maximumScale = subtypeMaxScale;
    }
    entity.model.color = Cesium.Color.WHITE.withAlpha(visibility.alpha);
    entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
    entity.model.colorBlendAmount = visibility.whiteness;
    applyLiveGlbModelQuality(entity.model, track);
    entity.billboard = undefined;
    entity.point = undefined;
    if (hasAnimatedPose) return;
    entity.orientation = buildTrackOrientation(
        track,
        lon,
        lat,
        alt,
        attitude.headingDeg,
        attitude.pitchDeg,
        attitude.rollDeg
    );
    entity.__currentHeadingDeg = attitude.headingDeg;
    entity.__currentPitchDeg = attitude.pitchDeg;
    entity.__currentRollDeg = attitude.rollDeg;
}
function applyLiveTrackModelSizing(entity, track = {}) {
    if (!entity?.model) return;
    const style = getLiveTrackStyleConfig(track);
    entity.model.scale = getLiveTrackSubtypeScale(track, style.scale);
    entity.model.minimumPixelSize = getLiveTrackSubtypeMinPixelSize(track, style.minimumPixelSize);
    entity.model.maximumScale = getLiveTrackSubtypeMaxScale(track, style.maximumScale);
}
function getLiveLabelStyleConfig() {
    return {
        scale: getCssNumber("--warzone-live-label-scale", 0.42),
        offsetY: getCssNumber("--warzone-live-label-offset-y", -18),
        font: getCssText("--warzone-live-label-font", "30px sans-serif"),
        fill: getCssColor("--warzone-live-label-fill", "#00d8b2"),
        outline: getCssColor("--warzone-live-label-outline", "rgba(0, 16, 18, 0.92)"),
        outlineWidth: clamp(getCssNumber("--warzone-live-label-outline-width", 0), 0, 8),
        background: getCssColor("--warzone-live-label-background", "rgba(8, 12, 20, 0)"),
        paddingX: getCssNumber("--warzone-live-label-padding-x", 6),
        paddingY: getCssNumber("--warzone-live-label-padding-y", 3),
        maxDistance: getCssNumber("--warzone-live-label-distance", 180000),
        maxChars: Math.max(0, Math.floor(getCssNumber("--warzone-live-label-max-chars", 0))),
        align: getCssText("--warzone-live-label-align", "center"),
        uppercase: getCssNumber("--warzone-live-label-uppercase", 0) >= 0.5,
        animHeightMax: getCssNumber("--warzone-live-track-anim-height-max", 1600000),
        depthTestDisableDistance: getCssNumber("--warzone-live-label-depth-test-disable-distance", Number.POSITIVE_INFINITY),
        focusOffsetX: getCssNumber("--warzone-live-focus-label-offset-x", 0),
        focusOffsetY: getCssNumber("--warzone-live-focus-label-offset-y", 0),
        focusOffsetZ: getCssNumber("--warzone-live-focus-label-offset-z", 0),
        focusScreenOffsetX: getCssNumber("--warzone-live-focus-label-screen-offset-x", 0),
        focusScreenOffsetY: getCssNumber("--warzone-live-focus-label-screen-offset-y", 0),
    };
}
function getLiveLabelHorizontalOrigin(value = "") {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "left" || normalized === "start") return Cesium.HorizontalOrigin.LEFT;
    if (normalized === "right" || normalized === "end") return Cesium.HorizontalOrigin.RIGHT;
    return Cesium.HorizontalOrigin.CENTER;
}
function transformLiveLabelText(text = "", labelStyle = {}) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    const transformed = labelStyle.uppercase ? raw.toUpperCase() : raw;
    const maxChars = Math.max(0, Math.floor(Number(labelStyle.maxChars || 0)));
    if (!maxChars || transformed.length <= maxChars) return transformed;
    const words = transformed.split(" ");
    const lines = [];
    let line = "";
    words.forEach((word) => {
        if (!word) return;
        if (!line) {
            line = word;
            return;
        }
        if ((line.length + 1 + word.length) <= maxChars) {
            line += ` ${word}`;
            return;
        }
        lines.push(line);
        line = word;
    });
    if (line) lines.push(line);
    return lines.join("\n");
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
function wakeLiveTrackRenderAfterAssetUpdate() {
    requestWarzoneRenderBatched();
    if (__liveTrackRenderWakeBurstTimer) return;
    const delays = [120, 360];
    let index = 0;
    const scheduleNext = () => {
        __liveTrackRenderWakeBurstTimer = window.setTimeout(() => {
            requestWarzoneRenderBatched();
            index += 1;
            if (index < delays.length) {
                scheduleNext();
            } else {
                __liveTrackRenderWakeBurstTimer = 0;
            }
        }, delays[index]);
    };
    scheduleNext();
}
function requestRenderWhenTrackImageReady(imageUrl = "") {
    if (typeof Image === "undefined") return;
    const safeUrl = String(imageUrl || "").trim();
    if (!safeUrl || /^data:image\//i.test(safeUrl) || __liveTrackImageWakeCache.has(safeUrl)) return;
    __liveTrackImageWakeCache.add(safeUrl);
    if (__liveTrackImageWakeCache.size > 80) {
        __liveTrackImageWakeCache = new Set(Array.from(__liveTrackImageWakeCache).slice(-40));
    }
    const image = new Image();
    image.onload = requestWarzoneRenderBatched;
    image.onerror = requestWarzoneRenderBatched;
    image.src = safeUrl;
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
function getLonLatDistanceMeters(lonA, latA, lonB, latB) {
    if (![lonA, latA, lonB, latB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const latMeters = 111320;
    const avgLatRad = Cesium.Math.toRadians((latA + latB) * 0.5);
    const lonMeters = Math.max(1, Math.cos(avgLatRad) * latMeters);
    const dx = (lonA - lonB) * lonMeters;
    const dy = (latA - latB) * latMeters;
    return Math.hypot(dx, dy);
}
function classifyLiveTrackTelemetryUpdate(entity, track = {}, sourceTimestamp = 0) {
    if (!entity) return "accept";
    const lastSourceTimestamp = Number(entity.__lastSourceTimestamp || 0);
    const nextSourceTimestamp = Number(sourceTimestamp || 0);
    if (
        lastSourceTimestamp > 0 &&
        nextSourceTimestamp > 0 &&
        nextSourceTimestamp < (lastSourceTimestamp - LIVE_TRACK_STALE_UPDATE_TOLERANCE_MS)
    ) {
        return "stale";
    }
    const previous = __liveTrackLastPositions.get(String(track.track_key || ""));
    if (!previous) return "accept";
    const lon = Number(track.lon);
    const lat = Number(track.lat);
    const previousLon = Number(previous.lon);
    const previousLat = Number(previous.lat);
    if (![lon, lat, previousLon, previousLat].every(Number.isFinite)) return "accept";
    const distanceMeters = getLonLatDistanceMeters(previousLon, previousLat, lon, lat);
    const previousAltitudeFt = Number(previous.altitude_ft || 0);
    const nextAltitudeFt = Number(getTrackResolvedAltitudeFt(track) || 0);
    const altitudeDeltaFt = Math.abs(nextAltitudeFt - previousAltitudeFt);
    const previousHeadingDeg = Number(entity.__lastReportedHeadingDeg ?? entity.__currentHeadingDeg ?? 0);
    const nextHeadingDeg = normalizeDegrees(Number(track.heading_deg || previousHeadingDeg));
    const headingDeltaDeg = Math.abs(getShortestAngleDeltaDeg(previousHeadingDeg, nextHeadingDeg));
    const previousSpeedKts = Number(entity.__lastReportedSpeedKts || 0);
    const nextSpeedKts = Number(track.speed_kts ?? track.ground_speed_kts ?? previousSpeedKts);
    const speedDeltaKts = Math.abs(nextSpeedKts - previousSpeedKts);
    if (
        distanceMeters <= LIVE_TRACK_INSIGNIFICANT_DISTANCE_METERS &&
        altitudeDeltaFt <= LIVE_TRACK_INSIGNIFICANT_ALTITUDE_FEET &&
        headingDeltaDeg <= LIVE_TRACK_INSIGNIFICANT_HEADING_DEG &&
        speedDeltaKts <= LIVE_TRACK_INSIGNIFICANT_SPEED_KTS
    ) {
        return "insignificant";
    }
    return "accept";
}
function refreshLiveTrackLiveness(entity, track = {}, sourceTimestamp = 0) {
    if (!entity) return;
    entity.__lastSourceTimestamp = Number(sourceTimestamp || Date.now());
    entity.__lastReportedHeadingDeg = Number(track.heading_deg ?? entity.__lastReportedHeadingDeg ?? 0);
    entity.__lastReportedSpeedKts = Number(
        track.speed_kts ?? track.ground_speed_kts ?? entity.__lastReportedSpeedKts ?? 0
    );
    const entry = __liveTrackRegistry.get(String(track.track_key || ""));
    if (entry) {
        entry.active = true;
        entry.ended_at = null;
        entry.last_seen_at = Date.now();
    }
}
function isMajorLiveTrackCorrection(distanceMeters, sourceGapMs, track = {}) {
    const speedKts = Number(track.speed_kts ?? track.ground_speed_kts ?? 0);
    const speedMps = Number.isFinite(speedKts) && speedKts > 0 ? speedKts * 0.514444 : 0;
    const expectedDistanceMeters = speedMps * Math.max(1, Number(sourceGapMs || 0) / 1000);
    const correctionThresholdMeters = Math.max(
        LIVE_TRACK_MAJOR_CORRECTION_MIN_METERS,
        expectedDistanceMeters * LIVE_TRACK_MAJOR_CORRECTION_SPEED_FACTOR
    );
    return Number(distanceMeters || 0) > correctionThresholdMeters;
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
const LIVE_TRACK_TRAINING_ACTIVITY_PATTERNS = [
    /\btrainer\b/i,
    /\bbasic trainer\b/i,
    /\bprimary trainer\b/i,
    /\badvanced trainer\b/i,
    /\bjet trainer\b/i,
    /\bflight training\b/i,
    /\bpilot training\b/i,
    /\btraining aircraft\b/i,
    /\btraining (flight|activity|mission|sortie)\b/i,
    /\bmilitary training aircraft\b/i,
];
const LIVE_TRACK_TRAINER_SPECIAL_OPERATIONAL_PATTERNS = [
    /\bFA-?50\b/i,
    /\bYAK(?:OVLEV)?[-\s]?130\b/i,
    /\bM-?346FA\b/i,
    /\bA-?29\b/i,
    /\bSUPER TUCANO\b/i,
    /\bAT-?6\b/i,
    /\bWOLVERINE\b/i,
    /\bBLACK ?HAWK\b/i,
    /\bSEAHAWK\b/i,
    /\bHAWKEYE\b/i,
];
const LIVE_TRACK_TRAINER_PLATFORM_PATTERNS = [
    /\b(?:AERO\s+)?L-?(?:29|39|59)\b/i,
    /\bDELFIN\b/i,
    /\bALBATROS\b/i,
    /\bSUPER ALBATROS\b/i,
    /\bALPHA JET\b/i,
    /\b(?:BAE\s+)?HAWK(?:\s+(?:T[12]|100|200))?\b/i,
    /(^|[^A-Z0-9])T-?6[ABC]?\b/i,
    /\bTEXAN II\b/i,
    /\bBEECHCRAFT\s+T-?6\b/i,
    /\bCT-?156\b/i,
    /\bHARVARD II\b/i,
    /\b(?:PILATUS\s+)?PC-?(?:7|9|21)(?:\s*(?:MKII|M))?\b/i,
    /\bGROB\s+G-?(?:115|120A?|120TP)\b/i,
    /\bG-?(?:115|120A?|120TP)\b/i,
    /\bCIRRUS\s+T-?53A?\b/i,
    /\bCIRRUS\s+SR-?20\b/i,
    /(^|[^A-Z0-9])T-?53A?\b/i,
    /\bKAYDET\s+II\b/i,
    /\bSHARK\s*\d+\b/i,
    /(^|[^A-Z0-9])T-?38[AC]?\b/i,
    /\bTALON\b/i,
    /\b(?:BOEING\s+)?T-?7A?\b/i,
    /\bRED HAWK\b/i,
    /\b(?:KAI\s+)?KT-?1\b/i,
    /\bWOONGBI\b/i,
    /\b(?:HONGDU\s+|NANCHANG\s+)?CJ-?6\b/i,
    /\bYAK(?:OVLEV)?[-\s]?(?:52|152)\b/i,
    /\bPZL-?130\b/i,
    /\bORLIK\b/i,
    /\bSF-?260(?:EA)?\b/i,
    /\bDIAMOND\s+DA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bDA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bEMB-?312\b/i,
    /\bTUCANO\b/i,
    /\bK-?8\b/i,
    /\bJL-?8\b/i,
    /\bKARAKORUM\b/i,
    /\bM-?311\b/i,
    /\bM-?345\b/i,
    /\bM-?346(?!FA)\b/i,
    /\bMB-?(?:326|339)\b/i,
    /\bJET PROVOST\b/i,
    /\bSCOTTISH AVIATION BULLDOG\b/i,
    /\bBULLDOG\b/i,
    /\bCT-?114\b/i,
    /\bTUTOR\b/i,
    /\bJL-?10\b/i,
    /\bL-?15\b/i,
];
function isExcludedTrainerAircraftText(text = "") {
    const haystack = String(text || "");
    if (!haystack) return false;
    const hasTrainingActivity = LIVE_TRACK_TRAINING_ACTIVITY_PATTERNS.some((pattern) => pattern.test(haystack));
    if (
        !hasTrainingActivity &&
        LIVE_TRACK_TRAINER_SPECIAL_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(haystack))
    ) {
        return false;
    }
    return hasTrainingActivity || LIVE_TRACK_TRAINER_PLATFORM_PATTERNS.some((pattern) => pattern.test(haystack));
}
function getTrackSourceTimestamp(track = {}) {
    const ts = Number(track.timestamp || 0);
    if (Number.isFinite(ts) && ts > 0) return ts;
    const sourceDateTs = new Date(
        track.updated_at ||
        track.last_seen_at ||
        track.occurred_at ||
        track.created_at ||
        0
    ).getTime();
    if (Number.isFinite(sourceDateTs) && sourceDateTs > 0) return sourceDateTs;
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
        track.operator,
        track.owner,
        metadata.callsign,
        metadata.operator,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    if (LIVE_TRACK_SPECIAL_ISR_COMMAND_PATTERNS.some((pattern) => pattern.test(haystack))) return "isr";
    if (LIVE_AIRCRAFT_FALCON_EXECUTIVE_PATTERNS.some((pattern) => pattern.test(haystack))) return "vip";
    if (LIVE_AIRCRAFT_CASA_HC144_PATROL_PATTERNS.some((pattern) => pattern.test(haystack))) return "recon";
    if (LIVE_TRACK_SPECIAL_VIP_GOV_PATTERNS.some((pattern) => pattern.test(haystack))) return "vip";
    if (/(awacs|aew|wedgetail|hawkeye|sentry|e-3\b|e3\b|e-7\b|e7\b|a-50\b|a50\b|phalcon|erieye|kj-200\b|kj200\b|kj-500\b|kj500\b|kj-2000\b|kj2000\b)/.test(haystack)) return "awacs";
    if (/(rivet joint|cobra ball|combat sent|recon|reconnaissance|surveillance|poseidon|orion|rc-135\b|rc135\b|ep-3\b|ep3\b|p-8\b|p8\b|p-3\b|p3\b)/.test(haystack)) return "recon";
    if (/(isr\b|global hawk|triton|jstars|e-8\b|e8\b|rq-4\b|rq4\b|special mission)/.test(haystack)) return "isr";
    if (/(tanker|refuel|refueller|pegasus|extender|stratotanker|kc-135\b|kc135\b|kc-46\b|kc46\b|kc-10\b|kc10\b|a330 mrtt\b|mrtt\b|voyager\b|il-78\b|il78\b|yy-20\b|yy20\b)/.test(haystack)) return "tanker";
    if (/(transport|airlift|cargo|logistics|globemaster|hercules|atlas\b|millennium\b|a-?400m\b|c-17\b|c17\b|c-5\b|c5\b|c-130\b|hc-130\b|mc-130\b|c130\b|c-390\b|c390\b|c-40\b|c40\b|an-124\b|an124\b|an-12\b|an12\b|il-76\b|il76\b|y-8\b|y8\b|y-9\b|y9\b|y-20\b|y20\b|cn-235\b|cn235\b|c295\b)/.test(haystack)) return "transport";
    if (/(helicopter|rotary|rotorcraft|black hawk|blackhawk|apache|chinook|osprey|seahawk|super stallion|king stallion|lakota|agusta|sikorsky|leonardo|aw-139\b|aw139\b|aw-119\b|aw119\b|th-73\b|th73\b|uh-72\b|uh72\b|uh-60\b|uh60\b|hh-60\b|hh60\b|mh-60\b|mh60\b|h-60\b|h60\b|ch-47\b|ch47\b|ch-53\b|ch53\b|v-22\b|v22\b|mi-8\b|mi8\b|mi-17\b|mi17\b|mi-24\b|mi24\b|mi-28(?:nm|n)?\b|mi28(?:nm|n)?\b|mi-35\b|mi35\b|ka-27\b|ka27\b|ka-50\b|ka50\b|hokum\b|ka-52\b|ka52\b)/.test(haystack)) return "helicopter";
    if (/(bomber|b-1\b|b1\b|b-2\b|b2\b|b-52\b|b52\b|su-34\b|su34\b|tu-22m3\b|tu22m3\b|tu-95\b|tu95\b|tu-160\b|tu160\b|h-6\b|h6\b|ac-130\b|ac130\b|spectre|spooky)/.test(haystack)) return "bomber";
    if (/(uav\b|drone\b|ucav\b|reaper\b|predator\b|mq-9\b|mq9\b|rq-4\b|rq4\b|tb2\b|bayraktar\b|heron\b|hermes\b)/.test(haystack)) return "uav";
    if (isExcludedTrainerAircraftText(haystack)) return "trainer";
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
function getTrackCallsignLabel(track = {}) {
    const metadata = getTrackMetadata(track);
    const callsign = sanitizeTrackText(
        track.callsign ||
        track.flight ||
        metadata.callsign ||
        metadata.flight ||
        ""
    );
    return isTrackTextUsable(callsign) ? callsign : "";
}
function getTrackIcao24Label(track = {}) {
    const metadata = getTrackMetadata(track);
    return String(
        track.icao24 ||
        track.icao ||
        metadata.icao ||
        ""
    ).trim().toLowerCase();
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
function areAircraftTracksLikelyDuplicates(a = {}, b = {}) {
    const aKey = String(a.track_key || "").trim();
    const bKey = String(b.track_key || "").trim();
    if (!aKey || !bKey || aKey === bKey) return false;

    const aIcao = getTrackIcao24Label(a);
    const bIcao = getTrackIcao24Label(b);
    if (aIcao && bIcao) {
        return aIcao === bIcao;
    }

    const aCallsign = getTrackCallsignLabel(a).toLowerCase();
    const bCallsign = getTrackCallsignLabel(b).toLowerCase();
    const aRegistration = getTrackRegistrationLabel(a).toLowerCase();
    const bRegistration = getTrackRegistrationLabel(b).toLowerCase();
    const sharesCallsign = Boolean(aCallsign && bCallsign && aCallsign === bCallsign);
    const sharesRegistration = Boolean(aRegistration && bRegistration && aRegistration === bRegistration);
    if (!sharesCallsign && !sharesRegistration) return false;

    const aSubtype = String(resolveTrackSubtype(a) || "").trim().toLowerCase();
    const bSubtype = String(resolveTrackSubtype(b) || "").trim().toLowerCase();
    if (aSubtype && bSubtype && aSubtype !== bSubtype) return false;

    const aTypeCode = sanitizeTrackText(a.type_code || getTrackMetadata(a).type_code || "").toLowerCase();
    const bTypeCode = sanitizeTrackText(b.type_code || getTrackMetadata(b).type_code || "").toLowerCase();
    if (aTypeCode && bTypeCode && aTypeCode !== bTypeCode) return false;

    const aModel = getTrackModelLabel(a).toLowerCase();
    const bModel = getTrackModelLabel(b).toLowerCase();
    if (aModel && bModel && aModel !== bModel) return false;

    const aLat = Number(a.lat);
    const aLon = Number(a.lon);
    const bLat = Number(b.lat);
    const bLon = Number(b.lon);
    if (!Number.isFinite(aLat) || !Number.isFinite(aLon) || !Number.isFinite(bLat) || !Number.isFinite(bLon)) {
        return false;
    }
    const distanceMeters = getCartesianDistanceMeters(
        Cesium.Cartesian3.fromDegrees(aLon, aLat, 0),
        Cesium.Cartesian3.fromDegrees(bLon, bLat, 0)
    );
    if (!Number.isFinite(distanceMeters) || distanceMeters > LIVE_TRACK_DUPLICATE_DISTANCE_METERS) {
        return false;
    }

    const aHeading = Number(a.heading_deg);
    const bHeading = Number(b.heading_deg);
    if (Number.isFinite(aHeading) && Number.isFinite(bHeading)) {
        const headingDelta = Math.abs(getShortestAngleDeltaDeg(aHeading, bHeading));
        if (headingDelta > LIVE_TRACK_DUPLICATE_HEADING_DELTA_DEG) return false;
    }

    const aSpeed = Number(a.speed_kts);
    const bSpeed = Number(b.speed_kts);
    if (Number.isFinite(aSpeed) && Number.isFinite(bSpeed)) {
        if (Math.abs(aSpeed - bSpeed) > LIVE_TRACK_DUPLICATE_SPEED_DELTA_KTS) return false;
    }

    return true;
}
function findDuplicateLiveTrackKey(track = {}) {
    for (const entry of __liveTrackRegistry.values()) {
        if (!entry?.active || !entry?.track_key) continue;
        if (areAircraftTracksLikelyDuplicates(track, entry)) {
            return String(entry.track_key || "");
        }
    }
    return "";
}
function getFocusedTrackKey() {
    return String(__liveTrackReplayState.selectedTrackKey || "");
}
function isFocusedTrackKey(trackKey = "") {
    return Boolean(
        trackKey &&
        getFocusedTrackKey() === String(trackKey || "") &&
        String(__liveTrackReplayState.mode || "") === "focus"
    );
}
function getLiveTrackFocusVisibilityRadiusMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-visible-radius", LIVE_TRACK_FOCUS_VISIBILITY_RADIUS_METERS),
        0,
        2000000
    );
}
function getFocusedContextModelRadiusMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-context-model-radius", 12000),
        0,
        250000
    );
}
function getFocusedContextModelMaxActive() {
    return Math.max(
        0,
        Math.floor(getCssNumber("--warzone-live-aircraft-focus-context-model-max-active", 4))
    );
}
function getTrackVisibilityCartesian(trackKey = "", entry = null) {
    const viewer = window.__warzoneViewer;
    const entity = viewer?.entities?.getById?.(`track-${trackKey}`);
    const entityPosition = getPositionCartesian(entity);
    if (entityPosition) return entityPosition;
    const lon = Number(entry?.lon);
    const lat = Number(entry?.lat);
    const alt = Number(entry?.altitude_m || 0);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return Cesium.Cartesian3.fromDegrees(lon, lat, Number.isFinite(alt) ? alt : 0);
}
function shouldShowTrackInFocusMode(trackKey = "", entry = null, focusedPosition = null) {
    if (!isFocusSelectionActive()) return true;
    const selectedTrackKey = getFocusedTrackKey();
    if (!selectedTrackKey) return true;
    if (String(trackKey || "") === selectedTrackKey) return true;
    const focusEntry = __liveTrackRegistry.get(selectedTrackKey);
    const focusCartesian = focusedPosition || getTrackVisibilityCartesian(selectedTrackKey, focusEntry);
    const trackCartesian = getTrackVisibilityCartesian(trackKey, entry);
    if (!focusCartesian || !trackCartesian) return false;
    const distanceMeters = getCartesianDistanceMeters(focusCartesian, trackCartesian);
    return Number.isFinite(distanceMeters) && distanceMeters <= getLiveTrackFocusVisibilityRadiusMeters();
}
function getTrackDistanceFromFocusedTrackMeters(trackKey = "", entry = null, focusedPosition = null) {
    if (!isFocusSelectionActive()) return Number.POSITIVE_INFINITY;
    const selectedTrackKey = getFocusedTrackKey();
    if (!selectedTrackKey) return Number.POSITIVE_INFINITY;
    if (String(trackKey || "") === selectedTrackKey) return 0;
    const focusEntry = __liveTrackRegistry.get(selectedTrackKey);
    const focusCartesian = focusedPosition || getTrackVisibilityCartesian(selectedTrackKey, focusEntry);
    const trackCartesian = getTrackVisibilityCartesian(trackKey, entry);
    if (!focusCartesian || !trackCartesian) return Number.POSITIVE_INFINITY;
    return getCartesianDistanceMeters(focusCartesian, trackCartesian);
}
function getFocusedContextModelPriorityRank(track = {}, focusedPosition = null) {
    const thisTrackKey = String(track.track_key || "");
    const radiusMeters = getFocusedContextModelRadiusMeters();
    const thisDistance = getTrackDistanceFromFocusedTrackMeters(thisTrackKey, track, focusedPosition);
    if (!Number.isFinite(thisDistance) || thisDistance > radiusMeters) return Number.POSITIVE_INFINITY;
    let closerCount = 0;
    __liveTrackRegistry.forEach((entry, trackKey) => {
        if (!entry?.active) return;
        if (String(trackKey || "") === thisTrackKey) return;
        if (isFocusedTrackKey(trackKey)) return;
        const otherDistance = getTrackDistanceFromFocusedTrackMeters(trackKey, entry, focusedPosition);
        if (!Number.isFinite(otherDistance) || otherDistance > radiusMeters) return;
        if (otherDistance < thisDistance) closerCount += 1;
    });
    return closerCount;
}
function applyLiveTrackFocusVisibility(trackKey = "", focusedPosition = null) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !trackKey) return;
    const entry = __liveTrackRegistry.get(trackKey);
    const show = shouldShowTrackInFocusMode(trackKey, entry, focusedPosition);
    const entity = viewer.entities.getById(`track-${trackKey}`);
    if (entity) entity.show = show;
    const trailEntity = viewer.entities.getById(`track-trail-${trackKey}`);
    if (trailEntity) trailEntity.show = show && !hasFocusedRouteForTrack(trackKey);
}
function refreshFocusedTrackIsolation() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    const selectedTrackKey = getFocusedTrackKey();
    const focusedPosition = selectedTrackKey
        ? getTrackVisibilityCartesian(selectedTrackKey, __liveTrackRegistry.get(selectedTrackKey))
        : null;
    __liveTrackEntities.forEach((entity) => {
        if (!entity?.__trackKey) return;
        applyLiveTrackFocusVisibility(entity.__trackKey, focusedPosition);
    });
    __liveTrackRegistry.forEach((entry, trackKey) => {
        applyLiveTrackFocusVisibility(trackKey, focusedPosition);
    });
    requestWarzoneRenderBatched();
}
function refreshFocusedContextLiveTrackVisualModes(focusedTrackKey = "") {
    if (!isFocusSelectionActive() || !focusedTrackKey) return;
    const focusEntry = __liveTrackRegistry.get(focusedTrackKey);
    const focusedPosition = getTrackVisibilityCartesian(focusedTrackKey, focusEntry);
    __liveTrackRegistry.forEach((entry, trackKey) => {
        const safeTrackKey = String(trackKey || "");
        if (!entry?.active || !safeTrackKey || safeTrackKey === String(focusedTrackKey)) return;
        if (shouldShowTrackInFocusMode(safeTrackKey, entry, focusedPosition)) {
            refreshLiveTrackVisualMode(safeTrackKey);
        }
    });
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
    const isFocused = isTrackCurrentlyFocused(trackKey);
    return {
        text: transformLiveLabelText(getTrackDisplayTitle(track), labelStyle),
        show: new Cesium.CallbackProperty(() => shouldShowTrackLabel(trackKey), false),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelStyle.maxDistance),
        font: labelStyle.font,
        scale: labelStyle.scale,
        pixelOffset: new Cesium.Cartesian2(
            isFocused ? labelStyle.focusScreenOffsetX : 0,
            labelStyle.offsetY + (isFocused ? labelStyle.focusScreenOffsetY : 0)
        ),
        eyeOffset: new Cesium.Cartesian3(
            isFocused ? labelStyle.focusOffsetX : 0,
            isFocused ? labelStyle.focusOffsetY : 0,
            isFocused ? labelStyle.focusOffsetZ : 0
        ),
        fillColor: Cesium.Color.fromCssColorString(labelStyle.fill).withAlpha(0.98),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(labelStyle.background),
        backgroundPadding: new Cesium.Cartesian2(labelStyle.paddingX, labelStyle.paddingY),
        outlineColor: Cesium.Color.fromCssColorString(labelStyle.outline),
        outlineWidth: labelStyle.outlineWidth,
        style: labelStyle.outlineWidth > 0 ? Cesium.LabelStyle.FILL_AND_OUTLINE : Cesium.LabelStyle.FILL,
        horizontalOrigin: getLiveLabelHorizontalOrigin(labelStyle.align),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: isFocused ? Number.POSITIVE_INFINITY : labelStyle.depthTestDisableDistance,
    };
}
function applyTrackLabel(label, track = {}, trackKey = "") {
    if (!label) return;
    const nextConfig = buildTrackLabel(track, trackKey);
    label.text = nextConfig.text;
    label.show = nextConfig.show;
    label.distanceDisplayCondition = nextConfig.distanceDisplayCondition;
    label.font = nextConfig.font;
    label.scale = nextConfig.scale;
    label.pixelOffset = nextConfig.pixelOffset;
    label.eyeOffset = nextConfig.eyeOffset;
    label.fillColor = nextConfig.fillColor;
    label.showBackground = nextConfig.showBackground;
    label.backgroundColor = nextConfig.backgroundColor;
    label.backgroundPadding = nextConfig.backgroundPadding;
    label.outlineColor = nextConfig.outlineColor;
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
function getLiveTrackFocusCameraRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-camera-range", LIVE_TRACK_FOCUS_CAMERA_RANGE_METERS),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackFocusCameraPitchDeg() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-camera-pitch", LIVE_TRACK_FOCUS_CAMERA_PITCH_DEG),
        LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG,
        LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG
    );
}
function getLiveTrackFocusZoomRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-zoom-range", feetToMeters(LIVE_TRACK_FOCUS_ZOOM_DELTA_FEET)),
        0,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackFocusWheelZoomStepMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-wheel-zoom-step", feetToMeters(LIVE_TRACK_FOCUS_WHEEL_ZOOM_STEP_FEET)),
        1,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackFocusWarningRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-warning-range", LIVE_TRACK_FOCUS_WARNING_RANGE_METERS),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackFocusFinalRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-focus-final-range", LIVE_TRACK_FOCUS_FINAL_RANGE_METERS),
        getLiveTrackFocusWarningRangeMeters(),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackFocusSafeRangeMeters() {
    return clamp(
        Math.min(getLiveTrackFocusCameraRangeMeters(), getLiveTrackFocusWarningRangeMeters() * 0.85),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        getLiveTrackFocusFinalRangeMeters()
    );
}
export function closeFocusDriftWarningModal() {
    const modal = document.getElementById("wz-focus-warning-modal");
    if (!modal) return;
    modal.classList.remove("is-visible");
    modal.classList.add("is-closing");
    window.setTimeout(() => {
        modal.hidden = true;
        modal.classList.remove("is-closing");
    }, 220);
}
export function showFocusDriftWarningModal({
    assetType = "aircraft",
    onStay = null,
    onUnfocus = null,
} = {}) {
    const modal = document.getElementById("wz-focus-warning-modal");
    if (!modal) return false;
    const type = String(assetType || "aircraft").trim().toLowerCase() === "naval" ? "naval" : "aircraft";
    const titleEl = document.getElementById("wz-focus-warning-title");
    const summaryEl = document.getElementById("wz-focus-warning-summary");
    const stayBtn = document.getElementById("wz-focus-warning-stay");
    const unfocusBtn = document.getElementById("wz-focus-warning-unfocus");
    if (titleEl) titleEl.textContent = modal.dataset.title || titleEl.textContent || "Focus Warning";
    if (summaryEl) {
        summaryEl.textContent = type === "naval"
            ? (modal.dataset.navalMessage || summaryEl.textContent)
            : (modal.dataset.aircraftMessage || summaryEl.textContent);
    }
    if (stayBtn) stayBtn.innerHTML = `<span aria-hidden="true"></span>${modal.dataset.stayLabel || "Stay Locked"}`;
    if (unfocusBtn) unfocusBtn.innerHTML = `<span aria-hidden="true"></span>${modal.dataset.unfocusLabel || "Unlock Asset"}`;
    const replaceButton = (button, handler) => {
        if (!button) return;
        const next = button.cloneNode(true);
        button.replaceWith(next);
        next.addEventListener("click", () => {
            closeFocusDriftWarningModal();
            if (typeof handler === "function") handler();
        }, { once: true });
    };
    replaceButton(stayBtn, onStay);
    replaceButton(unfocusBtn, onUnfocus);
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    return true;
}
function showAircraftFocusWarning() {
    if (__liveTrackFocusWarningActive || !isFocusSelectionActive()) return;
    __liveTrackFocusWarningActive = true;
    const shown = showFocusDriftWarningModal({
        assetType: "aircraft",
        onStay: () => {
            __liveTrackFocusWarningActive = false;
            __liveTrackFocusRangeMeters = getLiveTrackFocusSafeRangeMeters();
            __liveTrackLastFocusCameraSyncAt = 0;
            syncFocusedTrackCamera({ preserveRange: true });
            requestWarzoneRenderBatched();
        },
        onUnfocus: () => {
            __liveTrackFocusWarningActive = false;
            clearLiveTrackSelection({ duration: 0.95, focusFlyOut: true });
        },
    });
    if (!shown) {
        __liveTrackFocusWarningActive = false;
    }
}
function handleAircraftFocusRangeChange(nextRangeMeters) {
    const finalRange = getLiveTrackFocusFinalRangeMeters();
    const warningRange = getLiveTrackFocusWarningRangeMeters();
    if (nextRangeMeters >= finalRange) {
        __liveTrackFocusRangeMeters = finalRange;
        refreshFocusedContextLiveTrackSizing();
        showAircraftFocusWarning();
        return true;
    }
    __liveTrackFocusRangeMeters = clamp(
        nextRangeMeters,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        finalRange
    );
    refreshFocusedContextLiveTrackSizing();
    if (__liveTrackFocusRangeMeters >= warningRange) {
        showAircraftFocusWarning();
    }
    return true;
}
function refreshFocusedContextLiveTrackSizing() {
    const viewer = window.__warzoneViewer;
    const focusedTrackKey = getFocusedTrackKey();
    if (!viewer || !focusedTrackKey) return;
    const focusedPosition = getTrackVisibilityCartesian(focusedTrackKey, __liveTrackRegistry.get(focusedTrackKey));
    __liveTrackRegistry.forEach((entry, trackKey) => {
        const safeTrackKey = String(trackKey || "");
        if (!safeTrackKey || !entry?.active) return;
        if (!shouldShowTrackInFocusMode(safeTrackKey, entry, focusedPosition)) return;
        const entity = viewer.entities?.getById?.(`track-${safeTrackKey}`);
        if (entity?.model) {
            applyLiveTrackModelSizing(entity, { ...entry, track_key: safeTrackKey });
        }
    });
    requestWarzoneRenderBatched();
}
function getLiveTrackFocusAnimConfig() {
    const minMs = clamp(
        getCssNumber("--warzone-live-aircraft-focus-anim-min-ms", LIVE_TRACK_FOCUS_MIN_ANIM_MS),
        120,
        60000
    );
    const maxMs = clamp(
        getCssNumber("--warzone-live-aircraft-focus-anim-max-ms", 9000),
        minMs,
        60000
    );
    const cadenceFactor = clamp(
        getCssNumber("--warzone-live-aircraft-focus-anim-cadence-factor", 1.04),
        0.2,
        1.5
    );
    return { minMs, maxMs, cadenceFactor };
}
function getFocusedTrackRangeBounds() {
    const baseRange = clamp(
        Number(__liveTrackFocusBaseRangeMeters || getLiveTrackFocusCameraRangeMeters()),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
    const zoomDeltaMeters = getLiveTrackFocusZoomRangeMeters();
    return {
        min: clamp(
            baseRange - zoomDeltaMeters,
            LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
            LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
        ),
        max: clamp(
            baseRange + zoomDeltaMeters,
            LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
            LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
        ),
    };
}
function applyFocusCameraControllerLock(enabled = false) {
    const controller = window.__warzoneViewer?.scene?.screenSpaceCameraController;
    if (!controller) return;
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
        __liveTrackFocusGuideEl.style.display = "none";
    }
}

function hideLiveTrackFocusVisuals() {
    hideFocusGuideElement();
    if (__liveTrackOverlayRoot) {
        __liveTrackOverlayRoot.classList.remove("is-visible");
        __liveTrackOverlayRoot.style.display = "none";
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

    const anchor = getFocusVisualAnchorScreenPosition(viewer, trackKey);

    if (!anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
        hideFocusGuideElement();
        return;
    }

    guide.style.left = `${anchor.x}px`;
    guide.style.top = `${anchor.y}px`;
    guide.style.display = "block";
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
    const stopFocusPointerEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    };
    const startFocusOrbitMotion = (event) => {
        if (!isFocusSelectionActive() || !__liveTrackHardLockEnabled) return;
        if (Number(event?.button) !== 0) return;
        if (__liveTrackCtrlTiltDragState?.active) return;
        stopFocusPointerEvent(event);
        try {
            if (event?.pointerId !== undefined) {
                canvas.setPointerCapture?.(event.pointerId);
            }
        } catch { }
        __liveTrackCtrlTiltDragState = {
            active: true,
            pointerId: event?.pointerId,
            lastX: Number(event?.clientX || 0),
            lastY: Number(event?.clientY || 0),
        };
        __liveTrackManualCameraIntent = false;
        __liveTrackUserCameraInteracting = false;
        requestWarzoneRender();
    };
    const updateFocusOrbitMotion = (event) => {
        if (!__liveTrackCtrlTiltDragState || !isFocusSelectionActive() || !__liveTrackHardLockEnabled) return;
        if (
            __liveTrackCtrlTiltDragState.pointerId !== undefined &&
            event?.pointerId !== undefined &&
            event.pointerId !== __liveTrackCtrlTiltDragState.pointerId
        ) {
            return;
        }
        stopFocusPointerEvent(event);
        const lastX = Number(__liveTrackCtrlTiltDragState.lastX ?? event?.clientX ?? 0);
        const lastY = Number(__liveTrackCtrlTiltDragState.lastY ?? event?.clientY ?? 0);
        const nextX = Number(event?.clientX ?? lastX);
        const nextY = Number(event?.clientY ?? lastY);
        const dx = nextX - lastX;
        const dy = nextY - lastY;
        __liveTrackCtrlTiltDragState.lastX = nextX;
        __liveTrackCtrlTiltDragState.lastY = nextY;
        if (Number.isFinite(dx) && Number.isFinite(dy) && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) {
            __liveTrackFocusHeadingDeg = normalizeDegrees(
                __liveTrackFocusHeadingDeg - dx * LIVE_TRACK_FOCUS_CAMERA_HEADING_SENSITIVITY_DEG_PER_PX
            );
            __liveTrackFocusPitchDeg = clamp(
                __liveTrackFocusPitchDeg + dy * LIVE_TRACK_FOCUS_CAMERA_PITCH_SENSITIVITY_DEG_PER_PX,
                LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG,
                LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG
            );
            __liveTrackUserCameraInteracting = false;
            __liveTrackLastFocusCameraSyncAt = 0;
            syncFocusedTrackCamera({ preserveRange: true });
            requestWarzoneRender();
        }
        __liveTrackManualCameraIntent = false;
    };
    const stopCtrlTiltDrag = (event) => {
        try {
            if (event?.pointerId !== undefined) {
                canvas.releasePointerCapture?.(event.pointerId);
            }
        } catch { }
        __liveTrackCtrlTiltDragState = null;
    };
    const handleFocusWheel = (event) => {
        if (!isFocusSelectionActive() || !__liveTrackHardLockEnabled) return;
        event.preventDefault();
        event.stopPropagation();
        const deltaY = Number(event?.deltaY || 0);
        const zoomStepMeters = getLiveTrackFocusWheelZoomStepMeters();
        const zoomDelta = deltaY > 0 ? zoomStepMeters : -zoomStepMeters;
        const nextRange = Number(__liveTrackFocusRangeMeters || __liveTrackFocusBaseRangeMeters) + zoomDelta;
        if (!handleAircraftFocusRangeChange(nextRange)) return;
        __liveTrackUserCameraInteracting = false;
        __liveTrackLastFocusCameraSyncAt = 0;
        syncFocusedTrackCamera({ preserveRange: true });
        requestWarzoneRender();
    };
    canvas.addEventListener("pointerdown", startFocusOrbitMotion, { passive: false, capture: true });
    canvas.addEventListener("pointermove", updateFocusOrbitMotion, { passive: false, capture: true });
    window.addEventListener("pointermove", updateFocusOrbitMotion, { passive: false, capture: true });
    window.addEventListener("pointerup", stopCtrlTiltDrag, { passive: true });
    window.addEventListener("pointercancel", stopCtrlTiltDrag, { passive: true });
    canvas.addEventListener("mousedown", startFocusOrbitMotion, { passive: false, capture: true });
    canvas.addEventListener("mousedown", markManualIntent, { passive: true });
    canvas.addEventListener("touchstart", markManualIntent, { passive: true });
    canvas.addEventListener("wheel", handleFocusWheel, { passive: false });
    canvas.addEventListener("dblclick", clearManualIntent, { passive: true });
    canvas.addEventListener("mousemove", updateFocusOrbitMotion, { passive: false, capture: true });
    window.addEventListener("mousemove", updateFocusOrbitMotion, { passive: false, capture: true });
    window.addEventListener("mouseup", clearManualIntent, { passive: true });
    window.addEventListener("touchend", clearManualIntent, { passive: true });
    window.addEventListener("mouseup", stopCtrlTiltDrag, { passive: true });
    window.addEventListener("blur", stopCtrlTiltDrag, { passive: true });
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
function getHistoryPointDistanceMeters(a = {}, b = {}, track = {}) {
    const aLon = Number(a?.lon);
    const aLat = Number(a?.lat);
    const bLon = Number(b?.lon);
    const bLat = Number(b?.lat);
    if (![aLon, aLat, bLon, bLat].every(Number.isFinite)) return Number.NaN;
    try {
        const aCartesian = Cesium.Cartesian3.fromDegrees(
            aLon,
            aLat,
            getTrackPointRenderAltitudeMeters(a, track)
        );
        const bCartesian = Cesium.Cartesian3.fromDegrees(
            bLon,
            bLat,
            getTrackPointRenderAltitudeMeters(b, track)
        );
        return getCartesianDistanceMeters(aCartesian, bCartesian);
    } catch {
        return getLonLatDistanceMeters(aLon, aLat, bLon, bLat);
    }
}
function getTrackHistoryMaxSpeedMps(track = {}) {
    const subtype = resolveTrackSubtype(track).trim().toLowerCase();
    return LIVE_TRACK_HISTORY_MAX_SPEED_MPS_BY_SUBTYPE[subtype]
        || LIVE_TRACK_HISTORY_MAX_SPEED_MPS_BY_SUBTYPE.aircraft;
}
function isImplausibleTrackMotion(movedMeters, dtMs, track = {}) {
    if (!Number.isFinite(movedMeters) || movedMeters <= LIVE_TRACK_HISTORY_JUMP_MIN_METERS) return false;
    if (!Number.isFinite(dtMs) || dtMs <= 0) return true;
    const maxDistanceMeters = Math.max(
        LIVE_TRACK_HISTORY_JUMP_MIN_METERS,
        getTrackHistoryMaxSpeedMps(track) * (dtMs / 1000) * LIVE_TRACK_HISTORY_SPEED_GRACE_FACTOR
    );
    return movedMeters > maxDistanceMeters;
}
function isFocusedRoutePointSpike(previous = {}, point = {}, next = {}, track = {}) {
    const directMeters = getHistoryPointDistanceMeters(previous, next, track);
    const inMeters = getHistoryPointDistanceMeters(previous, point, track);
    const outMeters = getHistoryPointDistanceMeters(point, next, track);
    if (![directMeters, inMeters, outMeters].every(Number.isFinite)) return false;
    if (inMeters < LIVE_TRACK_FOCUS_ROUTE_SPIKE_MIN_METERS || outMeters < LIVE_TRACK_FOCUS_ROUTE_SPIKE_MIN_METERS) return false;
    const detourRatio = (inMeters + outMeters) / Math.max(directMeters, 1);
    return detourRatio >= LIVE_TRACK_FOCUS_ROUTE_SPIKE_RATIO;
}
function sanitizeFocusedRouteHistoryPoints(points = [], track = {}) {
    const ordered = (Array.isArray(points) ? points : [])
        .filter((point) => Number.isFinite(Number(point?.lon)) && Number.isFinite(Number(point?.lat)))
        .sort((a, b) => Number(a?.ts || 0) - Number(b?.ts || 0));
    const jumpFiltered = [];
    for (const point of ordered) {
        const previous = jumpFiltered[jumpFiltered.length - 1];
        if (previous) {
            const movedMeters = getHistoryPointDistanceMeters(previous, point, track);
            const dtMs = Math.max(0, Number(point.ts || 0) - Number(previous.ts || 0));
            if (isImplausibleTrackMotion(movedMeters, dtMs, track)) {
                continue;
            }
        }
        jumpFiltered.push(point);
    }
    if (jumpFiltered.length < 3) return jumpFiltered;
    const spikeFiltered = [jumpFiltered[0]];
    for (let index = 1; index < jumpFiltered.length - 1; index += 1) {
        const previous = spikeFiltered[spikeFiltered.length - 1];
        const point = jumpFiltered[index];
        const next = jumpFiltered[index + 1];
        if (!isFocusedRoutePointSpike(previous, point, next, track)) {
            spikeFiltered.push(point);
        }
    }
    spikeFiltered.push(jumpFiltered[jumpFiltered.length - 1]);
    return spikeFiltered;
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
        ts: getTrackSourceTimestamp(track),
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
            const dtMs = Math.max(0, Number(point.ts || 0) - Number(previousPoint.ts || 0));
            if (isImplausibleTrackMotion(movedMeters, dtMs, track)) {
                entry.path_history = pruneHistoryPoints(history);
                entry.last_seen_at = point.ts;
                return;
            } else if (movedMeters < minTrailDistanceMeters) {
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
    if (isFocusedTrackKey(trackKey)) {
        __liveTrackFocusedRouteGeometryCache = null;
        syncFocusedRouteEntity(trackKey);
    }
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
function resetCameraToActiveRegion(options = {}) {
    const viewer = window.__warzoneViewer;
    const region = getActiveRegion?.();
    if (!viewer || !region) return returnToRegionalFocus(options);
    try {
        flyToRegion(viewer, region, {
            source: "aircraft-focus-clear",
            showLoader: false,
            ...options,
        });
        return true;
    } catch {
        return returnToRegionalFocus(options);
    }
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

    const focusPanel = document.createElement("aside");
    focusPanel.className = "wz-aircraft-focus-panel is-visible";
    focusPanel.style.left = "50%";
    focusPanel.style.top = "126px";
    focusPanel.style.padding = ".45rem";
    focusPanel.setAttribute("aria-label", "Focused aircraft map controls");

    const controls = document.createElement("div");
    controls.className = "wz-aircraft-focus-panel__controls";

    const btnMap3d = document.createElement("button");
    btnMap3d.type = "button";
    btnMap3d.className = "wz-aircraft-focus-panel__mode";
    btnMap3d.dataset.focusMapMode = "plain";
    btnMap3d.textContent = "3D";
    btnMap3d.setAttribute("aria-label", "Use plain 3D map");
    btnMap3d.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mapApi = window.__warzoneViewer?.__warzone;
        mapApi?.setSatelliteVisible?.(true);
        mapApi?.setGreyedSatelliteVisible?.(false);
        mapApi?.setContourGridVisible?.(false);
        void Promise.resolve(mapApi?.setContourLayerVisible?.(false))
            .finally(() => {
                disableAircraftFocusTerrain(window.__warzoneViewer);
                syncFocusedTrackOverlayModeButtons();
                refreshFocusedTrackModelAfterMapModeChange();
            });
    });

    const btnTerrain = document.createElement("button");
    btnTerrain.type = "button";
    btnTerrain.className = "wz-aircraft-focus-panel__mode";
    btnTerrain.dataset.focusMapMode = "terrain";
    btnTerrain.textContent = "TER";
    btnTerrain.setAttribute("aria-label", "Use 3D terrain elevation map");
    btnTerrain.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mapApi = window.__warzoneViewer?.__warzone;
        mapApi?.setSatelliteVisible?.(true);
        mapApi?.setGreyedSatelliteVisible?.(false);
        mapApi?.setContourGridVisible?.(false);
        void Promise.resolve(mapApi?.setContourLayerVisible?.(false))
            .then(() => mapApi?.enableFocusedTerrain?.())
            .finally(() => {
                syncFocusedTrackOverlayModeButtons();
                refreshFocusedTrackModelAfterMapModeChange();
            });
    });

    const btnContour = document.createElement("button");
    btnContour.type = "button";
    btnContour.className = "wz-aircraft-focus-panel__mode";
    btnContour.dataset.focusMapMode = "contour";
    btnContour.textContent = "CTR";
    btnContour.setAttribute("aria-label", "Use contour terrain map");
    btnContour.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        __liveTrackContourAnchorKey = "";
        if (!syncFocusedTrackContourCenter(getFocusedTrackKey(), { force: true })) {
            syncFocusedTrackOverlayModeButtons();
            return;
        }
        const mapApi = window.__warzoneViewer?.__warzone;
        mapApi?.setSatelliteVisible?.(true);
        mapApi?.setGreyedSatelliteVisible?.(true);
        mapApi?.setContourGridVisible?.(false);
        disableAircraftFocusTerrain(window.__warzoneViewer);
        void Promise.resolve(mapApi?.setContourLayerVisible?.(true))
            .finally(() => {
                syncFocusedTrackOverlayModeButtons();
                refreshFocusedTrackModelAfterMapModeChange();
            });
    });

    const unfocusButton = document.createElement("button");
    unfocusButton.type = "button";
    unfocusButton.className = "wz-aircraft-focus-panel__unfocus";
    unfocusButton.textContent = "Unlock";
    unfocusButton.setAttribute("aria-label", "Unlock aircraft");
    unfocusButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearLiveTrackSelection({ duration: 0.95, focusFlyOut: true });
    });

    controls.appendChild(btnMap3d);
    controls.appendChild(btnTerrain);
    controls.appendChild(btnContour);
    controls.appendChild(unfocusButton);
    focusPanel.appendChild(controls);
    root.appendChild(focusPanel);

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
function syncFocusedTrackOverlayModeButtons() {
    const root = __liveTrackOverlayRoot;
    if (!root) return;
    const mapApi = window.__warzoneViewer?.__warzone;
    const contourVisible = mapApi?.isContourLayerVisible?.() === true;
    const terrainVisible = mapApi?.isFocusedTerrainActive?.() === true;
    const mode = contourVisible ? "contour" : terrainVisible ? "terrain" : "plain";
    root.querySelectorAll("[data-focus-map-mode]").forEach((button) => {
        const active = button.dataset.focusMapMode === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}
function refreshFocusedTrackModelAfterMapModeChange() {
    const focusedTrackKey = getFocusedTrackKey();
    if (!focusedTrackKey || String(__liveTrackReplayState.mode || "") !== "focus") return;
    __liveTrackFocusedRouteGeometryCache = null;
    refreshLiveTrackVisualMode(focusedTrackKey);
    requestWarzoneRenderBatched();
}
function syncFocusedTrackContourCenter(trackKey = "", options = {}) {
    const viewer = window.__warzoneViewer;
    const mapApi = viewer?.__warzone;
    if (!viewer || !mapApi?.setContourFocusPosition) return false;
    const normalizedTrackKey = String(trackKey || "");
    const entity = trackKey ? viewer.entities?.getById?.(`track-${trackKey}`) : null;
    const position = getPositionCartesian(entity);
    if (!position) {
        __liveTrackContourAnchorKey = "";
        mapApi.clearContourFocusPosition?.();
        return false;
    }
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    if (!cartographic) {
        __liveTrackContourAnchorKey = "";
        __liveTrackContourAnchorLon = Number.NaN;
        __liveTrackContourAnchorLat = Number.NaN;
        mapApi.clearContourFocusPosition?.();
        return false;
    }
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const refreshDistance = Math.max(
        15000,
        Number(options.refreshDistance || getCssNumber("--warzone-contour-refresh-distance", 45000))
    );
    const movedMeters = getLonLatDistanceMeters(__liveTrackContourAnchorLon, __liveTrackContourAnchorLat, lon, lat);
    if (
        normalizedTrackKey &&
        __liveTrackContourAnchorKey === normalizedTrackKey &&
        options.force !== true &&
        Number.isFinite(movedMeters) &&
        movedMeters < refreshDistance
    ) {
        return true;
    }
    __liveTrackContourAnchorKey = normalizedTrackKey;
    __liveTrackContourAnchorLon = lon;
    __liveTrackContourAnchorLat = lat;
    mapApi.setContourFocusPosition({
        lon,
        lat,
        height: Number(cartographic.height || 0),
    }, {
        force: options.force === true,
        reason: "focused-aircraft-sync",
    });
    return true;
}
function syncFocusedTrackContourMode(focused = false) {
    const autoEnabled = window.__stratopsConfig?.autoContourOnAircraftFocus === true;
    const mapApi = window.__warzoneViewer?.__warzone;
    if (!autoEnabled || !mapApi?.setContourLayerVisible || !mapApi?.isContourLayerVisible) {
        if (!focused && mapApi?.setContourLayerVisible) {
            __liveTrackContourAnchorKey = "";
            __liveTrackContourAnchorLon = Number.NaN;
            __liveTrackContourAnchorLat = Number.NaN;
            mapApi.clearContourFocusPosition?.();
            void Promise.resolve(mapApi.restoreDefaultMapRender?.() || mapApi.setContourLayerVisible(false))
                .finally(() => syncFocusedTrackOverlayModeButtons());
            return;
        }
        syncFocusedTrackOverlayModeButtons();
        return;
    }
    if (focused) {
        if (__liveTrackContourStateBeforeFocus === null) {
            __liveTrackContourStateBeforeFocus = mapApi.isContourLayerVisible() === true;
        }
        __liveTrackContourAnchorKey = "";
        __liveTrackContourAnchorLon = Number.NaN;
        __liveTrackContourAnchorLat = Number.NaN;
        syncFocusedTrackContourCenter(getFocusedTrackKey(), { force: true });
        void Promise.resolve(mapApi.setContourLayerVisible(true))
            .finally(() => syncFocusedTrackOverlayModeButtons());
        return;
    }
    if (__liveTrackContourStateBeforeFocus === null) {
        syncFocusedTrackOverlayModeButtons();
        return;
    }
    const restoreVisible = __liveTrackContourStateBeforeFocus === true;
    __liveTrackContourStateBeforeFocus = null;
    __liveTrackContourAnchorKey = "";
    __liveTrackContourAnchorLon = Number.NaN;
    __liveTrackContourAnchorLat = Number.NaN;
    mapApi.clearContourFocusPosition?.();
    if (restoreVisible) {
        void Promise.resolve(mapApi.setContourLayerVisible(true))
            .finally(() => syncFocusedTrackOverlayModeButtons());
    } else {
        void Promise.resolve(mapApi.setContourLayerVisible(false))
            .finally(() => syncFocusedTrackOverlayModeButtons());
    }
}
function getViewerCenterScreenPosition(viewer = window.__warzoneViewer) {
    const canvas = viewer?.scene?.canvas;
    const host = viewer?.container || viewer?.cesiumWidget?.container;
    const width = Number(canvas?.clientWidth || host?.clientWidth || 0);
    const height = Number(canvas?.clientHeight || host?.clientHeight || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return { x: width / 2, y: height / 2 };
}
function getFocusVisualAnchorScreenPosition(viewer = window.__warzoneViewer, trackKey = "") {
    if (
        String(__liveTrackReplayState.mode || "") === "focus" &&
        __liveTrackHardLockEnabled
    ) {
        const center = getViewerCenterScreenPosition(viewer);
        if (center) return center;
    }
    return getScreenPositionForTrack(trackKey);
}
function syncLiveTrackFocusOverlay() {
    const viewer = window.__warzoneViewer;

    if (!viewer) return;
    const root = ensureLiveTrackOverlayRoot(viewer);
    if (!root) return;
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusMode = String(__liveTrackReplayState.mode || "") === "focus";
    if (!selectedTrackKey || !isFocusMode) {
        root.classList.remove("is-visible");
        root.style.display = "none";
        __liveTrackOverlayLastVisible = false;
        __liveTrackOverlayLastX = Number.NaN;
        __liveTrackOverlayLastY = Number.NaN;
        return;
    }
    if (window.__warzoneViewer?.__warzone?.isContourLayerVisible?.() === true) {
        const now = performance.now();
        if ((now - __liveTrackLastContourFocusSyncAt) >= 1500) {
            __liveTrackLastContourFocusSyncAt = now;
            syncFocusedTrackContourCenter(selectedTrackKey);
        }
    }
    syncFocusedTrackOverlayModeButtons();
    const screen = getFocusVisualAnchorScreenPosition(viewer, selectedTrackKey);
    if (!screen) {
        root.classList.remove("is-visible");
        root.style.display = "none";
        __liveTrackOverlayLastVisible = false;
        __liveTrackOverlayLastX = Number.NaN;
        __liveTrackOverlayLastY = Number.NaN;
        return;
    }
    if (!__liveTrackOverlayLastVisible) {
        root.style.display = "block";
        root.classList.add("is-visible");
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
    __liveTrackFocusPitchDeg = getLiveTrackFocusCameraPitchDeg();
}
function getFocusedTrackCameraViewFromTarget(position) {
    const viewer = window.__warzoneViewer;
    const camera = viewer?.camera;
    if (!camera?.positionWC || !position) return null;
    try {
        const targetFrame = Cesium.Transforms.eastNorthUpToFixedFrame(position);
        const inverseFrame = Cesium.Matrix4.inverseTransformation(targetFrame, new Cesium.Matrix4());
        const localOffset = Cesium.Matrix4.multiplyByPoint(
            inverseFrame,
            camera.positionWC,
            new Cesium.Cartesian3()
        );
        const range = Cesium.Cartesian3.magnitude(localOffset);
        if (!Number.isFinite(range) || range <= 0) return null;
        const headingRad = Math.atan2(-localOffset.x, -localOffset.y);
        const pitchRad = Math.asin(clamp(-localOffset.z / range, -1, 1));
        const headingDeg = Cesium.Math.toDegrees(headingRad);
        const pitchDeg = Cesium.Math.toDegrees(pitchRad);
        if (!Number.isFinite(headingDeg) || !Number.isFinite(pitchDeg)) return null;
        return { headingDeg, pitchDeg, range };
    } catch {
        return null;
    }
}
function syncFocusedTrackCameraOrientationFromViewer(position, options = {}) {
    if (!position) return;
    const preserveRange = options?.preserveRange === true;
    const view = getFocusedTrackCameraViewFromTarget(position);
    const headingDeg = Number(view?.headingDeg);
    const pitchDeg = Number(view?.pitchDeg);
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
    const measuredRange = Number(view?.range);
    if (!preserveRange && Number.isFinite(measuredRange) && measuredRange > 0) {
        if (__liveTrackHardLockEnabled) {
            handleAircraftFocusRangeChange(measuredRange);
        } else {
            __liveTrackFocusRangeMeters = clamp(
                measuredRange,
                LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
                LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
            );
        }
    }
}
function syncFocusedTrackCamera(options = {}) {
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
    if (__liveTrackUserCameraInteracting && !__liveTrackCtrlTiltDragState?.active) return;
    const now = performance.now();
    if ((now - __liveTrackLastFocusCameraSyncAt) < LIVE_TRACK_FOCUS_CAMERA_SYNC_MIN_MS) {
        return;
    }
    __liveTrackLastFocusCameraSyncAt = now;
    const entity = viewer.entities.getById(`track-${selectedTrackKey}`);
    const position = getPositionCartesian(entity);
    if (!position) return;
    const preserveRange = options?.preserveRange === true;
    try {
        viewer.camera.lookAt(
            position,
            new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(__liveTrackFocusHeadingDeg),
                Cesium.Math.toRadians(__liveTrackFocusPitchDeg),
                __liveTrackFocusRangeMeters
            )
        );
        refreshLiveTrackEntityVisualStyle(entity);
    } catch { }
}
function bindLiveTrackOverlay(viewer) {
    if (!viewer || __liveTrackOverlayBound) return;
    __liveTrackOverlayBound = true;
    ensureLiveTrackOverlayRoot(viewer);
    document.addEventListener("wz:contour-layer-changed", syncFocusedTrackOverlayModeButtons);
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
            if (__liveTrackCtrlTiltDragState?.active) {
                __liveTrackUserCameraInteracting = false;
                if (__liveTrackFocusResumeTimer) {
                    clearTimeout(__liveTrackFocusResumeTimer);
                    __liveTrackFocusResumeTimer = null;
                }
            } else {
                __liveTrackUserCameraInteracting = false;
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
        refreshLiveTrackViewDependentVisuals();
        if (!hasSelection || __liveTrackIsCameraFlying || !__liveTrackHardLockEnabled) {
            __liveTrackUserCameraInteracting = false;
            return;
        }
        if (__liveTrackFocusResumeTimer) {
            clearTimeout(__liveTrackFocusResumeTimer);
            __liveTrackFocusResumeTimer = null;
        }
        const wasUserCameraInteracting = __liveTrackUserCameraInteracting;
        const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
        const entity = viewer.entities.getById(`track-${selectedTrackKey}`);
        const position = getPositionCartesian(entity);
        if (position && wasUserCameraInteracting) {
            syncFocusedTrackCameraOrientationFromViewer(position);
        }
        __liveTrackUserCameraInteracting = false;
        __liveTrackLastFocusCameraSyncAt = 0;
        syncFocusedTrackCamera();
        requestWarzoneRenderBatched();
    });
}
function getLiveTrackUnfocusCameraRangeMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-unfocus-camera-range", 56000),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackUnfocusZoomOutDeltaMeters() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-unfocus-zoom-out-delta", 18000),
        0,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
}
function getLiveTrackUnfocusCameraPitchDeg() {
    return clamp(
        getCssNumber("--warzone-live-aircraft-unfocus-camera-pitch", -89.5),
        -90,
        -45
    );
}
function getViewerSceneModeLabel(viewer) {
    if (!viewer?.scene) return "3d";
    return viewer.scene.mode === Cesium.SceneMode.SCENE2D ? "2d" : "3d";
}
function morphViewerSceneMode(viewer, mode = "3d", options = {}) {
    const callback = typeof options?.callback === "function" ? options.callback : null;
    if (!viewer?.scene) {
        callback?.();
        return;
    }
    const targetMode = String(mode || "3d").toLowerCase() === "2d" ? "2d" : "3d";
    if (getViewerSceneModeLabel(viewer) === targetMode && viewer.scene.mode !== Cesium.SceneMode.MORPHING) {
        callback?.();
        return;
    }
    const duration = Math.max(0.2, Number(options?.duration || 0.95));
    let settled = false;
    let timer = 0;
    let removeListener = null;
    const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (typeof removeListener === "function") {
            removeListener();
            removeListener = null;
        }
        callback?.();
    };
    removeListener = viewer.scene.morphComplete?.addEventListener?.(finish) || null;
    timer = window.setTimeout(finish, Math.max(900, Math.round(duration * 1000) + 900));
    try {
        if (targetMode === "2d") {
            viewer.scene.morphTo2D(duration);
        } else {
            viewer.scene.morphTo3D(duration);
        }
    } catch {
        finish();
    }
}
function flyOutFromFocusedAircraft(trackKey = "", options = {}) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !trackKey) return false;
    const entity = viewer.entities.getById(`track-${trackKey}`);
    const targetPosition = getPositionCartesian(entity);
    if (!targetPosition) return false;
    const view = getFocusedTrackCameraViewFromTarget(targetPosition);
    const headingDeg = Number.isFinite(Number(view?.headingDeg))
        ? Number(view.headingDeg)
        : __liveTrackFocusHeadingDeg;
    const measuredRange = Number(view?.range || __liveTrackFocusRangeMeters || 0);
    const currentRange = Number.isFinite(measuredRange) && measuredRange > 0
        ? measuredRange
        : getLiveTrackFocusCameraRangeMeters();
    const range = clamp(
        Math.max(currentRange + getLiveTrackUnfocusZoomOutDeltaMeters(), getLiveTrackUnfocusCameraRangeMeters()),
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
    try {
        viewer.camera.cancelFlight?.();
        __liveTrackIsCameraFlying = true;
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(targetPosition, 1), {
            duration: Number(options.duration || 1.15),
            offset: new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(normalizeDegrees(headingDeg)),
                Cesium.Math.toRadians(getLiveTrackUnfocusCameraPitchDeg()),
                range
            ),
            complete: () => {
                __liveTrackIsCameraFlying = false;
                if (typeof options?.onComplete === "function") options.onComplete();
            },
            cancel: () => {
                __liveTrackIsCameraFlying = false;
                if (typeof options?.onComplete === "function") options.onComplete();
            },
        });
        return true;
    } catch {
        __liveTrackIsCameraFlying = false;
        if (typeof options?.onComplete === "function") options.onComplete();
        return false;
    }
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
    const entityId = typeof entity.id === "string" ? entity.id : "";
    if (entityId === "track-origin-hover-label") return "";
    const focusFadeMatch = entityId.match(/^track-focus-route-fade-\d+-(.+)$/);
    if (focusFadeMatch) {
        return String(focusFadeMatch[1] || "").trim();
    }
    if (entityId.startsWith("track-focus-route-")) {
        return entityId.replace(/^track-focus-route-/, "").trim();
    }
    if (entityId.startsWith("track-focus-start-")) {
        return entityId.replace(/^track-focus-start-/, "").trim();
    }
    if (entityId.startsWith("track-replay-route-")) {
        return entityId.replace(/^track-replay-route-/, "").trim();
    }
    if (entityId.startsWith("track-replay-marker-")) {
        return entityId.replace(/^track-replay-marker-/, "").trim();
    }
    if (entityId.startsWith("track-trail-")) {
        return entityId.replace(/^track-trail-/, "").trim();
    }
    if (entityId.startsWith("track-")) {
        return entityId.replace(/^track-/, "").trim();
    }
    return "";
}
function isPickedTrackTrailOrRoute(picked) {
    const entity =
        picked?.id ||
        picked?.primitive?.id ||
        picked?.primitive?._id ||
        null;
    const entityId = typeof entity?.id === "string" ? entity.id : "";
    return entityId.startsWith("track-trail-") ||
        entityId.startsWith("track-focus-route-") ||
        entityId.startsWith("track-replay-route-");
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
            hideRouteOriginHover();
            return;
        }
        const picked = safeScenePick(viewer, hoverPickPosition);
        const trackKey = resolvePickedTrackKey(picked);
        if (trackKey && isPickedTrackTrailOrRoute(picked)) {
            showRouteOriginHover(trackKey, hoverPickPosition);
        } else {
            hideRouteOriginHover();
        }
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
        const picked = safeScenePick(viewer, movement.position);
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

    clearRouteOriginHover();
    if (!viewer) return;
    if (__liveTrackReplayState.markerTimer) {
        clearInterval(__liveTrackReplayState.markerTimer);
        __liveTrackReplayState.markerTimer = null;
    }
    if (__liveTrackReplayState.routeEntity) {
        viewer.entities.remove(__liveTrackReplayState.routeEntity);
        __liveTrackReplayState.routeEntity = null;
    }
    if (Array.isArray(__liveTrackReplayState.routeFadeEntities)) {
        __liveTrackReplayState.routeFadeEntities.forEach((entity) => {
            try {
                viewer.entities.remove(entity);
            } catch { }
        });
        __liveTrackReplayState.routeFadeEntities = [];
    }
    __liveTrackFocusedRouteGeometryCache = null;
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
function canRunScenePick(viewer) {
    const scene = viewer?.scene;
    const canvas = scene?.canvas;
    const drawingBufferWidth = Number(scene?.drawingBufferWidth || canvas?.width || 0);
    const drawingBufferHeight = Number(scene?.drawingBufferHeight || canvas?.height || 0);
    const clientWidth = Number(canvas?.clientWidth || 0);
    const clientHeight = Number(canvas?.clientHeight || 0);
    return drawingBufferWidth > 0 &&
        drawingBufferHeight > 0 &&
        clientWidth > 0 &&
        clientHeight > 0;
}
function safeScenePick(viewer, windowPosition) {
    if (!viewer?.scene || !windowPosition || !canRunScenePick(viewer)) return null;
    try {
        return viewer.scene.pick(windowPosition);
    } catch {
        return null;
    }
}

function setSelectedTrack(trackKey = "", mode = "") {
    __liveTrackReplayState.selectedTrackKey = trackKey || "";
    __liveTrackReplayState.mode = mode || "";
    publishLiveTrackSelectionState();
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
    const mapApi = window.__warzoneViewer?.__warzone;
    if (mapApi?.setPerformanceMode) {
        const visibleCount = Math.max(0, Number(window.__warzoneViewer?.__warzonePerformanceState?.visibleCount || 0));
        mapApi.setPerformanceMode(visibleCount);
    }
    syncLiveTrackFocusOverlay();
    dispatchLiveTrackRegistryUpdate();
    // Highlight matching row in Aircraft Tracker widget
    syncWidgetRowHighlight(__liveTrackReplayState.selectedTrackKey);
    refreshFocusedTrackIsolation();
}

function getHistoryPointHeadingDeg(pathHistory = [], index = 0, track = {}) {
    const point = pathHistory[index] || {};
    const explicitHeading = Number(point.heading_deg ?? point.heading ?? point.track ?? Number.NaN);
    if (Number.isFinite(explicitHeading)) return normalizeDegrees(explicitHeading);
    const previous = pathHistory[Math.max(0, index - 1)];
    const next = pathHistory[Math.min(pathHistory.length - 1, index + 1)];
    const from = previous && previous !== point ? previous : point;
    const to = next && next !== point ? next : point;
    const fromLon = Number(from?.lon);
    const fromLat = Number(from?.lat);
    const toLon = Number(to?.lon);
    const toLat = Number(to?.lat);
    if ([fromLon, fromLat, toLon, toLat].every(Number.isFinite) && (fromLon !== toLon || fromLat !== toLat)) {
        return getHeadingDegreesFromPoints(fromLon, fromLat, toLon, toLat);
    }
    return normalizeDegrees(Number(track.heading_deg || 0));
}
function buildReplayPositions(pathHistory = [], track = {}, options = {}) {
    const focusAnchored = options.focusAnchored === true;
    const points = pathHistory.filter((point) => Number.isFinite(Number(point?.lon)) && Number.isFinite(Number(point?.lat)));
    return points
        .map((point, index) => {
            const lon = Number(point.lon);
            const lat = Number(point.lat);
            const alt = getTrackPointRenderAltitudeMeters(point, track);
            if (focusAnchored) {
                return buildTrackTrailCartesian(
                    track,
                    lon,
                    lat,
                    alt,
                    getHistoryPointHeadingDeg(points, index, track)
                );
            }
            return Cesium.Cartesian3.fromDegrees(
                lon,
                lat,
                getTrackTrailRenderAltitudeMeters(alt)
            );
        })
        .filter(Boolean);
}
function formatRouteOriginCoord(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(4) : "UNKNOWN";
}
function getFocusedRouteOriginPoint(trackKey = "") {
    const entry = __liveTrackRegistry.get(trackKey);
    if (!entry) return null;
    const points = pruneHistoryPoints(entry.path_history || [])
        .filter((point) => Number.isFinite(Number(point?.lon)) && Number.isFinite(Number(point?.lat)));
    return points.length ? points[0] : null;
}
function getMilitaryBasePoint(base = {}) {
    const lat = Number(base.lat ?? base.coordinates?.lat);
    const lon = Number(base.lon ?? base.lng ?? base.coordinates?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
function getMilitaryBaseDisplayName(base = {}) {
    return String(base.name || base.title || base.id || "")
        .replace(/\s+/g, " ")
        .trim();
}
function isLikelyAirbaseRecord(base = {}) {
    const text = [
        base.type,
        base.typeLabel,
        base.name,
        base.operator,
        base.sourceLayer,
        base.metadata?.originalType,
        base.metadata?.originalCategory,
    ].filter(Boolean).join(" ").toLowerCase();
    return /\b(airbase|air base|air force|airfield|air station|airport|aerodrome|afb|usaf|raf)\b/.test(text);
}
function refreshRouteOriginHoverLabel() {
    if (!__liveTrackOriginHoverEntity?.show || !__liveTrackOriginHoverTrackKey) return;
    const text = buildRouteOriginHoverText(__liveTrackOriginHoverTrackKey);
    if (!text || !__liveTrackOriginHoverEntity.label) return;
    __liveTrackOriginHoverEntity.label.text = text;
    requestWarzoneRenderBatched();
}
function loadRouteOriginBases() {
    if (Array.isArray(__liveTrackOriginBases)) {
        return Promise.resolve(__liveTrackOriginBases);
    }
    if (!__liveTrackOriginBasesPromise) {
        __liveTrackOriginBasesPromise = import("./warzone-military-bases-data.js")
            .then((module) => {
                __liveTrackOriginBases = Array.isArray(module?.MILITARY_BASES)
                    ? module.MILITARY_BASES.filter((base) => isLikelyAirbaseRecord(base) && getMilitaryBasePoint(base))
                    : [];
                __liveTrackOriginBaseCache.clear();
                refreshRouteOriginHoverLabel();
                return __liveTrackOriginBases;
            })
            .catch(() => {
                __liveTrackOriginBases = [];
                return __liveTrackOriginBases;
            });
    }
    return __liveTrackOriginBasesPromise;
}
function findNearestRouteOriginAirbase(point = {}) {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!Array.isArray(__liveTrackOriginBases)) {
        loadRouteOriginBases();
        return null;
    }
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    if (__liveTrackOriginBaseCache.has(cacheKey)) {
        return __liveTrackOriginBaseCache.get(cacheKey);
    }
    let best = null;
    for (const base of __liveTrackOriginBases) {
        const basePoint = getMilitaryBasePoint(base);
        if (!basePoint) continue;
        const distanceMeters = getLonLatDistanceMeters(lon, lat, basePoint.lon, basePoint.lat);
        if (!Number.isFinite(distanceMeters)) continue;
        if (!best || distanceMeters < best.distanceMeters) {
            best = {
                base,
                distanceMeters,
                distanceKm: distanceMeters / 1000,
                name: getMilitaryBaseDisplayName(base),
                country: String(base.country || "").trim(),
            };
        }
    }
    const match = best && best.distanceKm <= LIVE_TRACK_ORIGIN_BASE_RADIUS_KM ? best : null;
    __liveTrackOriginBaseCache.set(cacheKey, match);
    if (__liveTrackOriginBaseCache.size > 120) {
        const oldestKey = __liveTrackOriginBaseCache.keys().next().value;
        if (oldestKey !== undefined) __liveTrackOriginBaseCache.delete(oldestKey);
    }
    return match;
}
function formatRouteOriginDistanceKm(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "";
    return numeric >= 10 ? numeric.toFixed(0) : numeric.toFixed(1);
}
function formatRouteOriginLabelValue(value, maxLength = 34) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(8, maxLength - 3)).trim()}...`;
}
function buildRouteOriginHoverText(trackKey = "") {
    const point = getFocusedRouteOriginPoint(trackKey);
    if (!point) return "";
    const airbase = findNearestRouteOriginAirbase(point);
    const lines = ["ORIGIN"];
    if (airbase?.name) {
        lines.push(`NEAR ${formatRouteOriginLabelValue(airbase.name)}`);
        if (airbase.country) lines.push(formatRouteOriginLabelValue(airbase.country.toUpperCase(), 28));
        const distance = formatRouteOriginDistanceKm(airbase.distanceKm);
        if (distance) lines.push(`DIST ${distance} KM`);
    } else if (Array.isArray(__liveTrackOriginBases)) {
        lines.push("NEAREST AIRBASE UNKNOWN");
    }
    lines.push(`LAT ${formatRouteOriginCoord(point.lat)}`);
    lines.push(`LON ${formatRouteOriginCoord(point.lon)}`);
    return lines.join("\n");
}
function hideRouteOriginHover() {
    __liveTrackOriginHoverTrackKey = "";
    if (__liveTrackOriginHoverEntity) {
        __liveTrackOriginHoverEntity.show = false;
        requestWarzoneRenderBatched();
    }
}
function clearRouteOriginHover() {
    const viewer = window.__warzoneViewer;
    if (__liveTrackOriginHoverEntity && viewer?.entities) {
        try {
            viewer.entities.remove(__liveTrackOriginHoverEntity);
        } catch { }
    }
    __liveTrackOriginHoverEntity = null;
    __liveTrackOriginHoverTrackKey = "";
}
function isValidCartesianPosition(position) {
    return Boolean(position) &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        Number.isFinite(position.z);
}
function getRouteOriginHoverPosition(viewer, screenPosition, point, entry) {
    if (viewer && screenPosition) {
        try {
            if (viewer.scene?.pickPositionSupported && typeof viewer.scene.pickPosition === "function") {
                const pickedPosition = viewer.scene.pickPosition(screenPosition);
                if (isValidCartesianPosition(pickedPosition)) return pickedPosition;
            }
        } catch { }
        try {
            const ellipsoid = viewer.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
            const groundPosition = viewer.camera?.pickEllipsoid?.(screenPosition, ellipsoid);
            if (isValidCartesianPosition(groundPosition)) {
                const cartographic = Cesium.Cartographic.fromCartesian(groundPosition, ellipsoid);
                return Cesium.Cartesian3.fromRadians(
                    cartographic.longitude,
                    cartographic.latitude,
                    getTrackTrailRenderAltitudeMeters(getTrackPointRenderAltitudeMeters(point, entry)),
                    ellipsoid
                );
            }
        } catch { }
    }
    return Cesium.Cartesian3.fromDegrees(
        Number(point.lon),
        Number(point.lat),
        getTrackTrailRenderAltitudeMeters(getTrackPointRenderAltitudeMeters(point, entry))
    );
}
function showRouteOriginHover(trackKey = "", screenPosition = null) {
    const viewer = window.__warzoneViewer;
    const entry = __liveTrackRegistry.get(trackKey);
    const point = getFocusedRouteOriginPoint(trackKey);
    const text = buildRouteOriginHoverText(trackKey);
    if (!viewer || !entry || !point || !text) {
        hideRouteOriginHover();
        return false;
    }
    const position = getRouteOriginHoverPosition(viewer, screenPosition, point, entry);
    if (!isValidCartesianPosition(position)) {
        hideRouteOriginHover();
        return false;
    }
    __liveTrackOriginHoverTrackKey = trackKey;
    const labelStyle = getLiveLabelStyleConfig();
    if (!__liveTrackOriginHoverEntity) {
        __liveTrackOriginHoverEntity = viewer.entities.add({
            id: "track-origin-hover-label",
            position,
            label: {
                text,
                font: labelStyle.font,
                fillColor: Cesium.Color.fromCssColorString(labelStyle.fill),
                outlineColor: Cesium.Color.fromCssColorString(labelStyle.outline),
                outlineWidth: Math.max(labelStyle.outlineWidth, 2.2),
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(14, -18),
                scale: labelStyle.scale,
                showBackground: false,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            show: true,
        });
    } else {
        __liveTrackOriginHoverEntity.position = position;
        __liveTrackOriginHoverEntity.show = true;
        if (__liveTrackOriginHoverEntity.label) {
            __liveTrackOriginHoverEntity.label.text = text;
            __liveTrackOriginHoverEntity.label.font = labelStyle.font;
            __liveTrackOriginHoverEntity.label.scale = labelStyle.scale;
            __liveTrackOriginHoverEntity.label.fillColor = Cesium.Color.fromCssColorString(labelStyle.fill);
            __liveTrackOriginHoverEntity.label.outlineColor = Cesium.Color.fromCssColorString(labelStyle.outline);
            __liveTrackOriginHoverEntity.label.outlineWidth = Math.max(labelStyle.outlineWidth, 2.2);
            __liveTrackOriginHoverEntity.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
        }
    }
    requestWarzoneRenderBatched();
    return true;
}
function getFocusedRoutePositions(trackKey = "") {
    const viewer = window.__warzoneViewer;
    const entry = __liveTrackRegistry.get(trackKey);
    if (!viewer || !entry) return [];
    const historyPoints = sanitizeFocusedRouteHistoryPoints(
        pruneHistoryPoints(entry.path_history || []),
        entry
    );
    const positions = buildReplayPositions(historyPoints, entry, { focusAnchored: true });
    const entity = viewer.entities?.getById?.(`track-${trackKey}`);
    const liveHeadPosition = getPositionCartesian(entity);
    if (!liveHeadPosition) return smoothFocusedRoutePositions(positions);
    const lastPosition = positions.length ? positions[positions.length - 1] : null;
    const headDistanceMeters = getCartesianDistanceMeters(lastPosition, liveHeadPosition);
    const lastHistoryPoint = historyPoints.length ? historyPoints[historyPoints.length - 1] : null;
    const headDtMs = Math.max(0, Date.now() - Number(lastHistoryPoint?.ts || Date.now()));
    if (lastPosition && isImplausibleTrackMotion(headDistanceMeters, headDtMs, entry)) {
        return smoothFocusedRoutePositions(positions);
    }
    const replaceDistanceMeters = clamp(getLiveTrackFocusCameraRangeMeters() * 0.18, 1500, 18000);
    if (!lastPosition) {
        positions.push(liveHeadPosition);
    } else if (Number.isFinite(headDistanceMeters) && headDistanceMeters <= replaceDistanceMeters) {
        positions[positions.length - 1] = liveHeadPosition;
    } else if (!Number.isFinite(headDistanceMeters) || headDistanceMeters > 0.75) {
        positions.push(liveHeadPosition);
    }
    return smoothFocusedRoutePositions(positions);
}
function smoothFocusedRoutePositions(positions = []) {
    const source = Array.isArray(positions) ? positions.filter(Boolean) : [];
    if (source.length <= 2) return source;
    if (shouldRenderTrailAsStraightLine(source)) {
        return [source[0], source[source.length - 1]];
    }
    const smoothed = chaikinSmoothTrailPositions(source, source.length > 5 ? 2 : 1);
    if (!smoothed.length) return source;
    smoothed[0] = source[0];
    smoothed[smoothed.length - 1] = source[source.length - 1];
    return downsampleTrailPositions(smoothed, LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS);
}
function getPolylineDistanceMeters(positions = []) {
    let distanceMeters = 0;
    for (let index = 1; index < positions.length; index += 1) {
        distanceMeters += getCartesianDistanceMeters(positions[index - 1], positions[index]);
    }
    return distanceMeters;
}
function getRoutePointAtDistance(positions = [], distanceMeters = 0) {
    if (!positions.length) return null;
    const targetDistance = Math.max(0, Number(distanceMeters || 0));
    if (targetDistance <= 0) return positions[0];
    let walkedMeters = 0;
    for (let index = 1; index < positions.length; index += 1) {
        const start = positions[index - 1];
        const end = positions[index];
        const segmentMeters = getCartesianDistanceMeters(start, end);
        if (!Number.isFinite(segmentMeters) || segmentMeters <= 0) continue;
        if (walkedMeters + segmentMeters >= targetDistance) {
            const ratio = clamp((targetDistance - walkedMeters) / segmentMeters, 0, 1);
            return Cesium.Cartesian3.lerp(start, end, ratio, new Cesium.Cartesian3());
        }
        walkedMeters += segmentMeters;
    }
    return positions[positions.length - 1] || null;
}
function getRoutePositionsAfterDistance(positions = [], distanceMeters = 0) {
    if (positions.length < 2) return positions;
    const targetDistance = Math.max(0, Number(distanceMeters || 0));
    if (targetDistance <= 0) return positions;
    let walkedMeters = 0;
    const result = [];
    for (let index = 1; index < positions.length; index += 1) {
        const start = positions[index - 1];
        const end = positions[index];
        const segmentMeters = getCartesianDistanceMeters(start, end);
        if (!Number.isFinite(segmentMeters) || segmentMeters <= 0) continue;
        if (walkedMeters + segmentMeters >= targetDistance) {
            const ratio = clamp((targetDistance - walkedMeters) / segmentMeters, 0, 1);
            result.push(Cesium.Cartesian3.lerp(start, end, ratio, new Cesium.Cartesian3()));
            result.push(...positions.slice(index));
            break;
        }
        walkedMeters += segmentMeters;
    }
    return result.length >= 2 ? result : positions;
}
function getRouteSegmentBetweenDistances(positions = [], startDistanceMeters = 0, endDistanceMeters = 0) {
    if (positions.length < 2) return [];
    const start = getRoutePointAtDistance(positions, startDistanceMeters);
    const end = getRoutePointAtDistance(positions, endDistanceMeters);
    return start && end && getCartesianDistanceMeters(start, end) > 0 ? [start, end] : [];
}
function getRouteScreenFadeDistanceMeters(positions = [], targetPixels = 56) {
    const viewer = window.__warzoneViewer;
    const sceneToWindow = Cesium.SceneTransforms?.worldToWindowCoordinates ?? Cesium.SceneTransforms?.wgs84ToWindowCoordinates;
    if (!viewer?.scene || typeof sceneToWindow !== "function" || positions.length < 2) return Number.NaN;
    let walkedPixels = 0;
    let walkedMeters = 0;
    let previousScreen = null;
    try {
        previousScreen = sceneToWindow(viewer.scene, positions[0]);
    } catch {
        return Number.NaN;
    }
    if (!previousScreen || !Number.isFinite(previousScreen.x) || !Number.isFinite(previousScreen.y)) return Number.NaN;
    for (let index = 1; index < positions.length; index += 1) {
        let screen = null;
        try {
            screen = sceneToWindow(viewer.scene, positions[index]);
        } catch {
            return Number.NaN;
        }
        if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return Number.NaN;
        const dx = screen.x - previousScreen.x;
        const dy = screen.y - previousScreen.y;
        const segmentPixels = Math.hypot(dx, dy);
        const segmentMeters = getCartesianDistanceMeters(positions[index - 1], positions[index]);
        if (Number.isFinite(segmentPixels) && segmentPixels > 0 && Number.isFinite(segmentMeters) && segmentMeters > 0) {
            if (walkedPixels + segmentPixels >= targetPixels) {
                const ratio = clamp((targetPixels - walkedPixels) / segmentPixels, 0, 1);
                return walkedMeters + segmentMeters * ratio;
            }
            walkedPixels += segmentPixels;
            walkedMeters += segmentMeters;
        }
        previousScreen = screen;
    }
    return Number.NaN;
}
function getFocusedRouteFadeDistanceMeters(positions = [], totalMeters = Number.NaN) {
    const routeMeters = Number.isFinite(totalMeters) ? totalMeters : getPolylineDistanceMeters(positions);
    if (!Number.isFinite(routeMeters) || routeMeters <= 0) return 0;
    const targetPixels = clamp(getCssNumber("--warzone-live-track-route-fade-px", 28), 20, 32);
    let fadeMeters = getRouteScreenFadeDistanceMeters(positions, targetPixels);
    if (!Number.isFinite(fadeMeters) || fadeMeters <= 0) {
        const cameraHeight = getViewerCameraHeightMeters();
        fadeMeters = Number.isFinite(cameraHeight) ? clamp(cameraHeight * 0.018, 750, 60000) : routeMeters * 0.05;
    }
    fadeMeters = clamp(fadeMeters, 0, routeMeters * 0.35);
    return fadeMeters < routeMeters * 0.6 ? fadeMeters : 0;
}
function buildFocusedRouteGeometry(trackKey = "") {
    const positions = getFocusedRoutePositions(trackKey);
    const totalMeters = getPolylineDistanceMeters(positions);
    const fadeMeters = getFocusedRouteFadeDistanceMeters(positions, totalMeters);
    const shouldFade = positions.length >= 2 && fadeMeters > 0 && totalMeters > fadeMeters * 1.15;
    const fadeSegments = [];
    if (shouldFade) {
        for (let index = 0; index < LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS; index += 1) {
            const startDistance = fadeMeters * (index / LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS);
            const endDistance = fadeMeters * ((index + 1) / LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS);
            fadeSegments.push(getRouteSegmentBetweenDistances(positions, startDistance, endDistance));
        }
    }
    return {
        positions,
        totalMeters,
        fadeMeters: shouldFade ? fadeMeters : 0,
        solidPositions: shouldFade ? getRoutePositionsAfterDistance(positions, fadeMeters) : positions,
        fadeSegments,
    };
}
function getFocusedRouteGeometryInputs(trackKey = "") {
    const viewer = window.__warzoneViewer;
    const entry = __liveTrackRegistry.get(trackKey) || {};
    const history = Array.isArray(entry.path_history) ? entry.path_history : [];
    const entity = viewer?.entities?.getById?.(`track-${trackKey}`);
    const headPosition = getPositionCartesian(entity);
    const cameraPosition = viewer?.camera?.positionWC || viewer?.camera?.position || null;
    return {
        historyLength: history.length,
        historyLastTs: Number(history[history.length - 1]?.ts || 0),
        headPosition,
        cameraPosition,
        cameraHeading: Number(viewer?.camera?.heading || 0),
        cameraPitch: Number(viewer?.camera?.pitch || 0),
        cameraRoll: Number(viewer?.camera?.roll || 0),
        terrainActive: isFocusedTerrainModeActive(),
        fadePixels: clamp(getCssNumber("--warzone-live-track-route-fade-px", 28), 20, 32),
        smoothing: getLiveTrackTrailSmoothingStrength(),
    };
}
function canReuseFocusedRouteGeometry(cache, trackKey = "", inputs = {}) {
    if (!cache || cache.trackKey !== trackKey) return false;
    if (
        cache.historyLength !== inputs.historyLength ||
        cache.historyLastTs !== inputs.historyLastTs ||
        cache.terrainActive !== inputs.terrainActive ||
        cache.fadePixels !== inputs.fadePixels ||
        cache.smoothing !== inputs.smoothing
    ) {
        return false;
    }
    if (
        getCartesianDistanceMeters(cache.headPosition, inputs.headPosition) >=
        LIVE_TRACK_FOCUS_ROUTE_HEAD_INVALIDATION_METERS
    ) {
        return false;
    }
    if (
        getCartesianDistanceMeters(cache.cameraPosition, inputs.cameraPosition) >=
        LIVE_TRACK_FOCUS_ROUTE_CAMERA_INVALIDATION_METERS
    ) {
        return false;
    }
    return (
        Math.abs(Number(cache.cameraHeading || 0) - Number(inputs.cameraHeading || 0)) < LIVE_TRACK_FOCUS_ROUTE_ANGLE_INVALIDATION_RADIANS &&
        Math.abs(Number(cache.cameraPitch || 0) - Number(inputs.cameraPitch || 0)) < LIVE_TRACK_FOCUS_ROUTE_ANGLE_INVALIDATION_RADIANS &&
        Math.abs(Number(cache.cameraRoll || 0) - Number(inputs.cameraRoll || 0)) < LIVE_TRACK_FOCUS_ROUTE_ANGLE_INVALIDATION_RADIANS
    );
}
function getFocusedRouteGeometry(trackKey = "") {
    const key = String(trackKey || "");
    const inputs = getFocusedRouteGeometryInputs(key);
    if (canReuseFocusedRouteGeometry(__liveTrackFocusedRouteGeometryCache, key, inputs)) {
        return __liveTrackFocusedRouteGeometryCache.geometry;
    }
    const geometry = buildFocusedRouteGeometry(key);
    __liveTrackFocusedRouteGeometryCache = {
        trackKey: key,
        ...inputs,
        headPosition: inputs.headPosition
            ? Cesium.Cartesian3.clone(inputs.headPosition, new Cesium.Cartesian3())
            : null,
        cameraPosition: inputs.cameraPosition
            ? Cesium.Cartesian3.clone(inputs.cameraPosition, new Cesium.Cartesian3())
            : null,
        geometry,
    };
    return geometry;
}
function getFocusedRouteSolidPositions(trackKey = "") {
    return getFocusedRouteGeometry(trackKey).solidPositions || [];
}
function getFocusedRouteFadeSegmentPositions(trackKey = "", segmentIndex = 0) {
    const geometry = getFocusedRouteGeometry(trackKey);
    return geometry.fadeSegments?.[segmentIndex] || [];
}
function getFocusedRouteWidth(track = {}) {
    const style = getLiveTrackStyleConfig(track);
    const baseWidth = getLiveTrackSubtypeTrailWidth(track, style.trailWidth);
    const focusedWidthFactor = clamp(getCssNumber("--warzone-live-focus-route-width-factor", 1), 0.6, 1.4);
    return clamp(baseWidth * focusedWidthFactor, 1, 8);
}
function getFocusedRouteMaterial(alpha = 0.92) {
    return Cesium.Color.fromCssColorString(getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)"))
        .withAlpha(clamp(alpha, 0, 1));
}
function syncFocusedRouteEntity(trackKey = "") {
    const viewer = window.__warzoneViewer;
    const track = __liveTrackRegistry.get(trackKey) || {};
    if (
        !viewer ||
        !trackKey ||
        String(__liveTrackReplayState.mode || "") !== "focus" ||
        String(__liveTrackReplayState.selectedTrackKey || "") !== String(trackKey)
    ) {
        return false;
    }
    const positions = getFocusedRoutePositions(trackKey);
    if (positions.length < 2) return false;
    if (__liveTrackReplayState.routeEntity) return true;
    const routeWidth = getFocusedRouteWidth(track);
    __liveTrackReplayState.routeEntity = viewer.entities.add({
        id: `track-focus-route-${trackKey}`,
        polyline: {
            positions: new Cesium.CallbackProperty(() => getFocusedRouteSolidPositions(trackKey), false),
            width: routeWidth,
            material: getFocusedRouteMaterial(0.92),
            depthFailMaterial: getFocusedRouteMaterial(0.92),
            clampToGround: false,
            arcType: Cesium.ArcType.NONE,
        }
    });
    __liveTrackReplayState.routeFadeEntities = Array.from(
        { length: LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS },
        (_, index) => {
            const fadeRatio = LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS <= 1
                ? 1
                : index / (LIVE_TRACK_FOCUS_ROUTE_FADE_SEGMENTS - 1);
            const alpha = LIVE_TRACK_FOCUS_ROUTE_FADE_ALPHA * Math.pow(fadeRatio, 1.35);
            return viewer.entities.add({
                id: `track-focus-route-fade-${index}-${trackKey}`,
                polyline: {
                    positions: new Cesium.CallbackProperty(() => getFocusedRouteFadeSegmentPositions(trackKey, index), false),
                    width: routeWidth,
                    material: getFocusedRouteMaterial(alpha),
                    depthFailMaterial: getFocusedRouteMaterial(alpha),
                    clampToGround: false,
                    arcType: Cesium.ArcType.NONE,
                }
            });
        }
    );
    applyLiveTrackFocusVisibility(trackKey);
    requestWarzoneRenderBatched();
    return true;
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
            material: Cesium.Color.fromCssColorString(getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)")).withAlpha(0.96),
            depthFailMaterial: Cesium.Color.fromCssColorString(getCssColor("--warzone-live-track-color", "rgba(24,226,219,1)")).withAlpha(0.96),
            clampToGround: false,
            arcType: Cesium.ArcType.NONE,
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
            __liveTrackReplayState.markerEntity.billboard.alignedAxis = Cesium.Cartesian3.ZERO;
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
    return getCssNumber("--warzone-live-aircraft-model-roll-offset-default", 0) +
        getCssNumber("--warzone-live-aircraft-model-preview-roll", 0);
}
export function setAircraftModelHeadingOffset(subtype = "", headingOffsetDeg = 90) {
    const next = Number(headingOffsetDeg);
    if (!Number.isFinite(next)) return;
    const subtypeKey = String(subtype || "")
        .trim()
        .toLowerCase();
    if (subtypeKey && subtypeKey !== "default") {
        // Keep support for ad-hoc subtype calibration from the dev panel, but
        // the default runtime path uses one shared forward axis for all models.
        return;
    } else {
        LIVE_TRACK_MODEL_HEADING_OFFSET_DEFAULT = next;
    }
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
    if (!Number.isFinite(defaultValue)) {
        const firstNumericEntry = Object.entries(offsetMap).find(([, value]) => Number.isFinite(Number(value)));
        if (firstNumericEntry) {
            setAircraftModelHeadingOffset("default", Number(firstNumericEntry[1]));
        }
    }
}
function getLiveTrackTailOffsetMeters(track = {}) {
    const subtype = getTrackSubtypeKey(track);
    return LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE[subtype] ?? 220;
}
function offsetLonLatByMeters(lon, lat, eastMeters = 0, northMeters = 0) {
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(lat)) * latMeters);
    return {
        lon: lon + (eastMeters / lonMeters),
        lat: lat + (northMeters / latMeters),
    };
}
function getFocusedTrackAnchorOffsets(track = {}) {
    const tailOffsetMeters = getLiveTrackTailOffsetMeters(track);
    return {
        backwardMeters: getCssNumber("--warzone-live-aircraft-model-anchor-backward-meters", tailOffsetMeters * 0.34),
        downMeters: getCssNumber("--warzone-live-aircraft-model-anchor-down-meters", Math.max(18, tailOffsetMeters * 0.18)),
    };
}
function isFocusedTerrainModeActive() {
    return window.__warzoneViewer?.__warzone?.isFocusedTerrainActive?.() === true;
}
function getFocusedTerrainModelClearanceMeters(track = {}) {
    void track;
    return 0;
}
function buildTrackEntityCartesian(track = {}, lon, lat, alt, headingDeg = 0) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) {
        return null;
    }
    const isFocused = isTrackInFocusVisualContext(track);
    const anchorOffsets = isFocused ? getFocusedTrackAnchorOffsets(track) : null;
    const backwardMeters = anchorOffsets?.backwardMeters || 0;
    const terrainActive = isFocused && isFocusedTerrainModeActive();
    const downMeters = Number(anchorOffsets?.downMeters || 0);
    const terrainClearanceMeters = terrainActive ? getFocusedTerrainModelClearanceMeters(track) : 0;
    const headingRad = Cesium.Math.toRadians(normalizeDegrees(headingDeg));
    const northMeters = -Math.cos(headingRad) * backwardMeters;
    const eastMeters = -Math.sin(headingRad) * backwardMeters;
    const offset = offsetLonLatByMeters(lon, lat, eastMeters, northMeters);
    try {
        return Cesium.Cartesian3.fromDegrees(
            offset.lon,
            offset.lat,
            Math.max(0, alt - downMeters + terrainClearanceMeters)
        );
    } catch {
        return null;
    }
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
    const headingSmoothing = clamp(getCssNumber("--warzone-live-aircraft-heading-smoothing", 0.42), 0, 1);
    if (!Number.isFinite(headingDeltaDeg) || Math.abs(headingDeltaDeg) >= 165 || headingSmoothing <= 0) {
        state.headingDeg = targetHeadingDeg;
    } else {
        state.headingDeg = normalizeDegrees(state.headingDeg + (headingDeltaDeg * headingSmoothing));
    }
    if (dynamicBankEnabled) {
        const bankFactor = getCssNumber("--warzone-live-aircraft-model-bank-factor", -1.2);
        const bankMaxDeg = Math.max(0, getCssNumber("--warzone-live-aircraft-model-bank-max-deg", 18));
        const bankDeadbandDeg = Math.max(0, getCssNumber("--warzone-live-aircraft-model-bank-deadband-deg", 0.75));
        const bankSmoothing = clamp(getCssNumber("--warzone-live-aircraft-model-bank-smoothing", 0.24), 0.02, 1);
        const bankReturnSmoothing = clamp(getCssNumber("--warzone-live-aircraft-model-bank-return-smoothing", 0.16), 0.02, 1);
        const targetRollDeg = Math.abs(headingDeltaDeg) <= bankDeadbandDeg
            ? 0
            : clamp(headingDeltaDeg * bankFactor, -bankMaxDeg, bankMaxDeg);
        const rollSmoothing = targetRollDeg === 0 ? bankReturnSmoothing : bankSmoothing;
        state.rollDeg = state.rollDeg + ((targetRollDeg - state.rollDeg) * rollSmoothing);
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
        const isFocused = isTrackInFocusVisualContext(track);
        const tailOffsetMeters = getLiveTrackTailOffsetMeters(track);
        const focusedAnchorOffsets = isFocused ? getFocusedTrackAnchorOffsets(track) : null;
        const terrainActive = isFocused && isFocusedTerrainModeActive();
        const backwardMeters = isFocused
            ? focusedAnchorOffsets.backwardMeters
            : getCssNumber("--warzone-live-track-trail-anchor-backward-meters", tailOffsetMeters);
        const downMeters = isFocused
            ? focusedAnchorOffsets.downMeters
            : getCssNumber("--warzone-live-track-trail-anchor-down-meters", Math.max(12, tailOffsetMeters * 0.16));
        const terrainClearanceMeters = terrainActive ? getFocusedTerrainModelClearanceMeters(track) : 0;
        const headingRad = Cesium.Math.toRadians(normalizeDegrees(courseHeadingDeg));
        const northMeters = -Math.cos(headingRad) * backwardMeters;
        const eastMeters = -Math.sin(headingRad) * backwardMeters;
        const offset = offsetLonLatByMeters(lon, lat, eastMeters, northMeters);
        return Cesium.Cartesian3.fromDegrees(
            offset.lon,
            offset.lat,
            Math.max(0, getTrackTrailRenderAltitudeMeters(alt) - downMeters + terrainClearanceMeters)
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
function getTrailPathLengthMeters(positions = []) {
    let total = 0;
    for (let i = 1; i < positions.length; i += 1) {
        const distance = getCartesianDistanceMeters(positions[i - 1], positions[i]);
        if (Number.isFinite(distance)) total += distance;
    }
    return total;
}
function getPointLineDistanceMeters(point, start, end) {
    const line = Cesium.Cartesian3.subtract(end, start, new Cesium.Cartesian3());
    const rel = Cesium.Cartesian3.subtract(point, start, new Cesium.Cartesian3());
    const lineLength = Cesium.Cartesian3.magnitude(line);
    if (!Number.isFinite(lineLength) || lineLength <= 0) {
        return getCartesianDistanceMeters(point, start);
    }
    const cross = Cesium.Cartesian3.cross(rel, line, new Cesium.Cartesian3());
    return Cesium.Cartesian3.magnitude(cross) / lineLength;
}
function isTrailEntrySpike(previous = {}, point = {}, next = {}) {
    const directMeters = getCartesianDistanceMeters(previous?.position || null, next?.position || null);
    const inMeters = getCartesianDistanceMeters(previous?.position || null, point?.position || null);
    const outMeters = getCartesianDistanceMeters(point?.position || null, next?.position || null);
    if (![directMeters, inMeters, outMeters].every(Number.isFinite)) return false;
    if (inMeters < LIVE_TRACK_TRAIL_SPIKE_MIN_METERS || outMeters < LIVE_TRACK_TRAIL_SPIKE_MIN_METERS) return false;
    const detourRatio = (inMeters + outMeters) / Math.max(directMeters, 1);
    return detourRatio >= LIVE_TRACK_TRAIL_SPIKE_RATIO;
}
function sanitizeTrailSpikeEntries(entries = []) {
    const ordered = Array.isArray(entries) ? entries.filter((entry) => entry?.position) : [];
    if (ordered.length < 3) return ordered;
    const filtered = [ordered[0]];
    for (let index = 1; index < ordered.length - 1; index += 1) {
        const previous = filtered[filtered.length - 1];
        const point = ordered[index];
        const next = ordered[index + 1];
        if (!isTrailEntrySpike(previous, point, next)) {
            filtered.push(point);
        }
    }
    filtered.push(ordered[ordered.length - 1]);
    return filtered;
}
function shouldRenderTrailAsStraightLine(positions = []) {
    if (positions.length <= 2) return true;
    const first = positions[0];
    const last = positions[positions.length - 1];
    const directDistance = getCartesianDistanceMeters(first, last);
    if (!Number.isFinite(directDistance) || directDistance <= 0) return false;
    const pathLength = getTrailPathLengthMeters(positions);
    if (!Number.isFinite(pathLength) || pathLength <= 0) return false;
    let maxDeviation = 0;
    for (let i = 1; i < positions.length - 1; i += 1) {
        const deviation = getPointLineDistanceMeters(positions[i], first, last);
        if (Number.isFinite(deviation)) {
            maxDeviation = Math.max(maxDeviation, deviation);
        }
    }
    const pathRatio = pathLength / directDistance;
    const allowedDeviation = Math.max(90, directDistance * 0.018);
    return pathRatio <= 1.035 && maxDeviation <= allowedDeviation;
}
function catmullRomTrailPoint(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return new Cesium.Cartesian3(
        0.5 * ((2 * p1.x) + ((p2.x - p0.x) * t) + (((2 * p0.x) - (5 * p1.x) + (4 * p2.x) - p3.x) * t2) + (((-p0.x) + (3 * p1.x) - (3 * p2.x) + p3.x) * t3)),
        0.5 * ((2 * p1.y) + ((p2.y - p0.y) * t) + (((2 * p0.y) - (5 * p1.y) + (4 * p2.y) - p3.y) * t2) + (((-p0.y) + (3 * p1.y) - (3 * p2.y) + p3.y) * t3)),
        0.5 * ((2 * p1.z) + ((p2.z - p0.z) * t) + (((2 * p0.z) - (5 * p1.z) + (4 * p2.z) - p3.z) * t2) + (((-p0.z) + (3 * p1.z) - (3 * p2.z) + p3.z) * t3))
    );
}
function curveTrailPositions(positions = [], samplesPerSegment = 6) {
    const source = Array.isArray(positions) ? positions.filter(Boolean) : [];
    if (source.length < 3) return source;
    const samples = Math.max(3, Math.min(10, Math.round(Number(samplesPerSegment || 6))));
    const output = [source[0]];
    for (let i = 0; i < source.length - 1; i += 1) {
        const p0 = source[Math.max(0, i - 1)];
        const p1 = source[i];
        const p2 = source[i + 1];
        const p3 = source[Math.min(source.length - 1, i + 2)];
        for (let step = 1; step <= samples; step += 1) {
            output.push(catmullRomTrailPoint(p0, p1, p2, p3, step / samples));
        }
    }
    return downsampleTrailPositions(output, LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS);
}
function smoothTrackTrailPositions(rawPositions = []) {
    const positions = Array.isArray(rawPositions) ? rawPositions : [];
    if (positions.length <= 2) return positions;
    if (shouldRenderTrailAsStraightLine(positions)) {
        return [positions[0], positions[positions.length - 1]];
    }
    const smoothing = getLiveTrackTrailSmoothingStrength();
    const aggressiveSmoothing = Number.isFinite(smoothing) && smoothing >= 0.64;
    if (positions.length < LIVE_TRACK_TRAIL_SMOOTH_MIN_POINTS) {
        return curveTrailPositions(positions, aggressiveSmoothing ? 7 : 5);
    }
    if (!Number.isFinite(smoothing) || smoothing <= 0) return curveTrailPositions(positions, 5);

    const keepTail = Math.max(0, LIVE_TRACK_TRAIL_SMOOTH_KEEP_TAIL_POINTS);
    const bodyEnd = Math.max(3, positions.length - keepTail);
    const body = positions.slice(0, bodyEnd);
    const tail = keepTail > 0 ? positions.slice(bodyEnd) : [];
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
    const chaikinPasses = aggressiveSmoothing ? 2 : 1;
    const curvedBody = chaikinSmoothTrailPositions(averaged, chaikinPasses);
    const sampledCurve = curveTrailPositions(curvedBody, aggressiveSmoothing ? 7 : 5);
    const maxBodyPoints = Math.max(2, LIVE_TRACK_TRAIL_SMOOTH_MAX_POINTS - tail.length);
    const cappedBody = downsampleTrailPositions(sampledCurve, maxBodyPoints);
    return cappedBody.concat(tail);
}
function getTrackTrailPositions(trackKey) {
    const trailEntries = __liveTrackTrails.get(trackKey) || [];
    const cachedPositions = updateTrackTrailPositionsCache(trackKey, trailEntries);
    const entity = window.__warzoneViewer?.entities?.getById?.(`track-${trackKey}`);
    const liveHeadPosition = getPositionCartesian(entity);
    if (!liveHeadPosition) return cachedPositions;
    const cache = __liveTrackTrailPositionsCache.get(trackKey);
    if (
        cache?.renderPositions &&
        cache?.headPosition &&
        getCartesianDistanceMeters(cache.headPosition, liveHeadPosition) < LIVE_TRACK_TRAIL_HEAD_INVALIDATION_METERS
    ) {
        return cache.renderPositions;
    }
    if (!cachedPositions.length) return [liveHeadPosition];
    const lastPosition = cachedPositions[cachedPositions.length - 1];
    const headDistanceMeters = getCartesianDistanceMeters(lastPosition, liveHeadPosition);
    if (!Number.isFinite(headDistanceMeters) || headDistanceMeters <= 0.75) {
        if (cache) {
            cache.renderPositions = cachedPositions;
            cache.headPosition = Cesium.Cartesian3.clone(liveHeadPosition, cache.headPosition || new Cesium.Cartesian3());
        }
        return cachedPositions;
    }
    const replaceDistanceMeters = isFocusSelectionActive() ? 2200 : 420;
    const lastTrailEntry = trailEntries.length ? trailEntries[trailEntries.length - 1] : null;
    const headDtMs = Math.max(0, Date.now() - Number(lastTrailEntry?.ts || Date.now()));
    const track = __liveTrackRegistry.get(trackKey) || {};
    if (isImplausibleTrackMotion(headDistanceMeters, headDtMs, track)) {
        return cachedPositions;
    }
    let renderPositions;
    if (headDistanceMeters <= replaceDistanceMeters) {
        renderPositions = cachedPositions.slice(0, -1).concat([liveHeadPosition]);
    } else {
        renderPositions = cachedPositions.concat([liveHeadPosition]);
    }
    if (cache) {
        cache.renderPositions = renderPositions;
        cache.headPosition = Cesium.Cartesian3.clone(liveHeadPosition, cache.headPosition || new Cesium.Cartesian3());
    }
    return renderPositions;
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
function commitTrackTrailPosition(trackKey, track = {}, newPosition) {
    if (!trackKey || !newPosition) return;
    const now = Date.now();
    let trail = trimTrailEntries(__liveTrackTrails.get(trackKey) || []);
    const lastEntry = trail[trail.length - 1];
    const lastPosition = lastEntry?.position || null;
    const movedMeters = getCartesianDistanceMeters(lastPosition, newPosition);
    if (lastEntry) {
        const dtMs = Math.max(0, now - Number(lastEntry.ts || now));
        if (isImplausibleTrackMotion(movedMeters, dtMs, track)) {
            return;
        }
    }
    const minTrailDistanceMeters = getTrackTrailMinDistanceMeters(track);
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const isFocusedTrailTrack =
        selectedTrackKey &&
        selectedTrackKey === String(trackKey || "") &&
        String(__liveTrackReplayState.mode || "") === "focus";
    const effectiveMinTrailDistance = isFocusedTrailTrack
        ? minTrailDistanceMeters
        : minTrailDistanceMeters;
    if (!lastEntry || movedMeters >= effectiveMinTrailDistance) {
        trail.push({
            position: newPosition,
            ts: now,
        });
    }
    trail = sanitizeTrailSpikeEntries(trimTrailEntries(trail));
    __liveTrackTrails.set(trackKey, trail);
    updateTrackTrailPositionsCache(trackKey, trail);
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
    commitTrackTrailPosition(trackKey, track, newPosition);
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
function sanitizeSeedTrailEntries(entries = [], track = {}) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    if (safeEntries.length <= 1) return safeEntries;
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
        if (isImplausibleTrackMotion(movedMeters, dtMs, track)) {
            continue;
        }
        sanitized.push(next);
    }
    return sanitizeTrailSpikeEntries(sanitized);
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
    const entries = trimTrailEntries(sanitizeSeedTrailEntries(sortedEntries, track));
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
    if (isTrackInFocusVisualContext(track)) {
        commitTrackTrailPosition(trackKey, track, currentPosition);
        return;
    }
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
    const style = getLiveTrackStyleConfig(track);
    const trailVisible = shouldRenderLiveTrackTrail(trackKey, track);
    const trailWidth = getLiveTrackSubtypeTrailWidth(track, style.trailWidth);
    let entity = viewer.entities.getById(trailId);
    if (!trailVisible && !entity) return null;
    if (!entity) {
        const trailMaterial = Cesium.Color.fromCssColorString(style.trailColor)
            .withAlpha(style.trailOpacity);
        entity = viewer.entities.add({
            id: trailId,
            polyline: {
                show: trailVisible,
                positions: new Cesium.CallbackProperty(() => {
                    return getTrackTrailPositions(trackKey);
                }, false),
                width: trailWidth,
                material: trailMaterial,
                depthFailMaterial: trailMaterial,
                clampToGround: false,
                arcType: Cesium.ArcType.NONE,
            }
        });
        entity.__trackKey = trackKey;
    } else if (entity.polyline) {
        const trailMaterial = Cesium.Color.fromCssColorString(style.trailColor)
            .withAlpha(style.trailOpacity);
        entity.__trackKey = trackKey;
        entity.polyline.show = trailVisible;
        entity.polyline.width = trailWidth;
        entity.polyline.material = trailMaterial;
        entity.polyline.depthFailMaterial = trailMaterial;
        entity.polyline.arcType = Cesium.ArcType.NONE;
    }
    applyLiveTrackFocusVisibility(trackKey);
    return entity;
}
/* ================= ANIMATION ================= */
function stopFocusedTrackCoast(entity) {
    if (!entity) return;
    if (entity.__liveTrackCoastFrame) {
        cancelAnimationFrame(entity.__liveTrackCoastFrame);
        entity.__liveTrackCoastFrame = null;
    }
}
function maybeStartFocusedTrackCoast(entity, track = {}) {
    if (!entity || !isFocusedTrackKey(entity.__trackKey)) return;
    const speedKts = Number(track.speed_kts ?? track.ground_speed_kts ?? 0);
    if (!Number.isFinite(speedKts) || speedKts < LIVE_TRACK_FOCUS_COAST_MIN_SPEED_KTS) return;
    if (isTrackOnGround(track)) return;
    const startCartesian = getPositionCartesian(entity);
    if (!startCartesian) return;
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    if (!startCartographic) return;
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startAlt = Number(startCartographic.height || 0);
    const headingDeg = normalizeDegrees(Number(entity.__currentHeadingDeg ?? track.heading_deg ?? 0));
    const speedMps = speedKts * 0.514444;
    const headingRad = Cesium.Math.toRadians(headingDeg);
    const startTime = performance.now();
    stopFocusedTrackCoast(entity);
    const step = (now) => {
        const elapsedMs = Math.max(0, now - startTime);
        if (
            !isFocusedTrackKey(entity.__trackKey) ||
            elapsedMs >= LIVE_TRACK_FOCUS_COAST_MAX_MS
        ) {
            entity.__liveTrackCoastFrame = null;
            return;
        }
        const distanceMeters = speedMps * (elapsedMs / 1000);
        const northMeters = Math.cos(headingRad) * distanceMeters;
        const eastMeters = Math.sin(headingRad) * distanceMeters;
        const lat = startLat + metersToLatitudeDegrees(northMeters);
        const lon = startLon + metersToLongitudeDegrees(eastMeters, startLat);
        const position = buildTrackEntityCartesian(
            track,
            lon,
            lat,
            Math.max(0, startAlt),
            headingDeg
        );
        if (!position) {
            entity.__liveTrackCoastFrame = null;
            return;
        }
        entity.position = position;
        if (entity.model) {
            entity.orientation = buildTrackOrientation(
                track,
                lon,
                lat,
                startAlt,
                headingDeg,
                Number(entity.__currentPitchDeg || 0),
                Number(entity.__currentRollDeg || 0)
            );
        }
        requestWarzoneRenderBatched();
        entity.__liveTrackCoastFrame = requestAnimationFrame(step);
    };
    entity.__liveTrackCoastFrame = requestAnimationFrame(step);
}
function animateTrackTo(entity, track = {}, nextLon, nextLat, nextAlt = 0, nextSourceTimestamp = Date.now(), nextAttitude = null) {
    if (!entity) return;
    stopFocusedTrackCoast(entity);
    const startCartesian = getPositionCartesian(entity);
    const nextCartesian = buildTrackEntityCartesian(
        track,
        nextLon,
        nextLat,
        nextAlt,
        Number(nextAttitude?.headingDeg ?? track.heading_deg ?? 0)
    );
    const trackKey = entity.__trackKey;
    if (!nextCartesian) return;
    const startHeadingDeg = normalizeDegrees(Number(entity.__currentHeadingDeg ?? track.heading_deg ?? 0));
    const endHeadingDeg = normalizeDegrees(Number(nextAttitude?.headingDeg ?? track.heading_deg ?? startHeadingDeg));
    const headingDeltaDeg = getShortestAngleDeltaDeg(startHeadingDeg, endHeadingDeg);
    const startPitchDeg = Number(entity.__currentPitchDeg || 0);
    const endPitchDeg = Number(nextAttitude?.pitchDeg ?? startPitchDeg);
    const startRollDeg = Number(entity.__currentRollDeg || 0);
    const endRollDeg = Number(nextAttitude?.rollDeg ?? startRollDeg);
    const applyVisualRotation = (lon, lat, alt, headingDeg, pitchDeg, rollDeg) => {
        if (entity.billboard) {
            entity.billboard.rotation = getLiveTrackBillboardRotationRadians(headingDeg);
            entity.billboard.alignedAxis = Cesium.Cartesian3.ZERO;
        }
        if (entity.model) {
            entity.orientation = buildTrackOrientation(track, lon, lat, alt, headingDeg, pitchDeg, rollDeg);
        }
    };
    const commitPosition = (cartesianPosition) => {
        if (entity.__liveTrackAnimFrame) {
            cancelAnimationFrame(entity.__liveTrackAnimFrame);
            entity.__liveTrackAnimFrame = null;
        }
        entity.__liveTrackMotionState = null;
        entity.position = cartesianPosition;
        applyVisualRotation(nextLon, nextLat, nextAlt, endHeadingDeg, endPitchDeg, endRollDeg);
        entity.__currentHeadingDeg = endHeadingDeg;
        entity.__currentPitchDeg = endPitchDeg;
        entity.__currentRollDeg = endRollDeg;
        if (trackKey) {
            pushTrackTrailPointFromCartesian(trackKey, track, cartesianPosition, endHeadingDeg);
            entity.__liveTrackLastTrailSampleAt = performance.now();
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
    const focusAnimConfig = isFocusedTrack ? getLiveTrackFocusAnimConfig() : null;
    const minAnimMs = isFocusedTrack ? focusAnimConfig.minMs : LIVE_TRACK_MIN_ANIM_MS;
    const maxAnimMs = isFocusedTrack ? focusAnimConfig.maxMs : LIVE_TRACK_MAX_ANIM_MS;
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
    if (isMajorLiveTrackCorrection(distanceMeters, sourceGapMs, track)) {
        if (trackKey) {
            __liveTrackTrails.delete(trackKey);
            __liveTrackTrailPositionsCache.delete(trackKey);
        }
        commitPosition(nextCartesian);
        return;
    }
    const cadenceDuration = clamp(
        sourceGapMs * (isFocusedTrack ? focusAnimConfig.cadenceFactor : 0.94),
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
            ? Math.max(cadenceDuration, distanceDuration)
            : Math.max(cadenceDuration, distanceDuration),
        minAnimMs,
        maxAnimMs
    );
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startAlt = startCartographic.height || 0;
    const nextMotionState = {
        startCartesian,
        nextCartesian,
        startHeadingDeg,
        endHeadingDeg,
        headingDeltaDeg,
        startPitchDeg,
        endPitchDeg,
        startRollDeg,
        endRollDeg,
        startLon,
        startLat,
        startAlt,
        nextLon,
        nextLat,
        nextAlt,
        startTime,
        duration,
        isFocusedTrack,
        track,
    };
    if (entity.__liveTrackAnimFrame && entity.__liveTrackMotionState) {
        entity.__liveTrackMotionState = nextMotionState;
        return;
    }
    entity.__liveTrackMotionState = nextMotionState;
    const step = (now) => {
        const motion = entity.__liveTrackMotionState;
        if (!motion) {
            entity.__liveTrackAnimFrame = null;
            return;
        }
        const t = Math.min(1, (now - motion.startTime) / motion.duration);
        const eased = motion.isFocusedTrack
            ? t
            : (t * t * (3 - 2 * t));
        const headingDeg = normalizeDegrees(motion.startHeadingDeg + (motion.headingDeltaDeg * eased));
        const pitchDeg = motion.startPitchDeg + ((motion.endPitchDeg - motion.startPitchDeg) * eased);
        const rollDeg = motion.startRollDeg + ((motion.endRollDeg - motion.startRollDeg) * eased);
        let lon = motion.startLon + (motion.nextLon - motion.startLon) * eased;
        let lat = motion.startLat + (motion.nextLat - motion.startLat) * eased;
        let alt = motion.startAlt + (motion.nextAlt - motion.startAlt) * eased;
        let currentCartesian = null;
        if (motion.isFocusedTrack) {
            currentCartesian = Cesium.Cartesian3.lerp(
                motion.startCartesian,
                motion.nextCartesian,
                eased,
                new Cesium.Cartesian3()
            );
            const currentCartographic = Cesium.Cartographic.fromCartesian(currentCartesian);
            if (currentCartographic) {
                lon = Cesium.Math.toDegrees(currentCartographic.longitude);
                lat = Cesium.Math.toDegrees(currentCartographic.latitude);
                alt = currentCartographic.height || 0;
            }
        } else {
            currentCartesian = buildTrackEntityCartesian(motion.track, lon, lat, alt, headingDeg);
        }
        if (!currentCartesian) {
            entity.__liveTrackAnimFrame = null;
            return;
        }
        entity.position = currentCartesian;
        if (entity.billboard) {
            entity.billboard.rotation = getLiveTrackBillboardRotationRadians(headingDeg);
            entity.billboard.alignedAxis = Cesium.Cartesian3.ZERO;
        }
        if (entity.model) {
            entity.orientation = buildTrackOrientation(motion.track, lon, lat, alt, headingDeg, pitchDeg, rollDeg);
        }
        entity.__currentHeadingDeg = headingDeg;
        entity.__currentPitchDeg = pitchDeg;
        entity.__currentRollDeg = rollDeg;
        const shouldSampleTrail =
            t >= 1 ||
            (!motion.isFocusedTrack && (
                !Number.isFinite(Number(entity.__liveTrackLastTrailSampleAt)) ||
                (now - Number(entity.__liveTrackLastTrailSampleAt || 0)) >= LIVE_TRACK_ANIM_TRAIL_SAMPLE_MS
            ));
        if (trackKey && shouldSampleTrail) {
            pushTrackTrailPointFromCartesian(trackKey, motion.track, currentCartesian, headingDeg);
            entity.__liveTrackLastTrailSampleAt = now;
        }
        requestWarzoneRenderBatched();
        if (t < 1) {
            entity.__liveTrackAnimFrame = requestAnimationFrame(step);
        } else {
            entity.__liveTrackAnimFrame = null;
            entity.__liveTrackMotionState = null;
            entity.__currentHeadingDeg = motion.endHeadingDeg;
            entity.__currentPitchDeg = motion.endPitchDeg;
            entity.__currentRollDeg = motion.endRollDeg;
            maybeStartFocusedTrackCoast(entity, motion.track);
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
    const headingDeg = normalizeDegrees(
        Cesium.Math.toDegrees(
            Math.atan2(
                -directionSign * Math.sin(orbitAngleRad),
                directionSign * Math.cos(orbitAngleRad)
            )
        )
    );
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
    const point = interpolateRoutePoint(from, to, localT);
    point.heading_deg = getHeadingDegreesFromPoints(from.lon, from.lat, to.lon, to.lat);
    return point;
}
/* ================= PUBLIC API ================= */
function resolveLiveTrackModelCode(track = {}) {
    const metadata = getTrackMetadata(track);
    const explicitCode = String(
        track.asset_key ||
        metadata.asset_key ||
        track.model_code ||
        track.asset_suffix ||
        metadata.model_code ||
        metadata.asset_suffix ||
        ""
    ).trim();
    const explicitAssetKey = normalizeAircraftAssetKey(explicitCode);
    if (explicitAssetKey) {
        return explicitAssetKey;
    }

    const overrideCode = resolveAircraftAssetSuffixOverride(track);
    const overrideAssetKey = normalizeAircraftAssetKey(overrideCode);
    if (overrideAssetKey) {
        return overrideAssetKey;
    }

    const forcedModelCode = resolveForcedAircraftModelCode(track);
    const forcedAssetKey = normalizeAircraftAssetKey(forcedModelCode);
    if (forcedAssetKey) {
        return forcedAssetKey;
    }
    const iconCode = resolveLiveAircraftIconCode(track);
    const iconAssetKey = normalizeAircraftAssetKey(iconCode);
    if (iconAssetKey) {
        return iconAssetKey;
    }
    const subtype = resolveTrackSubtype(track)
        .trim()
        .toLowerCase();
    const subtypeCode = LIVE_AIRCRAFT_MODEL_CODE_BY_SUBTYPE[subtype] || LIVE_AIRCRAFT_MODEL_DEFAULT_CODE;
    return normalizeAircraftAssetKey(subtypeCode) || LIVE_AIRCRAFT_MODEL_DEFAULT_CODE;
}
function resolveLiveTrackModelUri(track = {}) {
    const modelCode = resolveLiveTrackModelCode(track);
    const asset = getAircraftAssetFile(modelCode);
    return asset?.model ? `${LIVE_AIRCRAFT_MODEL_BASE_PATH}/${asset.model}` : "";
}
export function upsertLiveTrack(track) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;
    const viewer = window.__warzoneViewer;
    const originalTrackKey = String(track?.track_key || "").trim();
    if (!isLayerEnabled("aircraft")) {
        if (originalTrackKey) clearLiveTrack(originalTrackKey);
        return;
    }
    if (String(resolveTrackSubtype(track) || "").trim().toLowerCase() === "trainer") {
        clearLiveTrack(originalTrackKey);
        return;
    }
    const duplicateTrackKey = findDuplicateLiveTrackKey(track);
    if (duplicateTrackKey && duplicateTrackKey !== originalTrackKey) {
        track = {
            ...track,
            track_key: duplicateTrackKey,
        };
        if (originalTrackKey) {
            const duplicateEntity = viewer?.entities?.getById?.(`track-${originalTrackKey}`);
            if (duplicateEntity || __liveTrackRegistry.has(originalTrackKey)) {
                clearLiveTrack(originalTrackKey);
            }
        }
    }

    bindLiveTrackOverlay(viewer);
    bindLiveTrackPicking(viewer);

    const id = `track-${track.track_key}`;
    const style = getLiveTrackStyleConfig(track);
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

    let entity = viewer.entities.getById(id);
    const telemetryUpdate = classifyLiveTrackTelemetryUpdate(entity, track, sourceTimestamp);
    if (telemetryUpdate === "stale") {
        return;
    }
    if (telemetryUpdate === "insignificant") {
        refreshLiveTrackLiveness(entity, track, sourceTimestamp);
        return;
    }

    const resolvedHeadingDeg = getTrackResolvedHeading(track);
    const attitude = getTrackAttitude(track, resolvedHeadingDeg);
    const renderMode = resolveAircraftRenderMode(track, modelUri);
    const point = renderMode === LIVE_TRACK_RENDER_MODE.POINT
        ? buildLiveTrackPoint(track)
        : null;
    const billboard = renderMode === LIVE_TRACK_RENDER_MODE.MODEL || point
        ? null
        : buildLiveTrackBillboard(track, attitude.headingDeg, renderMode);
    if (!entity) {
        const entitySpec = {
            id,
            position: buildTrackEntityCartesian(track, lon, lat, alt, attitude.headingDeg),
            label: buildTrackLabel(track, track.track_key)
        };
        if (!entitySpec.position) return;
        if (point) {
            entitySpec.point = point;
        } else if (billboard) {
            entitySpec.billboard = billboard;
        } else {
            entitySpec.model = buildLiveTrackModelGraphics(
                modelUri,
                subtypeScale,
                subtypeMinPixelSize,
                subtypeMaxScale,
                track
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
        entity.__currentPitchDeg = attitude.pitchDeg;
        entity.__currentRollDeg = attitude.rollDeg;
        entity.__lastSourceTimestamp = sourceTimestamp;
        entity.__lastReportedHeadingDeg = Number(track.heading_deg || attitude.headingDeg || 0);
        entity.__lastReportedSpeedKts = Number(track.speed_kts ?? track.ground_speed_kts ?? 0);
        __liveTrackEntities.set(id, entity);
    } else {
        entity.__trackKey = track.track_key;
        entity.__trackPickable = true;
        entity.__renderMode = renderMode;
        const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
        const trackKey = String(track.track_key || "");
        const shouldAnimateTrack =
            !LIVE_TRACK_ANIMATE_ONLY_SELECTED ||
            !selectedTrackKey ||
            selectedTrackKey === trackKey ||
            shouldShowTrackInFocusMode(trackKey, track);
        if (shouldAnimateTrack) {
            animateTrackTo(entity, track, lon, lat, alt, sourceTimestamp, attitude);
        } else {
            if (entity.__liveTrackAnimFrame) {
                cancelAnimationFrame(entity.__liveTrackAnimFrame);
                entity.__liveTrackAnimFrame = null;
            }
            entity.__liveTrackMotionState = null;
            const nextCartesian = buildTrackEntityCartesian(track, lon, lat, alt, attitude.headingDeg);
            if (!nextCartesian) return;
            entity.position = nextCartesian;
            pushTrackTrailPointFromCartesian(track.track_key, track, nextCartesian, attitude.headingDeg);
            entity.__currentHeadingDeg = attitude.headingDeg;
            entity.__currentPitchDeg = attitude.pitchDeg;
            entity.__currentRollDeg = attitude.rollDeg;
        }
        entity.__lastSourceTimestamp = sourceTimestamp;
        entity.__lastReportedHeadingDeg = Number(track.heading_deg || attitude.headingDeg || 0);
        entity.__lastReportedSpeedKts = Number(track.speed_kts ?? track.ground_speed_kts ?? 0);
        if (point) {
            applyLiveTrackPoint(entity, point);
        } else if (billboard) {
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

    if (!entity.point && !entity.billboard && !entity.model) {
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
    if (isFocusSelectionActive() && String(track.track_key || "") === getFocusedTrackKey()) {
        refreshFocusedTrackIsolation();
    } else {
        applyLiveTrackFocusVisibility(track.track_key);
    }
    __liveTrackLastPositions.set(track.track_key, {
        lon,
        lat,
        altitude_ft: resolvedAltitudeFt,
    });
    wakeLiveTrackRenderAfterAssetUpdate();
}

export function clearLiveTrack(trackKey) {
    const viewer = window.__warzoneViewer;

    if (!trackKey) return;
    const entityId = `track-${trackKey}`;
    const trailId = `track-trail-${trackKey}`;
    const existingRegistryEntry = __liveTrackRegistry.get(trackKey);
    const selectedFocus =
        __liveTrackReplayState.selectedTrackKey === trackKey &&
        __liveTrackReplayState.mode === "focus";
    if (selectedFocus) {
        const focusedEntity = viewer?.entities?.getById?.(entityId);
        if (existingRegistryEntry) {
            existingRegistryEntry.active = false;
            existingRegistryEntry.ended_at = Date.now();
            existingRegistryEntry.path_history = pruneHistoryPoints(existingRegistryEntry.path_history || []);
        }
        if (focusedEntity) {
            if (focusedEntity.__liveTrackAnimFrame) {
                cancelAnimationFrame(focusedEntity.__liveTrackAnimFrame);
                focusedEntity.__liveTrackAnimFrame = null;
            }
            focusedEntity.__liveTrackMotionState = null;
            maybeStartFocusedTrackCoast(focusedEntity, existingRegistryEntry || {});
        }
        dispatchLiveTrackRegistryUpdate();
        requestWarzoneRenderBatched();
        return;
    }
    if (viewer) {
        const entity = viewer.entities.getById(entityId);
        if (entity) {
            stopFocusedTrackCoast(entity);
            if (entity.__liveTrackAnimFrame) {
                cancelAnimationFrame(entity.__liveTrackAnimFrame);
                entity.__liveTrackAnimFrame = null;
            }
            entity.__liveTrackMotionState = null;
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
    if (existingRegistryEntry) {
        existingRegistryEntry.active = false;
        existingRegistryEntry.ended_at = Date.now();
        existingRegistryEntry.entity_id = "";
        existingRegistryEntry.path_history = pruneHistoryPoints(existingRegistryEntry.path_history || []);
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

    __devTrackTimers.forEach((timer) => clearInterval(timer));
    __devTrackTimers.clear();

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
            stopFocusedTrackCoast(entity);
            if (
                entityId.startsWith("track-") ||
                entityId.startsWith("track-trail-") ||
                entityId.startsWith("track-replay-route-") ||
                entityId.startsWith("track-replay-marker-") ||
                entityId.startsWith("track-focus-route-") ||
                entityId.startsWith("track-focus-start-")
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
    __liveTrackOriginHoverEntity = null;
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
function refreshLiveTrackVisualMode(trackKey = "") {
    const safeTrackKey = String(trackKey || "");
    if (!safeTrackKey) return;
    const entry = __liveTrackRegistry.get(safeTrackKey);
    if (!entry?.active) return;
    upsertLiveTrack({
        ...entry,
        track_key: safeTrackKey,
        timestamp: Date.now(),
    });
}
function refreshLiveTrackTrailRenderVisibility(trackKey = "", track = {}) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !trackKey) return;
    const shouldRender = shouldRenderLiveTrackTrail(trackKey, track);
    if (shouldRender) {
        getOrCreateTrackTrailEntity(viewer, trackKey, track);
        return;
    }
    const trailEntity = viewer.entities?.getById?.(`track-trail-${trackKey}`);
    if (trailEntity?.polyline) {
        trailEntity.polyline.show = false;
    }
}
function refreshLiveTrackViewDependentVisuals() {
    const viewer = window.__warzoneViewer;
    if (!viewer) return;
    const entities = Array.from(__liveTrackEntities.values());
    const seq = ++__liveTrackViewRefreshSeq;
    const chunkSize = 24;
    if (__liveTrackViewRefreshRaf) {
        cancelAnimationFrame(__liveTrackViewRefreshRaf);
        __liveTrackViewRefreshRaf = 0;
    }
    const processChunk = (startIndex = 0) => {
        if (seq !== __liveTrackViewRefreshSeq) return;
        const endIndex = Math.min(entities.length, startIndex + chunkSize);
        for (let index = startIndex; index < endIndex; index += 1) {
            const entity = entities[index];
            refreshLiveTrackViewDependentEntity(entity);
        }
        if (endIndex < entities.length) {
            __liveTrackViewRefreshRaf = requestAnimationFrame(() => {
                __liveTrackViewRefreshRaf = 0;
                processChunk(endIndex);
            });
            return;
        }
        requestWarzoneRenderBatched();
    };
    __liveTrackViewRefreshRaf = requestAnimationFrame(() => {
        __liveTrackViewRefreshRaf = 0;
        processChunk(0);
    });
}
function refreshLiveTrackViewDependentEntity(entity) {
    if (!entity?.__trackKey) return;
    const track = __liveTrackRegistry.get(entity.__trackKey);
    if (!track?.active) return;
    if (entity.point) {
        applyLiveTrackPoint(entity, buildLiveTrackPoint(track));
    }
    if (entity.billboard) {
        const mode = entity.__renderMode === LIVE_TRACK_RENDER_MODE.CHAR
            ? LIVE_TRACK_RENDER_MODE.CHAR
            : LIVE_TRACK_RENDER_MODE.PNG;
        const headingDeg = Number(entity.__currentHeadingDeg || track.heading_deg || 0);
        const nextBillboard = buildLiveTrackBillboard(track, headingDeg, mode);
        if (nextBillboard) applyLiveTrackBillboard(entity, nextBillboard);
    }
    if (entity.model) {
        applyLiveTrackModelSizing(entity, track);
        applyLiveGlbModelQuality(entity.model, track);
    }
    if (entity.label) {
        applyTrackLabel(entity.label, track, entity.__trackKey);
    }
    refreshLiveTrackTrailRenderVisibility(entity.__trackKey, track);
}
function refreshAllLiveTrackVisualModes() {
    __liveTrackRegistry.forEach((entry, trackKey) => {
        if (!entry?.active) return;
        refreshLiveTrackVisualMode(trackKey);
    });
}
function scheduleRefreshAllLiveTrackVisualModes(delayMs = 0) {
    if (__liveTrackVisualModeRefreshTimer) {
        clearTimeout(__liveTrackVisualModeRefreshTimer);
        __liveTrackVisualModeRefreshTimer = 0;
    }
    if (__liveTrackVisualModeRefreshRaf) {
        cancelAnimationFrame(__liveTrackVisualModeRefreshRaf);
        __liveTrackVisualModeRefreshRaf = 0;
    }
    __liveTrackVisualModeRefreshTimer = window.setTimeout(() => {
        __liveTrackVisualModeRefreshTimer = 0;
        const keys = [];
        __liveTrackRegistry.forEach((entry, trackKey) => {
            if (entry?.active && trackKey) keys.push(trackKey);
        });
        let index = 0;
        const step = () => {
            __liveTrackVisualModeRefreshRaf = 0;
            const end = Math.min(keys.length, index + 10);
            for (; index < end; index += 1) {
                refreshLiveTrackVisualMode(keys[index]);
            }
            if (index < keys.length) {
                __liveTrackVisualModeRefreshRaf = requestAnimationFrame(step);
            }
        };
        __liveTrackVisualModeRefreshRaf = requestAnimationFrame(step);
    }, Math.max(0, Number(delayMs) || 0));
}
export function focusLiveTrack(trackKey, options = {}) {
    const viewer = window.__warzoneViewer;

    if (!viewer || !trackKey) return false;
    clearReplayEntities();
    const entity = viewer.entities.getById(`track-${trackKey}`);
    const targetPosition = getPositionCartesian(entity);
    if (!entity || !targetPosition) {
        if (!options.__entityRecoveryAttempted) {
            try {
                window.__warzoneRequestFastForegroundAircraftRecovery?.({
                    forceRefresh: true,
                    forcePublicRefresh: true,
                });
            } catch {
                // ignore foreground recovery failures here; a second focus click can still retry
            }
            if (__liveTrackFocusEntityRetryTimer) {
                clearTimeout(__liveTrackFocusEntityRetryTimer);
                __liveTrackFocusEntityRetryTimer = 0;
            }
            __liveTrackFocusEntityRetryTimer = window.setTimeout(() => {
                __liveTrackFocusEntityRetryTimer = 0;
                focusLiveTrack(trackKey, {
                    ...options,
                    __entityRecoveryAttempted: true,
                });
            }, 220);
            return true;
        }
        return false;
    }
    if (__liveTrackFocusEntityRetryTimer) {
        clearTimeout(__liveTrackFocusEntityRetryTimer);
        __liveTrackFocusEntityRetryTimer = 0;
    }
    __liveTrackSceneModeBeforeFocus = getViewerSceneModeLabel(viewer);
    const configuredFocusRange = getLiveTrackFocusCameraRangeMeters();
    const focusRange = Math.max(
        configuredFocusRange,
        Number(options.cameraHeight || 0)
    );
    __liveTrackFocusRangeMeters = clamp(
        focusRange,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS,
        LIVE_TRACK_FOCUS_CAMERA_RANGE_MAX_METERS
    );
    __liveTrackFocusBaseRangeMeters = __liveTrackFocusRangeMeters;
    __liveTrackManualCameraIntent = false;
    __liveTrackUserCameraInteracting = false;
    __liveTrackLastFocusCameraSyncAt = 0;
    if (__liveTrackFocusResumeTimer) {
        clearTimeout(__liveTrackFocusResumeTimer);
        __liveTrackFocusResumeTimer = null;
    }
    resetFocusedTrackCameraOrientation();
    setSelectedTrack(trackKey, "focus");
    syncFocusedRouteEntity(trackKey);
    viewer.__warzone?.setSatelliteVisible?.(true);
    viewer.__warzone?.setGreyedSatelliteVisible?.(false);
    viewer.__warzone?.setContourGridVisible?.(false);
    void Promise.resolve(viewer.__warzone?.setContourLayerVisible?.(false))
        .finally(() => syncFocusedTrackOverlayModeButtons());
    disableAircraftFocusTerrain(viewer);
    syncFocusedTrackContourMode(true);
    refreshLiveTrackVisualMode(trackKey);
    refreshFocusedContextLiveTrackVisualModes(trackKey);
    setLiveTrackHardLockInternal(true);
    bindFocusGuideTracking();
    updateFocusGuideElement();
    const offset = new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(__liveTrackFocusHeadingDeg),
        Cesium.Math.toRadians(__liveTrackFocusPitchDeg),
        focusRange
    );
    const startFocusFlight = () => {
        viewer.camera.cancelFlight?.();
        __liveTrackIsCameraFlying = true;
        const finishFocusFlight = () => {
            __liveTrackIsCameraFlying = false;
            syncFocusedTrackCamera();
        };
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(targetPosition, 1), {
            duration: Number(options.duration || 1.5),
            offset,
            complete: finishFocusFlight,
            cancel: finishFocusFlight,
        });
    };
    startFocusFlight();
    return true;
}
export function clearLiveTrackSelection(options = {}) {
    const viewer = window.__warzoneViewer;
    const previousTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    const previousSelectionMode = String(__liveTrackReplayState.mode || "");
    const restoreSceneMode = previousSelectionMode === "focus" ? __liveTrackSceneModeBeforeFocus : "";
    const previousEntity = previousTrackKey && viewer
        ? viewer.entities.getById(`track-${previousTrackKey}`)
        : null;
    if (previousEntity) {
        stopFocusedTrackCoast(previousEntity);
    }
    if (viewer) {
        viewer.camera.cancelFlight?.();
        cancelAircraftFocusTerrainDisable();
    }
    __liveTrackIsCameraFlying = false;
    __liveTrackUserCameraInteracting = false;
    __liveTrackLastFocusCameraSyncAt = 0;
    if (__liveTrackFocusResumeTimer) {
        clearTimeout(__liveTrackFocusResumeTimer);
        __liveTrackFocusResumeTimer = null;
    }
    if (__liveTrackFocusEntityRetryTimer) {
        clearTimeout(__liveTrackFocusEntityRetryTimer);
        __liveTrackFocusEntityRetryTimer = 0;
    }
    setLiveTrackHardLockInternal(false);
    closeFocusDriftWarningModal();
    __liveTrackFocusWarningActive = false;
    __liveTrackManualCameraIntent = false;
    __liveTrackFocusRangeMeters = getLiveTrackFocusCameraRangeMeters();
    __liveTrackFocusBaseRangeMeters = __liveTrackFocusRangeMeters;
    resetFocusedTrackCameraOrientation();
    clearReplayEntities();
    setSelectedTrack("", "");
    syncFocusedTrackContourMode(false);
    refreshLiveTrackVisualMode(previousTrackKey);
    scheduleRefreshAllLiveTrackVisualModes(80);
    clearFocusedTrackCameraLock();
    hideLiveTrackFocusVisuals();
    const restoreSceneModeIfNeeded = () => {
        if (restoreSceneMode === "2d" && viewer) {
            morphViewerSceneMode(viewer, "2d", {
                duration: Number(options?.sceneDuration || 0.95),
            });
        }
        if (viewer && options?.restoreTerrain === true) {
            scheduleAircraftFocusTerrainDisable(viewer, 350);
        }
        __liveTrackSceneModeBeforeFocus = "";
    };
    const shouldFlyOutFromFocus = previousSelectionMode === "focus" &&
        options?.resetCamera !== false &&
        options?.resetToRegion !== true;
    if (options?.focusFlyOut === true || shouldFlyOutFromFocus) {
        const didFlyOut = flyOutFromFocusedAircraft(previousTrackKey, {
            duration: Number(options?.duration || 1.15),
            onComplete: restoreSceneModeIfNeeded,
        });
        if (!didFlyOut) {
            resetCameraToActiveRegion({ duration: Number(options?.duration || 1.2) });
            window.setTimeout(restoreSceneModeIfNeeded, Math.max(900, Math.round(Number(options?.duration || 1.2) * 1000) + 120));
        }
    } else if (options?.resetCamera !== false) {
        resetCameraToActiveRegion({ duration: Number(options?.duration || 1.2) });
        window.setTimeout(restoreSceneModeIfNeeded, Math.max(900, Math.round(Number(options?.duration || 1.2) * 1000) + 120));
    } else {
        restoreSceneModeIfNeeded();
    }
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
function refreshLiveTrackEntityVisualStyle(entity) {
    if (!entity?.__trackKey) return false;
    const track = __liveTrackRegistry.get(entity.__trackKey);
    if (entity.label && track) {
        applyTrackLabel(entity.label, track, entity.__trackKey);
    }
    if (entity.model) {
        if (track) applyLiveTrackModelSizing(entity, track);
        applyLiveGlbModelQuality(entity.model, track);
        if (track) {
            const position = getPositionCartesian(entity);
            const cartographic = position ? Cesium.Cartographic.fromCartesian(position) : null;
            if (cartographic) {
                entity.orientation = buildTrackOrientation(
                    track,
                    Cesium.Math.toDegrees(cartographic.longitude),
                    Cesium.Math.toDegrees(cartographic.latitude),
                    Number(cartographic.height || 0),
                    Number(entity.__currentHeadingDeg || track.heading_deg || 0),
                    Number(entity.__currentPitchDeg || 0),
                    Number(entity.__currentRollDeg || 0)
                );
            }
        }
    }
    return true;
}
export function refreshLiveTrackVisualStyles() {
    __liveTrackEntities.forEach((entity) => {
        refreshLiveTrackEntityVisualStyle(entity);
    });
    requestWarzoneRenderBatched();
}
export function refreshFocusedLiveTrackVisualStyles() {
    const selectedTrackKey = String(__liveTrackReplayState.selectedTrackKey || "");
    if (!selectedTrackKey || String(__liveTrackReplayState.mode || "") !== "focus") {
        refreshLiveTrackVisualStyles();
        return false;
    }
    const viewer = window.__warzoneViewer;
    const entity = viewer?.entities?.getById?.(`track-${selectedTrackKey}`);
    if (!refreshLiveTrackEntityVisualStyle(entity)) {
        refreshLiveTrackVisualStyles();
        return false;
    }
    requestWarzoneRenderBatched();
    return true;
}
export function refreshLiveTrackFocusCamera(options = {}) {
    if (!isFocusSelectionActive() || !__liveTrackHardLockEnabled) return false;
    const resetRange = options?.resetRange === true;
    const resetPitch = options?.resetPitch === true;
    if (resetRange) {
        __liveTrackFocusBaseRangeMeters = getLiveTrackFocusCameraRangeMeters();
        __liveTrackFocusRangeMeters = __liveTrackFocusBaseRangeMeters;
    } else {
        const bounds = getFocusedTrackRangeBounds();
        __liveTrackFocusRangeMeters = clamp(
            Number(__liveTrackFocusRangeMeters || __liveTrackFocusBaseRangeMeters || getLiveTrackFocusCameraRangeMeters()),
            bounds.min,
            bounds.max
        );
    }
    if (resetPitch) {
        __liveTrackFocusPitchDeg = getLiveTrackFocusCameraPitchDeg();
    }
    __liveTrackLastFocusCameraSyncAt = 0;
    syncFocusedTrackCamera({ preserveRange: true });
    requestWarzoneRenderBatched();
    return true;
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
    asset_key = "",
    model_code = "",
    render_mode = "",
    model_render_mode = "",
    metadata = null,
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
    const visualOverrides = {
        ...(asset_key ? { asset_key } : {}),
        ...(model_code ? { model_code } : {}),
        ...(render_mode ? { render_mode } : {}),
        ...(model_render_mode ? { model_render_mode } : {}),
        ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { metadata } : {}),
    };
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
        ...visualOverrides,
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
            heading_deg: point.heading_deg || 0,
            status: "active",
            ...visualOverrides,
        });
        if (!loop && t >= 1) {
            stopDevTrackSimulation(track_key);
        }
    }, intervalMs);
    __devTrackTimers.set(track_key, timer);
}
window.__setAircraftModelCalibrationEnabled = setAircraftModelCalibrationEnabled;
