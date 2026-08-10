import test from "node:test";
import assert from "node:assert/strict";
import { getReportingConfigStatus, readReportingConfig } from "../../shared/reporting-config.js";

test("reporting API and scheduled generation can be controlled separately", () => {
  const config = readReportingConfig({
    REPORTING_ENABLED: "false",
    REPORTING_API_ENABLED: "true",
    REPORTING_SCHEDULE_ENABLED: "false",
  });

  assert.equal(config.enabled, false);
  assert.equal(config.apiEnabled, true);
  assert.equal(config.scheduleEnabled, false);
  assert.equal(config.snapshotEnabled, false);
  assert.equal(config.dailyEnabled, true);
  assert.equal(config.weeklyEnabled, false);
});

test("split reporting flags fall back to legacy REPORTING_ENABLED", () => {
  const disabled = readReportingConfig({ REPORTING_ENABLED: "false" });
  assert.equal(disabled.apiEnabled, false);
  assert.equal(disabled.scheduleEnabled, false);

  const enabled = readReportingConfig({ REPORTING_ENABLED: "true" });
  assert.equal(enabled.apiEnabled, true);
  assert.equal(enabled.scheduleEnabled, true);
  assert.equal(enabled.snapshotEnabled, true);
});

test("daily snapshot persistence can run without enabling report or PDF generation", () => {
  const config = readReportingConfig({
    REPORTING_ENABLED: "false",
    REPORTING_API_ENABLED: "false",
    REPORTING_SCHEDULE_ENABLED: "false",
    REPORTING_SNAPSHOT_ENABLED: "true",
    REPORTING_SNAPSHOT_CRON: "12 0 * * *",
  });

  assert.equal(config.snapshotEnabled, true);
  assert.equal(config.scheduleEnabled, false);
  assert.equal(config.snapshotCron, "12 0 * * *");
  assert.equal(config.retentionDays, 365);
  const status = getReportingConfigStatus(config);
  assert.equal(status.snapshotReady, true);
  assert.equal(status.reportStorageReady, false);
  assert.equal(status.ready, true);
  assert.deepEqual(status.missing, []);
});

test("capture configuration is centralized and remains disabled by default", () => {
  const disabled = readReportingConfig({ REPORTING_ENABLED: "false" });
  assert.equal(disabled.capture.enabled, false);

  const enabled = readReportingConfig({
    REPORTING_ENABLED: "false",
    REPORTING_CAPTURE_ENABLED: "true",
    REPORTING_CAPTURE_BASE_URL: "http://127.0.0.1:4173/",
    REPORTING_CAPTURE_TOKEN: "capture-token",
    REPORTING_CAPTURE_WIDTH: "1920",
    REPORTING_CAPTURE_HEIGHT: "1080",
    REPORTING_CAPTURE_FORMAT: "png",
    REPORTING_CAPTURE_MAX_IMAGES: "6",
    REPORTING_CAPTURE_RETENTION_HOURS: "30",
  });
  assert.equal(enabled.capture.enabled, true);
  assert.equal(enabled.capture.baseUrl, "http://127.0.0.1:4173");
  assert.equal(enabled.capture.width, 1920);
  assert.equal(enabled.capture.height, 1080);
  assert.equal(enabled.capture.format, "png");
  assert.equal(enabled.capture.maxImages, 6);
  assert.equal(enabled.capture.retentionHours, 30);
  assert.equal(getReportingConfigStatus(enabled).captureEnabled, true);
  assert.deepEqual(getReportingConfigStatus(enabled).missing, []);
});

test("PDF validation and public asset settings have production-safe defaults", () => {
  const defaults = readReportingConfig({ REPORTING_ENABLED: "false" });
  assert.equal(defaults.publicHistoryDays, 7);
  assert.equal(defaults.publishedRetentionDays, 7);
  assert.equal(defaults.pdf.readinessTimeoutMs, 45000);
  assert.equal(defaults.pdf.minimumSizeBytes, 10000);
  assert.equal(defaults.publicAssetBaseUrl, "");

  const configured = readReportingConfig({
    REPORTING_ENABLED: "false",
    REPORTING_PUBLIC_HISTORY_DAYS: "9",
    REPORTING_PUBLISHED_RETENTION_DAYS: "14",
    REPORTING_PUBLIC_ASSET_BASE_URL: "https://stratops.example/",
    REPORTING_PDF_READY_TIMEOUT_MS: "60000",
  });
  assert.equal(configured.publicAssetBaseUrl, "https://stratops.example");
  assert.equal(configured.publicHistoryDays, 9);
  assert.equal(configured.publishedRetentionDays, 14);
  assert.equal(configured.pdf.readinessTimeoutMs, 60000);
});

test("report storage readiness accepts an explicitly configured EC2 IAM role", () => {
  const config = readReportingConfig({
    REPORTING_ENABLED: "true",
    AWS_S3_BUCKET: "reports-bucket",
    REPORTING_AWS_USE_IAM_ROLE: "true",
  });
  const status = getReportingConfigStatus(config);
  assert.equal(config.aws.roleCredentialSourceAvailable, true);
  assert.equal(status.reportStorageReady, true);
  assert.deepEqual(status.missing, []);
});
