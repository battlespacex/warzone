function getUtcDateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function emptyUsage(date = getUtcDateKey()) {
  return {
    utc_date: date,
    catalog_requests_attempted: 0,
    process_requests_attempted: 0,
    successful_images_generated: 0,
    estimated_processing_units: 0,
    http_429_responses: 0,
    failed_requests: 0,
    skipped_events: 0,
    cache_hits: 0,
    last_request_at: null,
    rate_limited_until: null,
    last_successful_request_at: null,
    last_error_code: null,
  };
}

async function getUsageRow(supabase, date = getUtcDateKey()) {
  const { data, error } = await supabase
    .from("copernicus_usage_daily")
    .select("*")
    .eq("utc_date", date)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const initial = emptyUsage(date);
  const inserted = await supabase
    .from("copernicus_usage_daily")
    .upsert(initial, { onConflict: "utc_date" })
    .select("*")
    .maybeSingle();
  if (inserted.error) throw inserted.error;
  return inserted.data || initial;
}

function isRateLimited(row = {}, now = new Date()) {
  const untilMs = Date.parse(row.rate_limited_until || "");
  return Number.isFinite(untilMs) && untilMs > now.getTime();
}

function canStartSatelliteJob(row = {}, config = {}, now = new Date()) {
  if (isRateLimited(row, now)) {
    return { ok: false, reason: "rate_limited" };
  }
  const generated = Number(row.successful_images_generated || 0);
  if (generated >= config.dailyEventLimit) {
    return { ok: false, reason: "daily_limit" };
  }
  return { ok: true, reason: "ok" };
}

async function incrementUsage(supabase, fields = {}, date = getUtcDateKey()) {
  const row = await getUsageRow(supabase, date);
  const payload = {
    updated_at: new Date().toISOString(),
  };
  for (const [field, delta] of Object.entries(fields)) {
    if (delta === undefined || delta === null) continue;
    const current = Number(row[field] || 0);
    payload[field] = current + Number(delta || 0);
  }
  if (
    fields.catalog_requests_attempted ||
    fields.process_requests_attempted ||
    fields.failed_requests ||
    fields.http_429_responses
  ) {
    payload.last_request_at = new Date().toISOString();
  }
  if (fields.successful_images_generated || fields.cache_hits) {
    payload.last_successful_request_at = new Date().toISOString();
  }
  if (fields.last_error_code) {
    payload.last_error_code = String(fields.last_error_code).slice(0, 80);
  }

  const { error } = await supabase
    .from("copernicus_usage_daily")
    .update(payload)
    .eq("utc_date", date);
  if (error) throw error;
  return { ...row, ...payload };
}

async function setRateLimitedUntil(supabase, until, errorCode = "rate_limited") {
  const date = getUtcDateKey();
  await getUsageRow(supabase, date);
  const { error } = await supabase
    .from("copernicus_usage_daily")
    .update({
      rate_limited_until: until instanceof Date ? until.toISOString() : until,
      last_error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq("utc_date", date);
  if (error) throw error;
}

async function getCopernicusStatusSummary(supabase, config = {}) {
  const row = await getUsageRow(supabase);
  return {
    copernicusEnabled: config.enabled === true,
    dailyLimit: config.dailyEventLimit,
    eventsProcessedToday: Number(row.successful_images_generated || 0),
    catalogRequestsToday: Number(row.catalog_requests_attempted || 0),
    processRequestsToday: Number(row.process_requests_attempted || 0),
    imagesGeneratedToday: Number(row.successful_images_generated || 0),
    cacheHitsToday: Number(row.cache_hits || 0),
    rateLimitedUntil: row.rate_limited_until || null,
    lastSuccessfulRequestAt: row.last_successful_request_at || null,
    lastErrorCode: row.last_error_code || null,
  };
}

export {
  canStartSatelliteJob,
  getCopernicusStatusSummary,
  getUsageRow,
  getUtcDateKey,
  incrementUsage,
  isRateLimited,
  setRateLimitedUntil,
};
