import test from "node:test";
import assert from "node:assert/strict";

import { processAisStreamMessage } from "../src/tracking/naval/providers/aisstream.js";

test("AISStream keeps static identity until a position arrives", () => {
    const cache = new Map();
    const staticResult = processAisStreamMessage({
        MessageType: "ShipStaticData",
        MetaData: { MMSI: 123456789 },
        Message: { ShipStaticData: { Name: "HMS TEST", Type: 35, CallSign: "NAVY1" } },
    }, { now: Date.parse("2026-08-13T12:00:00Z"), cache });
    assert.equal(staticResult.observation, null);

    const positionResult = processAisStreamMessage({
        MessageType: "PositionReport",
        MetaData: { MMSI: 123456789 },
        Message: { PositionReport: { Latitude: 51.5, Longitude: -0.1, Sog: 12, TrueHeading: 90 } },
    }, { now: Date.parse("2026-08-13T12:00:10Z"), cache });

    assert.equal(positionResult.observation.vessel_name, "HMS TEST");
    assert.equal(positionResult.observation.ship_type, 35);
    assert.equal(positionResult.observation.latitude, 51.5);
});

