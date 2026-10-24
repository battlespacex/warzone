import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = fs.readFileSync(path.join(root, "dev/assets/js/warzone-globe.js"), "utf8");
const aircraftSource = fs.readFileSync(path.join(root, "dev/assets/js/warzone-live-airforce.js"), "utf8");
const css = fs.readFileSync(path.join(root, "dev/assets/css/root.css"), "utf8");
const cesiumRoot = path.join(root, "node_modules/cesium/Build/Cesium");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
const implementation = ["cssVar", "numberVar", "boolVar", "colorFromCssVar", "lerp", "clamp01",
  "getContourOverlayState", "getContourFocusProfile", "smoothContourFade", "raiseContourGridPrimitive",
  "destroyContourGridPrimitive", "updateContourGridPrimitiveCenter", "chooseOperationalGridIntervalMeters",
  "getFocusedCtrRadarConfig", "addContourGridRing", "ensureContourGridPrimitive", "setContourGridCenter",
].map(extract).join("\n");

test("real Cesium CTR rings/grid fit unchanged air/naval Focus cameras and respond to configuration", { timeout: 120000 }, async t => {
  const executablePath = process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (!fs.existsSync(executablePath)) return t.skip("Set STRATOPS_TEST_CHROME to an installed Chrome executable");
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://ctr.test/**", async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body:
      '<html><head><style>html,body{margin:0;overflow:hidden}canvas{display:block}</style></head><body><canvas id="globe"></canvas><script>window.CESIUM_BASE_URL="/cesium/"</script><script src="/cesium/Cesium.js"></script></body></html>' });
    const local = path.resolve(cesiumRoot, pathname.replace(/^\/cesium\//, ""));
    if (!local.startsWith(cesiumRoot + path.sep) || !fs.existsSync(local)) return route.fulfill({ status: 404, body: "" });
    const contentType = local.endsWith(".js") ? "application/javascript" : local.endsWith(".json") ? "application/json" : "application/octet-stream";
    return route.fulfill({ body: fs.readFileSync(local), contentType });
  });
  await page.goto("http://ctr.test/", { waitUntil: "load" });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: implementation });
  const initialRangeStart = aircraftSource.indexOf("function getAircraftInitialFocusCameraConfig(");
  const initialRange = aircraftSource.slice(initialRangeStart, aircraftSource.indexOf("\n}", initialRangeStart) + 2);
  await page.addScriptTag({ content: `
    const LIVE_TRACK_FOCUS_CAMERA_PITCH_MIN_DEG = -89, LIVE_TRACK_FOCUS_CAMERA_PITCH_MAX_DEG = -8;
    const LIVE_TRACK_FOCUS_CAMERA_RANGE_MIN_METERS = 500;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const feetToMeters = feet => feet * 0.3048;
    const getTrackReportedAltitudeFt = track => track.altitude_ft;
    const getLiveTrackFocusCameraRangeMeters = () => numberVar('--warzone-live-aircraft-focus-camera-range', 2400);
    const getLiveTrackFocusAltitudeOffsetFt = () => numberVar('--warzone-live-aircraft-focus-altitude-offset-ft', 7000);
    const getLiveTrackFocusFinalRangeMeters = () => numberVar('--warzone-live-aircraft-focused-max-zoom-out', 90000);
    ${initialRange}
  ` });
  await page.evaluate(() => {
    const canvas = document.getElementById("globe");
    canvas.width = innerWidth; canvas.height = innerHeight;
    const scene = new Cesium.Scene({ canvas, contextOptions: { webgl: { preserveDrawingBuffer: true } } });
    scene.globe = new Cesium.Globe();
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#080d15");
    window.testViewer = { scene, __contourGridLayerVisible: true };
  });
  const results = [];
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 },
    { width: 3440, height: 1440 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(viewport);
    for (const profile of ["aircraft", "naval"]) {
      const result = await page.evaluate(async ({ profile, viewport }) => {
        const viewer = window.testViewer, scene = viewer.scene, canvas = scene.canvas;
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
        scene.camera.frustum.aspectRatio = viewport.width / viewport.height;
        const state = getContourOverlayState(viewer);
        state.hasFocusPosition = true; state.focusProfile = profile;
        const center = { lon: 50, lat: 26, height: profile === "aircraft" ? 18000 : 0 };
        state.centerHeight = center.height;
        const pitch = numberVar(`--warzone-live-${profile}-focus-camera-pitch`, -58);
        const range = profile === "aircraft"
          ? getAircraftInitialFocusCameraConfig({ altitude_ft: center.height / 0.3048 },
              Cesium.Cartesian3.fromDegrees(center.lon, center.lat, center.height), null, pitch).rangeMeters
          : numberVar("--warzone-live-naval-ctr-focused-distance", 24000);
        const aim = () => scene.camera.lookAt(Cesium.Cartesian3.fromDegrees(center.lon, center.lat, center.height),
          new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(pitch), range));
        const draw = async () => { for (let i = 0; i < 4; i++) {
          await new Promise(requestAnimationFrame); scene.initializeFrame(); scene.render(Cesium.JulianDate.now());
        } };
        aim(); ensureContourGridPrimitive(viewer, center); await draw();
        const primitive = state.gridPrimitive;
        const rings = Array.from({ length: primitive.length }, (_, i) => primitive.get(i)).filter(line => line.positions.length > 2);
        const points = rings.flatMap(ring => ring.positions.map(local => {
          const world = Cesium.Matrix4.multiplyByPoint(primitive.modelMatrix, local, new Cesium.Cartesian3());
          return Cesium.SceneTransforms.worldToWindowCoordinates(scene, world);
        }));
        const complete = points.every(point => point && point.x > 10 && point.x < viewport.width - 10 && point.y > 10 && point.y < viewport.height - 10);
        const context = scene.context._gl;
        const pixels = new Uint8Array(viewport.width * viewport.height * 4);
        context.readPixels(0, 0, viewport.width, viewport.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
        let redPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 25 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.2) redPixels++;
        center.lon += 0.01; center.lat += 0.005; center.height += profile === "aircraft" ? 50 : 0;
        setContourGridCenter(viewer, center); aim(); await draw();
        const geographic = Cesium.Cartographic.fromCartesian(Cesium.Matrix4.getTranslation(primitive.modelMatrix, new Cesium.Cartesian3()));
        return { profile, width: viewport.width, ringCount: rings.length, complete, redPixels,
          gridLines: primitive.length - rings.length, reused: primitive === state.gridPrimitive,
          lonError: Math.abs(Cesium.Math.toDegrees(geographic.longitude) - center.lon),
          altitudeError: Math.abs(geographic.height - center.height - 1),
          range, config: getFocusedCtrRadarConfig(viewer), ringWidths: rings.map(line => line.width) };
      }, { profile, viewport });
      assert.equal(result.ringCount, 2, JSON.stringify(result));
      assert.equal(result.complete, true, JSON.stringify(result));
      assert.ok(result.redPixels > 100, JSON.stringify(result));
      assert.ok(result.gridLines > 0);
      assert.equal(result.reused, true);
      assert.ok(result.lonError < 1e-8);
      assert.ok(result.altitudeError < 0.01);
      assert.deepEqual(result.ringWidths, [1.5, 1.5]);
      results.push(result);
      if (viewport.width === 1920) {
        await page.screenshot({ path: path.join(os.tmpdir(), `stratops-ctr-${profile}.png`) });
      }
    }
  }
  const tuning = await page.evaluate(() => {
    const viewer = window.testViewer, state = getContourOverlayState(viewer);
    const original = state.gridPrimitive;
    for (const [name, value] of Object.entries({ "inner-radius": 1000, "outer-radius": 2000,
      "ring-width": 3, "grid-width": 2, "grid-spacing": 250, "ring-count": 3, scale: 0.5 })) {
      document.documentElement.style.setProperty(`--warzone-naval-ctr-radar-${name}`, String(value));
    }
    ensureContourGridPrimitive(viewer);
    const config = getFocusedCtrRadarConfig(viewer);
    const lines = Array.from({ length: state.gridPrimitive.length }, (_, i) => state.gridPrimitive.get(i));
    const rings = lines.filter(line => line.positions.length > 2);
    const rebuilt = state.gridPrimitive !== original;
    viewer.__contourGridLayerVisible = false; updateContourGridPrimitiveCenter(viewer);
    const hidden = state.gridPrimitive.show === false;
    viewer.__contourGridLayerVisible = true; updateContourGridPrimitiveCenter(viewer);
    const restored = state.gridPrimitive.show === true;
    state.focusProfile = "aircraft";
    const aircraftConfig = getFocusedCtrRadarConfig(viewer);
    return { config, rebuilt, hidden, restored, aircraftConfig,
      ringWidths: rings.map(line => line.width), radii: rings.map(line => Math.hypot(line.positions[0].x, line.positions[0].y)),
      gridWidths: [...new Set(lines.filter(line => line.positions.length === 2).map(line => line.width))] };
  });
  assert.equal(tuning.rebuilt, true);
  assert.equal(tuning.hidden && tuning.restored, true);
  assert.deepEqual(tuning.radii, [500, 750, 1000]);
  assert.deepEqual(tuning.ringWidths, [3, 3, 3]);
  assert.ok(tuning.gridWidths.includes(2));
  assert.equal(tuning.config.spacing, 125);
  assert.equal(tuning.aircraftConfig.outerRadius, 300);
  assert.equal(errors.length, 0, errors.join("\n"));
  const sharedTuning = await page.evaluate(() => {
    const viewer = window.testViewer, state = getContourOverlayState(viewer);
    for (const name of ["inner-radius", "outer-radius", "ring-width", "grid-width", "grid-spacing", "ring-count", "scale"]) {
      document.documentElement.style.removeProperty(`--warzone-naval-ctr-radar-${name}`);
    }
    document.documentElement.style.setProperty("--warzone-ctr-radar-ring-width", "2.25");
    document.documentElement.style.setProperty("--warzone-ctr-radar-grid-width", "1.25");
    return ["aircraft", "naval"].map(profile => {
      state.focusProfile = profile;
      ensureContourGridPrimitive(viewer);
      const lines = Array.from({ length: state.gridPrimitive.length }, (_, i) => state.gridPrimitive.get(i));
      return { profile, ringWidths: lines.filter(line => line.positions.length > 2).map(line => line.width),
        gridWidth: Math.min(...lines.filter(line => line.positions.length === 2).map(line => line.width)) };
    });
  });
  for (const profile of sharedTuning) {
    assert.deepEqual(profile.ringWidths, [2.25, 2.25]);
    assert.equal(profile.gridWidth, 1.25);
  }
  t.diagnostic(JSON.stringify({ results, tuning, sharedTuning }));
  await page.evaluate(() => window.testViewer.scene.destroy());
});
