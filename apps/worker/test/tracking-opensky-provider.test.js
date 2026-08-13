import test from "node:test";
import assert from "node:assert/strict";

import {
    createOpenSkyProvider,
    hasOpenSkyMilitaryEvidence,
    normalizeOpenSkyState,
    resetOpenSkyToken,
} from "../src/tracking/aircraft/providers/opensky.js";
import { normalizeAdsbLolAircraft } from "../src/tracking/aircraft/providers/adsb-lol.js";
import { mergeAircraftObservations, selectAircraftMilitaryCandidates } from "../src/tracking/merge.js";

const NOW_SECONDS = Date.parse("2026-08-13T12:00:00Z") / 1000;

function response(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get() { return null; } },
        async json() { return payload; },
        async text() { return JSON.stringify(payload); },
    };
}

test("OpenSky refreshes an expired OAuth token once after a states 401", async () => {
    resetOpenSkyToken();
    const requests = [];
    const replies = [
        response(200, { access_token: "old-token", expires_in: 1800 }),
        response(401, { error: "expired" }),
        response(200, { access_token: "new-token", expires_in: 1800 }),
        response(200, { states: [["abc123", "RCH123", "United States", 1_786_622_395, 1_786_622_400, -79, 43, 1000, false, 100, 90, 0, null, null, "1234"]] }),
    ];
    const fetchImpl = async (url, options) => {
        requests.push({ url: String(url), authorization: options?.headers?.Authorization || "" });
        return replies.shift();
    };
    const provider = createOpenSkyProvider({
        enabled: true,
        clientId: "client-id",
        clientSecret: "client-secret",
        fetchImpl,
    });

    const result = await provider.fetchObservations();

    assert.equal(result.observations.length, 1);
    assert.equal(result.observations[0].icao24, "abc123");
    assert.equal(requests[1].authorization, "Bearer old-token");
    assert.equal(requests[3].authorization, "Bearer new-token");
    assert.equal(replies.length, 0);
});

test("OpenSky anonymous state arrays use the documented indexes and SI conversions", async () => {
    let request;
    const provider = createOpenSkyProvider({
        enabled: true,
        fetchImpl: async (url, options) => {
            request = { url: String(url), authorization: options?.headers?.Authorization || "" };
            return response(200, {
                time: NOW_SECONDS,
                states: [[
                    "ae1234", "RCH123  ", "United States", NOW_SECONDS - 5, NOW_SECONDS - 2,
                    -76.60363, 37.12912, 3048, false, 100, 91, 5.08,
                    [123], 3200, "1234", true, 2, 7,
                ]],
            });
        },
    });

    const result = await provider.fetchObservations();
    const aircraft = result.observations[0];

    assert.match(request.url, /[?&]extended=1(?:&|$)/);
    assert.equal(request.authorization, "");
    assert.equal(aircraft.icao24, "ae1234");
    assert.equal(aircraft.callsign, "RCH123");
    assert.equal(aircraft.country, "United States");
    assert.equal(aircraft.time_position, NOW_SECONDS - 5);
    assert.equal(aircraft.last_contact, NOW_SECONDS - 2);
    assert.equal(aircraft.longitude, -76.60363);
    assert.equal(aircraft.latitude, 37.12912);
    assert.ok(Math.abs(aircraft.altitude_ft - 10_000) < 0.1);
    assert.ok(Math.abs(aircraft.altitude_geom_ft - 10_498.688) < 0.1);
    assert.equal(aircraft.on_ground, false);
    assert.ok(Math.abs(aircraft.speed_kts - 194.3844) < 0.001);
    assert.equal(aircraft.heading_deg, 91);
    assert.ok(Math.abs(aircraft.vertical_rate_fpm - 1000) < 0.1);
    assert.equal(aircraft.squawk, "1234");
    assert.equal(aircraft.spi, true);
    assert.equal(aircraft.position_source, "mlat");
    assert.equal(aircraft.position_source_code, 2);
    assert.equal(aircraft.adsb_category, 7);
    assert.equal(aircraft.position_age_seconds, 5);
    assert.equal(result.diagnostics.military_candidates, 1);
});

test("OpenSky country alone does not qualify civilian traffic", () => {
    const civilian = normalizeOpenSkyState([
        "a12345", "UAL123", "United States", NOW_SECONDS - 2, NOW_SECONDS - 1,
        -79, 43, 3000, false, 120, 90, 0, null, 3100, "1200", false, 0, 4,
    ], { now: NOW_SECONDS * 1000 });

    assert.equal(hasOpenSkyMilitaryEvidence(civilian), false);
    assert.equal(selectAircraftMilitaryCandidates([civilian]).length, 0);
});

test("OpenSky military callsign evidence qualifies a candidate", () => {
    const military = normalizeOpenSkyState([
        "a12345", "RCH456", "United States", NOW_SECONDS - 2, NOW_SECONDS - 1,
        -79, 43, 3000, false, 120, 90, 0, null, 3100, "1200", false, 0, 4,
    ], { now: NOW_SECONDS * 1000 });

    assert.equal(military.military_hint, true);
    assert.deepEqual(selectAircraftMilitaryCandidates([military]), [military]);
});

test("ADSB.lol and fresh OpenSky positions merge into one corroborated ICAO track", () => {
    const adsbLol = normalizeAdsbLolAircraft({
        hex: "ae1234", lat: 37.12912, lon: -76.60363, seen_pos: 2,
    }, { now: NOW_SECONDS * 1000 });
    const opensky = normalizeOpenSkyState([
        "ae1234", "RCH123", "United States", NOW_SECONDS - 1, NOW_SECONDS - 1,
        -76.602, 37.13, 3048, false, 100, 90, 0, null, 3200, "1234", false, 0, 7,
    ], { now: NOW_SECONDS * 1000 });
    const canonical = mergeAircraftObservations(selectAircraftMilitaryCandidates([adsbLol, opensky]));

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].identity, "icao:ae1234");
    assert.equal(canonical[0].source_count, 2);
    assert.equal(canonical[0].corroboration, "corroborated");
    assert.deepEqual(canonical[0].sources, ["adsb_lol", "opensky"]);
});

test("stale OpenSky position cannot override fresher ADSB.lol position", () => {
    const adsbLol = normalizeAdsbLolAircraft({
        hex: "ae1234", lat: 37.12912, lon: -76.60363, seen_pos: 1,
    }, { now: NOW_SECONDS * 1000 });
    const staleOpenSky = normalizeOpenSkyState([
        "ae1234", "RCH123", "United States", NOW_SECONDS - 120, NOW_SECONDS - 1,
        -70, 40, 3048, false, 100, 90, 0, null, 3200, "1234", false, 0, 7,
    ], { now: NOW_SECONDS * 1000 });
    const canonical = mergeAircraftObservations(
        selectAircraftMilitaryCandidates([adsbLol, staleOpenSky]),
        { freshnessMs: 90_000 }
    );

    assert.equal(canonical.length, 1);
    assert.equal(canonical[0].latitude, 37.12912);
    assert.equal(canonical[0].longitude, -76.60363);
});
