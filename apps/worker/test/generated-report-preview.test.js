import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import express from "express";

const require = createRequire(import.meta.url);
const {
  createGeneratedReportPreviewRouter,
  resolveGeneratedReportArtifact,
} = require("../../../server/generated-report-preview.js");

async function listen(app) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function writeReport(root, dateKey, { pdf = true, html = true } = {}) {
  const directory = join(root, "daily", "global", dateKey);
  await mkdir(join(directory, "images"), { recursive: true });
  if (html) await writeFile(join(directory, "report.html"), "<!doctype html><title>Local briefing</title>");
  if (pdf) await writeFile(join(directory, "report.pdf"), Buffer.from("%PDF-1.4\n"));
  await writeFile(join(directory, "report.json"), JSON.stringify({
    report_id: `daily:${dateKey}:global:v1`,
    report_date: dateKey,
    window: { start: `${dateKey}T00:00:00.000Z`, end: `${dateKey}T23:59:59.999Z` },
    scope: { type: "global", label: "Global" },
  }));
  await writeFile(join(directory, "manifest.json"), "{}\n");
  await writeFile(join(directory, "images", "overview.png"), Buffer.from([137, 80, 78, 71]));
}

test("generated report preview serves safe local artifacts, MIME types, history, and real 404s", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "stratops-report-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeReport(root, "2026-08-08");
  await writeReport(root, "2026-08-07", { pdf: false });
  await writeReport(root, "2026-08-06", { html: false });

  const app = express();
  app.use("/generated-reports", createGeneratedReportPreviewRouter({ root, historyLimit: 7 }));
  const server = await listen(app);
  t.after(server.close);

  const html = await fetch(`${server.origin}/generated-reports/daily/global/2026-08-08/report.html`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get("content-type"), /^text\/html/);

  const pdf = await fetch(`${server.origin}/generated-reports/daily/global/2026-08-08/report.pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get("content-type"), /^application\/pdf/);

  const preview = await fetch(`${server.origin}/generated-reports/preview/daily/global/2026-08-08/report.pdf`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-type"), /^application\/pdf/);
  assert.match(preview.headers.get("content-disposition"), /^inline;/);
  assert.equal(preview.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(preview.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(preview.headers.get("cross-origin-resource-policy"), "same-origin");

  const download = await fetch(`${server.origin}/generated-reports/download/daily/global/2026-08-08/report.pdf`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal(download.headers.get("x-frame-options"), null);

  const manifest = await fetch(`${server.origin}/generated-reports/daily/global/2026-08-08/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get("content-type"), /^application\/json/);

  const image = await fetch(`${server.origin}/generated-reports/daily/global/2026-08-08/images/overview.png`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /^image\/png/);

  const missing = await fetch(`${server.origin}/generated-reports/daily/global/2099-01-01/report.html`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /^text\/plain/);
  assert.doesNotMatch(await missing.text(), /PAGE NOT FOUND/i);

  const historyResponse = await fetch(`${server.origin}/generated-reports/history?type=daily&scope_type=global`);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.deepEqual(history.reports.map((report) => report.report_date), ["2026-08-08", "2026-08-07"]);
  assert.equal(history.reports[0].is_latest, true);
  assert.equal(history.reports[0].pdf_available, true);
  assert.match(history.reports[0].html_url, /\/2026-08-08\/report\.html$/);
  assert.match(history.reports[0].preview_url, /\/preview\/daily\/global\/2026-08-08\/report\.pdf$/);
  assert.match(history.reports[0].download_url, /\/download\/daily\/global\/2026-08-08\/report\.pdf$/);
  assert.equal(history.reports[1].status, "preview_only");
  assert.equal(history.reports[1].download_url, "");
});

test("generated report preview rejects traversal and unsupported paths", () => {
  const root = join(tmpdir(), "stratops-report-preview-root");
  assert.equal(resolveGeneratedReportArtifact(root, "/../secret.json"), null);
  assert.equal(resolveGeneratedReportArtifact(root, "/%2e%2e/secret.json"), null);
  assert.equal(resolveGeneratedReportArtifact(root, "/daily/global/report.exe"), null);
  assert.equal(resolveGeneratedReportArtifact(root, "/daily/global/2026-08-08/../../secret.json"), null);
});
