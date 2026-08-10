import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = {};

const {
  sanitizeAlertDisplayText,
  getAlertCategory,
} = await import("../../../dev/assets/js/warzone-siren-alert.js");

test("alert display removes emoji without changing ordinary operational text", () => {
  assert.equal(
    sanitizeAlertDisplayText("🚨 Jizan fire reported ⚠️ via OSINT"),
    "Jizan fire reported via OSINT"
  );
  assert.equal(getAlertCategory("Sirens active in Jizan", "OSINT Feed", "red"), "SIREN ACTIVITY");
  assert.equal(getAlertCategory("Missile impact reported", "OSINT Feed", "red"), "STRIKE ACTIVITY");
});

test("alert strip uses bounded grid tracks without paint containment", async () => {
  const css = await readFile(new URL("../../../dev/assets/css/warzone-components.css", import.meta.url), "utf8");
  const html = await readFile(new URL("../../../dev/partials/popups.html", import.meta.url), "utf8");
  const block = css.match(/\.wz-siren-stack\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.match(block, /position:\s*fixed/);
  assert.match(block, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(block, /overflow:\s*visible/);
  assert.doesNotMatch(block, /contain:\s*[^;]*paint/);
  assert.match(css, /\.wz-siren-banner\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(html, /wz-siren-category/);
  assert.match(html, /stratops-ico-assets-alert-1/);
});

test("capture composites map-linked DOM overlays after a synchronized render frame", async () => {
  const source = await readFile(new URL("../../../dev/assets/js/warzone-capture-shot.js", import.meta.url), "utf8");
  assert.match(source, /#warzone-hotspot-layer/);
  assert.match(source, /#wz-radar-label-layer/);
  assert.match(source, /await waitForOverlayFrame\(\)/);
  assert.match(source, /new XMLSerializer\(\)/);
  assert.match(source, /<foreignObject/);
  assert.match(source, /ctx\.drawImage\([\s\S]*?rect\.width \* scaleX/);
});

test("strike labels use tactical billboard canvases and completed visuals hold at least ten seconds", async () => {
  const source = await readFile(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../../../dev/assets/css/root.css", import.meta.url), "utf8");
  assert.match(source, /function createTacticalStrikeLabel/);
  assert.match(source, /verticalOrigin:\s*Cesium\.VerticalOrigin\.BOTTOM/);
  assert.match(source, /ctx\.lineTo\(x \+ boxWidth - cutSize, y\)/);
  assert.match(source, /const completedHoldMinMs = Math\.max\([\s\S]*?10000/);
  assert.match(source, /const persistMs = Math\.max\(\s*completedHoldMinMs/);
  assert.match(css, /--warzone-missile-completed-hold-min:\s*10000/);
});
