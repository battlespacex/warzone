import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanTitle,
  isCoarseCountryCentroid,
  isValidCoordinate,
  normalizeConflictFeedItemForStorage,
  normalizeConflictItemToEventPayload,
  normalizeEventRowForStorage,
  normalizeSourceName,
  resolveEventLocation
} from "../src/intelligence-normalizer.js";
import { prepareStatusItemForDb } from "../src/status-supabase-writer.js";

test("does not use publisher country as event geography", () => {
  const item = {
    title: "Vessel attacked in the Red Sea after drone launch",
    summary: "Maritime incident reported by regional monitors.",
    source_name: "China Daily",
    source_country: "China",
    source_region: "Asia",
    url: "https://example.com/red-sea-attack",
    is_conflict_relevant: true
  };

  const normalized = normalizeConflictItemToEventPayload(item);

  assert.equal(normalized.map_eligible, false);
  assert.equal(normalized.event.location_label, "Red Sea");
  assert.equal(normalized.event.metadata.normalization.event_country, null);
  assert.equal(normalized.event.metadata.normalization.event_region, "Middle East");
  assert.equal(normalized.event.metadata.normalization.publisher_country, "China");
  assert.equal(normalized.event.metadata.normalization.location_precision, "REGIONAL");
  assert.equal(normalized.event.lat, null);
  assert.equal(normalized.event.lon, null);
});

test("actor nationality alone does not become event geography", () => {
  const location = resolveEventLocation({
    title: "Russia says Ukrainian drone attack caused blast",
    summary: "No city or coordinates were reported.",
    country: "United Kingdom",
    region: "Europe"
  });

  assert.equal(location.label, null);
  assert.equal(location.country, null);
  assert.equal(location.mapEligible, false);
  assert.equal(location.lat, null);
  assert.equal(location.lon, null);
  assert.equal(location.quality, "unknown");
  assert.equal(location.precision, "UNKNOWN");
});

test("city location beats country attribution and remains map eligible", () => {
  const normalized = normalizeConflictItemToEventPayload({
    title: "Russian drone strikes Chuhuiv community, administrative building damaged",
    summary: "Ukrainian officials reported damage in Kharkiv region.",
    source_name: "Ukraine Ukrinform",
    country: "Ukraine",
    url: "https://example.com/chuhuiv",
    is_conflict_relevant: true,
    confidence_score: 72
  });

  assert.equal(normalized.map_eligible, true);
  assert.equal(normalized.event.location_label, "Chuhuiv, Ukraine");
  assert.equal(normalized.event.category, "strike");
  assert.equal(normalized.event.severity, "medium");
  assert.equal(normalized.event.metadata.normalization.location_precision, "LOCAL");
});

test("foreign publisher geography remains separate from Riyadh incident geography", () => {
  const normalized = normalizeConflictItemToEventPayload({
    title: "Drone attack near Riyadh, Saudi Arabia.",
    summary: "The incident was reported overnight.",
    source_name: "Korea Daily",
    source_country: "South Korea",
    source_region: "East Asia",
    url: "https://example.com/riyadh",
    is_conflict_relevant: true
  });

  assert.equal(normalized.map_eligible, true);
  assert.equal(normalized.event.location_label, "Riyadh, Saudi Arabia");
  assert.equal(normalized.event.metadata.normalization.source_country, "South Korea");
  assert.equal(normalized.event.metadata.normalization.event_country, "Saudi Arabia");
  assert.equal(normalized.event.metadata.normalization.event_city, "Riyadh");
  assert.equal(normalized.event.metadata.normalization.location_precision, "LOCAL");
  assert.ok(normalized.event.lat > 24 && normalized.event.lat < 25);
  assert.ok(normalized.event.lon > 46 && normalized.event.lon < 47);
});

test("named airport resolves as an exact facility", () => {
  const normalized = normalizeConflictItemToEventPayload({
    title: "Attack reported at King Khalid International Airport.",
    summary: "Security forces responded to the incident.",
    url: "https://example.com/king-khalid",
    is_conflict_relevant: true
  });

  assert.equal(normalized.map_eligible, true);
  assert.equal(normalized.event.lat, 24.9576);
  assert.equal(normalized.event.lon, 46.6988);
  assert.equal(normalized.event.metadata.normalization.location_precision, "EXACT");
  assert.equal(normalized.event.metadata.normalization.event_place, "King Khalid International Airport");
  assert.equal(normalized.event.metadata.normalization.location_method, "text_facility");
});

test("city and near-city reports resolve as local with different confidence", () => {
  const isfahan = resolveEventLocation({ title: "Explosion reported in Isfahan." });
  const dammam = resolveEventLocation({ title: "Drone intercepted near Dammam." });

  assert.equal(isfahan.precision, "LOCAL");
  assert.equal(isfahan.city, "Isfahan");
  assert.equal(isfahan.mapEligible, true);
  assert.equal(dammam.precision, "LOCAL");
  assert.equal(dammam.city, "Dammam");
  assert.equal(dammam.method, "text_near_city");
  assert.ok(dammam.confidence < isfahan.confidence);
});

test("regional and unknown reports are retained without marker coordinates", () => {
  const regional = normalizeConflictItemToEventPayload({
    title: "Strikes reported in southern Lebanon.",
    summary: "Military activity continued overnight.",
    url: "https://example.com/south-lebanon",
    is_conflict_relevant: true
  });
  const unknown = normalizeConflictItemToEventPayload({
    title: "Drone attack reported by defence officials.",
    summary: "The report contains no usable incident location.",
    url: "https://example.com/unknown",
    is_conflict_relevant: true
  });

  assert.equal(regional.event.metadata.normalization.location_precision, "REGIONAL");
  assert.equal(regional.event.location_label, "Southern Lebanon");
  assert.equal(regional.event.lat, null);
  assert.equal(regional.event.lon, null);
  assert.equal(regional.event.metadata.event_location.regional_anchor_latitude, 33.25);
  assert.equal(unknown.event.metadata.normalization.location_precision, "UNKNOWN");
  assert.equal(unknown.event.lat, null);
  assert.equal(unknown.event.lon, null);
});

test("source coordinates are rejected when incident text identifies another country", () => {
  const location = resolveEventLocation({
    title: "Explosion reported in Isfahan, Iran.",
    lat: 37.5667,
    lon: 126.9783,
    source_country: "South Korea"
  });

  assert.equal(location.country, "Iran");
  assert.equal(location.city, "Isfahan");
  assert.equal(location.precision, "LOCAL");
  assert.ok(location.lon < 52);
});

test("foreign source countries never replace an Iran incident location", () => {
  for (const sourceCountry of ["United Kingdom", "United States", "South Korea", "Japan"]) {
    const location = resolveEventLocation({
      title: "Drone attack reported in Isfahan, Iran.",
      source_country: sourceCountry
    });
    assert.equal(location.country, "Iran");
    assert.equal(location.city, "Isfahan");
    assert.equal(location.precision, "LOCAL");
  }
});

test("explicit valid coordinates are accepted and invalid zero coordinates are rejected", () => {
  assert.equal(isValidCoordinate(49.99, 36.23), true);
  assert.equal(isValidCoordinate(0, 0), false);

  const exact = resolveEventLocation({
    title: "Explosion reported near depot",
    lat: "49.9900",
    lon: "36.2300",
    location_label: "Depot perimeter"
  });

  assert.equal(exact.mapEligible, true);
  assert.equal(exact.quality, "exact");
  assert.equal(exact.label, "Depot perimeter");
});

test("unsafe title and source fallbacks are removed before storage", () => {
  const item = normalizeConflictFeedItemForStorage({
    title: "Untitled",
    summary: "<p>&nbsp;Drone strike reported near Kharkiv</p>",
    source_name: "Unknown Source",
    url: "https://example.com/no-title",
    confidence_score: "65"
  });

  assert.equal(item.title, null);
  assert.equal(item.source_name, null);
  assert.equal(item.summary, "Drone strike reported near Kharkiv");
  assert.equal(item.confidence_score, 65);
  assert.equal(cleanTitle("Unknown location"), null);
  assert.equal(normalizeSourceName("Conflict feed"), "OSINT Feed");
});

test("similar same-hour operational items get stable canonical dedupe keys", () => {
  const first = normalizeConflictItemToEventPayload({
    title: "Drone strike hits Chernihiv supermarket",
    summary: "Casualties reported after a drone strike in Chernihiv.",
    source_name: "Regional Feed",
    url: "https://example.com/a",
    published_at: "2026-07-26T10:15:00Z",
    is_conflict_relevant: true
  });

  const second = normalizeConflictItemToEventPayload({
    title: "Drone strike hits Chernihiv supermarket",
    summary: "A separate outlet reports casualties in Chernihiv.",
    source_name: "Another Feed",
    url: "https://example.com/b",
    published_at: "2026-07-26T10:44:00Z",
    is_conflict_relevant: true
  });

  assert.equal(first.map_eligible, true);
  assert.equal(second.map_eligible, true);
  assert.equal(first.event.dedupe_key, second.event.dedupe_key);
});

test("generic worker event rows do not persist unsafe display fallbacks", () => {
  const row = normalizeEventRowForStorage({
    category: "strike",
    title: "Untitled event",
    summary: "Explosion reported near depot",
    source_name: "Unknown Source",
    location_label: "Unknown location",
    lat: "49.9900",
    lon: "36.2300",
    occurred_at: "2026-07-26T10:00:00Z",
    severity: "unknown"
  });

  assert.equal(row.title, "Strike update");
  assert.equal(row.source_name, null);
  assert.equal(row.location_label, null);
  assert.equal(row.severity, "medium");
  assert.equal(row.lat, 49.99);
  assert.equal(row.lon, 36.23);
});

test("generic worker event rows reject invalid zero coordinates before storage", () => {
  const row = normalizeEventRowForStorage({
    category: "military",
    title: "Military activity reported",
    summary: "Operational activity reported",
    lat: 0,
    lon: 0
  });

  assert.equal(row.lat, null);
  assert.equal(row.lon, null);
});

test("generic worker event rows reject broad country centroid coordinates", () => {
  assert.equal(isCoarseCountryCentroid(31.8, 35.0, "Israel"), true);

  const row = normalizeEventRowForStorage({
    category: "strike",
    title: "Senior Iranian source says Tehran will halt attacks as long as US holds fire",
    summary: "Diplomatic report mentioning Israel and Iran without a specific impact location.",
    location_label: null,
    lat: 31.8,
    lon: 35.0,
    severity: "critical"
  });

  assert.equal(row.lat, null);
  assert.equal(row.lon, null);
});

test("status feed rows do not persist unknown source or untitled fallback", () => {
  const row = prepareStatusItemForDb({
    title: "Untitled",
    summary: "<p>Airspace restriction notice issued</p>",
    source_name: "Unknown Source",
    guid: "status-1",
    severity: "unknown",
    category: "airspace"
  });

  assert.equal(row.title, null);
  assert.equal(row.summary, "Airspace restriction notice issued");
  assert.equal(row.source_name, null);
  assert.equal(row.severity, "normal");
});
