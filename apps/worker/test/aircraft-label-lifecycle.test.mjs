import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}

test("aircraft labels allocate only near the camera or for selection and restore across cycles", () => {
    let built = 0;
    let applied = 0;
    const selected = { selectedTrackKey: "" };
    const viewer = { camera: { positionCartographic: { height: 7_000_000 } } };
    const context = vm.createContext({
        window: { __warzoneViewer: viewer },
        __liveTrackReplayState: selected,
        LIVE_TRACK_LABEL_ZOOM_HEIGHT_MAX: 850_000,
        buildTrackLabel: () => { built++; return { text: "Aircraft" }; },
        applyTrackLabel: () => { applied++; },
    });
    for (const name of ["isCameraWithinTrackLabelZoom", "shouldAllocateTrackLabel", "syncTrackLabel"]) {
        vm.runInContext(functionSource(name), context);
    }
    const entity = {};
    for (let cycle = 0; cycle < 3; cycle++) {
        context.syncTrackLabel(entity, {}, "air-1");
        assert.equal(entity.label, undefined);
        viewer.camera.positionCartographic.height = 100_000;
        context.syncTrackLabel(entity, {}, "air-1");
        assert.equal(entity.label.text, "Aircraft");
        context.syncTrackLabel(entity, {}, "air-1");
        viewer.camera.positionCartographic.height = 7_000_000;
        context.syncTrackLabel(entity, {}, "air-1");
        assert.equal(entity.label, undefined);
    }
    assert.equal(built, 3);
    assert.equal(applied, 3);
    viewer.camera.positionCartographic.height = 100_000;
    entity.show = false;
    context.syncTrackLabel(entity, {}, "air-1");
    assert.equal(entity.label, undefined);
    entity.show = true;
    context.syncTrackLabel(entity, {}, "air-1");
    assert.equal(entity.label.text, "Aircraft");
    entity.show = false;
    context.syncTrackLabel(entity, {}, "air-1");
    assert.equal(entity.label, undefined);
    viewer.camera.positionCartographic.height = 7_000_000;
    entity.show = true;
    selected.selectedTrackKey = "air-1";
    context.syncTrackLabel(entity, {}, "air-1");
    assert.equal(entity.label.text, "Aircraft");
    selected.selectedTrackKey = "";
    context.syncTrackLabel(entity, {}, "air-1");
    assert.equal(entity.label, undefined);
});
