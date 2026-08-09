import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = {};

await import("../../../dev/assets/js/stratops-feature-config.js");

test("temporary frontend audio feature switches are disabled", () => {
  assert.equal(window.STRATOPS_FEATURES.system.audio, false);
  assert.equal(window.STRATOPS_FEATURES.alerts.audibleSirens, false);
});

test("entry soundtrack does not preload and its toggle is hidden before first paint", async () => {
  const html = await readFile(new URL("../../../dev/pages/index.html", import.meta.url), "utf8");
  const audio = html.match(/<audio id="bg-audio"[\s\S]*?<\/audio>/)?.[0] || "";
  const toggle = html.match(/<button id="audio-toggle"[\s\S]*?>/)?.[0] || "";
  assert.match(audio, /preload="none"/);
  assert.match(audio, /hidden/);
  assert.match(toggle, /hidden/);
  assert.match(toggle, /data-stratops-feature-disabled-by-config="system\.audio"/);
});

test("independent siren and missile audio paths honor the master audio switch", async () => {
  const sirenSource = await readFile(new URL("../../../dev/assets/js/warzone-siren-alert.js", import.meta.url), "utf8");
  const globeSource = await readFile(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
  assert.match(sirenSource, /!isStratOpsFeatureEnabled\("system\.audio"\)/);
  assert.match(sirenSource, /!isStratOpsFeatureEnabled\("alerts\.audibleSirens"\)/);
  assert.match(globeSource, /function safeCreateAudio[\s\S]*?!isStratOpsFeatureEnabled\("system\.audio"\)/);
  assert.match(globeSource, /function startMissileAlertSound[\s\S]*?!isStratOpsFeatureEnabled\("system\.audio"\)/);
});
