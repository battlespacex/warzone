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

test("Press Release disables only background file selection while preserving saved customization", async () => {
  const source = await readSource("dev/assets/js/poster-generator.js");
  const html = await readSource("dev/pages/poster.html");
  const css = await readSource("dev/assets/css/poster.css");

  assert.match(html, /id="backgroundInputLabel"[\s\S]*?id="backgroundInput"/);
  assert.match(source, /const disabled = state\.brandPreset === "pressrelease";[\s\S]*?input\.disabled = disabled/);
  assert.match(css, /\.file-button\.is-disabled\s*\{[\s\S]*?cursor:\s*not-allowed;[\s\S]*?opacity:/);
  assert.match(source, /Object\.assign\(state, normalized\);[\s\S]*?images\.background = state\.backgroundDataUrl \? await loadImage\(state\.backgroundDataUrl\) : null/);
  assert.doesNotMatch(source, /Object\.assign\(state, normalized\);[\s\S]{0,500}?Object\.assign\(state, PRESS_RELEASE_PRESET\.state\)/);
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
