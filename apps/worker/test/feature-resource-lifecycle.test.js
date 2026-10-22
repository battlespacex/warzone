import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import DataSourceCollection from "../../../node_modules/@cesium/engine/Source/DataSources/DataSourceCollection.js";

async function source(file) {
  return readFile(process.env.STRATOPS_LIFECYCLE_BASELINE
    ? join(process.env.STRATOPS_LIFECYCLE_BASELINE, file)
    : new URL(`../../../dev/assets/js/${file}`, import.meta.url), "utf8");
}

async function functions(file, names, globals) {
  const text = await source(file);
  const context = vm.createContext({ console, AbortController, ...globals });
  for (const name of names) {
    const start = text.indexOf(`function ${name}(`);
    if (start < 0) continue; // Allows the same probe to measure the pre-fix source.
    const asyncStart = text.slice(start - 6, start) === "async " ? start - 6 : start;
    vm.runInContext(text.slice(asyncStart, text.indexOf("\n}", start) + 2), context);
  }
  return context;
}

class Events {
  listeners = new Map();
  addEventListener(type, fn) {
    if (typeof type === "function") return this.addEventListener("cesium", type);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.removeEventListener(type, fn);
  }
  removeEventListener(type, fn) {
    if (typeof type === "function") return this.removeEventListener("cesium", type);
    this.listeners.get(type)?.delete(fn);
  }
  fire(type, event) { for (const fn of [...(this.listeners.get(type) || [])]) fn(event); }
  get count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}

function clock() {
  const timers = new Map(), frames = new Map();
  let id = 0;
  return {
    timers, frames,
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearTimeout: (key) => timers.delete(key),
    setInterval: (fn) => { timers.set(++id, fn); return id; },
    clearInterval: (key) => timers.delete(key),
    requestAnimationFrame: (fn) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (key) => frames.delete(key),
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const noop = () => {};
const cachedDataSource = (name) => ({ name, show: true, entities: {
  values: [], add(entity) { this.values.push(entity); return entity; },
  removeAll() { this.values.length = 0; }, suspendEvents: noop, resumeEvents: noop,
} });

test("final animation-task OFF cancels its pending frame across repeated cycles", async (t) => {
  const time = clock();
  const context = vm.createContext({ ...time, console, performance: { now: () => 1 },
    document: { visibilityState: "visible", addEventListener: noop },
    window: { __warzoneViewer: { scene: { requestRender: noop } } },
  });
  vm.runInContext((await source("warzone-animation-scheduler.js")).replace(/^export /gm, ""), context);
  for (let i = 0; i < 20; i += 1) {
    context.registerAnimationTask("feature", () => true);
    context.registerAnimationTask("feature", () => true);
    assert.equal(time.frames.size, 1);
    context.unregisterAnimationTask("feature");
  }
  t.diagnostic(`OFF pending animation frames: ${time.frames.size}`);
  assert.equal(time.frames.size, 0);
});

async function orbitalHarness() {
  const time = clock(), requests = [], tasks = new Map();
  let controls = 0;
  const state = { enabled: false, loading: false, fetchController: null, viewer: { scene: { requestRender: noop } },
    config: { enabled: true, apiPath: "/orbital", positionRefreshIntervalMs: 30000 },
    records: [{ id: "cached" }], visibleRecords: [], entities: new Map(), satrecs: new Map(),
    focusEntities: [], selectedId: "", focusRequestToken: 0,
  };
  const controller = { isActiveAsset: () => false, registerTask: (k, fn) => tasks.set(k, fn), removeTask: (k) => tasks.delete(k) };
  const c = await functions("warzone-mil-sats.js", ["installSatelliteFocusTasks", "stopOrbitalFetch", "fetchOrbitalData",
    "stopTimers", "startTimers", "cleanupLayer", "setWarzoneMilSatsEnabled"], {
    ...time, state, document: { hidden: false }, DEFAULT_API_PATH: "/orbital", DEFAULT_CONFIG: { positionRefreshIntervalMs: 30000 },
    SATELLITE_FOCUS_TASK_KEYS: { visual: "satellite-visual-motion", camera: "satellite-camera-follow" },
    SATELLITE_FOCUS_VISUAL_HZ: 30, SATELLITE_FOCUS_CAMERA_HZ: 12,
    getAssetFocusController: () => controller, updateFocusedSatelliteVisual: noop, updateSatelliteFocusCamera: noop,
    fetch: (url, options) => { const d = deferred(); requests.push({ ...d, signal: options.signal }); return d.promise; },
    updateControlsOptions: () => { controls += 1; }, updateVisibleRecords: noop, updateDefaultEntities: noop,
    setStatusText: noop, formatAge: String, mergeConfig: noop, stopStartupDemo: noop,
    resetSatelliteFocusRuntime: noop, destroyHandler: noop, hideHoverGuide: noop, hideHoverCard: noop,
    clearFocusEntities: noop, removeEntity: noop, purgeOrbitalRenderEntities: noop, hideOrbitalWidget: noop,
    showOrbitalWidget: noop, ensureControls: noop, ensureHandler: noop,
  });
  const respond = (index, id) => requests[index].resolve({ ok: true, json: async () => ({ satellites: [{ id }] }) });
  return { c, time, state, requests, tasks, respond, controls: () => controls };
}

test("orbital OFF aborts its request and a late response cannot rebuild controls", async (t) => {
  const h = await orbitalHarness();
  h.state.enabled = true;
  const pending = h.c.fetchOrbitalData();
  h.c.setWarzoneMilSatsEnabled(false);
  const before = h.controls();
  h.respond(0, "obsolete");
  await pending;
  const metrics = { aborted: h.requests[0].signal?.aborted === true, controlsAfterOff: h.controls() - before,
    cachedId: h.state.records[0]?.id, timers: h.time.timers.size };
  t.diagnostic(JSON.stringify(metrics));
  assert.deepEqual(metrics, { aborted: true, controlsAfterOff: 0, cachedId: "cached", timers: 0 });
});

test("orbital rapid OFF/ON isolates old completions and restores one runtime", async () => {
  const h = await orbitalHarness();
  h.state.enabled = true;
  const obsolete = h.c.fetchOrbitalData();
  h.c.setWarzoneMilSatsEnabled(false);
  h.c.setWarzoneMilSatsEnabled(true);
  assert.equal(h.requests.length, 2, "ON starts a fresh request without waiting for the aborted fetch");
  h.respond(0, "obsolete");
  await obsolete;
  assert.equal(h.state.loading, true, "old finally must not clear the new request state");
  assert.equal(h.state.records[0].id, "cached");
  h.respond(1, "current");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.state.records[0].id, "current");
  for (let i = 0; i < 20; i += 1) {
    h.c.setWarzoneMilSatsEnabled(true);
    assert.equal(h.time.timers.size, 2);
    assert.equal(h.tasks.size, 2);
    h.c.setWarzoneMilSatsEnabled(false);
    assert.equal(h.time.timers.size, 0);
    assert.equal(h.tasks.size, 0);
  }
});

async function aoiHarness() {
  const canvas = new Events(), win = new Events(), body = new Events();
  body.classList = { add: noop, remove: noop };
  let callbacks = 0;
  const state = { viewer: { scene: { canvas, requestRender: noop } }, polygon: [], active: false,
    scanGeneration: 0, panelObserver: { observe: noop, disconnect: noop }, panel: {},
    dataSource: { entities: { removeAll: noop } },
  };
  const c = await functions("warzone-aoi-lens.js", ["bindCanvasDrawing", "unbindCanvasDrawing", "activateEnabledAoi",
    "clearAoi", "closeEnabledAoi", "setEnabled", "renderSummary"], {
    state, window: win, document: { body }, isLayerEnabled: () => false,
    showPanel: noop, hidePanel: noop, setPanelBody: noop, setButtonState: noop, applyDataSourceVisibility: noop,
    bindFocusDismiss: noop, bindModalVisibility: noop, unbindAoiVisibility: noop,
    onPointerDown: () => { callbacks += 1; }, onPointerMove: () => { callbacks += 1; },
    onPointerUp: noop, onPointerCancel: noop, onCanvasClick: noop, onKeyDown: noop,
    renderSummaryHtml: () => "completed", buildSummary: async () => ({}),
  });
  return { c, state, canvas, win, callbacks: () => callbacks };
}

test("AOI OFF detaches drawing inputs and ON restores exactly one set", async (t) => {
  const h = await aoiHarness();
  h.c.bindCanvasDrawing(); // Existing initialization can have installed drawing hooks.
  for (let i = 0; i < 20; i += 1) {
    h.c.setEnabled(true);
    h.c.setEnabled(true);
    assert.equal(h.canvas.count + h.win.count, 6);
    h.c.setEnabled(false);
  }
  h.canvas.fire("pointermove", {});
  t.diagnostic(`AOI OFF input listeners: ${h.canvas.count + h.win.count}; pointer callbacks: ${h.callbacks()}`);
  assert.equal(h.canvas.count + h.win.count, 0);
  assert.equal(h.callbacks(), 0);
});

test("AOI OFF invalidates an unfinished scan before it updates the panel", async () => {
  const h = await aoiHarness(), scan = deferred();
  let panelWrites = 0;
  h.c.buildSummary = () => scan.promise;
  h.c.setPanelBody = () => { panelWrites += 1; };
  const pending = h.c.renderSummary([{ lon: 1, lat: 1 }]);
  h.c.setEnabled(false);
  const before = panelWrites;
  scan.resolve({});
  await pending;
  assert.equal(panelWrites, before);
});

test("aircraft OFF releases picking, focus inputs and camera callbacks; ON is idempotent", async (t) => {
  const time = clock(), canvas = new Events(), win = new Events(), doc = new Events(), handlers = new Set(), tasks = new Map();
  const events = { preRender: new Events(), moveStart: new Events(), moveEnd: new Events() };
  const viewer = { scene: { canvas, preRender: events.preRender }, camera: { moveStart: events.moveStart, moveEnd: events.moveEnd },
    container: { style: {} }, entities: { values: [], getById: noop } };
  win.__warzoneViewer = viewer;
  class Handler {
    actions = new Map();
    constructor() { handlers.add(this); }
    setInputAction(fn, type) { this.actions.set(type, fn); }
    destroy() { handlers.delete(this); }
  }
  class Cartesian2 { static clone(value, target) { return Object.assign(target, value); } }
  const c = await functions("warzone-live-airforce.js", ["bindLiveTrackRuntimeEvent", "bindLiveTrackSceneEvent", "unbindLiveTrackRuntime",
    "bindFocusInteractionTracking", "isCameraWithinTrackLabelZoom", "bindLiveTrackOverlay", "bindLiveTrackPicking", "syncLiveTrackRenderPopulation"], {
    ...time, window: win, document: doc, Cesium: { Cartesian2, ScreenSpaceEventHandler: Handler, ScreenSpaceEventType: { MOUSE_MOVE: "move", LEFT_CLICK: "click", LEFT_DOUBLE_CLICK: "double" } },
    __liveTrackRuntimeCleanups: [], __liveTrackOverlayBound: false, __liveTrackFocusInputBound: false, __liveTrackClickBound: false,
    __liveTrackClickHandler: null, __liveTrackRenderReconcileActive: false, __liveTrackRenderReconcileCancel: null,
    __liveTrackRegistry: new Map(), __liveTrackEntities: new Map(),
    __liveTrackViewRefreshSeq: 0, __liveTrackViewRefreshRaf: 0, __liveTrackInterpolationRenderRaf: 0,
    __liveTrackRenderWakeBurstTimer: 0, __liveTrackCtrlTiltDragState: null,
    LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ: 20, LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX: 65000,
    isLayerEnabled: () => false, isFocusSelectionActive: () => false, getFocusedTrackKey: () => "",
    ensureLiveTrackOverlayRoot: noop, syncFocusedTrackOverlayModeButtons: noop,
    getAssetFocusController: () => ({ registerTask: (key, fn) => tasks.set(key, fn), removeTask: (key) => tasks.delete(key), requestFrame: noop }),
    purgeLiveTrackRenderEntities: noop, requestWarzoneRenderBatched: noop,
    unbindLiveTrackRuntime: noop, hideTrackHover: noop, hideRouteOriginHover: noop, hideTrackHoverGuide: noop,
  });
  for (let i = 0; i < 20; i += 1) {
    c.bindLiveTrackOverlay(viewer); c.bindLiveTrackPicking(viewer);
    c.bindLiveTrackOverlay(viewer); c.bindLiveTrackPicking(viewer);
    assert.equal(handlers.size, 1);
    assert.equal(tasks.size, 2);
    [...handlers][0].actions.get("move")({ endPosition: { x: 4, y: 5 } });
    c.syncLiveTrackRenderPopulation();
    assert.equal(time.frames.size, 0, "OFF cancels queued hover picking before it can run");
  }
  const metrics = { pickingHandlers: handlers.size, inputListeners: canvas.count + win.count + doc.count,
    cameraCallbacks: Object.values(events).reduce((sum, event) => sum + event.count, 0), focusTasks: tasks.size };
  t.diagnostic(JSON.stringify(metrics));
  assert.deepEqual(metrics, { pickingHandlers: 0, inputListeners: 0, cameraCallbacks: 0, focusTasks: 0 });
});

async function airFeedHarness() {
  const time = clock(), requests = [], statuses = [];
  const c = await functions("warzone-air-ingestion.js", ["refreshPublicAirTracks", "stopPublicAirIngestion"], {
    ...time, window: time, document: { visibilityState: "visible" },
    __inFlightPromise: null, __isFetching: false, __fetchInFlightSince: 0, __activeFetchController: null,
    __pollingActive: true, __pollTimer: null, __pollGeneration: 0, __nextRetryAt: 0,
    __failureCount: 0, __lastFailureHttpStatus: 0, __activeTrackKeys: new Set(), __canonicalTrackStore: new Map(),
    isPublicAirFallbackEnabled: () => true, cleanupStaleTracks: noop,
    setFeedStatus: (status) => statuses.push(status),
    fetchAirplanesLiveRecords: (signal) => { const d = deferred(); requests.push({ ...d, signal }); return d.promise; },
  });
  return { c, requests, statuses };
}

test("public aircraft feed OFF rejects late responses and preserves a newer request", async (t) => {
  const h = await airFeedHarness();
  const old = h.c.refreshPublicAirTracks();
  h.c.stopPublicAirIngestion();
  h.requests[0].resolve([]); // Simulate a transport that resolves despite abort.
  await old;
  t.diagnostic(`Aircraft feed status after OFF and late response: ${h.statuses.at(-1)}`);
  assert.equal(h.statuses.at(-1), "paused");
  const first = h.c.refreshPublicAirTracks();
  h.c.stopPublicAirIngestion();
  const second = h.c.refreshPublicAirTracks();
  assert.equal(h.requests.length, 3);
  h.requests[1].resolve([]);
  await first;
  assert.equal(h.c.__isFetching, true);
  assert.equal(h.c.__activeFetchController.signal, h.requests[2].signal);
  h.requests[2].resolve([]);
  await second;
  assert.equal(h.c.__isFetching, false);
});

test("alert OFF removes only its siren channel and ON never duplicates it", async (t) => {
  let enabled = true;
  const listeners = [], channels = new Set();
  const sharedChannel = { name: "events-live" };
  channels.add(sharedChannel);
  const c = await functions("warzone-realtime.js", ["syncSirenBroadcastSubscription", "subscribeToSirenBroadcast"], {
    __sirenBroadcastChannel: null, __sirenBroadcastStopPromise: null, __sirenLayerListenerBound: false,
    isLayerEnabled: () => enabled, onLayerChange: (fn) => listeners.push(fn),
    instrumentRealtimeCallback: (name, fn) => fn,
    supabase: {
      channel: (name) => {
        const channel = { name, on() { return this; }, subscribe() { channels.add(this); return this; } };
        return channel;
      },
      removeChannel: (channel) => { channels.delete(channel); return Promise.resolve(); },
    },
  });
  for (let i = 0; i < 20; i += 1) {
    enabled = true;
    c.subscribeToSirenBroadcast(); c.subscribeToSirenBroadcast();
    enabled = false;
    listeners.forEach((fn) => fn("alerts"));
  }
  t.diagnostic(`Alert OFF siren subscriptions: ${channels.size - 1}; shared event subscriptions: ${Number(channels.has(sharedChannel))}`);
  assert.equal(channels.size, 1);
  assert.equal(channels.has(sharedChannel), true);
  assert.equal(listeners.length, 1);
  enabled = true;
  listeners.forEach((fn) => fn("*"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channels.size, 2);
});

test("alert OFF clears siren timers and pauses audio", async (t) => {
  const time = clock(), listeners = [];
  let enabled = true, pauses = 0;
  const c = vm.createContext({ ...time, console,
    window: { addEventListener: noop }, document: { getElementById: () => null },
    isStratOpsFeatureEnabled: () => true, isLayerEnabled: () => enabled,
    onLayerChange: (fn) => listeners.push(fn),
    Audio: class { play() { return Promise.resolve(); } pause() { pauses += 1; } },
  });
  vm.runInContext((await source("warzone-siren-alert.js")).replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""), c);
  c.startSirenLoop();
  assert.equal(time.timers.size, 1);
  enabled = false;
  listeners.forEach((fn) => fn("alerts"));
  t.diagnostic(`Alert OFF audio timers: ${time.timers.size}; audio pauses: ${pauses}`);
  assert.equal(time.timers.size, 0);
  assert.equal(pauses, 1);
  assert.equal(c.showSirenAlert({ title: "late broadcast" }), null);
});

test("GNSS OFF aborts, deduplicates refreshes and rejects stale completion", async (t) => {
  let enabled = true, calculations = 0;
  const requests = [];
  const c = await functions("essential.js", ["syncGnssInterferenceLayer", "refreshGnssInterferenceCells", "stopGnssInterferenceRefresh"], {
    window: { __warzoneViewer: {} }, __gnssInterferenceController: null, __gnssInterferenceLoadingPromise: null,
    __gnssInterferenceCellsCache: [], __gnssInterferenceMeta: {}, __gnssInterferenceLastLoadedAt: 0,
    GNSS_LAYER_REFRESH_MS: 30000, FOCUS_MODE_GNSS_REFRESH_MS: 60000,
    isLayerEnabled: () => enabled, shouldDeferBackgroundMapWork: () => false,
    clearGnssInterferenceLayer: noop, renderGnssInterferenceLayer: noop,
    getScopedGnssInterferenceCells: () => [],
    normalizeGnssCell: (row) => { calculations += 1; return row; },
    api: { getGnssInterferenceCells: (options = {}) => {
      const d = deferred(); requests.push({ ...d, signal: options.signal }); return d.promise;
    } },
  });
  const old = c.refreshGnssInterferenceCells();
  enabled = false;
  c.syncGnssInterferenceLayer();
  requests[0].resolve({ data: [{ id: "obsolete" }], meta: {} });
  await old;
  const metrics = { aborted: requests[0].signal?.aborted === true, calculationsAfterOff: calculations };
  t.diagnostic(JSON.stringify(metrics));
  assert.deepEqual(metrics, { aborted: true, calculationsAfterOff: 0 });
  enabled = true;
  const current = c.refreshGnssInterferenceCells();
  const duplicate = c.refreshGnssInterferenceCells({ force: true });
  assert.equal(requests.length, 2);
  requests[1].resolve({ data: [{ id: "current" }], meta: {} });
  await Promise.all([current, duplicate]);
  assert.equal(c.__gnssInterferenceCellsCache[0].id, "current");
});

async function dataSourceRuntime() {
  const text = await readFile(new URL("../../../dev/assets/js/warzone-data-source-lifecycle.js", import.meta.url), "utf8");
  return import(`data:text/javascript,${encodeURIComponent(text)}`);
}

test("optional Cesium data-source attachment handles rapid OFF/ON without duplicate visualizers", async () => {
  const { setDataSourceActive } = await dataSourceRuntime();
  const dataSources = new DataSourceCollection(), source = cachedDataSource("cached");
  source.entities.add({ id: "retained-record" });
  const viewer = { dataSources };
  let additions = 0;
  dataSources.dataSourceAdded.addEventListener(() => { additions += 1; });
  for (let i = 0; i < 20; i += 1) {
    setDataSourceActive(viewer, source, true);
    setDataSourceActive(viewer, source, false);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dataSources.length, 0);
  assert.equal(additions, 1);
  assert.equal(source.entities.values.length, 1);
  setDataSourceActive(viewer, source, true);
  setDataSourceActive(viewer, source, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dataSources.length, 1);
  assert.equal(additions, 2);
});

test("map labels, raised regions and borders OFF detach cached Cesium visualizers", async (t) => {
  const { setDataSourceActive } = await dataSourceRuntime();
  const dataSources = new DataSourceCollection(), time = clock();
  const sources = Array.from({ length: 4 }, (_, i) => cachedDataSource(`layer-${i}`));
  for (const ds of sources) { ds.entities.add({ id: "cached" }); await dataSources.add(ds); }
  const viewer = { dataSources, scene: { postRender: new Events(), requestRender: noop }, camera: { moveEnd: new Events() },
    __countryLabelDataSource: sources[0], __placeLabelDataSource: sources[1], __raisedRegionDataSource: sources[2],
    __borderDataSource: sources[3], __borderEntities: [], __raisedRegionLoaded: "middle_east", __countryLabelsLoaded: true,
    __warzoneMapLabelsVisible: true,
  };
  let heightCalculations = 0;
  const c = await functions("warzone-globe.js", ["attachLabelsZoomController", "detachLabelsZoomController", "setMapLabelsLayerVisible",
    "updateLabelsLayerVisibility", "applyRaisedRegionVisibility", "applyBorderVisibilityAlpha"], {
    ...time, setDataSourceActive, boolVar: () => true, shouldShowCityLabelsAtCurrentZoom: () => true,
    clamp01: (v) => Math.max(0, Math.min(1, v)), colorFromCssVar: () => ({}),
    getCameraHeight: () => { heightCalculations += 1; return 1000000; },
    detachLabelsZoomController: noop,
  });
  c.attachLabelsZoomController(viewer);
  c.setMapLabelsLayerVisible(viewer, false);
  c.applyRaisedRegionVisibility(viewer, false, { id: "middle_east" });
  c.applyBorderVisibilityAlpha(viewer, 0);
  for (let i = 0; i < 100; i += 1) viewer.scene.postRender.fire("cesium");
  const metrics = { attachedWhileOff: dataSources.length, labelHeightCalculations: heightCalculations,
    labelCallbacks: viewer.scene.postRender.count + viewer.camera.moveEnd.count, pendingLabelFrames: time.frames.size };
  t.diagnostic(JSON.stringify(metrics));
  assert.deepEqual(metrics, { attachedWhileOff: 0, labelHeightCalculations: 0, labelCallbacks: 0, pendingLabelFrames: 0 });
  for (let i = 0; i < 20; i += 1) {
    c.setMapLabelsLayerVisible(viewer, true);
    c.applyRaisedRegionVisibility(viewer, true, { id: "middle_east" });
    c.applyBorderVisibilityAlpha(viewer, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(dataSources.length, 4);
    c.setMapLabelsLayerVisible(viewer, false);
    c.applyRaisedRegionVisibility(viewer, false, { id: "middle_east" });
    c.applyBorderVisibilityAlpha(viewer, 0);
    assert.equal(dataSources.length, 0);
  }
  assert.equal(sources.every((ds) => ds.entities.values.length === 1), true);
});

test("disabled static overlays discard late geometry work and reuse the shared country read on ON", async () => {
  const { setDataSourceActive } = await dataSourceRuntime();
  const geometry = deferred();
  let fetches = 0, builds = 0;
  const viewer = { dataSources: new DataSourceCollection(), scene: { requestRender: noop },
    __warzoneMapLabelsVisible: true, __raisedRegionVisible: true, __raisedRegionRequestedId: "middle_east",
    __borderLayersVisible: true, __countryLabelDataSource: cachedDataSource("labels"),
    __raisedRegionDataSource: cachedDataSource("raised"), __borderEntities: [],
  };
  const c = await functions("warzone-globe.js", ["loadCountryGeometry", "addCountryNameLabels", "ensureRaisedRegionLoaded",
    "addGeoJsonBorderLayer", "setMapLabelsLayerVisible", "applyRaisedRegionVisibility", "setBorderLayersVisible"], {
    setDataSourceActive, BORDER_SOURCES: { countries: "countries" },
    fetchGeoJson: () => { fetches += 1; return geometry.promise; },
    attachLabelsZoomController: noop, detachLabelsZoomController: noop, updateLabelsLayerVisibility: noop,
    applyBorderVisibilityAlpha: noop, stopBorderFadeAnimation: noop,
    featureMatchesRaisedRegion: () => true, addRaisedRegionPolygon: () => { builds += 1; },
  });
  const pending = [c.addCountryNameLabels(viewer), c.ensureRaisedRegionLoaded(viewer, { id: "middle_east" }),
    c.addGeoJsonBorderLayer(viewer, { url: "countries" })];
  c.setMapLabelsLayerVisible(viewer, false);
  c.applyRaisedRegionVisibility(viewer, false, { id: "middle_east" });
  await c.setBorderLayersVisible(viewer, false);
  geometry.resolve({ features: [{ geometry: { type: "Polygon", coordinates: [] } }] });
  await Promise.all(pending);
  assert.equal(builds, 0);
  assert.equal(viewer.__countryLabelsLoaded, undefined);
  assert.notEqual(viewer.__raisedRegionLoaded, "middle_east");
  assert.equal(fetches, 1);
  c.applyRaisedRegionVisibility(viewer, true, { id: "middle_east" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 1);
  assert.equal(viewer.__raisedRegionLoaded, "middle_east");
  assert.equal(fetches, 1);
});

test("an old aircraft poll cannot schedule work after a newer ON cycle begins", async () => {
  const time = clock(), requests = [];
  const c = await functions("warzone-air-ingestion.js", ["schedulePublicAirPoll", "stopPublicAirIngestion"], {
    ...time, window: time, __pollGeneration: 0, __pollingActive: true, __pollTimer: null,
    __activeFetchController: null, __inFlightPromise: null, __nextRetryAt: 0, POLL_INTERVAL_MS: 10000,
    setFeedStatus: noop,
    refreshPublicAirTracks: () => { const d = deferred(); requests.push(d); return d.promise; },
  });
  const firePoll = () => {
    const [key, fn] = time.timers.entries().next().value;
    time.timers.delete(key);
    return fn();
  };
  c.schedulePublicAirPoll(0);
  const old = firePoll();
  c.stopPublicAirIngestion();
  c.__pollingActive = true;
  c.schedulePublicAirPoll(0);
  const current = firePoll();
  requests[0].resolve();
  await old;
  assert.equal(time.timers.size, 0);
  requests[1].resolve();
  await current;
  assert.equal(time.timers.size, 1);
  c.stopPublicAirIngestion();
  assert.equal(time.timers.size, 0);
});

test("aircraft OFF cancels a yielded history-normalization frame", async () => {
  const time = clock();
  let normalizations = 0;
  const c = await functions("essential.js", ["normalizeAircraftHistoryRowsProgressively"], {
    ...time, performance: { now: () => 0 }, getActiveRegion: () => ({}),
    AIRCRAFT_HISTORY_ACTIVE_WINDOW_MS: 60000, isPointInsideRegion: () => true,
    isAircraftTrackSubtype: () => true, shouldExcludeFromMilitaryAircraftTracker: () => false,
    normalizeAircraftHistoryRow: (row) => { normalizations += 1; return { ...row, active: false }; },
  });
  const rows = Array.from({ length: 36 }, (_, i) => ({ track_key: String(i), last_seen_at: Date.now() }));
  const controller = new AbortController();
  const pending = c.normalizeAircraftHistoryRowsProgressively(rows, { signal: controller.signal });
  assert.equal(normalizations, 12);
  assert.equal(time.frames.size, 1);
  controller.abort();
  assert.equal(time.frames.size, 0);
  assert.equal((await pending).length, 0);
  assert.equal(normalizations, 12);
  const restored = c.normalizeAircraftHistoryRowsProgressively(rows, { signal: new AbortController().signal });
  while (time.frames.size) {
    const callbacks = [...time.frames.values()]; time.frames.clear(); callbacks.forEach((fn) => fn());
  }
  assert.equal((await restored).length, 36);
});

test("aircraft history OFF aborts before normalization and cannot clear the next ON request", async () => {
  let enabled = true, normalizations = 0;
  const requests = [];
  const c = await functions("essential.js", ["refreshAircraftHistoryCache", "stopAircraftHistoryRefresh", "stopAircraftLiveSync"], {
    performance: { now: () => 0 }, window: { clearInterval: noop },
    __aircraftHistoryCache: [{ track_key: "cached" }], __aircraftHistoryLastLoadedAt: 0,
    __aircraftHistoryLoadingPromise: null, __aircraftHistoryController: null, __aircraftLiveSyncTimer: 0,
    AIRCRAFT_HISTORY_REFRESH_MS: 30000, AIRCRAFT_HISTORY_CACHE_MAX_ROWS: 100,
    isDocumentHidden: () => false, isAircraftTrackingFeatureEnabled: () => true,
    isLayerEnabled: () => enabled, markTrackerPerf: noop, syncLiveAircraftFromHistoryRows: noop,
    normalizeAircraftHistoryRowsProgressively: async (rows) => { normalizations += 1; return rows; },
    api: { getAircraftTracks: (options = {}) => {
      const d = deferred(); requests.push({ ...d, signal: options.signal }); return d.promise;
    } },
  });
  const old = c.refreshAircraftHistoryCache();
  enabled = false; c.stopAircraftLiveSync();
  assert.equal(requests[0].signal?.aborted, true);
  enabled = true;
  const current = c.refreshAircraftHistoryCache();
  assert.equal(requests.length, 2);
  requests[0].resolve({ data: [{ track_key: "obsolete" }], error: null });
  await old;
  assert.equal(normalizations, 0);
  assert.equal(c.__aircraftHistoryController.signal, requests[1].signal);
  requests[1].resolve({ data: [{ track_key: "current" }], error: null });
  await current;
  assert.equal(c.__aircraftHistoryCache[0].track_key, "current");
  assert.equal(c.__aircraftHistoryLoadingPromise, null);
});

test("aircraft and GNSS API adapters forward cancellation without changing legacy callers", async () => {
  const text = await source("supabase.js");
  const controller = new AbortController();
  const context = vm.createContext({ Date, API_BASE: "/api", GNSS_API_BASE: "/api", GNSS_CELL_LIMIT: 100,
    AIRCRAFT_HISTORY_WINDOW_MS: 10000, AIRCRAFT_HISTORY_LIMIT: 100, __warnedGnssUnavailable: false,
    readJsonResponse: async () => ({ cells: [] }),
  });
  const method = (name) => {
    const start = text.indexOf(`async ${name}(`);
    return vm.runInContext(`({${text.slice(start, text.indexOf("\n    },", start) + 7)}})`, context)[name];
  };
  const signals = [];
  context.fetch = async (url, options) => { signals.push(options?.signal); return { ok: true, json: async () => ({ tracks: [] }) }; };
  await method("getAircraftTracks")({ signal: controller.signal });
  await method("getGnssInterferenceCells")({ signal: controller.signal });
  assert.equal(signals.every((signal) => signal === controller.signal), true);
  await method("getAircraftTracks")();
  assert.equal(signals.at(-1), undefined);
  context.API_BASE = "";
  const query = { select() { return this; }, eq() { return this; }, gte() { return this; }, order() { return this; }, limit() { return this; },
    abortSignal(signal) { this.signal = signal; return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  context.supabase = { from: () => query };
  await method("getAircraftTracks")({ signal: controller.signal });
  assert.equal(query.signal, controller.signal);
});
