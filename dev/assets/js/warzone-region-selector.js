// assets/js/warzone-region-selector.js
// Region selector:
// 1. First visit -> modal popup, choose monitoring region
// 2. Top nav dropdown auto-updates as user pans globe
// 3. Filters visible events to selected region
// 4. Shows loader while camera flies to region

import * as Cesium from "cesium";

// ── Region definitions ─────────────────────────────────────────────────────────
const REGIONS = [
    {
        id: "global",
        label: "Global View",
        emoji: "🌍",
        bounds: { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180 },
        camera: { lon: 40, lat: 25, alt: 12000000 },
    },
    {
        id: "middle_east",
        label: "Middle East & Gulf",
        emoji: "🔥",
        bounds: { minLat: 12, maxLat: 42, minLon: 28, maxLon: 65 },
        camera: { lon: 44, lat: 28, alt: 3800000 },
        hot: true,
    },
    {
        id: "levant",
        label: "Levant & Eastern Med",
        emoji: "⚔️",
        bounds: { minLat: 28, maxLat: 40, minLon: 25, maxLon: 42 },
        camera: { lon: 35, lat: 33, alt: 1800000 },
        hot: true,
    },
    {
        id: "ukraine",
        label: "Ukraine & Eastern Europe",
        emoji: "🛡️",
        bounds: { minLat: 44, maxLat: 56, minLon: 22, maxLon: 42 },
        camera: { lon: 33, lat: 49, alt: 2200000 },
    },
    {
        id: "south_asia",
        label: "South Asia",
        emoji: "🌐",
        bounds: { minLat: 5, maxLat: 38, minLon: 60, maxLon: 100 },
        camera: { lon: 78, lat: 22, alt: 5000000 },
    },
    {
        id: "europe",
        label: "Europe",
        emoji: "🏛️",
        bounds: { minLat: 35, maxLat: 72, minLon: -12, maxLon: 45 },
        camera: { lon: 15, lat: 52, alt: 5500000 },
    },
    {
        id: "north_america",
        label: "North America",
        emoji: "🦅",
        bounds: { minLat: 18, maxLat: 72, minLon: -170, maxLon: -50 },
        camera: { lon: -96, lat: 40, alt: 8000000 },
    },
    {
        id: "east_asia",
        label: "East Asia & Pacific",
        emoji: "🌏",
        bounds: { minLat: -10, maxLat: 55, minLon: 100, maxLon: 180 },
        camera: { lon: 125, lat: 28, alt: 5500000 },
    },
    {
        id: "africa",
        label: "Africa",
        emoji: "🌍",
        bounds: { minLat: -35, maxLat: 38, minLon: -20, maxLon: 52 },
        camera: { lon: 20, lat: 5, alt: 7000000 },
    },
];

const STORAGE_KEY = "wz_selected_region";
const VISITED_KEY = "wz_region_visited";

let __activeRegion = REGIONS[0]; // default: global
let __onChangeCallbacks = [];

// ── Helpers ────────────────────────────────────────────────────────────────────
function getRegionById(id) {
    return REGIONS.find(r => r.id === id) || REGIONS[0];
}

function detectRegionFromCamera(viewer) {
    if (!viewer) return null;
    try {
        const pos = viewer.camera.positionCartographic;
        const lon = Cesium.Math.toDegrees(pos.longitude);
        const lat = Cesium.Math.toDegrees(pos.latitude);
        const alt = pos.height;

        if (alt > 8000000) return getRegionById("global");

        const matches = REGIONS.filter(r => {
            if (r.id === "global") return false;
            const b = r.bounds;
            return lon >= b.minLon && lon <= b.maxLon &&
                lat >= b.minLat && lat <= b.maxLat;
        });

        if (!matches.length) return getRegionById("global");

        // prefer smallest bounding area
        matches.sort((a, b) => {
            const areaA = (a.bounds.maxLon - a.bounds.minLon) * (a.bounds.maxLat - a.bounds.minLat);
            const areaB = (b.bounds.maxLon - b.bounds.minLon) * (b.bounds.maxLat - b.bounds.minLat);
            return areaA - areaB;
        });

        return matches[0];
    } catch {
        return null;
    }
}

// ── Event filter ───────────────────────────────────────────────────────────────
// ── Viewport-based filter (replaces static bounds) ────────────────────────────
// Shows ALL events currently visible in camera view — no arbitrary cutoffs
export function filterEventsByRegion(events, region) {
    if (!region || region.id === "global") return events;

    // Try to use live camera viewport first
    const viewer = window.__warzoneViewer;
    if (viewer) {
        try {
            const rect = viewer.camera.computeViewRectangle();
            if (rect) {
                const minLon = Cesium.Math.toDegrees(rect.west);
                const maxLon = Cesium.Math.toDegrees(rect.east);
                const minLat = Cesium.Math.toDegrees(rect.south);
                const maxLat = Cesium.Math.toDegrees(rect.north);

                // Add 15% padding so events near edges still show
                const lonPad = (maxLon - minLon) * 0.15;
                const latPad = (maxLat - minLat) * 0.15;

                return events.filter(e => {
                    const lat = Number(e.lat);
                    const lon = Number(e.lon);
                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
                    return lat >= minLat - latPad && lat <= maxLat + latPad &&
                        lon >= minLon - lonPad && lon <= maxLon + lonPad;
                });
            }
        } catch { }
    }

    // Fallback to region bounds if camera not ready yet
    const { minLat, maxLat, minLon, maxLon } = region.bounds;
    return events.filter(e => {
        const lat = Number(e.lat);
        const lon = Number(e.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
        return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
    });
}

export function getActiveRegion() { return __activeRegion; }

export function onRegionChange(cb) { __onChangeCallbacks.push(cb); }

function notifyChange(region) {
    __activeRegion = region;
    try { localStorage.setItem(STORAGE_KEY, region.id); } catch { }
    __onChangeCallbacks.forEach(cb => { try { cb(region); } catch { } });
    updateNavDropdown(region);
}

// ── Camera fly ────────────────────────────────────────────────────────────────
export function flyToRegion(viewer, region) {
    if (!viewer || !region) return;

    // Show loader ONLY inside the map div — not full page
    const mapLoader = document.getElementById("wz-map-loader");
    if (mapLoader) { mapLoader.hidden = false; }

    const { minLon, minLat, maxLon, maxLat } = region.bounds;

    if (region.id === "global") {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(20, 20, 18000000),
            duration: 1.8,
            complete: () => { if (mapLoader) mapLoader.hidden = true; },
        });
        return;
    }

    viewer.camera.flyTo({
        destination: Cesium.Rectangle.fromDegrees(minLon, minLat, maxLon, maxLat),
        duration: 1.8,
        complete: () => { if (mapLoader) mapLoader.hidden = true; },
    });
}

export function selectRegion(viewer, regionId) {
    const region = getRegionById(regionId);
    flyToRegion(viewer, region);
    notifyChange(region);
}

// ── Nav dropdown ──────────────────────────────────────────────────────────────
function updateNavDropdown(region) {
    const dropdown = document.getElementById("wz-region-nav");
    if (dropdown) dropdown.value = region.id;
}

export function initRegionNav(viewer) {
    const dropdown = document.getElementById("wz-region-nav");
    if (!dropdown) return;

    dropdown.innerHTML = REGIONS.map(r =>
        `<option value="${r.id}">${r.emoji} ${r.label}${r.hot ? " 🔴" : ""}</option>`
    ).join("");

    dropdown.value = __activeRegion.id;

    dropdown.addEventListener("change", () => {
        selectRegion(viewer, dropdown.value);
    });

    // Update region dropdown label as user pans — no data re-sync needed
    let detectTimer = null;
    viewer?.camera?.moveEnd?.addEventListener(() => {
        clearTimeout(detectTimer);
        detectTimer = setTimeout(() => {
            const detected = detectRegionFromCamera(viewer);
            if (detected && detected.id !== __activeRegion.id) {
                notifyChange(detected);
            }
        }, 600);
    });
}

// ── First-visit modal ─────────────────────────────────────────────────────────
export function initRegionSelector(viewer) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) __activeRegion = getRegionById(saved);
    } catch { }

    // Expose for dock "🌍 Region" button
    window.__warzoneShowRegionModal = () => showRegionModal(viewer);

    const visited = (() => {
        try { return localStorage.getItem(VISITED_KEY) === "1"; }
        catch { return false; }
    })();

    if (!visited) {
        showRegionModal(viewer);
    } else {
        flyToRegion(viewer, __activeRegion);
    }

    initRegionNav(viewer);
}

function showRegionModal(viewer) {
    const overlay = document.getElementById("wz-region-modal");
    if (!overlay) return;

    const grid = document.getElementById("wz-region-modal-grid");
    if (!grid) return;

    grid.innerHTML = REGIONS.map(r => {
        const hotClass = r.hot ? " is-hot" : "";
        const selClass = r.id === __activeRegion.id ? " is-selected" : "";
        const hotBadge = r.hot ? '<span class="wz-region-btn__hot">ACTIVE</span>' : "";
        return `
            <button class="wz-region-btn${hotClass}${selClass}" data-region="${r.id}">
                <span class="wz-region-btn__emoji">${r.emoji}</span>
                <span class="wz-region-btn__label">${r.label}</span>
                ${hotBadge}
            </button>`;
    }).join("");

    // Replace confirm button first, then use the new one everywhere
    const oldConfirm = document.getElementById("wz-region-confirm");
    let confirmBtn = oldConfirm;

    if (oldConfirm) {
        const newConfirm = oldConfirm.cloneNode(true);
        oldConfirm.replaceWith(newConfirm);
        confirmBtn = newConfirm;
    }

    if (confirmBtn) confirmBtn.disabled = true;

    overlay.hidden = false;
    let chosen = __activeRegion.id;

    overlay.querySelectorAll(".wz-region-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            overlay.querySelectorAll(".wz-region-btn").forEach(b => b.classList.remove("is-selected"));
            btn.classList.add("is-selected");
            chosen = btn.dataset.region;
            if (confirmBtn) confirmBtn.disabled = false;
        });
    });

    if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
            try { localStorage.setItem(VISITED_KEY, "1"); } catch { }

            overlay.classList.add("is-closing");

            setTimeout(() => {
                overlay.hidden = true;
                overlay.classList.remove("is-visible", "is-closing");
            }, 400);

            selectRegion(viewer, chosen);
        });
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.classList.add("is-visible");
        });
    });
}

export { REGIONS };