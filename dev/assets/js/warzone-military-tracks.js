// assets/js/warzone-military-tracks.js
// Canvas-generated icons (no SVG files needed), drone loiter animation

import * as Cesium from "cesium";

const CFG = {
    maxTracks: 150,
    trailSegments: 10,
    trailLengthDeg: 3.0,
    shipTrailLengthDeg: 1.5,
    trailFadeMs: 25 * 60 * 1000,
    iconSize: 48,
    iconScale: 0.6,
    awacOrbitRadiusKm: 280,
    altitudeAircraft: 9000,
    altitudeShip: 80,
    droneAltitude: 600,
    droneOrbitRadiusKm: 8,
    droneOrbitSteps: 60,
};

// ── Canvas Icon Factory ────────────────────────────────────────────────────────
const __iconCache = new Map();

function makeIconCanvas(subcat, colorHex) {
    const cacheKey = `${subcat}::${colorHex}`;
    if (__iconCache.has(cacheKey)) return __iconCache.get(cacheKey);
    const S = CFG.iconSize, cx = S / 2, cy = S / 2;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = colorHex;
    ctx.shadowColor = colorHex;
    ctx.shadowBlur = 10;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const s = subcat.toLowerCase();
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
        // Hexagon with propellers
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
            const x = cx + 13 * Math.cos(a), y = cy + 13 * Math.sin(a);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    } else {
        // Naval generic
        ctx.beginPath();
        ctx.roundRect(cx - 7, cy - 16, 14, 32, 3); ctx.fill();
    }
    __iconCache.set(cacheKey, c);
    return c;
}

function getColor(subcat) {
    const s = (subcat || "").toLowerCase();
    if (s === "awacs") return "#f0d060";
    if (s === "tanker" || s === "transport") return "#00d9b2";
    if (s === "recon" || s === "patrol") return "#ff7820";
    if (s === "carrier") return "#ff3c3c";
    if (s === "destroyer" || s === "frigate") return "#9b7bff";
    if (s === "submarine") return "#7bdcff";
    if (s === "naval" || s === "logistics") return "#00d9b2";
    if (s === "drone" || s === "uav" || s === "shahed") return "#ffcc00";
    return "#33d90a";
}

function isNaval(subcat) {
    return ["carrier", "destroyer", "frigate", "submarine", "naval", "logistics", "patrol", "minesweeper"]
        .includes((subcat || "").toLowerCase());
}

function hexToCs(hex, a = 1.0) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    return new Cesium.Color(r, g, b, a);
}

function buildTrail(lon, lat, headingDeg, len, segs, altM) {
    const backRad = Cesium.Math.toRadians((headingDeg + 180) % 360);
    return Array.from({ length: segs + 1 }, (_, i) => {
        const t = i / segs, dist = t * len;
        return Cesium.Cartesian3.fromDegrees(
            lon + dist * Math.sin(backRad), lat + dist * Math.cos(backRad), altM * (1 - t * 0.25)
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

// ── Drone loiter ───────────────────────────────────────────────────────────────
function animateDroneLoiter(viewer, lon, lat, colorHex) {
    const orbit = buildCircle(lon, lat, CFG.droneOrbitRadiusKm, CFG.droneAltitude, CFG.droneOrbitSteps);
    const color = hexToCs(colorHex, 0.9);
    let frame = 0;

    const billboard = viewer.entities.add({
        position: new Cesium.CallbackProperty(() => orbit[frame % orbit.length], false),
        billboard: {
            image: makeIconCanvas("drone", colorHex),
            scale: 0.45,
            color,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            eyeOffset: new Cesium.Cartesian3(0, 0, -200),
        },
    });

    const ring = viewer.entities.add({
        polyline: {
            positions: orbit,
            width: 1.0,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.15, color: hexToCs(colorHex, 0.3),
            }),
        },
    });

    const interval = setInterval(() => { frame++; viewer.scene.requestRender(); }, 400);
    return {
        billboard, ring, interval,
        stop() { clearInterval(interval); },
    };
}

// ── Init ───────────────────────────────────────────────────────────────────────
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
        trackMap.delete(key);
    }

    function enforceMax() {
        if (trackMap.size <= CFG.maxTracks) return;
        [...trackMap.entries()].sort((a, b) => a[1].addedAt - b[1].addedAt)
            .slice(0, trackMap.size - CFG.maxTracks)
            .forEach(([k]) => removeTrack(k));
    }

    function addTrack(event) {
        if (!event) return;
        const lon = Number(event.lon), lat = Number(event.lat);
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
            trackMap.set(key, { droneAnim, addedAt: Date.now() });
            enforceMax();
            viewer.scene.requestRender();
            return;
        }

        const callsign = String(meta.callsign || meta.vessel_name || meta.flight || event.title || subcat).toUpperCase().slice(0, 14);

        const iconEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, altM),
            billboard: {
                image: makeIconCanvas(subcat, colorHex),
                scale: CFG.iconScale,
                rotation: Cesium.Math.toRadians(-heading),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                eyeOffset: new Cesium.Cartesian3(0, 0, -800),
                color,
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
            properties: { eventId: event.id, subcat, title: event.title || "" },
        });

        const trailLen = naval ? CFG.shipTrailLengthDeg : CFG.trailLengthDeg;
        const trailPos = buildTrail(lon, lat, heading, trailLen, CFG.trailSegments, altM);
        const trailEntity = viewer.entities.add({
            polyline: {
                positions: trailPos,
                width: naval ? 1.5 : 2.0,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.2, color: hexToCs(colorHex, 0.6),
                }),
                clampToGround: false, followSurface: false,
            },
        });

        let orbitEntity = null;
        if (subcat === "awacs") {
            orbitEntity = viewer.entities.add({
                polyline: {
                    positions: buildCircle(lon, lat, CFG.awacOrbitRadiusKm, altM),
                    width: 1.0,
                    material: new Cesium.PolylineGlowMaterialProperty({
                        glowPower: 0.1, color: hexToCs(colorHex, 0.28),
                    }),
                },
            });
        }

        trackMap.set(key, { iconEntity, trailEntity, orbitEntity, addedAt: Date.now() });
        enforceMax();
        viewer.scene.requestRender();
    }

    const cleanupInterval = setInterval(() => {
        const cutoff = Date.now() - CFG.trailFadeMs;
        for (const [k, t] of trackMap) { if (t.addedAt < cutoff) removeTrack(k); }
    }, 5 * 60 * 1000);

    return {
        addTrack,
        setTracks(events = []) {
            [...trackMap.keys()].forEach(removeTrack);
            events.forEach(addTrack);
        },
        clearAll() { [...trackMap.keys()].forEach(removeTrack); },
        destroy() { clearInterval(cleanupInterval);[...trackMap.keys()].forEach(removeTrack); },
        get count() { return trackMap.size; },
    };
}

export function isMilitaryTrackEvent(event) {
    if (!event) return false;
    const cat = String(event.category || "").toLowerCase();
    const src = String(event.source_name || "").toLowerCase();
    const subcat = String(event.subcategory || "").toLowerCase();
    if (cat !== "military") return false;
    const valid = ["fighter", "tanker", "transport", "awacs", "recon", "patrol",
        "carrier", "destroyer", "frigate", "submarine", "naval",
        "logistics", "military", "drone", "uav", "shahed"];
    const ok = src.includes("ads-b") || src.includes("ais") ||
        src.includes("dev test") || src.includes("dev_test") ||
        valid.includes(subcat);
    if (!ok) return false;
    const lat = Number(event.lat), lon = Number(event.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
}