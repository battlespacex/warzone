// File Path: /assets/js/warzone-globe.js
import * as Cesium from "cesium";
import { resolveDisplayCoordinates } from "./warzone-location-resolver.js";
/* ---------- Data sources ---------- */
const BORDER_SOURCES = {
    countries: [
        "/assets/data/ne_110m_admin_0_countries.geojson",
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    ],
    provinces: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    cities: "https://raw.githubusercontent.com/drei01/geojson-world-cities/master/cities.geojson",
};
const RAISED_REGION_EXPLICIT_ISO2 = {
    middle_east: new Set(["AE", "BH", "CY", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"]),
    levant: new Set(["CY", "EG", "IL", "JO", "LB", "PS", "SY", "TR"]),
    ukraine: new Set(["UA", "RU", "BY", "PL", "RO", "MD", "LT", "LV", "EE"]),
};
const RAISED_REGION_CONTINENT_MATCH = {
    africa: "AFRICA",
    europe: "EUROPE",
    north_america: "NORTH AMERICA",
    south_america: "SOUTH AMERICA",
    oceania: "OCEANIA",
};
const RAISED_REGION_SUBREGION_MATCH = {
    central_asia: new Set(["CENTRAL ASIA"]),
    south_asia: new Set(["SOUTHERN ASIA"]),
    east_asia: new Set(["EASTERN ASIA", "SOUTH-EASTERN ASIA"]),
    latin_america: new Set(["CENTRAL AMERICA", "CARIBBEAN"]),
};
const markerCache = new Map();
const ringCanvasCache = new Map();
const MARKER_CACHE_MAX_ITEMS = 220;
const RING_CACHE_MAX_ITEMS = 40;
const __eventEntityIds = new Set();
const __eventPulseEntities = new Set();
const __EVENT_LOD_STATE = {
    mode: "map",
    cameraHeight: 2350000,
};
const ADAPTIVE_QUALITY_PROFILES = ["normal", "balanced", "conservative", "safe"];
const STARTUP_CAMERA = {
    lon: 40,
    lat: 22,
    height: 5800000,
    heading: 0,
    pitch: -90,
    roll: 0,
};
function normalizeAdaptiveProfile(profile = "normal") {
    const value = String(profile || "").toLowerCase();
    return ADAPTIVE_QUALITY_PROFILES.includes(value) ? value : "normal";
}
function getAdaptiveProfileCaps(profile = "normal") {
    switch (normalizeAdaptiveProfile(profile)) {
        case "balanced":
            return {
                maxResolutionScale: 1.0,
                maxMsaaSamples: 1,
                minSse: 1.85,
                maxTileCache: 520,
                forcePreloadSiblingsFalse: true,
                forceFxaaEnabled: false,
            };
        case "conservative":
            return {
                maxResolutionScale: 0.9,
                maxMsaaSamples: 1,
                minSse: 2.35,
                maxTileCache: 420,
                forcePreloadSiblingsFalse: true,
                forceFxaaEnabled: false,
            };
        case "safe":
            return {
                maxResolutionScale: 0.8,
                maxMsaaSamples: 1,
                minSse: 2.9,
                maxTileCache: 280,
                forcePreloadSiblingsFalse: true,
                forceFxaaEnabled: false,
            };
        default:
            return {
                maxResolutionScale: 2,
                maxMsaaSamples: 8,
                minSse: 0.8,
                maxTileCache: 1200,
                forcePreloadSiblingsFalse: false,
                forceFxaaEnabled: false,
            };
    }
}
function setLimitedCache(map, key, value, maxItems = 200) {
    if (!(map instanceof Map)) return value;
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    const max = Math.max(8, Number(maxItems || 200));
    while (map.size > max) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
    return value;
}
function getEventEntityCount() {
    return __eventEntityIds.size;
}
function getCameraHeight(viewer) {
    try {
        return Number(viewer?.camera?.positionCartographic?.height || 0);
    } catch {
        return 0;
    }
}
function shouldClusterEvents(viewer) {
    return getCameraHeight(viewer) > numberVar("--warzone-event-cluster-height", 1800000);
}
function shouldShowEventRingsAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-event-ring-max-height", 6500000);
}
function shouldShowEventOutlinesAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-event-outline-max-height", 1800000);
}
function getMaxRenderableEventsAtHeight(cameraHeight = 0) {
    const base = Math.max(40, numberVar("--warzone-max-renderable-events", 240));
    if (cameraHeight > 8500000) return Math.max(base, 420);
    if (cameraHeight > 5000000) return Math.max(base, 340);
    if (cameraHeight > 2600000) return Math.max(base, 280);
    return Math.max(base, 220);
}
function getMaxRenderableEvents(viewer) {
    const height = getCameraHeight(viewer);
    return getMaxRenderableEventsAtHeight(height);
}
function clusterEventsForDisplay(events = [], precisionDeg = 0.32, maxItems = 520) {
    const groups = new Map();
    for (const event of events) {
        const lat = Number(event?.lat);
        const lon = Number(event?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const key = `${Math.round(lat / precisionDeg)}:${Math.round(lon / precisionDeg)}`;
        if (!groups.has(key)) {
            groups.set(key, {
                lat,
                lon,
                items: [event],
            });
        } else {
            const group = groups.get(key);
            const n = group.items.length;
            group.lat = (group.lat * n + lat) / (n + 1);
            group.lon = (group.lon * n + lon) / (n + 1);
            group.items.push(event);
        }
    }
    return Array.from(groups.values())
        .map((group, index) => {
            const items = group.items;
            const clusterCount = items.reduce((acc, item) => {
                const itemCount = Number(item?.cluster_count || item?._clusterCount || 1);
                return acc + (Number.isFinite(itemCount) && itemCount > 0 ? itemCount : 1);
            }, 0);
            const clusterEvents = items
                .flatMap((item) => (Array.isArray(item?._clusterEvents) ? item._clusterEvents : [item]))
                .filter(Boolean)
                .slice(0, 24);
            const critical = items.some((e) => String(e?.severity || "").toLowerCase() === "critical");
            const high = items.some((e) => String(e?.severity || "").toLowerCase() === "high");
            const latest = items
                .slice()
                .sort((a, b) => new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0))[0] || items[0];
            return {
                ...latest,
                id: latest?.id || `cluster-${index + 1}`,
                lat: group.lat,
                lon: group.lon,
                title: clusterCount > 1 ? `${clusterCount} events near ${latest?.location_label || "cluster"}` : latest?.title,
                summary: clusterCount > 1 ? `Clustered ${clusterCount} nearby events for high-altitude rendering.` : latest?.summary,
                severity: critical ? "critical" : (high ? "high" : (latest?.severity || "medium")),
                cluster_count: clusterCount,
                _clusterCount: clusterCount,
                _clusterEvents: clusterEvents,
            };
        })
        .sort((a, b) => (Number(b.cluster_count || 1) - Number(a.cluster_count || 1)))
        .slice(0, maxItems);
}
function applyEventLod(viewer) {
    if (!viewer) return;
    const mode = viewer.__warzoneMapMode || __EVENT_LOD_STATE.mode || "map";
    const cameraHeight = getCameraHeight(viewer);
    const allowMarkers = boolVar("--warzone-event-markers-visible", true);
    const allowRings = boolVar("--warzone-event-rings-visible", true);
    const suppressMarkers = viewer.__warzoneSuppressEventMarkers === true;
    const eventEntityCount = getEventEntityCount();
    const ringBudget = Math.max(80, numberVar("--warzone-event-ring-budget", 200));
    const outlineBudget = Math.max(60, numberVar("--warzone-event-outline-budget", 140));
    const showRingsByZoom = shouldShowEventRingsAtCurrentZoom(viewer);
    const showOutlinesByZoom =
        shouldShowEventOutlinesAtCurrentZoom(viewer) &&
        eventEntityCount <= outlineBudget;
    __EVENT_LOD_STATE.mode = mode;
    __EVENT_LOD_STATE.cameraHeight = cameraHeight;
    const entities = viewer.entities.values;
    for (const entity of entities) {
        if (!entity?.properties) continue;
        const isEventOutline = !!entity.properties?.isEventOutline?.getValue?.();
        const isEventFill = !!entity.properties?.isEventFill?.getValue?.();
        const isEventMarkerFill = !!entity.properties?.isEventMarkerFill?.getValue?.();
        const isEventPulse = !!entity.properties?.isEventPulse?.getValue?.();
        const heatRadius = Number(entity.properties?.heatRadius?.getValue?.() ?? 140000);
        const category = String(entity.properties?.category?.getValue?.() ?? "strike");
        const severity = String(entity.properties?.severity?.getValue?.() ?? "medium");
        // Read cluster_count stored by createEventEntity — clusters keep their scaled radius
        const clusterCount = Number(entity.properties?.cluster_count?.getValue?.() ?? 1);
        const isCluster = clusterCount > 1;
        const colorCss = getCategoryColorCss(category);
        const color = Cesium.Color.fromCssColorString(colorCss);
        const baseRadius = getSeverityRadius({ severity, cluster_count: clusterCount });
        const fillAlpha = isCluster
            ? Math.min(numberVar("--warzone-event-ring-fill-alpha", 0.14) * 1.6, 0.38)
            : numberVar("--warzone-event-ring-fill-alpha", 0.14);
        if (isEventOutline || isEventFill || isEventPulse) {
            if (isEventMarkerFill) {
                const showMarkerFill = mode !== "heatmap" && !suppressMarkers && (isCluster || allowMarkers);
                if (entity.billboard) {
                    entity.billboard.show = showMarkerFill;
                }
                if (entity.ellipse) {
                    entity.ellipse.show = showMarkerFill;
                    if (showMarkerFill) {
                        applyEventMarkerEllipsePulse(
                            entity,
                            getEventMarkerSizePx(clusterCount),
                            color,
                            Math.max(0.02, Math.min(1, numberVar("--warzone-event-marker-fill-alpha", 0.82))),
                            {
                                id: entity.id,
                                event_id: entity.properties?.event_id?.getValue?.(),
                                category,
                                severity,
                                cluster_count: clusterCount,
                                lat: entity.properties?.lat?.getValue?.(),
                                lon: entity.properties?.lon?.getValue?.(),
                            }
                        );
                    } else {
                        clearEventEllipsePulse(entity);
                    }
                }
                continue;
            }
            if (entity.billboard) {
                const showRing = mode !== "heatmap" && allowRings && showRingsByZoom;
                entity.billboard.show = showRing;
                if (!showRing) clearEventEllipsePulse(entity);
            }
            if (entity.ellipse) {
                const showPulse = mode !== "heatmap" && allowRings && showRingsByZoom;
                entity.ellipse.show = showPulse;
                if (showPulse && isEventPulse) {
                    const pulseRadius = Math.max(2000, numberVar("--warzone-event-pulse-radius", 22000));
                    const pulseAlpha = numberVar("--warzone-event-pulse-fill-alpha", 0.18);
                    applyEventEllipsePulse(entity, pulseRadius, color, pulseAlpha, {
                        id: entity.id,
                        event_id: entity.properties?.event_id?.getValue?.(),
                        category,
                        severity,
                        cluster_count: clusterCount,
                        lat: entity.properties?.lat?.getValue?.(),
                        lon: entity.properties?.lon?.getValue?.(),
                    });
                } else {
                    clearEventEllipsePulse(entity);
                }
            }
            continue;
        }
        if (entity.billboard) {
            entity.billboard.show = false;
        }
        if (entity.label) {
            entity.label.show = mode !== "heatmap" && !suppressMarkers && isCluster;
        }
        if (mode === "heatmap" && allowRings && showRingsByZoom) {
            ensureEventEllipse(entity, baseRadius, color, fillAlpha);
        }
        if (entity.ellipse) {
            if (!allowRings || !showRingsByZoom) {
                clearEventEllipsePulse(entity);
                entity.ellipse.show = false;
                continue;
            }
            entity.ellipse.show = true;
            if (mode === "heatmap") {
                clearEventEllipsePulse(entity);
                entity.ellipse.semiMinorAxis = heatRadius;
                entity.ellipse.semiMajorAxis = heatRadius;
                entity.ellipse.material = color.withAlpha(0.24);
                entity.ellipse.outline = false;
            } else {
                clearEventEllipsePulse(entity);
                entity.ellipse.semiMinorAxis = baseRadius;
                entity.ellipse.semiMajorAxis = baseRadius;
                entity.ellipse.material = color.withAlpha(fillAlpha);
                entity.ellipse.outline = false;
                entity.ellipse.outlineWidth = 0;
            }
        }
    }
    viewer.scene.requestRender();
    startEventPulseRenderLoop(viewer);
}
function attachEventLodController(viewer) {
    if (!viewer || viewer.__warzoneEventLodAttached) return;
    viewer.__warzoneEventLodAttached = true;
    let pending = false;
    const run = () => {
        pending = false;
        applyEventLod(viewer);
    };
    const queue = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(run);
    };
    viewer.camera.moveEnd.addEventListener(queue);
    viewer.scene.postRender.addEventListener(() => {
        const currentHeight = getCameraHeight(viewer);
        if (Math.abs(currentHeight - (__EVENT_LOD_STATE.cameraHeight || 0)) > 250000) {
            queue();
        }
    });
    if (!viewer.__warzoneEventPulseVisibilityBound) {
        viewer.__warzoneEventPulseVisibilityBound = true;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                stopEventPulseRenderLoop(viewer);
                return;
            }
            applyEventLod(viewer);
        }, { passive: true });
    }
}
function rememberEventEntity(entity) {
    if (!entity?.id) return;
    __eventEntityIds.add(String(entity.id));
}
function forgetEventEntity(entityId) {
    if (!entityId) return;
    __eventEntityIds.delete(String(entityId));
}
function registerEventPulseEntity(entity) {
    if (entity) __eventPulseEntities.add(entity);
}
function unregisterEventPulseEntity(entity) {
    if (entity) __eventPulseEntities.delete(entity);
}
function removeExistingEventEntity(viewer, entityId) {
    if (!viewer || !entityId) return;
    const ids = [String(entityId), `${String(entityId)}-pulse`, `${String(entityId)}-fill`, `${String(entityId)}-outline`];
    for (const id of ids) {
        try {
            const existing = viewer.entities.getById(id);
            if (existing) {
                unregisterEventPulseEntity(existing);
                viewer.entities.remove(existing);
            }
        } catch { }
        forgetEventEntity(id);
    }
}
function cancelPendingEventSync(viewer) {
    if (!viewer) return;
    viewer.__warzoneEventSyncToken = Number(viewer.__warzoneEventSyncToken || 0) + 1;
    if (viewer.__warzoneEventSyncRaf) {
        try {
            cancelAnimationFrame(viewer.__warzoneEventSyncRaf);
        } catch {
            // ignore
        }
        viewer.__warzoneEventSyncRaf = 0;
    }
}
function buildEventRenderSignature(event = {}) {
    const id = String(event.id || "");
    const occurredAt = String(event.occurred_at || "");
    const category = String(event.category || "");
    const severity = String(event.severity || "");
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const clusterCount = Number(event.cluster_count || event._clusterCount || 1);
    const latKey = Number.isFinite(lat) ? lat.toFixed(4) : "x";
    const lonKey = Number.isFinite(lon) ? lon.toFixed(4) : "x";
    const clusterKey = Number.isFinite(clusterCount) ? String(clusterCount) : "1";
    return `${id}|${occurredAt}|${category}|${severity}|${clusterKey}|${latKey}|${lonKey}`;
}
function reconcileEventEntities(viewer, events = [], options = {}) {
    if (!viewer) return;
    cancelPendingEventSync(viewer);
    const token = Number(viewer.__warzoneEventSyncToken || 0);
    const prevState =
        viewer.__warzoneEventRenderState instanceof Map
            ? viewer.__warzoneEventRenderState
            : new Map();
    const nextState = new Map();
    const nextEventsById = new Map();
    for (const event of Array.isArray(events) ? events : []) {
        const id = String(event?.id || "").trim();
        if (!id) continue;
        nextEventsById.set(id, event);
    }
    for (const [id, event] of nextEventsById.entries()) {
        nextState.set(id, buildEventRenderSignature(event));
    }
    const removeIds = [];
    for (const prevId of prevState.keys()) {
        if (!nextState.has(prevId)) {
            removeIds.push(prevId);
        }
    }
    const upsertEvents = [];
    for (const event of nextEventsById.values()) {
        const id = String(event?.id || "").trim();
        if (!id) continue;
        const nextSig = nextState.get(id);
        const prevSig = prevState.get(id);
        if (prevSig !== nextSig) {
            upsertEvents.push(event);
        }
    }
    if (!removeIds.length && !upsertEvents.length) {
        applyEventLod(viewer);
        viewer.scene.requestRender();
        return;
    }
    const chunkSize = Math.max(20, Math.round(numberVar("--warzone-event-sync-chunk-size", 56)));
    const disableEllipse = options?.disableEllipse === true;
    const disableOutline = options?.disableOutline === true || disableEllipse;
    const suppressMarkers = options?.suppressMarkers === true;
    const step = (removeIndex, upsertIndex) => {
        if (Number(viewer.__warzoneEventSyncToken || 0) !== token) return;
        let ops = 0;
        if (viewer.entities?.suspendEvents) viewer.entities.suspendEvents();
        while (removeIndex < removeIds.length && ops < chunkSize) {
            removeExistingEventEntity(viewer, removeIds[removeIndex]);
            removeIndex += 1;
            ops += 1;
        }
        while (upsertIndex < upsertEvents.length && ops < chunkSize) {
            addEventEntity(viewer, upsertEvents[upsertIndex], {
                disableEllipse,
                disableOutline,
                suppressMarkers,
            });
            upsertIndex += 1;
            ops += 1;
        }
        if (viewer.entities?.resumeEvents) viewer.entities.resumeEvents();
        const done = removeIndex >= removeIds.length && upsertIndex >= upsertEvents.length;
        if (done) {
            viewer.__warzoneEventSyncRaf = 0;
            viewer.__warzoneEventRenderState = nextState;
            applyEventLod(viewer);
            viewer.scene.requestRender();
            return;
        }
        viewer.scene.requestRender();
        viewer.__warzoneEventSyncRaf = requestAnimationFrame(() => step(removeIndex, upsertIndex));
    };
    step(0, 0);
}
function clearTrackedEventEntities(viewer) {
    cancelPendingEventSync(viewer);
    const ids = Array.from(__eventEntityIds);
    if (viewer?.entities?.suspendEvents) viewer.entities.suspendEvents();
    for (const id of ids) {
        try {
            const entity = viewer.entities.getById(id);
            if (entity) viewer.entities.remove(entity);
        } catch { }
    }
    if (viewer?.entities?.resumeEvents) viewer.entities.resumeEvents();
    __eventEntityIds.clear();
    __eventPulseEntities.clear();
    if (viewer) {
        viewer.__warzoneEventRenderState = new Map();
    }
    stopEventPulseRenderLoop(viewer);
    viewer.scene.requestRender();
}
function setTrackedEventLayerVisible(viewer, layerId = "", visible = true) {
    const targetLayerId = String(layerId || "").trim();
    if (!viewer || !targetLayerId) return;
    const show = visible !== false;
    for (const id of __eventEntityIds) {
        const entity = viewer.entities?.getById?.(id);
        const entityLayerId = String(getEntityPropertyValue(entity, "layer_id", "") || "").trim();
        if (entityLayerId !== targetLayerId) continue;
        entity.show = show;
    }
    viewer.scene.requestRender?.();
}
/* ---------- CSS helpers ---------- */
function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}
function numberVar(name, fallback) {
    const raw = cssVar(name, String(fallback));
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function boolVar(name, fallback = false) {
    const value = cssVar(name, fallback ? "1" : "0").toLowerCase();
    return value === "1" || value === "true" || value === "yes";
}
function stringVar(name, fallback = "") {
    return cssVar(name, fallback);
}
function stripCssUrl(value = "") {
    return String(value)
        .trim()
        .replace(/^url\((.*)\)$/i, "$1")
        .replace(/^["']|["']$/g, "")
        .trim();
}
function readCssAssetPath(name, fallback = "") {
    return stripCssUrl(stringVar(name, fallback));
}
function colorFromCssVar(name, fallback, alpha = 1) {
    return Cesium.Color.fromCssColorString(cssVar(name, fallback)).withAlpha(alpha);
}
/* ---------- Math helpers ---------- */
function lerp(a, b, t) {
    return a + (b - a) * t;
}
function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}
/* ---------- Event helpers ---------- */
function getCategoryColorCss(category) {
    switch (String(category || "").toLowerCase()) {
        case "strike":
            return cssVar("--warzone-strike-color", "#ff5a4f");
        case "recon":
        case "recon_intel":
            return cssVar("--warzone-recon-color", "#57b8ff");
        case "military":
        case "ground_activity":
            return cssVar("--warzone-military-color", "#56d80e");
        case "air_activity":
            return cssVar("--warzone-air-activity-color", "#57b8ff");
        case "naval_activity":
            return cssVar("--warzone-naval-activity-color", "#9b7bff");
        case "alert":
            return cssVar("--warzone-alert-color", "#ff2a2a");
        case "airspace":
            return cssVar("--warzone-airspace-color", "#00d8b2");
        case "cyber":
            return cssVar("--warzone-cyber-color", "#9b7bff");
        case "thermal":
            return cssVar("--warzone-thermal-color", "#ff7a00");
        case "signal":
        case "seismic":
            return cssVar("--warzone-signal-color", "#ffd24d");
        case "unknown_activity":
            return cssVar("--warzone-default-color", "#ff7a45");
        default:
            return cssVar("--warzone-default-color", "#ff7a45");
    }
}
function getSeverityRadius(event) {
    const base = numberVar("--warzone-event-ring-size", 70000);
    const count = Number(event?.cluster_count || 1);
    // Logarithmic cluster scaling — cluster of 10 → 1.5x, cluster of 100 → 2.0x, cluster of 500 → 2.5x
    // This makes dense regions visually obvious at any zoom level
    const countScale = count > 1 ? (1 + Math.log2(count) * 0.28) : 1;
    switch (event?.severity) {
        case "critical": return base * 4 * countScale;
        case "high": return base * 3 * countScale;
        case "medium": return base * 2.5 * countScale;
        case "low": return base * countScale;
        default: return base * 1.8 * countScale;
    }
}
function getEventMarkerSizePx(count = 1) {
    const baseSize = Math.max(16, numberVar("--warzone-event-marker-size", 56));
    const step = Math.max(0, numberVar("--warzone-event-marker-cluster-step", 10));
    const maxSize = Math.max(baseSize, numberVar("--warzone-event-marker-max-size", 108));
    if (count > 1) {
        return Math.min(baseSize + Math.log2(Math.max(count, 2)) * step, maxSize);
    }
    return baseSize;
}
function getEventMarkerPerspectiveSquash(viewer) {
    const pitch = Math.abs(Number(viewer?.camera?.pitch ?? (-Math.PI / 2)));
    const topDownPitch = Math.PI / 2;
    const horizonRatio = Math.max(0, Math.min(1, 1 - (pitch / topDownPitch)));
    const maxSquash = Math.max(0, Math.min(0.86, numberVar("--warzone-event-marker-perspective-squash", 0.72)));
    return 1 - horizonRatio * maxSquash;
}
function getEventMarkerMetersPerPixel(entity, viewer = window.__warzoneViewer) {
    const scene = viewer?.scene;
    const camera = viewer?.camera;
    const position = entity?.position?.getValue?.(Cesium.JulianDate.now()) || null;
    if (!scene || !camera || !position) {
        return Math.max(40, numberVar("--warzone-event-marker-meters-per-pixel-fallback", 120));
    }
    try {
        const metersPerPixel = camera.getPixelSize(
            new Cesium.BoundingSphere(position, 1),
            Math.max(1, Number(scene.drawingBufferWidth || scene.canvas?.width || 1)),
            Math.max(1, Number(scene.drawingBufferHeight || scene.canvas?.height || 1))
        );
        if (Number.isFinite(metersPerPixel) && metersPerPixel > 0) return metersPerPixel;
    } catch { }
    return Math.max(40, numberVar("--warzone-event-marker-meters-per-pixel-fallback", 120));
}
function getEventRingBillboardScale(event = {}) {
    const base = Math.max(1, numberVar("--warzone-event-ring-size", 70000));
    const radius = Math.max(base, getSeverityRadius(event));
    const pixelSize = Math.max(72, Math.min(180, Math.sqrt(radius / base) * 84));
    return pixelSize / 512;
}
function getEventFillBillboardScale(event = {}) {
    const baseScale = getEventRingBillboardScale(event);
    const pixelSize = Math.max(38, Math.min(72, baseScale * 512 * 0.52));
    return pixelSize / 512;
}
function getHeatRadius(event) {
    switch (event?.severity) {
        case "critical":
            return 240000;
        case "high":
            return 180000;
        case "medium":
            return 135000;
        default:
            return 100000;
    }
}
function hashEventPulseSeed(event = {}) {
    const seed = [
        event?.id,
        event?.event_id,
        event?.title,
        event?.category,
        event?.severity,
        event?.lat,
        event?.lon,
    ].filter((value) => value !== undefined && value !== null && value !== "").join("|");
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function getEventPulseSettings(event = {}) {
    const enabled = boolVar("--warzone-event-ring-pulse-enabled", true);
    const hash = hashEventPulseSeed(event);
    const group = hash % 3;
    const durationVars = [
        "--warzone-event-ring-pulse-duration-a",
        "--warzone-event-ring-pulse-duration-b",
        "--warzone-event-ring-pulse-duration-c",
    ];
    const fallbackDurations = [2200, 3000, 3900];
    const durationMs = Math.max(1400, numberVar(durationVars[group], fallbackDurations[group]) * 1.5);
    return {
        enabled,
        durationMs,
        offsetMs: ((hash >>> 3) % 1000) / 1000 * durationMs,
        radiusScale: Math.max(0, numberVar("--warzone-event-ring-pulse-scale", 0.12)),
        alphaScale: Math.max(0, numberVar("--warzone-event-ring-pulse-alpha-scale", 0.35)),
    };
}
function getEventPulseValue(settings) {
    if (!settings?.enabled) return 0;
    const now = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    return ((now + settings.offsetMs) % settings.durationMs) / settings.durationMs;
}
function getEventPulsedRadius(radius, settings) {
    if (!settings?.enabled) return radius;
    const progress = getEventPulseValue(settings);
    const wave = 0.5 - (0.5 * Math.cos(progress * Math.PI * 2));
    return radius * (1 + wave * settings.radiusScale);
}
function getEventPulsedFillAlpha(fillAlpha, settings) {
    if (!settings?.enabled) return fillAlpha;
    const progress = getEventPulseValue(settings);
    const alphaWave = Math.pow(0.5 - (0.5 * Math.cos(progress * Math.PI * 2)), 0.92);
    const alpha = fillAlpha * (0.24 + alphaWave * Math.max(0.10, settings.alphaScale));
    return Math.max(0.01, Math.min(alpha, 0.42));
}
function clearEventEllipsePulse(entity) {
    if (!entity) return;
    unregisterEventPulseEntity(entity);
    delete entity.__wzPulseBaseRadius;
    delete entity.__wzPulseBaseScale;
    delete entity.__wzMarkerBaseSizePx;
    delete entity.__wzPulseSettings;
    delete entity.__wzPulseColor;
    delete entity.__wzPulseFillAlpha;
}
function ensureEventEllipse(entity, radius, color, fillAlpha) {
    if (!entity || entity.ellipse) return;
    entity.ellipse = new Cesium.EllipseGraphics({
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        material: color.withAlpha(fillAlpha),
        outline: false,
        outlineWidth: 0,
        height: 0,
        show: true,
    });
}
function applyEventPulseFrame(entity) {
    const settings = entity.__wzPulseSettings || {};
    const ellipse = entity?.ellipse;
    const markerBaseSizePx = Number(entity?.__wzMarkerBaseSizePx);
    if (ellipse && Number.isFinite(markerBaseSizePx) && markerBaseSizePx > 0) {
        const metersPerPixel = getEventMarkerMetersPerPixel(entity);
        if (!settings?.enabled) {
            const radiusMeters = Math.max(1, metersPerPixel * markerBaseSizePx * 0.5);
            ellipse.semiMinorAxis = radiusMeters;
            ellipse.semiMajorAxis = radiusMeters;
            if (entity.__wzPulseColor && Number.isFinite(entity.__wzPulseFillAlpha)) {
                const maxAlpha = Math.max(0, Math.min(0.70, entity.__wzPulseFillAlpha));
                ellipse.material = entity.__wzPulseColor.withAlpha(maxAlpha);
            }
        } else {
            const progress = getEventPulseValue(settings);
            const smoothWave = 0.5 - (0.5 * Math.cos(progress * Math.PI * 2));
            const alphaWave = Math.pow(smoothWave, 0.92);
            const pulseDiameterPx = markerBaseSizePx * (0.74 + smoothWave * 0.26);
            const radiusMeters = Math.max(1, metersPerPixel * pulseDiameterPx * 0.5);
            ellipse.semiMinorAxis = radiusMeters;
            ellipse.semiMajorAxis = radiusMeters;
            if (entity.__wzPulseColor && Number.isFinite(entity.__wzPulseFillAlpha)) {
                const maxAlpha = Math.max(0, Math.min(0.70, entity.__wzPulseFillAlpha));
                const alpha = Math.max(0, Math.min(maxAlpha, maxAlpha * alphaWave));
                ellipse.material = entity.__wzPulseColor.withAlpha(alpha);
            }
        }
    }
    const baseRadius = Number(entity?.__wzPulseBaseRadius);
    if (ellipse && Number.isFinite(baseRadius) && baseRadius > 0) {
        const nextRadius = getEventPulsedRadius(baseRadius, settings);
        ellipse.semiMinorAxis = nextRadius;
        ellipse.semiMajorAxis = nextRadius;
        if (entity.__wzPulseColor && Number.isFinite(entity.__wzPulseFillAlpha)) {
            ellipse.material = entity.__wzPulseColor.withAlpha(
                getEventPulsedFillAlpha(entity.__wzPulseFillAlpha, settings)
            );
        }
    }
    const billboard = entity?.billboard;
    const baseSizePx = Number(entity?.__wzPulseBaseSizePx);
    if (billboard && Number.isFinite(baseSizePx) && baseSizePx > 0) {
        const squash = getEventMarkerPerspectiveSquash(window.__warzoneViewer);
        if (!settings?.enabled) {
            billboard.width = baseSizePx;
            billboard.height = baseSizePx * squash;
            billboard.scale = 1;
            billboard.color = Cesium.Color.WHITE.withAlpha(1);
            return;
        }
        const progress = getEventPulseValue(settings);
        const smoothWave = 0.5 - (0.5 * Math.cos(progress * Math.PI * 2));
        const alphaWave = Math.pow(smoothWave, 0.92);
        const pulseSize = baseSizePx * (0.82 + smoothWave * 0.18);
        billboard.width = pulseSize;
        billboard.height = pulseSize * squash;
        billboard.scale = 1;
        const alpha = Math.max(0, Math.min(0.70, alphaWave * 0.70));
        billboard.color = Cesium.Color.WHITE.withAlpha(alpha);
    }
}
function updateEventPulseFrame(viewer) {
    if (!viewer) return;
    for (const entity of __eventPulseEntities) {
        applyEventPulseFrame(entity);
    }
}
function applyEventEllipsePulse(entity, radius, color, fillAlpha, event = {}) {
    const ellipse = entity?.ellipse;
    if (!ellipse) return;
    const settings = getEventPulseSettings(event);
    entity.__wzPulseBaseRadius = radius;
    entity.__wzPulseSettings = settings;
    entity.__wzPulseColor = color;
    entity.__wzPulseFillAlpha = fillAlpha;
    registerEventPulseEntity(entity);
    ellipse.show = true;
    ellipse.outline = false;
    ellipse.outlineWidth = 0;
    ellipse.material = color.withAlpha(fillAlpha);
    applyEventPulseFrame(entity);
}
function applyEventBillboardPulse(entity, baseScale, fillAlpha, event = {}) {
    const billboard = entity?.billboard;
    if (!billboard) return;
    const settings = getEventPulseSettings(event);
    entity.__wzPulseBaseSizePx = baseScale;
    entity.__wzPulseSettings = settings;
    entity.__wzPulseFillAlpha = fillAlpha;
    registerEventPulseEntity(entity);
    billboard.show = true;
    applyEventPulseFrame(entity);
}
function applyEventMarkerEllipsePulse(entity, baseSizePx, color, fillAlpha, event = {}) {
    const ellipse = entity?.ellipse;
    if (!ellipse) return;
    const settings = getEventPulseSettings(event);
    entity.__wzMarkerBaseSizePx = baseSizePx;
    entity.__wzPulseBaseSizePx = baseSizePx;
    entity.__wzPulseSettings = settings;
    entity.__wzPulseColor = color;
    entity.__wzPulseFillAlpha = fillAlpha;
    registerEventPulseEntity(entity);
    ellipse.show = true;
    ellipse.outline = false;
    ellipse.outlineWidth = 0;
    ellipse.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    applyEventPulseFrame(entity);
}
function isEntityGraphicVisible(graphic) {
    if (!graphic) return false;
    const show = graphic.show;
    if (show === undefined) return true;
    if (typeof show === "boolean") return show;
    try {
        return show.getValue?.() !== false;
    } catch {
        return true;
    }
}
function shouldRunEventPulseRenderLoop(viewer) {
    if (document.hidden || viewer?.__warzoneSuppressEventMarkers === true) return false;
    const hasVisiblePulse = Array.from(__eventPulseEntities).some((entity) => (
        entity?.__wzPulseSettings?.enabled === true &&
        (isEntityGraphicVisible(entity.ellipse) || isEntityGraphicVisible(entity.billboard))
    ));
    return Boolean(
        viewer &&
        boolVar("--warzone-event-ring-pulse-enabled", true) &&
        hasVisiblePulse
    );
}
function startEventPulseRenderLoop(viewer) {
    if (!viewer || viewer.__warzoneEventPulseRaf) return;
    let lastRenderAt = 0;
    const tick = (now) => {
        viewer.__warzoneEventPulseRaf = 0;
        if (!shouldRunEventPulseRenderLoop(viewer)) return;
        const fps = Math.max(1, numberVar("--warzone-event-ring-pulse-fps", 36));
        if (now - lastRenderAt >= 1000 / fps) {
            lastRenderAt = now;
            updateEventPulseFrame(viewer);
            viewer.scene?.requestRender?.();
        }
        viewer.__warzoneEventPulseRaf = requestAnimationFrame(tick);
    };
    viewer.__warzoneEventPulseRaf = requestAnimationFrame(tick);
}
function stopEventPulseRenderLoop(viewer) {
    if (!viewer?.__warzoneEventPulseRaf) return;
    cancelAnimationFrame(viewer.__warzoneEventPulseRaf);
    viewer.__warzoneEventPulseRaf = 0;
}
function normalizeEvents(events) {
    if (!Array.isArray(events)) return [];
    return events
        .map((item, index) => {
            const base = {
                id: item.id || `event-${index + 1}`,
                title: item.title || "Untitled event",
                summary: item.summary || "",
                category: item.category || "strike",
                severity: item.severity || "medium",
                source_lat: Number(item.source_lat ?? item.lat),
                source_lon: Number(item.source_lon ?? item.lon),
                lat: Number(item.lat),
                lon: Number(item.lon),
                origin_lat: Number(item.origin_lat),
                origin_lon: Number(item.origin_lon),
                origin_label: item.origin_label || "",
                impact_lat: Number(item.impact_lat ?? item.lat),
                impact_lon: Number(item.impact_lon ?? item.lon),
                impact_label: item.impact_label || item.location_label || "",
                location_label: item.location_label || "Unknown location",
                country: item.country || item.countryName || "",
                city: item.city || "",
                province: item.province || item.state || item.admin1 || "",
                occurred_at: item.occurred_at || "",
                confidence: Number(item.confidence ?? 50),
                animation_duration_ms: Number(item.animation_duration_ms),
                persist_ms: Number(item.persist_ms),
                target_type: item.target_type || "",
                target_scope: item.target_scope || "",
                location_scope: item.location_scope || "",
                highlight_radius_m: Number(item.highlight_radius_m),
                target_radius_m: Number(item.target_radius_m),
                incoming_highlight_radius_m: Number(item.incoming_highlight_radius_m),
            };
            const placement = resolveDisplayCoordinates(base);
            return {
                ...base,
                display_lat: placement.lat,
                display_lon: placement.lon,
                display_source: placement.reason,
                display_precision: placement.precision,
                inferred_place_type: placement.placeType,
                inferred_country_code: placement.countryCode,
                inferred_country_name: placement.countryName,
                inferred_place_name: placement.resolvedPlaceName,
                location_mismatch: placement.mismatch,
                lat: placement.lat,
                lon: placement.lon
            };
        })
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}
/* ---------- Marker canvases ---------- */
function colorCssWithAlpha(colorCss, alpha = 1) {
    try {
        const color = Cesium.Color.fromCssColorString(colorCss);
        const r = Math.round(color.red * 255);
        const g = Math.round(color.green * 255);
        const b = Math.round(color.blue * 255);
        return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
    } catch {
        return colorCss;
    }
}
function createMarkerCanvas(colorCss) {
    if (markerCache.has(colorCss)) return markerCache.get(colorCss);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    const cx = 64;
    const cy = 64;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = colorCssWithAlpha(colorCss, numberVar("--warzone-event-marker-fill-alpha", 0.82));
    ctx.beginPath();
    ctx.arc(cx, cy, 31, 0, Math.PI * 2);
    ctx.fill();
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(markerCache, colorCss, dataUrl, MARKER_CACHE_MAX_ITEMS);
    return dataUrl;
}
// Cluster marker — flat color fill only. Count is rendered as a separate static label.
function createClusterMarkerCanvas(colorCss, count) {
    const key = `cluster:${colorCss}:${Math.min(count, 999)}`;
    if (markerCache.has(key)) return markerCache.get(key);
    const sz = 256;
    const cx = sz / 2;
    const cy = sz / 2;
    const discR = Math.min(46 + Math.log2(Math.max(count, 2)) * 7.2, 92);
    const canvas = document.createElement("canvas");
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = colorCssWithAlpha(colorCss, numberVar("--warzone-event-marker-fill-alpha", 0.82));
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.fill();
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(markerCache, key, dataUrl, MARKER_CACHE_MAX_ITEMS);
    return dataUrl;
}
function createClusterCountLabel(count = 1) {
    if (!(count > 1)) return undefined;
    const text = count > 999 ? "999+" : String(count);
    const fontSize = count > 99
        ? cssVar("--warzone-event-count-font-size-100plus", "16px")
        : count > 9
            ? cssVar("--warzone-event-count-font-size-10plus", "18px")
            : cssVar("--warzone-event-count-font-size", "19px");
    return {
        text,
        font: `700 ${fontSize} ${stringVar("--heading-font", "system-ui, Arial, sans-serif")}`,
        fillColor: colorFromCssVar("--color-text-heading", "#eef0f5", 0.98),
        outlineColor: Cesium.Color.TRANSPARENT,
        outlineWidth: 0,
        style: Cesium.LabelStyle.FILL,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: false,
    };
}
function createRingCanvas(strokeCss = "#f51e58", size = 512, lineWidth = 20) {
    const key = `${strokeCss}|${size}|${lineWidth}`;
    if (ringCanvasCache.has(key)) return ringCanvasCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    const r = (size - lineWidth * 2) / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeCss;
    ctx.stroke();
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(ringCanvasCache, key, dataUrl, RING_CACHE_MAX_ITEMS);
    return dataUrl;
}
function createEventCircleCanvas(colorCss = "#f51e58", size = 512) {
    const key = `event-circle|${colorCss}|${size}`;
    if (ringCanvasCache.has(key)) return ringCanvasCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.46;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = colorCss;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(ringCanvasCache, key, dataUrl, RING_CACHE_MAX_ITEMS);
    return dataUrl;
}
function normalizeEventSourceUrl(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const direct = raw.match(/^https?:\/\/[^\s<>"']+/i);
    if (direct) return direct[0];
    const embedded = raw.match(/https?:\/\/[^\s<>"']+/i);
    return embedded ? embedded[0] : "";
}
function resolveGlobeEventSourceUrl(event = {}) {
    const metadata = event?.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
        ? event.metadata
        : {};
    const candidates = [
        event?.source_url,
        event?.sourceUrl,
        event?.source_link,
        event?.sourceLink,
        event?.external_url,
        event?.article_url,
        event?.post_url,
        event?.canonical_url,
        event?.url,
        event?.link,
        metadata.source_url,
        metadata.sourceUrl,
        metadata.source_link,
        metadata.sourceLink,
        metadata.external_url,
        metadata.article_url,
        metadata.post_url,
        metadata.canonical_url,
        metadata.url,
        metadata.link,
    ];
    for (const candidate of candidates) {
        const url = normalizeEventSourceUrl(candidate);
        if (url) return url;
    }
    return "";
}
function createEventMarkerFillEntity(event, options = {}) {
    const colorCss = getCategoryColorCss(event.category);
    const color = Cesium.Color.fromCssColorString(colorCss);
    const count = Number(event?.cluster_count || 1);
    const isCluster = count > 1;
    const showEventMarkers = boolVar("--warzone-event-markers-visible", true);
    const suppressMarkers = options?.suppressMarkers === true;
    const showMarker = !suppressMarkers && (isCluster || showEventMarkers);
    const fillAlpha = Math.max(0.02, Math.min(1, numberVar("--warzone-event-marker-fill-alpha", 0.82)));
    const markerSizePx = getEventMarkerSizePx(count);
    const markerSquash = getEventMarkerPerspectiveSquash(window.__warzoneViewer);
    return {
        id: `${event.id}-fill`,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
        billboard: {
            image: isCluster
                ? createClusterMarkerCanvas(colorCss, count)
                : createEventCircleCanvas(colorCss, 512),
            width: markerSizePx,
            height: markerSizePx * markerSquash,
            color: Cesium.Color.WHITE,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: showMarker,
        },
        ellipse: {
            semiMinorAxis: 1,
            semiMajorAxis: 1,
            material: color.withAlpha(fillAlpha),
            outline: false,
            outlineWidth: 0,
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            show: showMarker,
        },
        properties: {
            event_id: event.id,
            isEventFill: true,
            isEventMarkerFill: true,
            category: event.category,
            severity: event.severity,
            cluster_count: count,
            lat: event.lat,
            lon: event.lon,
        },
    };
}
/* ---------- Event entities ---------- */
function createEventEntity(event, options = {}) {
    const count = Number(event?.cluster_count || 1);
    const isCluster = count > 1;
    const radius = getSeverityRadius(event); // already scaled by cluster_count
    const heatRadius = getHeatRadius(event);
    const showEventMarkers = boolVar("--warzone-event-markers-visible", true);
    const suppressMarkers = options?.suppressMarkers === true;
    const showEventRings = false;
    // Clusters always show their marker (count badge) regardless of zoom CSS var
    const showMarker = !suppressMarkers && (isCluster || showEventMarkers);
    const sourceUrl = resolveGlobeEventSourceUrl(event);
    const clusterEvents = Array.isArray(event?._clusterEvents)
        ? event._clusterEvents
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
            }))
        : [];
    return {
        id: event.id,
        name: event.title,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
        label: isCluster ? { ...createClusterCountLabel(count), show: showMarker } : undefined,
        ellipse: showEventRings ? {
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: Cesium.Color.fromCssColorString(getCategoryColorCss(event.category)).withAlpha(
                isCluster
                    ? Math.min(numberVar("--warzone-event-ring-fill-alpha", 0.14) * 1.6, 0.38)
                    : numberVar("--warzone-event-ring-fill-alpha", 0.14)
            ),
            outline: false,
            outlineWidth: 0,
            height: 0,
            show: false,
        } : undefined,
        properties: {
            event_id: event.id,
            layer_id: event._layerId || event.layer_id || "",
            title: event.title,
            summary: event.summary,
            category: event.category,
            severity: event.severity,
            cluster_count: count,
            cluster_events: clusterEvents,
            lat: event.lat,
            lon: event.lon,
            location_label: event.location_label,
            occurred_at: event.occurred_at,
            confidence: event.confidence,
            heatRadius,
            radius,
            weapon_type: event.weapon_type,
            source_url: sourceUrl,
            origin_lat: event.origin_lat,
            origin_lon: event.origin_lon,
            origin_label: event.origin_label,
            impact_lat: event.impact_lat,
            impact_lon: event.impact_lon,
            impact_label: event.impact_label,
        },
    };
}
function addEventEntity(viewer, event, options = {}) {
    removeExistingEventEntity(viewer, event?.id);
    const entity = viewer.entities.add(createEventEntity(event, options));
    const fillEntity = viewer.entities.add(createEventMarkerFillEntity(event, options));
    const count = Number(event?.cluster_count || 1);
    const markerSizePx = getEventMarkerSizePx(count);
    applyEventMarkerEllipsePulse(
        fillEntity,
        markerSizePx,
        Cesium.Color.fromCssColorString(getCategoryColorCss(event.category)),
        Math.max(0.02, Math.min(1, numberVar("--warzone-event-marker-fill-alpha", 0.82))),
        event
    );
    rememberEventEntity(entity);
    rememberEventEntity(fillEntity);
    startEventPulseRenderLoop(viewer);
    return { entity, fillEntity, ringEntity: null, pulseEntity: null };
}
function getEntityPropertyValue(entity, key, fallback = "") {
    if (!entity?.properties) return fallback;
    try {
        const value = entity.properties?.[key]?.getValue?.();
        return value == null ? fallback : value;
    } catch {
        return fallback;
    }
}
function isEventMarkerEntity(entity) {
    if (!entity) return false;
    const isEventOutline = !!getEntityPropertyValue(entity, "isEventOutline", false);
    const isEventFill = !!getEntityPropertyValue(entity, "isEventFill", false);
    if (isEventOutline || isEventFill) return false;
    const clusterCount = Number(getEntityPropertyValue(entity, "cluster_count", NaN));
    return Number.isFinite(clusterCount) && clusterCount > 0;
}
function resolvePickedEventMarkerEntity(viewer, picked) {
    const pickedEntity = picked?.id;
    if (!pickedEntity) return null;
    if (isEventMarkerEntity(pickedEntity)) return pickedEntity;
    const isEventOutline = !!getEntityPropertyValue(pickedEntity, "isEventOutline", false);
    const isEventFill = !!getEntityPropertyValue(pickedEntity, "isEventFill", false);
    if (!isEventOutline && !isEventFill) return null;
    const pickedId = String(pickedEntity.id || "");
    const markerId = pickedId.endsWith("-outline")
        ? pickedId.slice(0, -8)
        : pickedId.endsWith("-fill")
            ? pickedId.slice(0, -5)
            : pickedId;
    if (!markerId || !viewer?.entities?.getById) return null;
    const markerEntity = viewer.entities.getById(markerId);
    if (!isEventMarkerEntity(markerEntity)) return null;
    return markerEntity;
}
function buildPickedEventDetail(entity, screenPosition = null, viewer = null) {
    const clusterCount = Math.max(1, Number(getEntityPropertyValue(entity, "cluster_count", 1) || 1));
    const clusterEventsRaw = getEntityPropertyValue(entity, "cluster_events", []);
    const clusterEvents = Array.isArray(clusterEventsRaw) ? clusterEventsRaw.slice(0, 8) : [];
    let anchorCartesian = null;
    let lat = Number(getEntityPropertyValue(entity, "lat", NaN));
    let lon = Number(getEntityPropertyValue(entity, "lon", NaN));
    const activeViewer = viewer || window.__warzoneViewer || null;
    const hasScreenPosition =
        Number.isFinite(screenPosition?.x) && Number.isFinite(screenPosition?.y);
    if (activeViewer?.scene && hasScreenPosition) {
        try {
            if (activeViewer.scene.pickPositionSupported) {
                anchorCartesian = activeViewer.scene.pickPosition(screenPosition) || null;
            }
        } catch {
            anchorCartesian = null;
        }
        if (!anchorCartesian) {
            try {
                anchorCartesian = activeViewer.camera?.pickEllipsoid?.(
                    screenPosition,
                    activeViewer.scene.globe?.ellipsoid
                ) || null;
            } catch {
                anchorCartesian = null;
            }
        }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        try {
            const position = entity?.position?.getValue?.(Cesium.JulianDate.now());
            if (position) {
                const cartographic = Cesium.Cartographic.fromCartesian(position);
                lat = Cesium.Math.toDegrees(cartographic.latitude);
                lon = Cesium.Math.toDegrees(cartographic.longitude);
            }
        } catch {
            lat = Number.NaN;
            lon = Number.NaN;
        }
    }
    return {
        entityId: String(entity?.id || "").trim(),
        id: String(getEntityPropertyValue(entity, "event_id", entity.id || "")),
        title: String(getEntityPropertyValue(entity, "title", "")),
        summary: String(getEntityPropertyValue(entity, "summary", "")),
        category: String(getEntityPropertyValue(entity, "category", "")),
        severity: String(getEntityPropertyValue(entity, "severity", "")),
        clusterCount,
        lat,
        lon,
        locationLabel: String(getEntityPropertyValue(entity, "location_label", "")),
        occurredAt: String(getEntityPropertyValue(entity, "occurred_at", "")),
        weaponType: String(getEntityPropertyValue(entity, "weapon_type", "")),
        sourceUrl: String(getEntityPropertyValue(entity, "source_url", "")),
        clusterEvents,
        anchorCartesian: anchorCartesian
            && Number.isFinite(anchorCartesian.x)
            && Number.isFinite(anchorCartesian.y)
            && Number.isFinite(anchorCartesian.z)
            ? {
                x: Number(anchorCartesian.x),
                y: Number(anchorCartesian.y),
                z: Number(anchorCartesian.z),
            }
            : null,
        screenPosition: screenPosition && Number.isFinite(screenPosition.x) && Number.isFinite(screenPosition.y)
            ? { x: Number(screenPosition.x), y: Number(screenPosition.y) }
            : null,
    };
}
function bindEventMarkerPicking(viewer) {
    if (!viewer || viewer.__warzoneEventMarkerPickBound) return;
    viewer.__warzoneEventMarkerPickBound = true;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    viewer.__warzoneEventMarkerPickHandler = handler;
    handler.setInputAction((movement) => {
        const picked = movement?.endPosition ? viewer.scene.pick(movement.endPosition) : null;
        const eventEntity = resolvePickedEventMarkerEntity(viewer, picked);
        viewer.scene.canvas.style.cursor = eventEntity ? "pointer" : "";
        viewer.scene.canvas.title = eventEntity ? "Click event circle for details" : "";
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((movement) => {
        if (!movement?.position) return;
        const picked = viewer.scene.pick(movement.position);
        const eventEntity = resolvePickedEventMarkerEntity(viewer, picked);
        if (!eventEntity) {
            document.dispatchEvent(new CustomEvent("wz:event-marker-cleared", {
                detail: { source: "globe-click" },
            }));
            return;
        }
        document.dispatchEvent(new CustomEvent("wz:event-marker-selected", {
            detail: buildPickedEventDetail(eventEntity, movement.position, viewer),
        }));
        viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}
/* ---------- Viewer style ---------- */
function applyViewerStyle(viewer) {
    viewer.scene.skyBox.show = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
    viewer.scene.backgroundColor = colorFromCssVar("--warzone-space", "#02050b", 1);
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.baseColor = colorFromCssVar("--warzone-globe-base", "#08111a", 1);
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.translucency.enabled = false;
    // Keep close-zoom detail sharp, then let performance mode raise SSE while moving.
    const initialSse = Math.max(0.9, Math.min(4.5, numberVar("--warzone-globe-max-screen-space-error", 1.4)));
    viewer.scene.globe.maximumScreenSpaceError = initialSse;
    viewer.scene.globe.tileCacheSize = Math.max(
        220,
        Math.min(720, Math.round(numberVar("--warzone-globe-tile-cache-size", 900)))
    );
    viewer.scene.globe.loadingDescendantLimit = Math.max(
        8,
        Math.min(72, Math.round(numberVar("--warzone-globe-loading-descendant-limit", 48)))
    );
    viewer.scene.globe.preloadAncestors = boolVar("--warzone-globe-preload-ancestors", true);
    viewer.scene.globe.preloadSiblings = boolVar("--warzone-globe-preload-siblings", false);
    viewer.scene.fog.enabled = false;
    // Stabilize satellite tone: prevent HDR auto-exposure pumping during tile refresh/motion.
    try {
        if ("highDynamicRange" in viewer.scene) {
            viewer.scene.highDynamicRange = false;
        }
    } catch {
        // Older Cesium builds may expose this flag as read-only.
    }
    if (viewer.scene.screenSpaceCameraController) {
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableCollisionDetection = false;
        ctrl.inertiaSpin = numberVar("--warzone-camera-inertia-spin", 0.86);
        ctrl.inertiaTranslate = numberVar("--warzone-camera-inertia-translate", 0.82);
        ctrl.inertiaZoom = numberVar("--warzone-camera-inertia-zoom", 0.72);
        ctrl.zoomFactor = numberVar("--warzone-camera-zoom-factor", 7.5);
        ctrl.maximumZoomDistance = numberVar("--warzone-camera-max-zoom", 20000000);
        ctrl.minimumZoomDistance = numberVar("--warzone-camera-min-zoom", 100);
    }
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
    viewer.resolutionScale = Math.max(0.7, Math.min(numberVar("--warzone-resolution-scale", 1), 1.22));
    if (viewer.scene.postProcessStages?.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = boolVar("--warzone-fxaa-enabled", true);
    }
    viewer.scene.msaaSamples = Math.max(1, Math.min(Math.round(numberVar("--warzone-msaa-samples", 1)), 4));
    applyMapColorMixer(viewer, "--warzone-map");
}
function clampCameraZoomDistance(viewer) {
    if (!viewer?.camera?.positionCartographic) return;
    const maxZoomDistance = numberVar("--warzone-camera-max-zoom", 20000000);
    const minZoomDistance = numberVar("--warzone-camera-min-zoom", 100);
    const cartographic = viewer.camera.positionCartographic;
    const currentHeight = Number(cartographic.height || 0);
    if (!Number.isFinite(currentHeight)) return;
    const nextHeight = Math.max(minZoomDistance, Math.min(maxZoomDistance, currentHeight));
    if (Math.abs(nextHeight - currentHeight) < 1) return;
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            nextHeight
        ),
        orientation: {
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
        },
    });
    viewer.scene.requestRender?.();
}
function clamp2DCameraCenter(viewer) {
    if (!viewer?.scene || getSceneMode(viewer) !== "2d") return;
    const cartographic = viewer.camera?.positionCartographic;
    if (!cartographic) return;
    const maxLatDeg = Math.max(70, Math.min(85.04, numberVar("--warzone-2d-max-latitude", 84.9)));
    const maxLatRad = Cesium.Math.toRadians(maxLatDeg);
    const maxLonRad = Math.PI;
    const currentLon = Number(cartographic.longitude || 0);
    const clampedLon = Cesium.Math.clamp(currentLon, -maxLonRad, maxLonRad);
    const clampedLat = Cesium.Math.clamp(Number(cartographic.latitude || 0), -maxLatRad, maxLatRad);
    const currentLat = Number(cartographic.latitude || 0);
    if (!Number.isFinite(currentLat)) return;
    if (
        Math.abs(clampedLon - currentLon) < 1e-7 &&
        Math.abs(clampedLat - currentLat) < 1e-7
    ) {
        return;
    }
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
            clampedLon,
            clampedLat,
            Number(cartographic.height || numberVar("--warzone-camera-min-zoom", 100))
        ),
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
        },
    });
    viewer.scene.requestRender?.();
}
function clamp2DProjectedViewport(viewer) {
    if (!viewer?.scene || getSceneMode(viewer) !== "2d") return;
    const camera = viewer.camera;
    const projection = viewer.scene.mapProjection || camera?._projection;
    const frustum = camera?.frustum?.offCenterFrustum || camera?.frustum;
    if (!camera?.position || !projection || !frustum) return;
    const maxLatDeg = Math.max(70, Math.min(85.04, numberVar("--warzone-2d-max-latitude", 84.9)));
    const maxProjected = projection.project(
        Cesium.Cartographic.fromDegrees(180, maxLatDeg, 0)
    );
    const maxY = Math.abs(Number(maxProjected?.y || 0));
    const halfWidth = Math.abs(Number(frustum.right || 0) - Number(frustum.left || 0)) * 0.5;
    const halfHeight = Math.abs(Number(frustum.top || 0) - Number(frustum.bottom || 0)) * 0.5;
    if (![maxY, halfWidth, halfHeight].every(Number.isFinite)) return;
    if (halfHeight >= maxY) return;

    const yLimit = Math.max(0, maxY - halfHeight);
    const nextX = Number(camera.position.x || 0);
    const nextY = Cesium.Math.clamp(Number(camera.position.y || 0), -yLimit, yLimit);
    if (
        Math.abs(nextX - Number(camera.position.x || 0)) < 0.5 &&
        Math.abs(nextY - Number(camera.position.y || 0)) < 0.5
    ) {
        return;
    }
    camera.position.x = nextX;
    camera.position.y = nextY;
    camera.setView({
        destination: camera.position,
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
        },
        convert: false,
    });
    viewer.scene.requestRender?.();
}
function normalize2DCameraOrientation(viewer) {
    if (!viewer?.scene || getSceneMode(viewer) !== "2d") return;
    const camera = viewer.camera;
    const heading = Number(camera.heading || 0);
    const pitch = Number(camera.pitch || 0);
    const roll = Number(camera.roll || 0);
    if (
        Math.abs(heading) < 1e-5 &&
        Math.abs(pitch + Cesium.Math.PI_OVER_TWO) < 1e-5 &&
        Math.abs(roll) < 1e-5
    ) {
        return;
    }
    camera.setView({
        destination: camera.position,
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
        },
        convert: false,
    });
    viewer.scene.requestRender?.();
}
function apply2DControllerBounds(viewer) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    if (!controller || !viewer?.camera) return;
    if (!viewer.__warzone2DControllerDefaults) {
        viewer.__warzone2DControllerDefaults = {
            maximumTranslateFactor: Number(controller.maximumTranslateFactor),
            maximumZoomFactor: Number(viewer.camera.maximumZoomFactor),
            enableRotate: controller.enableRotate,
            enableTilt: controller.enableTilt,
        };
    }
    if ("maximumTranslateFactor" in controller) {
        controller.maximumTranslateFactor = Math.max(0.92, Math.min(1.08, numberVar("--warzone-2d-max-translate-factor", 0.98)));
    }
    viewer.camera.maximumZoomFactor = Math.max(1, Math.min(8, numberVar("--warzone-2d-max-zoom-factor", 4)));
    controller.enableRotate = false;
    controller.enableTilt = false;
}
function restore2DControllerBounds(viewer) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    const defaults = viewer?.__warzone2DControllerDefaults;
    if (!controller || !defaults || !viewer?.camera) return;
    if ("maximumTranslateFactor" in controller && Number.isFinite(defaults.maximumTranslateFactor)) {
        controller.maximumTranslateFactor = defaults.maximumTranslateFactor;
    }
    if (Number.isFinite(defaults.maximumZoomFactor)) {
        viewer.camera.maximumZoomFactor = defaults.maximumZoomFactor;
    }
    controller.enableRotate = defaults.enableRotate !== false;
    controller.enableTilt = defaults.enableTilt !== false;
}
function syncSceneModeBounds(viewer) {
    if (!viewer?.scene) return;
    const mode = getSceneMode(viewer);
    if (mode === "2d") {
        apply2DControllerBounds(viewer);
        normalize2DCameraOrientation(viewer);
        clamp2DCameraCenter(viewer);
        clamp2DProjectedViewport(viewer);
    } else {
        restore2DControllerBounds(viewer);
    }
}
function attach2DCameraBoundsGuard(viewer) {
    if (!viewer || viewer.__warzone2DBoundsGuardBound) return;
    viewer.__warzone2DBoundsGuardBound = true;
    let queued = false;
    const queueClamp = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            clamp2DCameraCenter(viewer);
            clamp2DProjectedViewport(viewer);
        });
    };
    viewer.camera.moveEnd.addEventListener(queueClamp);
    viewer.scene.postRender.addEventListener(() => {
        if (getSceneMode(viewer) !== "2d") return;
        const cartographic = viewer.camera?.positionCartographic;
        if (!cartographic) return;
        const maxLatDeg = Math.max(70, Math.min(85.04, numberVar("--warzone-2d-max-latitude", 84.9)));
        const maxLatRad = Cesium.Math.toRadians(maxLatDeg);
        if (Math.abs(Number(cartographic.latitude || 0)) > (maxLatRad + 1e-6)) {
            queueClamp();
        }
        clamp2DProjectedViewport(viewer);
    });
    viewer.scene.morphComplete.addEventListener(() => {
        syncSceneModeBounds(viewer);
    });
}
function attachCameraZoomLimiter(viewer) {
    if (!viewer || viewer.__warzoneCameraZoomLimiterBound) return;
    viewer.__warzoneCameraZoomLimiterBound = true;
    let queued = false;
    const queueClamp = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            clampCameraZoomDistance(viewer);
        });
    };
    viewer.camera.moveEnd.addEventListener(queueClamp);
    viewer.scene.postRender.addEventListener(() => {
        const height = getCameraHeight(viewer);
        const cameraCtrl = viewer.scene?.screenSpaceCameraController;
        const maxZoomDistance = Number(cameraCtrl?.maximumZoomDistance || numberVar("--warzone-camera-max-zoom", 20000000));
        const minZoomDistance = Number(cameraCtrl?.minimumZoomDistance || numberVar("--warzone-camera-min-zoom", 100));
        if (height > maxZoomDistance + 1000 || height < minZoomDistance - 1000) {
            queueClamp();
        }
    });
    queueClamp();
}
function tuneImageryLayer(layer, prefix = "--warzone-map") {
    if (!layer) return;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const baseBrightness = numberVar(`${prefix}-brightness`, 0.65);
    const baseSaturation = numberVar(`${prefix}-saturation`, 0.2);
    const baseHue = numberVar(`${prefix}-hue`, 0);
    const tint = numberVar(`${prefix}-tint`, 0);
    const warmth = numberVar(`${prefix}-warmth`, 0);
    const warmthPositive = Math.max(0, warmth);
    const warmthNegative = Math.max(0, -warmth);

    layer.brightness = clamp(
        baseBrightness + (warmthPositive * 0.1) - (warmthNegative * 0.08),
        0,
        3
    );
    layer.contrast = numberVar(`${prefix}-contrast`, 1.2);
    layer.gamma = numberVar(`${prefix}-gamma`, 0.85);
    layer.saturation = clamp(
        baseSaturation + (tint * 0.25) + (warmthPositive * 0.18) - (warmthNegative * 0.12),
        0,
        3
    );
    layer.hue = baseHue + (tint * 0.35) - (warmth * 0.22);
    layer.alpha = numberVar(`${prefix}-alpha`, 1);
    layer.maximumAnisotropy = Math.max(1, numberVar("--warzone-imagery-max-anisotropy", 16));
}
function shouldShowCityLabelsAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-labels-max-height", 3000000);
}
function updateLabelsLayerVisibility(viewer) {
    if (!viewer) return;
    const contourReady = viewer.__contourLayerVisible === true && viewer.__contourOverlayState?.hasVisibleContours === true;
    const terrainVisible = viewer.__terrainVisible !== false && !contourReady;
    const zoomVisible = shouldShowCityLabelsAtCurrentZoom(viewer);
    const countryLabelsEnabled = boolVar("--warzone-country-labels-enabled", false);
    const detailedLabelsEnabled = boolVar("--warzone-places-layer-enabled", false);
    viewer.__labelsVisibleByZoom = zoomVisible;
    const hasDetailedPlaceLayer = !!viewer.__imageryLabels;
    if (viewer.__imageryLabels) {
        viewer.__imageryLabels.show = detailedLabelsEnabled && terrainVisible && zoomVisible;
    }
    if (viewer.__countryLabelDataSource) {
        viewer.__countryLabelDataSource.show =
            countryLabelsEnabled
            && terrainVisible
            && (!hasDetailedPlaceLayer || !zoomVisible);
    }
}
function applyRenderedTerrainVisibility(viewer) {
    if (!viewer) return;
    const greyedSatellite = viewer.__warzoneGreyedSatelliteVisible === true;
    const show = viewer.__satelliteVisible !== false
        && viewer.__terrainVisible !== false;
    if (viewer.__imageryBase) {
        viewer.__imageryBase.show = show;
        if (greyedSatellite) {
            viewer.__imageryBase.alpha = clamp01(numberVar("--warzone-contour-imagery-alpha", 0.58));
            viewer.__imageryBase.brightness = numberVar("--warzone-contour-imagery-brightness", 0.42);
            viewer.__imageryBase.saturation = numberVar("--warzone-contour-imagery-saturation", 0);
            viewer.__imageryBase.contrast = numberVar("--warzone-contour-imagery-contrast", 1.18);
        } else {
            tuneImageryLayer(viewer.__imageryBase, "--warzone-map");
        }
    }
    updateLabelsLayerVisibility(viewer);
}
function restoreDefaultRenderedMap(viewer) {
    if (!viewer) return false;
    const state = getContourOverlayState(viewer);
    if (state) {
        if (state.buildTimer) {
            clearTimeout(state.buildTimer);
            state.buildTimer = 0;
        }
        state.buildToken += 1;
        state.centerLon = Number.NaN;
        state.centerLat = Number.NaN;
        state.centerHeight = 0;
        state.hasVisibleContours = false;
    }
    viewer.__contourLayerVisible = false;
    viewer.__contourGridLayerVisible = false;
    scheduleContourDemCacheRelease(viewer);
    viewer.__warzoneContourPausedFocusedTerrain = false;
    viewer.__satelliteVisible = true;
    viewer.__warzoneGreyedSatelliteVisible = false;
    clearContourOverlay(viewer);
    applyContourLayerState(viewer);
    applyRenderedTerrainVisibility(viewer);
    updateLabelsLayerVisibility(viewer);
    viewer.scene?.requestRender?.();
    return true;
}
function attachLabelsZoomController(viewer) {
    if (!viewer || viewer.__warzoneLabelsZoomBound) return;
    viewer.__warzoneLabelsZoomBound = true;
    let raf = 0;
    const queue = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            updateLabelsLayerVisibility(viewer);
            viewer.scene.requestRender?.();
        });
    };
    viewer.camera.moveEnd.addEventListener(queue);
    viewer.scene.postRender.addEventListener(() => {
        const h = getCameraHeight(viewer);
        if (!Number.isFinite(h)) return;
        const prev = Number(viewer.__labelsLastCameraHeight || 0);
        if (Math.abs(h - prev) >= 120000) {
            viewer.__labelsLastCameraHeight = h;
            queue();
        }
    });
    queue();
}
function getFeatureBoundsCenter(geometry) {
    if (!geometry || !geometry.type) return null;
    const getRingCenter = (ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return null;
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        let count = 0;
        for (const coord of ring) {
            if (!Array.isArray(coord) || coord.length < 2) continue;
            const lon = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            count += 1;
        }
        if (count < 3) return null;
        return {
            lon: (minLon + maxLon) / 2,
            lat: (minLat + maxLat) / 2,
        };
    };
    const getRingArea = (ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < ring.length; i += 1) {
            const curr = ring[i];
            const next = ring[(i + 1) % ring.length];
            const x1 = Number(curr?.[0]);
            const y1 = Number(curr?.[1]);
            const x2 = Number(next?.[0]);
            const y2 = Number(next?.[1]);
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
                continue;
            }
            area += (x1 * y2) - (x2 * y1);
        }
        return Math.abs(area) * 0.5;
    };
    if (geometry.type === "Polygon") {
        const ring = Array.isArray(geometry.coordinates?.[0]) ? geometry.coordinates[0] : null;
        const center = getRingCenter(ring);
        if (center) return center;
    }
    if (geometry.type === "MultiPolygon") {
        let bestRing = null;
        let bestArea = 0;
        const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        for (const polygon of polygons) {
            const ring = Array.isArray(polygon?.[0]) ? polygon[0] : null;
            if (!ring) continue;
            const area = getRingArea(ring);
            if (area > bestArea) {
                bestArea = area;
                bestRing = ring;
            }
        }
        const center = getRingCenter(bestRing);
        if (center) return center;
    }
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let count = 0;
    const pushPoint = (coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return;
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        count += 1;
    };
    const walkCoords = (coords) => {
        if (!Array.isArray(coords)) return;
        if (coords.length >= 2 && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
            pushPoint(coords);
            return;
        }
        for (const entry of coords) {
            walkCoords(entry);
        }
    };
    walkCoords(geometry.coordinates);
    if (count === 0) return null;
    return {
        lon: (minLon + maxLon) / 2,
        lat: (minLat + maxLat) / 2,
    };
}
function readCountryName(feature) {
    const props = feature?.properties || {};
    return String(
        props.ADMIN ||
        props.NAME ||
        props.name ||
        props.COUNTRY ||
        props.country ||
        ""
    ).trim();
}
async function addCountryNameLabels(viewer) {
    if (!viewer) return;
    if (!viewer.__countryLabelDataSource) {
        viewer.__countryLabelDataSource = new Cesium.CustomDataSource("warzone-country-labels");
        viewer.dataSources.add(viewer.__countryLabelDataSource);
    }
    const ds = viewer.__countryLabelDataSource;
    const entities = ds.entities;
    entities.removeAll();
    try {
        const geojson = await fetchGeoJson(BORDER_SOURCES.countries);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        const labelScale = numberVar("--warzone-country-label-scale", 0.5);
        const nearDistance = numberVar("--warzone-country-label-near-distance", 1600000);
        const farDistance = numberVar("--warzone-country-label-far-distance", 22000000);
        const nearMultiplier = numberVar("--warzone-country-label-near-multiplier", 0.9);
        const farMultiplier = numberVar("--warzone-country-label-far-multiplier", 1.28);
        const nearScale = Math.max(0.05, labelScale * nearMultiplier);
        const farScale = Math.max(0.05, labelScale * farMultiplier);
        const labelColor = colorFromCssVar("--warzone-country-label-color", "#eef0f5", 0.92);
        const outlineColor = colorFromCssVar("--warzone-country-label-outline", "#101111", 0.78);
        const outlineWidth = numberVar("--warzone-country-label-outline-width", 2);
        const labelFont = stringVar("--warzone-country-label-font", "600 15px Oxanium, sans-serif");
        for (const feature of features) {
            const name = readCountryName(feature);
            if (!name) continue;
            const center = getFeatureBoundsCenter(feature?.geometry);
            if (!center) continue;
            entities.add({
                position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 1000),
                label: {
                    text: name,
                    font: labelFont,
                    scale: labelScale,
                    scaleByDistance: new Cesium.NearFarScalar(
                        nearDistance,
                        nearScale,
                        farDistance,
                        farScale
                    ),
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    fillColor: labelColor,
                    outlineColor,
                    outlineWidth,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                },
            });
        }
    } catch (error) {
        void error;
    }
    updateLabelsLayerVisibility(viewer);
    viewer.scene.requestRender?.();
}
const MAP_COLOR_MIXER_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_red;
uniform float u_green;
uniform float u_blue;
uniform float u_cyan;
uniform float u_magenta;
uniform float u_yellow;
void main() {
    vec4 source = texture(colorTexture, v_textureCoordinates);
    vec3 rgb = source.rgb;

    rgb.r *= max(u_red, 0.0);
    rgb.g *= max(u_green, 0.0);
    rgb.b *= max(u_blue, 0.0);

    float cyan = u_cyan;
    float magenta = u_magenta;
    float yellow = u_yellow;

    rgb.r = clamp(rgb.r + (-cyan * 0.24) + (magenta * 0.24) + (yellow * 0.16), 0.0, 1.0);
    rgb.g = clamp(rgb.g + (cyan * 0.24) + (-magenta * 0.24) + (yellow * 0.16), 0.0, 1.0);
    rgb.b = clamp(rgb.b + (cyan * 0.24) + (magenta * 0.24) + (-yellow * 0.24), 0.0, 1.0);

    out_FragColor = vec4(rgb, source.a);
}
`;
function getMapColorMixerSettings(prefix = "--warzone-map") {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    return {
        red: clamp(numberVar(`${prefix}-red-level`, 1), 0, 2),
        green: clamp(numberVar(`${prefix}-green-level`, 1), 0, 2),
        blue: clamp(numberVar(`${prefix}-blue-level`, 1), 0, 2),
        cyan: clamp(numberVar(`${prefix}-cyan-level`, 0), -1, 1),
        magenta: clamp(numberVar(`${prefix}-magenta-level`, 0), -1, 1),
        yellow: clamp(numberVar(`${prefix}-yellow-level`, 0), -1, 1),
    };
}
function hasMapColorMixerOverrides(settings) {
    return (
        Math.abs(settings.red - 1) > 0.0001 ||
        Math.abs(settings.green - 1) > 0.0001 ||
        Math.abs(settings.blue - 1) > 0.0001 ||
        Math.abs(settings.cyan) > 0.0001 ||
        Math.abs(settings.magenta) > 0.0001 ||
        Math.abs(settings.yellow) > 0.0001
    );
}
function ensureMapColorMixerStage(viewer) {
    if (!viewer?.scene?.postProcessStages) return null;
    const existing = viewer.__warzoneMapColorMixerStage;
    if (existing && !existing.isDestroyed?.()) return existing;
    try {
        const stage = new Cesium.PostProcessStage({
            name: "warzone-map-color-mixer",
            fragmentShader: MAP_COLOR_MIXER_FRAGMENT,
            uniforms: {
                u_red: 1,
                u_green: 1,
                u_blue: 1,
                u_cyan: 0,
                u_magenta: 0,
                u_yellow: 0,
            },
        });
        viewer.scene.postProcessStages.add(stage);
        viewer.__warzoneMapColorMixerStage = stage;
        return stage;
    } catch {
        return null;
    }
}
function applyMapColorMixer(viewer, prefix = "--warzone-map") {
    const stage = ensureMapColorMixerStage(viewer);
    if (!stage) return;
    const settings = getMapColorMixerSettings(prefix);
    stage.uniforms.u_red = settings.red;
    stage.uniforms.u_green = settings.green;
    stage.uniforms.u_blue = settings.blue;
    stage.uniforms.u_cyan = settings.cyan;
    stage.uniforms.u_magenta = settings.magenta;
    stage.uniforms.u_yellow = settings.yellow;
    stage.enabled = hasMapColorMixerOverrides(settings);
}
function getStartCameraConfig() {
    return {
        lon: numberVar("--warzone-start-lon", STARTUP_CAMERA.lon),
        lat: numberVar("--warzone-start-lat", STARTUP_CAMERA.lat),
        height: numberVar("--warzone-start-height", STARTUP_CAMERA.height),
        heading: numberVar("--warzone-start-heading", STARTUP_CAMERA.heading),
        pitch: numberVar("--warzone-start-pitch", STARTUP_CAMERA.pitch),
        roll: numberVar("--warzone-start-roll", STARTUP_CAMERA.roll),
    };
}
function setInitialCamera(viewer) {
    const camera = getStartCameraConfig();
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            camera.lon,
            camera.lat,
            camera.height
        ),
        orientation: {
            heading: Cesium.Math.toRadians(camera.heading),
            pitch: Cesium.Math.toRadians(camera.pitch),
            roll: Cesium.Math.toRadians(camera.roll),
        },
    });
    viewer.scene.requestRender();
}
function focusRegion(
    viewer,
    lon = numberVar("--warzone-start-lon", 47.8),
    lat = numberVar("--warzone-start-lat", 30.2),
    height = numberVar("--warzone-focus-height", 2350000)
) {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: {
            heading: Cesium.Math.toRadians(numberVar("--warzone-start-heading", 0)),
            pitch: Cesium.Math.toRadians(numberVar("--warzone-start-pitch", -82)),
            roll: Cesium.Math.toRadians(numberVar("--warzone-start-roll", 0)),
        },
        duration: 0.9,
    });
}
function startStartupGlobeRotation(viewer) {
    if (!viewer?.scene || viewer.__warzoneStartupRotation?.active) return;
    const state = {
        active: true,
        lastTime: 0,
        speedDeg: Math.max(0.01, Math.min(numberVar("--warzone-startup-rotation-speed", 0.045), 0.3)),
    };
    const rotate = () => {
        if (!state.active) return;
        if (getSceneMode(viewer) !== "3d") {
            state.lastTime = 0;
            return;
        }
        const now = Date.now();
        if (!state.lastTime) {
            state.lastTime = now;
            return;
        }
        const dt = Math.min((now - state.lastTime) / 1000, 0.1);
        state.lastTime = now;
        viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -(state.speedDeg * Cesium.Math.RADIANS_PER_DEGREE) * dt);
        viewer.scene.requestRender?.();
    };
    state.rotate = rotate;
    viewer.__warzoneStartupRotation = state;
    viewer.scene.postRender.addEventListener(rotate);
    viewer.scene.requestRender?.();
}
function stopStartupGlobeRotation(viewer) {
    const state = viewer?.__warzoneStartupRotation;
    if (!viewer?.scene || !state) return;
    state.active = false;
    if (state.rotate) {
        viewer.scene.postRender.removeEventListener(state.rotate);
    }
    viewer.__warzoneStartupRotation = null;
    viewer.scene.requestRender?.();
}
/* ---------- Borders ---------- */
function flattenRingToDegrees(ring) {
    const out = [];
    for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        out.push(lon, lat);
    }
    return out;
}
function ringToCartesianPositions(ring, height = 0) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const positions = [];
    for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, height));
    }
    return positions;
}
function buildPolygonHierarchyFromRings(rings) {
    if (!Array.isArray(rings) || !rings.length) return null;
    const outer = ringToCartesianPositions(rings[0]);
    if (outer.length < 3) return null;
    const holes = rings
        .slice(1)
        .map((ring) => {
            const positions = ringToCartesianPositions(ring);
            return positions.length >= 3 ? new Cesium.PolygonHierarchy(positions) : null;
        })
        .filter(Boolean);
    return new Cesium.PolygonHierarchy(outer, holes);
}
function addRaisedRegionPolygon(viewer, rings) {
    const hierarchy = buildPolygonHierarchyFromRings(rings);
    if (!hierarchy || !viewer?.__raisedRegionDataSource?.entities) return;
    const entities = viewer.__raisedRegionDataSource.entities;
    const height = Math.max(1000, numberVar("--warzone-raised-region-height", 32000));
    const sideAlpha = clamp01(numberVar("--warzone-raised-region-side-alpha", 0.18));
    const fillAlpha = clamp01(numberVar("--warzone-raised-region-fill-alpha", 0.10));
    const outlineAlpha = clamp01(numberVar("--warzone-raised-region-outline-alpha", 0.78));
    const fillColor = colorFromCssVar("--warzone-raised-region-color", "#18e2db", 1);
    const outlineWidth = Math.max(1, numberVar("--warzone-raised-region-outline-width", 2.4));
    entities.add({
        polygon: {
            hierarchy,
            height,
            extrudedHeight: 0,
            material: fillColor.withAlpha(fillAlpha),
            closeTop: true,
            closeBottom: false,
            outline: false,
            perPositionHeight: false,
        },
    });
    entities.add({
        polygon: {
            hierarchy,
            height,
            extrudedHeight: 0,
            material: fillColor.withAlpha(sideAlpha),
            closeTop: false,
            closeBottom: false,
            outline: false,
            perPositionHeight: false,
        },
    });
    const outlinePositions = ringToCartesianPositions(rings[0], height + 600);
    if (outlinePositions.length >= 3) {
        outlinePositions.push(outlinePositions[0]);
        entities.add({
            polyline: {
                positions: outlinePositions,
                width: outlineWidth,
                material: fillColor.withAlpha(outlineAlpha),
                clampToGround: false,
            },
        });
    }
}
function normalizeFeatureProp(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}
function featureMatchesRaisedRegion(feature, regionId = "") {
    const id = String(regionId || "").trim();
    if (!id || id === "global") return false;
    const props = feature?.properties || {};
    const iso2 = normalizeFeatureProp(props.ISO_A2_EH || props.ISO_A2 || "");
    const continent = normalizeFeatureProp(props.CONTINENT || "");
    const subregion = normalizeFeatureProp(props.SUBREGION || "");
    if (RAISED_REGION_EXPLICIT_ISO2[id]?.has(iso2)) return true;
    const continentMatch = RAISED_REGION_CONTINENT_MATCH[id];
    if (continentMatch && continent === continentMatch) return true;
    return RAISED_REGION_SUBREGION_MATCH[id]?.has(subregion) === true;
}
async function ensureRaisedRegionLoaded(viewer, region = null) {
    if (!viewer) return;
    const regionId = String(region?.id || "middle_east").trim();
    if (!regionId || regionId === "global") return;
    if (viewer.__raisedRegionLoaded === regionId) return;
    if (viewer.__raisedRegionLoadPromise) return viewer.__raisedRegionLoadPromise;
    if (!viewer.__raisedRegionDataSource) {
        viewer.__raisedRegionDataSource = new Cesium.CustomDataSource("warzone-raised-region");
        viewer.dataSources.add(viewer.__raisedRegionDataSource);
    }
    const ds = viewer.__raisedRegionDataSource;
    ds.entities.removeAll();
    viewer.__raisedRegionLoadPromise = fetchGeoJson(BORDER_SOURCES.countries)
        .then((geojson) => {
            const features = Array.isArray(geojson?.features) ? geojson.features : [];
            ds.entities.suspendEvents?.();
            for (const feature of features) {
                if (!featureMatchesRaisedRegion(feature, regionId)) continue;
                const geometry = feature?.geometry;
                if (geometry?.type === "Polygon") {
                    addRaisedRegionPolygon(viewer, geometry.coordinates);
                } else if (geometry?.type === "MultiPolygon") {
                    const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                    for (const polygon of polygons) {
                        addRaisedRegionPolygon(viewer, polygon);
                    }
                }
            }
            ds.entities.resumeEvents?.();
            viewer.__raisedRegionLoaded = regionId;
        })
        .catch(() => {
            viewer.__raisedRegionLoaded = false;
        })
        .finally(() => {
            viewer.__raisedRegionLoadPromise = null;
        });
    return viewer.__raisedRegionLoadPromise;
}
function applyRaisedRegionVisibility(viewer, visible, region = null) {
    if (!viewer) return;
    const regionId = String(region?.id || "middle_east").trim();
    const show = !!visible && regionId && regionId !== "global";
    viewer.__raisedRegionVisible = show;
    if (!viewer.__raisedRegionDataSource) {
        viewer.__raisedRegionDataSource = new Cesium.CustomDataSource("warzone-raised-region");
        viewer.dataSources.add(viewer.__raisedRegionDataSource);
    }
    viewer.__raisedRegionDataSource.show = show;
    if (show && viewer.__raisedRegionLoaded !== regionId) {
        ensureRaisedRegionLoaded(viewer, region).then(() => {
            if (viewer.__raisedRegionDataSource) {
                viewer.__raisedRegionDataSource.show = viewer.__raisedRegionVisible === true;
            }
            viewer.scene?.requestRender?.();
        });
    }
    viewer.scene?.requestRender?.();
}
function getBorderEntityCollection(viewer) {
    if (viewer.__borderDataSource?.entities) {
        return viewer.__borderDataSource.entities;
    }
    return viewer.entities;
}
function stopBorderFadeAnimation(viewer) {
    if (viewer?.__borderFadeRaf) {
        cancelAnimationFrame(viewer.__borderFadeRaf);
        viewer.__borderFadeRaf = 0;
    }
}
function applyBorderVisibilityAlpha(viewer, visibilityAlpha) {
    if (!viewer) return;
    const alphaMultiplier = clamp01(Number(visibilityAlpha));
    viewer.__borderVisibilityAlpha = alphaMultiplier;
    const fallbackBaseColor =
        viewer.__borderFallbackColor ||
        (viewer.__borderFallbackColor = colorFromCssVar("--warzone-country-border", "#33e1ff", 1));
    const hasVisibleAlpha = alphaMultiplier > 0.001;
    if (viewer.__borderDataSource) {
        viewer.__borderDataSource.show = hasVisibleAlpha;
    }
    if (!Array.isArray(viewer.__borderEntities)) return;
    viewer.__borderEntities.forEach((entity) => {
        if (!entity?.polyline) return;
        const baseColor = entity.__borderBaseColor || fallbackBaseColor;
        const baseAlphaRaw = Number(entity.__borderBaseAlpha);
        const baseAlpha = Number.isFinite(baseAlphaRaw) ? clamp01(baseAlphaRaw) : 1;
        const nextAlpha = clamp01(baseAlpha * alphaMultiplier);
        entity.polyline.material = baseColor.withAlpha(nextAlpha);
        entity.show = nextAlpha > 0.001;
    });
}
function animateBorderVisibility(viewer, targetAlpha, options = {}) {
    if (!viewer) return;
    const startAlphaRaw = Number(viewer.__borderVisibilityAlpha);
    const startAlpha = Number.isFinite(startAlphaRaw)
        ? clamp01(startAlphaRaw)
        : (viewer.__borderLayersVisible !== false ? 1 : 0);
    const clampedTarget = clamp01(Number(targetAlpha));
    const requestedDuration = Number(options?.duration);
    const duration = Number.isFinite(requestedDuration)
        ? Math.max(0, requestedDuration)
        : Math.max(0, numberVar("--warzone-border-fade-duration", 620));
    if (Math.abs(clampedTarget - startAlpha) < 0.001 || duration <= 0) {
        stopBorderFadeAnimation(viewer);
        applyBorderVisibilityAlpha(viewer, clampedTarget);
        viewer.scene?.requestRender?.();
        return;
    }
    stopBorderFadeAnimation(viewer);
    const startedAt = performance.now();
    const step = (now) => {
        const t = clamp01((now - startedAt) / duration);
        const eased = easeInOutCubic(t);
        const next = lerp(startAlpha, clampedTarget, eased);
        applyBorderVisibilityAlpha(viewer, next);
        viewer.scene?.requestRender?.();
        if (t >= 1) {
            viewer.__borderFadeRaf = 0;
            return;
        }
        viewer.__borderFadeRaf = requestAnimationFrame(step);
    };
    viewer.__borderFadeRaf = requestAnimationFrame(step);
}
function addPolylineForRing(viewer, ring, options) {
    const coords = flattenRingToDegrees(ring);
    if (coords.length < 4) return;
    const baseColor = options?.baseColor || colorFromCssVar("--warzone-country-border", "#33e1ff", 1);
    const baseAlphaRaw = Number(options?.alpha);
    const baseAlpha = Number.isFinite(baseAlphaRaw) ? clamp01(baseAlphaRaw) : 1;
    const visibilityAlphaRaw = Number(viewer.__borderVisibilityAlpha);
    const visibilityAlpha = Number.isFinite(visibilityAlphaRaw)
        ? clamp01(visibilityAlphaRaw)
        : (viewer.__borderLayersVisible !== false ? 1 : 0);
    const initialAlpha = clamp01(baseAlpha * visibilityAlpha);
    const entity = getBorderEntityCollection(viewer).add({
        polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords),
            width: options.width,
            material: baseColor.withAlpha(initialAlpha),
            // Keep country borders at the lowest map layer.
            clampToGround: true,
            zIndex: 0,
        },
    });
    if (!Array.isArray(viewer.__borderEntities)) {
        viewer.__borderEntities = [];
    }
    entity.__borderBaseColor = baseColor.withAlpha(1);
    entity.__borderBaseAlpha = baseAlpha;
    entity.show = initialAlpha > 0.001;
    viewer.__borderEntities.push(entity);
}
function setBorderLayersVisible(viewer, visible, options = {}) {
    if (!viewer) return;
    const show = !!visible;
    viewer.__borderLayersVisible = show;
    if (show && !viewer.__borderLayersLoaded) {
        ensureBorderLayersLoaded(viewer).then(() => {
            if (viewer.__borderLayersVisible !== show) return;
            setBorderLayersVisible(viewer, show, options);
            viewer.scene?.requestRender?.();
        });
        return;
    }
    void options;
    stopBorderFadeAnimation(viewer);
    applyBorderVisibilityAlpha(viewer, show ? 1 : 0);
    viewer.scene?.requestRender?.();
}
async function fetchGeoJson(url) {
    const candidates = Array.isArray(url) ? url.filter(Boolean) : [url];
    if (!candidates.length) return null;
    let lastError = null;
    for (const candidate of candidates) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(candidate, {
                cache: "force-cache",
                signal: controller.signal,
            });
            if (!response.ok) {
                lastError = new Error(`GeoJSON fetch failed: ${response.status} (${candidate})`);
                continue;
            }
            return await response.json();
        } catch (error) {
            lastError = error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }
    throw lastError || new Error("GeoJSON fetch failed");
}
async function addGeoJsonBorderLayer(viewer, config) {
    if (!config?.url) return;
    try {
        const geojson = await fetchGeoJson(config.url);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        const baseColor = colorFromCssVar(
            config.colorVar,
            config.fallbackColor,
            1
        );
        const baseAlpha = clamp01(numberVar(config.alphaVar, config.fallbackAlpha));
        const width = numberVar(config.widthVar, config.fallbackWidth);
        for (const feature of features) {
            const geometry = feature?.geometry;
            if (!geometry) continue;
            if (geometry.type === "Polygon") {
                const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                if (rings[0]) addPolylineForRing(viewer, rings[0], { baseColor, alpha: baseAlpha, width });
            } else if (geometry.type === "MultiPolygon") {
                const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const polygon of polygons) {
                    const rings = Array.isArray(polygon) ? polygon : [];
                    if (rings[0]) addPolylineForRing(viewer, rings[0], { baseColor, alpha: baseAlpha, width });
                }
            } else if (geometry.type === "LineString") {
                addPolylineForRing(viewer, geometry.coordinates, { baseColor, alpha: baseAlpha, width });
            } else if (geometry.type === "MultiLineString") {
                const lines = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const line of lines) addPolylineForRing(viewer, line, { baseColor, alpha: baseAlpha, width });
            }
        }
    } catch (error) {
        void error;
    }
}
async function addBorderLayers(viewer) {
    if (!Array.isArray(viewer.__borderEntities)) {
        viewer.__borderEntities = [];
    }
    if (!viewer.__borderDataSource) {
        viewer.__borderDataSource = new Cesium.CustomDataSource("warzone-borders");
        viewer.dataSources.add(viewer.__borderDataSource);
        viewer.__borderDataSource.show = viewer.__borderLayersVisible !== false;
    }
    const entities = viewer.__borderDataSource.entities;
    entities.suspendEvents?.();
    await addGeoJsonBorderLayer(viewer, {
        name: "Country",
        url: BORDER_SOURCES.countries,
        colorVar: "--warzone-country-border",
        fallbackColor: "#18e2db",
        alphaVar: "--warzone-country-border-alpha",
        fallbackAlpha: 0.72,
        widthVar: "--warzone-country-border-width",
        fallbackWidth: 1.4,
    });
    entities.resumeEvents?.();
    const initialVisibility = Number.isFinite(Number(viewer.__borderVisibilityAlpha))
        ? Number(viewer.__borderVisibilityAlpha)
        : (viewer.__borderLayersVisible !== false ? 1 : 0);
    applyBorderVisibilityAlpha(viewer, initialVisibility);
}
function ensureBorderLayersLoaded(viewer) {
    if (!viewer) return Promise.resolve();
    if (viewer.__borderLayersLoaded) return Promise.resolve();
    if (viewer.__borderLayerLoadPromise) return viewer.__borderLayerLoadPromise;
    viewer.__borderLayerLoadPromise = addBorderLayers(viewer)
        .then(() => {
            viewer.__borderLayersLoaded = true;
        })
        .catch(() => {
            // keep retries possible on future toggles
        })
        .finally(() => {
            viewer.__borderLayerLoadPromise = null;
        });
    return viewer.__borderLayerLoadPromise;
}
async function addArcGisLayers(viewer) {
    viewer.imageryLayers.removeAll();
    const baseProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        { enablePickFeatures: false }
    );
    const baseLayer = viewer.imageryLayers.addImageryProvider(baseProvider);
    tuneImageryLayer(baseLayer, "--warzone-map");
    let labelsLayer = null;
    if (boolVar("--warzone-places-layer-enabled", false)) {
        const labelsProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer",
            { enablePickFeatures: false }
        );
        labelsLayer = viewer.imageryLayers.addImageryProvider(labelsProvider);
        tuneImageryLayer(labelsLayer, "--warzone-labels");
    }
    const show = viewer.__terrainVisible !== false;
    baseLayer.show = show;
    if (labelsLayer) labelsLayer.show = show;
    viewer.__imageryBase = baseLayer;
    viewer.__imageryLabels = labelsLayer;
    updateMapCredits();
    updateLabelsLayerVisibility(viewer);
    return { baseLayer, labelsLayer };
}

function setContourGridLayerVisible(viewer, visible) {
    const show = !!visible;
    viewer.__contourGridLayerVisible = show;
    if (show) retainContourDemCache();
    document.documentElement.style.setProperty("--warzone-contour-grid-enabled", show ? "1" : "0");
    const state = getContourOverlayState(viewer);
    if (show) {
        const center = Number.isFinite(state?.gridCenterLon) && Number.isFinite(state?.gridCenterLat)
            ? { lon: state.gridCenterLon, lat: state.gridCenterLat }
            : getContourFallbackCenter(viewer);
        ensureContourGridPrimitive(viewer, center, { force: true });
    } else if (state?.gridPrimitive) {
        state.gridPrimitive.show = false;
    }
    if (viewer.__contourLayerVisible === true) {
        if (state) state.buildToken += 1;
        void buildContourOverlay(viewer, {
            force: true,
            reason: "contour-grid-toggle",
        });
    } else if (!show) {
        clearContourOverlay(viewer);
        scheduleContourDemCacheRelease(viewer);
    }
    viewer.scene?.requestRender?.();
    return show;
}

function updateMapCredits() {
    const creditsEl = document.getElementById("warzone-map-credits");
    if (!creditsEl) return;
    creditsEl.setAttribute("aria-label", "Map credits and data attribution");
    creditsEl.querySelectorAll("img").forEach((img) => {
        if (!img.alt) {
            img.alt = img.className.includes("battlespacex") ? "BattlespaceX" : "Map credit";
        }
        img.decoding = "async";
    });
}
function getCesiumCreditContainer(globeEl) {
    if (!globeEl || typeof document === "undefined") return undefined;
    const existing = document.getElementById("warzone-cesium-credit-container");
    if (existing) return existing;
    const container = document.createElement("div");
    container.id = "warzone-cesium-credit-container";
    container.hidden = true;
    container.setAttribute("aria-hidden", "true");
    globeEl.appendChild(container);
    return container;
}
function getContourOverlayState(viewer) {
    if (!viewer) return null;
    if (!viewer.__contourOverlayState) {
        viewer.__contourOverlayState = {
            dataSource: null,
            terrainProvider: null,
            terrainProviderPromise: null,
            buildTimer: 0,
            buildPromise: null,
            buildQueued: false,
            buildQueuedForce: false,
            buildQueuedReason: "",
            buildToken: 0,
            clearTimer: 0,
            clearToken: 0,
            centerLon: Number.NaN,
            centerLat: Number.NaN,
            centerHeight: 0,
            hasFocusPosition: false,
            lastBuiltLon: Number.NaN,
            lastBuiltLat: Number.NaN,
            lastBuiltAt: 0,
            hasVisibleContours: false,
            gridPrimitive: null,
            gridCenterLon: Number.NaN,
            gridCenterLat: Number.NaN,
        };
    }
    return viewer.__contourOverlayState;
}
async function ensureContourOverlayDataSource(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return null;
    if (state.dataSource) return state.dataSource;
    const dataSource = new Cesium.CustomDataSource("warzone-contour-overlay");
    state.dataSource = dataSource;
    await Promise.resolve(viewer.dataSources.add(dataSource));
    return dataSource;
}
function applyContourLayerState(viewer) {
    const state = getContourOverlayState(viewer);
    const show = viewer?.__contourLayerVisible === true;
    if (state?.dataSource) {
        state.dataSource.show = show;
    }
    if (state?.gridPrimitive) {
        state.gridPrimitive.show = viewer?.__contourGridLayerVisible === true;
    }
}
function clearContourOverlay(viewer) {
    const state = getContourOverlayState(viewer);
    if (state) state.hasVisibleContours = false;
    if (!state?.dataSource) return;
    state.clearToken += 1;
    if (state.clearTimer) {
        clearTimeout(state.clearTimer);
        state.clearTimer = 0;
    }
    state.dataSource.entities.removeAll();
    state.dataSource.show = false;
    viewer.scene?.requestRender?.();
}
function clearContourOverlayDeferred(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return;
    state.hasVisibleContours = false;
    state.clearToken += 1;
    const clearToken = state.clearToken;
    if (state.clearTimer) {
        clearTimeout(state.clearTimer);
        state.clearTimer = 0;
    }
    const dataSource = state.dataSource;
    if (!dataSource?.entities) return;
    dataSource.show = false;
    viewer.scene?.requestRender?.();
    const removeChunk = () => {
        if (state.clearToken !== clearToken) return;
        const values = dataSource.entities.values || [];
        const batchSize = 90;
        for (let index = 0; index < batchSize && values.length; index += 1) {
            dataSource.entities.remove(values[values.length - 1]);
        }
        if (values.length) {
            state.clearTimer = window.setTimeout(removeChunk, 16);
            return;
        }
        state.clearTimer = 0;
        viewer.scene?.requestRender?.();
    };
    state.clearTimer = window.setTimeout(removeChunk, 16);
}
function isContourBuildCurrent(viewer, state, buildToken) {
    return (viewer?.__contourLayerVisible === true || viewer?.__contourGridLayerVisible === true) && state?.buildToken === buildToken;
}
async function ensureContourTerrainProvider(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return null;
    if (state.terrainProvider) return state.terrainProvider;
    if (state.terrainProviderPromise) return state.terrainProviderPromise;
    state.terrainProviderPromise = Promise.resolve()
        .then(() => createFocusedTerrainProvider())
        .then((provider) => {
            state.terrainProvider = provider || null;
            return state.terrainProvider;
        })
        .catch((error) => {
            console.warn("Focused terrain provider failed to load:", error);
            state.terrainProvider = null;
            return null;
        })
        .finally(() => {
            state.terrainProviderPromise = null;
        });
    return state.terrainProviderPromise;
}
function getFocusedTerrainProviderMode() {
    return String(window.__stratopsConfig?.focusedTerrainProvider || "arcgis").trim().toLowerCase();
}
function getFocusedTerrainArcGisUrl() {
    return String(
        window.__stratopsConfig?.focusedTerrainArcGisUrl ||
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
    ).trim();
}
function getFocusedTerrainArcGisToken() {
    return String(window.__stratopsConfig?.focusedTerrainArcGisToken || "").trim();
}
async function createArcGisFocusedTerrainProvider() {
    if (!Cesium.ArcGISTiledElevationTerrainProvider?.fromUrl) return null;
    const url = getFocusedTerrainArcGisUrl();
    if (!url) return null;
    const token = getFocusedTerrainArcGisToken();
    const options = token ? { token } : {};
    const provider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(url, options);
    provider.__warzoneArcGisUrl = url;
    return provider;
}
async function createFocusedTerrainProvider() {
    const mode = getFocusedTerrainProviderMode();
    if (mode !== "flat") {
        try {
            const arcGisTerrain = await createArcGisFocusedTerrainProvider();
            if (arcGisTerrain) {
                arcGisTerrain.__warzoneProviderKind = "arcgis";
                return arcGisTerrain;
            }
        } catch (error) {
            console.warn("ArcGIS focused terrain provider failed; using flat globe fallback:", error);
        }
        try {
            if (typeof Cesium.createWorldTerrainAsync === "function") {
                const worldTerrain = await Cesium.createWorldTerrainAsync({
                    requestVertexNormals: true,
                    requestWaterMask: false,
                });
                if (worldTerrain) {
                    worldTerrain.__warzoneProviderKind = "cesium-world";
                    return worldTerrain;
                }
            }
        } catch (error) {
            console.warn("Cesium world terrain provider failed; using flat globe fallback:", error);
        }
    }
    if (mode === "flat") {
        const flatTerrain = new Cesium.EllipsoidTerrainProvider();
        flatTerrain.__warzoneProviderKind = "flat";
        return flatTerrain;
    }
    return null;
}
async function enableFocusedTerrain(viewer) {
    if (!viewer) return false;
    if (!viewer.__warzoneFlatTerrainProvider) {
        viewer.__warzoneFlatTerrainProvider = viewer.terrainProvider;
    }
    const terrainProvider = await ensureContourTerrainProvider(viewer);
    if (!terrainProvider || terrainProvider.__warzoneProviderKind === "flat") return false;
    viewer.terrainProvider = terrainProvider;
    viewer.__warzoneFocusedTerrainFallbackFlat = terrainProvider.__warzoneProviderKind === "flat";
    viewer.__terrainVisible = true;
    viewer.__satelliteVisible = true;
    if (viewer.scene) {
        const globe = viewer.scene.globe;
        if (globe && !Number.isFinite(viewer.__warzoneFlatTerrainMaximumScreenSpaceError)) {
            viewer.__warzoneFlatTerrainMaximumScreenSpaceError = Number(globe.maximumScreenSpaceError);
        }
        if (globe && viewer.__warzoneFlatTerrainDepthTestAgainstTerrain === undefined) {
            viewer.__warzoneFlatTerrainDepthTestAgainstTerrain = globe.depthTestAgainstTerrain;
        }
        if (globe) {
            const focusedDetail = Math.max(1.5, numberVar("--warzone-focus-terrain-detail", 6));
            globe.maximumScreenSpaceError = Math.min(Number(globe.maximumScreenSpaceError) || focusedDetail, focusedDetail);
            globe.depthTestAgainstTerrain = false;
        }
        const defaultExaggeration = numberVar("--warzone-topography-exaggeration", 1);
        viewer.scene.verticalExaggeration = Math.max(1, numberVar("--warzone-focus-terrain-exaggeration", defaultExaggeration));
        viewer.scene.verticalExaggerationRelativeHeight = 0;
        applyRenderedTerrainVisibility(viewer);
        viewer.scene.requestRender?.();
    }
    viewer.__warzoneFocusedTerrainActive = true;
    dispatchFocusedTerrainChanged(viewer);
    return true;
}
function disableFocusedTerrain(viewer) {
    if (!viewer) return false;
    if (viewer.__warzoneFlatTerrainProvider) {
        viewer.terrainProvider = viewer.__warzoneFlatTerrainProvider;
    } else {
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    if (viewer.scene) {
        const globe = viewer.scene.globe;
        if (globe && Number.isFinite(viewer.__warzoneFlatTerrainMaximumScreenSpaceError)) {
            globe.maximumScreenSpaceError = viewer.__warzoneFlatTerrainMaximumScreenSpaceError;
        }
        if (globe && viewer.__warzoneFlatTerrainDepthTestAgainstTerrain !== undefined) {
            globe.depthTestAgainstTerrain = viewer.__warzoneFlatTerrainDepthTestAgainstTerrain;
        }
        viewer.scene.verticalExaggeration = 1;
        viewer.scene.verticalExaggerationRelativeHeight = 0;
        viewer.scene.requestRender?.();
    }
    viewer.__warzoneFocusedTerrainActive = false;
    dispatchFocusedTerrainChanged(viewer);
    return true;
}
function contourDistanceMeters(lonA, latA, lonB, latB) {
    if (![lonA, latA, lonB, latB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const latMeters = 111320;
    const avgLatRad = Cesium.Math.toRadians((latA + latB) * 0.5);
    const lonMeters = Math.max(1, Math.cos(avgLatRad) * latMeters);
    const dx = (lonA - lonB) * lonMeters;
    const dy = (latA - latB) * latMeters;
    return Math.hypot(dx, dy);
}
function getContourOverlayRadiusMeters() {
    return getContourOverlayRadii().outerRadius;
}
function getContourOverlayRadii() {
    const strongRadius = Math.max(40000, Math.min(240000, numberVar("--warzone-live-aircraft-contour-radius", 220000)));
    const blurRadius = Math.max(0, Math.min(90000, numberVar("--warzone-live-aircraft-contour-blur", 60000)));
    const fadeRadius = Math.max(0, Math.min(70000, numberVar("--warzone-live-aircraft-contour-fade", 30000)));
    const outerRadius = Math.max(strongRadius + 25000, Math.min(320000, strongRadius + blurRadius + fadeRadius));
    return { strongRadius, outerRadius };
}
function smoothContourFade(value) {
    const t = clamp01(value);
    return t * t * (3 - (2 * t));
}
function getContourChainAlphaScale(points = [], centerLon, centerLat, strongRadius, outerRadius) {
    if (!Array.isArray(points) || !points.length) return 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += Math.max(1, Math.floor(points.length / 8))) {
        const point = points[index];
        nearestDistance = Math.min(
            nearestDistance,
            contourDistanceMeters(centerLon, centerLat, Number(point?.lon), Number(point?.lat))
        );
    }
    const lastPoint = points[points.length - 1];
    nearestDistance = Math.min(
        nearestDistance,
        contourDistanceMeters(centerLon, centerLat, Number(lastPoint?.lon), Number(lastPoint?.lat))
    );
    if (!Number.isFinite(nearestDistance) || nearestDistance >= outerRadius) return 0;
    if (nearestDistance <= strongRadius) return 1;
    const fadeT = (nearestDistance - strongRadius) / Math.max(1, outerRadius - strongRadius);
    return Math.max(0, 1 - smoothContourFade(fadeT));
}
function getContourGridSampleSize() {
    return Math.max(34, Math.min(96, Math.round(numberVar("--warzone-contour-grid-size", 82))));
}
function getContourTerrainSampleLevel() {
    return Math.max(6, Math.min(14, Math.round(numberVar("--warzone-contour-sample-level", 11))));
}
const TERRARIUM_TILE_SIZE = 256;
const contourTerrariumTileCache = new Map();
const CONTOUR_DEM_CACHE_RELEASE_DELAY_MS = 90 * 1000;
let contourDemCacheReleaseTimer = 0;
let contourDemWarningShown = false;
function updateContourDemCacheDiagnostics() {
    window.__warzoneContourDemCacheSize = contourTerrariumTileCache.size;
}
function retainContourDemCache() {
    if (!contourDemCacheReleaseTimer) return;
    window.clearTimeout(contourDemCacheReleaseTimer);
    contourDemCacheReleaseTimer = 0;
}
function scheduleContourDemCacheRelease(viewer) {
    if (viewer?.__contourLayerVisible === true || viewer?.__contourGridLayerVisible === true) {
        retainContourDemCache();
        return;
    }
    if (contourDemCacheReleaseTimer || !contourTerrariumTileCache.size) return;
    contourDemCacheReleaseTimer = window.setTimeout(() => {
        contourDemCacheReleaseTimer = 0;
        if (viewer?.__contourLayerVisible === true || viewer?.__contourGridLayerVisible === true) return;
        contourTerrariumTileCache.clear();
        updateContourDemCacheDiagnostics();
    }, CONTOUR_DEM_CACHE_RELEASE_DELAY_MS);
}
function hasSampledContourHeights(samplePositions = []) {
    if (!Array.isArray(samplePositions) || !samplePositions.length) return false;
    const validCount = samplePositions.reduce((count, position) => (
        count + (Number.isFinite(Number(position?.height)) ? 1 : 0)
    ), 0);
    return validCount >= 24 && (validCount / samplePositions.length) >= 0.08;
}
function getContourTerrariumZoom() {
    return Math.max(6, Math.min(12, Math.round(numberVar("--warzone-contour-dem-zoom", 10))));
}
function getContourTerrariumTileTemplate() {
    return stringVar("--warzone-contour-dem-url", "/__warzone/terrain/terrarium/{z}/{x}/{y}.png");
}
function getContourTerrariumTileUrl(z, x, y) {
    return getContourTerrariumTileTemplate()
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
}
function getContourTerrariumTileUrls(z, x, y) {
    const primary = getContourTerrariumTileUrl(z, x, y);
    const fallback = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    return Array.from(new Set([primary, fallback].filter(Boolean)));
}
function getTerrariumTilePoint(lon, lat, zoom) {
    const n = 2 ** zoom;
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const lonWrapped = ((Number(lon) + 180) % 360 + 360) % 360 - 180;
    const latRad = Cesium.Math.toRadians(safeLat);
    const xFloat = ((lonWrapped + 180) / 360) * n;
    const yFloat = (1 - (Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI)) * 0.5 * n;
    const x = Math.max(0, Math.min(n - 1, Math.floor(xFloat)));
    const y = Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
    const pixelX = Math.max(0, Math.min(TERRARIUM_TILE_SIZE - 1, Math.floor((xFloat - x) * TERRARIUM_TILE_SIZE)));
    const pixelY = Math.max(0, Math.min(TERRARIUM_TILE_SIZE - 1, Math.floor((yFloat - y) * TERRARIUM_TILE_SIZE)));
    return { z: zoom, x, y, pixelX, pixelY };
}
function trimTerrariumTileCache() {
    const maxTiles = Math.max(24, Math.min(180, Math.round(numberVar("--warzone-contour-dem-tile-cache", 96))));
    while (contourTerrariumTileCache.size > maxTiles) {
        const oldestKey = contourTerrariumTileCache.keys().next().value;
        if (!oldestKey) break;
        contourTerrariumTileCache.delete(oldestKey);
    }
    updateContourDemCacheDiagnostics();
}
function loadTerrariumTilePixels(z, x, y) {
    retainContourDemCache();
    const key = `${z}/${x}/${y}`;
    const cached = contourTerrariumTileCache.get(key);
    if (cached) return cached;
    const promise = new Promise((resolve) => {
        const urls = getContourTerrariumTileUrls(z, x, y);
        let urlIndex = 0;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = TERRARIUM_TILE_SIZE;
                canvas.height = TERRARIUM_TILE_SIZE;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                context.drawImage(image, 0, 0, TERRARIUM_TILE_SIZE, TERRARIUM_TILE_SIZE);
                resolve(context.getImageData(0, 0, TERRARIUM_TILE_SIZE, TERRARIUM_TILE_SIZE).data);
            } catch (error) {
                if (urlIndex < urls.length - 1) {
                    urlIndex += 1;
                    image.src = urls[urlIndex];
                    return;
                }
                if (!contourDemWarningShown) {
                    contourDemWarningShown = true;
                    console.warn("Contour DEM tile decode failed. Real contour lines need /__warzone/terrain/terrarium/... or a CORS-readable DEM tile source.", error);
                }
                resolve(null);
            }
        };
        image.onerror = () => {
            if (urlIndex < urls.length - 1) {
                urlIndex += 1;
                image.src = urls[urlIndex];
                return;
            }
            if (!contourDemWarningShown) {
                contourDemWarningShown = true;
                console.warn("Contour DEM tiles unavailable. Real contour lines need /__warzone/terrain/terrarium/... to return PNG tiles.");
            }
            resolve(null);
        };
        image.src = urls[urlIndex];
    });
    contourTerrariumTileCache.set(key, promise);
    trimTerrariumTileCache();
    return promise;
}
function readTerrariumHeight(tilePixels, pixelX, pixelY) {
    if (!tilePixels) return Number.NaN;
    const index = ((pixelY * TERRARIUM_TILE_SIZE) + pixelX) * 4;
    const r = Number(tilePixels[index]);
    const g = Number(tilePixels[index + 1]);
    const b = Number(tilePixels[index + 2]);
    if (![r, g, b].every(Number.isFinite)) return Number.NaN;
    return (r * 256) + g + (b / 256) - 32768;
}
async function sampleTerrariumContourTerrain(samplePositions = []) {
    if (
        !Array.isArray(samplePositions) ||
        !samplePositions.length ||
        boolVar("--warzone-contour-dem-enabled", true) !== true ||
        typeof Image === "undefined" ||
        typeof document === "undefined"
    ) {
        return false;
    }
    const zoom = getContourTerrariumZoom();
    const tileGroups = new Map();
    let centerLonTotal = 0;
    let centerLatTotal = 0;
    let centerCount = 0;
    samplePositions.forEach((position, index) => {
        const lon = Cesium.Math.toDegrees(position.longitude);
        const lat = Cesium.Math.toDegrees(position.latitude);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        centerLonTotal += lon;
        centerLatTotal += lat;
        centerCount += 1;
        const tilePoint = getTerrariumTilePoint(lon, lat, zoom);
        const key = `${tilePoint.z}/${tilePoint.x}/${tilePoint.y}`;
        if (!tileGroups.has(key)) tileGroups.set(key, { tilePoint, samples: [], lonTotal: 0, latTotal: 0, count: 0 });
        const group = tileGroups.get(key);
        group.lonTotal += lon;
        group.latTotal += lat;
        group.count += 1;
        tileGroups.get(key).samples.push({ index, pixelX: tilePoint.pixelX, pixelY: tilePoint.pixelY });
    });
    const maxTiles = Math.max(8, Math.min(96, Math.round(numberVar("--warzone-contour-dem-max-tiles", 42))));
    const centerLon = centerCount ? centerLonTotal / centerCount : 0;
    const centerLat = centerCount ? centerLatTotal / centerCount : 0;
    const groups = Array.from(tileGroups.values())
        .sort((a, b) => {
            const aLon = a.count ? a.lonTotal / a.count : centerLon;
            const aLat = a.count ? a.latTotal / a.count : centerLat;
            const bLon = b.count ? b.lonTotal / b.count : centerLon;
            const bLat = b.count ? b.latTotal / b.count : centerLat;
            return contourDistanceMeters(aLon, aLat, centerLon, centerLat) - contourDistanceMeters(bLon, bLat, centerLon, centerLat);
        })
        .slice(0, maxTiles);
    await Promise.all(groups.map(async (group) => {
        const pixels = await loadTerrariumTilePixels(group.tilePoint.z, group.tilePoint.x, group.tilePoint.y);
        if (!pixels) return;
        group.samples.forEach((sample) => {
            const target = samplePositions[sample.index];
            const height = readTerrariumHeight(pixels, sample.pixelX, sample.pixelY);
            if (target && Number.isFinite(height)) {
                target.height = height;
            }
        });
    }));
    return hasSampledContourHeights(samplePositions);
}
function getArcGisContourSampleUrl(terrainProvider) {
    const url = String(terrainProvider?.__warzoneArcGisUrl || getFocusedTerrainArcGisUrl() || "").trim();
    return url ? `${url.replace(/\/+$/, "")}/getSamples` : "";
}
async function sampleArcGisContourTerrain(terrainProvider, samplePositions = []) {
    const sampleUrl = getArcGisContourSampleUrl(terrainProvider);
    if (!sampleUrl || !Array.isArray(samplePositions) || !samplePositions.length || typeof fetch !== "function") {
        return false;
    }
    const batchSize = Math.max(80, Math.min(420, Math.round(numberVar("--warzone-contour-arcgis-batch-size", 280))));
    for (let offset = 0; offset < samplePositions.length; offset += batchSize) {
        const batch = samplePositions.slice(offset, offset + batchSize);
        const geometry = {
            points: batch.map((position) => [
                Cesium.Math.toDegrees(position.longitude),
                Cesium.Math.toDegrees(position.latitude),
            ]),
            spatialReference: { wkid: 4326 },
        };
        const body = new URLSearchParams();
        body.set("f", "json");
        body.set("geometryType", "esriGeometryMultipoint");
        body.set("geometry", JSON.stringify(geometry));
        body.set("returnFirstValueOnly", "true");
        body.set("interpolation", "RSP_BilinearInterpolation");
        const token = getFocusedTerrainArcGisToken();
        if (token) body.set("token", token);
        try {
            const response = await fetch(sampleUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body,
            });
            if (!response.ok) return false;
            const payload = await response.json();
            if (payload?.error) {
                console.warn("ArcGIS contour sample failed:", payload.error);
                return false;
            }
            const samples = Array.isArray(payload?.samples) ? payload.samples : [];
            samples.forEach((sample, sampleIndex) => {
                const locationId = Number.isFinite(Number(sample?.locationId)) ? Number(sample.locationId) : sampleIndex;
                const target = batch[locationId];
                const height = Number(sample?.value);
                if (target && Number.isFinite(height)) {
                    target.height = height;
                }
            });
        } catch (error) {
            console.warn("ArcGIS contour sample request failed:", error);
            return false;
        }
    }
    return hasSampledContourHeights(samplePositions);
}
async function sampleContourTerrain(terrainProvider, samplePositions = []) {
    if (!Array.isArray(samplePositions) || !samplePositions.length) return false;
    const sampledTerrarium = await sampleTerrariumContourTerrain(samplePositions);
    if (sampledTerrarium) return true;
    if (!terrainProvider) return hasSampledContourHeights(samplePositions);
    if (terrainProvider.__warzoneProviderKind === "arcgis") {
        const sampledArcGis = await sampleArcGisContourTerrain(terrainProvider, samplePositions);
        return sampledArcGis;
    }
    if (typeof Cesium.sampleTerrain === "function") {
        try {
            await Cesium.sampleTerrain(terrainProvider, getContourTerrainSampleLevel(), samplePositions);
            return hasSampledContourHeights(samplePositions);
        } catch (error) {
            console.warn("Contour terrain sample failed:", error);
            return false;
        }
    }
    return hasSampledContourHeights(samplePositions);
}
function getContourFallbackCenter(viewer) {
    const canvas = viewer?.scene?.canvas;
    const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
    if (canvas && viewer?.camera) {
        try {
            const screenCenter = new Cesium.Cartesian2(
                Math.max(0, canvas.clientWidth * 0.5),
                Math.max(0, canvas.clientHeight * 0.5)
            );
            const picked = viewer.camera.pickEllipsoid(screenCenter, ellipsoid);
            if (picked) {
                const cartographic = ellipsoid.cartesianToCartographic(picked);
                if (cartographic) {
                    return {
                        lon: Cesium.Math.toDegrees(cartographic.longitude),
                        lat: Cesium.Math.toDegrees(cartographic.latitude),
                        height: Number(cartographic.height || 0),
                    };
                }
            }
        } catch { }
    }
    const cameraCartographic = viewer?.camera?.positionCartographic;
    if (cameraCartographic) {
        return {
            lon: Cesium.Math.toDegrees(cameraCartographic.longitude),
            lat: Cesium.Math.toDegrees(cameraCartographic.latitude),
            height: Number(cameraCartographic.height || 0),
        };
    }
    return null;
}
function clampContourBuildArea(area) {
    if (!area) return area;
    const maxSpanMeters = Math.max(120000, Math.min(1800000, numberVar("--warzone-contour-max-build-span", 650000)));
    const widthMeters = Number(area.widthMeters || 0);
    const heightMeters = Number(area.heightMeters || 0);
    if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters) || widthMeters <= 0 || heightMeters <= 0) return area;
    const scale = Math.min(1, maxSpanMeters / widthMeters, maxSpanMeters / heightMeters);
    if (scale >= 0.999) return area;
    const nextWidth = widthMeters * scale;
    const nextHeight = heightMeters * scale;
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(area.centerLat)) * latMeters);
    const halfLon = (nextWidth * 0.5) / lonMeters;
    const halfLat = (nextHeight * 0.5) / latMeters;
    return {
        minLon: area.centerLon - halfLon,
        maxLon: area.centerLon + halfLon,
        minLat: Math.max(-84, area.centerLat - halfLat),
        maxLat: Math.min(84, area.centerLat + halfLat),
        centerLon: area.centerLon,
        centerLat: area.centerLat,
        widthMeters: nextWidth,
        heightMeters: nextHeight,
        halfDiagonalMeters: Math.hypot(nextWidth, nextHeight) * 0.5,
    };
}
function getContourCenteredBuildArea(centerLon, centerLat, spanMeters = null) {
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(centerLat)) * latMeters);
    const span = Math.max(60000, Math.min(420000, Number(spanMeters ?? numberVar("--warzone-contour-local-span", 240000))));
    const halfLon = (span * 0.5) / lonMeters;
    const halfLat = (span * 0.5) / latMeters;
    return {
        minLon: centerLon - halfLon,
        maxLon: centerLon + halfLon,
        minLat: Math.max(-84, centerLat - halfLat),
        maxLat: Math.min(84, centerLat + halfLat),
        centerLon,
        centerLat,
        widthMeters: span,
        heightMeters: span,
        halfDiagonalMeters: Math.SQRT2 * span * 0.5,
    };
}
function getContourViewportBuildArea(viewer, centerLon, centerLat, options = {}) {
    const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
    const rect = viewer?.camera?.computeViewRectangle?.(ellipsoid);
    const latMeters = 111320;
    if (rect) {
        let west = Cesium.Math.toDegrees(rect.west);
        let east = Cesium.Math.toDegrees(rect.east);
        const south = Math.max(-84, Cesium.Math.toDegrees(rect.south));
        const north = Math.min(84, Cesium.Math.toDegrees(rect.north));
        if (east < west) east += 360;
        const latSpan = Math.max(0.01, north - south);
        const lonSpan = Math.max(0.01, east - west);
        const margin = Math.max(0.02, Math.min(0.18, numberVar("--warzone-contour-viewport-margin", 0.08)));
        const minLat = Math.max(-84, south - (latSpan * margin));
        const maxLat = Math.min(84, north + (latSpan * margin));
        const minLon = west - (lonSpan * margin);
        const maxLon = east + (lonSpan * margin);
        const midLat = (minLat + maxLat) * 0.5;
        const midLon = (minLon + maxLon) * 0.5;
        const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(midLat)) * latMeters);
        const widthMeters = Math.abs(maxLon - minLon) * lonMeters;
        const heightMeters = Math.abs(maxLat - minLat) * latMeters;
        if (Number.isFinite(widthMeters) && Number.isFinite(heightMeters) && widthMeters > 500 && heightMeters > 500) {
            const area = {
                minLon,
                maxLon,
                minLat,
                maxLat,
                centerLon: midLon,
                centerLat: midLat,
                widthMeters,
                heightMeters,
                halfDiagonalMeters: Math.hypot(widthMeters, heightMeters) * 0.5,
            };
            return options.clamp === false ? area : clampContourBuildArea(area);
        }
    }
    const { outerRadius } = getContourOverlayRadii();
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(centerLat)) * latMeters);
    const lonDelta = outerRadius / lonMeters;
    const latDelta = outerRadius / latMeters;
    const fallbackArea = {
        minLon: centerLon - lonDelta,
        maxLon: centerLon + lonDelta,
        minLat: Math.max(-84, centerLat - latDelta),
        maxLat: Math.min(84, centerLat + latDelta),
        centerLon,
        centerLat,
        widthMeters: outerRadius * 2,
        heightMeters: outerRadius * 2,
        halfDiagonalMeters: Math.SQRT2 * outerRadius,
    };
    return options.clamp === false ? fallbackArea : clampContourBuildArea(fallbackArea);
}
function getContourGridDimensions(area) {
    const base = getContourGridSampleSize();
    const aspect = Math.max(0.35, Math.min(3.5, Number(area?.widthMeters || 1) / Math.max(1, Number(area?.heightMeters || 1))));
    let cols = Math.round(base * Math.sqrt(aspect));
    let rows = Math.round(base / Math.sqrt(aspect));
    cols = Math.max(32, Math.min(112, cols));
    rows = Math.max(32, Math.min(112, rows));
    const maxSamples = Math.max(900, Math.min(5600, Math.round(numberVar("--warzone-contour-max-samples", 1800))));
    while ((cols + 1) * (rows + 1) > maxSamples && cols > 32 && rows > 32) {
        cols = Math.max(32, Math.floor(cols * 0.94));
        rows = Math.max(32, Math.floor(rows * 0.94));
    }
    return { rows, cols };
}
function smoothContourGridHeights(grid, passes = 1) {
    if (!Array.isArray(grid) || grid.length < 3 || !Array.isArray(grid[0]) || grid[0].length < 3) return;
    const totalPasses = Math.max(0, Math.min(5, Math.round(Number(passes || 0))));
    for (let pass = 0; pass < totalPasses; pass += 1) {
        const nextHeights = grid.map((row) => row.map((point) => Number(point?.height)));
        for (let row = 1; row < grid.length - 1; row += 1) {
            for (let col = 1; col < grid[row].length - 1; col += 1) {
                let total = 0;
                let weight = 0;
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (let dx = -1; dx <= 1; dx += 1) {
                        const height = Number(grid[row + dy]?.[col + dx]?.height);
                        if (!Number.isFinite(height)) continue;
                        const sampleWeight = dx === 0 && dy === 0 ? 3 : 1;
                        total += height * sampleWeight;
                        weight += sampleWeight;
                    }
                }
                if (weight > 0) nextHeights[row][col] = total / weight;
            }
        }
        grid.forEach((rowPoints, row) => {
            rowPoints.forEach((point, col) => {
                const height = Number(nextHeights[row]?.[col]);
                if (Number.isFinite(height)) point.height = height;
            });
        });
    }
}
function getContourGridHeightRange(grid) {
    let minHeight = Number.POSITIVE_INFINITY;
    let maxHeight = Number.NEGATIVE_INFINITY;
    grid.forEach((rowPoints) => {
        rowPoints.forEach((point) => {
            const height = Number(point?.height);
            if (!Number.isFinite(height)) return;
            minHeight = Math.min(minHeight, height);
            maxHeight = Math.max(maxHeight, height);
        });
    });
    return { minHeight, maxHeight };
}
function ensureContourGridCoordinates(grid) {
    if (!Array.isArray(grid)) return;
    grid.forEach((rowPoints) => {
        rowPoints.forEach((point) => {
            if (!Number.isFinite(point.lon)) point.lon = Cesium.Math.toDegrees(point.longitude);
            if (!Number.isFinite(point.lat)) point.lat = Cesium.Math.toDegrees(point.latitude);
        });
    });
}
function getContourLevels(minHeight, maxHeight, area = null) {
    const relief = Math.max(0, maxHeight - minHeight);
    if (!Number.isFinite(relief) || relief < 0.6) return [];
    const configuredSpacing = Math.max(4, Math.min(280, numberVar("--warzone-live-aircraft-contour-spacing", 70)));
    const targetLineCount = Math.max(10, Math.min(34, Math.round(numberVar("--warzone-contour-target-lines", 28))));
    const adaptiveSpacing = Math.max(1, relief / targetLineCount);
    const diagonalKm = Math.max(0, Number(area?.halfDiagonalMeters || 0) / 1000);
    const scaleSpacing = diagonalKm > 800
        ? 120
        : diagonalKm > 480
            ? 80
            : diagonalKm > 260
                ? 45
                : diagonalKm > 140
                    ? 28
                    : 14;
    const step = Math.max(1, Math.min(320, Math.max(configuredSpacing, adaptiveSpacing, scaleSpacing)));
    const start = Math.ceil(minHeight / step) * step;
    const end = Math.floor(maxHeight / step) * step;
    const levels = [];
    for (let level = start; level <= end; level += step) {
        levels.push(Math.round(level * 10) / 10);
        if (levels.length >= targetLineCount + 4) break;
    }
    if (!levels.length && relief >= 0.6) {
        const fallbackStep = Math.max(0.5, relief / 6);
        for (let level = minHeight + fallbackStep; level < maxHeight; level += fallbackStep) {
            levels.push(Math.round(level * 10) / 10);
            if (levels.length >= 8) break;
        }
    }
    return levels;
}
function destroyContourGridPrimitive(viewer) {
    const state = getContourOverlayState(viewer);
    const primitive = state?.gridPrimitive;
    if (!primitive) return;
    try {
        viewer?.scene?.primitives?.remove?.(primitive);
    } catch { }
    state.gridPrimitive = null;
}
function updateContourGridPrimitiveCenter(viewer, position = null) {
    const state = getContourOverlayState(viewer);
    const primitive = state?.gridPrimitive;
    const lon = Number(position?.lon ?? state?.gridCenterLon ?? state?.centerLon);
    const lat = Number(position?.lat ?? state?.gridCenterLat ?? state?.centerLat);
    if (!primitive || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    state.gridCenterLon = lon;
    state.gridCenterLat = lat;
    const heightOffset = Math.max(8, numberVar("--warzone-contour-grid-height-offset", 70));
    primitive.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(lon, lat, heightOffset)
    );
    primitive.show = viewer.__contourGridLayerVisible === true;
    viewer.scene?.requestRender?.();
    return true;
}
function ensureContourGridPrimitive(viewer, center = null, options = {}) {
    if (!viewer?.scene?.primitives || boolVar("--warzone-contour-grid-enabled", true) !== true) return 0;
    const state = getContourOverlayState(viewer);
    if (!state) return 0;
    if (options.force === true) destroyContourGridPrimitive(viewer);
    if (state.gridPrimitive) {
        updateContourGridPrimitiveCenter(viewer, center);
        return Number(state.gridPrimitive.length || 0);
    }
    const rows = Math.max(3, Math.min(18, Math.round(numberVar("--warzone-contour-grid-rows", 10))));
    const cols = Math.max(3, Math.min(18, Math.round(numberVar("--warzone-contour-grid-cols", 10))));
    const gridColorVar = "--warzone-contour-grid-color";
    const gridAlphaVar = "--warzone-contour-grid-alpha";
    const gridMajorAlphaVar = "--warzone-contour-grid-major-alpha";
    const gridWidthVar = "--warzone-contour-grid-width";
    const color = colorFromCssVar(gridColorVar, "#18f4ff", 1);
    const alpha = clamp01(numberVar(gridAlphaVar, 0.16));
    const majorAlpha = clamp01(numberVar(gridMajorAlphaVar, 0.24));
    const width = Math.max(0.35, Math.min(2.4, numberVar(gridWidthVar, 0.62)));
    const majorEvery = Math.max(2, Math.round(numberVar("--warzone-contour-grid-major-every", 4)));
    const radius = Math.max(5000, Math.min(80000, numberVar("--warzone-contour-grid-radius", 30000)));
    const fadeStart = Math.max(0, Math.min(radius - 500, numberVar("--warzone-contour-grid-fade-start", 24000)));
    const segments = Math.max(6, Math.min(18, Math.round(numberVar("--warzone-contour-grid-fade-segments", 10))));
    const collection = new Cesium.PolylineCollection();
    const addSegmentedLine = (fixedOffset, horizontal, major = false) => {
        const halfLength = Math.sqrt(Math.max(0, (radius * radius) - (fixedOffset * fixedOffset)));
        if (halfLength <= 1) return;
        const baseAlpha = major ? majorAlpha : alpha;
        for (let segment = 0; segment < segments; segment += 1) {
            const start = lerp(-halfLength, halfLength, segment / segments);
            const end = lerp(-halfLength, halfLength, (segment + 1) / segments);
            const midpoint = (start + end) * 0.5;
            const distance = Math.hypot(fixedOffset, midpoint);
            const fadeT = distance <= fadeStart
                ? 0
                : (distance - fadeStart) / Math.max(1, radius - fadeStart);
            const fade = Math.max(0, 1 - smoothContourFade(fadeT));
            if (fade <= 0.015) continue;
            const startPosition = horizontal
                ? new Cesium.Cartesian3(start, fixedOffset, 0)
                : new Cesium.Cartesian3(fixedOffset, start, 0);
            const endPosition = horizontal
                ? new Cesium.Cartesian3(end, fixedOffset, 0)
                : new Cesium.Cartesian3(fixedOffset, end, 0);
            collection.add({
                positions: [startPosition, endPosition],
                width: major ? width * 1.35 : width,
                material: Cesium.Material.fromType("Color", {
                    color: color.withAlpha(baseAlpha * fade),
                }),
            });
        }
    };
    for (let row = 0; row <= rows; row += 1) {
        const y = lerp(-radius, radius, row / rows);
        addSegmentedLine(y, true, row % majorEvery === 0);
    }
    for (let col = 0; col <= cols; col += 1) {
        const x = lerp(-radius, radius, col / cols);
        addSegmentedLine(x, false, col % majorEvery === 0);
    }
    state.gridPrimitive = viewer.scene.primitives.add(collection);
    updateContourGridPrimitiveCenter(viewer, center);
    return Number(collection.length || 0);
}
function smoothContourPolyline(points = [], passes = 1) {
    if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
    let result = points.slice();
    const totalPasses = Math.max(0, Math.min(3, Number(passes || 0)));
    for (let pass = 0; pass < totalPasses; pass += 1) {
        if (result.length < 3) break;
        const next = [result[0]];
        for (let index = 0; index < result.length - 1; index += 1) {
            const current = result[index];
            const following = result[index + 1];
            next.push({
                lon: lerp(current.lon, following.lon, 0.25),
                lat: lerp(current.lat, following.lat, 0.25),
                height: lerp(current.height, following.height, 0.25),
            });
            next.push({
                lon: lerp(current.lon, following.lon, 0.75),
                lat: lerp(current.lat, following.lat, 0.75),
                height: lerp(current.height, following.height, 0.75),
            });
        }
        next.push(result[result.length - 1]);
        if (next.length >= 3) {
            const relaxed = [next[0]];
            for (let index = 1; index < next.length - 1; index += 1) {
                const previous = next[index - 1];
                const current = next[index];
                const following = next[index + 1];
                const avgLon = (previous.lon + current.lon + following.lon) / 3;
                const avgLat = (previous.lat + current.lat + following.lat) / 3;
                const avgHeight = (previous.height + current.height + following.height) / 3;
                relaxed.push({
                    lon: lerp(current.lon, avgLon, 0.18),
                    lat: lerp(current.lat, avgLat, 0.18),
                    height: lerp(current.height, avgHeight, 0.18),
                });
            }
            relaxed.push(next[next.length - 1]);
            result = relaxed;
        } else {
            result = next;
        }
    }
    return result;
}
function joinContourSegments(segments = []) {
    const quantize = (point) => `${Math.round(point.lon * 10000)}:${Math.round(point.lat * 10000)}`;
    const adjacency = new Map();
    const used = new Array(segments.length).fill(false);
    segments.forEach((segment, index) => {
        [segment.a, segment.b].forEach((point, endpoint) => {
            const key = quantize(point);
            if (!adjacency.has(key)) adjacency.set(key, []);
            adjacency.get(key).push({ index, endpoint });
        });
    });
    const chains = [];
    const appendConnected = (points, forward = true) => {
        let keepWalking = true;
        while (keepWalking) {
            keepWalking = false;
            const edgePoint = forward ? points[points.length - 1] : points[0];
            const key = quantize(edgePoint);
            const candidates = adjacency.get(key) || [];
            for (const candidate of candidates) {
                if (used[candidate.index]) continue;
                used[candidate.index] = true;
                const segment = segments[candidate.index];
                const nextPoint = candidate.endpoint === 0 ? segment.b : segment.a;
                if (forward) points.push(nextPoint);
                else points.unshift(nextPoint);
                keepWalking = true;
                break;
            }
        }
    };
    segments.forEach((segment, index) => {
        if (used[index]) return;
        used[index] = true;
        const points = [segment.a, segment.b];
        appendConnected(points, true);
        appendConnected(points, false);
        chains.push(points);
    });
    return chains;
}
function buildContourSegments(grid, level) {
    const segments = [];
    const rows = grid.length - 1;
    const cols = grid[0]?.length - 1 || 0;
    const interpolateEdge = (a, b, fallbackHeight = level) => {
        const delta = b.height - a.height;
        const t = Math.abs(delta) < 1e-6 ? 0.5 : clamp01((level - a.height) / delta);
        return {
            lon: lerp(a.lon, b.lon, t),
            lat: lerp(a.lat, b.lat, t),
            height: fallbackHeight,
        };
    };
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const topLeft = grid[row][col];
            const topRight = grid[row][col + 1];
            const bottomRight = grid[row + 1][col + 1];
            const bottomLeft = grid[row + 1][col];
            const edges = [];
            if ((topLeft.height >= level) !== (topRight.height >= level)) edges.push(interpolateEdge(topLeft, topRight));
            if ((topRight.height >= level) !== (bottomRight.height >= level)) edges.push(interpolateEdge(topRight, bottomRight));
            if ((bottomRight.height >= level) !== (bottomLeft.height >= level)) edges.push(interpolateEdge(bottomRight, bottomLeft));
            if ((bottomLeft.height >= level) !== (topLeft.height >= level)) edges.push(interpolateEdge(bottomLeft, topLeft));
            if (edges.length === 2) {
                segments.push({ a: edges[0], b: edges[1] });
            } else if (edges.length === 4) {
                const averageHeight = (topLeft.height + topRight.height + bottomRight.height + bottomLeft.height) * 0.25;
                if (averageHeight >= level) {
                    segments.push({ a: edges[0], b: edges[1] });
                    segments.push({ a: edges[2], b: edges[3] });
                } else {
                    segments.push({ a: edges[0], b: edges[3] });
                    segments.push({ a: edges[1], b: edges[2] });
                }
            }
        }
    }
    return segments;
}
async function buildContourOverlay(viewer, options = {}) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    if (state.buildPromise) {
        state.buildQueued = true;
        state.buildQueuedForce = state.buildQueuedForce || options.force === true;
        state.buildQueuedReason = options.reason || state.buildQueuedReason;
        return state.buildPromise;
    }
    state.buildPromise = (async () => {
        const buildToken = state.buildToken;
        const contourVisible = viewer.__contourLayerVisible === true;
        const gridVisible = viewer.__contourGridLayerVisible === true;
        const visible = contourVisible || gridVisible;
        if (!visible) {
            clearContourOverlay(viewer);
            return false;
        }
        if (!Number.isFinite(state.centerLon) || !Number.isFinite(state.centerLat)) {
        const fallbackCenter = getContourFallbackCenter(viewer);
        if (fallbackCenter) {
            state.centerLon = fallbackCenter.lon;
            state.centerLat = fallbackCenter.lat;
            state.centerHeight = fallbackCenter.height;
            state.hasFocusPosition = false;
        }
        }
        if (!Number.isFinite(state.centerLon) || !Number.isFinite(state.centerLat)) {
            clearContourOverlay(viewer);
            return false;
        }
        const centerLon = state.centerLon;
        const centerLat = state.centerLat;
        const refreshDistance = Math.max(900, numberVar("--warzone-contour-refresh-distance", 2400));
        if (
            options.force !== true &&
            contourDistanceMeters(centerLon, centerLat, state.lastBuiltLon, state.lastBuiltLat) < refreshDistance &&
            (Date.now() - state.lastBuiltAt) < 550
        ) {
            return false;
        }
        const dataSource = await ensureContourOverlayDataSource(viewer);
        if (!isContourBuildCurrent(viewer, state, buildToken)) return false;
        const terrainProvider = state.terrainProvider || null;
        const area = state.hasFocusPosition === true
            ? getContourCenteredBuildArea(centerLon, centerLat)
            : clampContourBuildArea(getContourViewportBuildArea(
                viewer,
                centerLon,
                centerLat,
                {
                    centerHeight: state.centerHeight,
                    clamp: false,
                }
            ));
        const gridDimensions = getContourGridDimensions(area);
        const grid = [];
        const samplePositions = [];
        for (let row = 0; row <= gridDimensions.rows; row += 1) {
            const rowPoints = [];
            const lat = lerp(area.minLat, area.maxLat, row / Math.max(1, gridDimensions.rows));
            for (let col = 0; col <= gridDimensions.cols; col += 1) {
                const lon = lerp(area.minLon, area.maxLon, col / Math.max(1, gridDimensions.cols));
                const sample = Cesium.Cartographic.fromDegrees(lon, lat, 0);
                samplePositions.push(sample);
                rowPoints.push(sample);
            }
            grid.push(rowPoints);
        }
        const contourColorVar = "--warzone-live-aircraft-contour-color";
        const contourLineWidthVar = "--warzone-contour-line-width";
        const contourHaloAlphaVar = "--warzone-contour-halo-alpha";
        const contourHaloWidthVar = "--warzone-contour-halo-width";
        const color = colorFromCssVar(contourColorVar, "#18e2db", 1);
        const baseAlpha = clamp01(numberVar("--warzone-live-aircraft-contour-alpha", 0.34));
        const minAlpha = clamp01(numberVar("--warzone-live-aircraft-contour-min-alpha", 0.012));
        const lineWidth = Math.max(0.55, numberVar(contourLineWidthVar, 1.35));
        const haloAlpha = Math.max(0.02, clamp01(numberVar(contourHaloAlphaVar, 0.16)));
        const majorEvery = Math.max(2, Math.round(numberVar("--warzone-live-aircraft-contour-major-every", 5)));
        const majorWidthScale = Math.max(1, numberVar("--warzone-live-aircraft-contour-major-width-scale", 1.65));
        const elevationWidthScale = Math.max(0, numberVar("--warzone-contour-elevation-width-scale", 0.28));
        const haloWidth = Math.max(0, numberVar(contourHaloWidthVar, 4.6));
        const heightOffset = Math.max(8, numberVar("--warzone-contour-height-offset", 95));
        const smoothingPasses = Math.max(0, Math.min(3, Math.round(numberVar("--warzone-contour-smoothing-passes", 2))));
        const maxLines = Math.max(120, Math.min(700, Math.round(numberVar("--warzone-contour-max-lines", 520))));
        state.clearToken += 1;
        if (state.clearTimer) {
            clearTimeout(state.clearTimer);
            state.clearTimer = 0;
        }
        const gridLineCount = gridVisible
            ? ensureContourGridPrimitive(viewer, {
                lon: Number.isFinite(state.gridCenterLon) ? state.gridCenterLon : centerLon,
                lat: Number.isFinite(state.gridCenterLat) ? state.gridCenterLat : centerLat,
            })
            : 0;
        if (state.gridPrimitive) state.gridPrimitive.show = gridVisible;
        if (!contourVisible) {
            dataSource.entities.removeAll();
            dataSource.show = false;
            state.hasVisibleContours = false;
            state.lastBuiltLon = centerLon;
            state.lastBuiltLat = centerLat;
            state.lastBuiltAt = Date.now();
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return gridLineCount > 0;
        }
        const sampled = await sampleContourTerrain(terrainProvider, samplePositions);
        if (!isContourBuildCurrent(viewer, state, buildToken)) return false;
        const validSampleHeights = samplePositions
            .map((position) => Number(position?.height))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        const hasRealSamples = sampled && validSampleHeights.length >= 24 && (validSampleHeights.length / samplePositions.length) >= 0.08;
        const fillHeight = validSampleHeights[Math.floor(validSampleHeights.length * 0.5)] || 0;
        grid.forEach((rowPoints) => {
            rowPoints.forEach((point) => {
                const height = Number(point?.height);
                point.height = hasRealSamples && Number.isFinite(height) ? height : fillHeight;
                point.lon = Cesium.Math.toDegrees(point.longitude);
                point.lat = Cesium.Math.toDegrees(point.latitude);
            });
        });
        if (!hasRealSamples) {
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return gridLineCount > 0 || state.hasVisibleContours === true;
        }
        smoothContourGridHeights(grid, numberVar("--warzone-contour-height-smoothing-passes", 3));
        let { minHeight, maxHeight } = getContourGridHeightRange(grid);
        let levels = getContourLevels(minHeight, maxHeight, area);
        if (!levels.length) {
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return gridLineCount > 0 || state.hasVisibleContours === true;
        }
        const { strongRadius, outerRadius } = getContourOverlayRadii();
        const contourStrongRadius = Math.max(strongRadius, Number(area?.halfDiagonalMeters || 0));
        const contourOuterRadius = Math.max(outerRadius, contourStrongRadius + 1000);
        const reliefRange = Math.max(1, maxHeight - minHeight);
        let lineCount = 0;
        const pendingContourEntities = [];
        levels.forEach((level, levelIndex) => {
            if (lineCount >= maxLines) return;
            const segments = buildContourSegments(grid, level);
            const chains = joinContourSegments(segments);
            const isMajor = levelIndex % majorEvery === 0 || levelIndex === 0 || levelIndex === levels.length - 1;
            const elevationT = clamp01((level - minHeight) / reliefRange);
            const widthScale = (1 + (elevationT * elevationWidthScale)) * (isMajor ? majorWidthScale : 1);
            chains.forEach((chain, chainIndex) => {
                if (lineCount >= maxLines) return;
                if (!Array.isArray(chain) || chain.length < 2) return;
                const smoothed = smoothContourPolyline(chain, smoothingPasses);
                const alphaScale = getContourChainAlphaScale(
                    smoothed,
                    centerLon,
                    centerLat,
                    contourStrongRadius,
                    contourOuterRadius
                );
                if (alphaScale <= 0.001) return;
                const chainAlpha = Math.max(minAlpha, (isMajor ? Math.min(0.88, baseAlpha * 1.35) : Math.min(0.72, baseAlpha * 1.12)) * alphaScale);
                const positions = smoothed.map((point) => Cesium.Cartesian3.fromDegrees(
                    point.lon,
                    point.lat,
                    Math.max(heightOffset, point.height + heightOffset)
                ));
                if (haloWidth > 0) {
                    pendingContourEntities.push({
                        id: `contour-halo-${Math.round(level)}-${chainIndex}`,
                        polyline: {
                            positions,
                            width: (lineWidth * widthScale) + haloWidth,
                            clampToGround: false,
                            arcType: Cesium.ArcType.GEODESIC,
                            material: new Cesium.PolylineGlowMaterialProperty({
                                glowPower: Math.min(0.95, (isMajor ? haloAlpha * 1.55 : haloAlpha * 1.25) * Math.max(0.45, alphaScale)),
                                taperPower: 0.55,
                                color: color.withAlpha(Math.min(0.58, chainAlpha * haloAlpha * (isMajor ? 1.25 : 0.9))),
                            }),
                        },
                    });
                }
                const mainMaterial = new Cesium.PolylineGlowMaterialProperty({
                    glowPower: Math.min(
                        0.24,
                        (state.hasFocusPosition === true ? 0.07 : 0.04) +
                        ((isMajor ? 0.055 : 0.03) * Math.max(0.5, alphaScale))
                    ),
                    taperPower: state.hasFocusPosition === true ? 0.82 : 0.68,
                    color: color.withAlpha(chainAlpha),
                });
                pendingContourEntities.push({
                    id: `contour-${Math.round(level)}-${chainIndex}`,
                    polyline: {
                        positions,
                        width: lineWidth * widthScale,
                        clampToGround: false,
                        arcType: Cesium.ArcType.GEODESIC,
                        material: mainMaterial,
                    },
                });
                lineCount += 1;
            });
        });
        if (!isContourBuildCurrent(viewer, state, buildToken)) return false;
        if (lineCount <= 0 && gridLineCount <= 0) {
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return state.hasVisibleContours === true;
        }
        dataSource.entities.removeAll();
        pendingContourEntities.forEach((entityDefinition) => dataSource.entities.add(entityDefinition));
        state.hasVisibleContours = lineCount > 0;
        dataSource.show = lineCount > 0;
        state.lastBuiltLon = centerLon;
        state.lastBuiltLat = centerLat;
        state.lastBuiltAt = Date.now();
        applyContourLayerState(viewer);
        applyRenderedTerrainVisibility(viewer);
        viewer.scene.requestRender?.();
        return true;
    })()
        .catch((error) => {
            console.warn("Contour overlay build failed:", error);
            if (!state.lastBuiltAt) clearContourOverlay(viewer);
            return false;
        })
        .finally(() => {
            state.buildPromise = null;
            if (state.buildQueued) {
                const queuedForce = state.buildQueuedForce;
                const queuedReason = state.buildQueuedReason;
                state.buildQueued = false;
                state.buildQueuedForce = false;
                state.buildQueuedReason = "";
                void buildContourOverlay(viewer, {
                    force: queuedForce,
                    reason: queuedReason || "queued-refresh",
                });
            }
        });
    return state.buildPromise;
}
function queueContourOverlayBuild(viewer, options = {}) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    if (state.buildTimer) {
        clearTimeout(state.buildTimer);
        state.buildTimer = 0;
    }
    const delayMs = Math.max(60, Math.min(260, Math.round(Number(options.delayMs || 140))));
    state.buildTimer = window.setTimeout(() => {
        state.buildTimer = 0;
        void buildContourOverlay(viewer, {
            force: options.force === true,
            reason: options.reason || "queued-build",
        });
    }, delayMs);
    return true;
}
function setContourFocusPosition(viewer, position = null, options = {}) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    const lon = Number(position?.lon);
    const lat = Number(position?.lat);
    const height = Number(position?.height || 0);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        state.centerLon = Number.NaN;
        state.centerLat = Number.NaN;
        state.centerHeight = 0;
        state.hasFocusPosition = false;
        clearContourOverlay(viewer);
        return false;
    }
    state.centerLon = lon;
    state.centerLat = lat;
    state.centerHeight = Number.isFinite(height) ? height : 0;
    state.hasFocusPosition = true;
    setContourGridCenter(viewer, { lon, lat, height: state.centerHeight });
    state.buildToken += 1;
    if (viewer.__contourLayerVisible === true) {
        queueContourOverlayBuild(viewer, {
            force: options.force === true,
            reason: options.reason || "focus-position-update",
            delayMs: options.delayMs || 120,
        });
    }
    return true;
}
function clearContourFocusPosition(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return;
    if (state.buildTimer) {
        clearTimeout(state.buildTimer);
        state.buildTimer = 0;
    }
    state.centerLon = Number.NaN;
    state.centerLat = Number.NaN;
    state.centerHeight = 0;
    state.hasFocusPosition = false;
    state.gridCenterLon = Number.NaN;
    state.gridCenterLat = Number.NaN;
    const fallbackCenter = getContourFallbackCenter(viewer);
    if (fallbackCenter) setContourGridCenter(viewer, fallbackCenter);
    state.buildToken += 1;
    clearContourOverlayDeferred(viewer);
}

function setContourGridCenter(viewer, position = null) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    const lon = Number(position?.lon);
    const lat = Number(position?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    state.gridCenterLon = lon;
    state.gridCenterLat = lat;
    if (!state.gridPrimitive && viewer.__contourGridLayerVisible === true) {
        ensureContourGridPrimitive(viewer, { lon, lat });
        return !!state.gridPrimitive;
    }
    return updateContourGridPrimitiveCenter(viewer, { lon, lat });
}
function refreshContourFromViewport(viewer, options = {}) {
    const state = getContourOverlayState(viewer);
    const center = getContourFallbackCenter(viewer);
    if (!state || !center) return false;
    state.centerLon = center.lon;
    state.centerLat = center.lat;
    state.centerHeight = Number.isFinite(center.height) ? center.height : 0;
    state.hasFocusPosition = false;
    setContourGridCenter(viewer, center);
    state.buildToken += 1;
    if (viewer.__contourLayerVisible === true) {
        queueContourOverlayBuild(viewer, {
            force: options.force === true,
            reason: options.reason || "viewport-contour-refresh",
            delayMs: options.delayMs || 120,
        });
    }
    viewer.scene?.requestRender?.();
    return true;
}
function bindContourViewportRefresh(viewer) {
    if (!viewer?.camera || viewer.__warzoneContourViewportRefreshBound) return;
    viewer.__warzoneContourViewportRefreshBound = true;
    let refreshTimer = 0;
    const queueRefresh = (delayMs = 260) => {
        if (viewer.__contourLayerVisible !== true) return;
        const contourState = getContourOverlayState(viewer);
        if (contourState?.hasFocusPosition === true) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
            refreshTimer = 0;
            if (viewer.__contourLayerVisible !== true) return;
            const activeContourState = getContourOverlayState(viewer);
            if (activeContourState?.hasFocusPosition === true) return;
            refreshContourFromViewport(viewer, {
                force: false,
                reason: "camera-move-contour-refresh",
            });
        }, Math.max(160, Math.min(900, Number(delayMs || 260))));
    };
    viewer.camera.moveEnd.addEventListener(() => queueRefresh(260));
}
function dispatchContourLayerChanged(viewer) {
    document.dispatchEvent(new CustomEvent("wz:contour-layer-changed", {
        detail: {
            visible: viewer?.__contourLayerVisible === true,
        },
    }));
}
function dispatchFocusedTerrainChanged(viewer) {
    document.dispatchEvent(new CustomEvent("wz:focused-terrain-changed", {
        detail: {
            visible: viewer?.__warzoneFocusedTerrainActive === true,
        },
    }));
}
async function setContourLayerVisible(viewer, visible = false) {
    if (!viewer) return false;
    viewer.__contourLayerVisible = !!visible;
    if (viewer.__contourLayerVisible) retainContourDemCache();
    applyRenderedTerrainVisibility(viewer);
    if (viewer.__contourLayerVisible) {
        const state = getContourOverlayState(viewer);
        if (!Number.isFinite(state?.centerLon) || !Number.isFinite(state?.centerLat)) {
            const fallbackCenter = getContourFallbackCenter(viewer);
            if (fallbackCenter) {
                state.centerLon = fallbackCenter.lon;
                state.centerLat = fallbackCenter.lat;
                state.centerHeight = fallbackCenter.height;
                state.hasFocusPosition = false;
            }
        }
        if (!Number.isFinite(state?.centerLon) || !Number.isFinite(state?.centerLat)) {
            viewer.__contourLayerVisible = false;
            clearContourOverlay(viewer);
            applyRenderedTerrainVisibility(viewer);
            applyContourLayerState(viewer);
            dispatchContourLayerChanged(viewer);
            return false;
        }
        state.buildToken += 1;
        applyRenderedTerrainVisibility(viewer);
        queueContourOverlayBuild(viewer, {
            force: true,
            reason: "toggle-on",
            delayMs: 90,
        });
    } else {
        const state = getContourOverlayState(viewer);
        if (state) state.buildToken += 1;
        if (viewer.__contourGridLayerVisible === true) {
            queueContourOverlayBuild(viewer, {
                force: true,
                reason: "contour-off-grid-on",
                delayMs: 40,
            });
        } else {
            clearContourOverlay(viewer);
            scheduleContourDemCacheRelease(viewer);
        }
    }
    applyContourLayerState(viewer);
    applyRenderedTerrainVisibility(viewer);
    dispatchContourLayerChanged(viewer);
    viewer.scene?.requestRender?.();
    return viewer.__contourLayerVisible === true;
}
/* ---------- Map mode ---------- */
function normalizeSceneMode(mode = "") {
    const raw = String(mode || "").trim().toLowerCase();
    if (raw === "2d" || raw === "flat") return "2d";
    if (raw === "3d" || raw === "globe") return "3d";
    return "";
}
function getSceneMode(viewer) {
    if (!viewer?.scene) return "3d";
    const sceneMode = viewer.scene.mode;
    if (sceneMode === Cesium.SceneMode.SCENE2D) return "2d";
    if (sceneMode === Cesium.SceneMode.MORPHING) {
        return normalizeSceneMode(viewer.__warzoneSceneTransitionTarget || viewer.__warzoneSceneMode) || "3d";
    }
    return "3d";
}
function isInteractiveSceneModeSource(source = "") {
    const value = String(source || "").trim().toLowerCase();
    return value === "manual" || value === "map-mode" || value === "ui";
}
function startSceneModeTransitionLoader(viewer, durationSeconds = 1.2) {
    if (typeof window === "undefined") return () => {};
    const token = Symbol("warzone-scene-mode-loader");
    const previousKeepVisible = window.__wzKeepSiteLoaderVisible === true;
    const previousKeepUntil = Number(window.__wzKeepSiteLoaderVisibleUntil || 0);
    const holdMs = Math.max(2400, Math.min(7200, Math.round(Number(durationSeconds || 0) * 1000) + 2800));
    viewer.__warzoneSceneModeLoaderToken = token;
    window.__wzKeepSiteLoaderVisible = true;
    window.__wzKeepSiteLoaderVisibleUntil = Date.now() + holdMs;
    window.SiteLoader?.start?.();
    return () => {
        if (viewer.__warzoneSceneModeLoaderToken !== token) return;
        delete viewer.__warzoneSceneModeLoaderToken;
        const shouldRestoreKeep = previousKeepVisible && previousKeepUntil > Date.now();
        window.__wzKeepSiteLoaderVisible = shouldRestoreKeep;
        window.__wzKeepSiteLoaderVisibleUntil = shouldRestoreKeep ? previousKeepUntil : 0;
        window.SiteLoader?.stop?.();
    };
}
function setSceneMode(viewer, mode = "3d", options = {}) {
    if (!viewer?.scene) return "3d";
    const nextMode = normalizeSceneMode(mode);
    if (!nextMode) return getSceneMode(viewer);
    const source = String(options?.source || "system");
    const interactiveTransition = isInteractiveSceneModeSource(source);
    const isMorphing = viewer.scene.mode === Cesium.SceneMode.MORPHING;
    if (isMorphing) {
        const transitionTarget = normalizeSceneMode(viewer.__warzoneSceneTransitionTarget);
        if (interactiveTransition) {
            viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + 9000;
        }
        return transitionTarget || normalizeSceneMode(viewer.__warzoneSceneMode) || getSceneMode(viewer);
    }
    if (viewer.__warzoneSceneModeTransitionActive === true) {
        const transitionTarget = normalizeSceneMode(viewer.__warzoneSceneTransitionTarget);
        if (interactiveTransition) {
            viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + 9000;
        }
        return transitionTarget || getSceneMode(viewer);
    }
    const currentMode = getSceneMode(viewer);
    if (currentMode === nextMode) {
        viewer.__warzoneSceneMode = currentMode;
        if (interactiveTransition) {
            viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + 8000;
            document.dispatchEvent(new CustomEvent("wz:scene-mode-refocus-requested", {
                detail: { mode: nextMode, source },
            }));
        }
        return currentMode;
    }
    const requestedDuration = Number(options?.duration);
    const defaultDuration = Math.max(0.2, Math.min(numberVar("--warzone-scene-morph-duration", 1.15), 3));
    const baseDuration = Number.isFinite(requestedDuration)
        ? Math.max(0, Math.min(requestedDuration, 3))
        : defaultDuration;
    const minInteractiveDuration = interactiveTransition
        ? Math.max(0.85, Math.min(numberVar("--warzone-scene-interactive-min-duration", 1.15), 2.4))
        : 0;
    const duration = Math.max(baseDuration, minInteractiveDuration);
    const stopLoader = interactiveTransition
        ? startSceneModeTransitionLoader(viewer, duration)
        : null;
    if (interactiveTransition) {
        viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + Math.max(8000, Math.round(duration * 1000) + 5200);
    }
    let finalizeTimer = 0;
    let finalized = false;
    let removeMorphComplete = null;
    const finalizeSceneTransition = () => {
        if (finalized) return;
        finalized = true;
        if (finalizeTimer) {
            clearTimeout(finalizeTimer);
            finalizeTimer = 0;
        }
        if (typeof removeMorphComplete === "function") {
            removeMorphComplete();
            removeMorphComplete = null;
        }
        viewer.__warzoneSceneMode = nextMode;
        viewer.__warzoneSceneTransitionTarget = null;
        viewer.__warzoneSceneModeTransitionActive = false;
        syncSceneModeBounds(viewer);
        stopLoader?.();
        if (interactiveTransition) {
            document.dispatchEvent(new CustomEvent("wz:scene-mode-refocus-requested", {
                detail: { mode: nextMode, source },
            }));
        }
        viewer.scene.requestRender?.();
    };
    try {
        viewer.__warzoneSceneTransitionTarget = nextMode;
        viewer.__warzoneSceneModeTransitionActive = true;
        removeMorphComplete = viewer.scene.morphComplete?.addEventListener?.(finalizeSceneTransition) || null;
        finalizeTimer = window.setTimeout(finalizeSceneTransition, Math.max(900, Math.round(duration * 1000) + 1200));
        if (nextMode === "2d") {
            viewer.scene.morphTo2D(duration);
        } else {
            viewer.scene.morphTo3D(duration);
        }
    } catch {
        if (finalizeTimer) clearTimeout(finalizeTimer);
        if (typeof removeMorphComplete === "function") removeMorphComplete();
        viewer.__warzoneSceneTransitionTarget = null;
        viewer.__warzoneSceneModeTransitionActive = false;
        stopLoader?.();
        return currentMode;
    }
    viewer.__warzoneSceneMode = nextMode;
    document.dispatchEvent(new CustomEvent("wz:scene-mode-changed", {
        detail: {
            mode: nextMode,
            source,
        },
    }));
    viewer.scene.requestRender();
    return nextMode;
}
function setMapMode(viewer, mode = "map") {
    const sceneMode = normalizeSceneMode(mode);
    if (sceneMode) {
        return setSceneMode(viewer, sceneMode, { source: "map-mode" });
    }
    viewer.__warzoneMapMode = mode;
    applyEventLod(viewer);
    return viewer.__warzoneMapMode;
}
/* ---------- Missile geometry ---------- */
function buildArcState(originLon, originLat, impactLon, impactLat, peakHeight = 420000, steps = 96) {
    const positions = [];
    const samples = [];
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const lon = lerp(originLon, impactLon, t);
        const lat = lerp(originLat, impactLat, t);
        const arc = Math.sin(Math.PI * t);
        const height = arc * peakHeight;
        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, height);
        positions.push(cart);
        samples.push({ t, lon, lat, height, cart });
    }
    return { positions, samples };
}
function interpolateSample(samples, t) {
    const clamped = clamp01(t);
    if (clamped <= 0) return samples[0];
    if (clamped >= 1) return samples[samples.length - 1];
    const maxIndex = samples.length - 1;
    const scaled = clamped * maxIndex;
    const i0 = Math.floor(scaled);
    const i1 = Math.min(i0 + 1, maxIndex);
    const localT = scaled - i0;
    const a = samples[i0];
    const b = samples[i1];
    const lon = lerp(a.lon, b.lon, localT);
    const lat = lerp(a.lat, b.lat, localT);
    const height = lerp(a.height, b.height, localT);
    return {
        t: clamped,
        lon,
        lat,
        height,
        cart: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    };
}
function alphaRampFromOrigin(t) {
    const fadeStart = numberVar("--warzone-missile-origin-fade-start", 0);
    const fadeEnd = numberVar("--warzone-missile-origin-fade-end", 0.3);
    const alphaMin = numberVar("--warzone-missile-origin-alpha-min", 0.2);
    const alphaMax = numberVar("--warzone-missile-origin-alpha-max", 1);
    if (t <= fadeStart) return alphaMin;
    if (t >= fadeEnd) return alphaMax;
    const local = (t - fadeStart) / Math.max(0.0001, fadeEnd - fadeStart);
    return lerp(alphaMin, alphaMax, easeInOutCubic(local));
}
/* ---------- Audio ---------- */
function safeCreateAudio(src, volume = 1, loop = false) {
    try {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.loop = loop;
        audio.volume = clamp01(volume);
        return audio;
    } catch {
        return null;
    }
}
function ensureAudioStore(viewer) {
    if (viewer.__warzoneAudio) return viewer.__warzoneAudio;
    const alertSrc = readCssAssetPath("--warzone-sound-alert-loop", "/assets/audio/warzone-alert-loop.mp3");
    const impactSrc = readCssAssetPath("--warzone-sound-impact", "/assets/audio/warzone-impact.mp3");
    viewer.__warzoneAudio = {
        alertLoop: safeCreateAudio(alertSrc, numberVar("--warzone-sound-alert-volume", 0.65), true),
        impactSrc,
        impactVolume: clamp01(numberVar("--warzone-sound-impact-volume", 0.9)),
        activeAlertCount: 0,
    };
    return viewer.__warzoneAudio;
}
function startMissileAlertSound(viewer) {
    const store = ensureAudioStore(viewer);
    store.activeAlertCount += 1;
    if (store.activeAlertCount === 1 && store.alertLoop) {
        try {
            store.alertLoop.currentTime = 0;
            store.alertLoop.play().catch(() => { });
        } catch { }
    }
}
function stopMissileAlertSound(viewer) {
    const store = ensureAudioStore(viewer);
    store.activeAlertCount = Math.max(0, store.activeAlertCount - 1);
    if (store.activeAlertCount === 0 && store.alertLoop) {
        try {
            store.alertLoop.pause();
            store.alertLoop.currentTime = 0;
        } catch { }
    }
}
function playImpactSound(viewer) {
    const store = ensureAudioStore(viewer);
    if (!store.impactSrc) return;
    if (Date.now() < Number(window.__warzoneOperationalAudioMutedUntil || 0)) return;
    try {
        const audio = new Audio(store.impactSrc);
        audio.preload = "auto";
        audio.volume = store.impactVolume;
        audio.currentTime = 0;
        audio.play().catch(() => { });
    } catch { }
}
/* ---------- Missile store ---------- */
function ensureMissileStore(viewer) {
    if (!viewer.__warzoneMissiles) viewer.__warzoneMissiles = new Map();
    if (!viewer.__warzoneMissileSeq) viewer.__warzoneMissileSeq = 0;
    if (!viewer.__warzoneMissileOrder) viewer.__warzoneMissileOrder = [];
}
function clearOneMissileTrack(viewer, missileId) {
    ensureMissileStore(viewer);
    const track = viewer.__warzoneMissiles.get(missileId);
    if (!track) return;
    if (track.flightFrame) cancelAnimationFrame(track.flightFrame);
    if (track.launchFxFrame) cancelAnimationFrame(track.launchFxFrame);
    if (track.impactFxFrame) cancelAnimationFrame(track.impactFxFrame);
    if (track.fadeFrame) cancelAnimationFrame(track.fadeFrame);
    if (track.highlightFrame) cancelAnimationFrame(track.highlightFrame);
    if (track.cleanupTimer) clearTimeout(track.cleanupTimer);
    if (track.alertSoundActive) {
        stopMissileAlertSound(viewer);
        track.alertSoundActive = false;
    }
    for (const entity of track.entities || []) {
        try {
            viewer.entities.remove(entity);
        } catch { }
    }
    viewer.__warzoneMissiles.delete(missileId);
    viewer.__warzoneMissileOrder = viewer.__warzoneMissileOrder.filter((id) => id !== missileId);
}
function clearAllMissileTracks(viewer) {
    ensureMissileStore(viewer);
    for (const missileId of viewer.__warzoneMissiles.keys()) {
        clearOneMissileTrack(viewer, missileId);
    }
}
function enforceMissileCap(viewer) {
    ensureMissileStore(viewer);
    const maxActive = Math.max(1, numberVar("--warzone-max-active-missiles", 12));
    while (viewer.__warzoneMissileOrder.length > maxActive) {
        const oldestId = viewer.__warzoneMissileOrder[0];
        if (!oldestId) break;
        clearOneMissileTrack(viewer, oldestId);
    }
}
/* ---------- Warning + impact FX ---------- */
function getIncomingHighlightRadius(event) {
    const explicitRadius =
        Number(event?.highlight_radius_m) ||
        Number(event?.target_radius_m) ||
        Number(event?.incoming_highlight_radius_m);
    if (Number.isFinite(explicitRadius) && explicitRadius > 0) {
        return explicitRadius;
    }
    const targetScope = String(
        event?.target_scope ||
        event?.target_type ||
        event?.location_scope ||
        ""
    ).toLowerCase();
    if (targetScope.includes("country") || targetScope.includes("national")) {
        return numberVar("--warzone-incoming-highlight-radius-country", 260000);
    }
    if (
        targetScope.includes("province") ||
        targetScope.includes("state") ||
        targetScope.includes("region") ||
        targetScope.includes("governorate")
    ) {
        return numberVar("--warzone-incoming-highlight-radius-region", 180000);
    }
    return numberVar("--warzone-incoming-highlight-radius-city", 120000);
}
function makeIncomingWarningEntity(viewer, missileId, event, lon, lat) {
    const color = Cesium.Color.fromCssColorString(
        cssVar("--warzone-incoming-highlight-color", "#ff2a2a")
    );
    const radius = getIncomingHighlightRadius(event);
    const height = numberVar("--warzone-warning-height", 4000);
    const warning = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        ellipse: {
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: color.withAlpha(0.95),
            outlineWidth: numberVar("--warzone-incoming-highlight-outline-width", 6),
            height,
        },
    });
    const inner = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        ellipse: {
            semiMinorAxis: radius * 0.58,
            semiMajorAxis: radius * 0.58,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: color.withAlpha(0.75),
            outlineWidth: Math.max(2, numberVar("--warzone-incoming-highlight-outline-width", 6) - 2),
            height,
        },
    });
    const core = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height + 1000),
        billboard: {
            image: createRingCanvas(cssVar("--warzone-incoming-highlight-color", "#ff2a2a"), 256, 14),
            scale: 0.22,
            color: Cesium.Color.WHITE.withAlpha(1),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.entities.push(warning, inner, core);
        track.warningOuter = warning;
        track.warningInner = inner;
        track.warningCore = core;
        track.warningBaseRadius = radius;
    }
    return { warning, inner, core };
}
function hideIncomingWarning(track) {
    if (track?.warningOuter) track.warningOuter.show = false;
    if (track?.warningInner) track.warningInner.show = false;
    if (track?.warningCore) track.warningCore.show = false;
}
function animateIncomingWarning(viewer, missileId) {
    const tick = () => {
        const track = viewer.__warzoneMissiles.get(missileId);
        if (!track || track.isFading || track.hasImpacted) return;
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
        const color = Cesium.Color.fromCssColorString(
            cssVar("--warzone-incoming-highlight-color", "#ff2a2a")
        );
        if (track.warningOuter?.ellipse) {
            const r = track.warningBaseRadius * (0.92 + pulse * 0.16);
            track.warningOuter.ellipse.semiMinorAxis = r;
            track.warningOuter.ellipse.semiMajorAxis = r;
            track.warningOuter.ellipse.outlineColor = color.withAlpha(0.72 + pulse * 0.28);
        }
        if (track.warningInner?.ellipse) {
            const r = track.warningBaseRadius * (0.5 + pulse * 0.12);
            track.warningInner.ellipse.semiMinorAxis = r;
            track.warningInner.ellipse.semiMajorAxis = r;
            track.warningInner.ellipse.outlineColor = color.withAlpha(0.5 + pulse * 0.35);
        }
        if (track.warningCore?.billboard) {
            track.warningCore.billboard.scale = 0.18 + pulse * 0.18;
            track.warningCore.billboard.color = Cesium.Color.WHITE.withAlpha(0.5 + pulse * 0.45);
        }
        viewer.scene.requestRender();
        track.highlightFrame = requestAnimationFrame(tick);
    };
    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.highlightFrame = requestAnimationFrame(tick);
    }
}
function makeImpactPulseEntities(viewer, missileId, lon, lat) {
    const stroke = cssVar("--warzone-missile-impact-color", "#ff2a2a");
    const img = createRingCanvas(
        stroke,
        512,
        numberVar("--warzone-missile-impact-ring-line-width", 10)
    );
    const height = numberVar("--warzone-missile-impact-height", 5000);
    const rings = [];
    const ringCount = Math.max(3, numberVar("--warzone-missile-impact-ring-count", 3));
    for (let i = 0; i < ringCount; i += 1) {
        const ring = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            billboard: {
                image: img,
                scale: 0.03,
                color: Cesium.Color.WHITE.withAlpha(0.01),
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
        rings.push(ring);
    }
    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.entities.push(...rings);
    }
    return rings;
}
function animateImpactPulse(viewer, missileId, rings) {
    const startedAt = performance.now();
    const cycles = Math.max(1, numberVar("--warzone-missile-impact-cycles", 3));
    const cycleDuration = Math.max(1200, numberVar("--warzone-missile-impact-cycle-duration", 5580));
    const staggerMs = Math.max(80, numberVar("--warzone-missile-impact-ring-stagger-ms", 620));
    const minScale = numberVar("--warzone-missile-impact-ring-min-scale", 0.02);
    const maxScale = numberVar("--warzone-missile-impact-ring-max-scale", 0.30);
    const alphaMax = clamp01(numberVar("--warzone-missile-impact-ring-alpha-max", 0.60));
    const totalDuration = cycles * cycleDuration;
    const tick = () => {
        const track = viewer.__warzoneMissiles.get(missileId);
        if (!track) return;
        const elapsed = performance.now() - startedAt;
        const globalFadeWindow = Math.min(1600, cycleDuration * 0.35);
        const globalFadeStart = totalDuration - globalFadeWindow;
        const globalFade =
            elapsed <= globalFadeStart
                ? 1
                : 1 - easeInOutCubic(clamp01((elapsed - globalFadeStart) / globalFadeWindow));
        if (elapsed >= totalDuration) {
            try {
                for (const ring of rings) viewer.entities.remove(ring);
                track.entities = track.entities.filter((e) => !rings.includes(e));
            } catch { }
            track.impactFxFrame = null;
            viewer.scene.requestRender();
            return;
        }
        const cycleTime = elapsed % cycleDuration;
        const activeWindow = cycleDuration * 0.9;
        for (let i = 0; i < rings.length; i += 1) {
            const ring = rings[i];
            if (!ring?.billboard) continue;
            const localElapsed = cycleTime - (i * staggerMs);
            if (localElapsed <= 0 || localElapsed >= activeWindow) {
                ring.billboard.scale = minScale;
                ring.billboard.color = Cesium.Color.WHITE.withAlpha(0);
                continue;
            }
            const t = clamp01(localElapsed / activeWindow);
            const grow = easeOutCubic(t);
            const scale = lerp(minScale, maxScale, grow);
            let alpha;
            if (t < 0.14) {
                alpha = alphaMax * easeOutCubic(t / 0.14);
            } else {
                const fadeT = clamp01((t - 0.14) / 0.86);
                alpha = alphaMax * Math.pow(1 - fadeT, 2.15);
            }
            alpha *= globalFade;
            ring.billboard.scale = scale;
            ring.billboard.color = Cesium.Color.WHITE.withAlpha(alpha);
        }
        viewer.scene.requestRender();
        track.impactFxFrame = requestAnimationFrame(tick);
    };
    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.impactFxFrame = requestAnimationFrame(tick);
    }
}
function makeLaunchFlashEntity(viewer, missileId, lon, lat, color = Cesium.Color.ORANGE) {
    const createdAt = performance.now();
    const track = viewer.__warzoneMissiles.get(missileId);
    const launchRing = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: {
            semiMinorAxis: 1,
            semiMajorAxis: 1,
            material: color.withAlpha(0.18),
            outline: true,
            outlineColor: color.withAlpha(0.85),
            outlineWidth: 2,
            height: 0,
        },
    });
    const launchPoint = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
            pixelSize: 8,
            color: Cesium.Color.WHITE.withAlpha(0.95),
            outlineColor: color.withAlpha(0.95),
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    const tick = () => {
        const activeTrack = viewer.__warzoneMissiles.get(missileId);
        if (!activeTrack) return;
        const elapsed = performance.now() - createdAt;
        const duration = Math.max(300, numberVar("--warzone-missile-launch-flash-duration", 900));
        const t = clamp01(elapsed / duration);
        if (t >= 1) {
            try {
                viewer.entities.remove(launchRing);
                viewer.entities.remove(launchPoint);
                activeTrack.entities = activeTrack.entities.filter(
                    (entity) => entity !== launchRing && entity !== launchPoint
                );
            } catch { }
            activeTrack.launchFxFrame = null;
            viewer.scene.requestRender();
            return;
        }
        const radius = Math.round(12000 + easeOutCubic(t) * numberVar("--warzone-missile-launch-ring-size", 65000));
        const alpha = Math.max(0, 0.28 - t * 0.24);
        if (launchRing.ellipse) {
            launchRing.ellipse.semiMinorAxis = radius;
            launchRing.ellipse.semiMajorAxis = radius;
            launchRing.ellipse.material = color.withAlpha(alpha * 0.35);
            launchRing.ellipse.outlineColor = color.withAlpha(alpha + 0.2);
        }
        if (launchPoint.point) {
            launchPoint.point.pixelSize = 8 + (1 - t) * 7;
            launchPoint.point.color = Cesium.Color.WHITE.withAlpha(0.45 + (1 - t) * 0.5);
            launchPoint.point.outlineColor = color.withAlpha(0.65 + (1 - t) * 0.25);
        }
        viewer.scene.requestRender();
        activeTrack.launchFxFrame = requestAnimationFrame(tick);
    };
    if (track) {
        track.launchFxFrame = requestAnimationFrame(tick);
    }
    return [launchRing, launchPoint];
}
function createMissileSegmentEntities(viewer, track, positions) {
    const segmentCount = Math.max(6, Math.floor(numberVar("--warzone-missile-segment-count", 22)));
    const width = numberVar("--warzone-missile-line-width", 5);
    const lineAlpha = numberVar("--warzone-missile-line-alpha", 1);
    const segments = [];
    for (let i = 0; i < segmentCount; i += 1) {
        const t0 = i / segmentCount;
        const t1 = (i + 1) / segmentCount;
        const baseAlpha = alphaRampFromOrigin((t0 + t1) * 0.5) * lineAlpha;
        const segment = viewer.entities.add({
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    const item = track.segmentPositions?.[i];
                    return item && item.length >= 2 ? item : [positions[0], positions[0]];
                }, false),
                width,
                material: track.lineBaseColor.withAlpha(baseAlpha),
                clampToGround: false,
            },
        });
        segments.push({
            entity: segment,
            t0,
            t1,
            baseAlpha,
        });
        track.entities.push(segment);
    }
    track.segmentEntities = segments;
}
function fadeOutMissileTrack(viewer, missileId, durationMs = 1800) {
    ensureMissileStore(viewer);
    const track = viewer.__warzoneMissiles.get(missileId);
    if (!track || track.isFading) return;
    track.isFading = true;
    if (track.cleanupTimer) {
        clearTimeout(track.cleanupTimer);
        track.cleanupTimer = null;
    }
    if (track.highlightFrame) {
        cancelAnimationFrame(track.highlightFrame);
        track.highlightFrame = null;
    }
    const startedAt = performance.now();
    const launchColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-launch-color", "#ff2a2a"));
    const impactColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-impact-color", "#ff2a2a"));
    const step = () => {
        const activeTrack = viewer.__warzoneMissiles.get(missileId);
        if (!activeTrack) return;
        const elapsed = performance.now() - startedAt;
        const t = clamp01(elapsed / durationMs);
        const fade = 1 - easeInOutCubic(t);
        if (Array.isArray(activeTrack.segmentEntities)) {
            for (const segment of activeTrack.segmentEntities) {
                if (!segment?.entity?.polyline) continue;
                segment.entity.polyline.material =
                    activeTrack.lineBaseColor.withAlpha(segment.baseAlpha * fade);
            }
        }
        if (activeTrack.launchMarker?.point) {
            activeTrack.launchMarker.point.color = launchColor.withAlpha(fade);
            activeTrack.launchMarker.point.outlineColor = Cesium.Color.WHITE.withAlpha(fade);
        }
        if (activeTrack.impactMarker?.point) {
            activeTrack.impactMarker.point.color = impactColor.withAlpha(0.92 * fade);
            activeTrack.impactMarker.point.outlineColor = impactColor.withAlpha(0.35 * fade);
        }
        if (activeTrack.launchMarker?.label) {
            activeTrack.launchMarker.label.fillColor = launchColor.withAlpha(fade);
            activeTrack.launchMarker.label.outlineColor = Cesium.Color.BLACK.withAlpha(fade);
        }
        if (activeTrack.impactMarker?.label) {
            activeTrack.impactMarker.label.fillColor = impactColor.withAlpha(fade);
            activeTrack.impactMarker.label.outlineColor = Cesium.Color.BLACK.withAlpha(fade);
        }
        viewer.scene.requestRender();
        if (t < 1) {
            activeTrack.fadeFrame = requestAnimationFrame(step);
            return;
        }
        activeTrack.fadeFrame = null;
        clearOneMissileTrack(viewer, missileId);
        viewer.scene.requestRender();
    };
    track.fadeFrame = requestAnimationFrame(step);
}
function animateMissileTrack(viewer, event) {
    const originLon = Number(event.origin_lon);
    const originLat = Number(event.origin_lat);
    const impactLon = Number(event.impact_lon ?? event.lon);
    const impactLat = Number(event.impact_lat ?? event.lat);
    if (
        !Number.isFinite(originLon) ||
        !Number.isFinite(originLat) ||
        !Number.isFinite(impactLon) ||
        !Number.isFinite(impactLat)
    ) {
        return null;
    }
    ensureMissileStore(viewer);
    const missileId = String(event.id || `missile-${++viewer.__warzoneMissileSeq}`);
    if (viewer.__warzoneMissiles.has(missileId)) {
        clearOneMissileTrack(viewer, missileId);
    }
    const peakHeight =
        event.severity === "critical"
            ? numberVar("--warzone-missile-peak-height-critical", 820000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-peak-height-high", 620000)
                : numberVar("--warzone-missile-peak-height-medium", 460000);
    const durationMs = Number(
        event.animation_duration_ms ||
        (event.severity === "critical"
            ? numberVar("--warzone-missile-duration-critical", 9000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-duration-high", 7500)
                : numberVar("--warzone-missile-duration-medium", 6200))
    );
    const persistMs = Number(
        event.persist_ms ||
        (event.severity === "critical"
            ? numberVar("--warzone-missile-persist-critical", 12000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-persist-high", 10000)
                : numberVar("--warzone-missile-persist-medium", 8000))
    );
    const { positions, samples } = buildArcState(
        originLon,
        originLat,
        impactLon,
        impactLat,
        peakHeight,
        Math.max(64, numberVar("--warzone-missile-steps", 120))
    );
    const launchColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-launch-color", "#ff2a2a"));
    const impactColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-impact-color", "#ff2a2a"));
    const track = {
        id: missileId,
        entities: [],
        flightFrame: null,
        launchFxFrame: null,
        impactFxFrame: null,
        fadeFrame: null,
        highlightFrame: null,
        cleanupTimer: null,
        isFading: false,
        hasImpacted: false,
        segmentEntities: [],
        segmentPositions: [],
        launchMarker: null,
        impactMarker: null,
        lineBaseColor: Cesium.Color.fromCssColorString(cssVar("--warzone-missile-line-color", "#ff2a2a")),
        lastImpactCart: null,
        warningOuter: null,
        warningInner: null,
        warningCore: null,
        warningBaseRadius: 0,
        alertSoundActive: false,
        impactSoundPlayed: false,
    };
    viewer.__warzoneMissiles.set(missileId, track);
    viewer.__warzoneMissileOrder.push(missileId);
    enforceMissileCap(viewer);
    createMissileSegmentEntities(viewer, track, positions);
    const launchMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(originLon, originLat),
        point: {
            pixelSize: 10,
            color: launchColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
            text: event.origin_label || "Launch",
            font: "bold 14px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -34),
            fillColor: launchColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    track.entities.push(launchMarker);
    track.launchMarker = launchMarker;
    const impactMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(impactLon, impactLat, numberVar("--warzone-impact-marker-height", 4000)),
        point: {
            pixelSize: 7,
            color: impactColor.withAlpha(0.98),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.2),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
            text: event.impact_label || event.location_label || "Impact",
            font: "bold 14px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -40),
            fillColor: impactColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    track.entities.push(impactMarker);
    track.impactMarker = impactMarker;
    makeIncomingWarningEntity(viewer, missileId, event, impactLon, impactLat);
    const launchFx = makeLaunchFlashEntity(viewer, missileId, originLon, originLat, launchColor);
    track.entities.push(...launchFx);
    startMissileAlertSound(viewer);
    track.alertSoundActive = true;
    if (boolVar("--warzone-missile-auto-focus", true)) {
        viewer.camera.flyTo({
            destination: Cesium.Rectangle.fromDegrees(
                Math.min(originLon, impactLon) - 2.8,
                Math.min(originLat, impactLat) - 2.2,
                Math.max(originLon, impactLon) + 2.8,
                Math.max(originLat, impactLat) + 2.2
            ),
            duration: numberVar("--warzone-missile-focus-duration", 0.95),
        });
    }
    animateIncomingWarning(viewer, missileId);
    const startedAt = performance.now();
    const step = () => {
        const activeTrack = viewer.__warzoneMissiles.get(missileId);
        if (!activeTrack || activeTrack.isFading) return;
        const elapsed = performance.now() - startedAt;
        const t = clamp01(elapsed / durationMs);
        const eased = easeInOutCubic(t);
        const current = interpolateSample(samples, eased);
        activeTrack.lastImpactCart = current.cart;
        const segmentGap = clamp01(numberVar("--warzone-missile-segment-gap", 0.02));
        activeTrack.segmentPositions = activeTrack.segmentEntities.map((segment) => {
            if (eased <= segment.t0) {
                return [positions[0], positions[0]];
            }
            const visibleEnd = Math.min(eased, segment.t1);
            const localEnd = interpolateSample(samples, visibleEnd).cart;
            const localStartT = Math.max(segment.t0, 0);
            if (visibleEnd <= localStartT + segmentGap) {
                const p = interpolateSample(samples, visibleEnd).cart;
                return [p, p];
            }
            const localStart = interpolateSample(samples, localStartT).cart;
            return [localStart, localEnd];
        });
        viewer.scene.requestRender();
        if (t < 1) {
            activeTrack.flightFrame = requestAnimationFrame(step);
            return;
        }
        activeTrack.flightFrame = null;
        if (activeTrack.alertSoundActive) {
            stopMissileAlertSound(viewer);
            activeTrack.alertSoundActive = false;
        }
        if (!activeTrack.impactSoundPlayed) {
            playImpactSound(viewer);
            activeTrack.impactSoundPlayed = true;
        }
        activeTrack.hasImpacted = true;
        hideIncomingWarning(activeTrack);
        const pulseEntities = makeImpactPulseEntities(viewer, missileId, impactLon, impactLat);
        animateImpactPulse(viewer, missileId, pulseEntities);
        viewer.scene.requestRender();
        activeTrack.cleanupTimer = setTimeout(() => {
            fadeOutMissileTrack(
                viewer,
                missileId,
                numberVar("--warzone-missile-fadeout-duration", 1800)
            );
        }, persistMs);
    };
    track.flightFrame = requestAnimationFrame(step);
    return missileId;
}
function clearAlertHighlight(viewer) {
    if (viewer.__warzoneAlertPulseFrame) {
        try { cancelAnimationFrame(viewer.__warzoneAlertPulseFrame); } catch { }
        viewer.__warzoneAlertPulseFrame = null;
    }
    if (viewer.__warzoneAlertCleanupTimer) {
        clearTimeout(viewer.__warzoneAlertCleanupTimer);
        viewer.__warzoneAlertCleanupTimer = null;
    }
    if (viewer.__warzoneAlertEntities) {
        viewer.__warzoneAlertEntities.forEach((e) => {
            try { viewer.entities.remove(e); } catch { }
        });
        viewer.__warzoneAlertEntities = null;
    }
    if (viewer.__warzoneAlertEntity) {
        try { viewer.entities.remove(viewer.__warzoneAlertEntity); } catch { }
        viewer.__warzoneAlertEntity = null;
    }
}
function highlightAlertRegion(viewer, event) {
    clearAlertHighlight(viewer);
    if (!event || !Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lon))) return;
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const severity = String(event.severity || "high").toLowerCase();
    const baseRadius = severity === "critical" ? 180000 : severity === "high" ? 140000 : 100000;
    const pulseDurationMs = Math.max(280, numberVar("--warzone-highlight-pulse-speed", 700));
    const highlightDurationMs = Math.max(1000, numberVar("--warzone-highlight-duration", 14000));
    const entities = [];
    const fill = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 2000),
        ellipse: {
            semiMinorAxis: baseRadius,
            semiMajorAxis: baseRadius,
            material: Cesium.Color.fromCssColorString("#fd3741").withAlpha(0.15),
            outline: false,
            height: 2000,
        },
    });
    entities.push(fill);
    const outerRing = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 3000),
        ellipse: {
            semiMinorAxis: baseRadius * 1.45,
            semiMajorAxis: baseRadius * 1.45,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#fd3741").withAlpha(0.7),
            outlineWidth: 5,
            height: 3000,
        },
    });
    entities.push(outerRing);
    const innerRing = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 4000),
        ellipse: {
            semiMinorAxis: baseRadius * 0.56,
            semiMajorAxis: baseRadius * 0.56,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#fd3741").withAlpha(0.9),
            outlineWidth: 5,
            height: 4000,
        },
    });
    entities.push(innerRing);
    viewer.__warzoneAlertEntities = entities;
    viewer.__warzoneAlertEntity = entities[0];
    const alertColor = Cesium.Color.fromCssColorString("#fd3741");
    const tick = () => {
        if (!viewer.__warzoneAlertEntities?.length) return;
        const pulse = 0.5 + 0.5 * Math.sin((performance.now() / pulseDurationMs) * Math.PI * 2);
        if (fill?.ellipse) {
            const r = baseRadius * (0.92 + pulse * 0.16);
            fill.ellipse.semiMinorAxis = r;
            fill.ellipse.semiMajorAxis = r;
            fill.ellipse.material = alertColor.withAlpha(0.06 + pulse * 0.14);
        }
        if (outerRing?.ellipse) {
            const r = baseRadius * (1.18 + pulse * 0.40);
            outerRing.ellipse.semiMinorAxis = r;
            outerRing.ellipse.semiMajorAxis = r;
            outerRing.ellipse.outlineColor = alertColor.withAlpha(0.28 + pulse * 0.54);
        }
        if (innerRing?.ellipse) {
            const r = baseRadius * (0.36 + pulse * 0.28);
            innerRing.ellipse.semiMinorAxis = r;
            innerRing.ellipse.semiMajorAxis = r;
            innerRing.ellipse.outlineColor = alertColor.withAlpha(0.24 + pulse * 0.62);
        }
        viewer.scene.requestRender();
        viewer.__warzoneAlertPulseFrame = requestAnimationFrame(tick);
    };
    viewer.__warzoneAlertPulseFrame = requestAnimationFrame(tick);
    viewer.scene.requestRender();
    viewer.__warzoneAlertCleanupTimer = setTimeout(() => {
        clearAlertHighlight(viewer);
        viewer.scene.requestRender();
    }, highlightDurationMs);
}
function labelCesiumCredits(creditsEl) {
    if (!creditsEl || typeof MutationObserver === "undefined") return;
    const applyLabels = () => {
        creditsEl.setAttribute("aria-label", "Map imagery credits");
        creditsEl.querySelectorAll("img").forEach((img) => {
            if (!img.hasAttribute("alt")) {
                img.setAttribute("alt", "Map provider credit");
            }
        });
        creditsEl.querySelectorAll("a").forEach((link) => {
            if (!link.getAttribute("aria-label")) {
                const imgAlt = link.querySelector("img")?.getAttribute("alt");
                const label = imgAlt || link.textContent?.trim() || "Map imagery credit";
                link.setAttribute("aria-label", label);
            }
        });
    };
    applyLabels();
    const observer = new MutationObserver(applyLabels);
    observer.observe(creditsEl, { childList: true, subtree: true });
}
export async function initWarzoneGlobe() {
    const globeEl = document.getElementById("warzone-globe");
    const creditsEl = document.getElementById("warzone-map-credits");
    if (!globeEl) return null;
    const cesiumCreditsEl = getCesiumCreditContainer(globeEl);
    const viewer = new Cesium.Viewer(globeEl, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: false,
        scene3DOnly: false,
        mapMode2D: Cesium.MapMode2D.ROTATE,
        requestRenderMode: true,
        contextOptions: {
            webgl: {
                antialias: true,
                powerPreference: "high-performance",
                preserveDrawingBuffer: false,
            },
        },
        skyAtmosphere: false,
        terrain: undefined,
        creditContainer: cesiumCreditsEl || creditsEl || undefined,
        imageryProvider: false,
    });
    labelCesiumCredits(cesiumCreditsEl);
    updateMapCredits();
    viewer.__terrainVisible = true;
    viewer.__raisedRegionVisible = false;
    viewer.__raisedRegionLoaded = false;
    viewer.__raisedRegionLoadPromise = null;
    viewer.__raisedRegionDataSource = null;
    viewer.__warzoneSceneMode = getSceneMode(viewer);
    viewer.__warzoneAdaptiveProfile = "normal";
    viewer.__warzoneSuppressEventMarkers = false;
    viewer.__borderLayersVisible = false;
    viewer.__borderVisibilityAlpha = 0;
    viewer.__borderLayersLoaded = false;
    viewer.__borderLayerLoadPromise = null;
    viewer.__borderEntities = [];
    viewer.__warzoneFlatTerrainProvider = viewer.terrainProvider;
    viewer.__warzoneFocusedTerrainActive = false;
    applyViewerStyle(viewer);
    setInitialCamera(viewer);
    startStartupGlobeRotation(viewer);
    attachCameraZoomLimiter(viewer);
    attach2DCameraBoundsGuard(viewer);
    syncSceneModeBounds(viewer);
    ensureMissileStore(viewer);
    ensureAudioStore(viewer);
    attachEventLodController(viewer);
    attachLabelsZoomController(viewer);
    bindEventMarkerPicking(viewer);
    viewer.scene.requestRender();
    viewer.__warzoneImageryReadyPromise = addArcGisLayers(viewer)
        .then(() => {
            viewer.scene.requestRender();
            return true;
        })
        .catch((error) => {
            console.warn("ArcGIS imagery provider failed; continuing without ion imagery fallback:", error);
            return false;
        });
    if (boolVar("--warzone-country-labels-enabled", false)) {
        addCountryNameLabels(viewer)
            .then(() => {
                viewer.scene.requestRender();
            })
            .catch(() => { });
    }
    viewer.__warzone = {
        addEvent(event) {
            const entity = addEventEntity(viewer, event);
            applyEventLod(viewer);
            viewer.scene.requestRender();
            return entity;
        },
        addEvents(events = []) {
            const normalized = normalizeEvents(events);
            const maxItems = getMaxRenderableEvents(viewer);
            const prepared = shouldClusterEvents(viewer)
                ? clusterEventsForDisplay(normalized, numberVar("--warzone-event-cluster-precision", 0.55), maxItems)
                : normalized.slice(0, maxItems);
            const ringEntityCap = Math.max(40, Math.round(numberVar("--warzone-event-ring-entity-cap", 160)));
            const shouldDisableRingsForBatch = prepared.length > ringEntityCap;
            reconcileEventEntities(viewer, prepared, {
                disableEllipse: shouldDisableRingsForBatch,
                disableOutline: shouldDisableRingsForBatch,
                suppressMarkers: viewer.__warzoneSuppressEventMarkers === true,
            });
        },
        setEventMarkersSuppressed(suppressed) {
            const next = !!suppressed;
            if (viewer.__warzoneSuppressEventMarkers === next) return;
            viewer.__warzoneSuppressEventMarkers = next;
            applyEventLod(viewer);
            viewer.scene.requestRender?.();
        },
        clearEventEntities() {
            clearTrackedEventEntities(viewer);
        },
        setEventLayerVisible(layerId, visible) {
            setTrackedEventLayerVisible(viewer, layerId, visible);
        },
        removeEvent(eventId) {
            removeExistingEventEntity(viewer, eventId);
            viewer.scene.requestRender();
        },
        focusRegion,
        getViewportBounds() {
            const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
            if (!rect) return null;
            const west = Cesium.Math.toDegrees(rect.west);
            const south = Cesium.Math.toDegrees(rect.south);
            const east = Cesium.Math.toDegrees(rect.east);
            const north = Cesium.Math.toDegrees(rect.north);
            return {
                minLon: west,
                minLat: south,
                maxLon: east,
                maxLat: north
            };
        },
        refocusMiddleEast() {
            const cam = getStartCameraConfig();
            focusRegion(viewer, cam.lon, cam.lat, numberVar("--warzone-focus-height", 2350000));
        },
        setMapMode(mode) {
            setMapMode(viewer, mode);
        },
        setSceneMode(mode, options = {}) {
            return setSceneMode(viewer, mode, options);
        },
        stopStartupRotation() {
            stopStartupGlobeRotation(viewer);
        },
        getSceneMode() {
            return getSceneMode(viewer);
        },
        refreshMapTuning() {
            if (viewer.__imageryBase) {
                tuneImageryLayer(viewer.__imageryBase, "--warzone-map");
            }
            if (viewer.__imageryLabels) {
                tuneImageryLayer(viewer.__imageryLabels, "--warzone-labels");
            }
            void buildContourOverlay(viewer, {
                force: true,
                reason: "refresh-map-tuning",
            });
            applyContourLayerState(viewer);
            updateLabelsLayerVisibility(viewer);
            applyMapColorMixer(viewer, "--warzone-map");
            viewer.scene.requestRender();
        },
        setTerrainVisible(visible) {
            const show = !!visible;
            viewer.__terrainVisible = show;
            applyRenderedTerrainVisibility(viewer);
            applyContourLayerState(viewer);
            viewer.scene.requestRender();
        },
        isTerrainVisible() {
            return !!(
                viewer.__imageryBase &&
                viewer.__imageryBase.show
            );
        },
        setSatelliteVisible(visible) {
            viewer.__satelliteVisible = !!visible;
            applyRenderedTerrainVisibility(viewer);
            viewer.scene?.requestRender?.();
            return viewer.__satelliteVisible === true;
        },
        isSatelliteVisible() {
            return viewer.__satelliteVisible !== false && viewer.__imageryBase?.show !== false;
        },
        setGreyedSatelliteVisible(visible) {
            viewer.__warzoneGreyedSatelliteVisible = !!visible;
            applyRenderedTerrainVisibility(viewer);
            viewer.scene?.requestRender?.();
            return viewer.__warzoneGreyedSatelliteVisible === true;
        },
        isGreyedSatelliteVisible() {
            return viewer.__warzoneGreyedSatelliteVisible === true;
        },
        setContourGridVisible(visible) {
            return setContourGridLayerVisible(viewer, visible);
        },
        isContourGridVisible() {
            return viewer.__contourGridLayerVisible === true;
        },
        setContourGridCenter(position) {
            return setContourGridCenter(viewer, position);
        },
        enableFocusedTerrain() {
            return enableFocusedTerrain(viewer);
        },
        disableFocusedTerrain() {
            return disableFocusedTerrain(viewer);
        },
        isFocusedTerrainActive() {
            return viewer.__warzoneFocusedTerrainActive === true;
        },
        setContourLayerVisible(visible) {
            return setContourLayerVisible(viewer, visible);
        },
        restoreDefaultMapRender() {
            return restoreDefaultRenderedMap(viewer);
        },
        toggleContourLayer() {
            return setContourLayerVisible(viewer, viewer.__contourLayerVisible !== true);
        },
        isContourLayerVisible() {
            return viewer.__contourLayerVisible === true;
        },
        setContourFocusPosition(position, options = {}) {
            return setContourFocusPosition(viewer, position, options);
        },
        refreshContourFromViewport(options = {}) {
            return refreshContourFromViewport(viewer, options);
        },
        clearContourFocusPosition() {
            clearContourFocusPosition(viewer);
        },
        setRaisedRegionVisible(visible, region = null) {
            applyRaisedRegionVisibility(viewer, visible, region);
        },
        isRaisedRegionVisible() {
            return viewer.__raisedRegionVisible === true;
        },
        setBorderLayersVisible(visible, options = {}) {
            setBorderLayersVisible(viewer, visible, options);
            viewer.scene.requestRender();
        },
        isBorderLayersVisible() {
            return viewer.__borderLayersVisible !== false;
        },
        setAdaptiveQualityProfile(profile = "normal") {
            const normalized = normalizeAdaptiveProfile(profile);
            viewer.__warzoneAdaptiveProfile = normalized;
            const count = Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0));
            this.setPerformanceMode(count);
            viewer.scene.requestRender?.();
            return normalized;
        },
        getAdaptiveQualityProfile() {
            return normalizeAdaptiveProfile(viewer.__warzoneAdaptiveProfile);
        },
        setPerformanceMode(visibleCount = 0) {
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
            const count = Math.max(0, Number(visibleCount || 0));
            const adaptiveProfile = normalizeAdaptiveProfile(viewer.__warzoneAdaptiveProfile);
            const adaptiveCaps = getAdaptiveProfileCaps(adaptiveProfile);
            const hardMaxResolutionScale = clamp(numberVar("--warzone-resolution-hard-max", 1.22), 0.7, 1.4);
            const hardMaxMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-msaa-hard-max", 2)));
            const baseResolution = clamp(numberVar("--warzone-resolution-scale", 1), 0.5, 2);
            const baseMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-msaa-samples", 1)));
            const baseFxaaEnabled = boolVar("--warzone-fxaa-enabled", true);
            const idleResolutionMin = clamp(numberVar("--warzone-idle-resolution-min", 1), 0.8, 2);
            const idleMsaaMin = Math.max(1, Math.round(numberVar("--warzone-idle-msaa-min", 2)));
            const movingResolutionFloor = clamp(numberVar("--warzone-moving-resolution-scale", 0.9), 0.68, 2);
            const movingMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-moving-msaa-samples", 1)));
            const baseTileCache = Math.max(
                220,
                Math.min(1200, Math.round(numberVar("--warzone-globe-tile-cache-size", 900)))
            );
            const loadingTileCache = Math.max(
                140,
                Math.min(baseTileCache, Math.round(numberVar("--warzone-globe-tile-cache-loading", Math.max(180, baseTileCache * 0.52))))
            );
            const movingTileCache = Math.max(
                180,
                Math.min(baseTileCache, Math.round(numberVar("--warzone-globe-tile-cache-moving", Math.max(220, baseTileCache * 0.66))))
            );
            const heavyTileCache = Math.max(
                140,
                Math.min(baseTileCache, Math.round(numberVar("--warzone-globe-tile-cache-heavy", Math.max(180, baseTileCache * 0.52))))
            );
            const baseLoadingDescendantLimit = Math.max(
                6,
                Math.min(72, Math.round(numberVar("--warzone-globe-loading-descendant-limit", 48)))
            );
            const busyLoadingDescendantLimit = Math.max(
                4,
                Math.min(baseLoadingDescendantLimit, Math.round(numberVar("--warzone-globe-loading-descendant-limit-busy", 10)))
            );
            const loadingQueueThreshold = Math.max(
                1,
                Math.round(numberVar("--warzone-globe-loading-queue-threshold", 8))
            );
            const basePreloadSiblings = boolVar("--warzone-globe-preload-siblings", false);
            const cameraHeight = getCameraHeight(viewer);
            const is2DMode = getSceneMode(viewer) === "2d";
            const isCameraMoving = viewer.__warzoneCameraMoving === true;
            const tileLoadQueueSize = Math.max(0, Number(viewer.__warzoneTileLoadQueueSize || 0));
            const tileLoadBusy = tileLoadQueueSize >= loadingQueueThreshold || viewer.__warzoneTileLoadBusy === true;
            const liveSelection = window.__warzoneLiveTrackSelection || {};
            const isAircraftFocusMode = String(liveSelection.mode || "") === "focus" && Boolean(liveSelection.trackKey);
            const focusSharpHeight = Math.max(30000, numberVar("--warzone-focus-sharp-height", 120000));
            const closeSharpHeight = Math.max(focusSharpHeight, numberVar("--warzone-close-sharp-height", 450000));
            const nearSharpHeight = Math.max(250000, numberVar("--warzone-near-sharp-height", 1800000));
            const focusResolutionScale = clamp(numberVar("--warzone-focus-resolution-scale", 1.16), 0.8, 2);
            const closeResolutionScale = clamp(numberVar("--warzone-close-resolution-scale", 1.08), 0.8, 2);
            const focusMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-focus-msaa-samples", 2)));
            const closeMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-close-msaa-samples", 2)));
            const focusPerformanceResolutionScale = clamp(numberVar("--warzone-focus-performance-resolution-scale", 0.72), 0.5, hardMaxResolutionScale);
            const focusPerformanceMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-focus-performance-msaa-samples", 1)));
            const focusPerformanceSse = clamp(numberVar("--warzone-focus-performance-screen-space-error", 3.4), 1.8, 6);
            const focusPerformanceTileCache = Math.max(96, Math.round(numberVar("--warzone-focus-performance-tile-cache", 160)));
            const focusPerformanceRenderTime = clamp(numberVar("--warzone-focus-performance-render-time", 0.18), 0.12, 0.8);
            const baseSse = clamp(numberVar("--warzone-globe-max-screen-space-error", 1.4), 0.9, 4.5);
            const closeSse = clamp(numberVar("--warzone-globe-close-screen-space-error", 1.15), 0.8, 2.5);
            const movingSse = clamp(numberVar("--warzone-globe-moving-screen-space-error", Math.max(baseSse * 1.45, 1.9)), 1.2, 6);
            let nextResolution = baseResolution;
            let nextMaximumRenderTime = Infinity;
            let nextMsaaSamples = baseMsaaSamples;
            let nextFxaaEnabled = baseFxaaEnabled;
            let nextSse = baseSse;
            let nextTileCache = baseTileCache;
            let nextLoadingDescendantLimit = baseLoadingDescendantLimit;
            let nextPreloadSiblings = basePreloadSiblings;
            if (count > 0) {
                if (count <= 60) {
                    nextMaximumRenderTime = 1.25;
                } else if (count <= 140) {
                    nextMaximumRenderTime = 0.95;
                    nextResolution = Math.max(0.88, baseResolution * 0.9);
                    nextMsaaSamples = 1;
                } else if (count <= 260) {
                    nextMaximumRenderTime = 0.78;
                    nextResolution = Math.max(0.8, baseResolution * 0.84);
                    nextMsaaSamples = 1;
                } else {
                    nextMaximumRenderTime = 0.58;
                    nextResolution = Math.max(0.74, baseResolution * 0.76);
                    nextMsaaSamples = 1;
                    nextFxaaEnabled = baseFxaaEnabled;
                    nextSse = Math.max(nextSse, Math.max(1.7, baseSse));
                }
            }
            if (count > 320) {
                nextTileCache = Math.min(nextTileCache, heavyTileCache);
                nextPreloadSiblings = false;
            } else if (count > 160) {
                nextTileCache = Math.min(nextTileCache, movingTileCache);
                nextPreloadSiblings = false;
            }
            // Keep icon edges readable when camera is settled.
            if (!isCameraMoving) {
                nextResolution = Math.max(nextResolution, Math.max(baseResolution, idleResolutionMin));
                nextMsaaSamples = Math.max(nextMsaaSamples, baseMsaaSamples, idleMsaaMin);
            }
            // Focus zoom: prioritize clarity around very-close tracking views.
            if (cameraHeight <= focusSharpHeight) {
                nextResolution = Math.max(nextResolution, Math.max(baseResolution, focusResolutionScale));
                nextMsaaSamples = Math.max(nextMsaaSamples, focusMsaaSamples);
                nextFxaaEnabled = baseFxaaEnabled;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, 0.24);
                nextSse = Math.min(nextSse, Math.min(baseSse, closeSse));
            } else if (cameraHeight <= closeSharpHeight) {
                // Close zoom (~30k-40k and nearby): keep map very clear without heavy overdraw.
                nextResolution = Math.max(nextResolution, Math.max(baseResolution, closeResolutionScale));
                nextMsaaSamples = Math.max(nextMsaaSamples, closeMsaaSamples);
                nextFxaaEnabled = baseFxaaEnabled;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, 0.36);
                nextSse = Math.min(nextSse, Math.min(baseSse, closeSse));
            } else if (cameraHeight <= nearSharpHeight) {
                // General near-zoom floor for readability.
                nextResolution = Math.max(1, baseResolution);
                nextMsaaSamples = Math.max(1, Math.min(2, baseMsaaSamples));
                nextFxaaEnabled = baseFxaaEnabled;
                nextSse = Math.min(nextSse, Math.max(1.25, baseSse));
            }
            if (isCameraMoving) {
                // While camera is moving, keep interaction responsive by easing quality cost.
                nextResolution = Math.max(
                    movingResolutionFloor,
                    Math.min(nextResolution, Math.max(movingResolutionFloor, baseResolution * 0.88))
                );
                nextMsaaSamples = Math.max(1, Math.min(nextMsaaSamples, movingMsaaSamples));
                nextFxaaEnabled = baseFxaaEnabled;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, 0.5);
                nextSse = Math.max(nextSse, movingSse);
                nextTileCache = Math.min(nextTileCache, movingTileCache);
                nextPreloadSiblings = false;
            }
            if (tileLoadBusy && !is2DMode) {
                nextResolution = Math.min(
                    nextResolution,
                    clamp(numberVar("--warzone-globe-loading-resolution-scale", 0.86), 0.5, 1)
                );
                nextMsaaSamples = 1;
                nextFxaaEnabled = true;
                nextSse = Math.max(
                    nextSse,
                    clamp(numberVar("--warzone-globe-loading-screen-space-error", 3.1), 1.4, 6)
                );
                nextTileCache = Math.min(nextTileCache, loadingTileCache);
                nextLoadingDescendantLimit = Math.min(nextLoadingDescendantLimit, busyLoadingDescendantLimit);
                nextPreloadSiblings = false;
            }
            const focusSceneSettled = isAircraftFocusMode && !isCameraMoving && !tileLoadBusy;
            if (isAircraftFocusMode) {
                if (focusSceneSettled) {
                    nextResolution = Math.max(nextResolution, focusPerformanceResolutionScale);
                    nextMsaaSamples = Math.max(nextMsaaSamples, focusPerformanceMsaaSamples);
                    nextSse = Math.min(nextSse, focusPerformanceSse);
                } else {
                    // Keep the focused GLB readable while camera motion or tile loading is active.
                    nextResolution = Math.max(nextResolution, Math.min(baseResolution, 1));
                    nextMsaaSamples = Math.max(nextMsaaSamples, Math.min(2, focusMsaaSamples));
                }
                nextFxaaEnabled = true;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, focusPerformanceRenderTime);
                nextTileCache = Math.min(nextTileCache, focusPerformanceTileCache);
                if (tileLoadBusy) {
                    nextLoadingDescendantLimit = Math.min(nextLoadingDescendantLimit, Math.max(4, busyLoadingDescendantLimit - 2));
                }
                nextPreloadSiblings = false;
            }
            if (adaptiveCaps.forceFxaaEnabled) {
                nextFxaaEnabled = true;
            }
            nextResolution = Math.min(nextResolution, adaptiveCaps.maxResolutionScale);
            nextMsaaSamples = Math.min(nextMsaaSamples, adaptiveCaps.maxMsaaSamples);
            nextSse = Math.max(nextSse, adaptiveCaps.minSse);
            nextTileCache = Math.min(nextTileCache, adaptiveCaps.maxTileCache);
            if (adaptiveCaps.forcePreloadSiblingsFalse) {
                nextPreloadSiblings = false;
            }
            if (isAircraftFocusMode) {
                const focusResolutionFloor = focusSceneSettled
                    ? Math.min(focusResolutionScale, 1.12)
                    : Math.min(baseResolution, 1);
                nextResolution = Math.max(nextResolution, focusResolutionFloor);
                if (focusSceneSettled) {
                    nextMsaaSamples = Math.max(nextMsaaSamples, 2);
                    nextSse = Math.min(nextSse, Math.max(1.15, closeSse));
                }
            }
            nextResolution = Math.min(nextResolution, hardMaxResolutionScale);
            nextMsaaSamples = Math.min(nextMsaaSamples, hardMaxMsaaSamples);
            nextSse = clamp(nextSse, 0.8, 6);
            nextTileCache = Math.max(140, Math.min(720, Math.round(nextTileCache)));
            nextLoadingDescendantLimit = Math.max(4, Math.min(72, Math.round(nextLoadingDescendantLimit)));
            if (is2DMode) {
                // Keep 2D map luminance stable: avoid adaptive quality oscillation that can look like
                // dark/light pumping while tiles stream and counters update.
                nextResolution = baseResolution;
                nextMaximumRenderTime = Infinity;
                nextMsaaSamples = baseMsaaSamples;
                nextFxaaEnabled = baseFxaaEnabled;
                nextSse = baseSse;
                nextTileCache = baseTileCache;
                nextLoadingDescendantLimit = baseLoadingDescendantLimit;
                nextPreloadSiblings = basePreloadSiblings;
            }
            const prevPerfState = viewer.__warzonePerformanceState || {};
            if (prevPerfState.resolutionScale !== nextResolution) {
                viewer.resolutionScale = nextResolution;
            }
            if (prevPerfState.maximumRenderTimeChange !== nextMaximumRenderTime) {
                viewer.scene.maximumRenderTimeChange = nextMaximumRenderTime;
            }
            if (prevPerfState.maximumScreenSpaceError !== nextSse) {
                viewer.scene.globe.maximumScreenSpaceError = nextSse;
            }
            if (Number.isFinite(nextMsaaSamples) && prevPerfState.msaaSamples !== nextMsaaSamples) {
                viewer.scene.msaaSamples = nextMsaaSamples;
            }
            if (viewer.scene.postProcessStages?.fxaa && prevPerfState.fxaaEnabled !== nextFxaaEnabled) {
                viewer.scene.postProcessStages.fxaa.enabled = nextFxaaEnabled;
            }
            if (prevPerfState.tileCacheSize !== nextTileCache) {
                viewer.scene.globe.tileCacheSize = nextTileCache;
            }
            if (prevPerfState.loadingDescendantLimit !== nextLoadingDescendantLimit) {
                viewer.scene.globe.loadingDescendantLimit = nextLoadingDescendantLimit;
            }
            if (prevPerfState.preloadSiblings !== nextPreloadSiblings) {
                viewer.scene.globe.preloadSiblings = nextPreloadSiblings;
            }
            viewer.__warzonePerformanceState = {
                resolutionScale: nextResolution,
                maximumRenderTimeChange: nextMaximumRenderTime,
                maximumScreenSpaceError: nextSse,
                msaaSamples: nextMsaaSamples,
                fxaaEnabled: nextFxaaEnabled,
                tileCacheSize: nextTileCache,
                loadingDescendantLimit: nextLoadingDescendantLimit,
                preloadSiblings: nextPreloadSiblings,
                visibleCount: count,
                cameraHeight,
                isCameraMoving,
                isAircraftFocusMode,
                tileLoadQueueSize,
                tileLoadBusy,
                adaptiveProfile,
            };
            viewer.scene.requestRenderMode = true;
        },
        highlightAlertRegion(event) {
            highlightAlertRegion(viewer, event);
        },
        clearAlertHighlight() {
            clearAlertHighlight(viewer);
        },
        animateMissileTrack(event) {
            return animateMissileTrack(viewer, event);
        },
        clearMissileTrack(id) {
            if (id) {
                clearOneMissileTrack(viewer, id);
            } else {
                clearAllMissileTracks(viewer);
            }
        },
        clearAllMissileTracks() {
            clearAllMissileTracks(viewer);
        },
        startAlertLoopSound() {
            startMissileAlertSound(viewer);
        },
        stopAlertLoopSound() {
            stopMissileAlertSound(viewer);
        },
        playImpactSound() {
            playImpactSound(viewer);
        },
    };
    if (!viewer.__warzonePerfZoomBound) {
        viewer.__warzonePerfZoomBound = true;
        let perfRaf = 0;
        let moveSettleTimer = 0;
        const queuePerfSync = () => {
            if (perfRaf) return;
            perfRaf = requestAnimationFrame(() => {
                perfRaf = 0;
                const count = Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0));
                viewer.__warzone?.setPerformanceMode?.(count);
                viewer.scene.requestRender?.();
            });
        };
        viewer.camera.moveStart.addEventListener(() => {
            clearTimeout(moveSettleTimer);
            viewer.__warzoneCameraMoving = true;
            queuePerfSync();
        });
        viewer.camera.moveEnd.addEventListener(queuePerfSync);
        viewer.camera.moveEnd.addEventListener(() => {
            clearTimeout(moveSettleTimer);
            moveSettleTimer = window.setTimeout(() => {
                viewer.__warzoneCameraMoving = false;
                queuePerfSync();
            }, 360);
        });
        if (viewer.scene?.globe?.tileLoadProgressEvent?.addEventListener) {
            let tileLoadSettleTimer = 0;
            viewer.scene.globe.tileLoadProgressEvent.addEventListener((queueLength = 0) => {
                const nextQueueSize = Math.max(0, Number(queueLength || 0));
                viewer.__warzoneTileLoadQueueSize = nextQueueSize;
                const busy = nextQueueSize > 0;
                if (busy) {
                    if (tileLoadSettleTimer) {
                        window.clearTimeout(tileLoadSettleTimer);
                        tileLoadSettleTimer = 0;
                    }
                    if (viewer.__warzoneTileLoadBusy !== true) {
                        viewer.__warzoneTileLoadBusy = true;
                        queuePerfSync();
                    }
                    return;
                }
                if (tileLoadSettleTimer) {
                    window.clearTimeout(tileLoadSettleTimer);
                }
                tileLoadSettleTimer = window.setTimeout(() => {
                    tileLoadSettleTimer = 0;
                    if (viewer.__warzoneTileLoadBusy !== false || viewer.__warzoneTileLoadQueueSize !== 0) {
                        viewer.__warzoneTileLoadBusy = false;
                        viewer.__warzoneTileLoadQueueSize = 0;
                        queuePerfSync();
                    }
                }, 520);
            });
        }
    }
    bindContourViewportRefresh(viewer);
    return viewer;
}
