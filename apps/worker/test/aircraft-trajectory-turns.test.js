import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
function section(name, next) {
  return air.slice(air.indexOf(`function ${name}(`), air.indexOf(`function ${next}(`));
}

test("recorded left, right and circular turns retain each accepted waypoint", () => {
  const context = vm.createContext({
    getHistoryPointDistanceMeters: (a, b) => Math.hypot(a.lon - b.lon, a.lat - b.lat) * 1000,
    isImplausibleTrackMotion: (distance, elapsed) => distance > 5000 && elapsed < 1000,
  });
  vm.runInContext(section("sanitizeFocusedRouteHistoryPoints", "appendTrackHistoryPoint"), context);
  const recorded = [
    { lon: 0, lat: 0, ts: 1000 }, { lon: 1, lat: 0, ts: 2000 },
    { lon: 1, lat: 1, ts: 3000 }, { lon: 0, lat: 1, ts: 4000 },
    { lon: 0, lat: 0, ts: 5000 },
  ];
  const result = context.sanitizeFocusedRouteHistoryPoints(recorded);
  assert.deepEqual(Array.from(result), recorded);
  assert.equal(result[1], recorded[1]);
  assert.equal(result[2], recorded[2]);
});

test("trail cache renders observed vertices without moving older segments", () => {
  const cache = new Map();
  const context = vm.createContext({ __liveTrackTrailPositionsCache: cache });
  vm.runInContext(section("updateTrackTrailPositionsCache", "getLiveTrackTrailSmoothingStrength"), context);
  const first = [{ position: { x: 0 }, ts: 1 }, { position: { x: 1 }, ts: 2 }];
  const initial = context.updateTrackTrailPositionsCache("a", first);
  assert.equal(context.updateTrackTrailPositionsCache("a", first), initial);
  const turn = [...first, { position: { x: 1, y: 1 }, ts: 3 }];
  const updated = context.updateTrackTrailPositionsCache("a", turn);
  assert.equal(updated.length, 3);
  assert.equal(updated[0], first[0].position);
  assert.equal(updated[1], first[1].position);
  assert.equal(updated[2], turn[2].position);
});

test("validated turns bank in opposite directions with subtype limits; straight and stale updates level", () => {
  const visualState = new Map();
  const normalizeDegrees = (value) => ((value % 360) + 360) % 360;
  const context = vm.createContext({
    __liveTrackVisualState: visualState,
    __liveTrackLastPositions: new Map(),
    LIVE_TRACK_HEADING_SPIKE_MIN_DEG: 90,
    LIVE_TRACK_HEADING_CONFIRMATION_DEG: 20,
    LIVE_TRACK_MIN_PREDICTION_SPEED_KTS: 15,
    normalizeDegrees,
    getShortestAngleDeltaDeg: (a, b) => ((b - a + 540) % 360) - 180,
    getCssNumber: (name, fallback) => ({
      "--warzone-live-aircraft-model-dynamic-bank-enabled": 1,
      "--warzone-live-aircraft-model-bank-factor": -1.8,
      "--warzone-live-aircraft-model-bank-smoothing": 1,
      "--warzone-live-aircraft-model-bank-return-smoothing": 1,
    }[name] ?? fallback),
    getSubtypeCssNumber: (_name, subtype) => subtype === "fighter" ? 60 : 20,
    resolveTrackSubtype: (track) => track.subtype,
    getTrackSourceTimestamp: (track) => track.ts,
    getTrackMetadata: () => ({}),
    getTrackDerivedBearing: () => null,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
  vm.runInContext(section("getTrackVisualState", "removeLiveTrackTrailRenderState"), context);
  const sample = (heading, ts, subtype = "fighter") => context.getTrackAttitude(
    { track_key: "a", speed_kts: 300, ts, subtype }, heading
  ).rollDeg;
  assert.equal(sample(0, 1000), 0);
  const right = sample(15, 6000);
  assert.ok(right < 0 && right >= -60);
  const left = sample(0, 11000);
  assert.ok(left > 0 && left <= 60);
  assert.equal(sample(0, 16000), 0);
  assert.equal(sample(20, 100000, "transport"), 0);
  assert.ok(Math.abs(sample(35, 105000, "transport")) <= 20);
});
