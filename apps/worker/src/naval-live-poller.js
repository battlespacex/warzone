const DEFAULT_NAVAL_PROVIDER_TICK_MS = 5000;
const MIN_NAVAL_PROVIDER_TICK_MS = 3000;

function enabledFromEnv(value, fallback = true) {
    if (value === undefined || value === null || value === "") return fallback;
    return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readNavalLivePollConfig(env = process.env) {
    return Object.freeze({
        enabled: enabledFromEnv(env.NAVAL_LIVE_POLL_ENABLED, true),
        tickMs: Math.max(MIN_NAVAL_PROVIDER_TICK_MS, positiveInteger(env.NAVAL_PROVIDER_TICK_MS, DEFAULT_NAVAL_PROVIDER_TICK_MS)),
    });
}

export function shouldRunNavalInGeneralCycle({ livePollEnabled, feedEnabled = true } = {}) {
    return feedEnabled !== false && livePollEnabled !== true;
}

export function createNavalLivePoller({
    enabled = true,
    tickMs = DEFAULT_NAVAL_PROVIDER_TICK_MS,
    runCycle,
    logger = console,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
} = {}) {
    if (typeof runCycle !== "function") throw new TypeError("runCycle must be a function");
    const effectiveTickMs = Math.max(MIN_NAVAL_PROVIDER_TICK_MS, Number(tickMs) || DEFAULT_NAVAL_PROVIDER_TICK_MS);
    let intervalTimer = null;
    let startupTimer = null;
    let started = false;
    let running = false;

    async function runOnce() {
        if (!enabled) return { status: "disabled" };
        if (running) return { status: "skipped" };
        running = true;
        try {
            await runCycle();
            return { status: "completed" };
        } catch (error) {
            logger?.error?.(`[ais-live] cycle failed: ${error?.message || error}`);
            return { status: "failed", error };
        } finally {
            running = false;
        }
    }

    function start() {
        if (!enabled || started) return false;
        started = true;
        logger?.log?.(`[ais-live] enabled tick=${effectiveTickMs}ms`);
        startupTimer = setTimeoutFn(() => {
            startupTimer = null;
            void runOnce();
        }, 0);
        intervalTimer = setIntervalFn(() => void runOnce(), effectiveTickMs);
        startupTimer?.unref?.();
        intervalTimer?.unref?.();
        return true;
    }

    function stop() {
        started = false;
        if (startupTimer !== null) clearTimeoutFn(startupTimer);
        if (intervalTimer !== null) clearIntervalFn(intervalTimer);
        startupTimer = null;
        intervalTimer = null;
    }

    return Object.freeze({ start, stop, runOnce });
}

export const NAVAL_LIVE_POLL_DEFAULTS = Object.freeze({
    tickMs: DEFAULT_NAVAL_PROVIDER_TICK_MS,
    minimumTickMs: MIN_NAVAL_PROVIDER_TICK_MS,
});
