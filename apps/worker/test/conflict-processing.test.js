import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractMiddleEastEyePublication, parseAbsolutePublicationDate } from "../src/conflict-article-publication.js";
import { parseLiveHtmlSource } from "../src/conflict-live-fetcher.js";
import { buildEnrichedItem } from "../src/conflict-media-enricher.js";
import { normalizeConflictFeedItemForStorage, normalizeConflictItemToEventPayload, resolveEventLocation as resolveLocation } from "../src/intelligence-normalizer.js";
import { upsertConflictFeedItems } from "../src/conflict-supabase-writer.js";
import { promoteConflictFeedItemsToEvents } from "../src/conflict-event-promoter.js";
import { isConflictIntelligenceEvent } from "../../shared/conflict-retention.js";

const publication = "2026-11-25T21:22:00.000Z";
const resolveEventLocation = (item) => resolveLocation(item, { conflictIntelligence: true });
const mee = { id: "middle-east-eye-live", name: "Middle East Eye Live", type: "html", base_url: "https://www.middleeasteye.net/" };
const item = (extra = {}) => ({ title: "Drone strike reported in Kharkiv", summary: "Buildings damaged in Kharkiv after a drone strike.",
  published_at: publication, source_id: mee.id, source_name: mee.name, url: "https://www.middleeasteye.net/live-blog/live-blog-update/example", is_conflict_relevant: true, ...extra });

test("MEE's observed absolute GMT publication field parses to UTC without ingestion fallback", () => {
  const result = extractMiddleEastEyePublication('<div class="submitted-date"><span class="date-created">25 November 2026 21:22 GMT</span></div>');
  assert.equal(result.value, publication);
  assert.equal(result.kind, "publication");
  assert.equal(extractMiddleEastEyePublication('<span class="date-created">2 hours ago</span>'), null);
  assert.equal(extractMiddleEastEyePublication('<span class="date-created">31 February 2026 21:22 GMT</span>'), null);
  assert.equal(parseAbsolutePublicationDate("2026-11-25T21:22:00"), null);
});

test("live listing retains each update's own narrative and ignores page-wide dates and other rows", () => {
  const html = `<script type="application/ld+json">{"datePublished":"2026-10-01T00:00:00Z"}</script>
    <div class="views-row"><a href="/live-blog/live-blog-update/first">Drone strike</a>
    <div class="views-field-field-text-1"><div>Incident reported in eastern Gaza City.<div>A building was damaged.</div></div></div></div>
    <div class="views-row"><a href="/live-blog/live-blog-update/second">Other report</a>
    <div class="views-field-field-text-1"><div>Officials comment from another city.</div></div></div>`;
  const parsed = parseLiveHtmlSource(html, mee);
  assert.equal(parsed.length, 2);
  assert.match(parsed[0].summary, /eastern Gaza City/);
  assert.doesNotMatch(parsed[0].summary, /another city/);
  assert.equal(parsed[0].published_at, null);
});

test("article enrichment reads MEE date and body instead of modification time or an unrelated time element", () => {
  const html = `<meta property="article:modified_time" content="2026-11-26T12:00:00Z">
    <time datetime="2026-11-26T10:00:00Z">Other story</time><span class="date-created">25 November 2026 21:22 GMT</span>
    <article class="live-blog-update full"><div class="content"><div class="field field-field-text">
      <p>A drone strike damaged buildings in eastern Gaza City.</p></div></div></article>`;
  const enriched = buildEnrichedItem(item({ title: "Drone strike reported in Gaza", published_at: null, summary: "", source_type: "html" }), html);
  assert.equal(enriched.published_at, publication);
  assert.equal(enriched.raw._publication_timestamp.source, "mee.date-created");
  const normalized = normalizeConflictItemToEventPayload(enriched);
  assert.equal(normalized.map_eligible, true);
  assert.equal(normalized.event.metadata.normalization.location_precision, "LOCAL");
  assert.equal(normalized.event.metadata.timeline.timestamp_basis, "source_publication");
  assert.equal(buildEnrichedItem(item({ published_at: null }), '<meta property="article:modified_time" content="2026-11-26T12:00:00Z">').published_at, null);
});

test("attacker nationality does not veto a named foreign incident locality", () => {
  for (const [title, locality, country] of [
    ["Russian drone strike damages buildings in Kharkiv", "Kharkiv, Ukraine", "Ukraine"],
    ["Ukrainian drone strike sparks fire at Krasnodar Refinery", "Krasnodar, Russia", "Russia"],
    ["Iran says explosion reported near Oman's Khasab port", "Khasab, Oman", "Oman"],
  ]) {
    const location = resolveEventLocation({ title });
    assert.equal(location.label, locality);
    assert.equal(location.country, country);
    assert.equal(location.precision, "LOCAL");
  }
  assert.equal(resolveEventLocation({ title: "Russian officials discuss Ukrainian defence" }).mapEligible, false);
});

test("resolver considers later location mentions and possessive geographic context", () => {
  assert.equal(resolveEventLocation({ title: "Kharkiv newspaper says explosion reported in Kharkiv" }).mapEligible, true);
  assert.equal(resolveEventLocation({ title: "Blasts reported in Yemen's Houthi-held Hodeidah" }).label, "Hodeidah, Yemen");
  const unknown = resolveEventLocation({ title: "Attack reported somewhere in Kuwait" });
  assert.equal(unknown.mapEligible, false);
});

test("storage persists resolved coordinates and confidence without creating country-centroid markers", () => {
  const known = normalizeConflictFeedItemForStorage(item({ lat: null, lon: null }));
  assert.ok(known.lat > 49 && known.lat < 51);
  assert.equal(known.lat, known.raw._event_location.latitude);
  assert.equal(known.raw._event_location.precision, "LOCAL");
  const regional = normalizeConflictFeedItemForStorage(item({ title: "Drone attacks reported in Gaza", summary: "No more specific location was provided." }));
  assert.equal(regional.lat, null); assert.equal(regional.lon, null);
  const advocacy = normalizeConflictItemToEventPayload(item({ title: "Teachers call for end to attacks", summary: "Teachers gathered in Gaza City and called for attacks to end." }));
  assert.equal(advocacy.map_eligible, false);
});

test("historical date recovery leaves existing undated rows protected pending manual review", async () => {
  let saved;
  const now = Date.parse("2026-11-26T12:00:00Z");
  const old = item({ published_at: null, raw: {} });
  const query = { select() { return this; }, in: async () => ({ data: [old] }),
    upsert(rows) { saved = rows; return { select: async () => ({ data: rows }) }; } };
  const db = { from: () => query };
  await upsertConflictFeedItems([item({ published_at: "2026-11-16T21:15:00Z" })], { db, now });
  assert.equal(saved[0].published_at, null);
  assert.equal(saved[0].raw._historical_publication_recovery.review_required, true);
  assert.equal(saved[0].raw._historical_publication_recovery.published_at, "2026-11-16T21:15:00.000Z");
});

test("promotion diagnostics distinguish evidence, location, age and normalization failures", async () => {
  const broken = item();
  Object.defineProperty(broken, "event_lat", { enumerable: true, get() { throw new Error("normalization failed"); } });
  const result = await promoteConflictFeedItemsToEvents([
    item({ title: "Procurement contract approved", summary: "Routine procurement announcement." }),
    item({ title: "Drone strike reported at an undisclosed location", summary: "No location was released." }),
    item({ published_at: "2026-10-01T00:00:00Z" }),
    item({ published_at: null }),
    broken,
  ], { now: Date.parse("2026-11-26T12:00:00Z"), db: { from() { throw new Error("no report should reach insertion"); } }, logger: { debug() {} } });
  assert.equal(result.insufficient_evidence_count, 1);
  assert.equal(result.skipped_no_location_count, 1);
  assert.equal(result.skipped_old_count, 1);
  assert.equal(result.skipped_missing_timestamp_count, 1);
  assert.equal(result.failed_normalization_count, 1);
  assert.equal(result.eligible_event_count, 0);
  assert.equal(result.error_count, 1);
});

test("unrelated news/OSINT and independent systems are outside conflict cleanup ownership", () => {
  for (const report_type of ["news", "osint", "notam", "signal", "siren_alert", "flight_tracking"]) {
    assert.equal(isConflictIntelligenceEvent({ report_type, dedupe_key: "other-system:123" }), false);
  }
  const sql = readFileSync(new URL("../../../docs/04-development/supabase-conflict-72h-migration.sql", import.meta.url), "utf8");
  const foundation = readFileSync(new URL("../../../docs/04-development/supabase-db-health-foundation.sql", import.meta.url), "utf8");
  const deletion = foundation.slice(foundation.indexOf("FOR candidate IN SELECT e.*"), foundation.indexOf("END LOOP;"));
  assert.doesNotMatch(deletion, /report_type IN/);
  assert.match(deletion, /stratops_conflict_owned/);
  assert.match(deletion, /stratops_event_has_dependents/);
  assert.match(sql, /e\.metadata->>'source_id' = f\.source_id/);
  assert.doesNotMatch(sql, /DELETE[^;]+published_at IS NULL/is);
  assert.equal(resolveLocation({ title: "Explosion in eastern Gaza City" }).precision, "REGIONAL");
  assert.equal(resolveEventLocation({ title: "Explosion in eastern Gaza City" }).precision, "LOCAL");
});
