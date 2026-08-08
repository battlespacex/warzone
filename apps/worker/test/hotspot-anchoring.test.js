import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = globalThis.window || {};

const {
  applyHotspotNodeAnchorPosition,
  computeActivityStackLeaderGeometry,
  isHotspotReconciliationDue,
} = await import("../../../dev/assets/js/warzone-hotspots.js");

function elementStub() {
  const values = new Map();
  return {
    hidden: false,
    style: {
      setProperty(name, value) { values.set(name, value); },
      getPropertyValue(name) { return values.get(name) || ""; },
    },
  };
}

test("hotspot wrapper pieces receive the same sub-pixel anchor without positional easing", () => {
  const node = {
    el: elementStub(),
    radiusEl: elementStub(),
    uxLabelEl: elementStub(),
    radiusSize: 100,
    stackOffset: { x: 0, y: 0 },
    uxLabelEligible: true,
  };
  const visible = applyHotspotNodeAnchorPosition(node, {
    x: 100.25,
    y: 200.5,
    matrix: "matrix(1, 0, 0, 1, 0, 0)",
  }, {
    offsetX: 10,
    offsetY: 20,
    width: 800,
    height: 600,
    edgePad: 40,
  });

  assert.equal(visible, true);
  assert.equal(node.screenX, 110.25);
  assert.equal(node.screenY, 220.5);
  assert.equal(node.uxLabelEl.style.getPropertyValue("--wzhs-anchor-x"), "110.25px");
  assert.equal(node.uxLabelEl.style.getPropertyValue("--wzhs-anchor-y"), "220.5px");
  assert.equal(node.radiusEl.style.getPropertyValue("--wzhs-anchor-x"), "60.25px");
  assert.equal(node.radiusEl.style.getPropertyValue("--wzhs-anchor-y"), "170.5px");
  assert.equal(node.el.style.getPropertyValue("--wzhs-anchor-x"), "196.25px");
  assert.equal(node.el.style.getPropertyValue("--wzhs-anchor-y"), "168.5px");
  assert.equal(node.radiusEl.style.getPropertyValue("--wzhs-surface-matrix"), "matrix(1, 0, 0, 1, 0, 0)");
});

test("invalid or offscreen projections hide all anchored pieces instead of leaving stale graphics", () => {
  const node = {
    el: elementStub(),
    radiusEl: elementStub(),
    uxLabelEl: elementStub(),
    radiusSize: 80,
    uxLabelEligible: true,
  };
  const visible = applyHotspotNodeAnchorPosition(node, { x: 900, y: 200 }, {
    width: 800,
    height: 600,
    edgePad: 20,
  });
  assert.equal(visible, false);
  assert.equal(node.el.hidden, true);
  assert.equal(node.radiusEl.hidden, true);
  assert.equal(node.uxLabelEl.hidden, true);
});

test("leader endpoint follows the live cluster anchor while panel geometry stays fixed", () => {
  const geometry = computeActivityStackLeaderGeometry(
    { x: 100, y: 210 },
    { side: "right", left: 300, top: 100, width: 320, height: 260 },
    24
  );
  assert.equal(geometry.hidden, false);
  assert.equal(geometry.left, 100);
  assert.equal(geometry.top, 210);
  assert.equal(geometry.width, 200);
  assert.equal(geometry.rotation, 0);
});

test("90 ms reconciliation remains throttled independently of per-frame anchor updates", () => {
  assert.equal(isHotspotReconciliationDue(1089, 1000, 90), false);
  assert.equal(isHotspotReconciliationDue(1090, 1000, 90), true);
});

test("postRender updates current anchors before the throttled reconciliation path", async () => {
  const source = await readFile(new URL("../../../dev/assets/js/warzone-hotspots.js", import.meta.url), "utf8");
  const onPostRender = source.match(/function onPostRender\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.ok(onPostRender.indexOf("updateCurrentAnchorPositions();") >= 0);
  assert.ok(onPostRender.indexOf("isHotspotReconciliationDue") > onPostRender.indexOf("updateCurrentAnchorPositions();"));
  assert.ok(onPostRender.indexOf("render(true);") > onPostRender.indexOf("isHotspotReconciliationDue"));
});

test("hotspot and locality-label CSS contain no positional transitions", async () => {
  const css = await readFile(new URL("../../../dev/assets/css/warzone-components.css", import.meta.url), "utf8");
  for (const selector of [".wzhs", ".wzhs-cluster-label"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
    assert.ok(rule, `missing ${selector} rule`);
    assert.doesNotMatch(rule, /transition\s*:[^;}]*(?:left|top|transform)/i);
  }
});
