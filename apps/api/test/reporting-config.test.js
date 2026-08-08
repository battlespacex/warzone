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
  assert.equal(config.retentionDays, 90);
  const status = getReportingConfigStatus(config);
  assert.equal(status.snapshotReady, true);
  assert.equal(status.reportStorageReady, false);
  assert.equal(status.ready, true);
  assert.deepEqual(status.missing, []);
});
