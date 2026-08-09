import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { supabase } from "./supabase.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { getPreviousUtcDateKey } from "../../shared/reporting-service.js";
import { generatePdfByDate } from "./reporting-pdf-service.js";

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => String(arg || "").startsWith(prefix));
  return match ? String(match).slice(prefix.length) : fallback;
}

const config = readReportingConfig();
const dateKey = readArg("date", getPreviousUtcDateKey());
const scopeType = readArg("scope", "global").toLowerCase();
const scopeValue = readArg("value", "");

try {
  const result = await generatePdfByDate({
    supabase,
    config,
    dateKey,
    scope: { type: scopeType, value: scopeValue },
  });
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error("[reports:pdf] failed:", error?.message || error);
  process.exitCode = 1;
}
