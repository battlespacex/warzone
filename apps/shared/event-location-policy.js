const LOCATION_PRECISION = Object.freeze({
  EXACT: "EXACT",
  LOCAL: "LOCAL",
  REGIONAL: "REGIONAL",
  UNKNOWN: "UNKNOWN",
});

const MAP_MARKER_PRECISIONS = new Set([
  LOCATION_PRECISION.EXACT,
  LOCATION_PRECISION.LOCAL,
]);

const UNSAFE_LOCATION_METHOD_RE =
  /(?:^|_)(?:source|publisher|feed_region|country_center|country_centroid|hotspot|synthetic)(?:_|$)/i;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeLocationPrecision(value, fallback = LOCATION_PRECISION.UNKNOWN) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["EXACT", "EXACT_COORDINATES", "FACILITY", "AIRPORT", "PORT", "MILITARY_BASE"].includes(normalized)) {
    return LOCATION_PRECISION.EXACT;
  }
  if (["LOCAL", "CITY", "TOWN", "DISTRICT", "CAPITAL", "NEAR_CITY", "NEAR_LOCALITY"].includes(normalized)) {
    return LOCATION_PRECISION.LOCAL;
  }
  if (["REGIONAL", "REGION", "AREA", "PROVINCE", "STATE", "MARITIME_AREA", "COUNTRY_HINT", "COUNTRY"].includes(normalized)) {
    return LOCATION_PRECISION.REGIONAL;
  }
  if (["UNKNOWN", "NONE", "MISSING", "NOT_FOUND"].includes(normalized)) {
    return LOCATION_PRECISION.UNKNOWN;
  }
  return fallback;
}

function readEventLocation(event = {}) {
  const metadata = asObject(event.metadata);
  const normalization = asObject(metadata.normalization);
  const eventLocation = asObject(metadata.event_location);
  const precision = normalizeLocationPrecision(
    event.location_precision ||
    event.locationPrecision ||
    eventLocation.precision ||
    normalization.location_precision,
    ""
  );
  const method = String(
    event.location_method ||
    event.locationMethod ||
    eventLocation.method ||
    normalization.location_method ||
    normalization.location_source ||
    ""
  ).trim();
  const confidenceValue = Number(
    event.location_confidence ??
    event.locationConfidence ??
    eventLocation.confidence ??
    normalization.location_confidence
  );

  return {
    precision: precision || null,
    method: method || null,
    confidence: Number.isFinite(confidenceValue) ? confidenceValue : null,
    event_country: event.event_country || event.eventCountry || eventLocation.country || normalization.event_country || null,
    event_region: event.event_region || event.eventRegion || eventLocation.region || normalization.event_region || null,
    event_city: event.event_city || event.eventCity || eventLocation.city || normalization.event_city || null,
    event_place: event.event_place || event.eventPlace || eventLocation.place || normalization.event_place || null,
    source_country: event.source_country || event.sourceCountry || normalization.source_country || normalization.publisher_country || null,
    source_region: event.source_region || event.sourceRegion || normalization.source_region || normalization.publisher_region || null,
  };
}

function isMapMarkerPrecision(value) {
  return MAP_MARKER_PRECISIONS.has(normalizeLocationPrecision(value));
}

function isUnsafeLocationMethod(value) {
  return UNSAFE_LOCATION_METHOD_RE.test(String(value || ""));
}

function hasFiniteCoordinates(latValue, lonValue) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180 &&
    !(Math.abs(lat) < 0.000001 && Math.abs(lon) < 0.000001)
  );
}

function hasTrustedMapCoordinates(event = {}, options = {}) {
  const location = readEventLocation(event);
  if (location.method && isUnsafeLocationMethod(location.method)) return false;
  if (location.precision && !isMapMarkerPrecision(location.precision)) return false;
  const lat = options.lat ?? event.lat ?? event.latitude;
  const lon = options.lon ?? event.lon ?? event.longitude;
  return hasFiniteCoordinates(lat, lon);
}

export {
  LOCATION_PRECISION,
  hasFiniteCoordinates,
  hasTrustedMapCoordinates,
  isMapMarkerPrecision,
  isUnsafeLocationMethod,
  normalizeLocationPrecision,
  readEventLocation,
};
