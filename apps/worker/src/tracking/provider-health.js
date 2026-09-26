export const PROVIDER_HEALTH_STATES = Object.freeze({
    DISABLED: "DISABLED",
    HEALTHY: "HEALTHY",
    DEGRADED: "DEGRADED",
    BACKOFF: "BACKOFF",
    UNAVAILABLE: "UNAVAILABLE",
});

const healthByProvider = new Map();
const inFlightProviders = new Set();
const DEFAULT_LONG_BACKOFF_MS = 15 * 60 * 1000;
const DEFAULT_MAX_BACKOFF_MS = 60 * 1000;
const RATE_LIMIT_BACKOFF_STEPS_MS = Object.freeze([30_000, 60_000, 120_000, 300_000]);

function key(domain, id) {
    return `${domain}:${id}`;
}

function iso(value) {
    return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function initialState(enabled, now = Date.now()) {
    return {
        status: enabled ? PROVIDER_HEALTH_STATES.DEGRADED : PROVIDER_HEALTH_STATES.DISABLED,
        last_attempt_at: null,
        last_success_at: null,
        last_failure_at: null,
        consecutive_failures: 0,
        last_status_code: null,
        next_retry_at: enabled ? iso(now) : null,
    };
}

export function getProviderHealth(domain, id, enabled = true, now = Date.now()) {
    const providerKey = key(domain, id);
    if (!healthByProvider.has(providerKey)) {
        healthByProvider.set(providerKey, initialState(enabled, now));
    }
    const current = healthByProvider.get(providerKey);
    if (!enabled && current.status !== PROVIDER_HEALTH_STATES.DISABLED) {
        const disabled = initialState(false, now);
        healthByProvider.set(providerKey, disabled);
        return disabled;
    }
    if (enabled && current.status === PROVIDER_HEALTH_STATES.DISABLED) {
        const reenabled = initialState(true, now);
        healthByProvider.set(providerKey, reenabled);
        return reenabled;
    }
    return current;
}

export function shouldAttemptProvider(domain, id, enabled = true, now = Date.now()) {
    const health = getProviderHealth(domain, id, enabled, now);
    if (health.status === PROVIDER_HEALTH_STATES.DISABLED) return false;
    const retryAt = Date.parse(health.next_retry_at || "");
    return !Number.isFinite(retryAt) || retryAt <= now;
}

function emitTransition(domain, id, previous, next, detail, logger = console) {
    if (previous.status === next.status && previous.last_status_code === next.last_status_code) return;
    const suffix = detail ? ` ${detail}` : "";
    const method = next.status === PROVIDER_HEALTH_STATES.HEALTHY ? "log" : "warn";
    logger?.[method]?.(`[${domain}:${id}] ${next.status}${suffix}`);
}

export function recordProviderAttempt(domain, id, enabled = true, now = Date.now()) {
    const previous = getProviderHealth(domain, id, enabled, now);
    const next = { ...previous, last_attempt_at: iso(now) };
    healthByProvider.set(key(domain, id), next);
    return next;
}

export function recordProviderSuccess(domain, id, itemCount, { now = Date.now(), logger = console } = {}) {
    const previous = getProviderHealth(domain, id, true, now);
    const status = Number(itemCount) > 0
        ? PROVIDER_HEALTH_STATES.HEALTHY
        : PROVIDER_HEALTH_STATES.DEGRADED;
    const next = {
        ...previous,
        status,
        last_success_at: iso(now),
        consecutive_failures: 0,
        last_status_code: 200,
        next_retry_at: null,
    };
    healthByProvider.set(key(domain, id), next);
    emitTransition(domain, id, previous, next, Number(itemCount) > 0 ? "" : "empty response", logger);
    return next;
}

function addJitter(delayMs, random = Math.random) {
    const sample = Math.max(0, Math.min(1, Number(random?.()) || 0));
    return Math.max(1000, Math.round(delayMs * (0.9 + (sample * 0.2))));
}

function retryDelay(error, failures, random = Math.random) {
    const status = Number(error?.status || error?.statusCode || 0);
    if (status === 401 || status === 403) {
        return Number(error?.longBackoffMs) || DEFAULT_LONG_BACKOFF_MS;
    }
    if (status === 429) {
        const step = RATE_LIMIT_BACKOFF_STEPS_MS[Math.min(
            RATE_LIMIT_BACKOFF_STEPS_MS.length - 1,
            Math.max(0, failures - 1)
        )];
        const retryAfterMs = Number(error?.retryAfterMs);
        return Math.max(
            addJitter(step, random),
            Number.isFinite(retryAfterMs) ? Math.max(1000, retryAfterMs) : 0
        );
    }
    return Math.min(DEFAULT_MAX_BACKOFF_MS, 5000 * (2 ** Math.max(0, failures - 1)));
}

export function recordProviderFailure(domain, id, error, { now = Date.now(), logger = console, random = Math.random } = {}) {
    const previous = getProviderHealth(domain, id, true, now);
    const failures = Number(previous.consecutive_failures || 0) + 1;
    const statusCode = Number(error?.status || error?.statusCode || 0) || null;
    const delayMs = retryDelay(error, failures, random);
    const unavailable = ![401, 403, 429].includes(statusCode) && failures >= 5;
    const next = {
        ...previous,
        status: unavailable ? PROVIDER_HEALTH_STATES.UNAVAILABLE : PROVIDER_HEALTH_STATES.BACKOFF,
        last_failure_at: iso(now),
        consecutive_failures: failures,
        last_status_code: statusCode,
        next_retry_at: iso(now + delayMs),
    };
    healthByProvider.set(key(domain, id), next);
    const failure = statusCode ? `HTTP ${statusCode}` : String(error?.code || "request failed");
    const detail = `${failure} retry in ${Math.max(1, Math.ceil(delayMs / 1000))}s next=${next.next_retry_at}`;
    emitTransition(domain, id, previous, next, detail, logger);
    return next;
}

export async function runConfiguredProviders(domain, providers, { logger = console, now = Date.now() } = {}) {
    const runnable = [];
    for (const provider of providers) {
        const enabled = provider.enabled !== false;
        const health = getProviderHealth(domain, provider.id, enabled, now);
        if (!enabled) continue;
        if (!shouldAttemptProvider(domain, provider.id, enabled, now)) continue;
        const providerKey = key(domain, provider.id);
        if (inFlightProviders.has(providerKey)) continue;
        const lastAttemptAt = Date.parse(health.last_attempt_at || "");
        if (
            Number(provider.minimumIntervalMs) > 0
            && Number.isFinite(lastAttemptAt)
            && now - lastAttemptAt < Number(provider.minimumIntervalMs)
        ) continue;
        recordProviderAttempt(domain, provider.id, enabled, now);
        inFlightProviders.add(providerKey);
        runnable.push(provider);
    }

    const settled = await Promise.allSettled(runnable.map(async (provider) => {
        try {
            const result = await provider.fetchObservations();
            const observations = Array.isArray(result) ? result : (result?.observations || []);
            recordProviderSuccess(domain, provider.id, observations.length, { logger, now });
            return { provider, observations, diagnostics: result?.diagnostics || null };
        } catch (error) {
            recordProviderFailure(domain, provider.id, error, { logger, now });
            throw error;
        } finally {
            inFlightProviders.delete(key(domain, provider.id));
        }
    }));

    const results = [];
    settled.forEach((entry) => {
        if (entry.status === "fulfilled") {
            results.push(entry.value);
        }
    });
    return results;
}

export function resetProviderHealth() {
    healthByProvider.clear();
    inFlightProviders.clear();
}
