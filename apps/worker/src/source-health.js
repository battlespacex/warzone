import { SOURCE_HEALTH_STATES } from "../../shared/source-quality-policy.js";

const healthBySource = new Map();
const FAILURE_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 30 * 60 * 1000;

function sourceKey(source = {}) {
  return String(source.id || source.source_id || source.name || source.source_name || source.url || "unknown").trim().toLowerCase();
}

function classifyFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (/\b429\b|rate limit|too many requests/.test(message)) return SOURCE_HEALTH_STATES.RATE_LIMITED;
  if (/parse|xml|html instead|unexpected token|invalid rss|feed not recognized/.test(message)) return SOURCE_HEALTH_STATES.PARSER_ERROR;
  return SOURCE_HEALTH_STATES.FAILING;
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
  };
  healthBySource.set(sourceKey(source), next);
  return next;
}

function recordSourceFailure(source = {}, error, now = Date.now()) {
  const previous = getSourceHealth(source);
  const consecutiveFailures = Number(previous.consecutive_failures || 0) + 1;
  const status = classifyFailure(error);
  const retryAfter = consecutiveFailures >= FAILURE_THRESHOLD || status === SOURCE_HEALTH_STATES.RATE_LIMITED
    ? new Date(now + FAILURE_COOLDOWN_MS).toISOString()
    : null;
  const next = {
    status,
    reason: String(error?.message || error || "unknown_error").slice(0, 240),
    consecutive_failures: consecutiveFailures,
    last_success: previous.last_success || null,
    last_failure: new Date(now).toISOString(),
    retry_after: retryAfter,
  };
  healthBySource.set(sourceKey(source), next);
  return next;
}

function shouldAttemptSource(source = {}, now = Date.now()) {
  const health = getSourceHealth(source);
  if (health.status === SOURCE_HEALTH_STATES.DISABLED) return false;
  const retryAt = Date.parse(health.retry_after || "");
  return !Number.isFinite(retryAt) || retryAt <= now;
}

function resetSourceHealth() {
  healthBySource.clear();
}

export {
  classifyFailure,
  getSourceHealth,
  recordSourceFailure,
  recordSourceSuccess,
  resetSourceHealth,
  shouldAttemptSource,
};
