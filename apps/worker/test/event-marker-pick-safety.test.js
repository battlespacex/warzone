import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const globeSourceUrl = new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url);

test("event marker picking skips zero-sized Cesium drawing buffers", async () => {
  const source = await readFile(globeSourceUrl, "utf8");
  const pickingSection = source.slice(
    source.indexOf("function canRunEventMarkerScenePick"),
    source.indexOf("const MAC_HORIZONTAL_NAVIGATION_MIN_DELTA")
  );

  assert.match(pickingSection, /drawingBufferWidth \?\? 0\) > 0/);
  assert.match(pickingSection, /drawingBufferHeight \?\? 0\) > 0/);
  assert.match(pickingSection, /clientWidth \?\? 0\) > 0/);
  assert.match(pickingSection, /clientHeight \?\? 0\) > 0/);
  assert.match(pickingSection, /try \{\s*return viewer\.scene\.pick\(windowPosition\);\s*\} catch/);
  assert.match(pickingSection, /safePickEventMarkerScene\(viewer, movement\?\.endPosition\)/);
  assert.match(pickingSection, /safePickEventMarkerScene\(viewer, movement\.position\)/);
  assert.doesNotMatch(pickingSection, /viewer\.scene\.pick\(movement\./);
});
