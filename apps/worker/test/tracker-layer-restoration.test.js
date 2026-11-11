import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseExpressionAt } from "acorn";
import CustomDataSource from "../../../node_modules/@cesium/engine/Source/DataSources/CustomDataSource.js";

const layersSource = readFileSync(new URL("../../../dev/assets/js/warzone-layers.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
function installFunctions(context, names) {
  for (const name of names) {
    const start = appSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const node = parseExpressionAt(appSource, start, { ecmaVersion: "latest" });
    vm.runInContext(appSource.slice(start, node.end), context);
  }
}

test("real layer notifications restore cached event Entities and imagery after each final tracker OFF", async () => {
  const noop = () => {};
  const events = new CustomDataSource("restoration-test");
  const calls = { statuses: 0, orbital: [], renders: 0, gnssLoads: 0, warnings: [] };
  let failNextStatus = false;
  const imagery = { show: true };
  const borders = { show: false };
  const globe = {
    setTerrainVisible: (show) => { imagery.show = show; },
    setBorderLayersVisible: (show) => { borders.show = show; },
    setEventMarkersSuppressed: noop,
    setEventLayerVisible: (id, show) => events.entities.values.forEach(entity => {
      if (entity.layerId === id) entity.show = show;
    }),
    clearEventEntities: () => events.entities.removeAll(),
    addEvents: (rows) => {
      events.entities.removeAll();
      rows.forEach(row => { const entity = events.entities.add({ id: row.id }); entity.layerId = row._layerId; });
    },
  };
  const viewer = { __warzone: globe, scene: { requestRender: () => { calls.renders += 1; } } };
  const context = vm.createContext({ console: { ...console, warn: (...args) => calls.warnings.push(args) }, Date, window: { __stratopsAuthState: { isAuthenticated: true },
    __warzoneViewer: viewer }, document: { body: { classList: { contains: () => false } },
    querySelector: () => null, getElementById: () => null }, localStorage: { getItem: () => null, setItem: noop },
    getStratOpsLayerFeaturePath: () => "", isStratOpsFeatureEnabled: () => true });
  vm.runInContext(layersSource.replace(/^import[\s\S]*?from "[^"]+";\r?\n/m, "")
    .replace(/import\.meta\.env\?\.DEV/g, "false").replace(/export \{[^}]+\};/g, "").replace(/\bexport /g, ""), context);
  for (const name of ["syncWidgetLayerToggleState", "syncIdleSceneState", "syncFocusAwareBackgroundLoops",
    "debouncedRenderUI", "closeSatelliteImageryViewer", "syncOrbitalWidgetVisibilityForLayer", "ensureHotspotLayer",
    "syncHotspotRootVisibility", "destroyHotspotLayer", "scheduleHotspotLayerRefresh", "scheduleLayerDeferredRefresh",
    "markTrackerPerf", "syncAircraftLivePipelines", "requestAircraftMovementsWidgetRender", "syncLiveAircraftFromHistoryRows",
    "syncLiveTrackRenderPopulation", "syncTracksRealtimeChannel", "cancelNavalHistoryRequest", "setNavalLayerVisible",
    "syncNavalSignals", "refreshPrivateNavalHistory", "clearRanges", "clearSweepers", "renderRanges", "renderSweepers",
    "syncHotspotLayerEvents", "syncGnssInterferenceLayer"]) context[name] = noop;
  Object.assign(context, {
    __eventsCache: [{ id: "region-a-event", category: "strike" }],
    __aircraftHistoryCache: [], __layerLifecycleState: new Map(), __militaryTracks: null, __hotspotLayer: null,
    __lastGlobeSyncKey: "", __lastRangesSyncKey: "__off__", __lastSweepersSyncKey: "__off__",
    __lastGlobeClusterBucket: "", __lastOverlaySourceKey: "", __lastOverlayClusterRadiusBucket: "", __cachedOverlayClusters: [],
    GLOBE_EVENT_RESYNC_EXEMPT_LAYER_IDS: new Set(["aircraft", "naval", "airspace", "gnss", "region-plate", "military-bases", "hotspots", "satellite-imagery"]),
    refreshStatusEvents: () => {
      calls.statuses += 1;
      return failNextStatus ? Promise.reject(new Error("status fixture unavailable")) : Promise.resolve();
    },
    refreshGnssInterferenceCells: () => { calls.gnssLoads += 1; },
    setWarzoneMilSatsEnabledDeferred: (enabled) => { calls.orbital.push(enabled); },
    shouldEnableMilSatsLayer: () => context.isLayerEnabled("orbital-assets"),
    isAircraftTrackingFeatureEnabled: () => true, isNavalTrackingFeatureEnabled: () => true,
    getCurrentMapSourceEvents: () => context.__eventsCache,
    hasEnabledGlobeEventLayer: () => ["strikes", "missiles", "drones", "airstrikes", "recon", "alerts", "thermal", "seismic", "cyber"].some(context.isLayerEnabled),
    applyAllFilters: (rows) => rows.filter(row => context.isEventVisible(row)),
    applyHotspotFilters: rows => rows,
    isNavalSignalEvent: () => false, isAircraftTelemetryEvent: () => false,
    makeEventSignature: rows => rows.map(row => row.id).join("|"), getActiveRegion: () => ({ id: "test" }),
    shouldSuspendMapWork: () => false, isDocumentHidden: () => false,
    startEventPollingFallback: noop, stopEventPollingFallback: noop,
  });
  installFunctions(context, ["syncIdleSceneState", "syncInitialEventsToGlobe", "syncImmediateEventLayerVisibility"]);
  const callbackStart = appSource.indexOf("onLayerChange((id, enabled, state, changedLayerIds) => {");
  const callbackEnd = appSource.indexOf("\n        __aircraftLayerChangeReady", callbackStart);
  vm.runInContext(appSource.slice(callbackStart, callbackEnd), context);
  for (const id of ["aircraft", "naval", "orbital-assets"]) {
    context.resetLayerStateForFreshLoad();
    context.setLayer(id, true);
    assert.equal(events.entities.values.length, 0, `${id}: isolated event entities removed`);
    context.__eventsCache = [{ id: `${id}-new-region-event`, category: "strike" }];
    failNextStatus = id === "orbital-assets";
    context.setLayer(id, false);
    assert.equal(events.entities.values.length, 1, `${id}: restored real Cesium EntityCollection`);
    assert.equal(events.entities.values[0].id, `${id}-new-region-event`);
    assert.equal(events.entities.values[0].show, true);
    assert.equal(imagery.show, true);
    assert.equal(borders.show, false, "borders remain off under the authoritative defaults");
    context.setLayer("country-borders", true);
    assert.equal(borders.show, true, "a restored eligible control reaches the real application handler");
    context.setLayer("country-borders", false);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.statuses, 3, "one existing status refresh request per final exit");
  assert.equal(calls.gnssLoads, 0, "GNSS defaults off; no fabricated restoration fetches");
  assert.ok(calls.renders > 0);
  assert.equal(calls.orbital.at(-1), false);
  assert.equal(calls.warnings.length, 1, "a status failure is reported without blocking other restored layers");
  assert.match(String(calls.warnings[0]), /Status refresh unavailable/);
});

test("late orbital imports cannot enable a superseded mode or initialize an already disabled layer", async () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const calls = [];
  const context = vm.createContext({ window: { __warzoneViewer: {} }, Promise,
    loadWarzoneMilSatsModule: () => promise });
  vm.runInContext("let __warzoneMilSatsModulePromise = true; let __warzoneMilSatsInitialized = false; let __warzoneMilSatsEnableGeneration = 0;", context);
  installFunctions(context, ["setWarzoneMilSatsEnabledDeferred"]);
  const on = context.setWarzoneMilSatsEnabledDeferred(true);
  const off = context.setWarzoneMilSatsEnabledDeferred(false);
  resolve({ initWarzoneMilSats: () => calls.push("init"), setWarzoneMilSatsEnabled: enabled => calls.push(enabled) });
  await Promise.all([on, off]);
  assert.deepEqual(calls, []);
  await context.setWarzoneMilSatsEnabledDeferred(true);
  await context.setWarzoneMilSatsEnabledDeferred(false);
  assert.deepEqual(calls, ["init", true, false]);
});
