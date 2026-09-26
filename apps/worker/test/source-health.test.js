import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure,
  formatSourceFailure,
  getSourceHealth,
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceHealth,
  shouldLogSourceFailure,
  shouldAttemptSource,
} from "../src/source-health.js";

test("disabled sources preserve their reason and are not attempted", () => {
  const source = { id: "dead-feed", enabled: false, disabled_reason: "verified_404" };
  assert.equal(getSourceHealth(source).status, "disabled");
  assert.equal(getSourceHealth(source).reason, "verified_404");
  assert.equal(shouldAttemptSource(source), false);
});

test("HTTP source policies apply long 403 cooldowns, disable 404s and honor Retry-After", () => {
  resetSourceHealth();
  const now = Date.parse("2026-09-25T12:00:00Z");

  const forbidden = recordSourceFailure(
    { id: "blocked" },
    Object.assign(new Error("forbidden"), { status: 403 }),
    now
  );
  assert.equal(Date.parse(forbidden.retry_after), now + (6 * 60 * 60 * 1000));

  const missing = recordSourceFailure(
    { id: "missing" },
    Object.assign(new Error("not found"), { status: 404 }),
    now
  );
  assert.equal(missing.status, "disabled");
  assert.equal(shouldAttemptSource({ id: "missing" }, now + 24 * 60 * 60 * 1000), false);

  const limited = recordSourceFailure(
    { id: "limited" },
    Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 90_000 }),
    now
  );
  assert.equal(Date.parse(limited.retry_after), now + 90_000);
});

test("TLS failures cool down for a day and repeated warning logs are suppressed", () => {
  resetSourceHealth();
  const source = { id: "bad-certificate", name: "Bad Certificate" };
  const now = Date.parse("2026-09-25T12:00:00Z");
  const health = recordSourceFailure(source, new Error("unable to verify the first certificate"), now);

  assert.equal(Date.parse(health.retry_after), now + (24 * 60 * 60 * 1000));
  assert.equal(shouldLogSourceFailure(source, health, now), true);
  assert.equal(shouldLogSourceFailure(source, health, now + 60_000), false);
  assert.match(formatSourceFailure(source, health), /Bad Certificate/);
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
  assert.equal(classifyFailure(new Error("returned text/html, expected JSON")), "parser_error");

  recordSourceFailure(source, new Error("invalid RSS parse"), 1000);
  assert.equal(getSourceHealth(source).status, "parser_error");
  assert.equal(recordSourceSuccess(source, 0, 2000).status, "stale");
  assert.equal(recordSourceSuccess(source, 4, 3000).status, "healthy");
  assert.equal(getSourceHealth(source).consecutive_failures, 0);
});
