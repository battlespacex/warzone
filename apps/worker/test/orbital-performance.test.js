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
  const counts = { propagations: 0, sampledProperties: 0, orientationProperties: 0, matrix3: 0, matrix4: 0, quaternions: 0, cssReads: 0 };
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
  const tasks = new Map(), timers = new Set(), frames = new Map(); let timerId = 0, frameId = 0;
  const angles = { heading: 0, pitch: -150, roll: -15 };
  const context = vm.createContext({ Cesium, state, json2satrec, propagate: (...args) => { counts.propagations += 1; return propagate(...args); },
    gstime, eciToGeodetic, resolveSatelliteModelProfile, Date, Math, EARTH_RADIUS_M: 6371008.8,
    getSatelliteModelHeadingDeg: () => { counts.cssReads++; return angles.heading; }, getSatelliteModelPitchDeg: () => { counts.cssReads++; return angles.pitch; },
    getSatelliteModelRollDeg: () => { counts.cssReads++; return angles.roll; }, getSatelliteModelScale: value => value, getCssNumber: (_key, value) => value,
    formatUpper: value => String(value || "").toUpperCase(),
    clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
    colorFromCss: () => RealCesium.Color.WHITE, window: {}, document: { hidden: false },
    mergeConfig: noop, updateControlsOptions: noop, fetchOrbitalData: noop, stopStartupDemo: noop,
    registerAnimationTask: (key, fn) => tasks.set(key, fn), unregisterAnimationTask: key => tasks.delete(key), requestSharedSceneRender: noop,
    ensureHandler: noop, showOrbitalWidget: noop, ensureControls: noop, stopOrbitalFetch: noop,
    resetSatelliteFocusRuntime: () => { state.focusRuntime = {}; }, destroyHandler: noop,
    hideHoverGuide: noop, hideHoverCard: noop, hideOrbitalWidget: noop,
    getAssetFocusController: () => ({ isActiveAsset: () => false, registerTask: (key, fn) => tasks.set(key, fn), removeTask: key => tasks.delete(key) }),
    setInterval: () => { timers.add(++timerId); return timerId; }, clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++frameId,fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id), performance,
    SATELLITE_FOCUS_TASK_KEYS: { visual: "visual", camera: "camera" }, SATELLITE_FOCUS_VISUAL_HZ: 30, SATELLITE_FOCUS_CAMERA_HZ: 12,
    CONFIDENCE_RANK: { "confirmed-public-classification": 4, "high-confidence-public-association": 3, inferred: 2, unconfirmed: 1 },
    DEFAULT_CONFIG: { positionRefreshIntervalMs: 30000 }, updateFocusedSatelliteVisual: noop, updateSatelliteFocusCamera: noop,
  });
  const scratchStart = code.indexOf("const satelliteOrientationScratch =");
  if (scratchStart >= 0) vm.runInContext(code.slice(scratchStart, code.indexOf("\n};", scratchStart) + 3), context);
  for (const name of ["getOperationalSatelliteAngles", "orbitalMetrics", "orbitalInputBusy", "orbitalRenderTick", "bindOrbitalPerformance", "cleanText", "optionKey", "confidenceRank", "getMinimumConfidenceRank", "getPriorityScore", "matchesFilters", "chooseVisibleRecords",
    "createSatelliteModelOrientation", "createSatelliteModelOrientationProperty", "getSatrec", "propagateRecord",
    "createSampledPosition", "createPolylinePositions", "createFootprintCirclePositions", "makePointEntity", "removeEntity",
    "removeMissingEntities", "updateDefaultEntities", "addFocusEntity", "clearFocusEntities", "addOrbitContext",
    "getOrbitalRenderEntities", "purgeOrbitalRenderEntities", "stopTimers", "startTimers", "installSatelliteFocusTasks", "cleanupLayer", "setWarzoneMilSatsEnabled"]) {
    const start = code.indexOf(`function ${name}(`);
    if (start < 0) continue; // The same harness can profile the saved baseline source.
    const node = parseExpressionAt(code, start, { ecmaVersion: "latest" });
    vm.runInContext(code.slice(start, node.end), context);
  }
  for (const [name, counter] of [["createSampledPosition", "sampledProperties"], ["createSatelliteModelOrientationProperty", "orientationProperties"]]) {
    const original = context[name]; context[name] = (...args) => { counts[counter] += 1; return original(...args); };
  }
  context.updateVisibleRecords = () => { state.visibleRecords = context.chooseVisibleRecords(state.records); context.updateDefaultEntities(); };
  const flush = () => { let guard = 0; while (frames.size) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); if (++guard > 1000) throw new Error("Nonterminating orbital batch"); } };
  for (const name of ["setWarzoneMilSatsEnabled", "updateDefaultEntities"]) {
    const original = context[name];
    context[name] = (...args) => { const result = original(...args); if (state.records.length <= 64) flush(); return result; };
  }
  const resetCounts = () => Object.keys(counts).forEach(key => { counts[key] = 0; });
  return { context, state, counts, resetCounts, angles, tasks, timers, frames, flush };
}

test("the two station records use existing layer entities, labels and ON/OFF lifecycle without duplicates", () => {
  const h = harness(), base = h.state.records[0];
  const stations = [['25544','International Space Station (ISS)'],['48274','Chinese Space Station (Tiangong)']].map(([id,name])=>({
    ...base,id:'sat-'+id,noradId:id,name,omm:{...base.omm,NORAD_CAT_ID:Number(id)},
    classification:{...base.classification,association:'space-station',associationLabel:'Space Station',mission:'space-station',missionLabel:'Space Station'}
  }));
  h.state.records = [...h.state.records,...stations];h.context.setWarzoneMilSatsEnabled(true);
  for(const record of stations){
    const entity=h.state.entities.get(record.id)?.point;assert.ok(entity?.model);assert.equal(entity.__wzOrbitalId,record.id);
    assert.equal(entity.label.text.getValue(),record.name.toUpperCase());
    assert.ok(h.context.propagateRecord(record,new Date())?.position);
  }
  const count=h.state.entities.size;for(let i=0;i<5;i++)h.context.setWarzoneMilSatsEnabled(true);assert.equal(h.state.entities.size,count);
  h.context.setWarzoneMilSatsEnabled(false);assert.equal(h.state.entities.size,0);
  h.context.setWarzoneMilSatsEnabled(true);for(const record of stations)assert.ok(h.state.entities.has(record.id));
});

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
  assert.equal(h.tasks.size, 3); assert.equal(h.timers.size, 2);
});

test("missing orbital CSS uses configured defaults rather than silently converting empty strings to zero",()=>{
  let value='';const context=vm.createContext({getCssVar:()=>value});
  const start=source.indexOf('function getCssNumber('),node=parseExpressionAt(source,start,{ecmaVersion:'latest'});
  vm.runInContext(source.slice(start,node.end),context);
  assert.equal(context.getCssNumber('--missing-model-scale',170000),170000);
  value=' ';assert.equal(context.getCssNumber('--missing-minimum',18),18);
  value='0';assert.equal(context.getCssNumber('--intentional-zero',1),0);
});

test("operational GLB positions advance in UTC with a frozen viewer time and high orbit models are not distance-clipped", t => {
  const originalNow = RealCesium.JulianDate.now;
  let utc = RealCesium.JulianDate.fromIso8601("2026-11-11T00:00:00Z");
  RealCesium.JulianDate.now = result => RealCesium.JulianDate.clone(utc, result);
  t.after(() => { RealCesium.JulianDate.now = originalNow; });
  const h = harness();
  const position = h.context.createSampledPosition(h.state.records[0], new Date("2026-11-11T00:00:00Z"), 8, 14);
  const frozen = RealCesium.JulianDate.fromIso8601("2020-01-01T00:00:00Z");
  const first = position.getValue(frozen);
  assert.ok(first);
  utc = RealCesium.JulianDate.addSeconds(utc, 60, new RealCesium.JulianDate());
  const next = position.getValue(frozen);
  assert.ok(RealCesium.Cartesian3.distance(first, next) > 1000);
  const expected = h.context.propagateRecord(h.state.records[0], RealCesium.JulianDate.toDate(utc));
  assert.ok(RealCesium.Cartesian3.distance(next, expected.position) < 1000);
  const model = h.context.makePointEntity(h.state.records[0], position).model;
  assert.equal(model.distanceDisplayCondition.getValue().far, Number.MAX_VALUE);
});

test("orientation preserves exact math, live CSS angles and the public result-object contract", () => {
  const h = harness();
  const position = new RealCesium.ConstantPositionProperty(RealCesium.Cartesian3.fromDegrees(-96, 38, 820000));
  const property = h.context.createSatelliteModelOrientationProperty(position);
  for (const [lon, lat, height, heading] of [[-96, 38, 820000, 0], [110, -30, 35786000, 42], [0, 89, 400000, -12]]) {
    h.angles.heading = heading;
    h.state.orientationCache = null; // Explicit CSS refresh invalidates the operational cache.
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
  for (let cycle = 0; cycle < 10; cycle++) {
    h.context.setWarzoneMilSatsEnabled(true); assert.equal(h.state.viewer.entities.values.length, 45);
    const before = h.state.entities.get("fixture-0").point.position;
    h.context.updateDefaultEntities(); assert.equal(h.state.entities.get("fixture-0").point.position, before);
    before.__wzOrbitalSampleUntil = 0;
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
  h.state.filters.country = "no-matching-country"; h.context.updateVisibleRecords();
  assert.equal(h.state.entities.size, 0); assert.equal(h.tasks.has("warzone-operational-orbital-models"), false);
  h.state.filters.country = "all"; h.context.updateVisibleRecords();
  assert.equal(h.state.entities.size, 45); assert.equal(h.tasks.has("warzone-operational-orbital-models"), true);
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

test("dense 300-satellite population yields construction, reuses warm samples and cancels stale batches on OFF",t=>{
  const h=harness();
  const template=h.state.records[0];
  h.state.records=Array.from({length:300},(_,i)=>({...template,id:`dense-${i}`,noradId:91000+i,
    omm:{...template.omm,NORAD_CAT_ID:91000+i,RA_OF_ASC_NODE:i%360}}));
  h.state.config.maximumVisibleSatellites=300;
  h.context.setWarzoneMilSatsEnabled(true);
  assert.equal(h.state.entities.size,0);assert.equal(h.frames.size,1);
  let frames=0,maxChunkMs=0;
  while(h.frames.size){const [id,fn]=h.frames.entries().next().value;h.frames.delete(id);
    const before=h.state.entities.size,start=performance.now();fn();maxChunkMs=Math.max(maxChunkMs,performance.now()-start);
    assert.ok(h.state.entities.size-before<=8);frames++;assert.ok(frames<100);}
  assert.equal(h.state.entities.size,300);
  h.resetCounts();h.context.updateDefaultEntities();
  while(h.frames.size){const [id,fn]=h.frames.entries().next().value;h.frames.delete(id);fn();}
  assert.equal(h.counts.propagations,0);assert.equal(h.counts.sampledProperties,0);assert.equal(h.counts.orientationProperties,0);
  h.context.updateDefaultEntities();assert.equal(h.frames.size,1);
  const stale=h.frames.values().next().value;
  h.context.setWarzoneMilSatsEnabled(false);
  assert.equal(h.frames.size,0);assert.equal(h.state.entities.size,0);assert.equal(h.state.viewer.entities.values.length,0);
  assert.equal(h.tasks.size,0);assert.equal(h.timers.size,0);
  h.context.setWarzoneMilSatsEnabled(true);stale();
  assert.equal(h.state.entities.size,0,'a stale batch cannot populate a newly enabled generation');
  h.context.setWarzoneMilSatsEnabled(false);assert.equal(h.frames.size,0);
  t.diagnostic(JSON.stringify({fixtureSatellites:300,constructionFrames:frames,maxNodeChunkMs:maxChunkMs,warmPropagations:0,
    note:'Node CPU fixture, not browser frame time or GPU memory'}));
});

test("camera input defers background construction without losing any assets and removes owned input/render listeners", () => {
  const h=harness(), template=h.state.records[0];
  h.state.records=Array.from({length:80},(_,i)=>({...template,id:`input-${i}`,noradId:92000+i,omm:{...template.omm,NORAD_CAT_ID:92000+i}}));
  h.state.config.maximumVisibleSatellites=80;
  h.context.window=new EventTarget(); h.state.viewer.scene.canvas=new EventTarget();
  h.state.viewer.scene.postRender=new RealCesium.Event();
  h.context.setWarzoneMilSatsEnabled(true);
  h.state.viewer.scene.canvas.dispatchEvent(new Event('pointerdown'));
  const [id,fn]=h.frames.entries().next().value;h.frames.delete(id);fn();
  assert.equal(h.state.entities.size,0);assert.equal(h.state.performance.deferredChunks,1);
  h.context.window.dispatchEvent(new Event('pointerup'));h.state.inputUntil=0;
  h.flush();assert.equal(h.state.entities.size,80);
  assert.equal(h.state.viewer.scene.postRender.numberOfListeners,1);
  h.context.setWarzoneMilSatsEnabled(false);
  assert.equal(h.state.viewer.scene.postRender.numberOfListeners,0);
  h.state.viewer.scene.canvas.dispatchEvent(new Event('pointerdown'));
  assert.equal(h.state.inputDown,false);assert.equal(h.frames.size,0);
});

test("operational orientation CSS cache expires and explicit invalidation preserves current angles",()=>{
  if(!source.includes('function getOperationalSatelliteAngles(')) return;
  let at=0,heading=1,reads=0;const state={};
  const c=vm.createContext({state,performance:{now:()=>at},getSatelliteModelHeadingDeg:()=>{reads++;return heading;},
    getSatelliteModelPitchDeg:()=>-150,getSatelliteModelRollDeg:()=>-15});
  const start=source.indexOf('function getOperationalSatelliteAngles('),node=parseExpressionAt(source,start,{ecmaVersion:'latest'});
  vm.runInContext(source.slice(start,node.end),c);
  assert.equal(c.getOperationalSatelliteAngles().heading,1);
  heading=2;for(let i=0;i<10000;i++)c.getOperationalSatelliteAngles();assert.equal(reads,1);
  at=251;assert.equal(c.getOperationalSatelliteAngles().heading,2);assert.equal(reads,2);
  heading=3;state.orientationCache=null;assert.equal(c.getOperationalSatelliteAngles().heading,3);
});

test("new API objects with unchanged orbital elements retain samples; changed elements rebuild exactly one satellite",()=>{
  const h=harness();h.context.setWarzoneMilSatsEnabled(true);
  const positions=[...h.state.entities.values()].map(entry=>entry.point.position);
  h.state.records=h.state.records.map(record=>({...record,omm:{...record.omm}}));
  h.resetCounts();h.context.updateVisibleRecords();
  assert.equal(h.counts.propagations,0);assert.equal(h.counts.sampledProperties,0);
  [...h.state.entities.values()].forEach((entry,i)=>assert.equal(entry.point.position,positions[i]));
  h.state.records=h.state.records.map((record,i)=>i?record:{...record,omm:{...record.omm,MEAN_ANOMALY:25}});
  h.context.updateVisibleRecords();assert.equal(h.counts.sampledProperties,1);assert.ok(h.counts.propagations>0);
  assert.notEqual(h.state.entities.get('fixture-0').point.position,positions[0]);
});

test("focus telemetry updates reuse detail rows and do not restart arrival animation or scrolling",()=>{
  let writes=0,arrivals=0,scrolls=0,offsets=0,altitude=600;
  const grid={children:[],appendChild(span){span.parentNode=this;this.children.push(span);writes++;}};
  const card={dataset:{},hidden:true,querySelector:selector=>selector.endsWith('details-grid')?grid:null,
    classList:{remove(){},add(){arrivals++;}},get offsetWidth(){offsets++;return 100;},closest:()=>({scrollTo(){scrolls++;}})};
  const c=vm.createContext({ensureFocusCard:()=>card,propagateRecord:()=>({altitudeKm:altitude,speedKmS:7.5}),
    resolveSatelliteMonitoringRegion:()=>({label:'Fixture'}),formatNumber:(n)=>String(n||0),formatAge:()=>'',
    cleanText:(v,f)=>String(v??f),showOrbitalWidget(){},state:{data:{}},formatUpper:v=>String(v).toUpperCase(),
    document:{createElement:()=>({dataset:{},textContent:''})},window:{matchMedia:()=>({matches:false}),requestAnimationFrame:fn=>fn()}});
  const start=source.indexOf('function showFocusCard('),node=parseExpressionAt(source,start,{ecmaVersion:'latest'});
  vm.runInContext(source.slice(start,node.end),c);
  const record={id:'fixture',name:'Fixture',orbital:{}};c.showFocusCard(record);const rows=[...grid.children];
  altitude=601;c.showFocusCard(record);
  assert.equal(writes,18);assert.equal(arrivals,1);assert.equal(offsets,1);assert.equal(scrolls,1);
  assert.equal(grid.children[9].textContent,'601 KM');rows.forEach((row,i)=>assert.equal(grid.children[i],row));
});
