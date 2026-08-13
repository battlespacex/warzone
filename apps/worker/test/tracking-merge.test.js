import test from "node:test";
import assert from "node:assert/strict";

import { mergeAircraftObservations, mergeNavalObservations } from "../src/tracking/merge.js";

function aircraft(source, observedAt, latitude, longitude, extra = {}) {
    return {
        domain: "aircraft",
        source,
        observed_at: observedAt,
        icao24: "abc123",
        latitude,
        longitude,
        military_hint: true,
        ...extra,
    };
}

test("two aircraft providers produce one corroborated canonical aircraft", () => {
    const canonical = mergeAircraftObservations([
        aircraft("airplanes_live", "2026-08-13T12:00:00Z", 43, -79),
        aircraft("adsbx", "2026-08-13T12:00:04Z", 43.01, -78.99),
    ]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "icao:abc123");
    assert.equal(canonical[0].source_count, 2);
    assert.equal(canonical[0].corroboration, "corroborated");
    assert.deepEqual(canonical[0].last_source_observations.map((item) => item.provider), ["airplanes_live", "adsbx"]);
});

test("freshest sane aircraft position is selected without averaging", () => {
    const canonical = mergeAircraftObservations([
        aircraft("airplanes_live", "2026-08-13T12:00:00Z", 43, -79),
        aircraft("opensky", "2026-08-13T12:00:03Z", 43.01, -78.99),
        aircraft("adsbx", "2026-08-13T12:00:05Z", 43.02, -78.98),
    ]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].latitude, 43.02);
    assert.equal(canonical[0].longitude, -78.98);
    assert.equal(canonical[0].source_count, 3);
    assert.equal(canonical[0].corroboration, "multi-source");
});

test("physically impossible newest aircraft position is rejected", () => {
    const canonical = mergeAircraftObservations([
        aircraft("airplanes_live", "2026-08-13T12:00:00Z", 43, -79),
        aircraft("opensky", "2026-08-13T12:00:03Z", 43.01, -78.99),
        aircraft("adsbx", "2026-08-13T12:00:05Z", 10, 10),
    ]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].latitude, 43.01);
    assert.equal(canonical[0].longitude, -78.99);
    assert.equal(canonical[0].source_disagreements, 1);
});

test("same MMSI produces one vessel and combines fresh position with static identity", () => {
    const canonical = mergeNavalObservations([
        {
            source: "aishub",
            observed_at: "2026-08-13T12:00:00Z",
            mmsi: "123456789",
            latitude: 35,
            longitude: 20,
            vessel_name: "HMS TEST",
            imo: "9876543",
            priority: 1,
        },
        {
            source: "aisstream",
            observed_at: "2026-08-13T12:02:00Z",
            mmsi: "123456789",
            latitude: 35.01,
            longitude: 20.01,
            speed_kts: 14,
            priority: 0,
        },
    ]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "mmsi:123456789");
    assert.equal(canonical[0].source_count, 2);
    assert.equal(canonical[0].vessel_name, "HMS TEST");
    assert.equal(canonical[0].latitude, 35.01);
    assert.equal(canonical[0].speed_kts, 14);
});

test("repeated provider cycles retain one canonical identity per aircraft", () => {
    const firstCycle = mergeAircraftObservations([
        aircraft("adsbx", "2026-08-13T12:00:00Z", 43, -79),
        aircraft("opensky", "2026-08-13T12:00:02Z", 43.01, -78.99),
    ]);
    const secondCycle = mergeAircraftObservations([
        aircraft("adsbx", "2026-08-13T12:01:00Z", 43.1, -78.9),
        aircraft("opensky", "2026-08-13T12:01:02Z", 43.11, -78.89),
    ]);

    assert.equal(firstCycle.length, 1);
    assert.equal(secondCycle.length, 1);
    assert.equal(firstCycle[0].identity, secondCycle[0].identity);
    assert.equal(firstCycle[0].source_count, 2);
    assert.equal(secondCycle[0].source_count, 2);
});
