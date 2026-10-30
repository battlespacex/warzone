import crypto from "crypto";
import { readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { basename, relative, resolve } from "path";
import { DEFAULT_PUBLISHED_REPORT_RETENTION_DAYS, readReportingConfig } from "../../shared/reporting-config.js";
import { buildReportObjectKeys, buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import { s3DeleteObject, s3PutObject } from "../../shared/reporting-s3.js";
import {
  REPORT_VERSION,
  generateDailySnapshot,
  generate72HourSnapshot,
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
import { buildCaptureDescriptors } from "../../shared/reporting-capture.js";
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
  IMAGE_FREE: "IMAGE_FREE",
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
  return String(error?.message || error || "Report pipeline failed")
    .replace(/https?:\/\/[^\s]+/gi, (url) => url.split("?")[0])
    .replace(/\b(token|secret|password|api[_-]?key|authorization)\s*[:=]\s*[^,\s]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizeStorageKey(value = "") {
  return String(value || "").trim().replace(/^\/+/, "");
}

function getCanonicalReportObjectKeys(snapshot = {}, config = readReportingConfig()) {
  const dateKey = String(snapshot.snapshot_date || snapshot.snapshot_data?.report_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Cannot determine canonical report date from snapshot: ${dateKey || "missing"}`);
  }
  const scope = normalizeScope({
    type: snapshot.scope_type || snapshot.snapshot_data?.scope?.type || "global",
    value: snapshot.scope_value ?? snapshot.snapshot_data?.scope?.value ?? null,
    label: snapshot.scope_label || snapshot.snapshot_data?.scope?.label || "Global",
  });
  const keys = buildReportObjectKeys({
    prefix: config.s3Prefix || "reports",
    dateKey,
    scope,
    reportType: snapshot.report_type || snapshot.snapshot_data?.report_type || "daily",
  });
  return Object.fromEntries(Object.entries(keys).map(([key, value]) => [key, normalizeStorageKey(value)]));
}

function getCanonicalReportPdfKey(snapshot = {}, config = readReportingConfig()) {
  return getCanonicalReportObjectKeys(snapshot, config).report_pdf;
}

function assertCanonicalManifestObjectKeys(snapshot = {}, config = readReportingConfig()) {
  const expected = getCanonicalReportObjectKeys(snapshot, config);
  const actual = snapshot?.report_manifest?.object_keys || {};
  for (const key of ["report_html", "report_json", "manifest_json", "report_pdf", "images_prefix"]) {
    const actualKey = normalizeStorageKey(actual[key]);
    if (!actualKey || actualKey !== expected[key]) {
      throw new Error(
        `Refusing report publication: manifest ${key} is non-canonical; expected=${expected[key]} actual=${actualKey || "missing"}`
      );
    }
  }
  return expected;
}

function assertCanonicalReportPublication({ snapshot, publication, config = readReportingConfig() } = {}) {
  const expected = assertCanonicalManifestObjectKeys(snapshot, config).report_pdf;
  const actual = normalizeStorageKey(publication?.storageKey);

  if (!actual || actual !== expected) {
    throw new Error(`Refusing report publication: PDF storage key is non-canonical; expected=${expected} actual=${actual || "missing"}`);
  }
  if (actual.includes(":") || /T\d{2}:\d{2}:\d{2}/.test(actual)) {
    throw new Error(`Refusing report publication: legacy timestamp/report-key format detected in ${actual}`);
  }
  return expected;
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

function validateCaptureReadiness({
  requiredCaptures = [],
  captureResults = [],
  captureEnabled = false,
  allowIncompleteCaptures = false,
} = {}) {
  const required = Array.isArray(requiredCaptures) ? requiredCaptures : [];
  const readyCaptureIds = new Set((Array.isArray(captureResults) ? captureResults : [])
    .filter((capture) => String(capture?.status || "").toUpperCase() === "READY")
    .map((capture) => capture.capture_id));
  const missingCaptures = required
    .filter((capture) => !readyCaptureIds.has(capture.capture_id));

  if (required.length && !captureEnabled && !allowIncompleteCaptures) {
    throw new Error("Report has imagery targets but REPORTING_CAPTURE_ENABLED is false");
  }
  if (missingCaptures.length && !allowIncompleteCaptures) {
    throw new Error(`Report capture incomplete: ${missingCaptures.map((capture) => capture.capture_type).join(", ")}`);
  }

  return {
    incomplete: missingCaptures.length > 0,
    missingCaptures,
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

async function uploadReportArtifacts({ snapshot, outputDirectory, config, uploadObject = s3PutObject, includeImages = true }) {
  assertCanonicalManifestObjectKeys(snapshot, config);
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
  if (includeImages) {
    try {
      imageNames = (await readdir(imagesDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
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

async function persistOperationalReportAvailable({ supabase, report, snapshot, model, manifest, publication, config, canonicalRequired = true, lease = null }) {
  if (canonicalRequired) assertCanonicalReportPublication({ snapshot, publication, config });
  const publishedRetentionDays = Math.max(1, Number((lease ? config.hour72?.publishedRetentionDays : config.publishedRetentionDays) || DEFAULT_PUBLISHED_REPORT_RETENTION_DAYS));
  const expiresAt = new Date(Date.now() + publishedRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const downloadToken = crypto.randomBytes(24).toString("hex");
  if (lease) {
    const { data, error } = await supabase.rpc("complete_operational_72hour_job", {
      p_job_key: lease.jobKey, p_owner: lease.owner, p_token: lease.token, p_report_id: report.id,
      p_report_body: { ...model, pipeline: { stage: PIPELINE_STAGES.COMPLETE, snapshot_key: snapshot.snapshot_key, manifest } },
      p_pdf_url: publication.url, p_pdf_storage_key: publication.storageKey,
      p_pdf_etag: publication.etag || null, p_download_token: downloadToken, p_expires_at: expiresAt,
    });
    if (error) throw error;
    if (!data) throw new Error("72-hour report lease was lost before publication");
    return data;
  }
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

function shiftUtcDateKey(dateKey, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return "";
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function getPublishedReportInstancePrefix(report = {}, config = readReportingConfig()) {
  const storageKey = String(report.pdf_storage_key || "").trim().replace(/^\/+/, "");
  const root = `${String(config.s3Prefix || "reports").trim().replace(/^\/+|\/+$/g, "")}/daily/`;
  if (!storageKey.startsWith(root) || !storageKey.endsWith("/report.pdf")) return "";
  const relativeKey = storageKey.slice(root.length);
  const isGlobal = /^global\/\d{4}-\d{2}-\d{2}\/report\.pdf$/.test(relativeKey);
  const isScoped = /^(?:region|country|aoi)\/[a-z0-9][a-z0-9-]*\/\d{4}-\d{2}-\d{2}\/report\.pdf$/.test(relativeKey);
  if (!isGlobal && !isScoped) return "";
  return storageKey.slice(0, -"report.pdf".length);
}

function collectPublishedReportObjectKeys(report = {}, config = readReportingConfig()) {
  const prefix = getPublishedReportInstancePrefix(report, config);
  if (!prefix) return [];
  const keys = new Set([
    `${prefix}report.html`,
    `${prefix}report.pdf`,
    `${prefix}report.json`,
    `${prefix}manifest.json`,
  ]);
  const manifest = report?.report_body?.pipeline?.manifest || {};
  const captures = [
    ...(Array.isArray(manifest.capture_results) ? manifest.capture_results : []),
    ...(Array.isArray(manifest.selected_images) ? manifest.selected_images : []),
  ];
  captures.forEach((capture) => {
    const key = String(capture?.s3_key || "").trim().replace(/^\/+/, "");
    if (key.startsWith(`${prefix}images/`) && !key.includes("..")) keys.add(key);
  });
  return [...keys];
}

async function cleanupPublishedDailyReports({
  supabase,
  config = readReportingConfig(),
  latestPublishedDateKey,
  logger = console,
  deleteObject = s3DeleteObject,
} = {}) {
  if (!supabase) throw new Error("Supabase client is required for published report cleanup");
  const retentionDays = Math.max(1, Number(config.publishedRetentionDays || DEFAULT_PUBLISHED_REPORT_RETENTION_DAYS));
  const retainedFromDate = shiftUtcDateKey(latestPublishedDateKey, -(retentionDays - 1));
  if (!retainedFromDate) return { ok: false, skipped: true, reason: "invalid_latest_report_date" };
  const cutoffIso = `${retainedFromDate}T00:00:00.000Z`;
  const { data, error } = await supabase
    .from("operational_reports")
    .select("id, report_key, report_type, status, period_start, pdf_storage_key, report_body")
    .eq("report_type", "daily")
    .in("status", ["available", "expired"])
    .lt("period_start", cutoffIso)
    .order("period_start", { ascending: true });
  if (error) throw error;

  const results = [];
  for (const report of data || []) {
    const keys = collectPublishedReportObjectKeys(report, config);
    if (!keys.length) {
      logger.warn?.(`[reports:retention] skipped unsafe report prefix id=${report.id}`);
      results.push({ id: report.id, ok: false, reason: "unsafe_report_prefix" });
      continue;
    }
    try {
      const expiring = await supabase
        .from("operational_reports")
        .update({ status: "expired", expires_at: nowIso(), updated_at: nowIso() })
        .eq("id", report.id);
      if (expiring.error) throw expiring.error;
      for (const key of keys) await deleteObject(config, { key });
      const expired = await supabase
        .from("operational_reports")
        .update({
          status: "expired",
          pdf_url: null,
          pdf_storage_key: null,
          pdf_etag: null,
          download_token: null,
          updated_at: nowIso(),
        })
        .eq("id", report.id);
      if (expired.error) throw expired.error;
      results.push({ id: report.id, ok: true, deleted: keys.length });
    } catch (cleanupError) {
      logger.warn?.(`[reports:retention] cleanup failed id=${report.id} error=${cleanError(cleanupError)}`);
      results.push({ id: report.id, ok: false, reason: cleanError(cleanupError) });
    }
  }
  return {
    ok: results.every((result) => result.ok),
    retained_from_date: retainedFromDate,
    expired: results.filter((result) => result.ok).length,
    results,
  };
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
  allowIncompleteCaptures = false,
  uploadObject = s3PutObject,
  reportType = "daily",
  period = null,
  lease = null,
} = {}) {
  if (!supabase) throw new Error("Supabase client is required for reporting");
  const normalizedScope = normalizeScope(scope);
  const scopeKey = getScopeKey(normalizedScope);
  const is72Hour = reportType === "72hour";
  if (is72Hour && (!period || !lease)) throw new Error("72-hour publication requires an owned period lease");
  const reportKey = `${reportType}:${dateKey}:${scopeKey}`;
  const snapshotKey = buildSnapshotKey(dateKey, scopeKey, undefined, reportType);
  return withPipelineLock(reportKey, async () => {
    const startedAt = Date.now();
    let stage = PIPELINE_STAGES.PENDING;
    let snapshot = null;
    let report = null;
    try {
      await lease?.assertOwner();
      stage = PIPELINE_STAGES.SNAPSHOT;
      snapshot = force ? null : await loadSnapshot(supabase, snapshotKey);
      if (!snapshot) snapshot = is72Hour
        ? await generate72HourSnapshot({ supabase, period, scope: normalizedScope, config })
        : await generateDailySnapshot({ supabase, dateKey, scope: normalizedScope, config });
      await lease?.assertOwner();
      logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `snapshot_count=1 reused=${!force}` });

      stage = PIPELINE_STAGES.INTELLIGENCE;
      const initialModel = snapshot.snapshot_data?.report_content || {};
      report = await upsertReportRecord({
        supabase,
        reportType,
        dateKey,
        scope: normalizedScope,
        body: { ...initialModel, pipeline: { stage } },
        snapshotIds: [snapshot.snapshot_id].filter(Boolean),
        period: is72Hour ? period : undefined,
        attemptCount: lease?.attempt,
      });
      logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt });

      const outputDirectory = __reportingRenderTestUtils.getReportOutputDirectory(snapshot);
      const existingPdf = await isFile(resolve(outputDirectory, "report.pdf"));
      const existingHtml = await isFile(resolve(outputDirectory, "report.html"));
      const retryUploadOnly = !force
        && existingPdf
        && existingHtml
        && snapshot.report_manifest?.pdf?.status === "READY"
        && snapshot.report_manifest?.html?.status === "READY"
        && Number(snapshot.report_manifest?.pdf?.failed_image_count || 0) === 0
        && (skipCapture || is72Hour || buildCaptureDescriptors(snapshot, {
          maxImages: config.capture.maxImages, s3Prefix: config.s3Prefix, format: config.capture.format,
        }).every((descriptor) => (snapshot.report_manifest?.capture_results || [])
          .some((capture) => capture.capture_id === descriptor.capture_id && capture.status === "READY")));

      if (!retryUploadOnly) {
        await lease?.assertOwner();
        stage = is72Hour ? PIPELINE_STAGES.IMAGE_FREE : PIPELINE_STAGES.CAPTURE;
        const requiredCaptures = skipCapture || is72Hour ? [] : buildCaptureDescriptors(snapshot, {
          maxImages: config.capture.maxImages, s3Prefix: config.s3Prefix, format: config.capture.format,
        });
        if (!skipCapture && !is72Hour && config.capture?.enabled) {
          const captureConfig = localOnly || skipUpload
            ? { ...config, aws: { ...config.aws, bucket: "" } }
            : config;
          await generateSnapshotCaptures({ supabase, snapshotKey, config: captureConfig, logger, force });
        }
        snapshot = await loadSnapshot(supabase, snapshotKey);
        const captureReadiness = validateCaptureReadiness({
          requiredCaptures,
          captureResults: snapshot.report_manifest?.capture_results,
          captureEnabled: config.capture?.enabled,
          allowIncompleteCaptures: is72Hour || allowIncompleteCaptures,
        });
        if (captureReadiness.incomplete) {
          logger.warn?.(
            `[reports:pipeline] report=${reportKey} date=${dateKey} scope=${scopeKey} stage=${stage} `
            + `capture_fallback=true missing=${captureReadiness.missingCaptures.map((capture) => capture.capture_type).join(",")}`
          );
        }
        const captureSummary = summarizeCaptures(snapshot.report_manifest);
        logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `capture_ready=${captureSummary.ready} capture_failed=${captureSummary.failed}` });

        stage = PIPELINE_STAGES.HTML;
        await lease?.assertOwner();
        const renderResult = await renderSnapshotReport({
          supabase,
          snapshotKey,
          config,
          upload: false,
        });
        snapshot = await loadSnapshot(supabase, snapshotKey);
        logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `html_status=READY path=${basename(renderResult.report_html)}` });

        stage = PIPELINE_STAGES.PDF;
        await lease?.assertOwner();
        const pdfResult = await generateSnapshotPdf({ supabase, snapshotKey, config });
        snapshot = await loadSnapshot(supabase, snapshotKey);
        logStage(logger, { reportKey, dateKey, scopeKey, stage, startedAt, details: `page_count=${pdfResult.page_count} pdf_size=${pdfResult.size_bytes}` });
      } else {
        logStage(logger, { reportKey, dateKey, scopeKey, stage: "RESUME_UPLOAD", startedAt });
      }

      const reportJsonPath = resolve(outputDirectory, "report.json");
      const model = JSON.parse(await readFile(reportJsonPath, "utf8"));
      stage = PIPELINE_STAGES.UPLOAD;
      await lease?.assertOwner();
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
        uploads = await uploadReportArtifacts({ snapshot, outputDirectory, config, uploadObject, includeImages: !is72Hour });
        publication = uploads.reportPdf;
      }

      if (!(localOnly || skipUpload)) {
        assertCanonicalReportPublication({ snapshot, publication, config });
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
      await lease?.assertOwner();
      const availableReport = await persistOperationalReportAvailable({
        supabase,
        report,
        snapshot,
        model,
        manifest: publishableManifest,
        publication,
        config,
        canonicalRequired: !(localOnly || skipUpload),
        lease,
      });
      const publishedRetention = is72Hour || localOnly || skipUpload
        ? { ok: true, skipped: true, reason: "local_publication" }
        : await cleanupPublishedDailyReports({
            supabase,
            config,
            latestPublishedDateKey: dateKey,
            logger,
          }).catch((cleanupError) => ({ ok: false, error: cleanError(cleanupError) }));
      const captureSummary = summarizeCaptures(completeManifest);
      logStage(logger, {
        reportKey,
        dateKey,
        scopeKey,
        stage: PIPELINE_STAGES.COMPLETE,
        startedAt,
        details: `capture_ready=${captureSummary.ready} capture_failed=${captureSummary.failed} page_count=${completeManifest.pdf?.page_count || 0} pdf_size=${completeManifest.pdf?.size_bytes || 0} s3_key=${localOnly || skipUpload ? "local-only" : publication.storageKey}`,
      });
      if (is72Hour && !(localOnly || skipUpload)) {
        await rm(outputDirectory, { recursive: true, force: true }).catch((cleanupError) =>
          logger.warn?.(`[reports:72hour] local artifact cleanup failed report=${reportKey} error=${cleanError(cleanupError)}`));
      }
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
        published_retention: publishedRetention,
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
      if (!is72Hour) await markOperationalReportFailed(supabase, report, stage, error).catch(() => null);
      if (is72Hour) error.pipelineStage = stage;
      throw error;
    }
  });
}

async function generateScheduledDailyPipelines({
  supabase,
  config = readReportingConfig(),
  logger = console,
  referenceDate = new Date(),
  runPipeline = runDailyReportPipeline,
} = {}) {
  if (!config.scheduleEnabled) return { ok: true, skipped: true, reason: "schedule_disabled" };
  if (!config.snapshotEnabled) return { ok: true, skipped: true, reason: "snapshot_disabled" };
  if (config.dailyEnabled === false) return { ok: true, skipped: true, reason: "daily_disabled" };
  const dateKey = getPreviousUtcDateKey(referenceDate);
  const results = [];
  for (const scope of getScheduledScopes(config)) {
    try {
      results.push(await runPipeline({
        supabase,
        dateKey,
        scope,
        config,
        logger,
        allowIncompleteCaptures: true,
      }));
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
  assertCanonicalManifestObjectKeys,
  assertCanonicalReportPublication,
  buildPipelineManifest,
  buildPublishableManifest,
  collectPublishedReportObjectKeys,
  getCanonicalReportObjectKeys,
  getCanonicalReportPdfKey,
  getPublishedReportInstancePrefix,
  getContentType,
  resetPipelineLocksForTests,
  summarizeCaptures,
  uploadReportArtifacts,
  validateCaptureReadiness,
  withPipelineLock,
};

export {
  PIPELINE_STAGES,
  __reportingPipelineTestUtils,
  cleanupPublishedDailyReports,
  generateScheduledDailyPipelines,
  runDailyReportPipeline,
};
