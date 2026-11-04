import test from "node:test";
import assert from "node:assert/strict";
import { authorizeNavalHistory } from "../src/naval-history-access.js";
import { createNavalHistoryHandler, createNavalPositionHistoryHandler } from "../src/routes.events.js";

function subscriptionClient(row = { plan: "advanced", status: "active" }) {
    const calls = [];
    const query = {
        select(...args) { calls.push(["select", ...args]); return this; },
        eq(...args) { calls.push(["eq", ...args]); return this; },
        async maybeSingle() { return { data: row, error: null }; },
    };
    return { calls, client: { from(table) { calls.push(["from", table]); return query; } } };
}

function response() {
    return {
        statusCode: 200, headers: {}, body: null,
        setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

test("naval history authorization fails closed without a server-validated session", async () => {
    const { client, calls } = subscriptionClient();
    const withoutCookie = await authorizeNavalHistory({ headers: {} }, { getSupabaseClient: () => client });
    assert.equal(withoutCookie.status, 401);
    assert.equal(calls.length, 0);
    const forgedEmail = await authorizeNavalHistory({ headers: { cookie: "session=x", "x-user-email": "premium@example.com" } }, {
        getSupabaseClient: () => client,
        fetchImpl: async () => ({ ok: true, json: async () => ({ isAuthenticated: false, email: "premium@example.com" }) }),
    });
    assert.equal(forgedEmail.status, 401);
    assert.equal(calls.length, 0);
});

test("validated premium subscriber is allowed; basic and inactive subscribers are denied", async () => {
    const req = { headers: { cookie: "session=x" } };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ isAuthenticated: true, user: { email: "PREMIUM@example.com" } }) });
    for (const [row, expected] of [
        [{ plan: "advanced", status: "active" }, 200],
        [{ plan: "expert", status: "trialing" }, 200],
        [{ plan: "basic", status: "active" }, 403],
        [{ plan: "advanced", status: "canceled" }, 403],
    ]) {
        const { client, calls } = subscriptionClient(row);
        const result = await authorizeNavalHistory(req, { getSupabaseClient: () => client, fetchImpl });
        assert.equal(result.status, expected);
        assert.deepEqual(calls.find(([name]) => name === "eq"), ["eq", "email", "premium@example.com"]);
    }
});

test("both private history routes reject unauthenticated requests before any database query", async () => {
    let queried = 0;
    const getSupabaseClient = () => { queried += 1; throw new Error("must not query"); };
    for (const handler of [createNavalHistoryHandler, createNavalPositionHistoryHandler]) {
        const res = response();
        await handler({ getSupabaseClient, authorize: async () => ({ allowed: false, status: 401 }) })({
            headers: {}, query: {}, params: { assetKey: "imo-1234567" },
        }, res);
        assert.equal(res.statusCode, 401);
        assert.equal(res.headers["Cache-Control"], "private, no-store");
    }
    assert.equal(queried, 0);
});

test("premium search and position queries use bounded private tables only", async () => {
    const calls = [];
    const asset = { asset_key: "imo-9876543", vessel_name: "USS EXAMPLE", last_seen_at: "2026-11-01T12:00:00Z" };
    const point = { observed_at: "2026-11-01T12:00:00Z", lat: 36, lon: -72 };
    const client = {
        from(table) {
            calls.push(["from", table]);
            const query = {
                select(...args) { calls.push(["select", ...args]); return this; },
                gte(...args) { calls.push(["gte", ...args]); return this; },
                lte(...args) { calls.push(["lte", ...args]); return this; },
                lt(...args) { calls.push(["lt", ...args]); return this; },
                ilike(...args) { calls.push(["ilike", ...args]); return this; },
                eq(...args) { calls.push(["eq", ...args]); return this; },
                order(...args) { calls.push(["order", ...args]); return this; },
                async range(...args) { calls.push(["range", ...args]); return { data: [asset], error: null }; },
                async limit(...args) { calls.push(["limit", ...args]); return { data: [point], error: null }; },
            };
            return query;
        },
    };
    const authorized = async () => ({ allowed: true, status: 200 });
    const list = createNavalHistoryHandler({ getSupabaseClient: () => client, authorize: authorized,
        clock: () => Date.parse("2026-11-03T12:00:00Z") });
    const listResponse = response();
    await list({ query: { search: "USS EXAMPLE", status: "historical", limit: "300" } }, listResponse);
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(listResponse.body.assets, [asset]);
    assert.deepEqual(calls.find(([name]) => name === "range"), ["range", 0, 199]);
    assert.deepEqual(calls.find(([name]) => name === "ilike"), ["ilike", "search_text", "%USS EXAMPLE%"]);
    assert.ok(calls.some(([name, field, value]) => name === "gte" && field === "last_seen_at" && value === "2026-10-27T12:00:00.000Z"));

    const positions = createNavalPositionHistoryHandler({ getSupabaseClient: () => client, authorize: authorized });
    const positionResponse = response();
    await positions({ params: { assetKey: "imo-9876543" } }, positionResponse);
    assert.equal(positionResponse.statusCode, 200);
    assert.deepEqual(positionResponse.body.points, [point]);
    assert.deepEqual(calls.filter(([name]) => name === "from").map(([, table]) => table),
        ["naval_asset_history", "naval_position_history"]);
});

test("history search rejects malformed input after entitlement check", async () => {
    const res = response();
    await createNavalHistoryHandler({ authorize: async () => ({ allowed: true, status: 200 }) })(
        { query: { search: "USS;DROP" } }, res);
    assert.equal(res.statusCode, 400);
});
