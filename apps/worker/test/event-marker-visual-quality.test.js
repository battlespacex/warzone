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
  assert.match(rootCss, /--warzone-event-marker-single-canvas-size:\s*512\s*;/);
  assert.match(rootCss, /--warzone-resolution-scale:\s*1\.2\s*;/);
  assert.match(rootCss, /--warzone-msaa-samples:\s*4\s*;/);
  assert.match(rootCss, /--warzone-globe-loading-resolution-scale:\s*1\.05\s*;/);
  assert.match(rootCss, /--warzone-globe-loading-msaa-samples:\s*2\s*;/);
  assert.match(rootCss, /--event-marker-ring-width-critical:\s*3\s*;/);
  assert.match(rootCss, /--event-marker-ring-glow-critical:\s*1\.5\s*;/);
  assert.match(globeSource, /--event-marker-ring-width-\$\{severityKey\}/);
  assert.match(globeSource, /imageSmoothingQuality\s*=\s*"high"/);
});

test("event labels use clean UI typography while activity labels retain heading typography", async () => {
  const rootCss = await readFile(rootCssUrl, "utf8");
  const componentCss = await readFile(componentCssUrl, "utf8");
  const globeSource = await readFile(globeSourceUrl, "utf8");

  assert.match(rootCss, /--event-marker-label-size:\s*var\(--text-sm\)\s*;/);
  assert.match(rootCss, /--event-marker-label-letter-spacing:\s*0\.1rem\s*;/);
  assert.match(rootCss, /--event-marker-label-font-weight:\s*600\s*;/);
  assert.match(rootCss, /--event-marker-label-padding-x:\s*0\.8rem\s*;/);
  assert.match(rootCss, /--event-marker-label-padding-top:\s*0\.8rem\s*;/);
  assert.match(rootCss, /--event-marker-label-padding-bottom:\s*0\.6rem\s*;/);
  assert.match(componentCss, /\.wzhs-cluster-label\s*\{[\s\S]*?font-family:\s*var\(--heading-font\)[\s\S]*?letter-spacing:\s*0\.2rem[\s\S]*?text-transform:\s*uppercase/);
  assert.match(componentCss, /\.wzhs-activity-stack\s*\{[\s\S]*?font-family:\s*var\(--heading-font\)[\s\S]*?letter-spacing:\s*0\.2rem[\s\S]*?text-transform:\s*uppercase/);
  assert.match(globeSource, /formatEventMarkerLabelText\(text\)/);
  assert.match(globeSource, /stringVar\("--text-font"/);
  assert.match(globeSource, /Math\.max\(4, Math\.min\(6,/);
  const eventLabelRenderer = globeSource.slice(
    globeSource.indexOf("function createEventMarkerTextBillboard"),
    globeSource.indexOf("function createEventCountEntity")
  );
  assert.doesNotMatch(eventLabelRenderer, /--heading-font/);
  assert.match(globeSource, /ctx\.lineTo\(logicalWidth - cutSize, logicalHeight\)/);
  assert.match(globeSource, /\.toUpperCase\(\)/);
});
