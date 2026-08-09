import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rootCssUrl = new URL("../../../dev/assets/css/root.css", import.meta.url);
const componentCssUrl = new URL("../../../dev/assets/css/warzone-components.css", import.meta.url);
const globeSourceUrl = new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url);

test("close event markers stay circular and use dedicated clean ring tuning", async () => {
  const rootCss = await readFile(rootCssUrl, "utf8");
  const globeSource = await readFile(globeSourceUrl, "utf8");

  assert.match(rootCss, /--warzone-event-marker-perspective-squash:\s*0\s*;/);
  assert.match(rootCss, /--event-marker-ring-width-critical:\s*3\s*;/);
  assert.match(rootCss, /--event-marker-ring-glow-critical:\s*1\.5\s*;/);
  assert.match(globeSource, /--event-marker-ring-width-\$\{severityKey\}/);
  assert.match(globeSource, /imageSmoothingQuality\s*=\s*"high"/);
});

test("event and activity labels use heading typography, uppercase and 0.2rem spacing", async () => {
  const rootCss = await readFile(rootCssUrl, "utf8");
  const componentCss = await readFile(componentCssUrl, "utf8");
  const globeSource = await readFile(globeSourceUrl, "utf8");

  assert.match(rootCss, /--event-marker-label-letter-spacing:\s*0\.2rem\s*;/);
  assert.match(componentCss, /\.wzhs-cluster-label\s*\{[\s\S]*?font-family:\s*var\(--heading-font\)[\s\S]*?letter-spacing:\s*0\.2rem[\s\S]*?text-transform:\s*uppercase/);
  assert.match(componentCss, /\.wzhs-activity-stack\s*\{[\s\S]*?font-family:\s*var\(--heading-font\)[\s\S]*?letter-spacing:\s*0\.2rem[\s\S]*?text-transform:\s*uppercase/);
  assert.match(globeSource, /formatEventMarkerLabelText\(text\)/);
  assert.match(globeSource, /\.toUpperCase\(\)/);
});
