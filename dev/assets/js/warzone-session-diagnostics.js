// Opt-in local diagnostics. Never requests a render, polls a provider or records data.
import { getRealtimeStats } from "./warzone-realtime-performance.js";

export function installSessionDiagnostics({ development = false } = {}) {
    if (!development || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname)) return null;
    if (window.__stratopsSessionDiagnostics) return window.__stratopsSessionDiagnostics;
    const intervals = [], lifecycle = [], longTasks = [], entries = [];
    const seenViewers = new WeakSet(), removers = [];
    let frame = 0, lastFrame = null, lastActiveFrame = null, viewer = null;
    let viewerCount = 0, renderedFrames = 0, removeRender = null, disposed = false;
    let pendingEntry = null, confirmCount = 0, observer = null;
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
        viewer = next;
        if (!seenViewers.has(viewer)) { seenViewers.add(viewer); viewerCount++; }
        removeRender = viewer.scene?.postRender?.addEventListener(() => { renderedFrames++; });
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
            persisted: event.persisted === true, renderMode: viewer?.scene?.requestRenderMode ?? null }, 64);
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
    }
    const api = {
        snapshot() {
            observeViewer();
            const scene = viewer?.scene, stats = getRealtimeStats();
            const runtime = window.__getStratOpsPerformanceDiagnostics?.();
            const sum = intervals.reduce((total, delta) => total + delta, 0);
            const events = Object.fromEntries(["preUpdate", "postUpdate", "preRender", "postRender"]
                .map(name => [name, scene?.[name]?.numberOfListeners ?? null]));
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
                resolutionScale: viewer?.resolutionScale ?? null, contextLost: scene?.canvas?.getContext?.("webgl2")?.isContextLost?.() ?? null,
                sceneEventSubscriptions: events, totalEntities, shownEntities, topLevelPrimitives: scene?.primitives?.length ?? 0,
                pendingTrackUpdates: stats.queueDepth, pendingVisualCandidates: stats.pendingVisualCandidates,
                instrumentedAppTimers: runtime?.activeTimers ?? null,
                diagnosticRafPending: Boolean(frame), longTasks: longTasks.slice(), lifecycle: lifecycle.slice(), entries: entries.map(entry => ({ ...entry })) };
        },
        dispose() {
            disposed = true;
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            removeRender?.(); observer?.disconnect(); removers.forEach(remove => remove());
            if (window.__stratopsSessionDiagnostics === api) delete window.__stratopsSessionDiagnostics;
        },
    };
    window.__stratopsSessionDiagnostics = api;
    if (visible()) frame = requestAnimationFrame(tick);
    return api;
}
