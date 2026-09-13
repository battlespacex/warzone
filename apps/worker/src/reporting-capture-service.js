import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import { dirname, normalize, resolve } from "path";
import { fileURLToPath } from "url";
import {
  CAPTURE_STATUS,
  buildCaptureDescriptors,
  buildCapturePageUrl,
  buildCaptureScenePayload,
  buildInitialCaptureResults,
  isCaptureCleanupEligible,
  mergeCaptureResult,
} from "../../shared/reporting-capture.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import {
  getPreviousUtcDateKey,
  getScheduledScopes,
  getScopeKey,
  normalizeScope,
} from "../../shared/reporting-service.js";
import { s3PutObject } from "../../shared/reporting-s3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CAPTURE_ROOT = resolve(__dirname, "..", "..", "..", ".generated", "reports");

function nowIso() {
  return new Date().toISOString();
}

function cleanFailureReason(error) {
  return String(error?.message || error || "Capture failed").replace(/\s+/g, " ").trim().slice(0, 500);
}

function getCaptureFilePath(relativePath = "") {
  const safeSegments = String(relativePath || "").split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]+/g, "-"))
    .filter(Boolean);
  const target = resolve(CAPTURE_ROOT, ...safeSegments);
  const rootPrefix = normalize(`${CAPTURE_ROOT}\\`);
  const normalizedTarget = normalize(target);
  if (!normalizedTarget.startsWith(rootPrefix)) throw new Error("Invalid capture output path");
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

async function persistCaptureState(supabase, snapshot) {
  const updatedAt = nowIso();
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .update({
      snapshot_data: snapshot.snapshot_data,
      report_manifest: snapshot.report_manifest,
      updated_at: updatedAt,
    })
    .eq("snapshot_key", snapshot.snapshot_key)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data || { ...snapshot, updated_at: updatedAt };
}

async function launchCaptureBrowser(config) {
  const { chromium } = await import("playwright");
  return chromium.launch({
    headless: true,
    ...(config.capture.browserExecutablePath ? { executablePath: config.capture.browserExecutablePath } : {}),
  });
}

async function captureTargetPage({ page, snapshot, descriptor, config }) {
  const url = buildCapturePageUrl(config.capture.baseUrl, snapshot.snapshot_key, descriptor.capture_id);
  // Low-altitude HVA frames can legitimately need longer for terrain, the GLB,
  // and CTR overlays to settle. Keep the strict semantic validation below, but
  // do not abort those captures before their report-only readiness checks finish.
  const timeoutMs = descriptor.capture_type === "HVA_FOCUS_3D"
    ? Math.max(config.capture.timeoutMs, 90000)
    : config.capture.timeoutMs;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  try {
    await page.waitForFunction(() => {
      const status = window.__stratopsReportCapture?.getState?.().status;
      return status === "READY" || status === "FAILED";
    }, null, { timeout: timeoutMs });
  } catch (error) {
    const diagnostic = await page.evaluate(() => window.__stratopsReportCapture?.getState?.() || null).catch(() => null);
    throw new Error(`${error?.message || error}; capture_state=${JSON.stringify(diagnostic)}`);
  }
  const captureState = await page.evaluate(() => window.__stratopsReportCapture.getState());
  validateSemanticCaptureState(descriptor, captureState);
  let screenshot;
  let cleanupState = null;
  try {
    screenshot = await page.screenshot({
      type: config.capture.format,
      ...(config.capture.format === "jpeg" ? { quality: config.capture.quality } : {}),
      animations: "disabled",
      caret: "hide",
      fullPage: false,
    });
  } finally {
    cleanupState = await page.evaluate(() => window.__stratopsReportCapture?.cleanup?.() || null).catch(() => null);
  }
  captureState.asset_cleanup = cleanupState;
  return { screenshot, captureState };
}

function validateSemanticCaptureState(descriptor = {}, captureState = {}) {
  if (captureState.status !== "READY") {
    const visibility = captureState.asset_focus_debug?.visibility_check;
    const diagnostic = visibility ? JSON.stringify({
      screen: visibility.screen_position,
      rendered_size: visibility.actual_visual_size_pixels,
      rendered_pixels: visibility.model_rendered_pixel_count,
      picked_pixels: visibility.model_picked_pixel_count,
      anchor_distance: visibility.anchor_to_closest_model_pick_pixels,
      safe_bounds: visibility.model_bounds_safe,
      useful_size: visibility.visual_size_useful,
      camera_range: visibility.camera_range_meters,
      bounding_sphere: visibility.model_bounding_sphere,
    }) : "";
    const reason = captureState.semantic_quality?.failure_reason || captureState.error || "capture_scene_failed";
    throw new Error(`${reason}${diagnostic ? `; visibility=${diagnostic}` : ""}`);
  }
  const quality = captureState.semantic_quality;
  if (!quality || quality.status !== "READY") {
    throw new Error(quality?.failure_reason || "semantic_quality_not_ready");
  }
  if (captureState.capture_type && captureState.capture_type !== descriptor.capture_type) {
    throw new Error("capture_type_mismatch");
  }
  return true;
}

async function storeCaptureImage({ descriptor, screenshot, config, uploadObject = s3PutObject }) {
  const localPath = getCaptureFilePath(descriptor.relative_path);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, screenshot);
  let upload = null;
  if (config.aws.bucket) {
    upload = await uploadObject(config, {
      key: descriptor.s3_key,
      body: screenshot,
      contentType: config.capture.format === "png" ? "image/png" : "image/jpeg",
    });
  }
  return { localPath, upload };
}

function buildCaptureResult(descriptor, status, overrides = {}) {
  return {
    capture_id: descriptor.capture_id,
    capture_type: descriptor.capture_type,
    status,
    local_path: null,
    s3_key: descriptor.s3_key,
    s3_url: null,
    width: null,
    height: null,
    format: null,
    generated_at: null,
    event_id: descriptor.event_id,
    cluster_id: descriptor.cluster_id,
    asset_id: descriptor.asset_id,
    camera: null,
    bounds: descriptor.bounds,
    center: descriptor.center,
    source_target: descriptor.source_target,
    failure_reason: null,
    attempt_count: 0,
    semantic_quality: null,
    asset_focus_debug: null,
    context_debug: null,
    asset_cleanup: null,
    ...overrides,
  };
}

async function generateSnapshotCaptures({
  supabase,
  snapshotKey,
  snapshotOverride = null,
  persistSnapshot = null,
  config = readReportingConfig(),
  logger = console,
  force = false,
  launchBrowser = launchCaptureBrowser,
  capturePage = captureTargetPage,
  uploadObject = s3PutObject,
  storeImage = storeCaptureImage,
} = {}) {
  if (!config.capture?.enabled && !force) {
    return { ok: true, skipped: true, reason: "capture_disabled" };
  }
  if (!snapshotOverride && !config.capture?.token) throw new Error("REPORTING_CAPTURE_TOKEN is required for report capture");
  let snapshot = snapshotOverride || await loadSnapshot(supabase, snapshotKey);
  const saveSnapshot = async (nextSnapshot) => {
    if (typeof persistSnapshot === "function") return persistSnapshot(nextSnapshot);
    if (snapshotOverride) return nextSnapshot;
    return persistCaptureState(supabase, nextSnapshot);
  };
  const descriptors = buildCaptureDescriptors(snapshot, {
    maxImages: config.capture.maxImages,
    s3Prefix: config.s3Prefix,
    format: config.capture.format,
  });
  if (!descriptors.length) return { ok: true, skipped: true, reason: "no_safe_capture_targets", snapshot_key: snapshotKey };

  const existingById = new Map((snapshot.report_manifest?.capture_results || []).map((entry) => [entry.capture_id, entry]));
  for (const pending of buildInitialCaptureResults(descriptors)) {
    if (!existingById.has(pending.capture_id)) snapshot = mergeCaptureResult(snapshot, pending);
  }
  snapshot = await saveSnapshot(snapshot);

  const pendingDescriptors = descriptors.filter((descriptor) => (
    force || existingById.get(descriptor.capture_id)?.status !== CAPTURE_STATUS.READY
  ));
  if (!pendingDescriptors.length) {
    return { ok: true, skipped: true, reason: "captures_already_ready", snapshot_key: snapshotKey };
  }

  let browser = null;
  let context = null;
  const results = [];
  try {
    browser = await launchBrowser(config);
    context = await browser.newContext({
      viewport: { width: config.capture.width, height: config.capture.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await context.route("**/stratops/reports/internal/capture/**", async (route) => {
      // The worker already owns this exact snapshot. Serve its payload to its
      // isolated capture page instead of depending on another API's flags/cache.
      {
        const requestUrl = new URL(route.request().url());
        const requestedCaptureId = decodeURIComponent(requestUrl.pathname.split("/").filter(Boolean).pop() || "");
        const capture = buildCaptureScenePayload(snapshot, requestedCaptureId, {
          maxImages: config.capture.maxImages,
          s3Prefix: config.s3Prefix,
          format: config.capture.format,
        });
        await route.fulfill({
          status: capture ? 200 : 404,
          contentType: "application/json",
          body: JSON.stringify(capture ? { ok: true, capture } : { ok: false, error: "Capture target not found" }),
        });
        return;
      }
    });
    const page = await context.newPage();
    for (const descriptor of pendingDescriptors) {
      let completed = null;
      const maxAttempts = config.capture.retries + 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        snapshot = mergeCaptureResult(snapshot, buildCaptureResult(descriptor, CAPTURE_STATUS.GENERATING, {
          attempt_count: attempt,
        }));
        snapshot = await saveSnapshot(snapshot);
        try {
          const { screenshot, captureState } = await capturePage({ page, snapshot, descriptor, config });
          const stored = await storeImage({ descriptor, screenshot, config, uploadObject });
          completed = buildCaptureResult(descriptor, CAPTURE_STATUS.READY, {
            local_path: stored.localPath,
            s3_key: stored.upload?.storageKey || descriptor.s3_key,
            s3_url: stored.upload?.url || null,
            width: config.capture.width,
            height: config.capture.height,
            format: config.capture.format,
            generated_at: nowIso(),
            camera: captureState?.camera || null,
            cluster_snapshot: captureState?.cluster_snapshot || null,
            semantic_quality: captureState?.semantic_quality || null,
            asset_focus_debug: captureState?.asset_focus_debug || null,
            context_debug: captureState?.context_debug || null,
            asset_cleanup: captureState?.asset_cleanup || null,
            attempt_count: attempt,
          });
          break;
        } catch (error) {
          const failureReason = cleanFailureReason(error);
          logger.warn?.(`[reports:capture] ${descriptor.capture_id} attempt ${attempt}/${maxAttempts} failed: ${failureReason}`);
          if (attempt === maxAttempts) {
            completed = buildCaptureResult(descriptor, CAPTURE_STATUS.FAILED, {
              generated_at: nowIso(),
              failure_reason: failureReason,
              attempt_count: attempt,
            });
          }
        }
      }
      snapshot = mergeCaptureResult(snapshot, completed);
      snapshot = await saveSnapshot(snapshot);
      results.push(completed);
    }
  } catch (error) {
    const reason = cleanFailureReason(error);
    for (const descriptor of pendingDescriptors) {
      if (results.some((result) => result.capture_id === descriptor.capture_id)) continue;
      const failed = buildCaptureResult(descriptor, CAPTURE_STATUS.FAILED, {
        generated_at: nowIso(),
        failure_reason: reason,
      });
      snapshot = mergeCaptureResult(snapshot, failed);
      results.push(failed);
    }
    snapshot = await saveSnapshot(snapshot);
  } finally {
    if (context) await context.close().catch(() => null);
    if (browser) await browser.close().catch(() => null);
  }
  return {
    ok: results.some((result) => result.status === CAPTURE_STATUS.READY),
    snapshot_key: snapshotKey,
    ready: results.filter((result) => result.status === CAPTURE_STATUS.READY).length,
    failed: results.filter((result) => result.status === CAPTURE_STATUS.FAILED).length,
    results,
    ...(snapshotOverride ? { snapshot } : {}),
  };
}

async function walkCaptureFiles(directory = CAPTURE_ROOT) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkCaptureFiles(path));
    else if (entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

async function cleanupExpiredReportCaptures({ config = readReportingConfig(), now = Date.now() } = {}) {
  const files = await walkCaptureFiles();
  const removed = [];
  for (const filePath of files) {
    const details = await stat(filePath);
    if (!isCaptureCleanupEligible({
      modifiedAt: details.mtime,
      now,
      retentionHours: config.capture.retentionHours,
    })) continue;
    await unlink(filePath);
    removed.push(filePath);
  }
  return { ok: true, removed, retention_hours: config.capture.retentionHours };
}

async function captureSnapshotByDate({ supabase, dateKey, scope = {}, config = readReportingConfig(), force = false, logger = console } = {}) {
  const normalizedScope = normalizeScope(scope);
  const snapshotKey = buildSnapshotKey(dateKey, getScopeKey(normalizedScope));
  return generateSnapshotCaptures({ supabase, snapshotKey, config, force, logger });
}

async function generateScheduledCaptures({ supabase, config = readReportingConfig(), logger = console, referenceDate = new Date() } = {}) {
  if (!config.capture?.enabled) return { ok: true, skipped: true, reason: "capture_disabled" };
  const dateKey = getPreviousUtcDateKey(referenceDate);
  const results = [];
  for (const scope of getScheduledScopes(config)) {
    try {
      results.push({ scope: getScopeKey(scope), ...(await captureSnapshotByDate({ supabase, dateKey, scope, config, logger })) });
    } catch (error) {
      results.push({ ok: false, scope: getScopeKey(scope), error: cleanFailureReason(error) });
    }
  }
  const cleanup = await cleanupExpiredReportCaptures({ config }).catch((error) => ({ ok: false, error: cleanFailureReason(error) }));
  return { ok: results.some((result) => result.ok), dateKey, results, cleanup };
}

const __reportingCaptureTestUtils = {
  CAPTURE_ROOT,
  buildCaptureResult,
  captureTargetPage,
  getCaptureFilePath,
  persistCaptureState,
  storeCaptureImage,
  validateSemanticCaptureState,
};

export {
  __reportingCaptureTestUtils,
  captureSnapshotByDate,
  cleanupExpiredReportCaptures,
  generateScheduledCaptures,
  generateSnapshotCaptures,
};
