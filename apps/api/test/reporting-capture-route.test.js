import test from "node:test";
import assert from "node:assert/strict";
import { __stratopsRouteTestUtils } from "../src/routes.stratops.js";

function requestWithAuthorization(value = "") {
  return {
    get(name) {
      return String(name).toLowerCase() === "authorization" ? value : "";
    },
  };
}

function requestForOrigin(origin = "https://stratops.battlespacex.com", prefix = "/api") {
  return {
    get(name) {
      const header = String(name).toLowerCase();
      if (header === "origin") return origin;
      if (header === "x-forwarded-prefix") return prefix;
      return "";
    },
  };
}

test("internal report capture authorization requires an exact bearer token", () => {
  const expected = "capture-secret-123";
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization(`Bearer ${expected}`), expected), true);
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization("Bearer wrong"), expected), false);
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization(""), expected), false);
  assert.equal(__stratopsRouteTestUtils.isAuthorizedCaptureRequest(requestWithAuthorization(`Bearer ${expected}`), ""), false);
});

test("published reports expose the HTML artifact beside the existing PDF", () => {
  const report = { pdf_storage_key: "reports/daily/global/2026-08-08/report.pdf" };
  const req = requestForOrigin();
  assert.equal(
    __stratopsRouteTestUtils.buildReportArtifactStorageKey(report, "report.html"),
    "reports/daily/global/2026-08-08/report.html"
  );
  assert.equal(
    __stratopsRouteTestUtils.getPublicReportHtmlUrl(req, report),
    "https://stratops.battlespacex.com/reports/daily/global/2026-08-08/report.html"
  );
});

test("report history payload is sanitized and binds HTML/PDF to the same publication", () => {
  const req = requestForOrigin();
  const report = {
    id: "report-2026-08-08",
    report_key: "daily:2026-08-08:global",
    report_type: "daily",
    scope_type: "global",
    scope_label: "Global",
    period_start: "2026-08-08T00:00:00.000Z",
    period_end: "2026-08-09T00:00:00.000Z",
    status: "available",
    pdf_storage_key: "reports/daily/global/2026-08-08/report.pdf",
    download_token: "private-token",
  };
  const payload = __stratopsRouteTestUtils.toPublicHistoryReport(req, report, { isLatest: true });
  assert.equal(payload.report_date, "2026-08-08");
  assert.equal(payload.is_latest, true);
  assert.equal(payload.html_url, "https://stratops.battlespacex.com/reports/daily/global/2026-08-08/report.html");
  assert.equal(payload.preview_url, "https://stratops.battlespacex.com/api/stratops/reports/report-2026-08-08/preview?token=private-token");
  assert.equal(payload.download_url, "https://stratops.battlespacex.com/api/stratops/reports/report-2026-08-08/download?token=private-token");
  assert.equal(payload.public_url, "https://stratops.battlespacex.com/reports/daily/global/2026-08-08/report.pdf");
  assert.equal(payload.status, "available");
  assert.equal(Object.hasOwn(payload, "report_key"), false);
  assert.equal(Object.hasOwn(payload, "download_token"), false);
});

test("legacy PDF-only publications are not advertised as HTML reports", () => {
  const report = { pdf_storage_key: "reports/daily/2026-08-08/global/legacy.pdf" };
  assert.equal(__stratopsRouteTestUtils.buildReportArtifactStorageKey(report, "report.html"), "");
});

test("history returns the latest seven actual publications without inventing missing dates", () => {
  const req = requestForOrigin();
  const dates = ["2026-08-09", "2026-08-08", "2026-08-06", "2026-08-05", "2026-08-04", "2026-08-03", "2026-08-02", "2026-08-01"];
  const reports = dates.map((date) => ({
    id: date,
    report_type: "daily",
    scope_type: "global",
    scope_label: "Global",
    period_start: `${date}T00:00:00.000Z`,
    period_end: `${date}T23:59:59.999Z`,
    status: "available",
    download_token: `token-${date}`,
    pdf_storage_key: `reports/daily/global/${date}/report.pdf`,
  }));
  const history = __stratopsRouteTestUtils.selectRecentPublishedReports(req, reports, 7);
  assert.equal(history.length, 7);
  assert.deepEqual(history.map((report) => report.report_date), dates.slice(0, 7));
  assert.equal(history.some((report) => report.report_date === "2026-08-07"), false);
  assert.equal(history[0].is_latest, true);
  assert.equal(history[1].is_latest, false);
});

test("public retention window is independent from the legacy 72-hour expiry", () => {
  assert.equal(
    __stratopsRouteTestUtils.getPublicReportHistoryCutoffIso(7, new Date("2026-08-09T18:00:00.000Z")),
    "2026-08-02T00:00:00.000Z"
  );
  const req = requestForOrigin();
  const retained = __stratopsRouteTestUtils.toPublicHistoryReport(req, {
    id: "six-day-old-report",
    report_type: "daily",
    scope_type: "global",
    scope_label: "Global",
    period_start: "2026-08-03T00:00:00.000Z",
    period_end: "2026-08-04T00:00:00.000Z",
    status: "expired",
    expires_at: "2026-08-06T00:00:00.000Z",
    download_token: "retained-token",
    pdf_storage_key: "reports/daily/global/2026-08-03/report.pdf",
  });
  assert.equal(retained.status, "available");
  assert.equal(retained.pdf_available, true);
  assert.equal(retained.html_available, true);
});

test("inline preview and attachment download use distinct frame-safe response headers", () => {
  const headers = new Map();
  const res = { set(name, value) { headers.set(String(name).toLowerCase(), value); } };
  const report = { period_start: "2026-08-08T00:00:00.000Z" };

  __stratopsRouteTestUtils.setReportPdfResponseHeaders(res, report, "inline");
  assert.equal(headers.get("content-type"), "application/pdf");
  assert.match(headers.get("content-disposition"), /^inline;/);
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(headers.get("content-security-policy"), "frame-ancestors 'self'");

  headers.clear();
  __stratopsRouteTestUtils.setReportPdfResponseHeaders(res, report, "attachment");
  assert.match(headers.get("content-disposition"), /^attachment;/);
  assert.equal(headers.has("x-frame-options"), false);
  assert.equal(headers.has("content-security-policy"), false);
});
