import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("operational reports open the published HTML artifact behind a local loader", async () => {
  const html = await readSource("../../../dev/partials/popups.html");
  const source = await readSource("../../../dev/assets/js/essential.js");
  const api = await readSource("../../../dev/assets/js/supabase.js");
  const components = await readSource("../../../dev/assets/css/warzone-components.css");

  assert.match(html, /id="wz-operational-report-loader"/);
  assert.match(html, /class="wz-operational-report-loader__gif"[^>]*src="\/assets\/images\/web\/bx_preloader\.gif"|src="\/assets\/images\/web\/bx_preloader\.gif"[^>]*class="wz-operational-report-loader__gif"/);
  assert.match(html, /id="wz-operational-report-viewer-frame"/);
  assert.match(html, /id="wz-operational-reports-select"/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(html, /Download (?:Report in PDF|PDF)/);
  assert.doesNotMatch(html, /wz-report-card--latest|wz-operational-reports-latest-summary/);
  assert.match(source, /const htmlUrl = api\.getOperationalReportHtmlUrl\(report\)/);
  assert.match(source, /frame\.onload = \(\) => \{[\s\S]*?loader\.hidden = true;[\s\S]*?frame\.hidden = false/);
  assert.match(components, /--wz-operational-report-loader-size:\s*16rem/);
  assert.match(components, /\.wz-operational-report-loader__gif\s*\{[\s\S]*?width:\s*var\(--wz-operational-report-loader-size\)/);
  assert.match(components, /\.wz-operational-report-loader\[hidden\][\s\S]*?display:\s*none !important/);
  assert.match(source, /frame\.src = htmlUrl/);
  assert.match(source, /api\.getOperationalReports\("daily", "global"\)/);
  assert.match(source, /api\.getOperationalReportDownloadUrl\(report\)/);
  assert.match(source, /selectedReport = report/);
  assert.match(source, /node\.inert = true/);
  assert.match(source, /node\.inert = inert/);
  assert.match(source, /screenSpaceCameraController/);
  assert.match(source, /canLoadOperationalReportHtml/);
  assert.match(source, /method:\s*"HEAD"/);
  assert.match(source, /OPERATIONAL_REPORT_DESKTOP_VIEWPORT_WIDTH = 1024/);
  assert.match(source, /new ResizeObserver\(syncOperationalReportPreviewLayout\)/);
  assert.match(source, /bounds\.width \/ OPERATIONAL_REPORT_DESKTOP_VIEWPORT_WIDTH/);
  assert.match(source, /modal\.addEventListener\("wheel", \(event\) => event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /report\.generated_summary/);
  assert.match(api, /getOperationalReportHtmlUrl\(report = \{\}\)/);
  assert.match(api, /\/generated-reports\/history\?/);
  assert.match(api, /source:\s*"local"/);
});

test("report popup keeps desktop app chrome visible and uses a contained 70vw by 70vh viewer", async () => {
  const components = await readSource("../../../dev/assets/css/warzone-components.css");
  const reportCss = await readSource("../../../dev/reports/template/reports.css");
  const boot = await readSource("../../../dev/assets/js/warzone-boot.js");

  assert.match(components, /body\.is-operational-report-open #warzone-gate-layer\s*\{[\s\S]*?z-index:\s*20000/);
  assert.match(components, /\.wz-operational-reports \.wz-modal-box\s*\{[\s\S]*?width:\s*70vw;[\s\S]*?height:\s*70vh/);
  assert.match(components, /\.wz-operational-reports\s*\{[\s\S]*?z-index:\s*2147483000/);
  assert.match(components, /body\.is-operational-report-open \.warzone-view\s*\{[\s\S]*?opacity:\s*0\.68/);
  assert.match(components, /\.wz-operational-report-viewer__frame\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%/);
  assert.match(components, /@media \(max-width:\s*768px\)[\s\S]*?\.wz-operational-reports__controls \.btn-primary\s*\{[\s\S]*?width:\s*100%/);
  assert.match(components, /@media \(max-width:\s*768px\)[\s\S]*?body\.is-operational-report-open \.warzone-brand/);
  assert.doesNotMatch(boot, /modalId === "wz-operational-reports-modal"/);
  assert.match(reportCss, /@media screen and \(max-width:\s*900px\)[\s\S]*?width:\s*100% !important;[\s\S]*?height:\s*auto !important/);
  assert.match(reportCss, /\.metrics-list\s*\{[\s\S]*?width:\s*100%/);
});
