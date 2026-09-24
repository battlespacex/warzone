import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../../dev/assets/css/root.css", import.meta.url), "utf8");

function section(source, name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
const getShortestAngleDeltaDeg = (from, to) => {
  let delta = normalizeDegrees(to) - normalizeDegrees(from);
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};

test("source cadence drives interpolation and prediction windows without a 12 second floor", () => {
  const context = vm.createContext({
    performance: { now: () => 0 }, clamp,
    LIVE_TRACK_DEFAULT_ANIM_MS: 4000,
    LIVE_TRACK_CADENCE_SAMPLE_MAX: 7,
    LIVE_TRACK_CADENCE_MIN_MS: 700,
    LIVE_TRACK_CADENCE_MAX_MS: 15000,
    LIVE_TRACK_CADENCE_DURATION_FACTOR: 0.9,
    LIVE_TRACK_MIN_ANIM_MS: 700,
    LIVE_TRACK_MAX_ANIM_MS: 15000,
    LIVE_TRACK_MIN_PREDICTION_SPEED_KTS: 15,
    LIVE_TRACK_PREDICTION_SMALL_CORRECTION_METERS: 500,
    LIVE_TRACK_PREDICTION_RECONCILE_MAX_MS: 5000,
    LIVE_TRACK_PREDICTION_CADENCE_FACTOR: 1.6,
    LIVE_TRACK_MIN_PREDICTION_MS: 10000,
    LIVE_TRACK_MAX_PREDICTION_MS: 20000,
  });
  vm.runInContext(section(air, "updateLiveTrackCadenceEstimate", "getLiveTrackHeadingUnitCartesian"), context);
  const entity = { __lastSourceTimestamp: 1000, __liveTrackLastReceiptMonotonicAt: 1000 };
  assert.equal(context.updateLiveTrackCadenceEstimate(entity, 3000, 3000), 2000);
  entity.__lastSourceTimestamp = 3000;
  assert.equal(context.updateLiveTrackCadenceEstimate(entity, 8000, 8000), 3500);
  for (const cadenceMs of [2000, 5000, 10000, 15000]) {
    const speedMps = 250 * 0.514444;
    const distanceMeters = speedMps * (cadenceMs / 1000);
    const duration = context.getLiveTrackInterpolationDurationMs(distanceMeters, cadenceMs, { speed_kts: 250 });
    assert.equal(duration, cadenceMs * 0.9);
    assert.ok(duration < 15000);
  }
  assert.equal(context.getLiveTrackPredictionWindowMs(2000), 10000);
  assert.equal(context.getLiveTrackPredictionWindowMs(8000), 12800);
  assert.equal(context.getLiveTrackPredictionWindowMs(15000), 20000);
});

test("shortest-angle heading smoothing rejects an isolated reverse spike", () => {
  const context = vm.createContext({
    __liveTrackVisualState: new Map(), normalizeDegrees, getShortestAngleDeltaDeg,
    LIVE_TRACK_HEADING_SPIKE_MIN_DEG: 120,
    LIVE_TRACK_HEADING_CONFIRMATION_DEG: 35,
    getTrackDerivedBearing: () => 90,
    getCssNumber: (_name, fallback) => fallback,
    clamp,
  });
  vm.runInContext(section(air, "getTrackVisualState", "getLiveTrackTrailMaxPoints"), context);
  const headings = [85, 87, 267, 89].map((headingDeg) =>
    context.getTrackAttitude({ track_key: "A" }, headingDeg).headingDeg
  );
  assert.deepEqual(headings, [85, 87, 87, 89]);
  const wrap = vm.createContext({ normalizeDegrees, getShortestAngleDeltaDeg, clamp, LIVE_TRACK_MAX_HEADING_RATE_DEG_PER_SEC: 28 });
  vm.runInContext(section(air, "getAlignedLiveTrackMotionAttitude", "getRenderedTrackMotionHeading"), wrap);
  assert.equal(wrap.getAlignedLiveTrackMotionAttitude({}, { headingDeg: 1 }, { headingDeg: 359 }, 1000).headingDeltaDeg, 2);
  assert.equal(wrap.getAlignedLiveTrackMotionAttitude({}, { headingDeg: 358 }, { headingDeg: 2 }, 1000).headingDeltaDeg, -4);
});

test("delayed source coordinates cannot replace a newer authoritative target", () => {
  const context = vm.createContext({
    __liveTrackRegistry: new Map([["A", { source_timestamp: 10000 }]]),
    __liveTrackLastPositions: new Map(),
    getLonLatDistanceMeters: () => 0,
    getTrackResolvedAltitudeFt: () => 10000,
    normalizeDegrees,
    getShortestAngleDeltaDeg,
    LIVE_TRACK_INSIGNIFICANT_DISTANCE_METERS: 8,
    LIVE_TRACK_INSIGNIFICANT_ALTITUDE_FEET: 20,
    LIVE_TRACK_INSIGNIFICANT_HEADING_DEG: 0.75,
    LIVE_TRACK_INSIGNIFICANT_SPEED_KTS: 1.5,
  });
  vm.runInContext(section(air, "classifyLiveTrackTelemetryUpdate", "refreshLiveTrackLiveness"), context);
  assert.equal(context.classifyLiveTrackTelemetryUpdate({ __lastSourceTimestamp: 10000 }, { track_key: "A" }, 5000), "stale");
});

test("altitude policy keeps barometric priority, geometric fallback and explicit ground", () => {
  const context = vm.createContext({
    __liveTrackRegistry: new Map([["A", { altitude_ft: 25000 }]]),
    __liveTrackLastPositions: new Map(),
    LIVE_TRACK_FALLBACK_ALTITUDE_FT_BY_SUBTYPE: { aircraft: 32000 },
    LIVE_TRACK_ENTITY_ALTITUDE_OFFSET_METERS: 18,
    getTrackMetadata: (track) => track.metadata || {},
    resolveTrackSubtype: () => "aircraft",
  });
  vm.runInContext(section(air, "parseNonNegativeNumber", "getTrackRegistrationLabel"), context);
  assert.equal(context.getTrackResolvedAltitudeFt({ track_key: "A" }), 25000);
  assert.equal(context.getTrackResolvedAltitudeFt({ track_key: "B", altitude_geom_ft: 12000 }), 12000);
  assert.equal(context.getTrackResolvedAltitudeFt({ track_key: "A", altitude_ft: 25000, on_ground: true }), 0);
  assert.equal(context.parseNonNegativeNumber(null), null);
});

test("bounded Hermite interpolation removes the synthetic hold-and-jump step", () => {
  class Cartesian3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
  Cartesian3.lerp = (start, end, t, result = new Cartesian3()) => {
    result.x = start.x + ((end.x - start.x) * t);
    result.y = start.y + ((end.y - start.y) * t);
    result.z = start.z + ((end.z - start.z) * t);
    return result;
  };
  const context = vm.createContext({ Cesium: { Cartesian3 } });
  vm.runInContext(section(air, "interpolateLiveTrackCartesian", "setLiveTrackPositionValue"), context);
  const motion = {
    startCartesian: new Cartesian3(0, 0, 0),
    endCartesian: new Cartesian3(1250, 0, 0),
    curveTangents: { start: { x: 400, y: 120, z: 0 }, end: { x: 400, y: 120, z: 0 } },
  };
  let previous = context.interpolateLiveTrackCartesian(motion, 0, new Cartesian3());
  let largestStepMeters = 0;
  const frameCount = Math.ceil(4500 / (1000 / 60));
  for (let frame = 1; frame <= frameCount; frame += 1) {
    const current = context.interpolateLiveTrackCartesian(motion, frame / frameCount, new Cartesian3());
    largestStepMeters = Math.max(largestStepMeters, Math.hypot(current.x - previous.x, current.y - previous.y));
    previous = current;
  }
  assert.ok(largestStepMeters < 8);
  assert.deepEqual(previous, new Cartesian3(1250, 0, 0));
  assert.ok(largestStepMeters < 1250);
});

test("motion architecture retains latest-target replacement, authoritative trails and angled focus", () => {
  const animate = section(air, "animateTrackTo", "resetLiveTrackRuntimeForLifecycle");
  assert.match(animate, /updateLiveTrackMotionFrame\(entity, receivedAt\)[\s\S]*startCartesian = getPositionCartesian\(entity\)/);
  assert.match(animate, /entity\.__liveTrackMotionState = \{[\s\S]*curveTangents/);
  assert.match(animate, /if \(trackKey && !wasPredicting\) pushTrackTrailPointFromCartesian/);
  assert.doesNotMatch(section(air, "updateLiveTrackPredictionFrame", "updateLiveTrackMotionFrame"), /pushTrackTrailPoint/);
  assert.match(css, /--warzone-live-aircraft-focus-camera-pitch:\s*-58/);
  assert.match(css, /--warzone-live-aircraft-focus-camera-heading-offset:\s*180/);
  assert.match(css, /--warzone-live-aircraft-focus-camera-sync-hz:\s*20/);
});
