// assets/js/warzone-sweeper.js
import * as Cesium from "cesium";

let __sweeperEntities = [];
let __sweeperTicker = null;
let __radarViewer = null;
let __radarItems = [];
let __radarLabels = [];

function getSweepPreset(event = {}) {
    const sub = String(
        event.subcategory ||
        event.subtype ||
        event.type ||
        ""
    ).toLowerCase();

    const weapon = String(event.weapon_type || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const text = `${sub} ${weapon} ${title}`;

    if (text.includes("awacs")) return { radius: 400000, widthDeg: 34, speed: 0.65, color: "#18e2db", label: "ISR Radar" };
    if (text.includes("fighter")) return { radius: 180000, widthDeg: 24, speed: 0.95, color: "#18e2db", label: "Airborne Radar" };
    if (text.includes("carrier")) return { radius: 600000, widthDeg: 30, speed: 0.45, color: "#18e2db", label: "Carrier Radar" };
    if (text.includes("destroyer")) return { radius: 120000, widthDeg: 22, speed: 0.80, color: "#18e2db", label: "Naval Radar" };
    if (text.includes("frigate")) return { radius: 120000, widthDeg: 22, speed: 0.80, color: "#18e2db", label: "Naval Radar" };
    if (text.includes("submarine")) return { radius: 80000, widthDeg: 18, speed: 0.40, color: "#18e2db", label: "Sonar Detection" };
    if (text.includes("sam")) return { radius: 250000, widthDeg: 18, speed: 0.55, color: "#18e2db", label: "SAM Radar" };
    if (text.includes("air defense")) return { radius: 250000, widthDeg: 18, speed: 0.55, color: "#18e2db", label: "Air Defense Radar" };

    return null;
}

function buildSectorHierarchy(lon, lat, radiusMeters, headingDeg, widthDeg = 28, steps = 28) {
    const coords = [lon, lat];

    const start = headingDeg - widthDeg / 2;
    const end = headingDeg + widthDeg / 2;

    for (let i = 0; i <= steps; i++) {
        const a = Cesium.Math.toRadians(start + ((end - start) * i / steps));

        const dxKm = (radiusMeters / 1000) * Math.sin(a);
        const dyKm = (radiusMeters / 1000) * Math.cos(a);

        const dLat = dyKm / 111.32;
        const dLon = dxKm / (111.32 * Math.cos(Cesium.Math.toRadians(lat)));

        coords.push(lon + dLon, lat + dLat);
    }

    return new Cesium.PolygonHierarchy(
        Cesium.Cartesian3.fromDegreesArray(coords)
    );
}

function clearTicker() {
    if (__sweeperTicker) {
        cancelAnimationFrame(__sweeperTicker);
        __sweeperTicker = null;
    }
}

function ensureRadarLabelLayer() {
    return document.getElementById("wz-radar-label-layer");
}

function createRadarLabel(text = "") {
    const layer = ensureRadarLabelLayer();
    if (!layer) return null;

    const el = document.createElement("div");
    el.className = "wz-radar-label";
    el.innerHTML = `<span class="wz-radar-label__text"></span>`;

    const textEl = el.querySelector(".wz-radar-label__text");
    if (textEl) textEl.textContent = text;

    layer.appendChild(el);
    __radarLabels.push(el);

    return el;
}

function getRadarScreenPosition(viewer, lon, lat) {
    try {
        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

        const p =
            Cesium.SceneTransforms.wgs84ToWindowCoordinates?.(viewer.scene, cart) ||
            Cesium.SceneTransforms.worldToWindowCoordinates?.(viewer.scene, cart);

        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;

        return p;
    } catch {
        return null;
    }
}

function updateRadarLabels() {
    if (!__radarViewer || !__radarItems.length) return;

    __radarItems.forEach((item) => {
        if (!item?.labelEl) return;

        const p = getRadarScreenPosition(__radarViewer, item.lon, item.lat);

        if (!p) {
            item.labelEl.style.opacity = "0";
            return;
        }

        item.labelEl.style.opacity = "1";
        item.labelEl.style.left = `${p.x}px`;
        item.labelEl.style.top = `${p.y}px`;
    });
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = Cesium.Math.toRadians(lat2 - lat1);
    const dLon = Cesium.Math.toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(Cesium.Math.toRadians(lat1)) *
        Math.cos(Cesium.Math.toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function getCircleOverlapRatio(r1, r2, d) {
    if (d >= r1 + r2) return 0;

    const smaller = Math.min(r1, r2);
    if (d <= Math.abs(r1 - r2)) return 1;

    const r1Sq = r1 * r1;
    const r2Sq = r2 * r2;

    const alpha = 2 * Math.acos((d * d + r1Sq - r2Sq) / (2 * d * r1));
    const beta = 2 * Math.acos((d * d + r2Sq - r1Sq) / (2 * d * r2));

    const area1 = 0.5 * r1Sq * (alpha - Math.sin(alpha));
    const area2 = 0.5 * r2Sq * (beta - Math.sin(beta));

    const overlapArea = area1 + area2;
    const smallerArea = Math.PI * smaller * smaller;

    return overlapArea / smallerArea;
}

function selectRadarCandidates(events = [], maxCount = 3, maxOverlap = 0.50) {
    const valid = events
        .map((event) => {
            const lat = Number(event.lat);
            const lon = Number(event.lon);
            const preset = getSweepPreset(event);

            if (!Number.isFinite(lat) || !Number.isFinite(lon) || !preset) return null;

            return {
                event,
                lat,
                lon,
                preset
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.preset.radius - a.preset.radius);

    const selected = [];

    for (const item of valid) {
        let shouldSkip = false;

        for (const existing of selected) {
            const d = getDistanceMeters(item.lat, item.lon, existing.lat, existing.lon);
            const overlap = getCircleOverlapRatio(item.preset.radius, existing.preset.radius, d);

            if (overlap > maxOverlap) {
                shouldSkip = true;
                break;
            }
        }

        if (!shouldSkip) {
            selected.push(item);
        }

        if (selected.length >= maxCount) break;
    }

    return selected;
}

export function clearSweepers(viewer) {
    clearTicker();

    __sweeperEntities.forEach((entity) => {
        try { viewer?.entities?.remove(entity); } catch { }
    });

    __sweeperEntities = [];
    __radarItems = [];

    __radarLabels.forEach((el) => {
        try { el.remove(); } catch { }
    });
    __radarLabels = [];

    __radarViewer = null;
}

export function renderSweepers(viewer, events = []) {
    if (!viewer) return;

    clearSweepers(viewer);

    const candidates = selectRadarCandidates(events, 4, 0.35);

    if (!candidates.length) {
        viewer.scene.requestRender?.();
        return;
    }

    __radarViewer = viewer;
    __radarItems = [];

    candidates.forEach((candidate, index) => {
        const preset = candidate.preset;
        const lat = candidate.lat;
        const lon = candidate.lon;
        const base = Cesium.Color.fromCssColorString(preset.color);

        const state = {
            heading: 320 + (index * 40)
        };

        const outerRing = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            ellipse: {
                semiMajorAxis: preset.radius,
                semiMinorAxis: preset.radius,
                material: base.withAlpha(0.2),
                outline: false,
                outlineColor: base.withAlpha(0.03),
                outlineWidth: 1,
                height: 0
            }
        });

        const centerDot = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: {
                pixelSize: 5,
                color: base.withAlpha(0.9),
                outlineColor: base.withAlpha(0.18),
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });

        const sweepCore = viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.CallbackProperty(() => {
                    return buildSectorHierarchy(
                        lon,
                        lat,
                        preset.radius,
                        state.heading,
                        preset.widthDeg,
                        28
                    );
                }, false),
                material: base.withAlpha(0.4),
                outline: false,
                perPositionHeight: false,
                height: 0
            }
        });

        const labelEl = createRadarLabel(preset.label || "Radar Coverage");

        __sweeperEntities.push(
            outerRing,
            centerDot,
            sweepCore
        );

        __radarItems.push({
            lat,
            lon,
            preset,
            state,
            labelEl
        });
    });

    let lastTs = null;

    const tick = (ts) => {
        if (lastTs == null) lastTs = ts;
        const dt = (ts - lastTs) / 1000;
        lastTs = ts;

        __radarItems.forEach((item) => {
            item.state.heading = (
                item.state.heading + (item.preset.speed * 60 * dt)
            ) % 360;
        });

        updateRadarLabels();
        viewer.scene.requestRender?.();
        __sweeperTicker = requestAnimationFrame(tick);
    };

    __sweeperTicker = requestAnimationFrame(tick);
    updateRadarLabels();
    viewer.scene.requestRender?.();
}
