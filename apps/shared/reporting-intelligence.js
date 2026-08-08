import { haversineDistanceKm } from "../../dev/assets/js/warzone-event-cluster-model.js";

const REPORT_CONTENT_MODEL_VERSION = 1;
const MAX_MAJOR_DEVELOPMENTS = 10;
const MAX_SELECTED_HVA = 6;
const MAX_CAPTURE_TARGETS = 8;
const SIGNIFICANT_SEVERITIES = new Set(["high", "critical"]);
const VERIFIED_STATES = new Set(["CONFIRMED", "CORROBORATED"]);
const GENERIC_TITLE_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "near", "of", "on", "reported", "reports", "the", "to", "with",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value = "", fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function slugify(value = "") {
  return cleanText(value, "item").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countValues(items = [], selector) {
  return items.reduce((counts, item) => {
    const key = cleanText(selector(item), "unknown").toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function countExactValues(items = [], selector) {
  return items.reduce((counts, item) => {
    const key = cleanText(selector(item), "UNKNOWN").toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sortCounts(counts = {}) {
  return Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function activityLevel(total = 0, highCritical = 0) {
  const weighted = Number(total || 0) + Number(highCritical || 0) * 3;
  if (weighted >= 50) return "INTENSE";
  if (weighted >= 25) return "HIGH";
  if (weighted >= 10) return "ELEVATED";
  if (weighted > 0) return "LIMITED";
  return "QUIET";
}

function clusterForItem(item = {}, clusters = []) {
  const eventId = String(item.event_id || "");
  if (!eventId) return null;
  return clusters.find((cluster) => (cluster.event_ids || []).some((id) => String(id) === eventId)) || null;
}

function titleTokens(value = "") {
  return new Set(cleanText(value).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !GENERIC_TITLE_WORDS.has(word)));
}

function tokenSimilarity(left = "", right = "") {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  a.forEach((token) => { if (b.has(token)) intersection += 1; });
  return intersection / Math.max(a.size, b.size);
}

function isSameIncident(left = {}, right = {}) {
  if (left.event_fingerprint && left.event_fingerprint === right.event_fingerprint) return true;
  if (left.source_url && left.source_url === right.source_url) return true;
  if (left.domain !== right.domain) return false;
  const leftPlace = cleanText(left.event_place || left.event_city || left.event_region || left.event_country).toLowerCase();
  const rightPlace = cleanText(right.event_place || right.event_city || right.event_region || right.event_country).toLowerCase();
  if (leftPlace && rightPlace && leftPlace !== rightPlace) return false;
  const timeDelta = Math.abs(Date.parse(left.occurred_at || 0) - Date.parse(right.occurred_at || 0));
  return timeDelta <= 12 * 3600000 && tokenSimilarity(left.title, right.title) >= 0.72;
}

function buildMajorDevelopments(items = [], clusters = [], theaters = []) {
  const theaterById = new Map(theaters.map((theater) => [theater.theater_id, theater]));
  const ranked = items.filter((item) => item.record_type !== "broader_intelligence").map((item) => {
    const cluster = clusterForItem(item, clusters);
    const theater = theaterById.get(item.theater_id);
    const clusterBoost = Math.min(18, Number(cluster?.activity_score || 0) * 1.5 + Math.max(0, Number(cluster?.incident_count || 0) - 1) * 3);
    const theaterBoost = Math.min(8, Math.max(0, Number(theater?.event_count || 0) - 1) * 0.7);
    const repeatedBoost = item.raw_report_count > 1 ? Math.min(8, Number(item.raw_report_count || 0) * 1.2) : 0;
    const selectionScore = Number((Number(item.report_relevance_score || 0) + clusterBoost + theaterBoost + repeatedBoost).toFixed(3));
    const reasons = [];
    if (SIGNIFICANT_SEVERITIES.has(item.severity)) reasons.push(`${item.severity}_severity`);
    if (VERIFIED_STATES.has(item.verification_state)) reasons.push("corroborated_or_confirmed");
    if (item.official_confirmation) reasons.push("official_confirmation");
    if (item.direct_evidence) reasons.push("direct_evidence");
    if (Number(item.independent_source_family_count || 0) > 1) reasons.push("independent_source_consensus");
    if (Number(cluster?.incident_count || 0) > 1) reasons.push("repeated_cluster_activity");
    if (!reasons.length) reasons.push("highest_available_report_relevance");
    return {
      ...item,
      relevant_cluster_id: cluster?.cluster_id || null,
      report_relevance_score: selectionScore,
      source_family_summary: (item.independent_source_families || []).slice(0, 8),
      reason_selected: reasons,
    };
  }).sort((left, right) => Number(right.report_relevance_score || 0) - Number(left.report_relevance_score || 0)
    || Date.parse(right.occurred_at || 0) - Date.parse(left.occurred_at || 0)
    || String(left.report_item_id).localeCompare(String(right.report_item_id)));
  const selected = [];
  for (const candidate of ranked) {
    if (selected.some((existing) => isSameIncident(candidate, existing))) continue;
    selected.push(candidate);
    if (selected.length >= MAX_MAJOR_DEVELOPMENTS) break;
  }
  return selected;
}

function getTrackIdentity(track = {}) {
  const metadata = asObject(track.metadata);
  return cleanText([
    track.title,
    track.subcategory,
    metadata.role,
    metadata.type_code,
    metadata.model_name,
    metadata.vessel_class,
    metadata.vessel_name,
    metadata.ship_type,
  ].filter(Boolean).join(" ")).toUpperCase();
}

function classifyAssetRole(track = {}) {
  const type = cleanText(track.track_type).toLowerCase();
  const identity = getTrackIdentity(track);
  if (type === "aircraft") {
    if (/\b(AWACS|AEW(?:&C)?|E-?3[ABCDEFG]?|E-?7[AST]?|A-?50|KJ-?(?:2000|500|200))\b/.test(identity)) return { role: "AIRBORNE_EARLY_WARNING", base: 96, contextual: false };
    if (/\b(RC-?135|RIVET JOINT|COMBAT SENT|COBRA BALL|EP-?3|SIGINT|ELINT|TU-?214R|IL-?20)\b/.test(identity)) return { role: "SIGNALS_INTELLIGENCE", base: 94, contextual: false };
    if (/\b(E-?8|JSTARS|BATTLEFIELD SURVEILLANCE)\b/.test(identity)) return { role: "BATTLEFIELD_SURVEILLANCE", base: 94, contextual: false };
    if (/\b(E-?4B|AIRBORNE COMMAND|COMMAND POST|NIGHTWATCH)\b/.test(identity)) return { role: "AIRBORNE_COMMAND_POST", base: 98, contextual: false };
    if (/\b(B-?1B|B-?2A?|B-?52[H]?|TU-?95|TU-?160|H-?6[KN]?|STRATEGIC BOMBER)\b/.test(identity)) return { role: "STRATEGIC_BOMBER", base: 94, contextual: false };
    if (/\b(RQ-?4|GLOBAL HAWK|U-?2S?|FORTE\d*|SPECIALI[ZS]ED ISR)\b/.test(identity)) return { role: "SPECIALIZED_ISR", base: 88, contextual: false };
    if (/\b(P-?8A?|POSEIDON|P-?3C?|ORION|MARITIME PATROL)\b/.test(identity)) return { role: "MARITIME_PATROL", base: 62, contextual: true };
    if (/\b(KC-?135|KC-?46|KC-?10|A330 MRTT|MRTT|IL-?78|TANKER|AIR REFUEL)\b/.test(identity)) return { role: "AERIAL_REFUELING", base: 48, contextual: true };
    return null;
  }
  if (type === "naval") {
    if (/\b(CARRIER|AIRCRAFT CARRIER|CVN-?\d+|CARRIER STRIKE GROUP|CSG)\b/.test(identity)) return { role: "AIRCRAFT_CARRIER", base: 98, contextual: false };
    if (/\b(COMMAND SHIP|FLEET FLAGSHIP|AMPHIBIOUS COMMAND)\b/.test(identity)) return { role: "NAVAL_COMMAND", base: 92, contextual: false };
    if (/\b(SUBMARINE|SSBN|SSGN|SSN)\b/.test(identity)) return { role: "STRATEGIC_SUBMARINE", base: 84, contextual: true, requiresStrongIdentification: true };
    if (/\b(AMPHIBIOUS ASSAULT|LHA-?\d+|LHD-?\d+|LANDING HELICOPTER DOCK|AMPHIBIOUS GROUP)\b/.test(identity)) return { role: "MAJOR_AMPHIBIOUS", base: 70, contextual: true };
    return null;
  }
  return null;
}

function getTrackPoint(track = {}) {
  const latitude = finiteNumber(track.lat ?? track.latitude);
  const longitude = finiteNumber(track.lon ?? track.longitude);
  return latitude === null || longitude === null ? null : { lat: latitude, lon: longitude };
}

function getItemPoint(item = {}) {
  const latitude = finiteNumber(item.latitude ?? item.lat);
  const longitude = finiteNumber(item.longitude ?? item.lon);
  return latitude === null || longitude === null ? null : { lat: latitude, lon: longitude };
}

function findAssetContext(track = {}, items = [], clusters = []) {
  const point = getTrackPoint(track);
  if (!point) return { nearbyItems: [], nearbyClusters: [], nearestDistanceKm: null, strongestCluster: null };
  const nearbyItems = items.map((item) => ({ item, distanceKm: haversineDistanceKm(point, getItemPoint(item) || {}) }))
    .filter((entry) => Number.isFinite(entry.distanceKm) && entry.distanceKm <= 900)
    .sort((left, right) => left.distanceKm - right.distanceKm);
  const nearbyClusters = clusters.map((cluster) => ({
    cluster,
    distanceKm: haversineDistanceKm(point, { lat: cluster.medoid?.latitude, lon: cluster.medoid?.longitude }),
  })).filter((entry) => Number.isFinite(entry.distanceKm) && entry.distanceKm <= 900)
    .sort((left, right) => left.distanceKm - right.distanceKm);
  return {
    nearbyItems,
    nearbyClusters,
    nearestDistanceKm: Math.min(nearbyItems[0]?.distanceKm ?? Infinity, nearbyClusters[0]?.distanceKm ?? Infinity),
    strongestCluster: [...nearbyClusters].sort((left, right) => Number(right.cluster.activity_score || 0) - Number(left.cluster.activity_score || 0))[0] || null,
  };
}

function durationMinutes(track = {}) {
  const metadata = asObject(track.metadata);
  const first = Date.parse(metadata.first_observed || track.first_observed || track.occurred_at || "");
  const last = Date.parse(metadata.last_observed || track.last_observed || track.updated_at || "");
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
  return Math.round((last - first) / 60000);
}

function trackMatchesScope(track = {}, scope = {}, context = {}) {
  if (cleanText(scope.type, "global").toLowerCase() === "global") return true;
  const wanted = cleanText(scope.value || scope.label).toLowerCase();
  const haystack = [track.country, track.region, asObject(track.metadata).country].map((value) => cleanText(value).toLowerCase());
  if (wanted && haystack.some((value) => value && (value === wanted || value.includes(wanted)))) return true;
  if (scope.type === "aoi" && Array.isArray(scope.bbox) && scope.bbox.length === 4) {
    const point = getTrackPoint(track);
    if (point) {
      const [west, south, east, north] = scope.bbox.map(Number);
      if ([west, south, east, north].every(Number.isFinite)
        && point.lon >= west && point.lon <= east && point.lat >= south && point.lat <= north) return true;
    }
  }
  return Number.isFinite(context.nearestDistanceKm) && context.nearestDistanceKm <= 900;
}

function normalizeTrack(track = {}, roleInfo = {}, context = {}, score = 0, reasons = [], confidence = 0) {
  const metadata = asObject(track.metadata);
  const point = getTrackPoint(track);
  const duration = durationMinutes(track);
  const firstObserved = cleanText(metadata.first_observed || track.first_observed, "") || null;
  const lastObserved = cleanText(metadata.last_observed || track.last_observed || track.updated_at, "") || null;
  const closestItem = context.nearbyItems[0]?.item;
  const closestCluster = context.nearbyClusters[0]?.cluster;
  const assetId = cleanText(track.track_key || track.id, "unknown-asset");
  const type = cleanText(metadata.type_code || metadata.model_name || metadata.ship_type || track.subcategory, "unknown");
  return {
    asset_id: assetId,
    track_type: cleanText(track.track_type, "unknown").toLowerCase(),
    callsign: cleanText(metadata.callsign || metadata.call_sign, "") || null,
    name: cleanText(metadata.vessel_name || track.title, "") || null,
    type,
    variant: cleanText(metadata.model_name, "") || null,
    role: roleInfo.role,
    operator: cleanText(metadata.operator || track.operator, "") || null,
    country: cleanText(track.country || metadata.country, "") || null,
    latitude: point?.lat ?? null,
    longitude: point?.lon ?? null,
    altitude_ft: finiteNumber(track.altitude_ft ?? metadata.altitude_ft),
    speed_kts: finiteNumber(track.speed_kts ?? metadata.speed_kts),
    heading_deg: finiteNumber(track.heading_deg ?? metadata.heading),
    squawk: cleanText(metadata.squawk, "") || null,
    first_observed: firstObserved,
    last_observed: lastObserved,
    duration_minutes: duration,
    observation_count: finiteNumber(metadata.observation_count ?? track.observation_count),
    status: cleanText(track.status, "unknown"),
    confidence,
    theater: closestItem?.theater_name || null,
    nearby_event_ids: context.nearbyItems.slice(0, 12).map((entry) => entry.item.event_id).filter(Boolean),
    nearby_cluster_ids: context.nearbyClusters.slice(0, 8).map((entry) => entry.cluster.cluster_id).filter(Boolean),
    nearest_activity_km: Number.isFinite(context.nearestDistanceKm) ? Number(context.nearestDistanceKm.toFixed(1)) : null,
    operational_significance: `${roleInfo.role.replace(/_/g, " ")} identified${closestCluster ? ` near ${closestCluster.location_label}` : ""}.`,
    qualification_reasons: reasons,
    priority_score: Number(score.toFixed(2)),
  };
}

function qualifyHighValueAsset(track = {}, { items = [], clusters = [], scope = { type: "global" } } = {}) {
  const roleInfo = classifyAssetRole(track);
  if (!roleInfo) return { qualified: false, reason: "routine_or_unsupported_asset" };
  const context = findAssetContext(track, items, clusters);
  if (!trackMatchesScope(track, scope, context)) return { qualified: false, reason: "outside_report_scope" };
  const metadata = asObject(track.metadata);
  const observationCount = Number(metadata.observation_count ?? track.observation_count ?? 0);
  const duration = durationMinutes(track);
  const significantNearby = context.nearbyItems.some((entry) => SIGNIFICANT_SEVERITIES.has(entry.item.severity))
    || context.nearbyClusters.some((entry) => Number(entry.cluster.incident_count || 0) >= 2 || Number(entry.cluster.activity_score || 0) >= 3);
  const repeated = observationCount >= 2 || Number(duration || 0) >= 30;
  let score = roleInfo.base;
  const reasons = [`role:${roleInfo.role.toLowerCase()}`];
  if (context.nearestDistanceKm <= 150) { score += 25; reasons.push("within_150km_of_reported_activity"); }
  else if (context.nearestDistanceKm <= 400) { score += 18; reasons.push("within_400km_of_reported_activity"); }
  else if (context.nearestDistanceKm <= 900) { score += 9; reasons.push("within_900km_of_reported_activity"); }
  if (significantNearby) { score += 9; reasons.push("near_significant_operational_activity"); }
  if (repeated) { score += 10; reasons.push("repeated_or_sustained_observation"); }
  const identityFields = [metadata.type_code, metadata.model_name, metadata.role, metadata.vessel_name, track.subcategory].filter(Boolean).length;
  const confidence = Math.min(98, 58 + identityFields * 8 + (getTrackPoint(track) ? 8 : 0));
  if (roleInfo.requiresStrongIdentification && identityFields < 2) {
    return { qualified: false, reason: "insufficient_asset_identification_confidence" };
  }
  if (roleInfo.role === "AERIAL_REFUELING" && !(significantNearby && repeated)) {
    return { qualified: false, reason: "insufficient_operational_context" };
  }
  if (roleInfo.contextual && !(significantNearby && (repeated || context.nearestDistanceKm <= 150))) {
    return { qualified: false, reason: "insufficient_operational_context" };
  }
  if (score < 70) return { qualified: false, reason: "below_hva_priority_threshold" };
  return { qualified: true, asset: normalizeTrack(track, roleInfo, context, score, reasons, confidence) };
}

function buildHighValueAssets(tracks = [], context = {}) {
  const qualified = tracks.map((track) => qualifyHighValueAsset(track, context)).filter((result) => result.qualified)
    .map((result) => result.asset)
    .sort((left, right) => right.priority_score - left.priority_score || left.asset_id.localeCompare(right.asset_id))
    .slice(0, MAX_SELECTED_HVA);
  const captureRequirements = qualified.flatMap((asset) => {
    if (asset.latitude === null || asset.longitude === null) return [];
    const radius = asset.track_type === "naval" ? 250 : 350;
    return [
      {
        type: "HVA_FOCUS_3D",
        asset_id: asset.asset_id,
        latitude: asset.latitude,
        longitude: asset.longitude,
        recommended_context_radius_km: radius,
        recommended_camera_mode: "3D_TRACK_FOCUS",
      },
      {
        type: "HVA_REGIONAL_CONTEXT",
        asset_id: asset.asset_id,
        latitude: asset.latitude,
        longitude: asset.longitude,
        related_cluster_ids: asset.nearby_cluster_ids,
        recommended_context_radius_km: radius * 2,
        recommended_camera_mode: "REGIONAL_2D_OR_3D",
      },
    ];
  });
  return {
    primary: qualified[0] || null,
    secondary: qualified.slice(1),
    all_qualified: qualified,
    capture_requirements: captureRequirements,
  };
}

function buildPreviousDayComparison(snapshotData = {}, previousSnapshot = null) {
  const previous = asObject(previousSnapshot?.snapshot_data || previousSnapshot);
  if (!Object.keys(previous).length) return { available: false, reason: "previous_snapshot_unavailable" };
  const currentActivity = asObject(snapshotData.overall_activity);
  const previousActivity = asObject(previous.overall_activity);
  const currentAggregates = asObject(snapshotData.aggregates);
  const previousAggregates = asObject(previous.aggregates);
  const deltaObject = (current = {}, prior = {}) => Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(prior)])]
    .sort().map((key) => [key, Number(current[key] || 0) - Number(prior[key] || 0)]));
  const currentHigh = Number(asObject(currentAggregates.by_severity).high || 0) + Number(asObject(currentAggregates.by_severity).critical || 0);
  const previousHigh = Number(asObject(previousAggregates.by_severity).high || 0) + Number(asObject(previousAggregates.by_severity).critical || 0);
  const currentCluster = Math.max(0, ...(snapshotData.cluster_summaries || []).map((cluster) => Number(cluster.activity_score || 0)));
  const previousCluster = Math.max(0, ...(previous.cluster_summaries || []).map((cluster) => Number(cluster.activity_score || 0)));
  return {
    available: true,
    previous_report_date: previous.report_date || previousSnapshot?.snapshot_date || null,
    total_activity_change: Number(currentActivity.total_report_items || 0) - Number(previousActivity.total_report_items || 0),
    operational_event_change: Number(currentActivity.operational_event_total || 0) - Number(previousActivity.operational_event_total || 0),
    high_critical_change: currentHigh - previousHigh,
    domain_changes: deltaObject(asObject(currentAggregates.by_domain), asObject(previousAggregates.by_domain)),
    theater_changes: deltaObject(
      Object.fromEntries((currentAggregates.by_theater || []).map((theater) => [theater.theater_id, theater.event_count])),
      Object.fromEntries((previousAggregates.by_theater || []).map((theater) => [theater.theater_id, theater.event_count]))
    ),
    strongest_cluster_activity_change: Number((currentCluster - previousCluster).toFixed(3)),
    source_family_change: Number(snapshotData.source_consensus?.independent_source_family_count || 0)
      - Number(previous.source_consensus?.independent_source_family_count || 0),
    qualified_hva_change: Number(currentActivity.high_value_asset_candidate_total || 0)
      - Number(previousActivity.high_value_asset_candidate_total || previous.report_content?.high_value_assets?.all_qualified?.length || 0),
  };
}

function buildHeadlineStats(snapshotData = {}, hva = {}) {
  const overall = asObject(snapshotData.overall_activity);
  const aggregates = asObject(snapshotData.aggregates);
  const severity = asObject(aggregates.by_severity);
  const verification = asObject(aggregates.by_verification_state);
  const highCritical = Number(severity.high || 0) + Number(severity.critical || 0);
  const corroborated = Number(verification.confirmed || 0) + Number(verification.corroborated || 0);
  return [
    { id: "operational_incidents", label: "Operational incidents", value: Number(overall.operational_event_total || 0), supporting_text: "Normalized map-eligible incidents", state: activityLevel(overall.operational_event_total, highCritical) },
    { id: "high_critical", label: "High / critical", value: highCritical, supporting_text: `${Number(severity.critical || 0)} critical`, state: highCritical ? "ATTENTION" : "NORMAL" },
    { id: "corroborated", label: "Corroborated+", value: corroborated, supporting_text: "Confirmed or independently corroborated", state: corroborated ? "VERIFIED" : "LIMITED" },
    { id: "active_clusters", label: "Active clusters", value: (snapshotData.cluster_summaries || []).length, supporting_text: "Spatial operational groupings", state: "OBSERVED" },
    { id: "qualified_hva", label: "Qualified HVA", value: hva.all_qualified?.length || 0, supporting_text: "Context-qualified strategic assets", state: hva.all_qualified?.length ? "NOTABLE" : "NONE" },
    { id: "source_families", label: "Independent sources", value: Number(snapshotData.source_consensus?.independent_source_family_count || 0), supporting_text: "Independent source families", state: "SOURCE_BASE" },
  ];
}

function buildKeyJudgments(snapshotData = {}, major = [], hva = {}, comparison = {}) {
  const judgments = [];
  const clusters = snapshotData.cluster_summaries || [];
  const strongest = [...clusters].sort((left, right) => Number(right.incident_count || 0) - Number(left.incident_count || 0)
    || Number(right.activity_score || 0) - Number(left.activity_score || 0))[0];
  if (Number(strongest?.incident_count || 0) >= 2) {
    judgments.push({
      id: `judgment-cluster-${slugify(strongest.cluster_id)}`,
      judgment: `OBSERVED: Repeated operational activity was concentrated in ${strongest.location_label}.`,
      supporting_event_ids: strongest.event_ids,
      supporting_cluster_ids: [strongest.cluster_id],
      confidence: strongest.corroborated_count >= 2 ? "HIGH" : "MODERATE",
      theater: major.find((item) => item.relevant_cluster_id === strongest.cluster_id)?.theater_name || null,
      domain: strongest.dominant_domain,
      evidence_summary: `${strongest.incident_count} incidents contributed to the cluster; ${strongest.corroborated_count} were corroborated or confirmed.`,
      reasoning_basis: "spatial_concentration_and_repetition",
    });
  }
  const domainCounts = sortCounts(asObject(snapshotData.aggregates?.by_domain));
  const [leadingDomain, leadingCount] = domainCounts[0] || [];
  const domainEvents = major.filter((item) => item.domain?.toLowerCase() === leadingDomain).map((item) => item.event_id).filter(Boolean);
  if (leadingCount >= 3 && domainEvents.length >= 2) {
    judgments.push({
      id: `judgment-domain-${slugify(leadingDomain)}`,
      judgment: `INDICATES: ${leadingDomain.toUpperCase()} activity formed a sustained feature of the reporting window.`,
      supporting_event_ids: domainEvents,
      supporting_cluster_ids: [...new Set(major.filter((item) => item.domain?.toLowerCase() === leadingDomain).map((item) => item.relevant_cluster_id).filter(Boolean))],
      confidence: "MODERATE",
      theater: major.find((item) => item.domain?.toLowerCase() === leadingDomain)?.theater_name || null,
      domain: leadingDomain.toUpperCase(),
      evidence_summary: `${leadingCount} report items were classified in the domain.`,
      reasoning_basis: "repeated_domain_activity",
    });
  }
  const verified = major.filter((item) => VERIFIED_STATES.has(item.verification_state));
  if (verified.length >= 2) {
    judgments.push({
      id: "judgment-corroborated-pattern",
      judgment: "ASSESSED: Multiple independently supported developments indicate that the observed activity pattern was sustained during the reporting period.",
      supporting_event_ids: verified.map((item) => item.event_id).filter(Boolean),
      supporting_cluster_ids: [...new Set(verified.map((item) => item.relevant_cluster_id).filter(Boolean))],
      confidence: verified.length >= 4 ? "HIGH" : "MODERATE",
      theater: verified[0]?.theater_name || null,
      domain: "MIXED",
      evidence_summary: `${verified.length} selected developments were confirmed or corroborated.`,
      reasoning_basis: "independent_verification_across_developments",
    });
  }
  if (comparison.available && Math.abs(comparison.operational_event_change) >= 3) {
    const direction = comparison.operational_event_change > 0 ? "increased" : "decreased";
    judgments.push({
      id: "judgment-day-over-day-tempo",
      judgment: `OBSERVED: Recorded operational tempo ${direction} versus the preceding daily snapshot.`,
      supporting_event_ids: major.map((item) => item.event_id).filter(Boolean),
      supporting_cluster_ids: [...new Set(major.map((item) => item.relevant_cluster_id).filter(Boolean))],
      confidence: "MODERATE",
      theater: null,
      domain: "MIXED",
      evidence_summary: `Operational event delta: ${comparison.operational_event_change >= 0 ? "+" : ""}${comparison.operational_event_change}.`,
      reasoning_basis: "previous_day_snapshot_comparison",
    });
  }
  if ((hva.all_qualified || []).length >= 2) {
    judgments.push({
      id: "judgment-multiple-hva",
      judgment: "SUGGESTS: Multiple qualified high-value assets contributed to an elevated strategic support or surveillance posture.",
      supporting_event_ids: [...new Set(hva.all_qualified.flatMap((asset) => asset.nearby_event_ids))],
      supporting_cluster_ids: [...new Set(hva.all_qualified.flatMap((asset) => asset.nearby_cluster_ids))],
      supporting_asset_ids: hva.all_qualified.map((asset) => asset.asset_id),
      confidence: "MODERATE",
      theater: hva.primary?.theater || null,
      domain: "AIR_MARITIME",
      evidence_summary: `${hva.all_qualified.length} assets passed role, identification, scope and operational-context checks.`,
      reasoning_basis: "multiple_context_qualified_hva",
    });
  }
  return judgments;
}

function buildWatchIndicators(snapshotData = {}, hva = {}, items = []) {
  const indicators = [];
  const clusters = snapshotData.cluster_summaries || [];
  clusters.filter((cluster) => Number(cluster.incident_count || 0) >= 2).slice(0, 3).forEach((cluster) => {
    indicators.push({
      id: `watch-cluster-${slugify(cluster.cluster_id)}`,
      indicator: `Recurring ${cleanText(cluster.dominant_domain, "mixed")} activity in ${cluster.location_label}`,
      current_state: `${cluster.incident_count} clustered incidents; latest ${cluster.latest_activity || "time unavailable"}`,
      trigger_event_ids: cluster.event_ids,
      trigger_cluster_ids: [cluster.cluster_id],
      theater: null,
      location: cluster.location_label,
      domain: cluster.dominant_domain,
      confidence: cluster.corroborated_count >= 2 ? "HIGH" : "MODERATE",
      why_it_matters: "Further activity in the same area would reinforce an already repeated operational pattern.",
      watch_window: "24-72H",
    });
  });
  ["missile", "air_defence", "gnss", "cyber", "airspace"].forEach((domain) => {
    const count = Number(snapshotData.aggregates?.by_domain?.[domain] || 0);
    if (count < 2) return;
    const domainItems = items.filter((item) => cleanText(item.domain).toLowerCase() === domain);
    indicators.push({
      id: `watch-domain-${domain}`,
      indicator: `Continued ${domain.replace(/_/g, " ")} activity`,
      current_state: `${count} related report items in the current window`,
      trigger_event_ids: domainItems.map((item) => item.event_id).filter(Boolean),
      trigger_cluster_ids: clusters.filter((cluster) => Object.keys(asObject(cluster.domain_distribution)).some((key) => key.toLowerCase() === domain)).map((cluster) => cluster.cluster_id),
      theater: null,
      location: null,
      domain: domain.toUpperCase(),
      confidence: "MODERATE",
      why_it_matters: "Persistence or geographic expansion could indicate a material change in operational tempo.",
      watch_window: "24-72H",
    });
  });
  (hva.all_qualified || []).slice(0, 3).forEach((asset) => {
    indicators.push({
      id: `watch-hva-${slugify(asset.asset_id)}`,
      indicator: `Continued presence or repositioning of ${asset.role.replace(/_/g, " ")}`,
      current_state: `${asset.asset_id} last observed ${asset.last_observed || "at an unavailable time"}`,
      trigger_event_ids: asset.nearby_event_ids,
      trigger_cluster_ids: asset.nearby_cluster_ids,
      trigger_asset_ids: [asset.asset_id],
      theater: asset.theater,
      location: asset.latitude === null ? null : { latitude: asset.latitude, longitude: asset.longitude },
      domain: asset.track_type === "naval" ? "MARITIME" : "AIR",
      confidence: asset.confidence >= 85 ? "HIGH" : "MODERATE",
      why_it_matters: asset.operational_significance,
      watch_window: "24-72H",
    });
  });
  return indicators;
}

function buildTheaterSections(theaters = [], major = [], hva = {}) {
  return theaters.map((theater) => {
    const developments = major.filter((item) => item.theater_id === theater.theater_id);
    const assets = (hva.all_qualified || []).filter((asset) => asset.theater === theater.theater_name);
    const themes = [...theater.dominant_domains].sort((left, right) => right.count - left.count).map((entry) => ({
      theme: entry.domain,
      weight: entry.count,
      evidence_event_ids: developments.filter((item) => item.domain === entry.domain).map((item) => item.event_id).filter(Boolean),
    }));
    assets.forEach((asset) => {
      themes.push({ theme: asset.role, weight: 1, evidence_asset_ids: [asset.asset_id] });
    });
    return {
      theater_id: theater.theater_id,
      theater: theater.theater_name,
      activity_level: activityLevel(theater.event_count, theater.critical_count + theater.high_count),
      event_count: theater.event_count,
      critical_count: theater.critical_count,
      high_count: theater.high_count,
      corroborated_count: theater.corroborated_count,
      dominant_domains: theater.dominant_domains,
      major_development_ids: developments.map((item) => item.report_item_id),
      major_cluster_ids: theater.major_clusters,
      qualified_hva_ids: assets.map((asset) => asset.asset_id),
      latest_significant_activity: developments[0]?.occurred_at || theater.latest_activity,
      trend: theater.activity_change,
      key_operational_themes: themes.slice(0, 6),
      assessment_inputs: {
        source_family_count: theater.source_family_count,
        repeated_cluster_count: theater.major_clusters.length,
        high_value_asset_roles: assets.map((asset) => asset.role),
      },
    };
  });
}

function buildSourceConsensus(major = [], snapshotData = {}) {
  const matrix = major.map((item) => ({
    development_id: item.report_item_id,
    event_id: item.event_id,
    raw_reports: Number(item.raw_report_count || 0),
    independent_families: Number(item.independent_source_family_count || 0),
    source_families: item.independent_source_families || [],
    top_source_families: (item.independent_source_families || []).slice(0, 5),
    source_classes: [...new Set((item.source_provenance || []).map((entry) => entry.source_class).filter(Boolean))],
    source_mix: countExactValues(item.source_provenance || [], (entry) => entry.source_class),
    official_confirmation: item.official_confirmation === true,
    direct_evidence: item.direct_evidence === true,
    verification_state: item.verification_state,
    dispute_status: item.disputed ? "DISPUTED" : "NOT_DISPUTED",
  }));
  return { summary: snapshotData.source_consensus, development_matrix: matrix };
}

function buildCrossDomainAssessment(snapshotData = {}) {
  return (snapshotData.cluster_summaries || []).flatMap((cluster) => {
    const domains = Object.entries(asObject(cluster.domain_distribution)).filter(([, share]) => Number(share) >= 0.12)
      .sort((left, right) => right[1] - left[1]);
    if (domains.length < 2) return [];
    return [{
      id: `cross-domain-${slugify(cluster.cluster_id)}`,
      related_domains: domains.slice(0, 4).map(([domain]) => domain),
      supporting_event_ids: cluster.event_ids,
      supporting_cluster_ids: [cluster.cluster_id],
      temporal_relationship: `Co-occurring within the daily reporting window; latest activity ${cluster.latest_activity || "unavailable"}.`,
      geographic_relationship: `Grouped within operational cluster ${cluster.location_label}.`,
      confidence: cluster.corroborated_count >= 2 ? "MODERATE" : "LOW",
      assessment_note: "Cross-domain co-occurrence is observed; no causal relationship is inferred.",
    }];
  }).slice(0, 8);
}

function buildOutlook(watchIndicators = [], theaterSections = [], comparison = {}) {
  const outlook = watchIndicators.slice(0, 6).map((indicator) => ({
    id: `outlook-${slugify(indicator.id)}`,
    theater: indicator.theater,
    domain: indicator.domain,
    assessment: `SUGGESTS monitoring for ${indicator.indicator.toLowerCase()} during the next reporting cycle.`,
    confidence: indicator.confidence,
    supporting_indicator_ids: [indicator.id],
    supporting_event_ids: indicator.trigger_event_ids || [],
    supporting_cluster_ids: indicator.trigger_cluster_ids || [],
    supporting_asset_ids: indicator.trigger_asset_ids || [],
    time_horizon: indicator.watch_window,
    conditions_to_watch: ["additional corroborated reports", "geographic expansion", "increased frequency or duration"],
  }));
  if (comparison.available && comparison.operational_event_change > 0 && theaterSections[0]) {
    outlook.unshift({
      id: "outlook-tempo-continuity",
      theater: theaterSections[0].theater,
      domain: theaterSections[0].dominant_domains[0]?.domain || "MIXED",
      assessment: "ASSESSED: Elevated recorded tempo may persist if the leading theater continues to generate corroborated activity.",
      confidence: "MODERATE",
      supporting_indicator_ids: [],
      supporting_event_ids: [],
      supporting_cluster_ids: theaterSections[0].major_cluster_ids,
      supporting_asset_ids: [],
      time_horizon: "24-72H",
      conditions_to_watch: ["daily event volume remains above the preceding snapshot", "cluster intensity increases"],
    });
  }
  return outlook.slice(0, 6);
}

function buildCaptureTargets({ major = [], clusters = [], hva = {}, counts = {}, scope = {}, satellitePreview = null } = {}) {
  const targets = [];
  const add = (target) => {
    const identity = `${target.type}:${target.event_id || target.cluster_id || target.asset_id || target.satellite_event_id || "scope"}`;
    if (!targets.some((entry) => entry.identity === identity)) targets.push({ ...target, identity });
  };
  const strongest = [...clusters].sort((left, right) => Number(right.activity_score || 0) - Number(left.activity_score || 0))[0];
  if (strongest) add({
    type: "OPERATIONAL_OVERVIEW",
    priority: 100,
    cluster_id: strongest.cluster_id,
    event_ids: strongest.event_ids,
    location: strongest.medoid,
    bounds: strongest.bounds,
    reason: "Strongest weighted operational cluster",
    recommended_camera_mode: "REGIONAL_2D_OR_3D",
  });
  major.filter((item) => SIGNIFICANT_SEVERITIES.has(item.severity) && item.latitude !== null && item.longitude !== null).slice(0, 4).forEach((item, index) => add({
    type: item.domain === "AIR" || item.domain === "ALERT" ? "AIRSPACE_EVENT" : "MAJOR_DEVELOPMENT",
    priority: 95 - index,
    event_id: item.event_id,
    cluster_id: item.relevant_cluster_id,
    location: { latitude: item.latitude, longitude: item.longitude },
    bounds: null,
    reason: `${item.severity} selected development with trusted coordinates`,
    recommended_camera_mode: "EVENT_CONTEXT_3D",
  }));
  (hva.all_qualified || []).slice(0, 2).forEach((asset, index) => add({
    type: asset.track_type === "naval" ? "NAVAL_ASSET_FOCUS" : "HVA_FOCUS_3D",
    priority: 90 - index,
    asset_id: asset.asset_id,
    related_cluster_ids: asset.nearby_cluster_ids,
    location: asset.latitude === null ? null : { latitude: asset.latitude, longitude: asset.longitude },
    bounds: null,
    reason: asset.operational_significance,
    recommended_camera_mode: asset.track_type === "naval" ? "MARITIME_3D" : "3D_TRACK_FOCUS",
  }));
  if (Number(counts.satellite_total || 0) > 0) add({
    type: "ORBITAL_CONTEXT",
    priority: 80,
    satellite_event_id: cleanText(satellitePreview?.event_id, "") || null,
    location: null,
    bounds: null,
    reason: "Available satellite observation metadata for the reporting window",
    recommended_camera_mode: "ORBITAL_CONTEXT",
  });
  if (scope.type === "aoi" && Array.isArray(scope.bbox)) add({
    type: "AOI_CONTEXT",
    priority: 75,
    location: null,
    bounds: scope.bbox,
    reason: "Requested area-of-interest context",
    recommended_camera_mode: "AOI_OVERVIEW",
  });
  return targets.sort((left, right) => right.priority - left.priority).slice(0, MAX_CAPTURE_TARGETS).map(({ identity, ...target }) => target);
}

function buildExecutiveSummaryInputs(snapshotData = {}, major = [], hva = {}, comparison = {}) {
  const severity = asObject(snapshotData.aggregates?.by_severity);
  const highCritical = Number(severity.high || 0) + Number(severity.critical || 0);
  const domains = sortCounts(asObject(snapshotData.aggregates?.by_domain));
  const theaters = snapshotData.aggregates?.by_theater || [];
  const domainSignals = Object.fromEntries(["air", "maritime", "strike", "missile", "air_defence", "alert", "cyber", "infrastructure", "gnss"]
    .map((domain) => [domain, Number(snapshotData.aggregates?.by_domain?.[domain] || 0)]));
  return {
    activity_level: activityLevel(snapshotData.overall_activity?.total_report_items, highCritical),
    leading_theaters: theaters.slice(0, 3).map((theater) => ({ theater: theater.theater_name, event_count: theater.event_count })),
    critical_event_count: Number(severity.critical || 0),
    high_event_count: Number(severity.high || 0),
    major_development_ids: major.map((item) => item.report_item_id),
    strongest_domains: domains.slice(0, 4).map(([domain, count]) => ({ domain: domain.toUpperCase(), count })),
    escalation_signals: major.filter((item) => SIGNIFICANT_SEVERITIES.has(item.severity) || Number(item.relevant_cluster_id ? 1 : 0)).slice(0, 8)
      .map((item) => ({ event_id: item.event_id, severity: item.severity, domain: item.domain, cluster_id: item.relevant_cluster_id })),
    significant_domain_activity: domainSignals,
    notable_asset_ids: (hva.all_qualified || []).map((asset) => asset.asset_id),
    notable_airspace_changes: major.filter((item) => ["AIR", "AIR_DEFENCE", "ALERT"].includes(item.domain)).map((item) => item.report_item_id),
    notable_disruptions: major.filter((item) => ["CYBER", "GNSS"].includes(item.domain) || item.category === "infrastructure").map((item) => item.report_item_id),
    significant_satellite_observation_count: Number(snapshotData.overall_activity?.satellite_total || 0),
    comparison_to_previous_day: comparison,
  };
}

function buildReportContent({ snapshotData = {}, items = [], clusters = [], theaters = [], tracks = [], previousSnapshot = null, counts = {}, scope = {}, satellitePreview = null } = {}) {
  const major = buildMajorDevelopments(items, clusters, theaters);
  const hva = buildHighValueAssets(tracks, { items, clusters, scope });
  snapshotData.overall_activity.high_value_asset_candidate_total = hva.all_qualified.length;
  const comparison = buildPreviousDayComparison(snapshotData, previousSnapshot);
  const theaterSections = buildTheaterSections(theaters, major, hva);
  const judgments = buildKeyJudgments(snapshotData, major, hva, comparison);
  const watchIndicators = buildWatchIndicators(snapshotData, hva, items);
  const captureTargets = buildCaptureTargets({ major, clusters, hva, counts, scope, satellitePreview });
  const sourceConsensus = buildSourceConsensus(major, snapshotData);
  const crossDomain = buildCrossDomainAssessment(snapshotData);
  const outlook = buildOutlook(watchIndicators, theaterSections, comparison);
  return {
    report_content_model_version: REPORT_CONTENT_MODEL_VERSION,
    executive_summary: buildExecutiveSummaryInputs(snapshotData, major, hva, comparison),
    headline_stats: buildHeadlineStats(snapshotData, hva),
    theater_sections: theaterSections,
    key_judgments: judgments,
    watch_indicators: watchIndicators,
    major_developments: major,
    event_cards: major.map((item) => ({ report_item_id: item.report_item_id, event_id: item.event_id, title: item.title, summary: item.summary, occurred_at: item.occurred_at, location: { country: item.event_country, region: item.event_region, city: item.event_city, place: item.event_place, latitude: item.latitude, longitude: item.longitude, precision: item.location_precision }, severity: item.severity, confidence: item.confidence, verification_state: item.verification_state, domain: item.domain, source_family_summary: item.source_family_summary })),
    high_value_assets: hva,
    operational_imagery_targets: captureTargets,
    imagery_placeholders: {
      operational: captureTargets.filter((target) => ["OPERATIONAL_OVERVIEW", "MAJOR_DEVELOPMENT", "AIRSPACE_EVENT"].includes(target.type)),
      regional: captureTargets.filter((target) => target.type === "OPERATIONAL_OVERVIEW"),
      aoi: captureTargets.filter((target) => target.type === "AOI_CONTEXT"),
      orbital: captureTargets.filter((target) => target.type === "ORBITAL_CONTEXT"),
      asset_track: hva.capture_requirements,
    },
    intelligence_wire_synthesis: {
      selected_intelligence_ids: items.filter((item) => item.record_type === "broader_intelligence").sort((left, right) => Number(right.report_relevance_score || 0) - Number(left.report_relevance_score || 0)).slice(0, 20).map((item) => item.intelligence_id),
      by_verification_state: snapshotData.aggregates?.by_verification_state || {},
      by_source_class: snapshotData.aggregates?.by_source_class || {},
      leading_source_families: snapshotData.source_consensus?.independent_source_families?.slice(0, 20) || [],
    },
    source_consensus: sourceConsensus,
    cross_domain_assessment: crossDomain,
    outlook,
    previous_day_comparison: comparison,
    methodology_metrics: {
      report_item_total: Number(snapshotData.overall_activity?.total_report_items || 0),
      operational_event_total: Number(snapshotData.overall_activity?.operational_event_total || 0),
      broader_intelligence_total: Number(snapshotData.overall_activity?.broader_intelligence_total || 0),
      independent_source_family_count: Number(snapshotData.source_consensus?.independent_source_family_count || 0),
      qualified_hva_total: hva.all_qualified.length,
      location_precision_distribution: countValues(items, (item) => item.location_precision),
      verification_distribution: snapshotData.aggregates?.by_verification_state || {},
      selection_method: "deterministic_relevance_deduplication_and_context_scoring",
    },
    disclaimer_metadata: {
      source_basis: "Normalized open-source intelligence and operational telemetry",
      causal_inference: false,
      predictive_certainty: false,
      disputed_reports_labeled: true,
      unavailable_telemetry_fields_preserved_as_null: true,
    },
  };
}

export {
  REPORT_CONTENT_MODEL_VERSION,
  buildMajorDevelopments,
  buildPreviousDayComparison,
  buildReportContent,
  qualifyHighValueAsset,
};
