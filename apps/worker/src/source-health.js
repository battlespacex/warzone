import { SOURCE_HEALTH_STATES } from "../../shared/source-quality-policy.js";

const healthBySource = new Map();
const failureLogBySource = new Map();
const FAILURE_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 30 * 60 * 1000;
const FORBIDDEN_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const TLS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_BACKOFF_STEPS_MS = Object.freeze([30_000, 60_000, 120_000, 300_000]);

function sourceKey(source = {}) {
  return String(source.id || source.source_id || source.name || source.source_name || source.url || "unknown").trim().toLowerCase();
}

function classifyFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  if (status === 429) return SOURCE_HEALTH_STATES.RATE_LIMITED;
  if (status === 404) return SOURCE_HEALTH_STATES.DISABLED;
  if (/\b429\b|rate limit|too many requests/.test(message)) return SOURCE_HEALTH_STATES.RATE_LIMITED;
  if (/parse|xml|html instead|returned .*text\/html|unexpected token|invalid (?:rss|json)|expected json|feed not recognized/.test(message)) return SOURCE_HEALTH_STATES.PARSER_ERROR;
  return SOURCE_HEALTH_STATES.FAILING;
}

function getFailureStatusCode(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || 0) || null;
}

function getRetryAfterMs(error, now = Date.now()) {
  const direct = Number(error?.retryAfterMs);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const headers = error?.response?.headers || error?.headers;
  const raw = headers?.get?.("retry-after")
    || headers?.["retry-after"]
    || headers?.["Retry-After"];
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function isTlsFailure(error) {
  return /certificate|self signed|unable to verify|cert_has_expired|untrusted/i.test(
    String(error?.code || error?.message || error || "")
  );
}

function transientDelay(failures) {
  return TRANSIENT_BACKOFF_STEPS_MS[Math.min(
    TRANSIENT_BACKOFF_STEPS_MS.length - 1,
    Math.max(0, failures - 1)
  )];
}

function getSourceHealth(source = {}) {
  if (source.enabled === false) {
    return {
      status: SOURCE_HEALTH_STATES.DISABLED,
      reason: source.disabled_reason || source.health_reason || source.note || "disabled_by_config",
      consecutive_failures: 0,
      last_success: null,
      last_failure: null,
      retry_after: null,
    };
  }
  return healthBySource.get(sourceKey(source)) || {
    status: SOURCE_HEALTH_STATES.HEALTHY,
    reason: null,
    consecutive_failures: 0,
    last_success: null,
    last_failure: null,
    retry_after: null,
    last_status_code: null,
  };
}

function recordSourceSuccess(source = {}, itemCount = 0, now = Date.now()) {
  const next = {
    status: Number(itemCount) > 0 ? SOURCE_HEALTH_STATES.HEALTHY : SOURCE_HEALTH_STATES.STALE,
    reason: Number(itemCount) > 0 ? null : "successful_fetch_returned_no_items",
    consecutive_failures: 0,
    last_success: new Date(now).toISOString(),
    last_failure: getSourceHealth(source).last_failure,
    retry_after: null,
    last_status_code: 200,
  };
  healthBySource.set(sourceKey(source), next);
  return next;
}

function recordSourceFailure(source = {}, error, now = Date.now()) {
  const previous = getSourceHealth(source);
  const consecutiveFailures = Number(previous.consecutive_failures || 0) + 1;
  const statusCode = getFailureStatusCode(error);
  const status = classifyFailure(error);
  const retryAfterMs = getRetryAfterMs(error, now);
  let delayMs = transientDelay(consecutiveFailures);
  if (statusCode === 401 || statusCode === 403) delayMs = FORBIDDEN_COOLDOWN_MS;
  if (statusCode === 429) delayMs = Math.max(delayMs, retryAfterMs || 0);
  if (isTlsFailure(error)) delayMs = TLS_COOLDOWN_MS;
  if (consecutiveFailures >= FAILURE_THRESHOLD && ![401, 403, 429].includes(statusCode)) {
    delayMs = Math.max(delayMs, FAILURE_COOLDOWN_MS);
  }
  const retryAfter = statusCode === 404 ? null : new Date(now + delayMs).toISOString();
  const next = {
    status,
    reason: String(error?.message || error || "unknown_error").slice(0, 240),
    consecutive_failures: consecutiveFailures,
    last_success: previous.last_success || null,
    last_failure: new Date(now).toISOString(),
    retry_after: retryAfter,
    last_status_code: statusCode,
  };
  healthBySource.set(sourceKey(source), next);
  return next;
}

function shouldLogSourceFailure(source = {}, health = getSourceHealth(source), now = Date.now()) {
  const key = sourceKey(source);
  const signature = `${health.status}:${health.last_status_code || "network"}:${health.reason || ""}`;
  const previous = failureLogBySource.get(key);
  const retryAt = Date.parse(health.retry_after || "");
  const cooldownMs = Number.isFinite(retryAt)
    ? Math.max(60_000, Math.min(FAILURE_COOLDOWN_MS, retryAt - now))
    : FAILURE_COOLDOWN_MS;
  if (previous?.signature === signature && now - previous.loggedAt < cooldownMs) return false;
  failureLogBySource.set(key, { signature, loggedAt: now });
  return true;
}

function formatSourceFailure(source = {}, health = getSourceHealth(source)) {
  const name = source.name || source.source_name || source.id || source.url || "unknown";
  const statusCode = Number(health.last_status_code || 0);
  const code = statusCode >= 400 ? `HTTP ${statusCode}` : health.status;
  const responseCode = statusCode > 0 && statusCode < 400 ? ` (HTTP ${statusCode})` : "";
  const reason = health.reason ? ` reason=${health.reason}` : "";
  const retryAt = Date.parse(health.retry_after || "");
  const next = Number.isFinite(retryAt)
    ? ` retry in ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))}s next=${health.retry_after}`
    : " disabled until manual recheck/restart";
  return `[source:${name}] ${code}${responseCode}${reason}${next}`;
}

function shouldAttemptSource(source = {}, now = Date.now()) {
  const health = getSourceHealth(source);
  if (health.status === SOURCE_HEALTH_STATES.DISABLED) return false;
  const retryAt = Date.parse(health.retry_after || "");
  return !Number.isFinite(retryAt) || retryAt <= now;
}

function resetSourceHealth() {
  healthBySource.clear();
  failureLogBySource.clear();
}

export {
  classifyFailure,
  formatSourceFailure,
  getSourceHealth,
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceHealth,
  shouldLogSourceFailure,
  shouldAttemptSource,
};
