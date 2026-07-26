import { readCopernicusConfig, getCopernicusConfigStatus } from "./copernicus-config.js";
import { buildObservationCacheKey, CopernicusHttpError, findBestObservation, processObservationPreview } from "./copernicus-service.js";
import { uploadSatellitePreviewToS3, deleteSatellitePreviewFromS3 } from "./copernicus-storage.js";
import {
  canStartSatelliteJob,
  getCopernicusStatusSummary,
  getUsageRow,
  incrementUsage,
  setRateLimitedUntil,
} from "./copernicus-usage.js";
import {
  getSatelliteExpiresAt,
  isEventEligibleForCopernicus,
  sanitizeForLog,
} from "./copernicus-utils.js";

const TERMINAL_STATUSES = new Set(["available", "unavailable", "permanent_error", "expired"]);
const WORKING_STATUSES = new Set(["searching", "processing"]);

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getBackoffIso(attemptCount = 0, baseMs = 15 * 60 * 1000) {
  const attempt = Math.max(0, Number(attemptCount || 0));
  const exponential = Math.min(8 * 60 * 60 * 1000, baseMs * (2 ** attempt));
  const jitter = Math.floor(Math.random() * Math.min(10 * 60 * 1000, exponential * 0.25));
  return new Date(Date.now() + exponential + jitter).toISOString();
}

function buildStorageKey(config, event, cacheKey, mimeType = "image/png") {
  const eventTime = new Date(event.occurred_at || Date.now());
  const yyyy = String(eventTime.getUTCFullYear());
  const mm = String(eventTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(eventTime.getUTCDate()).padStart(2, "0");
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  const safeEventId = String(event.id || "event").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80);
  return `${config.s3Prefix}/${yyyy}/${mm}/${dd}/${safeEventId}/${cacheKey}.${ext}`;
}

function sanitizeErrorCode(error) {
  if (error instanceof CopernicusHttpError && error.status) return `http_${error.status}`;
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("authentication")) return "auth_failed";
  if (message.includes("s3")) return "s3_failed";
  if (message.includes("too large")) return "image_too_large";
  return "processing_failed";
}

function sanitizeErrorMessage(error) {
  return sanitizeForLog(error?.message || error || "unknown error");
}

async function listCandidateEvents(supabase, config) {
  const cutoffIso = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("events")
    .select("id, category, subcategory, severity, title, summary, occurred_at, created_at, lat, lon, location_label, weapon_type")
    .gte("occurred_at", cutoffIso)
    .in("severity", ["high", "critical"])
    .not("lat", "is", null)
    .not("lon", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(Math.max(config.batchSize * 6, 30));
  if (error) throw error;
  return data || [];
}

async function getObservationForEvent(supabase, eventId) {
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .select("*")
    .eq("event_id", eventId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

function shouldAttemptObservation(row, config) {
  if (!row) return true;
  if (WORKING_STATUSES.has(String(row.status))) return false;
  if (row.status === "available") return false;
  if (row.status === "permanent_error" || row.status === "expired") return false;
  if (Number(row.attempt_count || 0) >= config.maxRetries) return false;
  const nextRetryAt = Date.parse(row.next_retry_at || "");
  return !Number.isFinite(nextRetryAt) || nextRetryAt <= Date.now();
}

async function upsertInitialObservation(supabase, event, status = "pending", reason = "") {
  const nowIso = new Date().toISOString();
  const payload = {
    event_id: event.id,
    status,
    provider: "copernicus",
    centre_latitude: Number(event.lat),
    centre_longitude: Number(event.lon),
    expires_at: getSatelliteExpiresAt(event),
    last_attempt_at: status === "pending" ? null : nowIso,
    updated_at: nowIso,
    error_code: reason || null,
  };
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .upsert(payload, { onConflict: "event_id" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function claimObservation(supabase, row, event) {
  const baseRow = row || await upsertInitialObservation(supabase, event);
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .update({
      status: "searching",
      last_attempt_at: new Date().toISOString(),
      attempt_count: Number(baseRow.attempt_count || 0) + 1,
      error_code: null,
      error_message_sanitized: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", baseRow.id)
    .in("status", ["pending", "retryable_error", "unavailable"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateObservation(supabase, id, payload) {
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findCachedObservation(supabase, cacheKey) {
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .select("*")
    .eq("cache_key", cacheKey)
    .eq("status", "available")
    .gt("expires_at", new Date().toISOString())
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length ? data[0] : null;
}

function copyCachedPayload(cached, event, observation) {
  return {
    status: "available",
    provider: cached.provider || "copernicus",
    collection: cached.collection || observation.collection,
    observation_type: cached.observation_type || observation.observationType,
    acquisition_time: cached.acquisition_time || observation.acquisitionTime,
    event_time_relation: cached.event_time_relation || observation.eventTimeRelation,
    cloud_cover: cached.cloud_cover ?? observation.cloudCover,
    bbox: cached.bbox || observation.bbox,
    centre_latitude: Number(event.lat),
    centre_longitude: Number(event.lon),
    source_item_id: cached.source_item_id || observation.sourceItemId,
    image_url: cached.image_url,
    storage_key: cached.storage_key,
    mime_type: cached.mime_type,
    width: cached.width,
    height: cached.height,
    byte_size: cached.byte_size,
    checksum: cached.checksum || null,
    etag: cached.etag || null,
    cache_key: cached.cache_key,
    next_retry_at: null,
    error_code: null,
    error_message_sanitized: null,
    expires_at: getSatelliteExpiresAt(event),
  };
}

async function markRetryableError(supabase, row, error, config) {
  const attemptCount = Number(row.attempt_count || 1);
  const maxed = attemptCount >= config.maxRetries;
  await updateObservation(supabase, row.id, {
    status: maxed ? "permanent_error" : "retryable_error",
    next_retry_at: maxed ? null : getBackoffIso(attemptCount),
    error_code: sanitizeErrorCode(error),
    error_message_sanitized: sanitizeErrorMessage(error),
  });
}

async function processOneEvent(supabase, event, config, logger = console) {
  const eligibility = isEventEligibleForCopernicus(event, config);
  if (!eligibility.eligible) {
    await incrementUsage(supabase, { skipped_events: 1 });
    logger.log?.(`[copernicus] skipped event=${event.id} reason=${eligibility.reason}`);
    return { ok: true, skipped: true, reason: eligibility.reason };
  }

  const existing = await getObservationForEvent(supabase, event.id);
  if (!shouldAttemptObservation(existing, config)) {
    return { ok: true, skipped: true, reason: "existing_state" };
  }

  const claimed = await claimObservation(supabase, existing, event);
  if (!claimed) return { ok: true, skipped: true, reason: "claim_lost" };

  try {
    logger.log?.(`[copernicus] catalog search started event=${event.id}`);
    await incrementUsage(supabase, { catalog_requests_attempted: 1 });
    const observation = await findBestObservation(config, event);
    if (!observation) {
      await updateObservation(supabase, claimed.id, {
        status: "unavailable",
        next_retry_at: new Date(Date.now() + config.eventRefreshHours * 60 * 60 * 1000).toISOString(),
        error_code: "no_suitable_observation",
        error_message_sanitized: "No suitable recent Copernicus observation found",
      });
      return { ok: true, unavailable: true };
    }

    logger.log?.(`[copernicus] observation selected event=${event.id} collection=${observation.collection} acquisition=${observation.acquisitionTime}`);
    const cacheKey = buildObservationCacheKey(config, observation);
    const cached = await findCachedObservation(supabase, cacheKey);
    if (cached?.image_url && cached?.storage_key) {
      await updateObservation(supabase, claimed.id, copyCachedPayload(cached, event, observation));
      await incrementUsage(supabase, { cache_hits: 1 });
      logger.log?.(`[copernicus] image cache hit event=${event.id} cache_key=${cacheKey}`);
      return { ok: true, cacheHit: true };
    }

    await updateObservation(supabase, claimed.id, {
      status: "processing",
      collection: observation.collection,
      observation_type: observation.observationType,
      acquisition_time: observation.acquisitionTime,
      event_time_relation: observation.eventTimeRelation,
      cloud_cover: observation.cloudCover,
      bbox: observation.bbox,
      source_item_id: observation.sourceItemId,
      cache_key: cacheKey,
    });

    logger.log?.(`[copernicus] process request started event=${event.id} cache_key=${cacheKey}`);
    await incrementUsage(supabase, { process_requests_attempted: 1 });
    const image = await processObservationPreview(config, observation);
    const storageKey = buildStorageKey(config, event, cacheKey, image.mimeType);
    const uploaded = await uploadSatellitePreviewToS3(config, {
      key: storageKey,
      body: image.body,
      contentType: image.mimeType,
    });
    logger.log?.(`[copernicus] s3 upload completed event=${event.id} key=${storageKey}`);

    await updateObservation(supabase, claimed.id, {
      status: "available",
      provider: "copernicus",
      collection: observation.collection,
      observation_type: observation.observationType,
      acquisition_time: observation.acquisitionTime,
      event_time_relation: observation.eventTimeRelation,
      cloud_cover: observation.cloudCover,
      bbox: observation.bbox,
      centre_latitude: Number(event.lat),
      centre_longitude: Number(event.lon),
      source_item_id: observation.sourceItemId,
      image_url: uploaded.imageUrl,
      storage_key: uploaded.storageKey,
      mime_type: image.mimeType,
      width: config.previewWidth,
      height: config.previewHeight,
      byte_size: image.byteSize,
      checksum: image.checksum,
      etag: uploaded.etag,
      cache_key: cacheKey,
      next_retry_at: null,
      error_code: null,
      error_message_sanitized: null,
      expires_at: getSatelliteExpiresAt(event),
    });
    await incrementUsage(supabase, { successful_images_generated: 1, estimated_processing_units: 1 });
    logger.log?.(`[copernicus] process request completed event=${event.id}`);
    return { ok: true, available: true };
  } catch (error) {
    const retryAfterMs = error instanceof CopernicusHttpError ? Number(error.retryAfterMs || 0) : 0;
    if (error instanceof CopernicusHttpError && error.status === 429) {
      const until = new Date(Date.now() + Math.max(retryAfterMs, 15 * 60 * 1000));
      await setRateLimitedUntil(supabase, until, "http_429");
      await incrementUsage(supabase, { http_429_responses: 1, failed_requests: 1, last_error_code: "http_429" });
      logger.warn?.(`[copernicus] rate limited until=${until.toISOString()}`);
    } else {
      await incrementUsage(supabase, { failed_requests: 1, last_error_code: sanitizeErrorCode(error) });
    }

    if (error instanceof CopernicusHttpError && error.permanent) {
      await updateObservation(supabase, claimed.id, {
        status: "permanent_error",
        error_code: sanitizeErrorCode(error),
        error_message_sanitized: sanitizeErrorMessage(error),
        next_retry_at: null,
      });
    } else {
      await markRetryableError(supabase, claimed, error, config);
    }
    logger.warn?.(`[copernicus] event=${event.id} failed code=${sanitizeErrorCode(error)} message=${sanitizeErrorMessage(error)}`);
    return { ok: false, error: sanitizeErrorCode(error) };
  }
}

async function runCopernicusSatelliteSync({ supabase, logger = console, config = readCopernicusConfig() } = {}) {
  const configStatus = getCopernicusConfigStatus(config);
  if (!config.enabled) return { ok: true, skipped: true, reason: "disabled" };
  if (!configStatus.ready) {
    logger.warn?.(`[copernicus] disabled by missing server config: ${configStatus.missing.join(", ")}`);
    return { ok: false, skipped: true, reason: "missing_config", missing: configStatus.missing };
  }

  const usage = await getUsageRow(supabase);
  const guard = canStartSatelliteJob(usage, config);
  if (!guard.ok) {
    logger.log?.(`[copernicus] quota guard activated reason=${guard.reason}`);
    return { ok: true, skipped: true, reason: guard.reason, status: await getCopernicusStatusSummary(supabase, config) };
  }

  const candidates = await listCandidateEvents(supabase, config);
  const results = {
    ok: true,
    considered_count: candidates.length,
    processed_count: 0,
    skipped_count: 0,
    available_count: 0,
    cache_hit_count: 0,
    error_count: 0,
  };

  for (const event of candidates) {
    if (results.processed_count >= config.batchSize) break;
    const row = await getUsageRow(supabase);
    const rowGuard = canStartSatelliteJob(row, config);
    if (!rowGuard.ok) break;
    const result = await processOneEvent(supabase, event, config, logger);
    if (result.skipped) {
      results.skipped_count += 1;
      continue;
    }
    results.processed_count += 1;
    if (result.available) results.available_count += 1;
    if (result.cacheHit) results.cache_hit_count += 1;
    if (!result.ok) results.error_count += 1;
  }

  results.status = await getCopernicusStatusSummary(supabase, config);
  if (results.error_count > 0) results.ok = false;
  return results;
}

async function cleanupExpiredSatelliteObservations({ supabase, logger = console, config = readCopernicusConfig() } = {}) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .select("id, storage_key, status")
    .lt("expires_at", nowIso)
    .neq("status", "expired")
    .limit(50);
  if (error) throw error;

  let expired = 0;
  let deleted = 0;
  for (const row of data || []) {
    const storageKey = row.storage_key;
    await updateObservation(supabase, row.id, {
      status: "expired",
      error_code: null,
      error_message_sanitized: null,
    });
    expired += 1;

    if (!storageKey) continue;
    const refs = await supabase
      .from("event_satellite_observations")
      .select("id")
      .eq("storage_key", storageKey)
      .neq("status", "expired")
      .gt("expires_at", nowIso)
      .limit(1);
    if (!refs.error && (!refs.data || refs.data.length === 0)) {
      const deleteResult = await deleteSatellitePreviewFromS3(config, storageKey);
      if (deleteResult.ok) deleted += 1;
      else logger.warn?.(`[copernicus] cleanup delete failed key=${storageKey} error=${sanitizeForLog(deleteResult.error)}`);
    }
  }

  if (expired || deleted) {
    logger.log?.(`[copernicus] cleanup completed expired=${expired} deleted=${deleted}`);
  }
  return { ok: true, expired_count: expired, deleted_count: deleted };
}

export {
  cleanupExpiredSatelliteObservations,
  processOneEvent,
  runCopernicusSatelliteSync,
};
