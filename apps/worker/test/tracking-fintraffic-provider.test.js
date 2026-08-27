import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

import {
    createFintrafficProvider,
    normalizeFintrafficObservation,
    parseFintrafficMessage,
} from "../src/tracking/naval/providers/fintraffic.js";
import { resetProviderHealth, runConfiguredProviders } from "../src/tracking/provider-health.js";

test("Fintraffic parser accepts documented location and metadata topics", () => {
    assert.equal(parseFintrafficMessage("vessels-v2/230123456/location", '{"lat":60}').kind, "location");
    assert.equal(parseFintrafficMessage("vessels-v2/230123456/locations", '{"lat":60}').kind, "location");
    assert.equal(parseFintrafficMessage("vessels-v2/230123456/metadata", '{"name":"FNS TEST"}').kind, "metadata");
    assert.equal(parseFintrafficMessage("vessels-v2/230123456/location", "not-json").kind, "malformed");
});

test("Fintraffic normalizes location, metadata, timestamp, and attribution", () => {
    const item = normalizeFintrafficObservation("230123456", {
        time: 1_786_622_400, lat: 60.1, lon: 24.9, sog: 12.5, cog: 91, heading: 90,
    }, {
        imo: 9876543, callSign: "NAVY1", name: "FNS TEST", type: 35,
    });
    assert.equal(item.observed_at, "2026-08-13T12:00:00.000Z");
    assert.equal(item.mmsi, "230123456");
    assert.equal(item.speed_kts, 12.5);
    assert.equal(item.ship_type_code, 35);
    assert.match(item.metadata.attribution, /Fintraffic/);
});

test("Fintraffic normalization tolerates missing fields and rejects invalid coordinates", () => {
    const item = normalizeFintrafficObservation("230123456", { time: 1_786_622_400, lat: 95, lon: 24.9 });
    assert.equal(item.latitude, null);
    assert.equal(item.longitude, null);
    assert.equal(item.vessel_name, "");
    assert.equal(item.speed_kts, null);
});

test("Fintraffic provider maintains one MQTT subscription and returns cached observations", async () => {
    const client = new EventEmitter();
    let subscribeCalls = 0;
    let ended = false;
    client.subscribe = (topics, options, callback) => {
        subscribeCalls += 1;
        assert.ok(topics.includes("vessels-v2/+/metadata"));
        callback(null);
        setImmediate(() => {
            client.emit("message", "vessels-v2/230123456/metadata", Buffer.from('{"name":"FNS TEST","type":35}'));
            client.emit("message", "vessels-v2/230123456/location", Buffer.from('{"time":1786622400,"lat":60.1,"lon":24.9,"sog":10}'));
        });
    };
    client.end = () => { ended = true; };
    const provider = createFintrafficProvider({
        connectImpl() {
            setImmediate(() => client.emit("connect"));
            return client;
        },
        initialSnapshotMs: 1,
        connectTimeoutMs: 1000,
        cacheTtlMs: 1_000_000_000_000,
    });

    const first = await provider.fetchObservations();
    const second = await provider.fetchObservations();
    assert.equal(first.observations.length, 1);
    assert.equal(first.observations[0].vessel_name, "FNS TEST");
    assert.equal(second.observations.length, 1);
    assert.equal(subscribeCalls, 1);
    provider.shutdown();
    assert.equal(ended, true);
});

test("Fintraffic failure is isolated from another live naval provider", async () => {
    resetProviderHealth();
    const unavailable = { id: "fintraffic", enabled: true, async fetchObservations() { throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); } };
    const working = { id: "aisstream", enabled: true, async fetchObservations() { return [{ source: "aisstream", mmsi: "123456789" }]; } };
    const results = await runConfiguredProviders("ais", [unavailable, working], { logger: { log() {}, warn() {} } });
    assert.equal(results.length, 1);
    assert.equal(results[0].provider.id, "aisstream");
});
