import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    MAP_EVENTS_LIMIT,
    MAP_EVENTS_SELECT_COLUMNS,
    MAP_EVENTS_WINDOW_HOURS,
    buildMapEventsQuery,
    createEventDetailHandler,
    createMapEventsHandler,
    parseMapEventsRequest,
} from "../src/routes.events.js";

function createSupabaseResult(data = [], error = null) {
    const calls = [];
    const query = {};
    ["select", "gte", "lte", "gt", "not", "or", "order", "limit", "eq", "maybeSingle"].forEach((method) => {
        query[method] = (...args) => {
            calls.push([method, ...args]);
            return query;
        };
    });
    query.then = (resolve, reject) => Promise.resolve({ data, error }).then(resolve, reject);
    return {
        calls,
        supabase: {
            from(...args) {
                calls.push(["from", ...args]);
                return query;
            },
        },
    };
}

function createResponseRecorder() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            this.headers[name] = value;
        },
        json(value) {
            this.body = value;
            return this;
        },
        send(value) {
            this.body = JSON.parse(value);
            return this;
        },
    };
}

function mapRequest(overrides = {}) {
    return {
        query: {
            region_id: "middle_east",
            min_lat: "12",
            max_lat: "42",
            min_lon: "28",
            max_lon: "65",
            ...overrides,
        },
        get() { return ""; },
        protocol: "http",
    };
}

test("map request uses a 48-hour, 800-row region-scoped query and no select star", () => {
    const options = parseMapEventsRequest(mapRequest().query, Date.parse("2026-09-14T12:00:00.000Z"));
    assert.equal(options.windowHours, MAP_EVENTS_WINDOW_HOURS);
    assert.equal(options.limit, MAP_EVENTS_LIMIT);
    assert.equal(options.cutoffIso, "2026-09-12T12:00:00.000Z");

    const recorder = createSupabaseResult();
    buildMapEventsQuery(recorder.supabase, options);
    assert.deepEqual(recorder.calls.find(([name]) => name === "select"), ["select", MAP_EVENTS_SELECT_COLUMNS]);
    assert.ok(!MAP_EVENTS_SELECT_COLUMNS.includes("*"));
    assert.ok(recorder.calls.some((call) => call[0] === "gte" && call[1] === "lat" && call[2] === 12));
    assert.ok(recorder.calls.some((call) => call[0] === "lte" && call[1] === "lat" && call[2] === 42));
    assert.ok(recorder.calls.some((call) => call[0] === "gte" && call[1] === "lon" && call[2] === 28));
    assert.ok(recorder.calls.some((call) => call[0] === "lte" && call[1] === "lon" && call[2] === 65));
});

test("map endpoint returns lightweight fields plus available satellite context", async () => {
    const recorder = createSupabaseResult([{
        id: "evt-map",
        created_at: "2026-09-14T10:00:00.000Z",
        occurred_at: "2026-09-14T11:00:00.000Z",
        category: "strike",
        title: "Missile strike reported near port",
        summary: "Operational incident summary",
        source_name: "Reuters",
        source_url: "https://example.com/private-detail",
        location_label: "Port area",
        severity: "high",
        confidence: 82,
        lat: 25,
        lon: 55,
        metadata: {
            normalization: { location_precision: "EXACT", location_method: "incident_coordinates" },
            source_provenance: [{ raw: true }],
        },
        media: { images: [{ full_url: "https://example.com/image.jpg" }] },
        raw: { secret: true },
    }]);
    let satelliteCalls = 0;
    const handler = createMapEventsHandler({
        getSupabaseClient: () => recorder.supabase,
        attachSatellite: async (_supabase, events) => {
            satelliteCalls += 1;
            return events.map((event) => ({
                ...event,
                satellite_context: {
                    status: "available",
                    imageUrl: "https://catalogue.dataspace.copernicus.eu/odata/v1/Assets(6caa0f27-d33c-4c1d-a23d-c0b31b5a336a)/$value",
                },
            }));
        },
        clock: (() => { let value = 100; return () => value += 5; })(),
        logger: { info() {} },
    });
    const res = createResponseRecorder();
    await handler(mapRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.events.length, 1);
    const event = res.body.events[0];
    assert.equal(event.id, "evt-map");
    assert.equal(event.map_eligible, true);
    assert.equal("source_url" in event, false);
    assert.equal("media" in event, false);
    assert.equal(satelliteCalls, 1);
    assert.equal(event.satellite_context.status, "available");
    assert.equal(event.satellite_available, true);
    assert.equal("raw" in event, false);
    assert.equal("source_provenance" in event.metadata, false);
    assert.match(res.headers["Server-Timing"], /db;dur=/);
    assert.doesNotMatch(createMapEventsHandler.toString(), /attachMedia/);
});

test("map endpoint handles empty regions and database failure without throwing", async () => {
    const emptyHandler = createMapEventsHandler({
        getSupabaseClient: () => createSupabaseResult([]).supabase,
        logger: { info() {} },
    });
    const emptyResponse = createResponseRecorder();
    await emptyHandler(mapRequest(), emptyResponse);
    assert.deepEqual(emptyResponse.body.events, []);

    const failedHandler = createMapEventsHandler({
        getSupabaseClient: () => createSupabaseResult([], new Error("database unavailable")).supabase,
    });
    const failedResponse = createResponseRecorder();
    await failedHandler(mapRequest(), failedResponse);
    assert.equal(failedResponse.statusCode, 500);
    assert.deepEqual(failedResponse.body, { error: "Failed" });
});

test("full events route remains enriched and event detail enriches on demand", async () => {
    const source = await readFile(new URL("../src/routes.events.js", import.meta.url), "utf8");
    assert.match(source, /router\.get\("\/", async \(req, res\) =>[\s\S]*?attachSatelliteContextToEvents[\s\S]*?attachEventMediaToEvents/);

    const recorder = createSupabaseResult({
        id: "evt-detail",
        category: "strike",
        title: "Detailed strike report",
        summary: "Long detail",
        source_name: "Reuters",
        lat: 25,
        lon: 55,
        metadata: { normalization: { location_precision: "EXACT", location_method: "incident_coordinates" } },
    });
    let satelliteCalls = 0;
    let mediaCalls = 0;
    const handler = createEventDetailHandler({
        getSupabaseClient: () => recorder.supabase,
        attachSatellite: async (_supabase, events) => {
            satelliteCalls += 1;
            return events.map((event) => ({ ...event, satellite_context: { status: "available" } }));
        },
        attachMedia: async (_supabase, events) => {
            mediaCalls += 1;
            return events.map((event) => ({ ...event, media: { images: [] } }));
        },
    });
    const res = createResponseRecorder();
    await handler({ params: { id: "evt-detail" }, get() { return ""; }, protocol: "http" }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.event.id, "evt-detail");
    assert.equal(satelliteCalls, 1);
    assert.equal(mediaCalls, 1);
});

test("invalid or missing region bounds are rejected", async () => {
    assert.equal(parseMapEventsRequest({ region_id: "europe" }), null);
    assert.equal(parseMapEventsRequest(mapRequest({ min_lat: "95" }).query), null);
    const handler = createMapEventsHandler({ getSupabaseClient: () => createSupabaseResult([]).supabase });
    const res = createResponseRecorder();
    await handler(mapRequest({ max_lon: "not-a-number" }), res);
    assert.equal(res.statusCode, 400);
});
