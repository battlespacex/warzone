import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Dev Panel loads only for development, localhost or staging hosts", async () => {
  const loader = await readSource("../../../dev/assets/js/pre-entry-dev-panel.js");
  const essential = await readSource("../../../dev/assets/js/essential.js");

  assert.match(loader, /import\.meta\.env\?\.DEV\s*===\s*true/);
  assert.match(loader, /hostname\.includes\("staging"\)/);
  assert.match(loader, /document\.body\.insertAdjacentHTML\("beforeend", html\)/);
  assert.match(loader, /\/warzone\/partials\/dev-panel\.html/);
  assert.match(essential, /if \(isDevInspectionEnvironment\(\)\) \{\s*import\("\.\/pre-entry-dev-panel\.js"\)/);
  assert.doesNotMatch(loader, /devpanel=1|wz_dev/);
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
