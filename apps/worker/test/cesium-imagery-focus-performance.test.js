import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("focus transitions reduce tile pressure without degrading settled imagery quality", async () => {
  const globe = await readSource("../../../dev/assets/js/warzone-globe.js");
  const css = await readSource("../../../dev/assets/css/root.css");

  assert.match(globe, /const focusSceneSettled = isFocusedAssetMode && !isCameraMoving && !tileLoadBusy/);
  assert.match(globe, /if \(focusSceneSettled\) \{[\s\S]*?nextResolution = Math\.max\(nextResolution, baseResolution\)[\s\S]*?nextMsaaSamples = Math\.max\(nextMsaaSamples, baseMsaaSamples\)[\s\S]*?nextSse = Math\.min\(nextSse, baseSse\)/);
  assert.match(globe, /if \(isFocusedAssetMode && !focusSceneSettled\)/);
  assert.match(globe, /tileCacheCap:\s*420/);
  assert.match(css, /--warzone-focus-performance-tile-cache:\s*420;/);
  assert.match(css, /--warzone-globe-tile-cache-size:\s*420;/);
  assert.match(css, /--warzone-globe-tile-cache-moving:\s*420;/);
  assert.match(css, /--warzone-globe-tile-cache-loading:\s*420;/);
  assert.match(css, /--warzone-globe-max-screen-space-error:\s*1\.65;/);
  assert.match(css, /--warzone-globe-moving-screen-space-error:\s*2\.65;/);
  assert.match(css, /--warzone-max-zoom-screen-space-error:\s*0\.55;/);
  assert.match(css, /--warzone-globe-loading-descendant-limit:\s*24;/);
  assert.match(css, /--warzone-globe-loading-descendant-limit-busy:\s*10;/);
  assert.match(css, /--warzone-globe-preload-ancestors:\s*1;/);
  assert.match(css, /--warzone-globe-preload-siblings:\s*0;/);
  assert.match(globe, /requestRenderMode:\s*true/);
  assert.match(globe, /viewer\.scene\.maximumRenderTimeChange = Infinity/);
});

test("development-safe Cesium diagnostics expose throttled camera and imagery evidence", async () => {
  const globe = await readSource("../../../dev/assets/js/warzone-globe.js");

  assert.match(globe, /enableCesiumPerformanceDiagnostics === true/);
  assert.match(globe, /hostname === "localhost"/);
  assert.match(globe, /window\.__stratopsPerf = Object\.freeze/);
  assert.match(globe, /getCameraStats/);
  assert.match(globe, /getImageryStats/);
  assert.match(globe, /getFocusStats/);
  assert.match(globe, /getTileNetworkStats/);
  assert.match(globe, /getTileCacheStats/);
  assert.match(globe, /getImageryLatencyStats/);
  assert.match(globe, /beginImagerySample/);
  assert.match(globe, /endImagerySample/);
  assert.match(globe, /PerformanceObserver/);
  assert.match(globe, /World_Imagery\\\/MapServer\\\/tile/);
  assert.match(globe, /stratops-imagery-request-burst-start/);
  assert.match(globe, /stratops-imagery-request-burst-end/);
  assert.match(globe, /stratops-imagery-cache-hit-revisit/);
  assert.match(globe, /stratops-imagery-settled/);
  assert.match(globe, /__warzoneAttachImageryProviderDiagnostics/);
  assert.doesNotMatch(globe, /baseProvider\.requestImage\s*=/);
  assert.match(globe, /wrapCameraMethod\("lookAt", "cameraLookAts"\)/);
  assert.match(globe, /wrapCameraMethod\("setView", "cameraSetViews"\)/);
  assert.match(globe, /wrapCameraMethod\("flyTo", "cameraFlyTos"\)/);
  assert.match(globe, /stratops-focus-camera-stable/);
  assert.match(globe, /stratops-focus-imagery-stable/);
  assert.match(globe, /stratops-focus-unlock-stable/);
  assert.doesNotMatch(globe.match(/function installCesiumPerformanceDiagnostics[\s\S]*?\n\}/)?.[0] || "", /requestAnimationFrame/);
});

test("aircraft and naval focus cameras use bounded rates and meaningful-change thresholds", async () => {
  const aircraft = await readSource("../../../dev/assets/js/warzone-live-airforce.js");
  const naval = await readSource("../../../dev/assets/js/warzone-live-naval.js");
  const css = await readSource("../../../dev/assets/css/root.css");

  assert.match(aircraft, /LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ = 20/);
  assert.match(aircraft, /targetDelta >= positionEpsilonMeters/);
  assert.match(aircraft, /headingDelta >= 0\.02/);
  assert.match(aircraft, /viewer\.__warzoneRecordFocusCameraUpdate\?\.\("aircraft"\)/);
  assert.match(aircraft, /registerTask\("aircraft-camera-lock"[\s\S]*?\{ hz: LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ \}/);

  assert.match(naval, /NAVAL_FOCUS_CAMERA_SYNC_HZ = 20/);
  assert.match(naval, /targetDelta < positionEpsilonMeters/);
  assert.match(naval, /headingDelta < 0\.02/);
  assert.match(naval, /viewer\.__warzoneRecordFocusCameraUpdate\?\.\("naval"\)/);
  assert.match(naval, /registerTask\("naval-camera-lock"[\s\S]*?\{ hz: NAVAL_FOCUS_CAMERA_SYNC_HZ \}/);

  assert.match(css, /--warzone-live-aircraft-focus-camera-sync-hz:\s*20;/);
  assert.match(css, /--warzone-live-aircraft-focus-camera-position-epsilon:\s*4;/);
  assert.match(css, /--warzone-live-naval-focus-camera-sync-hz:\s*20;/);
  assert.match(css, /--warzone-live-naval-focus-camera-position-epsilon:\s*2;/);
});
