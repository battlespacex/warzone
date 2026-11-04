import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const essential = readFileSync(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
const naval = readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
function sourceFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const declaration = source.slice(start - 6, start) === "async " ? start - 6 : start;
    return source.slice(declaration, source.indexOf("\n}", start) + 2);
}

test("private asset mapping retains historical identity, timestamps and source", () => {
    const context = vm.createContext({});
    vm.runInContext(sourceFunction(essential, "navalHistoryEventFromAsset"), context);
    const event = context.navalHistoryEventFromAsset({
        asset_key: "imo-1234567", mmsi: "123456789", imo: "1234567",
        vessel_name: "USS Example", aliases: ["name:Old Name"],
        last_seen_at: "2026-10-01T12:00:00Z", first_seen_at: "2025-01-01T12:00:00Z",
        source_name: "AISStream", lat: 35, lon: -75,
    });
    assert.equal(event.dedupe_key, "ais-123456789");
    assert.equal(event.__privateNavalHistory, true);
    assert.equal(event.occurred_at, "2026-10-01T12:00:00Z");
    assert.equal(event.metadata.history_asset_key, "imo-1234567");
    assert.deepEqual([...event.metadata.aliases], ["name:Old Name"]);
});

test("authentication cleanup removes private contacts without clearing live naval tracks", () => {
    const vessels = new Map([
        ["ais-old", { data: { private_history_only: true } }],
        ["ais-live", { data: { private_history_only: false } }],
    ]);
    const context = vm.createContext({
        __navalState: { vessels }, clearNavalVessel: (key) => vessels.delete(key),
    });
    vm.runInContext(sourceFunction(naval, "clearPrivateNavalHistory"), context);
    context.clearPrivateNavalHistory();
    assert.deepEqual([...vessels.keys()], ["ais-live"]);
});

test("private history is requested only for history states and loaded in bounded batches", async () => {
    const calls = [];
    const context = vm.createContext({
        __navalWidgetStatusFilter: "historical", __navalHistorySearch: "",
        __navalHistoryGeneration: 0, __navalHistoryRequest: null,
        __navalHistoryLoadedKey: "", __navalHistoryOffset: 0,
        __navalHistoryHasMore: false, __navalHistoryMessage: "",
        isNavalTrackingFeatureEnabled: () => true, isLayerEnabled: () => true,
        getMapEventsRegionRequest: () => ({ id: "gulf", bounds: { minLat: 0, maxLat: 50, minLon: 30, maxLon: 70 } }),
        cancelNavalHistoryRequest: ({ clear }) => {
            context.__navalHistoryGeneration++;
            if (clear) context.__navalHistoryOffset = 0;
        },
        requestNavalWidgetRender: () => {},
        api: { getNavalHistory: async (_region, options) => {
            calls.push(options);
            return { assets: [{ asset_key: "imo-1", mmsi: "1" }], meta: { has_more: false } };
        } },
        navalHistoryEventFromAsset: (asset) => asset,
        upsertNavalVessel: (asset) => calls.push(asset),
        AbortController,
    });
    vm.runInContext(sourceFunction(essential, "refreshPrivateNavalHistory"), context);
    await context.refreshPrivateNavalHistory();
    assert.equal(calls[0].status, "historical");
    assert.equal(calls[0].limit, 200);
    assert.equal(calls[1].asset_key, "imo-1");
    assert.equal(context.__navalHistoryOffset, 1);
    context.__navalWidgetStatusFilter = "recent";
    await context.refreshPrivateNavalHistory();
    assert.equal(calls.length, 2, "recent does not request archived assets");
});
