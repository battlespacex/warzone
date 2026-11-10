// UI adapter for the current app. Calibrate entrySteps/layerPanelSteps with ONE staging user first.
async function steps(page, operations = []) {
    for (const operation of operations) {
        const locator = page.locator(operation.selector);
        if (operation.action === "click") await locator.click();
        else if (operation.action === "check") await locator.check();
        else if (operation.action === "select") await locator.selectOption(operation.value);
        else if (operation.action === "wait") await locator.waitFor({ state: operation.state || "visible" });
        else throw new Error(`Unsupported UI action: ${operation.action}`);
    }
}
async function layer(page, id, enabled) {
    const row = page.locator(`.wz-layer-item[data-layer="${id}"]`);
    if (await row.getAttribute("data-locked") === "true") throw new Error(`Staging account cannot use ${id}`);
    if ((await row.getAttribute("class")).split(/\s+/).includes("is-on") !== enabled) await row.click();
}
async function waitForGnss(page) {
    // An unavailable/empty real dataset is inconclusive, never substituted with synthetic observations.
    await page.waitForFunction(() => {
        const viewer = window.__warzoneViewer;
        const gnss = window.__getStratOpsPerformanceDiagnostics?.()?.gnss;
        const primitives = viewer?.scene?.groundPrimitives;
        return gnss?.visible && gnss.activeCellEntities > 0 && viewer.cesiumWidget.useDefaultRenderLoop
            && primitives?.length > 0 && Array.from({ length: primitives.length }, (_, i) => primitives.get(i))
                .filter((primitive) => primitive.show !== false).every((primitive) => primitive.ready);
    });
}
async function prepare(page, config) {
    await steps(page, config.entrySteps);
    await page.waitForFunction(() => window.__stratopsAuthState?.isAuthenticated === true);
    await steps(page, config.regionSteps);
    await page.waitForFunction(() => Boolean(window.__warzoneViewer?.scene && window.__getStratOpsPerformanceDiagnostics));
    await steps(page, config.layerPanelSteps);
    if (await page.locator("#wz-map-layers-pane").getAttribute("aria-hidden") === "true") {
        await page.locator('[data-dock-widget="layers"]:visible').first().click();
    }
    await layer(page, "gnss", false);
}
async function enableGnss(page) { await layer(page, "gnss", true); }
async function exercise(page, config) {
    const checkValues = [];
    // All severity categories are exercised; a legitimately empty category isn't a failure.
    for (const severity of ["low", "medium", "high", "severe", "all"]) {
        await page.locator("#wz-gnss-severity").selectOption(severity);
        await page.waitForFunction((value) => document.getElementById("wz-gnss-severity").value === value, severity);
        await page.waitForFunction(() => {
            const viewer = window.__warzoneViewer;
            const gnss = window.__getStratOpsPerformanceDiagnostics?.()?.gnss;
            if (!gnss) return false;
            if (!gnss.visible) return gnss.activeCellEntities === 0;
            const primitives = viewer.scene.groundPrimitives;
            return gnss.activeCellEntities > 0 && primitives.length > 0 &&
                Array.from({ length: primitives.length }, (_, i) => primitives.get(i))
                    .filter((primitive) => primitive.show !== false).every((primitive) => primitive.ready);
        });
        checkValues.push({ severity, diagnostics: await page.evaluate(() => window.__getStratOpsPerformanceDiagnostics().gnss) });
    }
    await waitForGnss(page);
    const periods = [];
    for (const period of ["24h", "48h", "72h"]) {
        const responsePromise = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname.endsWith("/events/gnss-interference") && url.searchParams.get("date") === period;
        });
        await page.locator("#wz-gnss-period").selectOption(period);
        const response = await responsePromise;
        if (!response.ok()) throw new Error(`${period} GNSS API HTTP ${response.status()}`);
        const data = await response.json();
        if (data.demoMode === true) throw new Error("Staged/fake GNSS data cannot satisfy real-data acceptance");
        const value = await page.locator("#wz-gnss-period").inputValue();
        if (value !== period) throw new Error(`Observation period selection failed: ${period}`);
        periods.push({ period, sourceMode: data.sourceMode, sourceHealth: data.sourceHealth, cells: data.cells?.length || 0 });
        // 24h may legitimately contain no whole UTC daily summary. Preserve that provider behavior.
        if (data.cells?.length) await waitForGnss(page);
    }
    await waitForGnss(page); // Require real coverage after restoring 72h.
    // Exercise the existing camera controls, without replacing camera state or viewer.
    const canvas = page.locator("#warzone-globe .cesium-widget canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Globe canvas is not visible");
    const x = box.x + box.width * 0.5, y = box.y + box.height * 0.5;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 100, y + 40, { steps: 12 }); await page.mouse.up();
    await page.mouse.wheel(0, -250); await page.mouse.wheel(0, 250);
    await page.mouse.move(x, y); await page.mouse.down({ button: "middle" });
    await page.mouse.move(x + 60, y + 30, { steps: 12 }); await page.mouse.up({ button: "middle" });
    // Add reviewed UI steps for radar, SAM, AOI, trackers and orbital tools in this config.
    await steps(page, config.otherFeatureSteps);
    return { gnss: true, severitySelections: checkValues, observationPeriods: periods,
        otherFeatures: "manual review required; screenshots/diagnostics are evidence, not a visual pass" };
}
module.exports = { prepare, enableGnss, waitForGnss, exercise };
