// File Path: /assets/js/warzone-aoi-lens.js
import * as Cesium from "cesium";
import { getAllLiveTrackSnapshots } from "./warzone-live-airforce.js";
import { getAllNavalSnapshots } from "./warzone-live-naval.js";
import { isEventVisible } from "./warzone-layers.js";
import { hasTrustedMapCoordinates } from "../../../apps/shared/event-location-policy.js";

const AOI_SOURCE_NAME = "warzone-aoi-lens";
const EARTH_RADIUS_KM = 6371.0088;
const NEAR_RADIUS_KM = 75;
const MIN_DRAW_DEGREES = 0.03;
const SEVERITY_RANK = Object.freeze({
    critical: 5,
    severe: 5,
    high: 4,
    elevated: 3,
    medium: 3,
    moderate: 3,
    low: 2,
    monitoring: 1,
    unknown: 0,
});

let basesModulePromise = null;
const vertexHandleImageCache = new Map();

const state = {
    viewer: null,
    dataSource: null,
    active: false,
    drawing: false,
    editing: false,
    pointerId: null,
    start: null,
    current: null,
    polygon: [],
    armedVertexIndex: -1,
    editVertexIndex: -1,
    panel: null,
    panelBody: null,
    clearButton: null,
    closeButton: null,
    desktopButton: null,
    mobileButton: null,
    quickButton: null,
    panelObserver: null,
    suppressNextClick: false,
    hiddenForModal: false,
};

export function initWarzoneAoiLens(viewer) {
    if (!viewer?.scene?.canvas || state.viewer === viewer) return window.__warzoneAoiLens;
    state.viewer = viewer;
    state.dataSource = new Cesium.CustomDataSource(AOI_SOURCE_NAME);
    viewer.dataSources.add(state.dataSource);
    ensurePanel();
    hidePanel();
    bindToolbarButtons();
    setButtonState(false);
    syncToolbarAvailability();
    bindCanvasDrawing();
    bindFocusDismiss();
    bindModalVisibility();
    window.__warzoneAoiLens = {
        activate,
        clear: clearAoi,
        close,
        scanCurrent: () => state.polygon.length ? renderSummary(state.polygon) : null,
    };
    return window.__warzoneAoiLens;
}

function bindToolbarButtons() {
    state.desktopButton = document.getElementById("dock-aoi-lens");
    state.mobileButton = document.getElementById("wz-mobile-aoi-lens");
    state.quickButton = document.getElementById("wz-aoi-quick-open");
    [state.desktopButton, state.mobileButton, state.quickButton].forEach((button) => {
        if (!button || button.__wzAoiBound) return;
        button.__wzAoiBound = true;
        button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            activate();
            closeMobileMenu();
        });
    });
}

function bindCanvasDrawing() {
    const canvas = state.viewer?.scene?.canvas;
    if (!canvas || canvas.__wzAoiBound) return;
    canvas.__wzAoiBound = true;
    canvas.addEventListener("pointerdown", onPointerDown, true);
    canvas.addEventListener("pointermove", onPointerMove, true);
    canvas.addEventListener("pointerup", onPointerUp, true);
    canvas.addEventListener("pointercancel", onPointerCancel, true);
    canvas.addEventListener("click", onCanvasClick, true);
    window.addEventListener("keydown", onKeyDown, true);
}

function activate() {
    if (!state.viewer) return;
    showPanel();
    state.active = true;
    state.drawing = false;
    state.editing = false;
    state.start = null;
    state.current = null;
    state.pointerId = null;
    state.armedVertexIndex = -1;
    state.editVertexIndex = -1;
    document.body.classList.add("is-aoi-lens-active");
    setButtonState(true);
    setPanelBody(`
        <div class="wz-aoi-status wz-aoi-status--scan">Drag across the map to draw an AOI box.</div>
        <div class="wz-aoi-empty">Release to scan. Press Esc to cancel. After the scan, click a corner handle to arm it, then drag to resize the AOI.</div>
    `);
}

function clearAoi({ keepPanel = true } = {}) {
    state.active = false;
    state.drawing = false;
    state.editing = false;
    state.pointerId = null;
    state.start = null;
    state.current = null;
    state.polygon = [];
    state.armedVertexIndex = -1;
    state.editVertexIndex = -1;
    state.dataSource?.entities?.removeAll?.();
    applyDataSourceVisibility();
    document.body.classList.remove("is-aoi-lens-active", "is-aoi-drawing");
    setButtonState(false);
    state.viewer?.scene?.requestRender?.();
    if (keepPanel) {
        showPanel();
        setPanelBody(`
            <div class="wz-aoi-empty">AOI cleared. Draw a new area when ready.</div>
            <button type="button" class="btn-primary wz-aoi-redraw-btn" data-aoi-redraw>
                <span aria-hidden="true"></span>Draw AOI
            </button>
        `);
    }
}

function close() {
    clearAoi({ keepPanel: false });
    hidePanel();
}

function onPointerDown(event) {
    if (event.button !== 0) return;
    if (!state.active && state.polygon.length) {
        const vertexIndex = pickVertexIndex(event);
        if (vertexIndex >= 0) {
            if (state.armedVertexIndex === vertexIndex) {
                const point = pickLonLat(event);
                if (!point) return;
                state.editing = true;
                state.editVertexIndex = vertexIndex;
                state.pointerId = event.pointerId;
                state.current = point;
                document.body.classList.add("is-aoi-drawing");
                event.target?.setPointerCapture?.(event.pointerId);
                consumePointerEvent(event);
                return;
            }
            state.armedVertexIndex = vertexIndex;
            state.editVertexIndex = -1;
            drawSelection(state.polygon);
            setPanelBody(`
                <div class="wz-aoi-status wz-aoi-status--scan">Corner handle armed.</div>
                <div class="wz-aoi-empty">Drag the highlighted handle to resize the AOI. Click it again to cancel editing.</div>
            `);
            consumePointerEvent(event);
            return;
        }
        if (state.armedVertexIndex >= 0) {
            state.armedVertexIndex = -1;
            state.editVertexIndex = -1;
            drawSelection(state.polygon);
        }
    }
    if (!state.active) return;
    const point = pickLonLat(event);
    if (!point) return;
    state.drawing = true;
    state.pointerId = event.pointerId;
    state.start = point;
    state.current = point;
    document.body.classList.add("is-aoi-drawing");
    event.target?.setPointerCapture?.(event.pointerId);
    consumePointerEvent(event);
    drawPreview(rectangleToPolygon(state.start, state.current));
}

function onPointerMove(event) {
    if (state.editing && event.pointerId === state.pointerId) {
        const point = pickLonLat(event);
        if (!point) return;
        state.current = point;
        const nextPolygon = moveRectangleVertex(state.polygon, state.editVertexIndex, point);
        if (!isDrawablePolygon(nextPolygon)) return;
        state.polygon = nextPolygon;
        drawSelection(state.polygon);
        consumePointerEvent(event);
        return;
    }
    if (!state.active || !state.drawing || event.pointerId !== state.pointerId) return;
    const point = pickLonLat(event);
    if (!point) return;
    state.current = point;
    drawPreview(rectangleToPolygon(state.start, state.current));
    consumePointerEvent(event);
}

async function onPointerUp(event) {
    if (state.editing && event.pointerId === state.pointerId) {
        consumePointerEvent(event);
        event.target?.releasePointerCapture?.(event.pointerId);
        state.editing = false;
        state.pointerId = null;
        document.body.classList.remove("is-aoi-drawing");
        drawSelection(state.polygon);
        await renderSummary(state.polygon);
        return;
    }
    if (!state.active || !state.drawing || event.pointerId !== state.pointerId) return;
    consumePointerEvent(event);
    event.target?.releasePointerCapture?.(event.pointerId);
    const end = pickLonLat(event) || state.current;
    state.current = end;
    state.drawing = false;
    state.pointerId = null;
    document.body.classList.remove("is-aoi-drawing");
    const polygon = rectangleToPolygon(state.start, state.current);
    if (!isDrawablePolygon(polygon)) {
        drawPreview([]);
        setPanelBody(`<div class="wz-aoi-empty">AOI was too small. Drag a larger area to scan.</div>`);
        return;
    }
    state.active = false;
    state.polygon = polygon;
    setButtonState(false);
    document.body.classList.remove("is-aoi-lens-active");
    state.suppressNextClick = true;
    drawSelection(polygon);
    await renderSummary(polygon);
}

function onPointerCancel(event) {
    if ((state.drawing || state.editing) && event.pointerId === state.pointerId) {
        state.drawing = false;
        state.editing = false;
        state.pointerId = null;
        document.body.classList.remove("is-aoi-drawing");
        consumePointerEvent(event);
        if (state.polygon.length) drawSelection(state.polygon);
        return;
    }
    if (!state.drawing || event.pointerId !== state.pointerId) return;
    state.drawing = false;
    state.pointerId = null;
    document.body.classList.remove("is-aoi-drawing");
    consumePointerEvent(event);
}

function onCanvasClick(event) {
    if (!state.active && !state.suppressNextClick && state.armedVertexIndex < 0) return;
    if (state.suppressNextClick) state.suppressNextClick = false;
    consumePointerEvent(event);
}

function onKeyDown(event) {
    if (event.key !== "Escape") return;
    if (!state.active && !state.polygon.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (state.armedVertexIndex >= 0 && state.polygon.length) {
        state.armedVertexIndex = -1;
        state.editVertexIndex = -1;
        state.editing = false;
        drawSelection(state.polygon);
        return;
    }
    close();
}

function bindFocusDismiss() {
    if (document.body?.__wzAoiFocusDismissBound) return;
    document.body.__wzAoiFocusDismissBound = true;
    document.addEventListener("wz:aircraft-track-selected", (event) => {
        const mode = String(event?.detail?.mode || "");
        if (mode === "focus") {
            close();
        }
    });
}

function bindModalVisibility() {
    if (document.body?.__wzAoiModalVisibilityBound) return;
    document.body.__wzAoiModalVisibilityBound = true;
    document.addEventListener("wz:ui-modal-visibility", (event) => {
        const modalId = String(event?.detail?.modalId || "");
        if (modalId !== "wz-about-modal" && modalId !== "wz-donate-modal") return;
        state.hiddenForModal = Boolean(event?.detail?.isOpen);
        applyDataSourceVisibility();
        if (!state.hiddenForModal) {
            window.setTimeout(restorePanelVisibilityIfNeeded, 120);
        }
    });
    document.addEventListener("fullscreenchange", () => {
        window.setTimeout(restorePanelVisibilityIfNeeded, 120);
    }, true);
}

function applyDataSourceVisibility() {
    if (!state.dataSource) return;
    state.dataSource.show = !state.hiddenForModal;
    state.viewer?.scene?.requestRender?.();
}

function shouldKeepPanelVisible() {
    return Boolean(
        !state.hiddenForModal &&
        state.panel &&
        (state.active || state.drawing || state.editing || state.polygon.length)
    );
}

function restorePanelVisibilityIfNeeded() {
    if (!shouldKeepPanelVisible()) return;
    if (state.panel.classList.contains("wz-is-hidden")) {
        state.panel.classList.remove("wz-is-hidden");
        syncToolbarAvailability();
    }
}

function consumePointerEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
}

function pickLonLat(event) {
    const canvas = state.viewer?.scene?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
    const cartesian = state.viewer.camera.pickEllipsoid(position, state.viewer.scene.globe.ellipsoid);
    if (!cartesian) return null;
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    return {
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lon: Cesium.Math.toDegrees(cartographic.longitude),
    };
}

function rectangleToPolygon(start, end) {
    if (!start || !end) return [];
    const minLat = Math.min(start.lat, end.lat);
    const maxLat = Math.max(start.lat, end.lat);
    const minLon = Math.min(start.lon, end.lon);
    const maxLon = Math.max(start.lon, end.lon);
    return [
        { lat: minLat, lon: minLon },
        { lat: minLat, lon: maxLon },
        { lat: maxLat, lon: maxLon },
        { lat: maxLat, lon: minLon },
    ];
}

function moveRectangleVertex(polygon = [], vertexIndex = -1, point = null) {
    if (!point || polygon.length !== 4 || vertexIndex < 0 || vertexIndex > 3) return polygon;
    const opposite = polygon[(vertexIndex + 2) % 4];
    if (!opposite) return polygon;
    return rectangleToPolygon(point, opposite);
}

function isDrawablePolygon(polygon = []) {
    const bounds = getBounds(polygon);
    if (!bounds) return false;
    return Math.abs(bounds.maxLat - bounds.minLat) >= MIN_DRAW_DEGREES &&
        Math.abs(bounds.maxLon - bounds.minLon) >= MIN_DRAW_DEGREES;
}

function drawPreview(polygon) {
    state.dataSource?.entities?.removeAll?.();
    applyDataSourceVisibility();
    if (!polygon?.length) return;
    addPolygonEntities(polygon, { preview: true });
}

function drawSelection(polygon) {
    state.dataSource?.entities?.removeAll?.();
    applyDataSourceVisibility();
    addPolygonEntities(polygon, { preview: false, armedVertexIndex: state.armedVertexIndex });
    state.viewer?.scene?.requestRender?.();
}

function addPolygonEntities(polygon, { preview = false, armedVertexIndex = -1 } = {}) {
    const positions = polygonToCartesian(polygon);
    const closedPositions = polygonToCartesian([...polygon, polygon[0]]);
    const center = getPolygonCenter(polygon);
    const bottomCenter = getBottomEdgeCenter(polygon);
    const areaKm2 = getApproxPolygonAreaKm2(polygon);
    const fillColor = Cesium.Color.fromCssColorString(preview ? "rgba(24,226,219,0.14)" : "rgba(24,226,219,0.20)");
    const lineColor = Cesium.Color.fromCssColorString(preview ? "rgba(238,240,245,0.86)" : "rgba(24,226,219,0.95)");
    state.dataSource.entities.add({
        id: `${AOI_SOURCE_NAME}-fill`,
        polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: fillColor,
            outline: false,
            classificationType: Cesium.ClassificationType.BOTH,
        },
    });
    state.dataSource.entities.add({
        id: `${AOI_SOURCE_NAME}-outline`,
        polyline: {
            positions: closedPositions,
            width: preview ? 2 : 3,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: preview ? 0.12 : 0.18,
                color: lineColor,
            }),
            clampToGround: false,
        },
    });
    polygon.forEach((point, index) => {
        const isArmed = !preview && index === armedVertexIndex;
        state.dataSource.entities.add({
            id: `${AOI_SOURCE_NAME}-vertex-${index}`,
            position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0),
            properties: {
                wzAoiVertexIndex: index,
            },
            billboard: {
                image: getVertexHandleImage({ preview, armed: isArmed }),
                width: preview ? 12 : isArmed ? 18 : 15,
                height: preview ? 12 : isArmed ? 18 : 15,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
            },
        });
    });
    if (center) {
        state.dataSource.entities.add({
            id: `${AOI_SOURCE_NAME}-label`,
            position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 0),
            label: {
                text: preview ? "DRAW AOI" : "SELECTED AOI",
                font: "700 13px sans-serif",
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.75)"),
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -22),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
    }
    if (bottomCenter && areaKm2 > 0) {
        state.dataSource.entities.add({
            id: `${AOI_SOURCE_NAME}-area-label`,
            position: Cesium.Cartesian3.fromDegrees(bottomCenter.lon, bottomCenter.lat, 0),
            label: {
                text: `AREA ${Math.round(areaKm2).toLocaleString()} KM2`,
                font: "700 12px sans-serif",
                fillColor: preview
                    ? Cesium.Color.fromCssColorString("rgba(24,226,219,0.96)")
                    : Cesium.Color.fromCssColorString("rgba(238,240,245,0.96)"),
                outlineColor: Cesium.Color.fromCssColorString("rgba(0,0,0,0.82)"),
                outlineWidth: 3,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, 26),
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
    }
    state.viewer?.scene?.requestRender?.();
}

function pickVertexIndex(event) {
    const canvas = state.viewer?.scene?.canvas;
    if (!canvas || !state.viewer?.scene?.pick) return -1;
    const rect = canvas.getBoundingClientRect();
    const position = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top);
    let picked = null;
    try {
        picked = state.viewer.scene.pick(position);
    } catch {
        picked = null;
    }
    const entity = picked?.id || picked?.primitive?.id || picked?.primitive?._id || null;
    const explicitIndex = Number(entity?.properties?.wzAoiVertexIndex?.getValue?.());
    if (Number.isInteger(explicitIndex)) return explicitIndex;
    const match = String(entity?.id || "").match(/warzone-aoi-lens-vertex-(\d+)/);
    return match ? Number(match[1]) : -1;
}

function polygonToCartesian(polygon = []) {
    return polygon.map((point) => Cesium.Cartesian3.fromDegrees(point.lon, point.lat, 0));
}

async function renderSummary(polygon) {
    showPanel();
    setPanelBody(`<div class="wz-aoi-status wz-aoi-status--scan">Scanning current StratOps layers...</div>`);
    const summary = await buildSummary(polygon);
    setPanelBody(renderSummaryHtml(summary));
    return summary;
}

async function buildSummary(polygon) {
    const center = getPolygonCenter(polygon);
    const areaKm2 = getApproxPolygonAreaKm2(polygon);
    const events = getCurrentEvents().filter((event) => pointInsidePolygon(getEventPoint(event), polygon));
    const aircraft = getAircraftMatches(polygon);
    const naval = getNavalMatches(polygon);
    const bases = await getBaseMatches(polygon);
    const routes = countCrossingRoutes([...aircraft.all, ...naval.all], polygon);
    const severity = getHighestSeverity(events);
    return {
        label: "Selected AOI",
        center,
        areaKm2,
        events,
        severity,
        grouped: {
            severity: topGroups(events, (event) => normalizeSeverity(event.severity || event.alert_level || event.priority_label)),
            source: topGroups(events, (event) => event.source_name || event.source || "Unknown source"),
            type: topGroups(events, (event) => event.category || event.type || event.event_type || "Unknown type"),
        },
        timeline: getTimelineCounts(events),
        aircraft,
        naval,
        bases,
        routes,
        readout: buildOperationalReadout({ events, severity, aircraft, naval, bases, routes }),
    };
}

function getCurrentEvents() {
    const snapshot = window.__getWarzoneAoiDataSnapshot?.() || {};
    const source = snapshot.events?.length ? snapshot.events : snapshot.filteredEvents?.length ? snapshot.filteredEvents : snapshot.allEvents || [];
    return source.filter((event) => {
        const point = getEventPoint(event);
        if (!point) return false;
        try {
            return isEventVisible(event);
        } catch (_error) {
            return true;
        }
    });
}

function getAircraftMatches(polygon) {
    const all = safeArray(getAllLiveTrackSnapshots({ includePathHistory: true }));
    const matches = all.filter((track) => isPointInsideOrNear(getTrackPoint(track), polygon, NEAR_RADIUS_KM));
    return { all, matches, inside: matches.filter((track) => pointInsidePolygon(getTrackPoint(track), polygon)) };
}

function getNavalMatches(polygon) {
    const all = safeArray(getAllNavalSnapshots());
    const matches = all.filter((vessel) => isPointInsideOrNear(getTrackPoint(vessel), polygon, NEAR_RADIUS_KM));
    return { all, matches, inside: matches.filter((vessel) => pointInsidePolygon(getTrackPoint(vessel), polygon)) };
}

async function getBaseMatches(polygon) {
    try {
        if (!basesModulePromise) basesModulePromise = import("./warzone-military-bases-data.js");
        const module = await basesModulePromise;
        return safeArray(module.MILITARY_BASES)
            .filter((base) => pointInsidePolygon(getBasePoint(base), polygon))
            .slice(0, 24);
    } catch (error) {
        console.warn("AOI military base scan failed:", error);
        return [];
    }
}

function getEventPoint(event = {}) {
    const lat = Number(event.display_lat ?? event.lat ?? event.impact_lat);
    const lon = Number(event.display_lon ?? event.lon ?? event.impact_lon);
    return hasTrustedMapCoordinates(event, { lat, lon }) ? { lat, lon } : null;
}

function getTrackPoint(track = {}) {
    const lat = Number(track.lat ?? track.latitude ?? track.position?.lat);
    const lon = Number(track.lon ?? track.lng ?? track.longitude ?? track.position?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function getBasePoint(base = {}) {
    const lat = Number(base.lat ?? base.coordinates?.lat);
    const lon = Number(base.lon ?? base.lng ?? base.coordinates?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

function pointInsidePolygon(point, polygon = []) {
    if (!point || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lon;
        const yi = polygon[i].lat;
        const xj = polygon[j].lon;
        const yj = polygon[j].lat;
        const intersects = ((yi > point.lat) !== (yj > point.lat)) &&
            (point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function isPointInsideOrNear(point, polygon, radiusKm) {
    if (!point) return false;
    if (pointInsidePolygon(point, polygon)) return true;
    return distanceToBoundsKm(point, getBounds(polygon)) <= radiusKm;
}

function distanceToBoundsKm(point, bounds) {
    if (!bounds) return Number.POSITIVE_INFINITY;
    const meanLat = (bounds.minLat + bounds.maxLat) / 2;
    const kmPerLon = Math.max(0.001, 111.32 * Math.cos(Cesium.Math.toRadians(meanLat)));
    const dxDeg = point.lon < bounds.minLon ? bounds.minLon - point.lon : point.lon > bounds.maxLon ? point.lon - bounds.maxLon : 0;
    const dyDeg = point.lat < bounds.minLat ? bounds.minLat - point.lat : point.lat > bounds.maxLat ? point.lat - bounds.maxLat : 0;
    return Math.sqrt((dxDeg * kmPerLon) ** 2 + (dyDeg * 110.57) ** 2);
}

function countCrossingRoutes(items = [], polygon = []) {
    return items.filter((item) => {
        const path = safeArray(item.path_history || item.trail || item.positions)
            .map(getTrackPoint)
            .filter(Boolean);
        if (path.length < 2) return false;
        if (path.some((point) => pointInsidePolygon(point, polygon))) return true;
        for (let i = 1; i < path.length; i += 1) {
            if (segmentIntersectsPolygon(path[i - 1], path[i], polygon)) return true;
        }
        return false;
    }).length;
}

function segmentIntersectsPolygon(a, b, polygon) {
    for (let i = 0; i < polygon.length; i += 1) {
        if (segmentsIntersect(a, b, polygon[i], polygon[(i + 1) % polygon.length])) return true;
    }
    return false;
}

function segmentsIntersect(a, b, c, d) {
    const direction = (p, q, r) => ((r.lon - p.lon) * (q.lat - p.lat)) - ((q.lon - p.lon) * (r.lat - p.lat));
    const d1 = direction(c, d, a);
    const d2 = direction(c, d, b);
    const d3 = direction(a, b, c);
    const d4 = direction(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function getBounds(polygon = []) {
    if (!polygon.length) return null;
    return polygon.reduce((bounds, point) => ({
        minLat: Math.min(bounds.minLat, point.lat),
        maxLat: Math.max(bounds.maxLat, point.lat),
        minLon: Math.min(bounds.minLon, point.lon),
        maxLon: Math.max(bounds.maxLon, point.lon),
    }), { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 });
}

function getPolygonCenter(polygon = []) {
    const bounds = getBounds(polygon);
    return bounds ? { lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2 } : null;
}

function getBottomEdgeCenter(polygon = []) {
    if (polygon.length < 2) return null;
    const first = polygon[0];
    const second = polygon[1];
    if (!first || !second) return null;
    return {
        lat: (Number(first.lat) + Number(second.lat)) / 2,
        lon: (Number(first.lon) + Number(second.lon)) / 2,
    };
}

function getApproxPolygonAreaKm2(polygon = []) {
    if (polygon.length < 3) return 0;
    const meanLat = polygon.reduce((sum, point) => sum + point.lat, 0) / polygon.length;
    const projected = polygon.map((point) => ({
        x: EARTH_RADIUS_KM * Cesium.Math.toRadians(point.lon) * Math.cos(Cesium.Math.toRadians(meanLat)),
        y: EARTH_RADIUS_KM * Cesium.Math.toRadians(point.lat),
    }));
    let sum = 0;
    for (let i = 0; i < projected.length; i += 1) {
        const j = (i + 1) % projected.length;
        sum += projected[i].x * projected[j].y - projected[j].x * projected[i].y;
    }
    return Math.abs(sum) / 2;
}

function getHighestSeverity(events = []) {
    return events.reduce((highest, event) => {
        const severity = normalizeSeverity(event.severity || event.alert_level || event.priority_label);
        return severityRank(severity) > severityRank(highest) ? severity : highest;
    }, "unknown");
}

function normalizeSeverity(value = "") {
    const key = String(value || "unknown").trim().toLowerCase();
    if (key.includes("critical") || key.includes("severe")) return "critical";
    if (key.includes("high")) return "high";
    if (key.includes("medium") || key.includes("moderate") || key.includes("elevated")) return "medium";
    if (key.includes("low") || key.includes("monitor")) return "low";
    return key || "unknown";
}

function severityRank(value) {
    return SEVERITY_RANK[normalizeSeverity(value)] ?? 0;
}

function topGroups(items = [], getKey) {
    const counts = new Map();
    items.forEach((item) => {
        const key = cleanLabel(getKey(item));
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, 5);
}

function getTimelineCounts(events = []) {
    const now = Date.now();
    const windows = [
        ["1h", 60 * 60 * 1000],
        ["6h", 6 * 60 * 60 * 1000],
        ["24h", 24 * 60 * 60 * 1000],
        ["48h", 48 * 60 * 60 * 1000],
        ["7d", 7 * 24 * 60 * 60 * 1000],
    ];
    return windows.map(([label, ms]) => ({
        label,
        count: events.filter((event) => {
            const time = Date.parse(event.occurred_at || event.created_at || event.published_at || event.timestamp || "");
            return Number.isFinite(time) && now - time <= ms;
        }).length,
    }));
}

function buildOperationalReadout({ events, severity, aircraft, naval, bases, routes }) {
    if (!events.length && !aircraft.matches.length && !naval.matches.length && !bases.length) {
        return "No mapped events or active assets are currently inside this AOI. Maintain baseline monitoring and widen the scan if the area should contain activity.";
    }
    const parts = [];
    if (events.length) parts.push(`${events.length} mapped event${events.length === 1 ? "" : "s"} detected with highest severity ${severity}.`);
    if (aircraft.matches.length || naval.matches.length) parts.push(`${aircraft.matches.length} aircraft and ${naval.matches.length} naval contact${naval.matches.length === 1 ? "" : "s"} are inside or within ${NEAR_RADIUS_KM} km.`);
    if (bases.length) parts.push(`${bases.length} known strategic location${bases.length === 1 ? "" : "s"} fall inside the AOI.`);
    if (routes > 0) parts.push(`${routes} active route/trail crossing${routes === 1 ? "" : "s"} intersect the selected area.`);
    parts.push(severityRank(severity) >= 4 || aircraft.matches.length + naval.matches.length >= 5 ? "Operational posture: elevated attention recommended." : "Operational posture: monitor for changes.");
    return parts.join(" ");
}

function renderSummaryHtml(summary) {
    const center = summary.center ? `${formatCoord(summary.center.lat)} / ${formatCoord(summary.center.lon)}` : "Unknown";
    return `
        <div class="wz-aoi-grid">
            ${metric("Center", center)}
            ${metric("Area", `${Math.round(summary.areaKm2).toLocaleString()} km2`)}
            ${metric("Events", summary.events.length)}
            ${metric("Highest", cleanLabel(summary.severity))}
        </div>
        <div class="wz-aoi-readout">${escapeHtml(summary.readout)}</div>
        ${section("Timeline", renderTimeline(summary.timeline))}
        ${section("Events", renderGroups(summary.grouped))}
        ${section("Assets", renderAssets(summary))}
        ${section("Strategic Locations", renderBases(summary.bases))}
    `;
}

function metric(label, value) {
    return `<div class="wz-aoi-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function section(title, body) {
    return `
        <section class="wz-aoi-section">
            <h3>${escapeHtml(title)}</h3>
            <div class="wz-aoi-section__body">${body}</div>
        </section>
    `;
}

function renderTimeline(timeline) {
    if (!timeline.some((item) => item.count)) return `<p class="wz-aoi-empty">No timestamped AOI events in tracked windows.</p>`;
    return `<div class="wz-aoi-timeline">${timeline.map((item) => `<span><b>${escapeHtml(item.count)}</b>${escapeHtml(item.label)}</span>`).join("")}</div>`;
}

function renderGroups(grouped) {
    const groups = [
        ["Severity", grouped.severity],
        ["Source", grouped.source],
        ["Type", grouped.type],
    ];
    if (!groups.some(([, rows]) => rows.length)) return `<p class="wz-aoi-empty">No mapped events inside the selected AOI.</p>`;
    return groups.map(([label, rows]) => `
        <div class="wz-aoi-group">
            <span>${escapeHtml(label)}</span>
            <div>${rows.length ? rows.map((row) => `<em>${escapeHtml(row.label)} <b>${escapeHtml(row.count)}</b></em>`).join("") : "<em>None</em>"}</div>
        </div>
    `).join("");
}

function renderAssets(summary) {
    const rows = [
        ...summary.aircraft.matches.slice(0, 5).map((track) => assetName(track, "Aircraft")),
        ...summary.naval.matches.slice(0, 5).map((vessel) => assetName(vessel, "Vessel")),
    ];
    if (!rows.length && !summary.routes) return `<p class="wz-aoi-empty">No active aircraft/naval contacts inside or near this AOI.</p>`;
    return `
        <div class="wz-aoi-asset-counts">
            <span>${summary.aircraft.matches.length} aircraft near</span>
            <span>${summary.naval.matches.length} naval near</span>
            <span>${summary.routes} route crossings</span>
        </div>
        ${rows.length ? `<ul class="wz-aoi-list">${rows.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>` : ""}
    `;
}

function renderBases(bases) {
    if (!bases.length) return `<p class="wz-aoi-empty">No known strategic locations inside this AOI.</p>`;
    return `<ul class="wz-aoi-list">${bases.slice(0, 8).map((base) => `
        <li>${escapeHtml(base.name || "Known location")} <span>${escapeHtml(base.typeLabel || base.type || base.country || "")}</span></li>
    `).join("")}</ul>`;
}

function assetName(item, fallback) {
    return item.callsign || item.ident || item.flight || item.aircraft_name || item.vessel_name || item.title || item.track_key || fallback;
}

function cleanLabel(value) {
    return String(value || "Unknown").replace(/[_-]+/g, " ").trim() || "Unknown";
}

function formatCoord(value) {
    return Number(value).toFixed(4);
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function ensurePanel() {
    if (state.panel?.isConnected) return state.panel;
    const panel = document.querySelector('.warzone-widget[data-widget-id="aoi"]');
    if (!panel) return null;
    if (!panel.__wzAoiBound) {
        panel.__wzAoiBound = true;
        panel.querySelector("[data-aoi-clear]")?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            clearAoi();
        });
        panel.querySelector("[data-aoi-close]")?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            close();
        });
    }
    state.panel = panel;
    state.panelBody = panel.querySelector("#wz-aoi-panel-body");
    state.clearButton = panel.querySelector("[data-aoi-clear]");
    state.closeButton = panel.querySelector("[data-aoi-close]");
    if (!state.panelObserver && typeof MutationObserver === "function") {
        state.panelObserver = new MutationObserver(() => {
            restorePanelVisibilityIfNeeded();
        });
        state.panelObserver.observe(panel, { attributes: true, attributeFilter: ["class"] });
    }
    return panel;
}

function showPanel() {
    ensurePanel();
    state.panel?.classList.remove("wz-is-hidden");
    syncToolbarAvailability();
    restorePanelVisibilityIfNeeded();
}

function hidePanel() {
    state.panel?.classList.add("wz-is-hidden");
    syncToolbarAvailability();
}

function setPanelBody(html) {
    if (!state.panelBody) return;
    state.panelBody.innerHTML = html;
    state.panelBody.querySelector("[data-aoi-redraw]")?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activate();
    });
}

function setButtonState(active) {
    [state.desktopButton, state.mobileButton, state.quickButton].forEach((button) => {
        if (!button) return;
        button.classList.toggle("is-active", Boolean(active));
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

function syncToolbarAvailability() {
    const panelVisible = state.panel && !state.panel.classList.contains("wz-is-hidden");
    [state.desktopButton, state.mobileButton].forEach((button) => {
        if (!button) return;
        button.classList.toggle("wz-dock--gone", Boolean(panelVisible));
        button.setAttribute("aria-hidden", panelVisible ? "true" : "false");
    });
}

function getVertexHandleImage({ preview = false, armed = false } = {}) {
    const key = `${preview ? "preview" : "live"}:${armed ? "armed" : "idle"}`;
    if (vertexHandleImageCache.has(key)) return vertexHandleImageCache.get(key);
    const size = preview ? 32 : armed ? 40 : 36;
    const inset = preview ? 9 : armed ? 7 : 8;
    const fill = preview ? "rgba(238,240,245,0.95)" : armed ? "rgba(24,226,219,0.96)" : "rgba(238,240,245,0.96)";
    const stroke = preview ? "rgba(24,226,219,0.96)" : armed ? "rgba(238,240,245,0.98)" : "rgba(24,226,219,0.96)";
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = armed ? 3 : 2;
    ctx.beginPath();
    ctx.rect(inset, inset, size - (inset * 2), size - (inset * 2));
    ctx.fill();
    ctx.stroke();
    const image = canvas.toDataURL("image/png");
    vertexHandleImageCache.set(key, image);
    return image;
}

function closeMobileMenu() {
    const menu = document.getElementById("wz-mobile-dock-menu");
    const backdrop = document.getElementById("wz-mobile-dock-backdrop");
    menu?.classList?.remove("is-open");
    backdrop?.classList?.remove("is-open");
    menu?.setAttribute("aria-hidden", "true");
}
