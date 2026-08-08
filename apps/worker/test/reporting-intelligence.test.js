import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMajorDevelopments,
  buildPreviousDayComparison,
  buildReportContent,
  qualifyHighValueAsset,
  selectHighValueAssetsForReport,
} from "../../shared/reporting-intelligence.js";
import { buildReportingFoundation } from "../../shared/reporting-snapshot.js";
import { __reportingServiceTestUtils, normalizeScope } from "../../shared/reporting-service.js";

const WINDOW = {
  dateKey: "2026-08-08",
  windowStartIso: "2026-08-08T00:00:00.000Z",
  windowEndIso: "2026-08-09T00:00:00.000Z",
};

function quality(family, overrides = {}) {
  return {
    corroboration_state: "CORROBORATED",
    confidence: 84,
    raw_report_count: 3,
    independent_source_family_count: 2,
    independent_source_families: [family, "official"],
    official_confirmation: true,
    direct_evidence: false,
    disputed: false,
    event_fingerprint: `${family}-fingerprint`,
    source_provenance: [
      { source_name: family, source_class: "MAJOR_MEDIA", source_tier: "TIER_1", source_family: family },
      { source_name: "Official", source_class: "OFFICIAL", source_tier: "TIER_1", source_family: "official" },
    ],
    ...overrides,
  };
}

function event(id, { title, category, severity = "high", lat, lon, theater, country, city, place, hour = 8, qualityOverrides = {} }) {
  return {
    id,
    title,
    summary: `${title}. Evidence remained under review during the reporting period.`,
    occurred_at: `2026-08-08T${String(hour).padStart(2, "0")}:00:00.000Z`,
    category,
    severity,
    confidence: 84,
    source_name: "Test Wire",
    source_url: `https://example.test/${id}`,
    lat,
    lon,
    metadata: {
      normalization: { operational_theatre: theater },
      event_location: {
        country,
        region: theater,
        city,
        place: place || city,
        latitude: lat,
        longitude: lon,
        precision: place ? "EXACT" : "LOCAL",
        confidence: 90,
        method: place ? "named_facility" : "named_city",
      },
      event_quality: quality(`family-${id}`, qualityOverrides),
    },
  };
}

function track(trackKey, { trackType = "aircraft", title, subcategory, lat, lon, metadata = {} }) {
  return {
    id: trackKey,
    track_key: trackKey,
    track_type: trackType,
    category: "military",
    subcategory,
    title,
    lat,
    lon,
    altitude_ft: trackType === "aircraft" ? 31000 : null,
    speed_kts: trackType === "aircraft" ? 410 : 18,
    heading_deg: 90,
    status: "active",
    occurred_at: "2026-08-08T06:00:00.000Z",
    updated_at: "2026-08-08T09:00:00.000Z",
    metadata,
  };
}

function globalFixture() {
  const events = [
    event("gulf-missile-1", { title: "Missile strike reported near Gulf port", category: "missile", severity: "critical", lat: 26.2, lon: 50.1, theater: "Iran / Gulf", country: "Bahrain", city: "Manama", place: "Gulf port", hour: 2 }),
    event("gulf-naval-1", { title: "Naval activity increased in Gulf corridor", category: "naval_activity", lat: 26.3, lon: 50.2, theater: "Iran / Gulf", country: "Bahrain", city: "Manama", hour: 4 }),
    event("gulf-airdef-1", { title: "Air defence activity reported near Gulf corridor", category: "air_defence", lat: 26.4, lon: 50.3, theater: "Iran / Gulf", country: "Bahrain", city: "Manama", hour: 5 }),
    event("ukraine-strike-1", { title: "Strike reported near Odesa infrastructure", category: "strike", severity: "critical", lat: 46.48, lon: 30.72, theater: "Ukraine / Russia", country: "Ukraine", city: "Odesa", place: "Odesa infrastructure", hour: 6 }),
    event("ukraine-missile-1", { title: "Missile activity reported near Odesa", category: "missile", lat: 46.55, lon: 30.8, theater: "Ukraine / Russia", country: "Ukraine", city: "Odesa", hour: 7 }),
    event("ukraine-airdef-1", { title: "Air defence engaged near Odesa", category: "air_defence", lat: 46.6, lon: 30.75, theater: "Ukraine / Russia", country: "Ukraine", city: "Odesa", hour: 8 }),
    event("taiwan-naval-1", { title: "Naval formation observed east of Taiwan", category: "naval_activity", lat: 24.8, lon: 122.1, theater: "Taiwan / South China Sea", country: "Taiwan", city: "Hualien", hour: 10 }),
    event("taiwan-air-1", { title: "Military aviation activity east of Taiwan", category: "air_activity", lat: 24.9, lon: 122.2, theater: "Taiwan / South China Sea", country: "Taiwan", city: "Hualien", hour: 11 }),
    event("taiwan-air-2", { title: "ISR aviation activity continued east of Taiwan", category: "air_activity", lat: 25.0, lon: 122.15, theater: "Taiwan / South China Sea", country: "Taiwan", city: "Hualien", hour: 12 }),
  ];
  const tracks = [
    track("adsb-awacs", { title: "E-3 Sentry AWACS", subcategory: "awacs", lat: 26.5, lon: 50.5, metadata: { callsign: "MAGIC01", type_code: "E3", model_name: "E-3 Sentry", role: "awacs", operator: "USAF" } }),
    track("adsb-tanker", { title: "KC-135 tanker", subcategory: "tanker", lat: 46.7, lon: 30.9, metadata: { callsign: "SHELL22", type_code: "KC135", model_name: "KC-135", role: "tanker", operator: "USAF", observation_count: 4 } }),
    track("ais-carrier", { trackType: "naval", title: "Aircraft Carrier CVN-76", subcategory: "carrier", lat: 25.1, lon: 122.3, metadata: { vessel_name: "USS Ronald Reagan", vessel_class: "carrier", ship_type: "Aircraft carrier" } }),
    track("adsb-fighter", { title: "F-16 fighter", subcategory: "fighter", lat: 26.4, lon: 50.4, metadata: { callsign: "VIPER1", type_code: "F16", role: "fighter" } }),
  ];
  return { events, tracks };
}

function foundationFixture({ previousSnapshot = null } = {}) {
  const { events, tracks } = globalFixture();
  return buildReportingFoundation({
    ...WINDOW,
    scope: normalizeScope({ type: "global" }),
    scopeKey: "global",
    events,
    intelligence: [],
    tracks,
    previousSnapshot,
    counts: { aircraft_total: 3, naval_total: 1, satellite_total: 1 },
    satellitePreview: { event_id: "gulf-missile-1" },
  });
}

test("major-development ranking rewards significance and suppresses duplicate incidents", () => {
  const base = {
    report_item_id: "event:one",
    event_id: "one",
    title: "Critical missile strike at port",
    domain: "MISSILE",
    event_place: "Port",
    occurred_at: "2026-08-08T05:00:00.000Z",
    severity: "critical",
    verification_state: "CONFIRMED",
    report_relevance_score: 100,
    raw_report_count: 4,
    independent_source_family_count: 3,
    independent_source_families: ["a", "b", "c"],
    event_fingerprint: "same-incident",
  };
  const selected = buildMajorDevelopments([
    base,
    { ...base, report_item_id: "event:duplicate", event_id: "duplicate", title: "Missile strike reported at the port", report_relevance_score: 98 },
    { ...base, report_item_id: "event:separate", event_id: "separate", title: "Air defence activity in another city", domain: "AIR_DEFENCE", event_place: "Other city", event_fingerprint: "other", report_relevance_score: 70 },
  ], [], []);
  assert.deepEqual(selected.map((item) => item.event_id), ["one", "separate"]);
  assert.ok(selected[0].reason_selected.includes("critical_severity"));
});

test("HVA classifier qualifies AWACS and carrier while rejecting routine contacts", () => {
  const { events, tracks } = globalFixture();
  const items = foundationFixture().items;
  const clusters = foundationFixture().clusters;
  const awacs = qualifyHighValueAsset(tracks[0], { items, clusters, scope: { type: "global" } });
  const carrier = qualifyHighValueAsset(tracks[2], { items, clusters, scope: { type: "global" } });
  const fighter = qualifyHighValueAsset(tracks[3], { items, clusters, scope: { type: "global" } });
  assert.equal(awacs.qualified, true);
  assert.equal(awacs.asset.role, "AIRBORNE_EARLY_WARNING");
  assert.equal(carrier.qualified, true);
  assert.equal(carrier.asset.role, "AIRCRAFT_CARRIER");
  assert.equal(fighter.qualified, false);
  assert.equal(fighter.reason, "routine_or_unsupported_asset");
  assert.ok(events.length > 0);
});

test("tanker qualification requires operational proximity plus repeated or sustained observation", () => {
  const foundation = foundationFixture();
  const relevant = globalFixture().tracks[1];
  const farRoutine = track("adsb-far-tanker", { title: "KC-135 tanker", subcategory: "tanker", lat: -30, lon: -30, metadata: { type_code: "KC135", role: "tanker" } });
  assert.equal(qualifyHighValueAsset(relevant, { items: foundation.items, clusters: foundation.clusters, scope: { type: "global" } }).qualified, true);
  assert.equal(qualifyHighValueAsset(farRoutine, { items: foundation.items, clusters: foundation.clusters, scope: { type: "global" } }).qualified, false);
});

test("report content selects multiple HVA and prepares per-asset and daily capture targets", () => {
  const foundation = foundationFixture();
  const content = foundation.snapshotData.report_content;
  assert.equal(content.high_value_assets.all_qualified.length, 3);
  assert.equal(content.high_value_assets.selected_for_report.length, 3);
  assert.ok(content.high_value_assets.primary);
  assert.equal(content.high_value_assets.secondary.length, 2);
  assert.equal(content.high_value_assets.capture_requirements.length, 6);
  assert.ok(content.operational_imagery_targets.length >= 4);
  assert.ok(content.operational_imagery_targets.length <= 8);
  assert.ok(content.operational_imagery_targets.some((target) => target.type === "ORBITAL_CONTEXT"));
  assert.deepEqual(foundation.manifest.selected_hva.sort(), ["adsb-awacs", "adsb-tanker", "ais-carrier"].sort());
  assert.equal(foundation.manifest.selected_capture_targets.length, content.operational_imagery_targets.length);
});

test("HVA report selection suppresses invalid telemetry and same-role catalog repetition", () => {
  const assets = Array.from({ length: 6 }, (_, index) => ({
    asset_id: `awacs-${index + 1}`,
    track_type: "aircraft",
    role: "AIRBORNE_EARLY_WARNING",
    altitude_ft: 31000,
    speed_kts: index === 5 ? 0 : 360,
    last_observed: `2026-08-08T${String(23 - index).padStart(2, "0")}:00:00.000Z`,
    confidence: 94,
    priority_score: 96,
    nearby_event_ids: index < 2 ? [`event-${index + 1}`] : [],
    nearby_cluster_ids: index < 2 ? [`cluster-${index + 1}`] : [],
    theater: index < 3 ? "Middle East" : null,
  }));
  const result = selectHighValueAssetsForReport(assets, { windowEndIso: "2026-08-09T00:00:00.000Z" });
  assert.deepEqual(result.selected.map((asset) => asset.asset_id), ["awacs-1", "awacs-2"]);
  assert.equal(result.excluded.find((entry) => entry.asset_id === "awacs-6").reason, "inconsistent_airborne_speed");
  assert.ok(result.excluded.some((entry) => entry.reason === "same_role_redundancy"));
});

test("sustained HVA without linked regional activity requests only a meaningful focus capture", () => {
  const sustainedAwacs = track("adsb-sustained-awacs", {
    title: "E-3 Sentry AWACS",
    subcategory: "awacs",
    lat: 27.3,
    lon: 46.2,
    metadata: {
      callsign: "MAGIC02",
      type_code: "E3",
      model_name: "E-3 Sentry",
      role: "awacs",
      operator: "USAF",
      first_observed: "2026-08-08T04:00:00.000Z",
      last_observed: "2026-08-08T09:00:00.000Z",
    },
  });
  const foundation = buildReportingFoundation({
    ...WINDOW,
    scope: normalizeScope({ type: "global" }),
    scopeKey: "global",
    events: [],
    intelligence: [],
    tracks: [sustainedAwacs],
    counts: { aircraft_total: 1, naval_total: 0, satellite_total: 0 },
  });
  const hva = foundation.snapshotData.report_content.high_value_assets;
  assert.deepEqual(hva.selected_for_report.map((asset) => asset.asset_id), ["adsb-sustained-awacs"]);
  assert.deepEqual(hva.capture_requirements.map((capture) => capture.type), ["HVA_FOCUS_3D"]);
});

test("weak single-item theaters remain in snapshot data but are omitted from report theater cards", () => {
  const item = {
    report_item_id: "event:weak",
    event_id: "weak",
    record_type: "operational_event",
    report_display_eligible: true,
    display_title: "Routine activity update",
    title: "Routine activity update",
    domain: "AIR",
    category: "air_activity",
    severity: "low",
    verification_state: "REPORTED",
    report_relevance_score: 20,
    theater_id: "weak-theater",
    theater_name: "Weak Theater",
    raw_report_count: 1,
    independent_source_family_count: 1,
    independent_source_families: ["source-a"],
    occurred_at: "2026-08-08T12:00:00.000Z",
  };
  const snapshotData = {
    window: { end: "2026-08-09T00:00:00.000Z" },
    overall_activity: { total_report_items: 1, operational_event_total: 1 },
    aggregates: { by_severity: { low: 1 }, by_verification_state: { reported: 1 }, by_domain: { air: 1 }, by_theater: [] },
    source_consensus: { independent_source_family_count: 1 },
    cluster_summaries: [],
  };
  const content = buildReportContent({
    snapshotData,
    items: [item],
    clusters: [],
    tracks: [],
    theaters: [{
      theater_id: "weak-theater",
      theater_name: "Weak Theater",
      event_count: 1,
      critical_count: 0,
      high_count: 0,
      corroborated_count: 0,
      dominant_domains: [{ domain: "AIR", count: 1 }],
      major_clusters: [],
      source_family_count: 1,
      latest_activity: item.occurred_at,
      activity_change: { direction: "not established" },
    }],
    scope: { type: "global" },
  });
  assert.equal(content.theater_sections.length, 0);
  assert.equal(content.major_developments.length, 1, "underlying selected development remains available");
});

test("Key Judgments and Watch Indicators retain auditable evidence references", () => {
  const content = foundationFixture().snapshotData.report_content;
  assert.ok(content.key_judgments.length > 0);
  assert.ok(content.key_judgments.some((judgment) => judgment.supporting_event_ids.length >= 2 || judgment.supporting_cluster_ids.length > 0));
  assert.ok(content.watch_indicators.length > 0);
  content.watch_indicators.forEach((indicator) => {
    assert.equal(indicator.watch_window, "24-72H");
    assert.ok(indicator.trigger_event_ids.length || indicator.trigger_cluster_ids.length || indicator.trigger_asset_ids?.length);
  });
});

test("theater assessments derive different priorities for Gulf, Ukraine and Taiwan activity", () => {
  const sections = foundationFixture().snapshotData.report_content.theater_sections;
  const gulf = sections.find((section) => section.theater === "Iran / Gulf");
  const ukraine = sections.find((section) => section.theater === "Ukraine / Russia");
  const taiwan = sections.find((section) => section.theater === "Taiwan / South China Sea");
  assert.ok(gulf && ukraine && taiwan);
  assert.ok(gulf.key_operational_themes.some((theme) => theme.theme === "MISSILE"));
  assert.ok(ukraine.key_operational_themes.some((theme) => ["STRIKE", "MISSILE", "AIR_DEFENCE"].includes(theme.theme)));
  assert.ok(taiwan.key_operational_themes.some((theme) => ["AIR", "MARITIME"].includes(theme.theme)));
  assert.notDeepEqual(gulf.dominant_domains, taiwan.dominant_domains);
});

test("source consensus, cross-domain correlations and outlook remain evidence-backed", () => {
  const content = foundationFixture().snapshotData.report_content;
  const consensus = content.source_consensus.development_matrix[0];
  assert.ok(consensus.raw_reports >= 1);
  assert.ok(consensus.independent_families >= 1);
  assert.ok(Object.keys(consensus.source_mix).length >= 1);
  assert.ok(content.cross_domain_assessment.length > 0);
  assert.match(content.cross_domain_assessment[0].assessment_note, /no causal relationship/i);
  assert.ok(content.cross_domain_assessment[0].supporting_event_ids.length >= 2);
  assert.ok(content.outlook.length > 0);
  assert.ok(content.outlook.every((item) => item.supporting_indicator_ids.length || item.supporting_cluster_ids.length));
});

test("previous-day comparison calculates deltas and degrades safely without history", () => {
  assert.deepEqual(buildPreviousDayComparison({}, null), { available: false, reason: "previous_snapshot_unavailable" });
  const current = foundationFixture().snapshotData;
  const previous = {
    report_date: "2026-08-07",
    overall_activity: { total_report_items: 4, operational_event_total: 4, high_value_asset_candidate_total: 1 },
    aggregates: { by_domain: { missile: 1 }, by_severity: { high: 1, critical: 0 }, by_theater: [{ theater_id: "iran-gulf", event_count: 2 }] },
    cluster_summaries: [{ activity_score: 2 }],
    source_consensus: { independent_source_family_count: 2 },
  };
  const comparison = buildPreviousDayComparison(current, previous);
  assert.equal(comparison.available, true);
  assert.equal(comparison.operational_event_change, 5);
  assert.ok(comparison.high_critical_change > 0);
  assert.equal(comparison.qualified_hva_change, 2);
  assert.equal(comparison.previous_report_date, "2026-08-07");
});

test("track selection preserves latest-row telemetry across the scheduled UTC snapshot boundary", async () => {
  const upperBounds = {};
  const rowsByTable = {
    tracks: [{
      id: "track-1",
      track_key: "adsb-track-1",
      track_type: "aircraft",
      metadata: { type_code: "E3" },
    }],
    aircraft_tracks_log: [{
      track_key: "adsb-track-1",
      first_seen_at: "2026-08-08T06:00:00.000Z",
      last_seen_at: "2026-08-08T09:00:00.000Z",
    }],
    naval_tracks_log: [],
  };
  const rows = await __reportingServiceTestUtils.fetchTracksForDay({
    from(table) {
      return {
        select() { return this; },
        gte() { return this; },
        lt(column, value) { upperBounds[`${table}:${column}`] = value; return this; },
        order() { return this; },
        async range() { return { data: rowsByTable[table] || [], error: null }; },
      };
    },
  }, WINDOW.dateKey);
  assert.equal(upperBounds["tracks:updated_at"], "2026-08-09T00:15:00.000Z");
  assert.equal(upperBounds["aircraft_tracks_log:last_seen_at"], "2026-08-09T00:15:00.000Z");
  assert.equal(rows[0].metadata.first_observed, "2026-08-08T06:00:00.000Z");
  assert.equal(rows[0].metadata.last_observed, "2026-08-08T09:00:00.000Z");
});
