import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
function fn(name) {
  let start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  if (source.slice(start - 6, start) === "async ") start -= 6;
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function harness() {
  let time = 0, frameId = 0;
  const frames = new Map(), accepted = [], flashed = [], trimCalls = [], renders = [];
  const context = vm.createContext({
    __incomingEventUiFrame: 0, __incomingEventUiBatchDepth: 0, __incomingEventUiIds: new Set(),
    __allEventsCache: [], __eventsCache: [], __visibleEventsCache: [], __liveRecentEvents: [],
    __viewportScoped: false, __lastViewportKey: "", EVENT_CACHE_MAX_ITEMS: 1000, EVENT_VISIBLE_CACHE_MAX_ITEMS: 500,
    performance: { now: () => time }, requestAnimationFrame: cb => { frames.set(++frameId, cb); return frameId; },
    normalizeEvent: e => { time += 1; return { ...e }; }, resolveStrikeGeometry: e => e,
    isAircraftTelemetryEvent: () => false, isTrainerAircraftSignalEvent: () => false, isMilitaryRelevant: () => true,
    api: { mergeRealtimeMapEvent() {} }, isEventInsideActiveRegion: () => true, debouncedRenderFeed() {},
    trimSortedEventList: (rows, limit) => { trimCalls.push(rows.length); return rows.slice(0, limit); },
    shouldSuspendMapWork: () => false, isDocumentHidden: () => false,
    renderAll: rows => renders.push(rows.map(e => e.id)), flashFeedCard: id => flashed.push(id),
    syncNewsTickerForCurrentMode() {}, scheduleViewportFetch() {},
    window: { __warzoneViewer: { __warzone: {} } },
    document: { querySelectorAll: () => accepted.map(id => ({ dataset: { eventId: String(id) } })) },
    isOperationalMapEvent: () => true, isEventVisible: () => true, isNavalSignalEvent: () => true,
    getNavalTrackKey: e => e.id, isNavalTrackingFeatureEnabled: () => true,
    upsertNavalVessel: e => { time += 1; accepted.push(e.id); }, clearNavalVessel() {}, requestNavalWidgetRender() {},
    isTrackLikeEvent: () => false, isLayerEnabled: () => false, isSirenEvent: () => false,
  });
  for (const name of ["requestIncomingEventUiRefresh", "applyIncomingEventBatch", "handleIncomingEvent"]) vm.runInContext(fn(name), context);
  async function drain() {
    for (let count = 0; frames.size; count++) {
      assert.ok(count < 300, "frame work must be bounded");
      const [id, callback] = frames.entries().next().value; frames.delete(id); callback();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return { context, frames, accepted, flashed, trimCalls, renders, drain };
}
test("100 polling records yield while preserving every per-record update and rendering the cache once", async () => {
  const h = harness();
  const promise = h.context.applyIncomingEventBatch(Array.from({ length: 100 }, (_, id) => ({ id })));
  assert.ok(h.accepted.length < 100, "the burst must yield before all records complete");
  assert.equal(h.renders.length, 0);
  h.context.handleIncomingEvent({ id: "concurrent-realtime" });
  await h.drain(); await promise;
  assert.equal(h.accepted.length, 101);
  assert.equal(new Set(h.accepted).size, 101);
  assert.equal(h.renders.length, 1);
  assert.equal(h.renders[0].length, 101);
  assert.equal(h.flashed.length, 101);
  assert.equal(h.trimCalls.length, 2, "trim each authoritative cache once, not twice per record");
  assert.equal(h.context.__incomingEventUiBatchDepth, 0);
  assert.equal(h.frames.size, 0);
});
test("individual realtime bursts coalesce UI without postponing per-record processing", async () => {
  const h = harness(); for (let id = 0; id < 25; id++) h.context.handleIncomingEvent({ id });
  assert.equal(h.accepted.length, 25); assert.equal(h.frames.size, 1);
  await h.drain(); assert.equal(h.renders.length, 1);
});
test("obsolete polling batches stop after a yield, finalize caches and leave no pending work", async () => {
  const h = harness(); let current = true;
  const promise = h.context.applyIncomingEventBatch(Array.from({ length: 100 }, (_, id) => ({ id })), () => current);
  current = false; await h.drain(); await promise;
  assert.ok(h.accepted.length < 100); assert.equal(h.context.__incomingEventUiBatchDepth, 0);
  assert.equal(h.frames.size, 0); assert.equal(h.renders.length, 1);
});
