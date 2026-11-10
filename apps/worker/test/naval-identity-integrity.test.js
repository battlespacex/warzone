import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as Cesium from "cesium";
import { resolveNavalIdentity, selectVerifiedNavalModel } from "../../shared/naval-identity.js";
import { qualifyMilitaryVessel, buildNavalTrack, runAisWorker } from "../src/ais-worker.js";
import { mergeNavalObservations } from "../src/tracking/merge.js";
import { normalizeNavalObservation } from "../src/tracking/naval/normalize.js";
import { processAisStreamMessage } from "../src/tracking/naval/providers/aisstream.js";
import { buildPrivateNavalHistoryRows } from "../src/naval-private-history.js";

const observed = "2026-11-10T12:00:00Z";
const justice = { mmsi: "367605850", callsign: "WDH3254", vessel_name: "HMS JUSTICE", country: "United States",
    ship_type: "Towing", ship_type_code: 31, observed_at: observed };
// All military examples are isolated fixtures; no fictional registry is installed in runtime.
const record = (changes = {}) => ({ status: "verified", source: "test fixture registry", verified_at: "2026-11-01T12:00:00Z",
    identifiers: { mmsi: "999000001", imo: "9999999", callsign: "FIXTURE" }, military_status: "military",
    vessel_name: "Fixture vessel", operator: "Fixture operator", naval_force: "US Navy", flag_state: "United States",
    category: "carrier", ship_class: "Fixture carrier class", length_m: 330, ...changes });
const vessel = (r) => ({ ...r.identifiers, observed_at: observed, metadata: { identity_verification: r } });

test("HMS JUSTICE is commercial towing despite HMS, Royal Navy and an explicit carrier override", () => {
    const input = { ...justice, operator: "Royal Navy", model_code: "Carrier-HMS", category: "military" };
    const identity = resolveNavalIdentity(input);
    assert.equal(identity.military_status, "commercial"); assert.equal(identity.category, "tug");
    assert.equal(identity.operator, ""); assert.equal(identity.naval_force, "");
    assert.equal(selectVerifiedNavalModel(identity), "");
    assert.equal(qualifyMilitaryVessel({ mmsi: justice.mmsi, name: justice.vessel_name, callSign: justice.callsign,
        shipType: "Towing", providerMilitaryFlag: true }).accepted, false);
    const commercial = record({ identifiers: { mmsi: justice.mmsi, callsign: justice.callsign },
        military_status: "commercial", category: "tug", operator: "Centerline Logistics", naval_force: "", ship_class: "" });
    assert.equal(resolveNavalIdentity(justice, { records: [commercial] }).operator, "Centerline Logistics");
});

test("verified carrier and Zumwalt destroyer receive compatible models; other categories stay honest markers", () => {
    for (const [r, model] of [[record(), "Carrier-US"],
        [record({ category: "destroyer", ship_class: "Zumwalt class", length_m: 190 }), "Vessel-Zumwalt"]]) {
        assert.equal(selectVerifiedNavalModel(resolveNavalIdentity(vessel(r))), model);
    }
    for (const category of ["tug", "patrol", "cruiser", "corvette", "submarine", "landing_ship", "auxiliary", "logistics", "unknown"]) {
        assert.equal(selectVerifiedNavalModel(resolveNavalIdentity(vessel(record({ category })))), "", category);
    }
    assert.equal(selectVerifiedNavalModel(resolveNavalIdentity(vessel(record({ category: "destroyer", ship_class: "Other class" })))), "");
    assert.equal(selectVerifiedNavalModel(resolveNavalIdentity({ model_code: "Carrier-US", country: "United States" })), "");
});

test("prefixes, flag state, AIS type and confidence never establish verified military identity", () => {
    for (const prefix of ["HMS", "USS", "INS", "HMAS", "HMCS", "KRI", "ROKS", "FGS"]) {
        const identity = resolveNavalIdentity({ mmsi: "999000002", vessel_name: `${prefix} TEST`, country: "United States",
            ship_type: 35, source_confidence: 95, qualification_level: "confirmed" });
        assert.equal(identity.military_status, "unknown"); assert.equal(identity.verification_status, "unverified");
        assert.equal(identity.naval_force, ""); assert.equal(selectVerifiedNavalModel(identity), "");
    }
});

test("verified identity supports global forces without name or nationality inference", () => {
    for (const force of ["Indian Navy", "German Navy", "JMSDF", "PLA Navy", "Turkish Navy", "Brazilian Navy"]) {
        const r = record({ naval_force: force, category: "patrol", ship_class: "", length_m: 45 });
        const identity = resolveNavalIdentity(vessel(r));
        assert.equal(identity.naval_force, force); assert.equal(identity.military_status, "military");
    }
});

test("mismatched identifiers, contradictory registries and expired records cannot authorize a military model", () => {
    const r = record();
    for (const input of [{ ...vessel(r), imo: "8888888" },
        { ...vessel(r), callsign: "OTHER" },
        { mmsi: "888000001", vessel_name: r.vessel_name, metadata: { identity_verification: r } }]) {
        assert.notEqual(resolveNavalIdentity(input).verification_status, "verified");
        assert.equal(selectVerifiedNavalModel(resolveNavalIdentity(input)), "");
    }
    assert.equal(resolveNavalIdentity(vessel(r), { records: [record({ military_status: "commercial" })] }).verification_status, "conflict");
    assert.equal(resolveNavalIdentity(vessel(record({ valid_until: "2025-01-01" }))).verification_status, "unverified");
    assert.equal(resolveNavalIdentity({ ...vessel(r), ship_type: 31 }).verification_status, "conflict");
    assert.equal(resolveNavalIdentity({ ...vessel(r), length_m: 24 }).verification_status, "conflict");
});

const observation = (changes = {}) => ({ provider: "fixture", source: "fixture", priority: 0, observed_at: observed,
    mmsi: "999000001", imo: "9999999", callsign: "FIXTURE", vessel_name: "SHARED NAME",
    latitude: 30, longitude: 50, ship_type: 35, ...changes });

test("shared names do not merge identities and conflicting IMO values remain explicit", () => {
    const distinct = mergeNavalObservations([observation(), observation({ mmsi: "999000002", imo: "8888888" }),
        observation({ mmsi: "", imo: "", callsign: "" })]);
    assert.equal(distinct.length, 2);
    const conflict = mergeNavalObservations([observation(), observation({ source: "other", imo: "8888888" })])[0];
    assert.equal(conflict.imo, "");
    assert.equal(resolveNavalIdentity(conflict).verification_status, "conflict");
});

test("missing position observation time never becomes receipt time or a fresh track", () => {
    for (const time of [undefined, null, "", "invalid"]) {
        const value = normalizeNavalObservation("fixture", { ...observation(), observed_at: time }, { now: Date.now() });
        assert.equal(value.observed_at, null); assert.equal(mergeNavalObservations([value]).length, 0);
    }
    const result = processAisStreamMessage({ MessageType: "PositionReport", MetaData: { MMSI: 367605850 },
        Message: { PositionReport: { Latitude: 30, Longitude: 50 } } }, { cache: new Map(), now: Date.now() });
    assert.equal(result.observation, null);
});

test("name-only candidates remain unverified and old name qualifications cannot become confirmed history", () => {
    const qualification = qualifyMilitaryVessel({ name: "HMS EXAMPLE", mmsi: "999000001", shipType: 0 });
    assert.equal(qualification.reason, "unverified_name_hint");
    const track = buildNavalTrack({ name: "HMS EXAMPLE", mmsi: "999000001", trackIdentity: "999000001", lat: 30, lon: 50 });
    assert.equal(track.category, "unverified"); assert.equal(track.metadata.military_status, "unknown");
    const history = buildPrivateNavalHistoryRows([{ mmsi: "999000001", name: "HMS EXAMPLE", lat: 30, lon: 50,
        observedAt: observed, qualificationReason: "military_name_match" }]);
    assert.equal(history.assets[0].qualification_level, "probable");
});

const source = fs.readFileSync(new URL("../../../dev/assets/js/warzone-live-naval.js", import.meta.url), "utf8");
function frontend() {
    const flights = [], frames = [], entries = new Map(); let generation = 0, active = null;
    const camera = { positionWC: new Cesium.Cartesian3(1e7, 2e7, 3e7), directionWC: new Cesium.Cartesian3(0, 1, 0),
        upWC: new Cesium.Cartesian3(0, 0, 1), cancelFlight() {}, lookAtTransform() {},
        flyTo(options) { flights.push({ type: "restore", options }); },
        flyToBoundingSphere(sphere, options) { flights.push({ type: "focus", sphere, options }); } };
    const controller = { canEnterFocus: () => true, getState: () => ({ assetType: active ? "naval" : "", assetId: active || "" }),
        getGeneration: () => generation, isCurrent: (value) => value === generation,
        isActiveAsset: (key, type) => key === active && type === "naval",
        enterFocus({ assetId }) { active = assetId; generation++; return true; },
        exitFocus() { active = null; generation++; } };
    const viewer = { camera, isDestroyed: () => false, entities: { getById: (id) => entries.get(id) },
        scene: { requestRender() {} }, __warzone: {} };
    const context = vm.createContext({ Cesium, resolveNavalIdentity, selectVerifiedNavalModel, console,
        window: { __warzoneViewer: viewer }, document: {}, performance, requestAnimationFrame: (fn) => frames.push(fn),
        getAssetFocusController: () => controller });
    vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace(/^export /gm, ""), context);
    vm.runInContext(`getCssNumber=(_name, fallback)=>fallback;
        hideNavalHoverLabel=()=>{};setNavalFocusedZoomLock=()=>{};closeFocusDriftWarningModal=()=>{};
        scheduleNavalRenderReconcile=()=>{};requestNavalRenderBatched=()=>{};syncNavalWidgetHighlight=()=>{};
        emitNavalFocusChanged=()=>{};dispatchNavalRegistryUpdate=()=>{};syncNavalOverlay=()=>{};
        applyNavalVisual=()=>{};syncNavalContourCenter=()=>{};bindNavalOverlay=()=>{};bindNavalPicking=()=>{};
        syncFocusedNavalCamera=()=>{};__navalState.renderEnabled=true;`, context);
    return { context, viewer, controller, flights, frames, entries,
        state: vm.runInContext("__navalState", context) };
}

test("frontend ignores explicit carrier codes and has no country-default warship fallback", () => {
    const { context } = frontend();
    assert.equal(context.resolveNavalAssetKey({ ...justice, model_code: "Carrier-HMS" }), "Neutral");
    assert.equal(context.resolveNavalModelUri(justice), "");
    for (const country of ["United States", "United Kingdom", "China", "India", "Russia"]) {
        assert.equal(context.resolveNavalAssetKey({ country, subcategory: "naval" }), "Neutral");
    }
    assert.equal(context.resolveVesselAffiliation({ country: "United States", hintText: "HMS JUSTICE" }).operator, "");
    assert.equal(context.resolveNavalLastSeenAt({ updated_at: observed }), 0);
});

test("verified model dimensions are independent of focused UI scaling and pixel inflation", () => {
    const { context } = frontend();
    const v = vessel(record());
    assert.equal(context.resolveNavalAssetKey(v), "Carrier-US");
    assert.ok(Math.abs(context.getNavalModelScale(v) * 41.16168 - 330) < .001);
    assert.equal(context.getNavalModelScale(v), context.getFocusedNavalModelScale(v));
    assert.equal(context.getNavalModelMinPixelSize(v), 0);
    assert.equal(context.getNavalModelMaxScale(v), context.getNavalModelScale(v));
    assert.ok(source.includes("heightReference: Cesium.HeightReference.NONE"));
});

test("naval user Unfocus restores the saved view, clears focus and guards obsolete flight callbacks", () => {
    const h = frontend();
    const position = Cesium.Cartesian3.fromDegrees(50, 30);
    h.state.vessels.set("a", { entity: { position: new Cesium.ConstantPositionProperty(position) }, data: { track_key: "a", lat: 30, lon: 50 } });
    const original = Cesium.Cartesian3.clone(h.viewer.camera.positionWC);
    assert.equal(h.context.focusNavalVessel("a"), true);
    assert.equal(h.flights[0].type, "focus");
    h.viewer.camera.positionWC = Cesium.Cartesian3.fromDegrees(50, 30, 1000);
    h.context.clearNavalSelection({ resetCamera: true });
    assert.equal(h.state.selectedKey, null); assert.equal(h.state.isCameraFlying, false);
    assert.equal(h.flights.at(-1).type, "restore");
    assert.deepEqual(h.flights.at(-1).options.destination, original);
    const oldFlight = h.flights.at(-1);
    h.context.focusNavalVessel("a");
    oldFlight.options.complete();
    assert.equal(h.state.isCameraFlying, true, "old Unfocus must not clear a new focus flight");
    while (h.frames.length) h.frames.shift()();
    const count = h.flights.length;
    h.context.clearNavalSelection();
    assert.equal(h.flights.length, count, "region/layer cleanup must not fly back");
});

test("neutral admission retains hundreds of records without creating GLBs or independent polls", () => {
    const { context } = frontend();
    for (let i = 0; i < 400; i++) assert.equal(context.resolveNavalModelUri({ mmsi: `999${String(i).padStart(6, "0")}`, country: "United States" }), "");
    assert.equal((source.match(/function resolveNavalAssetKey\(/g) || []).length, 1);
});

test("frontend removes commercial legacy records and keeps registry identity across unverified refreshes", () => {
    const h = frontend(); h.state.renderEnabled = false;
    const event = { dedupe_key: "ais-367605850", source_name: "AIS fixture", title: "HMS JUSTICE", lat: 30, lon: 50,
        occurred_at: observed, metadata: { mmsi: justice.mmsi, call_sign: justice.callsign, ship_type: 31, vessel_name: justice.vessel_name } };
    h.state.vessels.set(event.dedupe_key, { data: { mmsi: justice.mmsi }, entity: null });
    h.context.upsertNavalVessel(event);
    assert.equal(h.state.vessels.has(event.dedupe_key), false);
    const r = record();
    const verified = { ...event, dedupe_key: "ais-999000001", metadata: { mmsi: r.identifiers.mmsi,
        imo: r.identifiers.imo, call_sign: r.identifiers.callsign, vessel_name: "Spoofed name", ship_type: 35, identity_verification: r } };
    h.context.upsertNavalVessel(verified);
    let saved = h.state.vessels.get(verified.dedupe_key).data;
    assert.equal(saved.operator, r.operator); assert.equal(saved.vessel_name, r.vessel_name);
    assert.equal(saved.naval_force, "US Navy"); assert.equal(h.context.resolveNavalAssetKey(saved), "Carrier-US");
    const { identity_verification, ...metadata } = verified.metadata;
    h.context.upsertNavalVessel({ ...verified, occurred_at: "2026-11-10T12:00:01Z", metadata: { ...metadata, operator: "Royal Navy" } });
    saved = h.state.vessels.get(verified.dedupe_key).data;
    assert.equal(saved.operator, r.operator); assert.equal(saved.naval_force, "US Navy");
    assert.equal(saved.verification_status, "verified");
});

test("verified registry provenance travels through the worker into the frontend contract without new providers", async () => {
    const previous = process.env.NAVAL_VERIFIED_IDENTITIES_JSON;
    const r = record(); const tracks = [], events = [];
    try {
        process.env.NAVAL_VERIFIED_IDENTITIES_JSON = JSON.stringify([r]);
        await runAisWorker({ providers: [{ id: "fixture-registry-test", priority: 0, enabled: true,
            async fetchObservations() { return { observations: [observation({ source: "fixture-registry-test", provider: "fixture-registry-test" })] }; } }],
            persistence: { async upsertEvents(rows) { events.push(...rows); }, async upsertTracks(rows) { tracks.push(...rows); },
                async upsertHistory() {}, async endAliases() {} }, logger: { log() {}, warn() {} } });
        assert.equal(tracks.length, 1); assert.equal(events.length, 1);
        assert.equal(tracks[0].metadata.identity_verification.source, "test fixture registry");
        assert.equal(tracks[0].metadata.observed_at, observed);
        assert.equal(tracks[0].category, "military");
        const identity = resolveNavalIdentity(tracks[0]);
        assert.equal(identity.naval_force, "US Navy"); assert.equal(selectVerifiedNavalModel(identity), "Carrier-US");
    } finally {
        if (previous === undefined) delete process.env.NAVAL_VERIFIED_IDENTITIES_JSON;
        else process.env.NAVAL_VERIFIED_IDENTITIES_JSON = previous;
    }
});
