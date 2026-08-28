import "../css/style.css";
import "../css/report-capture.css";
import "cesium/Build/Cesium/Widgets/widgets.css";
import * as Cesium from "cesium";
import { initWarzoneGlobe } from "./warzone-globe.js";
import { setLayer } from "./warzone-layers.js";
import {
    assessCaptureSemanticQuality,
    buildReportAssetFocusPreset,
    buildSnapshotAssetRenderInput,
} from "../../../apps/shared/reporting-capture.js";

const isLocalCaptureHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1" ||
    window.location.hostname === "[::1]";
const REPORT_CAPTURE_API_BASE = isLocalCaptureHost ? "/api" : "https://api.battlespacex.com";

window.__stratopsReportCaptureMode = true;
window.__stratopsConfig = {
    apiBase: REPORT_CAPTURE_API_BASE,
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
    selected_asset_entity: null,
    target_event_entity: null,
    semantic_quality: null,
    asset_adapter: null,
    asset_focus_debug: null,
    asset_cleanup: null,
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
        report_label: cluster.report_label || null,
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
        report_label_visible: true,
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
    if (!asset) return null;
    const input = buildSnapshotAssetRenderInput(asset);
    if (!input.valid) throw new Error(input.reason);
    let entity = null;
    if (input.track_type === "naval") {
        setLayer("naval", true);
        const naval = await import("./warzone-live-naval.js");
        entity = naval.upsertNavalVessel(input.event);
        state.asset_adapter = {
            input,
            focus: (options) => naval.focusNavalVessel(input.track_key, options),
            describe: () => naval.getNavalModelDescriptor(input.event),
            clear: () => naval.clearNavalVessel(input.track_key),
        };
    } else {
        setLayer("aircraft", true);
        const aircraft = await import("./warzone-live-airforce.js");
        entity = aircraft.upsertLiveTrack(input.event);
        state.asset_adapter = {
            input,
            focus: (options) => aircraft.focusLiveTrack(input.track_key, options),
            enableCtr: (options) => aircraft.enableFocusedLiveTrackContourMode({
                ...options,
                trackKey: input.track_key,
            }),
            describe: () => aircraft.getLiveTrackModelDescriptor(input.event),
            clear: () => {
                aircraft.clearLiveTrackSelection({ resetCamera: false });
                aircraft.clearLiveTrack(input.track_key);
            },
        };
    }
    entity = entity || state.viewer?.entities?.getById?.(`${input.track_type === "naval" ? "naval" : "track"}-${input.track_key}`) || null;
    if (!entity) throw new Error("asset_entity_not_created");
    if (entity) entity.__reportSnapshotAsset = true;
    state.asset_focus_debug = {
        source: "frozen_report_snapshot",
        track_type: input.track_type,
        expected_model_family: input.expected_model_family,
        entity_position: input.position,
        entity_heading: input.heading_degrees,
        visualization_fallback: null,
        visibility_check: null,
        model_ready_state: "ENTITY_CREATED",
    };
    return entity;
}

function getGraphicValue(value) {
    try {
        return value?.getValue?.(Cesium.JulianDate.now()) ?? value;
    } catch {
        return value;
    }
}

function getModelUri(entity) {
    const value = getGraphicValue(entity?.model?.uri);
    return String(value?.url || value || "").trim();
}

function getPickedEntityId(picked) {
    return String(picked?.id?.id || picked?.id || picked?.primitive?.id?.id || picked?.primitive?.id || "");
}

function modelWasPicked(viewer, entity, screen, minimumPixels) {
    if (!screen || !entity?.model) return false;
    const labelShow = entity.label ? getGraphicValue(entity.label.show) !== false : null;
    if (entity.label) entity.label.show = false;
    let picked = false;
    try {
        viewer.scene.requestRender();
        const boxSize = Math.max(18, Math.min(220, Math.round(Number(minimumPixels || 0) * 0.72)));
        const results = viewer.scene.drillPick(new Cesium.Cartesian2(screen.x, screen.y), 32, boxSize, boxSize) || [];
        picked = results.some((result) => getPickedEntityId(result) === String(entity.id));
    } catch {
        picked = false;
    } finally {
        if (entity.label) entity.label.show = labelShow !== false;
    }
    return picked;
}

function setCaptureAssetLabel(asset, entity) {
    const lines = [asset.callsign || asset.name, asset.variant || asset.type, asset.role]
        .map((value) => String(value || "").replace(/_/g, " ").trim().toUpperCase())
        .filter((value, index, values) => value && values.indexOf(value) === index)
        .slice(0, 3);
    if (!lines.length) return;
    entity.label = {
        text: lines.join("\n"),
        font: "700 15px Blinker, Arial, sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(34, -24),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.68),
        backgroundPadding: new Cesium.Cartesian2(7, 5),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
}

function inspectAssetVisibility(viewer, entity, preset) {
    const position = getEntityPosition(entity);
    const screen = position ? Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position) : null;
    const canvas = viewer.scene.canvas;
    const margin = Number(preset.safe_viewport_margin_pixels || 36);
    const safeViewport = Boolean(screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)
        && screen.x >= margin && screen.x <= canvas.clientWidth - margin
        && screen.y >= margin && screen.y <= canvas.clientHeight - margin);
    const configuredMinimumPixels = Number(getGraphicValue(entity?.model?.minimumPixelSize) || 0);
    const modelUri = getModelUri(entity);
    const cameraRange = position && viewer.camera?.positionWC
        ? Cesium.Cartesian3.distance(viewer.camera.positionWC, position)
        : Number.NaN;
    const expectedRange = Number(preset.range_meters || 0);
    const rangeWithinLimits = Number.isFinite(cameraRange) && expectedRange > 0
        && cameraRange >= expectedRange * 0.55 && cameraRange <= expectedRange * 1.8;
    const renderFrameContainsModel = safeViewport
        && configuredMinimumPixels >= Number(preset.minimum_visual_pixels || 0)
        && modelWasPicked(viewer, entity, screen, configuredMinimumPixels);
    return {
        passed: Boolean(modelUri && position && safeViewport && rangeWithinLimits && renderFrameContainsModel),
        model_uri: modelUri || null,
        model_graphic_visible: isGraphicEnabled(entity?.model),
        screen_position: screen ? { x: Number(screen.x.toFixed(1)), y: Number(screen.y.toFixed(1)) } : null,
        safe_viewport: safeViewport,
        configured_minimum_pixels: configuredMinimumPixels,
        minimum_visual_pixels: preset.minimum_visual_pixels,
        camera_range_meters: Number.isFinite(cameraRange) ? Math.round(cameraRange) : null,
        expected_camera_range_meters: expectedRange,
        camera_range_within_limits: rangeWithinLimits,
        render_frame_contains_model: renderFrameContainsModel,
    };
}

async function waitForVisibleAsset(viewer, entity, preset, timeoutMs = 12000) {
    const started = performance.now();
    let result = inspectAssetVisibility(viewer, entity, preset);
    while (!result.passed && performance.now() - started < timeoutMs) {
        viewer.scene.requestRender();
        await nextFrame();
        result = inspectAssetVisibility(viewer, entity, preset);
    }
    return result;
}

async function applyAssetFocus(payload, viewer) {
    const entity = state.selected_asset_entity;
    const adapter = state.asset_adapter;
    if (!entity || !adapter) throw new Error("asset_entity_not_created");
    const preset = buildReportAssetFocusPreset(payload.target.capture_type, payload.camera);
    viewer.__warzone?.setSceneMode?.("3d", { duration: 0, source: "report-asset-focus" });
    await waitUntil(() => viewer.scene.mode !== Cesium.SceneMode.MORPHING, 5000);
    const focusOptions = {
        rangeMeters: preset.range_meters,
        headingDegrees: preset.heading_degrees,
        pitchDegrees: preset.pitch_degrees,
        duration: 0,
    };
    const focusForCapture = async (options) => {
        if (preset.mode === "REGIONAL") {
            await applyCamera(viewer, {
                ...payload.camera,
                scene_mode: "3d",
                range_meters: options.rangeMeters,
                heading_degrees: options.headingDegrees,
                pitch_degrees: options.pitchDegrees,
            });
        } else if (adapter.focus(options) !== true) {
            throw new Error("asset_focus_failed");
        }
        await nextFrame();
        await nextFrame();
        if (preset.map_mode === "CTR") {
            const ctrEnabled = await adapter.enableCtr?.({ reason: "report-hva-capture" });
            if (ctrEnabled !== true) throw new Error("asset_ctr_mode_failed");
            await nextFrame();
            await nextFrame();
        }
    };
    await focusForCapture(focusOptions);
    const descriptor = adapter.describe();
    if (entity.model) {
        entity.model.minimumPixelSize = Math.max(
            Number(descriptor.minimum_pixel_size || 0),
            Number(preset.minimum_visual_pixels || 0)
        );
    }
    setCaptureAssetLabel(payload.selected_asset, entity);
    let visibility = await waitForVisibleAsset(viewer, entity, preset);
    let adjusted = false;
    if (!visibility.passed && visibility.model_uri) {
        adjusted = true;
        const retryPreset = {
            ...preset,
            range_meters: Math.max(preset.mode === "REGIONAL" ? 85000 : 16000, Math.round(preset.range_meters * 0.68)),
            minimum_visual_pixels: Math.max(preset.minimum_visual_pixels, preset.mode === "REGIONAL" ? 128 : 220),
        };
        if (entity.model) entity.model.minimumPixelSize = retryPreset.minimum_visual_pixels;
        await focusForCapture({
            rangeMeters: retryPreset.range_meters,
            headingDegrees: retryPreset.heading_degrees,
            pitchDegrees: retryPreset.pitch_degrees,
            duration: 0,
        });
        await nextFrame();
        visibility = await waitForVisibleAsset(viewer, entity, retryPreset, 7000);
        Object.assign(preset, retryPreset);
    }
    const actualUri = visibility.model_uri || descriptor.model_uri || null;
    state.asset_focus_debug = {
        ...state.asset_focus_debug,
        model_uri: actualUri,
        model_code: descriptor.model_code || null,
        model_family: descriptor.model_family || null,
        model_subtype: descriptor.subtype || null,
        visualization_fallback: Boolean(adapter.input.expected_model_family
            && descriptor.model_code
            && !String(descriptor.model_code).toUpperCase().includes(String(adapter.input.expected_model_family).toUpperCase())),
        configured_scale: Number(getGraphicValue(entity?.model?.scale) || descriptor.scale || 0),
        configured_minimum_pixel_size: Number(getGraphicValue(entity?.model?.minimumPixelSize) || descriptor.minimum_pixel_size || 0),
        configured_maximum_scale: Number(getGraphicValue(entity?.model?.maximumScale) || descriptor.maximum_scale || 0),
        camera_heading: preset.heading_degrees,
        camera_pitch: preset.pitch_degrees,
        camera_range: preset.range_meters,
        focus_mode: preset.mode,
        map_mode: preset.map_mode,
        ctr_mode_active: viewer.__warzone?.isCtrModeActive?.() === true,
        visibility_adjusted_once: adjusted,
        visibility_check: visibility,
        model_ready_state: visibility.render_frame_contains_model ? "MODEL_PICKED_IN_RENDER_FRAME" : "MODEL_NOT_VISIBLE",
    };
    if (!visibility.passed) throw new Error(actualUri ? "asset_not_visible" : "asset_model_mapping_unavailable");
    return preset;
}

function getEntityPosition(entity) {
    try {
        return entity?.position?.getValue?.(Cesium.JulianDate.now()) || entity?.position || null;
    } catch {
        return null;
    }
}

function isGraphicEnabled(graphic) {
    if (!graphic) return false;
    try {
        return graphic.show?.getValue?.() !== false && graphic.show !== false;
    } catch {
        return true;
    }
}

function isEntityVisibleInViewport(viewer, entity, { requireGraphic = true } = {}) {
    if (!viewer || !entity || entity.show === false) return false;
    if (requireGraphic && ![entity.model, entity.billboard, entity.point, entity.ellipse, entity.label].some(isGraphicEnabled)) return false;
    if (entity.model) {
        const uri = entity.model.uri?.getValue?.(Cesium.JulianDate.now()) || entity.model.uri;
        if (!uri) return false;
    }
    const position = getEntityPosition(entity);
    if (!position) return false;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
    const canvas = viewer.scene.canvas;
    return Boolean(screen && Number.isFinite(screen.x) && Number.isFinite(screen.y)
        && screen.x >= 8 && screen.x <= canvas.clientWidth - 8
        && screen.y >= 8 && screen.y <= canvas.clientHeight - 8);
}

function renderTargetEventMarker(payload, viewer) {
    if (payload.target.capture_type !== "MAJOR_DEVELOPMENT_CONTEXT") return null;
    const item = (payload.developments || []).find((entry) => entry.event_id === payload.target.event_id);
    if (!item || !Number.isFinite(Number(item.latitude)) || !Number.isFinite(Number(item.longitude))) return null;
    return viewer.entities.add({
        id: `report-target-${item.event_id}`,
        position: Cesium.Cartesian3.fromDegrees(Number(item.longitude), Number(item.latitude), 250),
        point: {
            pixelSize: 18,
            color: Cesium.Color.fromCssColorString("#f51e58"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
            text: `${String(item.domain || item.category || "EVENT").replace(/_/g, " ")}\n${item.display_location || item.event_place || item.event_city || item.event_region || item.event_country || "SELECTED EVENT"}`,
            font: "700 15px Blinker, Arial, sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 4,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(18, -22),
            horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.72),
            backgroundPadding: new Cesium.Cartesian2(8, 5),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
}

function collectSemanticEvidence(payload, viewer) {
    const assetEntity = state.selected_asset_entity;
    const isAssetFocusCapture = ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT", "NAVAL_FOCUS"].includes(payload.target.capture_type);
    const targetClusterId = payload.target.cluster_id || payload.clusters?.[0]?.cluster_id;
    const targetCluster = targetClusterId ? viewer.entities.getById(`${targetClusterId}-fill`) : null;
    const visibleReportClusters = (payload.clusters || []).filter((cluster) => {
        const fill = viewer.entities.getById(`${cluster.cluster_id}-fill`);
        const label = viewer.entities.getById(`${cluster.cluster_id}-count`);
        return isEntityVisibleInViewport(viewer, fill) && isEntityVisibleInViewport(viewer, label);
    });
    const visibleOrbital = viewer.entities.values.some((entity) => String(entity?.id || "").startsWith("wz-startup-sat-")
        && isEntityVisibleInViewport(viewer, entity));
    return {
        dev_fixture: payload.selected_asset?.is_dev_fixture === true,
        asset_visible: isAssetFocusCapture
            ? state.asset_focus_debug?.visibility_check?.passed === true
            : isEntityVisibleInViewport(viewer, assetEntity),
        target_event_visible: isEntityVisibleInViewport(viewer, state.target_event_entity),
        target_cluster_visible: isEntityVisibleInViewport(viewer, targetCluster),
        meaningful_operational_layer_visible: visibleReportClusters.length > 0,
        orbital_entity_visible: visibleOrbital,
        visible_report_cluster_count: visibleReportClusters.length,
        selected_asset_entity_id: assetEntity?.id || null,
    };
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
    const includeClusters = ["REGIONAL_OVERVIEW_3D", "TACTICAL_OVERVIEW_2D", "CLUSTER_CONTEXT", "HVA_REGIONAL_CONTEXT", "AOI_CONTEXT"].includes(payload.target.capture_type);
    const clusterLimit = ["REGIONAL_OVERVIEW_3D", "TACTICAL_OVERVIEW_2D"].includes(payload.target.capture_type) ? 6 : 3;
    const clusterEvents = (includeClusters ? payload.clusters || [] : []).map(toClusterEvent)
        .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon))
        .sort((left, right) => (String(right.cluster_id) === String(payload.target.cluster_id)) - (String(left.cluster_id) === String(payload.target.cluster_id))
            || Number(right.weighted_activity_score || 0) - Number(left.weighted_activity_score || 0))
        .slice(0, clusterLimit);
    const developmentEvents = (payload.developments || []).map(toDevelopmentEvent)
        .filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lon));
    viewer.__warzone?.setMapMode?.("map");
    viewer.__warzone?.addEvents?.([...clusterEvents, ...developmentEvents]);
    state.target_event_entity = renderTargetEventMarker(payload, viewer);
    state.selected_asset_entity = await renderSelectedAsset(payload);
    await renderOperationalSatellites(payload, viewer);
    const isAssetFocusCapture = ["HVA_FOCUS_3D", "HVA_REGIONAL_CONTEXT", "NAVAL_FOCUS"].includes(payload.target.capture_type);
    if (isAssetFocusCapture) await applyAssetFocus(payload, viewer);
    else await applyCamera(viewer, payload.camera);
    await Promise.resolve(viewer.__warzoneImageryReadyPromise).catch(() => null);
    await waitUntil(() => viewer.scene.globe?.tilesLoaded !== false, 10000);
    for (let index = 0; index < 12; index += 1) {
        viewer.scene.requestRender();
        await nextFrame();
    }
    state.camera = {
        requested: payload.camera,
        actual: viewer.__warzone?.getEventClusterSnapshot?.().camera || null,
    };
    state.cluster_snapshot = viewer.__warzone?.getEventClusterSnapshot?.() || null;
    const evidence = collectSemanticEvidence(payload, viewer);
    state.semantic_quality = {
        ...assessCaptureSemanticQuality(payload.target.capture_type, evidence),
        evidence,
    };
    if (state.semantic_quality.status !== "READY") {
        state.status = "FAILED";
        state.error = state.semantic_quality.failure_reason;
        throw new Error(state.semantic_quality.failure_reason);
    }
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
        selected_asset_entity_id: state.selected_asset_entity?.id || null,
        asset_focus_debug: state.asset_focus_debug,
        asset_cleanup: state.asset_cleanup,
        semantic_quality: state.semantic_quality,
    };
}

async function cleanupCapture() {
    if (state.asset_cleanup?.completed === true) return state.asset_cleanup;
    const entityId = state.selected_asset_entity?.id || null;
    try {
        state.asset_adapter?.clear?.();
        state.viewer?.scene?.requestRender?.();
        await nextFrame();
        const removed = entityId ? !state.viewer?.entities?.getById?.(entityId) : true;
        state.asset_cleanup = { completed: true, entity_id: entityId, entity_removed: removed };
    } catch (error) {
        state.asset_cleanup = {
            completed: false,
            entity_id: entityId,
            entity_removed: false,
            failure_reason: error?.message || String(error),
        };
    }
    return state.asset_cleanup;
}

window.__stratopsReportCapture = {
    ready: false,
    prepareCapture,
    getState,
    cleanup: cleanupCapture,
};

async function initialize() {
    if (!snapshotKey || !captureId) throw new Error("Missing snapshot_key or capture_id");
    const response = await fetch(`${REPORT_CAPTURE_API_BASE}/stratops/reports/internal/capture/${encodeURIComponent(snapshotKey)}/${encodeURIComponent(captureId)}`, {
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
    void cleanupCapture();
});
