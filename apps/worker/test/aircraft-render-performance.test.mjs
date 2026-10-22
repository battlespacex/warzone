import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createAircraftIdentityIndex } from "../../../dev/assets/js/warzone-aircraft-identity-index.js";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
function loadFunctions(context, names) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
  }
}

test("indexed aircraft duplicate lookup preserves the original full-scan match and registry order", () => {
  const registry = new Map();
  const index = createAircraftIdentityIndex();
  const context = vm.createContext({
    __liveTrackRegistry: registry,
    __liveTrackIdentityIndex: index,
    getTrackMetadata: (track) => track.metadata || {},
    sanitizeTrackText: (value) => String(value || "").trim(),
    isTrackTextUsable: (value) => Boolean(value),
    resolveTrackSubtype: (track) => track.subtype || "fighter",
    getCartesianDistanceMeters: (a, b) => Math.hypot(a.lon - b.lon, a.lat - b.lat) * 111000,
    getShortestAngleDeltaDeg: (a, b) => ((b - a + 540) % 360) - 180,
    Cesium: { Cartesian3: { fromDegrees: (lon, lat) => ({ lon, lat }) } },
    LIVE_TRACK_DUPLICATE_DISTANCE_METERS: 6500,
    LIVE_TRACK_DUPLICATE_HEADING_DELTA_DEG: 18,
    LIVE_TRACK_DUPLICATE_SPEED_DELTA_KTS: 80,
  });
  loadFunctions(context, [
    "getTrackRegistrationLabel", "getTrackCallsignLabel", "getTrackIcao24Label",
    "getTrackModelLabel", "areAircraftTracksLikelyDuplicates",
    "getTrackDuplicateIdentityTokens", "findDuplicateLiveTrackKey",
  ]);
  const baseline = (track) => {
    for (const entry of registry.values()) {
      if (!entry?.active || !entry?.track_key || entry.__manualAircraftOverride) continue;
      if (context.areAircraftTracksLikelyDuplicates(track, entry)) return entry.track_key;
    }
    return "";
  };
  const add = (entry) => {
    registry.set(entry.track_key, entry);
    if (entry.active && !entry.__manualAircraftOverride) {
      index.set(entry.track_key, context.getTrackDuplicateIdentityTokens(entry));
    } else index.deactivate(entry.track_key);
  };
  for (let n = 0; n < 300; n += 1) {
    add({ track_key: `air-${n}`, active: true, icao24: n.toString(16).padStart(6, "0"),
      callsign: `CALL${n % 15}`, registration: `REG${n % 23}`, lat: 42, lon: -74,
      heading_deg: 90, speed_kts: 350 });
  }
  const probes = [
    { track_key: "incoming-1", icao24: "000001", callsign: "CALL9" },
    { track_key: "incoming-2", callsign: "CALL3", lat: 42, lon: -74, heading_deg: 90, speed_kts: 350 },
    { track_key: "incoming-3", registration: "REG2", lat: 50, lon: -74 },
    { track_key: "incoming-4", callsign: "CALL3", lat: 42, lon: -74, heading_deg: 180 },
    { track_key: "incoming-5", callsign: "CALL3", lat: 42, lon: -74, speed_kts: 500 },
    { track_key: "incoming-6", callsign: "CALL3", lat: 42, lon: -74, subtype: "transport" },
    { track_key: "incoming-7", callsign: "CALL3", lat: 42, lon: -74, type_code: "B738" },
    { track_key: "incoming-8", callsign: "CALL3", lat: 42, lon: -74, model: "F-16" },
    { track_key: "incoming-9", icao24: "999999", callsign: "CALL3" },
    { track_key: "incoming-10", lat: 42, lon: -74 },
  ];
  const verify = () => probes.forEach((probe) => assert.equal(context.findDuplicateLiveTrackKey(probe), baseline(probe)));
  verify();
  const changed = { ...registry.get("air-1"), icao24: "aaaaaa", callsign: "NEWCALL" };
  add(changed);
  verify();
  changed.active = false;
  index.deactivate(changed.track_key);
  verify();
  changed.active = true;
  add(changed);
  verify();
  registry.delete(changed.track_key);
  index.delete(changed.track_key);
  verify();
});

test("aircraft trail geometry is Focus-only and old Focus geometry is released", () => {
  const entities = new Map();
  const viewer = { entities: {
    getById: (id) => entities.get(id),
    add: (value) => { entities.set(value.id, value); return value; },
    remove: (value) => entities.delete(value.id),
  } };
  const replay = { selectedTrackKey: "", mode: "" };
  const trails = new Map();
  const cache = new Map();
  const registry = new Map([["air-1", { path_history: [{ lon: 1 }, { lon: 2 }] }]]);
  let trailCommits = 0;
  const context = vm.createContext({
    window: { __warzoneViewer: viewer },
    document: { dispatchEvent() {} },
    CustomEvent: class {},
    __liveTrackReplayState: replay,
    __liveTrackTrails: trails,
    __liveTrackTrailPositionsCache: cache,
    __liveTrackRegistry: registry,
    getLiveTrackSubtypeTrailEnabled: () => true,
    getLiveTrackStyleConfig: () => ({ trailWidth: 2, trailColor: "white", trailOpacity: 1 }),
    getLiveTrackSubtypeTrailWidth: () => 2,
    getTrackTrailPositions: () => [],
    getPositionCartesian: (value) => value,
    commitTrackTrailPosition: () => { trailCommits += 1; },
    applyLiveTrackFocusVisibility() {},
    publishLiveTrackSelectionState() {},
    setLiveTrackHardLockInternal() {},
    clearFocusedTrackCameraLock() {},
    hideLiveTrackFocusVisuals() {},
    syncLiveTrackFocusOverlay() {},
    dispatchLiveTrackRegistryUpdate() {},
    syncWidgetRowHighlight() {},
    refreshFocusedTrackIsolation() {},
    Cesium: {
      CallbackProperty: class {},
      Color: { fromCssColorString: () => ({ withAlpha: () => ({}) }) },
      ArcType: { NONE: 0 },
    },
  });
  loadFunctions(context, ["isTrackCurrentlyFocused", "shouldRenderLiveTrackTrail",
    "removeLiveTrackTrailRenderState", "getOrCreateTrackTrailEntity",
    "pushTrackTrailPointFromCartesian", "setSelectedTrack"]);
  for (const count of [1000, 5000, 10000]) {
    for (let n = 0; n < count; n += 1) {
      const key = `air-${n}`;
      assert.equal(context.getOrCreateTrackTrailEntity(viewer, key, {}), null);
      context.pushTrackTrailPointFromCartesian(key, {}, {});
    }
    assert.equal(entities.size, 0);
    assert.equal(trailCommits, 0);
  }
  context.setSelectedTrack("air-1", "focus");
  context.getOrCreateTrackTrailEntity(viewer, "air-1", {});
  context.pushTrackTrailPointFromCartesian("air-1", {}, {});
  assert.equal(entities.size, 1);
  assert.equal(trailCommits, 1);
  trails.set("air-1", [{}]);
  cache.set("air-1", {});
  context.setSelectedTrack("air-2", "focus");
  assert.equal(entities.size, 0);
  assert.equal(trails.size, 0);
  assert.equal(cache.size, 0);
  assert.equal(registry.get("air-1").path_history.length, 2);
  context.getOrCreateTrackTrailEntity(viewer, "air-2", {});
  context.setSelectedTrack("", "");
  assert.equal(entities.size, 0);
});

test("the aircraft animation loop updates only active motions and stops after completion", () => {
  const registry = new Map();
  for (let n = 0; n < 10000; n += 1) registry.set(`track-${n}`, { __trackKey: String(n) });
  const focused = registry.get("track-0");
  const other = registry.get("track-1");
  focused.__liveTrackMotionState = {};
  other.__liveTrackMotionState = {};
  const active = new Set([focused, other]);
  const frames = [];
  let updates = 0, focusCameraUpdates = 0, renderRequests = 0, batchedRequests = 0;
  const context = vm.createContext({
    __liveTrackEntities: registry,
    __liveTrackActiveMotionEntities: active,
    __liveTrackReplayState: { selectedTrackKey: "0" },
    __liveTrackHardLockEnabled: true,
    __liveTrackInterpolationActiveUntil: 0,
    __liveTrackInterpolationRenderRaf: 0,
    performance: { now: () => 0 },
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    updateLiveTrackMotionFrame: (entity) => {
      updates += 1;
      if (entity === focused && updates === 1) return true;
      entity.__liveTrackMotionState = null;
      return false;
    },
    syncFocusedTrackCamera: () => { focusCameraUpdates += 1; },
    window: { __warzoneViewer: { scene: { requestRender: () => { renderRequests += 1; } } } },
    requestWarzoneRenderBatched: () => { batchedRequests += 1; },
  });
  loadFunctions(context, ["wakeLiveTrackInterpolationRender"]);
  context.wakeLiveTrackInterpolationRender(1000);
  context.wakeLiveTrackInterpolationRender(1000);
  assert.equal(frames.length, 1);
  frames.shift()(16);
  assert.equal(active.size, 1);
  frames.shift()(32);
  assert.equal(active.size, 0);
  assert.equal(frames.length, 0);
  assert.equal(updates, 3);
  assert.equal(focusCameraUpdates, 2);
  assert.equal(renderRequests, 2);
  assert.equal(batchedRequests, 1);
});

test("removing the final aircraft releases its active motion and pending frame", () => {
  const entity = { id: "track-A", __trackKey: "A", __liveTrackMotionState: {} };
  const entities = new Map([[entity.id, entity]]);
  const active = new Set([entity]);
  const viewerEntities = new Map([[entity.id, entity]]);
  let cancelled = 0;
  const context = vm.createContext({
    window: { __warzoneViewer: { entities: {
      getById: (id) => viewerEntities.get(id),
      remove: (value) => viewerEntities.delete(value.id),
    } } },
    __liveTrackEntities: entities,
    __liveTrackActiveMotionEntities: active,
    __liveTrackTrails: new Map(),
    __liveTrackTrailPositionsCache: new Map(),
    __liveTrackVisualState: new Map(),
    __liveTrackIconCodeCache: new Map(),
    __liveTrackRegistry: new Map(),
    __liveTrackHoverTrackKey: "",
    __liveTrackDestroyedCount: 0,
    __liveTrackInterpolationRenderRaf: 1,
    __liveTrackInterpolationActiveUntil: 1000,
    cancelAnimationFrame: () => { cancelled += 1; },
  });
  loadFunctions(context, ["removeLiveTrackRenderState"]);
  assert.equal(context.removeLiveTrackRenderState("A"), true);
  assert.equal(active.size, 0);
  assert.equal(entities.size, 0);
  assert.equal(viewerEntities.size, 0);
  assert.equal(cancelled, 1);
  assert.equal(context.__liveTrackInterpolationRenderRaf, 0);
});
