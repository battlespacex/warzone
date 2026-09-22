import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAircraftHistoryHandler, eventsRouter } from "../src/routes.events.js";

test("manual aircraft lookup returns only the exact live civilian match", async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths = [];
    globalThis.fetch = async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return new Response(JSON.stringify({ ac: [
            { hex: "abc123", flight: "AC123   ", r: "C-TEST", lat: 43.1, lon: -79.2,
                seen_pos: 2, alt_baro: 12000, gs: 260, track: 90 },
            { hex: "def456", flight: "OTHER", r: "N-OTHER", lat: 43.2, lon: -79.3, seen_pos: 1 },
        ] }), { status: 200 });
    };
    const app = express();
    app.use("/events", eventsRouter({ broadcast: () => {} }));
    const server = app.listen(0, "127.0.0.1");
    try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        const response = await originalFetch(`http://127.0.0.1:${address.port}/events/aircraft/lookup?identifier=ac123`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.track.icao24, "abc123");
        assert.equal(body.track.callsign, "AC123");
        assert.equal(body.track.lat, 43.1);
        assert.deepEqual(requestedPaths.sort(), [
            "/v2/callsign/AC123", "/v2/callsign/ACA123",
            "/v2/registration/AC123", "/v2/registration/ACA123",
        ]);
        requestedPaths.length = 0;
        const hex = await originalFetch(`http://127.0.0.1:${address.port}/events/aircraft/lookup?identifier=ABC123`);
        assert.equal(hex.status, 200);
        assert.equal((await hex.json()).track.icao24, "abc123");
        assert.deepEqual(requestedPaths.sort(), ["/v2/callsign/ABC123", "/v2/hex/ABC123", "/v2/registration/ABC123"]);
        requestedPaths.length = 0;
        const registration = await originalFetch(`http://127.0.0.1:${address.port}/events/aircraft/lookup?identifier=c-test`);
        assert.equal(registration.status, 200);
        assert.equal((await registration.json()).track.registration, "C-TEST");
        const invalid = await originalFetch(`http://127.0.0.1:${address.port}/events/aircraft/lookup?identifier=%2Fmil`);
        assert.equal(invalid.status, 400);
        assert.equal(requestedPaths.length, 2);
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
    }
});

test("manual aircraft lookup resolves IATA and ICAO callsign aliases to one exact aircraft", async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths = [];
    globalThis.fetch = async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return new Response(JSON.stringify({ ac: [
            { hex: "89644d", flight: "UAE9422 ", r: "A6-EQZ", lat: 25.2, lon: 55.3,
                seen_pos: 1, alt_baro: 30000, gs: 470, track: 275 },
            { hex: "896999", flight: "UAE9423", r: "A6-OTHER", lat: 25.3, lon: 55.4, seen_pos: 1 },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const app = express();
    app.use("/events", eventsRouter({ broadcast: () => {} }));
    const server = app.listen(0, "127.0.0.1");
    try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        for (const identifier of ["EK9422", "UAE9422"]) {
            requestedPaths.length = 0;
            const response = await originalFetch(`http://127.0.0.1:${address.port}/events/aircraft/lookup?identifier=${identifier}`);
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.track.icao24, "89644d");
            assert.equal(body.track.callsign, "UAE9422");
            assert.deepEqual(body.meta.aliases.sort(), ["EK 9422", "EK9422", "UAE 9422", "UAE9422"]);
            assert.ok(requestedPaths.includes("/v2/callsign/EK9422"));
            assert.ok(requestedPaths.includes("/v2/callsign/UAE9422"));
        }
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
    }
});

test("manual aircraft lookup maps PK739 and PIA739 to the same exact civilian aircraft", async () => {
    const originalFetch = globalThis.fetch;
    const requestedPaths = [];
    globalThis.fetch = async (url) => {
        requestedPaths.push(new URL(url).pathname);
        return new Response(JSON.stringify({ ac: [
            { hex: "760abc", flight: "PIA739 ", r: "AP-TEST", lat: 33.6, lon: 73.1,
                seen_pos: 1, alt_baro: 31000, gs: 450 },
            { hex: "760abd", flight: "PIA738", r: "AP-OTHER", lat: 33.7, lon: 73.2,
                seen_pos: 1 },
        ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const app = express();
    app.use("/events", eventsRouter({ broadcast: () => {} }));
    const server = app.listen(0, "127.0.0.1");
    try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        for (const identifier of ["PK739", "PIA739"]) {
            requestedPaths.length = 0;
            const response = await originalFetch(`http://127.0.0.1:${address.port}/events/aircraft/lookup?identifier=${identifier}`);
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.track.icao24, "760abc");
            assert.equal(body.track.callsign, "PIA739");
            assert.deepEqual(body.meta.aliases.sort(), ["PIA 739", "PIA739", "PK 739", "PK739"]);
            assert.ok(requestedPaths.includes("/v2/callsign/PK739"));
            assert.ok(requestedPaths.includes("/v2/callsign/PIA739"));
        }
    } finally {
        globalThis.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
    }
});

test("focused aircraft history returns only persisted points for the requested identity", async () => {
    let requestedKeys = [];
    const rows = [
        { track_key: "adsb-89644d", lat: 25.1, lon: 55.2, altitude_ft: 29000,
            speed_kts: 460, heading_deg: 275, status: "active", last_seen_at: "2026-09-21T12:00:00.000Z" },
    ];
    const query = {
        select() { return this; },
        in(_column, values) { requestedKeys = values; return this; },
        gte() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
    };
    const app = express();
    app.get("/events/aircraft/:identifier/history", createAircraftHistoryHandler({
        getSupabaseClient: () => ({ from: () => query }),
        clock: () => Date.parse("2026-09-21T12:30:00.000Z"),
    }));
    const server = app.listen(0, "127.0.0.1");
    try {
        await new Promise((resolve) => server.once("listening", resolve));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/events/aircraft/manual-aircraft-89644d/history`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.points.length, 1);
        assert.equal(body.points[0].track_key, "adsb-89644d");
        assert.ok(requestedKeys.includes("adsb-89644d"));
        assert.ok(requestedKeys.includes("manual-aircraft-89644d"));
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
