import crypto from "crypto";
import os from "os";
import { getClosed72HourPeriods, parseAnchor } from "../../shared/reporting-72hour-period.js";
import { s3DeleteObject } from "../../shared/reporting-s3.js";
import { getScheduledScopes, getScopeKey } from "../../shared/reporting-service.js";
import { runDailyReportPipeline } from "./reporting-pipeline-service.js";

const owner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
let running = false;

function validate72HourConfig(config) {
  const settings = config?.hour72;
  if (!settings) throw new Error("72-hour reporting configuration is missing");
  parseAnchor(settings.anchorUtc);
  const boundary = Date.parse(settings.catchupStartUtc);
  if (!Number.isFinite(boundary) || new Date(boundary).toISOString() !== settings.catchupStartUtc) {
    throw new Error("REPORTING_72H_CATCHUP_START_UTC must be an exact UTC ISO timestamp");
  }
  if (settings.renewalMinutes >= settings.leaseMinutes) throw new Error("72-hour lease renewal must be shorter than its duration");
  if (settings.s3RetentionDays < settings.publishedRetentionDays) throw new Error("72-hour S3 retention must not be shorter than published availability");
  const scopes = getScheduledScopes(config);
  const keys = new Set(settings.scopes);
  if (!keys.size || [...keys].some((key) => key !== "scheduled" && !scopes.some((scope) => getScopeKey(scope) === key))) {
    throw new Error("REPORTING_72H_SCOPES must contain configured scope keys or scheduled");
  }
  return keys.has("scheduled") ? scopes : scopes.filter((scope) => keys.has(getScopeKey(scope)));
}

async function cleanup72HourObjects(supabase, config, logger, now) {
  const delayDays = config.hour72.s3RetentionDays - config.hour72.publishedRetentionDays;
  const cutoff = new Date(new Date(now).getTime() - delayDays * 86400000).toISOString();
  const { data, error } = await supabase.from("operational_reports")
    .select("id, pdf_storage_key")
    .eq("report_type", "72hour")
    .in("status", ["available", "expired"])
    .lt("expires_at", cutoff)
    .not("pdf_storage_key", "is", null)
    .order("expires_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  const prefix = `${config.s3Prefix}/72hour/`;
  for (const report of data || []) {
    const pdfKey = String(report.pdf_storage_key || "");
    const suffix = pdfKey.startsWith(prefix) ? pdfKey.slice(prefix.length) : "";
    if (!/^(?:global|(?:region|country|aoi)\/[a-z0-9][a-z0-9-]*)\/\d{4}-\d{2}-\d{2}\/report\.pdf$/.test(suffix)) {
      logger.warn?.(`[reports:72hour] refusing unsafe retention key id=${report.id}`);
      continue;
    }
    try {
      const base = pdfKey.slice(0, -"report.pdf".length);
      for (const filename of ["report.html", "report.pdf", "report.json", "manifest.json"]) {
        await s3DeleteObject(config, { key: `${base}${filename}` });
      }
      const expired = await supabase.from("operational_reports")
        .update({ status: "expired", pdf_url: null, pdf_storage_key: null, pdf_etag: null,
          download_token: null, updated_at: new Date().toISOString() })
        .eq("id", report.id).lt("expires_at", cutoff);
      if (expired.error) throw expired.error;
    } catch (cleanupError) {
      logger.warn?.(`[reports:72hour] retention cleanup failed id=${report.id} error=${cleanupError.message}`);
    }
  }
}

async function readPublishedKeys(supabase, firstStart, lastEnd) {
  const keys = new Set();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("operational_reports")
      .select("report_key")
      .eq("report_type", "72hour")
      .in("status", ["available", "expired"])
      .gte("period_start", firstStart)
      .lt("period_start", lastEnd)
      .order("report_key", { ascending: true })
      .range(offset, offset + 499);
    if (error) throw error;
    (data || []).forEach((row) => keys.add(row.report_key));
    if ((data || []).length < 500) break;
  }
  return keys;
}

async function claimJob(supabase, jobKey, period, scopeKey, config) {
  const { data, error } = await supabase.rpc("claim_operational_72hour_job", {
    p_job_key: jobKey, p_period_start: period.startIso, p_period_end: period.endIso,
    p_scope_key: scopeKey, p_owner: owner, p_lease_seconds: config.hour72.leaseMinutes * 60,
    p_max_attempts: config.hour72.retryLimit,
  });
  if (error) throw error;
  const claim = Array.isArray(data) ? data[0] : data;
  return claim?.token ? claim : null;
}

function createLease(supabase, jobKey, token, attempt, config) {
  let lost = false;
  let renewing = null;
  async function assertOwner() {
    if (lost) throw new Error("72-hour report lease lost");
    if (!renewing) {
      renewing = supabase.rpc("renew_operational_72hour_job", {
        p_job_key: jobKey, p_owner: owner, p_token: token,
        p_lease_seconds: config.hour72.leaseMinutes * 60,
      }).then(({ data, error }) => {
        if (error || data !== true) {
          lost = true;
          throw error || new Error("72-hour report lease lost");
        }
      }).finally(() => { renewing = null; });
    }
    return renewing;
  }
  const timer = setInterval(() => { assertOwner().catch(() => { lost = true; }); }, config.hour72.renewalMinutes * 60 * 1000);
  return { jobKey, owner, token, attempt, assertOwner, stop: () => clearInterval(timer) };
}

async function failJob(supabase, lease, error, config, logger) {
  const reason = String(error?.message || error || "Unknown report failure")
    .replace(/https?:\/\/[^\s]+/gi, (url) => url.split("?")[0])
    .replace(/\b(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*[^,\s]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ").slice(0, 500);
  const stage = String(error?.pipelineStage || "SCHEDULER").slice(0, 80);
  const result = await supabase.rpc("fail_operational_72hour_job", {
    p_job_key: lease.jobKey, p_owner: lease.owner, p_token: lease.token,
    p_stage: stage, p_error: reason, p_retry_limit: config.hour72.retryLimit,
    p_retry_delay_seconds: config.hour72.retryDelayMinutes * 60,
  });
  if (result.error) logger.error?.(`[reports:72hour] failure recording failed report=${lease.jobKey} error=${result.error.message}`);
  logger.error?.(`[reports:72hour] report=${lease.jobKey} stage=${stage} outcome=failed error=${reason}`);
}

async function run72HourReportingCheck({ supabase, config, logger = console, now = new Date(), runPipeline = runDailyReportPipeline } = {}) {
  if (!config?.scheduleEnabled || !config?.hour72?.enabled) return { skipped: true, reason: "72hour_disabled" };
  if (running) return { skipped: true, reason: "72hour_check_running" };
  if (!supabase) throw new Error("Supabase client required");
  running = true;
  try {
    const scopes = validate72HourConfig(config);
    await cleanup72HourObjects(supabase, config, logger, now).catch((error) =>
      logger.warn?.(`[reports:72hour] retention check failed: ${error.message}`));
    const periods = getClosed72HourPeriods({
      now, anchor: config.hour72.anchorUtc, catchupStart: config.hour72.catchupStartUtc, limit: 10000, strictLimit: true,
    });
    if (!periods.length) return { checked: 0, attempted: 0, published: 0 };
    const published = await readPublishedKeys(supabase, periods[0].startIso, periods.at(-1).endIso);
    let attempted = 0;
    let completed = 0;
    for (const period of periods) {
      for (const scope of scopes) {
        const scopeKey = getScopeKey(scope);
        const jobKey = `72hour:${period.dateKey}:${scopeKey}`;
        if (published.has(jobKey)) continue;
        if (attempted >= config.hour72.maxPerRun) return { checked: periods.length, attempted, published: completed, backlog: true };
        const claim = await claimJob(supabase, jobKey, period, scopeKey, config);
        if (!claim) continue;
        attempted += 1;
        const lease = createLease(supabase, jobKey, claim.token, claim.attempt, config);
        logger.log?.(`[reports:72hour] report=${jobKey} scope=${scopeKey} attempt=${claim.attempt} outcome=claimed`);
        try {
          await runPipeline({
            supabase, dateKey: period.dateKey, scope, config, logger, reportType: "72hour",
            period, lease, skipCapture: true, allowIncompleteCaptures: true,
          });
          completed += 1;
          logger.log?.(`[reports:72hour] report=${jobKey} attempt=${claim.attempt} outcome=published`);
        } catch (error) {
          await failJob(supabase, lease, error, config, logger);
        } finally {
          lease.stop();
        }
      }
    }
    return { checked: periods.length, attempted, published: completed, backlog: false };
  } finally {
    running = false;
  }
}

export { run72HourReportingCheck, validate72HourConfig };
