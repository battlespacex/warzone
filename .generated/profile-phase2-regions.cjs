const { chromium } = require("../apps/worker/node_modules/playwright");

async function main() {
    const browser = await chromium.launch({
        executablePath: "C:/Users/wirfa/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
        headless: true,
        args: ["--enable-gpu", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage({ viewport: { width: 1712, height: 1000 }, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:4173/pages/index.html", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.locator("#wz-pre-entry-enter").click();
    await page.locator("#intro-disclaimer-check").check();
    await page.locator("#wz-intro-accept").click();
    await page.getByRole("button", { name: /Middle East & Gulf/i }).click();
    await page.locator("#wz-region-confirm").click();
    await page.waitForFunction(() => window.__warzoneViewer && document.body.classList.contains("is-app-active"), null, { timeout: 60000 });
    await page.evaluate(() => {
        const viewer = window.__warzoneViewer;
        window.__regionProfile = { resolution: [], msaa: [], frames: [], longTasks: [] };
        new PerformanceObserver((list) => window.__regionProfile.longTasks.push(...list.getEntries().map((e) => e.duration))).observe({ type: "longtask" });
        const tick = (now) => {
            window.__regionProfile.frames.push(now);
            window.__regionProfile.resolution.push(viewer.resolutionScale);
            window.__regionProfile.msaa.push(viewer.scene.msaaSamples);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    for (const id of ["europe", "north_america", "middle_east"]) {
        await page.locator("#wz-region-nav").click();
        await page.waitForFunction(() => document.getElementById("wz-region-modal")?.classList.contains("is-visible"), null, { timeout: 10000 });
        await page.locator(`#wz-region-modal-grid [data-region="${id}"]`).click();
        await page.locator("#wz-region-confirm").click();
        await page.waitForTimeout(4200);
    }
    const result = await page.evaluate(() => {
        const p = window.__regionProfile;
        const gaps = p.frames.slice(1).map((v, i) => v - p.frames[i]);
        const unique = (values) => [...new Set(values)];
        return {
            finalLabel: document.getElementById("wz-region-nav-label")?.textContent || "",
            durationMs: p.frames.at(-1) - p.frames[0],
            fps: p.frames.length / ((p.frames.at(-1) - p.frames[0]) / 1000),
            averageFrameMs: gaps.reduce((a, b) => a + b, 0) / gaps.length,
            p95FrameMs: [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)] || 0,
            longestFrameGapMs: Math.max(...gaps),
            longTasks: p.longTasks.length,
            worstLongTaskMs: Math.max(0, ...p.longTasks),
            resolutionValues: unique(p.resolution),
            msaaValues: unique(p.msaa),
            canvas: { width: window.__warzoneViewer.scene.canvas.width, height: window.__warzoneViewer.scene.canvas.height },
        };
    });
    console.log(JSON.stringify(result, null, 2));
    await browser.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
