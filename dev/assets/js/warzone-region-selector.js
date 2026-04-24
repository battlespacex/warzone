// File Path: /assets/js/warzone-region-selector.js
import * as Cesium from "cesium";
const REGIONS = [
    { id: "global", label: "Global View", bounds: { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 }, camera: { lon: 40, lat: 25, alt: 12000000 } },
    { id: "middle_east", label: "Middle East & Gulf", bounds: { minLat: 12, maxLat: 42, minLon: 28, maxLon: 65 }, camera: { lon: 44, lat: 28, alt: 3800000 }, hot: true },
    { id: "levant", label: "Levant & Eastern Med", bounds: { minLat: 28, maxLat: 40, minLon: 25, maxLon: 42 }, camera: { lon: 35, lat: 33, alt: 1800000 }, hot: true },
    { id: "ukraine", label: "Ukraine & Eastern Europe", bounds: { minLat: 44, maxLat: 56, minLon: 22, maxLon: 42 }, camera: { lon: 33, lat: 49, alt: 2200000 } },
    { id: "south_asia", label: "South Asia", bounds: { minLat: 5, maxLat: 38, minLon: 60, maxLon: 100 }, camera: { lon: 78, lat: 22, alt: 5000000 } },
    { id: "europe", label: "Europe", bounds: { minLat: 35, maxLat: 72, minLon: -12, maxLon: 45 }, camera: { lon: 15, lat: 52, alt: 5500000 } },
    { id: "north_america", label: "North America", bounds: { minLat: 18, maxLat: 72, minLon: -170, maxLon: -50 }, camera: { lon: -96, lat: 40, alt: 8000000 } },
    { id: "east_asia", label: "East Asia & Pacific", bounds: { minLat: -10, maxLat: 55, minLon: 100, maxLon: 180 }, camera: { lon: 125, lat: 28, alt: 5500000 } },
    { id: "africa", label: "Africa", bounds: { minLat: -35, maxLat: 38, minLon: -20, maxLon: 52 }, camera: { lon: 20, lat: 5, alt: 7000000 } },
];
const LENS_THEATERS = {
    live: ["global", "middle_east", "levant", "ukraine", "south_asia", "europe", "north_america", "east_asia", "africa"],
    standoff: ["global", "middle_east", "levant", "ukraine", "south_asia", "europe", "north_america", "east_asia", "africa"],
    flashpoint: ["global", "middle_east", "levant", "ukraine", "south_asia", "europe", "north_america", "east_asia", "africa"],
    all: ["global", "middle_east", "levant", "ukraine", "south_asia", "europe", "north_america", "east_asia", "africa"]
};
const LENS_REGION_LABELS = {
    live: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", south_asia: "South Asia", europe: "Europe", north_america: "North America", east_asia: "East Asia & Pacific", africa: "Africa" },
    standoff: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", south_asia: "South Asia", europe: "Europe", north_america: "North America", east_asia: "East Asia & Pacific", africa: "Africa" },
    flashpoint: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", south_asia: "South Asia", europe: "Europe", north_america: "North America", east_asia: "East Asia & Pacific", africa: "Africa" },
    all: { global: "Global View", middle_east: "Middle East & Gulf", levant: "Levant & Eastern Med", ukraine: "Ukraine & Eastern Europe", south_asia: "South Asia", europe: "Europe", north_america: "North America", east_asia: "East Asia & Pacific", africa: "Africa" }
};
const STORAGE_KEY = "wz_selected_region";
const LENS_KEY = "wz_selected_lens";
const VISITED_KEY = "wz_region_visited";
const INTRO_ACCEPT_KEY = "wz_intro_accepted";
const LAYER_STATE_KEY = "wz_layer_state";
const BORDER_LAYER_ID = "country-borders";
const LANDING_CAMERA = { lon: 20, lat: 20, alt: 16200000 };
let __regionFlyLoaderTimer = 0;
let __activeRegion = getRegionById("middle_east");
let __activeLens = "live";
let __onChangeCallbacks = [];
function getRegionById(id) {
    return REGIONS.find((r) => r.id === id) || REGIONS[0];
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
function isCameraInsideRegion(viewer, region) {
    if (!viewer || !region || region.id === "global") return false;
    try {
        const pos = viewer.camera.positionCartographic;
        const lon = Cesium.Math.toDegrees(pos.longitude);
        const lat = Cesium.Math.toDegrees(pos.latitude);
        return isCoordinateInsideBounds(lon, lat, region.bounds);
    } catch {
        return false;
    }
}
function ensureRegionAllowedForLens() {
    const allowed = getRegionsForLens(__activeLens);
    const ok = allowed.some((r) => r.id === __activeRegion.id);
    if (!ok) __activeRegion = getDefaultRegionForLens(__activeLens);
}
function detectRegionFromCamera(viewer) {
    if (!viewer) return null;
    try {
        const pos = viewer.camera.positionCartographic;
        const lon = Cesium.Math.toDegrees(pos.longitude);
        const lat = Cesium.Math.toDegrees(pos.latitude);
        const alt = pos.height;
        if (alt > 8000000) return getRegionById("global");
        const matches = REGIONS.filter((r) => {
            if (r.id === "global") return false;
            return isCoordinateInsideBounds(lon, lat, r.bounds);
        });
        if (!matches.length) return getRegionById("global");
        matches.sort((a, b) => ((a.bounds.maxLon - a.bounds.minLon) * (a.bounds.maxLat - a.bounds.minLat)) - ((b.bounds.maxLon - b.bounds.minLon) * (b.bounds.maxLat - b.bounds.minLat)));
        return matches[0];
    } catch {
        return null;
    }
}
export function filterEventsByRegion(events, region) {
    if (!region || region.id === "global") return events;
    const { minLat, maxLat, minLon, maxLon } = region.bounds;
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
function notifyScopeChange() {
    try { localStorage.setItem(STORAGE_KEY, __activeRegion.id); } catch { }
    try { localStorage.setItem(LENS_KEY, __activeLens); } catch { }
    updateNavDropdown(__activeRegion);
    updateLensDropdown(__activeLens);
    __onChangeCallbacks.forEach((cb) => {
        try { cb({ region: __activeRegion, lens: __activeLens }); } catch { }
    });
}
export function setActiveLens(lensId) {
    __activeLens = lensId || "live";
    ensureRegionAllowedForLens();
    notifyScopeChange();
}
export function onRegionChange(cb) { __onChangeCallbacks.push(cb); }
function notifyChange(region) { __activeRegion = region; notifyScopeChange(); }
export function flyToRegion(viewer, region, options = {}) {
    if (!viewer || !region) return;
    const showLoader = options?.showLoader === true;
    if (__regionFlyLoaderTimer) {
        clearTimeout(__regionFlyLoaderTimer);
        __regionFlyLoaderTimer = 0;
    }
    const finalizeLoader = () => {
        if (__regionFlyLoaderTimer) {
            clearTimeout(__regionFlyLoaderTimer);
            __regionFlyLoaderTimer = 0;
        }
        if (showLoader) {
            window.SiteLoader?.stop?.();
        }
    };
    if (showLoader) {
        window.SiteLoader?.start?.();
        __regionFlyLoaderTimer = window.setTimeout(finalizeLoader, 5200);
    }
    const { minLon, minLat, maxLon, maxLat } = region.bounds;
    if (region.id === "global") {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(20, 20, 18000000),
            duration: 1.8,
            complete: finalizeLoader,
            cancel: finalizeLoader,
        });
        return;
    }
    viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
        duration: 1.8,
        complete: finalizeLoader,
        cancel: finalizeLoader,
    });
}
export function selectRegion(viewer, regionId, options = {}) {
    const region = getRegionById(regionId);
    flyToRegion(viewer, region, options);
    notifyChange(region);
}
function updateNavDropdown(region) {
    const dropdown = document.getElementById("wz-region-nav");
    if (!dropdown) return;
    const regions = getRegionsForLens(__activeLens);
    dropdown.innerHTML = regions.map((r) => `<option value="${r.id}">${getRegionLabelForLens(r, __activeLens)}${r.hot ? " ◉" : ""}</option>`).join("");
    dropdown.value = region && regions.some((r) => r.id === region.id) ? region.id : (regions[0]?.id || "");
}
function updateLensDropdown(lens) {
    const dropdown = document.getElementById("wz-lens-nav");
    if (!dropdown) return;
    dropdown.value = lens;
}
export function initRegionNav(viewer) {
    const dropdown = document.getElementById("wz-region-nav");
    if (!dropdown) return;
    updateNavDropdown(__activeRegion);
    dropdown.addEventListener("change", () => selectRegion(viewer, dropdown.value));
    const lensDropdown = document.getElementById("wz-lens-nav");
    if (lensDropdown) {
        lensDropdown.value = __activeLens;
        lensDropdown.addEventListener("change", () => {
            setActiveLens(lensDropdown.value);
            flyToRegion(viewer, __activeRegion);
        });
    }
    let detectTimer = null;
    viewer?.camera?.moveEnd?.addEventListener(() => {
        clearTimeout(detectTimer);
        detectTimer = setTimeout(() => {
            const activeRegion = __activeRegion;
            const keepCurrentRegion =
                activeRegion?.id !== "global" &&
                isCameraInsideRegion(viewer, activeRegion);
            if (keepCurrentRegion) return;
            const detected = detectRegionFromCamera(viewer);
            if (detected && detected.id !== activeRegion.id) notifyChange(detected);
        }, 600);
    });
}
export function initRegionSelector(viewer) {
    try {
        const savedLens = localStorage.getItem(LENS_KEY);
        __activeLens = savedLens || "live";
        __activeRegion = getRegionById("global");

        ensureRegionAllowedForLens();
    } catch {
        __activeRegion = getRegionById("global");
        __activeLens = "live";
    }

    window.__warzoneShowRegionModal = (instant = false) => showRegionModal(viewer, instant);

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
