import { loadWorkerEnv } from "./env.js";
loadWorkerEnv();

import { supabase } from "./supabase.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { getPreviousUtcDateKey } from "../../shared/reporting-service.js";
import {
  generateScheduledDailyPipelines,
  runDailyReportPipeline,
} from "./reporting-pipeline-service.js";

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

try {
  if (type !== "daily") {
    throw new Error(
      `Canonical reports:once currently supports daily reports only. Refusing legacy ${type} PDF generation.`
    );
  }

  const result = runScheduled
    ? await generateScheduledDailyPipelines({ supabase, config, logger: console })
    : await runDailyReportPipeline({
        supabase,
        config,
        dateKey,
        scope: { type: scopeType, value: scopeValue },
        force: hasFlag("force"),
        skipCapture: hasFlag("skip-capture"),
        skipUpload: hasFlag("skip-upload"),
        localOnly: hasFlag("local-only"),
        logger: console,
      });

  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error("[reports:once] failed:", error?.message || error);
  process.exitCode = 1;
}
