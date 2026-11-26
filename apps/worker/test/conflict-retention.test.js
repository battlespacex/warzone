import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isActiveConflictItem, isConflictIntelligenceEvent, earliestConflictDate, CONFLICT_RETENTION_MS } from "../../shared/conflict-retention.js";
import { mergeEventQuality, readEventQuality } from "../src/event-quality.js";
import { CORROBORATION_STATES } from "../../shared/source-quality-policy.js";
import { isMapEventHistoricallyRelevant } from "../../shared/map-event-policy.js";
import { collectMapEventPages } from "../../shared/map-event-pages.js";
import { readConflictBackfill, maintainConflictRetention } from "../src/conflict-retention.js";
import { upsertConflictFeedItems } from "../src/conflict-supabase-writer.js";
import { promoteConflictFeedItemsToEvents } from "../src/conflict-event-promoter.js";
import { normalizeConflictItemToEventPayload } from "../src/intelligence-normalizer.js";
import { mergeDuplicateGroup, runConflictFeedSync } from "../src/conflict-feed-runner.js";

const now = Date.parse("2026-11-26T12:00:00Z");
const date = (hours) => new Date(now - hours * 3600000).toISOString();
const logger = { log() {}, debug() {}, warn() {} };
const report = (extra = {}) => ({
  title: "Explosion reported at Isfahan International Airport",
  summary: "An explosion damaged buildings at Isfahan International Airport.",
  source_name: "Reuters", source_type: "rss", url: "https://example.test/incident",
  published_at: date(60), is_conflict_relevant: true, ...extra,
});

// In-memory query engine exercises actual writer/promoter operations, with no network.
function database(initial = {}) {
  const tables = { events: [], conflict_feed_items: [], ...structuredClone(initial) };
  const calls = [];
  return { tables, calls, from(table) {
    let filters = [], operation = "read", payload, slice;
    const q = {
      select() { return q; },
      eq(key, value) { filters.push((row) => key.includes("->") ? false : row[key] === value); return q; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return q; },
      or() { filters.push((row) => isConflictIntelligenceEvent(row) || (!row.metadata?.intelligence_pipeline && ["news", "osint", "reddit", "strike"].includes(row.report_type))); return q; },
      gt(key, value) { filters.push((row) => row[key] > value); return q; },
      lte(key, value) { filters.push((row) => row[key] <= value); return q; },
      order() { return q; }, limit(n) { slice = [0, n]; return q; },
      range(a, b) { calls.push(["range", table, a, b]); slice = [a, b + 1]; return q; },
      insert(rows) { operation = "insert"; payload = rows; return q; },
      upsert(rows) { operation = "upsert"; payload = rows; return q; },
      update(row) { operation = "update"; payload = row; return q; },
      then(resolve, reject) {
        let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
        if (operation === "update") {
          assert.equal("updated_at" in payload, false, "events has no updated_at column");
          rows.forEach((row) => Object.assign(row, payload));
        } else if (operation === "insert" || operation === "upsert") {
          rows = payload.map((item) => {
            const old = operation === "upsert" && tables[table].find((row) => row.url === item.url);
            if (old) return Object.assign(old, item);
            const created = { id: `${table}-${tables[table].length}`, ...item };
            tables[table].push(created); return created;
          });
        }
        calls.push([operation, table]);
        return Promise.resolve({ data: structuredClone(slice ? rows.slice(...slice) : rows), error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
}

test("strict UTC window uses original time, never ingestion or future dates", () => {
  assert.equal(isActiveConflictItem({ published_at: date(71), fetched_at: date(0) }, now), true);
  assert.equal(isActiveConflictItem({ published_at: date(72) }, now), false);
  assert.equal(isActiveConflictItem({ published_at: date(73), fetched_at: date(0) }, now), false);
  assert.equal(isActiveConflictItem({ fetched_at: date(0) }, now), false);
  assert.equal(isActiveConflictItem({ published_at: date(-1) }, now), false);
  assert.equal(CONFLICT_RETENTION_MS, 259200000);
});

test("strict expiry affects conflict intelligence only, including legacy fallback records", () => {
  for (const event of ["osint", "news", "conflict", "reddit", "strike"].map((report_type) => ({ report_type, metadata: { intelligence_pipeline: "conflict" } })).concat([{ dedupe_key: "conflict-feed:old" }])) {
    assert.equal(isConflictIntelligenceEvent(event), true);
    assert.equal(isMapEventHistoricallyRelevant({ ...event, occurred_at: date(73), severity: "critical" }, { now }), false);
  }
  assert.equal(isMapEventHistoricallyRelevant({ report_type: "seismic", occurred_at: date(73), severity: "high" }, { now }), true);
  for (const report_type of ["news", "osint", "signal", "notam", "flight_tracking"]) {
    assert.equal(isConflictIntelligenceEvent({ report_type }), false);
    assert.equal(isMapEventHistoricallyRelevant({ report_type, occurred_at: date(73), severity: "high" }, { now }), true);
  }
});

test("main worker conflict escalation preserves occurrence time and uses actual schema columns", () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function applyEscalation("), source.indexOf("async function insertEvent(event)"));
  assert.ok(body.length > 100);
  const apply = new Function("readEventQuality", "makeEventFingerprint", "mergeEventQuality", "CORROBORATION_STATES", "deriveEventStatus", "isConflictIntelligenceEvent", "earliestConflictDate", `${body}; return applyEscalation;`)(
    readEventQuality, () => "fingerprint", mergeEventQuality, CORROBORATION_STATES, () => "developing", isConflictIntelligenceEvent, earliestConflictDate,
  );
  const update = apply({ report_type: "conflict", occurred_at: date(60), metadata: {} }, { occurred_at: date(1), metadata: {} });
  assert.equal(update.occurred_at, date(60));
  assert.equal("updated_at" in update, false);
  assert.equal("updated_at" in apply({ report_type: "signal", metadata: {} }, { metadata: {} }), true);
});

test("main worker rejects expired or undated conflict reports before generic time normalization", async () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function insertEventIfValid("), source.indexOf("async function pruneStaleData("));
  const insert = new Function("isConflictIntelligenceEvent", "isActiveConflictItem", "normalizeEventRowForStorage", "shouldPromoteToOperationalEvent", "isMilitaryRelevantEvent", `${body}; return insertEventIfValid;`)(
    isConflictIntelligenceEvent, isActiveConflictItem, () => { throw new Error("must reject before normalization"); }, () => true, () => true,
  );
  assert.equal(await insert({ report_type: "news", occurred_at: new Date(Date.now() - 73 * 3600000).toISOString() }), false);
  assert.equal(await insert({ report_type: "osint", fetched_at: new Date().toISOString() }), false);
});

test("undated normalization does not manufacture a current occurrence timestamp", () => {
  assert.equal(normalizeConflictItemToEventPayload(report({ published_at: null, fetched_at: date(0) })).event.occurred_at, null);
});

test("raw upserts preserve original publication, source attribution and unrelated records", async () => {
  const old = report({ id: "old", raw: {}, published_at: date(60) });
  const db = database({ conflict_feed_items: [old, report({ id: "other", url: "https://example.test/other" })] });
  const result = await upsertConflictFeedItems([report({ published_at: date(1) }), report({ url: "https://example.test/new" })], { db });
  assert.equal(result.ok, true);
  assert.equal(result.inserted_count, 1);
  assert.equal(result.updated_count, 1);
  assert.equal(db.tables.conflict_feed_items.find((row) => row.id === "old").published_at, date(60));
  assert.equal(db.tables.conflict_feed_items.length, 3);
  assert.ok(result.items[0].raw._event_quality.source_provenance.length);
  await upsertConflictFeedItems([], { db });
  assert.equal(db.tables.conflict_feed_items.length, 3);
});

test("read errors prevent blind upserts that could reset age", async () => {
  let writes = 0;
  const db = { from() { return { select() { return this; }, in() { return { error: { message: "read unavailable" } }; }, upsert() { writes++; } }; } };
  const result = await upsertConflictFeedItems([report()], { db });
  assert.equal(result.ok, false); assert.equal(writes, 0);
});

test("global persisted backfill reads all pages including the final partial page", async () => {
  const db = database({ conflict_feed_items: Array.from({ length: 7 }, (_, i) => report({ id: i })) });
  const rows = await readConflictBackfill(db, { now, pageSize: 3 });
  assert.equal(rows.length, 7);
  assert.deepEqual(db.calls.filter(([op]) => op === "range").map((call) => call.slice(2)), [[0, 2], [3, 5], [6, 8]]);
});

test("old eligible reports are promoted, repeats merge without renewed time or duplicates", async () => {
  const db = database();
  const first = await promoteConflictFeedItemsToEvents([report()], { db, now, logger });
  assert.equal(first.promoted_count, 1);
  db.tables.events[0].confidence = 1;
  const second = await promoteConflictFeedItemsToEvents([report({ published_at: date(1) })], { db, now, logger });
  assert.equal(second.ok, true);
  assert.equal(second.updated_count, 1);
  assert.equal(db.tables.events.length, 1);
  assert.equal(db.tables.events[0].occurred_at, date(60));
  const third = await promoteConflictFeedItemsToEvents([report()], { db, now, logger });
  assert.equal(third.duplicate_count, 1);
  assert.equal(third.updated_count, 0);
});

test("promotion cap defers new events but still updates existing records", async () => {
  const normalized = normalizeConflictItemToEventPayload(report());
  const db = database({ events: [{ id: "existing", ...normalized.event }] });
  const result = await promoteConflictFeedItemsToEvents([
    report({ url: "https://example.test/second", title: "Drone strike reported in Kyiv", summary: "Drone strike in Kyiv damaged buildings." }),
    report(),
    report({ url: "https://example.test/third", title: "Drone strike reported in Riyadh", summary: "Drone strike in Riyadh damaged buildings." }),
  ], { db, now, logger, limit: 1 });
  assert.equal(result.promoted_count, 1);
  assert.equal(result.updated_count, 1);
  assert.equal(result.deferred_count, 1);
});

test("corroboration never relabels independent signals or explicitly unrelated news", async () => {
  const independent = [
    { id: "signal", report_type: "signal", source_url: report().url, metadata: {} },
    { id: "other-news", report_type: "news", source_url: report().url, metadata: { intelligence_pipeline: "another-system" } },
  ];
  const db = database({ events: independent });
  const result = await promoteConflictFeedItemsToEvents([report()], { db, now, logger });
  assert.equal(result.promoted_count, 1);
  assert.deepEqual(db.tables.events.slice(0, 2), independent);
});

test("expired, future and undated reports never become active map events", async () => {
  const db = database();
  const result = await promoteConflictFeedItemsToEvents([report({ published_at: date(73) }), report({ published_at: null }), report({ published_at: date(-1) })], { db, now, logger });
  assert.equal(result.skipped_old_count, 1);
  assert.equal(result.skipped_future_count, 1);
  assert.equal(result.skipped_missing_timestamp_count, 1);
  assert.equal(db.tables.events.length, 0);
});

test("deduplication retains earliest report time independently of primary source ranking", () => {
  const merged = mergeDuplicateGroup([report({ published_at: date(1) }), report({ source_name: "Other", published_at: date(60), url: "https://example.test/other" })]);
  assert.equal(merged.published_at, date(60));
  assert.equal(merged.raw._dedupe.supporting_sources.length, 1);
});

test("client consumes every page and deduplicates page overlaps by stable id", async () => {
  const offsets = [];
  const rows = await collectMapEventPages({ events: [{ id: "a" }], meta: { has_more: true, next_offset: 800 } }, async (offset) => {
    offsets.push(offset); return { events: [{ id: "a" }, { id: "b" }], meta: { has_more: false } };
  });
  assert.deepEqual(offsets, [800]); assert.deepEqual(rows.map((row) => row.id), ["a", "b"]);
  await assert.rejects(collectMapEventPages({ meta: { has_more: true, next_offset: -1 } }, () => {}), /pagination/);
});

test("map caches keep all active conflict reports while preserving the independent-row bound", () => {
  const source = readFileSync(new URL("../../../dev/assets/js/supabase.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function retainMapEventRows("), source.indexOf("function filterLegacyMapEventsToRegion("));
  const merge = new Function("isConflictIntelligenceEvent", "isActiveConflictItem", "MAP_EVENTS_BOOTSTRAP_LIMIT", `${body}; return mergeMapEventRows;`)(
    isConflictIntelligenceEvent, isActiveConflictItem, 800,
  );
  const currentTime = new Date().toISOString();
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `signal-${i}`, report_type: "signal" }))
    .concat(Array.from({ length: 3 }, (_, i) => ({ id: `conflict-${i}`, dedupe_key: `conflict-feed:${i}`, occurred_at: currentTime })));
  const retained = merge(rows, rows[0]);
  assert.equal(retained.length, 803);
  assert.equal(retained.filter(isConflictIntelligenceEvent).length, 3);
  assert.equal(retained.filter((row) => row.id === "signal-0").length, 1);
});

test("maintenance migration absence is reported without deleting or replacing data", async () => {
  const result = await maintainConflictRetention({ rpc: async () => ({ error: { code: "PGRST202" } }) }, logger);
  assert.equal(result.ok, false); assert.equal(result.migration_required, true);
});

test("existing event polling expires only conflict markers even when no new reports arrive", () => {
  const source = readFileSync(new URL("../../../dev/assets/js/essential.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function expireConflictEvents("), source.indexOf("async function pollLatestEvents("));
  const old = { id: "expired", dedupe_key: "conflict-feed:old", occurred_at: date(73) };
  const live = { id: "current", dedupe_key: "conflict-feed:current", occurred_at: date(1) };
  const independent = { id: "signal", report_type: "signal", occurred_at: date(73) };
  const rows = [old, live, independent];
  const globeUpdates = [];
  const widgetUpdates = [];
  const state = new Function("isConflictIntelligenceEvent", "isActiveConflictItem", "window", "renderAll", "syncHotspotLayerEvents", "applyHotspotFilters",
    "__allEventsCache", "__eventsCache", "__visibleEventsCache", "__liveRecentEvents", "__viewportScoped",
    `${body}; return { expire: expireConflictEvents, read: () => __allEventsCache };`)(
    isConflictIntelligenceEvent, isActiveConflictItem,
    { __warzoneViewer: { __warzoneLastSourceEvents: rows, __warzone: { addEvents: (events) => globeUpdates.push(events) } } },
    (events) => widgetUpdates.push(events), () => {}, (events) => events,
    rows, rows, rows, rows, false,
  );
  state.expire(now);
  assert.deepEqual(state.read().map((event) => event.id), ["current", "signal"]);
  assert.deepEqual(globeUpdates[0].map((event) => event.id), ["current", "signal"]);
  state.expire(now);
  assert.equal(widgetUpdates.length, 1);
});

test("an empty or failed provider refresh preserves and replays stored intelligence", async () => {
  const db = database({ conflict_feed_items: [report({ id: "retained", published_at: new Date(Date.now() - 60 * 3600000).toISOString() })] });
  db.rpc = async () => ({ data: { expired_events: 0, expired_reports: 0, retained_events: 1 } });
  const empty = { fetched_at: date(0), items: [], rss: {}, live_html: {}, telegram: {}, source_health: {} };
  const emptyResult = await runConflictFeedSync({ db, logger, fetchFeed: async () => empty });
  assert.equal(emptyResult.ok, true);
  assert.equal(db.tables.conflict_feed_items.length, 1);
  assert.equal(db.tables.events.length, 1);
  const failedResult = await runConflictFeedSync({ db, logger: { ...logger, error() {} }, fetchFeed: async () => { throw new Error("provider unavailable"); } });
  assert.equal(failedResult.ok, false);
  assert.equal(db.tables.conflict_feed_items.length, 1);
  assert.equal(db.tables.events.length, 1);
});
