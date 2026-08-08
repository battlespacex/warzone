import test from "node:test";
import assert from "node:assert/strict";
import { buildGeneralEventsQuery } from "../src/routes.events.js";
import {
    MAP_EVENT_HISTORY_WINDOW_HOURS,
    isMapEventHistoricallyRelevant,
} from "../../shared/map-event-policy.js";

function createQueryRecorder() {
    const calls = [];
    const query = new Proxy({}, {
        get(_target, property) {
            if (property === "then") return undefined;
            return (...args) => {
                calls.push([property, ...args]);
                return query;
            };
        },
    });
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

test("general events exclude aircraft telemetry before ordering and limiting", () => {
    const recorder = createQueryRecorder();
    buildGeneralEventsQuery(recorder.supabase, {
        cutoffIso: "2026-08-01T00:00:00.000Z",
        limit: 1000,
        now: Date.parse("2026-08-08T00:00:00.000Z"),
    });

    const operations = recorder.calls.map(([operation]) => operation);
    const orderIndex = operations.indexOf("order");
    const limitIndex = operations.indexOf("limit");
    const filterIndexes = operations
        .map((operation, index) => operation === "or" ? index : -1)
        .filter((index) => index >= 0);

    assert.equal(MAP_EVENT_HISTORY_WINDOW_HOURS, 168);
    assert.equal(filterIndexes.length, 3);
    assert.ok(filterIndexes.every((index) => index < orderIndex));
    assert.ok(filterIndexes.every((index) => index < limitIndex));
    assert.match(recorder.calls[filterIndexes[0]][1], /flight_tracking/);
    assert.match(recorder.calls[filterIndexes[1]][1], /ads-b/);
});

test("three-to-seven-day events require retained operational relevance", () => {
    const now = Date.parse("2026-08-08T00:00:00.000Z");
    const occurredAt = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString();

    assert.equal(isMapEventHistoricallyRelevant({ occurred_at: occurredAt, severity: "low" }, { now }), false);
    assert.equal(isMapEventHistoricallyRelevant({ occurred_at: occurredAt, severity: "high" }, { now }), true);
    assert.equal(isMapEventHistoricallyRelevant({ occurred_at: occurredAt, source_count: 2 }, { now }), true);
    assert.equal(isMapEventHistoricallyRelevant({
        occurred_at: occurredAt,
        priority_score: 85,
        confidence: 70,
    }, { now }), true);
});

test("events outside the seven-day map window are rejected even when severe", () => {
    const now = Date.parse("2026-08-08T00:00:00.000Z");
    const occurredAt = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isMapEventHistoricallyRelevant({ occurred_at: occurredAt, severity: "critical" }, { now }), false);
});
