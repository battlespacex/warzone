import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { supabase } from "./supabase.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { getPreviousUtcDateKey } from "../../shared/reporting-service.js";
import { captureSnapshotByDate, cleanupExpiredReportCaptures } from "./reporting-capture-service.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match).slice(prefix.length) : fallback;
}

const config = readReportingConfig();
const dateKey = readArg("date", getPreviousUtcDateKey());
const scopeType = readArg("scope", "global").toLowerCase();
const scopeValue = readArg("value", "");
const force = process.argv.includes("--force");

try {
  const result = await captureSnapshotByDate({
    supabase,
    config,
    dateKey,
    scope: { type: scopeType, value: scopeValue },
    force,
    logger: console,
  });
  const cleanup = await cleanupExpiredReportCaptures({ config });
  console.log(JSON.stringify({ ok: result.ok, result, cleanup }, null, 2));
} catch (error) {
  console.error("[reports:capture] failed:", error?.message || error);
  process.exitCode = 1;
}
