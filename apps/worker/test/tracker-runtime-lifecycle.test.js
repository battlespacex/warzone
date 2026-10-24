import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";

const naval = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
function fn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const sample = (changes = {}) => ({ track_key: "ais-369493622", mmsi: "369493622",
  lon: 50, lat: 26, heading_deg: 90, speed_kts: 20, last_seen_at: 1800000000000, ...changes });

function harness() {
  let now = 0, nextFrame = 0;
  const frames = new Map(), tasks = new Map();
  const state = { vessels: new Map(), renderEnabled: true, reconcileGeneration: 0,
    reconcileFrame: 0, createdCount: 0, selectedKey: "" };
  const viewer = { entities: new Cesium.EntityCollection(), camera: { positionCartographic: { height: 1000 } } };
  const context = vm.createContext({
    Cesium, window: { __warzoneViewer: viewer }, __navalState: state,
    performance: { now: () => now++ },
    requestAnimationFrame: cb => { frames.set(++nextFrame, cb); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    registerAnimationTask: (key, cb) => tasks.set(key, cb),
    unregisterAnimationTask: key => tasks.delete(key),
    NAVAL_MIN_ANIM_DISTANCE_METERS: 1, NAVAL_DEFAULT_ANIM_MS: 2600,
    NAVAL_MIN_ANIM_MS: 900, NAVAL_MAX_ANIM_MS: 9000,
    getNavalLabelStyleConfig: () => ({ animHeightMax: 1e9 }),
    buildNavalLabel: () => ({}), applyNavalLabel: () => {}, applyNavalVisual: () => {},
    buildNavalOrientation: () => Cesium.Quaternion.IDENTITY,
    requestNavalRenderBatched: () => {}, normalizeText: v => String(v || ""), normalizeCountryName: v => v,
  });
  for (const name of ["clamp", "normalizeHeadingDegrees", "shortestHeadingDeltaDegrees", "getEntityPosition",
    "animateVesselTo", "createVesselEntity", "updateVesselEntity", "isValidCoordinatePair",
    "parseCoordinate", "pickFirstFiniteCoordinate", "isResolvedFallbackCoordinate", "resolveNavalTelemetryCoordinates",
    "resolveNavalLastSeenAt", "mergeNavalVesselData", "isNavalPositionUpdateAccepted",
    "matchesNavalVisibilityFilter", "cancelNavalRenderReconcile", "scheduleNavalRenderReconcile",
    "removeNavalRenderEntity"]) vm.runInContext(fn(naval, name), context);
  return { context, state, viewer, frames, tasks,
    tick(time) { now = time; for (const [key, cb] of [...tasks]) if (cb(time) === false) tasks.delete(key); },
    drain() { let n = 0; while (frames.size) { assert.ok(n++ < 100); const [key, cb] = frames.entries().next().value; frames.delete(key); cb(); } },
  };
}

test("naval insertion is idempotent in a real Cesium collection and preserves selection references", () => {
  const h = harness(), vessel = sample();
  const entity = h.context.createVesselEntity(h.viewer, vessel);
  h.viewer.selectedEntity = entity;
  for (let i = 0; i < 10; i++) assert.equal(h.context.createVesselEntity(h.viewer, vessel), entity);
  assert.equal(h.viewer.entities.values.length, 1);
  assert.equal(h.viewer.selectedEntity, entity);
});

test("live creation and replaced registry entries cannot race a queued naval restoration", () => {
  const h = harness(), old = { data: sample(), entity: null };
  h.state.vessels.set(old.data.track_key, old);
  h.context.scheduleNavalRenderReconcile();
  const newer = sample({ lon: 50.001, last_seen_at: old.data.last_seen_at + 30000 });
  const entity = h.context.createVesselEntity(h.viewer, newer);
  h.state.vessels.set(newer.track_key, { data: newer, entity });
  h.drain();
  assert.equal(h.viewer.entities.values.length, 1);
  assert.equal(h.state.vessels.get(newer.track_key).entity, entity);
  assert.equal(entity.__navalData.lon, newer.lon);
  assert.equal(old.entity, null);
});

test("deleted records cannot be resurrected by queued naval restoration", () => {
  const h = harness(), vessel = sample();
  h.state.vessels.set(vessel.track_key, { data: vessel, entity: null });
  h.context.scheduleNavalRenderReconcile();
  h.state.vessels.delete(vessel.track_key);
  h.drain();
  assert.equal(h.viewer.entities.values.length, 0);
});

test("repeated naval OFF/ON cancels stale batches while aircraft entities remain independent", () => {
  const h = harness();
  const aircraft = h.viewer.entities.add({ id: "track-ais-369493622" });
  for (let i = 0; i < 300; i++) {
    const vessel = sample({ track_key: `ais-${i}` });
    h.state.vessels.set(vessel.track_key, { data: vessel, entity: null });
  }
  for (let cycle = 0; cycle < 5; cycle++) {
    h.state.renderEnabled = true;
    h.context.scheduleNavalRenderReconcile();
    const [firstId, first] = h.frames.entries().next().value;
    h.frames.delete(firstId);
    first();
    const stale = h.frames.values().next().value || first;
    h.state.renderEnabled = false;
    h.context.cancelNavalRenderReconcile();
    for (const [key, entry] of h.state.vessels) h.context.removeNavalRenderEntity(h.viewer, key, entry);
    h.state.renderEnabled = true;
    h.context.scheduleNavalRenderReconcile();
    stale(); // Simulates a previously dispatched callback after a newer ON.
    h.drain();
    assert.equal(h.viewer.entities.values.length, 301);
    assert.equal(h.viewer.entities.getById(aircraft.id), aircraft);
    assert.equal(h.tasks.size, 0);
  }
});

test("naval source time accepts epoch units and observation time outranks database refresh time", () => {
  const { context: c } = harness();
  assert.equal(c.resolveNavalLastSeenAt({ occurred_at: "2026-10-20T00:00:00Z", updated_at: "2026-10-23T00:00:00Z" }), Date.parse("2026-10-20T00:00:00Z"));
  assert.equal(c.resolveNavalLastSeenAt({ last_seen_at: 1800000000 }), 1800000000000);
  assert.equal(c.resolveNavalLastSeenAt({ last_seen_at: 1800000000000 }), 1800000000000);
  assert.equal(c.mergeNavalVesselData(sample(), sample({ last_seen_at: 1800000030000 })).last_seen_at, 1800000030000);
});

test("naval telemetry retains latitude/longitude order and rejects AIS out-of-range sentinels", () => {
  const { context: c } = harness();
  const position = c.resolveNavalTelemetryCoordinates({ source_lat: 26, source_lon: 50 });
  assert.equal(position.lat, 26);
  assert.equal(position.lon, 50);
  assert.equal(position.hasRawTelemetry, true);
  const unavailable = c.resolveNavalTelemetryCoordinates({ source_lat: 91, source_lon: 181 });
  assert.equal(Number.isNaN(unavailable.lat), true);
  assert.equal(Number.isNaN(unavailable.lon), true);
});

test("naval validity gate rejects older/duplicate samples, identity collisions, invalid coordinates and impossible jumps", () => {
  const { context: c } = harness(), previous = sample();
  for (const changes of [{ last_seen_at: previous.last_seen_at - 1 }, {}, { mmsi: "123456789", last_seen_at: previous.last_seen_at + 30000 },
    { lat: 91 }, { lon: NaN }, { lon: 70, last_seen_at: previous.last_seen_at + 30000 }]) {
    assert.equal(c.isNavalPositionUpdateAccepted(previous, sample(changes)), false, JSON.stringify(changes));
  }
  assert.equal(c.isNavalPositionUpdateAccepted(previous, sample({ lon: 50.003, last_seen_at: previous.last_seen_at + 30000 })), true);
  assert.equal(c.isNavalPositionUpdateAccepted(previous, sample({ speed_kts: 100, lon: 50.03, last_seen_at: previous.last_seen_at + 60000 })), true);
});

test("naval visual refresh leaves interpolation intact and movement ends at the authoritative position", () => {
  const h = harness(), vessel = sample();
  const entity = h.context.createVesselEntity(h.viewer, vessel);
  const next = sample({ lon: 50.002, last_seen_at: vessel.last_seen_at + 30000 });
  h.context.updateVesselEntity(entity, next);
  const motion = entity.__navalMotionState;
  assert.equal(motion.duration, 27000, "a 30-second AIS update must not be compressed to nine seconds");
  h.tick(1000);
  h.context.updateVesselEntity(entity, next);
  assert.equal(entity.__navalMotionState, motion);
  h.tick(30000);
  assert.equal(h.tasks.size, 0);
  const position = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
  assert.ok(Math.abs(Cesium.Math.toDegrees(position.longitude) - next.lon) < 1e-8);
  const held = entity.position.getValue(Cesium.JulianDate.now());
  h.tick(1000000);
  assert.ok(Cesium.Cartesian3.equals(held, entity.position.getValue(Cesium.JulianDate.now())));
});

test("naval interpolation crosses the date line by the short path", () => {
  const h = harness(), vessel = sample({ lon: 179.999, lat: 0 });
  const entity = h.context.createVesselEntity(h.viewer, vessel);
  h.context.updateVesselEntity(entity, sample({ lon: -179.999, lat: 0, last_seen_at: vessel.last_seen_at + 30000 }));
  h.tick(4500);
  const position = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
  assert.ok(Math.abs(Cesium.Math.toDegrees(position.longitude)) > 179.99);
});

test("a filtered vessel resumes its unfinished accepted movement when shown again", () => {
  const h = harness(), vessel = sample();
  const entity = h.context.createVesselEntity(h.viewer, vessel);
  const next = sample({ lon: 50.002, last_seen_at: vessel.last_seen_at + 30000 });
  h.context.updateVesselEntity(entity, next);
  h.tick(1000);
  h.tasks.clear();
  entity.__navalMotionState = null;
  h.context.updateVesselEntity(entity, next);
  assert.ok(entity.__navalMotionState);
  h.tick(40000);
  const position = Cesium.Cartographic.fromCartesian(entity.position.getValue(Cesium.JulianDate.now()));
  assert.ok(Math.abs(Cesium.Math.toDegrees(position.longitude) - next.lon) < 1e-8);
});

test("equal aircraft source times cannot repeatedly retarget a moving/predicted aircraft", () => {
  const context = vm.createContext({ __liveTrackRegistry: new Map([["A", { source_timestamp: 10000 }]]) });
  vm.runInContext(fn(air, "classifyLiveTrackTelemetryUpdate"), context);
  assert.equal(context.classifyLiveTrackTelemetryUpdate({ __lastSourceTimestamp: 10000 }, { track_key: "A" }, 10000), "insignificant");
  assert.equal(context.classifyLiveTrackTelemetryUpdate({ __lastSourceTimestamp: 10000 }, { track_key: "A" }, 9000), "stale");
});

test("aircraft interpolation uses elapsed time through delayed frames and preserves heading/altitude endpoints", () => {
  const c = vm.createContext({
    Cesium, clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    normalizeDegrees: value => ((value % 360) + 360) % 360,
    setLiveTrackPositionValue: (entity, value) => { entity.position = Cesium.Cartesian3.clone(value); },
    setLiveTrackOrientationValue: () => {}, setLiveTrackBillboardRotationValue: () => {},
    recordLiveTrackMotionDiagnostic: () => {},
  });
  vm.runInContext(fn(air, "interpolateLiveTrackCartesian"), c);
  vm.runInContext(fn(air, "updateLiveTrackMotionFrame"), c);
  for (const frames of [[0, 500, 1000], [0, 100, 200, 500, 750, 1000]]) {
    const entity = { __liveTrackMotionState: {
      phase: "interpolation", startedAt: 0, durationMs: 1000,
      startCartesian: new Cesium.Cartesian3(0, 0, 100), endCartesian: new Cesium.Cartesian3(100, 0, 200),
      startHeadingDeg: 90, headingDeltaDeg: 30, endHeadingDeg: 120,
      startPitchDeg: 0, endPitchDeg: 5, startRollDeg: 0, endRollDeg: 10,
    } };
    let previous = -1;
    for (const now of frames) {
      c.updateLiveTrackMotionFrame(entity, now);
      assert.ok(entity.position.x >= previous);
      assert.ok(Math.abs(entity.position.x - now / 10) < 1e-8);
      assert.ok(Math.abs(entity.position.z - (100 + now / 10)) < 1e-8);
      previous = entity.position.x;
    }
    assert.equal(entity.__currentHeadingDeg, 120);
    assert.equal(entity.__currentPitchDeg, 5);
    assert.equal(entity.__liveTrackMotionState, null);
  }
});
