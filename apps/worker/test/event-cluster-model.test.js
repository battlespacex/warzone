import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpatialEventClusters,
  calculateEventActivityScore,
  determineDominantDomain,
  scoreToRadius,
} from "../../../dev/assets/js/warzone-event-cluster-model.js";

const NOW = Date.parse("2026-08-08T12:00:00.000Z");

function event(id, lat, lon, overrides = {}) {
  return {
    id,
    title: "Operational incident",
    category: "strike",
    severity: "medium",
    confidence: 70,
    occurred_at: "2026-08-08T10:00:00.000Z",
    location_precision: "LOCAL",
    map_eligible: true,
    corroboration_state: "REPORTED",
    independent_source_family_count: 1,
    lat,
    lon,
    ...overrides,
  };
}

test("cluster center is an underlying incident coordinate and inputs are not mutated", () => {
  const incidents = [
    event("a", 24.7136, 46.6753),
    event("b", 24.9576, 46.6988, { severity: "critical" }),
    event("c", 26.4207, 50.0888),
  ];
  const snapshot = structuredClone(incidents);
  const [cluster] = buildSpatialEventClusters(incidents, { nowMs: NOW, distanceKm: 450, zoomBucket: "theater" });

  assert.equal(cluster.actual_event_count, 3);
  assert.ok(incidents.some((item) => item.lat === cluster.lat && item.lon === cluster.lon));
  assert.deepEqual(incidents, snapshot);
});

test("an exact facility remains at its accepted coordinates when rendered individually", () => {
  const airport = event("kkia", 24.9576, 46.6988, {
    title: "Attack reported at King Khalid International Airport",
    location_precision: "EXACT",
  });
  const [result] = buildSpatialEventClusters([airport], { nowMs: NOW, distanceKm: 0.5, zoomBucket: "street" });

  assert.equal(result.lat, airport.lat);
  assert.equal(result.lon, airport.lon);
  assert.equal(result.location_precision, "EXACT");
  assert.equal(result.actual_event_count, 1);
});

test("recent corroborated critical incidents outweigh numerous old weak reports", () => {
  const recent = Array.from({ length: 8 }, (_, index) => event(`recent-${index}`, 32 + index * 0.01, 35, {
    severity: "critical",
    confidence: 92,
    corroboration_state: "CORROBORATED",
    source_tier: "TIER_1",
    independent_source_family_count: 3,
    occurred_at: "2026-08-08T11:45:00.000Z",
  }));
  const old = Array.from({ length: 20 }, (_, index) => event(`old-${index}`, 32 + index * 0.01, 35, {
    severity: "low",
    confidence: 30,
    corroboration_state: "UNVERIFIED",
    source_tier: "TIER_3",
    occurred_at: "2026-08-02T12:00:00.000Z",
  }));
  const recentScore = recent.reduce((sum, item) => sum + calculateEventActivityScore(item, { nowMs: NOW }), 0);
  const oldScore = old.reduce((sum, item) => sum + calculateEventActivityScore(item, { nowMs: NOW }), 0);

  assert.ok(recentScore > oldScore);
  assert.ok(scoreToRadius(recentScore) > scoreToRadius(oldScore));
});

test("cluster counts unique incidents, not raw article/report volume", () => {
  const incidents = Array.from({ length: 5 }, (_, index) => event(`incident-${index}`, 33.9 + index * 0.01, 35.5, {
    raw_report_count: 4,
  }));
  const [cluster] = buildSpatialEventClusters(incidents, { nowMs: NOW, distanceKm: 30 });

  assert.equal(cluster.actual_event_count, 5);
  assert.equal(cluster.cluster_count, 5);
});

test("dominant domain and MIXED threshold are based on weighted composition", () => {
  const airDominant = [
    ...Array.from({ length: 10 }, (_, index) => event(`air-${index}`, 31, 35, { category: "air_activity", title: "Air activity reported" })),
    ...Array.from({ length: 3 }, (_, index) => event(`missile-${index}`, 31, 35, { category: "strike", title: "Missile launch reported" })),
    ...Array.from({ length: 2 }, (_, index) => event(`cyber-${index}`, 31, 35, { category: "cyber", title: "Cyber incident reported" })),
  ];
  const evenMix = [
    event("mix-air", 31, 35, { category: "air_activity", title: "Air activity reported" }),
    event("mix-missile", 31, 35, { category: "strike", title: "Missile launch reported" }),
    event("mix-cyber", 31, 35, { category: "cyber", title: "Cyber incident reported" }),
  ];

  assert.equal(determineDominantDomain(airDominant, { nowMs: NOW }).domain, "AIR");
  assert.equal(determineDominantDomain(evenMix, { nowMs: NOW }).domain, "MIXED");
});

test("domain color input and severity remain separate cluster properties", () => {
  const incidents = [
    event("air-critical", 31, 35, {
      category: "air_activity",
      title: "Fighter air activity reported",
      severity: "critical",
    }),
    event("air-high", 31.01, 35.01, {
      category: "air_activity",
      title: "Military aircraft activity reported",
      severity: "high",
    }),
  ];
  const [cluster] = buildSpatialEventClusters(incidents, { nowMs: NOW, distanceKm: 30 });

  assert.equal(cluster.dominant_domain, "AIR");
  assert.equal(cluster.severity, "critical");
});

test("pulse policy is selective and globally capped", () => {
  const recent = Array.from({ length: 20 }, (_, index) => event(`pulse-${index}`, 20 + index, 20, {
    severity: "critical",
    occurred_at: "2026-08-08T11:50:00.000Z",
  }));
  const oldRoutine = event("routine", -20, -20, {
    severity: "low",
    occurred_at: "2026-08-06T12:00:00.000Z",
  });
  const clusters = buildSpatialEventClusters([...recent, oldRoutine], {
    nowMs: NOW,
    distanceKm: 0,
    pulseCap: 12,
  });

  assert.equal(clusters.filter((cluster) => cluster.pulse_eligible).length, 12);
  assert.equal(clusters.find((cluster) => cluster.id === "routine").pulse_mode, "none");
  assert.equal(clusters.find((cluster) => cluster.id === "routine").pulse_eligible, false);
});

test("zoom distance merges and splits the same immutable event coordinates", () => {
  const incidents = [
    event("riyadh", 24.7136, 46.6753),
    event("dammam", 26.4207, 50.0888),
    event("doha", 25.2854, 51.5310),
  ];
  const far = buildSpatialEventClusters(incidents, { nowMs: NOW, distanceKm: 900, zoomBucket: "world" });
  const close = buildSpatialEventClusters(incidents, { nowMs: NOW, distanceKm: 85, zoomBucket: "local" });

  assert.equal(far.length, 1);
  assert.equal(close.length, 3);
  assert.deepEqual(close.map((cluster) => [cluster.lat, cluster.lon]).sort(), incidents.map((item) => [item.lat, item.lon]).sort());
});

test("regional, unknown and dedicated aircraft telemetry do not become point clusters", () => {
  const candidates = [
    event("regional", 33.2, 35.4, { location_precision: "REGIONAL" }),
    event("unknown", 35.6, 51.4, { location_precision: "UNKNOWN" }),
    event("aircraft", 32, 34, { location_precision: "EXACT", report_type: "flight_tracking" }),
    event("valid", 50.45, 30.52),
  ];
  const clusters = buildSpatialEventClusters(candidates, { nowMs: NOW, distanceKm: 1000 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].id, "valid");
});

test("global clustering keeps distant operational theatres independent", () => {
  const incidents = [
    event("ukraine", 50.4501, 30.5234),
    event("middle-east", 33.8938, 35.5018),
    event("taiwan", 25.0330, 121.5654),
  ];
  const clusters = buildSpatialEventClusters(incidents, { nowMs: NOW, distanceKm: 900, zoomBucket: "world" });

  assert.equal(clusters.length, 3);
  assert.deepEqual(new Set(clusters.flatMap((cluster) => cluster.event_ids)), new Set(["ukraine", "middle-east", "taiwan"]));
});

test("radius scoring is logarithmic and clamped", () => {
  assert.equal(scoreToRadius(0, { min: 48, max: 96, scoreAtMax: 80 }), 48);
  assert.equal(scoreToRadius(10000, { min: 48, max: 96, scoreAtMax: 80 }), 96);
  assert.ok(scoreToRadius(8, { min: 48, max: 96, scoreAtMax: 80 }) < scoreToRadius(40, { min: 48, max: 96, scoreAtMax: 80 }));
});
