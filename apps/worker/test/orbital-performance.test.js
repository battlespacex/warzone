import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { parseExpressionAt } from "acorn";
import * as RealCesium from "cesium";
import { json2satrec } from "../../../node_modules/satellite.js/dist/io.js";
import { propagate } from "../../../node_modules/satellite.js/dist/propagation/propagate.js";
import { gstime } from "../../../node_modules/satellite.js/dist/propagation/gstime.js";
import { eciToGeodetic } from "../../../node_modules/satellite.js/dist/transforms.js";
import { resolveSatelliteModelProfile } from "../../../dev/assets/js/warzone-satellite-models.js";

const source = readFileSync(process.env.STRATOPS_ORBITAL_SOURCE || new URL("../../../dev/assets/js/warzone-mil-sats.js", import.meta.url), "utf8");
const noop = () => {};
function harness(code = source) {
  const counts = { propagations: 0, sampledProperties: 0, orientationProperties: 0, matrix3: 0, matrix4: 0, quaternions: 0 };
  const counted = (Type, counter) => new Proxy(Type, {
    construct(target, args) { counts[counter] += 1; return Reflect.construct(target, args); },
    get(target, key) {
      if (key === "fromHeadingPitchRoll") return (angles, result) => {
        if (!result) counts[counter] += 1;
        return target.fromHeadingPitchRoll(angles, result);
      };
      return Reflect.get(target, key);
    },
  });
  const Cesium = { ...RealCesium,
    Matrix3: counted(RealCesium.Matrix3, "matrix3"),
    Transforms: { ...RealCesium.Transforms, eastNorthUpToFixedFrame: (position, ellipsoid, result) => {
      if (!result) counts.matrix4 += 1;
      return RealCesium.Transforms.eastNorthUpToFixedFrame(position, ellipsoid, result);
    } },
    Quaternion: { ...RealCesium.Quaternion, fromRotationMatrix: (matrix, result) => {
      if (!result) counts.quaternions += 1;
      return RealCesium.Quaternion.fromRotationMatrix(matrix, result);
    } },
  };
  // Synthetic OMM fixtures are used only in this Node test, never as application observations.
  const records = Array.from({ length: 45 }, (_, i) => ({ id: `fixture-${i}`, noradId: 90000 + i, name: `Fixture ${i}`,
    country: i % 2 ? "US" : "FR", classification: { confidence: "unconfirmed" },
    omm: { OBJECT_NAME: `Fixture ${i}`, NORAD_CAT_ID: 90000 + i, EPOCH: "2026-11-11T00:00:00.000000",
      MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005, INCLINATION: 51.64, RA_OF_ASC_NODE: i * 8,
      ARG_OF_PERICENTER: 100, MEAN_ANOMALY: 20, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U",
      ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.00001, MEAN_MOTION_DDOT: 0 },
  }));
  const state = { enabled: false, viewer: { entities: new RealCesium.EntityCollection(), scene: { requestRender: noop } },
    config: { enabled: true, maximumVisibleSatellites: 160, sampleIntervalSeconds: 120, defaultSamplePastMinutes: 8,
      defaultSampleFutureMinutes: 14, minimumClassificationConfidence: "unconfirmed", positionRefreshIntervalMs: 30000,
      pastOrbitMinutes: 45, futureOrbitMinutes: 60, showOrbitPath: true, showGroundTrack: true, showNadirLine: true, showTheoreticalFootprint: true },
    records, visibleRecords: [], entities: new Map(), satrecs: new Map(), focusEntities: [], selectedId: "",
    filters: { association: "all", country: "all", mission: "all", orbit: "all" },
    focusRuntime: {}, configKey: "", fetchController: null,
  };
  const tasks = new Map(), timers = new Set(); let timerId = 0;
  const angles = { heading: 0, pitch: -150, roll: -15 };
  const context = vm.createContext({ Cesium, state, json2satrec, propagate: (...args) => { counts.propagations += 1; return propagate(...args); },
    gstime, eciToGeodetic, resolveSatelliteModelProfile, Date, Math, EARTH_RADIUS_M: 6371008.8,
    getSatelliteModelHeadingDeg: () => angles.heading, getSatelliteModelPitchDeg: () => angles.pitch,
    getSatelliteModelRollDeg: () => angles.roll, getSatelliteModelScale: value => value, getCssNumber: (_key, value) => value,
    formatUpper: value => String(value || "").toUpperCase(),
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    colorFromCss: () => RealCesium.Color.WHITE, window: {}, document: { hidden: false },
    mergeConfig: noop, updateControlsOptions: noop, fetchOrbitalData: noop, stopStartupDemo: noop,
    ensureHandler: noop, showOrbitalWidget: noop, ensureControls: noop, stopOrbitalFetch: noop,
    resetSatelliteFocusRuntime: () => { state.focusRuntime = {}; }, destroyHandler: noop,
    hideHoverGuide: noop, hideHoverCard: noop, hideOrbitalWidget: noop,
    getAssetFocusController: () => ({ isActiveAsset: () => false, registerTask: (key, fn) => tasks.set(key, fn), removeTask: key => tasks.delete(key) }),
    setInterval: () => { timers.add(++timerId); return timerId; }, clearInterval: id => timers.delete(id),
    SATELLITE_FOCUS_TASK_KEYS: { visual: "visual", camera: "camera" }, SATELLITE_FOCUS_VISUAL_HZ: 30, SATELLITE_FOCUS_CAMERA_HZ: 12,
    CONFIDENCE_RANK: { "confirmed-public-classification": 4, "high-confidence-public-association": 3, inferred: 2, unconfirmed: 1 },
    DEFAULT_CONFIG: { positionRefreshIntervalMs: 30000 }, updateFocusedSatelliteVisual: noop, updateSatelliteFocusCamera: noop,
  });
  const scratchStart = code.indexOf("const satelliteOrientationScratch =");
  if (scratchStart >= 0) vm.runInContext(code.slice(scratchStart, code.indexOf("\n};", scratchStart) + 3), context);
  for (const name of ["cleanText", "optionKey", "confidenceRank", "getMinimumConfidenceRank", "getPriorityScore", "matchesFilters", "chooseVisibleRecords",
    "createSatelliteModelOrientation", "createSatelliteModelOrientationProperty", "getSatrec", "propagateRecord",
    "createSampledPosition", "createPolylinePositions", "createFootprintCirclePositions", "makePointEntity", "removeEntity",
    "removeMissingEntities", "updateDefaultEntities", "addFocusEntity", "clearFocusEntities", "addOrbitContext",
    "getOrbitalRenderEntities", "purgeOrbitalRenderEntities", "stopTimers", "startTimers", "installSatelliteFocusTasks", "cleanupLayer", "setWarzoneMilSatsEnabled"]) {
    const start = code.indexOf(`function ${name}(`);
    const node = parseExpressionAt(code, start, { ecmaVersion: "latest" });
    vm.runInContext(code.slice(start, node.end), context);
  }
  for (const [name, counter] of [["createSampledPosition", "sampledProperties"], ["createSatelliteModelOrientationProperty", "orientationProperties"]]) {
    const original = context[name]; context[name] = (...args) => { counts[counter] += 1; return original(...args); };
  }
  context.updateVisibleRecords = () => { state.visibleRecords = context.chooseVisibleRecords(state.records); context.updateDefaultEntities(); };
  const resetCounts = () => Object.keys(counts).forEach(key => { counts[key] = 0; });
  return { context, state, counts, resetCounts, angles, tasks, timers };
}

test("repeated orbital ON synchronization retains every model and sampled property", () => {
  const h = harness(); h.context.setWarzoneMilSatsEnabled(true);
  assert.equal(h.state.entities.size, 45);
  const properties = [...h.state.entities.values()].map(entry => [entry.point.position, entry.point.orientation, entry.point.model.uri.getValue()]);
  h.resetCounts();
  for (let i = 0; i < 20; i++) h.context.setWarzoneMilSatsEnabled(true);
  assert.equal(h.counts.sampledProperties, 0);
  assert.equal(h.counts.propagations, 0);
  [...h.state.entities.values()].forEach((entry, i) => {
    assert.equal(entry.point.position, properties[i][0]); assert.equal(entry.point.orientation, properties[i][1]);
    assert.equal(entry.point.model.uri.getValue(), properties[i][2]);
  });
  assert.equal(h.tasks.size, 2); assert.equal(h.timers.size, 2);
});

test("orientation preserves exact math, live CSS angles and the public result-object contract", () => {
  const h = harness();
  const position = new RealCesium.ConstantPositionProperty(RealCesium.Cartesian3.fromDegrees(-96, 38, 820000));
  const property = h.context.createSatelliteModelOrientationProperty(position);
  for (const [lon, lat, height, heading] of [[-96, 38, 820000, 0], [110, -30, 35786000, 42], [0, 89, 400000, -12]]) {
    h.angles.heading = heading;
    const location = RealCesium.Cartesian3.fromDegrees(lon, lat, height); position.setValue(location);
    const expected = RealCesium.Quaternion.fromRotationMatrix(RealCesium.Matrix3.multiply(
      RealCesium.Matrix4.getMatrix3(RealCesium.Transforms.eastNorthUpToFixedFrame(location), new RealCesium.Matrix3()),
      RealCesium.Matrix3.fromHeadingPitchRoll(new RealCesium.HeadingPitchRoll(...[heading, -150, -15].map(RealCesium.Math.toRadians))),
      new RealCesium.Matrix3()));
    const result = new RealCesium.Quaternion(); h.resetCounts();
    assert.equal(property.getValue(RealCesium.JulianDate.now(), result), result);
    assert.ok(RealCesium.Quaternion.equalsEpsilon(result, expected, 1e-14));
    assert.equal(h.counts.matrix3 + h.counts.matrix4 + h.counts.quaternions, 0);
    const first = property.getValue(); const snapshot = RealCesium.Quaternion.clone(first);
    const second = property.getValue(); assert.notEqual(first, second); assert.deepEqual(first, snapshot);
  }
  position.setValue(undefined);
  assert.equal(property.getValue(RealCesium.JulianDate.now(), new RealCesium.Quaternion()), undefined);
});

test("timed sampling stays fresh and repeated focus geometry / OFF cycles release owned entities and tasks", () => {
  const h = harness();
  for (let cycle = 0; cycle < 5; cycle++) {
    h.context.setWarzoneMilSatsEnabled(true); assert.equal(h.state.viewer.entities.values.length, 45);
    const before = h.state.entities.get("fixture-0").point.position;
    h.context.updateDefaultEntities(); assert.notEqual(h.state.entities.get("fixture-0").point.position, before);
    const now = new Date("2026-11-11T00:00:00Z"); const record = h.state.records[0];
    const point = h.context.propagateRecord(record, now);
    h.context.addOrbitContext(record, now, point.position);
    assert.equal(h.state.focusEntities.length, 9);
    assert.equal(h.state.viewer.entities.getById("wz-orbital-ground-track-90000").polyline.clampToGround.getValue(), true);
    assert.equal(h.state.viewer.entities.getById("wz-orbital-footprint-outline-90000").polyline.positions.getValue().length, 97);
    h.context.clearFocusEntities(); assert.equal(h.state.viewer.entities.values.length, 45);
    h.context.setWarzoneMilSatsEnabled(false);
    assert.equal(h.state.viewer.entities.values.length, 0); assert.equal(h.state.satrecs.size, 0);
    assert.equal(h.tasks.size, 0); assert.equal(h.timers.size, 0);
  }
});

test("filters retain the authorized records and restore all 45 GLB model entities", () => {
  const h = harness(); h.context.setWarzoneMilSatsEnabled(true);
  h.state.filters.country = "us"; h.context.updateVisibleRecords();
  assert.equal(h.state.entities.size, 22); assert.equal(h.state.records.length, 45);
  h.state.filters.country = "all"; h.context.updateVisibleRecords();
  assert.equal(h.state.entities.size, 45);
  for (const entry of h.state.entities.values()) {
    assert.match(entry.point.model.uri.getValue(), /\.glb$/);
    assert.equal(entry.point.model.minimumPixelSize.getValue(), 18);
  }
});

test("profile pure orbital work with 45 fixtures; no browser memory or FPS claim", () => {
  const h = harness();
  let start = performance.now(); h.context.setWarzoneMilSatsEnabled(true);
  const activation = { ms: performance.now() - start, ...h.counts };
  h.resetCounts(); start = performance.now();
  for (let i = 0; i < 20; i++) h.context.setWarzoneMilSatsEnabled(true);
  const repeatedOn = { calls: 20, ms: performance.now() - start, ...h.counts };
  const time = RealCesium.JulianDate.now(), result = new RealCesium.Quaternion();
  const properties = [...h.state.entities.values()].map(entry => entry.point.orientation);
  h.resetCounts(); start = performance.now();
  for (let i = 0; i < 300; i++) properties.forEach(property => property.getValue(time, result));
  const orientations = { evaluations: 13500, ms: performance.now() - start, ...h.counts };
  const assets = readdirSync(new URL("../../../dev/assets/images/models/space/", import.meta.url)).filter(file => file.endsWith(".glb")).map(file => {
    const bytes = readFileSync(new URL(`../../../dev/assets/images/models/space/${file}`, import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    return { file, bytes: bytes.length, meshes: gltf.meshes?.length || 0, images: gltf.images?.length || 0, textures: gltf.textures?.length || 0 };
  });
  if (process.env.STRATOPS_ORBITAL_PROFILE_OUTPUT) writeFileSync(process.env.STRATOPS_ORBITAL_PROFILE_OUTPUT,
    JSON.stringify({ note: "Node CPU/math fixtures; not Chrome memory, GPU resources, FPS or network measurements", activation, repeatedOn, orientations, assets }, null, 2));
});
