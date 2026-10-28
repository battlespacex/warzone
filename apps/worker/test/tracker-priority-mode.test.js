import test from "node:test";
import assert from "node:assert/strict";

const stored = new Map();
const items = new Map();
const classList = () => {
  const classes = new Set();
  return {
    contains: (name) => classes.has(name),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
  };
};
const panel = {
  querySelectorAll: (selector) => selector === ".wz-layer-item" ? [...items.values()] : [],
  querySelector: (selector) => items.get(selector.match(/^\[data-layer="([^"]+)"\]$/)?.[1]) || null,
};

globalThis.window = {
  __stratopsAuthState: { isAuthenticated: true },
  location: { hostname: "localhost" },
};
globalThis.document = {
  body: { classList: { contains: () => false } },
  getElementById: (id) => id === "wz-layer-panel" ? panel : null,
  querySelector: () => null,
};
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
};

const layers = await import("../../../dev/assets/js/warzone-layers.js");
const notifications = [];
layers.onLayerChange((id, enabled, state, changedIds) => {
  notifications.push({ id, enabled, state, changedIds });
});
for (const { id } of layers.LAYER_DEFS) {
  items.set(id, {
    dataset: { layer: id },
    classList: classList(),
    setAttribute() {},
    querySelector: () => null,
  });
}

function fresh() {
  layers.resetLayerStateForFreshLoad();
  notifications.length = 0;
}

test("tracker priority writes unrelated OFF states once and keeps the globe", (t) => {
  fresh();
  const before = layers.LAYER_DEFS.filter(({ id }) => layers.isLayerEnabled(id)).length;
  assert.equal(layers.setLayer("aircraft", true), true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, "*");
  for (const id of ["strikes", "missiles", "ranges", "sweepers", "alerts", "hotspots", "satellite-imagery"]) {
    assert.equal(notifications[0].state[id], false, `${id} must be OFF in authoritative state`);
    assert.equal(layers.isLayerEnabled(id), false);
    assert.equal(items.get(id).classList.contains("is-on"), false);
  }
  assert.equal(layers.isLayerEnabled("terrain"), true);
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("naval"), false);
  assert.equal(items.get("aircraft").classList.contains("is-on"), true);
  assert.equal(JSON.parse(stored.get("wz_layer_state")).alerts, false);
  t.diagnostic(`enabled layers: ${before} before, ${layers.LAYER_DEFS.filter(({ id }) => layers.isLayerEnabled(id)).length} after`);
});

test("both trackers coexist and incompatible layers stay blocked until both trackers are OFF", () => {
  fresh();
  layers.setLayer("aircraft", true);
  layers.setLayer("alerts", true);
  layers.setLayer("orbital-assets", true);
  layers.setLayer("gnss", true);
  layers.setLayer("airspace", true);
  assert.equal(layers.isLayerEnabled("orbital-assets"), false);
  assert.equal(items.get("orbital-assets").classList.contains("is-locked"), true);
  layers.toggleLayer("naval");
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("naval"), true);
  assert.equal(layers.isLayerEnabled("airspace"), true);
  assert.equal(layers.isLayerEnabled("orbital-assets"), false);
  assert.equal(layers.isLayerEnabled("gnss"), false);
  assert.equal(layers.isLayerEnabled("alerts"), false);
  layers.setLayer("orbital-assets", true);
  assert.equal(layers.isLayerEnabled("orbital-assets"), false);
  layers.setLayer("aircraft", false);
  assert.equal(layers.isLayerEnabled("naval"), true);
  assert.equal(layers.isLayerEnabled("airspace"), false);
  assert.equal(layers.setLayer("cyber", true), false);
  assert.equal(layers.isLayerEnabled("orbital-assets"), false);
  layers.setLayer("naval", false);
  assert.equal(items.get("orbital-assets").classList.contains("is-locked"), false);
  layers.setLayer("orbital-assets", true);
  assert.equal(layers.isLayerEnabled("orbital-assets"), true);
});

test("repeated tracker cycles emit one notification per action without state leaks", () => {
  fresh();
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const before = notifications.length;
    layers.setLayer("naval", true);
    assert.equal(notifications.length, before + 1);
    layers.setLayer("naval", true);
    assert.equal(notifications.length, before + 1);
    assert.equal(layers.isLayerEnabled("terrain"), true);
    assert.equal(layers.isLayerEnabled("alerts"), false);
    layers.setLayer("alerts", true);
    assert.equal(layers.isLayerEnabled("alerts"), false);
    layers.setLayer("naval", false);
    assert.equal(layers.isLayerEnabled("naval"), false);
    assert.equal(layers.isLayerEnabled("alerts"), false);
  }
  assert.equal(layers.isLayerEnabled("aircraft"), false);
});

test("all public admission paths reject GNSS and Cyber without transient notifications", async () => {
  for (const tracker of ["aircraft", "naval"]) {
    fresh(); layers.setLayer(tracker, true);
    const count = notifications.length;
    for (const id of ["gnss", "cyber", "hotspots", "satellite-imagery"]) {
      assert.equal(layers.setLayer(id, true), false);
      assert.equal(layers.toggleLayer(id), false);
      assert.equal(await layers.requestLayerToggle(id), false);
      assert.equal(layers.isLayerEnabled(id), false);
      assert.equal(items.get(id).classList.contains("is-locked"), true);
    }
    assert.equal(notifications.length, count);
    assert.equal(layers.setLayer("map-labels", true), true);
    layers.setLayer(tracker, false);
    assert.equal(layers.setLayer("gnss", true), true);
  }
});

test("tracker request uses the reduced priority state and retains premium access checks", async () => {
  fresh();
  assert.equal(await layers.requestLayerToggle("aircraft"), true);
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("sweepers"), false);

  fresh();
  window.__stratopsAuthState.isAuthenticated = false;
  try {
    assert.equal(layers.setLayer("aircraft", true), false);
    assert.equal(layers.isLayerEnabled("aircraft"), false);
    assert.equal(layers.isLayerEnabled("strikes"), true);
  } finally {
    window.__stratopsAuthState.isAuthenticated = true;
  }
});
