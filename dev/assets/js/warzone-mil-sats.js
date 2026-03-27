// assets/js/warzone-mil-sats.js
// CLEAN FINAL VERSION (YOUR ALTITUDES RESTORED)

import * as Cesium from "cesium";

const __warzoneMilSatsState = {
    viewer: null,
    entities: [],
    postRenderBound: false,
};

const SAT_MODEL_BASE = "/assets/images/models/space/";

const WARZONE_MIL_SATS = [

    { id: "sat-gulf-1", lat: 24.5, lon: 45.0, altitude: 500000 },
    { id: "sat-gulf-2", lat: 32.5, lon: 52.5, altitude: 350000 },
    { id: "sat-gulf-3", lat: 18.5, lon: 58.5, altitude: 700000 },

    { id: "sat-eu-1", lat: 50, lon: 10, altitude: 700000 },
    { id: "sat-eu-2", lat: 45, lon: 15, altitude: 500000 },
    { id: "sat-eu-3", lat: 55, lon: 20, altitude: 350000 },

    { id: "sat-sa-1", lat: 34.5, lon: 76.5, altitude: 350000 },
    { id: "sat-sa-2", lat: 28.8, lon: 84.5, altitude: 400000 },
    { id: "sat-sa-3", lat: 21.5, lon: 69.5, altitude: 700000 },

    { id: "sat-ea-1", lat: 31.2, lon: 122.5, altitude: 700000 },
    { id: "sat-ea-2", lat: 24.6, lon: 128.0, altitude: 350000 },
    { id: "sat-ea-3", lat: 14.5, lon: 114.8, altitude: 400000 },

    { id: "sat-af-1", lat: 10, lon: 20, altitude: 350000 },
    { id: "sat-af-2", lat: -5, lon: 30, altitude: 400000 },
    { id: "sat-af-3", lat: 25, lon: 10, altitude: 700000 },

    { id: "sat-ua-1", lat: 49, lon: 31, altitude: 400000 },
    { id: "sat-ua-2", lat: 47, lon: 36, altitude: 700000 },
    { id: "sat-ua-3", lat: 50, lon: 26, altitude: 350000 },
];

function getCssVarNumber(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function createOrientation(position) {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const base = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());

    const hpr = Cesium.Matrix3.fromHeadingPitchRoll(
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(0),
            Cesium.Math.toRadians(-150),
            Cesium.Math.toRadians(-15)
        )
    );

    const final = Cesium.Matrix3.multiply(base, hpr, new Cesium.Matrix3());
    return Cesium.Quaternion.fromRotationMatrix(final);
}

function createSatellite(viewer, sat) {
    const pos = Cesium.Cartesian3.fromDegrees(sat.lon, sat.lat, sat.altitude);
    const orientation = createOrientation(pos);

    const scale = getCssVarNumber("--warzone-mil-sat-scale", 200000);
    const minPx = getCssVarNumber("--warzone-mil-sat-min-px", 20);
    const maxScale = getCssVarNumber("--warzone-mil-sat-max-scale", 320000);

    const model = viewer.entities.add({
        id: sat.id,
        position: pos,
        orientation,
        model: {
            uri: SAT_MODEL_BASE + "sat-1.glb",
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

    __warzoneMilSatsState.entities.forEach(group => {
        const entity = group[0];
        const pos = entity.position.getValue(Cesium.JulianDate.now());
        const d = Cesium.Cartesian3.distance(cam.positionWC, pos);

        const visible = d < 12000000;
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
