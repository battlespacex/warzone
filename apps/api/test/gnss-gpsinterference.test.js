import test from "node:test";
import assert from "node:assert/strict";
import { createGpsInterferenceService, getRollingGpsInterferenceSnapshot, selectGpsInterferenceRegion } from "../src/gnss-gpsinterference.js";

const hex = (h, lat, lon, c, affected = 2) => ({
    h, c, g: 20, b: affected, p: affected / 22 * 100,
    poly: [[lat, lon], [lat + .1, lon + .1], [lat + .2, lon + .1],
        [lat + .3, lon], [lat + .2, lon - .1], [lat + .1, lon - .1]],
});
const payload = { updated: "2026-11-02T08:50:00Z", history_date: "2026-11-01", window_minutes: 1440,
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
    const bounded = selectGpsInterferenceRegion(first, { bounds: { minLat: 39, maxLat: 42, minLon: -82, maxLon: -79 }, limit: 1 });
    assert.equal(bounded.cells.length, 1);
    assert.equal(bounded.severityCounts.low + bounded.severityCounts.severe, bounded.totalCells);
    assert.match(bounded.message, /Map display bounded to 1 of 2 regional cells; severity counts include all regional cells/);
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

test("rolling GNSS windows include only complete UTC observation days and deduplicate cells", async () => {
    const dates = [];
    const getSnapshot = async (date) => {
        dates.push(date);
        return { cells: [{ cellId: "same", severity: date === "2026-11-03" ? "high" : "low", polygon: [] }],
            observationPeriod: date, windowMinutes: 1440, complete: true, updatedAt: `${date}T05:00:00Z` };
    };
    const now = () => Date.parse("2026-11-04T12:00:00Z");
    const one = await getRollingGpsInterferenceSnapshot("24h", { getSnapshot, now });
    assert.equal(one.coverageHours, 0);
    assert.equal(one.sourceHealth, "unavailable");
    const two = await getRollingGpsInterferenceSnapshot("48h", { getSnapshot, now });
    assert.equal(two.coverageHours, 24);
    const three = await getRollingGpsInterferenceSnapshot("72h", { getSnapshot, now });
    assert.equal(three.coverageHours, 48);
    assert.equal(three.cells.length, 1);
    assert.equal(three.cells[0].severity, "high");
    assert.deepEqual(dates, ["2026-11-03", "2026-11-02", "2026-11-03"]);
});

test("rolling GNSS rejects snapshots without a proven flight day or daily window", async () => {
    const snapshot = await getRollingGpsInterferenceSnapshot("48h", {
        now: () => Date.parse("2026-11-04T12:00:00Z"),
        getSnapshot: async () => ({ cells: [{ cellId: "bad" }], observationPeriod: "2026-11-03", windowMinutes: 60 }),
    });
    assert.equal(snapshot.cells.length, 0);
    assert.equal(snapshot.coverageHours, 0);
    await assert.rejects(getRollingGpsInterferenceSnapshot("12h"), /Invalid GNSS observation period/);
});

test("missing newest day explains empty 24h and 48h while 72h shows only an older full UTC day", async () => {
    const now = () => Date.parse("2026-11-05T02:25:00Z");
    const getSnapshot = async (date) => date === "2026-11-03"
        ? { cells: [{ cellId: "observed-nov-3", observedAt: date, severity: "high", polygon: [] }],
            observationPeriod: date, windowMinutes: 1440, complete: true }
        : null;
    const results = await Promise.all(["24h", "48h", "72h"].map((period) =>
        getRollingGpsInterferenceSnapshot(period, { getSnapshot, now })));
    assert.deepEqual(results.map((result) => result.cells.length), [0, 0, 1]);
    assert.deepEqual(results.map((result) => result.coverageHours), [0, 0, 24]);
    assert.equal(results[2].cells[0].observedAt, "2026-11-03");
    assert.match(results[2].message, /not continuous per-hexagon observation coverage/);
    assert.match(results[1].message, /Overlapping daily summaries cannot be split/);
});

test("larger UTC windows retain every hexagon from smaller windows at the same reference time", async () => {
    const now = () => Date.parse("2026-11-05T00:00:00Z");
    const getSnapshot = async (date) => ({ cells: [
        { cellId: "shared", observedAt: date, severity: "low", polygon: [] },
        { cellId: date, observedAt: date, severity: "high", polygon: [] },
    ], observationPeriod: date, windowMinutes: 1440, complete: true });
    const snapshots = await Promise.all(["24h", "48h", "72h"].map((period) =>
        getRollingGpsInterferenceSnapshot(period, { getSnapshot, now })));
    const ids = snapshots.map((snapshot) => new Set(snapshot.cells.map((cell) => cell.cellId)));
    assert.ok([...ids[0]].every((id) => ids[1].has(id) && ids[2].has(id)));
    assert.ok([...ids[1]].every((id) => ids[2].has(id)));
    assert.deepEqual(snapshots.map((snapshot) => snapshot.coverageHours), [24, 48, 72]);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.sourceHealth), ["Available", "Available", "Available"]);
});
