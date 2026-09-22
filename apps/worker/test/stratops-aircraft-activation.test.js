import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
const start = source.indexOf("function bindWidgetLayerToggles() {");
const end = source.indexOf("function getWarzoneAoiDataSnapshot()", start);
assert.ok(start >= 0 && end > start);
const binding = source.slice(start, end);

test("an early Air Tracker toggle starts cached seeding and the live pipeline before map bootstrap ends", async () => {
    let clickHandler;
    let layerEnabled = false;
    const calls = [];
    const cached = [{ track_key: "cached-aircraft" }];
    const control = { dataset: { widgetLayerToggle: "aircraft" }, disabled: false };
    const context = vm.createContext({
        __widgetLayerControlsBound: false,
        __aircraftLayerChangeReady: false,
        __aircraftHistoryCache: cached,
        document: { addEventListener: (_name, handler) => { clickHandler = handler; } },
        syncWidgetLayerToggleState: () => calls.push("toggle state"),
        isLayerEnabled: () => layerEnabled,
        requestLayerToggle: async () => { layerEnabled = true; calls.push("layer enabled"); },
        markTrackerPerf: (_kind, stage) => calls.push(stage),
        syncAircraftLivePipelines: () => calls.push("live pipeline"),
        syncLiveAircraftFromHistoryRows: (rows) => {
            assert.equal(rows, cached);
            calls.push("cached rows");
        },
        requestAircraftMovementsWidgetRender: () => calls.push("widget rendered"),
    });
    vm.runInContext(binding, context);
    context.bindWidgetLayerToggles();
    await clickHandler({
        target: { closest: () => control },
        preventDefault() {},
        stopPropagation() {},
    });
    assert.deepEqual(calls, [
        "toggle state", "toggle clicked", "layer enabled", "tracker enabled",
        "live pipeline", "cached rows", "widget rendered", "toggle state",
    ]);
    assert.equal(control.disabled, false);
});

test("the established layer listener remains the only pipeline starter after bootstrap", async () => {
    let clickHandler;
    let layerEnabled = false;
    let pipelineStarts = 0;
    const control = { dataset: { widgetLayerToggle: "aircraft" }, disabled: false };
    const context = vm.createContext({
        __widgetLayerControlsBound: false,
        __aircraftLayerChangeReady: true,
        __aircraftHistoryCache: [],
        document: { addEventListener: (_name, handler) => { clickHandler = handler; } },
        syncWidgetLayerToggleState() {},
        isLayerEnabled: () => layerEnabled,
        requestLayerToggle: async () => { layerEnabled = true; },
        markTrackerPerf() {},
        syncAircraftLivePipelines: () => { pipelineStarts += 1; },
        syncLiveAircraftFromHistoryRows() {},
        requestAircraftMovementsWidgetRender() {},
    });
    vm.runInContext(binding, context);
    context.bindWidgetLayerToggles();
    await clickHandler({
        target: { closest: () => control },
        preventDefault() {},
        stopPropagation() {},
    });
    assert.equal(pipelineStarts, 0);
});

test("an access-denied Air Tracker toggle never starts aircraft requests", async () => {
    let clickHandler;
    let pipelineStarts = 0;
    const control = { dataset: { widgetLayerToggle: "aircraft" }, disabled: false };
    const context = vm.createContext({
        __widgetLayerControlsBound: false,
        __aircraftLayerChangeReady: false,
        __aircraftHistoryCache: [],
        document: { addEventListener: (_name, handler) => { clickHandler = handler; } },
        syncWidgetLayerToggleState() {},
        isLayerEnabled: () => false,
        requestLayerToggle: async () => false,
        markTrackerPerf() {},
        syncAircraftLivePipelines: () => { pipelineStarts += 1; },
        syncLiveAircraftFromHistoryRows() {},
        requestAircraftMovementsWidgetRender() {},
    });
    vm.runInContext(binding, context);
    context.bindWidgetLayerToggles();
    await clickHandler({
        target: { closest: () => control },
        preventDefault() {},
        stopPropagation() {},
    });
    assert.equal(pipelineStarts, 0);
    assert.equal(control.disabled, false);
});
