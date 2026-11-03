import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
function functionSource(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, "Missing worker function " + start);
    return source.slice(from, to);
}

test("general cron cycle stays single-flight until its first run completes", async () => {
    const activeWorkerJobs = new Set();
    const warnings = [];
    let executions = 0;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const context = vm.createContext({
        activeWorkerJobs, logWorkerOnce: (_key, message) => warnings.push(message),
        console: { log() {} }, Date,
        runWorkerCycle: async () => { executions += 1; await pending; },
    });
    vm.runInContext(functionSource("async function runLockedWorkerJob(", "function feedHealthSource("), context);
    vm.runInContext(functionSource("async function runWorker()", "async function runWorkerCycle()"), context);
    const first = context.runWorker();
    assert.equal(executions, 1);
    const skipped = await context.runWorker();
    assert.equal(skipped.skipped, true);
    assert.equal(executions, 1);
    assert.equal(warnings.length, 1);
    release();
    await first;
    assert.equal(activeWorkerJobs.size, 0);
    await context.runWorker();
    assert.equal(executions, 2);
    context.runWorkerCycle = async () => { executions += 1; throw new Error("cycle failed"); };
    await assert.rejects(context.runWorker(), /cycle failed/);
    assert.equal(activeWorkerJobs.size, 0);
    assert.equal(executions, 3); // A failure does not schedule a retry.
});
