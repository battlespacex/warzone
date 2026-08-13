import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
    createAisStreamProvider,
    normalizeAisStreamBoundingBoxes,
    processAisStreamMessage,
    pruneAisStreamCache,
} from "../src/tracking/naval/providers/aisstream.js";

test("AISStream converts internal lon-lat boxes to the required nested lat-lon format", () => {
    assert.deepEqual(
        normalizeAisStreamBoundingBoxes([[-80, 20, -70, 30], [10, -5, 20, 5]]),
        [[[20, -80], [30, -70]], [[-5, 10], [5, 20]]]
    );
    assert.throws(() => normalizeAisStreamBoundingBoxes("[1,2,3]"), /bounding boxes/i);
    assert.throws(() => normalizeAisStreamBoundingBoxes([[-181, 20, -70, 30]]), /Invalid AISStream/);
});

test("AISStream subscription errors are recognized before MMSI extraction", () => {
    const parsed = processAisStreamMessage({ error: "invalid bounding box" });
    assert.equal(parsed.kind, "error");
    assert.equal(parsed.mmsi, "");
    assert.equal(parsed.error, "invalid bounding box");
});

test("AISStream logs a subscription error once before attempting vessel extraction", async () => {
    const warnings = [];
    const socket = new EventEmitter();
    socket.send = () => socket.emit("message", Buffer.from(JSON.stringify({ error: "subscription rejected" })));
    socket.close = () => socket.emit("close");
    const provider = createAisStreamProvider({
        enabled: true,
        apiKey: "test-key",
        diagnosticWindowMs: 1,
        webSocketFactory: () => {
            setImmediate(() => socket.emit("open"));
            return socket;
        },
        logger: { warn(message) { warnings.push(message); } },
    });
    await assert.rejects(provider.fetchObservations(), /subscription rejected/);
    assert.deepEqual(warnings, ["[ais:aisstream] SUBSCRIPTION_ERROR subscription rejected"]);
    provider.shutdown();
});

for (const messageType of [
    "PositionReport",
    "StandardClassBPositionReport",
    "ExtendedClassBPositionReport",
    "LongRangeAisBroadcastMessage",
]) {
    test(`AISStream normalizes ${messageType}`, () => {
        const result = processAisStreamMessage({
            MessageType: messageType,
            MetaData: { MMSI: 123456789, ShipName: "USS TEST", time_utc: "2026-08-13T12:00:00Z" },
            Message: { [messageType]: { Latitude: 40, Longitude: -70, Sog: 12, Cog: 91, TrueHeading: 90 } },
        }, { cache: new Map() });
        assert.equal(result.kind, "position");
        assert.equal(result.observation.mmsi, "123456789");
        assert.equal(result.observation.latitude, 40);
        assert.equal(result.observation.course_deg, 91);
    });
}

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

test("AISStream static data survives short windows and bounded TTL pruning", () => {
    const cache = new Map();
    const started = Date.parse("2026-08-13T12:00:00Z");
    processAisStreamMessage({
        MessageType: "StaticDataReport",
        MetaData: { MMSI: 987654321 },
        Message: { StaticDataReport: { ReportA: { Name: "USS CACHE" }, ReportB: { CallSign: "NAVY9", ShipType: 35 } } },
    }, { now: started, cache, cacheTtlMs: 30 * 60_000 });
    const joined = processAisStreamMessage({
        MessageType: "StandardClassBPositionReport",
        MetaData: { MMSI: 987654321 },
        Message: { StandardClassBPositionReport: { Latitude: 41, Longitude: -71 } },
    }, { now: started + 60_000, cache, cacheTtlMs: 30 * 60_000 });
    assert.equal(joined.observation.vessel_name, "USS CACHE");
    assert.equal(joined.observation.callsign, "NAVY9");

    pruneAisStreamCache(cache, started + 31 * 60_000, 30 * 60_000);
    assert.equal(cache.size, 0);
});
