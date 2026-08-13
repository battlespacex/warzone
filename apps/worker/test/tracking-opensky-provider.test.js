import test from "node:test";
import assert from "node:assert/strict";

import { createOpenSkyProvider, resetOpenSkyToken } from "../src/tracking/aircraft/providers/opensky.js";

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
        response(200, { states: [["abc123", "RCH123", "United States", 0, 1_786_622_400, -79, 43, 1000, false, 100, 90, 0, null, null, "1234"]] }),
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

    const observations = await provider.fetchObservations();

    assert.equal(observations.length, 1);
    assert.equal(observations[0].icao24, "abc123");
    assert.equal(requests[1].authorization, "Bearer old-token");
    assert.equal(requests[3].authorization, "Bearer new-token");
    assert.equal(replies.length, 0);
});
