// File Path: /assets/js/warzone-sweeper.js
import * as Cesium from "cesium";
let __sweeperEntities = [];
let __sweeperTicker = null;
let __radarViewer = null;
let __radarItems = [];
let __radarLabels = [];
const RADAR_FALLBACK_COLOR = "#18e2db";
export const RADAR_SWEEP_MATERIAL_TYPE = "StratOpsRadarSweep";
export const RADAR_RING_RATIOS = Object.freeze([0.34, 0.67, 1]);
const SWEEPER_RENDER = {
    labelFrameSkip: 3,
    requestRenderFrameSkip: 2,
    maxHeight: 10000000,
    maxCount: 7,
    maxOverlap: 0.32,
    overlayHeight: 1200,
};
function parseEventMetadata(event = {}) {
    const raw = event?.metadata;
    if (!raw) return {};
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function toFiniteNumber(...values) {
    for (const value of values) {
        const num = Number(value);
        if (Number.isFinite(num)) return num;
    }
    return null;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function cssNumber(name, fallback) {
    if (typeof window === "undefined" || typeof getComputedStyle !== "function") return fallback;
    const parsed = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(parsed) ? parsed : fallback;
}
function cssColor(name, fallback) {
    if (typeof window === "undefined" || typeof getComputedStyle !== "function") return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function readRadarVisualTokens(fallbackColor = RADAR_FALLBACK_COLOR) {
    const color = cssColor("--radar-color", fallbackColor);
    const ringColor = cssColor("--radar-ring-color", color);
    return {
        color,
        ringColor,
        ringOpacity: clamp(cssNumber("--radar-ring-opacity", 0.42), 0, 1),
        ringOuterOpacity: clamp(cssNumber("--radar-ring-outer-opacity", 0.7), 0, 1),
        ringWidth: clamp(cssNumber("--radar-ring-width", 1.6), 0.5, 4),
        sweepOpacityMin: clamp(cssNumber("--radar-sweep-opacity-min", 0.02), 0, 1),
        sweepOpacityMid: clamp(cssNumber("--radar-sweep-opacity-mid", 0.14), 0, 1),
        sweepOpacityMax: clamp(cssNumber("--radar-sweep-opacity-max", 0.42), 0, 1),
        sweepWidthDeg: clamp(cssNumber("--radar-sweep-width", 64), 45, 80),
        sweepLeadingEdgeDeg: clamp(cssNumber("--radar-sweep-leading-edge-width", 1.4), 0.5, 3),
        sweepSpeed: clamp(cssNumber("--radar-sweep-speed", 1), 0.1, 3),
        centerSize: clamp(cssNumber("--radar-center-size", 4), 2, 10),
        centerGlow: clamp(cssNumber("--radar-center-glow", 2), 0, 6),
    };
}
function normalizeHeading(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(((num % 360) + 360) % 360);
}
function sanitizeIdPart(value = "") {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
}
function makeOverlayEntityId(prefix, event = {}, index = 0) {
    const base =
        sanitizeIdPart(event?.id) ||
        sanitizeIdPart(event?.track_key) ||
        sanitizeIdPart(event?.title) ||
        `item-${index + 1}`;
    return `${prefix}-${base}-${index + 1}`;
}
function buildOverlayClusterEvents(event = {}) {
    const source = Array.isArray(event?._clusterEvents) && event._clusterEvents.length
        ? event._clusterEvents
        : [event];
    return source
        .filter(Boolean)
        .slice(0, 24)
        .map((item) => ({
            id: item?.id || "",
            title: item?.title || "",
            summary: item?.summary || "",
            category: item?.category || "",
            severity: item?.severity || "",
            location_label: item?.location_label || item?.impact_label || item?.country || "",
            occurred_at: item?.occurred_at || "",
        }));
}
function resolveOverlaySourceUrl(event = {}) {
    const raw = String(
        event?.source_url ||
        event?.source_link ||
        event?.source ||
        event?.url ||
        event?.link ||
        ""
    ).trim();
    return /^https?:\/\//i.test(raw) ? raw : "";
}
function buildOverlayMovementSummary(event = {}) {
    const metadata = parseEventMetadata(event);
    const callsignRaw = String(
        event?.callsign ||
        metadata?.callsign ||
        metadata?.call_sign ||
        ""
    ).trim();
    const callsign = callsignRaw ? callsignRaw.toUpperCase() : "";
    const altitudeFt = toFiniteNumber(
        event?.altitude_ft,
        event?.altitude,
        metadata?.altitude_ft,
        metadata?.altitude
    );
    const speedKts = toFiniteNumber(
        event?.speed_kts,
        event?.ground_speed_kts,
        event?.speed,
        metadata?.speed_kts,
        metadata?.ground_speed_kts,
        metadata?.speed
    );
    const headingDeg = normalizeHeading(
        toFiniteNumber(
            event?.heading_deg,
            event?.heading,
            metadata?.heading_deg,
            metadata?.heading
        )
    );
    const parts = [];
    if (callsign) parts.push(`Callsign ${callsign}`);
    if (Number.isFinite(altitudeFt) && altitudeFt > 0) parts.push(`ALT ${Math.round(altitudeFt)} ft`);
    if (Number.isFinite(speedKts) && speedKts > 0) parts.push(`SPD ${Math.round(speedKts)} kt`);
    if (Number.isFinite(headingDeg)) parts.push(`HDG ${headingDeg} deg`);
    if (!parts.length) return "";
    return `Movement: ${parts.join(" | ")}.`;
}
function buildOverlayPopupProperties(event = {}, fallbackId = "") {
    const clusterCountRaw = Number(event?.cluster_count || event?._clusterCount || 1);
    const clusterCount = Number.isFinite(clusterCountRaw) && clusterCountRaw > 0 ? clusterCountRaw : 1;
    const summaryBase = String(event?.summary || "").trim();
    const movementSummary = buildOverlayMovementSummary(event);
    const summary = summaryBase && movementSummary
        ? `${summaryBase} ${movementSummary}`
        : (summaryBase || movementSummary || "Operational coverage overlay.");
    return {
        event_id: String(event?.id || fallbackId || "").trim(),
        title: String(event?.title || event?.subcategory || event?.weapon_type || "Coverage hotspot").trim(),
        summary,
        category: String(event?.category || "military").trim(),
        severity: String(event?.severity || "medium").trim(),
        cluster_count: clusterCount,
        cluster_events: buildOverlayClusterEvents(event),
        location_label: String(
            event?.location_label ||
            event?.impact_label ||
            event?.origin_label ||
            event?.country ||
            ""
        ).trim(),
        occurred_at: String(event?.occurred_at || event?.updated_at || "").trim(),
        weapon_type: String(event?.weapon_type || event?.subcategory || event?.type || "").trim(),
        source_url: resolveOverlaySourceUrl(event),
    };
}
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
    if (text.includes("awacs")) return { radius: 400000, speed: 0.65, label: "ISR Radar" };
    if (text.includes("fighter")) return { radius: 180000, speed: 0.95, label: "Airborne Radar" };
    if (text.includes("carrier")) return { radius: 600000, speed: 0.45, label: "Carrier Radar" };
    if (text.includes("destroyer")) return { radius: 120000, speed: 0.80, label: "Naval Radar" };
    if (text.includes("frigate")) return { radius: 120000, speed: 0.80, label: "Naval Radar" };
    if (text.includes("submarine")) return { radius: 80000, speed: 0.40, label: "Sonar Detection" };
    if (text.includes("sam")) return { radius: 250000, speed: 0.55, label: "SAM Radar" };
    if (text.includes("air defense")) return { radius: 250000, speed: 0.55, label: "Air Defense Radar" };
    if (text.includes("airspace") || text.includes("notam")) return { radius: 260000, speed: 0.60, label: "Airspace Watch" };
    return null;
}
function getCameraHeight(viewer) {
    try {
        return Number(viewer?.camera?.positionCartographic?.height || 0);
    } catch {
        return 0;
    }
}
function shouldRenderSweepers(viewer) {
    return getCameraHeight(viewer) <= SWEEPER_RENDER.maxHeight;
}
export function buildRadarSweepStops(widthDeg = 64, {
    minAlpha = 0.02,
    midAlpha = 0.14,
    maxAlpha = 0.42,
    leadingEdgeDeg = 1.4,
} = {}) {
    const width = clamp(Number(widthDeg) || 64, 45, 80);
    const min = clamp(Number(minAlpha) || 0, 0, 1);
    const mid = clamp(Number(midAlpha) || 0, min, 1);
    const max = clamp(Number(maxAlpha) || 0, mid, 1);
    const trailStart = 1 - (width / 360);
    const trailSpan = 1 - trailStart;
    const edgeStop = clamp((Number(leadingEdgeDeg) || 1.4) / 360, 0.001, trailStart * 0.5);
    return [
        { offset: 0, alpha: max },
        { offset: edgeStop, alpha: 0 },
        { offset: trailStart, alpha: 0 },
        { offset: trailStart + trailSpan * 0.18, alpha: min },
        { offset: trailStart + trailSpan * 0.58, alpha: mid },
        { offset: trailStart + trailSpan * 0.86, alpha: Math.max(mid, max * 0.68) },
        { offset: 1, alpha: max },
    ];
}
function ensureRadarSweepMaterialRegistered() {
    if (Cesium.Material._materialCache.getMaterial(RADAR_SWEEP_MATERIAL_TYPE)) return;
    Cesium.Material._materialCache.addMaterial(RADAR_SWEEP_MATERIAL_TYPE, {
        fabric: {
            type: RADAR_SWEEP_MATERIAL_TYPE,
            uniforms: {
                color: Cesium.Color.WHITE,
                heading: 0,
                sweepWidth: Cesium.Math.toRadians(64),
                leadingEdgeWidth: Cesium.Math.toRadians(1.4),
                minAlpha: 0.02,
                midAlpha: 0.14,
                maxAlpha: 0.42,
            },
            source: `
                czm_material czm_getMaterial(czm_materialInput materialInput)
                {
                    czm_material material = czm_getDefaultMaterial(materialInput);
                    vec2 centered = materialInput.st - vec2(0.5);
                    float radius = length(centered) * 2.0;
                    float fragmentHeading = atan(centered.x, centered.y);
                    if (fragmentHeading < 0.0) fragmentHeading += 6.28318530718;
                    float trail = mod(heading - fragmentHeading + 6.28318530718, 6.28318530718);
                    float inSweep = 1.0 - step(sweepWidth, trail);
                    float strength = 1.0 - clamp(trail / max(sweepWidth, 0.0001), 0.0, 1.0);
                    float fadedAlpha = strength < 0.58
                        ? mix(minAlpha, midAlpha, smoothstep(0.0, 0.58, strength))
                        : mix(midAlpha, maxAlpha, smoothstep(0.58, 1.0, strength));
                    float edgeAlpha = (1.0 - smoothstep(0.0, max(leadingEdgeWidth, 0.0001), trail)) * maxAlpha;
                    float radialMask = smoothstep(0.0, 0.05, radius) * (1.0 - smoothstep(0.96, 1.0, radius));
                    material.diffuse = color.rgb;
                    material.alpha = color.a * max(fadedAlpha * inSweep, edgeAlpha) * radialMask;
                    return material;
                }
            `,
        },
        translucent: () => true,
    });
}
ensureRadarSweepMaterialRegistered();
class RadarSweepMaterialProperty {
    constructor(state, color, tokens) {
        ensureRadarSweepMaterialRegistered();
        this._definitionChanged = new Cesium.Event();
        this._state = state;
        this._color = color;
        this._tokens = tokens;
    }
    get isConstant() {
        return false;
    }
    get definitionChanged() {
        return this._definitionChanged;
    }
    getType() {
        return RADAR_SWEEP_MATERIAL_TYPE;
    }
    getValue(_time, result = {}) {
        result.color = Cesium.Color.clone(this._color, result.color);
        result.heading = Cesium.Math.toRadians(this._state.heading);
        result.sweepWidth = Cesium.Math.toRadians(this._tokens.sweepWidthDeg);
        result.leadingEdgeWidth = Cesium.Math.toRadians(this._tokens.sweepLeadingEdgeDeg);
        result.minAlpha = this._tokens.sweepOpacityMin;
        result.midAlpha = this._tokens.sweepOpacityMid;
        result.maxAlpha = this._tokens.sweepOpacityMax;
        return result;
    }
    equals(other) {
        return this === other;
    }
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
            Cesium.SceneTransforms.worldToWindowCoordinates?.(viewer.scene, cart) ||
            Cesium.SceneTransforms.wgs84ToWindowCoordinates?.(viewer.scene, cart);
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
function getRadarDestination(lat, lon, radiusMeters, headingDeg) {
    const angularDistance = radiusMeters / 6371000;
    const bearing = Cesium.Math.toRadians(headingDeg);
    const lat1 = Cesium.Math.toRadians(lat);
    const lon1 = Cesium.Math.toRadians(lon);
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angularDistance) +
        Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [Cesium.Math.toDegrees(lon2), Cesium.Math.toDegrees(lat2)];
}
function buildRadarRingPositions(lat, lon, radiusMeters, steps = 96) {
    const coordinates = [];
    for (let index = 0; index <= steps; index += 1) {
        coordinates.push(...getRadarDestination(lat, lon, radiusMeters, (index / steps) * 360));
    }
    return Cesium.Cartesian3.fromDegreesArray(coordinates);
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
function getSpatialBucketKey(lat, lon, radiusMeters = 0) {
    const bucketDeg = Math.max(1.8, (radiusMeters / 111320) * 0.95);
    return `${Math.round(lat / bucketDeg)}:${Math.round(lon / bucketDeg)}`;
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
    const usedBuckets = new Set();
    for (const item of valid) {
        const bucketKey = getSpatialBucketKey(item.lat, item.lon, item.preset.radius);
        if (usedBuckets.has(bucketKey)) {
            continue;
        }
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
            usedBuckets.add(bucketKey);
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
    if (!shouldRenderSweepers(viewer)) {
        viewer.scene.requestRender?.();
        return;
    }
    const candidates = selectRadarCandidates(
        events,
        SWEEPER_RENDER.maxCount,
        SWEEPER_RENDER.maxOverlap
    );
    if (!candidates.length) {
        viewer.scene.requestRender?.();
        return;
    }
    __radarViewer = viewer;
    __radarItems = [];
    if (viewer.entities?.suspendEvents) viewer.entities.suspendEvents();
    candidates.forEach((candidate, index) => {
        const preset = candidate.preset;
        const lat = candidate.lat;
        const lon = candidate.lon;
        const visualTokens = readRadarVisualTokens();
        const base = Cesium.Color.fromCssColorString(visualTokens.color) || Cesium.Color.fromCssColorString(RADAR_FALLBACK_COLOR);
        const ringBase = Cesium.Color.fromCssColorString(visualTokens.ringColor) || base;
        const overlayId = makeOverlayEntityId("sweeper", candidate.event, index);
        const popupProps = buildOverlayPopupProperties(candidate.event, overlayId);
        const state = {
            heading: 320 + (index * 40)
        };
        const overlayHeight = SWEEPER_RENDER.overlayHeight;
        const rings = RADAR_RING_RATIOS.map((ratio, ringIndex) => viewer.entities.add({
            id: `${overlayId}-ring-${ringIndex + 1}`,
            polyline: {
                positions: buildRadarRingPositions(lat, lon, preset.radius * ratio),
                material: ringBase.withAlpha(
                    ringIndex === RADAR_RING_RATIOS.length - 1
                        ? visualTokens.ringOuterOpacity
                        : visualTokens.ringOpacity
                ),
                width: visualTokens.ringWidth,
                clampToGround: true,
                arcType: Cesium.ArcType.GEODESIC,
            },
            properties: { ...popupProps },
        }));
        const sweepBeam = viewer.entities.add({
                id: `${overlayId}-sweep`,
                position: Cesium.Cartesian3.fromDegrees(lon, lat),
                ellipse: {
                    semiMajorAxis: preset.radius,
                    semiMinorAxis: preset.radius,
                    material: new RadarSweepMaterialProperty(state, base, visualTokens),
                    height: 0,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    zIndex: 40 + index,
                },
                properties: { ...popupProps },
        });
        const centerDot = viewer.entities.add({
            id: `${overlayId}-center`,
            position: Cesium.Cartesian3.fromDegrees(lon, lat, overlayHeight + 10),
            point: {
                pixelSize: visualTokens.centerSize,
                color: base.withAlpha(0.72),
                outlineColor: base.withAlpha(0.20),
                outlineWidth: visualTokens.centerGlow,
                heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: 0,
            },
            properties: { ...popupProps },
        });
        const labelEl = createRadarLabel(preset.label || "Radar Coverage");
        __sweeperEntities.push(
            ...rings,
            sweepBeam,
            centerDot
        );
        __radarItems.push({
            lat,
            lon,
            preset,
            visualTokens,
            state,
            labelEl
        });
    });
    if (viewer.entities?.resumeEvents) viewer.entities.resumeEvents();
    let lastTs = null;
    let frameCount = 0;
    const tick = (ts) => {
        if (!__radarViewer) return;
        if (lastTs == null) lastTs = ts;
        if (document.visibilityState === "hidden") {
            lastTs = ts;
            __sweeperTicker = requestAnimationFrame(tick);
            return;
        }
        const dt = (ts - lastTs) / 1000;
        lastTs = ts;
        frameCount += 1;
        if (!shouldRenderSweepers(viewer)) {
            clearSweepers(viewer);
            viewer.scene.requestRender?.();
            return;
        }
        __radarItems.forEach((item) => {
            item.state.heading = (
                item.state.heading + (item.preset.speed * item.visualTokens.sweepSpeed * 60 * dt)
            ) % 360;
        });
        if (frameCount % SWEEPER_RENDER.labelFrameSkip === 0) {
            updateRadarLabels();
        }
        if (frameCount % SWEEPER_RENDER.requestRenderFrameSkip === 0) {
            viewer.scene.requestRender?.();
        }
        __sweeperTicker = requestAnimationFrame(tick);
    };
    __sweeperTicker = requestAnimationFrame(tick);
    updateRadarLabels();
    viewer.scene.requestRender?.();
}
