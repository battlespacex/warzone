const CAPTURE_STATUS = Object.freeze({
  PENDING: "PENDING",
  GENERATING: "GENERATING",
  READY: "READY",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
});

const CAPTURE_TYPE_ALIASES = Object.freeze({
  OPERATIONAL_OVERVIEW: "REGIONAL_OVERVIEW_3D",
  REGIONAL_OVERVIEW_3D: "REGIONAL_OVERVIEW_3D",
  TACTICAL_OVERVIEW_2D: "TACTICAL_OVERVIEW_2D",
  MAJOR_DEVELOPMENT: "MAJOR_DEVELOPMENT_CONTEXT",
  AIRSPACE_EVENT: "MAJOR_DEVELOPMENT_CONTEXT",
  MAJOR_DEVELOPMENT_CONTEXT: "MAJOR_DEVELOPMENT_CONTEXT",
  CLUSTER_CONTEXT: "CLUSTER_CONTEXT",
  HVA_FOCUS_3D: "HVA_FOCUS_3D",
  HVA_REGIONAL_CONTEXT: "HVA_REGIONAL_CONTEXT",
  NAVAL_ASSET_FOCUS: "NAVAL_FOCUS",
  NAVAL_FOCUS: "NAVAL_FOCUS",
  AOI_CONTEXT: "AOI_CONTEXT",
  ORBITAL_CONTEXT: "ORBITAL_CONTEXT",
});
const DEFAULT_CAPTURE_PRIORITY = Object.freeze({
  REGIONAL_OVERVIEW_3D: 100,
  TACTICAL_OVERVIEW_2D: 96,
  MAJOR_DEVELOPMENT_CONTEXT: 92,
  CLUSTER_CONTEXT: 88,
  HVA_FOCUS_3D: 90,
  HVA_REGIONAL_CONTEXT: 84,
  NAVAL_FOCUS: 89,
  AOI_CONTEXT: 82,
  ORBITAL_CONTEXT: 80,
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanText(value = "", fallback = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function slugify(value = "", fallback = "item") {
  return cleanText(value, fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeCaptureType(value = "") {
  return CAPTURE_TYPE_ALIASES[cleanText(value).toUpperCase()] || "";
}

function normalizePoint(value = {}, fallback = {}) {
  const source = asObject(value);
  const backup = asObject(fallback);
  const latitude = finiteNumber(source.latitude ?? source.lat ?? backup.latitude ?? backup.lat);
  const longitude = finiteNumber(source.longitude ?? source.lon ?? backup.longitude ?? backup.lon);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function normalizeBounds(value) {
  if (Array.isArray(value) && value.length === 4) {
    const [west, south, east, north] = value.map(Number);
    return [west, south, east, north].every(Number.isFinite)
      ? { west, south, east, north, crosses_antimeridian: east < west }
      : null;
  }
  const source = asObject(value);
  const west = finiteNumber(source.west ?? source.minLon);
  const south = finiteNumber(source.south ?? source.minLat);
  const east = finiteNumber(source.east ?? source.maxLon);
  const north = finiteNumber(source.north ?? source.maxLat);
  if ([west, south, east, north].some((entry) => entry === null)) return null;
  return {
    west,
    south,
    east,
    north,
    crosses_antimeridian: source.crosses_antimeridian === true || east < west,
  };
}

function getSnapshotParts(snapshot = {}) {
  const snapshotData = asObject(snapshot.snapshot_data);
  const reportContent = asObject(snapshotData.report_content);
  const manifest = asObject(snapshot.report_manifest);
  return { snapshotData, reportContent, manifest };
}

function findCluster(snapshotData = {}, clusterId = "") {
  const wanted = cleanText(clusterId);
  return (snapshotData.cluster_summaries || []).find((cluster) => cleanText(cluster.cluster_id) === wanted) || null;
}

function findDevelopment(reportContent = {}, eventId = "") {
  const wanted = cleanText(eventId);
  return (reportContent.major_developments || []).find((item) => cleanText(item.event_id || item.report_item_id) === wanted) || null;
}

function findAsset(reportContent = {}, assetId = "") {
  const wanted = cleanText(assetId);
  const selected = reportContent.high_value_assets?.selected_for_report || [];
  return [...selected, ...(reportContent.high_value_assets?.all_qualified || [])]
    .find((asset) => cleanText(asset.asset_id) === wanted) || null;
}

function aggregateClusterBounds(clusters = []) {
  const normalized = clusters.map((cluster) => normalizeBounds(cluster.bounds)).filter(Boolean);
  if (!normalized.length) return null;
  if (normalized.some((bounds) => bounds.crosses_antimeridian)) return normalized[0];
  return {
    west: Math.min(...normalized.map((bounds) => bounds.west)),
    south: Math.min(...normalized.map((bounds) => bounds.south)),
    east: Math.max(...normalized.map((bounds) => bounds.east)),
    north: Math.max(...normalized.map((bounds) => bounds.north)),
    crosses_antimeridian: false,
  };
}

function resolveCaptureTarget(snapshot = {}, rawTarget = {}) {
  const { snapshotData, reportContent } = getSnapshotParts(snapshot);
  const captureType = normalizeCaptureType(rawTarget.capture_type || rawTarget.type);
  if (!captureType) return { safe: false, reason: "unsupported_capture_type" };
  const eventId = cleanText(rawTarget.event_id, "") || null;
  const clusterId = cleanText(rawTarget.cluster_id, "") || null;
  const assetId = cleanText(rawTarget.asset_id, "") || null;
  const cluster = clusterId ? findCluster(snapshotData, clusterId) : null;
  const development = eventId ? findDevelopment(reportContent, eventId) : null;
  const asset = assetId ? findAsset(reportContent, assetId) : null;
  const clusters = snapshotData.cluster_summaries || [];
  const strongestCluster = [...clusters].sort((left, right) => Number(right.activity_score || 0) - Number(left.activity_score || 0))[0] || null;
  let bounds = normalizeBounds(rawTarget.bounds || cluster?.bounds);
  let center = normalizePoint(rawTarget.location || rawTarget, cluster?.medoid || development || asset);

  if (captureType === "REGIONAL_OVERVIEW_3D" || captureType === "TACTICAL_OVERVIEW_2D") {
    bounds = bounds || aggregateClusterBounds(clusters);
    center = center || normalizePoint(strongestCluster?.medoid);
    if (!center && !bounds) return { safe: false, reason: "overview_has_no_operational_geometry" };
  }
  if (captureType === "CLUSTER_CONTEXT") {
    if (!cluster && !bounds) return { safe: false, reason: "cluster_geometry_unavailable" };
    center = center || normalizePoint(cluster?.medoid);
  }
  if (captureType === "MAJOR_DEVELOPMENT_CONTEXT") {
    const precision = cleanText(development?.location_precision).toUpperCase();
    if (!center || !["EXACT", "LOCAL"].includes(precision)) {
      return { safe: false, reason: "event_has_no_trusted_point_geometry" };
    }
  }
  if (["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT", "NAVAL_FOCUS"].includes(captureType)) {
    center = center || normalizePoint(asset);
    if (!asset || !center) return { safe: false, reason: "asset_snapshot_geometry_unavailable" };
  }
  if (captureType === "AOI_CONTEXT" && !bounds) {
    return { safe: false, reason: "aoi_bounds_unavailable" };
  }
  if (captureType === "ORBITAL_CONTEXT") {
    const satelliteCount = Number(snapshotData.overall_activity?.satellite_total || 0);
    if (!satelliteCount && !rawTarget.satellite_event_id) {
      return { safe: false, reason: "orbital_context_not_supported_by_snapshot" };
    }
    center = center || normalizePoint(strongestCluster?.medoid);
    bounds = bounds || normalizeBounds(strongestCluster?.bounds);
  }

  return {
    safe: true,
    target: {
      capture_type: captureType,
      source_type: cleanText(rawTarget.type || rawTarget.capture_type),
      priority: Number(rawTarget.priority || DEFAULT_CAPTURE_PRIORITY[captureType] || 0),
      event_id: eventId,
      cluster_id: clusterId,
      asset_id: assetId,
      satellite_event_id: cleanText(rawTarget.satellite_event_id, "") || null,
      related_cluster_ids: Array.isArray(rawTarget.related_cluster_ids) ? rawTarget.related_cluster_ids.filter(Boolean) : [],
      event_ids: Array.isArray(rawTarget.event_ids) ? rawTarget.event_ids.filter(Boolean) : [],
      center,
      bounds,
      recommended_context_radius_km: finiteNumber(rawTarget.recommended_context_radius_km),
      recommended_camera_mode: cleanText(rawTarget.recommended_camera_mode, "") || null,
      reason: cleanText(rawTarget.reason, "Selected by the Phase 2 report intelligence model"),
      source_target: {
        type: cleanText(rawTarget.type || rawTarget.capture_type),
        event_id: eventId,
        cluster_id: clusterId,
        asset_id: assetId,
      },
    },
  };
}

function captureFamily(captureType = "") {
  if (captureType === "MAJOR_DEVELOPMENT_CONTEXT") return "development";
  if (captureType === "CLUSTER_CONTEXT") return "cluster";
  if (["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT"].includes(captureType)) return "hva";
  if (captureType === "NAVAL_FOCUS") return "naval";
  if (captureType === "AOI_CONTEXT") return "aoi";
  if (captureType === "ORBITAL_CONTEXT") return "orbital";
  return "overview";
}

function captureFilename(captureType, ordinal, extension = "jpg") {
  const index = String(ordinal).padStart(2, "0");
  const names = {
    REGIONAL_OVERVIEW_3D: `operational-overview-3d.${extension}`,
    TACTICAL_OVERVIEW_2D: `tactical-overview-2d.${extension}`,
    MAJOR_DEVELOPMENT_CONTEXT: `development-${index}-context.${extension}`,
    CLUSTER_CONTEXT: `cluster-${index}-context.${extension}`,
    HVA_FOCUS_3D: `hva-${index}-focus-3d.${extension}`,
    HVA_REGIONAL_CONTEXT: `hva-${index}-regional.${extension}`,
    NAVAL_FOCUS: `naval-${index}-focus.${extension}`,
    AOI_CONTEXT: `aoi-${index}-context.${extension}`,
    ORBITAL_CONTEXT: `orbital-${index}-context.${extension}`,
  };
  return names[captureType] || `capture-${index}.${extension}`;
}

function getScopePath(snapshot = {}) {
  const snapshotData = asObject(snapshot.snapshot_data);
  const scope = asObject(snapshotData.scope);
  const type = cleanText(snapshot.scope_type || scope.type, "global").toLowerCase();
  if (type === "global") return "global";
  const value = snapshot.scope_value || scope.value || scope.label || snapshot.scope_label || "all";
  return `${slugify(type, "scope")}/${slugify(value, "all")}`;
}

function buildReportImageDirectory(snapshot = {}) {
  const dateKey = cleanText(snapshot.snapshot_date || snapshot.snapshot_data?.report_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Invalid snapshot date for report image path");
  return `daily/${getScopePath(snapshot)}/${dateKey}/images`;
}

function buildCaptureDescriptors(snapshot = {}, { maxImages = 8, s3Prefix = "reports", format = "jpeg" } = {}) {
  const { reportContent, manifest } = getSnapshotParts(snapshot);
  const sourceTargets = [
    ...(Array.isArray(reportContent.operational_imagery_targets) ? reportContent.operational_imagery_targets : []),
    ...(Array.isArray(manifest.selected_capture_targets) ? manifest.selected_capture_targets : []),
    ...(Array.isArray(manifest.capture_requirements) ? manifest.capture_requirements : []),
  ];
  const deduped = [];
  const identities = new Set();
  sourceTargets.forEach((rawTarget) => {
    const resolved = resolveCaptureTarget(snapshot, rawTarget);
    if (!resolved.safe) return;
    const target = resolved.target;
    const identity = [target.capture_type, target.event_id, target.cluster_id, target.asset_id, target.satellite_event_id].filter(Boolean).join(":");
    if (!identity || identities.has(identity)) return;
    identities.add(identity);
    deduped.push(target);
  });
  deduped.sort((left, right) => right.priority - left.priority
    || left.capture_type.localeCompare(right.capture_type)
    || cleanText(left.event_id || left.cluster_id || left.asset_id).localeCompare(cleanText(right.event_id || right.cluster_id || right.asset_id)));

  const familyCounts = new Map();
  const assetOrdinals = new Map();
  const imageDirectory = buildReportImageDirectory(snapshot);
  const prefix = cleanText(s3Prefix, "reports").replace(/^\/+|\/+$/g, "") || "reports";
  const extension = cleanText(format).toLowerCase() === "png" ? "png" : "jpg";
  return deduped.slice(0, clamp(maxImages, 1, 24)).map((target, index) => {
    const family = captureFamily(target.capture_type);
    let ordinal;
    if (target.asset_id && ["hva", "naval"].includes(family)) {
      if (!assetOrdinals.has(target.asset_id)) assetOrdinals.set(target.asset_id, assetOrdinals.size + 1);
      ordinal = assetOrdinals.get(target.asset_id);
    } else {
      ordinal = (familyCounts.get(family) || 0) + 1;
      familyCounts.set(family, ordinal);
    }
    const filename = captureFilename(target.capture_type, ordinal, extension);
    return {
      ...target,
      capture_id: `capture-${String(index + 1).padStart(2, "0")}-${slugify(target.capture_type)}`,
      filename,
      relative_path: `${imageDirectory}/${filename}`,
      s3_key: `${prefix}/${imageDirectory}/${filename}`,
      status: CAPTURE_STATUS.PENDING,
    };
  });
}

function centerFromBounds(bounds = {}) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return null;
  const longitude = normalized.crosses_antimeridian
    ? ((((normalized.west + ((normalized.east + 360) - normalized.west) / 2) + 540) % 360) - 180)
    : (normalized.west + normalized.east) / 2;
  return { latitude: (normalized.south + normalized.north) / 2, longitude };
}

function boundsSpanKm(bounds = {}) {
  const normalized = normalizeBounds(bounds);
  if (!normalized) return 0;
  const latSpan = Math.abs(normalized.north - normalized.south) * 111;
  const rawLonSpan = normalized.crosses_antimeridian
    ? (normalized.east + 360) - normalized.west
    : Math.abs(normalized.east - normalized.west);
  const centerLat = (normalized.south + normalized.north) / 2;
  const lonSpan = rawLonSpan * 111 * Math.max(0.15, Math.cos(centerLat * Math.PI / 180));
  return Math.max(latSpan, lonSpan);
}

function calculateCaptureCamera(target = {}) {
  const captureType = normalizeCaptureType(target.capture_type || target.type);
  const bounds = normalizeBounds(target.bounds);
  const center = normalizePoint(target.center) || centerFromBounds(bounds);
  if (!captureType || !center) return null;
  const spanKm = boundsSpanKm(bounds);
  const contextKm = finiteNumber(target.recommended_context_radius_km);
  const presets = {
    REGIONAL_OVERVIEW_3D: { scene_mode: "3d", min: 1200000, max: 8500000, factor: 2.6, pitch: -55 },
    TACTICAL_OVERVIEW_2D: { scene_mode: "2d", min: 500000, max: 6500000, factor: 2.25, pitch: -90 },
    MAJOR_DEVELOPMENT_CONTEXT: { scene_mode: "3d", min: 260000, max: 1300000, factor: 2.1, pitch: -58 },
    CLUSTER_CONTEXT: { scene_mode: "3d", min: 360000, max: 1800000, factor: 2.25, pitch: -58 },
    HVA_FOCUS_3D: { scene_mode: "3d", min: 24000, max: 70000, factor: 1, pitch: -28 },
    HVA_REGIONAL_CONTEXT: { scene_mode: "3d", min: 140000, max: 450000, factor: 1.6, pitch: -50 },
    NAVAL_FOCUS: { scene_mode: "3d", min: 45000, max: 90000, factor: 1, pitch: -58 },
    AOI_CONTEXT: { scene_mode: "2d", min: 300000, max: 6000000, factor: 2.35, pitch: -90 },
    ORBITAL_CONTEXT: { scene_mode: "3d", min: 2200000, max: 10000000, factor: 2.8, pitch: -62 },
  };
  const preset = presets[captureType];
  const geometryRange = Math.max(spanKm * 1000 * preset.factor, Number(contextKm || 0) * 1000 * 1.5);
  const range = clamp(geometryRange || preset.min, preset.min, preset.max);
  return {
    scene_mode: preset.scene_mode,
    center,
    bounds,
    heading_degrees: captureType === "HVA_FOCUS_3D"
      // HeadingPitchRange describes the camera's look direction. Reverse the
      // aircraft heading, then bias 40 degrees to one side for a front-quarter view.
      ? ((finiteNumber(target.asset_heading_deg) ?? 0) + 140) % 360
      : captureType === "NAVAL_FOCUS"
        ? ((finiteNumber(target.asset_heading_deg) ?? 0) + 30) % 360
      : captureType === "HVA_REGIONAL_CONTEXT"
        ? ((finiteNumber(target.asset_heading_deg) ?? 0) + 345) % 360
        : 20,
    pitch_degrees: preset.pitch,
    roll_degrees: 0,
    range_meters: Math.round(range),
  };
}

function classifySnapshotAssetModelFamily(asset = {}) {
  const trackType = cleanText(asset.track_type, "aircraft").toLowerCase();
  const text = [asset.type, asset.variant, asset.name, asset.role, asset.callsign]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (trackType === "naval") {
    if (/\b(?:aircraft[_ -]?carrier|carrier|cvn[- ]?\d+)\b/.test(text)) return "CARRIER";
    if (/\b(?:amphibious|lhd|lha)\b/.test(text)) return "AMPHIBIOUS";
    if (/\b(?:command ship|intelligence|isr)\b/.test(text)) return "NAVAL_ISR";
    return "NAVAL";
  }
  if (/\b(?:e[- ]?3|sentry)\b/.test(text)) return "AWACS-E3";
  if (/\b(?:e[- ]?7|wedgetail|737 aew)\b/.test(text)) return "AWACS-E7";
  if (/\b(?:rc[- ]?135|rivet joint|cobra ball|combat sent)\b/.test(text)) return "ISR-RC135";
  if (/\b(?:p[- ]?8|poseidon)\b/.test(text)) return "ISR-P8";
  if (/\b(?:awacs|aew|airborne[_ -]?early[_ -]?warning)\b/.test(text)) return "AWACS";
  if (/\b(?:recon|isr|surveillance)\b/.test(text)) return "ISR";
  return "AIRCRAFT";
}

function buildSnapshotAssetRenderInput(asset = {}) {
  const latitude = asset.latitude === null || asset.latitude === undefined || asset.latitude === "" ? null : finiteNumber(asset.latitude);
  const longitude = asset.longitude === null || asset.longitude === undefined || asset.longitude === "" ? null : finiteNumber(asset.longitude);
  if (!cleanText(asset.asset_id)) return { valid: false, reason: "asset_id_unavailable" };
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { valid: false, reason: "invalid_asset_coordinates" };
  }
  const trackType = cleanText(asset.track_type, "aircraft").toLowerCase() === "naval" ? "naval" : "aircraft";
  const heading = finiteNumber(asset.heading_deg);
  const headingDegrees = heading === null ? 0 : ((heading % 360) + 360) % 360;
  const common = {
    track_key: cleanText(asset.asset_id),
    title: cleanText(asset.name || asset.callsign || asset.asset_id),
    category: "military",
    subcategory: cleanText(asset.role, trackType === "naval" ? "naval" : "military"),
    lat: latitude,
    lon: longitude,
    speed_kts: finiteNumber(asset.speed_kts),
    heading_deg: headingDegrees,
    country: cleanText(asset.country),
    operator: cleanText(asset.operator),
    status: cleanText(asset.status, "active"),
    updated_at: cleanText(asset.last_observed),
    __reportSnapshotAsset: true,
  };
  const event = trackType === "naval" ? {
    ...common,
    id: common.track_key,
    source_key: common.track_key,
    dedupe_key: common.track_key,
    occurred_at: common.updated_at,
    metadata: {
      track_key: common.track_key,
      vessel_name: cleanText(asset.name),
      vessel_class: cleanText(asset.variant || asset.role),
      ship_type: cleanText(asset.type),
      operator: common.operator,
      country: common.country,
      lat: latitude,
      lon: longitude,
      speed_kts: common.speed_kts,
      heading_deg: headingDegrees,
    },
  } : {
    ...common,
    altitude_ft: finiteNumber(asset.altitude_ft),
    render_mode: "model",
    model_render_mode: "model",
    metadata: {
      callsign: cleanText(asset.callsign),
      type_code: cleanText(asset.type),
      model_name: cleanText(asset.variant),
      role: cleanText(asset.role),
      operator: common.operator,
      squawk: cleanText(asset.squawk),
    },
  };
  return {
    valid: true,
    track_type: trackType,
    track_key: common.track_key,
    position: { latitude, longitude, altitude_ft: finiteNumber(asset.altitude_ft) },
    heading_degrees: headingDegrees,
    expected_model_family: classifySnapshotAssetModelFamily(asset),
    event,
  };
}

function buildReportAssetFocusPreset(captureType = "", camera = {}) {
  const type = normalizeCaptureType(captureType);
  const regional = type === "HVA_REGIONAL_CONTEXT";
  return {
    capture_type: type,
    mode: regional ? "REGIONAL" : "FOCUS",
    map_mode: type === "HVA_FOCUS_3D" || type === "HVA_REGIONAL_CONTEXT" ? "CTR" : "DEFAULT",
    heading_degrees: finiteNumber(camera.heading_degrees) ?? 30,
    pitch_degrees: finiteNumber(camera.pitch_degrees) ?? (regional ? -50 : type === "HVA_FOCUS_3D" ? -28 : -58),
    range_meters: finiteNumber(camera.range_meters) ?? (regional ? 140000 : 24000),
    minimum_visual_pixels: regional ? 96 : 180,
    safe_viewport_margin_pixels: regional ? 36 : 52,
  };
}

function sanitizeDevelopment(item = {}) {
  return {
    event_id: item.event_id,
    report_item_id: item.report_item_id,
    title: item.display_title || item.title,
    summary: item.display_summary || item.summary,
    occurred_at: item.occurred_at,
    domain: item.domain,
    category: item.category,
    severity: item.severity,
    confidence: item.confidence,
    verification_state: item.verification_state,
    event_country: item.event_country,
    event_region: item.event_region,
    event_city: item.event_city,
    event_place: item.event_place,
    display_location: item.display_location,
    latitude: finiteNumber(item.latitude),
    longitude: finiteNumber(item.longitude),
    location_precision: item.location_precision,
    relevant_cluster_id: item.relevant_cluster_id,
  };
}

function assessCaptureSemanticQuality(captureType = "", evidence = {}) {
  const type = normalizeCaptureType(captureType);
  const requirements = {
    HVA_FOCUS_3D: ["asset_visible"],
    HVA_REGIONAL_CONTEXT: ["asset_visible", "meaningful_operational_layer_visible"],
    NAVAL_FOCUS: ["asset_visible"],
    MAJOR_DEVELOPMENT_CONTEXT: ["target_event_visible"],
    CLUSTER_CONTEXT: ["target_cluster_visible"],
    REGIONAL_OVERVIEW_3D: ["meaningful_operational_layer_visible"],
    TACTICAL_OVERVIEW_2D: ["meaningful_operational_layer_visible"],
    ORBITAL_CONTEXT: ["orbital_entity_visible"],
    AOI_CONTEXT: ["meaningful_operational_layer_visible"],
  }[type] || [];
  const missing = requirements.filter((key) => evidence[key] !== true);
  return {
    status: missing.length ? "FAILED" : "READY",
    required_checks: requirements,
    passed_checks: requirements.filter((key) => evidence[key] === true),
    failed_checks: missing,
    failure_reason: missing.length ? missing.map((key) => ({
      asset_visible: "asset_not_visible",
      target_event_visible: "event_marker_not_visible",
      target_cluster_visible: "cluster_not_visible",
      meaningful_operational_layer_visible: "operational_layer_empty",
      orbital_entity_visible: "orbital_entity_not_visible",
    }[key] || `missing_${key}`)).join(",") : null,
  };
}

function sanitizeAsset(asset = {}) {
  return {
    asset_id: asset.asset_id,
    track_type: asset.track_type,
    callsign: asset.callsign,
    name: asset.name,
    type: asset.type,
    variant: asset.variant,
    role: asset.role,
    operator: asset.operator,
    country: asset.country,
    latitude: finiteNumber(asset.latitude),
    longitude: finiteNumber(asset.longitude),
    altitude_ft: finiteNumber(asset.altitude_ft),
    speed_kts: finiteNumber(asset.speed_kts),
    heading_deg: finiteNumber(asset.heading_deg),
    squawk: asset.squawk,
    last_observed: asset.last_observed,
    status: asset.status,
    confidence: asset.confidence,
    theater: asset.theater,
    nearby_event_ids: asset.nearby_event_ids || [],
    nearby_cluster_ids: asset.nearby_cluster_ids || [],
  };
}

function buildCaptureClusterLabel(cluster = {}, developments = []) {
  const count = Math.max(1, Number(cluster.incident_count || cluster.actual_event_count || cluster.cluster_count || 1));
  const broadLocation = /^(?:europe|asia|africa|global|unspecified|unknown location)$/i.test(cleanText(cluster.location_label))
    || /\b(?:area|corridor|region|theater)\b/i.test(cleanText(cluster.location_label));
  const linked = developments.find((item) => item.relevant_cluster_id === cluster.cluster_id
    || (cluster.event_ids || []).includes(item.event_id));
  const linkedLocation = cleanText(linked?.display_location || linked?.event_place || linked?.event_city || linked?.location_label, "");
  const location = cleanText(broadLocation && linkedLocation ? linkedLocation : cluster.location_label, "Operational area").toUpperCase();
  const domain = cleanText(cluster.dominant_domain, "MIXED").replace(/_/g, " ").toUpperCase();
  return {
    count,
    location,
    domain,
    text: `${count} EVENT${count === 1 ? "" : "S"}\n${location}\n${domain}`,
  };
}

function buildCaptureScenePayload(snapshot = {}, captureId = "", options = {}) {
  const descriptors = buildCaptureDescriptors(snapshot, options);
  const target = descriptors.find((entry) => entry.capture_id === captureId);
  if (!target) return null;
  const { snapshotData, reportContent } = getSnapshotParts(snapshot);
  const asset = target.asset_id ? findAsset(reportContent, target.asset_id) : null;
  const camera = calculateCaptureCamera({ ...target, asset_heading_deg: asset?.heading_deg });
  if (!camera) return null;
  return {
    report_id: snapshot.snapshot_key,
    snapshot_key: snapshot.snapshot_key,
    report_date: snapshot.snapshot_date || snapshotData.report_date,
    scope: snapshotData.scope,
    target,
    camera,
    clusters: (snapshotData.cluster_summaries || []).map((cluster) => ({
      cluster_id: cluster.cluster_id,
      event_ids: cluster.event_ids || [],
      incident_count: cluster.incident_count,
      activity_score: cluster.activity_score,
      dominant_domain: cluster.dominant_domain,
      domain_distribution: cluster.domain_distribution,
      severity: cluster.severity,
      latest_activity: cluster.latest_activity,
      medoid: cluster.medoid,
      centroid: cluster.centroid,
      bounds: cluster.bounds,
      location_label: cluster.location_label,
      corroborated_count: cluster.corroborated_count,
      report_label: buildCaptureClusterLabel(cluster, reportContent.major_developments || []),
    })),
    developments: (reportContent.major_developments || []).map(sanitizeDevelopment),
    high_value_assets: (reportContent.high_value_assets?.selected_for_report || reportContent.high_value_assets?.all_qualified || []).map(sanitizeAsset),
    selected_asset: asset ? sanitizeAsset(asset) : null,
    orbital: {
      selected: target.capture_type === "ORBITAL_CONTEXT",
      satellite_observation_count: Number(snapshotData.overall_activity?.satellite_total || 0),
      satellite_event_id: target.satellite_event_id,
      disclaimer: "Orbital visualization is contextual and is distinct from satellite imagery evidence.",
    },
  };
}

function mergeCaptureResult(snapshot = {}, captureResult = {}) {
  const next = {
    ...snapshot,
    snapshot_data: { ...asObject(snapshot.snapshot_data) },
    report_manifest: { ...asObject(snapshot.report_manifest) },
  };
  const reportContent = { ...asObject(next.snapshot_data.report_content) };
  const existing = Array.isArray(next.report_manifest.capture_results) ? next.report_manifest.capture_results : [];
  const results = existing.filter((entry) => entry.capture_id !== captureResult.capture_id);
  results.push({ ...captureResult });
  results.sort((left, right) => cleanText(left.capture_id).localeCompare(cleanText(right.capture_id)));
  const ready = results.filter((entry) => entry.status === CAPTURE_STATUS.READY);
  next.report_manifest.capture_results = results;
  next.report_manifest.selected_images = ready;
  reportContent.capture_results = results;
  reportContent.selected_images = ready;
  reportContent.imagery_placeholders = {
    ...asObject(reportContent.imagery_placeholders),
    generated: ready,
    failed: results.filter((entry) => entry.status === CAPTURE_STATUS.FAILED),
  };
  next.snapshot_data.report_content = reportContent;
  next.snapshot_data.reserved = { ...asObject(next.snapshot_data.reserved), selected_images: ready };
  return next;
}

function buildInitialCaptureResults(descriptors = []) {
  return descriptors.map((descriptor) => ({
    capture_id: descriptor.capture_id,
    capture_type: descriptor.capture_type,
    status: CAPTURE_STATUS.PENDING,
    local_path: null,
    s3_key: descriptor.s3_key,
    width: null,
    height: null,
    format: null,
    generated_at: null,
    event_id: descriptor.event_id,
    cluster_id: descriptor.cluster_id,
    asset_id: descriptor.asset_id,
    camera: null,
    bounds: descriptor.bounds,
    center: descriptor.center,
    source_target: descriptor.source_target,
    failure_reason: null,
    semantic_quality: null,
  }));
}

function isCaptureCleanupEligible({ modifiedAt, now = Date.now(), retentionHours = 24 } = {}) {
  const modified = modifiedAt instanceof Date ? modifiedAt.getTime() : Date.parse(modifiedAt || "");
  if (!Number.isFinite(modified)) return false;
  return now - modified > clamp(retentionHours, 1, 24 * 30) * 3600000;
}

function buildCapturePageUrl(baseUrl = "", snapshotKey = "", captureId = "") {
  const base = cleanText(baseUrl).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) throw new Error("REPORTING_CAPTURE_BASE_URL must be an http(s) URL");
  const url = new URL(`${base}/report-capture`);
  url.searchParams.set("snapshot_key", snapshotKey);
  url.searchParams.set("capture_id", captureId);
  return url.toString();
}

export {
  CAPTURE_STATUS,
  assessCaptureSemanticQuality,
  buildReportAssetFocusPreset,
  buildCaptureDescriptors,
  buildCapturePageUrl,
  buildCaptureScenePayload,
  buildCaptureClusterLabel,
  buildInitialCaptureResults,
  buildReportImageDirectory,
  buildSnapshotAssetRenderInput,
  calculateCaptureCamera,
  classifySnapshotAssetModelFamily,
  isCaptureCleanupEligible,
  mergeCaptureResult,
  normalizeCaptureType,
  resolveCaptureTarget,
};
