import "../css/style.css";
import "../css/report-capture.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { initWarzoneGlobe } from "./warzone-globe.js";
import { setLayer } from "./warzone-layers.js";

window.__stratopsReportCaptureMode = true;
window.__stratopsConfig = {
    apiBase: "/api",
    enableMilSatsLayer: true,
    startupMilSatsDemo: false,
    useAircraftBillboards: false,
    useNavalBillboards: false,
    aircraftVisualPolicy: {
        defaultMode: "model",
        focusedMode: "model",
        modelZoomHeight: Number.POSITIVE_INFINITY,
        modelMaxActive: 8,
        charFallbackCount: 0,
        zoomModel: true,
    },
    navalVisualPolicy: {
        modelZoomHeight: Number.POSITIVE_INFINITY,
        modelMaxActive: 8,
        charFallbackCount: 0,
        zoomModel: true,
    },
    strategicSatellites: {
        enabled: true,
        apiPath: "/api/satellites/military",
        maximumVisibleSatellites: 160,
        sampleIntervalSeconds: 120,
        pastOrbitMinutes: 45,
        futureOrbitMinutes: 60,
        positionRefreshIntervalMs: 30000,
        focusedModelCount: 1,
        showOrbitPath: true,
        showGroundTrack: true,
        showNadirLine: true,
        showTheoreticalFootprint: true,
        showLabels: false,
        minimumClassificationConfidence: "unconfirmed",
    },
};

const params = new URLSearchParams(window.location.search);
const snapshotKey = String(params.get("snapshot_key") || "").trim();
const captureId = String(params.get("capture_id") || "").trim();
const state = {
    ready: false,
    status: "INITIALIZING",
    error: null,
    payload: null,
    viewer: null,
    camera: null,
    cluster_snapshot: null,
};

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitUntil(predicate, timeoutMs = 12000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
        if (predicate()) return true;
        await nextFrame();
    }
    return false;
}

function toClusterEvent(cluster = {}) {
    const point = cluster.medoid || cluster.centroid || {};
    return {
        id: cluster.cluster_id,
        cluster_id: cluster.cluster_id,
        event_ids: cluster.event_ids || [],
        lat: Number(point.latitude ?? point.lat),
        lon: Number(point.longitude ?? point.lon),
        title: cluster.location_label || "Operational activity",
        location_label: cluster.location_label || "Operational activity",
        category: String(cluster.dominant_domain || "mixed").toLowerCase(),
        dominant_domain: cluster.dominant_domain,
        domain_distribution: cluster.domain_distribution,
        severity: cluster.severity || "medium",
        confidence: cluster.corroborated_count > 0 ? 80 : 55,
        corroboration_state: cluster.corroborated_count > 0 ? "CORROBORATED" : "REPORTED",
        occurred_at: cluster.latest_activity,
        actual_event_count: Number(cluster.incident_count || 1),
        cluster_count: Number(cluster.incident_count || 1),
        _clusterCount: Number(cluster.incident_count || 1),
        is_report_cluster_summary: true,
        weighted_activity_score: Number(cluster.activity_score || 0),
        centroid: cluster.centroid,
        bounds: cluster.bounds,
        location_precision: "LOCAL",
        location_method: "report_cluster_medoid",
    };
}

function toDevelopmentEvent(item = {}) {
    return {
        id: item.event_id,
        lat: Number(item.latitude),
        lon: Number(item.longitude),
        title: item.title,
        summary: item.summary,
        category: item.category || String(item.domain || "mixed").toLowerCase(),
        severity: item.severity,
        confidence: item.confidence,
        corroboration_state: item.verification_state,
        occurred_at: item.occurred_at,
        location_precision: item.location_precision,
        location_method: "report_snapshot_event",
        event_country: item.event_country,
        event_region: item.event_region,
        event_city: item.event_city,
        event_place: item.event_place,
        location_label: item.event_place || item.event_city || item.event_region || item.event_country,
    };
}

async function renderSelectedAsset(payload) {
    const asset = payload.selected_asset;
    if (!asset) return;
    if (asset.track_type === "naval") {
        setLayer("naval", true);
        const { upsertNavalVessel } = await import("./warzone-live-naval.js");
        upsertNavalVessel({
            id: asset.asset_id,
            source_key: asset.asset_id,
            dedupe_key: asset.asset_id,
            title: asset.name || asset.callsign || asset.asset_id,
            category: "military",
            subcategory: asset.role,
            lat: asset.latitude,
            lon: asset.longitude,
            speed_kts: asset.speed_kts,
            heading_deg: asset.heading_deg,
            country: asset.country,
            occurred_at: asset.last_observed,
            metadata: {
                track_key: asset.asset_id,
                vessel_name: asset.name,
                vessel_class: asset.role,
                ship_type: asset.type,
                operator: asset.operator,
                country: asset.country,
                lat: asset.latitude,
                lon: asset.longitude,
                speed_kts: asset.speed_kts,
                heading_deg: asset.heading_deg,
            },
        });
        return;
    }
    setLayer("aircraft", true);
    const { upsertLiveTrack } = await import("./warzone-live-airforce.js");
    upsertLiveTrack({
        track_key: asset.asset_id,
        title: asset.name || asset.callsign || asset.asset_id,
        category: "military",
        subcategory: asset.role,
        lat: asset.latitude,
        lon: asset.longitude,
        altitude_ft: asset.altitude_ft,
        speed_kts: asset.speed_kts,
        heading_deg: asset.heading_deg,
        country: asset.country,
        status: asset.status || "active",
        updated_at: asset.last_observed,
        render_mode: "model",
        model_render_mode: "model",
        metadata: {
            callsign: asset.callsign,
            type_code: asset.type,
            model_name: asset.variant,
            role: asset.role,
            operator: asset.operator,
            squawk: asset.squawk,
        },
    });
}

async function renderOperationalSatellites(payload, viewer) {
    if (payload.target.capture_type !== "ORBITAL_CONTEXT") return;
    setLayer("orbital-assets", true);
    const { initWarzoneMilSats } = await import("./warzone-mil-sats.js");
    initWarzoneMilSats(viewer);
}

async function applyCamera(viewer, camera) {
    viewer.__warzone?.setSceneMode?.(camera.scene_mode, { duration: 0, source: "report-capture" });
    await waitUntil(() => viewer.scene.mode !== Cesium.SceneMode.MORPHING, 5000);
    const heading = Cesium.Math.toRadians(Number(camera.heading_degrees || 0));
    const pitch = Cesium.Math.toRadians(Number(camera.pitch_degrees || -55));
    const roll = Cesium.Math.toRadians(Number(camera.roll_degrees || 0));
    const target = Cesium.Cartesian3.fromDegrees(
        Number(camera.center.longitude),
        Number(camera.center.latitude)
    );
    if (String(camera.scene_mode).toLowerCase() === "3d") {
        viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(
            heading,
            pitch,
            Number(camera.range_meters)
        ));
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } else {
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(
                Number(camera.center.longitude),
                Number(camera.center.latitude),
                Number(camera.range_meters)
            ),
            orientation: { heading, pitch, roll },
        });
    }
    viewer.scene.requestRender();
    await nextFrame();
    await nextFrame();
}

async function prepareCapture() {
    const payload = state.payload;
    const viewer = state.viewer;
    if (!payload || !viewer) throw new Error("Capture scene is not initialized");
    state.status = "PREPARING";
    const clusterEvents = (payload.clusters || []).map(toClusterEvent)
        .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon));
    const developmentEvents = (payload.developments || []).map(toDevelopmentEvent)
        .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon));
    const useAggregateView = ["REGIONAL_OVERVIEW_3D", "TACTICAL_OVERVIEW_2D"].includes(payload.target.capture_type);
    viewer.__warzone?.setMapMode?.(useAggregateView ? "heatmap" : "map");
    viewer.__warzone?.addEvents?.([...clusterEvents, ...developmentEvents]);
    await renderSelectedAsset(payload);
    await renderOperationalSatellites(payload, viewer);
    await applyCamera(viewer, payload.camera);
    await Promise.resolve(viewer.__warzoneImageryReadyPromise).catch(() => null);
    await waitUntil(() => viewer.scene.globe?.tilesLoaded !== false, 10000);
    for (let index = 0; index < 6; index += 1) {
        viewer.scene.requestRender();
        await nextFrame();
    }
    state.camera = {
        requested: payload.camera,
        actual: viewer.__warzone?.getEventClusterSnapshot?.().camera || null,
    };
    state.cluster_snapshot = viewer.__warzone?.getEventClusterSnapshot?.() || null;
    state.status = "READY";
    state.ready = true;
    document.body.classList.add("wz-report-capture-ready");
    return getState();
}

function getState() {
    return {
        ready: state.ready,
        status: state.status,
        error: state.error,
        capture_id: state.payload?.target?.capture_id || captureId,
        capture_type: state.payload?.target?.capture_type || null,
        camera: state.camera,
        cluster_snapshot: state.cluster_snapshot,
        selected_asset_id: state.payload?.selected_asset?.asset_id || null,
    };
}

window.__stratopsReportCapture = {
    ready: false,
    prepareCapture,
    getState,
};

async function initialize() {
    if (!snapshotKey || !captureId) throw new Error("Missing snapshot_key or capture_id");
    const response = await fetch(`/api/stratops/reports/internal/capture/${encodeURIComponent(snapshotKey)}/${encodeURIComponent(captureId)}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
    });
    if (!response.ok) throw new Error(`Capture payload unavailable (${response.status})`);
    const json = await response.json();
    state.payload = json.capture;
    state.viewer = await initWarzoneGlobe();
    window.__warzoneViewer = state.viewer;
    state.viewer.__warzone?.stopStartupRotation?.();
    state.viewer.__warzone?.setAdaptiveQualityProfile?.("normal");
    state.viewer.__warzone?.setPerformanceMode?.(0);
    await prepareCapture();
    window.__stratopsReportCapture.ready = true;
}

initialize().catch((error) => {
    state.error = error?.message || String(error);
    state.status = "FAILED";
    window.__stratopsReportCapture.ready = false;
    document.getElementById("wz-report-capture-status").textContent = `CAPTURE FAILED: ${state.error}`;
    console.error("Report capture initialization failed:", error);
});
