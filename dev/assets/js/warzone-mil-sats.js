// File Path: /assets/js/warzone-mil-sats.js
import * as Cesium from "cesium";
import { json2satrec } from "../../../node_modules/satellite.js/dist/io.js";
import { propagate } from "../../../node_modules/satellite.js/dist/propagation/propagate.js";
import { gstime } from "../../../node_modules/satellite.js/dist/propagation/gstime.js";
import { eciToGeodetic } from "../../../node_modules/satellite.js/dist/transforms.js";
import {
    getSatelliteModelHeadingDeg,
    getSatelliteModelPitchDeg,
    getSatelliteModelRollDeg,
    getSatelliteModelScale,
    getStartupSatelliteModelProfile,
    resolveSatelliteModelProfile,
} from "./warzone-satellite-models.js";
import { REGIONS, getActiveRegion, requestRegionSwitch } from "./warzone-region-selector.js";
import { getAssetFocusController } from "./warzone-asset-focus-controller.js";

const DEFAULT_API_PATH = "https://api.battlespacex.com/satellites/military";
const EARTH_RADIUS_M = 6371008.8;
const SCENE_MORPH_WAIT_TIMEOUT_MS = 6000;
const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    apiPath: DEFAULT_API_PATH,
    maximumVisibleSatellites: 160,
    sampleIntervalSeconds: 120,
    pastOrbitMinutes: 45,
    futureOrbitMinutes: 60,
    positionRefreshIntervalMs: 30000,
    focusedModelCount: 1,
    showOrbitPath: true,
    showGroundTrack: true,
    showNadirLine: true,
    showTheoreticalFootprint: true,
    showLabels: false,
    minimumClassificationConfidence: "unconfirmed",
    defaultSamplePastMinutes: 8,
    defaultSampleFutureMinutes: 14,
});
const STARTUP_DEMO_SATS = Object.freeze([
    { id: "sat-gulf-1", lat: 24.5, lon: 45.0, altitude: 440000, modelKey: "ge-sar-lupe" },
    { id: "sat-gulf-3", lat: 18.5, lon: 58.5, altitude: 1520000, modelKey: "uk-skynet" },
    { id: "sat-ru-visible-3", lat: 12.5, lon: 66.0, altitude: 2520000, modelKey: "ru-pion-nks" },
    { id: "sat-eu-1", lat: 50.0, lon: 10.0, altitude: 620000, modelKey: "ge-sar-lupe" },
    { id: "sat-eu-2", lat: 51.0, lon: 2.0, altitude: 1500000, modelKey: "fr-cos" },
    { id: "sat-eu-3", lat: 55.0, lon: 20.0, altitude: 1860000, modelKey: "uk-skynet" },
    { id: "sat-eu-4", lat: 59.5, lon: 34.0, altitude: 2480000, modelKey: "ru-pion-nks" },
    { id: "sat-sa-1", lat: 34.5, lon: 76.5, altitude: 500000, modelKey: "us-wgs" },
    { id: "sat-sa-2", lat: 28.8, lon: 84.5, altitude: 1120000, modelKey: "fr-cos" },
    { id: "sat-sa-3", lat: 21.5, lon: 69.5, altitude: 1720000, modelKey: "us-muos" },
    { id: "sat-sa-4", lat: 8.5, lon: 79.5, altitude: 2360000, modelKey: "uk-skynet" },
    { id: "sat-ea-1", lat: 31.2, lon: 122.5, altitude: 680000, modelKey: "us-sbirs-geo" },
    { id: "sat-ea-2", lat: 24.6, lon: 128.0, altitude: 1340000, modelKey: "us-wgs" },
    { id: "sat-ea-3", lat: 14.5, lon: 114.8, altitude: 1980000, modelKey: "us-muos" },
    { id: "sat-ea-4", lat: 39.8, lon: 139.2, altitude: 2600000, modelKey: "fr-cos" },
    { id: "sat-scs-1", lat: 16.2, lon: 111.6, altitude: 920000, modelKey: "ge-sar-lupe" },
    { id: "sat-scs-2", lat: 9.8, lon: 116.4, altitude: 1760000, modelKey: "uk-skynet" },
    { id: "sat-scs-3", lat: 6.8, lon: 120.2, altitude: 2440000, modelKey: "us-sbirs-geo" },
    { id: "sat-cj-1", lat: 28.6, lon: 117.8, altitude: 760000, modelKey: "us-wgs" },
    { id: "sat-cj-2", lat: 33.4, lon: 124.2, altitude: 1480000, modelKey: "ge-sar-lupe" },
    { id: "sat-cj-3", lat: 36.2, lon: 131.4, altitude: 2140000, modelKey: "us-muos" },
    { id: "sat-cj-4", lat: 40.8, lon: 142.6, altitude: 2820000, modelKey: "uk-skynet" },
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
const CONFIDENCE_RANK = Object.freeze({
    "confirmed-public-classification": 4,
    "high-confidence-public-association": 3,
    inferred: 2,
    unconfirmed: 1,
});

const state = {
    viewer: null,
    config: { ...DEFAULT_CONFIG },
    enabled: false,
    loading: false,
    data: null,
    records: [],
    visibleRecords: [],
    entities: new Map(),
    satrecs: new Map(),
    selectedId: "",
    hoveredId: "",
    handler: null,
    refreshTimer: null,
    visibleTimer: null,
    hoverCard: null,
    hoverGuide: null,
    focusCard: null,
    controls: null,
    focusEntities: [],
    focusOwnerSignature: "",
    focusPendingId: "",
    focusRequestToken: 0,
    filters: {
        association: "all",
        country: "all",
        mission: "all",
        orbit: "all",
    },
};
const startupDemoState = {
    enabled: false,
    groups: [],
    frameListener: null,
    lastFrameTime: 0,
};

function mergeConfig() {
    const configured = window.__stratopsConfig?.strategicSatellites || {};
    state.config = {
        ...DEFAULT_CONFIG,
        ...configured,
        enabled: configured.enabled !== false && window.__stratopsConfig?.enableMilSatsLayer !== false,
    };
}

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

function colorFromCss(name, fallback, alpha = 1) {
    return Cesium.Color.fromCssColorString(getCssVar(name, fallback)).withAlpha(alpha);
}

function cleanText(value, fallback = "") {
    return String(value ?? fallback)
        .replace(/[\u0000-\u001f\u007f<>]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function formatUpper(value, fallback = "UNKNOWN") {
    const text = cleanText(value, fallback);
    return (text || fallback).toUpperCase();
}

function formatNumber(value, decimals = 0, fallback = "UNKNOWN") {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(decimals) : fallback;
}

function formatAge(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return "UNKNOWN";
    if (value < 90) return `${Math.max(0, Math.round(value))} SEC`;
    if (value < 7200) return `${Math.round(value / 60)} MIN`;
    if (value < 172800) return `${Math.round(value / 3600)} HR`;
    return `${Math.round(value / 86400)} DAY`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getStartupDemoModelConfig(sat = {}) {
    return getStartupSatelliteModelProfile(sat?.modelKey || 0);
}

function createStartupDemoOrientation(position, sat = {}) {
    const modelCfg = getStartupDemoModelConfig(sat);
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

function createSatelliteModelOrientation(position) {
    if (!position) return undefined;
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const base = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
    const hpr = Cesium.Matrix3.fromHeadingPitchRoll(
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(getSatelliteModelHeadingDeg(0)),
            Cesium.Math.toRadians(getSatelliteModelPitchDeg(-150)),
            Cesium.Math.toRadians(getSatelliteModelRollDeg(-15))
        )
    );
    const final = Cesium.Matrix3.multiply(base, hpr, new Cesium.Matrix3());
    return Cesium.Quaternion.fromRotationMatrix(final);
}

function createSatelliteModelOrientationProperty(positionProperty) {
    return new Cesium.CallbackProperty((time) => {
        const position = positionProperty?.getValue?.(time);
        return position ? createSatelliteModelOrientation(position) : undefined;
    }, false);
}

function createStartupDemoEntity(sat = {}) {
    if (!state.viewer?.entities) return null;
    const modelCfg = getStartupDemoModelConfig(sat);
    const position = Cesium.Cartesian3.fromDegrees(
        Number(sat.lon) || 0,
        Number(sat.lat) || 0,
        Math.max(0, Number(sat.altitude) || 0)
    );
    return state.viewer.entities.add({
        id: `wz-startup-sat-${sat.id}`,
        position,
        orientation: createStartupDemoOrientation(position, sat),
        model: {
            uri: modelCfg.uri,
            scale: getSatelliteModelScale(194000),
            minimumPixelSize: getCssNumber("--warzone-mil-sat-min-px", 20),
            maximumScale: getCssNumber("--warzone-mil-sat-max-scale", 320000),
            shadows: Cesium.ShadowMode.DISABLED,
        },
    });
}

function refreshStartupDemoScale() {
    startupDemoState.groups.forEach((group) => {
        const entity = group?.entity;
        const modelCfg = getStartupDemoModelConfig(group?.satDef);
        if (!entity?.model) return;
        entity.model.uri = modelCfg.uri;
        entity.model.scale = getSatelliteModelScale(194000);
        entity.model.minimumPixelSize = getCssNumber("--warzone-mil-sat-min-px", 20);
        entity.model.maximumScale = getCssNumber("--warzone-mil-sat-max-scale", 320000);
        const position = entity.position?.getValue?.(Cesium.JulianDate.now()) || entity.position;
        if (position) entity.orientation = createStartupDemoOrientation(position, group?.satDef);
    });
    state.viewer?.scene?.requestRender?.();
}

function getStartupDemoRotationDegPerSec() {
    if (window.__stratopsConfig?.milSatsRotation === false) return 0;
    const globeSpeed = Math.max(0.01, Math.min(getCssNumber("--warzone-startup-rotation-speed", 0.52), 0.75));
    const speed = Number(window.__stratopsConfig?.milSatsRotationSpeed);
    const speedRatio = Number.isFinite(speed) && speed > 0 ? Math.max(0.2, speed / 5) : 1;
    return globeSpeed * speedRatio * 1.18;
}

function stopStartupDemo() {
    if (startupDemoState.frameListener && state.viewer?.scene) {
        state.viewer.scene.postRender.removeEventListener(startupDemoState.frameListener);
    }
    startupDemoState.frameListener = null;
    startupDemoState.lastFrameTime = 0;
    startupDemoState.enabled = false;
    startupDemoState.groups.forEach((group) => removeEntity(group?.entity));
    startupDemoState.groups = [];
    state.viewer?.scene?.requestRender?.();
}

export function setWarzoneMilSatsStartupDemoEnabled(enabled) {
    const shouldEnable = enabled !== false;
    if (!shouldEnable) {
        stopStartupDemo();
        return;
    }
    if (!state.viewer || startupDemoState.enabled) return;
    startupDemoState.enabled = true;
    startupDemoState.lastFrameTime = Date.now();
    startupDemoState.groups = STARTUP_DEMO_SATS.map((satDef) => ({
        satDef,
        currentLon: Number(satDef.lon) || 0,
        entity: createStartupDemoEntity(satDef),
    }));
    refreshStartupDemoScale();
    startupDemoState.frameListener = () => {
        if (!startupDemoState.enabled || !state.viewer || document.hidden) return;
        const now = Date.now();
        const last = Number(startupDemoState.lastFrameTime || now);
        startupDemoState.lastFrameTime = now;
        const dt = Math.min(Math.max(0, (now - last) / 1000), 0.1);
        const degPerSec = getStartupDemoRotationDegPerSec();
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
            group.entity.orientation = createStartupDemoOrientation(position, group.satDef);
        });
        state.viewer.scene.requestRender?.();
    };
    state.viewer.scene.postRender.addEventListener(startupDemoState.frameListener);
    state.viewer.scene.requestRender?.();
}

function optionKey(value = "") {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function confidenceRank(value = "") {
    return CONFIDENCE_RANK[optionKey(value)] || 1;
}

function getMinimumConfidenceRank() {
    return confidenceRank(state.config.minimumClassificationConfidence || "unconfirmed");
}

function getSatelliteRecord(id = "") {
    return state.records.find((record) => record.id === id) || null;
}

function getSatrec(record) {
    if (!record?.id || !record?.omm) return null;
    if (state.satrecs.has(record.id)) return state.satrecs.get(record.id);
    try {
        const satrec = json2satrec(record.omm);
        if (!satrec || satrec.error) return null;
        state.satrecs.set(record.id, satrec);
        return satrec;
    } catch {
        return null;
    }
}

function propagateRecord(record, date = new Date()) {
    const satrec = getSatrec(record);
    if (!satrec) return null;
    const pv = propagate(satrec, date);
    if (!pv?.position || !pv?.velocity) return null;
    const gmst = gstime(date);
    const geo = eciToGeodetic(pv.position, gmst);
    const lon = Cesium.Math.toDegrees(geo.longitude);
    const lat = Cesium.Math.toDegrees(geo.latitude);
    const altitudeKm = Number(geo.height);
    if (![lon, lat, altitudeKm].every(Number.isFinite)) return null;
    const velocity = pv.velocity;
    const speedKmS = Math.sqrt(
        (velocity.x * velocity.x) +
        (velocity.y * velocity.y) +
        (velocity.z * velocity.z)
    );
    return {
        date,
        lon,
        lat,
        altitudeKm,
        speedKmS: Number.isFinite(speedKmS) ? speedKmS : null,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(0, altitudeKm * 1000)),
        groundPosition: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
    };
}

function createSampledPosition(record, now = new Date(), pastMinutes, futureMinutes) {
    const property = new Cesium.SampledPositionProperty();
    property.setInterpolationOptions({
        interpolationDegree: 2,
        interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });
    const sampleIntervalSeconds = Math.max(30, Number(state.config.sampleIntervalSeconds) || 120);
    const start = -Math.max(0, Number(pastMinutes) || 0) * 60;
    const end = Math.max(0, Number(futureMinutes) || 0) * 60;
    let sampleCount = 0;
    for (let offset = start; offset <= end; offset += sampleIntervalSeconds) {
        const date = new Date(now.getTime() + offset * 1000);
        const point = propagateRecord(record, date);
        if (!point) continue;
        property.addSample(Cesium.JulianDate.fromDate(date), point.position);
        sampleCount += 1;
    }
    if (sampleCount < 2) return null;
    return property;
}

function createPolylinePositions(record, now, pastMinutes, futureMinutes, altitudeMode = "space") {
    const positions = [];
    const sampleIntervalSeconds = Math.max(45, Number(state.config.sampleIntervalSeconds) || 120);
    const start = -Math.max(0, Number(pastMinutes) || 0) * 60;
    const end = Math.max(0, Number(futureMinutes) || 0) * 60;
    for (let offset = start; offset <= end; offset += sampleIntervalSeconds) {
        const point = propagateRecord(record, new Date(now.getTime() + offset * 1000));
        if (!point) continue;
        positions.push(altitudeMode === "ground" ? point.groundPosition : point.position);
    }
    return positions;
}

function createFootprintCirclePositions(point, radiusMeters, segments = 96) {
    const latRad = Cesium.Math.toRadians(Number(point?.lat || 0));
    const lonRad = Cesium.Math.toRadians(Number(point?.lon || 0));
    const angularDistance = Math.max(0, Number(radiusMeters || 0)) / EARTH_RADIUS_M;
    const positions = [];
    for (let index = 0; index <= segments; index += 1) {
        const bearing = (Math.PI * 2 * index) / segments;
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const sinDistance = Math.sin(angularDistance);
        const cosDistance = Math.cos(angularDistance);
        const nextLat = Math.asin(
            (sinLat * cosDistance) +
            (cosLat * sinDistance * Math.cos(bearing))
        );
        const nextLon = lonRad + Math.atan2(
            Math.sin(bearing) * sinDistance * cosLat,
            cosDistance - (sinLat * Math.sin(nextLat))
        );
        positions.push(Cesium.Cartesian3.fromDegrees(
            Cesium.Math.toDegrees(nextLon),
            Cesium.Math.toDegrees(nextLat),
            0
        ));
    }
    return positions;
}

function getPriorityScore(record) {
    const classification = record?.classification || {};
    const operationalBoost = /operational|extended|backup|standby/i.test(record?.operationalStatus || "") ? 20 : 0;
    const orbitBoost = /leo|geo/i.test(record?.orbitClass || "") ? 8 : 0;
    return confidenceRank(classification.confidence) * 100 + operationalBoost + orbitBoost;
}

function matchesFilters(record) {
    const classification = record?.classification || {};
    if (confidenceRank(classification.confidence) < getMinimumConfidenceRank()) return false;
    if (state.filters.association !== "all" && optionKey(classification.associationLabel || classification.association) !== state.filters.association) return false;
    if (state.filters.country !== "all" && optionKey(record.country || record.ownerCode) !== state.filters.country) return false;
    if (state.filters.mission !== "all" && optionKey(classification.missionLabel || classification.mission) !== state.filters.mission) return false;
    if (state.filters.orbit !== "all" && optionKey(record.orbitClass) !== state.filters.orbit) return false;
    return true;
}

function chooseVisibleRecords(records = []) {
    const limit = Math.max(20, Math.min(600, Number(state.config.maximumVisibleSatellites) || DEFAULT_CONFIG.maximumVisibleSatellites));
    return records
        .filter((record) => getSatrec(record))
        .filter(matchesFilters)
        .sort((a, b) => getPriorityScore(b) - getPriorityScore(a) || String(a.name).localeCompare(String(b.name)))
        .slice(0, limit);
}

function getRegionArea(region = null) {
    const bounds = region?.bounds || {};
    const lonSpan = Number(bounds.maxLon) - Number(bounds.minLon);
    const latSpan = Number(bounds.maxLat) - Number(bounds.minLat);
    if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan) || lonSpan <= 0 || latSpan <= 0) return Number.POSITIVE_INFINITY;
    return lonSpan * latSpan;
}

function resolveSatelliteMonitoringRegion(point = null) {
    const lon = Number(point?.lon);
    const lat = Number(point?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const containsPoint = (region) => {
        const bounds = region?.bounds || {};
        return (
            lon >= Number(bounds.minLon) &&
            lon <= Number(bounds.maxLon) &&
            lat >= Number(bounds.minLat) &&
            lat <= Number(bounds.maxLat)
        );
    };
    const activeRegion = getActiveRegion?.();
    if (activeRegion?.id && activeRegion.id !== "global" && containsPoint(activeRegion)) {
        return activeRegion;
    }
    const matches = REGIONS
        .filter((region) => region?.id && region.id !== "global")
        .filter(containsPoint)
        .sort((a, b) => getRegionArea(a) - getRegionArea(b));
    return matches[0] || null;
}

function getSatelliteRegionGroups(records = state.visibleRecords) {
    const groups = new Map();
    const now = new Date();
    (Array.isArray(records) ? records : []).forEach((record) => {
        const point = propagateRecord(record, now);
        if (!point) return;
        const region = resolveSatelliteMonitoringRegion(point);
        const key = region?.id || "outside";
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                region,
                label: region?.label || "Outside Defined Regions",
                records: [],
            });
        }
        groups.get(key).records.push({ record, point });
    });
    const activeRegionId = getActiveRegion?.()?.id || "";
    return [...groups.values()].sort((a, b) => {
        const aCurrent = a.region?.id === activeRegionId ? 1 : 0;
        const bCurrent = b.region?.id === activeRegionId ? 1 : 0;
        if (aCurrent !== bCurrent) return bCurrent - aCurrent;
        if (!!a.region !== !!b.region) return a.region ? -1 : 1;
        if (b.records.length !== a.records.length) return b.records.length - a.records.length;
        return a.label.localeCompare(b.label);
    });
}

function renderSatelliteRegionList() {
    const controls = ensureControls();
    const list = controls?.querySelector?.(".wz-orbital-regions__list");
    const meta = controls?.querySelector?.(".wz-orbital-regions__meta");
    if (!list || !meta) return;
    if (!state.enabled) {
        meta.textContent = "Layer off";
        list.replaceChildren();
        return;
    }
    const groups = getSatelliteRegionGroups(state.visibleRecords);
    const mappedCount = groups.reduce((sum, group) => sum + (group.region ? group.records.length : 0), 0);
    meta.textContent = state.loading
        ? "Updating propagated positions"
        : `${mappedCount}/${state.visibleRecords.length} visible assets inside monitoring regions`;
    list.replaceChildren();
    if (!groups.length) {
        const empty = document.createElement("div");
        empty.className = "wz-orbital-regions__empty";
        empty.textContent = state.loading ? "Locating satellites..." : "No visible satellites are currently inside a defined monitoring region.";
        list.appendChild(empty);
        return;
    }
    const activeRegionId = getActiveRegion?.()?.id || "";
    groups.forEach((group) => {
        const row = document.createElement("article");
        row.className = "wz-orbital-region-row";
        if (group.region?.id === activeRegionId) row.classList.add("is-current");

        const copy = document.createElement("div");
        copy.className = "wz-orbital-region-row__copy";
        const head = document.createElement("div");
        head.className = "wz-orbital-region-row__head";
        const title = document.createElement("strong");
        title.textContent = formatUpper(group.label);
        const count = document.createElement("span");
        count.textContent = `${group.records.length} SAT${group.records.length === 1 ? "" : "S"}`;
        head.appendChild(title);
        head.appendChild(count);

        const names = document.createElement("p");
        const visibleNames = group.records
            .slice(0, 3)
            .map(({ record }) => formatUpper(record.name || record.objectName || record.noradId));
        const remaining = Math.max(0, group.records.length - visibleNames.length);
        names.textContent = `${visibleNames.join(" • ")}${remaining ? ` • +${remaining} MORE` : ""}`;
        copy.appendChild(head);
        copy.appendChild(names);
        row.appendChild(copy);

        if (group.region && group.records.length) {
            const action = document.createElement("button");
            const isCurrent = group.region.id === activeRegionId;
            const primaryRecord = group.records[0]?.record;
            const focusBlocked = Boolean(state.focusPendingId) || !primaryRecord || !getAssetFocusController().canEnterFocus({
                assetType: "satellite",
                assetId: primaryRecord.id,
            });
            action.type = "button";
            action.className = isCurrent ? "btn-secondary white wz-orbital-region-row__action" : "btn-primary wz-orbital-region-row__action";
            action.innerHTML = `<span aria-hidden="true"></span>${isCurrent ? "View" : "Switch Region"}`;
            action.setAttribute("aria-label", isCurrent
                ? `View a satellite currently over ${group.label}`
                : `Switch monitoring region to ${group.label} to view satellites`);
            action.disabled = focusBlocked;
            action.setAttribute("aria-disabled", focusBlocked ? "true" : "false");
            action.addEventListener("click", () => {
                if (!primaryRecord || focusBlocked) return;
                if (isCurrent) {
                    selectSatellite(primaryRecord.id);
                    return;
                }

                // A region switch must never begin while the camera is still tracking
                // a focused satellite. Release the tracked/selected entity immediately
                // before opening the region confirmation prompt.
                selectSatellite("", { flyOut: false });

                void requestRegionSwitch(state.viewer, group.region.id, {
                    source: "orbital-satellite-region",
                    contextLabel: `${group.records.length} satellite${group.records.length === 1 ? "" : "s"} currently over ${group.label}`,
                    onSwitched: () => {
                        updateControlsOptions();
                        window.setTimeout(() => selectSatellite(primaryRecord.id), 180);
                    },
                });
            });
            row.appendChild(action);
        }
        list.appendChild(row);
    });
}

function removeEntity(entity) {
    try {
        if (entity && state.viewer?.entities?.contains?.(entity)) {
            state.viewer.entities.remove(entity);
        }
    } catch {
        // Ignore Cesium cleanup races during scene shutdown.
    }
}

function clearFocusEntities() {
    state.focusEntities.forEach(removeEntity);
    state.focusEntities = [];
}

function ensureHoverCard() {
    if (state.hoverCard) return state.hoverCard;
    const card = document.createElement("div");
    card.className = "wz-orbital-hover-card";
    card.hidden = true;
    document.body.appendChild(card);
    state.hoverCard = card;
    return card;
}

function getOrCreateHoverGuide() {
    if (state.hoverGuide?.isConnected) return state.hoverGuide;
    const host =
        state.viewer?.container ||
        state.viewer?.scene?.canvas?.parentElement ||
        null;
    if (!host) return null;

    const guide = document.createElement("div");
    guide.className = "wz-aircraft-focus-guides is-hover";
    guide.setAttribute("aria-hidden", "true");
    guide.innerHTML = `
        <span class="wz-aircraft-focus-guides__line is-top-left"></span>
        <span class="wz-aircraft-focus-guides__line is-top-right"></span>
        <span class="wz-aircraft-focus-guides__line is-bottom-left"></span>
        <span class="wz-aircraft-focus-guides__line is-bottom-right"></span>
    `;
    host.appendChild(guide);
    state.hoverGuide = guide;
    return guide;
}

function hideHoverGuide() {
    if (!state.hoverGuide) return;
    state.hoverGuide.classList.remove("is-visible");
    state.hoverGuide.style.display = "none";
}

function showHoverGuide(screenPosition = null) {
    if (
        !screenPosition ||
        !Number.isFinite(screenPosition.x) ||
        !Number.isFinite(screenPosition.y)
    ) {
        hideHoverGuide();
        return;
    }

    const guide = getOrCreateHoverGuide();
    if (!guide) return;

    guide.style.left = `${screenPosition.x}px`;
    guide.style.top = `${screenPosition.y}px`;
    guide.style.display = "block";
    guide.classList.add("is-visible");
}

function hideHoverCard() {
    if (state.hoverCard) state.hoverCard.hidden = true;
}

function getOrbitalWidget() {
    return document.querySelector('[data-widget-id="orbital"]');
}

function showOrbitalWidget({ expand = false } = {}) {
    const widget = getOrbitalWidget();
    if (!widget) return;
    widget.classList.remove("wz-is-hidden");
    if (expand) {
        widget.classList.remove("is-collapsed");
        const content = widget.querySelector(".panel-content");
        const collapseBtn = widget.querySelector("[data-panel-collapse]");
        const icon = collapseBtn?.querySelector("span");
        if (collapseBtn) collapseBtn.setAttribute("aria-expanded", "true");
        if (icon) {
            icon.classList.remove("stratops-ico-close-1");
            icon.classList.add("stratops-ico-top-1");
        }
        if (content) {
            content.hidden = false;
            content.style.height = "";
            content.style.opacity = "";
        }
    }
    window.__syncWarzoneDock?.();
}

function hideOrbitalWidget() {
    const widget = getOrbitalWidget();
    if (!widget) return;
    widget.classList.add("wz-is-hidden");
    window.__syncWarzoneDock?.();
}

function buildValueRow(label, value) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = cleanText(value, "UNKNOWN") || "UNKNOWN";
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
}

function showHoverCard(record, movement) {
    const card = ensureHoverCard();
    const point = propagateRecord(record, new Date());
    const classification = record.classification || {};

    card.replaceChildren();

    const header = document.createElement("div");
    header.className = "wz-orbital-hover-card__header";

    const icon = document.createElement("div");
    icon.className = "static-icon stratops-ico-assets-recon-intel-1";

    const titleGroup = document.createElement("div");
    titleGroup.className = "wz-orbital-hover-card__title-group";

    const title = document.createElement("h3");
    title.textContent = formatUpper(
        record.name || record.objectName || record.noradId
    );

    const sub = document.createElement("span");
    sub.textContent =
        `${formatUpper(
            classification.associationLabel || "PUBLIC ORBITAL ESTIMATE"
        )} / ${formatUpper(record.orbitClass)}`;

    titleGroup.appendChild(title);
    titleGroup.appendChild(sub);

    header.appendChild(icon);
    header.appendChild(titleGroup);

    const list = document.createElement("dl");

    [
        ["MISSION", classification.missionLabel || "Mission unconfirmed"],
        ["CONFIDENCE", classification.confidenceLabel || "Unconfirmed"],
        ["COUNTRY/OWNER", record.country || record.ownerCode || "Unknown"],
        ["NORAD", record.noradId],
        ["INTL ID", record.internationalDesignator || "Unknown"],
        ["ALTITUDE", point ? `${formatNumber(point.altitudeKm, 0)} KM` : "UNKNOWN"],
        ["SPEED", point?.speedKmS ? `${formatNumber(point.speedKmS, 2)} KM/S` : "UNKNOWN"],
        ["INCLINATION", `${formatNumber(record.orbital?.inclinationDeg, 1)} DEG`],
        ["EPOCH", record.orbital?.epoch || "Unknown"],
        ["DATA AGE", formatAge(state.data?.cacheAgeSeconds)],
        ["SOURCE", "CelesTrak public GP elements"],
    ].forEach(([label, value]) => {
        list.appendChild(buildValueRow(label, value));
    });

    const note = document.createElement("p");
    note.textContent =
        "Positions are propagated estimates, not direct sensor detections.";

    card.appendChild(header);
    card.appendChild(list);
    card.appendChild(note);

    const rect = state.viewer?.scene?.canvas?.getBoundingClientRect?.();

    const x =
        Number(movement?.endPosition?.x ?? movement?.position?.x ?? 0) +
        (rect?.left || 0);

    const y =
        Number(movement?.endPosition?.y ?? movement?.position?.y ?? 0) +
        (rect?.top || 0);

    card.style.left =
        `${Math.min(window.innerWidth - 340, Math.max(12, x + 18))}px`;

    card.style.top =
        `${Math.min(window.innerHeight - 420, Math.max(12, y + 18))}px`;

    card.hidden = false;
}

function ensureFocusCard() {
    ensureControls();
    return state.focusCard;
}

function hideFocusCard() {
    if (state.focusCard) state.focusCard.hidden = true;
}

function flyToSatelliteOverview(record = null) {
    if (!state.viewer?.camera) return;

    const viewer = state.viewer;
    const point = record ? propagateRecord(record, new Date()) : null;

    const lon = Number(point?.lon ?? record?.lon);
    const lat = Number(point?.lat ?? record?.lat);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    const height = Math.max(
        1200000,
        getCssNumber("--warzone-orbital-unfocus-camera-height", 3200000)
    );

    const duration = Math.max(
        0.4,
        getCssNumber("--warzone-orbital-unfocus-camera-duration", 1.15)
    );

    try {
        viewer.camera.cancelFlight?.();
        viewer.trackedEntity = undefined;
        viewer.selectedEntity = undefined;
    } catch { }

    try {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                lon,
                lat,
                height
            ),
            orientation: {
                heading: 0,
                pitch: Cesium.Math.toRadians(-90),
                roll: 0,
            },
            duration,
            complete: () => {
                viewer.trackedEntity = undefined;
                viewer.selectedEntity = undefined;
                viewer.scene?.requestRender?.();
            },
            cancel: () => {
                viewer.trackedEntity = undefined;
                viewer.selectedEntity = undefined;
                viewer.scene?.requestRender?.();
            },
        });
    } catch {
        viewer.scene?.requestRender?.();
    }
}
function showFocusCard(record) {
    const card = ensureFocusCard();
    if (!card) return;
    const point = propagateRecord(record, new Date());
    const monitoringRegion = resolveSatelliteMonitoringRegion(point);
    const classification = record.classification || {};
    const title = card.querySelector(".wz-orbital-widget__details-title");
    const kicker = card.querySelector(".wz-orbital-widget__details-kicker");
    const grid = card.querySelector(".wz-orbital-widget__details-grid");
    const note = card.querySelector(".wz-orbital-widget__details-note");
    if (title) {
        title.textContent = formatUpper(record.name || record.objectName || record.noradId);
    }
    if (kicker) {
        kicker.textContent = "FOCUSED ASSET / PUBLIC ORBITAL ESTIMATE";
    }
    if (grid) {
        const items = [
            ["CLASSIFICATION", classification.associationLabel || "Military-associated"],
            ["MISSION", classification.missionLabel || "Mission unconfirmed"],
            ["CONFIDENCE", classification.confidenceLabel || "Unconfirmed"],
            ["COUNTRY/OWNER", record.country || record.ownerCode || "Unknown"],
            ["OPERATOR", record.operator || "Unknown"],
            ["STATUS", record.operationalStatus || "Unknown"],
            ["NORAD", record.noradId],
            ["INTL DESIGNATOR", record.internationalDesignator || "Unknown"],
            ["ORBIT", record.orbitClass || "Other / unclassified orbit"],
            ["ALTITUDE", point ? `${formatNumber(point.altitudeKm, 0)} KM` : "Unknown"],
            ["PERIOD", Number.isFinite(Number(record.orbital?.periodMinutes))
                ? `${formatNumber(record.orbital.periodMinutes, 1)} MIN`
                : "Unknown"],
            ["REGION", monitoringRegion?.label || "Outside defined regions"],
            ["SPEED", point?.speedKmS ? `${formatNumber(point.speedKmS, 2)} KM/S` : "Unknown"],
            ["INCLINATION", `${formatNumber(record.orbital?.inclinationDeg, 1)} DEG`],
            ["ELEMENT EPOCH", record.orbital?.epoch || "Unknown"],
            ["DATA AGE", formatAge(state.data?.cacheAgeSeconds)],
            ["SOURCE STATUS", state.data?.sourceStatus || "Unknown"],
            ["SOURCE", "CelesTrak public GP elements"],
        ];
        grid.replaceChildren();
        items.forEach(([label, value]) => {
            const span = document.createElement("span");
            span.dataset.label = label;
            span.textContent = cleanText(value, "UNKNOWN") || "UNKNOWN";
            grid.appendChild(span);
        });
    }
    if (note) {
        note.textContent = "Position is propagated from public orbital elements and is not a direct sensor detection. Classification, mission, and operational status may be incomplete or inferred.";
    }
    showOrbitalWidget({ expand: true });
    card.hidden = false;
    card.classList.remove("is-focus-arriving");
    void card.offsetWidth;
    card.classList.add("is-focus-arriving");

    const panelContent = card.closest(".panel-content");
    window.requestAnimationFrame(() => {
        if (typeof panelContent?.scrollTo === "function") {
            panelContent.scrollTo({
                top: 0,
                behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
            });
        } else if (panelContent) {
            panelContent.scrollTop = 0;
        }
    });
}

function entityForPick(picked) {
    const entity = picked?.id || picked?.primitive?.id;
    if (!entity?.__wzOrbitalId) return null;
    return entity;
}

function handleMouseMove(movement) {
    if (!state.enabled || !state.viewer) return;
    const picked = state.viewer.scene.pick(movement.endPosition);
    const entity = entityForPick(picked);
    if (!entity) {
        state.hoveredId = "";
        state.viewer.scene.canvas.style.cursor = "";
        hideHoverGuide();
        hideHoverCard();
        return;
    }
    const record = getSatelliteRecord(entity.__wzOrbitalId);
    if (!record) return;
    state.hoveredId = record.id;
    state.viewer.scene.canvas.style.cursor = "pointer";
    showHoverGuide(movement.endPosition);
    showHoverCard(record, movement);
    state.viewer.scene.requestRender?.();
}

function handleClick(movement) {
    if (!state.enabled || !state.viewer) return;
    const picked = state.viewer.scene.pick(movement.position);
    const entity = entityForPick(picked);
    if (!entity) return;
    hideHoverGuide();
    hideHoverCard();
    selectSatellite(entity.__wzOrbitalId);
}

function ensureHandler() {
    if (state.handler || !state.viewer) return;
    state.handler = new Cesium.ScreenSpaceEventHandler(state.viewer.scene.canvas);
    state.handler.setInputAction(handleMouseMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    state.handler.setInputAction(handleClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function destroyHandler() {
    try {
        state.handler?.destroy?.();
    } catch {
        // ignore
    }
    state.handler = null;
}

function makePointEntity(record, positionProperty) {
    const modelProfile = resolveSatelliteModelProfile(record);
    const point = state.viewer.entities.add({
        id: `wz-orbital-${record.noradId}`,
        position: positionProperty,
        orientation: createSatelliteModelOrientationProperty(positionProperty),
        model: {
            uri: modelProfile.uri,
            scale: getSatelliteModelScale(getCssNumber("--warzone-orbital-model-scale", 170000)),
            minimumPixelSize: getCssNumber("--warzone-orbital-model-min-px", 18),
            maximumScale: getCssNumber("--warzone-orbital-model-max-scale", 260000),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, getCssNumber("--warzone-orbital-max-visible-distance", 26000000)),
            shadows: Cesium.ShadowMode.DISABLED,
        },
        label: {
            text: formatUpper(record.name || record.noradId),
            show: !!state.config.showLabels,
            font: `${getCssNumber("--warzone-orbital-label-size", 10)}px var(--text-font)`,
            fillColor: colorFromCss("--warzone-orbital-label-color", "#9fd7ff", 0.86),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            scaleByDistance: new Cesium.NearFarScalar(800000, 1, 8000000, 0.35),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4500000),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    point.__wzOrbitalId = record.id;
    return point;
}

function removeMissingEntities(nextIds) {
    for (const [id, entry] of state.entities) {
        if (nextIds.has(id)) continue;
        removeEntity(entry.point);
        state.entities.delete(id);
    }
}

function updateDefaultEntities() {
    if (!state.enabled || !state.viewer) return;
    const now = new Date();
    const nextIds = new Set();
    state.visibleRecords.forEach((record) => {
        const position = createSampledPosition(
            record,
            now,
            state.config.defaultSamplePastMinutes,
            state.config.defaultSampleFutureMinutes
        );
        if (!position) return;
        nextIds.add(record.id);
        const existing = state.entities.get(record.id);
        if (existing?.point) {
            const modelProfile = resolveSatelliteModelProfile(record);
            existing.point.position = position;
            existing.point.orientation = createSatelliteModelOrientationProperty(position);
            if (existing.point.model) {
                existing.point.model.uri = modelProfile.uri;
                existing.point.model.scale = getSatelliteModelScale(getCssNumber("--warzone-orbital-model-scale", 170000));
                existing.point.model.minimumPixelSize = getCssNumber("--warzone-orbital-model-min-px", 18);
                existing.point.model.maximumScale = getCssNumber("--warzone-orbital-model-max-scale", 260000);
            }
            existing.point.show = record.id !== state.selectedId;
            return;
        }
        const point = makePointEntity(record, position);
        point.show = record.id !== state.selectedId;
        state.entities.set(record.id, { record, point });
    });
    removeMissingEntities(nextIds);
    state.viewer.scene.requestRender?.();
}

function updateVisibleRecords() {
    state.visibleRecords = chooseVisibleRecords(state.records);
    if (state.selectedId && !getSatelliteRecord(state.selectedId)) {
        selectSatellite("", { flyOut: false });
    }
    updateDefaultEntities();
    updateControlsOptions();
}

function setStatusText(text) {
    if (!state.controls) return;
    const status = state.controls.querySelector(".wz-orbital-controls__status");
    if (status) status.textContent = text;
}

function createSelect(id, label) {
    const wrap = document.createElement("label");
    wrap.className = "wz-orbital-controls__field";
    const span = document.createElement("span");
    span.textContent = label;
    const selectorWrap = document.createElement("span");
    selectorWrap.className = "wz-selector";
    const select = document.createElement("select");
    select.id = id;
    select.className = "wz--dropdown";
    select.setAttribute("aria-label", `Filter orbital assets by ${label.toLowerCase()}`);
    wrap.appendChild(span);
    selectorWrap.appendChild(select);
    wrap.appendChild(selectorWrap);
    select.addEventListener("change", () => {
        const key = id.replace("wz-orbital-filter-", "");
        state.filters[key] = String(select.value || "all");
        updateVisibleRecords();
        selectSatellite("", { flyOut: false });
    });
    return wrap;
}

function ensureControls() {
    if (state.controls?.isConnected) return state.controls;
    const panel = document.getElementById("wz-orbital-panel");
    if (!panel) return null;
    const controls = document.createElement("div");
    controls.className = "wz-orbital-widget";
    const head = document.createElement("div");
    head.className = "wz-orbital-controls__head";
    const title = document.createElement("h3");
    title.textContent = "Orbital Assets";
    const status = document.createElement("span");
    status.className = "wz-orbital-controls__status";
    status.textContent = "Layer off";
    head.appendChild(title);
    head.appendChild(status);
    const grid = document.createElement("div");
    grid.className = "wz-orbital-controls__grid";
    grid.appendChild(createSelect("wz-orbital-filter-association", "Class"));
    grid.appendChild(createSelect("wz-orbital-filter-country", "Country"));
    grid.appendChild(createSelect("wz-orbital-filter-mission", "Mission"));
    grid.appendChild(createSelect("wz-orbital-filter-orbit", "Orbit"));
    const note = document.createElement("p");
    note.textContent = "Orbital data: CelesTrak / public GP elements.";
    const controlsPanel = document.createElement("section");
    controlsPanel.className = "wz-orbital-controls";
    controlsPanel.appendChild(head);
    controlsPanel.appendChild(grid);
    controlsPanel.appendChild(note);

    const regions = document.createElement("section");
    regions.className = "wz-orbital-regions";
    regions.innerHTML = `
        <div class="wz-orbital-regions__head">
            <h3>Current Satellite Regions</h3>
            <span class="wz-orbital-regions__meta">Locating satellites...</span>
        </div>
        <div class="wz-orbital-regions__list" aria-live="polite"></div>
    `;

    const summary = document.createElement("section");
    summary.className = "wz-orbital-widget__summary";
    summary.innerHTML = `
        <h3>Operational Overlay</h3>
        <div class="wz-orbital-widget__summary-body">
            <div class="wz-orbital-widget__summary-head">
                <span class="wz-orbital-widget__summary-status">Layer off</span>
            </div>
            <div class="wz-orbital-widget__summary-grid"></div>
            <p class="wz-orbital-widget__summary-note">Enable the layer to view publicly tracked military-associated orbital assets.</p>
        </div>
    `;

    const details = document.createElement("section");
    details.className = "wz-orbital-widget__details";
    details.hidden = true;
    details.innerHTML = `
        <div class="wz-orbital-widget__details-head">
            <div>
                <span class="wz-orbital-widget__details-kicker">PUBLIC ORBITAL ESTIMATE</span>
                <h3 class="wz-orbital-widget__details-title">UNSPECIFIED ASSET</h3>
            </div>
            <button type="button" class="btn-secondary white wz-orbital-widget__details-close"
                aria-label="Unfocus satellite"><span aria-hidden="true"></span>Unfocus</button>
        </div>
        <div class="wz-orbital-widget__details-grid"></div>
        <p class="wz-orbital-widget__details-note"></p>
    `;
    details.querySelector(".wz-orbital-widget__details-close")?.addEventListener("click", () => selectSatellite("", { flyOut: true }));

    controlsPanel.insertBefore(details, grid);
    controls.appendChild(controlsPanel);
    controls.appendChild(regions);
    controls.appendChild(summary);
    panel.replaceChildren(controls);
    state.controls = controls;
    state.focusCard = details;
    return controls;
}

function setSelectOptions(select, options, allLabel) {
    if (!select) return;
    const current = select.value || "all";
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = allLabel;
    select.appendChild(all);
    options.forEach(({ key, label }) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = label;
        select.appendChild(option);
    });
    select.value = [...select.options].some((option) => option.value === current) ? current : "all";
}

function buildOptions(records, getter) {
    const map = new Map();
    records.forEach((record) => {
        const label = cleanText(getter(record));
        const key = optionKey(label);
        if (!label || key === "unknown") return;
        map.set(key, formatUpper(label));
    });
    return [...map.entries()]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

function updateControlsOptions() {
    const controls = ensureControls();
    if (!controls) return;
    showOrbitalWidget({ expand: state.enabled });
    setStatusText(state.loading
        ? "Loading"
        : `${state.visibleRecords.length}/${state.records.length} public orbital estimates`);
    setSelectOptions(
        controls.querySelector("#wz-orbital-filter-association"),
        buildOptions(state.records, (record) => record.classification?.associationLabel),
        "All Classes"
    );
    setSelectOptions(
        controls.querySelector("#wz-orbital-filter-country"),
        buildOptions(state.records, (record) => record.country || record.ownerCode),
        "All Countries"
    );
    setSelectOptions(
        controls.querySelector("#wz-orbital-filter-mission"),
        buildOptions(state.records, (record) => record.classification?.missionLabel),
        "All Missions"
    );
    setSelectOptions(
        controls.querySelector("#wz-orbital-filter-orbit"),
        buildOptions(state.records, (record) => record.orbitClass),
        "All Orbits"
    );
    const summaryStatus = controls.querySelector(".wz-orbital-widget__summary-status");
    const summaryGrid = controls.querySelector(".wz-orbital-widget__summary-grid");
    const summaryNote = controls.querySelector(".wz-orbital-widget__summary-note");
    if (summaryStatus) {
        summaryStatus.textContent = state.loading
            ? "Loading"
            : `${state.visibleRecords.length}/${state.records.length} public orbital estimates`;
    }
    if (summaryGrid) {
        const selected = getSatelliteRecord(state.selectedId);
        const items = [
            ["VISIBLE", `${state.visibleRecords.length}/${state.records.length}`],
            ["DATA AGE", formatAge(state.data?.cacheAgeSeconds)],
            ["SOURCE", state.data?.sourceStatus || "READY"],
            ["SELECTION", selected ? formatUpper(selected.name || selected.noradId) : "NONE"],
        ];
        summaryGrid.replaceChildren();
        items.forEach(([label, value]) => {
            const span = document.createElement("span");
            span.dataset.label = label;
            span.textContent = cleanText(value, "UNKNOWN") || "UNKNOWN";
            summaryGrid.appendChild(span);
        });
    }
    if (summaryNote) {
        summaryNote.textContent = state.selectedId
            ? "Focused asset details are shown above the filters. Orbital positions are propagated estimates from public orbital elements."
            : "Orbital positions are propagated estimates from public GP elements and are not direct sensor detections.";
    }
    renderSatelliteRegionList();
}

async function fetchOrbitalData() {
    if (!state.enabled || state.loading) return;
    state.loading = true;
    updateControlsOptions();
    try {
        const response = await fetch(state.config.apiPath || DEFAULT_API_PATH, {
            headers: { accept: "application/json" },
            cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const records = Array.isArray(payload?.satellites) ? payload.satellites : [];
        state.data = payload;
        state.records = records;
        state.satrecs.clear();
        updateVisibleRecords();
        setStatusText(payload.stale
            ? `Cached public orbital data / ${formatAge(payload.cacheAgeSeconds)} old`
            : `${state.visibleRecords.length}/${state.records.length} public orbital estimates`);
    } catch {
        setStatusText(state.records.length
            ? "Using cached public orbital data"
            : "Orbital data temporarily unavailable");
    } finally {
        state.loading = false;
        updateControlsOptions();
    }
}

function addFocusEntity(entity) {
    if (entity) state.focusEntities.push(entity);
    return entity;
}

function updateSelectedSatellitePosition() {
    if (!state.viewer || !state.selectedId) return false;
    const record = getSatelliteRecord(state.selectedId);
    if (!record) return false;
    const now = new Date();
    const selected = state.viewer.entities?.getById?.(`wz-orbital-selected-${record.noradId}`);
    if (!selected) return false;
    const position = createSampledPosition(record, now, 4, 18);
    if (!position) return false;
    selected.position = position;
    selected.orientation = createSatelliteModelOrientationProperty(position);
    showFocusCard(record);
    updateControlsOptions();
    state.viewer.scene?.requestRender?.();
    return true;
}

function addOrbitContext(record, now, selectedPosition) {
    if (!state.viewer) return;
    const orbitColor = colorFromCss("--warzone-orbital-path-color", "#9fd7ff", getCssNumber("--warzone-orbital-path-alpha", 0.34));
    const predictedColor = colorFromCss("--warzone-orbital-predicted-color", "#e7edf5", getCssNumber("--warzone-orbital-predicted-alpha", 0.26));
    const groundColor = colorFromCss("--warzone-orbital-ground-track-color", "#18e2db", getCssNumber("--warzone-orbital-ground-track-alpha", 0.24));
    const nadirColor = colorFromCss("--warzone-orbital-nadir-color", "#9fd7ff", getCssNumber("--warzone-orbital-nadir-alpha", 0.3));

    if (state.config.showOrbitPath) {
        const recent = createPolylinePositions(record, now, Number(state.config.pastOrbitMinutes) || 45, 0, "space");
        const future = createPolylinePositions(record, now, 0, Number(state.config.futureOrbitMinutes) || 60, "space");
        if (recent.length > 1) {
            addFocusEntity(state.viewer.entities.add({
                id: `wz-orbital-path-past-${record.noradId}`,
                polyline: {
                    positions: recent,
                    width: getCssNumber("--warzone-orbital-path-width", 1.4),
                    material: orbitColor,
                    arcType: Cesium.ArcType.NONE,
                },
            }));
        }
        if (future.length > 1) {
            addFocusEntity(state.viewer.entities.add({
                id: `wz-orbital-path-future-${record.noradId}`,
                polyline: {
                    positions: future,
                    width: getCssNumber("--warzone-orbital-path-width", 1.4),
                    material: predictedColor,
                    arcType: Cesium.ArcType.NONE,
                },
            }));
            const labelPoint = future[Math.min(3, future.length - 1)];
            addFocusEntity(state.viewer.entities.add({
                id: `wz-orbital-path-label-${record.noradId}`,
                position: labelPoint,
                label: {
                    text: "PREDICTED ORBIT",
                    font: `${getCssNumber("--warzone-orbital-label-size", 10)}px var(--text-font)`,
                    fillColor: predictedColor.withAlpha(0.82),
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
            }));
        }
    }

    if (state.config.showGroundTrack) {
        const ground = createPolylinePositions(
            record,
            now,
            Number(state.config.pastOrbitMinutes) || 45,
            Number(state.config.futureOrbitMinutes) || 60,
            "ground"
        );
        if (ground.length > 1) {
            addFocusEntity(state.viewer.entities.add({
                id: `wz-orbital-ground-track-${record.noradId}`,
                polyline: {
                    positions: ground,
                    width: getCssNumber("--warzone-orbital-ground-track-width", 1),
                    material: groundColor,
                    clampToGround: true,
                },
            }));
        }
    }

    const current = propagateRecord(record, now);
    if (!current) return;
    addFocusEntity(state.viewer.entities.add({
        id: `wz-orbital-ground-point-${record.noradId}`,
        position: current.groundPosition,
        point: {
            pixelSize: getCssNumber("--warzone-orbital-ground-point-size", 7),
            color: groundColor.withAlpha(0.82),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    }));

    if (state.config.showNadirLine) {
        addFocusEntity(state.viewer.entities.add({
            id: `wz-orbital-nadir-${record.noradId}`,
            polyline: {
                positions: [selectedPosition, current.groundPosition],
                width: getCssNumber("--warzone-orbital-nadir-width", 1),
                material: nadirColor,
                arcType: Cesium.ArcType.NONE,
            },
        }));
    }

    if (state.config.showTheoreticalFootprint) {
        const altitudeM = Math.max(0, current.altitudeKm * 1000);
        const horizonAngle = Math.acos(clamp(EARTH_RADIUS_M / (EARTH_RADIUS_M + altitudeM), -1, 1));
        const groundRadius = Math.max(10000, EARTH_RADIUS_M * horizonAngle);
        addFocusEntity(state.viewer.entities.add({
            id: `wz-orbital-footprint-${record.noradId}`,
            position: current.groundPosition,
            ellipse: {
                semiMajorAxis: groundRadius,
                semiMinorAxis: groundRadius,
                height: 0,
                material: colorFromCss("--warzone-orbital-footprint-color", "#9fd7ff", getCssNumber("--warzone-orbital-footprint-fill-alpha", 0.035)),
                outline: false,
            },
        }));
        addFocusEntity(state.viewer.entities.add({
            id: `wz-orbital-footprint-outline-${record.noradId}`,
            polyline: {
                positions: createFootprintCirclePositions(current, groundRadius),
                width: getCssNumber("--warzone-orbital-footprint-outline-width", 2),
                material: colorFromCss("--warzone-orbital-footprint-outline-color", "#9fd7ff", getCssNumber("--warzone-orbital-footprint-outline-alpha", 0.24)),
                clampToGround: true,
            },
        }));
        addFocusEntity(state.viewer.entities.add({
            id: `wz-orbital-footprint-label-${record.noradId}`,
            position: current.groundPosition,
            label: {
                text: "THEORETICAL LINE-OF-SIGHT FOOTPRINT",
                font: `${getCssNumber("--warzone-orbital-label-size", 10)}px var(--text-font)`,
                fillColor: colorFromCss("--warzone-orbital-label-color", "#9fd7ff", 0.74),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.82),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -12),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        }));
    }
}

function waitForCurrentSceneMorph(viewer, timeoutMs = SCENE_MORPH_WAIT_TIMEOUT_MS) {
    if (viewer?.scene?.mode !== Cesium.SceneMode.MORPHING) {
        return Promise.resolve(viewer?.scene?.mode);
    }
    return new Promise((resolve) => {
        let settled = false;
        let timer = 0;
        let removeListener = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timer) window.clearTimeout(timer);
            if (typeof removeListener === "function") removeListener();
            resolve(viewer?.scene?.mode);
        };
        removeListener = viewer.scene.morphComplete?.addEventListener?.(finish) || null;
        timer = window.setTimeout(finish, timeoutMs);
        viewer.scene.requestRender?.();
    });
}

function request3DSceneModeAndWait(viewer, timeoutMs = SCENE_MORPH_WAIT_TIMEOUT_MS) {
    const setSceneMode = viewer?.__warzone?.setSceneMode;
    if (!viewer?.scene || typeof setSceneMode !== "function") return Promise.resolve(false);
    return new Promise((resolve) => {
        let settled = false;
        let timer = 0;
        let removeListener = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (timer) window.clearTimeout(timer);
            if (typeof removeListener === "function") removeListener();
            resolve(viewer.scene.mode === Cesium.SceneMode.SCENE3D);
        };
        removeListener = viewer.scene.morphComplete?.addEventListener?.(finish) || null;
        timer = window.setTimeout(finish, timeoutMs);
        try {
            setSceneMode("3d", { source: "satellite-focus" });
        } catch {
            finish();
            return;
        }
        if (viewer.scene.mode === Cesium.SceneMode.SCENE3D) finish();
        viewer.scene.requestRender?.();
    });
}

async function ensure3DModeBeforeSatelliteFocus(viewer) {
    if (!viewer?.scene) return false;
    if (viewer.scene.mode === Cesium.SceneMode.MORPHING) {
        await waitForCurrentSceneMorph(viewer);
    }
    if (viewer.scene.mode === Cesium.SceneMode.SCENE3D) return true;
    if (viewer.scene.mode === Cesium.SceneMode.MORPHING) return false;
    return request3DSceneModeAndWait(viewer);
}

function selectSatellite(id = "", options = {}) {
    const selectedId = cleanText(id);
    if (!selectedId) {
        state.focusRequestToken += 1;
        state.focusPendingId = "";
        return commitSatelliteSelection("", options);
    }

    const focusController = getAssetFocusController();
    if (state.focusPendingId || !focusController.canEnterFocus({
        assetType: "satellite",
        assetId: selectedId,
    })) return false;

    const viewer = state.viewer;
    if (!viewer || !getSatelliteRecord(selectedId)) return false;
    if (viewer.scene?.mode === Cesium.SceneMode.SCENE3D) {
        return commitSatelliteSelection(selectedId, options);
    }

    const requestToken = state.focusRequestToken + 1;
    state.focusRequestToken = requestToken;
    state.focusPendingId = selectedId;
    updateControlsOptions();

    return ensure3DModeBeforeSatelliteFocus(viewer)
        .then((ready) => {
            if (
                !ready ||
                requestToken !== state.focusRequestToken ||
                state.focusPendingId !== selectedId ||
                !state.enabled ||
                state.viewer !== viewer ||
                !focusController.canEnterFocus({ assetType: "satellite", assetId: selectedId })
            ) return false;
            state.focusPendingId = "";
            return commitSatelliteSelection(selectedId, options);
        })
        .finally(() => {
            if (requestToken !== state.focusRequestToken) return;
            state.focusPendingId = "";
            updateControlsOptions();
        });
}

function commitSatelliteSelection(id = "", options = {}) {
    const selectedId = cleanText(id);
    const viewer = state.viewer;
    const focusController = getAssetFocusController();
    const previousSelectedId = state.selectedId;

    if (selectedId && !focusController.canEnterFocus({
        assetType: "satellite",
        assetId: selectedId,
    })) return false;

    const previousRecord = previousSelectedId
        ? getSatelliteRecord(previousSelectedId)
        : null;

    // Release the previous tracked satellite before removing its entity.
    try {
        if (viewer) {
            viewer.trackedEntity = undefined;
            viewer.selectedEntity = undefined;
        }
    } catch { }

    clearFocusEntities();

    if (state.selectedId && state.entities.has(state.selectedId)) {
        const previous = state.entities.get(state.selectedId);

        if (previous?.point) {
            previous.point.show = true;
        }
    }

    state.selectedId = selectedId;

    // UNLOCK / UNFOCUS
    if (!selectedId) {
        if (focusController.isActiveAsset(previousSelectedId, "satellite")) {
            focusController.exitFocus("satellite-clear");
        }
        hideFocusCard();
        updateControlsOptions();

        if (options.flyOut !== false) {
            flyToSatelliteOverview(previousRecord);
        }

        viewer?.scene?.requestRender?.();
        return true;
    }

    const record = getSatelliteRecord(selectedId);

    if (!record || !viewer) {
        state.selectedId = "";
        return false;
    }

    const now = new Date();

    const position = createSampledPosition(
        record,
        now,
        Number(state.config.pastOrbitMinutes) || 45,
        Number(state.config.futureOrbitMinutes) || 60
    );

    const current = propagateRecord(record, now);

    if (!position || !current) {
        state.selectedId = "";
        if (focusController.isActiveAsset(selectedId, "satellite")) {
            focusController.exitFocus("satellite-position-unavailable");
        }
        return false;
    }

    if (!focusController.enterFocus({
        assetType: "satellite",
        assetId: selectedId,
        mode: "observation",
    })) return false;

    const entry = state.entities.get(record.id);

    if (entry?.point) {
        entry.point.show = false;
    }

    const selectedPosition = current.position;
    const modelProfile = resolveSatelliteModelProfile(record);

    const selectedEntity = addFocusEntity(
        viewer.entities.add({
            id: `wz-orbital-selected-${record.noradId}`,
            position,
            orientation: createSatelliteModelOrientationProperty(position),

            // Camera position used while tracking the satellite.
            viewFrom: new Cesium.Cartesian3(
                -650000,
                -650000,
                380000
            ),

            model: {
                uri: modelProfile.uri,
                scale: getSatelliteModelScale(
                    getCssNumber(
                        "--warzone-orbital-selected-model-scale",
                        170000
                    )
                ),
                minimumPixelSize: getCssNumber(
                    "--warzone-orbital-selected-model-min-px",
                    18
                ),
                maximumScale: getCssNumber(
                    "--warzone-orbital-selected-model-max-scale",
                    260000
                ),
                shadows: Cesium.ShadowMode.DISABLED,
            },

            point: {
                pixelSize: getCssNumber(
                    "--warzone-orbital-selected-fallback-size",
                    10
                ),
                color: colorFromCss(
                    "--warzone-orbital-selected-color",
                    "#e7edf5",
                    0.92
                ),
                outlineColor: colorFromCss(
                    "--warzone-orbital-selected-ring-color",
                    "#9fd7ff",
                    0.9
                ),
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },

            label: {
                text: formatUpper(record.name || record.noradId),
                font: `${getCssNumber(
                    "--warzone-orbital-label-size",
                    10
                )}px var(--text-font)`,
                fillColor: colorFromCss(
                    "--warzone-orbital-label-color",
                    "#9fd7ff",
                    0.9
                ),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -20),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        })
    );

    addOrbitContext(record, now, selectedPosition);
    showFocusCard(record);
    updateControlsOptions();

    if (!selectedEntity) {
        if (focusController.isActiveAsset(selectedId, "satellite")) {
            focusController.exitFocus("satellite-entity-unavailable");
        }
        viewer.scene.requestRender?.();
        return false;
    }

    // Smoothly approach the satellite in a slightly angled 3D view.
    viewer.flyTo(selectedEntity, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
            Cesium.Math.toRadians(25),
            Cesium.Math.toRadians(-28),
            950000
        ),
    }).then((completed) => {
        if (
            completed !== false &&
            state.selectedId === selectedId &&
            viewer.entities.contains(selectedEntity)
        ) {
            // Anchor the camera so it continues following the moving satellite.
            viewer.trackedEntity = selectedEntity;
            viewer.selectedEntity = selectedEntity;
        }

        viewer.scene.requestRender?.();
    }).catch(() => {
        if (
            state.selectedId === selectedId &&
            viewer.entities.contains(selectedEntity)
        ) {
            viewer.trackedEntity = selectedEntity;
        }

        viewer.scene.requestRender?.();
    });
    return true;
}

function stopTimers() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.visibleTimer) clearInterval(state.visibleTimer);
    state.refreshTimer = null;
    state.visibleTimer = null;
}

function startTimers() {
    stopTimers();
    const refreshMs = Math.max(15000, Number(state.config.positionRefreshIntervalMs) || DEFAULT_CONFIG.positionRefreshIntervalMs);
    state.visibleTimer = setInterval(() => {
        if (!state.enabled || document.hidden) return;
        updateDefaultEntities();
        if (!updateSelectedSatellitePosition()) updateControlsOptions();
    }, refreshMs);
    state.refreshTimer = setInterval(() => {
        if (!state.enabled || document.hidden) return;
        void fetchOrbitalData();
    }, Math.max(refreshMs * 4, 5 * 60 * 1000));
}

function cleanupLayer() {
    const focusController = getAssetFocusController();
    if (focusController.isActiveAsset(state.selectedId, "satellite")) {
        focusController.exitFocus("satellite-layer-disabled");
    }
    state.focusRequestToken += 1;
    state.focusPendingId = "";
    stopTimers();
    destroyHandler();
    hideHoverGuide();
    hideHoverCard();
    clearFocusEntities();
    for (const entry of state.entities.values()) {
        removeEntity(entry.point);
    }
    state.entities.clear();
    state.satrecs.clear();
    state.visibleRecords = [];
    state.selectedId = "";
    state.hoverCard?.remove?.();
    state.hoverGuide?.remove?.();
    state.controls?.remove?.();
    state.hoverCard = null;
    state.hoverGuide = null;
    state.focusCard = null;
    state.controls = null;
    hideOrbitalWidget();
    state.viewer?.scene?.requestRender?.();
}

function handleVisibilityChange() {
    if (!state.enabled || document.hidden) return;
    updateDefaultEntities();
    if (!updateSelectedSatellitePosition()) updateControlsOptions();
    void fetchOrbitalData();
}

function handleAssetFocusChanged(event) {
    const detail = event?.detail || {};
    const signature = `${detail.state || ""}:${detail.assetType || ""}:${detail.assetId || ""}`;
    if (signature === state.focusOwnerSignature) return;
    state.focusOwnerSignature = signature;
    if (state.enabled) updateControlsOptions();
}

function handleAppEntered() {
    setWarzoneMilSatsStartupDemoEnabled(false);
}

export function setWarzoneMilSatsEnabled(enabled) {
    mergeConfig();
    const shouldEnable = enabled !== false && state.config.enabled !== false;
    if (!state.viewer) {
        state.enabled = shouldEnable;
        return;
    }
    if (!shouldEnable) {
        state.enabled = false;
        cleanupLayer();
        return;
    }
    if (state.enabled) {
        updateControlsOptions();
        return;
    }
    stopStartupDemo();
    state.enabled = true;
    showOrbitalWidget({ expand: true });
    ensureControls();
    ensureHandler();
    startTimers();
    void fetchOrbitalData();
}

export function initWarzoneMilSats(viewer) {
    if (!viewer) return;
    mergeConfig();
    state.viewer = viewer;
    state.enabled = false;
    window.refreshWarzoneMilSatsScale = () => {
        if (startupDemoState.enabled) refreshStartupDemoScale();
        if (state.enabled) updateDefaultEntities();
    };
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("wz:app-entered", handleAppEntered);
    document.addEventListener("wz:app-entered", handleAppEntered);
    document.removeEventListener("wz:asset-focus-changed", handleAssetFocusChanged);
    document.addEventListener("wz:asset-focus-changed", handleAssetFocusChanged);
}
