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

test("ADSB.lol, OpenSky, and a third provider normalize ICAO case into one aircraft", () => {
    const canonical = mergeAircraftObservations([
        aircraft("adsb_lol", "2026-08-13T12:00:00Z", 43, -79, { icao24: "ae1234" }),
        aircraft("opensky", "2026-08-13T12:00:02Z", 43.001, -78.999, { icao24: "AE1234" }),
        aircraft("airplanes_live", "2026-08-13T12:00:04Z", 43.002, -78.998, { icao24: "Ae1234" }),
    ]);

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "icao:ae1234");
    assert.equal(canonical[0].source_count, 3);
    assert.equal(canonical[0].corroboration, "multi-source");
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

test("AISStream and Fintraffic deduplicate by MMSI and retain the newer sane position", () => {
    const canonical = mergeNavalObservations([
        { source: "fintraffic", observed_at: "2026-08-13T12:00:00Z", mmsi: "230123456", vessel_name: "FNS TEST", latitude: 60, longitude: 24, priority: 1, metadata: { attribution: "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY" } },
        { source: "aisstream", observed_at: "2026-08-13T12:01:00Z", mmsi: "230123456", latitude: 60.01, longitude: 24.01, priority: 0 },
    ]);
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].latitude, 60.01);
    assert.equal(canonical[0].source_count, 2);
    assert.match(canonical[0].last_source_observations.find((item) => item.provider === "fintraffic").attribution, /CC 4\.0 BY/);
});

test("five naval providers reporting one MMSI produce one multi-source vessel", () => {
    const providers = ["aisstream", "aishub", "spire", "marinetraffic", "vesselfinder"];
    const canonical = mergeNavalObservations(providers.map((source, index) => ({
        source,
        observed_at: `2026-08-13T12:00:0${index}Z`,
        mmsi: "368123456",
        imo: "9876543",
        vessel_name: "USS EXAMPLE",
        latitude: 36 + index * 0.0001,
        longitude: -72 + index * 0.0001,
        military_hint: true,
        priority: index,
    })), { freshnessMs: 300_000, maxSpeedKts: 80 });

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "mmsi:368123456");
    assert.equal(canonical[0].source_count, 5);
    assert.equal(canonical[0].corroboration, "multi-source");
    assert.deepEqual(canonical[0].sources, providers);
});

test("IMO-only observations reconcile into a unique MMSI group when reliable MMSI arrives", () => {
    const canonical = mergeNavalObservations([
        { source: "spire", observed_at: "2026-08-13T12:00:00Z", imo: "9876543", vessel_name: "USS EXAMPLE", latitude: 36, longitude: -72 },
        { source: "aisstream", observed_at: "2026-08-13T12:00:02Z", mmsi: "368123456", imo: "9876543", latitude: 36.001, longitude: -72.001 },
    ]);
    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "mmsi:368123456");
    assert.equal(canonical[0].source_count, 2);
});

test("different MMSIs never merge merely because vessel names match", () => {
    const canonical = mergeNavalObservations([
        { source: "aisstream", observed_at: "2026-08-13T12:00:00Z", mmsi: "111111111", vessel_name: "PATROL ONE", latitude: 36, longitude: -72 },
        { source: "aishub", observed_at: "2026-08-13T12:00:01Z", mmsi: "222222222", vessel_name: "PATROL ONE", latitude: 36.0001, longitude: -72.0001 },
    ]);
    assert.equal(canonical.length, 2);
});

test("freshest physically supported naval position wins without averaging", () => {
    const canonical = mergeNavalObservations([
        { source: "aisstream", observed_at: "2026-08-13T12:00:00Z", mmsi: "368123456", latitude: 36, longitude: -72 },
        { source: "spire", observed_at: "2026-08-13T12:01:00Z", mmsi: "368123456", latitude: 36.01, longitude: -72.01 },
        { source: "aishub", observed_at: "2026-08-13T12:01:02Z", mmsi: "368123456", latitude: 36.0102, longitude: -72.0102 },
    ], { maxSpeedKts: 80 });
    assert.equal(canonical[0].latitude, 36.0102);
    assert.equal(canonical[0].longitude, -72.0102);
});

test("impossible newest naval jump is rejected when two plausible sources agree", () => {
    const canonical = mergeNavalObservations([
        { source: "aisstream", observed_at: "2026-08-13T12:00:00Z", mmsi: "368123456", latitude: 36, longitude: -72 },
        { source: "spire", observed_at: "2026-08-13T12:01:00Z", mmsi: "368123456", latitude: 36.01, longitude: -72.01 },
        { source: "aishub", observed_at: "2026-08-13T12:01:02Z", mmsi: "368123456", latitude: 10, longitude: 10 },
    ], { maxSpeedKts: 80 });
    assert.equal(canonical[0].latitude, 36.01);
    assert.equal(canonical[0].source_disagreements, 1);
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
