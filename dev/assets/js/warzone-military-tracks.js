// assets/js/warzone-military-tracks.js
// Restored manager-style military tracks system
// Keeps your existing app flow working, plus:
// - root/CSS controlled trail + asset settings
// - solid trail color (no glow border)
// - blink effect
// - one-time sound on appear
// - SVG icon support with canvas fallback
// - longer visible lifetime

import * as Cesium from "cesium";

/* =========================================================
   ROOT / CSS HELPERS
========================================================= */

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

/* =========================================================
   CONFIG
========================================================= */

const CFG = {
    maxTracks: 90,
    trailSegments: 10,
    trailLengthDeg: 3.0,
    shipTrailLengthDeg: 1.5,
    trailFadeMs: 25 * 60 * 1000,

    iconSize: 64,
    iconScale: 0.72,

    awacOrbitRadiusKm: 280,
    altitudeAircraft: 9000,
    altitudeShip: 80,
    droneAltitude: 600,
    droneOrbitRadiusKm: 8,
    droneOrbitSteps: 60,
};

/* =========================================================
   ICON PATHS
   Uses SVG first. If missing, falls back to canvas icon.
========================================================= */

const ICONS = {
    fighter: "/assets/images/icons/fighter.svg",
    awacs: "/assets/images/icons/awacs.svg",
    recon: "/assets/images/icons/recon.svg",
    patrol: "/assets/images/icons/recon.svg",
    tanker: "/assets/images/icons/tanker.svg",
    transport: "/assets/images/icons/tanker.svg",
    carrier: "/assets/images/icons/carrier.svg",
    destroyer: "/assets/images/icons/destroyer.svg",
    frigate: "/assets/images/icons/frigate.svg",
    submarine: "/assets/images/icons/submarine.svg",
    drone: "/assets/images/icons/drone.svg",
    uav: "/assets/images/icons/drone.svg",
    shahed: "/assets/images/icons/drone.svg",
    naval: "/assets/images/icons/naval.svg",
};

function getIconImage(subcat, colorHex) {
    const s = String(subcat || "").toLowerCase();
    const path = ICONS[s];

    // If you have real SVGs, this will be used.
    // If not, it falls back to the canvas-generated icon.
    return path || makeIconCanvas(s, colorHex);
}

/* =========================================================
   SOUND
========================================================= */

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

/* =========================================================
   UTILS
========================================================= */

function hexToCs(hex, a = 1.0) {
    return Cesium.Color.fromCssColorString(hex).withAlpha(a);
}

function getColor(subcat) {
    const s = (subcat || "").toLowerCase();

    // Root-controlled generic fallback
    const militaryColor = cssVar("--warzone-military", "#56d80e");

    if (s === "awacs") return cssVar("--warzone-military-awacs-color", "#f0d060");
    if (s === "tanker" || s === "transport") return cssVar("--warzone-military-tanker-color", "#00d9b2");
    if (s === "recon" || s === "patrol") return cssVar("--warzone-military-recon-color", "#ff7820");
    if (s === "carrier") return cssVar("--warzone-military-carrier-color", "#ff3c3c");
    if (s === "destroyer" || s === "frigate") return cssVar("--warzone-military-naval-color", "#9b7bff");
    if (s === "submarine") return cssVar("--warzone-military-submarine-color", "#7bdcff");
    if (s === "naval" || s === "logistics") return cssVar("--warzone-military-naval-color", "#00d9b2");
    if (s === "drone" || s === "uav" || s === "shahed") return cssVar("--warzone-military-drone-color", "#ffcc00");

    return militaryColor;
}

function getTrailColor(subcat, fallback) {
    const s = String(subcat || "").toLowerCase();

    if (s === "awacs") return cssVar("--warzone-military-trail-awacs", fallback);
    if (s === "tanker" || s === "transport") return cssVar("--warzone-military-trail-tanker", fallback);
    if (s === "recon" || s === "patrol") return cssVar("--warzone-military-trail-recon", fallback);
    if (s === "carrier") return cssVar("--warzone-military-trail-carrier", fallback);
    if (s === "destroyer" || s === "frigate" || s === "naval" || s === "logistics") {
        return cssVar("--warzone-military-trail-naval", fallback);
    }
    if (s === "submarine") return cssVar("--warzone-military-trail-submarine", fallback);
    if (s === "drone" || s === "uav" || s === "shahed") return cssVar("--warzone-military-trail-drone", fallback);

    return cssVar("--warzone-military-trail-default", fallback);
}

function getHeadingOffset(subcat) {
    const s = (subcat || "").toLowerCase();

    if (s === "fighter") return numberVar("--warzone-military-heading-offset-fighter", 0);
    if (s === "awacs") return numberVar("--warzone-military-heading-offset-awacs", 0);
    if (s === "recon" || s === "patrol") return numberVar("--warzone-military-heading-offset-recon", 0);
    if (s === "tanker" || s === "transport") return numberVar("--warzone-military-heading-offset-tanker", 0);
    if (s === "carrier") return numberVar("--warzone-military-heading-offset-carrier", 0);
    if (s === "destroyer") return numberVar("--warzone-military-heading-offset-destroyer", 0);
    if (s === "frigate") return numberVar("--warzone-military-heading-offset-frigate", 0);
    if (s === "submarine") return numberVar("--warzone-military-heading-offset-submarine", 0);
    if (s === "drone" || s === "uav" || s === "shahed") return numberVar("--warzone-military-heading-offset-drone", 0);

    return numberVar("--warzone-military-heading-offset-default", 0);
}

function isNaval(subcat) {
    return ["carrier", "destroyer", "frigate", "submarine", "naval", "logistics", "patrol", "minesweeper"]
        .includes((subcat || "").toLowerCase());
}

function buildTrail(lon, lat, headingDeg, len, segs, altM) {
    const backRad = Cesium.Math.toRadians((headingDeg + 180) % 360);

    return Array.from({ length: segs + 1 }, (_, i) => {
        const t = i / segs;
        const dist = t * len;

        return Cesium.Cartesian3.fromDegrees(
            lon + dist * Math.sin(backRad),
            lat + dist * Math.cos(backRad),
            altM * (1 - t * 0.25)
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

/* =========================================================
   CANVAS ICON FALLBACKS
========================================================= */

const __iconCache = new Map();

function makeIconCanvas(subcat, colorHex) {
    const cacheKey = `${subcat}::${colorHex}`;
    if (__iconCache.has(cacheKey)) return __iconCache.get(cacheKey);

    const S = CFG.iconSize;
    const cx = S / 2;
    const cy = S / 2;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;

    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = colorHex;
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 10;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const s = String(subcat || "").toLowerCase();

    if (s === "fighter" || s === "military") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 20); ctx.lineTo(cx + 6, cy - 4);
        ctx.lineTo(cx + 18, cy + 14); ctx.lineTo(cx + 10, cy + 12);
        ctx.lineTo(cx + 7, cy + 20); ctx.lineTo(cx, cy + 14);
        ctx.lineTo(cx - 7, cy + 20); ctx.lineTo(cx - 10, cy + 12);
        ctx.lineTo(cx - 18, cy + 14); ctx.lineTo(cx - 6, cy - 4);
        ctx.closePath(); ctx.fill();
    } else if (s === "tanker" || s === "transport") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 20); ctx.lineTo(cx + 4, cy - 8);
        ctx.lineTo(cx + 22, cy + 4); ctx.lineTo(cx + 14, cy + 8);
        ctx.lineTo(cx + 5, cy + 20); ctx.lineTo(cx - 5, cy + 20);
        ctx.lineTo(cx - 14, cy + 8); ctx.lineTo(cx - 22, cy + 4);
        ctx.lineTo(cx - 4, cy - 8); ctx.closePath(); ctx.fill();
    } else if (s === "awacs") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18); ctx.lineTo(cx + 4, cy - 6);
        ctx.lineTo(cx + 20, cy + 4); ctx.lineTo(cx + 12, cy + 8);
        ctx.lineTo(cx + 5, cy + 18); ctx.lineTo(cx - 5, cy + 18);
        ctx.lineTo(cx - 12, cy + 8); ctx.lineTo(cx - 20, cy + 4);
        ctx.lineTo(cx - 4, cy - 6); ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.ellipse(cx, cy - 4, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    } else if (s === "recon" || s === "patrol") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 22); ctx.lineTo(cx + 3, cy - 10);
        ctx.lineTo(cx + 22, cy); ctx.lineTo(cx + 12, cy + 4);
        ctx.lineTo(cx + 4, cy + 22); ctx.lineTo(cx - 4, cy + 22);
        ctx.lineTo(cx - 12, cy + 4); ctx.lineTo(cx - 22, cy);
        ctx.lineTo(cx - 3, cy - 10); ctx.closePath(); ctx.fill();
    } else if (s === "carrier") {
        ctx.beginPath();
        ctx.roundRect(cx - 18, cy - 7, 36, 14, 3); ctx.fill();
        ctx.shadowBlur = 4;
        ctx.fillRect(cx + 6, cy - 13, 6, 6);
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - 16, cy - 2); ctx.lineTo(cx + 16, cy - 2); ctx.stroke();
    } else if (s === "destroyer" || s === "frigate") {
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18); ctx.lineTo(cx + 8, cy - 4);
        ctx.lineTo(cx + 10, cy + 12); ctx.lineTo(cx + 4, cy + 18);
        ctx.lineTo(cx - 4, cy + 18); ctx.lineTo(cx - 10, cy + 12);
        ctx.lineTo(cx - 8, cy - 4); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = colorHex; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy - 22);
        ctx.moveTo(cx - 5, cy - 18); ctx.lineTo(cx + 5, cy - 18); ctx.stroke();
    } else if (s === "submarine") {
        ctx.beginPath(); ctx.ellipse(cx, cy + 4, 7, 18, 0, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 4; ctx.fillRect(cx - 3, cy - 16, 6, 8);
    } else if (s === "drone" || s === "uav" || s === "shahed") {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            const x = cx + 13 * Math.cos(a);
            const y = cy + 13 * Math.sin(a);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.beginPath();
        ctx.roundRect(cx - 7, cy - 16, 14, 32, 3); ctx.fill();
    }

    const dataUrl = c.toDataURL("image/png");
    __iconCache.set(cacheKey, dataUrl);
    return dataUrl;
}

/* =========================================================
   DRONE LOITER
========================================================= */

function animateDroneLoiter(viewer, lon, lat, colorHex) {
    const orbit = buildCircle(lon, lat, CFG.droneOrbitRadiusKm, CFG.droneAltitude, CFG.droneOrbitSteps);
    const color = hexToCs(colorHex, 0.9);
    let frame = 0;

    const billboard = viewer.entities.add({
        position: new Cesium.CallbackProperty(() => orbit[frame % orbit.length], false),
        billboard: {
            image: getIconImage("drone", colorHex),
            scale: numberVar("--warzone-military-asset-scale", 0.72) * 0.62,
            color,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            eyeOffset: new Cesium.Cartesian3(0, 0, -200),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        },
    });

    const ringColor = cssVar("--warzone-military-drone-orbit-color", colorHex);
    const ringAlpha = numberVar("--warzone-military-drone-orbit-alpha", 0.32);
    const ringWidth = numberVar("--warzone-military-drone-orbit-width", 1.0);

    const ring = viewer.entities.add({
        polyline: {
            positions: orbit,
            width: ringWidth,
            material: hexToCs(ringColor, ringAlpha),
        },
    });

    const interval = setInterval(() => {
        frame = (frame + 1) % orbit.length;
        viewer.scene.requestRender();
    }, 700);

    return {
        billboard,
        ring,
        interval,
        stop() {
            clearInterval(interval);
        },
    };
}

/* =========================================================
   INIT / MANAGER
========================================================= */

export function initMilitaryTracks(viewer) {
    if (!viewer) return null;

    const trackMap = new Map();

    function removeTrack(key) {
        const t = trackMap.get(key);
        if (!t) return;

        if (t.iconEntity) viewer.entities.remove(t.iconEntity);
        if (t.trailEntity) viewer.entities.remove(t.trailEntity);
        if (t.orbitEntity) viewer.entities.remove(t.orbitEntity);

        if (t.droneAnim) {
            t.droneAnim.stop();
            viewer.entities.remove(t.droneAnim.billboard);
            viewer.entities.remove(t.droneAnim.ring);
        }

        if (t.cleanupTimer) {
            clearTimeout(t.cleanupTimer);
        }

        trackMap.delete(key);
    }

    function enforceMax() {
        if (trackMap.size <= CFG.maxTracks) return;

        let oldestKey = null;
        let oldestTime = Infinity;

        for (const [k, t] of trackMap.entries()) {
            if (t.addedAt < oldestTime) {
                oldestTime = t.addedAt;
                oldestKey = k;
            }
        }

        if (oldestKey) removeTrack(oldestKey);
    }

    function addTrack(event) {
        if (!event) return;

        const lon = Number(event.lon);
        const lat = Number(event.lat);

        if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) return;

        const key = event.source_key || `mil-${event.id || Date.now()}`;
        const subcat = String(event.subcategory || event.category || "military").toLowerCase();
        const meta = event.metadata || {};
        const heading = Number(meta.heading || event.heading || 0);
        const naval = isNaval(subcat);
        const altM = naval ? CFG.altitudeShip : CFG.altitudeAircraft;
        const colorHex = getColor(subcat);
        const color = hexToCs(colorHex);

        if (trackMap.has(key)) removeTrack(key);

        // Drone: loiter animation
        if (["drone", "uav", "shahed"].includes(subcat)) {
            const droneAnim = animateDroneLoiter(viewer, lon, lat, colorHex);

            playMilitaryAppearSound();

            const lifespan = 45000 + Math.random() * 15000;
            const cleanupTimer = setTimeout(() => removeTrack(key), lifespan);

            trackMap.set(key, {
                droneAnim,
                addedAt: Date.now(),
                cleanupTimer,
            });

            enforceMax();
            viewer.scene.requestRender();
            return;
        }

        const callsign = String(
            meta.callsign ||
            meta.vessel_name ||
            meta.flight ||
            event.title ||
            subcat
        ).toUpperCase().slice(0, 14);

        const iconEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
            billboard: {
                image: getIconImage(subcat, colorHex),
                scale: numberVar("--warzone-military-asset-scale", CFG.iconScale),
                rotation: Cesium.Math.toRadians(-(heading + getHeadingOffset(subcat))),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                eyeOffset: new Cesium.Cartesian3(0, 0, -800),
                color: color.withAlpha(numberVar("--warzone-military-asset-alpha", 1)),
            },
            label: {
                text: callsign,
                font: "600 10px 'Rajdhani',monospace",
                fillColor: color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -34),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scale: 0.9,
                showBackground: true,
                backgroundColor: new Cesium.Color(0, 0, 0, 0.65),
                backgroundPadding: new Cesium.Cartesian2(5, 3),
            },
            properties: {
                eventId: event.id,
                subcat,
                title: event.title || "",
            },
        });

        const blinkMin = numberVar("--warzone-military-asset-blink-min", 0.55);
        const blinkMax = numberVar("--warzone-military-asset-blink-max", 1);
        const blinkSpeed = numberVar("--warzone-military-asset-blink-speed", 0.0028);

        iconEntity.billboard.color = new Cesium.CallbackProperty(() => {
            const alpha =
                blinkMin +
                (blinkMax - blinkMin) *
                (0.5 + 0.5 * Math.sin(Date.now() * blinkSpeed));

            return color.withAlpha(alpha);
        }, false);

        const trailLen = naval ? CFG.shipTrailLengthDeg : CFG.trailLengthDeg;
        const trailPos = buildTrail(lon, lat, heading, trailLen, CFG.trailSegments, altM);
        const trailColor = getTrailColor(subcat, colorHex);
        const trailAlpha = numberVar("--warzone-military-trail-alpha", 0.9);

        const trailEntity = viewer.entities.add({
            polyline: {
                positions: trailPos,
                width: naval
                    ? numberVar("--warzone-military-trail-width-naval", 2.4)
                    : numberVar("--warzone-military-trail-width-aircraft", 3.6),
                material: hexToCs(trailColor, trailAlpha),
                clampToGround: false,
                followSurface: false,
            },
        });

        let orbitEntity = null;
        if (subcat === "awacs") {
            const orbitColor = cssVar("--warzone-military-awacs-orbit-color", colorHex);
            const orbitAlpha = numberVar("--warzone-military-awacs-orbit-alpha", 0.28);
            const orbitWidth = numberVar("--warzone-military-awacs-orbit-width", 1.0);

            orbitEntity = viewer.entities.add({
                polyline: {
                    positions: buildCircle(lon, lat, CFG.awacOrbitRadiusKm, altM),
                    width: orbitWidth,
                    material: hexToCs(orbitColor, orbitAlpha),
                },
            });
        }

        playMilitaryAppearSound();

        const lifespan = naval
            ? 90000 + Math.random() * 30000   // 90–120 sec
            : 45000 + Math.random() * 15000;  // 45–60 sec

        const cleanupTimer = setTimeout(() => removeTrack(key), lifespan);

        trackMap.set(key, {
            iconEntity,
            trailEntity,
            orbitEntity,
            addedAt: Date.now(),
            cleanupTimer,
        });

        enforceMax();
        viewer.scene.requestRender();
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
    const src = String(event.source_name || "").toLowerCase();
    const subcat = String(event.subcategory || "").toLowerCase();

    if (cat !== "military") return false;

    const valid = [
        "fighter",
        "tanker",
        "transport",
        "awacs",
        "recon",
        "patrol",
        "carrier",
        "destroyer",
        "frigate",
        "submarine",
        "naval",
        "logistics",
        "military",
        "drone",
        "uav",
        "shahed",
    ];

    const ok =
        src.includes("ads-b") ||
        src.includes("ais") ||
        src.includes("dev test") ||
        src.includes("dev_test") ||
        valid.includes(subcat);

    if (!ok) return false;

    const lat = Number(event.lat);
    const lon = Number(event.lon);

    return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}