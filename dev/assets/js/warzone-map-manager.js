import * as Cesium from "cesium";
import "../css/warzone-tactical-map.css";
import { getAssetFocusController, resetWarzoneCameraReference } from "./warzone-asset-focus-controller.js";
import { isLayerEnabled, onLayerChange } from "./warzone-layers.js";
import {
    getMapSources, getMapSelection, isTacticalMapActive, rememberMapSelection,
    setActiveMapRenderer, setMapHost, registerMapSource, getTacticalView, routeTacticalView,
} from "./warzone-map-bridge.js";

const STORAGE_KEY = "stratops.map-engine";
const THREE_D_LAYERS = new Set(["airspace", "ranges", "sweepers", "aoi", "region-plate", "satellite-imagery"]);
let manager = null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function readPreference() {
    try { return localStorage.getItem(STORAGE_KEY) === "satellite" ? "satellite" : "tactical"; }
    catch { return "tactical"; }
}
function satelliteCamera(viewer) {
    const canvas = viewer.scene.canvas;
    const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const target = ray && viewer.scene.globe.pick(ray, viewer.scene);
    const geo = target ? Cesium.Cartographic.fromCartesian(target) : viewer.camera.positionCartographic;
    const latitude = Cesium.Math.toDegrees(geo.latitude);
    const range = target ? Cesium.Cartesian3.distance(target, viewer.camera.positionWC) : geo.height;
    const metersPerPixel = Math.max(1, 2 * Math.max(100, range) * Math.tan(Math.PI / 6) / Math.max(1, canvas.clientHeight));
    return { center: [Cesium.Math.toDegrees(geo.longitude), clamp(latitude, -85, 85)],
        zoom: clamp(Math.log2(40075016.686 * Math.cos(geo.latitude) / (512 * metersPerPixel)), -4, 18),
        bearing: Cesium.Math.toDegrees(viewer.camera.heading),
        pitch: clamp(90 + Cesium.Math.toDegrees(viewer.camera.pitch), 0, 85) };
}
function restoreSatelliteCamera(viewer, camera) {
    const [lon, lat] = camera.center;
    const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, camera.zoom));
    const range = clamp(mpp * Math.max(1, viewer.scene.canvas.clientHeight) / (2 * Math.tan(Math.PI / 6)), 100, 40000000);
    viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(lon, lat, 0), new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(camera.bearing), Cesium.Math.toRadians(clamp(Number(camera.pitch) || 0, 0, 85) - 90), range));
    resetWarzoneCameraReference(viewer, { preserveView: true });
}

export function initWarzoneMapManager(viewer = null, options = {}) {
    if (manager || document.body.classList.contains("wz-report-capture-mode")) return manager;
    const globeContainer = document.getElementById("warzone-globe");
    if (!globeContainer) return null;
    const container = document.createElement("div");
    container.id = "wz-tactical-map";
    container.hidden = true;
    container.setAttribute("aria-label", "StratOps tactical intelligence map");
    // Sibling only: the persistent viewer and its parent are never replaced.
    globeContainer.insertAdjacentElement("afterend", container);
    const controls = document.createElement("nav");
    controls.className = "wz-map-switch";
    controls.setAttribute("aria-label", "Map engine");
    const buttons = {};
    for (const mode of ["tactical", "satellite"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = mode.toUpperCase();
        button.setAttribute("aria-pressed", mode === "satellite" ? "true" : "false");
        button.addEventListener("click", () => { void switchMode(mode); });
        buttons[mode] = button; controls.appendChild(button);
    }
    const status = document.createElement("span");
    status.className = "wz-map-switch__status";
    status.setAttribute("role", "status");
    controls.appendChild(status);
    document.body.appendChild(controls);
    let basesModule = null;
    let basesPromise = null;
    function ensureBasesData() {
        if (!basesPromise) basesPromise = import("./warzone-military-bases.js").then((module) => {
            basesModule = module;
            renderer?.refresh();
        }).catch((error) => notice("Military base data unavailable: " + error.message));
        return basesPromise;
    }
    registerMapSource("bases", { layer: "military-bases",
        snapshot: () => basesModule?.getWarzoneMilitaryBaseMapRecords() || [] });

    let renderer = null;
    let pending = null;
    let savedRenderLoop = viewer?.useDefaultRenderLoop ?? true;
    let savedClockAnimation = viewer?.clock.shouldAnimate ?? false;
    let lastCamera = options.camera || { center: [44, 28], zoom: 2, bearing: 0, pitch: 0 };
    let lastSwitchMs = 0;
    let lastSwitchError = null;
    let transitioning = false;
    function notice(message = "") { status.textContent = message; }
    function showSelection(selected, record, screen = null) {
        getMapSources().forEach((adapter, type) => adapter.present?.(
            selected?.type === type ? record : null, selected?.type === type ? screen : null));
    }
    function select(type, id, options = {}) {
        if (!renderer || !isTacticalMapActive()) return false;
        const previous = getMapSelection();
        if (!id) {
            if (previous?.type !== type) return true;
            getMapSources().get(type)?.select?.("");
            getAssetFocusController().exitFocus("unlock");
            renderer.clearFocus();
            rememberMapSelection(null); renderer.refresh(); return true;
        }
        // The spherical MapLibre camera targets sea level, not orbital altitude.
        // Preserve the exact native orbital interaction instead of an approximation.
        if (type === "satellite") {
            const adapter = getMapSources().get(type);
            if ((adapter?.layer && !isLayerEnabled(adapter.layer)) ||
                !adapter?.snapshot().some((record) => String(record.id) === String(id))) return false;
            if (previous && previous.type !== type) getMapSources().get(previous.type)?.select?.("");
            getAssetFocusController().enterFocus({ assetType: type, assetId: id, mode: "focus" });
            rememberMapSelection({ type, id, follow: true });
            adapter.select?.(id);
            void switchMode("satellite", "Orbital focus uses the original Satellite renderer");
            return true;
        }
        routeTacticalView("3d");
        const record = renderer.select(type, id, options);
        if (!record) { notice("That contact is unavailable in the current layer/filter."); return false; }
        if (previous && previous.type !== type) getMapSources().get(previous.type)?.select?.("");
        const focusController = getAssetFocusController();
        if (!focusController.isActiveAsset(id, type))
            focusController.enterFocus({ assetType: type, assetId: id, mode: "focus" });
        rememberMapSelection({ type, id, follow: ["aircraft", "naval", "satellite"].includes(type) });
        getMapSources().get(type)?.select?.(id);
        if (type === "events") document.dispatchEvent(new CustomEvent("wz:event-marker-selected", {
            detail: { ...record, eventId: record.id, entityId: record.id,
                screenPosition: { x: innerWidth / 2, y: innerHeight / 2 } },
        }));
        renderer.refresh(); return true;
    }
    function region(region) {
        if (!renderer || !region?.bounds) return;
        const selected = getMapSelection();
        if (selected) rememberMapSelection({ ...selected, follow: false });
        const b = region.bounds;
        renderer.clearFocus();
        renderer.map.setCenterClampedToGround(true);
        renderer.map.setCenterElevation(0);
        renderer.map.fitBounds([[b.minLon, Math.max(-85, b.minLat)], [b.maxLon, Math.min(85, b.maxLat)]],
            { padding: 60, duration: 650, maxZoom: 10 });
        document.dispatchEvent(new CustomEvent("wz:region-camera-settled", { detail: { regionId: region.id } }));
    }
    function restoreCesium(selection, camera) {
        if (isTacticalMapActive()) getAssetFocusController().exitFocus("map-engine-switch");
        setActiveMapRenderer("satellite");
        document.body.classList.remove("wz-map-tactical");
        showSelection(null, null);
        container.hidden = true;
        getMapSources().forEach((adapter) => adapter.select?.(""));
        viewer.clock.shouldAnimate = savedClockAnimation;
        viewer.useDefaultRenderLoop = savedRenderLoop;
        viewer.resize();
        if (camera) restoreSatelliteCamera(viewer, camera);
        getMapSources().forEach((adapter) => adapter.resume?.());
        if (selection) {
            const adapter = getMapSources().get(selection.type);
            if (!adapter?.layer || isLayerEnabled(adapter.layer)) adapter?.focus?.(selection.id);
        }
        viewer.scene.requestRender();
    }
    function switchMode(next, reason = "") {
        if (pending) return pending.then(() => switchMode(next, reason));
        if (next === "tactical" ? Boolean(renderer) && isTacticalMapActive() : Boolean(viewer) && !isTacticalMapActive()) return Promise.resolve(true);
        pending = Promise.resolve().then(async () => {
            const started = performance.now();
            lastSwitchError = null;
            transitioning = true;
            Object.values(buttons).forEach((button) => { button.disabled = true; });
            try {
                if (next === "tactical") {
                    // Import first; a failed chunk leaves the existing viewer untouched.
                    const { createTacticalMap } = await import("./warzone-tactical-map.js");
                    if (viewer) lastCamera = satelliteCamera(viewer);
                    const focusState = viewer ? getAssetFocusController().getState() : {};
                    const selection = focusState.assetId
                        ? { type: focusState.assetType, id: focusState.assetId, follow: true } : getMapSelection();
                    if (focusState.assetId) getMapSources().get(focusState.assetType)?.clear?.();
                    // Complete a native clear-selection morph before stopping
                    // the clock; never leave Cesium frozen mid-morph.
                    if (viewer) {
                        if (viewer.scene.mode === Cesium.SceneMode.MORPHING) viewer.scene.completeMorph();
                        getAssetFocusController().exitFocus("map-engine-switch");
                        savedRenderLoop = viewer.useDefaultRenderLoop;
                        savedClockAnimation = viewer.clock.shouldAnimate;
                        viewer.camera.cancelFlight();
                        viewer.useDefaultRenderLoop = false;
                        viewer.clock.shouldAnimate = false;
                    }
                    rememberMapSelection(selection?.type === "satellite" ? { ...selection, follow: false } : selection);
                    setActiveMapRenderer("tactical");
                    document.body.classList.add("wz-map-tactical");
                    container.hidden = false;
                    notice("Loading Tactical map…");
                    try {
                        renderer = await createTacticalMap(container, lastCamera, { select, showSelection, notice });
                        await renderer.ready;
                        if (selection && selection.type !== "satellite") {
                            getMapSources().get(selection.type)?.select?.(selection.id);
                            renderer.select(selection.type, selection.id);
                            getAssetFocusController().enterFocus({ assetType: selection.type, assetId: selection.id, mode: "focus" });
                        } else {
                            // Overview retains the ID, but does not pretend native orbital follow is active.
                            getMapSources().get("satellite")?.select?.("");
                        }
                        renderer.refresh();
                        notice("3D terrain, orbit paths, coverage volumes and imagery tools use SATELLITE.");
                    } catch (error) {
                        renderer?.destroy(); renderer = null;
                        if (viewer) restoreCesium(selection, lastCamera);
                        else {
                            setActiveMapRenderer("satellite");
                            document.body.classList.remove("wz-map-tactical");
                            container.hidden = true;
                        }
                        notice("Tactical could not load. Select Satellite to continue. " + error.message);
                        return false;
                    }
                } else {
                    const selection = getMapSelection();
                    const camera = renderer?.camera() || lastCamera;
                    notice("Loading Satellite...");
                    // Release Tactical's context before creating Cesium's context.
                    lastCamera = camera;
                    renderer?.pause();
                    renderer?.destroy(); renderer = null;
                    showSelection(null, null);
                    if (!viewer) {
                        if (!options.ensureSatellite) throw new Error("Satellite initializer unavailable");
                        viewer = await options.ensureSatellite(camera);
                        if (!viewer) throw new Error("Satellite viewer initialization failed");
                        savedRenderLoop = viewer.useDefaultRenderLoop;
                        savedClockAnimation = viewer.clock.shouldAnimate;
                    }
                    restoreCesium(selection, camera);
                    notice(reason ? reason + " — Satellite mode" : "");
                }
                try { localStorage.setItem(STORAGE_KEY, next); } catch { /* private storage */ }
                document.dispatchEvent(new CustomEvent("wz:map-engine-changed", { detail: { mode: next } }));
                document.dispatchEvent(new CustomEvent("wz:scene-mode-changed", {
                    detail: { mode: next === "tactical" ? getTacticalView() : viewer.__warzone.getSceneMode() },
                }));
                return true;
            } catch (error) {
                lastSwitchError = { name: error.name, message: error.message,
                    request: error.request || null, type: error.type || null };
                if (window.__warzoneViewer && isTacticalMapActive()) {
                    window.__warzoneViewer.useDefaultRenderLoop = false;
                    window.__warzoneViewer.clock.shouldAnimate = false;
                }
                if (!renderer && isTacticalMapActive()) {
                    // A failed import can be retried; rebuild only the map renderer,
                    // never the shared trackers, subscriptions, or onboarding flow.
                    try {
                        const { createTacticalMap } = await import("./warzone-tactical-map.js");
                        renderer = await createTacticalMap(container, lastCamera, { select, showSelection, notice });
                        await renderer.ready;
                    } catch (recoveryError) {
                        renderer?.destroy(); renderer = null;
                        console.warn("[map-engine] Tactical recovery failed", recoveryError);
                    }
                }
                renderer?.resume();
                notice("Map switch failed: " + error.message);
                console.warn("[map-engine]", error);
                return false;
            } finally {
                lastSwitchMs = performance.now() - started;
                transitioning = false;
                Object.entries(buttons).forEach(([mode, button]) => {
                    button.disabled = false;
                    button.setAttribute("aria-pressed", String((mode === "tactical") === isTacticalMapActive()));
                });
                pending = null;
            }
        });
        return pending;
    }
    // These singleton listeners survive switches; only the renderer's listeners
    // and visual update timer are recreated/disposed. No data subscription here.
    onLayerChange((id, enabled) => {
        if ((id === "military-bases" || id === "*") && isLayerEnabled("military-bases")) void ensureBasesData();
        if (!isTacticalMapActive() || transitioning) return;
        const selection = getMapSelection();
        const layer = getMapSources().get(selection?.type)?.layer;
        if (layer && !isLayerEnabled(layer)) select(selection.type, "");
        if (enabled && THREE_D_LAYERS.has(id)) {
            void switchMode("satellite", id + " requires Satellite");
        } else renderer?.refresh();
    });
    document.addEventListener("wz:asset-focus-changed", (event) => {
        if (isTacticalMapActive() || transitioning) return;
        const state = event.detail;
        const previous = getMapSelection();
        if (state?.assetId) {
            if (previous?.id !== state.assetId || previous?.type !== state.assetType)
                rememberMapSelection({ type: state.assetType, id: state.assetId, follow: true });
        } else if (previous && state?.state === "inactive") rememberMapSelection(null);
    });
    manager = { switchMode, select, region, showSelection, notice,
        overlayContainer: container,
        start: () => switchMode(readPreference()),
        api: {
            requestRender: () => renderer?.requestRender(),
            getCameraHeight: () => renderer?.map.transform.getCameraAltitude(),
            getSceneMode: getTacticalView,
            setSceneMode: routeTacticalView,
            setMapMode: routeTacticalView,
            isContourLayerVisible: () => false,
            isFocusedTerrainActive: () => false,
            setContourLayerVisible: (visible) => visible
                ? switchMode("satellite", "Contour view").then((ok) => ok && viewer.__warzone.setContourLayerVisible(true))
                : Promise.resolve(false),
            refreshContourFromViewport: (settings) => switchMode("satellite", "Contour view")
                .then((ok) => ok && viewer.__warzone.refreshContourFromViewport?.(settings)),
            enableFocusedTerrain: () => switchMode("satellite", "Terrain view")
                .then((ok) => ok && viewer.__warzone.enableFocusedTerrain?.()),
            disableFocusedTerrain: () => Promise.resolve(false),
        },
        setView: (view) => renderer?.setView(view) || false,
        project: (point) => {
            if (!renderer || point?.lon == null || point?.lat == null) return null;
            const lon = Number(point.lon), lat = Number(point.lat);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            const screen = point.height != null ? renderer.projectPoint(point) : renderer.map.project([lon, lat]);
            if (!screen) return null;
            const rect = container.getBoundingClientRect();
            return { x: rect.left + screen.x, y: rect.top + screen.y, space: "viewport" };
        },
        getViewportBounds: () => {
            if (!renderer) return null;
            const b = renderer.map.getBounds();
            return { minLon: clamp(b.getWest(), -180, 180), minLat: clamp(b.getSouth(), -85, 85),
                maxLon: clamp(b.getEast(), -180, 180), maxLat: clamp(b.getNorth(), -85, 85) };
        } };
    setMapHost(manager);
    if (typeof __STRATOPS_DEV_TOOLS__ !== "undefined" && __STRATOPS_DEV_TOOLS__
        && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        window.__warzoneMapDiagnostics = () => ({ mode: isTacticalMapActive() ? "tactical" : "satellite",
            switching: transitioning, lastSwitchMs, cesiumRenderLoop: viewer?.useDefaultRenderLoop ?? false,
            lastSwitchError,
            ownedWebGLContexts: Number(Boolean(viewer)) + Number(Boolean(renderer)),
            activeRenderers: Number(Boolean(viewer?.useDefaultRenderLoop)) + Number(Boolean(renderer) && isTacticalMapActive() && !transitioning),
            selection: getMapSelection(),
            tactical: renderer?.diagnostics() || null });
    }
    // The boot sequence awaits the selected renderer's own first frame.
    if (isLayerEnabled("military-bases")) void ensureBasesData();
    manager.ready = options.autoStart === false ? Promise.resolve(false) : manager.start();
    return manager;
}
