// File Path: /assets/js/warzone-mil-sats.js
import * as Cesium from "cesium";
const __warzoneMilSatsState = {
    viewer: null,
    entities: [],
    postRenderBound: false,
};
const SAT_MODEL_BASE = "/assets/images/models/space/";
const SAT_MODEL_CONFIG = {
    "sat-1": {
        uri: SAT_MODEL_BASE + "sat-1.glb",
        scale: 200000,
        minimumPixelSize: 20,
        maximumScale: 320000,
        heading: 0,
        pitch: -150,
        roll: -15,
    },
    "sat-2": {
        uri: SAT_MODEL_BASE + "sat-1.glb",
        scale: 200000,
        minimumPixelSize: 20,
        maximumScale: 320000,
        heading: 0,
        pitch: -150,
        roll: -15,
    },
};
const WARZONE_MIL_SATS = [
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
];
function getCssVarNumber(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
function getSatelliteModelConfig(sat) {
    const mod = String(sat?.mod || "sat-1").trim();
    return SAT_MODEL_CONFIG[mod] || SAT_MODEL_CONFIG["sat-1"];
}
function createOrientation(position, sat) {
    const modelCfg = getSatelliteModelConfig(sat);
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
function createSatellite(viewer, sat) {
    const pos = Cesium.Cartesian3.fromDegrees(sat.lon, sat.lat, sat.altitude);
    const orientation = createOrientation(pos, sat);
    const modelCfg = getSatelliteModelConfig(sat);
    const scale = Number.isFinite(Number(sat?.scale))
        ? Number(sat.scale)
        : getCssVarNumber("--warzone-mil-sat-scale", modelCfg.scale);
    const minPx = Number.isFinite(Number(sat?.minimumPixelSize))
        ? Number(sat.minimumPixelSize)
        : getCssVarNumber("--warzone-mil-sat-min-px", modelCfg.minimumPixelSize);
    const maxScale = Number.isFinite(Number(sat?.maximumScale))
        ? Number(sat.maximumScale)
        : getCssVarNumber("--warzone-mil-sat-max-scale", modelCfg.maximumScale);
    const model = viewer.entities.add({
        id: sat.id,
        position: pos,
        orientation,
        model: {
            uri: modelCfg.uri,
            scale,
            minimumPixelSize: minPx,
            maximumScale: maxScale,
            shadows: Cesium.ShadowMode.DISABLED,
        }
    });
    return [model];
}
function updateVisibility(viewer) {
    const cam = viewer.camera;
    const visibilityDistance = getCssVarNumber("--warzone-mil-sat-visibility-distance", 12000000);
    __warzoneMilSatsState.entities.forEach(group => {
        const entity = group[0];
        const pos = entity.position.getValue(Cesium.JulianDate.now());
        const d = Cesium.Cartesian3.distance(cam.positionWC, pos);
        const visible = d < visibilityDistance;
        group.forEach(e => e.show = visible);
    });
}
export function initWarzoneMilSats(viewer) {
    if (!viewer) return;
    __warzoneMilSatsState.viewer = viewer;
    __warzoneMilSatsState.entities = WARZONE_MIL_SATS.map(s =>
        createSatellite(viewer, s)
    );
    if (!__warzoneMilSatsState.postRenderBound) {
        viewer.scene.postRender.addEventListener(() => {
            updateVisibility(viewer);
        });
        __warzoneMilSatsState.postRenderBound = true;
    }
    updateVisibility(viewer);
}
