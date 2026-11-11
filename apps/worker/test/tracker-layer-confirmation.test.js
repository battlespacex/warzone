import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class Button {
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  click() { this.listeners.get("click")?.(); }
  focus() { document.activeElement = this; }
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
const window = {
  __stratopsAuthState: { isAuthenticated: true },
  location: { hostname: "localhost" },
  __warzoneOpenSharedModal: (_modal, callback) => { modalOpenCount += 1; callback?.(); },
  __warzoneCloseSharedModal: (_modal, callback) => callback?.(),
};
const keyboard = new Map();
const document = {
  body: { classList: { contains: () => false } },
  getElementById: (id) => elements.get(id) || null,
  querySelector: () => null,
  addEventListener: (type, listener) => keyboard.set(type, listener),
  removeEventListener: (type, listener) => { if (keyboard.get(type) === listener) keyboard.delete(type); },
};
const layers = vm.createContext({ window, document, localStorage: { setItem() {}, getItem: () => null },
  getStratOpsLayerFeaturePath: () => "", isStratOpsFeatureEnabled: () => true });
const source = readFileSync(new URL("../../../dev/assets/js/warzone-layers.js", import.meta.url), "utf8");
vm.runInContext(source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/m, "")
  .replace(/import\.meta\.env\?\.DEV/g, "false").replace(/export \{[^}]+\};/g, "").replace(/\bexport /g, ""), layers);
layers.LAYER_DEFS = vm.runInContext("LAYER_DEFS", layers);
const snapshot = () => Object.fromEntries(
  layers.LAYER_DEFS.map(({ id }) => [id, layers.isLayerEnabled(id)])
);

test("tracker confirmation cancel preserves every layer and continue applies isolation", async () => {
  layers.resetLayerStateForFreshLoad();
  const before = snapshot();
  const cancelled = layers.requestLayerToggle("aircraft");
  assert.equal(modalOpenCount, 1);
  assert.equal(elements.get("wz-layer-warning-title").textContent, "Enable Aircraft Tracking?");
  backButton.click();
  assert.equal(await cancelled, false);
  assert.deepEqual(snapshot(), before);

  const approved = layers.requestLayerToggle("aircraft");
  assert.equal(modalOpenCount, 2);
  confirmButton.click();
  assert.equal(await approved, true);
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("strikes"), false);

  const naval = layers.requestLayerToggle("naval");
  assert.equal(modalOpenCount, 3, "the compatible second tracker also requires confirmation");
  assert.equal(layers.isLayerEnabled("naval"), false);
  assert.equal(elements.get("wz-layer-warning-title").textContent, "Enable Naval Tracking?");
  confirmButton.click();
  assert.equal(await naval, true);
  assert.equal(layers.isLayerEnabled("aircraft"), true);
  assert.equal(layers.isLayerEnabled("naval"), true);
});

test("each final tracker OFF restores the exact entry defaults, not an isolated snapshot", () => {
  const defaults = vm.runInContext("DASHBOARD_DEFAULT_LAYER_STATE", layers);
  for (const id of ["aircraft", "naval", "orbital-assets"]) {
    layers.resetLayerStateForFreshLoad();
    layers.setLayer("strikes", false);
    layers.setLayer("country-borders", true);
    layers.setLayer(id, true);
    if (id !== "orbital-assets") {
      assert.equal(layers.setLayer("aoi", true), true);
      assert.equal(layers.isLayerEnabled("aoi"), true);
    }
    layers.setLayer(id, false);
    for (const layer of layers.LAYER_DEFS) assert.equal(layers.isLayerEnabled(layer.id), defaults[layer.id], `${id} -> ${layer.id}`);
    assert.equal(layers.setLayer("strikes", false), false);
    assert.equal(layers.setLayer("strikes", true), true, "normal controls are unlocked");
  }
});

test("tracker switches publish one coherent isolation state; defaults return only after the final tracker", () => {
  layers.resetLayerStateForFreshLoad();
  const transitions = [];
  layers.onLayerChange((id, _enabled, state, changed) => transitions.push({ id, state, changed }));
  for (const [id, enabled] of [["aircraft", true], ["naval", true], ["aircraft", false],
    ["orbital-assets", true], ["naval", true], ["aircraft", true], ["naval", false]]) {
    layers.setLayer(id, enabled);
    assert.equal(layers.isLayerEnabled("strikes"), false);
  }
  assert.equal(layers.isLayerEnabled("orbital-assets"), false);
  layers.setLayer("aircraft", false);
  assert.equal(layers.isLayerEnabled("strikes"), true);
  assert.equal(layers.isLayerEnabled("orbital-assets"), false, "a saved orbital mode must never return");
  assert.equal(transitions.length, 8);
  assert.ok(transitions.slice(0, -1).every(({ state }) => !state.strikes && !state.hotspots));
  assert.ok(transitions.at(-1).changed.includes("strikes"));
});

test("orbital warning cancels with Escape, traps Tab, restores focus and removes handlers", async () => {
  layers.resetLayerStateForFreshLoad();
  const trigger = new Button(); trigger.focus();
  const before = snapshot();
  const pending = layers.requestLayerToggle("orbital-assets");
  assert.equal(elements.get("wz-layer-warning-title").textContent, "Enable Orbital Intelligence?");
  assert.equal(confirmButton.textContent, "Enable Orbital Intelligence");
  assert.equal(document.activeElement, backButton);
  confirmButton.focus();
  let prevented = false;
  keyboard.get("keydown")({ key: "Tab", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(document.activeElement, closeButton);
  keyboard.get("keydown")({ key: "Escape", preventDefault() {}, stopPropagation() {} });
  assert.equal(await pending, false);
  assert.deepEqual(snapshot(), before);
  assert.equal(document.activeElement, trigger);
  assert.equal(keyboard.size, 0);
  assert.equal(confirmButton.listeners.size, 0);
});

test("pending confirmations cannot overlap, override newer state, or bypass authorization", async () => {
  layers.resetLayerStateForFreshLoad();
  const pending = layers.requestLayerToggle("aircraft");
  assert.equal(await layers.requestLayerToggle("naval"), false);
  layers.setLayer("orbital-assets", true);
  confirmButton.click();
  assert.equal(await pending, false);
  assert.equal(layers.isLayerEnabled("orbital-assets"), true);
  assert.equal(layers.isLayerEnabled("aircraft"), false);
  layers.setLayer("orbital-assets", false);
  const revoked = layers.requestLayerToggle("naval");
  window.__stratopsAuthState.isAuthenticated = false;
  window.location.hostname = "stratops.battlespacex.com";
  confirmButton.click();
  assert.equal(await revoked, false);
  assert.equal(layers.isLayerEnabled("naval"), false);
  layers.setLayer("orbital-assets", false);
  assert.equal(layers.isLayerEnabled("cyber"), false);
  window.__stratopsAuthState.isAuthenticated = true;
});

test("each manual tracker activation confirms exactly once, while OFF never warns", async () => {
  for (const [id, label] of [["aircraft", "Aircraft Tracking"], ["naval", "Naval Tracking"], ["orbital-assets", "Orbital Intelligence"]]) {
    layers.resetLayerStateForFreshLoad();
    const opens = modalOpenCount;
    const before = snapshot();
    const pending = layers.requestLayerToggle(id);
    assert.deepEqual(snapshot(), before);
    assert.equal(elements.get("wz-layer-warning-title").textContent, `Enable ${label}?`);
    assert.equal(backButton.textContent, "Cancel");
    assert.equal(confirmButton.textContent, `Enable ${label}`);
    confirmButton.click();
    assert.equal(await pending, true);
    assert.equal(layers.isLayerEnabled(id), true);
    assert.equal(await layers.requestLayerToggle(id), false);
    assert.equal(layers.isLayerEnabled(id), false);
    assert.equal(modalOpenCount, opens + 1);
  }
});

test("final restoration respects revoked premium access and startup rejects saved orbital isolation", () => {
  layers.resetLayerStateForFreshLoad();
  layers.setLayer("naval", true);
  window.__stratopsAuthState.isAuthenticated = false;
  layers.setLayer("naval", false);
  assert.equal(layers.isLayerEnabled("strikes"), true);
  assert.equal(layers.isLayerEnabled("cyber"), false);
  assert.equal(layers.isLayerEnabled("airspace"), false);
  window.__stratopsAuthState.isAuthenticated = true;
  layers.localStorage.getItem = () => JSON.stringify({ "orbital-assets": true, strikes: false });
  layers.restoreLayerStateForStartup();
  assert.equal(layers.isLayerEnabled("orbital-assets"), false);
  assert.equal(layers.isLayerEnabled("strikes"), true);
  layers.localStorage.getItem = () => null;
});
