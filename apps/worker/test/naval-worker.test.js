import test from "node:test";
import assert from "node:assert/strict";

import { buildNavalTrack, qualifyMilitaryVessel, runAisWorker } from "../src/ais-worker.js";
import { resetProviderHealth } from "../src/tracking/provider-health.js";

function navalProvider(id, offset = 0) {
    return {
        id,
        enabled: true,
        priority: offset,
        async fetchObservations() {
            return {
                observations: [{
                    domain: "naval",
                    source: id,
                    provider: id,
                    observed_at: `2026-08-13T12:00:0${offset}Z`,
                    mmsi: "368123456",
                    imo: "9876543",
                    vessel_name: "USS EXAMPLE",
                    callsign: "NAVY1",
                    latitude: 36 + offset * 0.0001,
                    longitude: -72 + offset * 0.0001,
                    speed_kts: 12,
                    heading_deg: 90,
                    ship_type: 35,
                    provider_military_flag: true,
                    military_hint: true,
                }],
                diagnostics: { fetched: 1, normalized: 1, valid: 1 },
            };
        },
    };
}

test("five-provider vessel produces one canonical Supabase track upsert", async () => {
    resetProviderHealth();
    const providers = ["aisstream", "aishub", "spire", "marinetraffic", "vesselfinder"].map(navalProvider);
    const calls = { events: [], tracks: [], history: [], aliases: [] };
    const persistence = {
        async upsertEvents(rows) { calls.events.push(rows); },
        async upsertTracks(rows) { calls.tracks.push(rows); return rows.length; },
        async upsertHistory(rows) { calls.history.push(rows); },
        async endAliases(rows) { calls.aliases.push(rows); },
    };
    const result = await runAisWorker({ providers, persistence, logger: { log() {}, warn() {} } });

    assert.equal(result.canonical, 1);
    assert.equal(result.corroborated, 1);
    assert.equal(result.upserted, 1);
    assert.equal(calls.tracks.length, 1);
    assert.equal(calls.tracks[0].length, 1);
    assert.equal(calls.tracks[0][0].track_key, "ais-368123456");
    assert.equal(calls.tracks[0][0].metadata.source_count, 5);
    assert.equal(calls.tracks[0][0].metadata.corroboration, "multi-source");
});

test("repeated MMSI observations keep the same canonical track key", () => {
    const first = buildNavalTrack({
        mmsi: "368123456", trackIdentity: "368123456", name: "USS EXAMPLE", lat: 36, lon: -72,
        lastSourceObservations: [], sourceCount: 1, corroboration: "single-source",
    });
    const second = buildNavalTrack({
        mmsi: "368123456", trackIdentity: "368123456", name: "USS EXAMPLE", lat: 36.1, lon: -71.9,
        lastSourceObservations: [], sourceCount: 1, corroboration: "single-source",
    });
    assert.equal(first.track_key, "ais-368123456");
    assert.equal(second.track_key, first.track_key);
});

test("naval tracks round decimal AIS motion values for integer database columns", () => {
    const track = buildNavalTrack({
        mmsi: "368123456", trackIdentity: "368123456", name: "USS EXAMPLE", lat: 36, lon: -72,
        speed: 9.1, heading: 127.6, lastSourceObservations: [], sourceCount: 1,
        corroboration: "single-source",
    });

    assert.equal(track.speed_kts, 9);
    assert.equal(track.heading_deg, 128);
});

test("naval history persistence uses the numeric AIS ship type code", async () => {
    resetProviderHealth();
    let historyRows = [];
    const provider = navalProvider("aisstream");
    provider.fetchObservations = async () => ({ observations: [{
        domain: "naval", source: "aisstream", observed_at: "2026-08-13T12:00:00Z",
        mmsi: "368123456", vessel_name: "USS EXAMPLE", latitude: 36, longitude: -72,
        ship_type: "Military ops", ship_type_code: 35, provider_military_flag: true,
    }] });
    await runAisWorker({
        providers: [provider],
        persistence: { async upsertEvents() {}, async upsertTracks(rows) { return rows.length; }, async upsertHistory(rows) { historyRows = rows; }, async endAliases() {} },
        logger: { log() {}, warn() {} },
    });
    assert.equal(historyRows[0].ship_type, 35);
});

test("later MMSI reconciles and ends an earlier IMO-only temporary track", async () => {
    resetProviderHealth();
    const aliases = [];
    const persistence = {
        async upsertEvents() {},
        async upsertTracks(rows) { return rows.length; },
        async upsertHistory() {},
        async endAliases(rows) { aliases.push(...rows); },
    };
    const observation = (source, mmsi) => ({
        domain: "naval", source, provider: source, observed_at: new Date().toISOString(),
        mmsi, imo: "7654321", vessel_name: "USS RECONCILE", latitude: 36, longitude: -72,
        ship_type: 35, provider_military_flag: true,
    });
    await runAisWorker({
        providers: [{ id: "spire-temp", enabled: true, priority: 1, async fetchObservations() { return [observation("spire-temp", "")]; } }],
        persistence,
        logger: { log() {}, warn() {} },
    });
    await runAisWorker({
        providers: [{ id: "aisstream-temp", enabled: true, priority: 0, async fetchObservations() { return [observation("aisstream-temp", "368765432")]; } }],
        persistence,
        logger: { log() {}, warn() {} },
    });
    assert.deepEqual(aliases, ["ais-imo-7654321"]);
});

test("military classifier rejects civilian traffic and accepts configured known MMSI", () => {
    assert.deepEqual(
        qualifyMilitaryVessel({ mmsi: "111111111", name: "MV CIVILIAN CARGO", shipType: 70 }, { knownMilitaryMmsi: new Set(), knownMilitaryImo: new Set() }),
        { accepted: false, reason: "rejected_civilian" }
    );
    assert.deepEqual(
        qualifyMilitaryVessel({ mmsi: "368123456", name: "CONTACT", shipType: 0 }, { knownMilitaryMmsi: new Set(["368123456"]), knownMilitaryImo: new Set() }),
        { accepted: true, reason: "known_military_mmsi" }
    );
    assert.deepEqual(
        qualifyMilitaryVessel({ mmsi: "", name: "USS EXAMPLE", shipType: 0 }, { knownMilitaryMmsi: new Set(), knownMilitaryImo: new Set(), knownMilitaryCallsigns: new Set() }),
        { accepted: true, reason: "military_name_match" }
    );
    assert.deepEqual(
        qualifyMilitaryVessel({ mmsi: "", name: "CONTACT", callSign: "NATO1", shipType: 0 }, { knownMilitaryMmsi: new Set(), knownMilitaryImo: new Set(), knownMilitaryCallsigns: new Set(["NATO1"]) }),
        { accepted: true, reason: "known_military_callsign" }
    );
    assert.equal(qualifyMilitaryVessel({ name: "NAVY BLUE", shipType: 70 }, { knownMilitaryMmsi: new Set(), knownMilitaryImo: new Set(), knownMilitaryCallsigns: new Set() }).accepted, false);
    assert.equal(qualifyMilitaryVessel({ name: "IRIS", shipType: "Towing" }, { knownMilitaryMmsi: new Set(), knownMilitaryImo: new Set(), knownMilitaryCallsigns: new Set() }).accepted, false);
});
