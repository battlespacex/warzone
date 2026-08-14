import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("focused orbital details are promoted ahead of filters using the existing focus state", async () => {
  const source = await readSource("../../../dev/assets/js/warzone-mil-sats.js");
  const css = await readSource("../../../dev/assets/css/warzone-components.css");

  assert.match(source, /controlsPanel\.insertBefore\(details, grid\)/);
  assert.match(source, /FOCUSED ASSET \/ PUBLIC ORBITAL ESTIMATE/);
  assert.match(source, /\["PERIOD", Number\.isFinite\(Number\(record\.orbital\?\.periodMinutes\)\)/);
  assert.match(source, /\["REGION", monitoringRegion\?\.label/);
  assert.match(source, /panelContent\.scrollTo\(\{[\s\S]*?top: 0/);
  assert.match(source, />Unfocus<\/button>/);
  assert.match(css, /\.wz-orbital-widget__details\.is-focus-arriving/);
  assert.doesNotMatch(source, /let\s+focusedSatellite|const\s+focusedSatellite/);
});

test("entry handoff starts the existing globe rotation before synchronized overlay fades", async () => {
  const index = await readSource("../../../dev/assets/js/index.js");
  const boot = await readSource("../../../dev/assets/js/warzone-boot.js");
  const background = await readSource("../../../dev/assets/js/warzone-startup-background.js");
  const rootCss = await readSource("../../../dev/assets/css/root.css");
  const componentsCss = await readSource("../../../dev/assets/css/warzone-components.css");

  assert.match(index, /prepareStartupRegionJourney\(viewer, selectedRegion\);[\s\S]*?viewer\.__warzone\?\.startStartupRotation\?\.\(\)/);
  assert.match(index, /playStartupRegionJourney\(viewer, selectedRegion\)/);
  assert.match(index, /async function fadeOperationalEntryIntoApp\(\)[\s\S]*?SiteLoader\?\.fadeIntoApp\?\.\(\)[\s\S]*?__warzoneReleaseStartupBackground/);
  assert.match(index, /document\.body\.classList\.add\("is-entry-exiting"\)/);
  assert.match(boot, /OPERATIONAL_LOADER_REVEAL_MS = 1000/);
  assert.match(background, /layer\.classList\.add\("is-leaving"\)/);
  assert.match(background, /function releaseVideoResources[\s\S]*?video\?\.pause[\s\S]*?layer\?\.remove\(\)[\s\S]*?classList\.remove\("is-pre-entry"\)/);
  assert.match(background, /beginExit\(\)\.then\(\(\) => \{\s*releaseVideoResources\(layer, video\)/);
  assert.match(rootCss, /--stratops-loader-exit-duration:\s*1000ms/);
  assert.match(rootCss, /--stratops-startup-video-exit-duration:\s*1000ms/);
  assert.match(rootCss, /--stratops-startup-video-exit-delay:\s*0ms/);
  assert.doesNotMatch(componentsCss, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.wz-startup-background,/);
});

test("real satellite focus reuses scene-mode switching and waits for 3D before camera focus", async () => {
  const source = await readSource("../../../dev/assets/js/warzone-mil-sats.js");

  assert.match(source, /async function ensure3DModeBeforeSatelliteFocus\(viewer\)/);
  assert.match(source, /setSceneMode\("3d", \{ source: "satellite-focus" \}\)/);
  assert.match(source, /morphComplete\?\.addEventListener\?\.\(finish\)/);
  assert.match(source, /state\.focusPendingId = selectedId;[\s\S]*?ensure3DModeBeforeSatelliteFocus\(viewer\)[\s\S]*?commitSatelliteSelection\(selectedId, options\)/);
  assert.match(source, /focusController\.canEnterFocus\([\s\S]*?ensure3DModeBeforeSatelliteFocus\(viewer\)/);
  assert.match(source, /selectSatellite\(primaryRecord\.id\)/);
  assert.match(source, /selectSatellite\(entity\.__wzOrbitalId\)/);
  assert.doesNotMatch(source, /\.morphTo3D\(/);
});

test("every dashboard entry applies the authoritative map-layer defaults before widget initialization", async () => {
  const layers = await readSource("../../../dev/assets/js/warzone-layers.js");
  const boot = await readSource("../../../dev/assets/js/warzone-boot.js");
  const regionSelector = await readSource("../../../dev/assets/js/warzone-region-selector.js");

  const expectedDefaults = {
    strikes: true,
    missiles: true,
    drones: true,
    airstrikes: true,
    aircraft: false,
    airspace: false,
    naval: false,
    "military-bases": false,
    gnss: false,
    ranges: true,
    sweepers: true,
    alerts: true,
    cyber: false,
    thermal: true,
    recon: true,
    seismic: true,
    hotspots: true,
    aoi: false,
    "orbital-assets": false,
    "satellite-imagery": true,
    terrain: true,
    "map-labels": false,
    "region-plate": false,
    "country-borders": false,
  };

  const defaultsMatch = layers.match(/export const DASHBOARD_DEFAULT_LAYER_STATE = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(defaultsMatch, "central dashboard layer defaults must be defined");
  const parsedDefaults = Object.fromEntries(
    [...defaultsMatch[1].matchAll(/(?:"([^"]+)"|([a-z][a-z-]*)):\s*(true|false)/g)]
      .map((match) => [match[1] || match[2], match[3] === "true"])
  );
  assert.deepEqual(parsedDefaults, expectedDefaults);

  const loadStateBody = layers.match(/function loadState\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(loadStateBody, /localStorage|getItem|saved/);
  assert.match(loadStateBody, /DASHBOARD_DEFAULT_LAYER_STATE\[layer\.id\] === true/);
  assert.match(layers, /if \(DASHBOARD_DEFAULT_LAYER_STATE\[id\] === true\) return true/);
  assert.match(boot, /resetLayerStateForFreshLoad\(\);\s*loadWidgetState\(\);/);
  assert.match(regionSelector, /setBorderLayersVisible\?\.\(\s*isLayerEnabled\("country-borders"\)/);
  assert.doesNotMatch(regionSelector, /localStorage\.getItem\("wz_layer_state"\)/);
});

test("poster generator stacks editor, preview, and export with normal mobile document scrolling", async () => {
  const html = await readSource("../../../dev/pages/poster.html");
  const css = await readSource("../../../dev/assets/css/root.css");

  assert.match(html, /class="poster-generator-document"/);
  assert.match(html, /class="controls"[\s\S]*?class="poster-editor"[\s\S]*?class="export-panel"[\s\S]*?class="preview-area"/);
  assert.match(css, /\.poster-generator-page \.app-shell\s*\{[\s\S]*?grid-template-columns:\s*30vw 1fr/);
  assert.match(css, /\.poster-generator-page \.controls\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.poster-generator-page \.export-panel\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /\.poster-generator-page \.preview-area\s*\{[\s\S]*?height:\s*100vh/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?html\.poster-generator-document[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.poster-generator-page \.controls\s*\{\s*display:\s*contents/);
  assert.match(css, /\.poster-generator-page \.poster-editor\s*\{[\s\S]*?order:\s*1/);
  assert.match(css, /\.poster-generator-page \.preview-area\s*\{[\s\S]*?order:\s*2/);
  assert.match(css, /\.poster-generator-page \.export-panel\s*\{[\s\S]*?position:\s*static;[\s\S]*?order:\s*3/);
  assert.match(css, /\.poster-generator-page #posterCanvas\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*auto/);
});
