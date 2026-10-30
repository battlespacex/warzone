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
  "updateContourGridDrawMatrix", "createContourGridDrawPrimitive",
  "destroyContourGridPrimitive", "fitContourGridToSurface", "updateContourGridPrimitiveCenter", "chooseOperationalGridIntervalMeters",
  "getFocusedCtrRadarConfig", "addContourGridRing", "ensureContourGridPrimitive", "setContourGridCenter",
].map(extract).join("\n");

test("real Cesium surface CTR renders at low-altitude Focus and follows elevated terrain", { timeout: 240000 }, async t => {
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
  await page.goto("http://ctr.test/", { waitUntil: "commit" });
  await page.waitForFunction(() => Boolean(window.Cesium));
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
    const scene = new Cesium.Scene({ canvas, scene3DOnly: true, contextOptions: { webgl: { preserveDrawingBuffer: true } } });
    scene.globe = new Cesium.Globe();
    scene.globe.baseColor = Cesium.Color.fromCssColorString("#080d15");
    window.testViewer = { scene, __contourGridLayerVisible: true };
  });
  const results = [];
  const viewports = process.env.STRATOPS_CTR_SURFACE_ONLY === "1" ? [] : [
    { width: 1920, height: 1080 }, { width: 2560, height: 1440 },
    { width: 3440, height: 1440 }, { width: 3840, height: 2160 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const profile of ["aircraft", "naval"]) {
      const result = await page.evaluate(async ({ profile, viewport }) => {
        const viewer = window.testViewer, scene = viewer.scene, canvas = scene.canvas;
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
        scene.camera.frustum.aspectRatio = viewport.width / viewport.height;
        const state = getContourOverlayState(viewer);
        state.hasFocusPosition = true; state.focusProfile = profile;
        const center = { lon: 50, lat: 26, height: profile === "aircraft" ? 20 : 0 };
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
        aim();
        const extentVariable = `--warzone-${profile}-ctr-radar-extent-scale`;
        const configuredExtentScale = numberVar(extentVariable, 1);
        document.documentElement.style.setProperty(extentVariable, '1');
        ensureContourGridPrimitive(viewer, center);
        const baseConfig = getFocusedCtrRadarConfig(viewer);
        const baseRings = Array.from({ length: state.gridPrimitive.length }, (_, i) => state.gridPrimitive.get(i)).filter(line => line.positions.length > 2);
        const baseRadii = baseRings.map(line => Math.hypot(line.positions[0].x, line.positions[0].y));
        const baseColors = baseRings.map(line => line.material.uniforms.color.toCssColorString());
        document.documentElement.style.removeProperty(extentVariable);
        ensureContourGridPrimitive(viewer, center);
        for (let frame = 0; frame < 120 && !state.gridDrawPrimitive?.ready; frame++) await draw(1);
        await draw();
        const primitive = state.gridPrimitive;
        const rings = Array.from({ length: primitive.length }, (_, i) => primitive.get(i)).filter(line => line.positions.length > 2);
        const points = rings.flatMap(ring => ring.positions.map(local => {
          const world = Cesium.Matrix4.multiplyByPoint(primitive.modelMatrix, local, new Cesium.Cartesian3());
          return Cesium.SceneTransforms.worldToWindowCoordinates(scene, world);
        }));
        const vertexHeights = rings.flatMap(ring => ring.positions.map(local => Cesium.Cartographic.fromCartesian(
          Cesium.Matrix4.multiplyByPoint(primitive.modelMatrix, local, new Cesium.Cartesian3())).height));
        const complete = points.every(point => point && point.x > 10 && point.x < viewport.width - 10 && point.y > 10 && point.y < viewport.height - 10);
        const context = scene.context._gl;
        const pixels = new Uint8Array(viewport.width * viewport.height * 4);
        context.readPixels(0, 0, viewport.width, viewport.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
        let redPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 25 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.2) redPixels++;
        center.lon += 0.01; center.lat += 0.005; center.height += profile === "aircraft" ? 5 : 0;
        setContourGridCenter(viewer, center); aim(); await draw();
        const geographic = Cesium.Cartographic.fromCartesian(Cesium.Matrix4.getTranslation(primitive.modelMatrix, new Cesium.Cartesian3()));
        return { profile, width: viewport.width, ringCount: rings.length, complete, redPixels,
          radiusRatios: rings.map((line, i) => Math.hypot(line.positions[0].x, line.positions[0].y) / baseRadii[i]),
          colorsUnchanged: rings.every((line, i) => line.material.uniforms.color.toCssColorString() === baseColors[i]),
          spacingBounded: getFocusedCtrRadarConfig(viewer).spacing ===
            Math.max(getFocusedCtrRadarConfig(viewer).outerRadius / 32, baseConfig.spacing),
          minHeight: Math.min(...vertexHeights), maxHeight: Math.max(...vertexHeights), firstPoint: points[0],
          gridLines: primitive.length - rings.length, reused: primitive === state.gridPrimitive,
          lonError: Math.abs(Cesium.Math.toDegrees(geographic.longitude) - center.lon),
          altitudeError: Math.abs(geographic.height - 1),
          range, config: getFocusedCtrRadarConfig(viewer), ringWidths: rings.map(line => line.width), configuredExtentScale };
      }, { profile, viewport });
      assert.equal(result.ringCount, 2, JSON.stringify(result));
      // Report aircraft viewport clipping without changing its explicitly fixed
      // camera or reducing the newly requested geographic extent to hide it.
      if (profile === "naval") assert.equal(result.complete, true, JSON.stringify(result));
      assert.deepEqual(result.radiusRatios, [result.configuredExtentScale, result.configuredExtentScale]);
      assert.equal(result.colorsUnchanged && result.spacingBounded, true);
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
  const repeated = await page.evaluate(() => {
    const viewer = window.testViewer, state = getContourOverlayState(viewer);
    for (let i = 0; i < 12; i++) for (const profile of ['aircraft', 'naval']) {
      state.hasFocusPosition = true; state.focusProfile = profile;
      ensureContourGridPrimitive(viewer, { lon: 50, lat: 26, height: 12000 });
      const primitive = state.gridPrimitive;
      const expected = profile === 'aircraft'
        ? 300 * numberVar('--warzone-aircraft-ctr-radar-extent-scale', 1)
        : 3000 * numberVar('--warzone-naval-ctr-radar-extent-scale', 1);
      if (getFocusedCtrRadarConfig(viewer).outerRadius !== expected) return false;
      for (let repeat = 0; repeat < 3; repeat++) ensureContourGridPrimitive(viewer, { lon: 50, lat: 26, height: 12000 });
      if (state.gridPrimitive !== primitive || viewer.scene.primitives.length !== 1) return false;
    }
    return true;
  });
  assert.equal(repeated, true, 'repeated profile changes do not accumulate scaling or duplicate overlays');
  await page.setViewportSize({ width: 1280, height: 720 });
  const surfaceResults = await page.evaluate(async () => {
    const viewer = window.testViewer, scene = viewer.scene;
    scene.canvas.width = 1280; scene.canvas.height = 720;
    scene.canvas.style.width = '1280px'; scene.canvas.style.height = '720px';
    scene.camera.frustum.aspectRatio = 1280 / 720;
    const state = getContourOverlayState(viewer);
    const draw = async (frames = 12) => { for (let i = 0; i < frames; i++) {
      await new Promise(requestAnimationFrame); scene.initializeFrame(); scene.render(Cesium.JulianDate.now());
    } };
    const settle = async center => {
      for (let frames = 0; frames < 500; frames++) {
        // Mirror the live tracking updates while terrain fitting yields.
        updateContourGridPrimitiveCenter(viewer, center);
        await draw(1);
        const primitive = state.gridPrimitive;
        if (scene.globe.tilesLoaded && primitive.__surfaceTilesLoaded === true &&
          !primitive.__surfaceNeedsRefresh && !primitive.__surfaceFitFrame && primitive.__surfaceFitCenter && Cesium.Cartesian3.equals(
          primitive.__surfaceFitCenter, Cesium.Matrix4.getTranslation(primitive.modelMatrix, new Cesium.Cartesian3()))) return;
      }
      throw new Error('surface fitting did not settle at the current target position');
    };
    const tilingScheme = new Cesium.GeographicTilingScheme();
    const terrain = new Cesium.CustomHeightmapTerrainProvider({ width: 32, height: 32, tilingScheme,
      callback: (x, y, level) => {
        const rectangle = tilingScheme.tileXYToRectangle(x, y, level);
        const values = new Float32Array(32 * 32);
        for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
          const lon = Cesium.Math.toDegrees(Cesium.Math.lerp(rectangle.west, rectangle.east, col / 31));
          const lat = Cesium.Math.toDegrees(Cesium.Math.lerp(rectangle.north, rectangle.south, row / 31));
          values[row * 32 + col] = Math.max(0, 1800 + 900 * Math.sin((lon - 50) * 20) + 600 * Math.sin((lat - 26) * 20));
        }
        return values;
      } });
    scene.globe.terrainProvider = terrain;
    viewer.terrainProvider = terrain;
    scene.globe.depthTestAgainstTerrain = true;
    const measurements = [];
    for (const profile of ['aircraft', 'naval']) {
      state.hasFocusPosition = true; state.focusProfile = profile;
      const center = { lon: 50, lat: 26, height: profile === 'aircraft' ? 18000 : 500 };
      // Diagnostic ground overview, not a change to the application's Focus camera.
      scene.camera.lookAt(Cesium.Cartesian3.fromDegrees(50, 26, 1800),
        new Cesium.HeadingPitchRange(0, -Math.PI / 2, profile === 'aircraft' ? 1800 : 18000));
      ensureContourGridPrimitive(viewer, center);
      await draw(45);
      const primitive = state.gridPrimitive;
      primitive.__surfaceFitAt = -Infinity;
      const started = performance.now();
      updateContourGridPrimitiveCenter(viewer, center);
      const fitMs = performance.now() - started;
      await settle(center);
      await draw();
      // The larger footprint may refine additional tiles during those frames.
      // Wait for the existing terrain fitter again before comparing heights.
      await settle(center);
      let maxError = 0, samples = 0, minClearance = Infinity, maxClearance = -Infinity;
      for (let i = 0; i < primitive.length; i++) for (const point of primitive.get(i).positions) {
        const geographic = Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(primitive.modelMatrix, point, new Cesium.Cartesian3()));
        const ground = scene.globe.getHeight(geographic);
        if (Number.isFinite(ground)) {
          const clearance = geographic.height - ground;
          samples++; maxError = Math.max(maxError, Math.abs(clearance - 1));
          minClearance = Math.min(minClearance, clearance); maxClearance = Math.max(maxClearance, clearance);
        }
      }
      const originalMatrix = Cesium.Matrix4.clone(primitive.modelMatrix);
      center.height += 12000;
      updateContourGridPrimitiveCenter(viewer, center);
      const ignoresAltitude = Cesium.Matrix4.equals(originalMatrix, primitive.modelMatrix);
      center.lon += 0.0001;
      primitive.__surfaceFitAt = -Infinity;
      updateContourGridPrimitiveCenter(viewer, center);
      await settle(center);
      await draw();
      const gl = scene.context._gl;
      const pixels = new Uint8Array(scene.canvas.width * scene.canvas.height * 4);
      gl.readPixels(0, 0, scene.canvas.width, scene.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let redPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 25 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.2) redPixels++;
      let highFocusVisibleVertices = null;
      if (profile === 'aircraft') {
        const position = Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 18000);
        const pitch = numberVar('--warzone-live-aircraft-focus-camera-pitch', -58);
        const range = getAircraftInitialFocusCameraConfig({ altitude_ft: 18000 / 0.3048 }, position, null, pitch).rangeMeters;
        scene.camera.lookAt(position, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(pitch), range));
        highFocusVisibleVertices = 0;
        for (let i = 0; i < primitive.length; i++) for (const local of primitive.get(i).positions) {
          const point = Cesium.SceneTransforms.worldToWindowCoordinates(scene,
            Cesium.Matrix4.multiplyByPoint(primitive.modelMatrix, local, new Cesium.Cartesian3()));
          if (point && point.x >= 0 && point.x <= scene.canvas.width && point.y >= 0 && point.y <= scene.canvas.height) highFocusVisibleVertices++;
        }
        scene.camera.lookAt(Cesium.Cartesian3.fromDegrees(50, 26, 1800),
          new Cesium.HeadingPitchRange(0, -Math.PI / 2, 1800));
        await draw();
      }
      measurements.push({ profile, samples, maxError, minClearance, maxClearance, ignoresAltitude, fitMs, maxSliceMs: primitive.__surfaceMaxSliceMs,
        redPixels, highFocusVisibleVertices, reused: primitive === state.gridPrimitive });
      window.surfaceScreenshotProfile = profile;
      // Save each view from Node below without loading application/authentication code.
      if (profile === 'aircraft') window.airSurfaceImage = scene.canvas.toDataURL();
    }
    return measurements;
  });
  for (const result of surfaceResults) {
    assert.ok(result.samples > 500, JSON.stringify(result));
    // Preserve the existing one-metre terrain offset: the expanded footprint
    // must stay above the surface and within that offset's anti-z-fighting band.
    assert.ok(result.minClearance > 0 && result.maxClearance < 2, JSON.stringify(result));
    assert.ok(result.redPixels > 100, JSON.stringify(result));
    assert.equal(result.ignoresAltitude && result.reused, true);
  }
  const airSurfaceImage = await page.evaluate(() => window.airSurfaceImage);
  fs.writeFileSync(path.join(os.tmpdir(), 'stratops-ctr-surface-aircraft.png'), Buffer.from(airSurfaceImage.split(',')[1], 'base64'));
  await page.screenshot({ path: path.join(os.tmpdir(), 'stratops-ctr-surface-naval.png') });
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
  assert.deepEqual(tuning.radii, [250, 375, 500]);
  assert.deepEqual(tuning.ringWidths, [3, 3, 3]);
  assert.ok(tuning.gridWidths.includes(2));
  assert.equal(tuning.config.spacing, 125);
  assert.equal(tuning.aircraftConfig.outerRadius,
    300 * Number(css.match(/--warzone-aircraft-ctr-radar-extent-scale:\s*([\d.]+);/)?.[1] || 1));
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
  t.diagnostic(JSON.stringify({ results, surfaceResults, tuning, sharedTuning }));
  await page.evaluate(() => window.testViewer.scene.destroy());
});
