// assets/js/warzone-military-tracks.js
//
// Military aircraft + naval vessel visualization
//
// Aircraft: glowing heading-rotated icon + fading trail polyline
// Ships:    heading-rotated icon + shorter wake trail
// AWACS:    orbit ring + icon
//
// Called from essential.js when events with subcategory matching
// aircraft/vessel types are loaded or received in realtime.
//
// Public API (attached to window.__warzoneViewer.__warzone):
//   addMilitaryTrack(event)   — add single aircraft/vessel
//   setMilitaryTracks(events) — bulk load on page init
//   clearMilitaryTracks()     — remove all

import * as Cesium from "cesium";

// ─── Config ───────────────────────────────────────────────────────────────────

const CFG = {
    maxTracks: 200,       // max simultaneous tracks
    trailSegments: 12,        // polyline segments per trail
    trailLengthDeg: 3.5,       // trail length in degrees (aircraft)
    shipTrailLengthDeg: 1.8,       // shorter for ships
    trailFadeMs: 25 * 60 * 1000,  // 25 min — fade out old tracks
    iconScale: 0.55,
    awacOrbitRadiusKm: 280,       // AWACS patrol orbit radius
    altitudeAircraft: 9000,      // display altitude for aircraft (9km)
    altitudeShip: 50,        // ships at sea level
};

// ─── Icons ────────────────────────────────────────────────────────────────────
// Apni SVG files yahan set karo.
// SVGs white fill mein banao — Cesium billboard "color" property se tint hoga.
// Icon upar (north) ki taraf point kare jab heading = 0.
//
// Example:
//   const ICON_AIRCRAFT = "/assets/icons/aircraft-fighter.svg";
//
// Abhi ke liye inline SVGs use ho rahe hain — jab apni files ready ho jayen
// toh bas path string se replace karo, svgUrl() hataao.

function svgUrl(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ── REPLACE THESE with your own file paths when ready ─────────────────────────
// const ICON_AIRCRAFT  = "/assets/icons/aircraft-fighter.svg";
// const ICON_TANKER    = "/assets/icons/aircraft-tanker.svg";
// const ICON_AWACS     = "/assets/icons/aircraft-awacs.svg";
// const ICON_RECON     = "/assets/icons/aircraft-recon.svg";
// const ICON_SHIP      = "/assets/icons/ship-naval.svg";
// const ICON_CARRIER   = "/assets/icons/ship-carrier.svg";
// const ICON_DESTROYER = "/assets/icons/ship-destroyer.svg";
// ─────────────────────────────────────────────────────────────────────────────

const ICON_AIRCRAFT = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <polygon points="16,2 19,14 30,18 19,19 18,30 16,26 14,30 13,19 2,18 13,14" fill="white" opacity="0.95"/>
</svg>`);

const ICON_TANKER = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <polygon points="16,3 20,12 30,16 20,18 18,29 16,25 14,29 12,18 2,16 12,12" fill="white" opacity="0.9"/>
</svg>`);

const ICON_AWACS = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <circle cx="16" cy="16" r="13" fill="none" stroke="white" stroke-width="2" opacity="0.9"/>
  <polygon points="16,3 18,13 29,16 18,18 16,29 14,18 3,16 14,13" fill="white" opacity="0.95"/>
</svg>`);

const ICON_RECON = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <polygon points="16,2 18,14 30,16 18,18 16,30 14,18 2,16 14,14" fill="white" opacity="0.95"/>
  <circle cx="16" cy="16" r="4" fill="white" opacity="0.7"/>
</svg>`);

const ICON_SHIP = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path d="M16 4 L20 12 L28 14 L28 20 L20 22 L16 28 L12 22 L4 20 L4 14 L12 12 Z" fill="white" opacity="0.9"/>
  <rect x="14" y="10" width="4" height="8" fill="rgba(0,0,0,0.4)"/>
</svg>`);

const ICON_CARRIER = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <polygon points="16,2 30,16 16,30 2,16" fill="white" opacity="0.9" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>
  <rect x="13" y="8" width="6" height="16" fill="rgba(0,0,0,0.35)"/>
</svg>`);

const ICON_DESTROYER = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <polygon points="16,4 22,14 28,18 22,22 16,28 10,22 4,18 10,14" fill="white" opacity="0.9"/>
</svg>`);


/*const ICON_AIRCRAFT = "/assets/icons/aircraft-fighter.svg";
const ICON_TANKER = "/assets/icons/aircraft-tanker.svg";
const ICON_AWACS = "/assets/icons/aircraft-awacs.svg";
const ICON_RECON = "/assets/icons/aircraft-recon.svg";
const ICON_SHIP = "/assets/icons/ship-naval.svg";
const ICON_CARRIER = "/assets/icons/ship-carrier.svg";
const ICON_DESTROYER = "/assets/icons/ship-destroyer.svg";*/

function getIcon(subcat) {
    switch ((subcat || "").toLowerCase()) {
        case "awacs": return ICON_AWACS;
        case "tanker":
        case "transport": return ICON_TANKER;
        case "recon":
        case "patrol": return ICON_RECON;
        case "carrier": return ICON_CARRIER;
        case "destroyer":
        case "frigate":
        case "submarine": return ICON_DESTROYER;
        case "naval":
        case "logistics":
        case "patrol": return ICON_SHIP;
        case "fighter":
        case "military":
        default:
            return ICON_AIRCRAFT;
    }
}

function getTrailColor(subcat) {
    switch ((subcat || "").toLowerCase()) {
        case "awacs": return new Cesium.Color(1.0, 0.82, 0.3, 1.0);   // gold
        case "tanker":
        case "transport": return new Cesium.Color(0.0, 0.85, 0.7, 1.0);   // teal
        case "recon":
        case "patrol": return new Cesium.Color(1.0, 0.42, 0.0, 1.0);   // orange
        case "carrier": return new Cesium.Color(1.0, 0.16, 0.16, 1.0);  // red
        case "destroyer":
        case "frigate": return new Cesium.Color(0.61, 0.48, 1.0, 1.0);  // purple
        case "naval":
        case "logistics": return new Cesium.Color(0.0, 0.85, 0.7, 0.8);
        case "fighter":
        default: return new Cesium.Color(0.34, 0.85, 0.05, 1.0); // green
    }
}

function isNaval(subcat) {
    return ["carrier", "destroyer", "frigate", "submarine", "naval", "logistics", "patrol", "minesweeper"]
        .includes((subcat || "").toLowerCase());
}

function isAircraft(subcat) {
    return ["fighter", "tanker", "transport", "awacs", "recon", "patrol", "military"]
        .includes((subcat || "").toLowerCase());
}

// ─── Trail geometry ────────────────────────────────────────────────────────────
// Build trail positions going BACKWARDS from current position along heading

function buildTrailPositions(lon, lat, headingDeg, trailLengthDeg, segments, altM) {
    const positions = [];
    // Opposite direction of travel
    const backDeg = (headingDeg + 180) % 360;
    const backRad = Cesium.Math.toRadians(backDeg);

    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const dist = t * trailLengthDeg;
        // Simple linear trail (not great circle but good enough for short distances)
        const tLon = lon + dist * Math.sin(backRad);
        const tLat = lat + dist * Math.cos(backRad);
        const tAlt = altM * (1 - t * 0.3);   // slight altitude taper
        positions.push(Cesium.Cartesian3.fromDegrees(tLon, tLat, tAlt));
    }
    return positions;
}

// Per-position alpha for trail fade (bright at aircraft, transparent at tail)
function buildTrailColors(baseColor, segments) {
    const colors = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const alpha = (1 - t) * baseColor.alpha;
        colors.push(new Cesium.Color(baseColor.red, baseColor.green, baseColor.blue, alpha));
    }
    return colors;
}

// ─── AWACS orbit ring ──────────────────────────────────────────────────────────

function buildOrbitPositions(lon, lat, radiusKm, segments = 64) {
    const positions = [];
    for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const dLon = (radiusKm / 111.32) * Math.sin(angle) / Math.cos(Cesium.Math.toRadians(lat));
        const dLat = (radiusKm / 111.32) * Math.cos(angle);
        positions.push(Cesium.Cartesian3.fromDegrees(lon + dLon, lat + dLat, CFG.altitudeAircraft));
    }
    return positions;
}

// ─── Entity management ────────────────────────────────────────────────────────

export function initMilitaryTracks(viewer) {
    if (!viewer) return null;

    // Map: sourceKey → { iconEntity, trailEntity, orbitEntity, addedAt }
    const trackMap = new Map();

    function removeTrack(key) {
        const t = trackMap.get(key);
        if (!t) return;
        if (t.iconEntity) viewer.entities.remove(t.iconEntity);
        if (t.trailEntity) viewer.entities.remove(t.trailEntity);
        if (t.orbitEntity) viewer.entities.remove(t.orbitEntity);
        trackMap.delete(key);
    }

    function enforceMax() {
        if (trackMap.size <= CFG.maxTracks) return;
        // Remove oldest
        const sorted = [...trackMap.entries()]
            .sort((a, b) => a[1].addedAt - b[1].addedAt);
        const toRemove = sorted.slice(0, trackMap.size - CFG.maxTracks);
        for (const [k] of toRemove) removeTrack(k);
    }

    function pruneExpired() {
        const cutoff = Date.now() - CFG.trailFadeMs;
        for (const [k, t] of trackMap) {
            if (t.addedAt < cutoff) removeTrack(k);
        }
    }

    function addTrack(event) {
        if (!event) return;

        const lon = Number(event.lon);
        const lat = Number(event.lat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

        const key = event.source_key || `mil-${event.id}`;
        const subcat = String(event.subcategory || event.category || "military").toLowerCase();
        const meta = event.metadata || {};
        const heading = Number(meta.heading ?? 0);
        const naval = isNaval(subcat);
        const altM = naval ? CFG.altitudeShip : CFG.altitudeAircraft;

        // Remove old entry for same key (position update)
        if (trackMap.has(key)) removeTrack(key);

        const color = getTrailColor(subcat);
        const iconImg = getIcon(subcat);
        const trailLen = naval ? CFG.shipTrailLengthDeg : CFG.trailLengthDeg;

        // ── Icon billboard ──────────────────────────────────────────────────
        const iconEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
            billboard: {
                image: iconImg,
                scale: CFG.iconScale,
                rotation: Cesium.Math.toRadians(-heading),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                // Glow effect via eye offset
                eyeOffset: new Cesium.Cartesian3(0, 0, -500),
            },
            label: {
                text: String(meta.callsign || meta.vessel_name || subcat.toUpperCase()),
                font: "500 11px 'Rajdhani', sans-serif",
                fillColor: color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -28),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                showBackground: false,
                scale: 0.9,
            },
            // Store event data for click popup
            properties: {
                eventId: event.id,
                sourceKey: key,
                subcat,
                title: event.title,
                summary: event.summary,
                meta: JSON.stringify(meta),
            },
        });

        // ── Trail polyline ──────────────────────────────────────────────────
        const trailPositions = buildTrailPositions(lon, lat, heading, trailLen, CFG.trailSegments, altM);
        const trailColors = buildTrailColors(color, CFG.trailSegments);

        const trailEntity = viewer.entities.add({
            polyline: {
                positions: trailPositions,
                width: naval ? 1.5 : 2.0,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.18,
                    color: color.withAlpha(0.7),
                }),
                clampToGround: false,
                followSurface: false,
                depthFailMaterial: new Cesium.ColorMaterialProperty(color.withAlpha(0.1)),
            },
        });

        // ── AWACS orbit ring ────────────────────────────────────────────────
        let orbitEntity = null;
        if (subcat === "awacs") {
            const orbitPositions = buildOrbitPositions(lon, lat, CFG.awacOrbitRadiusKm);
            orbitEntity = viewer.entities.add({
                polyline: {
                    positions: orbitPositions,
                    width: 1.0,
                    material: new Cesium.PolylineGlowMaterialProperty({
                        glowPower: 0.12,
                        color: new Cesium.Color(1.0, 0.82, 0.3, 0.35),
                    }),
                    clampToGround: false,
                },
            });
        }

        trackMap.set(key, {
            iconEntity,
            trailEntity,
            orbitEntity,
            addedAt: Date.now(),
        });

        enforceMax();

        // Request a render so Cesium draws the new entity
        viewer.scene.requestRender();
    }

    // Periodic cleanup of expired tracks
    const cleanupInterval = setInterval(pruneExpired, 5 * 60 * 1000);

    // ── Public API ──────────────────────────────────────────────────────────
    return {
        addTrack,

        setTracks(events = []) {
            // Clear all existing
            for (const key of [...trackMap.keys()]) removeTrack(key);
            for (const e of events) addTrack(e);
        },

        clearAll() {
            for (const key of [...trackMap.keys()]) removeTrack(key);
        },

        destroy() {
            clearInterval(cleanupInterval);
            for (const key of [...trackMap.keys()]) removeTrack(key);
        },

        get count() { return trackMap.size; },
    };
}

// ─── Category detector ────────────────────────────────────────────────────────
// Use this in essential.js to decide if an event should get a military track

export function isMilitaryTrackEvent(event) {
    if (!event) return false;
    const cat = String(event.category || "").toLowerCase();
    const subcat = String(event.subcategory || "").toLowerCase();
    const src = String(event.source_name || "").toLowerCase();

    // Must be military category AND from our workers
    if (cat !== "military") return false;
    if (!src.includes("ads-b") && !src.includes("ais")) return false;

    // Must have valid position
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (lat === 0 && lon === 0) return false;

    return true;
}