import crypto from "crypto";
import { readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, relative, resolve } from "path";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import { s3PutObject } from "../../shared/reporting-s3.js";
import {
  REPORT_VERSION,
  generateDailySnapshot,
  getPreviousUtcDateKey,
  getScheduledScopes,
  getScopeKey,
  normalizeScope,
  upsertReportRecord,
} from "../../shared/reporting-service.js";
import {
  cleanupExpiredReportCaptures,
  generateSnapshotCaptures,
} from "./reporting-capture-service.js";
import { generateSnapshotPdf } from "./reporting-pdf-service.js";
import {
  __reportingRenderTestUtils,
  renderSnapshotReport,
} from "./reporting-render-service.js";

const activePipelines = new Map();
const PIPELINE_STAGES = Object.freeze({
  PENDING: "PENDING",
  SNAPSHOT: "SNAPSHOT",
  INTELLIGENCE: "INTELLIGENCE",
  CAPTURE: "CAPTURE",
  HTML: "HTML",
  PDF: "PDF",
  UPLOAD: "UPLOAD",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
});

function nowIso() {
  return new Date().toISOString();
}

function cleanError(error) {
  return String(error?.message || error || "Report pipeline failed").replace(/\s+/g, " ").trim().slice(0, 500);
}

function withPipelineLock(key, createPromise) {
  if (activePipelines.has(key)) {
    return Promise.resolve({ ok: true, skipped: true, reason: "report_pipeline_already_running", report_key: key });
  }
  const promise = Promise.resolve().then(createPromise).finally(() => activePipelines.delete(key));
  activePipelines.set(key, promise);
  return promise;
}

function logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details = "" }) {
  const duration = Date.now() - startedAt;
  logger.log?.(`[reports:pipeline] report=${reportKey} date=${dateKey} scope=${scopeKey} stage=${stage} duration_ms=${duration}${details ? ` ${details}` : ""}`);
}

async function loadSnapshot(supabase, snapshotKey) {
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .select("*")
    .eq("snapshot_key", snapshotKey)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function persistSnapshotManifest(supabase, snapshotKey, manifest) {
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .update({ report_manifest: manifest, updated_at: nowIso() })
    .eq("snapshot_key", snapshotKey)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function getContentType(filename = "") {
  if (/\.html$/i.test(filename)) return "text/html; charset=utf-8";
  if (/\.json$/i.test(filename)) return "application/json; charset=utf-8";
  if (/\.pdf$/i.test(filename)) return "application/pdf";
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.jpe?g$/i.test(filename)) return "image/jpeg";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "application/octet-stream";
}

function summarizeCaptures(manifest = {}) {
  const results = Array.isArray(manifest.capture_results) ? manifest.capture_results : [];
  return {
    ready: results.filter((entry) => String(entry?.status || "").toUpperCase() === "READY").length,
    failed: results.filter((entry) => String(entry?.status || "").toUpperCase() === "FAILED").length,
    total: results.length,
  };
}

function buildPipelineManifest(manifest = {}, overrides = {}) {
  return {
    ...manifest,
    selected_event_ids: manifest.event_ids || [],
    selected_cluster_ids: manifest.cluster_ids || [],
    selected_hva_ids: manifest.selected_hva || [],
    ...overrides,
  };
}

function buildPublishableManifest(manifest = {}) {
  const sanitizeCaptures = (entries) => (Array.isArray(entries) ? entries : []).map((entry = {}) => ({
    capture_id: entry.capture_id || null,
    capture_type: entry.capture_type || null,
    status: entry.status || null,
    event_id: entry.event_id || null,
    cluster_id: entry.cluster_id || null,
    asset_id: entry.asset_id || null,
    relative_path: String(entry.status || "").toUpperCase() === "READY"
      ? `images/${basename(String(entry.s3_key || entry.local_path || ""))}`
      : null,
    s3_key: entry.s3_key || null,
    s3_url: /^https?:\/\//i.test(String(entry.s3_url || "")) ? entry.s3_url : null,
    width: entry.width || null,
    height: entry.height || null,
    format: entry.format || null,
    generated_at: entry.generated_at || null,
    failure_reason: entry.failure_reason || null,
    attempt_count: entry.attempt_count || 0,
    semantic_quality: entry.semantic_quality || null,
  }));
  return {
    ...manifest,
    capture_results: sanitizeCaptures(manifest.capture_results),
    selected_images: sanitizeCaptures(manifest.selected_images),
  };
}

async function uploadReportArtifacts({ snapshot, outputDirectory, config, uploadObject = s3PutObject }) {
  const objectKeys = snapshot.report_manifest?.object_keys || {};
  for (const key of ["report_html", "report_json", "manifest_json", "report_pdf", "images_prefix"]) {
    if (!objectKeys[key]) throw new Error(`Snapshot manifest is missing object key ${key}`);
  }
  const artifacts = [
    ["reportHtml", "report.html", objectKeys.report_html],
    ["reportJson", "report.json", objectKeys.report_json],
    ["reportPdf", "report.pdf", objectKeys.report_pdf],
  ];
  const uploads = {};
  for (const [name, filename, key] of artifacts) {
    uploads[name] = await uploadObject(config, {
      key,
      body: await readFile(resolve(outputDirectory, filename)),
      contentType: getContentType(filename),
    });
    if (uploads[name]?.localPath) throw new Error(`Remote upload unavailable for ${key}`);
  }
  const imagesDirectory = resolve(outputDirectory, "images");
  let imageNames = [];
  try {
    imageNames = (await readdir(imagesDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  uploads.images = [];
  for (const filename of imageNames) {
    const key = `${objectKeys.images_prefix}${filename}`;
    const uploaded = await uploadObject(config, {
      key,
      body: await readFile(resolve(imagesDirectory, filename)),
      contentType: getContentType(filename),
    });
    if (uploaded?.localPath) throw new Error(`Remote upload unavailable for ${key}`);
    uploads.images.push({ filename, ...uploaded });
  }
  return uploads;
}

async function persistOperationalReportAvailable({ supabase, report, snapshot, model, manifest, publication, config }) {
  const expiresAt = new Date(Date.now() + config.pdfExpiryHours * 60 * 60 * 1000).toISOString();
  const downloadToken = crypto.randomBytes(24).toString("hex");
  const { data, error } = await supabase
    .from("operational_reports")
    .update({
      status: "available",
      report_body: {
        ...model,
        pipeline: {
          stage: PIPELINE_STAGES.COMPLETE,
          snapshot_key: snapshot.snapshot_key,
          manifest,
        },
      },
      pdf_url: publication.url,
      pdf_storage_key: publication.storageKey,
      pdf_etag: publication.etag || null,
      download_token: downloadToken,
      expires_at: expiresAt,
      report_version: REPORT_VERSION,
      updated_at: nowIso(),
    })
    .eq("id", report.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function markOperationalReportFailed(supabase, report, stage, error) {
  if (!report?.id) return null;
  const { data } = await supabase
    .from("operational_reports")
    .update({
      status: "failed",
      report_body: {
        ...(report.report_body || {}),
        pipeline: { stage: PIPELINE_STAGES.FAILED, failed_stage: stage, error: cleanError(error) },
      },
      updated_at: nowIso(),
    })
    .eq("id", report.id)
    .select("*")
    .maybeSingle();
  return data;
}

async function runDailyReportPipeline({
  supabase,
  dateKey = getPreviousUtcDateKey(),
  scope = {},
  config = readReportingConfig(),
  logger = console,
  force = false,
  skipCapture = false,
  skipUpload = false,
  localOnly = false,
  uploadObject = s3PutObject,
} = {}) {
  if (!supabase) throw new Error("Supabase client is required for reporting");
  const normalizedScope = normalizeScope(scope);
  const scopeKey = getScopeKey(normalizedScope);
  const reportKey = `daily:${dateKey}:${scopeKey}`;
  const snapshotKey = buildSnapshotKey(dateKey, scopeKey);
  return withPipelineLock(reportKey, async () => {
    const startedAt = Date.now();
    let stage = PIPELINE_STAGES.PENDING;
    let snapshot = null;
    let report = null;
    try {
      stage = PIPELINE_STAGES.SNAPSHOT;
      snapshot = force ? null : await loadSnapshot(supabase, snapshotKey);
      if (!snapshot) snapshot = await generateDailySnapshot({ supabase, dateKey, scope: normalizedScope, config });
      logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `snapshot_count=1 reused=${!force}` });

      stage = PIPELINE_STAGES.INTELLIGENCE;
      const initialModel = snapshot.snapshot_data?.report_content || {};
      report = await upsertReportRecord({
        supabase,
        reportType: "daily",
        dateKey,
        scope: normalizedScope,
        body: { ...initialModel, pipeline: { stage } },
        snapshotIds: [snapshot.snapshot_id].filter(Boolean),
      });
      logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt });

      const outputDirectory = __reportingRenderTestUtils.getReportOutputDirectory(snapshot);
      const existingPdf = await isFile(resolve(outputDirectory, "report.pdf"));
      const existingHtml = await isFile(resolve(outputDirectory, "report.html"));
      const retryUploadOnly = !force
        && existingPdf
        && existingHtml
        && snapshot.report_manifest?.pdf?.status === "READY"
        && snapshot.report_manifest?.html?.status === "READY";

      if (!retryUploadOnly) {
        stage = PIPELINE_STAGES.CAPTURE;
        if (!skipCapture && config.capture?.enabled) {
          try {
            await generateSnapshotCaptures({ supabase, snapshotKey, config, logger, force });
          } catch (captureError) {
            logger.warn?.(`[reports:pipeline] report=${reportKey} stage=CAPTURE degraded error=${cleanError(captureError)}`);
          }
        }
        snapshot = await loadSnapshot(supabase, snapshotKey);
        const captureSummary = summarizeCaptures(snapshot.report_manifest);
        logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `capture_ready=${captureSummary.ready} capture_failed=${captureSummary.failed}` });

        stage = PIPELINE_STAGES.HTML;
        const renderResult = await renderSnapshotReport({
          supabase,
          snapshotKey,
          config,
          upload: false,
        });
        snapshot = await loadSnapshot(supabase, snapshotKey);
        logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `html_status=READY path=${basename(renderResult.report_html)}` });

        stage = PIPELINE_STAGES.PDF;
        const pdfResult = await generateSnapshotPdf({ supabase, snapshotKey, config });
        snapshot = await loadSnapshot(supabase, snapshotKey);
        logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `page_count=${pdfResult.page_count} pdf_size=${pdfResult.size_bytes}` });
      } else {
        logStage(logger, { reportKey, dateKey, scopeKey, stage: "RESUME_UPLOAD", startedAt });
      }

      const reportJsonPath = resolve(outputDirectory, "report.json");
      const model = JSON.parse(await readFile(reportJsonPath, "utf8"));
      stage = PIPELINE_STAGES.UPLOAD;
      let uploads = null;
      let publication;
      if (localOnly || skipUpload) {
        const localStorageKey = relative(__reportingRenderTestUtils.REPORT_OUTPUT_ROOT, resolve(outputDirectory, "report.pdf")).replace(/\\/g, "/");
        const pdfBuffer = await readFile(resolve(outputDirectory, "report.pdf"));
        publication = {
          storageKey: localStorageKey,
          url: `/stratops/reports/file/${localStorageKey.split("/").map(encodeURIComponent).join("/")}`,
          etag: crypto.createHash("sha256").update(pdfBuffer).digest("hex"),
        };
      } else {
        if (!config.aws?.bucket) throw new Error("AWS_S3_BUCKET is required unless --local-only or --skip-upload is used");
        uploads = await uploadReportArtifacts({ snapshot, outputDirectory, config, uploadObject });
        publication = uploads.reportPdf;
      }

      const completedAt = nowIso();
      const completeManifest = buildPipelineManifest(snapshot.report_manifest, {
        generation_status: "complete",
        overall_status: PIPELINE_STAGES.COMPLETE,
        completed_at: completedAt,
        upload: {
          status: localOnly || skipUpload ? "SKIPPED_LOCAL" : "READY",
          generated_at: completedAt,
          report_html_key: uploads?.reportHtml?.storageKey || null,
          report_json_key: uploads?.reportJson?.storageKey || null,
          report_pdf_key: publication.storageKey,
          image_count: uploads?.images?.length || 0,
        },
      });
      const publishableManifest = buildPublishableManifest(completeManifest);
      await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(publishableManifest, null, 2)}\n`, "utf8");
      if (uploads) {
        uploads.manifestJson = await uploadObject(config, {
          key: snapshot.report_manifest.object_keys.manifest_json,
          body: await readFile(resolve(outputDirectory, "manifest.json")),
          contentType: "application/json; charset=utf-8",
        });
        if (uploads.manifestJson?.localPath) throw new Error("Remote upload unavailable for manifest.json");
      }
      await persistSnapshotManifest(supabase, snapshotKey, completeManifest);
      const availableReport = await persistOperationalReportAvailable({
        supabase,
        report,
        snapshot,
        model,
        manifest: publishableManifest,
        publication,
        config,
      });
      const captureSummary = summarizeCaptures(completeManifest);
      logStage(logger, {
        reportKey,
        dateKey,
        scopeKey,
        stage: PIPELINE_STAGES.COMPLETE,
        startedAt,
        details: `capture_ready=${captureSummary.ready} capture_failed=${captureSummary.failed} page_count=${completeManifest.pdf?.page_count || 0} pdf_size=${completeManifest.pdf?.size_bytes || 0} s3_key=${localOnly || skipUpload ? "local-only" : publication.storageKey}`,
      });
      return {
        ok: true,
        report_key: reportKey,
        snapshot_key: snapshotKey,
        report: {
          id: availableReport?.id,
          status: availableReport?.status,
          pdf_storage_key: availableReport?.pdf_storage_key,
          expires_at: availableReport?.expires_at,
        },
        pdf: completeManifest.pdf,
        upload: completeManifest.upload,
        output_directory: outputDirectory,
        local_only: localOnly || skipUpload,
        uploads,
        duration_ms: Date.now() - startedAt,
      };
    } catch (error) {
      const reason = cleanError(error);
      logger.error?.(`[reports:pipeline] report=${reportKey} date=${dateKey} scope=${scopeKey} stage=${stage} final_status=FAILED error=${reason}`);
      if (snapshot?.snapshot_key) {
        const failedManifest = buildPipelineManifest(snapshot.report_manifest, {
          generation_status: "failed",
          overall_status: PIPELINE_STAGES.FAILED,
          failure: { stage, reason, failed_at: nowIso() },
        });
        await persistSnapshotManifest(supabase, snapshot.snapshot_key, failedManifest).catch(() => null);
        const outputDirectory = __reportingRenderTestUtils.getReportOutputDirectory(snapshot);
        await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(failedManifest, null, 2)}\n`, "utf8").catch(() => null);
      }
      await markOperationalReportFailed(supabase, report, stage, error).catch(() => null);
      throw error;
    }
  });
}

async function generateScheduledDailyPipelines({ supabase, config = readReportingConfig(), logger = console, referenceDate = new Date() } = {}) {
  if (!config.scheduleEnabled) return { ok: true, skipped: true, reason: "schedule_disabled" };
  if (!config.snapshotEnabled) return { ok: true, skipped: true, reason: "snapshot_disabled" };
  if (config.dailyEnabled === false) return { ok: true, skipped: true, reason: "daily_disabled" };
  const dateKey = getPreviousUtcDateKey(referenceDate);
  const results = [];
  for (const scope of getScheduledScopes(config)) {
    try {
      results.push(await runDailyReportPipeline({ supabase, dateKey, scope, config, logger }));
    } catch (error) {
      results.push({ ok: false, scope: getScopeKey(scope), error: cleanError(error) });
    }
  }
  const cleanup = await cleanupExpiredReportCaptures({ config }).catch((error) => ({ ok: false, error: cleanError(error) }));
  return { ok: results.some((result) => result.ok), dateKey, results, cleanup };
}

function resetPipelineLocksForTests() {
  activePipelines.clear();
}

const __reportingPipelineTestUtils = {
  PIPELINE_STAGES,
  buildPipelineManifest,
  buildPublishableManifest,
  getContentType,
  resetPipelineLocksForTests,
  summarizeCaptures,
  uploadReportArtifacts,
  withPipelineLock,
};

export {
  PIPELINE_STAGES,
  __reportingPipelineTestUtils,
  generateScheduledDailyPipelines,
  runDailyReportPipeline,
};
