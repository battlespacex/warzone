import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Dev Panel remains unmounted while disabled and retains an explicit re-enable path", async () => {
  const config = await readSource("../../../dev/assets/js/stratops-feature-config.js");
  const loader = await readSource("../../../dev/assets/js/pre-entry-dev-panel.js");
  const essential = await readSource("../../../dev/assets/js/essential.js");

  assert.match(config, /devPanel:\s*false/);
  assert.match(loader, /if \(!isStratOpsFeatureEnabled\("system\.devPanel"\)\) return null/);
  assert.match(loader, /import\.meta\.env\?\.DEV\s*===\s*true/);
  assert.match(loader, /hostname\.includes\("staging"\)/);
  assert.match(loader, /document\.body\.insertAdjacentHTML\("beforeend", html\)/);
  assert.match(loader, /\/warzone\/partials\/dev-panel\.html/);
  assert.match(essential, /if \(isStratOpsFeatureEnabled\("system\.devPanel"\) && isDevInspectionEnvironment\(\)\) \{\s*import\("\.\/pre-entry-dev-panel\.js"\)/);
  assert.doesNotMatch(loader, /devpanel=1|wz_dev/);
});

test("entry scene tuner stays outside the page and live DOM while disabled", async () => {
  const config = await readSource("../../../dev/assets/js/stratops-feature-config.js");
  const showcase = await readSource("../../../dev/assets/js/pre-entry-showcase.js");
  const showcasePartial = await readSource("../../../dev/partials/pre-entry-showcase.html");
  const tunerPartial = await readSource("../../../dev/partials/entry-scene-tuner.html");

  assert.match(config, /entrySceneTuner:\s*false/);
  assert.match(showcase, /const tunerEnabled = isLocalDev && isStratOpsFeatureEnabled\("system\.entrySceneTuner"\)/);
  assert.match(showcase, /if \(!overlay \|\| !isStratOpsFeatureEnabled\("system\.entrySceneTuner"\)\) return null/);
  assert.match(showcase, /await mountEntrySceneTuner\(overlay\)/);
  assert.match(showcase, /tunerEnabled\s*\? import\("\.\/warzone-startup-scene-tuner\.js"\)/);
  assert.doesNotMatch(showcasePartial, /id="wz-intro-startup-scene-tuner"/);
  assert.match(tunerPartial, /id="wz-intro-startup-scene-tuner"/);
});

test("visual inspection controls use the existing operational renderers", async () => {
  const panel = await readSource("../../../dev/assets/js/warzone-dev-panel.js");
  const partial = await readSource("../../../dev/partials/dev-panel.html");

  for (const id of [
    "wz-dev-radar-enable",
    "wz-dev-radar-disable",
    "wz-dev-radar-force",
    "wz-dev-satellite-viewer-open",
    "wz-dev-satellite-trigger-locate",
    "wz-dev-popup-open",
    "wz-dev-popup-freeze",
    "wz-dev-popup-resume",
    "wz-dev-hotspot-regional",
    "wz-dev-hotspot-stack",
    "wz-dev-hotspot-locality",
  ]) {
    assert.match(partial, new RegExp(`id="${id}"`));
  }

  assert.match(panel, /setLayer\("sweepers", true\)/);
  assert.match(panel, /setLayer\("satellite-imagery", true\)/);
  assert.match(panel, /function getDevRadarFixture\(\)[\s\S]*?getDevEventPreviewPlacement\(\)/);
  assert.match(panel, /renderSweepers\(window\.__warzoneViewer, \[getDevRadarFixture\(\)\]\)/);
  assert.match(panel, /initDevPanelSectionFilter\(\);\s*showFullDevPanel\(\);/);
  assert.match(panel, /openSatelliteImageryViewer\(getDevSatelliteObservationDetail\(\)\)/);
  assert.match(panel, /window\.__hotspotLayer/);
  assert.match(panel, /setDevInspectionPreview\(\{ events: buildDevHotspotPreviewEvents\(\), zoomState \}\)/);
  assert.doesNotMatch(panel, /supabase\.(?:from|insert|upsert)/i);
});

test("popup freeze blocks replacement, dismissal and anchor loss only while enabled", async () => {
  const essential = await readSource("../../../dev/assets/js/essential.js");

  assert.match(essential, /if \(__eventPopupDevInspectionFrozen && options\?\.force !== true\) return;/);
  assert.match(essential, /if \(__eventPopupDevInspectionFrozen\) return;\s*const screenPosition = getPopupAnchorScreenPosition\(\)/);
  assert.match(essential, /if \(__eventPopupDevInspectionFrozen && detail\?\.devInspectionPreview !== true\) return;/);
  assert.match(essential, /export function setDevEventPopupInspectionFrozen/);
});

test("satellite viewer and trigger stay on the real component/entity paths", async () => {
  const essential = await readSource("../../../dev/assets/js/essential.js");
  const globe = await readSource("../../../dev/assets/js/warzone-globe.js");

  assert.match(essential, /export function openSatelliteImageryViewer\(detail = \{\}\)/);
  assert.match(essential, /const viewer = ensureSatelliteImageryViewer\(\)/);
  assert.match(essential, /wz-satellite-imagery-viewer__panel/);
  assert.match(globe, /isSatelliteImageryMarker:\s*true/);
  assert.match(globe, /Satellite Observation - open imagery viewer/);
  assert.match(globe, /disableDepthTestDistance:\s*Number\.POSITIVE_INFINITY/);
});

test("hotspot DEV preview is isolated and live events remain stored", async () => {
  const hotspots = await readSource("../../../dev/assets/js/warzone-hotspots.js");

  assert.match(hotspots, /const renderedEvents = devInspectionPreview\?\.events \|\| allEvents/);
  assert.match(hotspots, /setDevInspectionPreview\(/);
  assert.match(hotspots, /clearDevInspectionPreview\(\)/);
  assert.match(hotspots, /devInspectionPreview = null/);
});
