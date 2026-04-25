// File Path: /assets/js/warzone-region-selector.js
import * as Cesium from "cesium";
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
const LENS_THEATERS = {
    live: ["global", "middle_east", "levant", "ukraine", "central_asia", "south_asia", "europe", "north_america", "latin_america", "south_america", "east_asia", "oceania", "africa"],
    standoff: ["global", "middle_east", "levant", "ukraine", "central_asia", "south_asia", "europe", "north_america", "latin_america", "south_america", "east_asia", "oceania", "africa"],
    flashpoint: ["global", "middle_east", "levant", "ukraine", "central_asia", "south_asia", "europe", "north_america", "latin_america", "south_america", "east_asia", "oceania", "africa"],
    all: ["global", "middle_east", "levant", "ukraine", "central_asia", "south_asia", "europe", "north_america", "latin_america", "south_america", "east_asia", "oceania", "africa"]
};
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
const LANDING_CAMERA = { lon: 20, lat: 20, alt: 16200000 };
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
let __regionCameraSyncTimer = 0;
let __regionCameraSyncBound = false;
let __regionCameraSyncPauseUntil = 0;
let __regionLastAutoSwitchAt = 0;
let __regionDeferredNotifyTimer = 0;
const REGION_CAMERA_SYNC_DEBOUNCE_MS = 120;
const REGION_CAMERA_SYNC_PAUSE_MS = 650;
const REGION_CAMERA_SYNC_MIN_SWITCH_INTERVAL_MS = 900;
const REGION_CAMERA_SYNC_ENABLED = true;
const REGION_GLOBAL_ALT_THRESHOLD = 8000000;
function getRegionById(id) {
    return REGIONS.find((r) => r.id === id) || REGIONS.find((r) => r.id === "middle_east") || REGIONS[0];
}
function getRegionsForLens(lens) {
    const ids = LENS_THEATERS[lens] || LENS_THEATERS.live;
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
function setLandingCamera(viewer) {
    if (!viewer?.camera) return;
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            LANDING_CAMERA.lon,
            LANDING_CAMERA.lat,
            LANDING_CAMERA.alt
        ),
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
function ensureRegionAllowedForLens() {
    const allowed = getRegionsForLens(__activeLens);
    const ok = allowed.some((r) => r.id === __activeRegion.id);
    if (!ok) __activeRegion = getDefaultRegionForLens(__activeLens);
}
function detectRegionFromCamera(viewer, focusHint = null) {
    if (!viewer) return null;
    try {
        const focus = focusHint || getCameraFocusCoordinates(viewer);
        if (!focus) return null;
        const lon = Number(focus.lon);
        const lat = Number(focus.lat);
        const alt = Number(focus.alt || 0);
        if (alt > REGION_GLOBAL_ALT_THRESHOLD) return getRegionById("global");
        const matches = REGIONS.filter((r) => {
            if (r.id === "global") return false;
            const bounds = getRegionBounds(r);
            return bounds ? isCoordinateInsideBounds(lon, lat, bounds) : false;
        });
        if (!matches.length) return getRegionById("global");
        matches.sort((a, b) => {
            const aBounds = getRegionBounds(a) || a.bounds;
            const bBounds = getRegionBounds(b) || b.bounds;
            const aArea = (aBounds.maxLon - aBounds.minLon) * (aBounds.maxLat - aBounds.minLat);
            const bArea = (bBounds.maxLon - bBounds.minLon) * (bBounds.maxLat - bBounds.minLat);
            return aArea - bArea;
        });
        return matches[0];
    } catch {
        return null;
    }
}
function scheduleRegionSyncFromCamera(viewer) {
    if (!viewer || __regionTransitionInFlight) return;
    if (Date.now() < __regionCameraSyncPauseUntil) return;
    if (__regionCameraSyncTimer) {
        clearTimeout(__regionCameraSyncTimer);
        __regionCameraSyncTimer = 0;
    }
    __regionCameraSyncTimer = window.setTimeout(() => {
        __regionCameraSyncTimer = 0;
        if (!viewer || __regionTransitionInFlight) return;
        if (Date.now() < __regionCameraSyncPauseUntil) return;
        const now = Date.now();
        if ((now - __regionLastAutoSwitchAt) < REGION_CAMERA_SYNC_MIN_SWITCH_INTERVAL_MS) {
            return;
        }
        const focus = getCameraFocusCoordinates(viewer);
        if (!focus) return;
        const focusAlt = Number(focus.alt || 0);
        const isHighAltitudeGlobal = Number.isFinite(focusAlt) && focusAlt > REGION_GLOBAL_ALT_THRESHOLD;
        const activeRegion = __activeRegion;
        if (activeRegion && activeRegion.id !== "global" && !isHighAltitudeGlobal) {
            const activeBounds = getRegionBounds(activeRegion) || activeRegion.bounds;
            if (activeBounds && isCoordinateInsideBounds(Number(focus.lon), Number(focus.lat), activeBounds)) {
                return;
            }
        }
        const detected = detectRegionFromCamera(viewer, focus);
        if (!detected) return;
        const resolved = resolveRegionForLens(detected.id, __activeLens);
        if (!resolved || resolved.id === __activeRegion.id) return;
        __regionLastAutoSwitchAt = now;
        __regionCameraSyncPauseUntil = now + REGION_CAMERA_SYNC_PAUSE_MS;
        notifyChange(resolved, {
            source: "camera",
            deferCallbacks: true,
            callbackDelay: 180,
        });
        viewer.scene?.requestRender?.();
    }, REGION_CAMERA_SYNC_DEBOUNCE_MS);
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
    __activeLens = lensId || "live";
    ensureRegionAllowedForLens();
    notifyScopeChange({ source: "lens" });
}
export function onRegionChange(cb) { __onChangeCallbacks.push(cb); }
function notifyChange(region, options = {}) { __activeRegion = region; notifyScopeChange(options); }
export function flyToRegion(viewer, region, options = {}) {
    if (!viewer || !region) return;
    const showLoader = options?.showLoader === true;
    releaseRegionCameraLock(viewer);
    __regionTransitionInFlight = true;
    viewer.camera.cancelFlight?.();
    if (__regionFlyLoaderTimer) {
        clearTimeout(__regionFlyLoaderTimer);
        __regionFlyLoaderTimer = 0;
    }
    let finalized = false;
    const finalizeTransition = () => {
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
    };
    if (showLoader) {
        window.SiteLoader?.start?.();
        __regionFlyLoaderTimer = window.setTimeout(finalizeTransition, 5200);
    }
    const bounds = getRegionBounds(region) || region.bounds;
    const { minLon, minLat, maxLon, maxLat } = bounds;
    if (region.id === "global") {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(20, 20, 18000000),
            duration: 1.8,
            complete: finalizeTransition,
            cancel: finalizeTransition,
        });
        return;
    }
    viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
        duration: 1.8,
        complete: finalizeTransition,
        cancel: finalizeTransition,
    });
}
export function selectRegion(viewer, regionId, options = {}) {
    const region = resolveRegionForLens(regionId, __activeLens);
    __regionCameraSyncPauseUntil = Date.now() + 1200;
    notifyChange(region, { source: "manual" });
    flyToRegion(viewer, region, options);
}
function updateNavDropdown(region) {
    const regions = getRegionsForLens(__activeLens);
    const dropdowns = [
        document.getElementById("wz-region-nav"),
        document.getElementById("wz-region-nav-mobile"),
    ].filter(Boolean);
    dropdowns.forEach((dropdown) => {
        dropdown.innerHTML = regions
            .map((r) => `<option value="${r.id}">${getRegionLabelForLens(r, __activeLens)}${r.hot ? " ◉" : ""}</option>`)
            .join("");
        dropdown.value = region && regions.some((r) => r.id === region.id) ? region.id : (regions[0]?.id || "");
    });
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
    if (dropdown) {
        dropdown.addEventListener("change", () => selectRegion(viewer, dropdown.value));
    }
    if (mobileDropdown) {
        mobileDropdown.addEventListener("change", () => selectRegion(viewer, mobileDropdown.value));
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
    });
    if (REGION_CAMERA_SYNC_ENABLED && !__regionCameraSyncBound && viewer?.camera?.moveEnd) {
        __regionCameraSyncBound = true;
        viewer.camera.moveEnd.addEventListener(() => {
            scheduleRegionSyncFromCamera(viewer);
        });
    }
}
export function initRegionSelector(viewer) {
    try {
        const savedLens = localStorage.getItem(LENS_KEY);
        const savedRegionId = localStorage.getItem(STORAGE_KEY);
        __activeLens = savedLens || "live";
        __activeRegion = resolveRegionForLens(savedRegionId || "", __activeLens);
        ensureRegionAllowedForLens();
    } catch {
        __activeRegion = getDefaultRegionForLens("live");
        __activeLens = "live";
    }

    window.__warzoneShowRegionModal = (instant = false) => showRegionModal(viewer, instant);

    primeRegionCountryBounds();

    setLandingCamera(viewer);
    viewer?.__warzone?.setBorderLayersVisible?.(false, { animate: false });
    initRegionNav(viewer);
}
function showRegionModal(viewer, instant = false) {
    const overlay = document.getElementById("wz-region-modal");
    if (!overlay) return;

    const grid = document.getElementById("wz-region-modal-grid");
    if (!grid) return;

    const regions = getRegionsForLens(__activeLens);

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

    let chosen = null;

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.classList.add("is-disabled");
        confirmBtn.setAttribute("aria-disabled", "true");
    }

    overlay.hidden = false;
    overlay.classList.remove("is-closing");

    const regionButtons = overlay.querySelectorAll(".wz-region-btn");

    regionButtons.forEach((btn) => {
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

            try { localStorage.setItem(VISITED_KEY, "1"); } catch { }

            window.__warzoneEnterApp?.();
            window.SiteLoader?.start?.();

            overlay.classList.remove("is-visible");
            overlay.classList.add("is-closing");

            setTimeout(() => {
                overlay.hidden = true;
                overlay.classList.remove("is-closing");
                selectRegion(viewer, chosen, { showLoader: true });
                viewer?.__warzone?.setBorderLayersVisible?.(
                    getSavedCountryBorderLayerVisibility(),
                    { animate: true, duration: 780 }
                );
                window.__warzoneStartDeferredApp?.();
            }, 220);
        });
    }

    if (backBtn) {
        backBtn.addEventListener("click", () => {
            const introModal = document.getElementById("wz-intro-modal");
            overlay.classList.remove("is-visible");
            overlay.classList.add("is-closing");
            window.setTimeout(() => {
                overlay.hidden = true;
                overlay.classList.remove("is-closing");
                if (!introModal) return;
                introModal.hidden = false;
                requestAnimationFrame(() => {
                    introModal.classList.add("is-visible");
                });
            }, 220);
        });
    }

    if (instant) {
        overlay.classList.add("is-visible");
    } else {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                overlay.classList.add("is-visible");
            });
        });
    }
}
export { REGIONS };
