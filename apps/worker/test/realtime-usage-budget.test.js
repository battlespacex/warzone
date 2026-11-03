import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRealtimeUsage } from "../scripts/realtime-usage-budget.mjs";

test("usage projection uses the supplied billing cycle length and actual message total", () => {
    const result = evaluateRealtimeUsage({
        messages: 19527906,
        cycleStart: "2026-10-01T00:00:00Z",
        cycleEnd: "2026-11-01T00:00:00Z",
        asOf: "2026-11-01T00:00:00Z",
    });
    assert.equal(result.cycleDays, 31);
    assert.equal(result.projectedCycleMessages, 19527906);
    assert.equal(result.budgetRisk, true);
    assert.equal(result.estimatedRealtimeOverageUsd, 37.5);
});

test("thresholds are configurable and no production metric is inferred from a client sample", () => {
    const result = evaluateRealtimeUsage({
        messages: 60000,
        cycleStart: "2026-11-01T00:00:00Z",
        cycleEnd: "2026-12-01T00:00:00Z",
        asOf: "2026-11-02T00:00:00Z",
        thresholds: { review: 50000, warning: 70000, critical: 90000, monthly: 1000000 },
    });
    assert.equal(result.dailyAverage, 60000);
    assert.equal(result.level, "review");
    assert.equal(result.projectedCycleMessages, 1800000);
    assert.equal(result.budgetRisk, true);
    assert.equal(result.estimatedRealtimeOverageUsd, 0);
    assert.throws(() => evaluateRealtimeUsage({ messages: -1, cycleStart: "bad", cycleEnd: "bad", asOf: "bad" }));
});
