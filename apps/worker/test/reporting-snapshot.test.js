import test from "node:test";
import assert from "node:assert/strict";
import {
  SNAPSHOT_SCHEMA_VERSION,
  buildReportObjectKeys,
  buildReportingFoundation,
} from "../../shared/reporting-snapshot.js";
import {
  __reportingServiceTestUtils,
  getPreviousUtcDateKey,
  normalizeScope,
} from "../../shared/reporting-service.js";

const WINDOW = {
  dateKey: "2026-08-08",
  windowStartIso: "2026-08-08T00:00:00.000Z",
  windowEndIso: "2026-08-09T00:00:00.000Z",
};

function quality(overrides = {}) {
  return {
    corroboration_state: "CONFIRMED",
    confidence: 92,
    raw_report_count: 3,
    independent_source_family_count: 2,
    independent_source_families: ["official-sa", "reuters"],
    official_confirmation: true,
    direct_evidence: true,
    disputed: false,
    event_fingerprint: "incident-airport-1",
    source_provenance: [
      {
        source_name: "Saudi Press Agency",
        source_class: "OFFICIAL",
        source_tier: "TIER_1",
        source_family: "official-sa",
        source_reliability: 94,
        official_confirmation: true,
        direct_evidence: false,
        url: "https://example.test/official-airport",
      },
      {
        source_name: "Reuters",
        source_class: "MAJOR_MEDIA",
        source_tier: "TIER_1",
        source_family: "reuters",
        source_reliability: 92,
        official_confirmation: false,
        direct_evidence: true,
        url: "https://example.test/reuters-airport",
      },
    ],
    ...overrides,
  };
}

function fixtures() {
  const events = [
    {
      id: "event-airport",
      title: "Missile strike reported at King Khalid International Airport",
      summary: "The incident was confirmed by official and independent reporting.",
      occurred_at: "2026-08-08T05:30:00.000Z",
      category: "strike",
      severity: "critical",
      confidence: 92,
      source_name: "Reuters",
      source_url: "https://example.test/reuters-airport",
      lat: 24.9576,
      lon: 46.6988,
      metadata: {
        event_location: {
          country: "Saudi Arabia",
          region: "Middle East",
          city: "Riyadh",
          place: "King Khalid International Airport",
          latitude: 24.9576,
          longitude: 46.6988,
          precision: "EXACT",
          confidence: 99,
          method: "named_facility",
        },
        event_quality: quality(),
      },
    },
    {
      id: "event-odesa",
      title: "Artillery activity reported near Odesa",
      summary: "Local military activity continued through the reporting window.",
      occurred_at: "2026-08-08T20:00:00.000Z",
      category: "ground_activity",
      severity: "medium",
      confidence: 64,
      source_name: "Regional Monitor",
      source_url: "https://example.test/odesa",
      lat: 46.4825,
      lon: 30.7233,
      metadata: {
        event_location: {
          country: "Ukraine",
          region: "Ukraine",
          city: "Odesa",
          place: "Odesa area",
          latitude: 46.4825,
          longitude: 30.7233,
          precision: "LOCAL",
          confidence: 78,
          method: "near_city",
        },
        event_quality: quality({
          corroboration_state: "REPORTED",
          confidence: 64,
          raw_report_count: 1,
          independent_source_family_count: 1,
          independent_source_families: ["regional-monitor"],
          official_confirmation: false,
          direct_evidence: false,
          event_fingerprint: "incident-odesa-1",
          source_provenance: [],
        }),
      },
    },
  ];
  const intelligence = [
    {
      id: "intel-south-lebanon",
      title: "Military activity reported across southern Lebanon",
      summary: "Broad regional reporting without a precise incident point.",
      published_at: "2026-08-08T09:00:00.000Z",
      category: "military",
      source_name: "Telegram Regional Channel",
      url: "https://example.test/south-lebanon",
      raw: {
        _event_location: {
          country: "Lebanon",
          region: "Middle East",
          place: "Southern Lebanon",
          regional_anchor_latitude: 33.25,
          regional_anchor_longitude: 35.35,
          precision: "REGIONAL",
          confidence: 62,
          method: "broad_region_phrase",
        },
        _event_quality: quality({
          corroboration_state: "UNVERIFIED",
          confidence: 42,
          raw_report_count: 1,
          independent_source_family_count: 1,
          independent_source_families: ["telegram-regional-channel"],
          official_confirmation: false,
          direct_evidence: false,
          event_fingerprint: "regional-lebanon-1",
          source_provenance: [],
        }),
      },
    },
    {
      id: "intel-unknown",
      title: "Security posture reportedly changed overnight",
      summary: "Relevant intelligence without reliable incident geography.",
      published_at: "2026-08-08T11:00:00.000Z",
      category: "alert",
      source_name: "Defense Monitor",
      url: "https://example.test/unknown-location",
      raw: {
        _event_location: { precision: "UNKNOWN", confidence: 0, method: "not_found" },
        _event_quality: quality({
          corroboration_state: "REPORTED",
          confidence: 55,
          raw_report_count: 1,
          independent_source_family_count: 1,
          independent_source_families: ["defense-monitor"],
          official_confirmation: false,
          direct_evidence: false,
          event_fingerprint: "unknown-location-1",
          source_provenance: [],
        }),
      },
    },
    {
      id: "intel-duplicate",
      title: "Republished airport incident",
      published_at: "2026-08-08T06:00:00.000Z",
      category: "strike",
      source_name: "Reuters",
      url: "https://example.test/reuters-airport",
      raw: { _event_quality: quality() },
    },
  ];
  return { events, intelligence };
}

test("daily reporting range is the prior complete UTC day", () => {
  const dateKey = getPreviousUtcDateKey(new Date("2026-08-09T00:01:00.000Z"));
  const range = __reportingServiceTestUtils.getDayRange(dateKey);
  assert.equal(dateKey, "2026-08-08");
  assert.deepEqual(range, {
    startIso: "2026-08-08T00:00:00.000Z",
    endIso: "2026-08-09T00:00:00.000Z",
  });
});

test("snapshot foundation combines map events and broader intelligence without duplicating promoted reports", () => {
  const { events, intelligence } = fixtures();
  const foundation = buildReportingFoundation({
    ...WINDOW,
    scope: normalizeScope({ type: "global" }),
    scopeKey: "global",
    events,
    intelligence,
    counts: { aircraft_total: 8, naval_total: 3, alerts_total: 2, satellite_total: 1 },
  });

  assert.equal(foundation.snapshotData.snapshot_schema_version, SNAPSHOT_SCHEMA_VERSION);
  assert.equal(foundation.snapshotData.overall_activity.operational_event_total, 2);
  assert.equal(foundation.snapshotData.overall_activity.broader_intelligence_total, 2);
  assert.equal(foundation.items.length, 4);
  assert.deepEqual(foundation.manifest.event_ids.sort(), ["event-airport", "event-odesa"]);
  assert.deepEqual(foundation.manifest.intelligence_ids.sort(), ["intel-south-lebanon", "intel-unknown"]);
  assert.ok(foundation.manifest.cluster_ids.length >= 2);
  assert.equal(foundation.snapshotData.aggregates.by_domain.missile, 1);
  assert.equal(foundation.snapshotData.aggregates.by_domain.artillery, 1);
  const middleEast = foundation.snapshotData.aggregates.by_theater.find((theater) => theater.theater_name === "Middle East");
  assert.ok(middleEast);
  assert.ok(middleEast.major_clusters.length >= 1);
});

test("report selections preserve location semantics, source quality, provenance and deterministic relevance", () => {
  const { events, intelligence } = fixtures();
  const foundation = buildReportingFoundation({
    ...WINDOW,
    scope: normalizeScope({ type: "global" }),
    scopeKey: "global",
    events,
    intelligence,
    counts: {},
  });
  const exact = foundation.items.find((item) => item.event_id === "event-airport");
  const local = foundation.items.find((item) => item.event_id === "event-odesa");
  const regional = foundation.items.find((item) => item.intelligence_id === "intel-south-lebanon");
  const unknown = foundation.items.find((item) => item.intelligence_id === "intel-unknown");

  assert.equal(exact.location_precision, "EXACT");
  assert.equal(exact.event_place, "King Khalid International Airport");
  assert.equal(exact.latitude, 24.9576);
  assert.equal(exact.raw_report_count, 3);
  assert.equal(exact.independent_source_family_count, 2);
  assert.equal(exact.official_confirmation, true);
  assert.equal(exact.source_provenance.length, 2);
  assert.equal(local.location_precision, "LOCAL");
  assert.equal(regional.location_precision, "REGIONAL");
  assert.equal(regional.latitude, null);
  assert.deepEqual(regional.regional_anchor, { latitude: 33.25, longitude: 35.35 });
  assert.equal(regional.verification_state, "UNVERIFIED");
  assert.equal(unknown.location_precision, "UNKNOWN");
  assert.equal(unknown.latitude, null);
  assert.equal(foundation.snapshotData.selections.major_developments[0].event_id, "event-airport");
});

test("historical snapshot payload is independent of the seven-day raw-event retention window", () => {
  const { events, intelligence } = fixtures();
  const payload = __reportingServiceTestUtils.buildSnapshotPayload({
    dateKey: WINDOW.dateKey,
    scope: normalizeScope({ type: "global" }),
    events,
    intelligence,
    counts: { aircraft_total: 0, naval_total: 0, alerts_total: 0, satellite_total: 0 },
    config: { s3Prefix: "reports" },
  });
  assert.equal(payload.snapshot_key, "daily:2026-08-08:global:v1");
  assert.equal(payload.snapshot_version, 1);
  assert.equal(payload.window_start, WINDOW.windowStartIso);
  assert.equal(payload.window_end, WINDOW.windowEndIso);
  assert.equal(payload.report_item_total, 4);
  assert.equal(payload.snapshot_data.cluster_summaries[0].center_method, "weighted_medoid");
  assert.equal(Object.hasOwn(payload, "expires_at"), false);
});

test("snapshot persistence is idempotent for date, scope and schema version", async () => {
  const rows = new Map();
  let nextId = 1;
  const supabase = {
    from(table) {
      assert.equal(table, "operational_report_snapshots");
      return {
        upsert(payload, options) {
          assert.equal(options.onConflict, "snapshot_key");
          const existing = rows.get(payload.snapshot_key);
          const stored = { ...existing, ...payload, snapshot_id: existing?.snapshot_id || `snapshot-${nextId++}` };
          rows.set(payload.snapshot_key, stored);
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: stored, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const first = await __reportingServiceTestUtils.upsertSnapshot(supabase, {
    snapshot_key: "daily:2026-08-08:global:v1",
    generated_at: "2026-08-09T00:12:00.000Z",
  });
  const second = await __reportingServiceTestUtils.upsertSnapshot(supabase, {
    snapshot_key: "daily:2026-08-08:global:v1",
    generated_at: "2026-08-09T00:13:00.000Z",
  });
  assert.equal(rows.size, 1);
  assert.equal(first.snapshot_id, second.snapshot_id);
  assert.equal(second.generated_at, "2026-08-09T00:13:00.000Z");
});

test("future S3 keys follow the report instance path contract without generated images in shared assets", () => {
  assert.deepEqual(buildReportObjectKeys({
    prefix: "reports",
    dateKey: "2026-08-08",
    scope: { type: "global", label: "Global" },
  }), {
    base: "reports/daily/global/2026-08-08",
    report_json: "reports/daily/global/2026-08-08/report.json",
    manifest_json: "reports/daily/global/2026-08-08/manifest.json",
    report_html: "reports/daily/global/2026-08-08/report.html",
    report_pdf: "reports/daily/global/2026-08-08/report.pdf",
    images_prefix: "reports/daily/global/2026-08-08/images/",
  });
});
