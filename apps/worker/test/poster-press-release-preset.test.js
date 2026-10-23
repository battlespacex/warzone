import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const readSource = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

test("Press Release preset uses the bundled background and required branding defaults", async () => {
  const source = await readSource("dev/assets/js/poster-generator.js");
  const html = await readSource("dev/pages/poster.html");

  await access(path.join(repositoryRoot, "dev/assets/images/poster/pr-bg-1.jpg"));
  assert.match(html, /<option value="pressrelease">Press Release<\/option>/);
  assert.match(source, /const PRESS_RELEASE_PRESET = Object\.freeze\(\{[\s\S]*?backgroundAsset:\s*"\/assets\/images\/poster\/pr-bg-1\.jpg"/);
  assert.match(source, /state:\s*Object\.freeze\(\{[\s\S]*?logo:\s*"battlespacex"[\s\S]*?qr:\s*"battlespacex"[\s\S]*?bottomBranding:\s*"battlespacex"[\s\S]*?enableDescription:\s*true/);
  assert.match(source, /state\.brandPreset === "pressrelease"[\s\S]*?alignTextBox\("title", "center"\)[\s\S]*?alignTextBox\("description", "center"\)/);
});

test("Press Release locks background controls and uses a top-aligned cover fit", async () => {
  const source = await readSource("dev/assets/js/poster-generator.js");
  const html = await readSource("dev/pages/poster.html");
  const css = await readSource("dev/assets/css/poster.css");

  assert.match(html, /id="backgroundInputLabel"[\s\S]*?id="backgroundInput"/);
  assert.match(source, /const disabled = state\.brandPreset === "pressrelease";[\s\S]*?input\.disabled = disabled/);
  for (const id of ["fitMode", "imageZoom", "imageX", "imageY", "brightness", "contrast", "saturation", "darkOverlay", "overlaySelect"]) {
    assert.match(source, new RegExp(`PRESS_RELEASE_BACKGROUND_CONTROL_IDS[\\s\\S]*?"${id}"`));
  }
  assert.match(source, /function fitPressReleaseBackgroundToTop\(\)[\s\S]*?state\.fitMode = "cover"[\s\S]*?state\.imageZoom = 100[\s\S]*?state\.imageX = 0[\s\S]*?state\.imageY = bounds\.maxY/);
  assert.match(source, /if \(!images\.background \|\| state\.brandPreset === "pressrelease"\) return;/);
  assert.match(css, /\.file-button\.is-disabled\s*\{[\s\S]*?cursor:\s*not-allowed;[\s\S]*?opacity:/);
  assert.match(css, /\.preset-control-disabled\s*\{[\s\S]*?cursor:\s*not-allowed;[\s\S]*?opacity:/);
});

test("title and description have independent safe-area text-box alignment controls", async () => {
  const source = await readSource("dev/assets/js/poster-generator.js");
  const html = await readSource("dev/pages/poster.html");

  for (const target of ["title", "description"]) {
    for (const alignment of ["left", "center", "right"]) {
      assert.match(html, new RegExp(`data-text-box-target="${target}"[\\s\\S]*?data-text-box-align="${alignment}"`));
    }
  }
  assert.match(source, /function alignTextBox\(prefix, alignment\)[\s\S]*?SAFE_AREA\.right - width[\s\S]*?SAFE_AREA\.left \+ \(availableWidth - width\) \/ 2[\s\S]*?SAFE_AREA\.left/);
  assert.match(source, /function preserveTextBoxPosition\(prefix, previousAlign\)[\s\S]*?getTextBoxLeft[\s\S]*?getTextAnchor/);
  assert.doesNotMatch(source.match(/function alignTextBox\(prefix, alignment\) \{([\s\S]*?)\n  \}/)?.[1] || "", /prefix \+ "Y"/);
});
