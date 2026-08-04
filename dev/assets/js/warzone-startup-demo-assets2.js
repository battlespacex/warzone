import * as Cesium from "cesium";

const MODEL_BASE = "/assets/images/models";

const STATIC_ASSETS = Object.freeze([
    {
        id: "oman-carrier",
        label: "Oman Carrier",
        uri: `${MODEL_BASE}/sea/Carrier-US.glb`,
        cssPrefix: "--wz-startup-oman-carrier",
    },
    {
        id: "oman-frigate-1",
        label: "Oman Frigate 1",
        uri: `${MODEL_BASE}/sea/Vessel-Frigate.glb`,
        cssPrefix: "--wz-startup-oman-frigate-1",
    },
    {
        id: "oman-frigate-2",
        label: "Oman Frigate 2",
        uri: `${MODEL_BASE}/sea/Vessel-Frigate.glb`,
        cssPrefix: "--wz-startup-oman-frigate-2",
    },
    {
        id: "cyprus-carrier",
        label: "Cyprus Carrier",
        uri: `${MODEL_BASE}/sea/Carrier-US.glb`,
        cssPrefix: "--wz-startup-cyprus-carrier",
    },
    {
    id: "china-carrier",
    label: "China Carrier Fujian",
    uri: `${MODEL_BASE}/sea/Carrier-Fujian.glb`,
    cssPrefix: "--wz-startup-china-carrier",
    },
    {
        id: "china-isr",
        label: "China ISR Vessel",
        uri: `${MODEL_BASE}/sea/Vessel-ISR.glb`,
        cssPrefix: "--wz-startup-china-isr",
    },
    {
        id: "china-sub",
        label: "China Submarine SSN",
        uri: `${MODEL_BASE}/sea/Submarine-SSN.glb`,
        cssPrefix: "--wz-startup-china-sub",
    },
]);

const MOVING_ASSETS = Object.freeze([
    {
        id: "awacs",
        label: "AWACS E-3",
        uri: `${MODEL_BASE}/air/AWACS-E3.glb`,
        cssPrefix: "--wz-startup-awacs",
    },
    {
        id: "globalhawk",
        label: "Global Hawk",
        uri: `${MODEL_BASE}/air/Drone-Globalhawk.glb`,
        cssPrefix: "--wz-startup-globalhawk",
    },
    
    {
        id: "f22-1",
        label: "F22 Lead",
        uri: `${MODEL_BASE}/air/Fighter-F22.glb`,
        cssPrefix: "--wz-startup-f22-1",
    },
    {
        id: "f22-2",
        label: "F22 Wing 1",
        uri: `${MODEL_BASE}/air/Fighter-F22.glb`,
        cssPrefix: "--wz-startup-f22-2",
    },
    {
        id: "f22-3",
        label: "F22 Wing 2",
        uri: `${MODEL_BASE}/air/Fighter-F22.glb`,
        cssPrefix: "--wz-startup-f22-3",
    },
]);

const STATIC_ASSET_IDS = new Set(STATIC_ASSETS.map((asset) => asset.id));
const MOVING_ASSET_IDS = new Set(MOVING_ASSETS.map((asset) => asset.id));
const ENTRY_NAVAL_FLAG = "--wz-entry-show-naval-assets";
const ENTRY_AIR_FLAG = "--wz-entry-show-air-assets";

function entryFlag(name, fallback = 1) {
    return getCssNumber(name, fallback) !== 0;
}

function shouldCreateStaticAssets() {
    return entryFlag(ENTRY_NAVAL_FLAG, 1);
}

function shouldCreateMovingAssets() {
    return entryFlag(ENTRY_AIR_FLAG, 1);
}

function isAssetLayerEnabled(asset) {
    if (STATIC_ASSET_IDS.has(asset.id)) return shouldCreateStaticAssets();
    if (MOVING_ASSET_IDS.has(asset.id)) return shouldCreateMovingAssets();
    return true;
}

const state = {
    viewer: null,
    enabled: false,
    paused: false,
    entities: new Map(),
    moving: new Map(),
    frameListener: null,
    lastFrameTime: 0,
    lastUpdateTime: 0,
    pendingTimers: [],
};

function getCssNumber(name, fallback = 0) {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const value = Number(raw);
        return Number.isFinite(value) ? value : fallback;
    } catch {
        return fallback;
    }
}

function getAssetNumber(asset, suffix, fallback = 0) {
    return getCssNumber(`${asset.cssPrefix}-${suffix}`, fallback);
}

function isAssetVisible(asset) {
    return isAssetLayerEnabled(asset) && getAssetNumber(asset, "visible", 1) !== 0;
}

function clamp01(value) {
    const n = Number(value) || 0;
    return ((n % 1) + 1) % 1;
}

function orientationFromHeading(position, headingDeg, pitchDeg = 0, rollDeg = 0) {
    if (!position) return undefined;
    return Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(Number(headingDeg) || 0),
            Cesium.Math.toRadians(Number(pitchDeg) || 0),
            Cesium.Math.toRadians(Number(rollDeg) || 0)
        )
    );
}

function createEntity(asset, lon, lat, altitude, headingDeg) {
    if (!state.viewer?.entities) return null;
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(0, altitude));
    const entityId = `wz-startup-demo-${asset.id}`;
    const existing = state.viewer.entities.getById?.(entityId);
    if (existing) {
        try {
            state.viewer.entities.remove(existing);
        } catch { }
    }
    const entity = state.viewer.entities.add({
        id: entityId,
        name: asset.label,
        position,
        orientation: orientationFromHeading(
            position,
            headingDeg,
            getAssetNumber(asset, "pitch", 0),
            getAssetNumber(asset, "roll", 0)
        ),
        show: isAssetVisible(asset),
        model: {
            uri: asset.uri,
            scale: getAssetNumber(asset, "scale", 1),
            minimumPixelSize: Math.max(0, getAssetNumber(asset, "min-px", 42)),
            maximumScale: Math.max(1, getAssetNumber(asset, "max-scale", 5000)),
            shadows: Cesium.ShadowMode.DISABLED,
        },
    });
    entity.__wzStartupDemoAssetId = asset.id;
    return entity;
}

function readStaticPose(asset) {
    return {
        lon: getAssetNumber(asset, "lon", 0),
        lat: getAssetNumber(asset, "lat", 0),
        altitude: Math.max(0, getAssetNumber(asset, "altitude", 0)),
        heading: getAssetNumber(asset, "heading", 0),
    };
}

function updateEntityModel(entity, asset) {
    if (!entity) return;
    entity.show = isAssetVisible(asset);
    if (!entity.model) return;
    entity.model.uri = asset.uri;
    entity.model.scale = getAssetNumber(asset, "scale", 1);
    entity.model.minimumPixelSize = Math.max(0, getAssetNumber(asset, "min-px", 42));
    entity.model.maximumScale = Math.max(1, getAssetNumber(asset, "max-scale", 5000));
}

function updateStaticEntity(asset) {
    const entity = state.entities.get(asset.id);
    if (!entity) return;
    const pose = readStaticPose(asset);
    const position = Cesium.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.altitude);
    entity.position = position;
    entity.orientation = orientationFromHeading(
        position,
        pose.heading,
        getAssetNumber(asset, "pitch", 0),
        getAssetNumber(asset, "roll", 0)
    );
    updateEntityModel(entity, asset);
}

function toLocalKm(lon, lat, centerLon, centerLat) {
    const kmPerDegLat = 111.32;
    const kmPerDegLon = Math.max(1, kmPerDegLat * Math.cos(Cesium.Math.toRadians(centerLat)));
    return {
        x: (lon - centerLon) * kmPerDegLon,
        y: (lat - centerLat) * kmPerDegLat,
        kmPerDegLat,
        kmPerDegLon,
    };
}

function fromLocalKm(x, y, centerLon, centerLat, kmPerDegLon, kmPerDegLat) {
    return {
        lon: centerLon + x / kmPerDegLon,
        lat: centerLat + y / kmPerDegLat,
    };
}

function readRoute(asset) {
    const startLon = getAssetNumber(asset, "start-lon", 0);
    const startLat = getAssetNumber(asset, "start-lat", 0);
    const endLon = getAssetNumber(asset, "end-lon", startLon + 1);
    const endLat = getAssetNumber(asset, "end-lat", startLat);
    const centerLon = (startLon + endLon) / 2;
    const centerLat = (startLat + endLat) / 2;
    const start = toLocalKm(startLon, startLat, centerLon, centerLat);
    const end = toLocalKm(endLon, endLat, centerLon, centerLat);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const vx = -uy;
    const vy = ux;
    const radius = Math.max(5, getAssetNumber(asset, "loop-width-km", 220) / 2);
    const totalLength = 2 * length + 2 * Math.PI * radius;
    return {
        start,
        end,
        centerLon,
        centerLat,
        kmPerDegLon: start.kmPerDegLon,
        kmPerDegLat: start.kmPerDegLat,
        length,
        ux,
        uy,
        vx,
        vy,
        radius,
        totalLength,
    };
}

function pointOnRacetrack(route, progress) {
    let distance = clamp01(progress) * route.totalLength;
    const straight = route.length;
    const arc = Math.PI * route.radius;
    let x;
    let y;

    if (distance < straight) {
        const t = distance / straight;
        x = route.start.x + route.vx * route.radius + (route.end.x - route.start.x) * t;
        y = route.start.y + route.vy * route.radius + (route.end.y - route.start.y) * t;
    } else if ((distance -= straight) < arc) {
        const a = distance / route.radius;
        x = route.end.x + route.vx * route.radius * Math.cos(a) + route.ux * route.radius * Math.sin(a);
        y = route.end.y + route.vy * route.radius * Math.cos(a) + route.uy * route.radius * Math.sin(a);
    } else if ((distance -= arc) < straight) {
        const t = distance / straight;
        x = route.end.x - route.vx * route.radius + (route.start.x - route.end.x) * t;
        y = route.end.y - route.vy * route.radius + (route.start.y - route.end.y) * t;
    } else {
        distance -= straight;
        const a = Math.min(Math.PI, distance / route.radius);
        x = route.start.x - route.vx * route.radius * Math.cos(a) - route.ux * route.radius * Math.sin(a);
        y = route.start.y - route.vy * route.radius * Math.cos(a) - route.uy * route.radius * Math.sin(a);
    }

    return fromLocalKm(
        x,
        y,
        route.centerLon,
        route.centerLat,
        route.kmPerDegLon,
        route.kmPerDegLat
    );
}

function bearingDegrees(from, to) {
    const lat1 = Cesium.Math.toRadians(from.lat);
    const lat2 = Cesium.Math.toRadians(to.lat);
    const dLon = Cesium.Math.toRadians(to.lon - from.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
        - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Cesium.Math.toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function updateMovingEntity(asset, entry, dtSeconds = 0) {
    if (!entry?.entity) return;

    const speed = Math.max(0, getAssetNumber(asset, "speed", 0.01));
    const now = Date.now();
    const movementDelayDone = !entry.delayUntil || now >= entry.delayUntil;

    if (!state.paused && movementDelayDone && dtSeconds > 0) {
        entry.progress = clamp01(entry.progress + speed * dtSeconds);
    }

    const route = readRoute(asset);
    const point = pointOnRacetrack(route, entry.progress);
    const nextPoint = pointOnRacetrack(route, entry.progress + 0.0005);
    const altitude = Math.max(0, getAssetNumber(asset, "altitude", 180000));
    const heading = bearingDegrees(point, nextPoint) + getAssetNumber(asset, "heading-offset", 0);

    let finalPos = { lon: point.lon, lat: point.lat };
    const back = Math.max(0, getCssNumber("--wz-startup-f22-back-distance", 25));
    const side = Math.max(0, getCssNumber("--wz-startup-f22-side-distance", 18));

    if (asset.id === "f22-2") {
        finalPos = offsetFormationHeading(point.lon, point.lat, heading, back, -side);
    }

    if (asset.id === "f22-3") {
        finalPos = offsetFormationHeading(point.lon, point.lat, heading, back, side);
    }

    const finalPosition = Cesium.Cartesian3.fromDegrees(finalPos.lon, finalPos.lat, altitude);
    entry.entity.position = finalPosition;
    entry.entity.orientation = orientationFromHeading(
        finalPosition,
        heading,
        getAssetNumber(asset, "pitch", 0),
        getAssetNumber(asset, "roll", 0)
    );

    updateEntityModel(entry.entity, asset);
}

function removeEntity(entity) {
    if (!entity || !state.viewer?.entities) return;
    try {
        state.viewer.entities.remove(entity);
    } catch { }
}

function stopFrameListener() {
    if (state.frameListener && state.viewer?.scene) {
        try {
            state.viewer.scene.postRender.removeEventListener(state.frameListener);
        } catch { }
    }
    state.frameListener = null;
    state.lastFrameTime = 0;
    state.lastUpdateTime = 0;
}

function cleanup() {
    stopFrameListener();
    state.pendingTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.pendingTimers = [];
    state.entities.forEach(removeEntity);
    state.entities.clear();
    state.moving.clear();
    state.enabled = false;
    state.paused = false;
    state.viewer?.scene?.requestRender?.();
}

function createAllEntities() {
    state.pendingTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.pendingTimers = [];

    // 1. Static naval assets. When disabled, they are not created or loaded at all.
    if (shouldCreateStaticAssets()) {
        STATIC_ASSETS.forEach((asset, i) => {
            const timerId = window.setTimeout(() => {
                if (!state.enabled || !shouldCreateStaticAssets()) return;
                const pose = readStaticPose(asset);
                const entity = createEntity(asset, pose.lon, pose.lat, pose.altitude, pose.heading);
                if (entity) state.entities.set(asset.id, entity);
                state.viewer?.scene?.requestRender?.();
            }, i * 120);
            state.pendingTimers.push(timerId);
        });
    }

    // 2. Moving air assets. When disabled, they are not created or loaded at all.
    if (shouldCreateMovingAssets()) {
        MOVING_ASSETS.forEach((asset, i) => {
            const timerId = window.setTimeout(() => {
                if (!state.enabled || !shouldCreateMovingAssets()) return;
                const progress = clamp01(getAssetNumber(asset, "phase", 0));
                const route = readRoute(asset);
                const point = pointOnRacetrack(route, progress);
                const nextPoint = pointOnRacetrack(route, progress + 0.0005);

                const altitude = Math.max(0, getAssetNumber(asset, "altitude", 180000));
                const heading = bearingDegrees(point, nextPoint) + getAssetNumber(asset, "heading-offset", 0);

                const entity = createEntity(asset, point.lon, point.lat, altitude, heading);
                if (!entity) return;

                state.entities.set(asset.id, entity);
                state.moving.set(asset.id, {
                    entity,
                    progress,
                    delayUntil: Date.now() + 800
                });

                updateMovingEntity(asset, state.moving.get(asset.id), 0);
                state.viewer?.scene?.requestRender?.();
            }, 300 + (i * 200));
            state.pendingTimers.push(timerId);
        });
    }
}

function offsetFormation(baseLon, baseLat, offsetKmX, offsetKmY) {
    const kmPerDegLat = 111.32;
    const kmPerDegLon = kmPerDegLat * Math.cos(Cesium.Math.toRadians(baseLat));

    return {
        lon: baseLon + (offsetKmX / kmPerDegLon),
        lat: baseLat + (offsetKmY / kmPerDegLat),
    };
}

function offsetFormationHeading(baseLon, baseLat, headingDeg, backKm, sideKm) {
    const rad = Cesium.Math.toRadians(Number(headingDeg) || 0);

    // Forward vector based on actual aircraft heading.
    const fx = Math.sin(rad);
    const fy = Math.cos(rad);

    // Right-side vector, perpendicular to heading.
    const rx = Math.sin(rad + Math.PI / 2);
    const ry = Math.cos(rad + Math.PI / 2);

    const kmPerDegLat = 111.32;
    const kmPerDegLon = Math.max(1, kmPerDegLat * Math.cos(Cesium.Math.toRadians(baseLat)));

    const offsetX = (-backKm * fx) + (sideKm * rx);
    const offsetY = (-backKm * fy) + (sideKm * ry);

    return {
        lon: baseLon + (offsetX / kmPerDegLon),
        lat: baseLat + (offsetY / kmPerDegLat),
    };
}
function startFrameListener() {
    stopFrameListener();
    if (!state.viewer?.scene) return;
    state.lastFrameTime = Date.now();
    state.frameListener = () => {
        if (!state.enabled || !state.viewer || document.hidden) return;
        if (!document.body.classList.contains("wz-pre-entry-active")) {
            setWarzoneStartupDemoAssetsEnabled(false);
            return;
        }
        const now = Date.now();
        const updateMs = Math.max(40, Math.min(1000, getCssNumber("--wz-startup-demo-update-ms", 80)));
        if (state.lastUpdateTime && now - state.lastUpdateTime < updateMs) return;
        const last = Number(state.lastFrameTime || now);
        state.lastFrameTime = now;
        state.lastUpdateTime = now;
        const dt = Math.min(Math.max(0, (now - last) / 1000), 0.25);
        if (shouldCreateMovingAssets()) {
            MOVING_ASSETS.forEach((asset) => updateMovingEntity(asset, state.moving.get(asset.id), dt));
        }
        state.viewer.scene.requestRender?.();
    };
    state.viewer.scene.postRender.addEventListener(state.frameListener);
}

export function refreshWarzoneStartupDemoAssets() {
    if (!state.viewer || !state.enabled) return;
    if (shouldCreateStaticAssets()) STATIC_ASSETS.forEach(updateStaticEntity);
    if (shouldCreateMovingAssets()) MOVING_ASSETS.forEach((asset) => updateMovingEntity(asset, state.moving.get(asset.id), 0));
    state.viewer.scene?.requestRender?.();
}

export function syncWarzoneStartupDemoAssetLayers() {
    const shouldEnableAny = shouldCreateStaticAssets() || shouldCreateMovingAssets();
    if (!state.viewer || !document.body.classList.contains("wz-pre-entry-active")) return;
    cleanup();
    if (shouldEnableAny) {
        setWarzoneStartupDemoAssetsEnabled(true);
    }
}

export function setWarzoneStartupDemoAssetsPaused(paused) {
    state.paused = paused === true;
    state.lastFrameTime = Date.now();
    return state.paused;
}

export function setWarzoneStartupDemoAssetPhase(assetId, phase) {
    const asset = MOVING_ASSETS.find((item) => item.id === assetId);
    const entry = state.moving.get(assetId);
    if (!asset || !entry) return false;
    entry.progress = clamp01(phase);
    updateMovingEntity(asset, entry, 0);
    state.viewer?.scene?.requestRender?.();
    return true;
}

export function initWarzoneStartupDemoAssets(viewer) {
    state.viewer = viewer || null;
    const api = {
        refresh: refreshWarzoneStartupDemoAssets,
        setPaused: setWarzoneStartupDemoAssetsPaused,
        setPhase: setWarzoneStartupDemoAssetPhase,
        setEnabled: setWarzoneStartupDemoAssetsEnabled,
        syncLayers: syncWarzoneStartupDemoAssetLayers,
        isPaused: () => state.paused,
        isEnabled: () => state.enabled,
    };
    window.__warzoneStartupDemoAssets = api;
    document.removeEventListener("wz:app-entered", handleAppEntered);
    document.addEventListener("wz:app-entered", handleAppEntered);
    return api;
}

export function setWarzoneStartupDemoAssetsEnabled(enabled) {
    const shouldEnable = enabled !== false && (shouldCreateStaticAssets() || shouldCreateMovingAssets());
    if (!shouldEnable) {
        cleanup();
        return;
    }
    if (!state.viewer || state.enabled) return;
    if (!document.body.classList.contains("wz-pre-entry-active")) return;
    state.enabled = true;
    state.paused = false;
    state.lastFrameTime = Date.now();
    state.lastUpdateTime = 0;
    createAllEntities();
    refreshWarzoneStartupDemoAssets();
    startFrameListener();
    state.viewer.scene?.requestRender?.();
}

function handleAppEntered() {
    setWarzoneStartupDemoAssetsEnabled(false);
}
