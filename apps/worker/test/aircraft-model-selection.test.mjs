import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
const source = readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const context = vm.createContext({ __liveAircraftFailedModelUris: new Set(), __liveAircraftModelResourceCache: new Map(),
  LIVE_AIRCRAFT_MODEL_BASE_PATH: "/assets/images/models/air", LIVE_AIRCRAFT_MODEL_DEFAULT_CODE: "Fighter-F16",
  LIVE_AIRCRAFT_ASSET_KEY_BY_ICON_CODE: {}, getTrackMetadata: (track) => track.metadata || {},
  isTrackInFocusVisualContext: () => false, resolveTrackSubtype: (track) => track.subcategory || "aircraft",
  normalizeAircraftCategoryRole: (value) => value,
  Cesium: { Resource: class { constructor(options) { Object.assign(this, options); } } } });
function declaration(name, endMarker) {
  const start = source.indexOf(`const ${name} =`);
  assert.ok(start >= 0);
  const end = source.indexOf(endMarker, start);
  assert.ok(end >= 0);
  vm.runInContext(source.slice(start, end + endMarker.length), context);
}
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  vm.runInContext(source.slice(start, source.indexOf("\n}", start) + 2), context);
}
declaration("LIVE_AIRCRAFT_ASSET_FILES", "\n});");
declaration("LIVE_AIRCRAFT_EXACT_MODEL_RULES", "\n]);");
declaration("LIVE_AIRCRAFT_GLOBAL_DEFAULTS", "\n});");
for (const name of ["normalizeAircraftIconText", "normalizeAircraftAssetKey", "getAircraftAssetFile", "hasAnyPattern",
  "buildExactAircraftModelHaystack", "resolveExactAircraftModelAssetKey", "getLiveAircraftModelUriForCode",
  "isLiveAircraftModelCodeAvailable", "resolveFocusedAircraftFallbackModelCode", "resolveLiveTrackModelCode",
  "resolveLiveTrackModelUri", "resolveLiveTrackModelResource"]) fn(name);
const globalHawkUri = "/assets/images/models/air/Drone-Globalhawk.glb";
function expectModel(track, code, uri) {
  assert.equal(context.resolveLiveTrackModelCode(track), code);
  assert.equal(context.resolveLiveTrackModelUri(track), uri);
  assert.equal(context.resolveLiveTrackModelResource(track, code).url, uri);
}
test("MQ-4C identity outranks generic fighter hints", () => {
  expectModel({ model_name: "Northrop Grumman MQ-4C Triton BAMS", subcategory: "isr", asset_key: "Fighter-F16" }, "Drone-Globalhawk", globalHawkUri);
  expectModel({ title: "Northrop Grumman MQ-4C Triton BAMS (United States Navy)", asset_key: "Fighter-F16" }, "Drone-Globalhawk", globalHawkUri);
  expectModel({ metadata: { title: "Northrop Grumman MQ4C Triton BAMS" } }, "Drone-Globalhawk", globalHawkUri);
});
test("neighboring dedicated types remain correctly mapped", () => {
  expectModel({ model_name: "Northrop Grumman RQ-4B Global Hawk" }, "Drone-Globalhawk", globalHawkUri);
  expectModel({ model_name: "General Atomics MQ-9 Reaper" }, "Drone-MQ9", "/assets/images/models/air/Drone-MQ9.glb");
  expectModel({ model_name: "F/A-18 Super Hornet" }, "Fighter-F18", "/assets/images/models/air/Fighter-F18.glb");
  assert.equal(context.resolveLiveTrackModelCode({ model_name: "MQ-1 Predator", subcategory: "uav" }), "");
  assert.equal(context.resolveLiveTrackModelCode({ model_name: "Unrelated UAV", subcategory: "uav" }), "");
});
test("failed exact GLB cannot fall back to a fighter", () => {
  context.__liveAircraftFailedModelUris.add(globalHawkUri);
  try {
    assert.equal(context.resolveLiveTrackModelCode({ model_name: "MQ-4C Triton", asset_key: "Fighter-F16" }), "");
    assert.equal(context.resolveLiveTrackModelUri({ model_name: "MQ-4C Triton" }), "");
  } finally { context.__liveAircraftFailedModelUris.delete(globalHawkUri); }
});
test("resolved URL names an existing GLB 2 asset with exact casing", () => {
  const asset = fileURLToPath(new URL("../../../dev/assets/images/models/air/" + path.basename(globalHawkUri), import.meta.url));
  const bytes = readFileSync(asset);
  assert.equal(bytes.toString("ascii", 0, 4), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
});
