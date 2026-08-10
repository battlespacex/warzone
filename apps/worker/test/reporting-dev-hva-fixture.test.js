import test from "node:test";
import assert from "node:assert/strict";
import {
  DEV_HVA_ASSET_ID,
  assertReportingDevHvaFixtureAllowed,
  createReportingDevHvaFixture,
  injectReportingDevHvaFixture,
} from "../../shared/reporting-dev-hva-fixture.js";
import { buildCaptureDescriptors, buildSnapshotAssetRenderInput } from "../../shared/reporting-capture.js";
import { buildReportRenderModel } from "../../shared/reporting-html.js";
import {
  createFixtureCaptureSnapshot,
  createLocalFixtureConfig,
  createTransientSnapshotState,
} from "../src/reporting-dev-hva-fixture-service.js";

function baseSnapshot() {
  return {
    snapshot_key: "daily:2026-08-08:global:v1",
    snapshot_date: "2026-08-08",
    window_start: "2026-08-08T00:00:00.000Z",
    window_end: "2026-08-09T00:00:00.000Z",
    scope_type: "global",
    scope_key: "global",
    scope_label: "Global",
    snapshot_data: {
      report_date: "2026-08-08",
      window: { start: "2026-08-08T00:00:00.000Z", end: "2026-08-09T00:00:00.000Z" },
      scope: { type: "global", key: "global", label: "Global" },
      overall_activity: {},
      selections: {},
      report_content: {
        headline_stats: [],
        major_developments: [],
        high_value_assets: { all_qualified: [], selected_for_report: [], capture_requirements: [] },
        operational_imagery_targets: [],
      },
    },
    report_manifest: { selected_capture_targets: [], capture_requirements: [], capture_results: [], selected_images: [] },
  };
}

test("dev E-4B fixture is deterministic and bounded by the requested report window", () => {
  const asset = createReportingDevHvaFixture({
    dateKey: "2026-08-08",
    windowStart: "2026-08-08T00:00:00.000Z",
    windowEnd: "2026-08-09T00:00:00.000Z",
  });
  assert.equal(asset.asset_id, DEV_HVA_ASSET_ID);
  assert.equal(asset.callsign, "ORDER01");
  assert.equal(asset.type, "E-4B");
  assert.equal(asset.model_code, "AWACS-E4");
  assert.deepEqual([asset.latitude, asset.longitude, asset.altitude_ft, asset.speed_kts, asset.heading_deg], [38.85, -77.04, 28000, 410, 225]);
  assert.ok(Date.parse(asset.first_observed) >= Date.parse("2026-08-08T00:00:00.000Z"));
  assert.ok(Date.parse(asset.last_observed) <= Date.parse("2026-08-09T00:00:00.000Z"));
});

test("fixture injection selects exactly one dev asset and forces both normal HVA captures", () => {
  const original = baseSnapshot();
  const injected = injectReportingDevHvaFixture(original);
  const selected = injected.snapshot_data.report_content.high_value_assets.selected_for_report;
  assert.equal(selected.filter((asset) => asset.asset_id === DEV_HVA_ASSET_ID).length, 1);
  assert.equal(injected.snapshot_data.report_content.high_value_assets.all_qualified.some((asset) => asset.asset_id === DEV_HVA_ASSET_ID), false);
  assert.equal(original.snapshot_data.report_content.high_value_assets.selected_for_report.length, 0);
  const descriptors = buildCaptureDescriptors(injected, { maxImages: 8, format: "jpeg" })
    .filter((item) => item.asset_id === DEV_HVA_ASSET_ID);
  assert.deepEqual(descriptors.map((item) => item.capture_type).sort(), ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT"]);
  const renderInput = buildSnapshotAssetRenderInput(selected[0]);
  assert.equal(renderInput.expected_model_family, "AWACS-E4");
  assert.equal(renderInput.event.metadata.type_code, "E-4B");
  const reportModel = buildReportRenderModel(injected);
  const reportAsset = reportModel.high_value_assets.find((asset) => asset.asset_id === DEV_HVA_ASSET_ID);
  assert.equal(reportAsset.display_title, "US E-4B NIGHTWATCH - ORDER01");
  assert.equal(reportAsset.status, "DEV FIXTURE");
});

test("fixture safety rejects non-local, scheduled and production execution", () => {
  const safeConfig = { scheduleEnabled: false };
  assert.throws(() => assertReportingDevHvaFixtureAllowed({ config: safeConfig, localOnly: false, environment: {} }), /requires --local-only/);
  assert.throws(() => assertReportingDevHvaFixtureAllowed({ config: { scheduleEnabled: true }, localOnly: true, environment: {} }), /scheduling is enabled/);
  assert.throws(() => assertReportingDevHvaFixtureAllowed({ config: safeConfig, localOnly: true, scheduled: true, environment: {} }), /scheduling is enabled/);
  assert.throws(() => assertReportingDevHvaFixtureAllowed({ config: safeConfig, localOnly: true, environment: { NODE_ENV: "production" } }), /production/);
  assert.equal(assertReportingDevHvaFixtureAllowed({ config: safeConfig, localOnly: true, environment: { NODE_ENV: "development" } }), true);
});

test("fixture configuration disables object storage and transient state stays in memory", () => {
  const config = createLocalFixtureConfig({
    publicAssetBaseUrl: "https://cdn.example.test",
    aws: { bucket: "production-bucket", region: "us-east-1" },
    capture: { enabled: false, maxImages: 8 },
  });
  assert.equal(config.aws.bucket, "");
  assert.equal(config.publicAssetBaseUrl, "");
  assert.equal(config.capture.enabled, true);
  const state = createTransientSnapshotState(baseSnapshot());
  state.persistManifest(null, state.snapshot.snapshot_key, { status: "READY", dev_fixture: { enabled: true } });
  assert.equal(state.snapshot.report_manifest.status, "READY");
});

test("fixture capture snapshot excludes unrelated capture work", () => {
  const injected = injectReportingDevHvaFixture(baseSnapshot());
  injected.snapshot_data.report_content.operational_imagery_targets.push({ type: "OPERATIONAL_OVERVIEW", priority: 100 });
  const captureSnapshot = createFixtureCaptureSnapshot(injected);
  const descriptors = buildCaptureDescriptors(captureSnapshot, { maxImages: 8 });
  assert.deepEqual(descriptors.map((item) => item.capture_type).sort(), ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT"]);
  assert.ok(descriptors.every((item) => item.asset_id === DEV_HVA_ASSET_ID));
});
