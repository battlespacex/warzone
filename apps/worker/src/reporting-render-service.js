import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, normalize, resolve } from "path";
import { fileURLToPath } from "url";
import {
  REPORT_HTML_RENDER_VERSION,
  buildReportRenderModel,
  renderReportHtml,
} from "../../shared/reporting-html.js";
import { buildReportImageDirectory } from "../../shared/reporting-capture.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import {
  getPreviousUtcDateKey,
  getScopeKey,
  normalizeScope,
} from "../../shared/reporting-service.js";
import { s3PutObject } from "../../shared/reporting-s3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const REPORT_OUTPUT_ROOT = resolve(PROJECT_ROOT, ".generated", "reports");
const REPORT_TEMPLATE_PATH = resolve(PROJECT_ROOT, "dev", "reports", "template", "reports-template.html");
const REPORT_CSS_PATH = resolve(PROJECT_ROOT, "dev", "reports", "template", "reports.css");

function nowIso() {
  return new Date().toISOString();
}

function cleanPathSegment(value = "") {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function getReportOutputDirectory(snapshot = {}) {
  const relativeDirectory = buildReportImageDirectory(snapshot).replace(/\/images$/, "");
  const segments = relativeDirectory.split("/").map(cleanPathSegment).filter(Boolean);
  const target = resolve(REPORT_OUTPUT_ROOT, ...segments);
  const rootPrefix = normalize(`${REPORT_OUTPUT_ROOT}\\`);
  if (!normalize(target).startsWith(rootPrefix)) throw new Error("Invalid report output path");
  return target;
}

async function loadSnapshot(supabase, snapshotKey) {
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .select("*")
    .eq("snapshot_key", snapshotKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Report snapshot not found: ${snapshotKey}`);
  return data;
}

async function persistRenderState(supabase, snapshotKey, reportManifest) {
  const updatedAt = nowIso();
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .update({ report_manifest: reportManifest, updated_at: updatedAt })
    .eq("snapshot_key", snapshotKey)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data || { snapshot_key: snapshotKey, report_manifest: reportManifest, updated_at: updatedAt };
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function getAvailableLocalImageNames(snapshot, outputDirectory) {
  const captures = Array.isArray(snapshot.report_manifest?.capture_results)
    ? snapshot.report_manifest.capture_results
    : [];
  const names = new Set();
  for (const capture of captures) {
    if (String(capture?.status || "").toUpperCase() !== "READY") continue;
    const filename = basename(String(capture.s3_key || capture.local_path || ""));
    if (!filename || cleanPathSegment(filename) !== filename) continue;
    if (await fileExists(resolve(outputDirectory, "images", filename))) names.add(filename);
  }
  return names;
}

function sanitizeManifestCapture(result = {}) {
  return {
    capture_id: result.capture_id,
    capture_type: result.capture_type,
    status: result.status,
    event_id: result.event_id,
    cluster_id: result.cluster_id,
    asset_id: result.asset_id,
    relative_path: result.src?.startsWith("images/") ? result.src : null,
    public_url: /^https?:\/\//i.test(String(result.src || "")) ? result.src : null,
    width: result.width,
    height: result.height,
    generated_at: result.generated_at,
    failure_reason: result.failure_reason,
  };
}

function sanitizeStorageResult(result = {}, fallbackKey = null) {
  return {
    storageKey: result.storageKey || fallbackKey,
    url: result.url || null,
    etag: result.etag || null,
  };
}

function applyPublicAssetBaseUrl(html, publicAssetBaseUrl = "") {
  const base = String(publicAssetBaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return html;
  return String(html || "").replace(/(["'])\/assets\//g, `$1${base}/assets/`);
}

function buildRenderedManifest(snapshot, model, generatedAt, uploadResults = {}) {
  const existing = snapshot.report_manifest && typeof snapshot.report_manifest === "object"
    ? snapshot.report_manifest
    : {};
  const objectKeys = existing.object_keys || {};
  return {
    ...existing,
    report_id: model.report_id,
    snapshot_key: model.snapshot_key,
    report_date: model.report_date,
    scope: model.scope,
    window_start: model.window.start,
    window_end: model.window.end,
    snapshot_version: model.snapshot_version,
    render_version: REPORT_HTML_RENDER_VERSION,
    rendered_at: generatedAt,
    generation_status: "html_ready",
    status: "READY",
    event_ids: model.developments.map((item) => item.event_id).filter(Boolean),
    selected_hva: model.high_value_assets.map((asset) => asset.asset_id).filter(Boolean),
    capture_results: model.capture_results.map(sanitizeManifestCapture),
    selected_images: model.imagery.map(sanitizeManifestCapture),
    report_html_path: objectKeys.report_html || null,
    report_json_path: objectKeys.report_json || null,
    manifest_json_path: objectKeys.manifest_json || null,
    render_outputs: {
      report_html: sanitizeStorageResult(uploadResults.reportHtml, objectKeys.report_html || null),
      report_json: sanitizeStorageResult(uploadResults.reportJson, objectKeys.report_json || null),
      manifest_json: { storageKey: objectKeys.manifest_json || null },
    },
    html: {
      status: "READY",
      path: "report.html",
      s3_key: objectKeys.report_html || null,
      generated_at: generatedAt,
    },
    overall_status: "HTML",
  };
}

async function renderSnapshotReport({
  supabase,
  snapshotKey,
  config = readReportingConfig(),
  upload = Boolean(config.aws?.bucket),
  uploadObject = s3PutObject,
  persistState = persistRenderState,
  generatedAt = nowIso(),
} = {}) {
  if (!supabase) throw new Error("Supabase client is required to load the report snapshot");
  const snapshot = await loadSnapshot(supabase, snapshotKey);
  const outputDirectory = getReportOutputDirectory(snapshot);
  const localImageNames = await getAvailableLocalImageNames(snapshot, outputDirectory);
  const [templateHtml, templateCss] = await Promise.all([
    readFile(REPORT_TEMPLATE_PATH, "utf8"),
    readFile(REPORT_CSS_PATH, "utf8"),
  ]);
  const model = buildReportRenderModel(snapshot, { localImageNames });
  const html = applyPublicAssetBaseUrl(
    renderReportHtml({ templateHtml, templateCss, model }),
    config.publicAssetBaseUrl
  );
  const reportJson = `${JSON.stringify(model, null, 2)}\n`;
  const paths = {
    directory: outputDirectory,
    reportHtml: resolve(outputDirectory, "report.html"),
    reportJson: resolve(outputDirectory, "report.json"),
    manifestJson: resolve(outputDirectory, "manifest.json"),
  };
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(paths.reportHtml, html, "utf8"),
    writeFile(paths.reportJson, reportJson, "utf8"),
  ]);

  const objectKeys = snapshot.report_manifest?.object_keys || {};
  const uploadResults = {};
  if (upload) {
    if (!objectKeys.report_html || !objectKeys.report_json || !objectKeys.manifest_json) {
      throw new Error("Snapshot manifest does not contain report HTML/JSON object keys");
    }
    [uploadResults.reportHtml, uploadResults.reportJson] = await Promise.all([
      uploadObject(config, { key: objectKeys.report_html, body: html, contentType: "text/html; charset=utf-8" }),
      uploadObject(config, { key: objectKeys.report_json, body: reportJson, contentType: "application/json; charset=utf-8" }),
    ]);
  }

  const renderedManifest = buildRenderedManifest(snapshot, model, generatedAt, uploadResults);
  const manifestJson = `${JSON.stringify(renderedManifest, null, 2)}\n`;
  await writeFile(paths.manifestJson, manifestJson, "utf8");
  if (upload) {
    uploadResults.manifestJson = await uploadObject(config, {
      key: objectKeys.manifest_json,
      body: manifestJson,
      contentType: "application/json; charset=utf-8",
    });
  }

  const persistedManifest = {
    ...(snapshot.report_manifest || {}),
    render_version: REPORT_HTML_RENDER_VERSION,
    rendered_at: generatedAt,
    generation_status: "html_ready",
    status: "READY",
    report_html_path: objectKeys.report_html || null,
    report_json_path: objectKeys.report_json || null,
    manifest_json_path: objectKeys.manifest_json || null,
    render_outputs: renderedManifest.render_outputs,
    html: renderedManifest.html,
    overall_status: "HTML",
  };
  await persistState(supabase, snapshotKey, persistedManifest);
  return {
    ok: true,
    snapshot_key: snapshotKey,
    report_date: model.report_date,
    scope: model.scope,
    render_version: REPORT_HTML_RENDER_VERSION,
    output_directory: outputDirectory,
    report_html: paths.reportHtml,
    report_json: paths.reportJson,
    manifest_json: paths.manifestJson,
    uploaded: upload,
    upload_results: uploadResults,
    headline_card_count: model.headline_stats.length,
    development_count: model.developments.length,
    hva_count: model.high_value_assets.length,
    image_count: model.imagery.length,
  };
}

async function renderSnapshotByDate({
  supabase,
  dateKey = getPreviousUtcDateKey(),
  scope = {},
  config = readReportingConfig(),
  upload,
} = {}) {
  const normalizedScope = normalizeScope(scope);
  const snapshotKey = buildSnapshotKey(dateKey, getScopeKey(normalizedScope));
  return renderSnapshotReport({ supabase, snapshotKey, config, upload });
}

const __reportingRenderTestUtils = {
  REPORT_CSS_PATH,
  REPORT_OUTPUT_ROOT,
  REPORT_TEMPLATE_PATH,
  applyPublicAssetBaseUrl,
  buildRenderedManifest,
  getAvailableLocalImageNames,
  getReportOutputDirectory,
  sanitizeManifestCapture,
  sanitizeStorageResult,
};

export {
  __reportingRenderTestUtils,
  getReportOutputDirectory,
  renderSnapshotByDate,
  renderSnapshotReport,
};
