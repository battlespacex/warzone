import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const globeSource = fs.readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
const aircraftSource = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
function extract(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("aircraft motion frames advance the grounded CTR grid without terrain fits or camera changes", () => {
    const state = { gridPrimitive: { modelMatrix: null }, hasFocusPosition: true };
    let fits = 0, raises = 0, renderRequests = 0, cameraChanges = 0;
    const viewer = {
        scene: { mode: 3, requestRender: () => { renderRequests++; } },
        entities: { getById: () => ({}) },
        __contourGridLayerVisible: true,
    };
    const context = vm.createContext({
        Cesium: {
            SceneMode: { SCENE3D: 3 },
            Cartographic: { fromCartesian: point => point },
            Cartesian3: { fromDegrees: (lon, lat, height) => ({ lon, lat, height }) },
            Math: { toDegrees: value => value },
            Transforms: { eastNorthUpToFixedFrame: point => point },
        },
        window: { __warzoneViewer: viewer },
        __liveTrackReplayState: { selectedTrackKey: "sample", mode: "focus" },
        __liveTrackIsCameraFlying: true,
        __liveTrackHardLockEnabled: false,
        getPositionCartesian: () => context.currentPosition,
        getContourOverlayState: () => state,
        numberVar: () => 1,
        fitContourGridToSurface: () => { fits++; },
        raiseContourGridPrimitive: () => { raises++; },
        updateContourGridDrawMatrix: () => {},
        performance: { now: () => 0 },
    });
    viewer.camera = { lookAt: () => { cameraChanges++; } };
    viewer.__warzone = {
        isContourGridVisible: () => true,
        setContourGridCenter: (position, options) => context.setContourGridCenter(viewer, position, options),
    };
    vm.runInContext([
        extract(globeSource, "updateContourGridPrimitiveCenter"),
        extract(globeSource, "setContourGridCenter"),
        extract(aircraftSource, "syncFocusedTrackCamera"),
    ].join("\n"), context);

    for (let frame = 0; frame < 60; frame++) {
        context.currentPosition = { longitude: 50 + frame * 0.00001,
            latitude: 26 + frame * 0.000005, height: 12000 + frame };
        context.syncFocusedTrackCamera({ motionFrame: true });
        assert.equal(state.gridPrimitive.modelMatrix.lon, context.currentPosition.longitude);
        assert.equal(state.gridPrimitive.modelMatrix.lat, context.currentPosition.latitude);
        assert.equal(state.gridPrimitive.modelMatrix.height, 1, "aircraft altitude must not lift the grid");
    }
    assert.equal(fits, 0);
    assert.equal(raises, 0);
    assert.equal(renderRequests, 0);
    assert.equal(cameraChanges, 0);
    context.setContourGridCenter(viewer, { lon: 50, lat: 26 });
    assert.equal(fits, 1, "normal refresh still fits the grid to terrain");
    assert.equal(raises, 1);
    assert.equal(renderRequests, 1);
});

test("real Cesium 3D grid follows every aircraft position without rebuilding its GPU primitive", { timeout: 90000 }, async t => {
    const chrome = process.env.STRATOPS_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
    if (!fs.existsSync(chrome)) return t.skip("Chrome is unavailable");
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const cesiumRoot = path.join(root, "node_modules/cesium/Build/Cesium");
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("http://ctr.test/**", route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === "/") return route.fulfill({ contentType: "text/html", body:
            '<canvas id="globe" width="1280" height="720"></canvas><script>window.CESIUM_BASE_URL="/cesium/"</script><script src="/cesium/Cesium.js"></script>' });
        const local = path.resolve(cesiumRoot, pathname.replace(/^\/cesium\//, ""));
        if (!local.startsWith(cesiumRoot + path.sep) || !fs.existsSync(local)) return route.fulfill({ status: 404, body: "" });
        return route.fulfill({ body: fs.readFileSync(local),
            contentType: local.endsWith(".js") ? "application/javascript" : "application/octet-stream" });
    });
    await page.goto("http://ctr.test/", { waitUntil: "commit" });
    await page.waitForFunction(() => Boolean(window.Cesium));
    await page.addStyleTag({ content: fs.readFileSync(path.join(root, "dev/assets/css/root.css"), "utf8") });
    const names = ["cssVar", "numberVar", "boolVar", "colorFromCssVar", "lerp", "clamp01",
        "getContourOverlayState", "getContourFocusProfile", "smoothContourFade", "raiseContourGridPrimitive",
        "updateContourGridDrawMatrix", "createContourGridDrawPrimitive", "destroyContourGridPrimitive",
        "fitContourGridToSurface", "updateContourGridPrimitiveCenter", "chooseOperationalGridIntervalMeters",
        "getFocusedCtrRadarConfig", "addContourGridRing", "ensureContourGridPrimitive", "setContourGridCenter"];
    await page.addScriptTag({ content: names.map(name => extract(globeSource, name)).join("\n") });
    const result = await page.evaluate(async () => {
        const scene = new Cesium.Scene({ canvas: document.getElementById("globe"), scene3DOnly: true,
            contextOptions: { webgl: { preserveDrawingBuffer: true } } });
        scene.globe = new Cesium.Globe();
        scene.globe.baseColor = Cesium.Color.fromCssColorString("#080d15");
        const viewer = { scene, __contourGridLayerVisible: true };
        const state = getContourOverlayState(viewer);
        state.hasFocusPosition = true; state.focusProfile = "aircraft";
        const start = { lon: 50, lat: 26 };
        scene.camera.lookAt(Cesium.Cartesian3.fromDegrees(start.lon, start.lat, 12000),
            new Cesium.HeadingPitchRange(0, -1, 24000));
        const activationStarted = performance.now();
        ensureContourGridPrimitive(viewer, start);
        for (let frame = 0; frame < 120 && !state.gridDrawPrimitive?.ready; frame++) {
            await new Promise(requestAnimationFrame);
            scene.initializeFrame(); scene.render(Cesium.JulianDate.now());
        }
        const readyMs = performance.now() - activationStarted;
        const draw = state.gridDrawPrimitive;
        const baseWorld = Cesium.Cartesian3.fromDegrees(start.lon, start.lat, 1);
        let maxCenterError = 0;
        const frameTimes = [];
        for (let frame = 0; frame < 60; frame++) {
            const lon = 50 + (frame < 30 ? frame : 60 - frame) * 0.00005;
            const lat = 26 + frame * 0.00003;
            if (frame === 30) scene.camera.lookAt(Cesium.Cartesian3.fromDegrees(lon, lat, 12000),
                new Cesium.HeadingPitchRange(0.25, -0.9, 21000));
            const started = performance.now();
            setContourGridCenter(viewer, { lon, lat, height: 12000 }, { transformOnly: true });
            scene.initializeFrame(); scene.render(Cesium.JulianDate.now());
            frameTimes.push(performance.now() - started);
            const actual = Cesium.Matrix4.multiplyByPoint(draw.modelMatrix, baseWorld, new Cesium.Cartesian3());
            const expected = Cesium.Cartesian3.fromDegrees(lon, lat, 1);
            maxCenterError = Math.max(maxCenterError, Cesium.Cartesian3.distance(actual, expected));
        }
        const gl = scene.context._gl;
        const pixels = new Uint8Array(1280 * 720 * 4);
        gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let coloredPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] > 25 && pixels[index] > pixels[index + 1] * 1.5 &&
                pixels[index] > pixels[index + 2] * 1.2) coloredPixels++;
        }
        frameTimes.sort((a, b) => a - b);
        const outcome = { ready: draw.ready, reused: state.gridDrawPrimitive === draw,
            maxCenterError, coloredPixels, lines: state.gridPrimitive.length,
            readyMs, meanFrameMs: frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length,
            p95FrameMs: frameTimes[56] };
        scene.destroy();
        return outcome;
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(result.ready && result.reused, true, JSON.stringify(result));
    assert.ok(result.maxCenterError < 0.01, JSON.stringify(result));
    assert.ok(result.coloredPixels > 100, JSON.stringify(result));
    t.diagnostic(JSON.stringify(result));
});
