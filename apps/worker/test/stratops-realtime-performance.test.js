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
    const queue = createTrackUpdateQueue({ process, now: () => 0, schedule: (fn) => { frames.set(++nextId, fn); return nextId; }, cancel: (id) => frames.delete(id), ...extra });
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
test("long per-aircraft backlogs retain the newest positions", () => {
    const calls = [];
    const h = harness((p) => calls.push(p.new.value));
    for (let i = 0; i < 100; i++) h.queue.enqueue(payload("A", i));
    assert.equal(h.queue.getStats().queueDepth, 4);
    while (h.frames.size) h.frame();
    assert.deepEqual(calls, [96, 97, 98, 99]);
});
test("bounded backlog reaches the newest position without replaying 1000 old updates", () => {
    const countFrames = (maxQueuedPerTrack) => {
        const h = harness(() => {}, { maxQueuedPerTrack });
        for (let i = 0; i < 1000; i++) h.queue.enqueue(payload("A", i));
        let frames = 0;
        while (h.frames.size) { h.frame(); frames += 1; }
        return frames;
    };
    assert.equal(countFrames(Number.POSITIVE_INFINITY), 250);
    assert.equal(countFrames(4), 1);
});
test("focused aircraft drains ahead of a large unrelated backlog", () => {
    const calls = [];
    const h = harness((p) => calls.push(p.new.track_key), { priorityKey: () => "FOCUS" });
    for (let i = 0; i < 20; i++) h.queue.enqueue(payload(`other-${i}`, i));
    h.queue.enqueue(payload("FOCUS", 1));
    h.frame();
    assert.equal(calls[0], "FOCUS");
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
        isTrackCurrentlyFocused: () => true,
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
    assert.match(fn(essential, "requestAircraftMovementsWidgetRender"),
        /if \(__aircraftWidgetRenderTimer\) \{\s*if \(requestedDelay !== 0\) return;/);
});
test("aircraft channel filters naval writes without losing deletes or duplicating subscriptions", async () => {
    const essential = await read("../../../dev/assets/js/essential.js");
    const channels = new Set();
    const received = [];
    let enabled = true;
    const supabase = {
        realtime: {},
        channel(name) {
            const channel = {
                name, bindings: [],
                on(type, options, callback) { this.bindings.push({ type, options, callback }); return this; },
                subscribe() { channels.add(this); return this; },
                unsubscribe() { channels.delete(this); },
            };
            return channel;
        },
        removeChannel(channel) { channels.delete(channel); },
    };
    const context = vm.createContext({
        supabase, console,
        __tracksRealtimeQueue: { clear() {} },
        isAircraftTrackingFeatureEnabled: () => true,
        isLayerEnabled: () => enabled,
        isDocumentHidden: () => false,
        installRealtimeSocketDiagnostics() {},
        instrumentRealtimeCallback: (_, callback) => callback,
        enqueueTracksRealtimePayload: (change) => received.push(change),
        markTrackerPerf() {},
        recordRealtimeChannelError() {},
    });
    vm.runInContext(`let __tracksRealtimeChannel = null; ${fn(essential, "startTracksRealtimeChannel")}; ${fn(essential, "stopTracksRealtimeChannel")}`, context);
    context.startTracksRealtimeChannel();
    context.startTracksRealtimeChannel();
    assert.equal(channels.size, 1);
    const channel = [...channels][0];
    assert.deepEqual(channel.bindings.map(({ options }) => options.event), ["INSERT", "UPDATE", "DELETE"]);
    assert.equal(channel.bindings[0].options.filter, "track_type=eq.aircraft");
    assert.equal(channel.bindings[1].options.filter, "track_type=eq.aircraft");
    assert.equal(channel.bindings[2].options.filter, undefined);
    assert.ok(channel.bindings.every(({ callback }) => callback === channel.bindings[0].callback));
    channel.bindings[0].callback({ eventType: "INSERT", new: { track_key: "air-1" } });
    channel.bindings[1].callback({ eventType: "UPDATE", new: { track_key: "air-1" } });
    channel.bindings[2].callback({ eventType: "DELETE", old: { track_key: "air-1" } });
    assert.equal(received.length, 3);
    // Same synthetic input under the old wildcard and new server-side filter.
    let oldDelivered = 0;
    for (let i = 0; i < 1000; i += 1) {
        for (const track_type of ["aircraft", "naval"]) {
            oldDelivered += 1;
            for (const binding of channel.bindings) {
                if (binding.options.event === "UPDATE" &&
                    (!binding.options.filter || binding.options.filter === `track_type=eq.${track_type}`)) {
                    binding.callback({ eventType: "UPDATE", new: { track_key: `${track_type}-${i}`, track_type } });
                }
            }
        }
    }
    assert.equal(oldDelivered, 2000);
    assert.equal(received.length - 3, 1000, "the filtered aircraft subscriber never receives naval updates");
    enabled = false;
    context.stopTracksRealtimeChannel();
    assert.equal(channels.size, 0);
    enabled = true;
    context.startTracksRealtimeChannel();
    assert.equal(channels.size, 1);
    context.stopTracksRealtimeChannel();
});
test("events channel excludes only discarded flight-tracking updates", async () => {
    const realtime = await read("../../../dev/assets/js/warzone-realtime.js");
    const essential = await read("../../../dev/assets/js/essential.js");
    assert.match(fn(essential, "handleIncomingEvent"), /if \(isAircraftTelemetryEvent\(normalized\)\) return;/);
    const received = [];
    const bindings = [];
    const channel = {
        on(type, options, callback) { bindings.push({ type, options, callback }); return this; },
        subscribe() { return this; },
    };
    const context = vm.createContext({
        supabase: { realtime: {}, channel: () => channel },
        installRealtimeSocketDiagnostics() {},
        instrumentRealtimeCallback: (_, callback) => callback,
        handleIncomingEvent: (event) => received.push(event),
    });
    vm.runInContext(fn(realtime, "subscribeToLiveEvents"), context);
    assert.equal(await context.subscribeToLiveEvents(), channel);
    assert.deepEqual(bindings.map(({ options }) => options.event), ["INSERT", "UPDATE"]);
    assert.ok(bindings.every(({ options }) => options.filter === "report_type=isdistinct.flight_tracking"));
    assert.ok(bindings.every(({ callback }) => callback === bindings[0].callback));
    bindings[0].callback({ eventType: "INSERT", new: { id: "alert", report_type: null } });
    bindings[1].callback({ eventType: "UPDATE", new: { id: "naval", report_type: "signal" } });
    assert.deepEqual(received.map(({ id }) => id), ["alert", "naval"]);
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
test("a focused aircraft survives temporary gaps, resumes on the same entity, and ends once after final grace", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    let now = 1_000_000, removals = 0, unlocks = 0;
    const logs = [];
    const entity = { id: "track-A" };
    const entry = { active: true, liveness_state: "live", last_seen_at: now - 180_000, last_received_at: now };
    const registry = new Map([["A", entry]]);
    const context = {
        Date: { now: () => now }, window: { location: { hostname: "localhost" } }, console: { info: (...args) => logs.push(args) },
        __liveTrackRegistry: registry, LIVE_TRACK_STALE_TIMEOUT_MS: 90_000,
        __liveTrackIdentityIndex: { deactivate: () => {} },
        LIVE_TRACK_FOCUSED_STALE_GRACE_START_MS: 120_000, LIVE_TRACK_FOCUSED_STALE_TIMEOUT_MS: 180_000,
        removeLiveTrackRenderState: () => { removals++; }, isFocusedTrackKey: () => true,
        clearLiveTrackSelection: () => { unlocks++; },
    };
    const logLiveness = vm.runInNewContext(`${fn(aircraft, "logAirFocusLiveness")}; logAirFocusLiveness`, context);
    const markStale = vm.runInNewContext(`${fn(aircraft, "markStaleTracksAsEnded")}; markStaleTracksAsEnded`, {
        ...context, logAirFocusLiveness: logLiveness,
    });
    const refreshLiveness = vm.runInNewContext(
        `${fn(aircraft, "logAirFocusLiveness")}; ${fn(aircraft, "restoreLiveTrackLiveness")}; ${fn(aircraft, "refreshLiveTrackLiveness")}; refreshLiveTrackLiveness`,
        context
    );

    now += 30_000;
    markStale();
    assert.equal(entry.active, true); assert.equal(entry.liveness_state, "live"); assert.equal(removals, 0); assert.equal(unlocks, 0);

    now += 60_001;
    markStale();
    assert.equal(entry.active, true); assert.equal(entry.liveness_state, "temporarily_stale"); assert.equal(removals, 0); assert.equal(unlocks, 0);

    now += 30_000;
    markStale();
    assert.equal(entry.active, true); assert.equal(entry.liveness_state, "stale_grace");

    refreshLiveness(entity, { track_key: "A", heading_deg: 90, speed_kts: 400 }, now);
    assert.equal(entry.active, true); assert.equal(entry.liveness_state, "live"); assert.equal(entry.last_received_at, now);
    assert.equal(registry.get("A"), entry); assert.equal(entity.id, "track-A");

    now += 180_001;
    markStale(); markStale();
    assert.equal(entry.active, false); assert.equal(entry.liveness_state, "ended");
    assert.equal(removals, 1); assert.equal(unlocks, 1);
    assert.deepEqual(logs.map(([message]) => message), [
        "[AIR FOCUS] stale started",
        "[AIR FOCUS] stale grace active",
        "[AIR FOCUS] track resumed",
        "[AIR FOCUS] stale started",
        "[AIR FOCUS] stale grace active",
        "[AIR FOCUS] ended after timeout",
    ]);
});
test("a non-focused aircraft keeps the existing 90 second stale timeout", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    let now = 1_000_000, removals = 0;
    const entry = { active: true, liveness_state: "live", last_received_at: now };
    const markStale = vm.runInNewContext(`${fn(aircraft, "markStaleTracksAsEnded")}; markStaleTracksAsEnded`, {
        Date: { now: () => now }, __liveTrackRegistry: new Map([["B", entry]]),
        __liveTrackIdentityIndex: { deactivate: () => {} },
        LIVE_TRACK_STALE_TIMEOUT_MS: 90_000, LIVE_TRACK_FOCUSED_STALE_TIMEOUT_MS: 180_000,
        isFocusedTrackKey: () => false, removeLiveTrackRenderState: () => { removals++; },
    });
    now += 90_001;
    markStale();
    assert.equal(entry.active, false); assert.equal(entry.liveness_state, "ended"); assert.equal(removals, 1);
});
test("a missing naval snapshot gets a grace period before removal", async () => {
    const essential = await read("../../../dev/assets/js/essential.js");
    let now = 1_000_000, removals = 0;
    const vessels = [{ track_key: "NAVAL-A", received_at: now }];
    const sync = vm.runInNewContext(`let __lastNavalSignalsSyncKey = "__empty__"; ${fn(essential, "syncNavalSignals")}; syncNavalSignals`, {
        Date: { now: () => now }, isNavalTrackingFeatureEnabled: () => true,
        isLayerEnabled: () => true, setNavalLayerVisible: () => {},
        isNavalSignalEvent: () => true, isEventVisible: () => true,
        getNavalTrackKey: (event) => event.track_key,
        getAllNavalSnapshots: () => vessels, clearNavalVessel: () => { removals++; vessels.length = 0; },
        requestNavalWidgetRender: () => {}, markTrackerPerf: () => {}, upsertNavalVessel: () => {},
    });
    sync([]); assert.equal(removals, 0);
    now += 90_001;
    sync([]); assert.equal(removals, 1);
});
test("aircraft history seeds first entities before yielding the remaining rows", async () => {
    const essential = await read("../../../dev/assets/js/essential.js");
    const processed = [], frames = [], renders = [];
    let now = 0;
    const context = vm.createContext({
        isAircraftTrackingFeatureEnabled: () => true, isLayerEnabled: () => true,
        isDatabaseAircraftLiveSourceEnabled: () => true,
        isPointInsideRegion: () => true, getActiveRegion: () => ({}),
        cancelAnimationFrame: () => {}, requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
        performance: { now: () => ++now }, markTrackerPerf: () => {},
        upsertLiveTrack: (row) => { processed.push(row.track_key); return {}; },
        requestAircraftMovementsWidgetRender: (delay) => { renders.push(delay); },
        AIRCRAFT_WIDGET_RENDER_THROTTLE_MS: 500,
    });
    vm.runInContext(`let __aircraftHistorySeedRaf = 0, __aircraftHistorySeedGeneration = 0;
        let __aircraftHistorySeeding = false, __seededAircraftTrackKeys = new Set();
        ${fn(essential, "syncLiveAircraftFromHistoryRows")}`, context);
    context.syncLiveAircraftFromHistoryRows(Array.from({ length: 20 }, (_, i) => ({ track_key: String(i), active: true, lat: 1, lon: 1 })));
    assert.ok(processed.length > 0 && processed.length < 20);
    assert.equal(renders[0], 0);
    while (frames.length) frames.shift()();
    assert.equal(processed.length, 20);
});
test("aircraft motion frames do not bypass the 20 Hz camera cap", async () => {
    const aircraft = await read("../../../dev/assets/js/warzone-live-airforce.js");
    const viewer = { scene: { mode: 3 }, entities: { getById: () => ({}) }, camera: {} };
    let translations = 0;
    const syncCamera = vm.runInNewContext(`${fn(aircraft, "syncFocusedTrackCamera")}; syncFocusedTrackCamera`, {
        window: { __warzoneViewer: viewer }, Cesium: { SceneMode: { SCENE3D: 3 } },
        __liveTrackReplayState: { selectedTrackKey: "A", mode: "focus" },
        __liveTrackIsCameraFlying: false, __liveTrackHardLockEnabled: true,
        __liveTrackUserCameraInteracting: false, __liveTrackLastFocusCameraSyncAt: 100,
        LIVE_TRACK_FOCUS_CAMERA_SYNC_HZ: 20,
        getPositionCartesian: () => ({}), performance: { now: () => 120 },
        translateFocusedTrackCamera: () => { translations++; },
        getCssNumber: () => 20, clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    });
    assert.doesNotThrow(() => syncCamera({ motionFrame: true }));
    assert.equal(translations, 1, "lightweight translation follows motion before the expensive camera cap");
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
