import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { supabase } from "./supabase.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { getPreviousUtcDateKey } from "../../shared/reporting-service.js";
import { captureSnapshotByDate, cleanupExpiredReportCaptures } from "./reporting-capture-service.js";
import { runReportingDevHvaFixture } from "./reporting-dev-hva-fixture-service.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match).slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const config = readReportingConfig();
const dateKey = readArg("date", getPreviousUtcDateKey());
const scopeType = readArg("scope", "global").toLowerCase();
const scopeValue = readArg("value", "");
const force = hasFlag("force");
const devHvaFixture = hasFlag("dev-hva-fixture");

try {
  const result = devHvaFixture
    ? await runReportingDevHvaFixture({
      supabase,
      config,
      dateKey,
      scope: { type: scopeType, value: scopeValue },
      localOnly: hasFlag("local-only"),
      scheduled: hasFlag("scheduled"),
      captureOnly: true,
      logger: console,
    })
    : await captureSnapshotByDate({
      supabase,
      config,
      dateKey,
      scope: { type: scopeType, value: scopeValue },
      force,
      logger: console,
    });
  const cleanup = devHvaFixture ? { skipped: true, reason: "dev_hva_fixture" } : await cleanupExpiredReportCaptures({ config });
  console.log(JSON.stringify({ ok: result.ok, result, cleanup }, null, 2));
} catch (error) {
  console.error("[reports:capture] failed:", error?.message || error);
  process.exitCode = 1;
}
