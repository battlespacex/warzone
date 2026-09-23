const fs = require("fs");
const path = require("path");
const { chromium } = require("../apps/worker/node_modules/playwright");

const executablePath = "C:/Users/wirfa/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const durationMs = Math.max(3000, Number(process.env.PERF_DURATION_MS || 30000));
const baseUrl = process.env.PERF_URL || "http://127.0.0.1:4173/pages/index.html";
const label = process.env.PERF_LABEL || "current";
const traceEnabled = process.env.PERF_TRACE !== "0";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

function summarizeCpu(profile) {
    const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
    const totals = new Map();
    (profile.samples || []).forEach((nodeId, index) => {
        const frame = nodes.get(nodeId)?.callFrame;
        if (!frame) return;
        const url = String(frame.url || "").replace(/^.*\/assets\//, "/assets/");
        const key = `${frame.functionName || "(anonymous)"} | ${url}:${Number(frame.lineNumber || 0) + 1}`;
        totals.set(key, (totals.get(key) || 0) + Number(profile.timeDeltas?.[index] || 0) / 1000);
    });
    return [...totals]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([frame, milliseconds]) => ({ frame, milliseconds: Math.round(milliseconds * 10) / 10 }));
}

async function readTrace(cdp, stream) {
    let text = "";
    while (true) {
        const part = await cdp.send("IO.read", { handle: stream });
        text += part.data || "";
        if (part.eof) break;
    }
    await cdp.send("IO.close", { handle: stream });
    return JSON.parse(text).traceEvents || [];
}

function summarizeTrace(events) {
    const names = new Map(events.filter((event) => event.ph === "M" && event.name === "thread_name")
        .map((event) => [`${event.pid}:${event.tid}`, event.args?.name]));
    const rows = new Map();
    for (const event of events) {
        if (event.ph !== "X" || !Number.isFinite(event.dur) || event.dur < 1000) continue;
        const thread = names.get(`${event.pid}:${event.tid}`) || "unknown";
        if (!/RendererMain|CrGpuMain|VizCompositorThread|Compositor/i.test(thread)) continue;
        const key = `${thread} | ${event.name}`;
        const row = rows.get(key) || { task: key, count: 0, totalMs: 0, worstMs: 0 };
        const milliseconds = event.dur / 1000;
        row.count += 1;
        row.totalMs += milliseconds;
        row.worstMs = Math.max(row.worstMs, milliseconds);
        rows.set(key, row);
    }
    return [...rows.values()]
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, 40)
        .map((row) => ({ ...row, totalMs: Math.round(row.totalMs), worstMs: Math.round(row.worstMs * 10) / 10 }));
}

async function enterApp(page) {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => window.__stratopsConfig, null, { timeout: 20000 });
    await page.evaluate((overrides) => {
        const config = window.__stratopsConfig;
        if (overrides.basemap) config.basemap.provider = overrides.basemap;
        if (overrides.mapUrl) config.basemap.selfhosted.baseUrl = overrides.mapUrl;
        if (overrides.terrain) config.terrain.provider = overrides.terrain;
        if (overrides.terrainUrl) config.terrain.selfhosted.baseUrl = overrides.terrainUrl;
        window.__emptyGlobeDisableFeatures = overrides.disableFeatures;
        if (overrides.emptyFeatureSet && window.STRATOPS_FEATURES) {
            for (const [group, entries] of Object.entries(window.STRATOPS_FEATURES)) {
                for (const key of Object.keys(entries || {})) entries[key] = false;
            }
            Object.assign(window.STRATOPS_FEATURES.system || {}, {
                intro: true,
                authentication: true,
                globe: true,
                regionSelection: true,
            });
            if (window.STRATOPS_FEATURES.header) window.STRATOPS_FEATURES.header.regionSelector = true;
        }
        if (overrides.disableEffects) {
            const style = document.createElement("style");
            style.id = "empty-globe-disable-effects";
            style.textContent = "body * { backdrop-filter: none !important; filter: none !important; box-shadow: none !important; animation: none !important; transition: none !important; }";
            document.head.appendChild(style);
        }
    }, {
        basemap: process.env.PERF_BASEMAP || "",
        mapUrl: process.env.PERF_MAP_URL || "",
        terrain: process.env.PERF_TERRAIN || "",
        terrainUrl: process.env.PERF_TERRAIN_URL || "",
        disableEffects: process.env.PERF_DISABLE_EFFECTS === "1",
        disableFeatures: process.env.PERF_DISABLE_FEATURES || "",
        emptyFeatureSet: process.env.PERF_EMPTY_FEATURE_SET === "1",
    });
    if (await page.locator("#wz-pre-entry-enter").count()) {
        await page.locator("#wz-pre-entry-enter").click();
    }
    await page.locator("#intro-disclaimer-check").check();
    await page.locator("#wz-intro-accept").click();
    await page.getByRole("button", { name: /Middle East & Gulf/i }).click();
    await page.locator("#wz-region-confirm").click();
    await page.waitForFunction(() => window.__warzoneViewer && document.body.classList.contains("is-app-active"), null, { timeout: 45000 });
    if (process.env.PERF_FORCE_RUNTIME_EMPTY === "1") {
        await page.evaluate(() => {
            const viewer = window.__warzoneViewer;
            viewer.trackedEntity = undefined;
            viewer.selectedEntity = undefined;
            viewer.entities?.removeAll?.();
            viewer.dataSources?.removeAll?.(true);
            viewer.scene?.primitives?.removeAll?.();
            viewer.scene?.groundPrimitives?.removeAll?.();
            viewer.scene?.requestRender?.();
        });
    }
    await page.waitForTimeout(Math.max(1000, Number(process.env.PERF_SETTLE_MS || 5000)));
}

async function main() {
    const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--enable-gpu", "--ignore-gpu-blocklist"],
    });
    const context = await browser.newContext({ viewport: { width: 1712, height: 1000 }, deviceScaleFactor: Number(process.env.PERF_DPR || 1) });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.addInitScript(() => {
        window.__emptyGlobeLongTasks = [];
        window.__emptyGlobeResources = [];
        try {
            new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => window.__emptyGlobeLongTasks.push({
                    start: entry.startTime,
                    duration: entry.duration,
                }));
            }).observe({ type: "longtask", buffered: true });
            new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => window.__emptyGlobeResources.push({
                    name: entry.name,
                    start: entry.startTime,
                    end: entry.responseEnd,
                    duration: entry.duration,
                    transferSize: entry.transferSize,
                }));
            }).observe({ type: "resource", buffered: true });
        } catch { }
    });
    if (process.env.PERF_EMPTY_FEATURE_SET === "1") {
        await page.addInitScript(() => {
            let featureConfig;
            const emptyFeatures = (next) => {
                if (!next || typeof next !== "object") return next;
                for (const entries of Object.values(next)) {
                    for (const key of Object.keys(entries || {})) entries[key] = false;
                }
                Object.assign(next.system || {}, {
                    intro: true,
                    authentication: true,
                    globe: true,
                    regionSelection: true,
                });
                if (next.header) next.header.regionSelector = true;
                return next;
            };
            Object.defineProperty(window, "STRATOPS_FEATURES", {
                configurable: true,
                get: () => featureConfig,
                set: (next) => { featureConfig = emptyFeatures(next); },
            });
        });
    }
    await enterApp(page);
    const canvas = page.locator(".cesium-widget canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Cesium canvas has no bounding box");

    await page.evaluate(() => {
        const viewer = window.__warzoneViewer;
        const scene = viewer.scene;
        const canvas = scene.canvas;
        const eventNames = ["moveStart", "moveEnd", "changed"];
        const sceneEvents = ["preRender", "postRender", "preUpdate", "postUpdate"];
        const timings = [];
        const disableFeatures = String(window.__emptyGlobeDisableFeatures || "");
        const wrapEvent = (event, eventName) => {
            if (!(event?._listeners instanceof Map)) return;
            const original = [...event._listeners.entries()];
            event._listeners.clear();
            original.forEach(([callback, scopes], index) => {
                const source = String(callback);
                const row = {
                    event: eventName,
                    index,
                    source: source.replace(/\s+/g, " ").slice(0, 220),
                    count: 0,
                    totalMs: 0,
                    worstMs: 0,
                };
                const wrapped = function (...args) {
                    const startedAt = performance.now();
                    try {
                        return callback.apply(this, args);
                    } finally {
                        const elapsed = performance.now() - startedAt;
                        row.count += 1;
                        row.totalMs += elapsed;
                        row.worstMs = Math.max(row.worstMs, elapsed);
                    }
                };
                event._listeners.set(wrapped, scopes);
                timings.push(row);
            });
        };
        eventNames.forEach((name) => wrapEvent(viewer.camera[name], `camera.${name}`));
        sceneEvents.forEach((name) => wrapEvent(scene[name], `scene.${name}`));

        if (disableFeatures.includes("render-effects")) {
            if (scene.postProcessStages?.fxaa) scene.postProcessStages.fxaa.enabled = false;
            scene.msaaSamples = 1;
            scene.orderIndependentTranslucency = false;
        }

        const requestRenderCallers = new Map();
        const originalRequestRender = scene.requestRender.bind(scene);
        let requestRenderCalls = 0;
        scene.requestRender = function (...args) {
            requestRenderCalls += 1;
            const stack = String(new Error().stack || "").split("\n").slice(2)
                .find((line) => !line.includes("profile-empty-globe")) || "unknown";
            const key = stack.trim().replace(/https?:\/\/[^/]+/, "");
            requestRenderCallers.set(key, (requestRenderCallers.get(key) || 0) + 1);
            return originalRequestRender(...args);
        };

        let resizeCalls = 0;
        const originalResize = viewer.resize.bind(viewer);
        viewer.resize = function (...args) {
            resizeCalls += 1;
            return originalResize(...args);
        };
        let resizeObserverCallbacks = 0;
        const resizeObserver = new ResizeObserver(() => { resizeObserverCallbacks += 1; });
        resizeObserver.observe(canvas);
        let canvasAttributeChanges = 0;
        const canvasSizeChanges = [];
        const mutationObserver = new MutationObserver((records) => {
            const sizeRecords = records.filter((record) => record.attributeName === "width" || record.attributeName === "height");
            canvasAttributeChanges += sizeRecords.length;
            if (sizeRecords.length) canvasSizeChanges.push({
                at: performance.now(),
                width: canvas.width,
                height: canvas.height,
                resolutionScale: viewer.resolutionScale,
            });
        });
        mutationObserver.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });

        window.__emptyGlobeSample = {
            startedAt: 0,
            endedAt: 0,
            active: false,
            frameTimes: [],
            timings,
            get requestRenderCalls() { return requestRenderCalls; },
            get requestRenderCallers() { return [...requestRenderCallers.entries()].sort((a, b) => b[1] - a[1]); },
            get resizeCalls() { return resizeCalls; },
            get resizeObserverCallbacks() { return resizeObserverCallbacks; },
            get canvasAttributeChanges() { return canvasAttributeChanges; },
            get canvasSizeChanges() { return canvasSizeChanges; },
        };
        const tick = (now) => {
            if (window.__emptyGlobeSample.active) window.__emptyGlobeSample.frameTimes.push(now);
            window.__emptyGlobeFrameRaf = requestAnimationFrame(tick);
        };
        window.__emptyGlobeFrameRaf = requestAnimationFrame(tick);
    });

    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await cdp.send("Profiler.start");
    if (traceEnabled) {
        await cdp.send("Tracing.start", {
            categories: "devtools.timeline,v8,blink,cc,gpu,disabled-by-default-devtools.timeline.frame,disabled-by-default-v8.cpu_profiler",
            transferMode: "ReturnAsStream",
        });
    }
    await page.evaluate(() => {
        window.__emptyGlobeLongTasks.length = 0;
        window.__emptyGlobeResources.length = 0;
        window.__emptyGlobeSample.startedAt = performance.now();
        window.__emptyGlobeSample.active = true;
        window.__stratopsPerf?.beginImagerySample?.("continuous-drag");
    });

    const x0 = box.x + box.width * 0.5;
    const y0 = box.y + box.height * 0.55;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const dragStartedAt = Date.now();
    let step = 0;
    while (Date.now() - dragStartedAt < durationMs) {
        const x = x0 + Math.sin(step * 0.095) * Math.min(420, box.width * 0.32);
        const y = y0 + Math.sin(step * 0.037) * Math.min(90, box.height * 0.1);
        await page.mouse.move(x, y);
        step += 1;
        await sleep(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(750);
    await page.evaluate(() => {
        const sample = window.__emptyGlobeSample;
        sample.active = false;
        sample.endedAt = performance.now();
        cancelAnimationFrame(window.__emptyGlobeFrameRaf);
        sample.finished = {
            requestRenderCalls: sample.requestRenderCalls,
            requestRenderCallers: sample.requestRenderCallers,
            resizeCalls: sample.resizeCalls,
            resizeObserverCallbacks: sample.resizeObserverCallbacks,
            canvasAttributeChanges: sample.canvasAttributeChanges,
            canvasSizeChanges: sample.canvasSizeChanges.slice(),
            timings: sample.timings.map((row) => ({ ...row })),
            imagery: window.__stratopsPerf?.endImagerySample?.(),
        };
    });

    const cpuProfile = (await cdp.send("Profiler.stop")).profile;
    let traceSummary = [];
    if (traceEnabled) {
        const completed = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
        await cdp.send("Tracing.end");
        const { stream } = await completed;
        traceSummary = summarizeTrace(await readTrace(cdp, stream));
    }
    const state = await page.evaluate(() => {
        const viewer = window.__warzoneViewer;
        const scene = viewer.scene;
        const canvas = scene.canvas;
        const sample = window.__emptyGlobeSample;
        const primitives = [];
        const visit = (collection) => {
            const list = collection?._primitives || [];
            for (const primitive of list) {
                primitives.push(primitive);
                if (primitive?._primitives) visit(primitive);
            }
        };
        visit(scene.primitives);
        const typeCount = (pattern) => primitives.filter((item) => pattern.test(item?.constructor?.name || "")).length;
        const frameGaps = sample.frameTimes.slice(1).map((time, index) => time - sample.frameTimes[index]);
        const classifyResource = (name) => {
            if (/elevation|terrain|quantized-mesh|terrarium/i.test(name)) return "terrain";
            if (/arcgisonline|World_Imagery|\/map\/v1\//i.test(name)) return "imagery";
            return "other";
        };
        const resources = window.__emptyGlobeResources
            .filter((entry) => entry.start <= sample.endedAt)
            .map((entry) => ({ ...entry, kind: classifyResource(entry.name) }));
        const overlayEffects = [...document.querySelectorAll("body *")].filter((element) => {
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
            const rect = element.getBoundingClientRect();
            const large = rect.width >= innerWidth * 0.8 && rect.height >= innerHeight * 0.8;
            return large && (style.backdropFilter !== "none" || style.filter !== "none" || style.mixBlendMode !== "normal");
        }).map((element) => ({
            id: element.id,
            className: String(element.className || "").slice(0, 180),
            filter: getComputedStyle(element).filter,
            backdropFilter: getComputedStyle(element).backdropFilter,
            mixBlendMode: getComputedStyle(element).mixBlendMode,
        }));
        const longTasks = window.__emptyGlobeLongTasks.filter((task) => task.start <= sample.endedAt);
        const finished = sample.finished;
        return {
            sampleDurationMs: sample.endedAt - sample.startedAt,
            emptyMode: window.__stratopsPerfEmptyGlobeReady === true,
            frameCount: sample.frameTimes.length,
            frameGaps,
            fps: sample.frameTimes.length / Math.max(0.001, (sample.frameTimes.at(-1) - sample.frameTimes[0]) / 1000),
            longTasks,
            requestRenderCalls: finished.requestRenderCalls,
            requestRenderCallers: finished.requestRenderCallers,
            handlerTimings: finished.timings.map((row) => ({
                ...row,
                averageMs: row.count ? row.totalMs / row.count : 0,
            })),
            resize: {
                viewerResizeCalls: finished.resizeCalls,
                resizeObserverCallbacks: finished.resizeObserverCallbacks,
                canvasAttributeChanges: finished.canvasAttributeChanges,
                canvasSizeChanges: finished.canvasSizeChanges,
            },
            canvas: {
                clientWidth: canvas.clientWidth,
                clientHeight: canvas.clientHeight,
                width: canvas.width,
                height: canvas.height,
                drawingBufferWidth: scene.drawingBufferWidth,
                drawingBufferHeight: scene.drawingBufferHeight,
                devicePixelRatio,
                resolutionScale: viewer.resolutionScale,
            },
            settings: {
                requestRenderMode: scene.requestRenderMode,
                maximumRenderTimeChange: scene.maximumRenderTimeChange,
                msaaSamples: scene.msaaSamples,
                fxaa: scene.postProcessStages?.fxaa?.enabled,
                hdr: scene.highDynamicRange,
                fog: scene.fog?.enabled,
                skyAtmosphere: scene.skyAtmosphere?.show,
                globeLighting: scene.globe?.enableLighting,
                dynamicAtmosphereLighting: scene.globe?.dynamicAtmosphereLighting,
                groundAtmosphere: scene.globe?.showGroundAtmosphere,
                shadows: viewer.shadows,
                terrainShadows: scene.globe?.shadows,
                oit: scene.orderIndependentTranslucency,
                maximumScreenSpaceError: scene.globe?.maximumScreenSpaceError,
                tileCacheSize: scene.globe?.tileCacheSize,
                loadingDescendantLimit: scene.globe?.loadingDescendantLimit,
                preloadAncestors: scene.globe?.preloadAncestors,
                preloadSiblings: scene.globe?.preloadSiblings,
                cameraPercentageChanged: viewer.camera.percentageChanged,
                terrainProvider: viewer.terrainProvider?.__warzoneProviderKind || viewer.terrainProvider?.constructor?.name,
            },
            runtime: {
                imageryLayers: viewer.imageryLayers?.length || 0,
                primitives: primitives.length,
                groundPrimitives: scene.groundPrimitives?._primitives?.length || 0,
                dataSources: viewer.dataSources?.length || 0,
                entities: viewer.entities?.values?.length || 0,
                tilesets: typeCount(/Cesium3DTileset/),
                models: typeCount(/Model/),
                billboards: typeCount(/Billboard/),
                labels: typeCount(/Label/),
                overlayEffects,
                bodyClasses: document.body.className,
                entryVisible: Boolean(document.querySelector("#wz-pre-entry-modal.is-visible, #wz-intro-modal.is-visible, .site-loader.is-active")),
                startupSatelliteState: window.__warzoneStartupMilSatsState || window.__warzoneStartupDemoState || null,
                devToolsPresent: Boolean(document.querySelector("#wz-model-tuner, .wz-model-tuner, #wz-dev-panel")),
            },
            resources,
            cesiumPerf: {
                camera: window.__stratopsPerf?.getCameraStats?.(),
                requestRender: window.__stratopsPerf?.getRequestRenderStats?.(),
                imagery: finished.imagery,
                animation: window.__stratopsPerf?.getAnimationStats?.(),
                render: window.__stratopsPerf?.getRenderStats?.(),
            },
        };
    });
    const gaps = state.frameGaps;
    const result = {
        label,
        url: baseUrl,
        durationMs,
        emptyMode: state.emptyMode,
        frames: {
            fps: Math.round(state.fps * 100) / 100,
            count: state.frameCount,
            averageMs: Math.round((gaps.reduce((sum, value) => sum + value, 0) / Math.max(1, gaps.length)) * 100) / 100,
            p95Ms: Math.round(percentile(gaps, 0.95) * 100) / 100,
            p99Ms: Math.round(percentile(gaps, 0.99) * 100) / 100,
            maximumMs: Math.round(Math.max(0, ...gaps) * 100) / 100,
            over50Ms: gaps.filter((value) => value > 50).length,
            over100Ms: gaps.filter((value) => value > 100).length,
            over200Ms: gaps.filter((value) => value > 200).length,
        },
        longTasks: {
            count: state.longTasks.length,
            totalMs: Math.round(state.longTasks.reduce((sum, task) => sum + task.duration, 0)),
            worstMs: Math.round(Math.max(0, ...state.longTasks.map((task) => task.duration)) * 10) / 10,
            top: [...state.longTasks].sort((a, b) => b.duration - a.duration).slice(0, 15),
        },
        requestRender: {
            calls: state.requestRenderCalls,
            callsPerSecond: Math.round((state.requestRenderCalls / (state.sampleDurationMs / 1000)) * 100) / 100,
            callers: state.requestRenderCallers.slice(0, 20),
        },
        handlerTimings: state.handlerTimings,
        canvas: state.canvas,
        resize: state.resize,
        settings: state.settings,
        runtime: state.runtime,
        network: {
            imageryRequests: state.resources.filter((entry) => entry.kind === "imagery").length,
            terrainRequests: state.resources.filter((entry) => entry.kind === "terrain").length,
            totalRequests: state.resources.length,
        },
        cesiumPerf: state.cesiumPerf,
        cpu: summarizeCpu(cpuProfile),
        trace: traceSummary,
        consoleErrors,
        failedRequests,
    };
    const output = path.resolve(`.generated/empty-globe-${label}.json`);
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, frames: result.frames, longTasks: result.longTasks, requestRender: result.requestRender, canvas: result.canvas, settings: result.settings, runtime: result.runtime, network: result.network, cpu: result.cpu.slice(0, 12), trace: result.trace.slice(0, 12), errors: consoleErrors.length }, null, 2));
    await browser.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
