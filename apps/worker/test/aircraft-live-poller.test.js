import test from "node:test";
import assert from "node:assert/strict";

import {
    AIRCRAFT_LIVE_POLL_DEFAULTS,
    createAircraftLivePoller,
    readAircraftLivePollConfig,
    shouldRunAircraftInGeneralCycle,
} from "../src/aircraft-live-poller.js";
import { normalizeAdsbLolAircraft } from "../src/tracking/aircraft/providers/adsb-lol.js";
import { mergeAircraftObservations } from "../src/tracking/merge.js";

const quietLogger = { log() {}, error() {} };

test("live aircraft poller runs immediately and repeatedly at the configured interval", async () => {
    let startupCallback;
    let intervalCallback;
    let configuredInterval = 0;
    let calls = 0;
    const poller = createAircraftLivePoller({
        runCycle: async () => { calls += 1; },
        intervalMs: 5000,
        logger: quietLogger,
        setTimeoutFn(callback) { startupCallback = callback; return 1; },
        clearTimeoutFn() {},
        setIntervalFn(callback, intervalMs) {
            intervalCallback = callback;
            configuredInterval = intervalMs;
            return 2;
        },
        clearIntervalFn() {},
    });

    assert.equal(poller.start(), true);
    startupCallback();
    await new Promise((resolve) => setImmediate(resolve));
    intervalCallback();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(calls, 2);
    assert.equal(configuredInterval, 5000);
});

test("live aircraft poller prevents overlapping ADS-B cycles", async () => {
    let releaseFirst;
    let calls = 0;
    const firstCycle = new Promise((resolve) => { releaseFirst = resolve; });
    const poller = createAircraftLivePoller({
        runCycle: async () => { calls += 1; await firstCycle; },
        logger: quietLogger,
    });

    const running = poller.runOnce();
    const overlapping = await poller.runOnce();
    assert.equal(overlapping.status, "skipped");
    assert.equal(calls, 1);

    releaseFirst();
    assert.equal((await running).status, "completed");
});

test("same ADSB.lol ICAO keeps one canonical identity while its position changes", () => {
    const first = mergeAircraftObservations([
        normalizeAdsbLolAircraft({ hex: "ae2764", lat: 37.12912, lon: -76.60363, seen_pos: 1 }),
    ]);
    const second = mergeAircraftObservations([
        normalizeAdsbLolAircraft({ hex: "ae2764", lat: 37.1315, lon: -76.5981, seen_pos: 1 }),
    ]);

    assert.equal(first[0].identity, "icao:ae2764");
    assert.equal(second[0].identity, first[0].identity);
    assert.equal(`adsb-${first[0].icao24}`, "adsb-ae2764");
    assert.notDeepEqual(
        [second[0].latitude, second[0].longitude],
        [first[0].latitude, first[0].longitude]
    );
});

test("disabled live polling preserves the five-minute aircraft fallback", () => {
    assert.equal(shouldRunAircraftInGeneralCycle({ livePollEnabled: false, feedEnabled: true }), true);
    assert.equal(shouldRunAircraftInGeneralCycle({ livePollEnabled: true, feedEnabled: true }), false);
    assert.equal(shouldRunAircraftInGeneralCycle({ livePollEnabled: false, feedEnabled: false }), false);
});

test("live poll interval is configurable but never below the development minimum", () => {
    assert.equal(readAircraftLivePollConfig({}).intervalMs, AIRCRAFT_LIVE_POLL_DEFAULTS.intervalMs);
    assert.equal(readAircraftLivePollConfig({ AIRCRAFT_LIVE_POLL_INTERVAL_MS: "3000" }).intervalMs, 3000);
    assert.equal(readAircraftLivePollConfig({ AIRCRAFT_LIVE_POLL_INTERVAL_MS: "1000" }).intervalMs, 3000);
    assert.equal(readAircraftLivePollConfig({ AIRCRAFT_LIVE_POLL_ENABLED: "false" }).enabled, false);
});

test("stopping the live aircraft poller clears startup and interval timers", () => {
    const cleared = [];
    const poller = createAircraftLivePoller({
        runCycle: async () => {},
        logger: quietLogger,
        setTimeoutFn() { return 11; },
        clearTimeoutFn(timer) { cleared.push(["timeout", timer]); },
        setIntervalFn() { return 22; },
        clearIntervalFn(timer) { cleared.push(["interval", timer]); },
    });

    poller.start();
    poller.stop();

    assert.deepEqual(cleared, [["timeout", 11], ["interval", 22]]);
    assert.equal(poller.getState().started, false);
});
