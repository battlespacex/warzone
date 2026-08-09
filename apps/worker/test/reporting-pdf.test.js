import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { chromium } from "playwright";
import { __reportingPdfTestUtils } from "../src/reporting-pdf-service.js";
import { __reportingRenderTestUtils } from "../src/reporting-render-service.js";

test("PDF output and print options are deterministic and retain US Letter CSS size", async () => {
  const directory = __reportingRenderTestUtils.getReportOutputDirectory({
    snapshot_date: "2026-08-07",
    scope_type: "region",
    scope_value: "Middle East",
  });
  assert.match(directory.replace(/\\/g, "/"), /\.generated\/reports\/daily\/region\/middle-east\/2026-08-07$/);
  assert.deepEqual(__reportingPdfTestUtils.PDF_PRINT_OPTIONS, {
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    scale: 1,
  });
  const css = await readFile(__reportingRenderTestUtils.REPORT_CSS_PATH, "utf8");
  assert.match(css, /@page\s*\{[\s\S]*?size:\s*215\.9mm 279\.4mm;/);
  const template = await readFile(__reportingRenderTestUtils.REPORT_TEMPLATE_PATH, "utf8");
  assert.match(template, /window\.__stratopsReportReady = true/);
  assert.match(template, /document\.fonts\?\.ready/);
  assert.match(
    __reportingRenderTestUtils.applyPublicAssetBaseUrl('<img src="/assets/logo.svg">', "https://stratops.example/"),
    /https:\/\/stratops\.example\/assets\/logo\.svg/
  );
});

test("readiness wait requires stable pagination and no pending images", async () => {
  const calls = [];
  const page = {
    async waitForFunction(callback, value, options) {
      calls.push({ callback: String(callback), value, options });
    },
    async evaluate() {
      return { pageCount: 7, title: "Report", text: "STRATOPS", oversizedBlocks: 0, failedImages: 1 };
    },
  };
  const result = await __reportingPdfTestUtils.waitForReportReadiness(page, 12345);
  assert.equal(result.pageCount, 7);
  assert.equal(calls[0].options.timeout, 12345);
  assert.match(calls[0].callback, /__stratopsReportReady/);
  assert.match(calls[0].callback, /pageCount/);
});

test("HTML converts to a text-readable PDF over HTTP without Chromium headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stratops-report-pdf-"));
  let server;
  let browser;
  try {
    await writeFile(join(directory, "report.html"), `<!doctype html><html><head><title>StratOps</title><style>@page { size: 215.9mm 279.4mm; margin: 0; } body { font: 20px sans-serif; }</style></head><body><h1>STRATOPS</h1><p>2026-08-07 operational intelligence briefing</p><script>window.__stratopsReportReady=true;window.__stratopsReport={getState(){return {status:'READY',pageCount:1}}};</script></body></html>`, "utf8");
    server = await __reportingPdfTestUtils.startReportHttpServer(directory);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    const buffer = await page.pdf(__reportingPdfTestUtils.PDF_PRINT_OPTIONS);
    const inspection = await __reportingPdfTestUtils.inspectPdfBuffer(buffer);
    assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(inspection.pageCount, 1);
    assert.match(inspection.text, /STRATOPS/);
    assert.match(inspection.text, /2026-08-07/);
    assert.doesNotMatch(inspection.text, /127\.0\.0\.1|about:blank/);
  } finally {
    await browser?.close().catch(() => null);
    await server?.close().catch(() => null);
    await rm(directory, { recursive: true, force: true });
  }
});
