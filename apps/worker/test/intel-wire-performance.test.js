import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Intel Wire interactions reuse prepared data without an artificial loading delay", async () => {
  const source = await readSource("../../../dev/assets/js/essential.js");
  const action = source.match(/function runFeedPanelAction\(action\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(action, /requestAnimationFrame/);
  assert.doesNotMatch(action, /setWidgetLoading|minDelayMs|setTimeout/);
  assert.match(source, /renderFeed\(__intelWireLastViewModel \|\| buildIntelWireViewModel\(\)\)/);
  assert.match(source, /buildIntelWireViewModel\(__intelWireLastViewModel\?\.baseEvents\)/);
});

test("Intel Wire panel work is suspended while its widget is hidden", async () => {
  const source = await readSource("../../../dev/assets/js/essential.js");

  assert.match(source, /function isIntelWirePanelActive\(\)/);
  assert.match(source, /function bindIntelWirePanelLifecycle\(\)/);
  assert.match(source, /if \(!isIntelWirePanelActive\(\)\) \{\s*__intelWireRenderPending = true/);
  assert.match(source, /if \(!isIntelWirePanelActive\(\)\) return;\s*refreshIntelWireRelativeTimes/);
  assert.match(source, /stopIntelWireCardMedia\(card\)/);
});

test("Intel Wire cards skip off-screen rendering while preserving layout size", async () => {
  const css = await readSource("../../../dev/assets/css/warzone-components.css");

  assert.match(css, /\.wz-feed-list \.timeline-item \{[\s\S]*?content-visibility:\s*auto/);
  assert.match(css, /\.wz-feed-list \.timeline-item \{[\s\S]*?contain-intrinsic-size:\s*auto 24rem/);
});
