import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  ZOOM_UX_STATES, getZoomUxState, selectActiveClusterGroup, buildLocalActivityStackModel,
} from "../../../dev/assets/js/warzone-map-zoom-ux.js";

// Execute the actual render-time group/model decision with real prioritization.
const source = await readFile(new URL("../../../dev/assets/js/warzone-hotspots.js", import.meta.url), "utf8");
const start = source.indexOf("        const activeGroup =", source.indexOf("const visible = stackVisible"));
const end = source.indexOf("        const clusterNumbers =", start);
assert.ok(start >= 0 && end > start);
const decision = new vm.Script(`${source.slice(start, end)}\n({ activeGroup, stackModel });`);

function evaluate(visible, height, activityStack = { groupIds: [] }) {
  return decision.runInNewContext({
    visible, zoomState: getZoomUxState(height), ZOOM_UX_STATES,
    selectActiveClusterGroup, buildLocalActivityStackModel, activityStack,
    overlayRect: { width: 1280, height: 800 },
    cssLengthToPx: (_name, fallback) => fallback,
    cssNumber: (_name, fallback) => fallback,
  });
}

function cluster(country, region, x = 640) {
  const events = [1, 2].map(id => ({
    id: `${country}-${id}`, event_country: country, event_region: region,
    category: "strike", lat: 26, lon: 50, location_precision: "LOCAL",
    occurred_at: new Date().toISOString(),
  }));
  return { id: country, cluster_id: country, screen: { x, y: 400 },
    weighted_activity_score: 5, event_count: 2, _clusterEvents: events };
}

test("regional summaries exist immediately and survive zoom-band transitions for every region", () => {
  for (const [country, region] of [["Saudi Arabia", "Eastern Province"], ["Ukraine", "Donetsk"], ["Taiwan", "Taipei"]]) {
    const state = { groupIds: [] };
    for (const height of [18000000, 9000000, 5200001, 5200000, 4000000, 2600001, 2600000, 1000000]) {
      const { activeGroup, stackModel } = evaluate([cluster(country, region)], height, state);
      assert.equal(activeGroup.clusters.length, 1);
      assert.equal(stackModel.total_event_count, 2);
      assert.ok(stackModel.area_label.includes(country));
      assert.ok(stackModel.area_label.includes(region));
      assert.deepEqual(Array.from(state.groupIds), [country]);
    }
  }
});

test("separated groups produce only one prioritized summary and no visible clusters clears it", () => {
  const { activeGroup, stackModel } = evaluate([
    cluster("Saudi Arabia", "Eastern Province", 640), cluster("Ukraine", "Donetsk", 30),
  ], 9000000);
  assert.equal(activeGroup.clusters.length, 1);
  assert.equal(stackModel.entries.length, 1);
  assert.ok(stackModel.area_label.includes("Saudi Arabia"));
  const state = { groupIds: ["Saudi Arabia"] };
  const empty = evaluate([], 9000000, state);
  assert.equal(empty.activeGroup, null);
  assert.equal(empty.stackModel, null);
  assert.equal(state.groupIds.length, 0);
});
