const fs = require("fs");
const path = require("path");
const { chromium } = require("../apps/worker/node_modules/playwright");

const executablePath = "C:/Users/wirfa/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
const url = "http://127.0.0.1:4173/pages/index.html";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] || 0;
};
const round = (n) => Math.round(Number(n || 0) * 100) / 100;

async function enter(page) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#wz-pre-entry-enter").click();
    await page.locator("#intro-disclaimer-check").check();
    await page.locator("#wz-intro-accept").click();
    await page.getByRole("button", { name: /Middle East & Gulf/i }).click();
    await page.locator("#wz-region-confirm").click();
    await page.waitForFunction(() => window.__warzoneViewer && document.body.classList.contains("is-app-active"), null, { timeout: 60000 });
}

async function install(page) {
    await page.evaluate(() => {
        const viewer = window.__warzoneViewer;
        const scene = viewer.scene;
        const canvas = scene.canvas;
        const profile = { active: null };
        const snapshot = () => ({
            clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
            width: canvas.width, height: canvas.height,
            drawingBufferWidth: scene.drawingBufferWidth, drawingBufferHeight: scene.drawingBufferHeight,
            devicePixelRatio, resolutionScale: viewer.resolutionScale, msaaSamples: scene.msaaSamples,
            entities: viewer.entities?.values?.length || 0,
        });
        profile.begin = (name) => {
            profile.active = {
                name, startedAt: performance.now(), frames: [], longTasks: [], requestRender: 0,
                widthMutations: 0, heightMutations: 0, resolutionChanges: 0, msaaChanges: 0,
                lastResolution: viewer.resolutionScale, lastMsaa: scene.msaaSamples, start: snapshot(),
            };
        };
        profile.end = () => {
            const stage = profile.active;
            stage.endedAt = performance.now();
            stage.end = snapshot();
            profile.active = null;
            return stage;
        };
        try {
            new PerformanceObserver((list) => {
                if (profile.active) profile.active.longTasks.push(...list.getEntries().map((entry) => entry.duration));
            }).observe({ type: "longtask" });
        } catch { }
        const requestRender = scene.requestRender.bind(scene);
        scene.requestRender = (...args) => {
            if (profile.active) profile.active.requestRender += 1;
            return requestRender(...args);
        };
        new MutationObserver((records) => {
            if (!profile.active) return;
            for (const record of records) {
                if (record.attributeName === "width") profile.active.widthMutations += 1;
                if (record.attributeName === "height") profile.active.heightMutations += 1;
            }
        }).observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
        const tick = (now) => {
            const stage = profile.active;
            if (stage) {
                stage.frames.push(now);
                if (stage.lastResolution !== viewer.resolutionScale) { stage.resolutionChanges += 1; stage.lastResolution = viewer.resolutionScale; }
                if (stage.lastMsaa !== scene.msaaSamples) { stage.msaaChanges += 1; stage.lastMsaa = scene.msaaSamples; }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        window.__phase2ShortProfile = profile;
    });
}

function summarize(stage) {
    const gaps = stage.frames.slice(1).map((time, index) => time - stage.frames[index]);
    const seconds = (stage.endedAt - stage.startedAt) / 1000;
    return {
        name: stage.name, durationMs: round(seconds * 1000), fps: round(stage.frames.length / seconds),
        averageFrameMs: round(gaps.reduce((sum, value) => sum + value, 0) / Math.max(1, gaps.length)),
        p95FrameMs: round(pct(gaps, 0.95)), p99FrameMs: round(pct(gaps, 0.99)),
        longestFrameGapMs: round(Math.max(0, ...gaps)), gapsOver50Ms: gaps.filter((n) => n > 50).length,
        gapsOver100Ms: gaps.filter((n) => n > 100).length, longTasks: stage.longTasks.length,
        worstLongTaskMs: round(Math.max(0, ...stage.longTasks)), canvasWidthMutations: stage.widthMutations,
        canvasHeightMutations: stage.heightMutations, resolutionScaleChanges: stage.resolutionChanges,
        msaaSamplesChanges: stage.msaaChanges, requestRenderPerSecond: round(stage.requestRender / seconds),
        start: stage.start, end: stage.end,
    };
}

async function stage(page, name, action) {
    await page.evaluate((value) => window.__phase2ShortProfile.begin(value), name);
    await action();
    await page.waitForTimeout(500);
    return summarize(await page.evaluate(() => window.__phase2ShortProfile.end()));
}

async function drag(page, durationMs = 30000) {
    const box = await page.locator(".cesium-widget canvas").boundingBox();
    const x0 = box.x + box.width * 0.5;
    const y0 = box.y + box.height * 0.55;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const started = Date.now();
    let step = 0;
    while (Date.now() - started < durationMs) {
        await page.mouse.move(x0 + Math.sin(step * 0.095) * 420, y0 + Math.sin(step * 0.037) * 90);
        step += 1;
        await sleep(16);
    }
    await page.mouse.up();
}

async function enableNaval(page) {
    await page.evaluate(() => document.querySelector('[data-widget-layer-toggle="naval"]')?.click());
    await page.waitForTimeout(600);
    const warning = await page.evaluate(() => {
        const modal = document.getElementById("wz-layer-warning-modal");
        const result = { hidden: modal?.hidden, className: modal?.className || "" };
        if (modal && !modal.hidden) document.getElementById("wz-layer-warning-confirm")?.click();
        return result;
    });
    await page.waitForFunction(() => document.querySelector('[data-widget-layer-toggle="naval"]')?.getAttribute("aria-pressed") === "true", null, { timeout: 15000 }).catch(() => {});
    return { warning, enabled: await page.evaluate(() => document.querySelector('[data-widget-layer-toggle="naval"]')?.getAttribute("aria-pressed") === "true") };
}

async function switchRegion(page, id) {
    await page.evaluate(() => {
        document.getElementById("wz-region-outside-close")?.click();
        document.getElementById("wz-region-nav")?.click();
    });
    await page.waitForTimeout(500);
    let visible = await page.evaluate(() => document.getElementById("wz-region-modal")?.classList.contains("is-visible"));
    if (!visible) {
        await page.evaluate(() => window.__warzoneShowRegionModal?.(true));
        await page.waitForTimeout(100);
        visible = await page.evaluate(() => !document.getElementById("wz-region-modal")?.hidden);
    }
    if (!visible) throw new Error(`Region selector did not open for ${id}`);
    await page.evaluate((regionId) => document.querySelector(`#wz-region-modal-grid [data-region="${regionId}"]`)?.click(), id);
    await page.waitForTimeout(50);
    await page.evaluate(() => document.getElementById("wz-region-confirm")?.click());
    await page.waitForTimeout(4200);
}

async function main() {
    const browser = await chromium.launch({ executablePath, headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist"] });
    const page = await browser.newPage({ viewport: { width: 1712, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await enter(page);
    await install(page);
    const result = { naval: {}, regions: {}, errors };
    result.naval.activation = await enableNaval(page);
    await page.waitForTimeout(30000);
    result.naval.rows = await page.locator(".wz-naval-item[data-track-key]").count();
    result.naval.diagnostics = await page.evaluate(() => window.__getWarzoneAircraftPipelineDiagnostics?.()?.naval || null);
    if (result.naval.activation.enabled) result.naval.drag = await stage(page, "naval-active-drag", () => drag(page));
    if (result.naval.rows > 0) {
        result.naval.focus = await page.evaluate(() => {
            const row = document.querySelector(".wz-naval-item[data-track-key]");
            window.__navalFocusVessel?.(row.dataset.trackKey);
            return { trackKey: row.dataset.trackKey };
        });
        await page.waitForTimeout(1500);
        result.naval.focus.metrics = await stage(page, "naval-focus", () => page.waitForTimeout(30000));
    }
    fs.writeFileSync(path.resolve(".generated/phase2-naval-region-partial.json"), JSON.stringify(result, null, 2));
    result.regions.metrics = await stage(page, "region-switches", async () => {
        await switchRegion(page, "europe");
        await switchRegion(page, "north_america");
        await switchRegion(page, "middle_east");
    });
    result.regions.final = await page.evaluate(() => ({
        region: document.getElementById("wz-region-nav")?.dataset.region || "",
        label: document.getElementById("wz-region-nav-label")?.textContent || "",
    }));
    const output = path.resolve(".generated/phase2-naval-region.json");
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, result }, null, 2));
    await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
