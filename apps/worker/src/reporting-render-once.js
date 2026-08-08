import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { supabase } from "./supabase.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { getPreviousUtcDateKey } from "../../shared/reporting-service.js";
import { renderSnapshotByDate } from "./reporting-render-service.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match).slice(prefix.length) : fallback;
}

const config = readReportingConfig();
const dateKey = readArg("date", getPreviousUtcDateKey());
const scopeType = readArg("scope", "global").toLowerCase();
const scopeValue = readArg("value", "");
const localOnly = process.argv.includes("--local-only");

try {
  const result = await renderSnapshotByDate({
    supabase,
    config,
    dateKey,
    scope: { type: scopeType, value: scopeValue },
    upload: localOnly ? false : undefined,
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error("[reports:render] failed:", error?.message || error);
  process.exitCode = 1;
}
