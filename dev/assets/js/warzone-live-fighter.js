// assets/js/wazone-live-fighter.js

import * as Cesium from "cesium";

let __liveTrackEntities = new Map();
const __devTrackTimers = new Map();
const __liveTrackTrails = new Map();
const __liveTrackLastPositions = new Map();
const __liveTrackVisualState = new Map();

const LIVE_TRACK_MODEL_URI = "/assets/images/models/fighter.glb";
const LIVE_TRACK_HEADING_OFFSET_DEG = -90;
function getCssNumber(name, fallback) {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    } catch {
        return fallback;
    }
}
function getCssColor(name, fallback) {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return raw || fallback;
    } catch {
        return fallback;
    }
}
function getLiveTrackStyleConfig() {
    return {
        scale: getCssNumber("--warzone-live-track-scale", 2),
        minimumPixelSize: getCssNumber("--warzone-live-track-min-pixel-size", 48),
        maximumScale: getCssNumber("--warzone-live-track-max-scale", 200),
        trailWidth: getCssNumber("--warzone-live-track-width", 2.2),
        trailOpacity: getCssNumber("--warzone-live-track-opacity", 0.45),
        trailColor: getCssColor("--warzone-live-track-color", "#18e2db"),
    };
}
function normalizeDegrees(deg) {
    const value = deg % 360;
    return value < 0 ? value + 360 : value;
}
function getHeadingDegreesFromPoints(fromLon, fromLat, toLon, toLat) {
    const phi1 = Cesium.Math.toRadians(fromLat);
    const phi2 = Cesium.Math.toRadians(toLat);
    const lambda1 = Cesium.Math.toRadians(fromLon);
    const lambda2 = Cesium.Math.toRadians(toLon);

    const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
    const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);

    const bearing = Cesium.Math.toDegrees(Math.atan2(y, x));
    return normalizeDegrees(bearing);
}
function getTrackResolvedHeading(track) {
    const fallbackHeading = normalizeDegrees(Number(track.heading_deg || 0));
    const previous = __liveTrackLastPositions.get(track.track_key);

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
function buildTrackOrientation(lon, lat, alt, headingDeg) {
    return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(lon, lat, alt),
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(normalizeDegrees(headingDeg + LIVE_TRACK_HEADING_OFFSET_DEG)),
            0,
            0
        )
    );
}
function animateTrackTo(entity, nextLon, nextLat, nextAlt = 0, duration = 220) {
    const startTime = performance.now();

    let startCart = null;

    try {
        startCart = entity.position?.getValue?.(Cesium.JulianDate.now()) || entity.position;
    } catch {
        startCart = entity.position;
    }

    if (!startCart) {
        entity.position = Cesium.Cartesian3.fromDegrees(nextLon, nextLat, nextAlt);
        window.__warzoneViewer?.scene?.requestRender?.();
        return;
    }

    const startCartographic = Cesium.Cartographic.fromCartesian(startCart);
    const startLon = Cesium.Math.toDegrees(startCartographic.longitude);
    const startLat = Cesium.Math.toDegrees(startCartographic.latitude);
    const startAlt = startCartographic.height || 0;

    function step(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const eased = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const lon = startLon + (nextLon - startLon) * eased;
        const lat = startLat + (nextLat - startLat) * eased;
        const alt = startAlt + (nextAlt - startAlt) * eased;

        entity.position = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
        window.__warzoneViewer?.scene?.requestRender?.();

        if (t < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}
export function upsertLiveTrack(track) {
    const globe = window.__warzoneViewer?.__warzone;
    if (!globe) return;

    const viewer = window.__warzoneViewer;
    const id = `track-${track.track_key}`;
    const style = getLiveTrackStyleConfig();

    const lat = Number(track.lat);
    const lon = Number(track.lon);
    const alt = (Number(track.altitude_ft || 0) * 0.3048) + 800;

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const resolvedHeadingDeg = getTrackResolvedHeading(track);
    const attitude = getTrackAttitude(track, resolvedHeadingDeg);
    const modelHeadingDeg = attitude.headingDeg + LIVE_TRACK_HEADING_OFFSET_DEG;

    let entity = viewer.entities.getById(id);

    if (!entity) {
        entity = viewer.entities.add({
            id,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            model: {
                uri: LIVE_TRACK_MODEL_URI,
                scale: style.scale,
                minimumPixelSize: style.minimumPixelSize,
                maximumScale: style.maximumScale,
                color: Cesium.Color.WHITE,
                colorBlendMode: Cesium.ColorBlendMode.MIX,
                colorBlendAmount: 0.15,
            },
            orientation: Cesium.Transforms.headingPitchRollQuaternion(
                Cesium.Cartesian3.fromDegrees(lon, lat, alt),
                new Cesium.HeadingPitchRoll(
                    Cesium.Math.toRadians(modelHeadingDeg),
                    Cesium.Math.toRadians(attitude.pitchDeg),
                    Cesium.Math.toRadians(attitude.rollDeg)
                )
            ),
            label: {
                text: track.title || track.track_key,
                font: "12px sans-serif",
                pixelOffset: new Cesium.Cartesian2(0, -25),
                fillColor: Cesium.Color.WHITE
            }
        });

        __liveTrackEntities.set(id, entity);
    } else {
        animateTrackTo(entity, lon, lat, alt, 220);

        entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
            Cesium.Cartesian3.fromDegrees(lon, lat, alt),
            new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(modelHeadingDeg),
                Cesium.Math.toRadians(attitude.pitchDeg),
                Cesium.Math.toRadians(attitude.rollDeg)
            )
        );

        if (entity.model) {
            entity.model.scale = style.scale;
            entity.model.minimumPixelSize = style.minimumPixelSize;
            entity.model.maximumScale = style.maximumScale;
            entity.model.color = Cesium.Color.WHITE;
            entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
            entity.model.colorBlendAmount = 0.15;
        }

        if (entity.label) {
            entity.label.text = track.title || track.track_key;
        }
    }

    updateTrackTrail(viewer, track);

    __liveTrackLastPositions.set(track.track_key, {
        lon,
        lat,
        altitude_ft: Number(track.altitude_ft || 0),
    });

    viewer.scene.requestRender();
}
function updateTrackTrail(viewer, track) {
    const key = track.track_key;
    if (!key) return;

    const lon = Number(track.lon);
    const lat = Number(track.lat);
    const alt = Number(track.altitude_ft || 0) * 0.3048;
    const courseHeadingDeg = getTrackResolvedHeading(track);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    pushTrackTrailPoint(key, lon, lat, alt, courseHeadingDeg);
    getOrCreateTrackTrailEntity(viewer, key);
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function getShortestAngleDeltaDeg(fromDeg = 0, toDeg = 0) {
    let delta = normalizeDegrees(toDeg) - normalizeDegrees(fromDeg);

    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    return delta;
}
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

    state.headingDeg = normalizeDegrees(
        state.headingDeg + (headingDeltaDeg * 0.22)
    );

    const targetRollDeg = clamp(headingDeltaDeg * 1.35, -18, 18);
    state.rollDeg = state.rollDeg + ((targetRollDeg - state.rollDeg) * 0.18);

    const previous = __liveTrackLastPositions.get(track.track_key);
    let targetPitchDeg = 0;

    if (previous) {
        const prevAltFt = Number(previous.altitude_ft || 0);
        const nextAltFt = Number(track.altitude_ft || 0);
        const climbDeltaFt = nextAltFt - prevAltFt;

        targetPitchDeg = clamp(climbDeltaFt / 900, -8, 8);
    }

    state.pitchDeg = state.pitchDeg + ((targetPitchDeg - state.pitchDeg) * 0.16);

    return {
        headingDeg: state.headingDeg,
        pitchDeg: state.pitchDeg,
        rollDeg: state.rollDeg,
    };
}
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
        altitude_ft: (from.altitude_ft || 0) + (((to.altitude_ft || 0) - (from.altitude_ft || 0)) * t),
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
function getOrCreateTrackTrailEntity(viewer, trackKey) {
    const trailId = `track-trail-${trackKey}`;
    const style = getLiveTrackStyleConfig();
    let entity = viewer.entities.getById(trailId);

    if (!entity) {
        entity = viewer.entities.add({
            id: trailId,
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    return __liveTrackTrails.get(trackKey) || [];
                }, false),
                width: style.trailWidth,
                material: Cesium.Color.fromCssColorString(style.trailColor).withAlpha(style.trailOpacity),
                clampToGround: false,
            }
        });
    } else if (entity.polyline) {
        entity.polyline.width = style.trailWidth;
        entity.polyline.material = Cesium.Color.fromCssColorString(style.trailColor).withAlpha(style.trailOpacity);
    }

    return entity;
}
function pushTrackTrailPoint(trackKey, lon, lat, alt, courseHeadingDeg = 0) {
    const trail = __liveTrackTrails.get(trackKey) || [];

    const TAIL_OFFSET_METERS = 1200;
    const headingRad = Cesium.Math.toRadians(courseHeadingDeg);

    const metersPerDegLat = 110540;
    const metersPerDegLon = 111320 * Math.cos(Cesium.Math.toRadians(lat));

    const tailLon =
        lon - ((TAIL_OFFSET_METERS * Math.sin(headingRad)) / Math.max(metersPerDegLon, 1));

    const tailLat =
        lat - ((TAIL_OFFSET_METERS * Math.cos(headingRad)) / metersPerDegLat);

    trail.push(Cesium.Cartesian3.fromDegrees(tailLon, tailLat, alt));

    if (trail.length > 80) trail.shift();

    __liveTrackTrails.set(trackKey, trail);
}
export function clearLiveTrack(trackKey) {
    const viewer = window.__warzoneViewer;
    if (!viewer || !trackKey) return;

    const entityId = `track-${trackKey}`;
    const trailId = `track-trail-${trackKey}`;

    const entity = viewer.entities.getById(entityId);
    if (entity) viewer.entities.remove(entity);

    const trail = viewer.entities.getById(trailId);
    if (trail) viewer.entities.remove(trail);

    __liveTrackEntities.delete(entityId);
    __liveTrackTrails.delete(trackKey);
    __liveTrackLastPositions.delete(trackKey);
    __liveTrackVisualState.delete(trackKey);

    viewer.scene.requestRender();
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

        let p = null;

        if (isOrbitMode) {
            p = buildOrbitPoint({
                center,
                radiusMeters,
                altitude_ft,
                startAngleDeg,
                turnDirection: mode === "orbit-left" ? "left" : "right",
                t,
            });
        } else if (Array.isArray(waypoints) && waypoints.length >= 2) {
            p = buildWaypointRoutePoint(waypoints, t);
        } else {
            p = interpolateRoutePoint(from, to, t);
        }

        if (!p) return;

        upsertLiveTrack({
            track_key,
            title,
            source_name,
            category,
            subcategory,
            country,
            region,
            lat: p.lat,
            lon: p.lon,
            altitude_ft: Math.round(p.altitude_ft || 0),
            heading_deg: Math.round(p.heading_deg || 0),
            status: "active",
        });

        if (!loop && t >= 1) {
            stopDevTrackSimulation(track_key);
        }
    }, intervalMs);

    __devTrackTimers.set(track_key, timer);
}


