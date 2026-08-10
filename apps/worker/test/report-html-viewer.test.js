import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("operational reports temporarily open the published PDF artifact behind a local loader", async () => {
  const html = await readSource("../../../dev/partials/popups.html");
  const source = await readSource("../../../dev/assets/js/essential.js");
  const api = await readSource("../../../dev/assets/js/supabase.js");
  const featureConfig = await readSource("../../../dev/assets/js/stratops-feature-config.js");
  const components = await readSource("../../../dev/assets/css/warzone-components.css");
  const productionServer = await readSource("../../../server.js");
  const webpack = await readSource("../../../webpack.config.js");

  assert.match(html, /id="wz-operational-report-loader"/);
  assert.match(html, /class="wz-operational-report-loader__gif"[^>]*src="\/assets\/images\/web\/bx_preloader\.gif"|src="\/assets\/images\/web\/bx_preloader\.gif"[^>]*class="wz-operational-report-loader__gif"/);
  assert.match(html, /id="wz-operational-report-viewer-frame"/);
  assert.match(html, /id="wz-operational-reports-select"/);
  assert.doesNotMatch(html, /id="wz-operational-report-viewer-frame"[^>]*\bsandbox=/);
  assert.match(html, /Download (?:Report in PDF|PDF)/);
  assert.doesNotMatch(html, /wz-report-card--latest|wz-operational-reports-latest-summary/);
  assert.match(featureConfig, /reports:\s*\{[\s\S]*?htmlPreview:\s*false/);
  assert.match(source, /isStratOpsFeatureEnabled\("reports\.htmlPreview", false\)/);
  assert.match(source, /api\.getOperationalReportViewerUrl\(report\)/);
  assert.match(source, /frame\.onload = \(\) => \{[\s\S]*?loader\.hidden = true;[\s\S]*?frame\.hidden = false/);
  assert.match(components, /--wz-operational-report-loader-size:\s*26rem/);
  assert.match(components, /\.wz-operational-report-loader__gif\s*\{[\s\S]*?width:\s*var\(--wz-operational-report-loader-size\)/);
  assert.match(components, /\.wz-operational-report-loader\[hidden\][\s\S]*?display:\s*none !important/);
  assert.match(source, /frame\.src = frameUrl/);
  assert.match(source, /api\.getOperationalReports\("daily", "global"\)/);
  assert.match(source, /api\.getOperationalReportDownloadUrl\(report\)/);
  assert.match(source, /selectedReport = report/);
  assert.match(source, /node\.inert = true/);
  assert.match(source, /node\.inert = inert/);
  assert.match(source, /screenSpaceCameraController/);
  assert.match(source, /canLoadOperationalReportPreview/);
  assert.match(source, /method:\s*"HEAD"/);
  assert.match(source, /"application\/pdf"/);
  assert.match(source, /OPERATIONAL_REPORT_DESKTOP_VIEWPORT_WIDTH = 1024/);
  assert.match(source, /new ResizeObserver\(syncOperationalReportPreviewLayout\)/);
  assert.match(source, /bounds\.width \/ OPERATIONAL_REPORT_DESKTOP_VIEWPORT_WIDTH/);
  assert.match(source, /modal\.addEventListener\("wheel", \(event\) => event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /report\.generated_summary/);
  assert.match(api, /getOperationalReportHtmlUrl\(report = \{\}\)/);
  assert.match(api, /report\?\.preview_url/);
  assert.match(api, /report\?\.local_preview !== true/);
  assert.match(api, /parsed\.origin === window\.location\.origin/);
  assert.match(productionServer, /Buffer\.from\(await response\.arrayBuffer\(\)\)/);
  assert.match(productionServer, /"content-disposition"[\s\S]*?"content-security-policy"[\s\S]*?"x-frame-options"/);
  assert.match(webpack, /Buffer\.from\(await response\.arrayBuffer\(\)\)/);
  assert.match(webpack, /"content-disposition"[\s\S]*?"content-security-policy"[\s\S]*?"x-frame-options"/);
  assert.match(api, /\/generated-reports\/history\?/);
  assert.match(api, /source:\s*"local"/);
});

test("PDF.js report viewer uses centralized StratOps surfaces and stable thumbnail states", async () => {
  const source = await readSource("../../../dev/assets/js/report-pdf-viewer.js");
  const viewerHtml = await readSource("../../../dev/pages/report-pdf-viewer.html");
  const viewerCss = await readSource("../../../dev/assets/css/report-pdf-viewer.css");
  const rootCss = await readSource("../../../dev/assets/css/root.css");
  const essential = await readSource("../../../dev/assets/js/essential.js");
  const webpack = await readSource("../../../webpack.config.js");
  const packageJson = JSON.parse(await readSource("../../../package.json"));

  assert.equal(packageJson.dependencies["pdfjs-dist"], "^4.8.69");
  assert.match(essential, /new URL\("\/pages\/report-pdf-viewer\.html", window\.location\.origin\)/);
  assert.match(essential, /viewerUrl\.searchParams\.set\("file", previewUrl\)/);
  assert.match(essential, /frame\.src = frameUrl/);
  assert.match(source, /from "pdfjs-dist\/build\/pdf\.mjs"/);
  assert.match(source, /new PDFViewer\(/);
  assert.match(source, /fetch\(parsed\.href,[\s\S]*?Accept: "application\/pdf"/);
  assert.match(source, /renderThumbnail\(pdfDocument, pageNumber, pdfViewer\)/);
  assert.match(source, /setActiveThumbnail\(pageNumber\)/);
  assert.match(viewerHtml, /id="report-pdf-thumbnails"/);
  assert.match(viewerHtml, /id="report-pdf-download"/);
  assert.match(rootCss, /--report-pdf-toolbar-bg:\s*#18222c/);
  assert.match(rootCss, /--report-pdf-sidebar-bg:\s*#111920/);
  assert.match(rootCss, /--report-pdf-viewer-bg:\s*#090f14/);
  assert.match(rootCss, /--report-pdf-thumbnail-hover-border:\s*#20d6d6/);
  assert.match(rootCss, /--report-pdf-thumbnail-active-border:\s*#20d6d6/);
  assert.match(viewerCss, /\.report-pdf-thumbnail\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?border:\s*1px solid var\(--report-pdf-thumbnail-border\)/);
  assert.match(viewerCss, /\.report-pdf-thumbnail:hover,[\s\S]*?border-color:\s*var\(--report-pdf-thumbnail-hover-border\)/);
  assert.match(viewerCss, /\.report-pdf-thumbnail\.is-active,[\s\S]*?outline:\s*2px solid var\(--report-pdf-thumbnail-active-border\)/);
  assert.doesNotMatch(viewerCss, /\.report-pdf-thumbnail:hover[^}]*\b(?:width|height):/);
  assert.match(webpack, /reportPdfViewer:\s*path\.resolve\(DEV_DIR, "assets\/js\/report-pdf-viewer\.js"\)/);
  assert.match(webpack, /filename:\s*"pages\/report-pdf-viewer\.html"/);
  assert.match(webpack, /pdf\.worker\.min\.mjs/);
});

test("report popup keeps desktop app chrome visible and uses the configured contained viewer", async () => {
  const components = await readSource("../../../dev/assets/css/warzone-components.css");
  const reportCss = await readSource("../../../dev/reports/template/reports.css");
  const boot = await readSource("../../../dev/assets/js/warzone-boot.js");

  assert.match(components, /body\.is-operational-report-open #warzone-gate-layer\s*\{[\s\S]*?z-index:\s*20000/);
  assert.match(components, /\.wz-operational-reports \.wz-modal-box\s*\{[\s\S]*?width:\s*70vw;[\s\S]*?height:\s*80vh/);
  assert.match(components, /\.wz-operational-reports\s*\{[\s\S]*?z-index:\s*2147483000/);
  assert.match(components, /body\.is-operational-report-open \.warzone-view\s*\{[\s\S]*?opacity:\s*0\.68/);
  assert.match(components, /\.wz-operational-report-viewer__frame\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%/);
  assert.match(components, /@media \(max-width:\s*768px\)[\s\S]*?\.wz-operational-reports__controls \.btn-primary\s*\{[\s\S]*?width:\s*100%/);
  assert.match(components, /@media \(max-width:\s*768px\)[\s\S]*?body\.is-operational-report-open \.warzone-brand/);
  assert.doesNotMatch(boot, /modalId === "wz-operational-reports-modal"/);
  assert.match(reportCss, /@media screen and \(max-width:\s*900px\)[\s\S]*?width:\s*100% !important;[\s\S]*?height:\s*auto !important/);
  assert.match(reportCss, /\.metrics-list\s*\{[\s\S]*?width:\s*100%/);
});
