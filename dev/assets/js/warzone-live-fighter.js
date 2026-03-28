import * as Cesium from "cesium";

/* ================= STATE ================= */

let __liveTrackEntities = new Map();
const __devTrackTimers = new Map();
const __liveTrackTrails = new Map(); // Map<trackKey, Array<{ position, ts }>>
const __liveTrackLastPositions = new Map();
const __liveTrackVisualState = new Map();

/* ================= CONFIG ================= */

const LIVE_TRACK_HEADING_OFFSET_DEG = -90;
const LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS = 800;

/*
 * Trail anchor tuning:
 * - TAIL offset = move line farther behind aircraft center
 * - ENGINE offset = push line closer to burner / exhaust area
 * - ALT offset   = slight visual drop so line does not appear to start from belly
 */
const LIVE_TRACK_TAIL_OFFSET_METERS = 700;
const LIVE_TRACK_ENGINE_OFFSET_METERS = 165;
const LIVE_TRACK_TRAIL_ALTITUDE_OFFSET_METERS = -18;

const LIVE_TRACK_MAX_TRAIL_POINTS = 160;
const LIVE_TRACK_TRAIL_MAX_AGE_MS = 18 * 60 * 1000;
const LIVE_TRACK_MIN_TRAIL_POINT_DISTANCE_METERS = 240;

const LIVE_TRACK_MIN_ANIM_DISTANCE_METERS = 60;
const LIVE_TRACK_MIN_ANIM_MS = 140;
const LIVE_TRACK_MAX_ANIM_MS = 520;

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
    const subtype = String(track.subcategory || track.subtype || "").trim().toLowerCase();
    if (!subtype) return fallbackScale;
    return getCssNumber(`--warzone-live-track-scale-${subtype}`, fallbackScale);
}

function getLiveTrackSubtypeMinPixelSize(track = {}, fallbackValue = 140) {
    const subtype = String(track.subcategory || track.subtype || "").trim().toLowerCase();
    if (!subtype) return fallbackValue;
    return getCssNumber(`--warzone-live-track-min-pixel-size-${subtype}`, fallbackValue);
}

function getLiveTrackSubtypeMaxScale(track = {}, fallbackValue = 520) {
    const subtype = String(track.subcategory || track.subtype || "").trim().toLowerCase();
    if (!subtype) return fallbackValue;
    return getCssNumber(`--warzone-live-track-max-scale-${subtype}`, fallbackValue);
}

function getLiveTrackSubtypeTrailEnabled(track = {}) {
    const subtype = String(track.subcategory || track.subtype || "").trim().toLowerCase();
    if (!subtype) return true;
    return getCssNumber(`--warzone-live-track-trail-enabled-${subtype}`, 1) !== 0;
}

function getLiveTrackSubtypeTrailWidth(track = {}, fallbackWidth = 3.4) {
    const subtype = String(track.subcategory || track.subtype || "").trim().toLowerCase();
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
        const candidate =
            positionOrEntity?.position?.getValue?.(Cesium.JulianDate.now()) ||
            positionOrEntity?.getValue?.(Cesium.JulianDate.now()) ||
            positionOrEntity?.position ||
            positionOrEntity ||
            null;

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

function buildTrackOrientation(lon, lat, alt, headingDeg, pitchDeg = 0, rollDeg = 0) {
    return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(lon, lat, alt),
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(normalizeDegrees(headingDeg + LIVE_TRACK_HEADING_OFFSET_DEG)),
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

function pushTrackTrailPoint(trackKey, lon, lat, alt, courseHeadingDeg = 0) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(alt)) {
        return;
    }

    const headingRad = Cesium.Math.toRadians(courseHeadingDeg);
    const metersPerDegLat = 110540;
    const metersPerDegLon = 111320 * Math.cos(Cesium.Math.toRadians(lat));

    const tailLon =
        lon - ((LIVE_TRACK_TAIL_OFFSET_METERS * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));

    const tailLat =
        lat - ((LIVE_TRACK_TAIL_OFFSET_METERS * Math.cos(headingRad)) / metersPerDegLat);

    const engineLon =
        tailLon - ((LIVE_TRACK_ENGINE_OFFSET_METERS * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));

    const engineLat =
        tailLat - ((LIVE_TRACK_ENGINE_OFFSET_METERS * Math.cos(headingRad)) / metersPerDegLat);

    const newPosition = Cesium.Cartesian3.fromDegrees(
        engineLon,
        engineLat,
        alt + LIVE_TRACK_TRAIL_ALTITUDE_OFFSET_METERS
    );

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

    __liveTrackTrails.set(trackKey, trimTrailEntries(trail));
}

function pushTrackTrailPointFromCartesian(trackKey, cartesianPosition, headingDeg = 0) {
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

    pushTrackTrailPoint(trackKey, lon, lat, alt, headingDeg);
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

function animateTrackTo(entity, nextLon, nextLat, nextAlt = 0) {
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

        const trackKey = entity.__trackKey;
        const headingDeg = entity.__currentHeadingDeg ?? 0;
        if (trackKey) {
            pushTrackTrailPointFromCartesian(trackKey, nextCartesian, headingDeg);
        }

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
            pushTrackTrailPointFromCartesian(trackKey, currentCartesian, headingDeg);
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

    const n = waypoints.length;
    const clampedT = Math.max(0, Math.min(1, t));
    const scaled = clampedT * (n - 1);
    const i = Math.floor(scaled);

    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[Math.min(n - 1, i)];
    const p2 = waypoints[Math.min(n - 1, i + 1)];
    const p3 = waypoints[Math.min(n - 1, i + 2)];
    const localT = scaled - i;

    function interpolate(p0Value, p1Value, p2Value, p3Value, tt) {
        return 0.5 * (
            (2 * p1Value) +
            (-p0Value + p2Value) * tt +
            (2 * p0Value - 5 * p1Value + 4 * p2Value - p3Value) * tt * tt +
            (-p0Value + 3 * p1Value - 3 * p2Value + p3Value) * tt * tt * tt
        );
    }

    const lat = interpolate(p0.lat, p1.lat, p2.lat, p3.lat, localT);
    const lon = interpolate(p0.lon, p1.lon, p2.lon, p3.lon, localT);

    const altitude_ft =
        (p1.altitude_ft || 0) +
        (((p2.altitude_ft || 0) - (p1.altitude_ft || 0)) * localT);

    const heading_deg = getHeadingDegreesFromPoints(p1.lon, p1.lat, p2.lon, p2.lat);

    return {
        lat,
        lon,
        altitude_ft,
        heading_deg,
    };
}

/* ================= PUBLIC API ================= */

function resolveLiveTrackModelUri(track = {}) {
    const subtype = String(track.subcategory || track.subtype || "").trim().toLowerCase();
    return LIVE_TRACK_MODEL_BY_SUBTYPE[subtype] || LIVE_TRACK_MODEL_URI;
}

export function upsertLiveTrack(track) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;

    const viewer = window.__warzoneViewer;
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
                lon,
                lat,
                alt,
                attitude.headingDeg,
                attitude.pitchDeg,
                attitude.rollDeg
            ),
            label: {
                text: track.title || track.subcategory || "Aircraft",
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800000),
                font: "12px sans-serif",
                pixelOffset: new Cesium.Cartesian2(0, -25),
                fillColor: Cesium.Color.WHITE,
            }
        });

        entity.__trackKey = track.track_key;
        entity.__currentHeadingDeg = attitude.headingDeg;

        __liveTrackEntities.set(id, entity);

        pushTrackTrailPointFromCartesian(track.track_key, entity.position, attitude.headingDeg);
    } else {
        entity.__trackKey = track.track_key;
        entity.__currentHeadingDeg = attitude.headingDeg;

        animateTrackTo(entity, lon, lat, alt);

        entity.orientation = buildTrackOrientation(
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
            entity.label.text = track.title || track.subcategory || "Military Aircraft";
        }
    }

    getOrCreateTrackTrailEntity(viewer, track.track_key, track);

    __liveTrackLastPositions.set(track.track_key, {
        lon,
        lat,
        altitude_ft: Number(track.altitude_ft || 0),
    });

    requestWarzoneRender();
}

export function clearLiveTrack(trackKey) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !trackKey) return;

    const entityId = `track-${trackKey}`;
    const trailId = `track-trail-${trackKey}`;

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

    __liveTrackEntities.delete(entityId);
    __liveTrackTrails.delete(trackKey);
    __liveTrackLastPositions.delete(trackKey);
    __liveTrackVisualState.delete(trackKey);

    requestWarzoneRender();
}

export function stopDevTrackSimulation(trackKey = "dev-track-fighter-1") {
    const timer = __devTrackTimers.get(trackKey);

    if (timer) {
        clearInterval(timer);
        __devTrackTimers.delete(trackKey);
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
