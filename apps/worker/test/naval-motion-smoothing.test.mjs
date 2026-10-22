import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
const start = source.indexOf("function animateVesselTo(");
assert.ok(start >= 0);
const animateSource = source.slice(start, source.indexOf("\n}", start) + 2);

test("a new naval observation continues moving immediately from the rendered position", () => {
  let now = 0;
  const tasks = new Map();
  const entity = {
    id: "naval-1", __navalKey: "naval-1", __navalLastSeenAt: 1000,
    position: { lon: 0, lat: 0 }, __navalHeadingDeg: 90,
    billboard: {},
  };
  const context = vm.createContext({
    Cesium: {
      Cartesian3: {
        ZERO: {},
        fromDegrees: (lon, lat) => ({ lon, lat }),
        distance: (a, b) => Math.hypot(a.lon - b.lon, a.lat - b.lat) * 111000,
      },
      Cartographic: { fromCartesian: (point) => ({ longitude: point.lon, latitude: point.lat }) },
      Math: { toDegrees: (value) => value, toRadians: (value) => value * Math.PI / 180 },
    },
    performance: { now: () => now },
    window: { __warzoneViewer: { camera: { positionCartographic: { height: 1000 } } } },
    getEntityPosition: (value) => value.position,
    getNavalLabelStyleConfig: () => ({ animHeightMax: 2000000 }),
    normalizeHeadingDegrees: (value) => ((value % 360) + 360) % 360,
    shortestHeadingDeltaDegrees: (from, to) => to - from,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    registerAnimationTask: (key, callback) => tasks.set(key, callback),
    unregisterAnimationTask: (key) => tasks.delete(key),
    requestNavalRenderBatched() {},
    NAVAL_MIN_ANIM_DISTANCE_METERS: 1,
    NAVAL_DEFAULT_ANIM_MS: 2600,
    NAVAL_MIN_ANIM_MS: 900,
    NAVAL_MAX_ANIM_MS: 9000,
  });
  vm.runInContext(animateSource, context);
  const vessel = (lon, seen) => ({ track_key: "naval-1", lon, lat: 0, heading_deg: 90, last_seen_at: seen });
  context.animateVesselTo(entity, vessel(0.02, 2000));
  entity.__navalLastSeenAt = 2000;
  assert.equal(tasks.size, 1);
  now = 300;
  tasks.get("naval:naval-1")(now);
  const previousPosition = entity.position.lon;
  context.animateVesselTo(entity, vessel(0.03, 3000));
  entity.__navalLastSeenAt = 3000;
  assert.equal(tasks.size, 1);
  now = 400;
  tasks.get("naval:naval-1")(now);
  const progress = (entity.position.lon - previousPosition) / (0.03 - previousPosition);
  assert.ok(progress > 0.09 && progress < 0.13, `first 100 ms progress was ${progress}`);
  now = 1200;
  assert.equal(tasks.get("naval:naval-1")(now), false);
  assert.ok(Math.abs(entity.position.lon - 0.03) < 1e-9);
  assert.equal(entity.__navalMotionState, null);
});
