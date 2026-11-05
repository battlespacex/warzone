import test from "node:test";
import assert from "node:assert/strict";
import { createGnssInterferenceHandler } from "../src/routes.events.js";
import { getPublicGnssInterferenceCells } from "../src/gnss-interference-public.js";

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test("GNSS geographic source wins over an empty live database result", async () => {
    const dates = [];
    let fallbackCalls = 0;
    const handler = createGnssInterferenceHandler({
        getSnapshot: async (date) => { dates.push(date); return { cells: [{ id: "hex-1" }] }; },
        selectRegion: (snapshot) => ({ cells: snapshot.cells, sourceMode: "gpsinterference" }),
        getFallback: async () => { fallbackCalls++; return { cells: [], sourceMode: "live" }; },
        getFallbackClient: () => null,
    });
    const res = response();
    await handler({ query: {} }, res);
    assert.deepEqual(dates, ["latest"]);
    assert.equal(fallbackCalls, 0);
    assert.equal(res.body.sourceMode, "gpsinterference");
    assert.equal(res.body.cells.length, 1);
});

test("GNSS missing historical and future dates never select database fallback", async () => {
    let providerCalls = 0, fallbackCalls = 0;
    const handler = createGnssInterferenceHandler({
        getSnapshot: async () => { providerCalls++; return null; },
        getFallback: async () => { fallbackCalls++; return { cells: [] }; },
    });
    const future = response();
    await handler({ query: { date: "2999-01-01" } }, future);
    assert.equal(future.statusCode, 400);
    const invalid = response();
    await handler({ query: { date: "2026-02-30" } }, invalid);
    assert.equal(invalid.statusCode, 400);
    const historical = response();
    await handler({ query: { date: "2020-01-01" } }, historical);
    assert.equal(historical.body.sourceMode, "unavailable");
    assert.equal(historical.body.cells.length, 0);
    assert.equal(providerCalls, 1);
    assert.equal(fallbackCalls, 0);
});

test("GNSS latest falls back only when provider is unavailable and labels empty results", async () => {
    const handler = createGnssInterferenceHandler({
        getSnapshot: async () => null,
        getFallbackClient: () => ({}),
        getFallback: async () => ({ cells: [], sourceMode: "live", tableAvailable: true }),
    });
    const res = response();
    await handler({ query: { date: "latest" } }, res);
    assert.equal(res.body.cells.length, 0);
    assert.equal(res.body.sourceHealth, "unavailable");
    assert.match(res.body.message, /does not establish absence/);
});

test("GNSS route accepts rolling periods without mistaking daily snapshots for a full window", async () => {
    let fallbackCalls = 0;
    const handler = createGnssInterferenceHandler({
        getSnapshot: async (date) => ({ cells: [{ cellId: date, severity: "low", polygon: [] }],
            observationPeriod: date, windowMinutes: 1440, complete: true, updatedAt: `${date}T05:00:00Z` }),
        getFallback: async () => { fallbackCalls++; return { cells: [] }; },
    });
    for (const period of ["24h", "48h", "72h"]) {
        const res = response();
        await handler({ query: { date: period } }, res);
        assert.equal(res.statusCode, 200);
        assert.match(res.body.observationPeriod, new RegExp(`Last ${period.slice(0, -1)}h`));
        assert.ok(res.body.severityCounts.low <= Number(period.slice(0, -1)) / 24);
        assert.equal(res.body.sourceMode, "gpsinterference");
    }
    assert.equal(fallbackCalls, 0);
});

test("GNSS database fallback filters by observation time rather than ingestion time", async () => {
    const calls = [];
    const query = {};
    for (const method of ["select", "neq", "not", "gte", "order"]) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    query.limit = async () => ({ data: [{ id: "observed", lat: 40, lon: -80,
        severity: "low", observed_at: new Date().toISOString(), updated_at: new Date().toISOString() }], error: null });
    const result = await getPublicGnssInterferenceCells({ supabase: { from: () => query } });
    assert.equal(result.cells.length, 1);
    assert.ok(calls.some(([method, field]) => method === "gte" && field === "observed_at"));
    assert.ok(!calls.some(([method, field]) => method === "gte" && field === "updated_at"));
});
