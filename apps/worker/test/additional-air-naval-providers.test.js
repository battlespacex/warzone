import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKystverketFeature, createKystverketProvider } from "../src/tracking/naval/providers/kystverket.js";
import { createAdsbFiProvider } from "../src/tracking/aircraft/providers/adsb-fi.js";
import { createBarentsWatchProvider, normalizeBarentsWatchVessel } from "../src/tracking/naval/providers/barentswatch.js";
import { createAircraftProviders } from "../src/tracking/aircraft/registry.js";
import { createNavalProviders } from "../src/tracking/naval/registry.js";

const now = Date.parse("2026-11-03T12:00:00Z");
const makeFeature = (props = {}, geometry = { type: "LineString", coordinates: [[10, 60], [11, 61]] }) =>
    ({ type: "Feature", properties: { mmsi: 257011940, name: "TEST VESSEL",
        msgtime: "2026-11-03T11:55:00Z", ...props }, geometry });

test("Norwegian AIS uses final observed LineString point", () => {
    const row = normalizeKystverketFeature(makeFeature(), { now });
    assert.equal(row.mmsi, "257011940");
    assert.equal(row.longitude, 11);
    assert.equal(row.latitude, 61);
    assert.equal(row.source, "kystverket");
    assert.equal(row.provider_military_flag, false);
});
test("Norwegian AIS excludes stale, future and invalid observations", () => {
    assert.equal(normalizeKystverketFeature(makeFeature({ msgtime: "2026-11-02T00:00:00Z" }), { now }), null);
    assert.equal(normalizeKystverketFeature(makeFeature({ msgtime: "2026-11-04T00:00:00Z" }), { now }), null);
    assert.equal(normalizeKystverketFeature(makeFeature({ mmsi: "abc" }), { now }), null);
    assert.equal(normalizeKystverketFeature(makeFeature({}, { type: "Point", coordinates: [999, 66] }), { now }), null);
});
test("Norwegian AIS limits polling and is disabled by default", () => {
    const p = createKystverketProvider({ enabled: false, minimumIntervalMs: 1000 });
    assert.equal(p.enabled, false);
    assert.equal(p.minimumIntervalMs, 900000);
});
test("ADSB.fi cannot turn on without explicit licensing approval", () => {
    assert.equal(createAdsbFiProvider({ enabled: true }).enabled, false);
    assert.equal(createAdsbFiProvider({ enabled: true }).disabledReason, "LICENSE_APPROVAL_REQUIRED");
    assert.equal(createAdsbFiProvider({ enabled: true, licenseApproved: true }).enabled, true);
});
test("both registries default to disabled new sources", () => {
    const aircraft = createAircraftProviders({});
    assert.equal(aircraft.find(p => p.id === "adsb_fi").enabled, false);
    const naval = createNavalProviders({});
    assert.equal(naval.find(p => p.id === "kystverket").enabled, false);
});

test("BarentsWatch latest vessel observations normalize without assuming military identity", () => {
    const row = normalizeBarentsWatchVessel({
        mmsi: 257011940, name: "BALDER", latitude: 69.543985, longitude: 17.769428,
        speedOverGround: 0, courseOverGround: 356.7, msgtime: "2026-11-03T11:55:00Z"
    }, { now });
    assert.equal(row.mmsi, "257011940");
    assert.equal(row.source, "barentswatch");
    assert.equal(row.latitude, 69.543985);
    assert.equal(row.military_hint, false);
});
test("BarentsWatch requires configured OAuth credentials and enforces 10 minute polling", () => {
    assert.equal(createBarentsWatchProvider({ enabled: true }).enabled, false);
    const p = createBarentsWatchProvider({ enabled: true, clientId: "test", clientSecret: "test", minimumIntervalMs: 1000 });
    assert.equal(p.enabled, true);
    assert.equal(p.minimumIntervalMs, 600000);
});
