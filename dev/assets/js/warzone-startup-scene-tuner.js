import "../css/warzone-dev-panel.css";
import * as Cesium from "cesium";

const SCENE_FIELDS = Object.freeze([
    { label: "Camera longitude", cssVar: "--warzone-start-lon", min: -180, max: 180, step: 0.1, fallback: 40.4 },
    { label: "Camera latitude", cssVar: "--warzone-start-lat", min: -85, max: 85, step: 0.1, fallback: 12.3 },
    { label: "Camera height", cssVar: "--warzone-start-height", min: 2000000, max: 15000000, step: 50000, fallback: 5200000 },
    { label: "Camera heading", cssVar: "--warzone-start-heading", min: -180, max: 180, step: 1, fallback: 0 },
    { label: "Camera pitch", cssVar: "--warzone-start-pitch", min: -89, max: -20, step: 1, fallback: -74 },
    { label: "Camera roll", cssVar: "--warzone-start-roll", min: -180, max: 180, step: 1, fallback: 0 },
    { label: "Globe rotation", cssVar: "--warzone-startup-rotation-speed", min: 0.01, max: 2, step: 0.01, fallback: 0.52 },
    { label: "Satellite update ms", cssVar: "--warzone-startup-sat-update-ms", min: 80, max: 500, step: 10, fallback: 160 },
    { label: "Satellite minimum latitude", cssVar: "--wz-startup-sat-min-lat", min: -90, max: 90, step: 1, fallback: 0 },
    { label: "Satellite maximum latitude", cssVar: "--wz-startup-sat-max-lat", min: -90, max: 90, step: 1, fallback: 60 },
    { label: "Aircraft/naval update ms", cssVar: "--wz-startup-demo-update-ms", min: 0, max: 1000, step: 10, fallback: 16 },
    { label: "Aircraft turn bank degree", cssVar: "--wz-startup-air-bank-deg", min: -65, max: 65, step: 1, fallback: 24 },
    { label: "Aircraft bank smoothing", cssVar: "--wz-startup-air-bank-smoothing", min: 0.05, max: 6, step: 0.05, fallback: 0.65 },
    { label: "B-2/KC-135 world speed", cssVar: "--wz-startup-b2-world-speed", min: 0, max: 0.08, step: 0.001, fallback: 0.008 },
    { label: "F22 back distance km", cssVar: "--wz-startup-f22-back-distance", min: 0, max: 120, step: 1, fallback: 25 },
    { label: "F22 side distance km", cssVar: "--wz-startup-f22-side-distance", min: 0, max: 80, step: 1, fallback: 18 },
    { label: "Satellite scale", cssVar: "--warzone-satellite-model-scale", min: 100, max: 500000, step: 100, fallback: 2200 },
    { label: "Satellite min pixels", cssVar: "--warzone-mil-sat-min-px", min: 1, max: 120, step: 1, fallback: 30 },
    { label: "Satellite max scale", cssVar: "--warzone-mil-sat-max-scale", min: 10000, max: 600000, step: 1000, fallback: 320000 },
    { label: "Show startup satellites 1/0", cssVar: "--wz-entry-show-satellites", min: 0, max: 1, step: 1, fallback: 1 },
    { label: "Show naval assets 1/0", cssVar: "--wz-entry-show-naval-assets", min: 0, max: 1, step: 1, fallback: 1 },
    { label: "Show air assets 1/0", cssVar: "--wz-entry-show-air-assets", min: 0, max: 1, step: 1, fallback: 1 },
    { label: "Show map imagery 1/0", cssVar: "--wz-entry-show-map-imagery", min: 0, max: 1, step: 1, fallback: 1 },
    { label: "Show country borders 1/0", cssVar: "--wz-entry-show-borders", min: 0, max: 1, step: 1, fallback: 0 },
]);

const STATIC_FIELD_TEMPLATE = Object.freeze([
    { key: "lon", label: "Longitude", min: -180, max: 180, step: 0.1 },
    { key: "lat", label: "Latitude", min: -85, max: 85, step: 0.1 },
    { key: "altitude", label: "Altitude", min: 0, max: 500000, step: 1000 },
    { key: "heading", label: "Heading", min: -360, max: 360, step: 1 },
    { key: "pitch", label: "Pitch", min: -180, max: 180, step: 1 },
    { key: "roll", label: "Roll", min: -180, max: 180, step: 1 },
    { key: "scale", label: "Model scale", min: 0.01, max: 100, step: 0.01 },
    { key: "min-px", label: "Minimum pixels", min: 0, max: 200, step: 1 },
    { key: "max-scale", label: "Maximum scale", min: 1, max: 10000, step: 10 },
    { key: "visible", label: "Visible 1/0", min: 0, max: 1, step: 1 },
]);

const MOVING_FIELD_TEMPLATE = Object.freeze([
    { key: "start-lon", label: "Route start longitude", min: -180, max: 180, step: 0.1 },
    { key: "start-lat", label: "Route start latitude", min: -85, max: 85, step: 0.1 },
    { key: "end-lon", label: "Route end longitude", min: -180, max: 180, step: 0.1 },
    { key: "end-lat", label: "Route end latitude", min: -85, max: 85, step: 0.1 },
    { key: "loop-width-km", label: "Patrol loop width km", min: 10, max: 1500, step: 10 },
    { key: "altitude", label: "Altitude", min: 0, max: 1000000, step: 5000 },
    { key: "speed", label: "Loop speed", min: 0, max: 0.1, step: 0.001 },
    { key: "phase", label: "Start phase", min: 0, max: 1, step: 0.01 },
    { key: "heading-offset", label: "Heading correction", min: -360, max: 360, step: 1 },
    { key: "pitch", label: "Pitch", min: -180, max: 180, step: 1 },
    { key: "roll", label: "Roll", min: -180, max: 180, step: 1 },
    { key: "scale", label: "Model scale", min: 0.01, max: 500000, step: 100 },
    { key: "min-px", label: "Minimum pixels", min: 0, max: 200, step: 1 },
    { key: "max-scale", label: "Maximum scale", min: 1, max: 10000, step: 10 },
    { key: "visible", label: "Visible 1/0", min: 0, max: 1, step: 1 },
]);

function buildAssetFields(prefix, template, fallbacks) {
    return template.map((field) => ({
        ...field,
        cssVar: `${prefix}-${field.key}`,
        fallback: fallbacks[field.key],
    }));
}

const GROUPS = Object.freeze([
    { id: "scene", label: "Scene & Satellites", fields: SCENE_FIELDS },
    {
        id: "oman-carrier",
        label: "Oman Carrier",
        fields: buildAssetFields("--wz-startup-oman-carrier", STATIC_FIELD_TEMPLATE, {
            lon: 59.4, lat: 21.8, altitude: 1000, heading: 330, pitch: 0, roll: 0,
            scale: 1, "min-px": 58, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "oman-frigate-1",
        label: "Oman Frigate 1",
        fields: buildAssetFields("--wz-startup-oman-frigate-1", STATIC_FIELD_TEMPLATE, {
            lon: 60.0, lat: 22.15, altitude: 1000, heading: 330, pitch: 0, roll: 0,
            scale: 1, "min-px": 42, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "oman-frigate-2",
        label: "Oman Frigate 2",
        fields: buildAssetFields("--wz-startup-oman-frigate-2", STATIC_FIELD_TEMPLATE, {
            lon: 60.05, lat: 21.35, altitude: 1000, heading: 330, pitch: 0, roll: 0,
            scale: 1, "min-px": 42, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "cyprus-carrier",
        label: "Cyprus Carrier",
        fields: buildAssetFields("--wz-startup-cyprus-carrier", STATIC_FIELD_TEMPLATE, {
            lon: 33.1, lat: 34.3, altitude: 1000, heading: 148, pitch: 0, roll: 0,
            scale: 1, "min-px": 58, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "awacs",
        label: "AWACS E-3",
        fields: buildAssetFields("--wz-startup-awacs", MOVING_FIELD_TEMPLATE, {
            "start-lon": 51.3, "start-lat": 25.25, "end-lon": 42.5, "end-lat": 18.2,
            "loop-width-km": 260, altitude: 220000, speed: 0.012, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 48, "max-scale": 1800, visible: 1,
        }),
    },
    {
        id: "globalhawk",
        label: "Global Hawk",
        fields: buildAssetFields("--wz-startup-globalhawk", MOVING_FIELD_TEMPLATE, {
            "start-lon": 52.8, "start-lat": 32.2, "end-lon": 64.2, "end-lat": 34.3,
            "loop-width-km": 300, altitude: 260000, speed: 0.014, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 44, "max-scale": 1800, visible: 1,
        }),
    },
    {
        id: "f22-1",
        label: "F22 Lead",
        fields: buildAssetFields("--wz-startup-f22-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": 138,
            "start-lat": 38,
            "end-lon": 145,
            "end-lat": 32,
            "loop-width-km": 260,
            altitude: 180000,
            speed: 0.02,
            phase: 0,
            "heading-offset": 90,
            pitch: 0,
            roll: 0,
            scale: 150000,
            "min-px": 64,
            "max-scale": 420000,
            visible: 1,
        }),
    },
    {
        id: "f22-2",
        label: "F22 Wing 1",
        fields: buildAssetFields("--wz-startup-f22-2", MOVING_FIELD_TEMPLATE, {
            "start-lon": 138,
            "start-lat": 38,
            "end-lon": 145,
            "end-lat": 32,
            "loop-width-km": 260,
            altitude: 180000,
            speed: 0.02,
            phase: 0,
            "heading-offset": 90,
            pitch: 0,
            roll: 0,
            scale: 150000,
            "min-px": 64,
            "max-scale": 420000,
            visible: 1,
        }),
    },
    {
        id: "f22-3",
        label: "F22 Wing 2",
        fields: buildAssetFields("--wz-startup-f22-3", MOVING_FIELD_TEMPLATE, {
            "start-lon": 138,
            "start-lat": 38,
            "end-lon": 145,
            "end-lat": 32,
            "loop-width-km": 260,
            altitude: 180000,
            speed: 0.02,
            phase: 0,
            "heading-offset": 90,
            pitch: 0,
            roll: 0,
            scale: 150000,
            "min-px": 64,
            "max-scale": 420000,
            visible: 1,
        }),
    },
    {
        id: "china-carrier",
        label: "China Carrier Fujian",
        fields: buildAssetFields("--wz-startup-china-carrier", STATIC_FIELD_TEMPLATE, {
            lon: 125.5,
            lat: 28.5,
            altitude: 1000,
            heading: 210,
            pitch: 0,
            roll: 0,
            scale: 1,
            "min-px": 58,
            "max-scale": 5000,
            visible: 1,
        }),
    },
    {
        id: "china-isr",
        label: "China ISR Vessel",
        fields: buildAssetFields("--wz-startup-china-isr", STATIC_FIELD_TEMPLATE, {
            lon: 128.2,
            lat: 26.8,
            altitude: 1000,
            heading: 200,
            pitch: 0,
            roll: 0,
            scale: 1,
            "min-px": 42,
            "max-scale": 5000,
            visible: 1,
        }),
    },
    {
        id: "china-sub",
        label: "China Submarine SSN",
        fields: buildAssetFields("--wz-startup-china-sub", STATIC_FIELD_TEMPLATE, {
            lon: 132.0,
            lat: 31.5,
            altitude: 500,
            heading: 180,
            pitch: 0,
            roll: 0,
            scale: 1,
            "min-px": 42,
            "max-scale": 5000,
            visible: 1,
        }),
    },

    {
        id: "sd-carrier-1",
        label: "San Diego Carrier 1",
        fields: buildAssetFields("--wz-startup-sd-carrier-1", STATIC_FIELD_TEMPLATE, {
            lon: -118.4, lat: 31.8, altitude: 0, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 70, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-carrier-2",
        label: "San Diego Carrier 2",
        fields: buildAssetFields("--wz-startup-sd-carrier-2", STATIC_FIELD_TEMPLATE, {
            lon: -119.6, lat: 30.9, altitude: 0, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 70, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-frigate-1",
        label: "San Diego Frigate 1",
        fields: buildAssetFields("--wz-startup-sd-frigate-1", STATIC_FIELD_TEMPLATE, {
            lon: -117.8, lat: 32.5, altitude: 1000, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 46, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-frigate-2",
        label: "San Diego Frigate 2",
        fields: buildAssetFields("--wz-startup-sd-frigate-2", STATIC_FIELD_TEMPLATE, {
            lon: -118.9, lat: 32.2, altitude: 1000, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 46, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-frigate-3",
        label: "San Diego Frigate 3",
        fields: buildAssetFields("--wz-startup-sd-frigate-3", STATIC_FIELD_TEMPLATE, {
            lon: -119.4, lat: 31.5, altitude: 1000, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 46, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-frigate-4",
        label: "San Diego Frigate 4",
        fields: buildAssetFields("--wz-startup-sd-frigate-4", STATIC_FIELD_TEMPLATE, {
            lon: -120.1, lat: 30.6, altitude: 1000, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 46, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-frigate-5",
        label: "San Diego Frigate 5",
        fields: buildAssetFields("--wz-startup-sd-frigate-5", STATIC_FIELD_TEMPLATE, {
            lon: -118.6, lat: 30.4, altitude: 1000, heading: 285, pitch: 0, roll: 0,
            scale: 1, "min-px": 46, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-ssbn-1",
        label: "San Diego SSBN 1",
        fields: buildAssetFields("--wz-startup-sd-ssbn-1", STATIC_FIELD_TEMPLATE, {
            lon: -120.6, lat: 29.8, altitude: 500, heading: 305, pitch: 0, roll: 0,
            scale: 1, "min-px": 52, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "sd-ssbn-2",
        label: "San Diego SSBN 2",
        fields: buildAssetFields("--wz-startup-sd-ssbn-2", STATIC_FIELD_TEMPLATE, {
            lon: -121.4, lat: 28.9, altitude: 500, heading: 305, pitch: 0, roll: 0,
            scale: 1, "min-px": 52, "max-scale": 5000, visible: 1,
        }),
    },
    {
        id: "b2-1",
        label: "B-2 Spirit Lead",
        fields: buildAssetFields("--wz-startup-b2-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": -160, "start-lat": 22, "end-lon": 160, "end-lat": 22,
            "loop-width-km": 520, altitude: 210000, speed: 0.008, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 76, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "b2-2",
        label: "B-2 Spirit Trail",
        fields: buildAssetFields("--wz-startup-b2-2", MOVING_FIELD_TEMPLATE, {
            "start-lon": -160, "start-lat": 22, "end-lon": 160, "end-lat": 22,
            "loop-width-km": 520, altitude: 210000, speed: 0.008, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 76, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "kc135-1",
        label: "KC-135 Refueler",
        fields: buildAssetFields("--wz-startup-kc135-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": -160, "start-lat": 20, "end-lon": 160, "end-lat": 20,
            "loop-width-km": 520, altitude: 205000, speed: 0.008, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 72, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "b52-1",
        label: "B-52 Lead",
        fields: buildAssetFields("--wz-startup-b52-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": -86.8, "start-lat": 32.7, "end-lon": -116.9, "end-lat": 37.2,
            "loop-width-km": 360, altitude: 190000, speed: 0.014, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 76, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "b52-2",
        label: "B-52 Wing",
        fields: buildAssetFields("--wz-startup-b52-2", MOVING_FIELD_TEMPLATE, {
            "start-lon": -86.8, "start-lat": 32.7, "end-lon": -116.9, "end-lat": 37.2,
            "loop-width-km": 360, altitude: 190000, speed: 0.014, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 76, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "b1-1",
        label: "B-1 Lancer",
        fields: buildAssetFields("--wz-startup-b1-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": -86.8, "start-lat": 32.7, "end-lon": -116.9, "end-lat": 37.2,
            "loop-width-km": 360, altitude: 195000, speed: 0.014, phase: 0,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 74, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "c5-1",
        label: "C-5 Galaxy",
        fields: buildAssetFields("--wz-startup-c5-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": -42, "start-lat": 42, "end-lon": 17, "end-lat": 29,
            "loop-width-km": 420, altitude: 180000, speed: 0.009, phase: 0.12,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 76, "max-scale": 9000, visible: 1,
        }),
    },
    {
        id: "c17-1",
        label: "C-17 Globemaster",
        fields: buildAssetFields("--wz-startup-c17-1", MOVING_FIELD_TEMPLATE, {
            "start-lon": -81.2, "start-lat": 28.4, "end-lon": -3.7, "end-lat": 40.2,
            "loop-width-km": 420, altitude: 180000, speed: 0.01, phase: 0.2,
            "heading-offset": 90, pitch: 0, roll: 0, scale: 1,
            "min-px": 74, "max-scale": 9000, visible: 1,
        }),
    },
]);

const ENTRY_LAYER_SWITCH_CSS_VARS = new Set([
    "--wz-entry-show-satellites",
    "--wz-entry-show-naval-assets",
    "--wz-entry-show-air-assets",
    "--wz-entry-show-map-imagery",
    "--wz-entry-show-borders",
]);

const tunerState = {
    root: null,
    currentGroupId: "scene",
    globePaused: false,
    assetsPaused: false,
    satellitesPaused: false,
    globeBackup: null,
    touchedCssVars: new Set(),
};

function getRootCssNumber(name, fallback) {
    const value = Number(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
    return Number.isFinite(value) ? value : fallback;
}

function getRootCssFlag(name, fallback = 1) {
    return getRootCssNumber(name, fallback) !== 0;
}

function applyEntryLayerSwitches(changedCssVar = "") {
    if (changedCssVar && !ENTRY_LAYER_SWITCH_CSS_VARS.has(changedCssVar)) return;

    const showSatellites = getRootCssFlag("--wz-entry-show-satellites", 1);
    const showNaval = getRootCssFlag("--wz-entry-show-naval-assets", 1);
    const showAir = getRootCssFlag("--wz-entry-show-air-assets", 1);
    const showMapImagery = getRootCssFlag("--wz-entry-show-map-imagery", 1);
    const showBorders = getRootCssFlag("--wz-entry-show-borders", 0);

    window.__warzoneStartupMilSats?.setEnabled?.(showSatellites);
    window.__warzoneStartupDemoAssets?.syncLayers?.();

    const viewer = window.__warzoneViewer;
    const warzoneApi = viewer?.__warzone || window.__warzone || null;
    warzoneApi?.setEntryMapImageryVisible?.(showMapImagery);
    warzoneApi?.setBorderLayersVisible?.(showBorders, { immediate: true });

    viewer?.scene?.requestRender?.();
}

function decimalsForStep(step) {
    const text = String(step ?? 1);
    return text.includes(".") ? text.split(".")[1].length : 0;
}

function formatValue(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(field.fallback ?? 0);
    return number.toFixed(decimalsForStep(field.step));
}

function currentGroup() {
    return GROUPS.find((group) => group.id === tunerState.currentGroupId) || GROUPS[0];
}

function applyStartupCamera() {
    const viewer = window.__warzoneViewer;
    if (!viewer?.camera) return;
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            getRootCssNumber("--warzone-start-lon", 40.4),
            getRootCssNumber("--warzone-start-lat", 12.3),
            getRootCssNumber("--warzone-start-height", 5200000)
        ),
        orientation: {
            heading: Cesium.Math.toRadians(getRootCssNumber("--warzone-start-heading", 0)),
            pitch: Cesium.Math.toRadians(getRootCssNumber("--warzone-start-pitch", -74)),
            roll: Cesium.Math.toRadians(getRootCssNumber("--warzone-start-roll", 0)),
        },
    });
    viewer.scene?.requestRender?.();
}

function applyStartupGlobeSpeed() {
    const rotation = window.__warzoneViewer?.__warzoneStartupRotation;
    if (!rotation || tunerState.globePaused) return;
    const base = getRootCssNumber("--warzone-startup-rotation-speed", 0.52);
    const multiplier = Math.max(0.1, Math.min(Number(window.__stratopsConfig?.startupRotationMultiplier || 1), 4));
    rotation.speedDeg = Math.max(0.001, Math.min(base * multiplier, 2));
}

function refreshPreview(groupId = tunerState.currentGroupId, changedCssVar = "") {
    if (groupId === "scene") {
        if (!changedCssVar || ENTRY_LAYER_SWITCH_CSS_VARS.has(changedCssVar)) {
            applyEntryLayerSwitches(changedCssVar);
        }

        if (changedCssVar.startsWith("--warzone-start-") && changedCssVar !== "--warzone-startup-rotation-speed") {
            applyStartupCamera();
        }
        applyStartupGlobeSpeed();
        window.refreshWarzoneMilSatsScale?.();
        if (changedCssVar === "--wz-startup-sat-min-lat" || changedCssVar === "--wz-startup-sat-max-lat") {
            window.__warzoneStartupMilSats?.rebuild?.();
        } else {
            window.__warzoneStartupMilSats?.refresh?.();
        }
    }
    if (changedCssVar.endsWith("-phase") && ["awacs", "globalhawk", "f22-1", "f22-2", "f22-3", "b2-1", "b2-2", "kc135-1", "b52-1", "b52-2", "b1-1", "c5-1", "c17-1"].includes(groupId)) {
        window.__warzoneStartupDemoAssets?.setPhase?.(
            groupId,
            getRootCssNumber(changedCssVar, 0)
        );
    } else {
        window.__warzoneStartupDemoAssets?.refresh?.();
    }
    window.__warzoneViewer?.scene?.requestRender?.();
}

function setGlobePaused(paused) {
    const rotation = window.__warzoneViewer?.__warzoneStartupRotation;
    tunerState.globePaused = paused === true;
    if (!rotation) return tunerState.globePaused;
    if (tunerState.globePaused) {
        tunerState.globeBackup = {
            enabled: rotation.enabled,
            paused: rotation.paused,
            speedDeg: rotation.speedDeg,
        };
        rotation.enabled = false;
        rotation.paused = true;
        rotation.speedDeg = 0;
    } else {
        const backup = tunerState.globeBackup;
        rotation.enabled = backup?.enabled !== false;
        rotation.paused = false;
        rotation.speedDeg = Number.isFinite(Number(backup?.speedDeg))
            ? Number(backup.speedDeg)
            : getRootCssNumber("--warzone-startup-rotation-speed", 0.52);
        tunerState.globeBackup = null;
        applyStartupGlobeSpeed();
    }
    window.__warzoneViewer?.scene?.requestRender?.();
    return tunerState.globePaused;
}

function updatePauseButtons() {
    const root = tunerState.root;
    if (!root) return;
    const globe = root.querySelector("[data-startup-action='pause-globe']");
    const assets = root.querySelector("[data-startup-action='pause-assets']");
    const satellites = root.querySelector("[data-startup-action='pause-satellites']");
    if (globe) globe.textContent = tunerState.globePaused ? "Resume Globe" : "Pause Globe";
    if (assets) assets.textContent = tunerState.assetsPaused ? "Resume Aircraft" : "Pause Aircraft";
    if (satellites) satellites.textContent = tunerState.satellitesPaused ? "Resume Satellites" : "Pause Satellites";
}

function setStatus(message = "") {
    const status = tunerState.root?.querySelector("#wz-intro-startup-scene-status");
    if (status) status.textContent = message;
}

function buildCssBlock(groups = [currentGroup()]) {
    const lines = [":root {"];
    groups.forEach((group) => {
        lines.push(`    /* ${group.label} */`);
        group.fields.forEach((field) => {
            const value = getRootCssNumber(field.cssVar, field.fallback);
            lines.push(`    ${field.cssVar}: ${formatValue(value, field)};`);
        });
    });
    lines.push("}");
    return lines.join("\n");
}

function syncOutput(all = false) {
    const output = tunerState.root?.querySelector("#wz-intro-startup-scene-output");
    if (!output) return "";
    const text = buildCssBlock(all ? GROUPS : [currentGroup()]);
    output.value = text;
    return text;
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        setStatus("Copied to clipboard.");
    } catch {
        const output = tunerState.root?.querySelector("#wz-intro-startup-scene-output");
        output?.focus();
        output?.select?.();
        setStatus("Select and copy the generated values.");
    }
}

function renderFields() {
    const root = tunerState.root;
    const fieldsRoot = root?.querySelector("#wz-intro-startup-scene-fields");
    if (!fieldsRoot) return;
    const group = currentGroup();
    fieldsRoot.replaceChildren();

    group.fields.forEach((field) => {
        const row = document.createElement("label");
        row.className = "wz-startup-tuner__field";

        const title = document.createElement("span");
        title.className = "wz-startup-tuner__field-label";
        title.textContent = field.label;

        const controls = document.createElement("span");
        controls.className = "wz-startup-tuner__field-controls";

        const range = document.createElement("input");
        range.type = "range";
        range.min = String(field.min);
        range.max = String(field.max);
        range.step = String(field.step);
        range.setAttribute("aria-label", `${field.label} slider`);

        const number = document.createElement("input");
        number.type = "number";
        number.min = String(field.min);
        number.max = String(field.max);
        number.step = String(field.step);
        number.setAttribute("aria-label", field.label);

        const value = formatValue(getRootCssNumber(field.cssVar, field.fallback), field);
        range.value = value;
        number.value = value;

        const apply = (nextValue, source) => {
            const formatted = formatValue(nextValue, field);
            if (source !== "range") range.value = formatted;
            if (source !== "number") number.value = formatted;
            document.documentElement.style.setProperty(field.cssVar, formatted);
            tunerState.touchedCssVars.add(field.cssVar);
            refreshPreview(group.id, field.cssVar);
            syncOutput(false);
            setStatus(`${field.label}: ${formatted}`);
        };

        range.addEventListener("input", () => apply(range.value, "range"));
        number.addEventListener("input", () => apply(number.value, "number"));
        number.addEventListener("change", () => apply(number.value, "number"));

        controls.append(range, number);
        row.append(title, controls);
        fieldsRoot.appendChild(row);
    });

    syncOutput(false);
}

function resetCurrentGroup() {
    const group = currentGroup();
    group.fields.forEach((field) => {
        document.documentElement.style.removeProperty(field.cssVar);
        tunerState.touchedCssVars.delete(field.cssVar);
    });
    renderFields();
    if (["awacs", "globalhawk", "f22-1", "f22-2", "f22-3"].includes(group.id)) {
        const phaseField = group.fields.find((field) => field.cssVar.endsWith("-phase"));
        if (phaseField) {
            window.__warzoneStartupDemoAssets?.setPhase?.(
                group.id,
                getRootCssNumber(phaseField.cssVar, phaseField.fallback)
            );
        }
    }
    if (group.id === "scene") {
        applyStartupCamera();
        applyEntryLayerSwitches();
        window.__warzoneStartupMilSats?.rebuild?.();
    }
    refreshPreview(group.id);
    setStatus(`${group.label} reset to root.css values.`);
}

function bindPanel(root) {
    const select = root.querySelector("#wz-intro-startup-scene-target");
    if (select) {
        select.replaceChildren(...GROUPS.map((group) => {
            const option = document.createElement("option");
            option.value = group.id;
            option.textContent = group.label;
            return option;
        }));
        select.value = tunerState.currentGroupId;
        select.addEventListener("change", () => {
            tunerState.currentGroupId = select.value || "scene";
            renderFields();
            setStatus(currentGroup().label);
        });
    }

    root.querySelector("[data-startup-action='collapse']")?.addEventListener("click", (event) => {
        const collapsed = root.classList.toggle("is-collapsed");
        event.currentTarget.textContent = collapsed ? "Expand" : "Collapse";
    });

    root.querySelector("[data-startup-action='fullscreen']")?.addEventListener("click", () => {
    const target =
        document.getElementById("warzone-app") ||
        document.getElementById("warzone-globe") ||
        document.documentElement;

    if (!document.fullscreenElement) {
        target.requestFullscreen?.();
        setStatus("Full screen enabled.");
        return;
    }

    document.exitFullscreen?.();
    setStatus("Full screen closed.");
});

    root.querySelector("[data-startup-action='pause-globe']")?.addEventListener("click", () => {
        setGlobePaused(!tunerState.globePaused);
        updatePauseButtons();
    });

    root.querySelector("[data-startup-action='pause-assets']")?.addEventListener("click", () => {
        tunerState.assetsPaused = !tunerState.assetsPaused;
        window.__warzoneStartupDemoAssets?.setPaused?.(tunerState.assetsPaused);
        updatePauseButtons();
    });

    root.querySelector("[data-startup-action='pause-satellites']")?.addEventListener("click", () => {
        tunerState.satellitesPaused = !tunerState.satellitesPaused;
        window.__warzoneStartupMilSats?.setPaused?.(tunerState.satellitesPaused);
        updatePauseButtons();
    });

    root.querySelector("[data-startup-action='reset']")?.addEventListener("click", resetCurrentGroup);
    root.querySelector("[data-startup-action='copy-selected']")?.addEventListener("click", () => {
        void copyText(syncOutput(false));
    });
    root.querySelector("[data-startup-action='copy-all']")?.addEventListener("click", () => {
        void copyText(syncOutput(true));
    });
}

export function initIntroStartupSceneTuner() {
    const root = document.getElementById("wz-intro-startup-scene-tuner");
    if (!root || root.dataset.bound === "1") return root;
    root.dataset.bound = "1";
    tunerState.root = root;
    tunerState.currentGroupId = "scene";
    tunerState.globePaused = false;
    tunerState.assetsPaused = false;
    tunerState.satellitesPaused = false;
    tunerState.touchedCssVars.clear();
    bindPanel(root);
    renderFields();
    applyEntryLayerSwitches();
    updatePauseButtons();
    root.hidden = false;
    setStatus("Entry-scene controls ready.");
    return root;
}

export function destroyIntroStartupSceneTuner() {
    if (tunerState.globePaused) setGlobePaused(false);
    if (tunerState.assetsPaused) window.__warzoneStartupDemoAssets?.setPaused?.(false);
    if (tunerState.satellitesPaused) window.__warzoneStartupMilSats?.setPaused?.(false);
    tunerState.touchedCssVars.forEach((cssVar) => {
        document.documentElement.style.removeProperty(cssVar);
    });
    tunerState.touchedCssVars.clear();
    tunerState.root = null;
    tunerState.globePaused = false;
    tunerState.assetsPaused = false;
    tunerState.satellitesPaused = false;
    tunerState.globeBackup = null;
}
