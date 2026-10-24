import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";

const air = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const naval = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
const globe = fs.readFileSync(new URL("../../../dev/assets/js/warzone-globe.js", import.meta.url), "utf8");
function fn(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return (source.slice(Math.max(0, start - 6), start) === "async " ? "async " : "")
        + source.slice(start, source.indexOf("\n}", start) + 2);
}
function button(source, name) {
    const start = source.indexOf(`${name}.addEventListener("click", (event) => {`) + `${name}.addEventListener("click", `.length;
    assert.ok(start > 0);
    return source.slice(start, source.indexOf("\n    });", start) + 6);
}
function harness(owner = "naval") {
    let generation = 1, assetType = owner, assetId = "target", refreshes = 0;
    const state = { selectedKey: owner === "naval" ? "target" : null, renderEnabled: true,
        vessels: new Map(), overlayRoot: { style: { display: "block" } }, overlayLastVisible: true };
    const radar = { layer: true, grid: true, ctr: true, anchor: true };
    const calls = [];
    const map = {
        setContourLayerVisible(value) { calls.push("layer:" + value); radar.layer = value; return Promise.resolve(value); },
        setContourGridVisible(value) { calls.push("grid:" + value); radar.grid = value; },
        clearContourFocusPosition() { calls.push("clear"); radar.anchor = false; },
        exitCtrMode() { radar.ctr = false; }, enterCtrMode() { radar.ctr = true; },
        isContourLayerVisible: () => radar.layer, isContourGridVisible: () => radar.grid,
        isCtrModeActive: () => radar.ctr, isFocusedTerrainActive: () => false,
        setSatelliteVisible() {}, setGreyedSatelliteVisible() {}, disableFocusedTerrain() {},
    };
    const controller = {
        getState: () => ({ assetType, assetId }), getGeneration: () => generation,
        isCurrent: value => value === generation,
        isActiveAsset: (id, type) => assetType === type && assetId === id,
        exitFocus() { generation++; assetType = ""; assetId = ""; },
    };
    let airKey = owner === "aircraft" ? "target" : "";
    const context = vm.createContext({ Cesium, __navalState: state,
        window: { __warzoneViewer: { __warzone: map, camera: { lookAtTransform() {} } } },
        getAssetFocusController: () => controller, getFocusedTrackKey: () => airKey,
        NAVAL_FOCUS_CAMERA_RANGE_METERS: 120000,
        __liveTrackContourStateBeforeFocus: null, __liveTrackContourAnchorKey: "",
        __liveTrackContourAnchorLon: NaN, __liveTrackContourAnchorLat: NaN,
        hideNavalHoverLabel() {}, setNavalFocusedZoomLock() {}, closeFocusDriftWarningModal() {},
        syncNavalWidgetHighlight() {}, applyNavalVisual() {}, scheduleNavalRenderReconcile() {},
        emitNavalFocusChanged() {}, dispatchNavalRegistryUpdate() {},
        syncNavalContourCenter: () => true, setNavalFocusRangeMeters() {},
        getNavalCtrFocusedDistanceMeters: () => 24000, syncFocusedNavalCamera() {},
        syncNavalOverlayModeButtons() {}, syncFocusedTrackOverlayModeButtons() {},
        syncFocusedTrackContourCenter: () => true, disableAircraftFocusTerrain() {},
        refreshFocusedTrackModelAfterMapModeChange() { refreshes++; },
    });
    vm.runInContext("let __navalMapModeGeneration = 0, __aircraftMapModeGeneration = 0;", context);
    for (const name of ["beginNavalMapModeChange", "clearNavalSelection"]) vm.runInContext(fn(naval, name), context);
    for (const name of ["beginAircraftMapModeChange", "exitFocusedTrackMapModes", "enableFocusedLiveTrackContourMode"]) vm.runInContext(fn(air, name), context);
    return { context, state, radar, calls, map, controller,
        get refreshes() { return refreshes; },
        click(source, name) { return vm.runInContext(`(${button(source, name)})`, context)({ preventDefault() {}, stopPropagation() {} }); },
        switchTo(type) { controller.exitFocus(); generation++; assetType = type; assetId = "target";
            state.selectedKey = type === "naval" ? "target" : null; airKey = type === "aircraft" ? "target" : ""; },
        clear(type) { if (type === "naval") context.clearNavalSelection(); else { controller.exitFocus(); airKey = ""; context.exitFocusedTrackMapModes(); } },
    };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

for (const owner of ["aircraft", "naval"]) {
    test(`${owner} OFF clears both CTR flags before the anchor and is idempotent`, async () => {
        const h = harness(owner);
        h.clear(owner);
        assert.deepEqual(h.radar, { layer: false, grid: false, ctr: false, anchor: false });
        assert.ok(h.calls.indexOf("grid:false") < h.calls.indexOf("clear"));
        h.clear(owner);
        await flush();
        assert.equal(h.radar.grid, false);
        if (owner === "naval") assert.equal(h.state.overlayRoot.style.display, "none");
    });
    test(`${owner} CTR survives the other tracker's cleanup`, () => {
        const h = harness(owner);
        if (owner === "aircraft") h.context.clearNavalSelection();
        else h.context.exitFocusedTrackMapModes();
        assert.deepEqual(h.radar, { layer: true, grid: true, ctr: true, anchor: true });
        assert.equal(h.calls.length, 0);
    });
}
test("queued naval CTR cannot run after OFF, even when the same vessel is focused again", async () => {
    const h = harness();
    h.click(naval, "btnContour");
    h.clear("naval");
    h.switchTo("naval");
    await flush();
    assert.equal(h.radar.grid, false);
    assert.equal(h.radar.ctr, false);
});
test("queued old-domain 3D and terrain callbacks cannot clear the new owner's CTR", async () => {
    for (const owner of ["aircraft", "naval"]) {
        const h = harness(owner);
        h.click(owner === "aircraft" ? air : naval, "btnMap3d");
        if (owner === "aircraft") h.click(air, "btnTerrain");
        h.switchTo(owner === "aircraft" ? "naval" : "aircraft");
        await flush();
        assert.equal(h.calls.length, 0);
        assert.equal(h.radar.grid, true);
        assert.equal(h.refreshes, 0);
    }
});
test("delayed aircraft CTR completion cannot refresh models after OFF and new Focus", async () => {
    const h = harness("aircraft");
    let finish;
    h.map.setContourLayerVisible = value => { h.radar.layer = value;
        return value ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(false); };
    const pending = h.context.enableFocusedLiveTrackContourMode();
    h.clear("aircraft");
    h.switchTo("naval");
    finish(true);
    assert.equal(await pending, false);
    assert.equal(h.refreshes, 0);
    assert.equal(h.radar.grid, false);
});
test("repeated naval 3D/CTR clicks use only the latest operation and cleanup stays bounded", async () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
        h.switchTo("naval");
        h.click(naval, "btnContour"); h.click(naval, "btnMap3d");
        await flush();
        assert.equal(h.radar.grid, false);
        h.click(naval, "btnMap3d"); h.click(naval, "btnContour");
        await flush();
        assert.equal(h.radar.grid, true);
        h.clear("naval");
        assert.equal(h.radar.grid, false);
    }
});

for (const owner of ["aircraft", "naval"]) {
    test(`${owner} cleanup invalidates real map builds and hides real Cesium radar primitives`, () => {
        const h = harness(owner), c = h.context, viewer = c.window.__warzoneViewer;
        const primitives = new Cesium.PrimitiveCollection();
        const primitive = primitives.add(new Cesium.PolylineCollection());
        const dataSource = new Cesium.CustomDataSource("contour");
        dataSource.entities.add({ id: "contour-test" });
        const state = { gridPrimitive: primitive, dataSource, buildToken: 3, clearToken: 0,
            buildTimer: 9, hasFocusPosition: true, focusProfile: owner };
        const timers = new Map([[9, () => assert.fail("old build timer must be cancelled")]]);
        let nextTimer = 10;
        viewer.__contourLayerVisible = viewer.__contourGridLayerVisible = true;
        viewer.scene = { primitives, requestRender() {} };
        c.getContourOverlayState = () => state;
        c.document = { documentElement: { style: { setProperty() {} } } };
        c.clearTimeout = id => timers.delete(id);
        c.window.setTimeout = callback => { timers.set(++nextTimer, callback); return nextTimer; };
        c.getContourFallbackCenter = () => ({ lon: 50, lat: 26 });
        c.setContourGridCenter = () => assert.equal(viewer.__contourGridLayerVisible, false,
            "clearing an anchor must not restore a visible fallback radar");
        for (const name of ["retainContourDemCache", "applyRenderedTerrainVisibility", "dispatchContourLayerChanged",
            "scheduleContourDemCacheRelease", "queueContourOverlayBuild"]) c[name] = () => {};
        c.buildContourOverlay = () => {};
        c.enterCtrMode = () => {};
        c.exitCtrMode = () => {};
        for (const name of ["setContourLayerVisible", "setContourGridLayerVisible", "clearContourOverlay",
            "clearContourOverlayDeferred", "clearContourFocusPosition", "applyContourLayerState",
            "raiseContourGridPrimitive", "isContourBuildCurrent"]) vm.runInContext(fn(globe, name), c);
        h.map.setContourLayerVisible = value => c.setContourLayerVisible(viewer, value);
        h.map.setContourGridVisible = value => c.setContourGridLayerVisible(viewer, value);
        h.map.clearContourFocusPosition = () => c.clearContourFocusPosition(viewer);
        h.clear(owner);
        assert.equal(viewer.__contourLayerVisible, false);
        assert.equal(viewer.__contourGridLayerVisible, false);
        assert.equal(primitive.show, false);
        assert.equal(dataSource.show, false);
        assert.equal(dataSource.entities.values.length, 0);
        assert.equal(c.isContourBuildCurrent(viewer, state, 3), false);
        assert.equal(timers.has(9), false);
        assert.equal(primitives.length, 1, "one reusable hidden primitive, no recreation");
        primitives.destroy();
    });
}
