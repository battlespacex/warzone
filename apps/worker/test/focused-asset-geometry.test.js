import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const globe = fs.readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
function section(source, name, next) {
  return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
}

test("naval CTR clamps outer ring to 15 km and builds two inner rings with 5% thicker strokes", () => {
  const state = {};
  class Cartesian3 { constructor(x, y, z) { Object.assign(this, { x, y, z }); } }
  class PolylineCollection { constructor() { this.lines = []; } add(line) { this.lines.push(line); } }
  const context = vm.createContext({
    Cesium: { Cartesian3, PolylineCollection, Material: { fromType: (_, options) => options } },
    getContourOverlayState: () => state, getContourFocusProfile: () => "naval",
    boolVar: () => true, numberVar: (key, fallback) => ({ "--warzone-live-naval-contour-grid-radius": 50000, "--warzone-contour-grid-ring-width": 1.5 }[key] ?? fallback),
    colorFromCssVar: () => ({ withAlpha: (alpha) => alpha }), cssVar: (_, fallback) => fallback,
    clamp01: (value) => value, lerp: (a, b, t) => a + (b - a) * t, smoothContourFade: (t) => t,
    chooseOperationalGridIntervalMeters: () => 5000, updateContourGridPrimitiveCenter() {}, raiseContourGridPrimitive() {},
    addContourGridRing(collection, radius, options) { collection.lines.push({ radius, ...options }); },
  });
  vm.runInContext(section(globe, "ensureContourGridPrimitive", "splitContourPolylineByRadius"), context);
  context.ensureContourGridPrimitive({ scene: { primitives: { add: (value) => value } } });
  const rings = state.gridPrimitive.lines.filter((line) => line.radius);
  assert.deepEqual(rings.map((line) => line.radius), [5000, 10000, 15000]);
  assert.ok(Math.abs(rings[2].width - 1.575) < 1e-10);
  assert.ok(Math.abs(rings[0].width - 1.5 * 0.86 * 1.05) < 1e-10);
});

test("aircraft orientation prefers valid telemetry including north over jitter-derived bearings", () => {
  const context = vm.createContext({
    __liveTrackLastPositions: new Map([["a", { lon: 1, lat: 1 }]]),
    normalizeDegrees: (value) => ((value % 360) + 360) % 360,
    getHeadingDegreesFromPoints: () => 270,
  });
  vm.runInContext(section(air, "getTrackResolvedHeading", "getTrackVisualState"), context);
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: 0 }), 0);
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: 45 }), 45);
  assert.equal(context.getTrackResolvedHeading({ track_key: "a", lon: 2, lat: 1, heading_deg: null }), 270);
});

test("focused trail retains historical coordinates while only the live head moves", () => {
  const track = { path_history: [{ ts: 100, x: 1 }, { ts: 200, x: 2 }, { ts: 300, x: 3 }] };
  const entity = { __liveTrackMotionState: { sourceTimestamp: 300 }, head: { x: 2.5 } };
  const context = vm.createContext({
    window: { __warzoneViewer: { entities: { getById: () => entity } } },
    __liveTrackRegistry: new Map([["a", track]]), pruneHistoryPoints: (value) => value,
    sanitizeFocusedRouteHistoryPoints: (value) => value, buildReplayPositions: (points) => points.map(({ x }) => ({ x })),
    getPositionCartesian: (value) => value.head, getCartesianDistanceMeters: () => 10,
    isImplausibleTrackMotion: () => false, Cesium: { Cartesian3: { clone: (value) => ({ ...value }) } },
  });
  vm.runInContext(section(air, "getFocusedRoutePositions", "smoothFocusedRoutePositions"), context);
  const first = context.getFocusedRoutePositions("a");
  entity.head.x = 2.8;
  const second = context.getFocusedRoutePositions("a");
  assert.equal(JSON.stringify(first), '[{"x":1},{"x":2},{"x":2.5}]');
  assert.equal(JSON.stringify(second), '[{"x":1},{"x":2},{"x":2.8}]');
});
