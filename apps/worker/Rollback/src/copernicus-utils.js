import crypto from "crypto";

const SATELLITE_VISIBLE_CATEGORIES = new Set([
  "strike",
  "thermal",
  "signal",
  "military",
  "ground_activity",
  "naval_activity",
  "alert",
]);

const SATELLITE_VISIBLE_TEXT_RE =
  /\b(airstrike|air strike|missile strike|drone strike|explosion|blast|fire|burning|infrastructure|damage|damaged|industrial|refinery|depot|warehouse|airfield|airbase|runway|port|bridge|flood|flooding|chemical|hazmat|factory|power plant|substation|oil terminal)\b/i;

const EXCLUDED_TEXT_RE =
  /\b(statement|diplomatic|diplomacy|election|contract|procurement|arms sale|budget|routine patrol|routine flight|sighting|training|exercise|drill|commentary|opinion)\b/i;

function sanitizeForLog(value = "") {
  return String(value || "")
    .replace(/(client_secret|access_token|refresh_token|authorization)=?[^&\s]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function isValidCoordinate(lat, lon) {
  if (lat === null || lat === undefined || lat === "" || lon === null || lon === undefined || lon === "") {
    return false;
  }
  const latitude = Number(lat);
  const longitude = Number(lon);
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(Math.abs(latitude) < 0.00001 && Math.abs(longitude) < 0.00001);
}

function getEventTime(event = {}) {
  const parsed = new Date(event.occurred_at || event.created_at || event.updated_at || 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isHighSeverity(event = {}) {
  const severity = String(event.severity || "").toLowerCase();
  return severity === "high" || severity === "critical";
}

function eventLooksSatelliteRelevant(event = {}) {
  const category = String(event.category || "").toLowerCase();
  const subcategory = String(event.subcategory || "").toLowerCase();
  const text = [
    event.title,
    event.summary,
    event.location_label,
    event.weapon_type,
    category,
    subcategory,
  ].filter(Boolean).join(" ");

  if (EXCLUDED_TEXT_RE.test(text) && !SATELLITE_VISIBLE_TEXT_RE.test(text)) return false;
  if (SATELLITE_VISIBLE_TEXT_RE.test(text)) return true;
  if (!SATELLITE_VISIBLE_CATEGORIES.has(category)) return false;

  return ["strike", "thermal", "signal"].includes(category) ||
    /\b(explosion|fire|airfield|runway|port|bridge|infrastructure|industrial|base)\b/i.test(subcategory);
}

function isEventEligibleForCopernicus(event = {}, config = {}) {
  if (!config.enabled) return { eligible: false, reason: "disabled" };
  if (!isValidCoordinate(event.lat, event.lon)) return { eligible: false, reason: "invalid_coordinates" };
  if (!isHighSeverity(event)) return { eligible: false, reason: "severity_not_high" };
  if (!eventLooksSatelliteRelevant(event)) return { eligible: false, reason: "category_not_supported" };

  const eventTime = getEventTime(event);
  if (!eventTime) return { eligible: false, reason: "invalid_event_time" };
  const ageMs = Date.now() - eventTime.getTime();
  if (ageMs < 0) return { eligible: false, reason: "future_event" };
  if (ageMs > 72 * 60 * 60 * 1000) return { eligible: false, reason: "older_than_72h" };

  return { eligible: true, reason: "eligible" };
}

function buildEventBbox(lat, lon, radiusKm = 7.5) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / Math.max(20, 111.32 * Math.cos(latitude * Math.PI / 180));
  return [
    Math.max(-180, longitude - lonDelta),
    Math.max(-90, latitude - latDelta),
    Math.min(180, longitude + lonDelta),
    Math.min(90, latitude + latDelta),
  ].map((value) => Number(value.toFixed(6)));
}

function normalizeBboxForCache(bbox = []) {
  return (Array.isArray(bbox) ? bbox : [])
    .slice(0, 4)
    .map((value) => Number(value).toFixed(4))
    .join(",");
}

function makeSatelliteCacheKey({
  collection,
  sourceItemId,
  acquisitionTime,
  bbox,
  width,
  height,
  visualizationVersion = "v1",
} = {}) {
  const raw = [
    collection || "unknown",
    sourceItemId || acquisitionTime || "unknown",
    normalizeBboxForCache(bbox),
    visualizationVersion,
    `${width || 512}x${height || 512}`,
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function getEventTimeRelation(acquisitionTime, eventTime) {
  const acquisitionMs = Date.parse(acquisitionTime || "");
  const eventMs = eventTime instanceof Date ? eventTime.getTime() : Date.parse(eventTime || "");
  if (!Number.isFinite(acquisitionMs) || !Number.isFinite(eventMs)) return "unknown";
  return acquisitionMs >= eventMs ? "after" : "before";
}

function extractCloudCover(feature = {}) {
  const value =
    feature.properties?.["eo:cloud_cover"] ??
    feature.properties?.cloudCover ??
    feature.properties?.cloud_cover ??
    null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getFeatureAcquisitionTime(feature = {}) {
  return feature.properties?.datetime ||
    feature.properties?.start_datetime ||
    feature.properties?.end_datetime ||
    null;
}

function normalizeCatalogFeature(feature = {}, collectionFallback = "") {
  const acquisitionTime = getFeatureAcquisitionTime(feature);
  if (!acquisitionTime) return null;
  const collection = feature.collection || collectionFallback || "";
  const sourceItemId = feature.id || feature.properties?.id || `${collection}:${acquisitionTime}`;
  return {
    raw: feature,
    sourceItemId,
    collection,
    acquisitionTime,
    cloudCover: extractCloudCover(feature),
  };
}

function rankCatalogFeatures(features = [], eventTime, { preferPostEvent = true } = {}) {
  const eventMs = eventTime instanceof Date ? eventTime.getTime() : Date.parse(eventTime || "");
  return (Array.isArray(features) ? features : [])
    .filter(Boolean)
    .sort((a, b) => {
      const aMs = Date.parse(a.acquisitionTime || "");
      const bMs = Date.parse(b.acquisitionTime || "");
      const aAfter = Number.isFinite(aMs) && Number.isFinite(eventMs) && aMs >= eventMs;
      const bAfter = Number.isFinite(bMs) && Number.isFinite(eventMs) && bMs >= eventMs;
      if (preferPostEvent && aAfter !== bAfter) return aAfter ? -1 : 1;
      const aCloud = Number.isFinite(a.cloudCover) ? a.cloudCover : 999;
      const bCloud = Number.isFinite(b.cloudCover) ? b.cloudCover : 999;
      if (aCloud !== bCloud) return aCloud - bCloud;
      const aDistance = Number.isFinite(aMs) && Number.isFinite(eventMs) ? Math.abs(aMs - eventMs) : Number.POSITIVE_INFINITY;
      const bDistance = Number.isFinite(bMs) && Number.isFinite(eventMs) ? Math.abs(bMs - eventMs) : Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    });
}

function getSatelliteExpiresAt(event = {}) {
  const eventTime = getEventTime(event) || new Date();
  return new Date(eventTime.getTime() + 72 * 60 * 60 * 1000).toISOString();
}

export {
  buildEventBbox,
  eventLooksSatelliteRelevant,
  getEventTime,
  getEventTimeRelation,
  getSatelliteExpiresAt,
  isEventEligibleForCopernicus,
  isValidCoordinate,
  makeSatelliteCacheKey,
  normalizeCatalogFeature,
  rankCatalogFeatures,
  sanitizeForLog,
};
