import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const naval = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
const globe = fs.readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../../dev/assets/css/root.css", import.meta.url), "utf8");
function section(source, name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test("naval CTR uses a 25% smaller 11.25 km outer ring and ground-curved grid", () => {
  const state = {};
  class Cartesian3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
  class PolylineCollection { constructor() { this.lines = []; } add(line) { this.lines.push(line); } }
  const context = vm.createContext({
    Cesium: { Cartesian3, PolylineCollection, Material: { fromType: (_, options) => options }, Math: { toRadians: (value) => value * Math.PI / 180 } },
    getContourOverlayState: () => state, getContourFocusProfile: () => "naval",
    boolVar: () => true, numberVar: (key, fallback) => ({ "--warzone-live-naval-contour-grid-radius": 11250, "--warzone-contour-grid-ring-width": 1.5 }[key] ?? fallback),
    colorFromCssVar: () => ({ withAlpha: (alpha) => alpha }), cssVar: (_, fallback) => fallback,
    clamp01: (value) => value, lerp: (a, b, t) => a + (b - a) * t, smoothContourFade: (t) => t,
    chooseOperationalGridIntervalMeters: () => 5000, updateContourGridPrimitiveCenter() {}, raiseContourGridPrimitive() {},
    addContourGridRing(collection, radius, options) { collection.lines.push({ radius, ...options }); },
  });
  vm.runInContext(section(globe, "ensureContourGridPrimitive", "splitContourPolylineByRadius"), context);
  context.ensureContourGridPrimitive({ scene: { primitives: { add: (value) => value } } });
  const rings = state.gridPrimitive.lines.filter((line) => line.radius);
  assert.deepEqual(rings.map((line) => line.radius), [3750, 7500, 11250]);
  assert.ok(Math.abs(rings[2].width - 1.575) < 1e-10);
  assert.ok(Math.abs(rings[0].width - 1.5 * 0.86 * 1.05) < 1e-10);
  assert.ok(rings[2].getHeight(11250, 0) < -9);
  assert.match(css, /--warzone-live-naval-contour-grid-radius:\s*11250/);
  assert.match(css, /--warzone-contour-grid-radius:\s*13500/);
  assert.match(css, /--warzone-contour-grid-height-offset:\s*1/);
  assert.match(css, /--warzone-live-naval-ctr-focused-distance:\s*24000/);
  assert.match(naval, /setNavalFocusRangeMeters\(getNavalCtrFocusedDistanceMeters\(\), \{ immediate: true \}\)/);
});

test("CTR ring vertices use the ground curvature supplied by the grid", () => {
  class Cartesian3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
  const lines = [];
  const context = vm.createContext({
    Cesium: { Cartesian3, Material: { fromType: (_, options) => options }, Color: { WHITE: { withAlpha: () => null } } },
    numberVar: (_, fallback) => fallback,
  });
  vm.runInContext(section(globe, "addContourGridRing", "ensureContourGridPrimitive"), context);
  context.addContourGridRing({ add: (line) => lines.push(line) }, 100, { getHeight: () => -4 });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].positions.every((position) => position.z === -4), true);
});

test("aircraft orientation follows meaningful movement but ignores position jitter", () => {
  let movedMeters = 10;
  const context = vm.createContext({
    __liveTrackLastPositions: new Map([["a", { lon: 1, lat: 1 }]]),
    LIVE_TRACK_COURSE_HEADING_MIN_DISTANCE_METERS: 75,
    normalizeDegrees: (value) => ((value % 360) + 360) % 360,
    getLonLatDistanceMeters: () => movedMeters,
    getHeadingDegreesFromPoints: () => 270,
  });
  vm.runInContext(section(air, "getTrackResolvedHeading", "getTrackVisualState"), context);
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: 0 }), 0);
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: 45 }), 45);
  movedMeters = 500;
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: 45 }), 270);
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: null }), 270);
});

test("non-focused aircraft billboard follows aviation heading clockwise", () => {
  const context = vm.createContext({
    normalizeDegrees: (value) => ((value % 360) + 360) % 360,
    getLiveTrackArrowHeadingOffsetDeg: () => 0,
    Cesium: { Math: { toRadians: (value) => value * Math.PI / 180 } },
  });
  vm.runInContext(section(air, "getLiveTrackBillboardRotationRadians", "buildLiveTrackPoint"), context);
  assert.equal(context.getLiveTrackBillboardRotationRadians(90), -Math.PI / 2);
  assert.equal(context.getLiveTrackBillboardRotationDeltaRadians(20), -Math.PI / 9);
});

test("aircraft faces the new movement segment before translation begins and remains level", () => {
  const context = vm.createContext({
    normalizeDegrees: (value) => ((value % 360) + 360) % 360,
  });
  vm.runInContext(section(air, "getAlignedLiveTrackMotionAttitude", "setLiveTrackPositionValue"), context);
  const attitude = context.getAlignedLiveTrackMotionAttitude(
    { heading_deg: 95 },
    { headingDeg: 132, pitchDeg: 0, rollDeg: 0 },
    { headingDeg: 18, pitchDeg: 4, rollDeg: 21 }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(attitude)), {
    startHeadingDeg: 132,
    endHeadingDeg: 132,
    headingDeltaDeg: 0,
    startPitchDeg: 0,
    endPitchDeg: 0,
    startRollDeg: 0,
    endRollDeg: 0,
  });
  assert.match(css, /--warzone-live-aircraft-model-dynamic-bank-enabled:\s*0/);
});

test("aircraft heading follows its rendered position to the API target", () => {
  const context = vm.createContext({
    normalizeDegrees: (value) => ((value % 360) + 360) % 360,
    LIVE_TRACK_MIN_ANIM_DISTANCE_METERS: 2,
    getLonLatDistanceMeters: () => 500,
    getHeadingDegreesFromPoints: (lon1, lat1, lon2, lat2) => lon1 + lat1 + lon2 + lat2,
    Cesium: {
      Cartographic: { fromCartesian: () => ({ longitude: 10, latitude: 20 }) },
      Math: { toDegrees: (value) => value },
    },
  });
  vm.runInContext(section(air, "getRenderedTrackMotionHeading", "setLiveTrackPositionValue"), context);
  assert.equal(context.getRenderedTrackMotionHeading({ x: 1, y: 2, z: 3 }, 30, 40, 95), 100);
});

test("aircraft orientation is rebuilt in the local frame of every rendered position", () => {
  const motionFrame = section(air, "updateLiveTrackMotionFrame", "wakeLiveTrackInterpolationRender");
  assert.match(motionFrame, /buildTrackOrientationAtCartesian\(\s*motion\.track \|\| \{\},\s*motion\.currentCartesian/);
  assert.doesNotMatch(motionFrame, /Quaternion\.slerp/);
});

test("focused trail ignores unreached API history and follows only rendered positions", () => {
  const track = { path_history: [{ ts: 100, x: 1 }, { ts: 200, x: 20 }, { ts: 300, x: 30 }] };
  const trail = [
    { ts: 100, position: { x: 1 } },
    { ts: 150, position: { x: 2 } },
    { ts: 300, position: { x: 20 } },
  ];
  const entity = {
    __liveTrackMotionState: { sourceTimestamp: 300, endCartesian: { x: 20 } },
    head: { x: 2.9 },
  };
  const context = vm.createContext({
    window: { __warzoneViewer: { entities: { getById: () => entity } } },
    __liveTrackRegistry: new Map([["a", track]]), __liveTrackTrails: new Map([["a", trail]]),
    trimTrailEntries: (value) => value,
    getPositionCartesian: (value) => value.head,
    getCartesianDistanceMeters: (a, b) => Math.abs(Number(a?.x || 0) - Number(b?.x || 0)),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    Cesium: { Cartesian3: { clone: (value) => ({ ...value }) } },
  });
  vm.runInContext(section(air, "getTraversedTrackTrailEntries", "smoothFocusedRoutePositions"), context);
  const first = context.getFocusedRoutePositions("a");
  entity.head.x = 3.2;
  const second = context.getFocusedRoutePositions("a");
  assert.equal(JSON.stringify(first), '[{"x":1},{"x":2},{"x":2.9}]');
  assert.equal(JSON.stringify(second), '[{"x":1},{"x":2},{"x":3.2}]');
});

test("trail seeding excludes API coordinates the aircraft has not reached", () => {
  const trails = new Map();
  let seededHistory = null;
  const context = vm.createContext({
    window: { __warzoneViewer: { entities: { getById: () => ({ __liveTrackLastCommittedSourceTimestamp: 100 }) } } },
    __liveTrackTrails: trails,
    __liveTrackRegistry: new Map([["a", { path_history: [{ ts: 100, x: 1 }, { ts: 200, x: 20 }] }]]),
    trimTrailEntries: (value) => value,
    parseTrailPointTimestamp: Number,
    seedTrackTrailFromHistory: (_key, _track, history) => { seededHistory = history; },
    buildTrackTrailCartesian: () => ({ x: 1 }),
    updateTrackTrailPositionsCache() {},
    Date,
  });
  vm.runInContext(section(air, "ensureTrackTrailVisible", "pushTrackTrailPointFromCartesian"), context);
  context.ensureTrackTrailVisible("a", {}, 0, 0, 0, 0);
  assert.equal(seededHistory, null);
  assert.equal(trails.get("a").length, 1);
});

test("full aircraft trail keeps only the deduplicated current flight session", () => {
  const context = vm.createContext({
    LIVE_TRACK_CURRENT_FLIGHT_GAP_MS: 45 * 60 * 1000,
    normalizeDegrees: (value) => ((value % 360) + 360) % 360,
    Map,
  });
  vm.runInContext(section(air, "normalizeLiveTrackHistoryPoint", "sanitizeSeedTrailEntries"), context);
  const hour = 60 * 60 * 1000;
  const base = Date.parse("2026-09-21T00:00:00.000Z");
  const points = context.selectCurrentFlightHistoryPoints([
    { lat: 1, lon: 1, ts: base + hour, on_ground: true },
    { lat: 2, lon: 2, ts: base + 2 * hour },
    { lat: 10, lon: 10, ts: base + 4 * hour, on_ground: true },
    { lat: 11, lon: 11, ts: base + 4 * hour + 60_000 },
    { lat: 11, lon: 11, ts: base + 4 * hour + 60_000 },
    { lat: 12, lon: 12, ts: base + 4 * hour + 120_000 },
    { lat: 100, lon: 12, ts: base + 4 * hour + 180_000 },
  ]);
  assert.equal(JSON.stringify(points.map((point) => [point.lat, point.lon])), "[[10,10],[11,11],[12,12]]");
});
