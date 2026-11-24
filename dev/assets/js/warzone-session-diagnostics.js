// Opt-in local diagnostics. Never requests a render, polls a provider or records data.
import { getRealtimeStats } from "./warzone-realtime-performance.js";
import { ResourceCache } from "cesium";

// These counters are partial estimates, never total Chrome/process/GPU memory.
export function readAllocationCounters(viewer) {
    const scene = viewer?.scene, heap = performance.memory;
    return {
        sampledAt: performance.now(), heapUsedBytes: heap?.usedJSHeapSize ?? null,
        heapTotalBytes: heap?.totalJSHeapSize ?? null, heapLimitBytes: heap?.jsHeapSizeLimit ?? null,
        drawingBufferWidth: scene?.drawingBufferWidth ?? scene?.canvas?.width ?? null,
        drawingBufferHeight: scene?.drawingBufferHeight ?? scene?.canvas?.height ?? null,
        // Cesium includes retained CPU copies in its geometry-cache statistic.
        modelCacheGeometryCpuAndGpuBytes: ResourceCache.statistics.geometryByteLength,
        modelCacheTextureBytes: ResourceCache.statistics.texturesByteLength,
        imageryLayers: viewer?.imageryLayers?.length ?? 0, dataSources: viewer?.dataSources?.length ?? 0,
        viewerEntities: viewer?.entities?.values?.length ?? 0, topLevelPrimitives: scene?.primitives?.length ?? 0,
        contextLost: scene?.context?._gl?.isContextLost?.() ?? null,
    };
}

export function readLoadedTileAllocations(viewer) {
    const surface = viewer?.scene?.globe?._surface;
    if (!surface?.forEachLoadedTile) return null;
    // Version-specific Cesium internals: on-demand, read-only and de-duplicated.
    const textures = new Set(), arrays = new Set();
    let loadedTiles = 0, imageryTextureBytes = 0, terrainMeshCpuBytes = 0;
    const texture = value => {
        if (!value || textures.has(value)) return;
        textures.add(value); imageryTextureBytes += Number(value.sizeInBytes || 0);
    };
    surface.forEachLoadedTile(tile => {
        loadedTiles++;
        for (const item of tile.data?.imagery || []) {
            for (const image of [item.readyImagery, item.loadingImagery]) {
                texture(image?.texture); texture(image?.textureWebMercator);
            }
        }
        for (const value of [tile.data?.mesh?.vertices, tile.data?.mesh?.indices]) {
            if (value?.buffer && !arrays.has(value.buffer)) {
                arrays.add(value.buffer); terrainMeshCpuBytes += value.buffer.byteLength;
            }
        }
    });
    return { loadedTiles, uniqueImageryTextures: textures.size, imageryTextureBytes, terrainMeshCpuBytes,
        note: "Partial loaded-tile estimates; excludes framebuffers, driver overhead and other GPU allocations" };
}

export function countLoadedModels(collection, seen = new Set()) {
    let total = 0, ready = 0;
    if (!collection?.get || seen.has(collection)) return { total, ready };
    seen.add(collection);
    for (let i = 0; i < collection.length; i++) {
        const primitive = collection.get(i);
        if (!primitive || seen.has(primitive)) continue;
        if (typeof primitive.getNode === "function" && primitive.statistics) {
            seen.add(primitive); total++; if (primitive.ready) ready++;
        } else if (typeof primitive.destroyPrimitives === "boolean") {
            const nested = countLoadedModels(primitive, seen); total += nested.total; ready += nested.ready;
        }
    }
    return { total, ready };
}

export function installSessionDiagnostics({ development = false } = {}) {
    if (!development || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname)) return null;
    if (window.__stratopsSessionDiagnostics) return window.__stratopsSessionDiagnostics;
    const intervals = [], lifecycle = [], longTasks = [], entries = [], allocations = [];
    const seenViewers = new WeakSet(), removers = [];
    let frame = 0, lastFrame = null, lastActiveFrame = null, viewer = null;
    let viewerCount = 0, renderedFrames = 0, removeRender = null, removeContextListeners = null, disposed = false;
    let pendingEntry = null, confirmCount = 0, observer = null, markObserver = null;
    const retain = (list, value, limit = 120) => {
        list.push(value);
        if (list.length > limit) list.shift();
    };
    const bind = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        removers.push(() => target.removeEventListener(type, handler, options));
    };
    const visible = () => document.visibilityState !== "hidden";
    function observeViewer() {
        const next = window.__warzoneViewer;
        if (!next || next === viewer) return;
        removeRender?.();
        removeContextListeners?.();
        viewer = next;
        if (!seenViewers.has(viewer)) { seenViewers.add(viewer); viewerCount++; }
        removeRender = viewer.scene?.postRender?.addEventListener(() => { renderedFrames++; });
        const canvas = viewer.scene?.canvas;
        if (canvas?.addEventListener) {
            const record = event => retain(lifecycle, { type: event.type, at: performance.now(),
                allocations: readAllocationCounters(viewer) }, 64);
            canvas.addEventListener("webglcontextlost", record, { passive: true });
            canvas.addEventListener("webglcontextrestored", record, { passive: true });
            removeContextListeners = () => {
                canvas.removeEventListener("webglcontextlost", record);
                canvas.removeEventListener("webglcontextrestored", record);
            };
        }
    }
    function tick(now) {
        frame = 0;
        if (disposed || !visible()) return;
        if (lastFrame !== null) retain(intervals, now - lastFrame);
        lastActiveFrame = lastFrame = now;
        observeViewer();
        const entry = entries[entries.length - 1];
        const boot = window.__warzoneOperationalDataPromise;
        if (entry && !entry.bootObserved && boot) {
            entry.bootObserved = true;
            Promise.resolve(boot).then(() => {
                if (!disposed) entry.bootDataReadyMs = performance.now() - entry.at;
            }, () => {});
        }
        if (pendingEntry) {
            const canvas = viewer?.scene?.canvas;
            const regionModal = document.getElementById("wz-region-modal");
            const shown = document.body.classList.contains("is-app-active") && regionModal?.hidden !== false
                && canvas?.clientWidth > 1 && canvas?.clientHeight > 1;
            if (shown && pendingEntry.globeVisibleMs === null) pendingEntry.globeVisibleMs = now - pendingEntry.at;
            if (shown && viewer.scene.screenSpaceCameraController?.enableInputs !== false) {
                pendingEntry.interactiveMs = now - pendingEntry.at;
                pendingEntry = null;
            }
        }
        frame = requestAnimationFrame(tick);
    }
    function onLifecycle(event) {
        retain(lifecycle, { type: event.type, at: performance.now(), visible: visible(),
            persisted: event.persisted === true, renderMode: viewer?.scene?.requestRenderMode ?? null,
            allocations: readAllocationCounters(window.__warzoneViewer) }, 64);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        lastFrame = null; // A suspension interval is not a slow foreground frame.
        intervals.length = 0;
        if (event.type !== "pagehide" && event.type !== "freeze" && visible()) frame = requestAnimationFrame(tick);
    }
    bind(document, "visibilitychange", onLifecycle);
    for (const type of ["pageshow", "pagehide", "focus", "blur", "freeze", "resume"]) {
        bind(type === "freeze" || type === "resume" ? document : window, type, onLifecycle);
    }
    bind(document, "click", event => {
        const button = event.target.closest?.("#wz-region-confirm");
        if (!button || button.disabled) return;
        confirmCount++;
        const entry = { at: performance.now(), globeVisibleMs: null, interactiveMs: null, bootDataReadyMs: null };
        retain(entries, entry, 32);
        pendingEntry = entry;
    }, true);
    if (typeof PerformanceObserver === "function") {
        try {
            observer = new PerformanceObserver(list => {
                for (const task of list.getEntries()) retain(longTasks, { at: task.startTime, durationMs: task.duration }, 64);
            });
            observer.observe({ type: "longtask", buffered: false });
        } catch { observer?.disconnect(); observer = null; }
        try {
            const phases = new Set(["stratops-region-confirmed", "stratops-viewer-created",
                "stratops-first-usable-map", "stratops-events-render-complete", "stratops-operational-ready"]);
            markObserver = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    if (phases.has(entry.name)) retain(allocations, { phase: entry.name, markAt: entry.startTime,
                        ...readAllocationCounters(window.__warzoneViewer) }, 32);
                }
            });
            markObserver.observe({ type: "mark", buffered: true });
        } catch { markObserver?.disconnect(); markObserver = null; }
    }
    const api = {
        snapshot() {
            observeViewer();
            const scene = viewer?.scene, stats = getRealtimeStats();
            const runtime = window.__getStratOpsPerformanceDiagnostics?.();
            const sum = intervals.reduce((total, delta) => total + delta, 0);
            const events = Object.fromEntries(["preUpdate", "postUpdate", "preRender", "postRender"]
                .map(name => [name, scene?.[name]?.numberOfListeners ?? null]));
            const cameraEvents = Object.fromEntries(["changed", "moveStart", "moveEnd"]
                .map(name => [name, viewer?.camera?.[name]?.numberOfListeners ?? null]));
            let shownEntities = 0, totalEntities = 0;
            const count = collection => {
                for (const entity of collection?.values || []) { totalEntities++; if (entity.isShowing !== false) shownEntities++; }
            };
            count(viewer?.entities);
            for (let i = 0; i < (viewer?.dataSources?.length || 0); i++) count(viewer.dataSources.get(i).entities);
            return { visibility: document.visibilityState, timeSinceLastActiveFrameMs: lastActiveFrame === null ? null : performance.now() - lastActiveFrame,
                frameIntervalsMs: intervals.slice(), displayFrameFps: sum > 0 ? intervals.length * 1000 / sum : null,
                renderedFrames, observedViewerCount: viewerCount, regionConfirmCount: confirmCount,
                requestRenderMode: scene?.requestRenderMode ?? null, maximumRenderTimeChange: scene?.maximumRenderTimeChange ?? null,
                resolutionScale: viewer?.resolutionScale ?? null, contextLost: scene?.context?._gl?.isContextLost?.() ?? null,
                allocations: readAllocationCounters(viewer), loadedTileAllocations: readLoadedTileAllocations(viewer),
                modelPrimitives: countLoadedModels(scene?.primitives),
                entryAllocationSamples: allocations.slice(),
                sceneEventSubscriptions: events, cameraEventSubscriptions: cameraEvents,
                totalEntities, shownEntities, topLevelPrimitives: scene?.primitives?.length ?? 0,
                pendingTrackUpdates: stats.queueDepth, pendingVisualCandidates: stats.pendingVisualCandidates,
                instrumentedAppTimers: runtime?.activeTimers ?? null,
                diagnosticRafPending: Boolean(frame), longTasks: longTasks.slice(), lifecycle: lifecycle.slice(), entries: entries.map(entry => ({ ...entry })) };
        },
        dispose() {
            disposed = true;
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            removeRender?.(); removeContextListeners?.(); observer?.disconnect(); markObserver?.disconnect(); removers.forEach(remove => remove());
            if (window.__stratopsSessionDiagnostics === api) delete window.__stratopsSessionDiagnostics;
        },
    };
    window.__stratopsSessionDiagnostics = api;
    if (visible()) frame = requestAnimationFrame(tick);
    return api;
}
