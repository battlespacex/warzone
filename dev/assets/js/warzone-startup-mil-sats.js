import * as Cesium from "cesium";
import {
    getSatelliteModelHeadingDeg,
    getSatelliteModelPitchDeg,
    getSatelliteModelRollDeg,
    getSatelliteModelScale,
    getStartupSatelliteModelProfile,
} from "./warzone-satellite-models.js";

const STARTUP_DEMO_SATS = Object.freeze([
    { id: "sat-gulf-1", lat: 24.5, lon: 45.0, altitude: 440000, modelKey: "ge-sar-lupe" },
    { id: "sat-gulf-3", lat: 18.5, lon: 58.5, altitude: 1520000, modelKey: "uk-skynet" },
    { id: "sat-ru-visible-3", lat: 13.5, lon: 66.0, altitude: 2520000, modelKey: "ru-pion-nks" },
    { id: "sat-eu-1", lat: 50.0, lon: 10.0, altitude: 620000, modelKey: "ge-sar-lupe" },
    { id: "sat-eu-2", lat: 51.0, lon: 2.0, altitude: 1500000, modelKey: "fr-cos" },
    { id: "sat-eu-3", lat: 55.0, lon: 20.0, altitude: 1860000, modelKey: "uk-skynet" },
    { id: "sat-eu-4", lat: 59.5, lon: 34.0, altitude: 2480000, modelKey: "ru-pion-nks" },
    { id: "sat-sa-1", lat: 34.5, lon: 76.5, altitude: 500000, modelKey: "us-wgs" },
    { id: "sat-sa-2", lat: 28.8, lon: 84.5, altitude: 1120000, modelKey: "fr-cos" },
    { id: "sat-sa-3", lat: 21.5, lon: 69.5, altitude: 1720000, modelKey: "us-muos" },
    { id: "sat-sa-4", lat: 8.5, lon: 79.5, altitude: 2360000, modelKey: "uk-skynet" },
    { id: "sat-scs-vietnam-east-1", lat: 15.8, lon: 124.8, altitude: 920000, modelKey: "cn-yaogan" },
    { id: "sat-scs-spratly-east-1", lat: 8.8, lon: 130.6, altitude: 2040000, modelKey: "ge-sar-lupe" },
    { id: "sat-japan-east-1", lat: 36.4, lon: 151.2, altitude: 2780000, modelKey: "fr-cos" },
    { id: "sat-af-1", lat: 10.0, lon: 20.0, altitude: 560000, modelKey: "us-wgs" },
    { id: "sat-af-2", lat: -5.0, lon: 30.0, altitude: 1180000, modelKey: "ge-sar-lupe" },
    { id: "sat-af-3", lat: 25.0, lon: 10.0, altitude: 1800000, modelKey: "fr-cos" },
    { id: "sat-af-4", lat: -22.0, lon: 18.0, altitude: 2420000, modelKey: "us-sbirs-geo" },
    { id: "sat-ua-1", lat: 49.0, lon: 31.0, altitude: 740000, modelKey: "uk-skynet" },
    { id: "sat-ua-2", lat: 47.0, lon: 36.0, altitude: 1420000, modelKey: "ru-pion-nks" },
    { id: "sat-ua-3", lat: 50.0, lon: 26.0, altitude: 2060000, modelKey: "ge-sar-lupe" },
    { id: "sat-ua-4", lat: 44.0, lon: 42.0, altitude: 2680000, modelKey: "fr-cos" },
    { id: "sat-ru-wide-1", lat: 55.5, lon: 72.0, altitude: 3060000, modelKey: "ru-pion-nks" },
    { id: "sat-ru-wide-2", lat: -8.0, lon: 54.0, altitude: 1380000, modelKey: "ru-pion-nks" },
    { id: "sat-na-1", lat: 38.0, lon: -96.0, altitude: 820000, modelKey: "us-wgs" },
    { id: "sat-na-2", lat: 48.5, lon: -116.0, altitude: 1540000, modelKey: "us-muos" },
    { id: "sat-na-3", lat: 28.0, lon: -82.0, altitude: 2180000, modelKey: "us-sbirs-geo" },
    { id: "sat-na-4", lat: 63.0, lon: -45.0, altitude: 2800000, modelKey: "uk-skynet" },
    { id: "sat-pac-1", lat: -10.0, lon: 154.0, altitude: 900000, modelKey: "us-wgs" },
    { id: "sat-pac-2", lat: -26.0, lon: 138.0, altitude: 1600000, modelKey: "us-sbirs-geo" },
    { id: "sat-pac-3", lat: 5.0, lon: 170.0, altitude: 2260000, modelKey: "us-muos" },
    { id: "sat-pac-4", lat: -41.0, lon: 172.0, altitude: 2860000, modelKey: "fr-cos" },
    { id: "sat-polar-1", lat: 72.0, lon: -20.0, altitude: 1040000, modelKey: "ge-sar-lupe" },
    { id: "sat-polar-2", lat: 68.0, lon: 85.0, altitude: 1740000, modelKey: "ru-pion-nks" },
    { id: "sat-polar-3", lat: -64.0, lon: 40.0, altitude: 2320000, modelKey: "us-wgs" },
    { id: "sat-polar-4", lat: -58.0, lon: -120.0, altitude: 2960000, modelKey: "us-muos" },
]);

const startupDemoState = {
    viewer: null,
    enabled: false,
    groups: [],
    frameListener: null,
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
    return getStartupSatelliteModelProfile(sat?.modelKey || 0);
}

function createOrientation(position, sat = {}) {
    const modelCfg = getModelConfig(sat);
    const heading = getSatelliteModelHeadingDeg(Number.isFinite(Number(sat?.heading)) ? Number(sat.heading) : 0);
    const pitch = getSatelliteModelPitchDeg(Number.isFinite(Number(sat?.pitch)) ? Number(sat.pitch) : -150);
    const roll = getSatelliteModelRollDeg(Number.isFinite(Number(sat?.roll)) ? Number(sat.roll) : -15);
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
            scale: getSatelliteModelScale(194000),
            minimumPixelSize: getCssNumber("--warzone-mil-sat-min-px", 20),
            maximumScale: getCssNumber("--warzone-mil-sat-max-scale", 320000),
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
        entity.model.uri = modelCfg.uri;
        entity.model.scale = getSatelliteModelScale(194000);
        entity.model.minimumPixelSize = getCssNumber("--warzone-mil-sat-min-px", 20);
        entity.model.maximumScale = getCssNumber("--warzone-mil-sat-max-scale", 320000);
        const position = entity.position?.getValue?.(Cesium.JulianDate.now()) || entity.position;
        if (position) entity.orientation = createOrientation(position, group?.satDef);
    });
    startupDemoState.viewer?.scene?.requestRender?.();
}

function getRotationDegPerSec() {
    if (window.__stratopsConfig?.milSatsRotation === false) return 0;
    const globeSpeed = Math.max(0.01, Math.min(getCssNumber("--warzone-startup-rotation-speed", 0.52), 0.75));
    const speed = Number(window.__stratopsConfig?.milSatsRotationSpeed);
    const speedRatio = Number.isFinite(speed) && speed > 0 ? Math.max(0.2, speed / 5) : 1;
    return globeSpeed * speedRatio * 1.18;
}

function stopDemo() {
    if (startupDemoState.frameListener && startupDemoState.viewer?.scene) {
        startupDemoState.viewer.scene.postRender.removeEventListener(startupDemoState.frameListener);
    }
    startupDemoState.frameListener = null;
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
    startupDemoState.frameListener = () => {
        if (!startupDemoState.enabled || !startupDemoState.viewer) return;
        if (document.hidden) return;
        const now = Date.now();
        const last = Number(startupDemoState.lastFrameTime || now);
        startupDemoState.lastFrameTime = now;
        const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
        const degPerSec = getRotationDegPerSec();
        if (!(degPerSec > 0)) return;
        startupDemoState.groups.forEach((group) => {
            group.currentLon -= degPerSec * dt;
            if (group.currentLon > 180) group.currentLon -= 360;
            if (group.currentLon < -180) group.currentLon += 360;
            if (!group?.entity) return;
            const position = Cesium.Cartesian3.fromDegrees(
                group.currentLon,
                Number(group.satDef.lat) || 0,
                Math.max(0, Number(group.satDef.altitude) || 0)
            );
            group.entity.position = position;
            group.entity.orientation = createOrientation(position, group.satDef);
        });
        startupDemoState.viewer.scene.requestRender?.();
    };
    startupDemoState.viewer.scene.postRender.addEventListener(startupDemoState.frameListener);
    startupDemoState.viewer.scene.requestRender?.();
}
