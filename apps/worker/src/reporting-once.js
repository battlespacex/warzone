import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { supabase } from "./supabase.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { ensureOperationalReport, generateDailySnapshot, generateScheduledReports, generateScheduledSnapshots, getPreviousUtcDateKey } from "../../shared/reporting-service.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match).slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const config = readReportingConfig();
const type = readArg("type", "daily").toLowerCase();
const dateKey = readArg("date", getPreviousUtcDateKey());
const scopeType = readArg("scope", "global").toLowerCase();
const scopeValue = readArg("value", "");
const runScheduled = hasFlag("scheduled");
const snapshotOnly = hasFlag("snapshot-only");

try {
  const result = runScheduled
    ? snapshotOnly
      ? await generateScheduledSnapshots({ supabase, config, logger: console })
      : await generateScheduledReports({ supabase, config, logger: console })
    : snapshotOnly
      ? await generateDailySnapshot({
        supabase,
        config,
        dateKey,
        scope: { type: scopeType, value: scopeValue },
      })
      : await ensureOperationalReport({
      supabase,
      config,
      reportType: type,
      dateKey,
      scope: { type: scopeType, value: scopeValue },
      force: hasFlag("force"),
    });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error("[reports:once] failed:", error?.message || error);
  process.exitCode = 1;
}
