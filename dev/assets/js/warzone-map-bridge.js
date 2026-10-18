// Renderer-neutral routing: no feeds, timers or rendering dependencies.
let mode = "satellite";
let tacticalView = "3d";
let host = null;
let selection = null;
const sources = new Map();
const filters = new Map();
const listeners = new Set();
const deferredFrames = new Set();
export const isTacticalMapActive = () => mode === "tactical";
export function getOperationalMapApi() {
    return isTacticalMapActive() ? host?.api || null
        : (typeof window !== "undefined" ? window.__warzoneViewer?.__warzone : null);
}
export const getMapSelection = () => selection;
export const getMapSources = () => sources;
export function registerMapSource(type, adapter) { sources.set(type, adapter); }
export function setMapFilter(type, predicate) { filters.set(type, predicate); }
export function matchesMapFilter(type, record) { return filters.get(type)?.(record) ?? true; }
export function setMapHost(value) { host = value; }
export function getMapOverlayContainer(viewer) {
    return isTacticalMapActive() ? host?.overlayContainer || document.body
        : viewer?.container || viewer?.cesiumWidget?.container || document.body;
}
export function mountMapAssetOverlay(root, viewer) {
    const container = getMapOverlayContainer(viewer);
    if (root.parentNode !== container) container.appendChild(root);
    const label = root.querySelector("[data-map-asset-label]");
    if (label) label.hidden = !isTacticalMapActive();
    return root;
}
// Presentation adapter for the existing focus overlay, not a second focus panel.
export function presentMapAssetOverlay(root, record, screen, labelStyle, text) {
    const visible = Boolean(record && screen);
    root.style.display = visible ? "block" : "none";
    root.classList.toggle("is-visible", visible);
    if (!visible) return;
    root.style.left = `${screen.x}px`;
    root.style.top = `${screen.y}px`;
    let label = root.querySelector("[data-map-asset-label]");
    if (!label) {
        label = document.createElement("span");
        label.dataset.mapAssetLabel = "1";
        root.appendChild(label);
    }
    label.hidden = false;
    if (label.__record === record && label.textContent === text) return;
    label.__record = record;
    label.textContent = text;
    const align = labelStyle.focusAlign || labelStyle.align || "center";
    const offset = align === "right" ? "-100%" : align === "left" ? "0%" : "-50%";
    Object.assign(label.style, { position: "absolute", whiteSpace: "pre", pointerEvents: "none",
        font: labelStyle.font, color: labelStyle.fill, background: labelStyle.background || "transparent",
        padding: `${labelStyle.paddingY || 0}px ${labelStyle.paddingX || 0}px`,
        left: `${labelStyle.focusScreenOffsetX || 0}px`,
        top: `${(labelStyle.offsetY || 0) + (labelStyle.focusScreenOffsetY || 0)}px`,
        transform: `translate(${offset}, -100%) scale(${labelStyle.scale || 1})`, transformOrigin: `bottom ${align}`, textAlign: align });
}
export function setActiveMapRenderer(value) {
    mode = value;
    if (mode === "satellite") {
        const callbacks = Array.from(deferredFrames);
        deferredFrames.clear();
        callbacks.forEach((callback) => requestAnimationFrame(callback));
    }
}
// Pause existing finite Cesium effects without spinning hidden RAF loops.
export function deferSatelliteFrame(callback) {
    if (!isTacticalMapActive()) return false;
    deferredFrames.add(callback);
    return true;
}
export function getTacticalViewportBounds() {
    return isTacticalMapActive() ? host?.getViewportBounds() : null;
}
export function projectTacticalPoint(point) {
    return isTacticalMapActive() ? host?.project(point) : null;
}
export function onMapDataChange(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}
export function notifyMapDataChange() { listeners.forEach((callback) => callback()); }
export function getTacticalView() { return tacticalView; }
export function routeTacticalView(view) {
    if (!isTacticalMapActive() || !host || !["2d", "3d"].includes(view)) return null;
    if (!host.setView(view)) return false;
    tacticalView = view;
    document.dispatchEvent(new CustomEvent("wz:scene-mode-changed", { detail: { mode: view } }));
    return view;
}
export function rememberMapSelection(value) {
    selection = value?.id ? { ...value, id: String(value.id) } : null;
    notifyMapDataChange();
}
// null means continue the caller's existing Cesium implementation.
export function routeMapSelection(type, id, options = {}) {
    if (!isTacticalMapActive() || !host) return null;
    return host.select(type, String(id || ""), options);
}
export function requestSatelliteMap(reason = "3D view") {
    return host?.switchMode("satellite", reason) || Promise.resolve(false);
}
export function routeMapRegion(region) {
    if (!isTacticalMapActive() || !host) return false;
    host.region(region);
    return true;
}
