import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";

const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}
test("terrain fitting yields and stale frames cannot run after OFF or primitive replacement", () => {
    for (const reason of ["off", "replacement", "unfocus"]) {
        let now = 0, queries = 0, id = 0;
        const frames = new Map();
        const line = { positions: Array.from({ length: 40 }, (_, i) => new Cesium.Cartesian3(i, 0, 0)) };
        const primitive = { length: 1, get: () => line,
            modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(50, 26, 1)) };
        const state = { gridPrimitive: primitive, hasFocusPosition: true };
        const viewer = { __contourGridLayerVisible: true, scene: { requestRender() {},
            globe: { getHeight: () => { queries++; return 1500; }, ellipsoid: Cesium.Ellipsoid.WGS84 } } };
        const context = vm.createContext({ Cesium, performance: { now: () => now += 0.6 },
            numberVar: (_, fallback) => fallback, getContourOverlayState: () => state,
            requestAnimationFrame: callback => { frames.set(++id, callback); return id; } });
        vm.runInContext(extract("fitContourGridToSurface"), context);
        context.fitContourGridToSurface(viewer, primitive);
        const first = frames.values().next().value;
        frames.clear(); first();
        assert.ok(queries > 0 && queries < 40, "work must yield before processing every vertex");
        assert.equal(frames.size, 1);
        const before = queries;
        if (reason === "off") viewer.__contourGridLayerVisible = false;
        else if (reason === "replacement") state.gridPrimitive = null;
        else state.hasFocusPosition = false;
        frames.values().next().value();
        assert.equal(queries, before);
        assert.equal(primitive.__surfaceFitFrame, 0);
    }
});
for (const profile of ["aircraft", "naval"]) {
    test(`${profile} radar ignores target altitude and follows loaded surface without recreation`, () => {
        let now = 0, queries = 0, surface = 0;
        const line = { positions: [new Cesium.Cartesian3(-50, 0, 0), new Cesium.Cartesian3(50, 0, 0)] };
        const primitive = { length: 1, get: () => line };
        const state = { gridPrimitive: primitive, hasFocusPosition: true, focusProfile: profile };
        const globe = { ellipsoid: Cesium.Ellipsoid.WGS84, tileLoadProgressEvent: new Cesium.Event(),
            getHeight: () => { queries++; return surface; } };
        const viewer = { scene: { globe, requestRender() {} }, __contourGridLayerVisible: true };
        const frames = new Map();
        let frameId = 0;
        const context = vm.createContext({ Cesium, performance: { now: () => now },
            requestAnimationFrame: cb => { frames.set(++frameId, cb); return frameId; },
            cancelAnimationFrame: id => frames.delete(id),
            getContourOverlayState: () => state, numberVar: (_, fallback) => fallback,
            raiseContourGridPrimitive() {} });
        for (const name of ["fitContourGridToSurface", "updateContourGridPrimitiveCenter"]) vm.runInContext(extract(name), context);
        const update = (height, lon = 50) => {
            context.updateContourGridPrimitiveCenter(viewer, { lon, lat: 26, height });
            while (frames.size) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); }
        };
        const heights = () => line.positions.map(local => Cesium.Cartographic.fromCartesian(
            Cesium.Matrix4.multiplyByPoint(primitive.modelMatrix, local, new Cesium.Cartesian3())).height);
        update(100);
        const matrix = Cesium.Matrix4.clone(primitive.modelMatrix);
        update(18000);
        assert.ok(Cesium.Matrix4.equals(matrix, primitive.modelMatrix));
        assert.equal(queries, 2, "no repeated terrain work inside the throttle interval");
        assert.equal(globe.tileLoadProgressEvent.numberOfListeners, 1);
        assert.ok(heights().every(height => Math.abs(height - 1) < 0.01));
        surface = 2200;
        now = 501;
        update(25000, 50.001);
        assert.ok(heights().every(height => Math.abs(height - 2201) < 0.1));
        surface = -50;
        now = 1002;
        update(9000, 50.002);
        assert.ok(heights().every(height => Math.abs(height + 49) < 0.1));
        surface = 0;
        now = 1503;
        update(12000, 50.003);
        assert.ok(heights().every(height => Math.abs(height - 1) < 0.1));
        viewer.__contourGridLayerVisible = false;
        update(40000);
        assert.equal(primitive.show, false);
        assert.equal(primitive.get(0), line);
        assert.equal(state.gridPrimitive, primitive);
        viewer.__contourGridLayerVisible = true;
        globe.tilesLoaded = true;
        now = 2104; update(18000);
        globe.tilesLoaded = false;
        now = 2120; update(18000);
        surface = 1800;
        globe.tilesLoaded = true;
        now = 2705; update(18000);
        assert.ok(heights().every(height => Math.abs(height - 1801) < 0.1),
            "new terrain tiles must invalidate a stationary cached surface fit");
        surface = 1900;
        globe.tileLoadProgressEvent.raiseEvent(0);
        now = 3306; update(18000);
        assert.ok(heights().every(height => Math.abs(height - 1901) < 0.1));
        assert.equal(globe.tileLoadProgressEvent.numberOfListeners, 1, "reuse the tile listener");
        context.document = { documentElement: { style: { setProperty() {} } } };
        context.clearContourOverlay = context.scheduleContourDemCacheRelease = context.exitCtrMode = () => {};
        vm.runInContext(extract("setContourGridLayerVisible"), context);
        context.setContourGridLayerVisible(viewer, false);
        assert.equal(globe.tileLoadProgressEvent.numberOfListeners, 0, "OFF removes the tile listener");
        viewer.scene.primitives = { remove() {} };
        vm.runInContext(extract("destroyContourGridPrimitive"), context);
        context.destroyContourGridPrimitive(viewer);
        assert.equal(state.gridPrimitive, null);
    });
}
