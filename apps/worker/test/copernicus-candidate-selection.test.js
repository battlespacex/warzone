import test from "node:test";
import assert from "node:assert/strict";
import { listCandidateEvents, prioritizeCandidateEvents } from "../src/copernicus-runner.js";
import { isEventEligibleForCopernicus } from "../src/copernicus-utils.js";

test("recent aircraft sightings do not hide an older eligible strike from the candidate scan", async () => {
  const occurredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = Array.from({ length: 35 }, (_, index) => ({
    id: `aircraft-${index}`, category: "military", subcategory: "isr",
    severity: "high", title: "Routine aircraft sighting", occurred_at: occurredAt,
    lat: 35, lon: 36,
  }));
  rows.push({
    id: "older-strike", category: "strike", severity: "high",
    title: "Strike reported near airfield", occurred_at: occurredAt,
    lat: 35, lon: 36,
  });
  const query = {
    select() { return this; },
    gte() { return this; },
    in() { return this; },
    not() { return this; },
    order() { return this; },
    limit(value) { return Promise.resolve({ data: rows.slice(0, value), error: null }); },
  };
  const supabase = { from(table) { assert.equal(table, "events"); return query; } };
  const config = { enabled: true, batchSize: 1 };
  const candidates = await listCandidateEvents(supabase, config);

  assert.equal(candidates.length, 36);
  assert.equal(candidates.filter((event) => isEventEligibleForCopernicus(event, config).eligible).length, 1);
  assert.equal(candidates.at(-1).id, "older-strike");
});

test("critical and high strike events run before other eligible events", () => {
  const events = [
    { id: "other-critical", category: "military", severity: "critical", occurred_at: "2026-09-21T12:00:00Z" },
    { id: "strike-high", category: "strike", severity: "high", occurred_at: "2026-09-21T10:00:00Z" },
    { id: "strike-critical", category: "strike", severity: "critical", occurred_at: "2026-09-21T09:00:00Z" },
  ];
  assert.deepEqual(prioritizeCandidateEvents(events).map(({ id }) => id), ["strike-critical", "strike-high", "other-critical"]);
  assert.equal(events[0].id, "other-critical");
});
