// File Path: /assets/js/warzone-region-selector.js
import * as Cesium from "cesium";
import { getTheaterDefinitions } from "./warzone-theaters.js";
const REGIONS = [
    { id: "global", label: "Global View", bounds: { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }, camera: { lon: 40, lat: 25, alt: 12000000 } },
    { id: "middle_east", label: "Middle East & Gulf", bounds: { minLat: 12, maxLat: 42, minLon: 28, maxLon: 65 }, camera: { lon: 44, lat: 28, alt: 3800000 }, hot: true },
    { id: "levant", label: "Levant & Eastern Med", bounds: { minLat: 28, maxLat: 40, minLon: 25, maxLon: 42 }, camera: { lon: 35, lat: 33, alt: 1800000 }, hot: true },
    { id: "ukraine", label: "Ukraine & Eastern Europe", bounds: { minLat: 44, maxLat: 56, minLon: 22, maxLon: 42 }, camera: { lon: 33, lat: 49, alt: 2200000 } },
    { id: "central_asia", label: "Central Asia", bounds: { minLat: 25, maxLat: 56, minLon: 45, maxLon: 95 }, camera: { lon: 70, lat: 40, alt: 5000000 } },
    { id: "south_asia", label: "South Asia", bounds: { minLat: 5, maxLat: 38, minLon: 60, maxLon: 100 }, camera: { lon: 78, lat: 22, alt: 5000000 } },
    { id: "europe", label: "Europe", bounds: { minLat: 35, maxLat: 72, minLon: -12, maxLon: 45 }, camera: { lon: 15, lat: 52, alt: 5500000 } },
    { id: "north_america", label: "North America", bounds: { minLat: 18, maxLat: 72, minLon: -170, maxLon: -50 }, camera: { lon: -96, lat: 40, alt: 8000000 } },
    { id: "latin_america", label: "Central America & Caribbean", bounds: { minLat: -5, maxLat: 33, minLon: -120, maxLon: -55 }, camera: { lon: -84, lat: 14, alt: 6500000 } },
    { id: "south_america", label: "South America", bounds: { minLat: -56, maxLat: 13, minLon: -82, maxLon: -34 }, camera: { lon: -60, lat: -18, alt: 7000000 } },
    { id: "east_asia", label: "East Asia & Pacific", bounds: { minLat: -10, maxLat: 55, minLon: 100, maxLon: 180 }, camera: { lon: 125, lat: 28, alt: 5500000 } },
    { id: "oceania", label: "Oceania", bounds: { minLat: -50, maxLat: 5, minLon: 110, maxLon: 180 }, camera: { lon: 146, lat: -23, alt: 7000000 } },
    { id: "africa", label: "Africa", bounds: { minLat: -35, maxLat: 38, minLon: -20, maxLon: 52 }, camera: { lon: 20, lat: 5, alt: 7000000 } },
];
// Keep global view support available internally while hiding it from user selection.
const REGION_SELECTOR_GLOBAL_VIEW_ENABLED = false;
const REGION_FOCUS_COMPACT_SCALE = 0.7;
const REGION_FOCUS_LARGE_SCALE = 0.85;
const REGION_FOCUS_COMPACT_SPAN_DEGREES = 20;
const REGION_FOCUS_LARGE_SPAN_DEGREES = 80;
const LENS_REGION_LABELS = {
    live: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", central_asia: "Central Asia", south_asia: "South Asia", europe: "Europe", north_america: "North America", latin_america: "Central America & Caribbean", south_america: "South America", east_asia: "East Asia & Pacific", oceania: "Oceania", africa: "Africa" },
    standoff: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", central_asia: "Central Asia", south_asia: "South Asia", europe: "Europe", north_america: "North America", latin_america: "Central America & Caribbean", south_america: "South America", east_asia: "East Asia & Pacific", oceania: "Oceania", africa: "Africa" },
    flashpoint: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", central_asia: "Central Asia", south_asia: "South Asia", europe: "Europe", north_america: "North America", latin_america: "Central America & Caribbean", south_america: "South America", east_asia: "East Asia & Pacific", oceania: "Oceania", africa: "Africa" },
    all: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", central_asia: "Central Asia", south_asia: "South Asia", europe: "Europe", north_america: "North America", latin_america: "Central America & Caribbean", south_america: "South America", east_asia: "East Asia & Pacific", oceania: "Oceania", africa: "Africa" }
};
const STORAGE_KEY = "wz_selected_region";
const LENS_KEY = "wz_selected_lens";
const VISITED_KEY = "wz_region_visited";
const INTRO_ACCEPT_KEY = "wz_intro_accepted";
const LAYER_STATE_KEY = "wz_layer_state";
const BORDER_LAYER_ID = "country-borders";
const LANDING_CAMERA = { lon: 40, lat: 22, alt: 5800000, heading: 0, pitch: -90, roll: 0 };
const REGION_COUNTRIES_URL = "/assets/data/ne_110m_admin_0_countries.geojson";
const REGION_EXPLICIT_ISO2 = {
    middle_east: new Set(["AE", "BH", "CY", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"]),
    levant: new Set(["CY", "EG", "IL", "JO", "LB", "PS", "SY", "TR"]),
    ukraine: new Set(["UA", "RU", "BY", "PL", "RO", "MD", "LT", "LV", "EE"]),
};
const REGION_CONTINENT_MATCH = {
    africa: "AFRICA",
    europe: "EUROPE",
    north_america: "NORTH AMERICA",
    south_america: "SOUTH AMERICA",
    oceania: "OCEANIA",
};
const REGION_SUBREGION_MATCH = {
    central_asia: new Set(["CENTRAL ASIA"]),
    south_asia: new Set(["SOUTHERN ASIA"]),
    east_asia: new Set(["EASTERN ASIA", "SOUTH-EASTERN ASIA"]),
    latin_america: new Set(["CENTRAL AMERICA", "CARIBBEAN"]),
};
let __regionFlyLoaderTimer = 0;
let __activeRegion = getRegionById("middle_east");
let __activeLens = "live";
let __onChangeCallbacks = [];
let __regionTransitionInFlight = false;
let __regionCountryBoundsPromise = null;
const __regionCountryBoundsById = new Map();
let __regionHintTimer = 0;
let __regionCameraSyncBound = false;
let __regionCameraSyncPauseUntil = 0;
let __regionDeferredNotifyTimer = 0;
let __regionHintLiveFrame = 0;
let __regionSceneModeRefocusTimer = 0;
let __regionSceneModeRefocusSeq = 0;
let __currentViewportRegion = __activeRegion;
let __hasUserSelectedRegion = false;
const REGION_HINT_SETTLED_DEBOUNCE_MS = 450;
const REGION_HINT_ENABLED = true;
const REGION_HINT_CENTER_DRIFT_RATIO = 0.6;
const REGION_OUTSIDE_PROMPT_ID = "wz-region-outside-prompt";
const REGION_GLOBAL_ALT_THRESHOLD = 8000000;
function numberVar(name, fallback) {
    if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
}
function getLandingCameraConfig() {
    return {
        lon: numberVar("--warzone-start-lon", LANDING_CAMERA.lon),
        lat: numberVar("--warzone-start-lat", LANDING_CAMERA.lat),
        alt: numberVar("--warzone-start-height", LANDING_CAMERA.alt),
        heading: numberVar("--warzone-start-heading", LANDING_CAMERA.heading),
        pitch: numberVar("--warzone-start-pitch", LANDING_CAMERA.pitch),
        roll: numberVar("--warzone-start-roll", LANDING_CAMERA.roll),
    };
}
function getRegionById(id) {
    return REGIONS.find((r) => r.id === id) || REGIONS.find((r) => r.id === "middle_east") || REGIONS[0];
}
function getLensRegionIds(lens = "live") {
    if (lens === "all") {
        return REGIONS
            .filter((region) => REGION_SELECTOR_GLOBAL_VIEW_ENABLED || region.id !== "global")
            .map((region) => region.id);
    }
    const allowed = new Set(REGION_SELECTOR_GLOBAL_VIEW_ENABLED ? ["global"] : []);
    const orderedIds = REGIONS.map((region) => region.id);
    getTheaterDefinitions().forEach((theater) => {
        if (!theater?.region || !Array.isArray(theater.lenses)) return;
        if (!theater.lenses.includes(lens)) return;
        allowed.add(theater.region);
        if (theater.region === "middle_east") {
            allowed.add("levant");
        }
        if (theater.region === "europe") {
            allowed.add("ukraine");
        }
    });
    return orderedIds.filter((id) => allowed.has(id));
}
function getRegionsForLens(lens) {
    const ids = getLensRegionIds(lens);
    return ids.map((id) => getRegionById(id)).filter(Boolean);
}
function getRegionLabelForLens(region, lens) {
    return LENS_REGION_LABELS[lens]?.[region.id] || region.label;
}
function getDefaultRegionForLens(lens) {
    const regions = getRegionsForLens(lens);
    return regions[0] || getRegionById("middle_east");
}
function resolveRegionForLens(regionId, lens = __activeLens) {
    const allowed = getRegionsForLens(lens);
    return allowed.find((r) => r.id === regionId) || getDefaultRegionForLens(lens);
}
function normalizeGeoKey(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}
function isFeatureInRegion(feature, regionId) {
    const props = feature?.properties || {};
    const iso2 = normalizeGeoKey(props.ISO_A2_EH || props.ISO_A2 || "");
    const continent = normalizeGeoKey(props.CONTINENT || "");
    const subregion = normalizeGeoKey(props.SUBREGION || "");
    const explicit = REGION_EXPLICIT_ISO2[regionId];
    if (explicit?.has(iso2)) return true;
    const continentMatch = REGION_CONTINENT_MATCH[regionId];
    if (continentMatch && continent === continentMatch) return true;
    const subregions = REGION_SUBREGION_MATCH[regionId];
    if (subregions?.has(subregion)) return true;
    return false;
}
function computeRegionBoundsFromFeatures(features = []) {
    let minLon = Number.POSITIVE_INFINITY;
    let maxLon = Number.NEGATIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;
    for (const feature of features) {
        const bbox = Array.isArray(feature?.bbox) ? feature.bbox : null;
        if (!bbox || bbox.length < 4) continue;
        const [fMinLon, fMinLat, fMaxLon, fMaxLat] = bbox.map(Number);
        if (![fMinLon, fMinLat, fMaxLon, fMaxLat].every(Number.isFinite)) continue;
        minLon = Math.min(minLon, fMinLon);
        maxLon = Math.max(maxLon, fMaxLon);
        minLat = Math.min(minLat, fMinLat);
        maxLat = Math.max(maxLat, fMaxLat);
    }
    if (![minLon, maxLon, minLat, maxLat].every(Number.isFinite)) return null;
    const lonSpan = maxLon - minLon;
    if (!Number.isFinite(lonSpan) || lonSpan <= 0 || lonSpan > 220) return null;
    const lonPad = 1.4;
    const latPad = 1.2;
    return {
        minLon: Math.max(-180, minLon - lonPad),
        maxLon: Math.min(180, maxLon + lonPad),
        minLat: Math.max(-89.5, minLat - latPad),
        maxLat: Math.min(89.5, maxLat + latPad),
    };
}
function primeRegionCountryBounds() {
    if (__regionCountryBoundsPromise) return __regionCountryBoundsPromise;
    __regionCountryBoundsPromise = fetch(REGION_COUNTRIES_URL)
        .then((res) => (res.ok ? res.json() : null))
        .then((geojson) => {
            const features = Array.isArray(geojson?.features) ? geojson.features : [];
            if (!features.length) return;
            for (const region of REGIONS) {
                if (!region || region.id === "global") continue;
                const regionFeatures = features.filter((feature) => isFeatureInRegion(feature, region.id));
                const regionBounds = computeRegionBoundsFromFeatures(regionFeatures);
                if (regionBounds) {
                    __regionCountryBoundsById.set(region.id, regionBounds);
                }
            }
        })
        .catch(() => {
            // Keep static bounds when country-derived bounds are unavailable.
        });
    return __regionCountryBoundsPromise;
}
function getRegionBounds(region = __activeRegion) {
    if (!region) return null;
    return __regionCountryBoundsById.get(region.id) || region.bounds || null;
}
function getRegionFocusBounds(region = __activeRegion) {
    const bounds = getRegionBounds(region);
    if (!bounds || !region || region.id === "global") return bounds;
    const minLon = Number(bounds.minLon);
    const maxLon = Number(bounds.maxLon);
    const minLat = Number(bounds.minLat);
    const maxLat = Number(bounds.maxLat);
    const lonSpan = maxLon - minLon;
    const latSpan = maxLat - minLat;
    if (![minLon, maxLon, minLat, maxLat, lonSpan, latSpan].every(Number.isFinite) || lonSpan <= 0 || latSpan <= 0) {
        return bounds;
    }
    const boundsCenterLat = (minLat + maxLat) / 2;
    const projectedLonSpan = lonSpan * Math.max(0.2, Math.cos(Cesium.Math.toRadians(boundsCenterLat)));
    const majorSpan = Math.max(latSpan, projectedLonSpan);
    const sizeRatio = clampValue(
        (majorSpan - REGION_FOCUS_COMPACT_SPAN_DEGREES) /
            (REGION_FOCUS_LARGE_SPAN_DEGREES - REGION_FOCUS_COMPACT_SPAN_DEGREES),
        0,
        1
    );
    const focusScale = REGION_FOCUS_COMPACT_SCALE +
        ((REGION_FOCUS_LARGE_SCALE - REGION_FOCUS_COMPACT_SCALE) * sizeRatio);
    const halfLonSpan = (lonSpan * focusScale) / 2;
    const halfLatSpan = (latSpan * focusScale) / 2;
    const preferredLon = Number.isFinite(Number(region.camera?.lon))
        ? Number(region.camera.lon)
        : (minLon + maxLon) / 2;
    const preferredLat = Number.isFinite(Number(region.camera?.lat))
        ? Number(region.camera.lat)
        : boundsCenterLat;
    const focusLon = clampValue(preferredLon, minLon + halfLonSpan, maxLon - halfLonSpan);
    const focusLat = clampValue(preferredLat, minLat + halfLatSpan, maxLat - halfLatSpan);
    return {
        minLon: focusLon - halfLonSpan,
        maxLon: focusLon + halfLonSpan,
        minLat: focusLat - halfLatSpan,
        maxLat: focusLat + halfLatSpan,
    };
}
function setLandingCamera(viewer) {
    if (!viewer?.camera) return;
    const camera = getLandingCameraConfig();
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            camera.lon,
            camera.lat,
            camera.alt
        ),
        orientation: {
            heading: Cesium.Math.toRadians(camera.heading),
            pitch: Cesium.Math.toRadians(camera.pitch),
            roll: Cesium.Math.toRadians(camera.roll),
        },
    });
    viewer.scene?.requestRender?.();
}
function getSavedCountryBorderLayerVisibility() {
    try {
        const saved = JSON.parse(localStorage.getItem(LAYER_STATE_KEY) || "{}");
        if (Object.prototype.hasOwnProperty.call(saved, BORDER_LAYER_ID)) {
            return saved[BORDER_LAYER_ID] !== false;
        }
    } catch {
        // keep defaults
    }
    return true;
}
function isCoordinateInsideBounds(lon, lat, bounds = {}) {
    return (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        lon >= Number(bounds.minLon) &&
        lon <= Number(bounds.maxLon) &&
        lat >= Number(bounds.minLat) &&
        lat <= Number(bounds.maxLat)
    );
}
function clampValue(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function applyRegionCameraLock(viewer, region = __activeRegion) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    if (!controller) return;
    void region;
    // Region selection should only filter data; keep camera fully interactive.
    const is2D = viewer?.scene?.mode === Cesium.SceneMode.SCENE2D;
    controller.enableInputs = true;
    controller.enableZoom = true;
    controller.enableRotate = !is2D;
    controller.enableTranslate = true;
    controller.enableTilt = !is2D;
    controller.enableLook = true;
}
function releaseRegionCameraLock(viewer) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    if (!controller) return;
    // Keep controls open during transitions too.
    const is2D = viewer?.scene?.mode === Cesium.SceneMode.SCENE2D;
    controller.enableInputs = true;
    controller.enableZoom = true;
    controller.enableRotate = !is2D;
    controller.enableTranslate = true;
    controller.enableTilt = !is2D;
    controller.enableLook = true;
}
function clampCameraToRegion(viewer, region, { animate = false } = {}) {
    if (!viewer || !region || region.id === "global") return false;
    const bounds = getRegionBounds(region);
    if (!bounds) return false;
    try {
        const pos = viewer.camera.positionCartographic;
        const lon = Cesium.Math.toDegrees(pos.longitude);
        const lat = Cesium.Math.toDegrees(pos.latitude);
        const clampedLon = clampValue(lon, Number(bounds.minLon), Number(bounds.maxLon));
        const clampedLat = clampValue(lat, Number(bounds.minLat), Number(bounds.maxLat));
        if (Math.abs(clampedLon - lon) < 1e-7 && Math.abs(clampedLat - lat) < 1e-7) return false;
        const destination = Cesium.Cartesian3.fromDegrees(
            clampedLon,
            clampedLat,
            Number(pos.height || region.camera?.alt || 2500000)
        );
        const orientation = {
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
        };
        if (animate) {
            viewer.camera.flyTo({
                destination,
                orientation,
                duration: 0.45,
            });
        } else {
            viewer.camera.setView({
                destination,
                orientation,
            });
        }
        viewer.scene?.requestRender?.();
        return true;
    } catch {
        return false;
    }
}
function isCameraInsideRegion(viewer, region) {
    if (!viewer || !region || region.id === "global") return false;
    const bounds = getRegionBounds(region);
    if (!bounds) return false;
    try {
        const pos = viewer.camera.positionCartographic;
        const lon = Cesium.Math.toDegrees(pos.longitude);
        const lat = Cesium.Math.toDegrees(pos.latitude);
        return isCoordinateInsideBounds(lon, lat, bounds);
    } catch {
        return false;
    }
}
function getCameraFocusCoordinates(viewer) {
    if (!viewer?.camera) return null;
    try {
        const scene = viewer.scene;
        const canvas = scene?.canvas;
        const width = Number(canvas?.clientWidth || canvas?.width || 0);
        const height = Number(canvas?.clientHeight || canvas?.height || 0);
        if (width > 0 && height > 0 && scene?.globe) {
            const screenCenter = new Cesium.Cartesian2(width / 2, height / 2);
            const picked = viewer.camera.pickEllipsoid(
                screenCenter,
                scene.globe.ellipsoid || Cesium.Ellipsoid.WGS84
            );
            if (picked) {
                const pickedCartographic = Cesium.Cartographic.fromCartesian(picked);
                if (
                    pickedCartographic &&
                    Number.isFinite(pickedCartographic.longitude) &&
                    Number.isFinite(pickedCartographic.latitude)
                ) {
                    return {
                        lon: Cesium.Math.toDegrees(pickedCartographic.longitude),
                        lat: Cesium.Math.toDegrees(pickedCartographic.latitude),
                        alt: Number(viewer.camera.positionCartographic?.height || 0),
                    };
                }
            }
        }
    } catch {
        // fall back to camera position
    }
    try {
        const pos = viewer.camera.positionCartographic;
        return {
            lon: Cesium.Math.toDegrees(pos.longitude),
            lat: Cesium.Math.toDegrees(pos.latitude),
            alt: Number(pos.height || 0),
        };
    } catch {
        return null;
    }
}
function getViewportBounds(viewer) {
    if (!viewer?.camera?.computeViewRectangle || !viewer?.scene?.globe?.ellipsoid) return null;
    try {
        const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
        if (!rect) return null;
        const west = Cesium.Math.toDegrees(rect.west);
        const south = Cesium.Math.toDegrees(rect.south);
        const east = Cesium.Math.toDegrees(rect.east);
        const north = Cesium.Math.toDegrees(rect.north);
        if (![west, south, east, north].every(Number.isFinite)) return null;
        if (east <= west || north <= south) return null;
        return {
            minLon: west,
            minLat: south,
            maxLon: east,
            maxLat: north,
        };
    } catch {
        return null;
    }
}
function getBoundsCenter(bounds = null) {
    if (!bounds) return null;
    const lon = (Number(bounds.minLon) + Number(bounds.maxLon)) / 2;
    const lat = (Number(bounds.minLat) + Number(bounds.maxLat)) / 2;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return { lon, lat };
}
function prime2DRegionCamera(viewer, region) {
    if (!viewer?.camera || !region || viewer.scene?.mode !== Cesium.SceneMode.SCENE2D) return false;
    const bounds = getRegionFocusBounds(region) || getRegionBounds(region) || region.bounds;
    const center = getBoundsCenter(bounds) || region.camera || {};
    const lon = Number(center.lon ?? region.camera?.lon);
    const lat = Number(center.lat ?? region.camera?.lat);
    const altitude = Number(region.camera?.alt || 7000000);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(altitude)) return false;
    try {
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
            orientation: {
                heading: 0,
                pitch: -Cesium.Math.PI_OVER_TWO,
                roll: 0,
            },
        });
        viewer.scene?.requestRender?.();
        return true;
    } catch {
        return false;
    }
}
function getBoundsArea(bounds = null) {
    if (!bounds) return 0;
    const lonSpan = Number(bounds.maxLon) - Number(bounds.minLon);
    const latSpan = Number(bounds.maxLat) - Number(bounds.minLat);
    if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan) || lonSpan <= 0 || latSpan <= 0) return 0;
    return lonSpan * latSpan;
}
function getBoundsIntersectionArea(a = null, b = null) {
    if (!a || !b) return 0;
    const minLon = Math.max(Number(a.minLon), Number(b.minLon));
    const maxLon = Math.min(Number(a.maxLon), Number(b.maxLon));
    const minLat = Math.max(Number(a.minLat), Number(b.minLat));
    const maxLat = Math.min(Number(a.maxLat), Number(b.maxLat));
    if (![minLon, maxLon, minLat, maxLat].every(Number.isFinite)) return 0;
    if (maxLon <= minLon || maxLat <= minLat) return 0;
    return (maxLon - minLon) * (maxLat - minLat);
}
function getViewerCanvasSize(viewer) {
    const canvas = viewer?.scene?.canvas;
    const width = Number(canvas?.clientWidth || canvas?.width || 0);
    const height = Number(canvas?.clientHeight || canvas?.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}
function getScreenDriftFromCenter(viewer, lon, lat) {
    if (!viewer?.scene || !Number.isFinite(Number(lon)) || !Number.isFinite(Number(lat))) return null;
    const size = getViewerCanvasSize(viewer);
    if (!size) return null;
    try {
        const cartesian = Cesium.Cartesian3.fromDegrees(Number(lon), Number(lat), 0);
        const screen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
        if (!screen || !Number.isFinite(Number(screen.x)) || !Number.isFinite(Number(screen.y))) return null;
        return {
            x: Math.abs(Number(screen.x) - (size.width / 2)) / (size.width / 2),
            y: Math.abs(Number(screen.y) - (size.height / 2)) / (size.height / 2),
        };
    } catch {
        return null;
    }
}
function getRegionScreenDrift(viewer, bounds) {
    const center = getBoundsCenter(bounds);
    const centerDrift = center ? getScreenDriftFromCenter(viewer, center.lon, center.lat) : null;
    if (centerDrift) return centerDrift;

    const minLon = Number(bounds?.minLon);
    const maxLon = Number(bounds?.maxLon);
    const minLat = Number(bounds?.minLat);
    const maxLat = Number(bounds?.maxLat);
    if (![minLon, maxLon, minLat, maxLat].every(Number.isFinite)) return null;

    let closestDrift = null;
    [0, 0.25, 0.5, 0.75, 1].forEach((xStep) => {
        [0, 0.25, 0.5, 0.75, 1].forEach((yStep) => {
            const drift = getScreenDriftFromCenter(
                viewer,
                minLon + ((maxLon - minLon) * xStep),
                minLat + ((maxLat - minLat) * yStep)
            );
            if (!drift) return;
            if (!closestDrift || Math.max(drift.x, drift.y) < Math.max(closestDrift.x, closestDrift.y)) {
                closestDrift = drift;
            }
        });
    });
    return closestDrift;
}
function isCameraViewInsideRegion(viewer, region, focusHint = null) {
    if (!viewer || !region || region.id === "global") return true;
    const bounds = getRegionBounds(region) || region.bounds;
    if (!bounds) return false;
    const screenDrift = getRegionScreenDrift(viewer, bounds);
    if (screenDrift) {
        return (
            screenDrift.x <= REGION_HINT_CENTER_DRIFT_RATIO &&
            screenDrift.y <= REGION_HINT_CENTER_DRIFT_RATIO
        );
    }
    const focus = focusHint || getCameraFocusCoordinates(viewer);
    if (
        focus &&
        Number.isFinite(Number(focus.lon)) &&
        Number.isFinite(Number(focus.lat)) &&
        isCoordinateInsideBounds(Number(focus.lon), Number(focus.lat), bounds)
    ) {
        return true;
    }
    return false;
}
function ensureRegionAllowedForLens() {
    const allowed = getRegionsForLens(__activeLens);
    const ok = allowed.some((r) => r.id === __activeRegion.id);
    if (!ok) __activeRegion = getDefaultRegionForLens(__activeLens);
}
function detectRegionFromCamera(viewer, focusHint = null) {
    if (!viewer) return null;
    try {
        const focus = focusHint || getCameraFocusCoordinates(viewer);
        const alt = Number(focus?.alt || viewer?.camera?.positionCartographic?.height || 0);
        const viewportBounds = getViewportBounds(viewer);
        const viewportCenter = getBoundsCenter(viewportBounds);
        if (viewportCenter) {
            const centerMatches = REGIONS.filter((r) => {
                if (r.id === "global") return false;
                const bounds = getRegionBounds(r);
                return bounds ? isCoordinateInsideBounds(viewportCenter.lon, viewportCenter.lat, bounds) : false;
            });
            if (centerMatches.length) {
                centerMatches.sort((a, b) => {
                    const aBounds = getRegionBounds(a) || a.bounds;
                    const bBounds = getRegionBounds(b) || b.bounds;
                    return getBoundsArea(aBounds) - getBoundsArea(bBounds);
                });
                return centerMatches[0];
            }
        }
        if (focus && Number.isFinite(Number(focus.lon)) && Number.isFinite(Number(focus.lat))) {
            const lon = Number(focus.lon);
            const lat = Number(focus.lat);
            const matches = REGIONS.filter((r) => {
                if (r.id === "global") return false;
                const bounds = getRegionBounds(r);
                return bounds ? isCoordinateInsideBounds(lon, lat, bounds) : false;
            });
            if (matches.length) {
                matches.sort((a, b) => {
                    const aBounds = getRegionBounds(a) || a.bounds;
                    const bBounds = getRegionBounds(b) || b.bounds;
                    return getBoundsArea(aBounds) - getBoundsArea(bBounds);
                });
                return matches[0];
            }
        }
        if (viewportBounds) {
            let bestRegion = null;
            let bestScore = 0;
            REGIONS.forEach((region) => {
                if (region.id === "global") return;
                const bounds = getRegionBounds(region);
                const score = getBoundsIntersectionArea(bounds, viewportBounds);
                if (score > bestScore) {
                    bestScore = score;
                    bestRegion = region;
                }
            });
            if (bestRegion && bestScore > 0) {
                return bestRegion;
            }
        }
        if (alt > REGION_GLOBAL_ALT_THRESHOLD) return getRegionById("global");
        return getRegionById("global");
    } catch {
        return null;
    }
}
function clearPendingRegionHintRefresh() {
    if (__regionHintTimer) {
        clearTimeout(__regionHintTimer);
        __regionHintTimer = 0;
    }
}
function refreshRegionButtonHintOnNextFrame(viewer) {
    if (__regionHintLiveFrame) return;
    __regionHintLiveFrame = requestAnimationFrame(() => {
        __regionHintLiveFrame = 0;
        refreshRegionButtonHint(viewer);
    });
}
function closeRegionModal(overlay, callback) {
    if (!overlay) {
        if (typeof callback === "function") callback();
        return;
    }
    if (typeof window.__warzoneCloseSharedModal === "function") {
        overlay.classList.add("is-closing");
        window.__warzoneCloseSharedModal(overlay, () => {
            overlay.classList.remove("is-closing");
            if (typeof callback === "function") callback();
        });
        return;
    }
    overlay.classList.remove("is-visible");
    overlay.classList.add("is-closing");
    window.setTimeout(() => {
        overlay.hidden = true;
        overlay.classList.remove("is-closing");
        if (typeof callback === "function") callback();
    }, 220);
}
function isRegionHintAllowed() {
    if (typeof document === "undefined") return false;
    if (!document.body?.classList?.contains("is-app-active")) return false;
    const introModal = document.getElementById("wz-intro-modal");
    if (introModal && !introModal.hidden) return false;
    return true;
}
function setRegionButtonHintActive(active) {
    const controls = [
        document.getElementById("wz-region-control"),
        document.getElementById("wz-region-control-mobile"),
    ].filter(Boolean);
    controls.forEach((control) => {
        control.classList.toggle("is-region-outside", !!active);
    });
}
function setRegionPromptVisibleOnControls(active) {
    const controls = [
        document.getElementById("wz-region-control"),
        document.getElementById("wz-region-control-mobile"),
    ].filter(Boolean);
    controls.forEach((control) => {
        control.classList.toggle("is-region-prompt-visible", !!active);
        control.closest(".warzone-region-bar")?.classList.toggle("is-region-prompt-visible", !!active);
    });
}
function isAnyBlockingRegionModalVisible() {
    return Boolean(document.querySelector(`.wz-modal.is-visible:not([hidden]):not(#${REGION_OUTSIDE_PROMPT_ID})`));
}
function ensureRegionOutsidePrompt(viewer) {
    const prompt = document.getElementById(REGION_OUTSIDE_PROMPT_ID);
    if (!prompt) return null;
    if (prompt.dataset.regionPromptBound === "true") return prompt;
    prompt.dataset.regionPromptBound = "true";
    document.getElementById("wz-region-outside-return")?.addEventListener("click", () => {
        setRegionHintState(false, viewer);
        flyToRegion(viewer, __activeRegion);
    });
    document.getElementById("wz-region-outside-select")?.addEventListener("click", () => {
        setRegionHintState(false, viewer);
        showRegionModal(viewer, false, {
            mode: "manual",
            suggestedRegion: __activeRegion,
            onConfirm: (regionId) => {
                selectRegion(viewer, regionId, { source: "manual", allowAnyRegion: true });
            },
            onCancel: () => {
                scheduleRegionButtonHintRefresh(viewer, 300);
            },
        });
    });
    document.getElementById("wz-region-outside-close")?.addEventListener("click", () => {
        setRegionHintState(false, viewer);
    });
    return prompt;
}
function setRegionOutsidePromptActive(active, viewer) {
    const prompt = active
        ? ensureRegionOutsidePrompt(viewer)
        : document.getElementById(REGION_OUTSIDE_PROMPT_ID);
    if (!prompt) return;
    const shouldShow = Boolean(active) && !isAnyBlockingRegionModalVisible();
    prompt.hidden = !shouldShow;
    prompt.classList.toggle("is-visible", shouldShow);
    setRegionPromptVisibleOnControls(shouldShow);
}
function setRegionHintState(active, viewer) {
    setRegionButtonHintActive(active);
    setRegionOutsidePromptActive(active, viewer);
}
function refreshRegionButtonHint(viewer) {
    const isSceneMorphing = viewer?.scene?.mode === Cesium.SceneMode.MORPHING;
    if (!viewer || __regionTransitionInFlight || isSceneMorphing || !isRegionHintAllowed()) {
        setRegionHintState(false, viewer);
        return;
    }
    setRegionHintState(!isCameraViewInsideRegion(viewer, __activeRegion), viewer);
}
function scheduleRegionButtonHintRefresh(viewer, delayMs = REGION_HINT_SETTLED_DEBOUNCE_MS) {
    clearPendingRegionHintRefresh();
    __regionHintTimer = window.setTimeout(() => {
        __regionHintTimer = 0;
        refreshRegionButtonHint(viewer);
    }, Math.max(0, Number(delayMs || 0)));
}
export function filterEventsByRegion(events, region) {
    if (!region || region.id === "global") return events;
    const bounds = getRegionBounds(region) || region.bounds;
    const { minLat, maxLat, minLon, maxLon } = bounds;
    const metersToLatDeg = (meters) => meters / 111320;
    const metersToLonDeg = (meters, atLatDeg) => {
        const cosLat = Math.cos((Number(atLatDeg) * Math.PI) / 180);
        return meters / Math.max(111320 * Math.abs(cosLat), 1);
    };
    const getEventRadiusMeters = (event = {}) => {
        const value =
            Number(event?.highlight_radius_m) ||
            Number(event?.target_radius_m) ||
            Number(event?.incoming_highlight_radius_m) ||
            0;
        return Number.isFinite(value) && value > 0 ? value : 0;
    };
    return events.filter((e) => {
        const lat = Number(e.display_lat ?? e.lat ?? e.impact_lat);
        const lon = Number(e.display_lon ?? e.lon ?? e.impact_lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
        if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
            return true;
        }
        // Keep radius-based overlays if their footprint intersects the region.
        const radiusMeters = getEventRadiusMeters(e);
        if (radiusMeters <= 0) return false;
        const latPad = metersToLatDeg(radiusMeters);
        const lonPad = metersToLonDeg(radiusMeters, lat);
        const eventMinLat = lat - latPad;
        const eventMaxLat = lat + latPad;
        const eventMinLon = lon - lonPad;
        const eventMaxLon = lon + lonPad;
        const intersects =
            eventMaxLat >= minLat &&
            eventMinLat <= maxLat &&
            eventMaxLon >= minLon &&
            eventMinLon <= maxLon;
        return intersects;
    });
}
export function getActiveRegion() { return __activeRegion; }
export function getActiveLens() { return __activeLens; }
function notifyScopeChange(options = {}) {
    try { localStorage.setItem(STORAGE_KEY, __activeRegion.id); } catch { }
    try { localStorage.setItem(LENS_KEY, __activeLens); } catch { }
    updateNavDropdown(__activeRegion);
    updateLensDropdown(__activeLens);
    const payload = {
        region: __activeRegion,
        lens: __activeLens,
        source: String(options.source || "system"),
    };
    const runCallbacks = () => {
        __regionDeferredNotifyTimer = 0;
        __onChangeCallbacks.forEach((cb) => {
            try { cb(payload); } catch { }
        });
    };
    if (options.deferCallbacks) {
        if (__regionDeferredNotifyTimer) {
            clearTimeout(__regionDeferredNotifyTimer);
        }
        __regionDeferredNotifyTimer = window.setTimeout(
            runCallbacks,
            Math.max(0, Math.min(Number(options.callbackDelay ?? 160), 1000))
        );
        return;
    }
    if (__regionDeferredNotifyTimer) {
        clearTimeout(__regionDeferredNotifyTimer);
        __regionDeferredNotifyTimer = 0;
    }
    runCallbacks();
}
export function setActiveLens(lensId) {
    clearPendingRegionHintRefresh();
    setRegionHintState(false);
    __activeLens = lensId || "live";
    ensureRegionAllowedForLens();
    notifyScopeChange({ source: "lens" });
}
export function onRegionChange(cb) { __onChangeCallbacks.push(cb); }
function notifyChange(region, options = {}) { __activeRegion = region; notifyScopeChange(options); }
export function flyToRegion(viewer, region, options = {}) {
    if (!viewer || !region) return Promise.resolve(false);
    const showLoader = options?.showLoader === true;
    const prime2D = options?.prime2D === true;
    const requestedDuration = Number(options?.duration);
    const duration = Number.isFinite(requestedDuration)
        ? Math.max(0, Math.min(requestedDuration, 3))
        : 1.8;
    return new Promise((resolve) => {
        viewer.__warzone?.stopStartupRotation?.();
        releaseRegionCameraLock(viewer);
        __regionTransitionInFlight = true;
        viewer.camera.cancelFlight?.();
        if (__regionFlyLoaderTimer) {
            clearTimeout(__regionFlyLoaderTimer);
            __regionFlyLoaderTimer = 0;
        }
        let finalized = false;
        const finalizeTransition = (success = true) => {
            if (finalized) return;
            finalized = true;
            __regionTransitionInFlight = false;
            if (__regionFlyLoaderTimer) {
                clearTimeout(__regionFlyLoaderTimer);
                __regionFlyLoaderTimer = 0;
            }
            if (showLoader) {
                window.SiteLoader?.stop?.();
            }
            applyRegionCameraLock(viewer, region);
            scheduleRegionButtonHintRefresh(viewer, 900);
            resolve(success);
        };
        if (showLoader) {
            window.SiteLoader?.start?.();
        }
        __regionFlyLoaderTimer = window.setTimeout(
            () => finalizeTransition(false),
            showLoader ? 5200 : Math.max(1200, Math.round(duration * 1000) + 900)
        );
        try {
            if (region.id === "global") {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(20, 20, 18000000),
                    duration,
                    complete: () => finalizeTransition(true),
                    cancel: () => finalizeTransition(false),
                });
                return;
            }
            const bounds = getRegionFocusBounds(region) || getRegionBounds(region) || region.bounds;
            const { minLon, minLat, maxLon, maxLat } = bounds;
            const is2D = viewer.scene?.mode === Cesium.SceneMode.SCENE2D;
            if (is2D) {
                if (prime2D) {
                    prime2DRegionCamera(viewer, region);
                }
                const center = getBoundsCenter(bounds) || region.camera || {};
                const lon = Number(center.lon ?? region.camera?.lon);
                const lat = Number(center.lat ?? region.camera?.lat);
                const altitude = Number(region.camera?.alt || 7000000);
                if (Number.isFinite(lon) && Number.isFinite(lat)) {
                    viewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
                        orientation: {
                            heading: 0,
                            pitch: -Cesium.Math.PI_OVER_TWO,
                            roll: 0,
                        },
                        duration,
                        complete: () => finalizeTransition(true),
                        cancel: () => finalizeTransition(false),
                    });
                    return;
                }
            }
            viewer.camera.flyTo({
                destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
                duration,
                complete: () => finalizeTransition(true),
                cancel: () => finalizeTransition(false),
            });
        } catch {
            finalizeTransition(false);
        }
    });
}
export function selectRegion(viewer, regionId, options = {}) {
    let region = null;
    if (options?.allowAnyRegion) {
        region = getRegionById(regionId);
        if (!getRegionsForLens(__activeLens).some((entry) => entry.id === region.id)) {
            __activeLens = "all";
        }
    } else {
        region = resolveRegionForLens(regionId, __activeLens);
    }
    clearPendingRegionHintRefresh();
    setRegionHintState(false, viewer);
    __hasUserSelectedRegion = true;
    __currentViewportRegion = region;
    __regionCameraSyncPauseUntil = Date.now() + 1200;
    notifyChange(region, { source: options?.source || "manual" });
    flyToRegion(viewer, region, options);
}
function updateNavDropdown(region) {
    const label = __hasUserSelectedRegion && region
        ? getRegionLabelForLens(region, __activeLens)
        : "";
    const buttons = [
        document.getElementById("wz-region-nav"),
        document.getElementById("wz-region-nav-mobile"),
    ].filter(Boolean);
    buttons.forEach((button) => {
        const labelEl = button.querySelector(".wz-region-select-btn__label");
        if (labelEl) {
            labelEl.textContent = label;
        } else {
            button.textContent = label;
        }
        button.dataset.region = __hasUserSelectedRegion ? (region?.id || "") : "";
        button.setAttribute(
            "aria-label",
            __hasUserSelectedRegion
                ? `Open monitoring region selector. Current region: ${label}`
                : "Open monitoring region selector"
        );
    });
    const mobileMenuLabel = document.getElementById("wz-mobile-region-menu-label");
    if (mobileMenuLabel) {
        mobileMenuLabel.textContent = label || "Select Region";
    }
}
function updateLensDropdown(lens) {
    [
        document.getElementById("wz-lens-nav"),
        document.getElementById("wz-lens-nav-mobile"),
    ].filter(Boolean).forEach((dropdown) => {
        dropdown.value = lens;
    });
}
export function initRegionNav(viewer) {
    const dropdown = document.getElementById("wz-region-nav");
    const mobileDropdown = document.getElementById("wz-region-nav-mobile");
    if (!dropdown && !mobileDropdown) return;
    updateNavDropdown(__activeRegion);
    applyRegionCameraLock(viewer, __activeRegion);
    const scheduleSceneModeRegionRefocus = (delayMs = 180) => {
        if (__regionSceneModeRefocusTimer) {
            clearTimeout(__regionSceneModeRefocusTimer);
            __regionSceneModeRefocusTimer = 0;
        }
        const seq = ++__regionSceneModeRefocusSeq;
        __regionSceneModeRefocusTimer = window.setTimeout(() => {
            __regionSceneModeRefocusTimer = 0;
            requestAnimationFrame(() => {
                if (seq !== __regionSceneModeRefocusSeq) return;
                if (viewer?.scene?.mode === Cesium.SceneMode.MORPHING) {
                    scheduleSceneModeRegionRefocus(180);
                    return;
                }
                refocusActiveRegionForSceneMode();
            });
        }, Math.max(0, Math.min(Number(delayMs) || 0, 1000)));
    };
    const refocusActiveRegionForSceneMode = () => {
        if (viewer?.scene?.mode === Cesium.SceneMode.MORPHING) {
            scheduleSceneModeRegionRefocus(180);
            return;
        }
        if (!__hasUserSelectedRegion || !__activeRegion || __activeRegion.id === "global") {
            scheduleRegionButtonHintRefresh(viewer, 900);
            return;
        }
        clearPendingRegionHintRefresh();
        setRegionHintState(false, viewer);
        flyToRegion(viewer, __activeRegion, {
            duration: Math.max(0.7, Math.min(numberVar("--warzone-scene-refocus-duration", 1.05), 2.4)),
            showLoader: false,
            prime2D: true,
            source: "scene-mode",
        });
    };
    const openRegionSelector = () => {
        showRegionModal(viewer, false, {
            mode: "manual",
            suggestedRegion: __activeRegion,
            onConfirm: (regionId) => {
                selectRegion(viewer, regionId, { source: "manual", allowAnyRegion: true });
            },
        });
    };
    if (dropdown) {
        dropdown.addEventListener("click", openRegionSelector);
    }
    if (mobileDropdown) {
        mobileDropdown.addEventListener("click", openRegionSelector);
    }
    const lensDropdown = document.getElementById("wz-lens-nav");
    const lensDropdownMobile = document.getElementById("wz-lens-nav-mobile");
    if (lensDropdown) {
        lensDropdown.value = __activeLens;
        lensDropdown.addEventListener("change", () => {
            setActiveLens(lensDropdown.value);
            flyToRegion(viewer, __activeRegion);
        });
    }
    if (lensDropdownMobile) {
        lensDropdownMobile.value = __activeLens;
        lensDropdownMobile.addEventListener("change", () => {
            setActiveLens(lensDropdownMobile.value);
            flyToRegion(viewer, __activeRegion);
        });
    }
    viewer?.scene?.morphComplete?.addEventListener?.(() => {
        applyRegionCameraLock(viewer, __activeRegion);
        if (Number(viewer.__warzoneSceneModeRefocusManagedUntil || 0) > Date.now()) {
            scheduleSceneModeRegionRefocus(220);
            return;
        }
        if (!__hasUserSelectedRegion || !__activeRegion || __activeRegion.id === "global") {
            scheduleRegionButtonHintRefresh(viewer, 900);
            return;
        }
        clearPendingRegionHintRefresh();
        setRegionHintState(false, viewer);
        flyToRegion(viewer, __activeRegion);
    });
    document.addEventListener("wz:scene-mode-refocus-requested", () => {
        scheduleSceneModeRegionRefocus(120);
    });
    if (REGION_HINT_ENABLED && !__regionCameraSyncBound && viewer?.camera?.moveEnd) {
        __regionCameraSyncBound = true;
        viewer?.camera?.moveStart?.addEventListener?.(() => {
            clearPendingRegionHintRefresh();
        });
        viewer.camera.moveEnd.addEventListener(() => {
            scheduleRegionButtonHintRefresh(viewer);
        });
        viewer.camera.changed?.addEventListener?.(() => {
            refreshRegionButtonHintOnNextFrame(viewer);
        });
        const canvas = viewer.scene?.canvas;
        if (canvas?.addEventListener) {
            const clearOnInputStart = () => {
                clearPendingRegionHintRefresh();
            };
            const settleOnInputEnd = () => {
                scheduleRegionButtonHintRefresh(viewer);
            };
            canvas.addEventListener("pointerdown", clearOnInputStart, { passive: true });
            canvas.addEventListener("pointerup", settleOnInputEnd, { passive: true });
            canvas.addEventListener("pointercancel", settleOnInputEnd, { passive: true });
            canvas.addEventListener("mouseup", settleOnInputEnd, { passive: true });
            canvas.addEventListener("touchend", settleOnInputEnd, { passive: true });
            canvas.addEventListener("wheel", settleOnInputEnd, { passive: true });
        }
        scheduleRegionButtonHintRefresh(viewer, 1200);
    }
}
export function initRegionSelector(viewer) {
    try {
        const savedLens = localStorage.getItem(LENS_KEY);
        const savedRegionId = localStorage.getItem(STORAGE_KEY);
        __activeLens = savedLens || "live";
        __hasUserSelectedRegion = !!savedRegionId;
        __activeRegion = resolveRegionForLens(savedRegionId || "", __activeLens);
        ensureRegionAllowedForLens();
        __currentViewportRegion = __activeRegion;
    } catch {
        __activeRegion = getDefaultRegionForLens("live");
        __activeLens = "live";
        __hasUserSelectedRegion = false;
        __currentViewportRegion = __activeRegion;
    }

    window.__warzoneShowRegionModal = (instant = false) => showRegionModal(viewer, instant);

    primeRegionCountryBounds();

    setLandingCamera(viewer);
    viewer?.__warzone?.setBorderLayersVisible?.(false, { animate: false });
    initRegionNav(viewer);
}
function showRegionModal(viewer, instant = false, options = {}) {
    const overlay = document.getElementById("wz-region-modal");
    if (!overlay) return;

    const grid = document.getElementById("wz-region-modal-grid");
    if (!grid) return;

    const titleEl = document.getElementById("wz-region-title");
    const subEl = document.getElementById("wz-region-sub");
    const mode = options?.mode === "manual" ? "manual" : "startup";
    const suggestedRegion = options?.suggestedRegion || null;
    const lensRegions = getRegionsForLens(__activeLens);
    const regions = REGIONS.filter((region) => (
        REGION_SELECTOR_GLOBAL_VIEW_ENABLED || region.id !== "global"
    ));

    grid.innerHTML = regions.map((r) => {
        const hotClass = r.hot ? " is-hot" : "";
        return `
            <button class="wz-region-btn${hotClass} btn-secondary white"
                    type="button"
                    data-region="${r.id}"
                    aria-pressed="false">
                <span aria-hidden="true"></span>
                <div class="hot-dot"></div>
                ${getRegionLabelForLens(r, __activeLens)}
            </button>`;
    }).join("");

    const oldConfirm = document.getElementById("wz-region-confirm");
    let confirmBtn = oldConfirm;
    const oldBack = document.getElementById("wz-region-back");
    let backBtn = oldBack;

    if (oldConfirm) {
        const newConfirm = oldConfirm.cloneNode(true);
        oldConfirm.replaceWith(newConfirm);
        confirmBtn = newConfirm;
    }
    if (oldBack) {
        const newBack = oldBack.cloneNode(true);
        oldBack.replaceWith(newBack);
        backBtn = newBack;
    }

    let chosen = mode === "manual" ? (suggestedRegion?.id || __activeRegion?.id || null) : null;

    if (titleEl) {
        titleEl.textContent = "Select Region";
    }
    if (subEl) {
        subEl.textContent = mode === "manual"
            ? `Current region: ${getRegionLabelForLens(__activeRegion, __activeLens)}. Select a monitoring region.`
            : "Choose an initial theater to begin monitoring.";
    }

    if (confirmBtn) {
        confirmBtn.innerHTML = mode === "manual"
            ? '<span aria-hidden="true"></span>Switch Region'
            : '<span aria-hidden="true"></span>Enter Stratops';
        const disabled = !chosen;
        confirmBtn.disabled = disabled;
        confirmBtn.classList.toggle("is-disabled", disabled);
        confirmBtn.setAttribute("aria-disabled", disabled ? "true" : "false");
    }
    if (backBtn) {
        const isManualMode = mode === "manual";
        backBtn.innerHTML = '<span aria-hidden="true"></span>Back';
        backBtn.hidden = isManualMode;
        backBtn.style.display = isManualMode ? "none" : "";
        backBtn.disabled = isManualMode;
        backBtn.setAttribute("aria-hidden", isManualMode ? "true" : "false");
    }

    overlay.classList.remove("is-closing");

    const regionButtons = overlay.querySelectorAll(".wz-region-btn");

    regionButtons.forEach((btn) => {
        const isSelected = chosen === btn.dataset.region;
        btn.classList.toggle("is-selected", isSelected);
        btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
        btn.addEventListener("click", () => {
            regionButtons.forEach((b) => {
                b.classList.remove("is-selected");
                b.setAttribute("aria-pressed", "false");
            });

            btn.classList.add("is-selected");
            btn.setAttribute("aria-pressed", "true");
            chosen = btn.dataset.region;

            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.classList.remove("is-disabled");
                confirmBtn.setAttribute("aria-disabled", "false");
            }
        });
    });

    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            if (!chosen) return;

            if (mode === "manual") {
                closeRegionModal(overlay, () => {
                    options?.onConfirm?.(chosen);
                });
                return;
            }

            try { localStorage.setItem(VISITED_KEY, "1"); } catch { }

            window.__warzoneEnterApp?.();
            window.SiteLoader?.start?.();

            closeRegionModal(overlay, () => {
                if (!lensRegions.some((region) => region.id === chosen)) {
                    __activeLens = "all";
                }
                selectRegion(viewer, chosen, { showLoader: true });
                viewer?.__warzone?.setBorderLayersVisible?.(
                    getSavedCountryBorderLayerVisibility(),
                    { animate: true, duration: 780 }
                );
                window.__warzoneStartDeferredApp?.();
            });
        });
    }

    if (backBtn) {
        backBtn.addEventListener("click", () => {
            if (mode === "manual") {
                return;
            }
            const introModal = document.getElementById("wz-intro-modal");
            closeRegionModal(overlay, () => {
                if (!introModal) return;
                introModal.hidden = false;
                requestAnimationFrame(() => {
                    introModal.classList.add("is-visible");
                });
            });
        });
    }

    if (typeof window.__warzoneOpenSharedModal === "function") {
        window.__warzoneOpenSharedModal(overlay);
    } else if (instant) {
        overlay.hidden = false;
        overlay.classList.add("is-visible");
    } else {
        overlay.hidden = false;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
            });
        });
    }
}
export { REGIONS };
