const DEFAULT_AIRCRAFT_LIVE_POLL_INTERVAL_MS = 5000;
const MIN_AIRCRAFT_LIVE_POLL_INTERVAL_MS = 3000;

function enabledFromEnv(value, fallback = true) {
    if (value === undefined || value === null || value === "") return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readAircraftLivePollConfig(env = process.env) {
    return Object.freeze({
        enabled: enabledFromEnv(env.AIRCRAFT_LIVE_POLL_ENABLED, true),
        intervalMs: Math.max(
            MIN_AIRCRAFT_LIVE_POLL_INTERVAL_MS,
            positiveInteger(env.AIRCRAFT_LIVE_POLL_INTERVAL_MS, DEFAULT_AIRCRAFT_LIVE_POLL_INTERVAL_MS)
        ),
    });
}

export function shouldRunAircraftInGeneralCycle({ livePollEnabled, feedEnabled = true } = {}) {
    return feedEnabled !== false && livePollEnabled !== true;
}

export function createAircraftLivePoller({
    enabled = true,
    intervalMs = DEFAULT_AIRCRAFT_LIVE_POLL_INTERVAL_MS,
    runCycle,
    logger = console,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
} = {}) {
    if (typeof runCycle !== "function") throw new TypeError("runCycle must be a function");

    const effectiveIntervalMs = Math.max(1, Number(intervalMs) || DEFAULT_AIRCRAFT_LIVE_POLL_INTERVAL_MS);
    let intervalTimer = null;
    let startupTimer = null;
    let started = false;
    let stopped = false;
    let running = false;
    let cycle = 0;

    async function runOnce() {
        if (!enabled || stopped) return { status: "disabled", cycle };
        if (running) return { status: "skipped", cycle };

        running = true;
        cycle += 1;
        const currentCycle = cycle;
        const startedAt = now();
        logger?.log?.(`[adsb-live] cycle=${currentCycle} started`);
        try {
            await runCycle();
            const durationMs = Math.max(0, now() - startedAt);
            logger?.log?.(`[adsb-live] cycle=${currentCycle} completed duration=${durationMs}ms`);
            return { status: "completed", cycle: currentCycle, durationMs };
        } catch (error) {
            const durationMs = Math.max(0, now() - startedAt);
            logger?.error?.(`[adsb-live] cycle=${currentCycle} failed duration=${durationMs}ms: ${error?.message || error}`);
            return { status: "failed", cycle: currentCycle, durationMs, error };
        } finally {
            running = false;
        }
    }

    function start() {
        if (!enabled || started) return false;
        started = true;
        stopped = false;
        logger?.log?.(`[adsb-live] enabled interval=${effectiveIntervalMs}ms`);
        startupTimer = setTimeoutFn(() => {
            startupTimer = null;
            void runOnce();
        }, 0);
        intervalTimer = setIntervalFn(() => {
            void runOnce();
        }, effectiveIntervalMs);
        startupTimer?.unref?.();
        intervalTimer?.unref?.();
        return true;
    }

    function stop() {
        stopped = true;
        started = false;
        if (startupTimer !== null) {
            clearTimeoutFn(startupTimer);
            startupTimer = null;
        }
        if (intervalTimer !== null) {
            clearIntervalFn(intervalTimer);
            intervalTimer = null;
        }
    }

    function getState() {
        return {
            enabled,
            intervalMs: effectiveIntervalMs,
            started,
            running,
            cycle,
        };
    }

    return Object.freeze({ start, stop, runOnce, getState });
}

export const AIRCRAFT_LIVE_POLL_DEFAULTS = Object.freeze({
    intervalMs: DEFAULT_AIRCRAFT_LIVE_POLL_INTERVAL_MS,
    minimumIntervalMs: MIN_AIRCRAFT_LIVE_POLL_INTERVAL_MS,
});
