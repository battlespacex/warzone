import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-layers.js", import.meta.url), "utf8");
function freshApplication(saved) {
  const storage = new Map([
    ["wz_layer_state", JSON.stringify(saved)], ["wz_auth_base", "https://www.battlespacex.com/api/auth"],
    ["account-preference", "keep"], ["wz_region", "north_america"],
  ]);
  const writes = [], reads = [];
  const auth = { isAuthenticated: true, user: { username: "existing-user" } };
  const context = vm.createContext({
    window: { __stratopsAuthState: auth, location: { hostname: "stratops.battlespacex.com" } },
    document: { body: { classList: { contains: () => false } }, getElementById: () => null, querySelector: () => null },
    localStorage: {
      getItem: key => { reads.push(key); return storage.get(key) ?? null; },
      setItem: (key, value) => { writes.push(key); storage.set(key, value); },
      clear: () => assert.fail("startup must not clear storage"),
      removeItem: () => assert.fail("startup must not remove unrelated storage"),
    },
    getStratOpsLayerFeaturePath: () => "", isStratOpsFeatureEnabled: () => true,
  });
  vm.runInContext(source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/m, "")
    .replace(/import\.meta\.env\?\.DEV/g, "false").replace(/export \{[^}]+\};/g, "").replace(/\bexport /g, ""), context);
  return { context, storage, writes, reads, auth };
}

test("every fresh application ignores saved layers while retaining authentication and unrelated preferences", () => {
  for (const saved of [
    { "orbital-assets": true, strikes: false }, { aircraft: true }, { naval: true },
    { gnss: true, aoi: true, terrain: false, "country-borders": true }, {},
  ]) {
    const { context, storage, writes, reads, auth } = freshApplication(saved);
    context.restoreLayerStateForStartup();
    const defaults = vm.runInContext("DASHBOARD_DEFAULT_LAYER_STATE", context);
    const ids = vm.runInContext("LAYER_DEFS.map(layer => layer.id)", context);
    for (const id of ids) assert.equal(context.isLayerEnabled(id), defaults[id], id);
    assert.equal(context.window.__stratopsAuthState, auth);
    assert.equal(auth.isAuthenticated, true);
    assert.equal(storage.get("wz_auth_base"), "https://www.battlespacex.com/api/auth");
    assert.equal(storage.get("account-preference"), "keep");
    assert.equal(storage.get("wz_region"), "north_america");
    assert.equal(reads.includes("wz_layer_state"), false, "persisted toggles are never hydrated");
    assert.deepEqual(writes, ["wz_layer_state", "wz_layer_layout_version"]);
    assert.equal(JSON.parse(storage.get("wz_layer_state")).gnss, false);
  }
});

test("startup initialization runs once per module lifetime and does not reset an active visit", () => {
  const { context, storage } = freshApplication({ gnss: true });
  context.restoreLayerStateForStartup();
  context.setLayer("aircraft", true);
  context.setLayer("naval", true);
  context.setLayer("aoi", true);
  context.restoreLayerStateForStartup();
  context.hydrateLayerStateFromStorage();
  for (const id of ["aircraft", "naval", "aoi"]) assert.equal(context.isLayerEnabled(id), true);
  const reopened = freshApplication(JSON.parse(storage.get("wz_layer_state"))).context;
  reopened.restoreLayerStateForStartup();
  for (const id of ["aircraft", "naval", "orbital-assets", "gnss", "aoi"]) assert.equal(reopened.isLayerEnabled(id), false);
});

test("boot establishes default layers before widgets and the operational application initialize", () => {
  const boot = readFileSync(new URL("../../../dev/assets/js/warzone-boot.js", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../../../dev/assets/js/index.js", import.meta.url), "utf8");
  assert.ok(boot.indexOf("restoreLayerStateForStartup();") < boot.indexOf("    loadWidgetState();"));
  assert.ok(entry.indexOf('import "./warzone-boot.js"') < entry.indexOf('document.addEventListener("DOMContentLoaded", async'));
  assert.doesNotMatch(source.slice(source.indexOf("export function restoreLayerStateForStartup"),
    source.indexOf("export function resetLayerStateForFreshLoad")), /signOut|fetch\(|removeItem|\.clear\(/);
});
