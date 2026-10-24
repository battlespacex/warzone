import test from "node:test";
import assert from "node:assert/strict";

class Button {
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  click() { this.listeners.get("click")?.(); }
}

const elements = new Map();
const modal = { hidden: true, classList: { add() {}, remove() {} } };
const closeButton = new Button();
const backButton = new Button();
const confirmButton = new Button();
for (const [id, value] of [
  ["wz-layer-warning-modal", modal],
  ["wz-layer-warning-title", { textContent: "" }],
  ["wz-layer-warning-summary", { textContent: "" }],
  ["wz-layer-warning-detail", { textContent: "" }],
  ["wz-layer-warning-close", closeButton],
  ["wz-layer-warning-back", backButton],
  ["wz-layer-warning-confirm", confirmButton],
]) elements.set(id, value);

let modalOpenCount = 0;
globalThis.window = {
  __stratopsAuthState: { isAuthenticated: true },
  location: { hostname: "localhost" },
  __warzoneOpenSharedModal: () => { modalOpenCount += 1; },
  __warzoneCloseSharedModal: (_modal, callback) => callback?.(),
};
globalThis.document = {
  body: { classList: { contains: () => false } },
  getElementById: (id) => elements.get(id) || null,
  querySelector: () => null,
};
globalThis.localStorage = { setItem() {}, getItem: () => null };

const layers = await import("../../../dev/assets/js/warzone-layers.js?tracker-confirmation");
const snapshot = () => Object.fromEntries(
  layers.LAYER_DEFS.map(({ id }) => [id, layers.isLayerEnabled(id)])
);

test("tracker confirmation cancel preserves every layer and continue applies isolation", async () => {
  layers.resetLayerStateForFreshLoad();
  const before = snapshot();
  const cancelled = layers.requestLayerToggle("aircraft");
  assert.equal(modalOpenCount, 1);
  assert.match(elements.get("wz-layer-warning-title").textContent, /Enable Live Tracking/);
  backButton.click();
  assert.equal(await cancelled, false);
  assert.deepEqual(snapshot(), before);

  const approved = layers.requestLayerToggle("aircraft");
  assert.equal(modalOpenCount, 2);
  confirmButton.click();
  assert.equal(await approved, true);
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("strikes"), false);

  assert.equal(await layers.requestLayerToggle("naval"), true);
  assert.equal(modalOpenCount, 2, "the compatible second tracker must not prompt");
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("naval"), true);
});
