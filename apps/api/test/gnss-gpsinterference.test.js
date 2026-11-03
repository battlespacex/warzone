import test from "node:test";
import assert from "node:assert/strict";
import { createGpsInterferenceService, selectGpsInterferenceRegion } from "../src/gnss-gpsinterference.js";

const hex = (h, lat, lon, c, affected = 2) => ({
    h, c, g: 20, b: affected, p: affected / 22 * 100,
    poly: [[lat, lon], [lat + .1, lon + .1], [lat + .2, lon + .1],
        [lat + .3, lon], [lat + .2, lon - .1], [lat + .1, lon - .1]],
});
const payload = { updated: "2026-11-02T08:50:00Z", history_date: "2026-11-01",
    hexes: [hex("a", 40, -80, "g"), hex("b", 41, -81, "p", 15),
        hex("b", 41, -81, "p", 15), hex("c", 10, 20, "r")] };

test("GNSS provider deduplicates source IDs, preserves counts and scopes overlapping region", async () => {
    let calls = 0;
    const get = createGpsInterferenceService({ fetchImpl: async () => { calls++; return { ok: true, text: async () => JSON.stringify(payload) }; } });
    const [first, second] = await Promise.all([get(), get()]);
    assert.equal(calls, 1);
    assert.equal(first.cells.length, 3);
    assert.equal(second.cells.length, 3);
    const regional = selectGpsInterferenceRegion(first, { bounds: { minLat: 39, maxLat: 42, minLon: -82, maxLon: -79 } });
    assert.equal(regional.totalCells, 2);
    assert.equal(regional.severityCounts.low, 1);
    assert.equal(regional.severityCounts.severe, 1);
    assert.equal(regional.cells[1].affectedAircraftCount, 15);
    assert.equal(regional.cells[1].sampleCount, 35);
    assert.equal(regional.cells[1].polygon.length, 6);
    assert.equal(regional.observationPeriod, "2026-11-01");
    await get();
    assert.equal(calls, 1);
});

test("GNSS provider returns stale cached observations on failure, with no retry storm", async () => {
    let time = 0, calls = 0;
    const get = createGpsInterferenceService({ now: () => time, fetchImpl: async () => {
        calls++; if (calls > 1) throw new Error("offline");
        return { ok: true, text: async () => JSON.stringify(payload) };
    } });
    await get(); time = 61_000;
    const stale = await get();
    assert.equal(stale.stale, true);
    assert.equal(selectGpsInterferenceRegion(stale).sourceHealth, "stale");
    await get();
    assert.equal(calls, 2);
});

test("GNSS provider rejects invalid historical dates before network access", async () => {
    const get = createGpsInterferenceService({ fetchImpl: () => { throw new Error("must not fetch"); } });
    await assert.rejects(get("2026-02-30"), /Invalid GNSS observation date/);
});


test("GNSS date-line hexagon is not counted in unrelated longitude ranges", () => {
    const cell = { id: "date-line", cellId: "date-line", severity: "high", polygon: [
        { lat: 10, lon: 179.8 }, { lat: 10.1, lon: 179.9 }, { lat: 10.2, lon: -179.9 },
        { lat: 10.3, lon: -179.8 }, { lat: 10.2, lon: -179.9 }, { lat: 10.1, lon: 179.9 },
    ] };
    const snapshot = { cells: [cell], updatedAt: "2026-11-02T08:50:00Z", observationPeriod: "2026-11-01" };
    assert.equal(selectGpsInterferenceRegion(snapshot, { bounds: { minLat: 0, maxLat: 20, minLon: 28, maxLon: 65 } }).totalCells, 0);
    assert.equal(selectGpsInterferenceRegion(snapshot, { bounds: { minLat: 0, maxLat: 20, minLon: 150, maxLon: 180 } }).totalCells, 1);
});
