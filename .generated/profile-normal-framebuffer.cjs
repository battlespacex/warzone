const fs = require("fs");
const path = require("path");
const { chromium } = require("../apps/worker/node_modules/playwright");

const executablePath = "C:/Users/wirfa/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const url = process.env.PERF_URL || "http://127.0.0.1:4173/pages/index.html";
const baselineDurationMs = Number(process.env.PERF_BASELINE_MS || 30000);
const trackerDragDurationMs = Number(process.env.PERF_TRACKER_DRAG_MS || 30000);
const aircraftFocusDurationMs = Number(process.env.PERF_AIRCRAFT_FOCUS_MS || 120000);
const navalFocusDurationMs = Number(process.env.PERF_NAVAL_FOCUS_MS || 30000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};
const round = (value) => Math.round(Number(value || 0) * 100) / 100;

async function enterApp(page) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => window.__stratopsConfig, null, { timeout: 20000 });
    await page.locator("#wz-pre-entry-enter").click();
    await page.locator("#intro-disclaimer-check").check();
    await page.locator("#wz-intro-accept").click();
    await page.getByRole("button", { name: /Middle East & Gulf/i }).click();
    await page.locator("#wz-region-confirm").click();
    await page.waitForFunction(
        () => window.__warzoneViewer && document.body.classList.contains("is-app-active"),
        null,
        { timeout: 60000 },
    );
}

async function installInstrumentation(page) {
    await page.evaluate(() => {
        const viewer = window.__warzoneViewer;
        const scene = viewer.scene;
        const canvas = scene.canvas;
        const state = {
            active: null,
            stages: [],
            tick: 0,
        };
        const snapshot = () => ({
            at: performance.now(),
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
            width: canvas.width,
            height: canvas.height,
            drawingBufferWidth: scene.drawingBufferWidth,
            drawingBufferHeight: scene.drawingBufferHeight,
            devicePixelRatio,
            resolutionScale: viewer.resolutionScale,
            msaaSamples: scene.msaaSamples,
            tileQueueSize: Number(viewer.__warzoneTileLoadQueueSize || 0),
            tileLoadBusy: viewer.__warzoneTileLoadBusy === true,
            entities: viewer.entities?.values?.length || 0,
            dataSources: viewer.dataSources?.length || 0,
        });
        const begin = (name) => {
            const stage = {
                name,
                startedAt: performance.now(),
                frames: [],
                longTasks: [],
                requestRenderCalls: 0,
                viewerResizeCalls: 0,
                resizeObserverCallbacks: 0,
                canvasWidthMutations: 0,
                canvasHeightMutations: 0,
                resolutionScaleChanges: 0,
                msaaSamplesChanges: 0,
                resources: [],
                start: snapshot(),
                lastResolutionScale: viewer.resolutionScale,
                lastMsaaSamples: scene.msaaSamples,
            };
            state.active = stage;
            return stage.start;
        };
        const end = () => {
            const stage = state.active;
            if (!stage) return null;
            stage.endedAt = performance.now();
            stage.end = snapshot();
            delete stage.lastResolutionScale;
            delete stage.lastMsaaSamples;
            state.stages.push(stage);
            state.active = null;
            return stage;
        };
        try {
            new PerformanceObserver((list) => {
                if (!state.active) return;
                for (const entry of list.getEntries()) {
                    state.active.longTasks.push({ start: entry.startTime, duration: entry.duration });
                }
            }).observe({ type: "longtask", buffered: false });
            new PerformanceObserver((list) => {
                if (!state.active) return;
                for (const entry of list.getEntries()) {
                    state.active.resources.push({ name: entry.name, duration: entry.duration });
                }
            }).observe({ type: "resource", buffered: false });
        } catch { }
        const originalRequestRender = scene.requestRender.bind(scene);
        scene.requestRender = (...args) => {
            if (state.active) state.active.requestRenderCalls += 1;
            return originalRequestRender(...args);
        };
        const originalResize = viewer.resize.bind(viewer);
        viewer.resize = (...args) => {
            if (state.active) state.active.viewerResizeCalls += 1;
            return originalResize(...args);
        };
        new ResizeObserver(() => {
            if (state.active) state.active.resizeObserverCallbacks += 1;
        }).observe(canvas);
        new MutationObserver((records) => {
            if (!state.active) return;
            for (const record of records) {
                if (record.attributeName === "width") state.active.canvasWidthMutations += 1;
                if (record.attributeName === "height") state.active.canvasHeightMutations += 1;
            }
        }).observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
        const tick = (now) => {
            const stage = state.active;
            if (stage) {
                stage.frames.push(now);
                if (viewer.resolutionScale !== stage.lastResolutionScale) {
                    stage.resolutionScaleChanges += 1;
                    stage.lastResolutionScale = viewer.resolutionScale;
                }
                if (scene.msaaSamples !== stage.lastMsaaSamples) {
                    stage.msaaSamplesChanges += 1;
                    stage.lastMsaaSamples = scene.msaaSamples;
                }
            }
            state.tick = requestAnimationFrame(tick);
        };
        state.tick = requestAnimationFrame(tick);
        window.__phase2FramebufferProfile = { state, begin, end, snapshot };
    });
}

function summarizeStage(stage) {
    if (!stage) return null;
    const gaps = stage.frames.slice(1).map((time, index) => time - stage.frames[index]);
    const durationSeconds = Math.max(0.001, (stage.endedAt - stage.startedAt) / 1000);
    return {
        name: stage.name,
        durationMs: round(stage.endedAt - stage.startedAt),
        fps: round(stage.frames.length / durationSeconds),
        averageFrameMs: round(gaps.reduce((sum, value) => sum + value, 0) / Math.max(1, gaps.length)),
        p95FrameMs: round(percentile(gaps, 0.95)),
        p99FrameMs: round(percentile(gaps, 0.99)),
        longestFrameGapMs: round(Math.max(0, ...gaps)),
        gapsOver50Ms: gaps.filter((value) => value > 50).length,
        gapsOver100Ms: gaps.filter((value) => value > 100).length,
        longTasks: stage.longTasks.length,
        worstLongTaskMs: round(Math.max(0, ...stage.longTasks.map((task) => task.duration))),
        canvasWidthMutations: stage.canvasWidthMutations,
        canvasHeightMutations: stage.canvasHeightMutations,
        resolutionScaleChanges: stage.resolutionScaleChanges,
        msaaSamplesChanges: stage.msaaSamplesChanges,
        viewerResizeCalls: stage.viewerResizeCalls,
        resizeObserverCallbacks: stage.resizeObserverCallbacks,
        requestRenderPerSecond: round(stage.requestRenderCalls / durationSeconds),
        imageryRequests: stage.resources.filter((entry) => /arcgisonline|World_Imagery|\/map\/v1\//i.test(entry.name)).length,
        terrainRequests: stage.resources.filter((entry) => /elevation|terrain|quantized-mesh|terrarium/i.test(entry.name)).length,
        start: stage.start,
        end: stage.end,
    };
}

async function runStage(page, name, action) {
    await page.evaluate((stageName) => window.__phase2FramebufferProfile.begin(stageName), name);
    await action();
    await page.waitForTimeout(500);
    const stage = await page.evaluate(() => window.__phase2FramebufferProfile.end());
    const summary = summarizeStage(stage);
    console.log(`STAGE ${name} ${JSON.stringify(summary)}`);
    return summary;
}

async function continuousDrag(page, durationMs) {
    const canvas = page.locator(".cesium-widget canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Cesium canvas has no bounds");
    const x0 = box.x + box.width * 0.5;
    const y0 = box.y + box.height * 0.55;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const startedAt = Date.now();
    let step = 0;
    while (Date.now() - startedAt < durationMs) {
        await page.mouse.move(
            x0 + Math.sin(step * 0.095) * Math.min(420, box.width * 0.32),
            y0 + Math.sin(step * 0.037) * Math.min(90, box.height * 0.1),
        );
        step += 1;
        await sleep(16);
    }
    await page.mouse.up();
}

async function continuousZoom(page, durationMs) {
    const canvas = page.locator(".cesium-widget canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Cesium canvas has no bounds");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const startedAt = Date.now();
    let direction = 1;
    let steps = 0;
    while (Date.now() - startedAt < durationMs) {
        await page.mouse.wheel(0, direction * 260);
        steps += 1;
        if (steps % 18 === 0) direction *= -1;
        await sleep(80);
    }
}

async function enableWidgetLayer(page, id) {
    const result = await page.evaluate((layerId) => {
        const button = document.querySelector(`[data-widget-layer-toggle="${layerId}"]`);
        if (!button) return { found: false };
        if (button.getAttribute("aria-pressed") !== "true") button.click();
        return { found: true };
    }, id);
    if (!result.found) return result;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.waitForTimeout(250);
        const approved = await page.evaluate(() => {
            const modal = document.getElementById("wz-layer-warning-modal");
            if (!modal || modal.hidden || !modal.classList.contains("is-visible")) return false;
            document.getElementById("wz-layer-warning-confirm")?.click();
            return true;
        });
        if (approved) break;
    }
    try {
        await page.waitForFunction((layerId) => document.querySelector(`[data-widget-layer-toggle="${layerId}"]`)?.getAttribute("aria-pressed") === "true", id, { timeout: 15000 });
    } catch { }
    return page.evaluate((layerId) => ({
        found: true,
        enabled: document.querySelector(`[data-widget-layer-toggle="${layerId}"]`)?.getAttribute("aria-pressed") === "true",
    }), id);
}

async function focusAircraft(page) {
    try {
        await page.waitForSelector('[data-track-action="focus"]', { timeout: 60000 });
    } catch {
        return { available: false, reason: "no_live_aircraft_focus_row" };
    }
    return page.evaluate(() => new Promise((resolve) => {
        const viewer = window.__warzoneViewer;
        const button = document.querySelector('[data-track-action="focus"]');
        const trackKey = button?.dataset.trackToggle || "";
        const clickedAt = performance.now();
        let cameraStartedAt = null;
        let settled = false;
        const onMoveStart = () => {
            if (cameraStartedAt === null) cameraStartedAt = performance.now();
        };
        viewer.camera.moveStart.addEventListener(onMoveStart);
        button?.click();
        const poll = () => {
            const stats = window.__stratopsPerf?.getFocusStats?.();
            if (stats?.lastCameraStableMs != null) settled = true;
            if (settled || performance.now() - clickedAt > 30000) {
                viewer.camera.moveStart.removeEventListener(onMoveStart);
                resolve({
                    available: true,
                    trackKey,
                    clickToCameraStartMs: cameraStartedAt == null ? null : cameraStartedAt - clickedAt,
                    clickToCenteredMs: settled ? performance.now() - clickedAt : null,
                    focusStats: stats || null,
                });
                return;
            }
            setTimeout(poll, 25);
        };
        poll();
    }));
}

async function switchRegion(page, regionId) {
    await page.evaluate(() => {
        document.getElementById("wz-region-outside-close")?.click();
        document.getElementById("wz-region-nav")?.click();
    });
    await page.waitForFunction(() => !document.getElementById("wz-region-modal")?.hidden, null, { timeout: 10000 });
    await page.evaluate((id) => {
        document.querySelector(`#wz-region-modal-grid [data-region="${id}"]`)?.click();
        document.getElementById("wz-region-confirm")?.click();
    }, regionId);
    await page.waitForTimeout(4200);
}

async function main() {
    const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--enable-gpu", "--ignore-gpu-blocklist"],
    });
    const context = await browser.newContext({ viewport: { width: 1712, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await enterApp(page);
    await installInstrumentation(page);
    const results = { url, emptyMode: await page.evaluate(() => window.__stratopsPerfEmptyGlobeReady === true), stages: {}, trackers: {}, focus: {}, regions: {}, errors };

    if (process.env.PERF_SKIP_BASELINE !== "1") {
        results.stages.normalDrag = await runStage(page, "normal-drag", () => continuousDrag(page, baselineDurationMs));
        results.stages.normalZoom = await runStage(page, "normal-zoom", () => continuousZoom(page, baselineDurationMs));
    }

    results.trackers.aircraft = await enableWidgetLayer(page, "aircraft");
    await page.waitForTimeout(12000);
    results.trackers.aircraft.diagnostics = await page.evaluate(() => window.__getWarzoneAircraftPipelineDiagnostics?.() || null);
    console.log(`TRACKER aircraft ${JSON.stringify(results.trackers.aircraft)}`);
    results.stages.aircraftDrag = await runStage(page, "aircraft-drag", () => continuousDrag(page, trackerDragDurationMs));
    results.focus.aircraft = await focusAircraft(page);
    console.log(`FOCUS aircraft ${JSON.stringify(results.focus.aircraft)}`);
    if (results.focus.aircraft.available) {
        results.stages.aircraftFocus = await runStage(page, "aircraft-focus-120s", () => page.waitForTimeout(aircraftFocusDurationMs));
        await page.evaluate(() => document.querySelector('[data-track-action="unlock"]')?.click());
        await page.waitForTimeout(1500);
    }

    results.trackers.naval = await enableWidgetLayer(page, "naval");
    await page.waitForTimeout(12000);
    results.trackers.naval.diagnostics = await page.evaluate(() => ({
        diagnostics: window.__getWarzoneAircraftPipelineDiagnostics?.()?.naval || null,
        rows: document.querySelectorAll(".wz-naval-item[data-track-key]").length,
    }));
    console.log(`TRACKER naval ${JSON.stringify(results.trackers.naval)}`);
    results.stages.navalDrag = await runStage(page, "naval-drag", () => continuousDrag(page, trackerDragDurationMs));
    const navalFocus = await page.evaluate(() => {
        const row = document.querySelector(".wz-naval-item[data-track-key]");
        if (!row) return { available: false, reason: "no_live_naval_row" };
        const trackKey = row.dataset.trackKey || "";
        const startedAt = performance.now();
        window.__navalFocusVessel?.(trackKey);
        return { available: true, trackKey, startedAt };
    });
    results.focus.naval = navalFocus;
    console.log(`FOCUS naval ${JSON.stringify(results.focus.naval)}`);
    if (navalFocus.available) {
        await page.waitForFunction(() => window.__warzoneFocusDiagnostics?.assetType === "naval", null, { timeout: 15000 }).catch(() => {});
        results.focus.naval.focusStats = await page.evaluate(() => window.__stratopsPerf?.getFocusStats?.() || null);
        results.stages.navalFocus = await runStage(page, "naval-focus-30s", () => page.waitForTimeout(navalFocusDurationMs));
    }

    results.stages.regionSwitches = await runStage(page, "region-switches", async () => {
        await switchRegion(page, "europe");
        await switchRegion(page, "north_america");
        await switchRegion(page, "middle_east");
    });
    results.regions.final = await page.evaluate(() => ({
        region: document.querySelector("#wz-region-nav")?.dataset.region || "",
        label: document.querySelector("#wz-region-nav-label")?.textContent || "",
        framebuffer: window.__phase2FramebufferProfile.snapshot(),
    }));

    const output = path.resolve(".generated/phase2-normal-framebuffer.json");
    fs.writeFileSync(output, JSON.stringify(results, null, 2));
    console.log(`RESULT ${output}`);
    console.log(JSON.stringify(results, null, 2));
    await browser.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
