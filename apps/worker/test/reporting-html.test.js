import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "fs/promises";
import {
  REPORT_HTML_RENDER_VERSION,
  buildReportRenderModel,
  formatReportingPeriod,
  renderReportHtml,
} from "../../shared/reporting-html.js";
import {
  __reportingRenderTestUtils,
  renderSnapshotReport,
} from "../src/reporting-render-service.js";

function buildSnapshot(overrides = {}) {
  const reportContent = {
    executive_summary: {
      activity_level: "ELEVATED",
      leading_theaters: [{ theater: "Middle East", event_count: 12 }],
      strongest_domains: [{ domain: "STRIKE", count: 7 }],
      notable_asset_ids: ["asset-1", "asset-2"],
      comparison_to_previous_day: { available: true, operational_event_change: 3 },
    },
    headline_stats: Array.from({ length: 6 }, (_, index) => ({
      id: `stat-${index + 1}`,
      label: `Metric ${index + 1}`,
      value: index + 1,
      supporting_text: `Evidence ${index + 1}`,
      state: index === 0 ? "ATTENTION" : "OBSERVED",
    })),
    theater_sections: [{
      theater_id: "middle-east",
      theater: "Middle East",
      activity_level: "HIGH",
      event_count: 12,
      critical_count: 2,
      high_count: 3,
      corroborated_count: 5,
      dominant_domains: [{ domain: "STRIKE", count: 7 }],
      major_development_ids: ["event:1"],
      major_cluster_ids: ["cluster-1"],
      qualified_hva_ids: ["asset-1"],
      latest_significant_activity: "2026-08-08T12:00:00Z",
      trend: { direction: "increasing" },
      key_operational_themes: [{ theme: "STRIKE", weight: 7 }],
    }],
    key_judgments: [{
      id: "judgment-1",
      judgment: "OBSERVED: Repeated activity remained concentrated.",
      confidence: "HIGH",
      theater: "Middle East",
      domain: "STRIKE",
      evidence_summary: "Five supported incidents.",
      reasoning_basis: "spatial_repetition",
    }],
    watch_indicators: [{
      id: "watch-1",
      indicator: "Continued strike activity",
      current_state: "Seven reports",
      theater: "Middle East",
      domain: "STRIKE",
      confidence: "MODERATE",
      why_it_matters: "Further corroboration would reinforce the pattern.",
      watch_window: "24-72H",
    }],
    major_developments: [{
      report_item_id: "event:1",
      event_id: "event-1",
      title: "Strike <script>alert(1)</script>",
      summary: "Reported near a strategic site & independently reviewed.",
      occurred_at: "2026-08-08T10:00:00Z",
      event_city: "Riyadh",
      event_country: "Saudi Arabia",
      latitude: 24.9576,
      longitude: 46.6988,
      location_precision: "EXACT",
      severity: "critical",
      confidence: 92,
      verification_state: "CORROBORATED",
      domain: "STRIKE",
      category: "strike",
      raw_report_count: 5,
      independent_source_family_count: 3,
      source_family_summary: ["Reuters", "Official"],
      official_confirmation: true,
      direct_evidence: false,
      disputed: false,
    }, {
      report_item_id: "event:2",
      event_id: "event-2",
      title: "Regional activity",
      summary: "Activity reported in southern Lebanon.",
      occurred_at: "2026-08-08T09:00:00Z",
      event_region: "Southern Lebanon",
      latitude: 33.2,
      longitude: 35.3,
      location_precision: "REGIONAL",
      severity: "medium",
      confidence: 60,
      verification_state: "REPORTED",
      domain: "AIR",
      raw_report_count: 1,
      independent_source_family_count: 1,
    }],
    high_value_assets: {
      all_qualified: ["asset-1", "asset-2"].map((assetId, index) => ({
        asset_id: assetId,
        track_type: index ? "naval" : "aircraft",
        callsign: index ? null : "N0RSE<02>",
        name: index ? "Carrier Group" : "E-3 Sentry",
        type: index ? "Carrier" : "E-3",
        role: index ? "AIRCRAFT_CARRIER" : "AIRBORNE_EARLY_WARNING",
        operator: "Test operator",
        country: "Test country",
        latitude: 25 + index,
        longitude: 50 + index,
        altitude_ft: index ? null : 31000,
        speed_kts: 410,
        heading_deg: 180,
        last_observed: "2026-08-08T11:00:00Z",
        status: "tracked",
        confidence: 88,
        theater: "Middle East",
        operational_significance: "Qualified strategic platform near selected activity.",
        qualification_reasons: ["role:strategic", "near_significant_activity"],
      })),
    },
    intelligence_wire_synthesis: { selected_intelligence_ids: ["intel-1"] },
    source_consensus: {
      development_matrix: [{
        development_id: "event:1",
        event_id: "event-1",
        raw_reports: 5,
        independent_families: 3,
        verification_state: "CORROBORATED",
        official_confirmation: true,
        direct_evidence: false,
        dispute_status: "NOT_DISPUTED",
        source_classes: ["MAJOR_WIRE", "OFFICIAL"],
      }],
    },
    cross_domain_assessment: [{
      id: "cross-1",
      related_domains: ["AIR_DEFENCE", "STRIKE"],
      temporal_relationship: "Co-occurring in the reporting window.",
      geographic_relationship: "Grouped in cluster 1.",
      confidence: "MODERATE",
      assessment_note: "No causal relationship is inferred.",
    }],
    outlook: [{
      id: "outlook-1",
      theater: "Middle East",
      domain: "STRIKE",
      assessment: "ASSESSED: Elevated activity may persist if reporting continues.",
      confidence: "MODERATE",
      time_horizon: "24-72H",
      conditions_to_watch: ["additional corroborated reports", "geographic expansion"],
    }],
    methodology_metrics: {
      report_item_total: 15,
      operational_event_total: 12,
      broader_intelligence_total: 3,
      independent_source_family_count: 6,
      qualified_hva_total: 2,
      location_precision_distribution: { EXACT: 1, REGIONAL: 1 },
      verification_distribution: { CORROBORATED: 1, REPORTED: 1 },
    },
  };
  const snapshot = {
    snapshot_key: "daily:2026-08-08:global:v1",
    snapshot_version: 1,
    snapshot_date: "2026-08-08",
    window_start: "2026-08-08T00:00:00Z",
    window_end: "2026-08-09T00:00:00Z",
    scope_type: "global",
    scope_key: "global",
    scope_label: "Global Activity",
    snapshot_data: {
      snapshot_key: "daily:2026-08-08:global:v1",
      snapshot_schema_version: 1,
      report_date: "2026-08-08",
      window: { start: "2026-08-08T00:00:00Z", end: "2026-08-09T00:00:00Z", timezone: "UTC" },
      scope: { type: "global", key: "global", label: "Global Activity" },
      overall_activity: { total_report_items: 15, operational_event_total: 12 },
      cluster_summaries: [{ cluster_id: "cluster-1" }],
      source_consensus: { raw_report_count: 20, independent_source_family_count: 6, official_confirmation_count: 1, direct_evidence_count: 0, disputed_count: 0 },
      aggregates: { by_verification_state: { CORROBORATED: 1, REPORTED: 1 }, by_source_class: { MAJOR_WIRE: 1 } },
      selections: {
        broader_intelligence: [{
          intelligence_id: "intel-1",
          source_name: "Defense Wire",
          source_class: "SPECIALIST_DEFENSE",
          title: "Air defence posture changes",
          summary: "Specialist reporting added technical context.",
          verification_state: "REPORTED",
        }],
      },
      report_content: reportContent,
    },
    report_manifest: {
      report_id: "daily:2026-08-08:global:v1",
      object_keys: {
        report_html: "reports/daily/global/2026-08-08/report.html",
        report_json: "reports/daily/global/2026-08-08/report.json",
        manifest_json: "reports/daily/global/2026-08-08/manifest.json",
      },
      cluster_ids: ["cluster-1"],
      capture_results: [{
        capture_id: "capture-overview",
        capture_type: "REGIONAL_OVERVIEW_3D",
        status: "READY",
        s3_key: "reports/daily/global/2026-08-08/images/overview.jpg",
        s3_url: "https://reports.example.test/images/overview.jpg",
        width: 1600,
        height: 900,
      }, {
        capture_id: "capture-development",
        capture_type: "MAJOR_DEVELOPMENT_CONTEXT",
        status: "READY",
        event_id: "event-1",
        s3_key: "reports/daily/global/2026-08-08/images/development.jpg",
        s3_url: "https://reports.example.test/images/development.jpg",
      }, {
        capture_id: "capture-hva-1",
        capture_type: "HVA_FOCUS_3D",
        status: "READY",
        asset_id: "asset-1",
        s3_key: "reports/daily/global/2026-08-08/images/hva-1.jpg",
        s3_url: "https://reports.example.test/images/hva-1.jpg",
      }, {
        capture_id: "capture-failed",
        capture_type: "ORBITAL_CONTEXT",
        status: "FAILED",
        s3_key: "reports/daily/global/2026-08-08/images/failed.jpg",
        failure_reason: "timeout",
      }],
    },
  };
  return {
    ...snapshot,
    ...overrides,
    snapshot_data: { ...snapshot.snapshot_data, ...(overrides.snapshot_data || {}) },
    report_manifest: { ...snapshot.report_manifest, ...(overrides.report_manifest || {}) },
  };
}

async function loadTemplate() {
  const [templateHtml, templateCss] = await Promise.all([
    readFile(__reportingRenderTestUtils.REPORT_TEMPLATE_PATH, "utf8"),
    readFile(__reportingRenderTestUtils.REPORT_CSS_PATH, "utf8"),
  ]);
  return { templateHtml, templateCss };
}

test("report template paths resolve to the exact master HTML and CSS", async () => {
  assert.match(__reportingRenderTestUtils.REPORT_TEMPLATE_PATH, /dev[\\/]reports[\\/]template[\\/]reports-template\.html$/);
  assert.match(__reportingRenderTestUtils.REPORT_CSS_PATH, /dev[\\/]reports[\\/]template[\\/]reports\.css$/);
  const { templateHtml, templateCss } = await loadTemplate();
  assert.match(templateHtml, /id="report-source"/);
  assert.match(templateCss, /--page-width:\s*215\.9mm/);
  assert.match(templateCss, /--page-height:\s*279\.4mm/);
});

test("render model maps all Phase 2 sections and applies coordinate and image rules", () => {
  const snapshot = buildSnapshot();
  const model = buildReportRenderModel(snapshot, { localImageNames: new Set(["overview.jpg", "hva-1.jpg"]) });
  assert.equal(model.period, "2026-08-08 TO 2026-08-09");
  assert.equal(model.headline_stats.length, 6);
  assert.equal(model.theaters[0].theater, "Middle East");
  assert.equal(model.key_judgments.length, 1);
  assert.equal(model.watch_indicators.length, 1);
  assert.equal(model.developments[0].verification_state, "CORROBORATED");
  assert.deepEqual(model.developments[0].coordinates, { latitude: 24.9576, longitude: 46.6988 });
  assert.equal(model.developments[1].coordinates, null, "regional records must not expose point coordinates");
  assert.equal(model.high_value_assets.length, 2);
  assert.equal(model.high_value_assets[0].image.src, "images/hva-1.jpg");
  assert.equal(model.high_value_assets[1].image, null);
  assert.equal(model.imagery.find((item) => item.capture_id === "capture-overview").src, "images/overview.jpg");
  assert.equal(model.imagery.find((item) => item.capture_id === "capture-development").src, "https://reports.example.test/images/development.jpg");
  assert.equal(model.imagery.some((item) => item.capture_id === "capture-failed"), false);
  assert.equal(model.intelligence_wire.length, 1);
  assert.equal(model.source_consensus.length, 1);
  assert.equal(model.cross_domain_assessment.length, 1);
  assert.equal(model.outlook.length, 1);
});

test("HTML uses shared static assets, relative generated images, safe escaping, and readiness hooks", async () => {
  const { templateHtml, templateCss } = await loadTemplate();
  const model = buildReportRenderModel(buildSnapshot(), { localImageNames: new Set(["overview.jpg", "hva-1.jpg"]) });
  const html = renderReportHtml({ templateHtml, templateCss, model });
  assert.match(html, /data-report-render-version="stratops-html-v1"/);
  assert.match(html, /\/assets\/images\/web\/logo-stratops-battlespacex\.svg/);
  assert.match(html, /\/assets\/fonts\/Blinker\/Blinker-Regular\.ttf/);
  assert.doesNotMatch(html, /\.\.\/\.\.\/assets\//);
  assert.match(html, /src="images\/overview\.jpg"/);
  assert.match(html, /2026-08-08 TO 2026-08-09/);
  assert.equal((html.match(/class="report-stat-card/g) || []).length, 6);
  assert.match(html, /Middle East/);
  assert.match(html, /KEY JUDGMENTS/);
  assert.match(html, /WATCH INDICATORS/);
  assert.match(html, /CORROBORATED/);
  assert.match(html, /AIR DEFENCE \+ STRIKE/);
  assert.match(html, /24-72 HOUR INTELLIGENCE OUTLOOK/);
  assert.match(html, /SOURCE METHODOLOGY/);
  assert.match(html, /Reported near a strategic site/);
  assert.doesNotMatch(html, /Strike &lt;script&gt;|alert\(1\)/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /failed\.jpg/);
  assert.match(html, /id="generated-pages"/);
  assert.match(html, /id="report-source"/);
  assert.match(html, /data-keep-with-next="true"/);
  assert.match(html, /<dt>Window<\/dt><dd>24-72H<\/dd>/);
  assert.doesNotMatch(html, /Precision:\s*UNKNOWN/);
  assert.match(html, /contentOverflows/);
  assert.match(html, /document\.fonts\?\.ready/);
  assert.match(html, /image\.addEventListener\("error"/);
  assert.match(html, /paginate\(\);/);
});

test("render model uses report-selected HVA and suppresses inconsistent telemetry", () => {
  const snapshot = buildSnapshot();
  const qualified = snapshot.snapshot_data.report_content.high_value_assets.all_qualified;
  snapshot.snapshot_data.report_content.high_value_assets.selected_for_report = [{
    ...qualified[0],
    speed_kts: 0,
    altitude_ft: 31000,
  }];
  const model = buildReportRenderModel(snapshot, { localImageNames: new Set(["hva-1.jpg"]) });
  assert.equal(model.high_value_assets.length, 1);
  assert.equal(model.high_value_assets[0].asset_id, "asset-1");
  assert.equal(model.high_value_assets[0].speed_kts, null);
  assert.match(model.high_value_assets[0].telemetry_note, /omitted/i);
});

test("source consensus reuses the exact cleaned development title and cards paginate independently", async () => {
  const snapshot = buildSnapshot();
  const model = buildReportRenderModel(snapshot, { localImageNames: new Set(["hva-1.jpg"]) });
  assert.equal(model.source_consensus[0].title, model.developments[0].title);
  const { templateHtml, templateCss } = await loadTemplate();
  const html = renderReportHtml({ templateHtml, templateCss, model });
  assert.equal((html.match(/pagination-card-unit--half report-hva-grid report-hva-grid--unit/g) || []).length, 2);
  assert.equal((html.match(/pagination-card-unit--half report-wire-list report-wire-list--unit/g) || []).length, 1);
  assert.match(html, /report-wire-list report-wire-list--unit[^>]*><article>[\s\S]*?<span class="corner-edge-1"><\/span><\/article><\/div>/);
  assert.equal((html.match(/pagination-card-unit--half report-theater-grid report-theater-grid--unit/g) || []).length, 1);
  assert.doesNotMatch(html, /class="[^"]*report-(?:hva-grid|wire-list|theater-grid)--single/);
  assert.match(html, /class="event-grid"/);
  assert.match(html, /pagination-card-unit--half/);
});

test("unassigned and broad fallback theaters are not promoted in executive output", () => {
  const snapshot = buildSnapshot();
  const content = snapshot.snapshot_data.report_content;
  content.executive_summary.leading_theaters = [
    { theater: "Unspecified", event_count: 200 },
    { theater: "Europe", event_count: 30 },
    { theater: "Ukraine", event_count: 12 },
  ];
  content.theater_sections.unshift({
    theater_id: "unspecified",
    theater: "Unspecified",
    activity_level: "HIGH",
    event_count: 200,
    dominant_domains: [{ domain: "MIXED", count: 200 }],
  });
  const model = buildReportRenderModel(snapshot);
  assert.doesNotMatch(model.executive_summary, /Unspecified|Europe/);
  assert.match(model.executive_summary, /Ukraine/);
  assert.equal(model.theaters.some((theater) => /unspecified/i.test(theater.theater)), false);
});

test("no-HVA and failed-image input renders accurate image-free fallbacks", async () => {
  const snapshot = buildSnapshot();
  snapshot.snapshot_data.report_content.high_value_assets = {
    selected_for_report: [],
    all_qualified: [{ asset_id: "qualified-only", name: "Qualified only" }],
  };
  snapshot.report_manifest.capture_results = snapshot.report_manifest.capture_results.filter((item) => item.status === "FAILED");
  const model = buildReportRenderModel(snapshot);
  const { templateHtml, templateCss } = await loadTemplate();
  const html = renderReportHtml({ templateHtml, templateCss, model });
  assert.equal(model.high_value_assets.length, 0);
  assert.equal(model.imagery.length, 0);
  assert.match(html, /No qualified high-value asset met/);
  assert.doesNotMatch(html, /<img[^>]+failed\.jpg/);
});

test("reporting period is based on supplied UTC boundaries", () => {
  assert.equal(formatReportingPeriod("2026-08-08T00:00:00Z", "2026-08-09T00:00:00Z"), "2026-08-08 TO 2026-08-09");
});

test("worker render writes idempotent HTML, report JSON, and the existing manifest format", async (t) => {
  const snapshot = buildSnapshot({
    snapshot_date: "2099-01-01",
    window_start: "2099-01-01T00:00:00Z",
    window_end: "2099-01-02T00:00:00Z",
    snapshot_key: "daily:2099-01-01:global:v1",
    snapshot_data: {
      ...buildSnapshot().snapshot_data,
      snapshot_key: "daily:2099-01-01:global:v1",
      report_date: "2099-01-01",
      window: { start: "2099-01-01T00:00:00Z", end: "2099-01-02T00:00:00Z", timezone: "UTC" },
    },
    report_manifest: {
      ...buildSnapshot().report_manifest,
      report_id: "daily:2099-01-01:global:v1",
      object_keys: {
        report_html: "reports/daily/global/2099-01-01/report.html",
        report_json: "reports/daily/global/2099-01-01/report.json",
        manifest_json: "reports/daily/global/2099-01-01/manifest.json",
      },
    },
  });
  const persisted = [];
  const supabase = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: snapshot, error: null }; },
      };
    },
  };
  const options = {
    supabase,
    snapshotKey: snapshot.snapshot_key,
    config: { aws: { bucket: "" } },
    upload: false,
    generatedAt: "2099-01-02T00:15:00Z",
    persistState: async (_client, key, manifest) => { persisted.push({ key, manifest }); },
  };
  const first = await renderSnapshotReport(options);
  t.after(() => rm(first.output_directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const firstHtml = await readFile(first.report_html, "utf8");
  const firstJson = JSON.parse(await readFile(first.report_json, "utf8"));
  const firstManifest = JSON.parse(await readFile(first.manifest_json, "utf8"));
  const second = await renderSnapshotReport(options);
  const secondHtml = await readFile(second.report_html, "utf8");
  assert.equal(first.output_directory, second.output_directory);
  assert.equal(firstHtml, secondHtml);
  assert.equal(firstJson.render_version, REPORT_HTML_RENDER_VERSION);
  assert.equal(firstJson.headline_stats.length, 6);
  assert.equal(firstManifest.report_id, snapshot.snapshot_key);
  assert.equal(firstManifest.snapshot_key, snapshot.snapshot_key);
  assert.equal(firstManifest.generation_status, "html_ready");
  assert.equal(firstManifest.report_html_path, "reports/daily/global/2099-01-01/report.html");
  assert.equal(firstManifest.capture_results.some((item) => Object.hasOwn(item, "local_path")), false);
  assert.equal(persisted.length, 2);
});
