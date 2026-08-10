import { mkdir, writeFile } from "fs/promises";
import { resolve } from "path";
import {
  DEV_HVA_ASSET_ID,
  assertReportingDevHvaFixtureAllowed,
  injectReportingDevHvaFixture,
} from "../../shared/reporting-dev-hva-fixture.js";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import { getScopeKey, normalizeScope } from "../../shared/reporting-service.js";
import { generateSnapshotCaptures } from "./reporting-capture-service.js";
import { generateSnapshotPdf } from "./reporting-pdf-service.js";
import { __reportingRenderTestUtils, renderSnapshotReport } from "./reporting-render-service.js";

async function loadBaseSnapshot(supabase, snapshotKey) {
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .select("*")
    .eq("snapshot_key", snapshotKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Base report snapshot not found: ${snapshotKey}. Generate the real snapshot first.`);
  return data;
}

function createLocalFixtureConfig(config = readReportingConfig()) {
  return {
    ...config,
    publicAssetBaseUrl: "",
    aws: { ...(config.aws || {}), bucket: "" },
    capture: { ...(config.capture || {}), enabled: true },
  };
}

function createTransientSnapshotState(snapshot) {
  let current = snapshot;
  return {
    get snapshot() { return current; },
    replace(nextSnapshot) {
      current = nextSnapshot;
      return current;
    },
    persistManifest(_supabase, _snapshotKey, reportManifest) {
      current = { ...current, report_manifest: reportManifest };
      return current;
    },
  };
}

function createFixtureCaptureSnapshot(snapshot) {
  const next = structuredClone(snapshot);
  const isFixtureTarget = (target) => target?.asset_id === DEV_HVA_ASSET_ID
    && ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT"].includes(target?.type || target?.capture_type);
  const reportContent = next.snapshot_data?.report_content || {};
  reportContent.operational_imagery_targets = (reportContent.operational_imagery_targets || []).filter(isFixtureTarget);
  next.snapshot_data.report_content = reportContent;
  next.report_manifest.selected_capture_targets = (next.report_manifest.selected_capture_targets || []).filter(isFixtureTarget);
  next.report_manifest.capture_requirements = (next.report_manifest.capture_requirements || []).filter(isFixtureTarget);
  return next;
}

function buildLocalReportUrl(snapshot = {}, baseUrl = "http://localhost:4173") {
  const imageDirectory = __reportingRenderTestUtils.getReportOutputDirectory(snapshot)
    .replace(__reportingRenderTestUtils.REPORT_OUTPUT_ROOT, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  return `${String(baseUrl || "http://localhost:4173").replace(/\/+$/, "")}/generated-reports/${imageDirectory}/report.html`;
}

async function runReportingDevHvaFixture({
  supabase,
  dateKey,
  scope = {},
  config = readReportingConfig(),
  localOnly = false,
  scheduled = false,
  captureOnly = false,
  logger = console,
} = {}) {
  if (!supabase) throw new Error("Supabase client is required to read the base report snapshot");
  assertReportingDevHvaFixtureAllowed({ config, localOnly, scheduled });
  const normalizedScope = normalizeScope(scope);
  const snapshotKey = buildSnapshotKey(dateKey, getScopeKey(normalizedScope));
  const baseSnapshot = await loadBaseSnapshot(supabase, snapshotKey);
  const transient = createTransientSnapshotState(createFixtureCaptureSnapshot(injectReportingDevHvaFixture(baseSnapshot)));
  const localConfig = createLocalFixtureConfig(config);
  const captureResult = await generateSnapshotCaptures({
    supabase: null,
    snapshotKey,
    snapshotOverride: transient.snapshot,
    persistSnapshot: async (nextSnapshot) => transient.replace(nextSnapshot),
    config: localConfig,
    logger,
    force: true,
  });
  if (captureResult.snapshot) transient.replace(captureResult.snapshot);
  const fixtureCaptures = (captureResult.results || []).filter((result) => result.asset_id === DEV_HVA_ASSET_ID);
  const readyFixtureTypes = new Set(fixtureCaptures.filter((result) => result.status === "READY").map((result) => result.capture_type));
  const missingFixtureTypes = ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT"].filter((type) => !readyFixtureTypes.has(type));
  if (missingFixtureTypes.length) {
    throw new Error(`Dev HVA fixture capture failed: ${missingFixtureTypes.join(", ")}`);
  }
  const outputDirectory = __reportingRenderTestUtils.getReportOutputDirectory(transient.snapshot);
  await mkdir(outputDirectory, { recursive: true });
  if (captureOnly) {
    await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(transient.snapshot.report_manifest, null, 2)}\n`, "utf8");
    return {
      ok: true,
      capture_only: true,
      snapshot_key: snapshotKey,
      output_directory: outputDirectory,
      captures: captureResult.results,
      dev_fixture: transient.snapshot.snapshot_data?.dev_fixture,
    };
  }
  const renderResult = await renderSnapshotReport({
    supabase: null,
    snapshotKey,
    snapshotOverride: transient.snapshot,
    config: localConfig,
    upload: false,
    persistState: (...args) => transient.persistManifest(...args),
  });
  const pdfResult = await generateSnapshotPdf({
    supabase: null,
    snapshotKey,
    snapshotOverride: transient.snapshot,
    config: localConfig,
    persistState: (...args) => transient.persistManifest(...args),
  });
  return {
    ok: renderResult.ok && pdfResult.ok,
    capture_only: false,
    local_only: true,
    snapshot_key: snapshotKey,
    output_directory: outputDirectory,
    captures: captureResult.results,
    report_html: renderResult.report_html,
    report_pdf: pdfResult.report_pdf,
    html_url: buildLocalReportUrl(transient.snapshot, localConfig.capture?.baseUrl),
    pdf: pdfResult.pdf,
    dev_fixture: transient.snapshot.snapshot_data?.dev_fixture,
  };
}

export {
  buildLocalReportUrl,
  createFixtureCaptureSnapshot,
  createLocalFixtureConfig,
  createTransientSnapshotState,
  runReportingDevHvaFixture,
};
