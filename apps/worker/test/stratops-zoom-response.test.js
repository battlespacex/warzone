import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const css = await read("../../../dev/assets/css/root.css");
const globe = await read("../../../dev/assets/js/warzone-globe.js");
const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
const naval = await read("../../../dev/assets/js/warzone-live-naval.js");
const numberVar = (name, fallback) => {
    const match = css.match(new RegExp(`${name}:\\s*([0-9.]+)\\s*;`));
    return match ? Number(match[1]) : fallback;
};
function fn(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}
test("actual viewer styling removes zoom inertia without altering pan, spin or sensitivity", () => {
    const controller = {};
    const viewer = { scene: { skyBox: {}, sun: {}, moon: {}, globe: { translucency: {} }, fog: {}, screenSpaceCameraController: controller } };
    const context = vm.createContext({ viewer, numberVar, boolVar: (_name, fallback) => fallback,
        colorFromCssVar: () => ({}), applyMapColorMixer: () => {},
    });
    vm.runInContext(`${fn(globe, "applyViewerStyle")}; applyViewerStyle(viewer);`, context);
    assert.equal(controller.inertiaZoom, 0);
    assert.equal(controller.inertiaSpin, 0.86); assert.equal(controller.inertiaTranslate, 0.82);
    assert.equal(controller.zoomFactor, 7.5);
    assert.equal(controller.minimumZoomDistance, 100); assert.equal(controller.maximumZoomDistance, 20000000);
    assert.match(globe, /ctrl\.inertiaZoom = numberVar\("--warzone-camera-inertia-zoom", 0\)/);
});
for (const [name, source, getter, resolver, state] of [
    ["aircraft", aircraft, "getLiveTrackFocusWheelZoomEase", "resolveLiveTrackFocusCameraRange", {
        __liveTrackFocusTargetRangeMeters: 2000, __liveTrackFocusRangeMeters: 1000,
        LIVE_TRACK_FOCUS_CAMERA_ZOOM_EPSILON_METERS: 1, getLiveTrackFocusCameraRangeMeters: () => 1000,
    }],
    ["naval", naval, "getNavalFocusWheelZoomEase", "resolveNavalFocusCameraRange", {
        __navalState: { focusTargetRangeMeters: 2000, focusRangeMeters: 1000 },
        NAVAL_FOCUS_CAMERA_RANGE_METERS: 1000, NAVAL_FOCUS_CAMERA_ZOOM_EPSILON_METERS: 1,
    }],
]) {
    test(`${name} focus zoom approaches both directions within four updates without overshooting`, () => {
        const context = vm.createContext({ ...state, getCssNumber: numberVar,
            clamp: (n, min, max) => Math.max(min, Math.min(max, n)),
        });
        vm.runInContext(`${fn(source, getter)}\n${fn(source, resolver)}`, context);
        const resolve = context[resolver];
        let previous = 1000;
        for (let i = 0; i < 4; i++) { const next = resolve(); assert.ok(next > previous && next < 2000); previous = next; }
        assert.ok(2000 - previous < 20, "at least 98 percent of requested zoom completes in four updates");
        if (name === "aircraft") context.__liveTrackFocusTargetRangeMeters = 1000;
        else context.__navalState.focusTargetRangeMeters = 1000;
        for (let i = 0; i < 4; i++) { const next = resolve(); assert.ok(next < previous && next > 1000); previous = next; }
        assert.ok(previous - 1000 < 20);
    });
}
