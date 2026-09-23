import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("focus transitions adapt refinement pressure without resizing the framebuffer", async () => {
  const globe = await readSource("../../../dev/assets/js/warzone-globe.js");
  const css = await readSource("../../../dev/assets/css/root.css");
  const performanceMode = globe.slice(
    globe.indexOf("setPerformanceMode(visibleCount = 0) {"),
    globe.indexOf("highlightAlertRegion(event) {", globe.indexOf("setPerformanceMode(visibleCount = 0) {")),
  );

  assert.match(globe, /const focusSceneSettled = isFocusedAssetMode && focusRefinement\?\.focusSettled === true/);
  assert.match(globe, /if \(tileLoadBusy && !is2DMode && !focusSceneSettled\)/);
  assert.match(globe, /if \(focusSceneSettled\) \{[\s\S]*?nextSse = Math\.min\(nextSse, cameraHeight <= closeSharpHeight/);
  assert.match(globe, /if \(isFocusedAssetMode && !focusSceneSettled\)/);
  assert.doesNotMatch(performanceMode, /viewer\.resolutionScale\s*=/);
  assert.doesNotMatch(performanceMode, /viewer\.scene\.msaaSamples\s*=/);
  assert.equal((globe.match(/viewer\.resolutionScale\s*=/g) || []).length, 1);
  assert.equal((globe.match(/viewer\.scene\.msaaSamples\s*=/g) || []).length, 1);
  assert.match(globe, /viewer\.resolutionScale = 1;/);
  assert.match(globe, /viewer\.scene\.msaaSamples = 1;/);
  assert.match(css, /--warzone-resolution-scale:\s*1;/);
  assert.match(css, /--warzone-msaa-samples:\s*1;/);
  assert.match(globe, /tileCacheCap:\s*420/);
  assert.match(css, /--warzone-focus-performance-tile-cache:\s*420;/);
  assert.match(css, /--warzone-globe-tile-cache-size:\s*420;/);
  assert.match(css, /--warzone-globe-tile-cache-moving:\s*420;/);
  assert.match(css, /--warzone-globe-tile-cache-loading:\s*420;/);
  assert.match(css, /--warzone-globe-max-screen-space-error:\s*1\.65;/);
  assert.match(css, /--warzone-globe-moving-screen-space-error:\s*2\.65;/);
  assert.match(css, /--warzone-max-zoom-screen-space-error:\s*0\.55;/);
  assert.match(css, /--warzone-globe-loading-descendant-limit:\s*24;/);
  assert.match(css, /--warzone-globe-loading-descendant-limit-busy:\s*10;/);
  assert.match(css, /--warzone-globe-preload-ancestors:\s*1;/);
  assert.match(css, /--warzone-globe-preload-siblings:\s*0;/);
  assert.match(globe, /requestRenderMode:\s*true/);
  assert.match(globe, /viewer\.scene\.maximumRenderTimeChange = Infinity/);
});

test("development-safe Cesium diagnostics expose throttled camera and imagery evidence", async () => {
  const globe = await readSource("../../../dev/assets/js/warzone-globe.js");

  assert.match(globe, /enableCesiumPerformanceDiagnostics === true/);
  assert.match(globe, /hostname === "localhost"/);
  assert.match(globe, /window\.__stratopsPerf = Object\.freeze/);
  assert.match(globe, /getCameraStats/);
  assert.match(globe, /getImageryStats/);
  assert.match(globe, /getFocusStats/);
  assert.match(globe, /getTileNetworkStats/);
  assert.match(globe, /getTileCacheStats/);
  assert.match(globe, /getImageryLatencyStats/);
  assert.match(globe, /beginImagerySample/);
  assert.match(globe, /endImagerySample/);
  assert.match(globe, /PerformanceObserver/);
  assert.match(globe, /World_Imagery\\\/MapServer\\\/tile/);
  assert.match(globe, /stratops-imagery-request-burst-start/);
  assert.match(globe, /stratops-imagery-request-burst-end/);
  assert.match(globe, /stratops-imagery-cache-hit-revisit/);
  assert.match(globe, /stratops-imagery-settled/);
  assert.match(globe, /__warzoneAttachImageryProviderDiagnostics/);
  assert.doesNotMatch(globe, /baseProvider\.requestImage\s*=/);
  assert.match(globe, /wrapCameraMethod\("lookAt", "cameraLookAts"\)/);
  assert.match(globe, /wrapCameraMethod\("setView", "cameraSetViews"\)/);
  assert.match(globe, /wrapCameraMethod\("flyTo", "cameraFlyTos"\)/);
  assert.match(globe, /stratops-focus-camera-stable/);
  assert.match(globe, /stratops-focus-imagery-stable/);
  assert.match(globe, /stratops-focus-unlock-stable/);
  assert.match(globe, /printTileRefinement\(\)/);
  assert.match(globe, /getTileRefinementStats/);
  assert.match(globe, /queuedArcGisRequests/);
  assert.match(globe, /highestRequestedLevel/);
  assert.match(globe, /provider\.requestImage = function[\s\S]*?return result/);
  assert.doesNotMatch(globe.match(/function installCesiumPerformanceDiagnostics[\s\S]*?\n\}/)?.[0] || "", /requestAnimationFrame/);
});

const loadPolicy = async () => import(`data:text/javascript,${encodeURIComponent(await readSource("../../../dev/assets/js/warzone-imagery-refinement.js"))}`);
const pose = (targetX = 0, offset = 0) => ({ position: [offset, -2500, 1000], direction: [0, 1, 0], up: [0, 0, 1], target: [6378137 + targetX, 0, 0], range: 2500 });

test("continuous follow settles without moveEnd or an empty tile queue", async () => {
  const { createFocusImageryRefinementPolicy } = await loadPolicy();
  const policy = createFocusImageryRefinementPolicy();
  let result;
  for (let now = 0; now <= 10000; now += 50) {
    result = policy.update({ now, active: true, generation: 1, pose: pose(now * 0.25) });
    assert.equal(result.focusSettled, now >= 900);
  }
  assert.equal(result.phase, "FOCUS_SETTLED");
  assert.equal(result.lastMeaningfulDisplacementAt, 0);
});

test("manual navigation, relative pose changes and major target jumps re-enter transition", async () => {
  const { createFocusImageryRefinementPolicy } = await loadPolicy();
  const policy = createFocusImageryRefinementPolicy();
  policy.update({ now: 0, active: true, generation: 1, pose: pose() });
  assert.equal(policy.update({ now: 1000, active: true, generation: 1, pose: pose(250) }).focusSettled, true);
  assert.equal(policy.update({ now: 1050, active: true, generation: 1, pose: pose(260), userInteracting: true }).phase, "FOCUS_TRANSITION");
  assert.equal(policy.update({ now: 2000, active: true, generation: 1, pose: pose(500) }).focusSettled, true);
  assert.equal(policy.update({ now: 2250, active: true, generation: 1, pose: pose(1700) }).majorTargetDisplacement, true);
  assert.equal(policy.update({ now: 3250, active: true, generation: 1, pose: pose(1900) }).focusSettled, true);
  assert.equal(policy.update({ now: 3300, active: true, generation: 1, pose: pose(1910, 50) }).phase, "FOCUS_TRANSITION");
});

test("fly-in does not settle prematurely and refocus starts a fresh settle window", async () => {
  const { createFocusImageryRefinementPolicy } = await loadPolicy();
  const policy = createFocusImageryRefinementPolicy();
  policy.update({ now: 0, active: true, generation: 1, pose: pose() });
  assert.equal(policy.update({ now: 5000, active: true, generation: 1, pose: pose(500), flightActive: true }).focusSettled, false);
  assert.equal(policy.update({ now: 6000, active: true, generation: 1, pose: pose(600) }).focusSettled, true);
  assert.equal(policy.update({ now: 6100, active: false }).phase, "UNFOCUSED");
  assert.equal(policy.update({ now: 6200, active: true, generation: 2, pose: pose(620) }).focusSettled, false);
});

async function qualityHarness(source = null) {
  const globe = source || await readSource("../../../dev/assets/js/warzone-globe.js");
  const css = await readSource("../../../dev/assets/css/root.css");
  const values = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*([\d.]+)\s*;/g)].map((match) => [match[1], Number(match[2])]));
  const viewer = { resolutionScale: 1, scene: { globe: {}, msaaSamples: 1, postProcessStages: { fxaa: {} } }, __warzoneCameraMoving: true, __warzoneTileLoadBusy: true, __warzoneTileLoadQueueSize: 50, __warzoneFocusRefinementState: { focusSettled: true, phase: "FOCUS_SETTLED" } };
  const context = vm.createContext({
    viewer, window: { __warzoneFocusDiagnostics: { state: "active", assetId: "aircraft" } },
    numberVar: (name, fallback) => values[name] ?? fallback, boolVar: () => true,
    ADAPTIVE_QUALITY_PROFILES: ["normal", "balanced", "conservative", "safe"],
    getCameraHeight: () => 10000, getSceneMode: () => "3d", updateMaximumZoomImagerySampling: () => {},
  });
  for (const [start, end] of [["function normalizeAdaptiveProfile", "function getAdaptiveProfileCaps"], ["function getAdaptiveProfileCaps", "function setLimitedCache"], ["function getFocusedAssetPerformanceCaps", "function rememberEventEntity"]]) {
    vm.runInContext(globe.slice(globe.indexOf(start), globe.indexOf(end)), context);
  }
  const start = globe.indexOf("setPerformanceMode(visibleCount = 0) {");
  const end = globe.indexOf("highlightAlertRegion(event) {", start);
  const mode = vm.runInContext(`({${globe.slice(start, end)}})`, context);
  return { viewer, context, apply: (visibleCount = 10) => mode.setPerformanceMode(visibleCount) };
}

test("all runtime quality modes keep framebuffer quality fixed across entity, camera, tile and focus state", async () => {
  const { viewer, apply } = await qualityHarness();
  viewer.__warzoneCameraMoving = false;
  viewer.__warzoneTileLoadBusy = false;
  viewer.__warzoneTileLoadQueueSize = 0;
  apply(0);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.scene.msaaSamples, 1);

  viewer.__warzoneCameraMoving = true;
  viewer.__warzoneTileLoadBusy = true;
  viewer.__warzoneTileLoadQueueSize = 50;
  apply(1000);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.scene.msaaSamples, 1);

  viewer.__warzoneFocusRefinementState.focusSettled = false;
  apply(30);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.scene.msaaSamples, 1);
});

test("actual settled-focus quality restores close SSE, full resolution/MSAA while follow and downloads continue", async () => {
  const { viewer, apply } = await qualityHarness();
  apply();
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 1.25);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.scene.msaaSamples, 1);
  assert.equal(viewer.scene.globe.loadingDescendantLimit, 24);
  assert.equal(viewer.scene.globe.tileCacheSize, 420);
  assert.equal(viewer.scene.requestRenderMode, true);
  assert.equal(viewer.__warzonePerformanceState.cesiumCameraMoving, true);
  assert.equal(viewer.__warzonePerformanceState.isCameraMoving, false);
});

test("actual transition and unlock retain existing moving/loading policies and adaptive safety caps", async () => {
  const { viewer, context, apply } = await qualityHarness();
  viewer.__warzoneFocusRefinementState.focusSettled = false;
  apply();
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2.65);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.scene.msaaSamples, 1);
  context.window.__warzoneFocusDiagnostics.state = "inactive";
  apply();
  assert.equal(viewer.__warzonePerformanceState.isFocusedAssetMode, false);
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 2.65);
  viewer.__warzoneCameraMoving = false;
  viewer.__warzoneTileLoadBusy = false;
  viewer.__warzoneTileLoadQueueSize = 0;
  apply();
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 0.55);
  context.window.__warzoneFocusDiagnostics.state = "active";
  viewer.__warzoneFocusRefinementState.focusSettled = true;
  viewer.__warzoneAdaptiveProfile = "balanced";
  apply();
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.scene.globe.maximumScreenSpaceError, 1.85);
  assert.equal(viewer.scene.msaaSamples, 1);
});

test("authentication modal render budgeting never changes framebuffer resolution or MSAA", async () => {
  const essential = await readSource("../../../dev/assets/js/essential.js");
  const start = essential.indexOf("function setAuthModalRenderBudget(paused) {");
  const end = essential.indexOf("function shouldSuspendMapWork()", start);
  const budget = essential.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(budget, /resolutionScale\s*=/);
  assert.doesNotMatch(budget, /msaaSamples\s*=/);
});

test("read-only tile snapshots distinguish desired children, rendered parent imagery and failed children", async () => {
  const { readTileRefinementSnapshot } = await loadPolicy();
  const layer = {};
  const parentImage = { imageryLayer: layer, level: 12, state: 4 };
  const childImage = { imageryLayer: layer, level: 18, state: 1 };
  const failedImage = { imageryLayer: layer, level: 19, state: 5 };
  const parent = { _lastSelectionResult: 2, _lastSelectionResultFrame: 10, data: { imagery: [{ readyImagery: parentImage, loadingImagery: childImage }] } };
  const kicked = { _lastSelectionResult: 6, _lastSelectionResultFrame: 10, parent, data: { imagery: [{ loadingImagery: failedImage }] } };
  parent.replacementNext = kicked;
  const globe = { _surface: { _tilesToRender: [parent], _lastSelectionFrameNumber: 10, _tileLoadQueueHigh: [kicked], _tileReplacementQueue: { head: parent, count: 2 } } };
  const state = readTileRefinementSnapshot(globe, layer);
  assert.equal(state.tilesRendered, 1);
  assert.equal(state.tilesWaitingForChildren, 1);
  assert.equal(state.highestRenderedLevel, 12);
  assert.equal(state.highestDesiredLevel, 19);
  assert.equal(state.imageryStates.loading, 1);
  assert.equal(state.imageryStates.ready, 1);
  assert.equal(state.imageryStates.failed, 1);
  assert.equal(state.parentImageryFallbacks, 1);
  childImage.state = 4;
  parent.data.imagery[0] = { readyImagery: childImage };
  assert.equal(readTileRefinementSnapshot(globe, layer).highestRenderedLevel, 18);
});

test("installed Cesium requests another frame on image request completion under requestRenderMode", async () => {
  const sceneSource = await readSource("../../../node_modules/@cesium/engine/Source/Scene/Scene.js");
  assert.match(sceneSource, /RequestScheduler\.requestCompletedEvent\.addEventListener\(\s*requestRenderAfterFrame\(this\)/);
  const callback = sceneSource.slice(sceneSource.indexOf("const requestRenderAfterFrame ="), sceneSource.indexOf("/**", sceneSource.indexOf("const requestRenderAfterFrame =")));
  const factory = vm.runInNewContext(`${callback}; requestRenderAfterFrame`);
  let rendered = 0;
  const scene = { requestRenderMode: true, frameState: { afterRender: [] }, requestRender: () => rendered++ };
  factory(scene)();
  assert.equal(scene.frameState.afterRender.length, 1);
  scene.frameState.afterRender[0]();
  assert.equal(rendered, 1);
});

test("installed Cesium camera settle detection never emits moveEnd during continuous 20 Hz reference-frame updates", async () => {
  const source = await readSource("../../../node_modules/@cesium/engine/Source/Scene/View.js");
  const start = source.indexOf("View.prototype.checkForCameraUpdates =");
  const end = source.indexOf("/**", start);
  let now = 0, starts = 0, ends = 0;
  const camera = { target: 0, moveStart: { raiseEvent: () => starts++ }, moveEnd: { raiseEvent: () => ends++ } };
  const context = { View: { prototype: {} }, cameraEqual: (a, b) => a.target === b.target, CesiumMath: { EPSILON15: 1e-15 }, getTimestamp: () => now, Camera: { clone: (a, b) => { b.target = a.target; } } };
  const check = vm.runInNewContext(`${source.slice(start, end)}; View.prototype.checkForCameraUpdates`, context);
  const view = { camera, _cameraClone: { target: 0 }, _cameraStartFired: false };
  const scene = { cameraEventWaitTime: 500 };
  for (now = 50; now <= 10000; now += 50) { camera.target += 12.5; check.call(view, scene); }
  assert.equal(starts, 1);
  assert.equal(ends, 0);
  now = 11000;
  check.call(view, scene);
  assert.equal(ends, 1);
});

test("live diagnostics preserve provider return values, count deferrals and expose per-level network timing", async () => {
  const globeSource = await readSource("../../../dev/assets/js/warzone-globe.js");
  const start = globeSource.indexOf("function installCesiumPerformanceDiagnostics");
  const end = globeSource.indexOf("function shouldClusterEvents", start);
  const events = new Map();
  const event = (name) => ({ addEventListener: (callback) => events.set(name, callback) });
  let calls = 0, nextResult = Promise.resolve({ image: true }), resourceObserver;
  const provider = { requestImage: () => { calls++; return nextResult; }, errorEvent: event("providerError") };
  const viewer = {
    camera: { moveStart: event("moveStart"), moveEnd: event("moveEnd"), changed: event("changed"), lookAt() {}, setView() {}, flyTo() {}, flyToBoundingSphere() {} },
    scene: { requestRender() {}, postRender: event("postRender"), globe: { tileLoadProgressEvent: event("tiles"), _surface: { _tilesToRender: [] } } },
    __imageryBase: { imageryProvider: provider },
  };
  const context = vm.createContext({
    window: { location: { hostname: "localhost", href: "http://localhost:4173" } },
    document: { addEventListener: (name, callback) => events.set(name, callback) },
    performance: { now: () => 100 }, markCesiumPerformance: () => {}, getCameraHeight: () => 10000,
    Cesium: { RequestScheduler: { statistics: {}, maximumRequests: 50, maximumRequestsPerServer: 18, numberOfActiveRequestsByServer: () => 0 } },
    PerformanceObserver: class { constructor(callback) { resourceObserver = callback; } observe() {} }, URL,
    console: { table() {} }, getRealtimeStats: () => ({}),
  });
  const installer = vm.runInContext(`${globeSource.slice(start, end)}; installCesiumPerformanceDiagnostics`, context);
  installer(viewer);
  const returned = provider.requestImage(1, 2, 18);
  assert.equal(returned, nextResult);
  assert.equal(calls, 1);
  await returned;
  await new Promise((resolve) => setImmediate(resolve));
  nextResult = undefined;
  assert.equal(provider.requestImage(2, 3, 19), undefined);
  assert.equal(calls, 2);
  resourceObserver({ getEntries: () => [{ name: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/2/1", duration: 123, transferSize: 4000, decodedBodySize: 3700, responseStatus: 200 }] });
  const network = context.window.__stratopsPerf.getTileNetworkStats();
  assert.equal(network.providerRequests.accepted, 1);
  assert.equal(network.providerRequests.completed, 1);
  assert.equal(network.providerRequests.deferred, 1);
  assert.equal(network.providerRequests.outstandingPromises, 0);
  assert.equal(network.providerRequests.highestRequestedLevel, 18);
  assert.equal(network.perLevel[0].level, 18);
  assert.equal(network.perLevel[0].p50LatencyMs, 123);
  assert.equal(network.perLevel[0].observedHttpStatuses[0], 200);
  assert.equal(typeof context.window.__stratopsPerf.printTileRefinement, "function");
  installer(viewer);
  provider.requestImage(3, 4, 20);
  assert.equal(calls, 3);
  assert.equal(context.window.__stratopsPerf.getTileNetworkStats().providerRequests.deferred, 2);
});

test("focus quality installer is idempotent, requests quality only on phase changes and never moves the camera", async () => {
  const source = await readSource("../../../dev/assets/js/warzone-imagery-refinement.js");
  const events = new Map();
  let now = 0, qualitySyncs = 0;
  const canvas = { addEventListener: (name, callback) => events.set(`canvas:${name}`, callback) };
  const context = vm.createContext({
    window: { __warzoneFocusDiagnostics: { state: "active", assetId: "plane", generation: 1 }, addEventListener: (name, callback) => events.set(`window:${name}`, callback) },
    document: { addEventListener: (name, callback) => events.set(`document:${name}`, callback) }, performance: { now: () => now },
  });
  const installer = vm.runInContext(`${source.replaceAll("export function", "function")}; installFocusImageryRefinementPolicy`, context);
  let listeners = 0, update;
  const viewer = { camera: { position: { x: 0, y: -2500, z: 1000 }, direction: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 }, transform: Array(16).fill(0) }, scene: { canvas, preUpdate: { addEventListener: (fn) => { listeners++; update = fn; } } } };
  viewer.camera.transform[12] = 6378137;
  installer(viewer, () => qualitySyncs++);
  installer(viewer, () => qualitySyncs++);
  assert.equal(listeners, 1);
  for (now = 50; now <= 2000; now += 50) { viewer.camera.transform[12] += 12.5; update(); }
  assert.equal(viewer.__warzoneFocusRefinementState.focusSettled, true);
  assert.equal(qualitySyncs, 2);
  events.get("canvas:wheel")();
  assert.equal(viewer.__warzoneFocusRefinementState.focusSettled, false);
  assert.equal(qualitySyncs, 3);
  context.window.__warzoneFocusDiagnostics.state = "inactive";
  events.get("document:wz:asset-focus-changed")();
  assert.equal(viewer.__warzoneFocusRefinementState.phase, "UNFOCUSED");
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval|camera\.(?:lookAt|setView|flyTo)\(/);
});

test("aircraft and naval focus cameras use bounded rates and meaningful-change thresholds", async () => {
  const aircraft = await readSource("../../../dev/assets/js/warzone-live-airforce.js");
  const naval = await readSource("../../../dev/assets/js/warzone-live-naval.js");
  const css = await readSource("../../../dev/assets/css/root.css");

  assert.match(aircraft, /LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ = 20/);
  assert.match(aircraft, /targetDelta >= positionEpsilonMeters/);
  assert.match(aircraft, /headingDelta >= 0\.02/);
  assert.match(aircraft, /viewer\.__warzoneRecordFocusCameraUpdate\?\.\("aircraft"\)/);
  assert.match(aircraft, /registerTask\("aircraft-camera-lock"[\s\S]*?\{ hz: LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ \}/);

  assert.match(naval, /NAVAL_FOCUS_CAMERA_SYNC_HZ = 20/);
  assert.match(naval, /targetDelta < positionEpsilonMeters/);
  assert.match(naval, /headingDelta < 0\.02/);
  assert.match(naval, /viewer\.__warzoneRecordFocusCameraUpdate\?\.\("naval"\)/);
  assert.match(naval, /registerTask\("naval-camera-lock"[\s\S]*?\{ hz: NAVAL_FOCUS_CAMERA_SYNC_HZ \}/);

  assert.match(css, /--warzone-live-aircraft-focus-camera-sync-hz:\s*20;/);
  assert.match(css, /--warzone-live-aircraft-focus-camera-position-epsilon:\s*4;/);
  assert.match(css, /--warzone-live-naval-focus-camera-sync-hz:\s*20;/);
  assert.match(css, /--warzone-live-naval-focus-camera-position-epsilon:\s*2;/);
});
