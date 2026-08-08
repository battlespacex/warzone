import {
  LOCATION_PRECISION,
  hasFiniteCoordinates,
  isMapMarkerPrecision,
  isUnsafeLocationMethod,
  normalizeLocationPrecision,
  readEventLocation,
} from "./event-location-policy.js";
import { resolveSourceProfile } from "./source-quality-policy.js";
import {
  buildSpatialEventClusters,
  classifyEventDomain,
} from "../../dev/assets/js/warzone-event-cluster-model.js";

const SNAPSHOT_SCHEMA_VERSION = 1;
const MAX_MAJOR_DEVELOPMENTS = 25;
const MAX_BROAD_INTELLIGENCE = 20;
const REPORT_SECTION_KEYS = Object.freeze([
  "executive_summary",
  "statistics",
  "theater_summaries",
  "operational_overview",
  "key_judgments",
  "watch_indicators",
  "major_intelligence_developments",
  "event_cards",
  "verification_and_sources",
  "high_value_assets",
  "intelligence_wire_synthesis",
  "cross_domain_assessment",
  "outlook",
  "methodology",
  "disclaimer",
]);

const SEVERITY_SCORE = Object.freeze({ unknown: 0, low: 4, medium: 12, high: 25, critical: 40 });
const VERIFICATION_SCORE = Object.freeze({
  UNVERIFIED: 0,
  REPORTED: 6,
  DISPUTED: 4,
  CORROBORATED: 15,
  CONFIRMED: 22,
});
const SOURCE_TIER_SCORE = Object.freeze({ TIER_1: 10, TIER_2: 7, TIER_3: 3, UNRATED: 1 });
const DOMAIN_SCORE = Object.freeze({
  MISSILE: 8,
  STRIKE: 7,
  ARTILLERY: 6,
  AIR_DEFENCE: 6,
  AIR: 5,
  MARITIME: 5,
  CYBER: 5,
  GNSS: 4,
  ALERT: 4,
  MIXED: 2,
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value = "", fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function slugify(value = "") {
  return cleanText(value, "all")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "all";
}

function getTimestamp(item = {}) {
  return item.occurred_at || item.published_at || item.fetched_at || item.created_at || null;
}

function getQuality(item = {}) {
  const metadata = asObject(item.metadata);
  const raw = asObject(item.raw);
  return asObject(item.event_quality || metadata.event_quality || raw._event_quality);
}

function getEmbeddedLocation(item = {}) {
  const metadata = asObject(item.metadata);
  const raw = asObject(item.raw);
  const rawMetadata = asObject(raw.metadata);
  return {
    ...asObject(rawMetadata.event_location),
    ...asObject(raw.event_location),
    ...asObject(raw._event_location),
    ...asObject(metadata.event_location),
  };
}

function normalizeReportLocation(item = {}, { allowStoredPoint = false } = {}) {
  const embedded = getEmbeddedLocation(item);
  const policyLocation = readEventLocation(item);
  const precision = normalizeLocationPrecision(
    item.location_precision || embedded.precision || policyLocation.precision,
    LOCATION_PRECISION.UNKNOWN
  );
  const method = cleanText(item.location_method || embedded.method || policyLocation.method, "not_found");
  const confidenceValue = Number(item.location_confidence ?? embedded.confidence ?? policyLocation.confidence);
  const pointAllowed = allowStoredPoint && isMapMarkerPrecision(precision) && !isUnsafeLocationMethod(method);
  const embeddedLat = embedded.latitude ?? embedded.lat;
  const embeddedLon = embedded.longitude ?? embedded.lon;
  const hasEmbeddedPoint = hasFiniteCoordinates(embeddedLat, embeddedLon);
  const latValue = hasEmbeddedPoint ? embeddedLat : (item.lat ?? item.latitude);
  const lonValue = hasEmbeddedPoint ? embeddedLon : (item.lon ?? item.longitude);
  const hasPoint = pointAllowed && hasFiniteCoordinates(latValue, lonValue);
  const regionalAnchorLat = embedded.regional_anchor_latitude ?? embedded.anchor_lat;
  const regionalAnchorLon = embedded.regional_anchor_longitude ?? embedded.anchor_lon;
  const hasRegionalAnchor = hasFiniteCoordinates(regionalAnchorLat, regionalAnchorLon);
  return {
    event_country: cleanText(item.event_country || embedded.country || policyLocation.event_country, "") || null,
    event_region: cleanText(item.event_region || embedded.region || policyLocation.event_region, "") || null,
    event_city: cleanText(item.event_city || embedded.city || policyLocation.event_city, "") || null,
    event_place: cleanText(item.event_place || embedded.place || policyLocation.event_place, "") || null,
    latitude: hasPoint ? Number(latValue) : null,
    longitude: hasPoint ? Number(lonValue) : null,
    regional_anchor: hasRegionalAnchor
      ? { latitude: Number(regionalAnchorLat), longitude: Number(regionalAnchorLon) }
      : null,
    location_precision: precision,
    location_confidence: Number.isFinite(confidenceValue) ? confidenceValue : 0,
    location_method: method,
  };
}

function normalizeQuality(item = {}) {
  const quality = getQuality(item);
  const profile = resolveSourceProfile({
    ...item,
    source_class: item.source_class || quality.source_class,
    source_tier: item.source_tier || quality.source_tier,
    source_family: item.source_family || quality.source_family,
    source_reliability: item.source_reliability || quality.source_reliability,
  });
  const provenance = Array.isArray(quality.source_provenance)
    ? quality.source_provenance.map((entry) => ({ ...entry }))
    : [];
  const families = Array.isArray(quality.independent_source_families)
    ? quality.independent_source_families.filter(Boolean)
    : [...new Set(provenance.map((entry) => entry.source_family).filter(Boolean))];
  if (!families.length && profile.source_family) families.push(profile.source_family);
  const rawReportCount = Math.max(1, Number(quality.raw_report_count || item.raw_report_count || item.source_count || provenance.length || 1));
  const independentCount = Math.max(1, Number(quality.independent_source_family_count || item.independent_source_family_count || families.length || 1));
  const state = cleanText(item.corroboration_state || quality.corroboration_state, "REPORTED").toUpperCase();
  const confidence = Number(item.confidence ?? item.confidence_score ?? quality.confidence);
  return {
    verification_state: state,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 0,
    source_class: profile.source_class,
    source_tier: profile.source_tier,
    source_family: profile.source_family,
    source_reliability: Number(profile.source_reliability || 0),
    raw_report_count: rawReportCount,
    independent_source_family_count: independentCount,
    independent_source_families: families,
    official_confirmation: quality.official_confirmation === true,
    direct_evidence: quality.direct_evidence === true,
    disputed: quality.disputed === true || state === "DISPUTED",
    source_provenance: provenance,
    event_fingerprint: cleanText(quality.event_fingerprint, "") || null,
  };
}

function getTheater(item = {}, location = {}) {
  const metadata = asObject(item.metadata);
  const raw = asObject(item.raw);
  const normalization = asObject(metadata.normalization);
  const rawNormalization = asObject(asObject(raw.metadata).normalization);
  const name = cleanText(
    item.theater || item.theatre || normalization.operational_theatre || rawNormalization.operational_theatre
      || location.event_region || location.event_country,
    "Unspecified"
  );
  return { id: slugify(name), name };
}

function normalizeReportItem(item = {}, recordType = "operational_event") {
  const isOperationalEvent = recordType === "operational_event";
  const embeddedLocation = getEmbeddedLocation(item);
  const embeddedMethod = cleanText(embeddedLocation.method, "");
  const hasTrustedEmbeddedPoint = Boolean(embeddedMethod)
    && isMapMarkerPrecision(embeddedLocation.precision)
    && !isUnsafeLocationMethod(embeddedMethod)
    && hasFiniteCoordinates(
      embeddedLocation.latitude ?? embeddedLocation.lat,
      embeddedLocation.longitude ?? embeddedLocation.lon
    );
  const location = normalizeReportLocation(item, { allowStoredPoint: isOperationalEvent || hasTrustedEmbeddedPoint });
  const quality = normalizeQuality(item);
  const theater = getTheater(item, location);
  const stableId = cleanText(item.id || item.guid || item.url || item.source_url, "");
  const reportItemId = `${isOperationalEvent ? "event" : "intel"}:${stableId || quality.event_fingerprint || slugify(item.title)}`;
  const domain = classifyEventDomain({
    ...item,
    lat: location.latitude,
    lon: location.longitude,
    location_precision: location.location_precision,
  });
  return {
    report_item_id: reportItemId,
    record_type: recordType,
    event_id: isOperationalEvent ? stableId || null : null,
    intelligence_id: isOperationalEvent ? null : stableId || null,
    title: cleanText(item.title, "Activity report"),
    summary: cleanText(item.summary || item.description, ""),
    occurred_at: getTimestamp(item),
    category: cleanText(item.category, "unknown").toLowerCase(),
    subcategory: cleanText(item.subcategory, "").toLowerCase() || null,
    domain,
    severity: cleanText(item.severity || asObject(item.raw).severity, "unknown").toLowerCase(),
    source_name: cleanText(item.source_name, "") || null,
    source_url: cleanText(item.source_url || item.url, "") || null,
    theater_id: theater.id,
    theater_name: theater.name,
    event_country_code: cleanText(item.country_code || embeddedLocation.country_code, "").toUpperCase() || null,
    location_label: cleanText(
      item.location_label || location.event_place || location.event_city || location.event_region || location.event_country,
      "Unknown location"
    ),
    ...location,
    ...quality,
  };
}

function canonicalUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]
      .forEach((key) => parsed.searchParams.delete(key));
    return parsed.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return cleanText(value, "").toLowerCase();
  }
}

function calculateReportRelevance(item = {}, windowEndIso) {
  const severity = SEVERITY_SCORE[item.severity] || 0;
  const verification = VERIFICATION_SCORE[item.verification_state] || 0;
  const tier = SOURCE_TIER_SCORE[item.source_tier] || SOURCE_TIER_SCORE.UNRATED;
  const confidence = Number(item.confidence || 0) * 0.22;
  const family = Math.min(12, Math.max(0, Number(item.independent_source_family_count || 1) - 1) * 4);
  const evidence = (item.official_confirmation ? 7 : 0) + (item.direct_evidence ? 5 : 0);
  const domain = DOMAIN_SCORE[item.domain] || 0;
  const precision = {
    [LOCATION_PRECISION.EXACT]: 5,
    [LOCATION_PRECISION.LOCAL]: 4,
    [LOCATION_PRECISION.REGIONAL]: 3,
    [LOCATION_PRECISION.UNKNOWN]: 0,
  }[item.location_precision] || 0;
  const occurred = Date.parse(item.occurred_at || "");
  const end = Date.parse(windowEndIso || "");
  const ageHours = Number.isFinite(occurred) && Number.isFinite(end) ? Math.max(0, (end - occurred) / 3600000) : 24;
  const recency = Math.max(0, 8 - ageHours / 3);
  const operational = item.record_type === "operational_event" ? 5 : 0;
  return Number((severity + verification + tier + confidence + family + evidence + domain + precision + recency + operational).toFixed(3));
}

function compareRelevance(left, right) {
  return Number(right.report_relevance_score || 0) - Number(left.report_relevance_score || 0)
    || Date.parse(right.occurred_at || 0) - Date.parse(left.occurred_at || 0)
    || String(left.report_item_id).localeCompare(String(right.report_item_id));
}

function buildReportSnapshotItems(events = [], intelligence = [], { windowEndIso } = {}) {
  const operational = (Array.isArray(events) ? events : [])
    .map((event) => normalizeReportItem(event, "operational_event"));
  const eventUrls = new Set(operational.map((item) => canonicalUrl(item.source_url)).filter(Boolean));
  const eventFingerprints = new Set(operational.map((item) => item.event_fingerprint).filter(Boolean));
  const broader = (Array.isArray(intelligence) ? intelligence : [])
    .map((item) => normalizeReportItem(item, "broader_intelligence"))
    .filter((item) => {
      const url = canonicalUrl(item.source_url);
      return !(url && eventUrls.has(url)) && !(item.event_fingerprint && eventFingerprints.has(item.event_fingerprint));
    });
  return [...operational, ...broader]
    .map((item) => ({
      ...item,
      report_relevance_score: calculateReportRelevance(item, windowEndIso),
    }));
}

function reportItemMatchesScope(item = {}, scope = {}) {
  const type = cleanText(scope.type, "global").toLowerCase();
  if (type === "global") return true;
  const wanted = cleanText(scope.value || scope.label, "").toLowerCase();
  if (type === "country") {
    return cleanText(item.event_country, "").toLowerCase() === wanted
      || cleanText(item.event_country_code, "").toLowerCase() === wanted;
  }
  if (type === "region") {
    return [item.event_region, item.theater_name]
      .some((value) => cleanText(value, "").toLowerCase().includes(wanted));
  }
  if (type === "aoi" && Array.isArray(scope.bbox) && scope.bbox.length === 4) {
    const [west, south, east, north] = scope.bbox.map(Number);
    return [west, south, east, north, item.latitude, item.longitude].every(Number.isFinite)
      && item.longitude >= west && item.longitude <= east
      && item.latitude >= south && item.latitude <= north;
  }
  return false;
}

function countValues(items = [], selector) {
  return items.reduce((counts, item) => {
    const value = cleanText(selector(item), "unknown").toLowerCase();
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function getLatestTime(items = []) {
  return items.map((item) => item.occurred_at).filter(Boolean).sort().at(-1) || null;
}

function buildTheaterSummaries(items = [], clusters = []) {
  const groups = new Map();
  items.forEach((item) => {
    const key = item.theater_id || "unspecified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.entries()].map(([theaterId, theaterItems]) => {
    const domainCounts = countValues(theaterItems, (item) => item.domain);
    const orderedDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const orderedItems = [...theaterItems].sort(compareRelevance);
    const firstHalf = theaterItems.filter((item) => {
      const parsed = Date.parse(item.occurred_at || "");
      return Number.isFinite(parsed) && new Date(parsed).getUTCHours() < 12;
    }).length;
    const secondHalf = theaterItems.length - firstHalf;
    const delta = secondHalf - firstHalf;
    const families = new Set(theaterItems.flatMap((item) => item.independent_source_families || []).filter(Boolean));
    const theaterEventIds = new Set(theaterItems.map((item) => item.event_id).filter(Boolean));
    const majorClusters = clusters
      .filter((cluster) => cluster.event_ids.some((eventId) => theaterEventIds.has(eventId)))
      .sort((left, right) => Number(right.activity_score || 0) - Number(left.activity_score || 0))
      .slice(0, 5)
      .map((cluster) => cluster.cluster_id);
    return {
      theater_id: theaterId,
      theater_name: theaterItems[0]?.theater_name || "Unspecified",
      event_count: theaterItems.length,
      operational_event_count: theaterItems.filter((item) => item.record_type === "operational_event").length,
      intelligence_count: theaterItems.filter((item) => item.record_type === "broader_intelligence").length,
      critical_count: theaterItems.filter((item) => item.severity === "critical").length,
      high_count: theaterItems.filter((item) => item.severity === "high").length,
      corroborated_count: theaterItems.filter((item) => ["CONFIRMED", "CORROBORATED"].includes(item.verification_state)).length,
      dominant_domains: orderedDomains.slice(0, 3).map(([domain, count]) => ({ domain: domain.toUpperCase(), count })),
      major_clusters: majorClusters,
      latest_activity: getLatestTime(theaterItems),
      activity_change: { direction: delta > 1 ? "increasing" : delta < -1 ? "decreasing" : "stable", delta },
      major_event_ids: orderedItems.map((item) => item.event_id).filter(Boolean).slice(0, 10),
      source_family_count: families.size,
    };
  }).sort((left, right) => right.event_count - left.event_count || left.theater_id.localeCompare(right.theater_id));
}

function buildActivityByHour(items = []) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, operational: 0, intelligence: 0 }));
  items.forEach((item) => {
    const parsed = new Date(item.occurred_at || "");
    if (Number.isNaN(parsed.getTime())) return;
    const bucket = hours[parsed.getUTCHours()];
    bucket.total += 1;
    if (item.record_type === "operational_event") bucket.operational += 1;
    else bucket.intelligence += 1;
  });
  return hours;
}

function buildClusterSummaries(items = [], windowEndIso) {
  const pointItems = items.filter((item) => item.record_type === "operational_event")
    .map((item) => ({
      ...item,
      id: item.event_id,
      lat: item.latitude,
      lon: item.longitude,
      location_precision: item.location_precision,
      corroboration_state: item.verification_state,
    }));
  const byId = new Map(pointItems.map((item) => [String(item.id), item]));
  const nowMs = Date.parse(windowEndIso || "");
  return buildSpatialEventClusters(pointItems, {
    zoomBucket: "regional",
    nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
    pulseCap: 0,
  }).map((cluster) => ({
    cluster_id: cluster.cluster_id,
    event_ids: cluster.event_ids,
    incident_count: cluster.actual_event_count,
    activity_score: cluster.weighted_activity_score,
    dominant_domain: cluster.dominant_domain,
    domain_distribution: cluster.domain_distribution,
    severity: cluster.severity,
    latest_activity: cluster.latest_event_time,
    medoid: { latitude: Number(cluster.lat), longitude: Number(cluster.lon) },
    centroid: { latitude: Number(cluster.centroid?.lat), longitude: Number(cluster.centroid?.lon) },
    bounds: cluster.bounds,
    center_method: cluster.center_method,
    location_label: cleanText(cluster.event_place || cluster.event_city || cluster.event_region || cluster.event_country, "Operational area"),
    corroborated_count: cluster.event_ids.filter((id) => ["CONFIRMED", "CORROBORATED"].includes(byId.get(String(id))?.verification_state)).length,
  }));
}

function getScopePath(scope = {}) {
  const type = cleanText(scope.type, "global").toLowerCase();
  if (type === "global") return "global";
  return `${type}/${slugify(scope.value || scope.label)}`;
}

function buildSnapshotKey(dateKey, scopeKey, version = SNAPSHOT_SCHEMA_VERSION) {
  return `daily:${dateKey}:${scopeKey}:v${version}`;
}

function buildReportObjectKeys({ prefix = "reports", dateKey, scope = {} } = {}) {
  const base = `${String(prefix || "reports").replace(/^\/+|\/+$/g, "")}/daily/${getScopePath(scope)}/${dateKey}`;
  return {
    base,
    report_json: `${base}/report.json`,
    manifest_json: `${base}/manifest.json`,
    report_html: `${base}/report.html`,
    report_pdf: `${base}/report.pdf`,
    images_prefix: `${base}/images/`,
  };
}

function buildReportingFoundation({ dateKey, windowStartIso, windowEndIso, scope, scopeKey, events = [], intelligence = [], counts = {}, s3Prefix = "reports" } = {}) {
  const items = buildReportSnapshotItems(events, intelligence, { windowEndIso })
    .filter((item) => reportItemMatchesScope(item, scope));
  const operationalItems = items.filter((item) => item.record_type === "operational_event");
  const broaderItems = items.filter((item) => item.record_type === "broader_intelligence");
  const ordered = [...items].sort(compareRelevance);
  const majorDevelopments = ordered.slice(0, MAX_MAJOR_DEVELOPMENTS);
  const selectedIntelligence = broaderItems.sort(compareRelevance).slice(0, MAX_BROAD_INTELLIGENCE);
  const clusters = buildClusterSummaries(operationalItems, windowEndIso);
  const theaters = buildTheaterSummaries(items, clusters);
  const families = new Set(items.flatMap((item) => item.independent_source_families || []).filter(Boolean));
  const snapshotKey = buildSnapshotKey(dateKey, scopeKey);
  const objectKeys = buildReportObjectKeys({ prefix: s3Prefix, dateKey, scope });
  const snapshotData = {
    snapshot_schema_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_key: snapshotKey,
    report_date: dateKey,
    window: { start: windowStartIso, end: windowEndIso, timezone: "UTC" },
    scope: { type: scope.type, key: scopeKey, value: scope.value || null, label: scope.label },
    overall_activity: {
      total_report_items: items.length,
      operational_event_total: operationalItems.length,
      broader_intelligence_total: broaderItems.length,
      aircraft_total: Number(counts.aircraft_total || 0),
      naval_total: Number(counts.naval_total || 0),
      alerts_total: Number(counts.alerts_total || 0),
      satellite_total: Number(counts.satellite_total || 0),
      high_value_asset_candidate_total: 0,
    },
    aggregates: {
      by_theater: theaters,
      by_country: countValues(items, (item) => item.event_country),
      by_domain: countValues(items, (item) => item.domain),
      by_severity: countValues(items, (item) => item.severity),
      by_verification_state: countValues(items, (item) => item.verification_state),
      by_source_class: countValues(items, (item) => item.source_class),
      by_source_tier: countValues(items, (item) => item.source_tier),
      activity_by_hour: buildActivityByHour(items),
    },
    source_consensus: {
      independent_source_families: [...families].sort(),
      independent_source_family_count: families.size,
      raw_report_count: items.reduce((sum, item) => sum + Number(item.raw_report_count || 0), 0),
      official_confirmation_count: items.filter((item) => item.official_confirmation).length,
      direct_evidence_count: items.filter((item) => item.direct_evidence).length,
      disputed_count: items.filter((item) => item.disputed).length,
    },
    selections: {
      major_developments: majorDevelopments,
      broader_intelligence: selectedIntelligence,
      high_value_asset_candidates: [],
    },
    cluster_summaries: clusters,
    domain_summaries: countValues(items, (item) => item.domain),
    reserved: {
      key_judgments: [],
      watch_indicators: [],
      cross_domain_assessment: null,
      outlook: null,
      selected_images: [],
    },
  };
  const manifest = {
    report_id: snapshotKey,
    report_date: dateKey,
    scope: snapshotData.scope,
    window_start: windowStartIso,
    window_end: windowEndIso,
    snapshot_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: null,
    event_ids: operationalItems.map((item) => item.event_id).filter(Boolean),
    intelligence_ids: broaderItems.map((item) => item.intelligence_id).filter(Boolean),
    cluster_ids: clusters.map((cluster) => cluster.cluster_id),
    selected_developments: majorDevelopments.map((item) => item.report_item_id),
    selected_hva: [],
    selected_images: [],
    report_sections: REPORT_SECTION_KEYS,
    generation_status: "snapshot_ready",
    object_keys: objectKeys,
  };
  return { snapshotKey, snapshotData, manifest, items, operationalItems, broaderItems, clusters, theaters };
}

export {
  REPORT_SECTION_KEYS,
  SNAPSHOT_SCHEMA_VERSION,
  buildReportObjectKeys,
  buildReportSnapshotItems,
  buildReportingFoundation,
  buildSnapshotKey,
  calculateReportRelevance,
  reportItemMatchesScope,
};
