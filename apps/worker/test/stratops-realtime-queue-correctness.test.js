import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const queueSource = await read("../../../dev/assets/js/warzone-realtime-performance.js");
const aircraftSource = await read("../../../dev/assets/js/warzone-live-airforce.js");
const essentialSource = await read("../../../dev/assets/js/essential.js");
const { createTrackUpdateQueue } = await import(`data:text/javascript,${encodeURIComponent(queueSource)}`);
function fn(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
}
const update = (key, timestamp, type = "UPDATE") => ({
    eventType: type, new: { track_key: key, timestamp, sourceTimestamp: timestamp, lat: 1, lon: timestamp / 1000 },
});
function harness({ cost = 0, maxRecordsPerFrame = 4 } = {}) {
    const registry = new Map(), entities = new Map(), frames = new Map();
    const history = [], renders = [], outcomes = [];
    let nextId = 0, time = 0;
    const classify = vm.runInNewContext(`${fn(aircraftSource, "classifyLiveTrackTelemetryUpdate")}; classifyLiveTrackTelemetryUpdate`, {
        __liveTrackRegistry: registry, __liveTrackLastPositions: new Map(),
        LIVE_TRACK_STALE_UPDATE_TOLERANCE_MS: 250,
    });
    const queue = createTrackUpdateQueue({
        schedule: (callback) => { frames.set(++nextId, callback); return nextId; }, cancel: (id) => frames.delete(id),
        now: () => time, maxRecordsPerFrame,
        getSourceTimestamp: (p) => p.new.sourceTimestamp,
        process(p, { dataOnly }) {
            time += cost;
            const row = p.new, key = row.track_key;
            if (p.eventType === "DELETE") {
                entities.delete(key); registry.delete(key); outcomes.push("deleted");
                return { status: "deleted", sourceTimestamp: row.sourceTimestamp };
            }
            const status = classify(entities.get(key), row, row.sourceTimestamp);
            outcomes.push(status);
            if (status === "stale") return { status: "stale" };
            history.push([key, row.sourceTimestamp, dataOnly]);
            registry.set(key, { source_timestamp: row.sourceTimestamp, __realtimeRenderPending: dataOnly });
            if (!dataOnly) {
                entities.set(key, { __lastSourceTimestamp: row.sourceTimestamp }); renders.push([key, row.sourceTimestamp]);
            }
            return { status: "accepted", candidate: row, sourceTimestamp: row.sourceTimestamp, visuallyReconciled: !dataOnly };
        },
        reconcile(candidate) {
            time += cost;
            entities.set(candidate.track_key, { __lastSourceTimestamp: candidate.sourceTimestamp });
            renders.push([candidate.track_key, candidate.sourceTimestamp]);
            return true;
        },
    });
    return { queue, history, renders, entities, outcomes, frames,
        frame() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); },
        drain() { for (let count = 0; frames.size; count++) { assert.ok(count < 100, "queue must finish without network traffic"); this.frame(); } },
    };
}

test("A/F: accepted intermediate then stale final reconciles with no future traffic", () => {
    const h = harness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 1000)); h.drain();
    assert.deepEqual(h.history, [["A", 2000, true]]);
    assert.deepEqual(h.outcomes, ["accept", "stale"]);
    assert.deepEqual(h.renders, [["A", 2000]]);
    assert.equal(h.queue.getStats().queueDepth, 0);
    assert.equal(h.queue.getStats().rescuedFinalVisualUpdates, 1);
});

test("B: two accepted states coalesce to the newer valid state", () => {
    const h = harness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 3000)); h.drain();
    assert.deepEqual(h.renders, [["A", 3000]]);
    assert.equal(h.queue.getStats().acceptedValidUpdates, 2);
    assert.equal(h.queue.getStats().rescuedFinalVisualUpdates, 0);
});
test("C: accepted, stale, then newer accepted renders newest valid only", () => {
    const h = harness();
    [2000, 1000, 3000].forEach((at) => h.queue.enqueue(update("A", at))); h.drain();
    assert.deepEqual(h.renders, [["A", 3000]]);
    assert.deepEqual(h.history.map((entry) => entry[1]), [2000, 3000]);
    assert.equal(h.queue.getStats().staleRejectedUpdates, 1);
});
test("D: DELETE discards the accepted visual candidate", () => {
    const h = harness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 2000, "DELETE")); h.drain();
    assert.deepEqual(h.renders, []); assert.equal(h.entities.has("A"), false);
    assert.equal(h.queue.getStats().pendingVisualCandidates, 0);
});
test("E: DELETE then stale pre-delete update cannot resurrect an entity", () => {
    const h = harness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 2000, "DELETE"));
    h.queue.enqueue(update("A", 1000)); h.drain();
    assert.deepEqual(h.renders, []); assert.equal(h.entities.has("A"), false);
    assert.equal(h.queue.getStats().staleRejectedUpdates, 1);
});
test("DELETE barrier survives drain completion and permits truly fresh recreation", () => {
    const h = harness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 2000, "DELETE")); h.drain();
    h.queue.enqueue(update("A", 2000)); h.drain(); assert.equal(h.entities.has("A"), false);
    h.queue.enqueue(update("A", 3000, "INSERT")); h.drain();
    assert.deepEqual(h.renders, [["A", 3000]]);
});
test("DELETE arriving before a budget-deferred rescue cancels that rescue", () => {
    const h = harness({ maxRecordsPerFrame: 1 });
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 1000));
    h.frame(); h.frame();
    assert.equal(h.queue.getStats().pendingVisualCandidates, 1);
    h.queue.enqueue(update("A", 2000, "DELETE")); h.drain();
    assert.deepEqual(h.renders, []); assert.equal(h.entities.has("A"), false);
});
test("G: interleaved aircraft remain independent and fair", () => {
    const h = harness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("B", 3000));
    h.queue.enqueue(update("A", 1000)); h.queue.enqueue(update("B", 4000)); h.drain();
    assert.deepEqual(h.renders.sort(), [["A", 2000], ["B", 4000]]);
    assert.equal(h.queue.getStats().rescuedFinalVisualUpdates, 1);
});
test("rescue respects four-ms budget and requires no future socket messages", () => {
    const h = harness({ cost: 5 });
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 1000));
    h.frame(); assert.equal(h.history.length, 1); assert.equal(h.renders.length, 0);
    h.frame(); assert.equal(h.outcomes.length, 2); assert.equal(h.renders.length, 0);
    assert.equal(h.frames.size, 1);
    h.frame(); assert.deepEqual(h.renders, [["A", 2000]]); assert.equal(h.frames.size, 0);
});
test("rescue consumes a drain slot, never a fifth unbudgeted job", () => {
    const h = harness();
    ["A", "B"].forEach((key) => { h.queue.enqueue(update(key, 2000)); h.queue.enqueue(update(key, 1000)); });
    h.frame(); assert.equal(h.outcomes.length, 4); assert.deepEqual(h.renders, []);
    assert.equal(h.frames.size, 1); h.frame(); assert.equal(h.renders.length, 2);
});
test("new accepted traffic replaces a deferred rescue candidate", () => {
    const h = harness({ maxRecordsPerFrame: 1 });
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 1000)); h.frame(); h.frame();
    h.queue.enqueue(update("A", 3000)); h.drain();
    assert.deepEqual(h.renders, [["A", 3000]]); assert.equal(h.queue.getStats().queueDepth, 0);
});
test("clear cancels candidates and the single scheduled rescue RAF", () => {
    const h = harness({ maxRecordsPerFrame: 1 });
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 1000)); h.frame(); h.frame();
    h.queue.clear(); assert.equal(h.frames.size, 0); assert.equal(h.queue.getStats().pendingVisualCandidates, 0);
    assert.deepEqual(h.renders, []);
});

// Execute the actual frontend handlers and aircraft update functions. Only the
// Cesium/UI boundaries are stubbed; validation, ingestion and rescue are real.
function frontendHarness() {
    const registry = new Map(), entities = new Map(), frames = new Map();
    const history = [], animations = [];
    const position = { initial: true };
    const entity = { id: "track-A", __trackKey: "A", __lastSourceTimestamp: 1000, position, point: {} };
    entities.set(entity.id, entity);
    let nextId = 0;
    const noop = () => {};
    const context = vm.createContext({
        window: { __warzoneViewer: { __warzone: {}, entities: {
            getById: (id) => entities.get(id), add: (spec) => { entities.set(spec.id, spec); return spec; },
        } } }, document: { documentElement: {} }, getComputedStyle: () => ({}),
        __liveTrackUpdateComputedStyle: null, __liveTrackRegistry: registry,
        markTrackerPerf: noop,
        __liveTrackLastPositions: new Map(), __liveTrackEntities: entities, __liveTrackCreatedCount: 0,
        LIVE_TRACK_STALE_UPDATE_TOLERANCE_MS: 250,
        LIVE_TRACK_INSIGNIFICANT_DISTANCE_METERS: 0, LIVE_TRACK_INSIGNIFICANT_ALTITUDE_FEET: 0,
        LIVE_TRACK_INSIGNIFICANT_HEADING_DEG: 0, LIVE_TRACK_INSIGNIFICANT_SPEED_KTS: 0,
        measureRealtimeStage: (_name, callback) => callback(),
        resolveTrackSubtype: () => "tanker", findDuplicateLiveTrackKey: () => "",
        getTrackRenderAltitudeMeters: () => 100, getTrackResolvedHeading: () => 90,
        getTrackResolvedAltitudeFt: () => 300,
        getLonLatDistanceMeters: (a, b, c, d) => Math.hypot(a - c, b - d) * 100000,
        normalizeDegrees: (n) => n, getShortestAngleDeltaDeg: (a, b) => b - a,
        buildLiveTrackRegistryEntry: (track) => ({ lon: track.lon, lat: track.lat }),
        appendTrackHistoryPoint: (key, track) => history.push([key, track.timestamp]),
        pruneTrackRegistry: noop, dispatchLiveTrackRegistryUpdate: noop,
        refreshLiveTrackLiveness: noop, shouldRenderLiveTrackDataState: () => true,
        bindLiveTrackOverlay: noop, bindLiveTrackPicking: noop, recordRealtimeWork: noop,
        getLiveTrackStyleConfig: () => ({}), resolveLiveTrackModelUri: () => "test.glb",
        getLiveTrackSubtypeScale: () => 1, getLiveTrackSubtypeMinPixelSize: () => 1,
        getLiveTrackSubtypeMaxScale: () => 1, getTrackAttitude: () => ({ headingDeg: 90, pitchDeg: 0, rollDeg: 0 }),
        resolveAircraftRenderMode: () => "point", LIVE_TRACK_RENDER_MODE: { POINT: "point", MODEL: "model" },
        buildLiveTrackPoint: () => ({}), applyLiveTrackPoint: noop,
        buildTrackEntityCartesian: (_track, lon, lat, alt) => ({ lon, lat, alt }), buildTrackLabel: () => ({}),
        animateTrackTo: (target, track, lon, lat, alt, timestamp) => animations.push({ target, timestamp, lon }),
        applyTrackLabel: noop, ensureTrackTrailVisible: noop, getOrCreateTrackTrailEntity: noop,
        applyLiveTrackFocusVisibility: noop, isFocusedTrackKey: () => false, wakeLiveTrackRenderAfterAssetUpdate: noop,
        isAircraftTrackingFeatureEnabled: () => true, isLayerEnabled: () => true, isDocumentHidden: () => false,
        isDatabaseAircraftLiveSourceEnabled: () => true, shouldExcludeFromMilitaryAircraftTracker: () => false,
        isPointInsideRegion: () => true, getActiveRegion: () => ({}),
        clearLiveTrack: (key) => { registry.delete(key); entities.delete(`track-${key}`); },
    });
    vm.runInContext([
        ...["getTrackSourceTimestamp", "classifyLiveTrackTelemetryUpdate", "recordLiveTrackDataState", "applyLiveTrackUpdate", "upsertLiveTrack"].map((name) => fn(aircraftSource, name)),
        ...["handleTracksRealtimePayload", "reconcileAcceptedRealtimeTrack"].map((name) => fn(essentialSource, name)),
    ].join("\n"), context);
    const queue = createTrackUpdateQueue({
        process: context.handleTracksRealtimePayload, reconcile: context.reconcileAcceptedRealtimeTrack,
        getSourceTimestamp: (p) => context.getTrackSourceTimestamp(p.new || p.old),
        schedule: (callback) => { frames.set(++nextId, callback); return nextId; }, cancel: (id) => frames.delete(id), now: () => 0,
    });
    return { queue, registry, entities, history, animations, entity, position, context,
        drain() { for (let count = 0; frames.size; count++) {
            assert.ok(count < 100); const [id, callback] = frames.entries().next().value; frames.delete(id); callback();
        } },
    };
}
test("actual frontend rescue reaches animateTrackTo without a jump or duplicate history ingestion", () => {
    const h = frontendHarness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 1000)); h.drain();
    assert.deepEqual(h.history, [["A", 2000]]);
    assert.equal(h.animations.length, 1); assert.equal(h.animations[0].timestamp, 2000);
    assert.equal(h.animations[0].target, h.entity); assert.equal(h.entity.position, h.position);
    assert.equal(h.registry.get("A").__realtimeRenderPending, false);
    assert.equal(h.queue.getStats().rescuedFinalVisualUpdates, 1);
    const stale = h.context.handleTracksRealtimePayload(update("A", 1000));
    assert.equal(stale.status, "stale"); assert.equal(h.animations.length, 1);
});
test("actual frontend DELETE plus stale update cannot recreate an aircraft or start interpolation", () => {
    const h = frontendHarness();
    h.queue.enqueue(update("A", 2000)); h.queue.enqueue(update("A", 2000, "DELETE"));
    h.queue.enqueue(update("A", 1000)); h.drain();
    assert.equal(h.entities.has("track-A"), false); assert.equal(h.animations.length, 0);
    assert.equal(h.queue.getStats().pendingVisualCandidates, 0);
});
