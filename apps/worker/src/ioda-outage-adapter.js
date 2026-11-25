// Normalize public IODA v2 country outage events for the existing network pipeline.
const IODA_EVENTS_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events";
const IODA_WINDOW_SECONDS = 6 * 60 * 60;
const IODA_MAX_EVENTS = 25;

function buildIodaQuery(nowMs = Date.now()) {
  const until = Math.floor(nowMs / 1000);
  return { from: until - IODA_WINDOW_SECONDS, until, entityType: "country", format: "codf", limit: 100, page: 0 };
}

function unwrapIodaEvents(payload) {
  if (payload?.error) throw new Error(`IODA API error: ${String(payload.error).slice(0, 160)}`);
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data?.results)) return data.results;
  throw new Error("Unexpected IODA outage events response");
}

function normalizedIodaTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === "string" && value.trim()) {
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) return normalizedIodaTimestamp(Number(value));
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
}

function normalizeIodaCountryOutage(item) {
  if (!item || typeof item !== "object") return null;
  const location = String(item.location || "").trim();
  const parts = location.match(/^country\/([A-Z]{2})$/i);
  const countryCode = String(item.entityCode || item.entity?.code || parts?.[1] || "").trim().toUpperCase();
  const entityType = String(item.entityType || item.entity?.type || (parts ? "country" : "")).toLowerCase();
  if (entityType !== "country" || !/^[A-Z]{2}$/.test(countryCode)) return null;
  const countryName = String(item.location_name || item.entity?.name || "").trim();
  if (!countryName) return null;
  const startedAt = normalizedIodaTimestamp(item.start ?? item.from ?? item.started_at);
  if (!startedAt) return null;
  const datasource = String(item.datasource || "unknown").trim().toLowerCase();
  const score = Number(item.score);
  return {
    countryCode, countryName, datasource, startedAt,
    score: Number.isFinite(score) ? score : null,
    durationSeconds: Number.isFinite(Number(item.duration)) ? Math.max(0, Number(item.duration)) : null,
    url: `https://ioda.inetintel.cc.gatech.edu/country/${encodeURIComponent(countryCode)}`,
    dedupeKey: `IODA|country/${countryCode}|${datasource}|${startedAt}`
  };
}

function parseIodaCountryOutages(payload, maxEvents = IODA_MAX_EVENTS) {
  const seen = new Set();
  const limit = Math.max(0, Math.min(100, Number(maxEvents) || 0));
  const result = [];
  for (const item of unwrapIodaEvents(payload)) {
    const normalized = normalizeIodaCountryOutage(item);
    if (!normalized || seen.has(normalized.dedupeKey)) continue;
    seen.add(normalized.dedupeKey);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}
export { IODA_EVENTS_URL, buildIodaQuery, unwrapIodaEvents, normalizedIodaTimestamp, normalizeIodaCountryOutage, parseIodaCountryOutages };
