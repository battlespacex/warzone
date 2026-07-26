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
    country: "China",
    region: "Asia",
    url: "https://example.com/red-sea-attack",
    is_conflict_relevant: true
  };

  const normalized = normalizeConflictItemToEventPayload(item);

  assert.equal(normalized.map_eligible, true);
  assert.equal(normalized.event.location_label, "Red Sea");
  assert.equal(normalized.event.metadata.normalization.event_country, null);
  assert.equal(normalized.event.metadata.normalization.publisher_country, "China");
  assert.equal(normalized.event.lat, 18);
  assert.equal(normalized.event.lon, 39);
});

test("country-only location hints are retained but not made map eligible", () => {
  const location = resolveEventLocation({
    title: "Russia says Ukrainian drone attack caused blast",
    summary: "No city or coordinates were reported.",
    country: "United Kingdom",
    region: "Europe"
  });

  assert.equal(location.label, "Ukraine");
  assert.equal(location.mapEligible, false);
  assert.equal(location.lat, null);
  assert.equal(location.lon, null);
  assert.equal(location.quality, "coarse_country_hint");
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
  assert.equal(normalized.event.metadata.normalization.location_precision, "city");
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
