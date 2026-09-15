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

test("entry handoff releases an interactive first map before operational data and dashboard staging complete", async () => {
  const index = await readSource("../../../dev/assets/js/index.js");
  const boot = await readSource("../../../dev/assets/js/warzone-boot.js");
  const background = await readSource("../../../dev/assets/js/warzone-startup-background.js");
  const rootCss = await readSource("../../../dev/assets/css/root.css");
  const componentsCss = await readSource("../../../dev/assets/css/warzone-components.css");

  assert.match(index, /markStartupPerformance\("stratops-region-confirmed"\)/);
  assert.match(index, /playStartupRegionJourney\(viewer, selectedRegion, \{ instant: true \}\)/);
  assert.match(index, /await waitForFirstUsableMap\(viewer\);[\s\S]*?__warzoneEnterApp\?\.\(\)[\s\S]*?initializeOperationalDataAfterMap\(viewer\)/);
  assert.doesNotMatch(index, /viewer\.__warzone\?\.startStartupRotation\?\.\(\)/);
  assert.match(index, /screenSpaceCameraController[\s\S]*?enableInputs = true[\s\S]*?stratops-first-usable-map/);
  assert.match(index, /window\.__warzoneOperationalDataPromise = operationalDataPromise/);
  assert.match(index, /Promise\.allSettled\(\[[\s\S]*?dashboardRevealPromise,[\s\S]*?operationalDataPromise/);
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

test("operational data and status requests are guarded after first-map readiness", async () => {
  const index = await readSource("../../../dev/assets/js/index.js");
  const essential = await readSource("../../../dev/assets/js/essential.js");
  const regions = await readSource("../../../dev/assets/js/warzone-region-selector.js");
  const api = await readSource("../../../dev/assets/js/supabase.js");

  assert.match(index, /async function waitForFirstUsableMap\(viewer\)/);
  assert.match(index, /__warzoneImageryReadyPromise/);
  assert.match(index, /waitForValidOperationalCanvas\(viewer\)/);
  assert.match(index, /waitForOperationalPostRender\(viewer\)/);
  assert.match(index, /stratops-operational-data-start/);
  assert.match(index, /stratops-operational-ready/);
  assert.match(essential, /let __warzoneAppInitPromise = null/);
  assert.match(essential, /export function initWarzoneApp\(\)[\s\S]*?return __warzoneAppInitPromise/);
  assert.match(essential, /const statusRefreshPromise = refreshStatusEvents\(\)[\s\S]*?markStartupPerformance\("stratops-events-render-start"\)/);
  assert.match(essential, /STATUS_REQUEST_TIMEOUT_MS = 8000/);
  assert.match(essential, /api\.getActiveAlerts\(\{ signal: controller\.signal \}\)/);
  assert.match(essential, /api\.getAirspaceStatuses\(\{ signal: controller\.signal \}\)/);
  assert.match(api, /async getActiveAlerts\(options = \{\}\)[\s\S]*?fetch\(`\$\{alertsApiBase\}\/events\/alerts`, options\)/);
  assert.match(api, /async getAirspaceStatuses\(options = \{\}\)[\s\S]*?fetch\(`\$\{API_BASE\}\/events\/airspace-status`, options\)/);
  assert.match(regions, /playStartupRegionJourney\(viewer, region, options = \{\}\)[\s\S]*?if \(instant\) \{[\s\S]*?finalize\(true\)/);
});

test("decorative startup video fades in from black after deferred first-frame readiness", async () => {
  const page = await readSource("../../../dev/pages/index.html");
  const background = await readSource("../../../dev/assets/js/warzone-startup-background.js");
  const css = await readSource("../../../dev/assets/css/warzone-components.css");

  assert.match(page, /id="wz-startup-video"[\s\S]*?preload="none"/);
  assert.doesNotMatch(page, /poster="\/assets\/images\/web\/stratops-og-preview\.jpg"/);
  assert.match(page, /<source data-src="\/assets\/videos\/stratops-startup-v1\.mp4"/);
  assert.doesNotMatch(page, /<source src="\/assets\/videos\/stratops-startup-v1\.mp4"/);
  assert.match(page, /autoplay muted loop playsinline/);
  assert.match(background, /window\.addEventListener\("load", scheduleWhenIdle, \{ once: true \}\)/);
  assert.match(background, /requestIdleCallback\(start, \{ timeout: STARTUP_VIDEO_IDLE_TIMEOUT_MS \}\)/);
  assert.match(background, /video\.dataset\.sourceAttached === "true"/);
  assert.match(background, /stratops-intro-video-request-start/);
  assert.match(background, /stratops-intro-video-metadata/);
  assert.match(background, /stratops-intro-video-first-frame/);
  assert.match(background, /stratops-intro-video-first-frame[\s\S]*?classList\.add\("is-video-ready"\)/);
  assert.match(background, /stratops-intro-video-paused-after-entry/);
  assert.match(background, /function releaseVideoResources[\s\S]*?video\?\.pause[\s\S]*?source\.removeAttribute\("src"\)/);
  assert.match(css, /\.wz-startup-background \{[\s\S]*?background: var\(--color-black\)/);
  assert.match(css, /\.wz-startup-background__video \{[\s\S]*?opacity: 0[\s\S]*?transition: opacity 700ms ease/);
  assert.match(css, /\.wz-startup-background__video\.is-video-ready \{\s*opacity: 1/);
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

test("orbital satellite focus stays independent from monitoring-region boundaries", async () => {
  const satellites = await readSource("../../../dev/assets/js/warzone-mil-sats.js");
  const regions = await readSource("../../../dev/assets/js/warzone-region-selector.js");

  assert.doesNotMatch(satellites, /requestRegionSwitch/);
  assert.doesNotMatch(satellites, /Satellite Outside Selected Region/);
  assert.doesNotMatch(satellites, /skipRegionConfirmation/);
  assert.match(satellites, /returnToSelectedRegion\(\)[\s\S]*?flyToRegion\(viewer, region/);
  assert.match(satellites, /source: "orbital-satellite-unfocus"/);
  assert.match(regions, /focusState\?\.assetType[\s\S]*?=== "satellite"[\s\S]*?focusState\?\.state[\s\S]*?!== "inactive"/);
  assert.match(regions, /satelliteFocusActive[\s\S]*?clearPendingRegionHintRefresh\(\)[\s\S]*?setRegionHintState\(false, viewer\)/);
});

test("satellite focus uses one bounded controller and clears native tracking on unlock", async () => {
  const satellites = await readSource("../../../dev/assets/js/warzone-mil-sats.js");
  const globe = await readSource("../../../dev/assets/js/warzone-globe.js");

  assert.match(satellites, /SATELLITE_FOCUS_VISUAL_HZ = 30/);
  assert.match(satellites, /SATELLITE_FOCUS_CAMERA_HZ = 12/);
  assert.match(satellites, /SATELLITE_FOCUS_POSITION_EPSILON_METERS = 350/);
  assert.match(satellites, /registerTask\([\s\S]*SATELLITE_FOCUS_TASK_KEYS\.visual[\s\S]*\{ hz: SATELLITE_FOCUS_VISUAL_HZ \}/);
  assert.match(satellites, /registerTask\([\s\S]*SATELLITE_FOCUS_TASK_KEYS\.camera[\s\S]*\{ hz: SATELLITE_FOCUS_CAMERA_HZ \}/);
  assert.match(satellites, /positionDelta >= SATELLITE_FOCUS_POSITION_EPSILON_METERS/);
  assert.match(satellites, /viewer\.camera\.lookAt\(/);
  assert.match(satellites, /viewer\.trackedEntity = undefined/);
  assert.doesNotMatch(satellites, /viewer\.trackedEntity = selectedEntity/);
  assert.match(satellites, /resetSatelliteFocusRuntime\(\);[\s\S]*focusController\.exitFocus\("satellite-clear"\)/);
  assert.match(satellites, /controller: "controlled-follow"/);
  assert.match(globe, /getSatelliteFocusStats/);
  assert.match(globe, /stratops-satellite-focus-imagery-stable/);
  assert.match(globe, /stratops-satellite-unlock-stable/);
});

test("aircraft hard lock keeps its reticle centered and couples camera motion to interpolation frames", async () => {
  const source = await readSource("../../../dev/assets/js/warzone-live-airforce.js");
  const rootCss = await readSource("../../../dev/assets/css/root.css");

  assert.doesNotMatch(source, /setLiveTrackHardLockInternal\(true\);\s*bindFocusGuideTracking\(\);/);
  assert.match(source, /focusedTrackAdvanced[\s\S]*?syncFocusedTrackCamera\(\{ motionFrame: true \}\)/);
  assert.match(source, /const forceMotionFrameSync = options\?\.motionFrame === true/);
  assert.match(source, /const forceCameraSync = forceLifecycleSync \|\| forceVisualRefresh \|\| forceMotionFrameSync/);
  assert.match(source, /function getFocusVisualAnchorScreenPosition[\s\S]*?__liveTrackHardLockEnabled[\s\S]*?getViewerCenterScreenPosition\(viewer\)[\s\S]*?const trackScreenPosition/);
  assert.match(source, /--warzone-live-aircraft-focus-camera-sync-hz/);
  assert.match(source, /targetDelta >= positionEpsilonMeters/);
  assert.match(source, /registerTask\("aircraft-camera-lock"[\s\S]*?\{ hz: LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ \}/);
  assert.match(source, /--warzone-live-aircraft-focus-camera-follow-ease", 1/);
  assert.match(rootCss, /--warzone-live-aircraft-focus-camera-follow-ease:\s*1;/);
  assert.match(rootCss, /--warzone-live-aircraft-focus-camera-sync-hz:\s*20;/);
});

test("CTR loads and scopes airbase highlights independently from the military-bases layer", async () => {
  const index = await readSource("../../../dev/assets/js/index.js");
  const bases = await readSource("../../../dev/assets/js/warzone-military-bases.js");

  assert.match(index, /addEventListener\("wz:contour-layer-changed",[\s\S]*?loadBasesModule\(\)/);
  assert.match(bases, /function shouldRetainBaseDataSource\(\)[\s\S]*?__state\.visible \|\| __state\.ctrHighlightsVisible/);
  assert.match(bases, /const shouldShowDataSource = authenticated && \(__state\.visible \|\| __state\.ctrHighlightsVisible\)/);
  assert.match(bases, /function isCtrAirfield\(base = \{\}\)[\s\S]*?military airport\|air station\|afb/);
  assert.match(bases, /text: `AIRFIELD \/ \$\{String\(displayBase\.name/);
  assert.match(bases, /scope\.radius \+ Number\(entity\.__militaryBaseCtrRadius \|\| 0\)/);
  assert.doesNotMatch(bases, /const shouldShow = __state\.visible && !__state\.authGated && __state\.ctrHighlightsVisible/);
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
