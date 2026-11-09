// File Path: /assets/js/warzone-sweeper.js
import * as Cesium from "cesium";
import {
    registerAnimationTask,
    requestSharedSceneRender,
    unregisterAnimationTask,
} from "./warzone-animation-scheduler.js";
let __sweeperEntities = [];
let __sweeperPrimitives = [];
let __sweeperTicker = false;
let __radarViewer = null;
let __radarItems = [];
let __radarLabels = [];
let __radarSourceEvents = [];
let __activeSamRadarItem = null;
let __samPointerStart = null;
let __removeSamRadarInteractions = null;
const __dismissedSamRadarIds = new Set();
let __removeCameraChanged = null;
let __removeCameraMoveEnd = null;
let __restoreGeneration = 0;
let __restorePending = false;
let __sweeperLastTimestamp = null;
let __sweeperFrameCount = 0;
const __sweeperStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
let __sweeperUpdateCount = 0;
const RADAR_FALLBACK_COLOR = "#18e2db";
const SWEEPER_ANIMATION_TASK_KEY = "overlay:radar-sweepers";
export const RADAR_SWEEP_MATERIAL_TYPE = "StratOpsRadarSweep";
export const RADAR_RING_RATIOS = Object.freeze([0.34, 0.67, 1]);
const SWEEPER_RENDER = {
    animationHz: 30,
    labelFrameSkip: 2,
    requestRenderFrameSkip: 1,
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
    const fillColor = cssColor("--radar-fill-color", color);
    return {
        color,
        ringColor,
        fillColor,
        fillOpacity: clamp(cssNumber("--radar-fill-opacity", 0), 0, 1),
        innerRingOpacity: clamp(cssNumber("--radar-inner-ring-opacity", 0), 0, 1),
        ringOpacity: clamp(cssNumber("--radar-ring-opacity", 0.42), 0, 1),
        ringOuterOpacity: clamp(cssNumber("--radar-ring-outer-opacity", 0.7), 0, 1),
        ringWidth: clamp(cssNumber("--radar-ring-width", 1.6), 0.5, 4),
        sweepOpacityMin: clamp(cssNumber("--radar-sweep-opacity-min", 0.02), 0, 1),
        sweepOpacityMid: clamp(cssNumber("--radar-sweep-opacity-mid", 0.14), 0, 1),
        sweepOpacityMax: clamp(cssNumber("--radar-sweep-opacity-max", 0.42), 0, 1),
        sweepWidthDeg: clamp(cssNumber("--radar-sweep-width", 64), 10, 180),
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
        lat: toFiniteNumber(event?.lat),
        lon: toFiniteNumber(event?.lon),
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
function syncSweeperCameraVisibility() {
    const viewer = __radarViewer;
    if (!viewer) return;
    const visible = shouldRenderSweepers(viewer);
    if (visible && !__radarItems.length && __radarSourceEvents.length) {
        if (__restorePending) return;
        const generation = ++__restoreGeneration;
        __restorePending = true;
        queueMicrotask(() => {
            if (generation !== __restoreGeneration || __radarViewer !== viewer) return;
            __restorePending = false;
            if (shouldRenderSweepers(viewer)) renderSweepers(viewer, __radarSourceEvents);
        });
        return;
    }
    if (!__radarItems.length || __sweeperPrimitives.every((primitive) => primitive.show === visible)) return;
    __sweeperPrimitives.forEach((primitive) => { primitive.show = visible; });
    if (visible) {
        startSweeperTicker();
        updateRadarLabels();
    } else {
        clearTicker();
        __radarItems.forEach((item) => {
            if (item.labelEl) item.labelEl.style.opacity = "0";
            item.labelOpacity = "0";
        });
    }
    requestSharedSceneRender();
}
function watchSweeperCamera(viewer) {
    __removeCameraChanged = viewer.camera?.changed?.addEventListener(syncSweeperCameraVisibility) || null;
    __removeCameraMoveEnd = viewer.camera?.moveEnd?.addEventListener(syncSweeperCameraVisibility) || null;
}
export function buildRadarSweepStops(widthDeg = 64, {
    minAlpha = 0.02,
    midAlpha = 0.14,
    maxAlpha = 0.42,
    leadingEdgeDeg = 1.4,
} = {}) {
    const width = clamp(Number(widthDeg) || 64, 10, 180);
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
                ringColor: Cesium.Color.WHITE,
                fillColor: Cesium.Color.WHITE,
                heading: 0,
                sweepWidth: Cesium.Math.toRadians(64),
                leadingEdgeWidth: Cesium.Math.toRadians(1.4),
                minAlpha: 0.02,
                midAlpha: 0.14,
                maxAlpha: 0.42,
                ringInner: RADAR_RING_RATIOS[0],
                ringMiddle: RADAR_RING_RATIOS[1],
                ringOuter: RADAR_RING_RATIOS[2],
                ringWidth: 1.6,
                innerRingOpacity: 0,
                ringOpacity: 0.42,
                ringOuterOpacity: 0.7,
                fillOpacity: 0,
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
                    float angularFeather = max(fwidth(trail) * 2.5, 0.0035);
                    float inSweep = 1.0 - smoothstep(
                        sweepWidth - angularFeather,
                        sweepWidth + angularFeather,
                        trail
                    );
                    float strength = 1.0 - clamp(
                        trail / max(sweepWidth, 0.0001),
                        0.0,
                        1.0
                    );

                    // The beam fades smoothly to fully transparent at its trailing edge.
                    float trailFade = pow(smoothstep(0.0, 1.0, strength), 1.8);

                    // Retain the narrow, bright leading edge.
                    float edgeAlpha = (
                        1.0 - smoothstep(0.0, max(leadingEdgeWidth, 0.0001), trail)
                    ) * maxAlpha;

                    float radialFeather = max(fwidth(radius) * 2.5, 0.004);
                    float radialMask = smoothstep(0.0, 0.05, radius)
                        * (1.0 - smoothstep(0.90, 1.0, radius));
                    float sweepAlpha = max(maxAlpha * trailFade * inSweep, edgeAlpha)
                        * radialMask;

                    float discMask = 1.0 - smoothstep(1.0 - radialFeather, 1.0, radius);
                    float fillAlpha = fillOpacity * discMask;

                    float ringPixel = max(fwidth(radius), 0.00035);
                    float ringHalfWidth = ringPixel * max(ringWidth, 0.5) * 0.5;
                    float ringFeather = ringPixel * 1.5;
                    float ringInnerEdge = max(0.0, ringHalfWidth - ringFeather * 0.5);
                    float ringOuterEdge = ringHalfWidth + ringFeather * 0.5;
                    float outerTarget = min(ringOuter, 1.0 - ringHalfWidth - ringFeather * 0.5);
                    float innerRing = (1.0 - smoothstep(
                        ringInnerEdge,
                        ringOuterEdge,
                        abs(radius - ringInner)
                    )) * innerRingOpacity;
                    float middleRing = 1.0 - smoothstep(
                        ringInnerEdge,
                        ringOuterEdge,
                        abs(radius - ringMiddle)
                    );
                    float outerRing = 1.0 - smoothstep(
                        ringInnerEdge,
                        ringOuterEdge,
                        abs(radius - outerTarget)
                    );
                    float ringAlpha = max(innerRing, middleRing) * ringOpacity;
                    ringAlpha = max(ringAlpha, outerRing * ringOuterOpacity);
                    float fillLayerAlpha = fillColor.a * fillAlpha;
                    float sweepLayerAlpha = color.a * sweepAlpha;
                    float ringLayerAlpha = ringColor.a * ringAlpha;
                    float useSweepColor = step(fillLayerAlpha, sweepLayerAlpha);
                    vec3 combinedColor = mix(fillColor.rgb, color.rgb, useSweepColor);
                    float useRingColor = step(max(fillLayerAlpha, sweepLayerAlpha), ringLayerAlpha);
                    material.diffuse = mix(combinedColor, ringColor.rgb, useRingColor);
                    material.alpha = max(fillLayerAlpha, max(sweepLayerAlpha, ringLayerAlpha));
                    return material;
                }
            `,
        },
        translucent: () => true,
    });
}
ensureRadarSweepMaterialRegistered();
function createRadarSweepPrimitive(viewer, {
    id,
    lon,
    lat,
    radius,
    state,
    color,
    tokens,
    popupProps,
}) {
    const material = Cesium.Material.fromType(RADAR_SWEEP_MATERIAL_TYPE, {
        color: Cesium.Color.clone(color),
        ringColor: Cesium.Color.fromCssColorString(tokens.ringColor) || Cesium.Color.clone(color),
        fillColor: Cesium.Color.fromCssColorString(tokens.fillColor) || Cesium.Color.clone(color),
        heading: Cesium.Math.toRadians(state.heading),
        sweepWidth: Cesium.Math.toRadians(tokens.sweepWidthDeg),
        leadingEdgeWidth: Cesium.Math.toRadians(tokens.sweepLeadingEdgeDeg),
        minAlpha: tokens.sweepOpacityMin,
        midAlpha: tokens.sweepOpacityMid,
        maxAlpha: tokens.sweepOpacityMax,
        ringInner: RADAR_RING_RATIOS[0],
        ringMiddle: RADAR_RING_RATIOS[1],
        ringOuter: RADAR_RING_RATIOS[2],
        ringWidth: tokens.ringWidth,
        innerRingOpacity: tokens.innerRingOpacity,
        ringOpacity: tokens.ringOpacity,
        ringOuterOpacity: tokens.ringOuterOpacity,
        fillOpacity: tokens.fillOpacity,
    });
    const pickEntity = new Cesium.Entity({
        id,
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        properties: {
            ...popupProps,
            lat,
            lon,
        },
    });
    const primitive = new Cesium.GroundPrimitive({
        geometryInstances: new Cesium.GeometryInstance({
            id: pickEntity,
            geometry: new Cesium.EllipseGeometry({
                center: Cesium.Cartesian3.fromDegrees(lon, lat),
                semiMajorAxis: radius,
                semiMinorAxis: radius,
                vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
            }),
        }),
        appearance: new Cesium.EllipsoidSurfaceAppearance({
            material,
            translucent: true,
            aboveGround: true,
        }),
        classificationType: Cesium.ClassificationType.TERRAIN,
        asynchronous: true,
    });
    viewer.scene.groundPrimitives.add(primitive);
    return { primitive, material };
}
function clearTicker() {
    unregisterAnimationTask(SWEEPER_ANIMATION_TASK_KEY);
    __sweeperTicker = false;
    __sweeperLastTimestamp = null;
    __sweeperFrameCount = 0;
}
function runSweeperTick(ts) {
    const viewer = __radarViewer;
    if (!viewer || !__radarItems.length) {
        __sweeperTicker = false;
        return false;
    }
    if (__sweeperLastTimestamp == null) __sweeperLastTimestamp = ts;
    const dt = Math.min(0.1, Math.max(0, (ts - __sweeperLastTimestamp) / 1000));
    __sweeperLastTimestamp = ts;
    __sweeperFrameCount += 1;
    __sweeperUpdateCount += 1;
    if (!shouldRenderSweepers(viewer)) {
        syncSweeperCameraVisibility();
        return false;
    }
    __radarItems.forEach((item) => {
        item.state.heading = (
            item.state.heading + (item.preset.speed * item.visualTokens.sweepSpeed * 60 * dt)
        ) % 360;
        if (item.sweepMaterial?.uniforms) {
            item.sweepMaterial.uniforms.heading = Cesium.Math.toRadians(item.state.heading);
        }
    });
    if (__sweeperFrameCount % SWEEPER_RENDER.labelFrameSkip === 0) updateRadarLabels();
    return true;
}
function startSweeperTicker() {
    if (__sweeperTicker || !__radarViewer || !__radarItems.length) return;
    __sweeperTicker = registerAnimationTask(
        SWEEPER_ANIMATION_TASK_KEY,
        runSweeperTick,
        { hz: SWEEPER_RENDER.animationHz }
    );
}
function ensureRadarLabelLayer() {
    return document.getElementById("wz-radar-label-layer");
}
function createRadarLabel(text = "", samDetails = null) {
    const layer = ensureRadarLabelLayer();
    if (!layer) return null;
    const el = document.createElement("div");
    if (samDetails) {
        const { event, preset, overlayId, lat, lon } = samDetails;
        const detailId = `wz-sam-radar-details-${overlayId}`;
        el.className = "wz-sam-radar-card";
        el.innerHTML = `
            <div class="wz-sam-radar-card__surface">
                <header class="wz-sam-radar-card__summary">
                    <div class="wz-sam-radar-card__kicker">
                        <span class="wz-sam-radar-card__category">Radar Intelligence</span>
                        <strong class="wz-sam-radar-card__title">Sam Radar</strong>
                        <span class="wz-sam-radar-card__meta">Simulated Surface-to-Air Coverage </span>
                    </div>
                    <div class="wz-widget-header-actions">
                        <button type="button"
                            class="static-icon wz-sam-radar-card__toggle"
                            aria-expanded="false"
                            aria-label="Expand SAM radar information" >
                            <span class="stratops-ico-top-1" aria-hidden="true"></span>
                        </button>
                    </div>
                </header>
                <div class="wz-sam-radar-card__details" id="${detailId}" aria-hidden="true" inert>
                    <p class="wz-sam-radar-card__description">Simulated radar coverage placed at a source event's coordinates. This does not identify a physical radar or report live detections.</p>
                    <dl class="wz-sam-radar-card__data">
                        <div><dt>System Type</dt><dd>Simulated air-defense radar sweep</dd></div>
                        <div><dt>Data Basis</dt><dd>Source event coordinates</dd></div>
                        <div><dt>Coverage</dt><dd data-sam-coverage></dd></div>
                        <div><dt>Detection Status</dt><dd>No live radar detections</dd></div>
                        <div><dt>Event Location</dt><dd data-sam-location></dd></div>
                    </dl>
                </div>
            </div>`;
        el.querySelector(".wz-sam-radar-card__toggle").setAttribute("aria-controls", detailId);
        el.querySelector("[data-sam-coverage]").textContent =
            `${Math.round(preset.radius / 1000)} km display radius (configured preset)`;
        const location = String(event?.location_label || event?.impact_label || event?.country || "").trim();
        el.querySelector("[data-sam-location]").textContent = location
            ? `${location} (event coordinates)`
            : `${lat.toFixed(3)}°, ${lon.toFixed(3)}° (event coordinates)`;
        // const sourceName = String(event?.source_name || parseEventMetadata(event)?.source_name || "").trim();
        // const sourceUrl = resolveOverlaySourceUrl(event);
        // const sourceEl = el.querySelector("[data-sam-source]");
        //if (sourceUrl) {
        //    const link = document.createElement("a");
        //    link.href = sourceUrl;
         //   link.target = "_blank";
         //   link.rel = "noopener noreferrer";
        //    link.textContent = sourceName || "View event source";
        //    sourceEl.appendChild(link);
        //} else {
        //    sourceEl.textContent = sourceName || "Source not available";
        //}
        el.hidden = __dismissedSamRadarIds.has(overlayId);
    } else {
        el.className = "wz-radar-label";
        el.setAttribute("aria-hidden", "true");
        el.innerHTML = `<span class="wz-radar-label__text"></span>`;
        el.querySelector(".wz-radar-label__text").textContent = text;
    }
    layer.appendChild(el);
    __radarLabels.push(el);
    return el;
}
function setSamRadarExpanded(item, expanded) {
    if (!item?.isSamRadar || !item.labelEl) return;
    if (expanded && __activeSamRadarItem && __activeSamRadarItem !== item) {
        setSamRadarExpanded(__activeSamRadarItem, false);
    }
    const card = item.labelEl;
    const toggle = card.querySelector(".wz-sam-radar-card__toggle");
    const details = card.querySelector(".wz-sam-radar-card__details");
    if (expanded) {
        card.hidden = false;
        __dismissedSamRadarIds.delete(item.overlayId);
    }
    card.classList.toggle("is-expanded", expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} SAM radar information`);
    details.setAttribute("aria-hidden", String(!expanded));
    details.inert = !expanded;
    if (expanded) __activeSamRadarItem = item;
    else if (__activeSamRadarItem === item) __activeSamRadarItem = null;
}
function collapseActiveSamRadar() {
    if (__activeSamRadarItem) setSamRadarExpanded(__activeSamRadarItem, false);
}
function bindSamRadarCard(item) {
    const card = item.labelEl;
    card.querySelector(".wz-sam-radar-card__toggle").addEventListener("click", () => {
        setSamRadarExpanded(item, __activeSamRadarItem !== item);
        updateRadarLabels();
    });
    card.querySelector(".wz-sam-radar-card__summary").addEventListener("click", (event) => {
        if (event.target.closest("button")) return;
        setSamRadarExpanded(item, __activeSamRadarItem !== item);
        updateRadarLabels();
    });
}
function bindSamRadarInteractions(viewer) {
    if (__removeSamRadarInteractions) return;
    const onPointerDown = (event) => {
        __samPointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onPointerCancel = () => { __samPointerStart = null; };
    const onPointerUp = (event) => {
        const start = __samPointerStart;
        __samPointerStart = null;
        if (!start || start.id !== event.pointerId || event.button !== 0 ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
        if (event.target?.closest?.(".wz-sam-radar-card")) return;
        const canvas = viewer.scene?.canvas;
        if (event.target === canvas) {
            const rect = canvas.getBoundingClientRect();
            try {
                const picked = viewer.scene.pick(new Cesium.Cartesian2(
                    event.clientX - rect.left, event.clientY - rect.top
                ));
                const pickedId = String(picked?.id?.id || picked?.id || "");
                const item = __radarItems.find((radar) => radar.isSamRadar &&
                    (pickedId === `${radar.overlayId}-center` || pickedId === `${radar.overlayId}-sweep`));
                if (item) {
                    setSamRadarExpanded(item, true);
                    updateRadarLabels();
                    item.labelEl.querySelector(".wz-sam-radar-card__toggle").focus({ preventScroll: true });
                    return;
                }
            } catch { }
        }
        collapseActiveSamRadar();
    };
    const onKeyDown = (event) => {
        if (event.key === "Escape" && __activeSamRadarItem) {
            const toggle = __activeSamRadarItem.labelEl.querySelector(".wz-sam-radar-card__toggle");
            collapseActiveSamRadar();
            toggle.focus({ preventScroll: true });
        }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("wz:event-marker-selected", collapseActiveSamRadar);
    document.addEventListener("wz:satellite-imagery-selected", collapseActiveSamRadar);
    __removeSamRadarInteractions = () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointercancel", onPointerCancel, true);
        document.removeEventListener("pointerup", onPointerUp, true);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("wz:event-marker-selected", collapseActiveSamRadar);
        document.removeEventListener("wz:satellite-imagery-selected", collapseActiveSamRadar);
    };
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
    const canvas = __radarViewer.scene?.canvas;
    const canvasWidth = Number(canvas?.clientWidth || canvas?.width || 0);
    const canvasHeight = Number(canvas?.clientHeight || canvas?.height || 0);
    const occluder = __radarItems.some((item) => item.isSamRadar) &&
        __radarViewer.scene?.globe?.ellipsoid && __radarViewer.camera?.positionWC
        ? new Cesium.EllipsoidalOccluder(
            __radarViewer.scene.globe.ellipsoid, __radarViewer.camera.positionWC
        ) : null;
    __radarItems.forEach((item) => {
        if (!item?.labelEl) return;
        const p = getRadarScreenPosition(__radarViewer, item.lon, item.lat);
        const visible = p && p.x >= 0 && p.y >= 0 && p.x <= canvasWidth && p.y <= canvasHeight &&
            (!item.isSamRadar || !occluder || occluder.isPointVisible(
                Cesium.Cartesian3.fromDegrees(item.lon, item.lat, SWEEPER_RENDER.overlayHeight)
            ));
        const opacity = visible ? "1" : "0";
        if (item.labelOpacity !== opacity) {
            item.labelEl.style.opacity = opacity;
            item.labelOpacity = opacity;
        }
        const visibility = visible ? "visible" : "hidden";
        if (item.labelVisibility !== visibility) {
            item.labelEl.style.visibility = visibility;
            item.labelVisibility = visibility;
        }
        if (!visible) {
            if (__activeSamRadarItem === item) setSamRadarExpanded(item, false);
            return;
        }
        if (item.labelEl.hidden) return;
        let labelX = p.x;
        let labelY = p.y;
        if (item.isSamRadar) {
            const width = item.labelEl.offsetWidth;
            const height = item.labelEl.offsetHeight;
            const margin = 10;
            const gap = 18;
            labelX = p.x + gap;
            if (labelX + width > canvasWidth - margin) labelX = p.x - width - gap;
            labelX = clamp(labelX, margin, Math.max(margin, canvasWidth - width - margin));
            const summary = item.labelEl.querySelector(
                ".wz-sam-radar-card__summary"
            );
            const details = item.labelEl.querySelector(
                ".wz-sam-radar-card__details"
            );

            const expandedHeight =
                (summary?.offsetHeight || 0) +
                (details?.scrollHeight || 0) +
                24;
            labelY = clamp(
                p.y + gap,
                margin,
                Math.max(margin, canvasHeight - expandedHeight - margin)
            );
        }
        const left = `${labelX}px`;
        const top = `${labelY}px`;

        if (item.labelLeft !== left) {
            item.labelEl.style.left = left;
            item.labelLeft = left;
        }
        if (item.labelTop !== top) {
            item.labelEl.style.top = top;
            item.labelTop = top;
        }
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
    const hadVisuals = __sweeperEntities.length > 0 || __sweeperPrimitives.length > 0 || __radarLabels.length > 0;
    clearTicker();
    __removeSamRadarInteractions?.();
    __removeSamRadarInteractions = null;
    __activeSamRadarItem = null;
    __samPointerStart = null;
    __restoreGeneration += 1;
    __restorePending = false;
    __removeCameraChanged?.();
    __removeCameraMoveEnd?.();
    __removeCameraChanged = null;
    __removeCameraMoveEnd = null;
    __sweeperEntities.forEach((entity) => {
        try { viewer?.entities?.remove(entity); } catch { }
    });
    __sweeperPrimitives.forEach((primitive) => {
        try { viewer?.scene?.groundPrimitives?.remove(primitive); } catch { }
    });
    __sweeperEntities = [];
    __sweeperPrimitives = [];
    __radarItems = [];
    __radarSourceEvents = [];
    __radarLabels.forEach((el) => {
        try { el.remove(); } catch { }
    });
    __radarLabels = [];
    __radarViewer = null;
    if (hadVisuals) requestSharedSceneRender();
}

export function getSweeperDiagnostics() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const elapsedSeconds = Math.max(0.001, (now - __sweeperStartedAt) / 1000);
    return Object.freeze({
        activeSweeperEntities: __sweeperEntities.length,
        activeSweeperPrimitives: __sweeperPrimitives.length,
        activeSweeperLabels: __radarLabels.length,
        animationFrameActive: Boolean(__sweeperTicker),
        schedulerTaskActive: Boolean(__sweeperTicker),
        targetUpdatesPerSecond: SWEEPER_RENDER.animationHz,
        updates: __sweeperUpdateCount,
        updatesPerSecond: Number((__sweeperUpdateCount / elapsedSeconds).toFixed(2)),
    });
}
export function renderSweepers(viewer, events = []) {
    if (!viewer) return;
    clearSweepers(viewer);
    const candidates = selectRadarCandidates(
        events,
        SWEEPER_RENDER.maxCount,
        SWEEPER_RENDER.maxOverlap
    );
    const currentSamIds = new Set(candidates.map((candidate, index) =>
        candidate.preset.label === "SAM Radar"
            ? makeOverlayEntityId("sweeper", candidate.event, index) : null
    ).filter(Boolean));
    for (const id of __dismissedSamRadarIds) {
        if (!currentSamIds.has(id)) __dismissedSamRadarIds.delete(id);
    }
    if (!candidates.length) {
        requestSharedSceneRender();
        return;
    }
    __radarViewer = viewer;
    __radarSourceEvents = events;
    watchSweeperCamera(viewer);
    if (!shouldRenderSweepers(viewer)) return;
    __radarItems = [];
    if (viewer.entities?.suspendEvents) viewer.entities.suspendEvents();
    candidates.forEach((candidate, index) => {
        const preset = candidate.preset;
        const lat = candidate.lat;
        const lon = candidate.lon;
        const visualTokens = readRadarVisualTokens();
        const base = Cesium.Color.fromCssColorString(visualTokens.color) || Cesium.Color.fromCssColorString(RADAR_FALLBACK_COLOR);
        const overlayId = makeOverlayEntityId("sweeper", candidate.event, index);
        const popupProps = buildOverlayPopupProperties(candidate.event, overlayId);
        const isSamRadar = preset.label === "SAM Radar";
        if (isSamRadar) popupProps.isSamRadarAnnotation = true;
        const state = {
            heading: 320 + (index * 40)
        };
        const overlayHeight = SWEEPER_RENDER.overlayHeight;
        const sweepBeam = createRadarSweepPrimitive(viewer, {
            id: `${overlayId}-sweep`,
            lon,
            lat,
            radius: preset.radius,
            state,
            color: base,
            tokens: visualTokens,
            popupProps,
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
        const labelEl = createRadarLabel(preset.label || "Radar Coverage", isSamRadar
            ? { event: candidate.event, preset, overlayId, lat, lon } : null);
        __sweeperEntities.push(
            centerDot
        );
        __sweeperPrimitives.push(sweepBeam.primitive);
        const item = {
            lat,
            lon,
            overlayId,
            isSamRadar,
            preset,
            visualTokens,
            state,
            sweepMaterial: sweepBeam.material,
            labelEl
        };
        __radarItems.push(item);
        if (isSamRadar && labelEl) bindSamRadarCard(item);
    });
    if (viewer.entities?.resumeEvents) viewer.entities.resumeEvents();
    if (__radarItems.some((item) => item.isSamRadar && item.labelEl)) bindSamRadarInteractions(viewer);
    startSweeperTicker();
    updateRadarLabels();
    requestSharedSceneRender();
}
