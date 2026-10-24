import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../../dev/assets/js/warzone-live-airforce.js", import.meta.url), "utf8");
const start = source.indexOf("export function syncLiveTrackRenderPopulation(");
assert.ok(start >= 0);
const end = source.indexOf("\n}\n", start) + 2;

test("Focus hides distant aircraft without entity churn and OFF still releases them", () => {
    const records = new Map(Array.from({ length: 1_000 }, (_, i) => [`air-${i}`, { active: true }]));
    const entities = new Map(Array.from(records.keys(), key => [`track-${key}`, { id: `track-${key}`, __trackKey: key, show: true }]));
    const tracked = new Map(entities);
    let batchDepth = 0;
    const viewer = { entities: {
        getById: id => entities.get(id),
        suspendEvents: () => { batchDepth++; },
        resumeEvents: () => { batchDepth--; },
    } };
    let enabled = true;
    let focusKey = "air-0";
    let removed = 0;
    let created = 0;
    let unbound = 0;
    const context = vm.createContext({
        window: { __warzoneViewer: viewer },
        __liveTrackRenderReconcileActive: false,
        __liveTrackRenderReconcileCancel: null,
        __liveTrackRegistry: records,
        __liveTrackEntities: tracked,
        isLayerEnabled: () => enabled,
        isFocusSelectionActive: () => Boolean(focusKey),
        clearLiveTrackSelection: () => { focusKey = ""; },
        getFocusedTrackKey: () => focusKey,
        getTrackDataCartesian: () => ({}),
        shouldRenderLiveTrackDataState: key => enabled && (!focusKey || key === focusKey),
        upsertLiveTrack: () => { created++; },
        removeLiveTrackRenderState: key => { removed++; entities.delete(`track-${key}`); tracked.delete(`track-${key}`); },
        hasFocusedRouteForTrack: () => false,
        purgeLiveTrackRenderEntities: () => { entities.clear(); tracked.clear(); },
        unbindLiveTrackRuntime: () => { unbound++; },
        requestWarzoneRenderBatched: () => {},
    });
    vm.runInContext(source.slice(start, end).replace(/^export /, ""), context);

    assert.equal(context.syncLiveTrackRenderPopulation(), true);
    assert.equal(entities.size, 1_000);
    assert.equal(entities.get("track-air-0").show, true);
    assert.equal([...entities.values()].filter(entity => entity.show === false).length, 999);
    assert.equal(removed, 0);
    assert.equal(created, 0);
    assert.equal(batchDepth, 0);

    focusKey = "";
    context.syncLiveTrackRenderPopulation();
    assert.equal([...entities.values()].filter(entity => entity.show === false).length, 0);
    assert.equal(removed, 0);
    assert.equal(created, 0);
    assert.equal(batchDepth, 0);

    enabled = false;
    context.syncLiveTrackRenderPopulation();
    assert.equal(entities.size, 0);
    assert.equal(removed, 1_000);
    assert.equal(unbound, 1);
    assert.equal(batchDepth, 0);
});

test("bulk restoration yields, cancels cleanly on OFF, and restores every track once", () => {
    const records = new Map(Array.from({ length: 1_000 }, (_, i) => [`air-${i}`, { active: true }]));
    const entities = new Map();
    const tracked = new Map();
    const frames = new Map();
    let nextFrame = 0;
    let clock = 0;
    let enabled = true;
    let batchDepth = 0;
    let added = 0;
    const viewer = { entities: {
        getById: id => entities.get(id),
        suspendEvents: () => { batchDepth++; },
        resumeEvents: () => { batchDepth--; },
    } };
    const context = vm.createContext({
        window: { __warzoneViewer: viewer },
        performance: { now: () => ++clock },
        requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: id => { frames.delete(id); },
        __liveTrackRenderReconcileActive: false,
        __liveTrackRenderReconcileCancel: null,
        __liveTrackRegistry: records,
        __liveTrackEntities: tracked,
        isLayerEnabled: () => enabled,
        isFocusSelectionActive: () => false,
        getFocusedTrackKey: () => "",
        shouldRenderLiveTrackDataState: () => enabled,
        upsertLiveTrack: track => {
            const id = `track-${track.track_key}`;
            if (entities.has(id)) throw new Error(`duplicate ${id}`);
            const entity = { id, __trackKey: track.track_key, show: true };
            entities.set(id, entity);
            tracked.set(id, entity);
            added++;
        },
        removeLiveTrackRenderState: key => {
            entities.delete(`track-${key}`);
            tracked.delete(`track-${key}`);
        },
        hasFocusedRouteForTrack: () => false,
        purgeLiveTrackRenderEntities: () => { entities.clear(); tracked.clear(); },
        unbindLiveTrackRuntime: () => {},
        requestWarzoneRenderBatched: () => {},
    });
    vm.runInContext(source.slice(start, end).replace(/^export /, ""), context);
    const next = () => {
        const [id, callback] = frames.entries().next().value;
        frames.delete(id);
        callback();
    };

    assert.equal(context.syncLiveTrackRenderPopulation(), true);
    assert.equal(entities.size, 0);
    next();
    assert.ok(entities.size > 0 && entities.size < records.size);
    const canceledCount = entities.size;
    const staleCallback = frames.values().next().value;
    assert.equal(batchDepth, 1);

    enabled = false;
    context.syncLiveTrackRenderPopulation();
    assert.equal(entities.size, 0);
    assert.equal(batchDepth, 0);
    assert.equal(frames.size, 0);

    enabled = true;
    context.syncLiveTrackRenderPopulation();
    staleCallback();
    assert.equal(entities.size, 0, "a cancelled batch stays cancelled after a newer ON");
    while (frames.size) next();
    assert.equal(entities.size, records.size);
    assert.equal(batchDepth, 0);
    assert.equal(added, records.size + canceledCount);
});
