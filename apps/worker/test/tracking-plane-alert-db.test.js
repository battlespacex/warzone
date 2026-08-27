import test from "node:test";
import assert from "node:assert/strict";

import { createPlaneAlertMilitaryDatabase, parsePlaneAlertMilitaryCsv } from "../src/tracking/aircraft/providers/plane-alert-db.js";

const CSV = `$ICAO,$Registration,$Operator,$Type,$ICAO Type,#CMPG,$Tag 1,$#Tag 2,$#Tag 3,Category,$#Link
AE1234,82-1234,United States Air Force,"Boeing C-17A, Globemaster III",C17,Mil,Cargo,Transport,Test,USAF,https://example.test
AE3300,15-46001,United States Air Force,Airbus A330 MRTT,A330,Mil,Tanker,Transport,Test,USAF,https://example.test`;

test("plane-alert-db CSV parser handles quoted fields and indexes canonical ICAO24", () => {
    const records = parsePlaneAlertMilitaryCsv(CSV);
    assert.equal(records.size, 2);
    assert.equal(records.get("ae1234").registration, "82-1234");
    assert.equal(records.get("ae1234").model, "Boeing C-17A, Globemaster III");
    assert.equal(records.get("ae1234").operator, "United States Air Force");
});

test("known military ICAO is enriched and classified without replacing good live metadata", async () => {
    const database = createPlaneAlertMilitaryDatabase({ initialCsv: CSV, cacheFile: "" });
    const result = await database.enrichObservations([{
        source: "opensky", icao24: "AE1234", registration: "LIVE-REG",
        latitude: 40, longitude: -70, military_hint: false,
    }]);
    const aircraft = result.observations[0];
    assert.equal(aircraft.registration, "LIVE-REG");
    assert.equal(aircraft.aircraft_type, "C17");
    assert.equal(aircraft.operator, "United States Air Force");
    assert.equal(aircraft.military_hint, true);
    assert.deepEqual(aircraft.metadata_sources, ["plane-alert-db"]);
    assert.equal(result.diagnostics.matches, 1);
});

test("normal civilian aircraft remains civilian", async () => {
    const database = createPlaneAlertMilitaryDatabase({ initialCsv: CSV, cacheFile: "" });
    const civilian = {
        source: "opensky", icao24: "A00001", registration: "N12345",
        aircraft_type: "B738", model: "Boeing 737-800", operator: "Example Airlines",
        military_hint: false,
    };
    const result = await database.enrichObservations([civilian]);
    assert.equal(result.observations[0], civilian);
    assert.equal(result.diagnostics.matches, 0);
});

test("dual-use type requires an exact military identity match", async () => {
    const database = createPlaneAlertMilitaryDatabase({ initialCsv: CSV, cacheFile: "" });
    const result = await database.enrichObservations([
        { source: "opensky", icao24: "A33000", aircraft_type: "A330", model: "Airbus A330", military_hint: false },
        { source: "opensky", icao24: "AE3300", aircraft_type: "A330", model: "Airbus A330", military_hint: false },
    ]);
    assert.equal(result.observations[0].military_hint, false);
    assert.equal(result.observations[1].military_hint, true);
    assert.equal(result.observations[1].operator, "United States Air Force");
});
