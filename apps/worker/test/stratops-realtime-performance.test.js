import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Socket } from "@supabase/phoenix";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const source = await read("../../../dev/assets/js/warzone-realtime-performance.js");
const { createTrackUpdateQueue, instrumentRealtimeCallback, installRealtimeSocketDiagnostics, getRealtimeStats } =
    await import(`data:text/javascript,${encodeURIComponent(source)}`);
const payload = (key, value, type = "UPDATE") => ({ eventType: type, new: { track_key: key, value } });
function harness(process, extra = {}) {
    let nextId = 0;
    const frames = new Map();
    const queue = createTrackUpdateQueue({ process, schedule: (fn) => { frames.set(++nextId, fn); return nextId; }, cancel: (id) => frames.delete(id), ...extra });
    return { queue, frames, frame() { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); } };
}
function fn(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const end = source.indexOf("\n}", start) + 2;
    return source.slice(start, end);
}

test("socket receipt does no reconciliation and schedules exactly one drain", () => {
    const calls = [];
    const h = harness((...args) => calls.push(args));
    for (let i = 0; i < 99; i++) h.queue.enqueue(payload(`track-${i}`, i));
    assert.equal(calls.length, 0);
    assert.equal(h.frames.size, 1);
    h.frame();
    assert.equal(calls.length, 4);
    assert.equal(h.queue.getStats().queueDepth, 95);
    assert.equal(h.frames.size, 1);
});
test("installed Phoenix decoder/channel routing returns before aircraft reconciliation", () => {
    let processed = 0;
    const h = harness(() => processed++);
    const socket = new Socket("wss://example.invalid/socket");
    socket.channel("realtime:tracks-live").on("postgres_changes", (p) => h.queue.enqueue(p));
    for (let i = 0; i < 99; i++) {
        socket.onConnMessage({ data: JSON.stringify([null, null, "realtime:tracks-live", "postgres_changes", payload(`track-${i}`, i)]) });
    }
    assert.equal(processed, 0);
    assert.equal(h.queue.getStats().queueDepth, 99);
    h.frame(); assert.equal(processed, 4);
});
test("coalescing retains every history point but renders only latest queued state", () => {
    const history = [], rendered = [];
    const h = harness((p, { dataOnly }) => { history.push(p.new.value); if (!dataOnly) rendered.push(p.new.value); });
    [1, 2, 3].forEach((value) => h.queue.enqueue(payload("ABC", value)));
    h.frame();
    assert.deepEqual(history, [1, 2, 3]);
    assert.deepEqual(rendered, [3]);
    assert.equal(h.queue.getStats().coalescedUpdates, 2);
});
test("DELETE remains an ordered lifecycle barrier followed by recreation", () => {
    const calls = [];
    const h = harness((p, { dataOnly }) => calls.push([p.eventType, p.new.value, dataOnly]));
    h.queue.enqueue(payload("ABC", 1));
    h.queue.enqueue(payload("ABC", 2, "DELETE"));
    h.queue.enqueue(payload("ABC", 3, "INSERT"));
    h.frame();
    assert.deepEqual(calls, [["UPDATE", 1, true], ["DELETE", 2, false], ["INSERT", 3, false]]);
});
test("frame budget yields after one expensive atomic record", () => {
    let time = 0, processed = 0;
    const h = harness(() => { processed++; time += 5; }, { now: () => time });
    for (let i = 0; i < 10; i++) h.queue.enqueue(payload(String(i), i));
    h.frame();
    assert.equal(processed, 1);
    assert.equal(h.queue.getStats().queueDepth, 9);
});
test("round-robin prevents one busy aircraft starving other aircraft", () => {
    const calls = [];
    const h = harness((p) => calls.push(p.new.track_key));
    for (let i = 0; i < 12; i++) h.queue.enqueue(payload("A", i));
    h.queue.enqueue(payload("B", 1));
    h.frame();
    assert.equal(calls[1], "B");
});
test("stop/hidden/layer-off cancellation discards pending stale work", () => {
    let calls = 0;
    const h = harness(() => calls++);
    h.queue.enqueue(payload("A", 1));
    h.queue.clear();
    assert.equal(h.frames.size, 0);
    assert.equal(h.queue.getStats().queueDepth, 0);
    h.queue.enqueue(payload("A", 2));
    h.frame();
    assert.equal(calls, 1);
});
test("one failed record does not abort other records", () => {
    const errors = [], calls = [];
    const h = harness((p) => { if (p.new.value === 1) throw new Error("test"); calls.push(p.new.value); }, { onError: (error) => errors.push(error.message) });
    h.queue.enqueue(payload("A", 1)); h.queue.enqueue(payload("B", 2)); h.frame();
    assert.deepEqual(errors, ["test"]); assert.deepEqual(calls, [2]);
});
test("instrumentation preserves callback this/return/exception and stores no payload", () => {
    globalThis.window = { location: { hostname: "localhost" } };
    try {
        const wrapped = instrumentRealtimeCallback("test", function (p) { assert.equal(this.marker, 1); return p.new.value; });
        assert.equal(wrapped.call({ marker: 1 }, payload("private-track", 5)), 5);
        assert.throws(() => instrumentRealtimeCallback("test", () => { throw new Error("test"); })(payload("A", 1)), /test/);
        const stats = getRealtimeStats();
        assert.equal(stats.channels.find((row) => row.channel === "test").sampleCount, 2);
        assert.ok(!JSON.stringify(stats).includes("private-track"));
    } finally { delete globalThis.window; }
});
test("socket timing wraps actual Phoenix method once without changing transport", () => {
    globalThis.window = { location: { hostname: "localhost" } };
    try {
        const socket = { onConnMessage(value) { assert.equal(this, socket); return value; } };
        const client = { socketAdapter: { getSocket: () => socket } };
        installRealtimeSocketDiagnostics(client);
        const installed = socket.onConnMessage;
        installRealtimeSocketDiagnostics(client);
        assert.equal(installed, socket.onConnMessage);
        assert.equal(socket.onConnMessage(7), 7);
        assert.ok(getRealtimeStats().socketCallback.sampleCount >= 1);
    } finally { delete globalThis.window; }
});
test("production diagnostics are opt-in and do not wrap socket by default", () => {
    globalThis.window = { location: { hostname: "stratops.battlespacex.com" } };
    try {
        const original = () => 1;
        const socket = { onConnMessage: original };
        installRealtimeSocketDiagnostics({ socketAdapter: { getSocket: () => socket } });
        assert.equal(socket.onConnMessage, original);
        assert.equal(getRealtimeStats().enabled, false);
    } finally { delete globalThis.window; }
});
test("unchanged trail point preserves cached curved geometry and live head path", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    const entries = [{ position: { x: 1 }, ts: Date.now() }];
    const commit = vm.runInNewContext(`${fn(aircraft, "commitTrackTrailPosition")}; commitTrackTrailPosition`, {
        __liveTrackTrails: new Map([["A", entries]]), trimTrailEntries: (value) => value.slice(),
        getCartesianDistanceMeters: () => 1, isImplausibleTrackMotion: () => false,
        getTrackTrailMinDistanceMeters: () => 6, __liveTrackReplayState: {},
        updateTrackTrailPositionsCache: () => { throw new Error("unnecessary geometry rebuild"); },
    });
    commit("A", {}, { x: 2 });
    assert.equal(entries.length, 1);
});
test("unchanged label avoids new Cesium callbacks but style/focus changes refresh", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    let builds = 0, focused = false, scale = 1;
    const apply = vm.runInNewContext(`const __liveTrackLabelSignatures = new WeakMap(); ${fn(aircraft, "applyTrackLabel")}; applyTrackLabel`, {
        getLiveLabelStyleConfig: () => ({ scale }), isTrackCurrentlyFocused: () => focused,
        getTrackDisplayTitle: (track) => track.title,
        buildTrackLabel: () => { builds++; return { text: "Aircraft", scale }; },
    });
    const label = {};
    apply(label, { title: "Aircraft" }, "A"); apply(label, { title: "Aircraft" }, "A");
    assert.equal(builds, 1);
    focused = true; apply(label, { title: "Aircraft" }, "A"); assert.equal(builds, 2);
    scale = 2; apply(label, { title: "Aircraft" }, "A"); assert.equal(builds, 3);
});
test("realtime entry point queues and preserves existing filters and interpolation", async () => {
    const essential = await read("../../../dev/assets/js/essential.js");
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    const receive = fn(essential, "enqueueTracksRealtimePayload");
    assert.doesNotMatch(receive, /upsertLiveTrack|normalizeAircraft|renderAircraft|sort\(/);
    assert.match(receive, /__tracksRealtimeQueue.enqueue\(payload\)/);
    assert.match(essential, /instrumentRealtimeCallback\("tracks-live", enqueueTracksRealtimePayload\)/);
    assert.match(fn(essential, "handleTracksRealtimePayload"), /shouldExcludeFromMilitaryAircraftTracker[\s\S]*isPointInsideRegion[\s\S]*upsertLiveTrack/);
    assert.match(aircraft, /animateTrackTo\(entity, track, lon, lat, alt, sourceTimestamp, attitude\)/);
    assert.match(essential, /AIRCRAFT_WIDGET_RENDER_THROTTLE_MS = 500/);
    assert.match(essential, /if \(__aircraftWidgetRenderTimer\) return/);
});
test("coalesced telemetry forces final render and still rejects older source time", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    const context = {
        __liveTrackRegistry: new Map([["A", { source_timestamp: 2000, __realtimeRenderPending: true }]]),
        LIVE_TRACK_STALE_UPDATE_TOLERANCE_MS: 0,
    };
    const classify = vm.runInNewContext(`${fn(aircraft, "classifyLiveTrackTelemetryUpdate")}; classifyLiveTrackTelemetryUpdate`, context);
    assert.equal(classify({ __lastSourceTimestamp: 1000 }, { track_key: "A" }, 3000), "accept");
    assert.equal(classify({ __lastSourceTimestamp: 1000 }, { track_key: "A" }, 1500), "stale");
});
test("pruning scans registry once per second rather than every telemetry update", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    let at = 0, historyVisits = 0;
    const registry = new Map(Array.from({ length: 99 }, (_, i) => [String(i), { active: true, path_history: [1] }]));
    const context = { performance: { now: () => at }, __liveTrackRegistry: registry, __liveTrackIconCodeCache: new Map(),
        LIVE_TRACK_HISTORY_RETENTION_MS: 1e6, LIVE_TRACK_INACTIVE_HISTORY_MAX_POINTS: 10, LIVE_TRACK_REGISTRY_MAX_ITEMS: 1000,
        pruneHistoryPoints: (points) => { historyVisits++; return points; } };
    const prune = vm.runInNewContext(`let __liveTrackRegistryLastPrunedAt = -Infinity; ${fn(aircraft, "pruneTrackRegistry")}; pruneTrackRegistry`, context);
    for (let i = 0; i < 99; i++) prune();
    assert.equal(historyVisits, 99);
    at = 1000; prune(); assert.equal(historyVisits, 198);
});
test("existing focused route does not rebuild geometry on network history receipt", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    const sync = vm.runInNewContext(`${fn(aircraft, "syncFocusedRouteEntity")}; syncFocusedRouteEntity`, {
        window: { __warzoneViewer: {} }, __liveTrackRegistry: new Map(),
        __liveTrackReplayState: { mode: "focus", selectedTrackKey: "A", routeEntity: {} },
        getFocusedRoutePositions: () => { throw new Error("must not rebuild"); },
    });
    assert.equal(sync("A"), true);
});
test("terrain template normalizes spaces and yields actual numeric slippy coordinates", async () => {
    const globe = await read("../../../dev/assets/js/warzone-globe.js");
    const tile = vm.runInNewContext(`${fn(globe, "getContourTerrariumTileTemplate")}; ${fn(globe, "getContourTerrariumTileUrl")}; ${fn(globe, "getTerrariumTilePoint")}; ({getContourTerrariumTileUrl,getTerrariumTilePoint})`, {
        stringVar: () => '"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{ z }/{ x }/{ y }.png"',
        TERRARIUM_TILE_SIZE: 256, Cesium: { Math: { toRadians: (degrees) => degrees * Math.PI / 180 } },
    });
    const { z, x, y } = tile.getTerrariumTilePoint(23, 37, 9);
    assert.equal(tile.getContourTerrariumTileUrl(z, x, y), `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
    assert.deepEqual([z,x,y], [9,288,199]);
    const css = await read("../../../dev/assets/css/root.css");
    assert.match(css, /--warzone-contour-dem-url: "https:\/\/s3.amazonaws.com\/elevation-tiles-prod\/terrarium\/\{z\}\/\{x\}\/\{y\}.png";/);
});
