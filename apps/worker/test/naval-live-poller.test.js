import test from "node:test";
import assert from "node:assert/strict";

import {
    createNavalLivePoller,
    readNavalLivePollConfig,
    shouldRunNavalInGeneralCycle,
} from "../src/naval-live-poller.js";

test("naval scheduler tick checks due providers without overlapping cycles", async () => {
    let resolveCycle;
    let calls = 0;
    const poller = createNavalLivePoller({
        runCycle: () => {
            calls += 1;
            return new Promise((resolve) => { resolveCycle = resolve; });
        },
    });
    const first = poller.runOnce();
    const second = await poller.runOnce();
    assert.equal(second.status, "skipped");
    resolveCycle();
    assert.equal((await first).status, "completed");
    assert.equal(calls, 1);
});

test("dedicated naval scheduler owns ingestion instead of the five-minute worker", () => {
    assert.equal(shouldRunNavalInGeneralCycle({ livePollEnabled: true, feedEnabled: true }), false);
    assert.equal(shouldRunNavalInGeneralCycle({ livePollEnabled: false, feedEnabled: true }), true);
    assert.equal(readNavalLivePollConfig({ NAVAL_PROVIDER_TICK_MS: "100" }).tickMs, 3000);
});
