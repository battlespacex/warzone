import * as Cesium from "cesium";

const SAT_MODEL_BASE = "/assets/images/models/space/";

const STARTUP_DEMO_MODEL_CONFIG = Object.freeze({
    "sat-1": {
        uri: `${SAT_MODEL_BASE}sat-1.glb`,
        scale: 200000,
        minimumPixelSize: 20,
        maximumScale: 320000,
        heading: 0,
        pitch: -150,
        roll: -15,
    },
    "sat-2": {
        uri: `${SAT_MODEL_BASE}sat-1.glb`,
        scale: 200000,
        minimumPixelSize: 20,
        maximumScale: 320000,
        heading: 0,
        pitch: -150,
        roll: -15,
    },
});

const STARTUP_DEMO_SATS = Object.freeze([
    { id: "sat-gulf-1", lat: 24.5, lon: 45.0, altitude: 500000, mod: "sat-1" },
    { id: "sat-gulf-2", lat: 32.5, lon: 52.5, altitude: 350000, mod: "sat-2" },
    { id: "sat-gulf-3", lat: 18.5, lon: 58.5, altitude: 700000, mod: "sat-1" },
    { id: "sat-eu-1", lat: 50, lon: 10, altitude: 700000, mod: "sat-1" },
    { id: "sat-eu-2", lat: 45, lon: 15, altitude: 500000, mod: "sat-2" },
    { id: "sat-eu-3", lat: 55, lon: 20, altitude: 350000, mod: "sat-1" },
    { id: "sat-sa-1", lat: 34.5, lon: 76.5, altitude: 350000, mod: "sat-1" },
    { id: "sat-sa-2", lat: 28.8, lon: 84.5, altitude: 400000, mod: "sat-2" },
    { id: "sat-sa-3", lat: 21.5, lon: 69.5, altitude: 700000, mod: "sat-1" },
    { id: "sat-ea-1", lat: 31.2, lon: 122.5, altitude: 700000, mod: "sat-2" },
    { id: "sat-ea-2", lat: 24.6, lon: 128.0, altitude: 350000, mod: "sat-1" },
    { id: "sat-ea-3", lat: 14.5, lon: 114.8, altitude: 400000, mod: "sat-2" },
    { id: "sat-af-1", lat: 10, lon: 20, altitude: 350000, mod: "sat-1" },
    { id: "sat-af-2", lat: -5, lon: 30, altitude: 400000, mod: "sat-2" },
    { id: "sat-af-3", lat: 25, lon: 10, altitude: 700000, mod: "sat-1" },
    { id: "sat-ua-1", lat: 49, lon: 31, altitude: 400000, mod: "sat-2" },
    { id: "sat-ua-2", lat: 47, lon: 36, altitude: 700000, mod: "sat-1" },
    { id: "sat-ua-3", lat: 50, lon: 26, altitude: 350000, mod: "sat-2" },
]);

const startupDemoState = {
    viewer: null,
    enabled: false,
    groups: [],
    updateTimer: 0,
    lastFrameTime: 0,
};

function getCssVar(name, fallback) {
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    } catch {
        return fallback;
    }
}

function getCssNumber(name, fallback) {
    const value = Number(getCssVar(name, ""));
    return Number.isFinite(value) ? value : fallback;
}

function getModelConfig(sat = {}) {
    const mod = String(sat?.mod || "sat-1").trim().toLowerCase();
    return STARTUP_DEMO_MODEL_CONFIG[mod] || STARTUP_DEMO_MODEL_CONFIG["sat-1"];
}

function createOrientation(position, sat = {}) {
    const modelCfg = getModelConfig(sat);
    const heading = Number.isFinite(Number(sat?.heading)) ? Number(sat.heading) : Number(modelCfg.heading || 0);
    const pitch = Number.isFinite(Number(sat?.pitch)) ? Number(sat.pitch) : Number(modelCfg.pitch || 0);
    const roll = Number.isFinite(Number(sat?.roll)) ? Number(sat.roll) : Number(modelCfg.roll || 0);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const base = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
    const hpr = Cesium.Matrix3.fromHeadingPitchRoll(
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(heading),
            Cesium.Math.toRadians(pitch),
            Cesium.Math.toRadians(roll)
        )
    );
    const final = Cesium.Matrix3.multiply(base, hpr, new Cesium.Matrix3());
    return Cesium.Quaternion.fromRotationMatrix(final);
}

function createEntity(viewer, sat = {}) {
    const modelCfg = getModelConfig(sat);
    const position = Cesium.Cartesian3.fromDegrees(
        Number(sat.lon) || 0,
        Number(sat.lat) || 0,
        Math.max(0, Number(sat.altitude) || 0)
    );
    return viewer.entities.add({
        id: `wz-startup-sat-${sat.id}`,
        position,
        orientation: createOrientation(position, sat),
        model: {
            uri: modelCfg.uri,
            scale: getCssNumber("--warzone-mil-sat-scale", modelCfg.scale),
            minimumPixelSize: getCssNumber("--warzone-mil-sat-min-px", modelCfg.minimumPixelSize),
            maximumScale: getCssNumber("--warzone-mil-sat-max-scale", modelCfg.maximumScale),
            shadows: Cesium.ShadowMode.DISABLED,
        },
    });
}

function removeEntity(entity) {
    if (!entity || !startupDemoState.viewer?.entities) return;
    try {
        startupDemoState.viewer.entities.remove(entity);
    } catch {
        // no-op
    }
}

function refreshScale() {
    startupDemoState.groups.forEach((group) => {
        const entity = group?.entity;
        const modelCfg = getModelConfig(group?.satDef);
        if (!entity?.model) return;
        entity.model.scale = getCssNumber("--warzone-mil-sat-scale", modelCfg.scale);
        entity.model.minimumPixelSize = getCssNumber("--warzone-mil-sat-min-px", modelCfg.minimumPixelSize);
        entity.model.maximumScale = getCssNumber("--warzone-mil-sat-max-scale", modelCfg.maximumScale);
    });
    startupDemoState.viewer?.scene?.requestRender?.();
}

function getRotationDegPerSec() {
    if (window.__stratopsConfig?.milSatsRotation === false) return 0;
    const speed = Number(window.__stratopsConfig?.milSatsRotationSpeed);
    return Number.isFinite(speed) && speed > 0 ? speed * 0.005 : 0.025;
}

function stopDemo() {
    if (startupDemoState.updateTimer) {
        clearInterval(startupDemoState.updateTimer);
    }
    startupDemoState.updateTimer = 0;
    startupDemoState.lastFrameTime = 0;
    startupDemoState.enabled = false;
    startupDemoState.groups.forEach((group) => removeEntity(group?.entity));
    startupDemoState.groups = [];
    startupDemoState.viewer?.scene?.requestRender?.();
}

export function initWarzoneStartupMilSats(viewer) {
    startupDemoState.viewer = viewer || null;
    window.refreshWarzoneMilSatsScale = () => {
        if (startupDemoState.enabled) refreshScale();
    };
}

export function setWarzoneStartupMilSatsDemoEnabled(enabled) {
    const shouldEnable = enabled !== false;
    if (!shouldEnable) {
        stopDemo();
        return;
    }
    if (!startupDemoState.viewer || startupDemoState.enabled) return;
    startupDemoState.enabled = true;
    startupDemoState.lastFrameTime = Date.now();
    startupDemoState.groups = STARTUP_DEMO_SATS.map((satDef) => ({
        satDef,
        currentLon: Number(satDef.lon) || 0,
        entity: createEntity(startupDemoState.viewer, satDef),
    }));
    refreshScale();
    startupDemoState.updateTimer = setInterval(() => {
        if (!startupDemoState.enabled || !startupDemoState.viewer) return;
        if (document.hidden) return;
        const now = Date.now();
        const last = Number(startupDemoState.lastFrameTime || now);
        startupDemoState.lastFrameTime = now;
        const dt = Math.min(Math.max(0, (now - last) / 1000), 0.5);
        const degPerSec = getRotationDegPerSec();
        if (!(degPerSec > 0)) return;
        startupDemoState.groups.forEach((group) => {
            group.currentLon += degPerSec * dt;
            if (group.currentLon > 180) group.currentLon -= 360;
            if (group.currentLon < -180) group.currentLon += 360;
            if (!group?.entity) return;
            group.entity.position = Cesium.Cartesian3.fromDegrees(
                group.currentLon,
                Number(group.satDef.lat) || 0,
                Math.max(0, Number(group.satDef.altitude) || 0)
            );
        });
        startupDemoState.viewer.scene.requestRender?.();
    }, 250);
    startupDemoState.viewer.scene.requestRender?.();
}
