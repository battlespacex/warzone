import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const readSource = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("aircraft classification rejects naval identities without rejecting explicit aircraft", async () => {
  const source = await readSource("dev/assets/js/essential.js");
  const start = source.indexOf("function isClearlyNavalContact(");
  const end = source.indexOf("\nfunction isEventInLens(", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    getEventMetadata: (event) => event.metadata || {},
  });
  vm.runInContext(source.slice(start, end), context);

  assert.equal(context.isClearlyNavalContact({ title: "US WARSHIP 14" }), true);
  assert.equal(context.isClearlyNavalContact({ metadata: { mmsi: "123456789" } }), true);
  assert.equal(context.isClearlyNavalContact({
    track_type: "aircraft",
    source_name: "ADS-B",
    metadata: { vessel_name: "associated carrier" },
  }), false);
});

test("tracker filters are shared by widget and Cesium populations", async () => {
  const essential = await readSource("dev/assets/js/essential.js");
  const aircraft = await readSource("dev/assets/js/warzone-live-airforce.js");
  const naval = await readSource("dev/assets/js/warzone-live-naval.js");

  assert.match(essential, /setLiveTrackVisibilityFilter\(\(track\) =>/);
  assert.match(essential, /setNavalVisibilityFilter\(\(vessel\) =>/);
  assert.match(aircraft, /matchesLiveTrackVisibilityFilter/);
  assert.match(naval, /matchesNavalVisibilityFilter/);
  assert.match(naval, /scheduleNavalRenderReconcile/);
  assert.match(essential, /items = \[selectedTrack, \.\.\.items\]/);
});

test("naval country filter and global all-layer controls are absent", async () => {
  const widgets = await readSource("dev/partials/widgets.html");
  const layers = await readSource("dev/assets/js/warzone-layers.js");

  assert.doesNotMatch(widgets, /wz-naval-filter-country/);
  assert.doesNotMatch(layers, /id="wz-layers-all-(?:on|off)"/);
  assert.match(layers, /mode === "tracker"/);
  assert.match(layers, /getTrackerIncompatibleActiveLayerIds/);
});

test("focused aircraft and naval sizing has a deterministic 1921-2559 fallback", async () => {
  const css = await readSource("dev/assets/css/root.css");
  const aircraft = await readSource("dev/assets/js/warzone-live-airforce.js");
  const naval = await readSource("dev/assets/js/warzone-live-naval.js");

  assert.match(css, /--warzone-live-aircraft-model-focused-size:\s*3;/);
  assert.match(css, /--warzone-live-naval-model-focused-size:\s*6\.5;/);
  assert.match(aircraft, /getAircraftFocusedCssNumber\("--warzone-live-aircraft-model-focused-size"/);
  assert.match(naval, /getNavalFocusedCssNumber\("--warzone-live-naval-model-focused-size"/);
});
