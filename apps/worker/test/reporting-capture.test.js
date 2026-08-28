import test from "node:test";
import assert from "node:assert/strict";
import {
  CAPTURE_STATUS,
  HVA_FOCUS_CAPTURE_RANGE_MULTIPLIER,
  assessCaptureSemanticQuality,
  buildCaptureDescriptors,
  buildCaptureClusterLabel,
  buildCapturePageUrl,
  buildCaptureScenePayload,
  buildReportAssetFocusPreset,
  buildReportImageDirectory,
  buildSnapshotAssetRenderInput,
  calculateCaptureCamera,
  classifySnapshotAssetModelFamily,
  isCaptureCleanupEligible,
  mergeCaptureResult,
  resolveCaptureTarget,
} from "../../shared/reporting-capture.js";
import { __reportingCaptureTestUtils, generateSnapshotCaptures } from "../src/reporting-capture-service.js";
import { injectReportingDevHvaFixture } from "../../shared/reporting-dev-hva-fixture.js";

function snapshotFixture(overrides = {}) {
  const snapshot = {
    snapshot_key: "daily:2026-08-08:global:v1",
    snapshot_date: "2026-08-08",
    scope_type: "global",
    scope_key: "global",
    scope_value: null,
    scope_label: "Global",
    snapshot_data: {
      report_date: "2026-08-08",
      scope: { type: "global", key: "global", value: null, label: "Global" },
      overall_activity: { satellite_total: 2 },
      cluster_summaries: [
        {
          cluster_id: "cluster-gulf",
          event_ids: ["event-exact", "event-second"],
          incident_count: 4,
          activity_score: 12,
          dominant_domain: "MISSILE",
          domain_distribution: { MISSILE: 0.65, AIR_DEFENCE: 0.35 },
          severity: "critical",
          latest_activity: "2026-08-08T14:00:00.000Z",
          medoid: { latitude: 26.2, longitude: 50.1 },
          centroid: { latitude: 26.25, longitude: 50.15 },
          bounds: { west: 49.8, south: 25.9, east: 50.5, north: 26.6 },
          location_label: "Gulf corridor",
          corroborated_count: 3,
        },
        {
          cluster_id: "cluster-ukraine",
          event_ids: ["event-ukraine"],
          incident_count: 2,
          activity_score: 6,
          dominant_domain: "STRIKE",
          domain_distribution: { STRIKE: 1 },
          severity: "high",
          latest_activity: "2026-08-08T12:00:00.000Z",
          medoid: { latitude: 46.48, longitude: 30.72 },
          centroid: { latitude: 46.48, longitude: 30.72 },
          bounds: { west: 30.4, south: 46.2, east: 31, north: 46.8 },
          location_label: "Odesa area",
          corroborated_count: 1,
        },
      ],
      report_content: {
        major_developments: [
          {
            report_item_id: "event:event-exact",
            event_id: "event-exact",
            title: "Missile strike at Gulf port",
            summary: "Corroborated activity at a named facility.",
            occurred_at: "2026-08-08T14:00:00.000Z",
            domain: "MISSILE",
            category: "missile",
            severity: "critical",
            confidence: 91,
            verification_state: "CORROBORATED",
            event_country: "Bahrain",
            event_region: "Iran / Gulf",
            event_city: "Manama",
            event_place: "Gulf port",
            latitude: 26.2,
            longitude: 50.1,
            location_precision: "EXACT",
            relevant_cluster_id: "cluster-gulf",
            source_provenance: [{ secret: "must-not-leak" }],
          },
          {
            report_item_id: "intel:regional",
            event_id: "event-regional",
            title: "Activity in southern region",
            latitude: null,
            longitude: null,
            location_precision: "REGIONAL",
          },
        ],
        high_value_assets: {
          all_qualified: [
            {
              asset_id: "adsb-awacs",
              track_type: "aircraft",
              callsign: "MAGIC01",
              name: "E-3 Sentry",
              type: "E3",
              variant: "E-3 Sentry",
              role: "AIRBORNE_EARLY_WARNING",
              operator: "USAF",
              country: "United States",
              latitude: 26.5,
              longitude: 50.4,
              altitude_ft: 31000,
              speed_kts: 410,
              heading_deg: 92,
              last_observed: "2026-08-08T14:10:00.000Z",
              status: "active",
              confidence: 96,
              nearby_event_ids: ["event-exact"],
              nearby_cluster_ids: ["cluster-gulf"],
            },
            {
              asset_id: "ais-carrier",
              track_type: "naval",
              name: "Carrier CVN-76",
              type: "Aircraft carrier",
              role: "AIRCRAFT_CARRIER",
              latitude: 25.9,
              longitude: 50.7,
              speed_kts: 18,
              heading_deg: 40,
              status: "active",
              confidence: 94,
              nearby_cluster_ids: ["cluster-gulf"],
            },
          ],
        },
        imagery_placeholders: {},
      },
      reserved: { selected_images: [] },
    },
    report_manifest: {
      selected_images: [],
      selected_capture_targets: [
        { type: "OPERATIONAL_OVERVIEW", priority: 100, cluster_id: "cluster-gulf", location: { latitude: 26.2, longitude: 50.1 }, bounds: { west: 49.8, south: 25.9, east: 50.5, north: 26.6 } },
        { type: "TACTICAL_OVERVIEW_2D", priority: 99, cluster_id: "cluster-gulf" },
        { type: "MAJOR_DEVELOPMENT", priority: 95, event_id: "event-exact", cluster_id: "cluster-gulf", location: { latitude: 26.2, longitude: 50.1 } },
        { type: "MAJOR_DEVELOPMENT", priority: 94, event_id: "event-regional" },
        { type: "CLUSTER_CONTEXT", priority: 90, cluster_id: "cluster-ukraine" },
        { type: "HVA_FOCUS_3D", priority: 88, asset_id: "adsb-awacs", location: { latitude: 26.5, longitude: 50.4 } },
        { type: "NAVAL_ASSET_FOCUS", priority: 86, asset_id: "ais-carrier", location: { latitude: 25.9, longitude: 50.7 } },
        { type: "AOI_CONTEXT", priority: 82, bounds: [49, 25, 52, 28] },
        { type: "ORBITAL_CONTEXT", priority: 80, satellite_event_id: "event-exact" },
      ],
      capture_requirements: [
        { type: "HVA_REGIONAL_CONTEXT", asset_id: "adsb-awacs", latitude: 26.5, longitude: 50.4, recommended_context_radius_km: 700, related_cluster_ids: ["cluster-gulf"] },
      ],
    },
  };
  return { ...snapshot, ...overrides };
}

function configFixture(overrides = {}) {
  return {
    s3Prefix: "reports",
    aws: { bucket: "" },
    capture: {
      enabled: true,
      baseUrl: "http://127.0.0.1:4173",
      width: 1600,
      height: 900,
      format: "jpeg",
      quality: 88,
      timeoutMs: 45000,
      retentionHours: 24,
      maxImages: 8,
      retries: 1,
      token: "test-capture-token",
      browserExecutablePath: "",
      ...overrides,
    },
  };
}

test("capture targets produce deterministic filenames, local directories and S3 keys", () => {
  const descriptors = buildCaptureDescriptors(snapshotFixture(), { maxImages: 24, s3Prefix: "reports", format: "jpeg" });
  assert.equal(descriptors.find((item) => item.capture_type === "REGIONAL_OVERVIEW_3D").filename, "operational-overview-3d.jpg");
  assert.equal(descriptors.find((item) => item.capture_type === "TACTICAL_OVERVIEW_2D").filename, "tactical-overview-2d.jpg");
  assert.equal(descriptors.find((item) => item.capture_type === "MAJOR_DEVELOPMENT_CONTEXT").filename, "development-01-context.jpg");
  assert.equal(descriptors.find((item) => item.capture_type === "HVA_FOCUS_3D").filename, "hva-01-focus-3d.jpg");
  assert.equal(descriptors.find((item) => item.capture_type === "HVA_REGIONAL_CONTEXT").filename, "hva-01-regional.jpg");
  assert.ok(descriptors.every((item) => item.relative_path.startsWith("daily/global/2026-08-08/images/")));
  assert.ok(descriptors.every((item) => item.s3_key.startsWith("reports/daily/global/2026-08-08/images/")));
  assert.equal(descriptors.some((item) => item.event_id === "event-regional"), false);
});

test("operational imagery targets are accepted directly when manifest mirrors are unavailable", () => {
  const snapshot = snapshotFixture();
  snapshot.snapshot_data.report_content.operational_imagery_targets = [{
    type: "MAJOR_DEVELOPMENT_CONTEXT",
    event_id: "event-exact",
    location: { latitude: 26.2, longitude: 50.1 },
  }];
  snapshot.report_manifest.selected_capture_targets = [];
  snapshot.report_manifest.capture_requirements = [];
  const descriptors = buildCaptureDescriptors(snapshot, { maxImages: 8, format: "jpeg" });
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].event_id, "event-exact");
  assert.equal(descriptors[0].filename, "development-01-context.jpg");
});

test("global, region, country and AOI report image paths are safe and deterministic", () => {
  assert.equal(buildReportImageDirectory(snapshotFixture()), "daily/global/2026-08-08/images");
  for (const [type, value, expected] of [
    ["region", "Iran / Gulf", "daily/region/iran-gulf/2026-08-08/images"],
    ["country", "Saudi Arabia", "daily/country/saudi-arabia/2026-08-08/images"],
    ["aoi", "Red Sea North", "daily/aoi/red-sea-north/2026-08-08/images"],
  ]) {
    const snapshot = snapshotFixture({
      scope_type: type,
      scope_value: value,
      snapshot_data: { ...snapshotFixture().snapshot_data, scope: { type, value, label: value } },
    });
    assert.equal(buildReportImageDirectory(snapshot), expected);
  }
});

test("camera framing is deterministic for bounds, exact events and HVA targets", () => {
  const cluster = calculateCaptureCamera({
    capture_type: "CLUSTER_CONTEXT",
    center: { latitude: 46.48, longitude: 30.72 },
    bounds: { west: 30.4, south: 46.2, east: 31, north: 46.8 },
  });
  const event = calculateCaptureCamera({ capture_type: "MAJOR_DEVELOPMENT_CONTEXT", center: { latitude: 26.2, longitude: 50.1 } });
  const hva = calculateCaptureCamera({ capture_type: "HVA_FOCUS_3D", center: { latitude: 26.5, longitude: 50.4 }, asset_heading_deg: 92 });
  assert.equal(cluster.scene_mode, "3d");
  assert.ok(cluster.range_meters >= 360000);
  assert.deepEqual(event.center, { latitude: 26.2, longitude: 50.1 });
  assert.equal(hva.heading_degrees, 232);
  assert.equal(hva.pitch_degrees, -28);
  assert.equal(HVA_FOCUS_CAPTURE_RANGE_MULTIPLIER, 0.8);
  assert.equal(hva.range_meters, 19200);
});

test("frozen E-3, E-7 and naval snapshots build deterministic live-render inputs without a realtime track", () => {
  const base = {
    asset_id: "frozen-awacs",
    track_type: "aircraft",
    latitude: 26.5,
    longitude: 50.4,
    altitude_ft: 31000,
    speed_kts: 410,
    heading_deg: 452,
    role: "AIRBORNE_EARLY_WARNING",
  };
  const e3 = buildSnapshotAssetRenderInput({ ...base, type: "E-3", variant: "E-3 Sentry" });
  const e7 = buildSnapshotAssetRenderInput({ ...base, asset_id: "frozen-e7", type: "E-7", variant: "E-7 Wedgetail" });
  const carrier = buildSnapshotAssetRenderInput({ ...base, asset_id: "frozen-carrier", track_type: "naval", type: "Aircraft carrier", role: "AIRCRAFT_CARRIER", altitude_ft: null });
  assert.equal(e3.valid, true);
  assert.equal(e3.expected_model_family, "AWACS-E3");
  assert.equal(e7.expected_model_family, "AWACS-E7");
  assert.equal(e3.heading_degrees, 92);
  assert.equal(e3.event.metadata.type_code, "E-3");
  assert.equal(e7.event.metadata.model_name, "E-7 Wedgetail");
  assert.equal(carrier.track_type, "naval");
  assert.equal(carrier.expected_model_family, "CARRIER");
  assert.equal(carrier.event.dedupe_key, "frozen-carrier");
  assert.equal(classifySnapshotAssetModelFamily({ type: "RC-135 Rivet Joint" }), "ISR-RC135");
  assert.equal(classifySnapshotAssetModelFamily({ type: "P-8 Poseidon" }), "ISR-P8");
  assert.equal(buildSnapshotAssetRenderInput({ ...base, latitude: null }).reason, "invalid_asset_coordinates");
});

test("focus and regional HVA presets use distinct heading, pitch, range and visibility thresholds", () => {
  const focusCamera = calculateCaptureCamera({ capture_type: "HVA_FOCUS_3D", center: { latitude: 26.5, longitude: 50.4 }, asset_heading_deg: 92, recommended_context_radius_km: 350 });
  const regionalCamera = calculateCaptureCamera({ capture_type: "HVA_REGIONAL_CONTEXT", center: { latitude: 26.5, longitude: 50.4 }, asset_heading_deg: 92, recommended_context_radius_km: 700 });
  const focus = buildReportAssetFocusPreset("HVA_FOCUS_3D", focusCamera);
  const regional = buildReportAssetFocusPreset("HVA_REGIONAL_CONTEXT", regionalCamera);
  assert.equal(focus.mode, "FOCUS");
  assert.equal(focus.map_mode, "CTR");
  assert.equal(focus.range_meters, 56000);
  assert.equal(regional.mode, "REGIONAL");
  assert.equal(regional.map_mode, "CTR");
  assert.equal(regional.range_meters, 450000);
  assert.notEqual(focus.heading_degrees, regional.heading_degrees);
  assert.notEqual(focus.pitch_degrees, regional.pitch_degrees);
  assert.ok(regional.range_meters > focus.range_meters * 2);
  assert.ok(focus.minimum_visual_pixels > regional.minimum_visual_pixels);
  for (const heading of [0, 92, 180, 315]) {
    const camera = calculateCaptureCamera({
      capture_type: "HVA_FOCUS_3D",
      center: { latitude: 26.5, longitude: 50.4 },
      asset_heading_deg: heading,
    });
    assert.equal(camera.heading_degrees, (heading + 140) % 360);
  }
});

test("regional and unknown developments never become fake point captures", () => {
  const snapshot = snapshotFixture();
  assert.equal(resolveCaptureTarget(snapshot, { type: "MAJOR_DEVELOPMENT", event_id: "event-regional" }).safe, false);
  assert.equal(resolveCaptureTarget(snapshot, { type: "MAJOR_DEVELOPMENT", event_id: "missing", location: { latitude: 1, longitude: 2 } }).safe, false);
});

test("capture scene payload is sanitized and traceable", () => {
  const snapshot = snapshotFixture();
  const descriptor = buildCaptureDescriptors(snapshot, { maxImages: 24 })
    .find((item) => item.capture_type === "MAJOR_DEVELOPMENT_CONTEXT");
  const payload = buildCaptureScenePayload(snapshot, descriptor.capture_id, { maxImages: 24 });
  assert.equal(payload.target.event_id, "event-exact");
  assert.equal(payload.camera.center.latitude, 26.2);
  assert.equal(payload.clusters[0].event_ids.includes("event-exact"), true);
  assert.deepEqual(payload.clusters[0].report_label, {
    count: 4,
    location: "GULF PORT",
    domain: "MISSILE",
    text: "4 EVENTS\nGULF PORT\nMISSILE",
  });
  assert.equal(JSON.stringify(payload).includes("must-not-leak"), false);
  assert.equal(buildCapturePageUrl("http://127.0.0.1:4173/", snapshot.snapshot_key, descriptor.capture_id).includes("test-capture-token"), false);
});

test("capture semantic quality rejects terrain-only HVA and empty operational scenes", () => {
  assert.deepEqual(buildCaptureClusterLabel({ incident_count: 14, location_label: "South Lebanon", dominant_domain: "STRIKE" }), {
    count: 14,
    location: "SOUTH LEBANON",
    domain: "STRIKE",
    text: "14 EVENTS\nSOUTH LEBANON\nSTRIKE",
  });
  const hvaFailure = assessCaptureSemanticQuality("HVA_FOCUS_3D", { asset_visible: false });
  assert.equal(hvaFailure.status, "FAILED");
  assert.equal(hvaFailure.failure_reason, "asset_not_visible");
  const overviewFailure = assessCaptureSemanticQuality("REGIONAL_OVERVIEW_3D", { meaningful_operational_layer_visible: false });
  assert.equal(overviewFailure.failure_reason, "operational_layer_empty");
  assert.equal(assessCaptureSemanticQuality("CLUSTER_CONTEXT", { target_cluster_visible: true }).status, "READY");
  const fixtureRegional = assessCaptureSemanticQuality("HVA_REGIONAL_CONTEXT", { asset_visible: true, dev_fixture: true });
  assert.equal(fixtureRegional.status, "READY");
  assert.deepEqual(fixtureRegional.required_checks, ["asset_visible"]);
  assert.equal(assessCaptureSemanticQuality("HVA_REGIONAL_CONTEXT", { asset_visible: true }).failure_reason, "operational_layer_empty");
});

test("capture service accepts READY only with matching semantic-quality evidence", () => {
  const descriptor = { capture_type: "HVA_FOCUS_3D" };
  assert.throws(() => __reportingCaptureTestUtils.validateSemanticCaptureState(descriptor, {
    status: "READY",
    capture_type: "HVA_FOCUS_3D",
    semantic_quality: { status: "FAILED", failure_reason: "asset_not_visible" },
  }), /asset_not_visible/);
  assert.equal(__reportingCaptureTestUtils.validateSemanticCaptureState(descriptor, {
    status: "READY",
    capture_type: "HVA_FOCUS_3D",
    semantic_quality: { status: "READY" },
  }), true);
});

test("real page capture cleans up the report-only entity after the screenshot", async () => {
  let evaluateCount = 0;
  let screenshotTaken = false;
  const page = {
    async goto() {},
    async waitForFunction() {},
    async evaluate() {
      evaluateCount += 1;
      if (evaluateCount === 1) return {
        status: "READY",
        capture_type: "HVA_FOCUS_3D",
        semantic_quality: { status: "READY" },
        asset_focus_debug: { model_uri: "/assets/models/AWACS-E3.glb" },
      };
      return { completed: true, entity_id: "track-frozen-awacs", entity_removed: true };
    },
    async screenshot() {
      screenshotTaken = true;
      return Buffer.from("image");
    },
  };
  const result = await __reportingCaptureTestUtils.captureTargetPage({
    page,
    snapshot: snapshotFixture(),
    descriptor: { capture_type: "HVA_FOCUS_3D", capture_id: "capture-hva" },
    config: configFixture(),
  });
  assert.equal(screenshotTaken, true);
  assert.equal(result.captureState.asset_cleanup.completed, true);
  assert.equal(result.captureState.asset_cleanup.entity_removed, true);
  assert.equal(evaluateCount, 2);
});

test("manifest updates preserve target traceability and separate ready from failed images", () => {
  let snapshot = snapshotFixture();
  snapshot = mergeCaptureResult(snapshot, { capture_id: "capture-01", capture_type: "REGIONAL_OVERVIEW_3D", status: CAPTURE_STATUS.READY, event_id: null, cluster_id: "cluster-gulf", asset_id: null });
  snapshot = mergeCaptureResult(snapshot, { capture_id: "capture-02", capture_type: "HVA_FOCUS_3D", status: CAPTURE_STATUS.FAILED, asset_id: "adsb-awacs", failure_reason: "timeout" });
  assert.equal(snapshot.report_manifest.capture_results.length, 2);
  assert.equal(snapshot.report_manifest.selected_images.length, 1);
  assert.equal(snapshot.snapshot_data.report_content.selected_images[0].capture_id, "capture-01");
  assert.equal(snapshot.snapshot_data.report_content.imagery_placeholders.failed[0].failure_reason, "timeout");
});

test("capture cap is respected and PNG configuration changes deterministic extension", () => {
  const jpeg = buildCaptureDescriptors(snapshotFixture(), { maxImages: 4, format: "jpeg" });
  const png = buildCaptureDescriptors(snapshotFixture(), { maxImages: 4, format: "png" });
  assert.equal(jpeg.length, 4);
  assert.equal(png.length, 4);
  assert.ok(png.every((item) => item.filename.endsWith(".png")));
});

test("cleanup eligibility removes only files older than configured retention", () => {
  const now = Date.parse("2026-08-10T12:00:00.000Z");
  assert.equal(isCaptureCleanupEligible({ modifiedAt: "2026-08-09T11:59:00.000Z", now, retentionHours: 24 }), true);
  assert.equal(isCaptureCleanupEligible({ modifiedAt: "2026-08-09T12:01:00.000Z", now, retentionHours: 24 }), false);
});

function makeSupabase(snapshot) {
  let stored = structuredClone(snapshot);
  return {
    get stored() { return stored; },
    from(table) {
      assert.equal(table, "operational_report_snapshots");
      return {
        select() {
          return {
            eq() {
              return { async maybeSingle() { return { data: structuredClone(stored), error: null }; } };
            },
          };
        },
        update(payload) {
          stored = { ...stored, ...structuredClone(payload) };
          return {
            eq() {
              return {
                select() {
                  return { async maybeSingle() { return { data: structuredClone(stored), error: null }; } };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("capture orchestration retries transient failures and continues after a failed target", async () => {
  const snapshot = snapshotFixture();
  snapshot.report_manifest.selected_capture_targets = snapshot.report_manifest.selected_capture_targets.slice(0, 3);
  snapshot.report_manifest.capture_requirements = [];
  const supabase = makeSupabase(snapshot);
  const attempts = new Map();
  let contextClosed = false;
  let browserClosed = false;
  let captureRoutePattern = "";
  let browserContextOptions = null;
  const result = await generateSnapshotCaptures({
    supabase,
    snapshotKey: snapshot.snapshot_key,
    config: configFixture({ maxImages: 3, retries: 1 }),
    launchBrowser: async () => ({
      async newContext(options) {
        browserContextOptions = options;
        return {
          async route(pattern) { captureRoutePattern = pattern; },
          async newPage() { return {}; },
          async close() { contextClosed = true; },
        };
      },
      async close() { browserClosed = true; },
    }),
    capturePage: async ({ descriptor }) => {
      const attempt = (attempts.get(descriptor.capture_id) || 0) + 1;
      attempts.set(descriptor.capture_id, attempt);
      if (descriptor.capture_type === "REGIONAL_OVERVIEW_3D" && attempt === 1) throw new Error("temporary scene timeout");
      if (descriptor.capture_type === "TACTICAL_OVERVIEW_2D") throw new Error("persistent render failure");
      return { screenshot: Buffer.from("image"), captureState: { camera: { actual: true }, cluster_snapshot: { clusters: [] } } };
    },
    storeImage: async ({ descriptor }) => ({ localPath: `C:/captures/${descriptor.filename}`, upload: null }),
    logger: { warn() {} },
  });
  assert.equal(result.ready, 2);
  assert.equal(result.failed, 1);
  assert.equal(attempts.get(result.results.find((entry) => entry.capture_type === "REGIONAL_OVERVIEW_3D").capture_id), 2);
  assert.equal(attempts.get(result.results.find((entry) => entry.capture_type === "TACTICAL_OVERVIEW_2D").capture_id), 2);
  assert.equal(supabase.stored.report_manifest.selected_images.length, 2);
  assert.equal(contextClosed, true);
  assert.equal(browserClosed, true);
  assert.equal(captureRoutePattern, "**/stratops/reports/internal/capture/**");
  assert.equal(browserContextOptions.extraHTTPHeaders, undefined);
});

test("snapshot-only operation does not launch capture while capture is disabled", async () => {
  let touchedSupabase = false;
  const result = await generateSnapshotCaptures({
    supabase: { from() { touchedSupabase = true; } },
    snapshotKey: "daily:2026-08-08:global:v1",
    config: configFixture({ enabled: false }),
  });
  assert.deepEqual(result, { ok: true, skipped: true, reason: "capture_disabled" });
  assert.equal(touchedSupabase, false);
});

test("transient dev HVA capture uses the in-memory snapshot without Supabase or S3", async () => {
  const snapshot = injectReportingDevHvaFixture(snapshotFixture());
  const savedSnapshots = [];
  let routedHandler = null;
  let uploaded = false;
  const result = await generateSnapshotCaptures({
    supabase: { from() { throw new Error("Supabase must not be touched"); } },
    snapshotKey: snapshot.snapshot_key,
    snapshotOverride: snapshot,
    persistSnapshot: async (nextSnapshot) => {
      savedSnapshots.push(nextSnapshot);
      return nextSnapshot;
    },
    config: configFixture({ maxImages: 2, retries: 0, token: "" }),
    force: true,
    launchBrowser: async () => ({
      async newContext() {
        return {
          async route(_pattern, handler) { routedHandler = handler; },
          async newPage() { return {}; },
          async close() {},
        };
      },
      async close() {},
    }),
    capturePage: async ({ descriptor }) => ({
      screenshot: Buffer.from("fixture-image"),
      captureState: {
        camera: { scene_mode: "3d" },
        semantic_quality: { status: "READY", asset_visible: true },
        asset_focus_debug: { expected_model_family: "AWACS-E4" },
      },
    }),
    uploadObject: async () => { uploaded = true; },
    storeImage: async ({ descriptor, config }) => {
      assert.equal(config.aws.bucket, "");
      return { localPath: `C:/captures/${descriptor.filename}`, upload: null };
    },
  });
  assert.equal(typeof routedHandler, "function");
  assert.equal(uploaded, false);
  assert.equal(result.ready, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(result.results.map((entry) => entry.capture_type).sort(), ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT"]);
  assert.ok(savedSnapshots.length >= 3);
  assert.equal(result.snapshot.snapshot_data.dev_fixture.asset_id, "dev-hva-usaf-e4b-001");
});
