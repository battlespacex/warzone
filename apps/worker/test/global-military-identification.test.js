import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { normalizeIcao24 } from "../../shared/aircraft-identifiers.js";
import { getAircraftAllocation, resolveAircraftIdentity } from "../../shared/aircraft-identity.js";
import { MILITARY_TAXONOMY } from "../../shared/military-taxonomy.js";
import { resolveNavalIdentity, createNavalIdentityRegistry, validImo, validMmsi, navalCandidateEvidence } from "../../shared/naval-identity.js";
import { maritimeAllocation } from "../../shared/maritime-allocations.js";
import { createPlaneAlertMilitaryDatabase, inspectPlaneAlertMilitaryCsv } from "../src/tracking/aircraft/providers/plane-alert-db.js";
import { importMilitaryAircraft } from "../../../scripts/import-military-aircraft.mjs";
import { runAdsbWorker } from "../src/adsb-worker.js";
import { mergeAircraftObservations, mergeNavalObservations } from "../src/tracking/merge.js";
import { providerPipelineSnapshot, resetProviderHealth, runConfiguredProviders } from "../src/tracking/provider-health.js";
import { isExcludedTrainerAircraftText } from "../../shared/aircraft-trainer-exclusions.js";

const csv = fs.readFileSync(new URL("../data/aircraft/plane-alert-mil.csv", import.meta.url));
const manifest = JSON.parse(fs.readFileSync(new URL("../data/aircraft/plane-alert-mil.csv.manifest.json", import.meta.url)));
const records = inspectPlaneAlertMilitaryCsv(csv.toString(), manifest).records;
const header = "$ICAO,$Registration,$Operator,$Type,$ICAO Type,#CMPG,Category\n";
const logger = { log() {}, warn() {}, error() {} };

test("pinned import verifies original bytes, provenance, all IDs and quarantines bad and conflicting rows", () => {
    assert.equal(createHash("sha256").update(csv).digest("hex"), manifest.sha256);
    assert.equal(records.size, 9854); assert.equal(manifest.validation.rejected.length, 2);
    assert.equal(manifest.validation.duplicates.length, 0);
    assert.ok([...records.values()].every(r => /^[a-f0-9]{6}$/.test(r.icao24) && r.source_version === manifest.version));
    const audit = inspectPlaneAlertMilitaryCsv(header + "001234,REG,Fixture Air Force,F-16,F16,Mil,Test\n001234,REG,Fixture Air Force,F-16,F16,Mil,Test\n001235,R1,Fixture Navy,C-17,C17,Mil,Test\n001235,R2,Other Navy,C-17,C17,Mil,Test\n1234,R3,Fixture Navy,F-16,F16,Mil,Test");
    assert.equal(audit.records.size, 1); assert.equal(audit.validation.duplicates.length, 2);
    assert.deepEqual(audit.validation.conflicting_ids, ["001235"]);
    assert.throws(() => inspectPlaneAlertMilitaryCsv("<html>error</html>"), /columns/);
    assert.throws(() => importMilitaryAircraft(csv, { version: "main" }), /commit SHA/);
});

test("complete ICAO24 preserves leading zeroes and rejects padding, non-ICAO addresses and reserved values", () => {
    assert.equal(normalizeIcao24("0x00Ab01"), "00ab01");
    for (const id of ["AB01", "~ae1234", "ae-1234", "ae12345", "000000", "ffffff", "", null]) assert.equal(normalizeIcao24(id), "");
});

test("official allocation boundaries replace inaccurate prefixes without granting military status", () => {
    for (const [id, iso] of [["300001", "IT"], ["3d0000", "DE"], ["4b9000", "TR"], ["710001", "SA"],
        ["718001", "KR"], ["e40001", "BR"], ["00b896", "ZA"], ["06a001", "QA"], ["896001", "AE"]]) {
        assert.equal(getAircraftAllocation(id).iso2, iso);
        assert.equal(resolveAircraftIdentity({ icao24: id }).qualified, false);
    }
    assert.equal(getAircraftAllocation("4b0000"), null, "unimplemented Swiss allocation must not be labelled Turkish");
});

test("all required aircraft families need ownership evidence; dual-use transports and tankers can qualify", () => {
    for (const type of ["F-16", "F/A-18", "F-22", "F-35", "Su-30", "Su-35", "Rafale", "Typhoon", "J-10", "JF-17",
        "AH-64", "UH-60", "CH-47", "C-130", "C-17", "KC-135", "E-3", "P-8", "A330", "B738"]) {
        assert.equal(resolveAircraftIdentity({ icao24: "ae1234", aircraft_type: type }).qualified, false, type);
        const identity = resolveAircraftIdentity({ icao24: "ae1234", aircraft_type: type, operator: "Fixture Air Force" });
        assert.equal(identity.qualified, true, type); assert.equal(identity.confidence, "strongly_supported_military");
    }
    assert.equal(resolveAircraftIdentity({ icao24: "a00001", model: "Civilian helicopter", operator: "Example Airlines" }).qualified, false);
    for(const operator of ["Navy Blue Aviation", "Army Air Charter", "Air Force Leasing"]) assert.equal(resolveAircraftIdentity({icao24:"a00001",operator}).qualified,false);
    assert.equal(isExcludedTrainerAircraftText("Pilatus PC-21 Trainer"), true);
    assert.equal(isExcludedTrainerAircraftText("FA-50 combat aircraft"), false);
    for (const country of MILITARY_TAXONOMY.countries) {
        assert.equal(resolveAircraftIdentity({ icao24: "ae1234", country: country.country,
            operator: country.air_services.join("; ") }).qualified, true, country.country);
    }
});

test("required military families retain their operational role through the real worker pipeline",async()=>{
    resetProviderHealth();const cases=[['F16','fighter'],['F18','fighter'],['F22','fighter'],['F35','fighter'],
        ['SU30','fighter'],['SU35','fighter'],['RFAL','fighter'],['EUFI','fighter'],['J10','fighter'],['JF17','fighter'],
        ['H64','helicopter'],['H60','helicopter'],['H47','helicopter'],['C130','transport'],['C17','transport'],
        ['K35R','tanker'],['E3TF','awacs'],['P8','isr']];
    const observations=cases.map(([aircraft_type],i)=>({icao24:(0xae8000+i).toString(16),aircraft_type,
        operator:'Fixture Air Force',latitude:20,longitude:30,observed_at:'2026-11-15T10:00:00Z',source:'family-fixture'}));
    const tracks=[];
    await runAdsbWorker({providers:[{id:'family-fixture',enabled:true,async fetchObservations(){return observations;}}],logger,
        persistence:{async upsertEvents(){},async upsertTracks(rows){tracks.push(...rows);return rows.length;},async upsertHistory(){}}});
    assert.equal(tracks.length,cases.length);
    cases.forEach(([type,role],i)=>assert.equal(tracks.find(track=>track.metadata.icao===observations[i].icao24)?.subcategory,role,type));
});

test("exact community registry matches retain evidence and registration conflicts remain ambiguous", async () => {
    const record = records.values().next().value;
    const supported = resolveAircraftIdentity({ icao24: record.icao24 }, { record });
    assert.equal(supported.confidence, "strongly_supported_military");
    assert.equal(supported.evidence[0].version, manifest.version);
    const conflict = resolveAircraftIdentity({ icao24: record.icao24, registration: "CONFLICT-TEST" }, { record });
    assert.equal(conflict.qualified, false); assert.deepEqual(conflict.conflicts, ["registration_conflict"]);
    let requests = 0;
    const db = createPlaneAlertMilitaryDatabase({ fetchImpl: () => { requests++; throw new Error("unexpected request"); } });
    await db.initialize(); await db.initialize({ forceRefresh: true });
    assert.equal(requests, 0); assert.equal(db.getDiagnostics().records, 9854);
    const enriched = await db.enrichObservations([{ icao24: record.icao24, registration: "CONFLICT-TEST" }]);
    assert.notEqual(enriched.observations[0].military_hint, true);
    const missing = createPlaneAlertMilitaryDatabase({ bundledFile: new URL("./missing-registry.csv", import.meta.url).pathname,
        fetchImpl: () => { requests++; throw new Error("unexpected request"); } });
    await assert.rejects(missing.initialize(), /Missing pinned/); assert.equal(requests,0);
});

test("genuine world reference identities pass worker qualification without creating registry-only tracks", async () => {
    resetProviderHealth(); const observed = "2026-11-15T10:00:00Z";
    const representatives = new Map();
    for (const record of records.values()) if (record.country && !isExcludedTrainerAircraftText(record.model)) representatives.set(record.country, record);
    const observations = [...representatives.values()].map((record, i) => ({ source: "fixture-global", icao24: record.icao24,
        registration: record.registration, latitude: 10 + i / 100, longitude: 40, observed_at: observed, altitude_ft: 20000 }));
    const tracks = [];
    const result = await runAdsbWorker({ providers: [{ id: "fixture-global", enabled: true, async fetchObservations() { return observations; } },
        createPlaneAlertMilitaryDatabase()], now: Date.parse(observed), logger,
        persistence: { async upsertEvents() {}, async upsertTracks(rows) { tracks.push(...rows); return rows.length; }, async upsertHistory() {} } });
    assert.equal(result.canonical, observations.length); assert.ok(tracks.length > 25);
    assert.ok(tracks.every(row => row.metadata.aircraft_identity.qualified && row.metadata.aircraft_identity.evidence[0].version === manifest.version));
    assert.equal(MILITARY_TAXONOMY.countries.length, 45);
});

test("multi-provider deduplication preserves exact identity conflicts and global records", () => {
    const base = { icao24: "ae1234", latitude: 20, longitude: 50, observed_at: "2026-11-15T10:00:00Z" };
    const merged = mergeAircraftObservations([{ ...base, source: "a", priority: 1 }, { ...base, source: "b", priority: 2,
        metadata: { aircraft_identity: { qualified: false, conflicts: ["registration_conflict"] } } }]);
    assert.equal(merged.length, 1); assert.equal(merged[0].source_count, 2);
    assert.equal(merged[0].metadata.aircraft_identity.qualified, false);
    assert.equal(base.latitude, 20);
    const fresh=mergeAircraftObservations([{...base,source:'a',metadata:{aircraft_identity:{qualified:true,conflicts:[]}}},
        {...base,source:'b',observed_at:'2026-11-15T09:00:00Z',metadata:{aircraft_identity:{qualified:false,conflicts:['registration_conflict']}}}]);
    assert.equal(fresh[0].metadata.aircraft_identity.qualified,true,'expired identity conflicts must not override fresh evidence');
});

test("naval registry indexes verified identifiers, keeps conflicts and rejects invalid checksums", () => {
    assert.equal(validMmsi("316011515"), true); assert.equal(validMmsi("31601151"), false);
    assert.equal(validImo("9074729"), true); assert.equal(validImo("9074728"), false);
    const record = { status: "verified", source: "isolated fixture", verified_at: "2026-11-01T00:00:00Z",
        identifiers: { mmsi: "316011515", imo: "9074729" }, military_status: "military", category: "patrol", operator: "Fixture Navy" };
    const registry = createNavalIdentityRegistry([record, record, { ...record, operator: "Other fixture Navy" }, { ...record, identifiers: { imo: "9074728" } }]);
    assert.equal(registry.validation.duplicates, 1); assert.equal(registry.validation.rejected.length, 1);
    assert.equal(resolveNavalIdentity({ ...record.identifiers }, { records: registry }).verification_status, "conflict");
    assert.equal(maritimeAllocation("316011515").administrations[0], "Canada");
    for (const country of MILITARY_TAXONOMY.countries) assert.equal(resolveNavalIdentity({ mmsi: "316011515", country: country.country }).verification_status, "unverified");
    assert.equal(navalCandidateEvidence({ vessel_name: "USS TEST", ship_type: 70 }).confidence, "unknown");
    const merged = mergeNavalObservations([{ source: "a", mmsi: "316011515", latitude: 20, longitude: 50, observed_at: "2026-11-15T10:00:00Z" },
        { source: "b", mmsi: "316011515", latitude: 20, longitude: 50, observed_at: "2026-11-15T10:00:00Z" }]);
    assert.equal(merged.length, 1); assert.equal(merged[0].source_count, 2);
});

test("provider failure is isolated and diagnostic snapshot never calls adapters or exposes credentials", async () => {
    resetProviderHealth();
    const providers = [{ id: "good-fixture", enabled: true, async fetchObservations() { return [{ icao24: "ae1234" }]; } },
        { id: "bad-fixture", enabled: true, async fetchObservations() { throw Object.assign(new Error("secret"), { status: 403 }); } },
        { id: "disabled-fixture", enabled: false, disabledReason: "MISSING_CREDENTIALS", apiKey: "secret" }];
    const results = await runConfiguredProviders("identity-test", providers, { logger });
    assert.equal(results.length, 1);
    const snapshot = providerPipelineSnapshot("identity-test", providers);
    assert.equal(snapshot[0].status, "HEALTHY"); assert.equal(snapshot[1].status, "BACKOFF"); assert.equal(snapshot[2].status, "DISABLED");
    assert.ok(!JSON.stringify(snapshot).includes("secret"));
});
