const MAP_EVENT_HISTORY_WINDOW_HOURS = 7 * 24;
const MAP_EVENT_FULL_RELEVANCE_WINDOW_HOURS = 72;
const MAP_EVENT_HISTORY_WINDOW_MS = MAP_EVENT_HISTORY_WINDOW_HOURS * 60 * 60 * 1000;
const MAP_EVENT_FULL_RELEVANCE_WINDOW_MS = MAP_EVENT_FULL_RELEVANCE_WINDOW_HOURS * 60 * 60 * 1000;

const MAP_EVENT_HISTORICAL_MIN_PRIORITY_SCORE = 80;
const MAP_EVENT_HISTORICAL_MIN_CONFIDENCE = 65;
const MAP_EVENT_HISTORICAL_MIN_SOURCE_COUNT = 2;

const GENERAL_EVENT_REPORT_TYPE_FILTER =
  "report_type.is.null,report_type.not.in.(flight_tracking,aircraft_telemetry,aircraft_tracking)";
const GENERAL_EVENT_SOURCE_FILTER =
  "source_name.is.null,and(source_name.not.ilike.*ads-b*,source_name.not.ilike.*airplanes.live*,source_name.not.ilike.*opensky*)";

function getEventTimestampMs(event = {}) {
  const value = event.occurred_at || event.occurredAt || event.published_at || event.publishedAt;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function getEventSourceCount(event = {}) {
  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const corroboration = metadata.corroboration && typeof metadata.corroboration === "object"
    ? metadata.corroboration
    : {};
  const values = [
    event.source_count,
    event.independent_source_count,
    metadata.source_count,
    metadata.independent_source_count,
    corroboration.source_count,
    corroboration.independent_source_count,
  ]
    .map(Number)
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 1;
}

function isMapEventHistoricallyRelevant(event = {}, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const timestamp = getEventTimestampMs(event);
  if (!Number.isFinite(timestamp)) return true;

  const ageMs = Math.max(0, now - timestamp);
  if (ageMs <= MAP_EVENT_FULL_RELEVANCE_WINDOW_MS) return true;
  if (ageMs > MAP_EVENT_HISTORY_WINDOW_MS) return false;

  const severity = String(event.severity || "").trim().toLowerCase();
  if (severity === "high" || severity === "critical") return true;
  if (event.is_breaking === true || event.isBreaking === true) return true;
  if (getEventSourceCount(event) >= MAP_EVENT_HISTORICAL_MIN_SOURCE_COUNT) return true;

  const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const priority = Number(event.priority_score ?? event.priorityScore ?? metadata.priority_score);
  const confidence = Number(event.confidence ?? event.confidence_score ?? metadata.confidence_score);
  return (
    Number.isFinite(priority) &&
    priority >= MAP_EVENT_HISTORICAL_MIN_PRIORITY_SCORE &&
    Number.isFinite(confidence) &&
    confidence >= MAP_EVENT_HISTORICAL_MIN_CONFIDENCE
  );
}

function buildMapEventHistoricalQueryFilter(options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const fullRelevanceCutoff = new Date(now - MAP_EVENT_FULL_RELEVANCE_WINDOW_MS).toISOString();
  return [
    `occurred_at.gte.${fullRelevanceCutoff}`,
    "severity.in.(high,critical)",
    `source_count.gte.${MAP_EVENT_HISTORICAL_MIN_SOURCE_COUNT}`,
    "is_breaking.eq.true",
    `and(priority_score.gte.${MAP_EVENT_HISTORICAL_MIN_PRIORITY_SCORE},confidence.gte.${MAP_EVENT_HISTORICAL_MIN_CONFIDENCE})`,
  ].join(",");
}

function applyGeneralEventDeliveryFilters(query) {
  return query
    .or(GENERAL_EVENT_REPORT_TYPE_FILTER)
    .or(GENERAL_EVENT_SOURCE_FILTER);
}

function applyMapEventHistoricalQueryFilter(query, options = {}) {
  return query.or(buildMapEventHistoricalQueryFilter(options));
}

export {
  GENERAL_EVENT_REPORT_TYPE_FILTER,
  GENERAL_EVENT_SOURCE_FILTER,
  MAP_EVENT_FULL_RELEVANCE_WINDOW_HOURS,
  MAP_EVENT_FULL_RELEVANCE_WINDOW_MS,
  MAP_EVENT_HISTORICAL_MIN_CONFIDENCE,
  MAP_EVENT_HISTORICAL_MIN_PRIORITY_SCORE,
  MAP_EVENT_HISTORICAL_MIN_SOURCE_COUNT,
  MAP_EVENT_HISTORY_WINDOW_HOURS,
  MAP_EVENT_HISTORY_WINDOW_MS,
  applyGeneralEventDeliveryFilters,
  applyMapEventHistoricalQueryFilter,
  buildMapEventHistoricalQueryFilter,
  isMapEventHistoricallyRelevant,
};
