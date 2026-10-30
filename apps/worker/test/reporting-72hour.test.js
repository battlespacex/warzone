import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { buildReportObjectKeys, buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import { buildReportRenderModel, renderReportHtml } from "../../shared/reporting-html.js";
import { get72HourPeriod, getClosed72HourPeriods } from "../../shared/reporting-72hour-period.js";
import { __reportingServiceTestUtils, generate72HourSnapshot } from "../../shared/reporting-service.js";
import { run72HourReportingCheck, validate72HourConfig } from "../src/reporting-72hour-scheduler.js";

const anchor = "2026-01-01T00:00:00.000Z";
const config = readReportingConfig({
  REPORTING_SCHEDULE_ENABLED: "true", REPORTING_72H_ENABLED: "true",
  REPORTING_72H_ANCHOR_UTC: anchor, REPORTING_72H_CATCHUP_START_UTC: anchor,
  REPORTING_72H_MAX_CATCHUP_PER_RUN: "2",
});

test("fixed UTC windows close exactly once with no gaps or overlaps", () => {
  assert.equal(get72HourPeriod("2026-01-03T23:59:59.999Z", anchor).startIso, anchor);
  assert.equal(get72HourPeriod("2026-01-04T00:00:00.000Z", anchor).startIso, "2026-01-04T00:00:00.000Z");
  const periods = getClosed72HourPeriods({ now: "2026-01-13T00:00:00.000Z", anchor, catchupStart: anchor, limit: 10 });
  assert.equal(periods.length, 4);
  for (let i = 1; i < periods.length; i += 1) assert.equal(periods[i - 1].endIso, periods[i].startIso);
  assert.equal(periods.at(-1).endIso, "2026-01-13T00:00:00.000Z");
  assert.equal(getClosed72HourPeriods({ now: "2026-01-03T23:59:59.999Z", anchor, catchupStart: anchor }).length, 0);
});

test("72-hour snapshot and publication keys cannot collide with daily", () => {
  assert.equal(buildSnapshotKey("2026-01-01", "global", 1, "72hour"), "72hour:2026-01-01:global:v1");
  assert.equal(buildReportObjectKeys({ dateKey: "2026-01-01", scope: { type: "global" }, reportType: "72hour" }).report_pdf,
    "reports/72hour/global/2026-01-01/report.pdf");
  assert.notEqual(buildSnapshotKey("2026-01-01", "global"), buildSnapshotKey("2026-01-01", "global", 1, "72hour"));
});

function emptyQuery() {
  const query = new Proxy({}, { get: (_target, name) => name === "then"
    ? (resolve) => resolve({ data: [], error: null })
    : () => query });
  return query;
}

test("startup catch-up is chronological, bounded, image-free and does not launch capture", async () => {
  const calls = [];
  const supabase = {
    from: () => emptyQuery(),
    rpc: async (name) => {
      calls.push(name);
      if (name === "claim_operational_72hour_job") return { data: [{ token: "test-token", attempt: 1 }], error: null };
      return { data: true, error: null };
    },
  };
  const seen = [];
  const result = await run72HourReportingCheck({ supabase, config, now: "2026-01-13T00:00:00.000Z",
    logger: { log() {}, warn() {}, error() {} },
    runPipeline: async (options) => { seen.push(options); return { ok: true }; } });
  assert.equal(result.attempted, 2);
  assert.deepEqual(seen.map((item) => item.period.startIso), [anchor, "2026-01-04T00:00:00.000Z"]);
  assert.ok(seen.every((item) => item.reportType === "72hour" && item.skipCapture === true && item.lease));
  assert.equal(calls.filter((name) => name === "claim_operational_72hour_job").length, 2);
});

test("unsafe lease and retention settings are rejected", () => {
  assert.throws(() => validate72HourConfig({ ...config, hour72: { ...config.hour72, renewalMinutes: 20, leaseMinutes: 20 } }));
  assert.throws(() => validate72HourConfig({ ...config, hour72: { ...config.hour72, s3RetentionDays: 14 } }));
});

test("an unclaimed period stays pending and becomes retryable after the lease is released", async () => {
  let claimAvailable = false;
  let pipelineCalls = 0;
  const supabase = {
    from: () => emptyQuery(),
    rpc: async (name) => name === "claim_operational_72hour_job"
      ? { data: claimAvailable ? [{ token: "recovered", attempt: 2 }] : [], error: null }
      : { data: true, error: null },
  };
  const logger = { log() {}, warn() {}, error() {} };
  const pending = await run72HourReportingCheck({ supabase, config, now: "2026-01-04T00:00:00.000Z",
    logger, runPipeline: async () => { pipelineCalls += 1; } });
  assert.equal(pending.attempted, 0);
  claimAvailable = true;
  const recovered = await run72HourReportingCheck({ supabase, config, now: "2026-01-04T00:00:00.000Z",
    logger, runPipeline: async () => { pipelineCalls += 1; } });
  assert.equal(recovered.attempted, 1);
  assert.equal(pipelineCalls, 1);
});

test("72-hour HTML states exact UTC coverage and has no capture placeholders", async () => {
  const snapshot = {
    report_type: "72hour", snapshot_key: "72hour:2026-01-01:global:v1", snapshot_date: "2026-01-01",
    window_start: anchor, window_end: "2026-01-04T00:00:00.000Z",
    scope_type: "global", scope_key: "global", scope_label: "Global",
    snapshot_data: { report_type: "72hour", report_content: {}, window: { start: anchor, end: "2026-01-04T00:00:00.000Z" } },
    report_manifest: { capture_results: [], selected_images: [] },
  };
  const model = buildReportRenderModel(snapshot);
  const [templateHtml, templateCss] = await Promise.all([
    readFile(new URL("../../../dev/reports/template/reports-template.html", import.meta.url), "utf8"),
    readFile(new URL("../../../dev/reports/template/reports.css", import.meta.url), "utf8"),
  ]);
  const html = renderReportHtml({ templateHtml, templateCss, model });
  assert.match(html, /72-Hour Operational Report/);
  assert.match(html, /2026-01-01T00:00:00Z THROUGH 2026-01-04T00:00:00Z/);
  assert.doesNotMatch(html, /<h1>OPERATIONAL IMAGERY<\/h1>|<figure class="report-image-block/);
  assert.equal(model.imagery.length, 0);
});

function sourceFixture({ statusUnavailable = false } = {}) {
  const requests = [];
  const rows = {
    events: [{ id: "event-1", title: "Airport restriction reported", category: "airspace",
      occurred_at: "2026-01-02T12:00:00.000Z", source_name: "Authority", severity: "medium" }],
    conflict_feed_items: [{ id: "intel-1", title: "Regional update", published_at: "2026-01-03T11:00:00.000Z",
      fetched_at: "2026-01-03T12:00:00.000Z", url: "https://example.test/intel-1", category: "military" }],
    tracks: [], aircraft_tracks_log: [], naval_tracks_log: [],
    status_feed_items: [{ id: "status-1", guid: "status-1", title: "Airport status", category: "airspace",
      published_at: "2026-01-02T00:00:00.000Z", url: "https://example.test/status-1",
      raw: { status_signal: { kind: "reported_signal" } } }],
  };
  return {
    requests,
    from(table) {
      let payload;
      const filters = [];
      const query = {
        select() { return query; }, eq(column, value) { filters.push(["eq", column, value]); return query; },
        or() { return query; },
        is(column, value) { filters.push(["is", column, value]); return query; },
        gte(column, value) { filters.push(["gte", column, value]); return query; },
        lt(column, value) { filters.push(["lt", column, value]); return query; },
        order() { return query; },
        range(first, last) {
          requests.push({ table, filters: [...filters] });
          if (table === "status_feed_items" && statusUnavailable) return Promise.resolve({ data: null, error: new Error("status source unavailable") });
          return Promise.resolve({ data: (rows[table] || []).slice(first, last + 1), error: null });
        },
        upsert(value) { payload = value; return query; },
        maybeSingle() { return Promise.resolve({ data: { ...payload, snapshot_id: "snapshot-1" }, error: null }); },
        then(resolve) { resolve({ count: 0, error: null }); },
      };
      return query;
    },
  };
}

test("snapshot queries exact UTC boundaries, includes status signals, and records optional failure", async () => {
  const period = get72HourPeriod(anchor, anchor);
  const source = sourceFixture();
  const snapshot = await generate72HourSnapshot({ supabase: source, period, config });
  assert.equal(snapshot.window_start, anchor);
  assert.equal(snapshot.window_end, "2026-01-04T00:00:00.000Z");
  assert.equal(snapshot.report_type, "72hour");
  assert.equal(snapshot.snapshot_data.source_health.status_feed_items.count, 1);
  assert.equal(snapshot.report_manifest.selected_capture_targets.length, 0);
  assert.ok(source.requests.filter((request) => ["events", "conflict_feed_items", "tracks", "status_feed_items"].includes(request.table))
    .every((request) => request.filters.some(([op, , value]) => op === "gte" && value === anchor)
      || request.filters.some(([op]) => op === "is")));
  const failedSource = sourceFixture({ statusUnavailable: true });
  const incomplete = await generate72HourSnapshot({ supabase: failedSource, period, config });
  assert.equal(incomplete.snapshot_data.source_health.status_feed_items.status, "unavailable");
  assert.match(incomplete.snapshot_data.report_content.executive_summary, /cannot be inferred from zero counts/);
});

test("bounded pagination reads all pages and fails explicitly at its safety cap", async () => {
  const pages = [Array.from({ length: 2 }, (_, id) => ({ id })), [{ id: 2 }]];
  const buildQuery = () => ({ range: async (first) => ({ data: pages[first / 2] || [], error: null }) });
  const rows = await __reportingServiceTestUtils.fetchPagedRows(buildQuery, { pageSize: 2, maxRows: 4 });
  assert.deepEqual(rows.map((row) => row.id), [0, 1, 2]);
  await assert.rejects(__reportingServiceTestUtils.fetchPagedRows(
    () => ({ range: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }) }),
    { pageSize: 2, maxRows: 4 }), /refusing a truncated report/);
});
