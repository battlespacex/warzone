import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  getSourceHealth,
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceHealth,
  shouldAttemptSource,
} from "../src/source-health.js";

test("disabled sources preserve their reason and are not attempted", () => {
  const source = { id: "dead-feed", enabled: false, disabled_reason: "verified_404" };
  assert.equal(getSourceHealth(source).status, "disabled");
  assert.equal(getSourceHealth(source).reason, "verified_404");
  assert.equal(shouldAttemptSource(source), false);
});

test("repeated failures trigger a bounded cooldown", () => {
  resetSourceHealth();
  const source = { id: "failing-feed", enabled: true };
  const now = Date.parse("2026-08-08T10:00:00.000Z");
  recordSourceFailure(source, new Error("HTTP 500"), now);
  recordSourceFailure(source, new Error("HTTP 500"), now + 1000);
  const health = recordSourceFailure(source, new Error("HTTP 500"), now + 2000);

  assert.equal(health.status, "failing");
  assert.equal(health.consecutive_failures, 3);
  assert.ok(health.retry_after);
  assert.equal(shouldAttemptSource(source, now + 3000), false);
  assert.equal(shouldAttemptSource(source, now + 31 * 60 * 1000), true);
});

test("rate limits and parser failures are classified and successful fetches recover", () => {
  resetSourceHealth();
  const source = { id: "recovering-feed", enabled: true };
  assert.equal(classifyFailure(new Error("HTTP 429 rate limit")), "rate_limited");
  assert.equal(classifyFailure(new Error("invalid RSS parse")), "parser_error");

  recordSourceFailure(source, new Error("invalid RSS parse"), 1000);
  assert.equal(getSourceHealth(source).status, "parser_error");
  assert.equal(recordSourceSuccess(source, 0, 2000).status, "stale");
  assert.equal(recordSourceSuccess(source, 4, 3000).status, "healthy");
  assert.equal(getSourceHealth(source).consecutive_failures, 0);
});
