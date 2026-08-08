import test from "node:test";
import assert from "node:assert/strict";
import { aggregateEventQuality } from "../src/event-quality.js";
import { areNearDuplicateItems, dedupeConflictItems } from "../src/conflict-feed-runner.js";
import { normalizeConflictItemToEventPayload } from "../src/intelligence-normalizer.js";

const BASE_TIME = "2026-08-08T10:00:00.000Z";

function report(overrides = {}) {
  return {
    title: "Explosion reported at Isfahan International Airport",
    summary: "Reuters reported an explosion at Isfahan International Airport.",
    published_at: BASE_TIME,
    source_name: "Reuters",
    source_type: "rss",
    url: "https://example.com/report-1",
    ...overrides,
  };
}

test("republished Reuters copies remain one independent source family", () => {
  const reports = Array.from({ length: 6 }, (_, index) => report({
    source_name: index === 0 ? "Reuters" : `Republisher ${index}`,
    url: `https://publisher-${index}.example/reuters-copy`,
  }));

  const quality = aggregateEventQuality(reports);

  assert.equal(quality.raw_report_count, 6);
  assert.equal(quality.independent_source_family_count, 1);
  assert.deepEqual(quality.independent_source_families, ["reuters"]);
  assert.equal(quality.corroboration_state, "REPORTED");
});

test("official confirmation plus independent media produces confirmed evidence", () => {
  const quality = aggregateEventQuality([
    report(),
    report({
      title: "Ministry confirms explosion at Isfahan International Airport",
      summary: "The Iranian defence ministry confirmed the incident in an official statement.",
      source_name: "Iran Defence Ministry",
      source_type: "official",
      source_class: "OFFICIAL",
      official_status: true,
      url: "https://official.example/statement",
    }),
    report({
      title: "Blast reported at Isfahan International Airport",
      summary: "A regional correspondent independently reported the airport blast.",
      source_name: "Jerusalem Post",
      url: "https://jpost.com/example/blast",
    }),
  ]);

  assert.equal(quality.corroboration_state, "CONFIRMED");
  assert.equal(quality.official_confirmation, true);
  assert.equal(quality.independent_source_family_count, 3);
  assert.ok(quality.confidence >= 88);
});

test("Telegram-only reporting is retained as unverified", () => {
  const quality = aggregateEventQuality([
    report({
      source_name: "Regional Alerts",
      source_type: "telegram",
      summary: "A channel claims an explosion occurred in Isfahan.",
      url: "https://t.me/regionalalerts/123",
    }),
  ]);

  assert.equal(quality.raw_report_count, 1);
  assert.equal(quality.corroboration_state, "UNVERIFIED");
  assert.ok(quality.confidence < 50);
});

test("independent major-media reporting upgrades a Telegram claim", () => {
  const quality = aggregateEventQuality([
    report({
      source_name: "Regional Alerts",
      source_type: "telegram",
      summary: "A channel claims an explosion occurred in Isfahan.",
      url: "https://t.me/regionalalerts/123",
    }),
    report(),
  ]);

  assert.equal(quality.independent_source_family_count, 2);
  assert.equal(quality.corroboration_state, "CORROBORATED");
  assert.ok(quality.confidence >= 75);
});

test("credible report and explicit denial are represented as disputed", () => {
  const quality = aggregateEventQuality([
    report(),
    report({
      title: "Iranian ministry denies reported Isfahan airport attack",
      summary: "An official statement denies that the reported attack occurred.",
      source_name: "Iran Defence Ministry",
      source_type: "official",
      source_class: "OFFICIAL",
      official_status: true,
      url: "https://official.example/denial",
    }),
  ]);

  assert.equal(quality.corroboration_state, "DISPUTED");
  assert.equal(quality.disputed, true);
  assert.ok(quality.confidence <= 62);
});

test("facility synonyms merge while a later different action remains separate", () => {
  const first = report({
    title: "Explosion at Isfahan airport",
    summary: "An explosion was reported at Isfahan International Airport.",
    url: "https://a.example/incident",
  });
  const duplicate = report({
    title: "Blast reported at Isfahan International Airport",
    summary: "A blast occurred at the airport in Isfahan.",
    source_name: "Jerusalem Post",
    url: "https://b.example/incident",
    published_at: "2026-08-08T10:20:00.000Z",
  });
  const laterAirDefence = report({
    title: "Air defence activity over Isfahan airport",
    summary: "Air defence activity was reported over Isfahan five hours later.",
    source_name: "Jerusalem Post",
    url: "https://b.example/air-defence",
    published_at: "2026-08-08T15:00:00.000Z",
  });

  assert.equal(areNearDuplicateItems(first, duplicate), true);
  assert.equal(areNearDuplicateItems(first, laterAirDefence), false);
  const deduplicated = dedupeConflictItems([first, duplicate, laterAirDefence]);
  assert.equal(deduplicated.length, 2);
  assert.equal(deduplicated.find((item) => item.raw_report_count === 2)?.independent_source_family_count, 2);
});

test("source quality cannot replace foreign incident geography", () => {
  const normalized = normalizeConflictItemToEventPayload(report({
    title: "Explosion reported in Isfahan, Iran",
    summary: "A Korean publisher reported an incident in Isfahan.",
    source_name: "Korea Daily",
    source_country: "South Korea",
    source_region: "East Asia",
    is_conflict_relevant: true,
  }));

  assert.equal(normalized.event.metadata.normalization.source_country, "South Korea");
  assert.equal(normalized.event.metadata.normalization.event_country, "Iran");
  assert.equal(normalized.event.metadata.normalization.event_city, "Isfahan");
});
