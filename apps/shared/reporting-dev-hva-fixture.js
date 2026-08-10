const DEV_HVA_ASSET_ID = "dev-hva-usaf-e4b-001";

function cleanDateKey(value = "") {
  const dateKey = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("A valid report date is required for the dev HVA fixture");
  return dateKey;
}

function deriveFixtureObservationWindow({ dateKey, windowStart, windowEnd } = {}) {
  const safeDateKey = cleanDateKey(dateKey);
  const start = Date.parse(windowStart || `${safeDateKey}T00:00:00.000Z`);
  const end = Date.parse(windowEnd || `${safeDateKey}T23:59:59.999Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("The report window is invalid for the dev HVA fixture");
  }
  const last = start + Math.floor((end - start) * 0.625);
  const first = Math.max(start, last - 45 * 60 * 1000);
  return {
    first_observed: new Date(first).toISOString(),
    last_observed: new Date(last).toISOString(),
  };
}

function createReportingDevHvaFixture({ dateKey, windowStart, windowEnd } = {}) {
  const observation = deriveFixtureObservationWindow({ dateKey, windowStart, windowEnd });
  return {
    asset_id: DEV_HVA_ASSET_ID,
    track_type: "aircraft",
    callsign: "ORDER01",
    name: "US E-4B NIGHTWATCH",
    display_title: "US E-4B NIGHTWATCH - ORDER01",
    type: "E-4B",
    variant: "E-4B Nightwatch",
    role: "AIRBORNE_COMMAND_POST",
    operator: "United States Air Force",
    country: "United States",
    latitude: 38.85,
    longitude: -77.04,
    altitude_ft: 28000,
    speed_kts: 410,
    heading_deg: 225,
    squawk: null,
    status: "DEV FIXTURE",
    confidence: 98,
    priority_score: 99,
    first_observed: observation.first_observed,
    last_observed: observation.last_observed,
    duration_minutes: 45,
    observation_count: 4,
    theater: null,
    nearby_event_ids: [],
    nearby_cluster_ids: [],
    nearest_activity_km: null,
    operational_significance: "Development-only E-4B report capture fixture. This is not real-world intelligence.",
    qualification_reasons: ["dev_test", "forced_final_report_selection", "snapshot_capture_validation"],
    observation_context: "DEV REPORT CAPTURE FIXTURE",
    model_code: "AWACS-E4",
    is_dev_fixture: true,
  };
}

function createFixtureCaptureRequirements(asset) {
  return [
    {
      type: "HVA_FOCUS_3D",
      priority: 99,
      asset_id: asset.asset_id,
      latitude: asset.latitude,
      longitude: asset.longitude,
      recommended_context_radius_km: 350,
      recommended_camera_mode: "3D_TRACK_FOCUS",
      reason: "Development-only E-4B focus capture fixture",
      is_dev_fixture: true,
    },
    {
      type: "HVA_REGIONAL_CONTEXT",
      priority: 98,
      asset_id: asset.asset_id,
      latitude: asset.latitude,
      longitude: asset.longitude,
      related_cluster_ids: [],
      recommended_context_radius_km: 700,
      recommended_camera_mode: "REGIONAL_2D_OR_3D",
      reason: "Development-only E-4B regional capture fixture",
      is_dev_fixture: true,
    },
  ];
}

function injectReportingDevHvaFixture(snapshot = {}) {
  const next = structuredClone(snapshot);
  const snapshotData = next.snapshot_data || {};
  const reportContent = snapshotData.report_content || {};
  const highValueAssets = reportContent.high_value_assets || {};
  const dateKey = next.snapshot_date || snapshotData.report_date;
  const asset = createReportingDevHvaFixture({
    dateKey,
    windowStart: next.window_start || snapshotData.window?.start,
    windowEnd: next.window_end || snapshotData.window?.end,
  });
  const withoutFixture = (items = []) => (Array.isArray(items) ? items : []).filter((item) => item?.asset_id !== DEV_HVA_ASSET_ID);
  const selected = [asset, ...withoutFixture(highValueAssets.selected_for_report)];
  const qualified = withoutFixture(highValueAssets.all_qualified);
  const captureRequirements = [
    ...createFixtureCaptureRequirements(asset),
    ...(Array.isArray(highValueAssets.capture_requirements) ? highValueAssets.capture_requirements : [])
      .filter((item) => item?.asset_id !== DEV_HVA_ASSET_ID),
  ];
  reportContent.high_value_assets = {
    ...highValueAssets,
    primary: asset,
    secondary: selected.slice(1),
    all_qualified: qualified,
    selected_for_report: selected,
    capture_requirements: captureRequirements,
  };
  reportContent.operational_imagery_targets = [
    ...createFixtureCaptureRequirements(asset),
    ...(Array.isArray(reportContent.operational_imagery_targets) ? reportContent.operational_imagery_targets : [])
      .filter((item) => item?.asset_id !== DEV_HVA_ASSET_ID),
  ];
  reportContent.methodology_metrics = {
    ...(reportContent.methodology_metrics || {}),
    qualified_hva_total: qualified.length,
    selected_hva_total: selected.length,
  };
  snapshotData.overall_activity = {
    ...(snapshotData.overall_activity || {}),
    high_value_asset_candidate_total: qualified.length,
    high_value_asset_selected_total: selected.length,
  };
  snapshotData.selections = {
    ...(snapshotData.selections || {}),
    high_value_asset_candidates: qualified,
    high_value_assets: selected,
  };
  snapshotData.report_content = reportContent;
  snapshotData.dev_fixture = {
    enabled: true,
    kind: "E-4B_HVA_CAPTURE",
    asset_id: DEV_HVA_ASSET_ID,
    is_dev_fixture: true,
  };
  next.snapshot_data = snapshotData;
  next.report_manifest = {
    ...(next.report_manifest || {}),
    selected_hva: selected.map((item) => item.asset_id).filter(Boolean),
    selected_capture_targets: reportContent.operational_imagery_targets,
    capture_requirements: captureRequirements,
    capture_results: [],
    selected_images: [],
    dev_fixture: snapshotData.dev_fixture,
  };
  return next;
}

function isClearlyProductionRuntime(environment = process.env) {
  return [
    environment.NODE_ENV,
    environment.APP_ENV,
    environment.ENVIRONMENT,
    environment.VERCEL_ENV,
    environment.CONTEXT,
  ].some((value) => String(value || "").trim().toLowerCase() === "production");
}

function assertReportingDevHvaFixtureAllowed({ config = {}, localOnly = false, scheduled = false, environment = process.env } = {}) {
  if (!localOnly) throw new Error("--dev-hva-fixture requires --local-only");
  if (scheduled || config.scheduleEnabled === true) {
    throw new Error("--dev-hva-fixture is disabled while reporting scheduling is enabled");
  }
  if (isClearlyProductionRuntime(environment)) {
    throw new Error("--dev-hva-fixture is disabled in production environments");
  }
  return true;
}

export {
  DEV_HVA_ASSET_ID,
  assertReportingDevHvaFixtureAllowed,
  createFixtureCaptureRequirements,
  createReportingDevHvaFixture,
  deriveFixtureObservationWindow,
  injectReportingDevHvaFixture,
  isClearlyProductionRuntime,
};
