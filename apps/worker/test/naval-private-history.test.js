import test from "node:test";
import assert from "node:assert/strict";
import { buildPrivateNavalHistoryRows, persistPrivateNavalHistory } from "../src/naval-private-history.js";
import { runAisWorker } from "../src/ais-worker.js";
import { resetProviderHealth } from "../src/tracking/provider-health.js";

function vessel(overrides = {}) {
    return {
        mmsi: "368123456", imoNumber: "9876543", callSign: "NAVY1",
        name: "USS EXAMPLE", vesselClass: "destroyer", operator: "US Navy",
        country: "United States", lat: 36, lon: -72, speed: 12, heading: 90,
        observedAt: "2026-11-03T12:00:00Z", sourceConfidence: 75,
        lastSourceObservations: [{ provider: "aisstream" }],
        qualificationReason: "known_military_imo", ...overrides,
    };
}

test("private history preserves first detection and reconciles changed MMSI by IMO", () => {
    const first = buildPrivateNavalHistoryRows([vessel()]);
    assert.equal(first.assets[0].asset_key, "imo-9876543");
    const second = buildPrivateNavalHistoryRows([
        vessel({ mmsi: "368765432", lat: 36.1, observedAt: "2026-11-03T13:00:00Z" }),
    ], first.assets);
    assert.equal(second.assets[0].asset_key, first.assets[0].asset_key);
    assert.equal(second.assets[0].first_seen_at, "2026-11-03T12:00:00.000Z");
    assert.equal(second.assets[0].last_seen_at, "2026-11-03T13:00:00.000Z");
    assert.equal(second.assets[0].lat, 36.1);
    assert.ok(second.assets[0].aliases.includes("mmsi:368123456"));
    assert.ok(second.assets[0].aliases.includes("mmsi:368765432"));
    assert.equal(second.points[0].asset_key, first.assets[0].asset_key);
});

test("older AIS observation adds a point without moving the last known position backward", () => {
    const latest = buildPrivateNavalHistoryRows([vessel()]).assets;
    const stale = buildPrivateNavalHistoryRows([
        vessel({ lat: 35, observedAt: "2026-11-02T12:00:00Z" }),
    ], latest);
    assert.equal(stale.assets[0].lat, 36);
    assert.equal(stale.assets[0].last_seen_at, "2026-11-03T12:00:00.000Z");
    assert.equal(stale.assets[0].first_seen_at, "2026-11-02T12:00:00.000Z");
    assert.equal(stale.points[0].lat, 35);
});

test("conflicting IMO identities for one MMSI fail closed", () => {
    const existing = buildPrivateNavalHistoryRows([vessel()]).assets;
    assert.throws(() => buildPrivateNavalHistoryRows([vessel({ imoNumber: "1111111" })], existing),
        /conflicting IMO/);
});

test("private writer reads known identity before adding positions and writes no Realtime tables", async () => {
    const calls = [];
    const client = {
        from(table) {
            const query = {
                select() { return this; },
                async in(field, values) {
                    calls.push(["lookup", table, field, values]);
                    return { data: [], error: null };
                },
                async upsert(rows, options) {
                    calls.push(["upsert", table, rows, options]);
                    return { error: null };
                },
            };
            return query;
        },
    };
    const result = await persistPrivateNavalHistory([vessel()], client);
    assert.deepEqual(result, { assets: 1, points: 1 });
    assert.deepEqual(calls.filter(([operation]) => operation === "upsert")
        .map(([, table]) => table), ["naval_asset_history", "naval_position_history"]);
    assert.equal(calls[3][3].onConflict, "asset_key,observed_at,lat,lon");
});

test("private write failure never interrupts live writes and is retried next cycle", async () => {
    resetProviderHealth();
    let liveWrites = 0;
    let privateAttempts = 0;
    const cache = new Map();
    const provider = {
        id: "aisstream", enabled: true, priority: 0,
        async fetchObservations() {
            return [{ domain: "naval", source: "aisstream", provider: "aisstream",
                observed_at: "2026-11-03T12:00:00Z", mmsi: "368123456", imo: "9876543",
                vessel_name: "USS EXAMPLE", latitude: 36, longitude: -72,
                ship_type: 35, provider_military_flag: true }];
        },
    };
    const persistence = {
        async upsertEvents() { liveWrites += 1; },
        async upsertTracks(rows) { return rows.length; },
        async upsertHistory() {}, async endAliases() {},
    };
    for (let cycle = 0; cycle < 2; cycle += 1) {
        await runAisWorker({ providers: [provider], persistence,
            privateHistoryEnabled: true, privateHistoryCache: cache,
            persistPrivateHistory: async () => {
                privateAttempts += 1;
                if (privateAttempts === 1) throw new Error("staging unavailable");
                return { assets: 1, points: 1 };
            },
            logger: { log() {}, warn() {}, error() {} },
        });
    }
    assert.equal(liveWrites, 2);
    assert.equal(privateAttempts, 2);
    assert.equal(cache.size, 1);
});
