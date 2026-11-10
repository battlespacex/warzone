import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const css = fs.readFileSync(path.join(root, "dev/assets/css/root.css"), "utf8");
const air = fs.readFileSync(path.join(root, "dev/assets/js/warzone-live-airforce.js"), "utf8");
const naval = fs.readFileSync(path.join(root, "dev/assets/js/warzone-live-naval.js"), "utf8");
const identity = fs.readFileSync(path.join(root, "apps/shared/naval-identity.js"), "utf8").replace(/^export /gm, "");
const carrierScale = 330 / 41.16168;
const aircraft = { fighter: 9, transport: 7, bomber: 7, tanker: 7, recon: 7, awacs: 7, helicopter: 10, vip: 8, drone: 8 };
const vessels = ["carrier", "amphibious", "cruiser", "destroyer", "frigate", "corvette", "intelligence", "ssbn",
    "ssn", "ssk", "aip_submarine", "submarine", "missile_boat", "patrol", "logistics", "minesweeper", "naval"];
function extract(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("mobile focus rules follow standard rules; resize listeners use existing teardown paths", () => {
    assert.ok(css.indexOf("@media (max-width: 767px)") > css.indexOf("@media (max-width: 1920px)"));
    assert.match(air, /bindLiveTrackRuntimeEvent\(window, "resize", refreshFocusedAircraftModelScale\)/);
    assert.match(extract(air, "bindLiveTrackRuntimeEvent"), /removeEventListener\(type, callback, options\)/);
    assert.match(extract(naval, "bindNavalOverlay"), /if \(__navalState.overlayBound\) return/);
    assert.match(extract(naval, "bindNavalOverlay"), /addEventListener\("resize", refreshFocusedNavalModelScale\)/);
    assert.match(extract(naval, "unbindNavalRuntime"), /removeEventListener\("resize", refreshFocusedNavalModelScale\)/);
});

test("Chrome resolves all focused categories across mobile, desktop, fallback and ultrawide widths", { timeout: 90000 }, async t => {
    const executablePath = process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
    if (!fs.existsSync(executablePath)) return t.skip("Installed Chrome is required");
    const browser = await chromium.launch({ executablePath, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setContent("<!doctype html><html><head></head><body></body></html>");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ path: path.join(root, "node_modules/cesium/Build/Cesium/Cesium.js") });
    await page.addScriptTag({ content: `
        const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
        const __liveTrackUpdateComputedStyle = null;
        const __liveTrackRegistry = new Map();
        const __navalState = { selectedKey: '', vessels: new Map() };
        let focusedAir = '', renders = 0;
        const getFocusedTrackKey = () => focusedAir;
        const isFocusedTrackKey = key => Boolean(key && key === focusedAir);
        const requestWarzoneRenderBatched = () => renders++;
        const requestNavalRenderBatched = () => renders++;
        const getAircraftFocusedSizingCategory = record => record.category;
        const getNavalFocusedSizingCategory = record => record.category;
        ${identity}
        const verifiedCarrier = { mmsi: '999000001', metadata: { identity_verification: {
            status: 'verified', source: 'browser test fixture', verified_at: '2026-11-01',
            identifiers: { mmsi: '999000001' }, military_status: 'military', category: 'carrier',
            naval_force: 'US Navy', ship_class: 'Fixture carrier', length_m: 330
        } } };
        window.__warzoneViewer = { entities: new Cesium.EntityCollection() };
        ${["getCssNumber", "getAircraftFocusedCssNumber", "getFocusedAircraftModelScale", "refreshFocusedAircraftModelScale"].map(n => extract(air, n)).join("\n")}
        ${["getNavalModelScale", "getFocusedNavalModelScale", "refreshFocusedNavalModelScale"].map(n => extract(naval, n)).join("\n")}
        const airEntity = window.__warzoneViewer.entities.add({ id: 'track-test', model: { scale: 1 } });
        const seaEntity = window.__warzoneViewer.entities.add({ id: 'naval-test', model: { scale: 1 } });
        const airModel = airEntity.model, seaModel = seaEntity.model;
        __liveTrackRegistry.set('test', { category: 'fighter' });
        __navalState.vessels.set('test', { entity: seaEntity, data: verifiedCarrier });
        window.addEventListener('resize', refreshFocusedAircraftModelScale);
        window.addEventListener('resize', refreshFocusedNavalModelScale);
        window.readSizes = (airCategories, navalCategories) => ({
            air: Object.fromEntries(airCategories.map(category => [category, getFocusedAircraftModelScale({ category })])),
            naval: Object.fromEntries(navalCategories.map(category => [category, getFocusedNavalModelScale(category === 'carrier' ? verifiedCarrier : { category })])),
        });
        window.focusDomain = domain => { focusedAir = domain === 'aircraft' ? 'test' : '';
            __navalState.selectedKey = domain === 'naval' ? 'test' : '';
            refreshFocusedAircraftModelScale(); refreshFocusedNavalModelScale(); };
        window.modelState = () => ({ air: airModel.scale.getValue(), naval: seaModel.scale.getValue(),
            sameModels: airEntity.model === airModel && seaEntity.model === seaModel,
            count: window.__warzoneViewer.entities.values.length });
    ` });
    const sizes = () => page.evaluate(([a, n]) => window.readSizes(a, n), [Object.keys(aircraft), vessels]);
    await page.setViewportSize({ width: 2200, height: 1000 });
    const fallback = await sizes();
    for (const width of [390, 430, 767, 768, 1280, 1920, 2200, 2560, 3440, 3840]) {
        await page.setViewportSize({ width, height: 1000 });
        const actual = await sizes();
        assert.deepEqual(actual.air, width >= 2560 ? Object.fromEntries(Object.keys(aircraft).map(k => [k, 3]))
            : width <= 1920 ? aircraft : fallback.air, `aircraft at ${width}px`);
        assert.deepEqual(actual.naval, Object.fromEntries(vessels.map(k => [k, k === 'carrier' ? carrierScale : 1])), `physical naval scale at ${width}px`);
    }
    // Distinct mobile-only overrides prove the independent tier, category, and domain cascade.
    await page.addStyleTag({ content: `@media (max-width: 767px) { :root {
        --warzone-live-aircraft-model-focused-size-fighter: 19;
        --warzone-live-naval-model-focused-size-carrier: 18;
    } }` });
    for (const domain of ["aircraft", "naval", "aircraft", "naval"]) {
        await page.evaluate(d => window.focusDomain(d), domain);
        for (const width of [768, 767, 768, 430, 767, 768]) {
            await page.setViewportSize({ width, height: width === 430 ? 390 : 1000 });
            await page.waitForFunction(([d, expected]) => window.modelState()[d === 'aircraft' ? 'air' : 'naval'] === expected,
                [domain, domain === "naval" ? carrierScale : width < 768 ? 19 : 9]);
            const state = await page.evaluate(() => window.modelState());
            assert.equal(state.sameModels, true);
            assert.equal(state.count, 2);
            const actual = await sizes();
            assert.equal(actual.air.transport, 7);
            assert.equal(actual.naval.destroyer, 1);
        }
    }
    assert.deepEqual(errors, []);
});
