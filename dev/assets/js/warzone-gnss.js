import * as Cesium from "cesium";
import { createOperationalGnssReveal } from "./warzone-gnss-reveal.js";
import { setDataSourceActive } from "./warzone-data-source-lifecycle.js";

const GNSS_LAYER_NAME = "warzone-gnss-interference";
const GNSS_TOOLTIP_ID = "wz-gnss-tooltip";
const GNSS_LEGEND_ID = "wz-gnss-legend";
const GNSS_LEGEND_DEMO_ID = "wz-gnss-legend-demo";
const GNSS_LEGEND_STATUS_ID = "wz-gnss-legend-status";
const GNSS_ENTITY_PROP_KEY = "isGnssCell";
const GNSS_FALLBACK_COLORS = {
    fill: {
        low: "rgba(13, 233, 79, 0.3)",
        medium: "rgba(252, 255, 77, 0.3)",
        high: "rgba(138, 67, 254, 0.3)",
        severe: "rgba(14, 127, 255, 0.3)",
        unknown: "rgba(100, 114, 133, 0.3)",
    },
    outline: {
        low: "rgba(13, 233, 79, 0.3)",
        medium: "rgba(252, 255, 77, 0.3)",
        high: "rgba(138, 67, 254, 0.3)",
        severe: "rgba(14, 127, 255, 0.3)",
        unknown: "rgba(100, 114, 133, 0.3)",
    },
};

const __gnssState = {
    dataSource: null,
    signature: "",
    styleSignature: "",
    visible: false,
    cellsById: new Map(),
    hoverEntity: null,
    activePanel: null,
    activePanelEntityId: "",
    handler: null,
    demoMode: false,
    trackingViewer: null,
    groundPrimitives: [],
    groundBuild: null,
    reveal: null,
    groundViewer: null,
    cameraCleanup: null,
    cameraMoving: false,
    settledRegion: "",
    batchGeneration: 0,
    sourceMode: "",
    showHexagons: true,
    severityFilter: "all",
    lastInput: null,
    controlsBound: false,
};

function cssNumber(name, fallback) {
    if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
    const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(raw) ? raw : fallback;
}

function cssColor(name, fallback) {
    if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return raw || fallback;
}

function readGnssTokens() {
    const tokens = {
        sizeKm: Math.max(6, cssNumber("--gnss-cell-size-km", 28)),
        heightOffset: Math.max(0, cssNumber("--gnss-cell-height-offset", 80)),
        outlineWidth: Math.max(0, cssNumber("--gnss-cell-outline-width", 1)),
        hoverOpacityBoost: Math.max(0, cssNumber("--gnss-cell-hover-opacity-boost", 0.14)),
        markerPixelSize: Math.max(14, cssNumber("--gnss-marker-size-px", 18)),
        markerOutlineWidth: Math.max(1, cssNumber("--gnss-marker-outline-width-px", 2)),
        markerScaleNearDistance: Math.max(1_000, cssNumber("--gnss-marker-scale-near-distance-m", 180000)),
        markerScaleNearValue: clamp(cssNumber("--gnss-marker-scale-near-value", 0.82), 0.3, 3),
        markerScaleFarDistance: Math.max(10_000, cssNumber("--gnss-marker-scale-far-distance-m", 8000000)),
        markerScaleFarValue: clamp(cssNumber("--gnss-marker-scale-far-value", 1.65), 0.3, 4),
        fill: {
            low: cssColor("--gnss-cell-fill-low", "rgba(13, 233, 79, 0.2)"),
            medium: cssColor("--gnss-cell-fill-medium", "rgba(252, 255, 77, 0.2)"),
            high: cssColor("--gnss-cell-fill-high", "rgba(138, 67, 254, 0.2)"),
            severe: cssColor("--gnss-cell-fill-severe", "rgba(14, 127, 255, 0.2)"),
            unknown: cssColor("--gnss-cell-fill-unknown", "rgba(100, 114, 133, 0.2)"),
        },
        outline: {
            low: cssColor("--gnss-cell-outline-low", "rgba(13, 233, 79, 0.1)"),
            medium: cssColor("--gnss-cell-outline-medium", "rgba(252, 255, 77, 0.1)"),
            high: cssColor("--gnss-cell-outline-high", "rgba(138, 67, 254, 0.1)"),
            severe: cssColor("--gnss-cell-outline-severe", "rgba(14, 127, 255, 0.1)"),
            unknown: cssColor("--gnss-cell-outline-unknown", "rgba(100, 114, 133, 0.1)"),
        },
    };
    tokens.signature = JSON.stringify(tokens);
    return tokens;
}

function normalizeSeverity(value = "") {
    const severity = String(value || "").toLowerCase();
    if (["low", "medium", "high", "severe", "unknown"].includes(severity)) return severity;
    if (severity === "critical") return "high";
    return "unknown";
}

function normalizeConfidence(value = "") {
    const confidence = String(value || "").toLowerCase();
    if (["low", "medium", "high"].includes(confidence)) return confidence;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (numeric >= 70) return "high";
        if (numeric >= 35) return "medium";
        return "low";
    }
    return "low";
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function computeCellSignature(cells = []) {
    return (Array.isArray(cells) ? cells : [])
        .map((cell) => [
            String(cell.id || cell.cellId || ""),
            Number(cell.lat || 0).toFixed(3),
            Number(cell.lon || 0).toFixed(3),
            normalizeSeverity(cell.severity),
            Number(cell.affectedPercent || 0).toFixed(1),
            Number(cell.sampleCount || 0),
            normalizeConfidence(cell.confidence),
            String(cell.updatedAt || cell.observedAt || ""),
        ].join(":"))
        .join("|");
}

function ensureDataSource(viewer) {
    if (__gnssState.dataSource) return __gnssState.dataSource;
    const dataSource = new Cesium.CustomDataSource(GNSS_LAYER_NAME);
    __gnssState.dataSource = dataSource;
    return dataSource;
}

function metersPerDegreeLongitude(latDeg) {
    return Math.max(111320 * Math.abs(Math.cos(Cesium.Math.toRadians(Number(latDeg) || 0))), 1);
}

function getAdaptiveCellSizeKm(viewer, baseSizeKm = 28) {
    const height = Number(viewer?.camera?.positionCartographic?.height || 0);
    if (!Number.isFinite(height) || height <= 0) return baseSizeKm;
    if (height >= 8_000_000) return Math.max(baseSizeKm, 240);
    if (height >= 4_500_000) return Math.max(baseSizeKm, 180);
    if (height >= 2_500_000) return Math.max(baseSizeKm, 125);
    if (height >= 1_200_000) return Math.max(baseSizeKm, 85);
    if (height >= 550_000) return Math.max(baseSizeKm, 56);
    return Math.max(baseSizeKm, 34);
}

function buildHexagonBoundary(cell = {}, sizeKm = 28) {
    const polygon = Array.isArray(cell.polygon) ? cell.polygon : null;
    if (polygon?.length >= 3) {
        return polygon
            .map((point) => {
                const lat = Number(point?.lat);
                const lon = Number(point?.lon);
                return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
            })
            .filter(Boolean);
    }
    const centerLat = Number(cell.lat);
    const centerLon = Number(cell.lon);
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) return [];
    const radiusMeters = Math.max(4000, sizeKm * 1000);
    const latDelta = radiusMeters / 111320;
    const lonScale = metersPerDegreeLongitude(centerLat);
    const vertices = [];
    for (let index = 0; index < 6; index += 1) {
        const angle = Cesium.Math.toRadians((60 * index) - 30);
        const lat = centerLat + (Math.sin(angle) * latDelta);
        const lon = centerLon + ((Math.cos(angle) * radiusMeters) / lonScale);
        vertices.push({ lat, lon });
    }
    return vertices;
}

function parseCesiumColor(value, fallback) {
    const primary = typeof value === "string" ? Cesium.Color.fromCssColorString(value.trim()) : null;
    if (primary) return primary;
    const backup = typeof fallback === "string" ? Cesium.Color.fromCssColorString(fallback.trim()) : null;
    if (backup) return backup;
    return Cesium.Color.fromBytes(160, 170, 180, 64);
}

function resolveSeverityColor(tokens, kind, severity = "unknown") {
    const key = normalizeSeverity(severity);
    const fallbackPalette = GNSS_FALLBACK_COLORS[kind] || GNSS_FALLBACK_COLORS.fill;
    const palette = tokens?.[kind] && typeof tokens[kind] === "object"
        ? tokens[kind]
        : fallbackPalette;
    const fallback = fallbackPalette[key] || fallbackPalette.unknown;
    return parseCesiumColor(palette[key] || palette.unknown, fallback);
}

function getSeverityColors(tokens, severity = "unknown", hovered = false) {
    const baseFill = resolveSeverityColor(tokens, "fill", severity);
    const baseOutline = resolveSeverityColor(tokens, "outline", severity);
    if (!hovered) {
        return { fill: baseFill, outline: baseOutline };
    }
    const boost = clamp(tokens.hoverOpacityBoost, 0, 0.35);
    return {
        fill: baseFill.withAlpha(clamp(baseFill.alpha + boost, 0, 1)),
        outline: baseOutline.withAlpha(clamp(baseOutline.alpha + (boost * 0.8), 0, 1)),
    };
}

function getSeverityOutlineColor(tokens, severity = "unknown") {
    return resolveSeverityColor(tokens, "outline", severity);
}

function buildHierarchy(points = [], heightOffset = 0) {
    const flat = [];
    points.forEach((point) => {
        flat.push(point.lon, point.lat, heightOffset);
    });
    return Cesium.Cartesian3.fromDegreesArrayHeights(flat);
}

function formatRelativeTimestamp(value = "") {
    const ts = Date.parse(String(value || ""));
    if (!Number.isFinite(ts)) return "Unknown";
    const diffMs = Math.max(0, Date.now() - ts);
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes} min ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hr ago`;
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function getTooltipElement() {
    return document.getElementById(GNSS_TOOLTIP_ID);
}

function getLegendElement() {
    return document.getElementById(GNSS_LEGEND_ID);
}

function getLegendDemoElement() {
    return document.getElementById(GNSS_LEGEND_DEMO_ID);
}

function getLegendStatusElement() {
    return document.getElementById(GNSS_LEGEND_STATUS_ID);
}

function renderTooltipContent(cell = {}) {
    const severityLabel = normalizeSeverity(cell.severity);
    const confidenceLabel = normalizeConfidence(cell.confidence);
    const affected = Number(cell.affectedPercent || 0).toFixed(1);
    const samples = Math.max(0, Number(cell.sampleCount || 0));
    return [
        `<div class="wz-gnss-tooltip__title">GNSS Jamming: ${severityLabel.charAt(0).toUpperCase()}${severityLabel.slice(1)}</div>`,
        `<div class="wz-gnss-tooltip__row"><span>Affected aircraft</span><strong>${affected}%</strong></div>`,
        `<div class="wz-gnss-tooltip__row"><span>Samples</span><strong>${samples}</strong></div>`,
        `<div class="wz-gnss-tooltip__row"><span>Confidence</span><strong>${confidenceLabel.charAt(0).toUpperCase()}${confidenceLabel.slice(1)}</strong></div>`,
        `<div class="wz-gnss-tooltip__row"><span>Region</span><strong>${cell.region || "Global"}</strong></div>`,
        `<div class="wz-gnss-tooltip__row"><span>Updated</span><strong>${formatRelativeTimestamp(cell.updatedAt || cell.observedAt)}</strong></div>`,
        //`<div class="wz-gnss-tooltip__source">Source: ${cell.sourceLabel || "GNSS Jamming Monitor"}</div>`,
        cell.isDemo ? `<div class="wz-gnss-tooltip__mode">Staged demo layer</div>` : "",
    ].filter(Boolean).join("");
}

function positionTooltip(position = null) {
    const tooltip = getTooltipElement();
    const shell = document.querySelector(".warzone-map-shell");
    if (!tooltip || !shell || !position) return;
    const shellRect = shell.getBoundingClientRect();
    const maxLeft = Math.max(12, shellRect.width - tooltip.offsetWidth - 12);
    const maxTop = Math.max(12, shellRect.height - tooltip.offsetHeight - 12);
    const left = clamp(position.x - shellRect.left + 14, 12, maxLeft);
    const top = clamp(position.y - shellRect.top + 14, 12, maxTop);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function showTooltip(cell = null, position = null) {
    const tooltip = getTooltipElement();
    if (!tooltip || !cell || !position || __gnssState.visible !== true) return;
    tooltip.innerHTML = renderTooltipContent(cell);
    tooltip.hidden = false;
    tooltip.classList.add("is-visible");
    positionTooltip(position);
}

function hideTooltip() {
    const tooltip = getTooltipElement();
    if (!tooltip) return;
    tooltip.hidden = true;
    tooltip.classList.remove("is-visible");
}

function escapeHtml(value = "") {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCoordinate(value) {
    const num = Number(value);
    return Number.isFinite(num) ? `${num.toFixed(4)}°` : "Unknown";
}

function titleCase(value = "") {
    const text = String(value || "").trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function setLegendVisible(visible, {
    demoMode = false,
    statusText = "",
    statusTone = "live",
} = {}) {
    const legend = getLegendElement();
    if (!legend) return;
    legend.hidden = !visible;
    const demoTag = getLegendDemoElement();
    if (demoTag) {
        demoTag.hidden = !visible || demoMode !== true;
    }
    const statusEl = getLegendStatusElement();
    if (statusEl) {
        statusEl.hidden = !visible || !statusText;
        statusEl.textContent = statusText || "";
        statusEl.dataset.tone = statusTone || "live";
    }
    if (!visible) {
        legend.classList.remove("is-collapsed");
        const collapseBtn = legend.querySelector("[data-panel-collapse]");
        if (collapseBtn) {
            collapseBtn.setAttribute("aria-expanded", "true");
        }
        const content = legend.querySelector(".panel-content");
        if (content) {
            content.style.height = "";
            content.style.opacity = "";
        }
    }
}

function buildLegendStatus({
    cellCount = 0,
    demoMode = false,
    updatedAt = "",
    liveAvailable = false,
    tableAvailable = false,
    message = "",
} = {}) {
    const count = Math.max(0, Number(cellCount) || 0);
    if (count > 0) {
        const updatedLabel = updatedAt ? ` Updated ${formatRelativeTimestamp(updatedAt)}.` : "";
        return demoMode
            ? `${count} staged GNSS cell${count === 1 ? "" : "s"} loaded.${updatedLabel}`
            : `${count} live GNSS cell${count === 1 ? "" : "s"} loaded.${updatedLabel}`;
    }
    if (message) return message;
    if (demoMode) return "GNSS demo fallback is enabled, but there are no staged cells to render.";
    if (!tableAvailable) return "GNSS backend table is not deployed yet.";
    if (!liveAvailable) return "GNSS live data is unavailable right now.";
    return "No active GNSS Jamming cells are available right now.";
}

function closeActiveGnssPanel() {
    const active = __gnssState.activePanel;
    const activeEntity = __gnssState.activePanelEntityId
        ? __gnssState.cellsById.get(__gnssState.activePanelEntityId)
        : null;
    active?.cleanup?.();
    active?.panel?.remove?.();
    __gnssState.activePanel = null;
    __gnssState.activePanelEntityId = "";
    if (activeEntity) {
        applyEntityVisualState(activeEntity, __gnssState.hoverEntity === activeEntity);
    }
}

function positionGnssPanel(panel, sx, sy) {
    if (!panel || !Number.isFinite(sx) || !Number.isFinite(sy)) return;

    const size = panel.__wzPanelSize || {
        width: panel.offsetWidth || 448,
        height: panel.offsetHeight || 260,
    };
    const width = size.width || 448;
    const height = size.height || 260;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = sx + 16;
    let top = sy - 18;

    if (left + width > viewportWidth - 8) left = sx - width - 16;
    if (top + height > viewportHeight - 8) top = viewportHeight - height - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;

    panel.style.left = "0";
    panel.style.top = "0";
    panel.style.right = "auto";
    panel.style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

function isScreenPointInViewport(screen) {
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false;
    return screen.x >= 0 &&
        screen.x <= window.innerWidth &&
        screen.y >= 0 &&
        screen.y <= window.innerHeight;
}

function getEntityScreenPosition(viewer, entity) {
    const scene = viewer?.scene;
    if (!scene || !entity?.position) return null;

    const time = Cesium.JulianDate.now();
    const position = entity.position.getValue?.(time) || entity.position;
    const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates
        || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    if (!position || !toWindow) return null;

    const screen = toWindow(scene, position);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
    return screen;
}

function setGnssPanelVisible(panel, visible) {
    if (!panel) return;
    panel.style.opacity = visible ? "1" : "0";
    panel.style.pointerEvents = visible ? "auto" : "none";
}

function updateActiveGnssPanelPosition() {
    const active = __gnssState.activePanel;
    if (!active?.panel?.isConnected) {
        __gnssState.activePanel = null;
        __gnssState.activePanelEntityId = "";
        return;
    }
    const entity = __gnssState.activePanelEntityId
        ? __gnssState.cellsById.get(__gnssState.activePanelEntityId)
        : null;
    const viewer = __gnssState.trackingViewer;
    if (!viewer || !entity || __gnssState.visible !== true) {
        closeActiveGnssPanel();
        return;
    }

    const screen = getEntityScreenPosition(viewer, entity);
    if (!screen || !isScreenPointInViewport(screen)) {
        closeActiveGnssPanel();
        return;
    }

    positionGnssPanel(active.panel, screen.x, screen.y);
    setGnssPanelVisible(active.panel, true);
}

function ensurePopupTracking(viewer) {
    if (!viewer?.scene?.postRender || __gnssState.trackingViewer === viewer) return;
    if (__gnssState.trackingViewer?.scene?.postRender) {
        try {
            __gnssState.trackingViewer.scene.postRender.removeEventListener(updateActiveGnssPanelPosition);
        } catch {}
    }
    __gnssState.trackingViewer = viewer;
    viewer.scene.postRender.addEventListener(updateActiveGnssPanelPosition);
}

function renderPopupContent(cell = {}) {
    const severity = normalizeSeverity(cell.severity);
    const severityLabel = titleCase(severity);
    const affected = `${Number(cell.affectedPercent || 0).toFixed(1)}%`;
    const sampleCount = Math.max(0, Number(cell.sampleCount || 0));
    const affectedCount = cell.affectedAircraftCount != null && Number.isFinite(Number(cell.affectedAircraftCount))
        ? String(cell.affectedAircraftCount) : "Not reported";
    //const sourceLabel = cell.sourceLabel || "GNSS Jamming Monitor";
    return `
        <div class="wz-widget-milbase wz-widget-gnss" itemscope itemtype="https://schema.org/Place">
            <header class="wz-widget-header">
                <div class="wz-widget-kicker">
                    <span class="static-icon stratops-ico-assets-gnss-1 wz-gnss-popup__dot--${severity}" aria-hidden="true"></span>
                    <span class="wz-widget-title">GNSS Intelligence</span>
                </div>
                <div class="wz-widget-header-actions">
                    <button type="button" class="static-icon" data-widget-close aria-label="Close GNSS panel">
                        <span class="stratops-ico-close-1" aria-hidden="true"></span>
                    </button>
                </div>
            </header>
            <section class="wz-widget-body">
                <h3>${escapeHtml(cell.classification || "Observed GNSS degradation")} - ${escapeHtml(severityLabel)}</h3>
                <ul class="wz-widget-data-list">
                    <li><strong>Affected Aircraft</strong><span>${escapeHtml(affected)}</span></li>
                    <li><strong>Observed Aircraft</strong><span>${escapeHtml(String(sampleCount))}</span></li>
                    <li><strong>Affected Count</strong><span>${escapeHtml(affectedCount)}</span></li>
                    <li><strong>Observation Period</strong><span>${escapeHtml(cell.observationPeriod || "Not reported")}</span></li>
                    <li><strong>Freshness</strong><span>${escapeHtml(formatRelativeTimestamp(cell.updatedAt || cell.observedAt))}</span></li>
                    <li><strong>Coordinates</strong><span>${escapeHtml(formatCoordinate(cell.lat))}, ${escapeHtml(formatCoordinate(cell.lon))}</span></li>
                    <li><strong>Limitations</strong><span>${escapeHtml(cell.detectionLimitations || "Aircraft accuracy reports are indirect evidence; jammer location is unknown.")}</span></li>
                </ul>
            </section>
        </div>
    `;
}

function showGnssPanel(viewer, entity, screenPosition = null) {
    if (!viewer || !entity?.__gnssCell) return;
    closeActiveGnssPanel();

    const panel = document.createElement("div");
    panel.id = "warzone-gnss-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("tabindex", "-1");
    panel.style.cssText = "position:fixed; width:28rem; max-width:calc(100vw - 1rem); z-index:900; opacity:0; transform:translate3d(0, 0, 0); pointer-events:none; transition:opacity 160ms ease;";
    panel.innerHTML = renderPopupContent(entity.__gnssCell);
    document.body.appendChild(panel);
    panel.__wzPanelSize = {
        width: panel.offsetWidth || 448,
        height: panel.offsetHeight || 260,
    };

    const closeBtn = panel.querySelector("[data-widget-close]");
    const escHandler = (event) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            closeActiveGnssPanel();
        }
    };

    document.addEventListener("keydown", escHandler);
    closeBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        closeActiveGnssPanel();
    });

    __gnssState.activePanelEntityId = entity.id;
    __gnssState.activePanel = {
        panel,
        cleanup: () => document.removeEventListener("keydown", escHandler),
    };
    applyEntityVisualState(entity, true);
    ensurePopupTracking(viewer);
    if (screenPosition) {
        positionGnssPanel(panel, screenPosition.x, screenPosition.y);
        setGnssPanelVisible(panel, true);
    }
    updateActiveGnssPanelPosition();
    panel.focus();
}

function clearHighlight() {
    if (!__gnssState.hoverEntity) return;
    const preserveHighlight = __gnssState.hoverEntity?.id === __gnssState.activePanelEntityId;
    applyEntityVisualState(__gnssState.hoverEntity, preserveHighlight);
    __gnssState.hoverEntity = null;
}

function applyEntityVisualState(entity, hovered = false) {
    if (!entity?.polygon || !entity.__gnssTokens) return;
    const colors = getSeverityColors(entity.__gnssTokens, entity.__gnssCell?.severity, hovered);
    entity.polygon.material = colors.fill;
    entity.polygon.outlineColor = colors.outline;
}

function findPickedGnssEntity(viewer, position) {
    const picked = position ? viewer.scene.pick(position) : null;
    const entity = picked?.id;
    if (entity?.__gnssCell || entity?.properties?.[GNSS_ENTITY_PROP_KEY]?.getValue?.() === true) {
        return entity;
    }
    return null;
}

function bindPicking(viewer) {
    if (__gnssState.handler) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    __gnssState.handler = handler;

    handler.setInputAction((movement) => {
        if (__gnssState.visible !== true) {
            viewer.container.style.cursor = "";
            hideTooltip();
            clearHighlight();
            return;
        }
        const entity = findPickedGnssEntity(viewer, movement?.endPosition);
        if (!entity) {
            viewer.container.style.cursor = "";
            clearHighlight();
            return;
        }
        viewer.container.style.cursor = "pointer";
        if (__gnssState.hoverEntity !== entity) {
            clearHighlight();
            __gnssState.hoverEntity = entity;
            applyEntityVisualState(entity, true);
        }
        viewer.scene.requestRender?.();
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction((movement) => {
        if (__gnssState.visible !== true) return;
        const entity = findPickedGnssEntity(viewer, movement?.position);
        if (!entity) {
            closeActiveGnssPanel();
            clearHighlight();
            hideTooltip();
            viewer.container.style.cursor = "";
            viewer.scene.requestRender?.();
            return;
        }
        __gnssState.hoverEntity = entity;
        applyEntityVisualState(entity, true);
        showGnssPanel(viewer, entity, movement.position);
        viewer.container.style.cursor = "pointer";
        viewer.scene.requestRender?.();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function upsertEntities(viewer, cells = [], tokens) {
    const dataSource = ensureDataSource(viewer);
    const entities = dataSource.entities;
    entities.removeAll();
    __gnssState.cellsById.clear();

    cells.forEach((cell) => {
        const points = buildHexagonBoundary(cell, tokens.sizeKm);
        if (points.length < 3) return;
        const hierarchy = buildHierarchy(points, tokens.heightOffset);
        const colors = getSeverityColors(tokens, cell.severity, false);
        const markerColor = getSeverityOutlineColor(tokens, cell.severity);
        const entity = entities.add({
            id: `gnss-cell-${cell.id}`,
            name: `GNSS Jamming ${normalizeSeverity(cell.severity)}`,
            position: Cesium.Cartesian3.fromDegrees(Number(cell.lon), Number(cell.lat), 0),
            polygon: {
                hierarchy,
                material: colors.fill,
                outline: tokens.outlineWidth > 0,
                outlineColor: colors.outline,
                outlineWidth: tokens.outlineWidth,
                arcType: Cesium.ArcType.GEODESIC,
                perPositionHeight: true,
                heightReference: Cesium.HeightReference.NONE,
            },
            point: {
                pixelSize: tokens.markerPixelSize,
                color: markerColor.withAlpha(0.94),
                outlineColor: Cesium.Color.fromCssColorString("rgba(7, 11, 18, 0.9)"),
                outlineWidth: tokens.markerOutlineWidth,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(
                    tokens.markerScaleNearDistance,
                    tokens.markerScaleNearValue,
                    Math.max(tokens.markerScaleFarDistance, tokens.markerScaleNearDistance + 1),
                    tokens.markerScaleFarValue,
                ),
                translucencyByDistance: new Cesium.NearFarScalar(8e6, 1.0, 2.0e7, 0.85),
            },
            properties: {
                [GNSS_ENTITY_PROP_KEY]: true,
                cell_id: cell.cellId || cell.id,
                severity: normalizeSeverity(cell.severity),
                affected_percent: Number(cell.affectedPercent || 0),
                sample_count: Number(cell.sampleCount || 0),
                confidence: normalizeConfidence(cell.confidence),
                country: String(cell.country || ""),
                region: String(cell.region || ""),
                //source_label: String(cell.sourceLabel || "GNSS Jamming Monitor"),
                observed_at: String(cell.observedAt || ""),
                updated_at: String(cell.updatedAt || ""),
                is_demo: cell.isDemo === true,
            },
        });
        entity.__gnssCell = {
            ...cell,
            severity: normalizeSeverity(cell.severity),
            confidence: normalizeConfidence(cell.confidence),
        };
        entity.__gnssTokens = tokens;
        __gnssState.cellsById.set(entity.id, entity);
    });
}

function bindGnssCamera(viewer) {
    if (__gnssState.groundViewer === viewer) return;
    __gnssState.cameraCleanup?.();
    if (__gnssState.groundViewer) clearGroundPrimitives(__gnssState.groundViewer);
    __gnssState.groundViewer = viewer;
    __gnssState.cameraMoving = false;
    __gnssState.settledRegion = "";
    const start = () => { __gnssState.cameraMoving = true; };
    const end = () => { __gnssState.cameraMoving = false; };
    const settled = (event) => {
        __gnssState.settledRegion = event.detail?.region?.id || "global";
        viewer.scene.requestRender?.();
    };
    viewer.camera?.moveStart?.addEventListener(start);
    viewer.camera?.moveEnd?.addEventListener(end);
    document.addEventListener?.("wz:region-camera-settled", settled);
    __gnssState.cameraCleanup = () => {
        viewer.camera?.moveStart?.removeEventListener(start);
        viewer.camera?.moveEnd?.removeEventListener(end);
        document.removeEventListener?.("wz:region-camera-settled", settled);
    };
}

function pauseGroundBuild() {
    const job = __gnssState.groundBuild;
    if (!job) return;
    job.ticket++;
    if (job.frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(job.frame);
    job.frame = null;
}

function scheduleGroundBuild() {
    const job = __gnssState.groundBuild;
    if (!job || job.done || job.frame !== null || !__gnssState.visible) return;
    const ticket = ++job.ticket;
    job.frame = requestAnimationFrame(() => {
        if (ticket !== job.ticket) return;
        job.frame = null;
        job.nextBatch();
    });
}

function clearGroundPrimitives(viewer) {
    pauseGroundBuild();
    __gnssState.groundBuild = null;
    __gnssState.reveal?.dispose();
    __gnssState.reveal = null;
    __gnssState.batchGeneration += 1;
    const collection = viewer?.scene?.groundPrimitives;
    if (collection) for (const primitive of __gnssState.groundPrimitives) collection.remove(primitive);
    __gnssState.groundPrimitives = [];
    __gnssState.cellsById.clear();
}

function renderGroundBatches(viewer, cells, tokens, options) {
    clearGroundPrimitives(viewer);
    const collection = viewer.scene.groundPrimitives;
    const generation = __gnssState.batchGeneration;
    let cursor = 0;
    const reveal = createOperationalGnssReveal(viewer, {
        total: cells.length,
        cameraSettled: () => !__gnssState.cameraMoving && (!options.regionId
            || __gnssState.settledRegion === options.regionId),
        warn: (message) => console.warn(message),
    });
    __gnssState.reveal = reveal;
    const job = { frame: null, ticket: 0, done: false, nextBatch: null };
    __gnssState.groundBuild = job;
    const nextBatch = () => {
        if (generation !== __gnssState.batchGeneration || !__gnssState.visible) return;
        if (viewer.isDestroyed?.()) { pauseGroundBuild(); reveal.dispose(); return; }
        const instances = [];
        const outlines = [];
        const records = [];
        const end = Math.min(cursor + 200, cells.length);
        for (; cursor < end; cursor += 1) {
            const cell = cells[cursor];
            const points = buildHexagonBoundary(cell, tokens.sizeKm);
            if (points.length < 3) continue;
            const color = getSeverityColors(tokens, cell.severity).fill;
            const id = { id: `gnss-cell-${cell.id}`, __gnssCell: cell,
                position: Cesium.Cartesian3.fromDegrees(cell.lon, cell.lat) };
            __gnssState.cellsById.set(id.id, id);
            const positions = Cesium.Cartesian3.fromDegreesArray(points.flatMap((point) => [point.lon, point.lat]));
            const outlineId = `gnss-outline-${cell.id}`;
            records.push({ fillId: id, outlineId });
            if (tokens.outlineWidth > 0) {
                outlines.push(new Cesium.GeometryInstance({
                    geometry: new Cesium.GroundPolylineGeometry({
                        positions,
                        loop: true,
                        width: tokens.outlineWidth,
                    }),
                    id: outlineId,
                    attributes: {
                        show: new Cesium.ShowGeometryInstanceAttribute(reveal.initialShow),
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            getSeverityOutlineColor(tokens, cell.severity)
                        ),
                    },
                }));
            }
            instances.push(new Cesium.GeometryInstance({
                geometry: new Cesium.PolygonGeometry({
                    polygonHierarchy: new Cesium.PolygonHierarchy(
                        positions
                    ),
                    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
                    show: new Cesium.ShowGeometryInstanceAttribute(reveal.initialShow) },
                id,
            }));
        }
        if (instances.length) {
            const primitive = collection.add(new Cesium.GroundPrimitive({
                geometryInstances: instances,
                appearance: new Cesium.PerInstanceColorAppearance({
                    flat: true,
                    translucent: true,
                    closed: false
                }),
                classificationType: Cesium.ClassificationType.TERRAIN,
                asynchronous: true,
                allowPicking: true,
                releaseGeometryInstances: true,
            }));

            __gnssState.groundPrimitives.push(primitive);

            let border = null;
            if (outlines.length > 0) {
                border = collection.add(new Cesium.GroundPolylinePrimitive({
                    geometryInstances: outlines,
                    appearance: new Cesium.PolylineColorAppearance({
                        translucent: true
                    }),
                    classificationType: Cesium.ClassificationType.TERRAIN,
                    asynchronous: true,
                    allowPicking: false,
                    releaseGeometryInstances: true,
                }));

                __gnssState.groundPrimitives.push(border);
            }

            reveal.addBatch(primitive, border, records);
            viewer.scene.requestRender?.();
        }
        if (cursor < cells.length) scheduleGroundBuild();
        else { job.done = true; reveal.seal(); }
    };
    job.nextBatch = nextBatch;
    scheduleGroundBuild();
}

function bindGnssControls(viewer) {
    if (__gnssState.controlsBound) return;
    const show = document.getElementById("wz-gnss-show-hexagons");
    const severity = document.getElementById("wz-gnss-severity");
    if (!show || !severity) return;
    __gnssState.controlsBound = true;
    show.addEventListener("change", () => {
        __gnssState.showHexagons = show.checked;
        if (__gnssState.lastInput) renderGnssInterferenceLayer(viewer, ...__gnssState.lastInput);
    });
    severity.addEventListener("change", () => {
        __gnssState.severityFilter = severity.value;
        if (__gnssState.lastInput) renderGnssInterferenceLayer(viewer, ...__gnssState.lastInput);
    });
}

export function renderGnssInterferenceLayer(viewer, cells = [], options = {}) {
    if (!viewer || viewer.isDestroyed?.()) return;
    bindGnssCamera(viewer);
    __gnssState.lastInput = [cells, options];
    bindGnssControls(viewer);
    bindPicking(viewer);
    const tokens = readGnssTokens();
    const sourceMode = options.sourceMode || "unavailable";
    const isPrimary = sourceMode === "gpsinterference";
    const allCells = Array.isArray(cells) ? cells : [];
    const selected = __gnssState.severityFilter === "all" ? allCells
        : allCells.filter((cell) => normalizeSeverity(cell.severity) === __gnssState.severityFilter);
    const layerEnabled = options.visible === true;
    const showCells = layerEnabled && __gnssState.showHexagons && selected.length > 0;
    const signature = computeCellSignature(selected) + ":" + sourceMode
        + (isPrimary ? `:${options.regionId || ""}:${options.observationKey || ""}` : `:${__gnssState.showHexagons}`);
    __gnssState.demoMode = options.demoMode === true;
    if (signature !== __gnssState.signature || tokens.signature !== __gnssState.styleSignature) {
        clearGroundPrimitives(viewer);
        if (isPrimary) {
            if (__gnssState.dataSource) {
                __gnssState.dataSource.entities.removeAll();
                setDataSourceActive(viewer, __gnssState.dataSource, false);
            }
        } else {
            upsertEntities(viewer, selected, tokens);
        }
        __gnssState.signature = signature;
        __gnssState.styleSignature = tokens.signature;
        __gnssState.sourceMode = sourceMode;
    }
    __gnssState.visible = showCells;
    if (isPrimary) {
        if (showCells && !__gnssState.groundBuild) renderGroundBatches(viewer, selected, tokens, options);
        __gnssState.reveal?.setVisible(showCells);
        if (showCells) scheduleGroundBuild(); else pauseGroundBuild();
    } else if (__gnssState.dataSource) {
        setDataSourceActive(viewer, __gnssState.dataSource, layerEnabled);
        __gnssState.dataSource.show = showCells;
    }
    if (!showCells) { closeActiveGnssPanel(); clearHighlight(); hideTooltip(); }
    const count = options.totalCells ?? allCells.length;
    const updated = options.updatedAt ? ` Updated ${formatRelativeTimestamp(options.updatedAt)}.` : "";
    const displayedCount = __gnssState.showHexagons ? selected.length : 0;
    const filterLabel = __gnssState.severityFilter === "all" ? "all severities" : __gnssState.severityFilter;
    const statusText = options.message || (count
        ? `${count} regional cells observed; ${displayedCount} displayed (${filterLabel}).${updated}${options.truncated ? " Map display bounded; counts include all cells." : ""}`
        : sourceMode === "gpsinterference" ? "No observations in this region; coverage may be insufficient."
            : buildLegendStatus({ cellCount: 0, ...options }));
    setLegendVisible(layerEnabled, { demoMode: options.demoMode, statusText,
        statusTone: options.sourceHealth === "Available" && showCells ? "live" : "Warning" });
    const counts = options.severityCounts || allCells.reduce((acc, cell) => {
        const key = normalizeSeverity(cell.severity);
        acc[key] = (acc[key] || 0) + 1; return acc;
    }, {});
    for (const key of ["low", "medium", "high", "severe"]) {
        const el = document.getElementById(`wz-gnss-count-${key}`);
        if (el) el.textContent = String(counts[key] || 0);
    }
    const period = document.getElementById("wz-gnss-observation-period");
    if (period) period.textContent = options.observationPeriod || "Unknown observation date";
    const health = document.getElementById("wz-gnss-source-health");
    if (health) health.textContent = options.sourceHealth || "Unavailable";
    viewer.scene.requestRender?.();
}

export function clearGnssInterferenceLayer(viewer, { retainGeometry = false } = {}) {
    const retain = retainGeometry && __gnssState.sourceMode === "gpsinterference";
    if (retain) {
        pauseGroundBuild();
        __gnssState.reveal?.setVisible(false);
    } else {
        clearGroundPrimitives(viewer);
        __gnssState.lastInput = null;
        __gnssState.cameraCleanup?.();
        __gnssState.cameraCleanup = null;
        __gnssState.groundViewer = null;
    }
    if (__gnssState.dataSource) {
        __gnssState.dataSource.entities.removeAll();
        __gnssState.dataSource.show = false;
        setDataSourceActive(viewer, __gnssState.dataSource, false);
    }
    if (!retain) __gnssState.signature = "";
    __gnssState.visible = false;
    closeActiveGnssPanel();
    clearHighlight();
    hideTooltip();
    if (__gnssState.handler) {
        try { __gnssState.handler.destroy(); } catch { }
        __gnssState.handler = null;
    }
    if (__gnssState.trackingViewer?.scene?.postRender) {
        try {
            __gnssState.trackingViewer.scene.postRender.removeEventListener(updateActiveGnssPanelPosition);
        } catch { }
    }
    __gnssState.trackingViewer = null;
    setLegendVisible(false, { demoMode: false });
    viewer?.scene?.requestRender?.();
}

export function getGnssDiagnostics() {
    return Object.freeze({
        visible: __gnssState.visible,
        groundPrimitiveCount: __gnssState.groundPrimitives.length,
        reveal: __gnssState.reveal?.diagnostics() || null,
        activeCellEntities: __gnssState.visible ? __gnssState.cellsById.size : 0,
        cachedCellRecords: __gnssState.cellsById.size,
        dataSourceActive: Boolean(__gnssState.dataSource),
        pickingHandlerActive: Boolean(__gnssState.handler),
        popupTrackingListenerActive: Boolean(__gnssState.trackingViewer),
    });
}
