import test from "node:test";
import assert from "node:assert/strict";
import { __reportingServiceTestUtils } from "../../shared/reporting-service.js";

test("single-flight report generation shares one in-flight promise per report key", async () => {
  __reportingServiceTestUtils.resetInFlightReportGenerationsForTests();
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const first = __reportingServiceTestUtils.withInFlightReportGeneration("daily:2026-07-29:global", async () => {
    calls += 1;
    await gate;
    return { ok: true, calls };
  });
  const second = __reportingServiceTestUtils.withInFlightReportGeneration("daily:2026-07-29:global", async () => {
    calls += 1;
    return { ok: true, calls };
  });

  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(firstResult, { ok: true, calls: 1 });
  assert.deepEqual(secondResult, { ok: true, calls: 1 });
});

test("single-flight report generation releases the key after completion", async () => {
  __reportingServiceTestUtils.resetInFlightReportGenerationsForTests();
  let calls = 0;

  const first = await __reportingServiceTestUtils.withInFlightReportGeneration("daily:2026-07-29:global", async () => {
    calls += 1;
    return calls;
  });
  const second = await __reportingServiceTestUtils.withInFlightReportGeneration("daily:2026-07-29:global", async () => {
    calls += 1;
    return calls;
  });

  assert.equal(first, 1);
  assert.equal(second, 2);
});
