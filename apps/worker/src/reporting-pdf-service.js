import { createServer } from "http";
import { readFile, stat, writeFile } from "fs/promises";
import { extname, normalize, resolve } from "path";
import { fileURLToPath } from "url";
import { readReportingConfig } from "../../shared/reporting-config.js";
import { buildSnapshotKey } from "../../shared/reporting-snapshot.js";
import {
  getPreviousUtcDateKey,
  getScopeKey,
  normalizeScope,
} from "../../shared/reporting-service.js";
import { __reportingRenderTestUtils } from "./reporting-render-service.js";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, "..", "..", "..", "..");
const STATIC_ASSET_ROOT = resolve(PROJECT_ROOT, "dev", "assets");
const PDF_PRINT_OPTIONS = Object.freeze({
  preferCSSPageSize: true,
  printBackground: true,
  displayHeaderFooter: false,
  scale: 1,
});

function nowIso() {
  return new Date().toISOString();
}

function contentTypeFor(path = "") {
  const extension = extname(path).toLowerCase();
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extension] || "application/octet-stream";
}

function safeResolve(root, relativePath = "") {
  const target = resolve(root, relativePath.replace(/^[/\\]+/, ""));
  const rootPrefix = normalize(`${root}\\`);
  if (!normalize(target).startsWith(rootPrefix)) throw new Error("Invalid report asset path");
  return target;
}

async function startReportHttpServer(outputDirectory) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      let filePath;
      if (pathname === "/" || pathname === "/report.html") {
        filePath = resolve(outputDirectory, "report.html");
      } else if (pathname.startsWith("/images/")) {
        filePath = safeResolve(outputDirectory, pathname);
      } else if (pathname.startsWith("/assets/")) {
        filePath = safeResolve(STATIC_ASSET_ROOT, pathname.slice("/assets/".length));
      } else {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": contentTypeFor(filePath),
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Unavailable");
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/report.html`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

async function waitForReportReadiness(page, timeoutMs) {
  await page.waitForFunction(() => (
    window.__stratopsReportReady === true
    && window.__stratopsReport?.getState?.().status === "READY"
    && Number(window.__stratopsReport?.getState?.().pageCount) > 0
  ), null, { timeout: timeoutMs });
  return page.evaluate(async () => {
    const first = window.__stratopsReport.getState();
    await new Promise((resolveReady) => requestAnimationFrame(() => requestAnimationFrame(resolveReady)));
    const second = window.__stratopsReport.getState();
    const pendingImages = [...document.images].filter((image) => !image.complete).length;
    if (first.pageCount !== second.pageCount || second.status !== "READY" || pendingImages) {
      throw new Error("Report pagination or images did not stabilize");
    }
    return {
      pageCount: Number(second.pageCount),
      title: document.title,
      text: document.body.innerText,
      oversizedBlocks: document.querySelectorAll(".pagination-block--oversized").length,
      failedImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0).length,
    };
  });
}

async function inspectPdfBuffer(buffer) {
  const header = buffer.subarray(0, 5).toString("ascii");
  if (header !== "%PDF-") throw new Error("Generated file is not a PDF");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: new Uint8Array(buffer), disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  await document.destroy();
  return { pageCount: pages.length, text: pages.join("\n") };
}

function validatePdfInspection({ buffer, inspection, expectedDate, expectedPageCount, minimumSizeBytes }) {
  if (buffer.length < minimumSizeBytes) throw new Error(`Generated PDF is too small (${buffer.length} bytes)`);
  if (!inspection.pageCount) throw new Error("Generated PDF has no pages");
  if (!inspection.text.includes(expectedDate)) throw new Error(`Generated PDF text does not include report date ${expectedDate}`);
  if (!/STRATOPS/i.test(inspection.text)) throw new Error("Generated PDF text does not include the report identity");
  if (expectedPageCount && inspection.pageCount !== expectedPageCount) {
    throw new Error(`PDF page count ${inspection.pageCount} does not match report DOM page count ${expectedPageCount}`);
  }
  return true;
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

async function persistPdfManifest(supabase, snapshotKey, reportManifest) {
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .update({ report_manifest: reportManifest, updated_at: nowIso() })
    .eq("snapshot_key", snapshotKey)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function generateSnapshotPdf({
  supabase,
  snapshotKey,
  config = readReportingConfig(),
  launchBrowser,
  persistState = persistPdfManifest,
  generatedAt = nowIso(),
} = {}) {
  if (!supabase) throw new Error("Supabase client is required to load the report snapshot");
  const snapshot = await loadSnapshot(supabase, snapshotKey);
  const outputDirectory = __reportingRenderTestUtils.getReportOutputDirectory(snapshot);
  const htmlPath = resolve(outputDirectory, "report.html");
  await stat(htmlPath);
  const pdfPath = resolve(outputDirectory, "report.pdf");
  const startedAt = Date.now();
  const localServer = await startReportHttpServer(outputDirectory);
  let browser;
  try {
    if (launchBrowser) {
      browser = await launchBrowser(config);
    } else {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({
        headless: true,
        ...(config.capture?.browserExecutablePath ? { executablePath: config.capture.browserExecutablePath } : {}),
      });
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await page.emulateMedia({ media: "print" });
    await page.goto(localServer.url, { waitUntil: "domcontentloaded", timeout: config.pdf.readinessTimeoutMs });
    const readiness = await waitForReportReadiness(page, config.pdf.readinessTimeoutMs);
    const buffer = await page.pdf({ path: pdfPath, ...PDF_PRINT_OPTIONS });
    const inspection = await inspectPdfBuffer(buffer);
    validatePdfInspection({
      buffer,
      inspection,
      expectedDate: snapshot.snapshot_date,
      expectedPageCount: readiness.pageCount,
      minimumSizeBytes: config.pdf.minimumSizeBytes,
    });
    const generatedManifest = {
      ...(snapshot.report_manifest || {}),
      generation_status: "pdf_ready",
      overall_status: "PDF",
      pdf: {
        status: "READY",
        generated_at: generatedAt,
        local_path: "report.pdf",
        s3_key: snapshot.report_manifest?.object_keys?.report_pdf || null,
        size_bytes: buffer.length,
        page_count: inspection.pageCount,
        dom_page_count: readiness.pageCount,
        render_duration_ms: Date.now() - startedAt,
        failed_image_count: readiness.failedImages,
        oversized_block_count: readiness.oversizedBlocks,
      },
    };
    await writeFile(resolve(outputDirectory, "manifest.json"), `${JSON.stringify(generatedManifest, null, 2)}\n`, "utf8");
    await persistState(supabase, snapshotKey, generatedManifest);
    return {
      ok: true,
      snapshot_key: snapshotKey,
      report_date: snapshot.snapshot_date,
      output_directory: outputDirectory,
      report_pdf: pdfPath,
      page_count: inspection.pageCount,
      dom_page_count: readiness.pageCount,
      size_bytes: buffer.length,
      render_duration_ms: generatedManifest.pdf.render_duration_ms,
      text_verified: true,
      pdf: generatedManifest.pdf,
      manifest_json: resolve(outputDirectory, "manifest.json"),
    };
  } finally {
    await browser?.close().catch(() => null);
    await localServer.close().catch(() => null);
  }
}

async function generatePdfByDate({ supabase, dateKey = getPreviousUtcDateKey(), scope = {}, config = readReportingConfig() } = {}) {
  const normalizedScope = normalizeScope(scope);
  return generateSnapshotPdf({
    supabase,
    snapshotKey: buildSnapshotKey(dateKey, getScopeKey(normalizedScope)),
    config,
  });
}

const __reportingPdfTestUtils = {
  PDF_PRINT_OPTIONS,
  STATIC_ASSET_ROOT,
  contentTypeFor,
  inspectPdfBuffer,
  safeResolve,
  startReportHttpServer,
  validatePdfInspection,
  waitForReportReadiness,
};

export {
  __reportingPdfTestUtils,
  generatePdfByDate,
  generateSnapshotPdf,
};
