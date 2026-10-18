// Injected into the development HTML before the deferred main bundle.
(() => {
    if (window.__stratopsStartupDiagnostics) return;
    const longTasks = [];
    const failures = [];
    const firstRegistryNotificationMs = {};
    const registryEvents = { "wz:aircraft-log-updated": "aircraft", "wz:naval-log-updated": "naval" };
    const registryChanged = (event) => {
        const kind = registryEvents[event.type];
        if (firstRegistryNotificationMs[kind] == null) firstRegistryNotificationMs[kind] = Math.round(performance.now());
    };
    Object.keys(registryEvents).forEach((name) => document.addEventListener(name, registryChanged));
    const recordFailure = (event) => {
        const error = event.reason || event.error;
        const url = event.target?.src || error?.request || event.filename;
        if (!url && error?.name !== "ChunkLoadError") return;
        failures.push({ atMs: Math.round(performance.now()), url: url || null,
            name: error?.name || "ResourceError", message: error?.message || event.message || "Resource could not load" });
        if (failures.length > 50) failures.shift();
    };
    window.addEventListener("error", recordFailure, true);
    window.addEventListener("unhandledrejection", recordFailure);
    let observer = null;
    if (typeof PerformanceObserver === "function" &&
        PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
        observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                longTasks.push({ startMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration) });
            }
            if (longTasks.length > 200) longTasks.splice(0, longTasks.length - 200);
        });
        observer.observe({ type: "longtask", buffered: true });
    }
    const rounded = (value) => Math.round(Number(value) || 0);
    const since = (start, end) => {
        const a = performance.getEntriesByName(start, "mark")[0];
        const b = performance.getEntriesByName(end, "mark")[0];
        return a && b ? rounded(b.startTime - a.startTime) : null;
    };
    window.__stratopsStartupDiagnostics = () => {
        const nav = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource");
        const scripts = resources.filter((entry) => /\.js(?:[?#]|$)/.test(entry.name));
        const main = scripts.find((entry) => /\/assets\/js\/bundle(?:\.|$)/.test(new URL(entry.name).pathname));
        return {
            navigation: nav ? { responseStartMs: rounded(nav.responseStart),
                responseEndMs: rounded(nav.responseEnd), domContentLoadedMs: rounded(nav.domContentLoadedEventEnd) } : null,
            // Resource completion includes transfer, not JavaScript evaluation.
            scripts: scripts.map((entry) => ({ path: new URL(entry.name).pathname,
                startMs: rounded(entry.startTime), durationMs: rounded(entry.duration),
                transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })),
            mainResponseEndMs: main ? rounded(main.responseEnd) : null,
            mainResponseToModuleBodyMs: main ? since("stratops-main-response-end", "stratops-main-module-start") : null,
            // Entry-array marker executes before index.js's static dependencies.
            // Excludes script transfer and browser parse/compile before execution.
            staticDependencyExecutionMs: since("stratops-entry-evaluation-start", "stratops-main-module-start"),
            stylesheets: resources.filter((entry) => entry.initiatorType === "link" &&
                (/\.css(?:[?#]|$)/.test(entry.name) || new URL(entry.name).hostname === "fonts.googleapis.com"))
                .map((entry) => ({ url: entry.name, startMs: rounded(entry.startTime), durationMs: rounded(entry.duration) })),
            tacticalModuleLoadingMs: since("stratops-tactical-import-start", "stratops-tactical-import-end"),
            tacticalManagerToMapMs: since("stratops-tactical-import-end", "stratops-first-usable-map"),
            regionToMapMs: since("stratops-region-confirmed", "stratops-first-usable-map"),
            firstUsableMapFromNavigationMs: performance.getEntriesByName("stratops-first-usable-map", "mark")[0]?.startTime ?? null,
            operationalDataMs: since("stratops-operational-data-start", "stratops-operational-ready"),
            measures: performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("stratops-"))
                .map((entry) => ({ name: entry.name, startMs: rounded(entry.startTime), durationMs: rounded(entry.duration) })),
            apiRequests: resources.filter((entry) => ["fetch", "xmlhttprequest"].includes(entry.initiatorType))
                .map((entry) => ({ path: new URL(entry.name).pathname, startMs: rounded(entry.startTime), durationMs: rounded(entry.duration) })),
            firstRegistryNotificationMs: { ...firstRegistryNotificationMs },
            trackers: window.__stratopsTrackerTimings || null,
            operations: window.__getStratOpsPerformanceDiagnostics?.() || null,
            aircraftPipeline: window.__getWarzoneAircraftPipelineDiagnostics?.() || null,
            orbital: window.__getWarzoneMilSatsDiagnostics?.() || null,
            failures: failures.slice(),
            cesiumInitialized: Boolean(window.__warzoneViewer),
            map: window.__warzoneMapDiagnostics?.() || null,
            longTasks: longTasks.slice(),
            note: "Compilation is measured separately by [dev-timing]. Pending requests and detailed JS evaluation require DevTools Network/Performance.",
        };
    };
    // Resource entries become available after transfer, before module evaluation.
    // A named mark at that timestamp lets the entry module compare its start.
    window.addEventListener("DOMContentLoaded", () => {
        const main = performance.getEntriesByType("resource").find((entry) =>
            /\/assets\/js\/bundle(?:\.|$)/.test(new URL(entry.name).pathname));
        if (main) performance.mark("stratops-main-response-end", { startTime: main.responseEnd });
    }, { once: true });
    window.__stopStratopsStartupDiagnostics = () => {
        observer?.disconnect();
        window.removeEventListener("error", recordFailure, true);
        window.removeEventListener("unhandledrejection", recordFailure);
        Object.keys(registryEvents).forEach((name) => document.removeEventListener(name, registryChanged));
    };
})();
