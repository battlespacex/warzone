import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { eventsRouter } from "../src/routes.events.js";

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
        assert.deepEqual(requestedPaths.sort(), ["/v2/callsign/AC123", "/v2/registration/AC123"]);
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
