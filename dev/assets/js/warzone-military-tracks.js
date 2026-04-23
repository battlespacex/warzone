// File Path: /assets/js/warzone-military-tracks.js
import * as Cesium from "cesium";

function cssVar(name, fallback = "") {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}
function numberVar(name, fallback) {
    const raw = cssVar(name, String(fallback));
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function stripCssUrl(value = "") {
    return String(value)
        .trim()
        .replace(/^url\((.*)\)$/i, "$1")
        .replace(/^["']|["']$/g, "")
        .trim();
}
function hexToCs(hex, a = 1.0) {
    return Cesium.Color.fromCssColorString(hex).withAlpha(a);
}
function normalizeSubcat(value = "") {
    return String(value || "").trim().toLowerCase();
}
function normalizeSrc(value = "") {
    return String(value || "").trim().toLowerCase();
}
const SUBMARINE_SUBTYPES = new Set(["submarine", "ssbn", "ssn", "ssk", "aip_submarine"]);
const NAVAL_TRACK_SUBTYPES = new Set([
    "carrier",
    "amphibious",
    "cruiser",
    "destroyer",
    "frigate",
    "corvette",
    "submarine",
    "ssbn",
    "ssn",
    "ssk",
    "aip_submarine",
    "missile_boat",
    "naval",
    "logistics",
    "patrol",
    "minesweeper",
]);
function getColor(subcat) {
    const s = normalizeSubcat(subcat);
    if (s === "carrier") return cssVar("--warzone-military-carrier-color", "#ff3c3c");
    if (s === "amphibious" || s === "cruiser" || s === "destroyer" || s === "frigate" || s === "corvette" || s === "naval" || s === "missile_boat") {
        return cssVar("--warzone-military-naval-color", "#9b7bff");
    }
    if (SUBMARINE_SUBTYPES.has(s)) return cssVar("--warzone-military-submarine-color", "#7bdcff");
    if (s === "logistics") return cssVar("--warzone-military-logistics-color", "#00d9b2");
    return cssVar("--warzone-military-naval-color", "#56d80e");
}
function getTrailColor(subcat, fallback) {
    const s = normalizeSubcat(subcat);
    if (s === "carrier") return cssVar("--warzone-military-trail-carrier", fallback);
    if (s === "amphibious" || s === "cruiser" || s === "destroyer" || s === "frigate" || s === "corvette" || s === "naval" || s === "missile_boat") {
        return cssVar("--warzone-military-trail-naval", fallback);
    }
    if (SUBMARINE_SUBTYPES.has(s)) return cssVar("--warzone-military-trail-submarine", fallback);
    if (s === "logistics") return cssVar("--warzone-military-trail-logistics", fallback);
    return cssVar("--warzone-military-trail-default", fallback);
}
function isNaval(subcat) {
    return NAVAL_TRACK_SUBTYPES.has(normalizeSubcat(subcat));
}
function buildHeadingOrientation(lon, lat, altM, headingDeg, subcat) {
    const offset = SUBMARINE_SUBTYPES.has(normalizeSubcat(subcat)) ? 0 : -90;
    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians((Number(headingDeg || 0) + offset + 360) % 360),
        0,
        0
    );
    return Cesium.Transforms.headingPitchRollQuaternion(
        Cesium.Cartesian3.fromDegrees(lon, lat, altM),
        hpr
    );
}
function buildTrail(lon, lat, headingDeg, len, segs, altM) {
    const backRad = Cesium.Math.toRadians((Number(headingDeg || 0) + 180) % 360);
    return Array.from({ length: segs + 1 }, (_, i) => {
        const t = i / segs;
        const dist = t * len;
        const trailAlt = Math.max(0, (altM * (1 - t * 0.1)) - CFG.trailAltitudeOffsetM);
        return Cesium.Cartesian3.fromDegrees(
            lon + dist * Math.sin(backRad),
            lat + dist * Math.cos(backRad),
            trailAlt
        );
    });
}
function buildCircle(lon, lat, radiusKm, altM, steps = 64) {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const a = (i / steps) * Math.PI * 2;
        const dLon = (radiusKm / 111.32) * Math.sin(a) / Math.cos(Cesium.Math.toRadians(lat));
        const dLat = (radiusKm / 111.32) * Math.cos(a);
        return Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, altM);
    });
}
function requestRender(viewer) {
    try {
        viewer?.scene?.requestRender?.();
    } catch { }
}
function playMilitaryAppearSound() {
    const src = stripCssUrl(cssVar("--warzone-military-sound", ""));
    if (!src) return;
    try {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = Math.max(0, Math.min(1, numberVar("--warzone-military-sound-volume", 0.72)));
        audio.currentTime = 0;
        audio.play().catch(() => { });
    } catch { }
}

const CFG = {
    maxTracks: 60,
    trailSegments: 8,
    shipTrailLengthDeg: 1.5,
    trailFadeMs: 25 * 60 * 1000,
    altitudeShip: 80,
    trailAltitudeOffsetM: 24,
};
const MODELS = {
    carrier: "/assets/images/models/naval/ac-rs-1.glb",
    amphibious: "/assets/images/models/naval/hc-1.glb",
    cruiser: "/assets/images/models/naval/ns-2.glb",
    destroyer: "/assets/images/models/naval/ns-2.glb",
    frigate: "/assets/images/models/naval/ns-2.glb",
    corvette: "/assets/images/models/naval/ns-1.glb",
    missile_boat: "/assets/images/models/naval/ns-1.glb",
    naval: "/assets/images/models/naval/ns-2.glb",
    submarine: "/assets/images/models/naval/sb-1.glb",
    ssbn: "/assets/images/models/naval/sb-1.glb",
    ssn: "/assets/images/models/naval/sb-1.glb",
    ssk: "/assets/images/models/naval/sb-1.glb",
    aip_submarine: "/assets/images/models/naval/sb-1.glb",
    logistics: "/assets/images/models/naval/ns-3.glb",
};
const MODEL_DEFAULT = "/assets/images/models/naval/ns-2.glb";
function getModelUri(subcat) {
    return MODELS[normalizeSubcat(subcat)] || MODEL_DEFAULT;
}

export function initMilitaryTracks(viewer) {
    if (!viewer) return null;

    const trackMap = new Map();

    function removeTrack(key) {
        const existing = trackMap.get(key);
        if (!existing) return;
        clearTimeout(existing.cleanupTimer);
        try { if (existing.iconEntity) viewer.entities.remove(existing.iconEntity); } catch { }
        try { if (existing.trailEntity) viewer.entities.remove(existing.trailEntity); } catch { }
        try { if (existing.orbitEntity) viewer.entities.remove(existing.orbitEntity); } catch { }
        trackMap.delete(key);
        requestRender(viewer);
    }

    function enforceMax() {
        if (trackMap.size <= CFG.maxTracks) return;
        const oldest = [...trackMap.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt);
        while (trackMap.size > CFG.maxTracks && oldest.length) {
            const next = oldest.shift();
            if (next) removeTrack(next[0]);
        }
    }

    function addTrack(event = {}) {
        const sourceName = normalizeSrc(event.source_name || "");
        const rawSubcat = normalizeSubcat(event.subcategory || event.subtype || event.type || "");
        const subcat = isNaval(rawSubcat)
            ? rawSubcat
            : ((sourceName.includes("ais") || sourceName.includes("naval") || sourceName.includes("ship") || sourceName.includes("vessel")) ? "naval" : rawSubcat);
        if (!isNaval(subcat)) return;

        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const key = String(event.id || event.track_key || `${subcat}-${lat.toFixed(3)}-${lon.toFixed(3)}`);
        removeTrack(key);

        const colorHex = getColor(subcat);
        const headingDeg = Number(event.heading_deg || event.heading || 0);
        const altM = CFG.altitudeShip;

        const iconEntity = viewer.entities.add({
            id: `mil-track-${key}`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
            orientation: buildHeadingOrientation(lon, lat, altM, headingDeg, subcat),
            model: {
                uri: getModelUri(subcat),
                scale: numberVar("--warzone-military-model-scale-naval", 0.9),
                minimumPixelSize: numberVar("--warzone-military-model-min-px-naval", 42),
                maximumScale: numberVar("--warzone-military-model-max-scale-naval", 160),
                silhouetteColor: hexToCs(colorHex, 0.0),
                silhouetteSize: 0,
            },
            properties: {
                militaryTrack: true,
                category: "military",
                subcategory: subcat,
                title: String(event.title || event.callsign || event.name || "Naval activity"),
                source_name: String(event.source_name || ""),
                derived: true,
                derived_visual_type: "naval-event-track",
            }
        });

        const trailEntity = viewer.entities.add({
            polyline: {
                positions: buildTrail(lon, lat, headingDeg, CFG.shipTrailLengthDeg, CFG.trailSegments, altM),
                width: numberVar("--warzone-military-trail-width-naval", 2.4),
                material: hexToCs(getTrailColor(subcat, colorHex), numberVar("--warzone-military-trail-alpha-naval", 0.38)),
                clampToGround: false,
                followSurface: false,
            },
        });

        let orbitEntity = null;
        if (subcat === "carrier") {
            orbitEntity = viewer.entities.add({
                polyline: {
                    positions: buildCircle(lon, lat, 180, altM),
                    width: numberVar("--warzone-military-carrier-orbit-width", 1.0),
                    material: hexToCs(
                        cssVar("--warzone-military-carrier-orbit-color", colorHex),
                        numberVar("--warzone-military-carrier-orbit-alpha", 0.2)
                    ),
                },
            });
        }

        playMilitaryAppearSound();

        const cleanupTimer = setTimeout(() => removeTrack(key), 90000 + Math.random() * 30000);

        trackMap.set(key, {
            iconEntity,
            trailEntity,
            orbitEntity,
            addedAt: Date.now(),
            cleanupTimer,
        });

        enforceMax();
        requestRender(viewer);
    }

    const cleanupInterval = setInterval(() => {
        const cutoff = Date.now() - CFG.trailFadeMs;
        for (const [k, t] of trackMap.entries()) {
            if (t.addedAt < cutoff) removeTrack(k);
        }
    }, 5 * 60 * 1000);

    return {
        addTrack,
        setTracks(events = []) {
            [...trackMap.keys()].forEach(removeTrack);
            events.forEach(addTrack);
        },
        clearAll() {
            [...trackMap.keys()].forEach(removeTrack);
        },
        destroy() {
            clearInterval(cleanupInterval);
            [...trackMap.keys()].forEach(removeTrack);
        },
        get count() {
            return trackMap.size;
        },
    };
}

export function isMilitaryTrackEvent(event) {
    if (!event) return false;

    const cat = String(event.category || "").toLowerCase();
    const src = normalizeSrc(event.source_name || "");
    const subcat = normalizeSubcat(event.subcategory || "");

    if (cat !== "military") return false;
    if (!Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lon))) return false;

    // Air activity is already handled by warzone-air-ingestion.js + warzone-live-airforce.js.
    // Keep this file only for naval / vessel-like event tracks so fake aircraft disappear.
    const isAllowedNavalSubtype = NAVAL_TRACK_SUBTYPES.has(subcat);
    const isAllowedSource = src.includes("ais") || src.includes("naval") || src.includes("ship") || src.includes("vessel");

    return isAllowedNavalSubtype || isAllowedSource;
}
