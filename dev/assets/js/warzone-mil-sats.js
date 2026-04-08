// File Path: /assets/js/warzone-mil-sats.js
import * as Cesium from "cesium";

// ─── Module State ─────────────────────────────────────────────────────────────
const __warzoneMilSatsState = {
    viewer: null,
    groups: [],          // [{ satDef, currentLon, entities[] }]
    postRenderBound: false,
    lastFrameTime: null,
    updateTimer: null,   // setInterval handle — cleared on re-init
    enabled: true,
};

// ─── Model Config ─────────────────────────────────────────────────────────────
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

// ─── Satellite Definitions ────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Rotation speed ───────────────────────────────────────────────────────────
// Speed scale reference (degrees per second per unit):
//   milSatsRotationSpeed: 1  →  0.005 deg/s  (slow background drift)
//   milSatsRotationSpeed: 5  →  0.025 deg/s  (clearly visible vs globe)
//   milSatsRotationSpeed: 10 →  0.050 deg/s  (fast, good for demo)
//
// *** Completely ignores window.__globeRotation ***
// Satellites run on wall-clock time only — pausing/stopping globe rotation
// has zero effect on satellite movement.
function getRotationDegPerSec() {
    const cfg = window.__stratopsConfig;
    if (!cfg?.milSatsRotation) return 0;
    const speed = Number(cfg.milSatsRotationSpeed);
    return Number.isFinite(speed) && speed > 0 ? speed * 0.005 : 0;
}

// ─── Entity creation ──────────────────────────────────────────────────────────
// Static position/orientation at creation — updated directly by the interval.
//
// WHY NO CallbackProperty: Globe uses requestRenderMode:true (on-demand renders).
// CallbackProperty(isConstant:false) tells Cesium "poll me every frame" — with
// 18 satellites × 2 properties = 36 callbacks, this defeats requestRenderMode
// entirely, forcing 60fps continuous renders and causing stuttering navigation.
// Direct property updates + a single requestRender() per 250ms interval means
// Cesium renders only when needed → smooth globe, smooth orbital drift.
function createSatellite(viewer, sat) {
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

    const initialPos = Cesium.Cartesian3.fromDegrees(sat.lon, sat.lat, sat.altitude);

    const model = viewer.entities.add({
        id: sat.id,
        position: initialPos,
        orientation: createOrientation(initialPos, sat), // static — drift is ~0.006°/interval, imperceptible
        model: {
            uri: modelCfg.uri,
            scale,
            minimumPixelSize: minPx,
            maximumScale: maxScale,
            shadows: Cesium.ShadowMode.DISABLED,
        },
    });

    return [model];
}

// ─── Visibility culling ───────────────────────────────────────────────────────
function updateVisibility(viewer) {
    if (!__warzoneMilSatsState.enabled) return;
    const cam = viewer.camera;
    __warzoneMilSatsState.groups.forEach(group => {
        const entity = group.entities[0];
        if (!entity) return;
        const pos = entity.position.getValue(Cesium.JulianDate.now());
        if (!pos) return;
        const d = Cesium.Cartesian3.distance(cam.positionWC, pos);
        const visible = d < 12000000;
        group.entities.forEach(e => { e.show = visible; });
    });
}

export function setWarzoneMilSatsEnabled(enabled) {
    const nextEnabled = enabled !== false;
    __warzoneMilSatsState.enabled = nextEnabled;

    __warzoneMilSatsState.groups.forEach((group) => {
        group.entities.forEach((entity) => {
            entity.show = nextEnabled;
        });
    });

    __warzoneMilSatsState.viewer?.scene?.requestRender?.();
}

// ─── Public init ──────────────────────────────────────────────────────────────
export function initWarzoneMilSats(viewer) {
    if (!viewer) return;
    if (window.__stratopsConfig?.enableMilSatsLayer === false) {
        __warzoneMilSatsState.enabled = false;
        return;
    }

    __warzoneMilSatsState.viewer = viewer;
    __warzoneMilSatsState.lastFrameTime = Date.now();

    // One group per satellite — each owns its live currentLon
    __warzoneMilSatsState.groups = WARZONE_MIL_SATS.map(satDef => {
        const group = {
            satDef,
            currentLon: satDef.lon,
            entities: [],
        };
        group.entities = createSatellite(viewer, satDef);
        return group;
    });

    // ── Interval-based position update — 4x/sec ──────────────────────────────
    // Satellites move 0.025 deg/sec → 0.006 deg per 250ms interval.
    // At globe scale this is completely smooth. Between intervals Cesium sleeps
    // in on-demand mode → navigation is 100% smooth and unaffected.
    const SAT_UPDATE_INTERVAL_MS = 250;
    if (__warzoneMilSatsState.updateTimer) {
        clearInterval(__warzoneMilSatsState.updateTimer);
    }
    __warzoneMilSatsState.updateTimer = setInterval(() => {
        if (!__warzoneMilSatsState.viewer) return;
        if (!__warzoneMilSatsState.enabled) return;

        const now = Date.now();
        const last = __warzoneMilSatsState.lastFrameTime;
        __warzoneMilSatsState.lastFrameTime = now;
        const dt = Math.min((now - last) / 1000, 0.5); // cap 500ms (tab switch)
        const degPerSec = getRotationDegPerSec();

        if (degPerSec > 0) {
            __warzoneMilSatsState.groups.forEach(group => {
                group.currentLon += degPerSec * dt;
                if (group.currentLon > 180) group.currentLon -= 360;
                if (group.currentLon < -180) group.currentLon += 360;

                // Direct property write — no Cesium polling overhead
                const entity = group.entities[0];
                if (entity) {
                    entity.position = Cesium.Cartesian3.fromDegrees(
                        group.currentLon, group.satDef.lat, group.satDef.altitude
                    );
                }
            });

            // Single requestRender per interval — Cesium renders once, then sleeps
            viewer.scene.requestRender();
        }

        updateVisibility(viewer);
    }, SAT_UPDATE_INTERVAL_MS);

    // Also re-check visibility when camera zooms in/out (no render cost)
    viewer.camera.changed.addEventListener(() => {
        if (!__warzoneMilSatsState.enabled) return;
        updateVisibility(viewer);
    });

    // Expose scale refresh — called from index.js at 150ms after CSS vars settle
    window.refreshWarzoneMilSatsScale = () => {
        __warzoneMilSatsState.groups.forEach(group => {
            const entity = group.entities[0];
            if (!entity?.model) return;
            const modelCfg = getSatelliteModelConfig(group.satDef);
            entity.model.scale = getCssVarNumber("--warzone-mil-sat-scale", modelCfg.scale);
            entity.model.minimumPixelSize = getCssVarNumber("--warzone-mil-sat-min-px", modelCfg.minimumPixelSize);
            entity.model.maximumScale = getCssVarNumber("--warzone-mil-sat-max-scale", modelCfg.maximumScale);
        });
    };

    updateVisibility(viewer);
}
