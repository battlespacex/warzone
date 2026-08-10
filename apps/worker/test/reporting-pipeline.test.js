import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  __reportingPipelineTestUtils,
  cleanupPublishedDailyReports,
  generateScheduledDailyPipelines,
  PIPELINE_STAGES,
} from "../src/reporting-pipeline-service.js";

test("pipeline manifest extends the existing format with deterministic selected IDs", () => {
  const manifest = __reportingPipelineTestUtils.buildPipelineManifest({
    event_ids: ["event-1"],
    cluster_ids: ["cluster-1"],
    selected_hva: ["asset-1"],
  }, {
    overall_status: PIPELINE_STAGES.COMPLETE,
    pdf: { status: "READY", page_count: 5, size_bytes: 50000 },
  });
  assert.deepEqual(manifest.selected_event_ids, ["event-1"]);
  assert.deepEqual(manifest.selected_cluster_ids, ["cluster-1"]);
  assert.deepEqual(manifest.selected_hva_ids, ["asset-1"]);
  assert.equal(manifest.overall_status, "COMPLETE");
});

test("published manifest removes server paths while retaining capture traceability", () => {
  const privateCapture = {
      capture_id: "capture-1",
      capture_type: "HVA_FOCUS",
      status: "READY",
      asset_id: "asset-1",
      local_path: "D:\\private\\worker\\images\\asset.jpg",
      s3_key: "reports/daily/global/2026-08-07/images/asset.jpg",
      s3_url: "https://reports.example/images/asset.jpg",
      semantic_quality: { status: "READY" },
  };
  const manifest = __reportingPipelineTestUtils.buildPublishableManifest({
    capture_results: [privateCapture],
    selected_images: [privateCapture],
  });
  assert.equal(manifest.capture_results[0].relative_path, "images/asset.jpg");
  assert.equal(Object.hasOwn(manifest.capture_results[0], "local_path"), false);
  assert.equal(Object.hasOwn(manifest.selected_images[0], "local_path"), false);
  assert.doesNotMatch(JSON.stringify(manifest), /private|worker\\\\images/);
});

test("pipeline lock prevents overlapping work for the same report key", async () => {
  __reportingPipelineTestUtils.resetPipelineLocksForTests();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = __reportingPipelineTestUtils.withPipelineLock("daily:2026-08-07:global", async () => {
    await pending;
    return { ok: true, marker: "first" };
  });
  const second = await __reportingPipelineTestUtils.withPipelineLock("daily:2026-08-07:global", async () => ({ marker: "second" }));
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "report_pipeline_already_running");
  release();
  assert.equal((await first).marker, "first");
});

test("artifact upload uses the clean deterministic S3 keys including images", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratops-report-upload-"));
  try {
    await mkdir(join(directory, "images"));
    await Promise.all([
      writeFile(join(directory, "report.html"), "<html></html>"),
      writeFile(join(directory, "report.json"), "{}"),
      writeFile(join(directory, "report.pdf"), "%PDF-test"),
      writeFile(join(directory, "images", "overview.jpg"), "image"),
    ]);
    const keys = [];
    const uploadObject = async (config, item) => {
      keys.push(item.key);
      return { storageKey: item.key, url: `https://reports.example/${item.key}`, etag: "etag" };
    };
    const uploads = await __reportingPipelineTestUtils.uploadReportArtifacts({
      snapshot: {
        report_manifest: {
          object_keys: {
            report_html: "reports/daily/global/2026-08-07/report.html",
            report_json: "reports/daily/global/2026-08-07/report.json",
            manifest_json: "reports/daily/global/2026-08-07/manifest.json",
            report_pdf: "reports/daily/global/2026-08-07/report.pdf",
            images_prefix: "reports/daily/global/2026-08-07/images/",
          },
        },
      },
      outputDirectory: directory,
      config: {},
      uploadObject,
    });
    assert.deepEqual(keys, [
      "reports/daily/global/2026-08-07/report.html",
      "reports/daily/global/2026-08-07/report.json",
      "reports/daily/global/2026-08-07/report.pdf",
      "reports/daily/global/2026-08-07/images/overview.jpg",
    ]);
    assert.equal(uploads.images.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("scheduled production pipeline remains inert when scheduling is disabled", async () => {
  const result = await generateScheduledDailyPipelines({
    supabase: null,
    config: { scheduleEnabled: false },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "schedule_disabled");
});

test("published report cleanup is restricted to deterministic daily report folders", () => {
  const config = { s3Prefix: "reports" };
  const safe = {
    pdf_storage_key: "reports/daily/global/2026-08-02/report.pdf",
    report_body: {
      pipeline: {
        manifest: {
          capture_results: [
            { s3_key: "reports/daily/global/2026-08-02/images/overview.jpg" },
            { s3_key: "assets/shared-logo.svg" },
          ],
        },
      },
    },
  };
  assert.equal(
    __reportingPipelineTestUtils.getPublishedReportInstancePrefix(safe, config),
    "reports/daily/global/2026-08-02/"
  );
  assert.deepEqual(__reportingPipelineTestUtils.collectPublishedReportObjectKeys(safe, config), [
    "reports/daily/global/2026-08-02/report.html",
    "reports/daily/global/2026-08-02/report.pdf",
    "reports/daily/global/2026-08-02/report.json",
    "reports/daily/global/2026-08-02/manifest.json",
    "reports/daily/global/2026-08-02/images/overview.jpg",
  ]);
  assert.equal(__reportingPipelineTestUtils.getPublishedReportInstancePrefix({
    pdf_storage_key: "assets/report.pdf",
  }, config), "");
});

test("seven-day publication retention expires artifacts without touching snapshots", async () => {
  const report = {
    id: "report-aug-02",
    report_key: "daily:2026-08-02:global",
    report_type: "daily",
    status: "available",
    period_start: "2026-08-02T00:00:00.000Z",
    pdf_storage_key: "reports/daily/global/2026-08-02/report.pdf",
    report_body: { pipeline: { manifest: { capture_results: [] } } },
  };
  const calls = [];
  const supabase = {
    from(table) {
      calls.push({ action: "from", table });
      return {
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        lt() { return this; },
        order() { return Promise.resolve({ data: [report], error: null }); },
        update(payload) {
          calls.push({ action: "update", table, payload });
          return {
            eq() { return Promise.resolve({ error: null }); },
          };
        },
      };
    },
  };
  const deleted = [];
  const result = await cleanupPublishedDailyReports({
    supabase,
    config: { s3Prefix: "reports", publishedRetentionDays: 7 },
    latestPublishedDateKey: "2026-08-09",
    deleteObject: async (_config, { key }) => { deleted.push(key); },
    logger: { warn() {} },
  });
  assert.equal(result.retained_from_date, "2026-08-03");
  assert.equal(result.expired, 1);
  assert.equal(deleted.length, 4);
  assert.equal(calls.some((call) => call.table === "operational_report_snapshots"), false);
  const updates = calls.filter((call) => call.action === "update");
  assert.equal(updates[0].payload.status, "expired");
  assert.equal(updates[1].payload.pdf_storage_key, null);
});
