// File Path: /assets/js/warzone-live-fighter.js
import * as Cesium from "cesium";
/* ================= STATE ================= */
let __liveTrackEntities = new Map();
const __devTrackTimers = new Map();
const __liveTrackTrails = new Map();
const __liveTrackLastPositions = new Map();
const __liveTrackVisualState = new Map();
const __liveTrackRegistry = new Map();
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


const LIVE_TRACK_LABEL_CAMERA_HEIGHT_MAX = 420000;

const LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX = 850000;
const LIVE_TRACK_FOCUS_GUIDE_COLOR = "rgba(24, 226, 219, 0.72)";
const LIVE_TRACK_FOCUS_GUIDE_LENGTH_PX = 92;
const LIVE_TRACK_FOCUS_GUIDE_GAP_PX = 42;
const LIVE_TRACK_FOCUS_GUIDE_THICKNESS_PX = 4;
let __liveTrackFocusGuideEl = null;


/* ================= CONFIG ================= */
const LIVE_TRACK_MODEL_OFFSETS = {
    fighter: -90,
    awacs: -140,
    recon: -90,
    drone: -90,
    tanker: -90,
    transport: -90,
};
const LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS = 800;
const LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE = {
    fighter: 650,
    awacs: 1200,
    recon: 400,
    drone: 300,
};
const LIVE_TRACK_ENGINE_OFFSET_METERS = 120;
const LIVE_TRACK_MAX_TRAIL_POINTS = 160;
const LIVE_TRACK_TRAIL_MAX_AGE_MS = 18 * 60 * 1000;
const LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS = 240;
const LIVE_TRACK_MIN_ANIM_DISTANCE_METERS = 60;
const LIVE_TRACK_MIN_ANIM_MS = 140;
const LIVE_TRACK_MAX_ANIM_MS = 520;
const LIVE_TRACK_HISTORY_RETENTION_MS = 72 * 60 * 60 * 1000;
const LIVE_TRACK_HISTORY_MAX_POINTS = 720;
const LIVE_TRACK_REPLAY_STEP_MS = 180;
const LIVE_TRACK_MODEL_URI = "/assets/images/models/air/fighter-1.glb";
const LIVE_TRACK_MODEL_BY_SUBTYPE = {
    fighter: "/assets/images/models/air/fighter.glb",
    awacs: "/assets/images/models/air/awacs.glb",
    recon: "/assets/images/models/air/uav.glb",
    isr: "/assets/images/models/air/awacs.glb",
    tanker: "/assets/images/models/air/fighter-1.glb",
    refueler: "/assets/images/models/air/fighter-1.glb",
    transport: "/assets/images/models/air/fighter-1.glb",
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
    const subtype = String(track.subcategory || track.subtype || "")
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackScale;
    return getCssNumber(`--warzone-live-track-scale-${subtype}`, fallbackScale);
}
function getLiveTrackSubtypeMinPixelSize(track = {}, fallbackValue = 140) {
    const subtype = String(track.subcategory || track.subtype || "")
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackValue;
    return getCssNumber(`--warzone-live-track-min-pixel-size-${subtype}`, fallbackValue);
}
function getLiveTrackSubtypeMaxScale(track = {}, fallbackValue = 520) {
    const subtype = String(track.subcategory || track.subtype || "")
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackValue;
    return getCssNumber(`--warzone-live-track-max-scale-${subtype}`, fallbackValue);
}
function getLiveTrackSubtypeTrailEnabled(track = {}) {
    const subtype = String(track.subcategory || track.subtype || "")
        .trim()
        .toLowerCase();
    if (!subtype) return true;
    return getCssNumber(`--warzone-live-track-trail-enabled-${subtype}`, 1) !== 0;
}
function getLiveTrackSubtypeTrailWidth(track = {}, fallbackWidth = 3.4) {
    const subtype = String(track.subcategory || track.subtype || "")
        .trim()
        .toLowerCase();
    if (!subtype) return fallbackWidth;
    return getCssNumber(`--warzone-live-track-trail-width-${subtype}`, fallbackWidth);
}
/* ================= UTILS ================= */
function requestWarzoneRender() {
    window.__warzoneViewer?.scene?.requestRender?.();
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
    if (key === "awacs") return "AWACS";
    if (key === "isr") return "ISR";
    if (key === "uav") return "UAV";
    if (!key) return "Aircraft";
    return key.charAt(0).toUpperCase() + key.slice(1);
}
function getTrackDisplayTitle(track = {}) {
    const primary = sanitizeTrackText(
        track.title ||
        track.callsign ||
        track.flight ||
        track.name ||
        ""
    );
    if (isTrackTextUsable(primary)) {
        return primary;
    }
    const subtype = formatTrackSubtypeLabel(track.subcategory || track.subtype || "aircraft");
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
    return {
        text: getTrackDisplayTitle(track),
        show: new Cesium.CallbackProperty(() => shouldShowTrackLabel(trackKey), false),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 220000),
        scale: 0.56,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        fillColor: Cesium.Color.WHITE.withAlpha(0.96),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.6),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
        outlineWidth: 0,
        style: Cesium.LabelStyle.FILL,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
}

function getViewerContainerElement() {
    const viewer = window.__warzoneViewer;

    const container = viewer?.container || document.getElementById("cesiumContainer");
    return container || null;
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

function buildLiveTrackRegistryEntry(track = {}, entity = null) {
    const subtype = String(track.subcategory || track.subtype || "unknown").trim().toLowerCase();
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
        title: getTrackDisplayTitle(track),
        subcategory: subtype,
        country: String(track.country || track.operator_country || track.metadata?.country || "Unknown"),
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
    document.dispatchEvent(new CustomEvent("wz:aircraft-log-updated"));
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
function bindLiveTrackOverlay(viewer) {
    if (!viewer || __liveTrackOverlayBound) return;
    __liveTrackOverlayBound = true;
    ensureLiveTrackOverlayRoot(viewer);
    viewer.scene.postRender.addEventListener(syncLiveTrackFocusOverlay);
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
        const picked = viewer.scene.pick(movement.position);
        const trackKey = resolvePickedTrackKey(picked);
        if (!trackKey) return;
        toggleLiveTrackSelection(trackKey);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
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
function setSelectedTrack(trackKey = "", mode = "") {
    __liveTrackReplayState.selectedTrackKey = trackKey || "";
    __liveTrackReplayState.mode = mode || "";
    document.dispatchEvent(new CustomEvent("wz:aircraft-track-selected", {
        detail: {
            trackKey: __liveTrackReplayState.selectedTrackKey,
            mode: __liveTrackReplayState.mode,
        },
    }));
    syncLiveTrackFocusOverlay();
    dispatchLiveTrackRegistryUpdate();
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
    return LIVE_TRACK_TAIL_OFFSET_BY_SUBTYPE[subtype] ?? 650;
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
function pushTrackTrailPoint(trackKey, track = {}, lon, lat, alt, courseHeadingDeg = 0) {
    if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        !Number.isFinite(alt)
    ) {
        return;
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
    const newPosition = Cesium.Cartesian3.fromDegrees(engineLon, engineLat, alt);
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
function animateTrackTo(entity, track = {}, nextLon, nextLat, nextAlt = 0) {
    if (!entity) return;
    if (entity.__liveTrackAnimFrame) {
        cancelAnimationFrame(entity.__liveTrackAnimFrame);
        entity.__liveTrackAnimFrame = null;
    }
    const startCartesian = getPositionCartesian(entity);
    const nextCartesian = Cesium.Cartesian3.fromDegrees(nextLon, nextLat, nextAlt);
    if (!startCartesian) {
        entity.position = nextCartesian;
        requestWarzoneRender();
        return;
    }
    const distanceMeters = getCartesianDistanceMeters(startCartesian, nextCartesian);
    if (distanceMeters <= LIVE_TRACK_MIN_ANIM_DISTANCE_METERS) {
        entity.position = nextCartesian;
        requestWarzoneRender();
        return;
    }
    const duration = clamp(distanceMeters * 0.08, LIVE_TRACK_MIN_ANIM_MS, LIVE_TRACK_MAX_ANIM_MS);
    const startTime = performance.now();
    const startCartographic = Cesium.Cartographic.fromCartesian(startCartesian);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startAlt = startCartographic.height || 0;
    const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const lon = startLon + (nextLon - startLon) * eased;
        const lat = startLat + (nextLat - startLat) * eased;
        const alt = startAlt + (nextAlt - startAlt) * eased;
        const currentCartesian = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
        entity.position = currentCartesian;
        const trackKey = entity.__trackKey;
        const headingDeg = entity.__currentHeadingDeg ?? 0;
        if (trackKey) {
            pushTrackTrailPointFromCartesian(trackKey, track, currentCartesian, headingDeg);
        }
        requestWarzoneRender();
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
    const subtype = String(track.subcategory || track.subtype || "")
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
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const resolvedHeadingDeg = getTrackResolvedHeading(track);
    const attitude = getTrackAttitude(track, resolvedHeadingDeg);
    let entity = viewer.entities.getById(id);

    if (!entity) {
        entity = viewer.entities.add({
            id,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            model: {
                uri: modelUri,
                scale: subtypeScale,
                minimumPixelSize: subtypeMinPixelSize,
                maximumScale: subtypeMaxScale,
                color: undefined,
                colorBlendMode: Cesium.ColorBlendMode.HIGHLIGHT,
                colorBlendAmount: 0,
            },
            orientation: buildTrackOrientation(
                track,
                lon,
                lat,
                alt,
                attitude.headingDeg,
                attitude.pitchDeg,
                attitude.rollDeg
            ),
            label: buildTrackLabel(track, track.track_key)
        });
        entity.__trackKey = track.track_key;
        entity.__trackPickable = true;
        entity.__currentHeadingDeg = attitude.headingDeg;
        __liveTrackEntities.set(id, entity);
    } else {
        entity.__trackKey = track.track_key;
        entity.__trackPickable = true;
        entity.__currentHeadingDeg = attitude.headingDeg;
        animateTrackTo(entity, track, lon, lat, alt);
        entity.orientation = buildTrackOrientation(
            track,
            lon,
            lat,
            alt,
            attitude.headingDeg,
            attitude.pitchDeg,
            attitude.rollDeg
        );
        if (entity.model) {
            entity.model.uri = modelUri;
            entity.model.scale = subtypeScale;
            entity.model.minimumPixelSize = subtypeMinPixelSize;
            entity.model.maximumScale = subtypeMaxScale;
            entity.model.color = Cesium.Color.WHITE;
            entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
            entity.model.colorBlendAmount = 0.15;
        }
        if (entity.label) {
            entity.label.text = getTrackDisplayTitle(track);
            entity.label.show = new Cesium.CallbackProperty(() => shouldShowTrackLabel(track.track_key), false);
            entity.label.distanceDisplayCondition = new Cesium.DistanceDisplayCondition(0, 220000);
            entity.label.scale = 0.56;
            entity.label.pixelOffset = new Cesium.Cartesian2(0, -20);
            entity.label.fillColor = Cesium.Color.WHITE.withAlpha(0.96);
            entity.label.showBackground = true;
            entity.label.backgroundColor = Cesium.Color.BLACK.withAlpha(0.6);
            entity.label.backgroundPadding = new Cesium.Cartesian2(8, 5);
            entity.label.outlineWidth = 0;
            entity.label.style = Cesium.LabelStyle.FILL;
            entity.label.horizontalOrigin = Cesium.HorizontalOrigin.CENTER;
            entity.label.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;
            entity.label.disableDepthTestDistance = Number.POSITIVE_INFINITY;
        }
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
    getOrCreateTrackTrailEntity(viewer, track.track_key, track);
    __liveTrackLastPositions.set(track.track_key, {
        lon,
        lat,
        altitude_ft: Number(track.altitude_ft || 0),
    });
    syncLiveTrackFocusOverlay();
    requestWarzoneRender();
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
    requestWarzoneRender();
    if (!trackKey) return null;
    const entry = __liveTrackRegistry.get(trackKey);
    return entry ? { ...entry } : null;
}
export function getAllLiveTrackSnapshots() {
    pruneTrackRegistry();
    markStaleTracksAsEnded();
    return [...__liveTrackRegistry.values()]
        .filter((entry) => Number(entry.last_seen_at || 0) >= Date.now() - LIVE_TRACK_HISTORY_RETENTION_MS)
        .map((entry) => ({
            ...entry,
            path_history: [...(entry.path_history || [])],
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
    const position = getPositionCartesian(entity);
    if (!position) return false;
    let cartographic = null;
    try {
        cartographic = Cesium.Cartographic.fromCartesian(position);
    } catch {
        return false;
    }
    if (!cartographic) return false;
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const height = Number(cartographic.height || 0);
    const focusHeight = Math.max(height + 160000, Number(options.cameraHeight || 220000));
    viewer.camera.cancelFlight?.();
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, focusHeight),
        duration: Number(options.duration || 1.35),
    });
    setSelectedTrack(trackKey, "focus");
    bindFocusGuideTracking();
    updateFocusGuideElement();
    return true;
}
export function clearLiveTrackSelection(options = {}) {
    clearReplayEntities();
    setSelectedTrack("", "");
    hideFocusGuideElement();
    returnToRegionalFocus(options);
    return true;
}
export function getLiveTrackSelection() {
    return {
        track_key: __liveTrackReplayState.selectedTrackKey || "",
        mode: __liveTrackReplayState.mode || "",
    };
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