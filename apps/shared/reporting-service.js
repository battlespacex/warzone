import crypto from "crypto";
import { readReportingConfig } from "./reporting-config.js";
import { createReportPdfBuffer } from "./reporting-pdf.js";
import { s3PutObject } from "./reporting-s3.js";
import { applyGeneralEventDeliveryFilters } from "./map-event-policy.js";
import {
  SNAPSHOT_SCHEMA_VERSION,
  buildReportingFoundation,
  buildSnapshotKey,
} from "./reporting-snapshot.js";

const REPORT_VERSION = "2026-07-stratops-report-v2";
const NORMALIZATION_VERSION = "event-normalizer-current";
const VALID_REPORT_TYPES = new Set(["daily", "weekly"]);
const VALID_SCOPE_TYPES = new Set(["global", "region", "country", "aoi"]);
const HIGH_SEVERITIES = new Set(["high", "critical"]);
const TRACK_BOUNDARY_GRACE_MINUTES = 15;
const inFlightReportGenerations = new Map();
const DOMAIN_CATEGORY_MAP = new Map([
  ["air", ["air_activity", "military"]],
  ["maritime", ["naval_activity"]],
  ["ground", ["ground_activity", "strike"]],
  ["missiles", ["missile", "strike"]],
  ["air_defence", ["air_defence", "airspace"]],
  ["airspace", ["airspace"]],
  ["cyber", ["cyber", "network"]],
  ["gnss", ["gnss"]],
  ["infrastructure", ["infrastructure", "seismic"]],
  ["satellite_intelligence", ["satellite"]],
]);

function nowIso() {
  return new Date().toISOString();
}

function toUtcDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toUtcDateKey(date);
}

function getPreviousUtcDateKey(reference = new Date()) {
  const date = reference instanceof Date ? new Date(reference) : new Date(reference);
  date.setUTCDate(date.getUTCDate() - 1);
  return toUtcDateKey(date);
}

function getDayRange(dateKey) {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function getMojibakeScore(value = "") {
  const text = String(value || "");
  const matches = text.match(/(?:\uFFFD|ï¿½|Ã.|Â.|â[\u0080-\u00bf]?|[\u0080-\u009f])/g);
  return matches ? matches.length : 0;
}

function repairMojibake(value = "") {
  let text = String(value || "");
  for (let index = 0; index < 2; index += 1) {
    const currentScore = getMojibakeScore(text);
    if (!currentScore) break;
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    if (!repaired || getMojibakeScore(repaired) >= currentScore) break;
    text = repaired;
  }
  return text;
}

function removeCorruptTextFragments(value = "") {
  return repairMojibake(value)
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€\u009d/g, "\"")
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/ï¿½|\uFFFD/g, " ")
    .replace(/\b[ÃÂâ][^\s|,.;:)]+/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
}

function cleanText(value = "", fallback = "") {
  const decodeHtmlEntities = (input = "") => {
    let current = String(input || "");
    for (let index = 0; index < 3; index += 1) {
      const decoded = current
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&#x27;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
      if (decoded === current) break;
      current = decoded;
    }
    return current;
  };
  const text = removeCorruptTextFragments(decodeHtmlEntities(String(value || "")))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\bimg\b/gi, " ")
    .replace(/\b(?:width|height|alt|src|srcset|class|style|loading|fetchpriority|decoding|sizes|about|rel|target|id|href)=["'][^"']*["']/gi, " ")
    .replace(/\b(?:width|height|alt|src|srcset|class|style|loading|fetchpriority|decoding|sizes|about|rel|target|id|href)=\S+/gi, " ")
    .replace(/\battachment-[a-z0-9_-]+\b/gi, " ")
    .replace(/\bwp-[a-z0-9_-]+\b/gi, " ")
    .replace(/\bfloat(?:left|right)\b/gi, " ")
    .replace(/\(\s*max-width:[^)]+\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b[01]{12,}\b/g, " ")
    .replace(/\b(?:0x[0-9a-f]{8,}|[a-f0-9]{24,})\b/gi, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function buildReportSlug(report = {}) {
  const rawKey = String(report.report_key || "").trim();
  const dateKey = rawKey.split(":")[1] || toUtcDateKey(report.period_end || report.period_start || new Date());
  const type = String(report.report_type || "daily").trim().toLowerCase();
  const scopeType = String(report.scope_type || "global").trim().toLowerCase();
  const scopeValue = cleanText(report.scope_value || report.scope_label || "", "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const parts = ["stratops-report"];
  if (type === "weekly") parts.push("weekly");
  parts.push(dateKey);
  if (scopeType !== "global" && scopeValue) parts.push(scopeValue);
  return parts.join("-");
}

function normalizeScope(scope = {}) {
  const type = String(scope.type || scope.scope_type || "global").trim().toLowerCase();
  const scopeType = VALID_SCOPE_TYPES.has(type) ? type : "global";
  if (scopeType === "global") {
    return { type: "global", value: null, label: "Global" };
  }
  if (scopeType === "aoi") {
    const bbox = Array.isArray(scope.bbox) ? scope.bbox.map(Number) : null;
    const validBbox = bbox && bbox.length === 4 && bbox.every(Number.isFinite);
    const label = cleanText(scope.label || scope.value || "AOI", "AOI");
    return { type: "aoi", value: label, label, bbox: validBbox ? bbox : null };
  }
  const value = cleanText(scope.value || scope.label || "", "");
  return {
    type: scopeType,
    value: value || null,
    label: value || (scopeType === "region" ? "Regional" : "Country"),
  };
}

function getScopeKey(scope = normalizeScope()) {
  return scope.type === "global"
    ? "global"
    : `${scope.type}:${String(scope.value || scope.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "all"}`;
}

function getReportKey({ reportType, dateKey, scope }) {
  return `${reportType}:${dateKey}:${getScopeKey(scope)}`;
}

function withInFlightReportGeneration(reportKey, createPromise) {
  const key = String(reportKey || "").trim();
  if (!key) {
    return Promise.resolve().then(createPromise);
  }
  if (inFlightReportGenerations.has(key)) {
    return inFlightReportGenerations.get(key);
  }
  const promise = Promise.resolve()
    .then(createPromise)
    .finally(() => {
      if (inFlightReportGenerations.get(key) === promise) {
        inFlightReportGenerations.delete(key);
      }
    });
  inFlightReportGenerations.set(key, promise);
  return promise;
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = cleanText(row?.[key] || "unknown", "unknown").toLowerCase();
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sumCounts(objects = []) {
  return objects.reduce((acc, object) => {
    Object.entries(object || {}).forEach(([key, value]) => {
      acc[key] = (acc[key] || 0) + Number(value || 0);
    });
    return acc;
  }, {});
}

function getEventTime(event = {}) {
  return event.occurred_at || event.created_at || "";
}

function eventMatchesScope(event = {}, scope = normalizeScope()) {
  if (scope.type === "global") return true;
  if (scope.type === "country") {
    const wanted = String(scope.value || "").toLowerCase();
    return (
      String(event.country_code || "").toLowerCase() === wanted ||
      String(event.country || "").toLowerCase() === wanted ||
      String(event.location_label || "").toLowerCase().includes(wanted)
    );
  }
  if (scope.type === "region") {
    const wanted = String(scope.value || "").toLowerCase();
    return (
      String(event.location_label || "").toLowerCase().includes(wanted) ||
      String(event.region || "").toLowerCase().includes(wanted)
    );
  }
  if (scope.type === "aoi" && Array.isArray(scope.bbox)) {
    const lon = Number(event.lon);
    const lat = Number(event.lat);
    const [west, south, east, north] = scope.bbox;
    return Number.isFinite(lon) && Number.isFinite(lat) && lon >= west && lon <= east && lat >= south && lat <= north;
  }
  return true;
}

function getMajorEvents(events = []) {
  return [...events]
    .sort((left, right) => {
      const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
      if (severityDelta !== 0) return severityDelta;
      const confidenceDelta = Number(right.confidence || 0) - Number(left.confidence || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return Date.parse(getEventTime(right) || 0) - Date.parse(getEventTime(left) || 0);
    })
    .slice(0, 15)
    .map((event) => ({
      id: event.id,
      title: cleanText(event.title, "Activity report"),
      occurred_at: getEventTime(event),
      location_label: cleanText(event.location_label, "Unknown location"),
      category: cleanText(event.category, "unknown"),
      severity: cleanText(event.severity, "unknown"),
      confidence: Number(event.confidence || 0),
      source_count: Number(event.source_count || 1),
      summary: cleanText(event.summary, ""),
    }));
}

function getSeverityRank(value = "") {
  const severity = String(value || "").toLowerCase();
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;
  return 0;
}

function getTopClusters(events = []) {
  const buckets = new Map();
  events.forEach((event) => {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = `${Math.round(lat)}:${Math.round(lon)}`;
    const current = buckets.get(key) || {
      label: cleanText(event.location_label, "Operational area"),
      lat: Math.round(lat * 10) / 10,
      lon: Math.round(lon * 10) / 10,
      event_total: 0,
      highest_severity: "unknown",
      categories: {},
    };
    current.event_total += 1;
    if (getSeverityRank(event.severity) > getSeverityRank(current.highest_severity)) {
      current.highest_severity = cleanText(event.severity, "unknown");
    }
    const category = cleanText(event.category, "unknown").toLowerCase();
    current.categories[category] = (current.categories[category] || 0) + 1;
    buckets.set(key, current);
  });
  return [...buckets.values()]
    .sort((left, right) => right.event_total - left.event_total)
    .slice(0, 10);
}

function deriveEscalationScore(events = []) {
  const total = events.length;
  if (!total) return 0;
  const weighted = events.reduce((sum, event) => sum + getSeverityRank(event.severity), 0);
  const critical = events.filter((event) => String(event.severity || "").toLowerCase() === "critical").length;
  const high = events.filter((event) => String(event.severity || "").toLowerCase() === "high").length;
  return Math.min(100, Math.round((weighted * 2.2) + critical * 7 + high * 3 + Math.min(total, 80) * 0.35));
}

function getDomainSummaries(events = [], counts = {}) {
  const summaries = {};
  DOMAIN_CATEGORY_MAP.forEach((categories, domain) => {
    const matched = events.filter((event) => {
      const haystack = [
        event.category,
        event.subcategory,
        event.report_type,
        event.weapon_type,
        event.title,
        event.summary,
      ].join(" ").toLowerCase();
      return categories.some((category) => haystack.includes(category));
    });
    summaries[domain] = matched.length
      ? `${matched.length} related signal${matched.length === 1 ? "" : "s"} were recorded. Highest observed severity was ${getHighestSeverity(matched)}.`
      : "No notable activity was recorded in this domain during the reporting period.";
  });
  if (Number(counts.aircraft_total || 0) > 0) {
    summaries.air = `${counts.aircraft_total} military aircraft track${counts.aircraft_total === 1 ? "" : "s"} were active in the reporting window. ${summaries.air}`;
  }
  if (Number(counts.naval_total || 0) > 0) {
    summaries.maritime = `${counts.naval_total} naval track${counts.naval_total === 1 ? "" : "s"} were active in the reporting window. ${summaries.maritime}`;
  }
  return summaries;
}

function getHighestSeverity(events = []) {
  return [...events].sort((left, right) => getSeverityRank(right.severity) - getSeverityRank(left.severity))[0]?.severity || "unknown";
}

function createExecutiveSummary({ events, scope, categoryTotals, severityTotals, satelliteTotal = 0, aircraftTotal = 0, navalTotal = 0 }) {
  const total = events.length;
  if (!total) {
    return `No normalized operational events were recorded for ${scope.label} during this reporting period.`;
  }
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "activity";
  const high = Number(severityTotals.high || 0);
  const critical = Number(severityTotals.critical || 0);
  const topLocation = Object.entries(countBy(events, "location_label")).sort((a, b) => b[1] - a[1])[0]?.[0] || scope.label;
  const clauses = [
    `${scope.label} recorded ${total} normalized operational event${total === 1 ? "" : "s"}.`,
    `The dominant activity category was ${topCategory}.`,
    `${critical} critical and ${high} high-severity event${high === 1 ? "" : "s"} were observed.`,
    `The most active reported area was ${topLocation}.`,
  ];
  if (aircraftTotal) clauses.push(`${aircraftTotal} military aircraft track${aircraftTotal === 1 ? "" : "s"} contributed to the air activity picture.`);
  if (navalTotal) clauses.push(`${navalTotal} naval track${navalTotal === 1 ? "" : "s"} contributed to the maritime picture.`);
  if (satelliteTotal) clauses.push(`${satelliteTotal} satellite observation record${satelliteTotal === 1 ? "" : "s"} were available in the contextual imagery table.`);
  clauses.push("All statements are derived from normalized OSINT records and do not independently verify disputed reports.");
  return clauses.join(" ");
}

function buildChartData(events = [], snapshots = []) {
  if (snapshots.length) {
    return {
      daily_event_count: snapshots.map((snapshot) => ({
        date: snapshot.snapshot_date,
        count: Number(snapshot.event_total || 0),
      })),
      severity_distribution: sumCounts(snapshots.map((snapshot) => snapshot.severity_totals)),
      category_distribution: sumCounts(snapshots.map((snapshot) => snapshot.category_totals)),
      regional_activity: sumCounts(snapshots.map((snapshot) => snapshot.trend_metrics?.regional_activity || {})),
    };
  }
  return {
    daily_event_count: [{ date: events[0] ? toUtcDateKey(getEventTime(events[0])) : toUtcDateKey(), count: events.length }],
    severity_distribution: countBy(events, "severity"),
    category_distribution: countBy(events, "category"),
    regional_activity: countBy(events, "location_label"),
  };
}

async function safeCount(builder, fallback = 0) {
  try {
    const { count, error } = await builder;
    if (error) return fallback;
    return Number(count || 0);
  } catch {
    return fallback;
  }
}

async function fetchPagedRows(buildQuery, { pageSize = 1000, maxRows = 8000 } = {}) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function fetchEventsForDay(supabase, dateKey, scope) {
  const { startIso, endIso } = getDayRange(dateKey);
  const data = await fetchPagedRows(() => applyGeneralEventDeliveryFilters(
    supabase
      .from("events")
      .select("id, created_at, occurred_at, category, subcategory, title, summary, source_name, source_url, location_label, country_code, severity, confidence, lat, lon, report_type, weapon_type, source_count, airspace_status, cyber_status, fir_code, tags, priority_score, dedupe_key, metadata")
      .gte("occurred_at", startIso)
      .lt("occurred_at", endIso)
  ).order("occurred_at", { ascending: false }).order("id", { ascending: true }));
  return data;
}

async function fetchConflictIntelligenceForDay(supabase, dateKey) {
  const { startIso, endIso } = getDayRange(dateKey);
  const selection = "id, source_id, source_name, source_type, source_category, title, summary, url, guid, published_at, fetched_at, region, country, lat, lon, category, confidence_score, is_conflict_relevant, raw";
  const published = await fetchPagedRows(() => supabase
    .from("conflict_feed_items")
    .select(selection)
    .eq("is_conflict_relevant", true)
    .gte("published_at", startIso)
    .lt("published_at", endIso)
    .order("published_at", { ascending: false })
    .order("id", { ascending: true }));
  const fetchedWithoutPublishTime = await fetchPagedRows(() => supabase
    .from("conflict_feed_items")
    .select(selection)
    .eq("is_conflict_relevant", true)
    .is("published_at", null)
    .gte("fetched_at", startIso)
    .lt("fetched_at", endIso)
    .order("fetched_at", { ascending: false })
    .order("id", { ascending: true }));
  const unique = new Map();
  [...published, ...fetchedWithoutPublishTime].forEach((item) => {
    const key = item.id || item.url || item.guid;
    if (key && !unique.has(String(key))) unique.set(String(key), item);
  });
  return [...unique.values()];
}

async function fetchTracksForDay(supabase, dateKey) {
  const { startIso, endIso } = getDayRange(dateKey);
  const trackWindowEndIso = new Date(Date.parse(endIso) + TRACK_BOUNDARY_GRACE_MINUTES * 60000).toISOString();
  try {
    return await fetchPagedRows(() => supabase
      .from("tracks")
      .select("id, track_key, track_type, category, subcategory, source_name, title, lat, lon, altitude_ft, speed_kts, heading_deg, region, country, status, occurred_at, updated_at, metadata")
      .gte("updated_at", startIso)
      .lt("updated_at", trackWindowEndIso)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true }));
  } catch {
    return [];
  }
}

async function fetchPreviousSnapshot(supabase, dateKey, scopeKey) {
  try {
    const previousDateKey = addUtcDays(dateKey, -1);
    const { data, error } = await supabase
      .from("operational_report_snapshots")
      .select("snapshot_date, snapshot_key, snapshot_data")
      .eq("snapshot_key", buildSnapshotKey(previousDateKey, scopeKey))
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

async function countAlerts(supabase, dateKey) {
  const { startIso, endIso } = getDayRange(dateKey);
  return safeCount(
    supabase
      .from("active_alerts")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
  );
}

async function countSatellite(supabase, dateKey) {
  const { startIso, endIso } = getDayRange(dateKey);
  return safeCount(
    supabase
      .from("event_satellite_observations")
      .select("id", { count: "exact", head: true })
      .eq("status", "available")
      .gte("updated_at", startIso)
      .lt("updated_at", endIso)
  );
}

async function fetchSatellitePreviewForEvents(supabase, eventIds = []) {
  const ids = Array.isArray(eventIds)
    ? eventIds.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 250)
    : [];
  if (!ids.length) return null;
  const { data, error } = await supabase
    .from("event_satellite_observations")
    .select("event_id, image_url, acquisition_time, collection, provider, resolution_meters, cloud_cover, updated_at")
    .eq("status", "available")
    .in("event_id", ids)
    .not("image_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || !data.length) return null;
  const row = data[0] || {};
  return {
    event_id: cleanText(row.event_id, ""),
    image_url: cleanText(row.image_url, ""),
    acquisition_time: cleanText(row.acquisition_time, ""),
    collection: cleanText(row.collection, ""),
    provider: cleanText(row.provider || "Copernicus", "Copernicus"),
    resolution_meters: Number(row.resolution_meters || 0) || null,
    cloud_cover: Number(row.cloud_cover || 0) || null,
  };
}

function buildSnapshotPayload({
  dateKey,
  scope,
  events,
  intelligence = [],
  tracks = [],
  previousSnapshot = null,
  counts,
  satellitePreview = null,
  config = readReportingConfig(),
}) {
  const { startIso, endIso } = getDayRange(dateKey);
  const reporting = buildReportingFoundation({
    dateKey,
    windowStartIso: startIso,
    windowEndIso: endIso,
    scope,
    scopeKey: getScopeKey(scope),
    events,
    intelligence,
    tracks,
    previousSnapshot,
    counts,
    satellitePreview,
    s3Prefix: config.s3Prefix,
  });
  const scopedEvents = reporting.operationalItems;
  reporting.snapshotData.report_content.methodology_metrics.telemetry_selection_window = {
    start: startIso,
    end: endIso,
    boundary_grace_minutes: TRACK_BOUNDARY_GRACE_MINUTES,
    reason: "Preserves latest-row telemetry across the scheduled 00:12 UTC snapshot boundary.",
  };
  const categoryTotals = countBy(scopedEvents, "category");
  const severityTotals = countBy(scopedEvents, "severity");
  const confidenceTotals = {
    high: scopedEvents.filter((event) => Number(event.confidence || 0) >= 75).length,
    medium: scopedEvents.filter((event) => Number(event.confidence || 0) >= 45 && Number(event.confidence || 0) < 75).length,
    low: scopedEvents.filter((event) => Number(event.confidence || 0) < 45).length,
  };
  const escalationScore = deriveEscalationScore(scopedEvents);
  const highestSeverityEvents = reporting.snapshotData.selections.major_developments
    .filter((item) => item.record_type === "operational_event")
    .slice(0, 15);
  const highestConfidenceEvents = [...scopedEvents]
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))
    .slice(0, 10)
    .map((event) => ({
      id: event.event_id,
      title: cleanText(event.title, "Activity report"),
      confidence: Number(event.confidence || 0),
      severity: cleanText(event.severity, "unknown"),
      occurred_at: event.occurred_at,
      location_label: cleanText(event.event_place || event.event_city || event.event_region || event.event_country, "Unknown location"),
    }));
  const generatedSummary = createExecutiveSummary({
    events: scopedEvents,
    scope,
    categoryTotals,
    severityTotals,
    satelliteTotal: counts.satellite_total,
    aircraftTotal: counts.aircraft_total,
    navalTotal: counts.naval_total,
  });
  const generatedAt = nowIso();
  reporting.manifest.generated_at = generatedAt;
  return {
    snapshot_key: reporting.snapshotKey,
    snapshot_version: SNAPSHOT_SCHEMA_VERSION,
    snapshot_date: dateKey,
    window_start: startIso,
    window_end: endIso,
    generated_at: generatedAt,
    updated_at: generatedAt,
    scope_type: scope.type,
    scope_key: getScopeKey(scope),
    scope_value: scope.value,
    scope_label: scope.label,
    region: scope.type === "region" ? scope.value : null,
    country: scope.type === "country" ? scope.value : null,
    aoi: scope.type === "aoi" ? { label: scope.label, bbox: scope.bbox || null } : null,
    event_total: scopedEvents.length,
    intelligence_total: reporting.broaderItems.length,
    report_item_total: reporting.items.length,
    source_family_total: reporting.snapshotData.source_consensus.independent_source_family_count,
    category_totals: categoryTotals,
    severity_totals: severityTotals,
    confidence_totals: confidenceTotals,
    aircraft_total: counts.aircraft_total,
    naval_total: counts.naval_total,
    alerts_total: counts.alerts_total,
    airspace_total: events.filter((event) => String(event.airspace_status || event.category || "").toLowerCase().includes("airspace")).length,
    cyber_total: events.filter((event) => String(event.cyber_status || event.category || "").toLowerCase().includes("cyber") || String(event.report_type || "").includes("network")).length,
    gnss_total: events.filter((event) => String(event.category || event.report_type || "").toLowerCase().includes("gnss")).length,
    satellite_total: counts.satellite_total,
    escalation_score: escalationScore,
    highest_confidence_events: highestConfidenceEvents,
    highest_severity_events: highestSeverityEvents,
    top_operational_clusters: reporting.clusters,
    regional_summary: generatedSummary,
    trend_metrics: {
      regional_activity: countBy(reporting.items, "theater_name"),
      high_severity_count: Number(severityTotals.high || 0) + Number(severityTotals.critical || 0),
    },
    chart_data: {
      ...buildChartData(scopedEvents),
      activity_by_hour: reporting.snapshotData.aggregates.activity_by_hour,
      domain_distribution: reporting.snapshotData.aggregates.by_domain,
      verification_distribution: reporting.snapshotData.aggregates.by_verification_state,
    },
    map_snapshot_reference: null,
    satellite_summary: {
      available_count: counts.satellite_total,
      summary: counts.satellite_total
        ? `${counts.satellite_total} satellite observation record${counts.satellite_total === 1 ? "" : "s"} were available in the contextual imagery table for this period.`
        : "No satellite observation records were available for this period.",
      preview_image_url: cleanText(satellitePreview?.image_url, ""),
      preview_event_id: cleanText(satellitePreview?.event_id, ""),
      acquisition_time: cleanText(satellitePreview?.acquisition_time, ""),
      collection: cleanText(satellitePreview?.collection, ""),
      provider: cleanText(satellitePreview?.provider, ""),
      resolution_meters: satellitePreview?.resolution_meters ?? null,
      cloud_cover: satellitePreview?.cloud_cover ?? null,
    },
    generated_summary: generatedSummary,
    snapshot_data: reporting.snapshotData,
    report_manifest: reporting.manifest,
    report_version: REPORT_VERSION,
    normalization_version: NORMALIZATION_VERSION,
  };
}

async function upsertSnapshot(supabase, payload) {
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .upsert(payload, { onConflict: "snapshot_key" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function generateDailySnapshot({ supabase, dateKey = getPreviousUtcDateKey(), scope = {}, config = readReportingConfig() } = {}) {
  const normalizedScope = normalizeScope(scope);
  const scopeKey = getScopeKey(normalizedScope);
  const [events, intelligence, tracks, alertsTotal, satelliteTotal, previousSnapshot] = await Promise.all([
    fetchEventsForDay(supabase, dateKey, normalizedScope),
    fetchConflictIntelligenceForDay(supabase, dateKey),
    fetchTracksForDay(supabase, dateKey),
    countAlerts(supabase, dateKey),
    countSatellite(supabase, dateKey),
    fetchPreviousSnapshot(supabase, dateKey, scopeKey),
  ]);
  const scopedTracks = tracks.filter((track) => eventMatchesScope(track, normalizedScope));
  const counts = {
    aircraft_total: scopedTracks.filter((track) => track.track_type === "aircraft").length,
    naval_total: scopedTracks.filter((track) => track.track_type === "naval").length,
    alerts_total: alertsTotal,
    satellite_total: satelliteTotal,
  };
  const satellitePreview = await fetchSatellitePreviewForEvents(
    supabase,
    events.map((event) => event.id)
  );
  const snapshot = await upsertSnapshot(supabase, buildSnapshotPayload({
    dateKey,
    scope: normalizedScope,
    events,
    intelligence,
    tracks,
    previousSnapshot,
    counts,
    satellitePreview,
    config,
  }));
  return snapshot;
}

function buildDailyReportBody(snapshot) {
  return {
    scope: {
      type: snapshot.scope_type,
      value: snapshot.scope_value,
      label: snapshot.scope_label,
    },
    reporting_period: getDayRange(snapshot.snapshot_date),
    executive_summary: snapshot.generated_summary || snapshot.regional_summary || "",
    operational_overview: {
      event_total: snapshot.event_total,
      critical_events: snapshot.severity_totals?.critical || 0,
      high_events: snapshot.severity_totals?.high || 0,
      aircraft_total: snapshot.aircraft_total,
      naval_total: snapshot.naval_total,
      airspace_total: snapshot.airspace_total,
      cyber_total: snapshot.cyber_total,
      gnss_total: snapshot.gnss_total,
      satellite_total: snapshot.satellite_total,
      escalation_score: snapshot.escalation_score,
    },
    regional_map: {
      map_snapshot_reference: snapshot.map_snapshot_reference || null,
      note: "Clean server-side map snapshot reference is reserved for the rendering worker.",
    },
    major_events: snapshot.highest_severity_events || [],
    domain_summaries: getDomainSummaries(snapshot.highest_severity_events || [], snapshot),
    trend_analysis: snapshot.chart_data || {},
    satellite_intelligence: snapshot.satellite_summary || {},
    sources: {
      reporting_period: "UTC daily snapshot",
      source_categories: Object.keys(snapshot.category_totals || {}),
      confidence_model: snapshot.confidence_totals || {},
      normalization: snapshot.normalization_version,
      event_retention: "Raw events remain on existing live retention; this report uses summarized snapshots.",
      automated_processing: true,
    },
  };
}

function buildWeeklyReportBody(snapshots, { dateKey, scope }) {
  const sorted = [...snapshots].sort((left, right) => String(left.snapshot_date).localeCompare(String(right.snapshot_date)));
  const categoryTotals = sumCounts(sorted.map((snapshot) => snapshot.category_totals));
  const severityTotals = sumCounts(sorted.map((snapshot) => snapshot.severity_totals));
  const eventTotal = sorted.reduce((sum, snapshot) => sum + Number(snapshot.event_total || 0), 0);
  const previousWeekDelta = null;
  const highSeverityEvents = sorted.flatMap((snapshot) => snapshot.highest_severity_events || [])
    .sort((left, right) => getSeverityRank(right.severity) - getSeverityRank(left.severity))
    .slice(0, 20);
  const escalationValues = sorted.map((snapshot) => Number(snapshot.escalation_score || 0));
  const escalationAverage = escalationValues.length
    ? Math.round(escalationValues.reduce((sum, value) => sum + value, 0) / escalationValues.length)
    : 0;
  const summary = [
    `${scope.label} recorded ${eventTotal} summarized operational events across ${sorted.length} daily snapshot${sorted.length === 1 ? "" : "s"}.`,
    `The seven-day escalation average was ${escalationAverage}.`,
    `The leading category was ${Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown"}.`,
    `${Number(severityTotals.critical || 0)} critical and ${Number(severityTotals.high || 0)} high-severity events were represented.`,
    "This weekly report is generated only from daily snapshots and does not query expired raw events.",
  ].join(" ");
  return {
    scope,
    reporting_period: {
      startIso: getDayRange(sorted[0]?.snapshot_date || dateKey).startIso,
      endIso: getDayRange(addUtcDays(sorted[0]?.snapshot_date || dateKey, sorted.length)).startIso,
    },
    executive_summary: summary,
    operational_overview: {
      event_total: eventTotal,
      critical_events: severityTotals.critical || 0,
      high_events: severityTotals.high || 0,
      aircraft_total: sorted.reduce((sum, snapshot) => sum + Number(snapshot.aircraft_total || 0), 0),
      naval_total: sorted.reduce((sum, snapshot) => sum + Number(snapshot.naval_total || 0), 0),
      airspace_total: sorted.reduce((sum, snapshot) => sum + Number(snapshot.airspace_total || 0), 0),
      cyber_total: sorted.reduce((sum, snapshot) => sum + Number(snapshot.cyber_total || 0), 0),
      gnss_total: sorted.reduce((sum, snapshot) => sum + Number(snapshot.gnss_total || 0), 0),
      satellite_total: sorted.reduce((sum, snapshot) => sum + Number(snapshot.satellite_total || 0), 0),
      escalation_score: escalationAverage,
      previous_week_delta: previousWeekDelta,
    },
    major_events: highSeverityEvents,
    domain_summaries: getDomainSummaries(highSeverityEvents, {}),
    trend_analysis: buildChartData([], sorted),
    satellite_intelligence: {
      summary: `${sorted.reduce((sum, snapshot) => sum + Number(snapshot.satellite_total || 0), 0)} satellite observation records were represented across the weekly snapshots.`,
    },
    sources: {
      reporting_period: "UTC weekly snapshot rollup",
      source_categories: Object.keys(categoryTotals),
      confidence_model: sumCounts(sorted.map((snapshot) => snapshot.confidence_totals)),
      normalization: NORMALIZATION_VERSION,
      event_retention: "Weekly reports combine daily snapshots only.",
      automated_processing: true,
    },
  };
}

function getReportStorageKey(config, report) {
  const scopeKey = getScopeKey({ type: report.scope_type, value: report.scope_value, label: report.scope_label });
  return `${config.s3Prefix}/${report.report_type}/${report.period_start}/${scopeKey}/${report.report_key.replace(/[^a-z0-9:_-]+/gi, "-")}.pdf`;
}

async function uploadReportPdf({ supabase, report, config }) {
  const body = report.report_body || report.body || {};
  const pdf = await createReportPdfBuffer({ ...report, body });
  const storageKey = getReportStorageKey(config, report);
  const uploaded = await s3PutObject(config, {
    key: storageKey,
    body: pdf,
    contentType: "application/pdf",
  });
  const expiresAt = new Date(Date.now() + config.pdfExpiryHours * 60 * 60 * 1000).toISOString();
  const downloadToken = crypto.randomBytes(24).toString("hex");
  const { data, error } = await supabase
    .from("operational_reports")
    .update({
      status: "available",
      pdf_url: uploaded.url,
      pdf_storage_key: uploaded.storageKey,
      pdf_etag: uploaded.etag,
      download_token: downloadToken,
      expires_at: expiresAt,
      updated_at: nowIso(),
    })
    .eq("id", report.id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertReportRecord({ supabase, reportType, dateKey, scope, body, snapshotIds }) {
  const reportKey = getReportKey({ reportType, dateKey, scope });
  const period = reportType === "daily"
    ? getDayRange(dateKey)
    : {
        startIso: `${addUtcDays(dateKey, -6)}T00:00:00.000Z`,
        endIso: `${addUtcDays(dateKey, 1)}T00:00:00.000Z`,
      };
  const payload = {
    report_key: reportKey,
    report_type: reportType,
    scope_type: scope.type,
    scope_key: getScopeKey(scope),
    scope_value: scope.value,
    scope_label: scope.label,
    period_start: period.startIso,
    period_end: period.endIso,
    status: "generating",
    report_body: body,
    snapshot_ids: snapshotIds,
    generated_summary: body.executive_summary || "",
    report_version: REPORT_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    updated_at: nowIso(),
  };
  const { data, error } = await supabase
    .from("operational_reports")
    .upsert(payload, { onConflict: "report_key" })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureDailyReport({ supabase, dateKey = getPreviousUtcDateKey(), scope = {}, config = readReportingConfig(), force = false } = {}) {
  const normalizedScope = normalizeScope(scope);
  const reportKey = getReportKey({ reportType: "daily", dateKey, scope: normalizedScope });
  return withInFlightReportGeneration(reportKey, async () => {
    if (!force) {
      const existing = await getAvailableReportByKey(supabase, reportKey);
      if (existing) return existing;
    }
    const snapshot = await generateDailySnapshot({ supabase, dateKey, scope: normalizedScope, config });
    const body = buildDailyReportBody(snapshot);
    const report = await upsertReportRecord({
      supabase,
      reportType: "daily",
      dateKey,
      scope: normalizedScope,
      body,
      snapshotIds: [snapshot.snapshot_id || snapshot.id].filter(Boolean),
    });
    return uploadReportPdf({ supabase, report, config });
  });
}

async function getAvailableReportByKey(supabase, reportKey) {
  const { data, error } = await supabase
    .from("operational_reports")
    .select("*")
    .eq("report_key", reportKey)
    .eq("report_version", REPORT_VERSION)
    .eq("status", "available")
    .gt("expires_at", nowIso())
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function getSnapshotsForWeeklyReport(supabase, { dateKey, scope }) {
  const startDate = addUtcDays(dateKey, -6);
  const { data, error } = await supabase
    .from("operational_report_snapshots")
    .select("*")
    .gte("snapshot_date", startDate)
    .lte("snapshot_date", dateKey)
    .eq("scope_key", getScopeKey(scope))
    .order("snapshot_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function ensureWeeklyReport({ supabase, dateKey = getPreviousUtcDateKey(), scope = {}, config = readReportingConfig(), force = false } = {}) {
  const normalizedScope = normalizeScope(scope);
  const reportKey = getReportKey({ reportType: "weekly", dateKey, scope: normalizedScope });
  return withInFlightReportGeneration(reportKey, async () => {
    if (!force) {
      const existing = await getAvailableReportByKey(supabase, reportKey);
      if (existing) return existing;
    }
    const snapshots = await getSnapshotsForWeeklyReport(supabase, { dateKey, scope: normalizedScope });
    if (snapshots.length < 7) {
      throw new Error(`Weekly report requires 7 daily snapshots; found ${snapshots.length}`);
    }
    const body = buildWeeklyReportBody(snapshots, { dateKey, scope: normalizedScope });
    const report = await upsertReportRecord({
      supabase,
      reportType: "weekly",
      dateKey,
      scope: normalizedScope,
      body,
      snapshotIds: snapshots.map((snapshot) => snapshot.snapshot_id || snapshot.id).filter(Boolean),
    });
    return uploadReportPdf({ supabase, report, config });
  });
}

function resetInFlightReportGenerationsForTests() {
  inFlightReportGenerations.clear();
}

const __reportingServiceTestUtils = {
  buildSnapshotPayload,
  fetchTracksForDay,
  getDayRange,
  resetInFlightReportGenerationsForTests,
  upsertSnapshot,
  withInFlightReportGeneration,
};

async function ensureOperationalReport({ supabase, reportType = "daily", dateKey, scope = {}, config = readReportingConfig(), force = false } = {}) {
  const type = String(reportType || "daily").toLowerCase();
  if (!VALID_REPORT_TYPES.has(type)) throw new Error("Unsupported report type");
  if (type === "weekly") {
    return ensureWeeklyReport({ supabase, dateKey: dateKey || getPreviousUtcDateKey(), scope, config, force });
  }
  return ensureDailyReport({ supabase, dateKey: dateKey || getPreviousUtcDateKey(), scope, config, force });
}

function getScheduledScopes(config = readReportingConfig()) {
  return [
    normalizeScope({ type: "global" }),
    ...config.scheduledRegions.map((value) => normalizeScope({ type: "region", value })),
    ...config.scheduledCountries.map((value) => normalizeScope({ type: "country", value })),
    ...config.scheduledAois.map((aoi) => normalizeScope({ type: "aoi", ...aoi })),
  ];
}

async function generateScheduledSnapshots({ supabase, config = readReportingConfig(), logger = console, referenceDate = new Date() } = {}) {
  if (!config.snapshotEnabled) return { ok: true, skipped: true, reason: "snapshot_schedule_disabled" };
  const dateKey = getPreviousUtcDateKey(referenceDate);
  const results = [];
  for (const scope of getScheduledScopes(config)) {
    try {
      const snapshot = await generateDailySnapshot({ supabase, dateKey, scope, config });
      results.push({ ok: true, scope: getScopeKey(scope), id: snapshot.snapshot_id || snapshot.id });
    } catch (error) {
      logger.warn?.(`[reports] daily snapshot failed scope=${getScopeKey(scope)} error=${error?.message || error}`);
      results.push({ ok: false, scope: getScopeKey(scope), error: error?.message || String(error) });
    }
  }
  await pruneExpiredSnapshots({ supabase, config }).catch((error) => {
    logger.warn?.(`[reports] snapshot cleanup failed: ${error?.message || error}`);
  });
  return { ok: results.some((result) => result.ok), dateKey, results };
}

async function generateScheduledReports({ supabase, config = readReportingConfig(), logger = console, referenceDate = new Date(), reportTypes = null } = {}) {
  if (!config.scheduleEnabled) return { ok: true, skipped: true, reason: "schedule_disabled" };
  const selectedTypes = Array.isArray(reportTypes)
    ? new Set(reportTypes.map((type) => String(type || "").toLowerCase()))
    : null;
  const runDaily = selectedTypes ? selectedTypes.has("daily") : config.dailyEnabled !== false;
  const runWeekly = selectedTypes ? selectedTypes.has("weekly") : config.weeklyEnabled === true;
  if (!runDaily && !runWeekly) return { ok: true, skipped: true, reason: "report_types_disabled" };
  const dateKey = getPreviousUtcDateKey(referenceDate);
  const scopes = getScheduledScopes(config);
  const results = [];
  for (const scope of scopes) {
    if (runDaily) {
      try {
        const daily = await ensureDailyReport({ supabase, dateKey, scope, config });
        results.push({ ok: true, report_type: "daily", scope: getScopeKey(scope), id: daily.id });
      } catch (error) {
        logger.warn?.(`[reports] daily generation failed scope=${getScopeKey(scope)} error=${error?.message || error}`);
        results.push({ ok: false, report_type: "daily", scope: getScopeKey(scope), error: error?.message || String(error) });
      }
    }
    if (runWeekly) {
      try {
        const weekly = await ensureWeeklyReport({ supabase, dateKey, scope, config });
        results.push({ ok: true, report_type: "weekly", scope: getScopeKey(scope), id: weekly.id });
      } catch (error) {
        if (!String(error?.message || "").includes("requires 7 daily snapshots")) {
          logger.warn?.(`[reports] weekly generation failed scope=${getScopeKey(scope)} error=${error?.message || error}`);
        }
      }
    }
  }
  await pruneExpiredReports({ supabase, config, logger }).catch((error) => {
    logger.warn?.(`[reports] cleanup failed: ${error?.message || error}`);
  });
  return { ok: results.some((result) => result.ok), dateKey, results };
}

async function pruneExpiredReports({ supabase, config = readReportingConfig() } = {}) {
  const updates = await supabase
    .from("operational_reports")
    .update({ status: "expired", updated_at: nowIso() })
    .lt("expires_at", nowIso())
    .neq("status", "expired");
  if (updates.error) throw updates.error;
  await pruneExpiredSnapshots({ supabase, config });
  return { ok: true };
}

async function pruneExpiredSnapshots({ supabase, config = readReportingConfig() } = {}) {
  if (config.retentionDays === null) return { ok: true, skipped: true, reason: "unlimited_retention" };
  const cutoff = addUtcDays(toUtcDateKey(), -config.retentionDays);
  const snapshots = await supabase
    .from("operational_report_snapshots")
    .delete()
    .lt("snapshot_date", cutoff);
  if (snapshots.error) throw snapshots.error;
  return { ok: true, cutoff };
}

function toPublicReport(report = {}) {
  const reportSlug = buildReportSlug(report);
  return {
    id: report.id,
    report_key: report.report_key,
    report_slug: reportSlug,
    report_type: report.report_type,
    scope_type: report.scope_type,
    scope_value: report.scope_value,
    scope_label: report.scope_label,
    period_start: report.period_start,
    period_end: report.period_end,
    status: report.status,
    generated_at: report.generated_at || report.created_at,
    updated_at: report.updated_at,
    expires_at: report.expires_at,
    generated_summary: report.generated_summary,
    report_version: report.report_version,
    download_token: report.download_token,
    public_url: `/reports/${encodeURIComponent(reportSlug)}`,
  };
}

export {
  REPORT_VERSION,
  __reportingServiceTestUtils,
  buildReportSlug,
  ensureDailyReport,
  ensureOperationalReport,
  ensureWeeklyReport,
  generateDailySnapshot,
  generateScheduledReports,
  generateScheduledSnapshots,
  getPreviousUtcDateKey,
  getScheduledScopes,
  getScopeKey,
  normalizeScope,
  pruneExpiredReports,
  pruneExpiredSnapshots,
  toPublicReport,
};
