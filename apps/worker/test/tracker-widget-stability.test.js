import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const baseline = process.env.STRATOPS_WIDGET_BASELINE === "1";
const read = file => baseline ? execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 8e6 })
    : fs.readFileSync(path.join(root, file), "utf8");
const essential = read("dev/assets/js/essential.js"), naval = read("dev/assets/js/warzone-live-naval.js");
function fn(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("widget scheduling coalesces urgent bursts and does not postpone an existing naval refresh", { skip: baseline }, () => {
    let now = 0, nextId = 0, renders = 0;
    const timers = new Map();
    const context = vm.createContext({ performance: { now: () => now },
        __aircraftWidgetRenderTimer: 0, __aircraftWidgetLastRenderedAt: 0, __navalWidgetRenderTimer: 0,
        AIRCRAFT_WIDGET_RENDER_THROTTLE_MS: 500, NAVAL_WIDGET_RENDER_THROTTLE_MS: 120,
        getLiveWidgetRenderDelay: delay => delay,
        window: { setTimeout: (callback, delay) => { timers.set(++nextId, { callback, at: now + delay }); return nextId; } },
        clearTimeout: id => timers.delete(id), renderAircraftMovementsWidget: () => renders++,
        measureRealtimeStage: (_, callback) => callback(),
    });
    for (const name of ["requestAircraftMovementsWidgetRender", "requestNavalWidgetRender"]) vm.runInContext(fn(essential, name), context);
    for (let i = 0; i < 100; i++) context.requestAircraftMovementsWidgetRender(0);
    assert.equal(renders, 0, "live bursts must not render synchronously for every notification");
    assert.equal(timers.size, 1);
    const pending = [...timers.values()][0]; timers.clear(); pending.callback();
    assert.equal(renders, 1);
    context.requestNavalWidgetRender();
    const originalTimer = context.__navalWidgetRenderTimer;
    for (let i = 0; i < 100; i++) { now++; context.requestNavalWidgetRender(); }
    assert.equal(context.__navalWidgetRenderTimer, originalTimer);
    assert.equal(timers.get(originalTimer).at, 120);
    context.requestNavalWidgetRender(0);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].at, 100, "user actions may preempt the normal throttle");
});

test("tracker controls and keyed rows stay stable under live updates", { timeout: 120000 }, async t => {
    const executablePath = process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
    if (!fs.existsSync(executablePath)) return t.skip("Installed Chrome required");
    const browser = await chromium.launch({ executablePath, headless: true, args: ["--enable-precise-memory-info"] });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.setContent(`<style>.list{height:300px;overflow:auto}.wz-aircraft-item{height:160px}</style>
      <section><select id="wz-aircraft-filter-subtype"><option value="all">All Types</option></select><div class="list" id="wz-aircraft-panel"></div></section>
      <section><select id="wz-naval-filter-subtype"><option value="all">All Types</option></select><div class="list" id="wz-naval-panel-list"></div></section>`);
    const helpers = ["getAircraftSubtypeOptions", "getNavalSubtypeOptions", "normalizeNavalSubtype", "formatNavalSubtypeLabel",
        "isPointInsideRegion", "isTrackerItemVisibleInScope",
        "formatAircraftSubtypeLabel", "isAircraftTrackSubtype", "prioritizeSelectedAircraftWidgetItem", "getAircraftWidgetItems",
        "ensureAircraftWidgetEmptyState", "getAircraftWidgetActionLabel", "getAircraftWidgetTimeLabel", "updateAircraftWidgetCard",
        "renderAircraftMovementsWidget", "requestNavalWidgetRender", "syncAircraftGlobeVisibilityFilter", "syncNavalGlobeVisibilityFilter"];
    if (essential.includes("function syncTrackerSubtypeOptions(")) helpers.push("syncTrackerSubtypeOptions");
    const airTypes = ["vip", "fighter", "awacs", "recon", "isr", "tanker", "refueler", "transport", "logistics", "logistic", "bomber", "drone", "uav", "helicopter"];
    const seaTypes = ["carrier", "amphibious", "cruiser", "destroyer", "frigate", "corvette", "intelligence", "submarine", "ssbn", "ssn", "ssk", "aip_submarine", "missile_boat", "logistics", "patrol", "minesweeper", "naval"];
    await page.addScriptTag({ content: `
      let records = { air: [], naval: [] }, selection = { track_key: '', mode: '' };
      let __aircraftWidgetFilter = 'active', __aircraftWidgetSubtypeFilter = 'all', __aircraftWidgetScopeFilter = 'region';
      let __aircraftWidgetCountryFilter = 'all', __aircraftGlobeFilterSignature = '', __navalGlobeFilterSignature = '';
      let __aircraftSubtypeOptionsKey = '', __navalSubtypeOptionsKey = '', __navalWidgetSubtypeFilter = 'all', __navalWidgetScopeFilter = 'region';
      let __aircraftWidgetPage = 1, __navalWidgetPage = 1, __navalWidgetRenderTimer = 0;
      let __aircraftHistoryCache = [], __aircraftHistorySeeding = false, __aircraftHistoryLoadingPromise = null;
      const __manualAircraftSearch = {}, __seededAircraftTrackKeys = new Set(), AIRCRAFT_RECENT_WINDOW_MS = 300000;
      ${essential.match(/const AIRCRAFT_WIDGET_SUBTYPES = Object\.freeze\(\[[\s\S]*?\]\);/)?.[0] || `const AIRCRAFT_WIDGET_SUBTYPES = ${JSON.stringify(airTypes)};`}
      const NAVAL_EVENT_SUBTYPES = new Set(${JSON.stringify(seaTypes)}), NAVAL_SUBTYPE_ALIAS_MAP = new Map();
      let LIVE_AIRCRAFT_WIDGET_MAX_ITEMS = 500, LIVE_NAVAL_WIDGET_MAX_ITEMS = 500;
      const NAVAL_WIDGET_RENDER_THROTTLE_MS = 120;
      ${naval.match(/const NAVAL_CONTACT_STALE_MS = [^;]+;/)[0]}
      const __navalState = { selectedKey: '', vessels: new Map() };
      const __navalInitialRequestPending = false;
      let airPredicate = () => true, navalPredicate = () => true, filterCalls = { air: 0, naval: 0 };
      let stage = {}, mutations = { options: 0, aircraftOptions: 0, navalOptions: 0, rows: 0, added: 0, removed: 0 }, countryScans = 0;
      let activeRegion = { id: 'test', bounds: { minLat: 0, maxLat: 60, minLon: 0, maxLon: 60 } };
      const counts = { air: 0, naval: 0 };
      const getAllLiveTrackSnapshots = () => records.air;
      // Model the existing registry API contract: invalid/expired AIS contacts
      // have already been purged before the widget obtains its snapshots.
      const getAllNavalSnapshots = () => records.naval.filter(v => !v.invalid && NAVAL_EVENT_SUBTYPES.has(v.subcategory)
        && Number.isFinite(v.lat) && Number.isFinite(v.lon) && v.last_seen_at >= Date.now() - NAVAL_CONTACT_STALE_MS);
      const getLiveTrackSelection = () => selection;
      const isLayerEnabled = () => true, isHighValueAssetDetectionEnabled = () => false;
      const isAircraftTrackingFeatureEnabled = () => true;
      const isDatabaseAircraftLiveSourceEnabled = () => true, getPublicAirFeedStatus = () => ({ state: 'active' });
      const isClearlyNavalContact = () => false;
      ${essential.slice(essential.indexOf("const FRONTEND_CIVILIAN_AIRLINER_CODES"), essential.indexOf("function formatAircraftAltitude("))}
      ${["getAircraftMetadata", "resolveAircraftSubtype", "sanitizeAircraftText", "getAircraftRegistrationLabel", "getAircraftMergeKey", "mergeAircraftWidgetTrack", "mergeAircraftWidgetSources"].map(n => fn(essential, n)).join("\n")}
      const normalizeAircraftCountryFilterValue = value => value;
      const getAircraftCountryFilterOptions = items => { countryScans += items.length; return []; };
      const getAircraftCountryLabel = () => 'US';
      const getActiveRegion = () => activeRegion;
      const setLiveTrackVisibilityFilter = predicate => { airPredicate = predicate; filterCalls.air++; };
      const setNavalVisibilityFilter = predicate => { navalPredicate = predicate; filterCalls.naval++; };
      const syncAircraftWidgetFilterControls = () => {}, syncAircraftCountryFilterControls = () => {};
      const updateAircraftWidgetHighValueCount = () => {}, updateAircraftWidgetTitleCount = n => { counts.air = n; };
      const notifyHighValueAssets = () => {}, updateNavalWidgetTitleCount = n => { counts.naval = n; };
      const recordRealtimeWork = () => {}, markTrackerPerf = () => {}, getLiveWidgetRenderDelay = n => n;
      const getHighValueNavalMeta = () => false, getHighValueAircraftMeta = () => false;
      const getAssetFocusController = () => ({ canEnterFocus: () => true });
      const getAircraftWidgetDetailLabel = track => track.subcategory, getAircraftWidgetForceLabel = () => 'US';
      const getAircraftDisplayTitle = track => track.callsign, getAircraftWidgetStatusLabel = () => 'Active';
      const formatAircraftLastSeen = () => 'Now', formatAircraftEndedAt = () => 'Ended';
      const formatAircraftAltitude = n => String(n), formatAircraftSpeed = n => String(n);
      const purgeInvalidNavalContacts = () => {}, isProbablyAircraftContact = () => false;
      const getNavalDisplayName = vessel => vessel.vessel_name;
      const getNavalWidgetDetailLabel = vessel => vessel.subcategory, getNavalWidgetCountryOperatorLabel = () => 'US Navy';
      const formatNavalSpeed = n => String(n), formatNavalHeading = n => String(n);
      const getNavalCoordinatesLabel = vessel => vessel.lon + ',' + vessel.lat, formatNavalTimeAgo = () => 'Now';
      const isNavalFocusBlocked = () => false, clearNavalSelection = () => {};
      ${helpers.map(n => fn(essential, n)).join("\n")}
      ${["ensureNavalWidgetEmptyState", "updateNavalWidgetCard", "renderNavalTrackerWidget"].map(n => fn(naval, n)).join("\n")}
      const originalNavalRender = renderNavalTrackerWidget;
      renderNavalTrackerWidget = options => { const start = performance.now(); originalNavalRender(options); stage.naval = performance.now() - start; };
      const observer = new MutationObserver(entries => { for (const entry of entries) {
        if (entry.target.closest?.('select') || entry.target.nodeName === 'OPTION') {
          mutations.options++;
          const id = entry.target.closest?.('select')?.id || '';
          if (id.includes('aircraft')) mutations.aircraftOptions++; else if (id.includes('naval')) mutations.navalOptions++;
        }
        else { mutations.rows++; mutations.added += entry.addedNodes.length; mutations.removed += entry.removedNodes.length; }
      } });
      document.querySelectorAll('section').forEach(node => observer.observe(node, { childList: true, subtree: true, attributes: true, characterData: true }));
      const longTasks = [];
      new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
      window.data = (count, categories = true) => {
        records.air = Array.from({ length: count }, (_, i) => ({ track_key: 'air-' + i, callsign: 'AIR' + i, icao24: i.toString(16).padStart(6, '0'), active: true,
          subcategory: categories && i % 2 === 0 ? 'isr' : 'fighter', lat: 26, lon: 50,
          altitude_ft: 20000, speed_kts: 300, heading_deg: 90, last_seen_at: Date.now() - i }));
        records.naval = Array.from({ length: count }, (_, i) => ({ track_key: 'naval-' + i, vessel_name: 'SHIP' + i,
          subcategory: categories && i % 2 === 0 ? 'destroyer' : 'frigate', speed_kts: 20, heading_deg: 90, lon: 50, lat: 26, last_seen_at: Date.now() - i }));
      };
      window.refresh = async () => {
        const start = performance.now(); renderAircraftMovementsWidget(); stage.air = performance.now() - start;
        requestNavalWidgetRender(0);
        while (__navalWidgetRenderTimer) await new Promise(resolve => setTimeout(resolve, 1));
        await new Promise(resolve => setTimeout(resolve, 0));
        return { ...stage, ...mutations, countryScans, heap: performance.memory?.usedJSHeapSize,
          longTasks: [...longTasks], filterCalls: { ...filterCalls } };
      };
      window.resetMetrics = () => { mutations = { options: 0, aircraftOptions: 0, navalOptions: 0, rows: 0, added: 0, removed: 0 }; countryScans = 0; };
      window.choose = (air, naval) => {
        __aircraftWidgetSubtypeFilter = air; __navalWidgetSubtypeFilter = naval;
        document.getElementById('wz-aircraft-filter-subtype').value = air;
        document.getElementById('wz-naval-filter-subtype').value = naval;
        syncAircraftGlobeVisibilityFilter(); syncNavalGlobeVisibilityFilter();
      };
      document.addEventListener('change', event => {
        if (event.target.id === 'wz-aircraft-filter-subtype') { __aircraftWidgetSubtypeFilter = event.target.value; syncAircraftGlobeVisibilityFilter(); }
        if (event.target.id === 'wz-naval-filter-subtype') { __navalWidgetSubtypeFilter = event.target.value; syncNavalGlobeVisibilityFilter(); }
      });
      window.snapshot = () => ({ air: __aircraftWidgetSubtypeFilter, naval: __navalWidgetSubtypeFilter,
        airOptions: [...document.getElementById('wz-aircraft-filter-subtype').options].map(o => o.value),
        navalOptions: [...document.getElementById('wz-naval-filter-subtype').options].map(o => o.value),
        counts: { ...counts },
        airMore: document.querySelector('#wz-aircraft-panel .wz-aircraft-load-more')?.textContent || null,
        navalMore: document.querySelector('#wz-naval-panel-list .wz-naval-load-more')?.textContent || null,
        airRows: document.querySelectorAll('#wz-aircraft-panel article').length,
        navalRows: document.querySelectorAll('#wz-naval-panel-list article').length,
        airEligible: records.air.filter(airPredicate).length, navalEligible: records.naval.filter(navalPredicate).length,
        airScroll: document.getElementById('wz-aircraft-panel').scrollTop,
        navalScroll: document.getElementById('wz-naval-panel-list').scrollTop,
        airEmpty: document.querySelector('#wz-aircraft-panel .wz-aircraft-empty')?.textContent,
        navalEmpty: document.querySelector('#wz-naval-panel-list .wz-aircraft-empty')?.textContent });
    ` });
    const profiles = [];
    for (const count of [50, 100, 250, 500]) {
        await page.evaluate(n => { window.choose('all', 'all'); window.data(n); window.resetMetrics(); }, count);
        const cold = await page.evaluate(() => window.refresh());
        const samples = [];
        for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.resetMetrics());
            samples.push(await page.evaluate(() => window.refresh()));
        }
        const stable = samples[samples.length - 1];
        const median = key => samples.map(s => s[key]).sort((a, b) => a - b)[2];
        await page.evaluate(() => window.resetMetrics());
        const churn = await page.evaluate(async () => { records.air[0].speed_kts++;
            records.naval[0].speed_kts++; return window.refresh(); });
        profiles.push({ count, cold, stable, medianAirMs: median('air'), medianNavalMs: median('naval'), churn });
    }
    let availability;
    if (!baseline) {
        await page.evaluate(() => { window.data(0); window.choose('all', 'all'); });
        await page.evaluate(() => window.refresh());
        const none = await page.evaluate(() => window.snapshot());
        assert.deepEqual(none.airOptions, ['all']); assert.deepEqual(none.navalOptions, ['all']);
        await page.evaluate(() => window.data(20));
        await page.evaluate(() => window.refresh());
        const live = await page.evaluate(() => window.snapshot());
        assert.deepEqual(live.airOptions, ['all', 'fighter', 'isr']);
        assert.deepEqual(live.navalOptions, ['all', 'destroyer', 'frigate']);
        const oneSide = await page.evaluate(async () => {
            const navalOptions = [...document.getElementById('wz-naval-filter-subtype').options];
            records.air.push({ ...records.air[0], track_key: 'air-only-addition', icao24: 'dd0000', subcategory: 'awacs' });
            window.resetMetrics(); const result = await window.refresh();
            return { navalOptionMutations: result.navalOptions, sameNavalOptions: navalOptions.every((node, i) =>
                node === document.getElementById('wz-naval-filter-subtype').options[i]), snapshot: window.snapshot() };
        });
        assert.equal(oneSide.navalOptionMutations, 0); assert.equal(oneSide.sameNavalOptions, true);
        assert.ok(oneSide.snapshot.airOptions.includes('awacs'));
        const paged = await page.evaluate(async () => {
            LIVE_AIRCRAFT_WIDGET_MAX_ITEMS = LIVE_NAVAL_WIDGET_MAX_ITEMS = 8;
            records.air[19].subcategory = 'transport'; records.naval[19].subcategory = 'carrier';
            window.choose('isr', 'destroyer'); await window.refresh(); return window.snapshot();
        });
        assert.ok(paged.airOptions.includes('transport'), 'categories include nonmatching records beyond the visible page');
        assert.ok(paged.navalOptions.includes('carrier'));
        assert.equal(paged.airRows, 8); assert.equal(paged.navalRows, 8);
        assert.equal(paged.counts.air, 10); assert.equal(paged.counts.naval, 10);
        assert.match(paged.airMore, /2 more/); assert.match(paged.navalMore, /2 more/);
        await page.evaluate(() => window.data(20, false));
        await page.evaluate(() => window.refresh());
        const pinned = await page.evaluate(() => window.snapshot());
        assert.equal(pinned.air, 'isr'); assert.equal(pinned.naval, 'destroyer');
        assert.ok(pinned.airOptions.includes('isr')); assert.ok(pinned.navalOptions.includes('destroyer'));
        assert.equal(pinned.airMore, null); assert.equal(pinned.navalMore, null);
        assert.equal(pinned.counts.air, 0); assert.equal(pinned.counts.naval, 0);
        await page.evaluate(() => window.choose('all', 'all'));
        await page.evaluate(() => window.refresh());
        const unpinned = await page.evaluate(() => window.snapshot());
        assert.deepEqual(unpinned.airOptions, ['all', 'fighter']);
        assert.deepEqual(unpinned.navalOptions, ['all', 'frigate']);
        const regions = await page.evaluate(async () => {
            window.data(2);
            const air = records.air[0], sea = records.naval[0];
            records.air.push({ ...air, track_key: 'other-region', icao24: 'bb0000', subcategory: 'bomber', lon: 110 });
            records.air.push({ ...air, track_key: 'ended', icao24: 'bb0001', subcategory: 'tanker', active: false });
            records.air.push({ ...air, track_key: 'invalid', icao24: 'bb0002', subcategory: 'helicopter', lat: NaN });
            records.air.push({ ...air, track_key: 'naval-in-air', icao24: 'bb0003', subcategory: 'destroyer' });
            records.air.push({ ...air, track_key: 'pending', icao24: 'bb0004', subcategory: 'drone', __realtimeRenderPending: true });
            __aircraftHistoryCache = [{ ...air, track_key: 'history-only', icao24: 'bb0005', subcategory: 'awacs' }];
            records.naval.push({ ...sea, track_key: 'other-region-ship', subcategory: 'carrier', lon: 110 });
            records.naval.push({ ...sea, track_key: 'stale-ship', subcategory: 'intelligence', last_seen_at: Date.now() - 86400000 });
            records.naval.push({ ...sea, track_key: 'invalid-ship', subcategory: 'patrol', lat: NaN });
            records.naval.push({ ...sea, track_key: 'air-in-naval', subcategory: 'fighter' });
            records.naval.push({ ...sea, track_key: 'nonoperational', subcategory: 'submarine', invalid: true });
            await window.refresh(); const first = window.snapshot();
            activeRegion = { id: 'other', bounds: { minLat: 0, maxLat: 60, minLon: 100, maxLon: 140 } };
            await window.refresh(); const second = window.snapshot();
            activeRegion = { id: 'test', bounds: { minLat: 0, maxLat: 60, minLon: 0, maxLon: 60 } };
            __aircraftHistoryCache = [];
            LIVE_AIRCRAFT_WIDGET_MAX_ITEMS = LIVE_NAVAL_WIDGET_MAX_ITEMS = 500;
            window.data(500); await window.refresh();
            return { first, second };
        });
        assert.deepEqual(regions.first.airOptions, ['all', 'drone', 'fighter', 'isr']);
        assert.deepEqual(regions.first.navalOptions, ['all', 'destroyer', 'frigate']);
        assert.deepEqual(regions.second.airOptions, ['all', 'bomber']);
        assert.deepEqual(regions.second.navalOptions, ['all', 'carrier']);
        availability = { none, live, oneSide, paged, pinned, unpinned, regions };
    }
    const dropdowns = [];
    for (const domain of ['aircraft', 'naval']) {
        const id = 'wz-' + domain + '-filter-subtype';
        await page.evaluate(id => {
            window.optionNodes = [...document.getElementById(id).options];
            window.openLatencyMs = null;
            document.getElementById(id).addEventListener('pointerdown', () => {
                const start = performance.now(); requestAnimationFrame(() => { window.openLatencyMs = performance.now() - start; });
            }, { once: true });
        }, id);
        await page.locator('#' + id).click();
        const before = await page.evaluate(id => document.getElementById(id).matches(':open'), id);
        await page.evaluate(() => { window.data(500, false); window.resetMetrics(); });
        const refreshed = await page.evaluate(() => window.refresh());
        const after = await page.evaluate(id => ({ open: document.getElementById(id).matches(':open'), latencyMs: window.openLatencyMs,
            sameOptions: [...document.getElementById(id).options].every((node, i) => node === window.optionNodes[i]) }), id);
        const optionMutations = refreshed[domain === 'aircraft' ? 'aircraftOptions' : 'navalOptions'];
        dropdowns.push({ domain, before, ...after, optionMutations });
        if (!baseline) { assert.equal(after.sameOptions, true); assert.equal(optionMutations, 0); if (before) assert.equal(after.open, true); }
        if (!baseline) {
            await page.keyboard.press('Escape');
            await page.waitForFunction(([id, absent]) => ![...document.getElementById(id).options].some(o => o.value === absent),
                [id, domain === 'aircraft' ? 'isr' : 'destroyer']);
            await page.locator('#' + id).click();
            await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
            const committed = await page.evaluate(id => ({ value: document.getElementById(id).value,
                state: id.includes('aircraft') ? __aircraftWidgetSubtypeFilter : __navalWidgetSubtypeFilter }), id);
            assert.equal(committed.value, committed.state, "native keyboard selection commits normally");
        } else await page.keyboard.press('Escape');
        await page.evaluate(() => window.choose('all', 'all'));
        await page.evaluate(() => window.data(500));
        await page.evaluate(() => window.refresh());
    }
    await page.evaluate(() => window.choose('isr', 'destroyer'));
    await page.evaluate(() => window.refresh());
    await page.evaluate(() => { window.data(100, false); window.resetMetrics(); });
    await page.evaluate(() => window.refresh());
    await page.evaluate(() => window.resetMetrics());
    const emptyRefresh = await page.evaluate(() => window.refresh());
    const empty = await page.evaluate(() => window.snapshot());
    if (!baseline) {
        assert.equal(empty.air, 'isr'); assert.equal(empty.naval, 'destroyer');
        assert.equal(empty.airRows, 0); assert.equal(empty.navalRows, 0);
        assert.equal(empty.airEligible, 0); assert.equal(empty.navalEligible, 0);
        assert.match(empty.airEmpty, /ISR/); assert.match(empty.navalEmpty, /Destroyer/);
        assert.equal(emptyRefresh.rows, 0, "unchanged empty states must not repeatedly mutate the DOM");
        assert.ok(profiles.every(p => p.stable.options === 0));
        assert.ok(profiles.every(p => p.stable.rows === 0));
    }
    await page.evaluate(() => window.data(100));
    await page.evaluate(() => window.refresh());
    const returned = await page.evaluate(() => window.snapshot());
    if (!baseline) { assert.equal(returned.airRows, 50); assert.equal(returned.navalRows, 50); }
    const controls = await page.evaluate(async () => {
        const airSelect = document.getElementById('wz-aircraft-filter-subtype'), navalSelect = document.getElementById('wz-naval-filter-subtype');
        const airRow = document.querySelector('#wz-aircraft-panel article'), navalRow = document.querySelector('#wz-naval-panel-list article');
        document.getElementById('wz-aircraft-panel').scrollTop = 500;
        document.getElementById('wz-naval-panel-list').scrollTop = 500;
        await new Promise(requestAnimationFrame);
        const before = window.snapshot();
        records.air[0].speed_kts++; records.naval[0].speed_kts++;
        await window.refresh(); await new Promise(requestAnimationFrame);
        const after = window.snapshot();
        const retainedRows = airRow === document.querySelector('#wz-aircraft-panel article') && navalRow === document.querySelector('#wz-naval-panel-list article');
        selection = { track_key: 'air-98', mode: 'focus' }; __navalState.selectedKey = 'naval-98';
        await window.refresh();
        const prioritized = [document.querySelector('#wz-aircraft-panel article').dataset.trackKey,
            document.querySelector('#wz-naval-panel-list article').dataset.trackKey];
        for (let i = 0; i < 20; i++) { window.choose(i % 2 ? 'isr' : 'fighter', i % 2 ? 'destroyer' : 'frigate'); await window.refresh(); }
        return { before, after, prioritized, sameControls: airSelect === document.getElementById('wz-aircraft-filter-subtype') && navalSelect === document.getElementById('wz-naval-filter-subtype'),
            retainedRows, final: window.snapshot() };
    });
    if (!baseline) {
        assert.equal(controls.sameControls, true);
        assert.equal(controls.retainedRows, true);
        assert.equal(controls.before.airScroll, controls.after.airScroll);
        assert.equal(controls.before.navalScroll, controls.after.navalScroll);
        assert.deepEqual(controls.prioritized, ['air-98', 'naval-98']);
        assert.equal(controls.final.air, 'isr'); assert.equal(controls.final.naval, 'destroyer');
    }
    const remounted = await page.evaluate(async () => {
        for (const id of ['wz-aircraft-filter-subtype', 'wz-naval-filter-subtype']) {
            const replacement = document.createElement('select'); replacement.id = id;
            document.getElementById(id).replaceWith(replacement);
        }
        await window.refresh();
        return { air: document.getElementById('wz-aircraft-filter-subtype').value,
            naval: document.getElementById('wz-naval-filter-subtype').value };
    });
    if (!baseline) assert.deepEqual(remounted, { air: 'isr', naval: 'destroyer' });
    await page.evaluate(async () => { window.choose('all', 'all'); window.data(500); await window.refresh(); });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize);
    const continuous = await page.evaluate(async () => {
        const callsBefore = { ...filterCalls }; longTasks.length = 0;
        for (let i = 0; i < 50; i++) { records.air[i % 500].speed_kts++; records.naval[i % 500].speed_kts++; await window.refresh(); }
        return { callsBefore, callsAfter: { ...filterCalls }, longTasks: [...longTasks], rows: window.snapshot() };
    });
    await cdp.send('HeapProfiler.collectGarbage');
    const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize);
    const listenerCounts = {};
    for (const domain of ['aircraft', 'naval']) {
        const remote = await cdp.send('Runtime.evaluate', { expression: `document.getElementById('wz-${domain}-filter-subtype')` });
        const result = await cdp.send('DOMDebugger.getEventListeners', { objectId: remote.result.objectId });
        listenerCounts[domain] = result.listeners.map(listener => listener.type).sort();
        if (!baseline) assert.deepEqual(listenerCounts[domain], ['blur', 'change', 'keyup', 'pointerup']);
        await cdp.send('Runtime.releaseObject', { objectId: remote.result.objectId });
    }
    if (!baseline) {
        assert.deepEqual(continuous.callsBefore, continuous.callsAfter, "telemetry must not resynchronize unchanged globe filters");
        assert.equal(continuous.rows.airRows, 500); assert.equal(continuous.rows.navalRows, 500);
        if (heapBefore && heapAfter) assert.ok(heapAfter - heapBefore < 8e6, "bounded heap after continuous updates and collection");
    }
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ baseline, profiles, availability, dropdowns, empty, returned, controls, remounted,
        continuous, heapBefore, heapAfter, listenerCounts }));
});
