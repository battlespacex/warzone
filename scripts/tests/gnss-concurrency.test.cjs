const test = require("node:test");
const assert = require("node:assert/strict");

// Synthetic service fixtures only: never sent to StratOps or used as map observations.
for (const users of [1, 10, 20, 30]) {
    test(`${users} concurrent callers share historical upstream requests within one API process`, async () => {
        const { createGpsInterferenceService, getRollingGpsInterferenceSnapshot, selectGpsInterferenceRegion } =
            await import("../../apps/api/src/gnss-gpsinterference.js");
        const now = () => Date.parse("2026-11-09T14:24:30Z");
        let requests = 0;
        const pending = [];
        const getSnapshot = createGpsInterferenceService({ now, fetchImpl: async (url) => {
            requests++;
            const date = url.split("/").at(-1);
            await new Promise((resolve) => pending.push(resolve));
            return { ok: true, text: async () => JSON.stringify({ updated: date + "T23:59:00Z", history_date: date,
                window_minutes: 1440, complete: true, hexes: [{ h: "fixture-cell", c: "r", g: 20, b: 4, p: 20,
                    poly: [[30, 40], [30.1, 40.1], [30.2, 40.1], [30.3, 40], [30.2, 39.9], [30.1, 39.9]] }] }) };
        } });
        const read = () => getRollingGpsInterferenceSnapshot("72h", { getSnapshot, now });
        const responses = Array.from({ length: users }, read);
        assert.equal(requests, 2); // Two complete UTC days inside the original rolling-window semantics.
        pending.forEach((resolve) => resolve());
        const snapshots = await Promise.all(responses);
        for (const snapshot of snapshots) {
            assert.equal(snapshot.cells.length, 1);
            assert.equal(snapshot.coverageHours, 48);
            assert.equal(snapshot.cells[0].severity, "high");
            assert.equal(snapshot.cells[0].polygon.length, 6);
            const region = selectGpsInterferenceRegion(snapshot, { bounds: { minLat: 29, maxLat: 31, minLon: 39, maxLon: 41 } });
            assert.equal(region.totalCells, 1);
            assert.equal(region.cells[0].affectedAircraftCount, 4);
        }
        await Promise.all(Array.from({ length: users }, read));
        assert.equal(requests, 2); // Warm in-process data cache; independent of browser/CDN caches.
    });
}
