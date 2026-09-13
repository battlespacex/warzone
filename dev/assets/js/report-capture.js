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
    capture_label_entity: null,
    target_event_entity: null,
    semantic_quality: null,
    asset_adapter: null,
    asset_focus_debug: null,
    context_debug: null,
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

async function waitForPromise(promise, timeoutMs = 5000) {
    if (!promise || typeof promise.then !== "function") return null;
    return new Promise((resolve) => {
        const timeout = window.setTimeout(() => resolve(null), Math.max(0, timeoutMs));
        Promise.resolve(promise).then(
            (value) => {
                window.clearTimeout(timeout);
                resolve(value);
            },
            () => {
                window.clearTimeout(timeout);
                resolve(null);
            }
        );
    });
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
            enableCtr: async () => {
                const mapApi = state.viewer?.__warzone;
                mapApi?.setContourFocusPosition?.({
                    lon: input.position.longitude, lat: input.position.latitude, height: 0,
                }, { profile: "naval", force: true });
                mapApi?.enterCtrMode?.({ reason: "report-naval-capture" });
                mapApi?.setContourGridVisible?.(true);
                await mapApi?.disableFocusedTerrain?.();
                await mapApi?.setContourLayerVisible?.(true);
                return mapApi?.isCtrModeActive?.() === true;
            },
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
            releaseCameraLock: () => aircraft.setLiveTrackHardLock(false),
enableCtr: async () => {
    const mapApi = state.viewer?.__warzone;

    mapApi?.setContourFocusPosition?.({
        lon: input.position.longitude,
        lat: input.position.latitude,
        height: Number(input.position.altitude_m || 0),
    }, {
        profile: "aircraft",
        force: true,
    });

    mapApi?.enterCtrMode?.({
        reason: "report-hva-capture",
    });

    mapApi?.setContourGridVisible?.(true);
    await mapApi?.disableFocusedTerrain?.();
    await mapApi?.setContourLayerVisible?.(true);

    return mapApi?.isCtrModeActive?.() === true;
},
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

function serializeCartesian(value) {
    if (!value) return null;
    return {
        x: Number(Number(value.x).toFixed(3)),
        y: Number(Number(value.y).toFixed(3)),
        z: Number(Number(value.z).toFixed(3)),
    };
}

function inspectModelBoundingSphere(viewer, entity) {
    const result = new Cesium.BoundingSphere();
    try {
        const status = viewer.dataSourceDisplay?.getBoundingSphere?.(entity, false, result);
        const statusName = status === Cesium.BoundingSphereState.DONE
            ? "DONE"
            : status === Cesium.BoundingSphereState.PENDING
                ? "PENDING"
                : "FAILED";
        return {
            status: statusName,
            center: statusName === "DONE" ? serializeCartesian(result.center) : null,
            radius_meters: statusName === "DONE" && Number.isFinite(result.radius)
                ? Number(result.radius.toFixed(3))
                : null,
        };
    } catch {
        return { status: "UNAVAILABLE", center: null, radius_meters: null };
    }
}

function sampleModelPixels(viewer, entity, anchorScreen, targetPixels) {
    if (!anchorScreen || !entity?.model) return null;
    const canvas = viewer.scene.canvas;
    const width = Number(canvas.width || canvas.clientWidth || 0);
    const height = Number(canvas.height || canvas.clientHeight || 0);
    const radius = Math.min(150, Math.max(120, Math.round(Number(targetPixels || 180) * 0.82)));
    const searchLeft = Math.max(0, Math.floor(anchorScreen.x - radius));
    const searchRight = Math.min(width - 1, Math.ceil(anchorScreen.x + radius));
    const searchTop = Math.max(0, Math.floor(anchorScreen.y - radius));
    const searchBottom = Math.min(height - 1, Math.ceil(anchorScreen.y + radius));
    const readWidth = Math.max(1, searchRight - searchLeft + 1);
    const readHeight = Math.max(1, searchBottom - searchTop + 1);
    const readBottom = Math.max(0, height - searchBottom - 1);
    const labelShow = entity.label ? getGraphicValue(entity.label.show) !== false : null;
    const modelColor = getGraphicValue(entity.model.color) || Cesium.Color.WHITE;
    const modelColorBlendMode = getGraphicValue(entity.model.colorBlendMode) ?? Cesium.ColorBlendMode.MIX;
    const modelColorBlendAmount = getGraphicValue(entity.model.colorBlendAmount) ?? 0;
    if (entity.label) entity.label.show = false;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let closestDistance = Number.POSITIVE_INFINITY;
    let sumX = 0;
    let sumY = 0;
    let renderedPixelCount = 0;
    const locations = [];
    const candidateLocations = [{ x: Math.round(anchorScreen.x), y: Math.round(anchorScreen.y) }];

    try {
        viewer.render();
        const visiblePixels = viewer.scene.context.readPixels({
            x: searchLeft, y: readBottom, width: readWidth, height: readHeight,
        });
        // A transparent color pass preserves the loaded Model primitive. Toggling
        // ModelGraphics.show removes/recreates it and made later readiness checks
        // race the GLB loader.
        entity.model.color = Cesium.Color.TRANSPARENT;
        entity.model.colorBlendMode = Cesium.ColorBlendMode.MIX;
        entity.model.colorBlendAmount = 1;
        viewer.render();
        const hiddenPixels = viewer.scene.context.readPixels({
            x: searchLeft, y: readBottom, width: readWidth, height: readHeight,
        });
        entity.model.color = modelColor;
        entity.model.colorBlendMode = modelColorBlendMode;
        entity.model.colorBlendAmount = modelColorBlendAmount;
        viewer.render();

        for (let row = 0; row < readHeight; row += 1) {
            for (let column = 0; column < readWidth; column += 1) {
                const index = (row * readWidth + column) * 4;
                const delta = Math.abs(visiblePixels[index] - hiddenPixels[index])
                    + Math.abs(visiblePixels[index + 1] - hiddenPixels[index + 1])
                    + Math.abs(visiblePixels[index + 2] - hiddenPixels[index + 2])
                    + Math.abs(visiblePixels[index + 3] - hiddenPixels[index + 3]);
                if (delta < 12) continue;
                const x = searchLeft + column;
                const y = height - 1 - (readBottom + row);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                sumX += x;
                sumY += y;
                renderedPixelCount += 1;
                closestDistance = Math.min(closestDistance, Math.hypot(x - anchorScreen.x, y - anchorScreen.y));
                if (candidateLocations.length < 24 && renderedPixelCount % 97 === 1) {
                    candidateLocations.push({ x, y });
                }
            }
        }
        for (const point of candidateLocations) {
            const picked = viewer.scene.pick(new Cesium.Cartesian2(point.x, point.y), 1, 1);
            if (getPickedEntityId(picked) === String(entity.id)) locations.push(point);
            if (locations.length >= 8) break;
        }
    } catch {
        renderedPixelCount = 0;
    } finally {
        entity.model.color = modelColor;
        entity.model.colorBlendMode = modelColorBlendMode;
        entity.model.colorBlendAmount = modelColorBlendAmount;
        if (entity.label) entity.label.show = labelShow !== false;
        viewer.scene.requestRender();
    }

    if (!renderedPixelCount) {
        return {
            picked_pixel_count: 0,
            rendered_pixel_count: 0,
            pick_locations: [],
            bounds: null,
            visual_width_pixels: 0,
            visual_height_pixels: 0,
            visual_size_pixels: 0,
            anchor_to_closest_pick_pixels: null,
            anchor_to_pick_centroid_pixels: null,
        };
    }
    const centroid = { x: sumX / renderedPixelCount, y: sumY / renderedPixelCount };
    const bounds = { min_x: minX, min_y: minY, max_x: maxX, max_y: maxY };
    const visualWidth = maxX - minX + 1;
    const visualHeight = maxY - minY + 1;
    return {
        picked_pixel_count: locations.length,
        rendered_pixel_count: renderedPixelCount,
        pick_locations: [
            ...locations,
            { x: Number(centroid.x.toFixed(1)), y: Number(centroid.y.toFixed(1)) },
        ],
        bounds,
        visual_width_pixels: visualWidth,
        visual_height_pixels: visualHeight,
        visual_size_pixels: Math.max(visualWidth, visualHeight),
        anchor_to_closest_pick_pixels: Number(closestDistance.toFixed(1)),
        anchor_to_pick_centroid_pixels: Number(Math.hypot(
            centroid.x - anchorScreen.x,
            centroid.y - anchorScreen.y
        ).toFixed(1)),
    };
}

function probeRenderedModel(viewer, entity, anchorScreen) {
    if (!anchorScreen || !entity?.model) return null;
    const canvas = viewer.scene.canvas;
    const width = Number(canvas.clientWidth || canvas.width || 0);
    const height = Number(canvas.clientHeight || canvas.height || 0);
    const labelShow = entity.label ? getGraphicValue(entity.label.show) !== false : null;
    const points = [{ x: anchorScreen.x, y: anchorScreen.y }];
    for (const radius of [24, 48, 72, 90]) {
        for (let angle = 0; angle < 16; angle += 1) {
            const radians = angle * Math.PI / 8;
            points.push({
                x: anchorScreen.x + Math.cos(radians) * radius,
                y: anchorScreen.y + Math.sin(radians) * radius,
            });
        }
    }
    const locations = [];
    try {
        if (entity.label) entity.label.show = false;
        viewer.render();
        for (const point of points) {
            if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
            const picked = viewer.scene.pick(new Cesium.Cartesian2(point.x, point.y), 1, 1);
            if (getPickedEntityId(picked) !== String(entity.id)) continue;
            locations.push({ x: Number(point.x.toFixed(1)), y: Number(point.y.toFixed(1)) });
            if (locations.length >= 8) break;
        }
    } catch {
        locations.length = 0;
    } finally {
        if (entity.label) entity.label.show = labelShow !== false;
        viewer.scene.requestRender();
    }
    if (!locations.length) {
        return {
            picked_pixel_count: 0,
            pick_locations: [],
            bounds: null,
            anchor_to_closest_pick_pixels: null,
            anchor_to_pick_centroid_pixels: null,
        };
    }
    const xs = locations.map((point) => point.x);
    const ys = locations.map((point) => point.y);
    const centroid = {
        x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
        y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
    };
    return {
        picked_pixel_count: locations.length,
        pick_locations: locations.slice(0, 12),
        bounds: {
            min_x: Math.min(...xs), min_y: Math.min(...ys),
            max_x: Math.max(...xs), max_y: Math.max(...ys),
        },
        anchor_to_closest_pick_pixels: Number(Math.min(...locations.map((point) =>
            Math.hypot(point.x - anchorScreen.x, point.y - anchorScreen.y)
        )).toFixed(1)),
        anchor_to_pick_centroid_pixels: Number(Math.hypot(
            centroid.x - anchorScreen.x,
            centroid.y - anchorScreen.y
        ).toFixed(1)),
    };
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
        // Keep the report label outside the 140-220 px aircraft silhouette.
        pixelOffset: new Cesium.Cartesian2(120, -70),
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
    const targetVisualPixels = Number(preset.target_visual_pixels || preset.minimum_visual_pixels || 180);
    const modelPixels = probeRenderedModel(viewer, entity, screen);
    const visualSizeUseful = configuredMinimumPixels >= 140 && configuredMinimumPixels <= 220
        && targetVisualPixels >= 140 && targetVisualPixels <= 220;
    const anchorNearModel = Number.isFinite(modelPixels?.anchor_to_closest_pick_pixels)
        && modelPixels.anchor_to_closest_pick_pixels <= 90;
    const modelBoundsSafe = Boolean(modelPixels?.bounds
        && modelPixels.bounds.min_x >= margin
        && modelPixels.bounds.max_x <= canvas.clientWidth - margin
        && modelPixels.bounds.min_y >= margin
        && modelPixels.bounds.max_y <= canvas.clientHeight - margin);
    const rangeWithinLimits = Number.isFinite(cameraRange) && expectedRange > 0
        && cameraRange >= expectedRange * 0.55 && cameraRange <= expectedRange * 1.8;
    const renderFrameContainsModel = safeViewport
        && modelBoundsSafe
        && visualSizeUseful
        && anchorNearModel
        && configuredMinimumPixels >= Number(preset.minimum_visual_pixels || 0)
        && Number(modelPixels?.picked_pixel_count || 0) > 0;
    const boundingSphere = inspectModelBoundingSphere(viewer, entity);
    return {
        passed: Boolean(modelUri && position && safeViewport && rangeWithinLimits && renderFrameContainsModel),
        model_uri: modelUri || null,
        model_graphic_visible: isGraphicEnabled(entity?.model),
        screen_position: screen ? { x: Number(screen.x.toFixed(1)), y: Number(screen.y.toFixed(1)) } : null,
        safe_viewport: safeViewport,
        configured_minimum_pixels: configuredMinimumPixels,
        minimum_visual_pixels: preset.minimum_visual_pixels,
        computed_target_visual_pixels: targetVisualPixels,
        actual_visual_size_pixels: null,
        actual_visual_width_pixels: null,
        actual_visual_height_pixels: null,
        visual_size_evidence: "configured_target_plus_exact_model_pick",
        visual_size_useful: visualSizeUseful,
        model_bounds_safe: modelBoundsSafe,
        model_pick_locations: modelPixels?.pick_locations || [],
        model_pick_bounds: modelPixels?.bounds || null,
        model_picked_pixel_count: modelPixels?.picked_pixel_count || 0,
        model_rendered_pixel_count: null,
        anchor_to_closest_model_pick_pixels: modelPixels?.anchor_to_closest_pick_pixels ?? null,
        anchor_to_model_pick_centroid_pixels: modelPixels?.anchor_to_pick_centroid_pixels ?? null,
        anchor_near_model: anchorNearModel,
        selected_entity_cartesian: serializeCartesian(position),
        camera_cartesian: serializeCartesian(viewer.camera?.positionWC),
        model_bounding_sphere: boundingSphere,
        model_scale: Number(getGraphicValue(entity?.model?.scale) || 0),
        model_minimum_pixel_size: configuredMinimumPixels,
        camera_range_meters: Number.isFinite(cameraRange) ? Math.round(cameraRange) : null,
        expected_camera_range_meters: expectedRange,
        camera_range_within_limits: rangeWithinLimits,
        render_frame_contains_model: renderFrameContainsModel,
    };
}

async function waitForVisibleAsset(viewer, entity, preset, timeoutMs = 12000) {
    const started = performance.now();
    const remaining = () => Math.max(0, timeoutMs - (performance.now() - started));
    await waitForPromise(viewer.__warzoneImageryReadyPromise, Math.min(remaining(), 5000));
    await waitUntil(() => viewer.scene.globe?.tilesLoaded !== false, Math.min(remaining(), 5000));
    for (let frame = 0; frame < 4; frame += 1) {
        viewer.scene.requestRender();
        await nextFrame();
    }
    // Bounding-sphere data is useful diagnostics when Cesium exposes it, but
    // exact scene picks are the capture acceptance evidence and must not be
    // blocked by a dataSourceDisplay sphere that remains FAILED/PENDING.
    const modelLoadWaitMs = preset.capture_type === "HVA_FOCUS_3D" && !entity?.label ? 20000 : 1500;
    await waitUntil(
        () => inspectModelBoundingSphere(viewer, entity).status === "DONE",
        Math.min(remaining(), modelLoadWaitMs)
    );
    let result = null;
    let attempts = 0;
    while (attempts < 4 && performance.now() - started < timeoutMs) {
        attempts += 1;
        viewer.scene.requestRender();
        await nextFrame();
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = inspectAssetVisibility(viewer, entity, preset);
        if (result.passed) break;
    }
    return result || inspectAssetVisibility(viewer, entity, preset);
}

async function verifyFinalAssetVisibility(viewer, entity, preset, priorVisibility, timeoutMs = 10000) {
    const started = performance.now();
    const labelShow = entity.label ? getGraphicValue(entity.label.show) !== false : null;
    while (performance.now() - started < timeoutMs) {
        const position = getEntityPosition(entity);
        const screen = position ? Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position) : null;
        const candidates = [
            ...(priorVisibility?.model_pick_locations || []),
            ...(screen ? [{ x: screen.x, y: screen.y }] : []),
        ].filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        let confirmedLocation = null;
        if (entity.label) entity.label.show = false;
        viewer.render();
        for (const point of candidates) {
            const picked = viewer.scene.pick(new Cesium.Cartesian2(point.x, point.y), 1, 1);
            if (getPickedEntityId(picked) === String(entity.id)) {
                confirmedLocation = { x: Number(point.x.toFixed(1)), y: Number(point.y.toFixed(1)) };
                break;
            }
        }
        if (entity.label) entity.label.show = labelShow !== false;
        viewer.scene.requestRender();
        if (priorVisibility?.passed && confirmedLocation) {
            const cameraRange = position && viewer.camera?.positionWC
                ? Cesium.Cartesian3.distance(viewer.camera.positionWC, position)
                : Number.NaN;
            return {
                ...priorVisibility,
                passed: true,
                final_model_pick_confirmed: true,
                final_model_pick_location: confirmedLocation,
                screen_position: screen
                    ? { x: Number(screen.x.toFixed(1)), y: Number(screen.y.toFixed(1)) }
                    : priorVisibility.screen_position,
                camera_range_meters: Number.isFinite(cameraRange) ? Math.round(cameraRange) : null,
                camera_cartesian: serializeCartesian(viewer.camera?.positionWC),
            };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        await nextFrame();
    }
    return { ...priorVisibility, passed: false, final_model_pick_confirmed: false };
}

async function applyReportAssetCamera(viewer, entity, preset) {
    const position = getEntityPosition(entity);
    if (!position) throw new Error("asset_entity_position_unavailable");
    viewer.camera.cancelFlight?.();
    viewer.camera.lookAt(position, new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(Number(preset.heading_degrees || 0)),
        Cesium.Math.toRadians(Number(preset.pitch_degrees || -36)),
        Number(preset.range_meters || 11200)
    ));
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    viewer.scene.requestRender();
    await nextFrame();
    await nextFrame();
}

async function applyAssetFocus(payload, viewer) {
    let entity = state.selected_asset_entity;
    const adapter = state.asset_adapter;
    if (!entity || !adapter) throw new Error("asset_entity_not_created");
    const preset = buildReportAssetFocusPreset(payload.target.capture_type, payload.camera);
    preset.target_visual_pixels = payload.target.capture_type === "HVA_FOCUS_3D" ? 180 : preset.minimum_visual_pixels;
    viewer.__warzone?.setSceneMode?.("3d", { duration: 0, source: "report-asset-focus" });
    await waitUntil(() => viewer.scene.mode !== Cesium.SceneMode.MORPHING, 5000);
    const descriptor = adapter.describe();
    if (entity.model) {
        entity.__reportCaptureMinimumPixels = Number(preset.minimum_visual_pixels || 180);
        entity.model.minimumPixelSize = Math.max(
            Number(descriptor.minimum_pixel_size || 0),
            Number(preset.minimum_visual_pixels || 0)
        );
        // The interactive maximumScale can prevent minimumPixelSize from being
        // reached at report-camera distances. Lift it only for this frozen asset.
        entity.model.maximumScale = undefined;
    }
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
    const mapApi = viewer.__warzone;

    console.log("[report-ctr] before", {
        ctr: mapApi?.isCtrModeActive?.(),
        grid: mapApi?.isContourGridVisible?.(),
        layer: mapApi?.isContourLayerVisible?.(),
    });

    const enableResult = await adapter.enableCtr?.({
        reason: "report-hva-capture"
    });

    console.log("[report-ctr] after enableCtr", {
        enableResult,
        ctr: mapApi?.isCtrModeActive?.(),
        grid: mapApi?.isContourGridVisible?.(),
        layer: mapApi?.isContourLayerVisible?.(),
    });

    await nextFrame();

    console.log("[report-ctr] after frame 1", {
        ctr: mapApi?.isCtrModeActive?.(),
        grid: mapApi?.isContourGridVisible?.(),
        layer: mapApi?.isContourLayerVisible?.(),
    });

    await nextFrame();

    console.log("[report-ctr] after frame 2", {
        ctr: mapApi?.isCtrModeActive?.(),
        grid: mapApi?.isContourGridVisible?.(),
        layer: mapApi?.isContourLayerVisible?.(),
    });

    const ctrActive = await waitUntil(
        () => mapApi?.isCtrModeActive?.() === true,
        5000
    );

    if (!ctrActive) {
        throw new Error("asset_ctr_mode_failed");
    }
}
        if (payload.target.capture_type === "HVA_FOCUS_3D") {
            adapter.releaseCameraLock?.();
            await applyReportAssetCamera(viewer, entity, {
                ...preset,
                range_meters: options.rangeMeters,
                heading_degrees: options.headingDegrees,
                pitch_degrees: options.pitchDegrees,
            });
        }
    };
    await focusForCapture(focusOptions);
    if (payload.target.capture_type === "HVA_FOCUS_3D") entity.label = undefined;
    styleCaptureAssetModel(entity);
    let visibility = await waitForVisibleAsset(
        viewer,
        entity,
        preset,
        payload.target.capture_type === "HVA_FOCUS_3D" ? 30000 : 12000
    );
    let adjustmentCount = 0;
    const maximumAdjustments = payload.target.capture_type === "HVA_FOCUS_3D" ? 2 : 1;
    while (!visibility.passed && visibility.model_uri && adjustmentCount < maximumAdjustments) {
        adjustmentCount += 1;
        const measuredPixels = Number(visibility.actual_visual_size_pixels || 0);
        const targetPixels = Number(preset.target_visual_pixels || 180);
        const measuredRangeFactor = measuredPixels > 0
            ? Math.max(0.55, Math.min(1.35, measuredPixels / targetPixels))
            // No rendered pixels is a model-readiness signal, not evidence that
            // the camera is too far away. Keep the intended range while loading.
            : 1;
        const retryPreset = {
            ...preset,
            range_meters: preset.mode === "REGIONAL"
                ? Math.max(85000, Math.round(preset.range_meters * 0.68))
                : Math.max(9000, Math.min(36000, Math.round(preset.range_meters * measuredRangeFactor))),
            minimum_visual_pixels: Math.max(preset.minimum_visual_pixels, preset.mode === "REGIONAL" ? 128 : 180),
        };
        if (entity.model) entity.model.minimumPixelSize = retryPreset.minimum_visual_pixels;
        styleCaptureAssetModel(entity);
        if (payload.target.capture_type === "HVA_FOCUS_3D") {
            await applyReportAssetCamera(viewer, entity, retryPreset);
        } else {
            await focusForCapture({
                rangeMeters: retryPreset.range_meters,
                headingDegrees: retryPreset.heading_degrees,
                pitchDegrees: retryPreset.pitch_degrees,
                duration: 0,
            });
        }
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
        configured_maximum_scale: getGraphicValue(entity?.model?.maximumScale) ?? null,
        camera_heading: preset.heading_degrees,
        camera_pitch: preset.pitch_degrees,
        camera_range: preset.range_meters,
        computed_visual_target_pixels: preset.target_visual_pixels,
        selected_entity_cartesian: visibility.selected_entity_cartesian,
        camera_cartesian: visibility.camera_cartesian,
        camera_to_entity_distance_meters: visibility.camera_range_meters,
        model_bounding_sphere: visibility.model_bounding_sphere,
        model_pick_locations: visibility.model_pick_locations,
        anchor_to_picked_pixel_distance: visibility.anchor_to_closest_model_pick_pixels,
        focus_mode: preset.mode,
        map_mode: preset.map_mode,
        ctr_mode_active: viewer.__warzone?.isCtrModeActive?.() === true,
        visibility_adjusted_once: adjustmentCount > 0,
        visibility_adjustment_count: adjustmentCount,
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

function inspectMajorDevelopmentContext(payload, viewer) {
    if (payload.target.capture_type !== "MAJOR_DEVELOPMENT_CONTEXT") return null;
    const entity = state.target_event_entity;
    const position = getEntityPosition(entity);
    const screen = position ? Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position) : null;
    const cameraRange = position && viewer.camera?.positionWC
        ? Cesium.Cartesian3.distance(viewer.camera.positionWC, position)
        : Number.NaN;
    return {
        target_event_id: payload.target.event_id,
        related_cluster_id: payload.target.cluster_id || null,
        context_bounds: payload.camera.bounds || null,
        requested_context_radius_km: payload.target.recommended_context_radius_km || null,
        final_camera_range_meters: Number(payload.camera.range_meters || 0),
        final_camera_pitch_degrees: Number(payload.camera.pitch_degrees || 0),
        final_camera_heading_degrees: Number(payload.camera.heading_degrees || 0),
        actual_camera_to_event_distance_meters: Number.isFinite(cameraRange) ? Math.round(cameraRange) : null,
        event_screen_position: screen
            ? { x: Number(screen.x.toFixed(1)), y: Number(screen.y.toFixed(1)) }
            : null,
        rendered_related_cluster_ids: (payload.clusters || [])
            .filter((cluster) => String(cluster.cluster_id) === String(payload.target.cluster_id))
            .map((cluster) => cluster.cluster_id),
    };
}

function styleCaptureAssetModel(entity) {
    if (!entity?.model) return;
    // The operational basemap is intentionally dark. Outline only the frozen
    // report entity so its real GLB silhouette remains obvious in the JPG.
    entity.model.color = Cesium.Color.fromCssColorString("#b8dce6");
    entity.model.colorBlendMode = Cesium.ColorBlendMode.REPLACE;
    entity.model.colorBlendAmount = 1;
    entity.model.silhouetteColor = Cesium.Color.fromCssColorString("#31dce8").withAlpha(0.92);
    entity.model.silhouetteSize = 2;
    entity.model.customShader = undefined;
    entity.model.imageBasedLightingFactor = new Cesium.Cartesian2(2, 2);
    entity.model.lightColor = Cesium.Color.WHITE;
    entity.model.shadows = Cesium.ShadowMode.DISABLED;
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
    const includeClusters = ["REGIONAL_OVERVIEW_3D", "TACTICAL_OVERVIEW_2D", "MAJOR_DEVELOPMENT_CONTEXT", "CLUSTER_CONTEXT", "HVA_REGIONAL_CONTEXT", "AOI_CONTEXT"].includes(payload.target.capture_type);
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
    const assetPreset = isAssetFocusCapture ? await applyAssetFocus(payload, viewer) : null;
    if (!isAssetFocusCapture) await applyCamera(viewer, payload.camera);
    await waitForPromise(viewer.__warzoneImageryReadyPromise, 5000);
    await waitUntil(() => viewer.scene.globe?.tilesLoaded !== false, 5000);
    for (let index = 0; index < 12; index += 1) {
        viewer.scene.requestRender();
        await nextFrame();
    }
    if (assetPreset) {
        const assetEntity = state.selected_asset_entity;
        if (assetEntity.model) {
            assetEntity.model.minimumPixelSize = assetPreset.minimum_visual_pixels;
            assetEntity.model.maximumScale = undefined;
        }
        styleCaptureAssetModel(assetEntity);
        if (payload.target.capture_type === "HVA_FOCUS_3D") {
            await applyReportAssetCamera(viewer, assetEntity, assetPreset);
        }
        await nextFrame();
        await nextFrame();
        const finalVisibility = await verifyFinalAssetVisibility(
            viewer,
            assetEntity,
            assetPreset,
            state.asset_focus_debug.visibility_check
        );
        state.asset_focus_debug.visibility_check = finalVisibility;
        state.asset_focus_debug.selected_entity_cartesian = finalVisibility.selected_entity_cartesian;
        state.asset_focus_debug.camera_cartesian = finalVisibility.camera_cartesian;
        state.asset_focus_debug.camera_to_entity_distance_meters = finalVisibility.camera_range_meters;
        state.asset_focus_debug.model_bounding_sphere = finalVisibility.model_bounding_sphere;
        state.asset_focus_debug.model_pick_locations = finalVisibility.model_pick_locations;
        state.asset_focus_debug.anchor_to_picked_pixel_distance = finalVisibility.anchor_to_closest_model_pick_pixels;
        if (!finalVisibility.passed) throw new Error("asset_not_visible_in_final_capture_frame");
        // Camera-dependent live styling can run during the final framing step.
        // Reapply the capture-only presentation after validation so the actual
        // screenshot keeps the visible silhouette and non-overlapping label.
        await nextFrame();
        styleCaptureAssetModel(assetEntity);
        state.capture_label_entity = viewer.entities.add({
            id: `${assetEntity.id}-report-label`,
            position: getEntityPosition(assetEntity),
        });
        setCaptureAssetLabel(payload.selected_asset, state.capture_label_entity);
        viewer.render();
    }
    state.context_debug = inspectMajorDevelopmentContext(payload, viewer);
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
        context_debug: state.context_debug,
        asset_cleanup: state.asset_cleanup,
        semantic_quality: state.semantic_quality,
    };
}

async function cleanupCapture() {
    if (state.asset_cleanup?.completed === true) return state.asset_cleanup;
    const entityId = state.selected_asset_entity?.id || null;
    try {
        state.asset_adapter?.clear?.();
        const selectedEntity = entityId ? state.viewer?.entities?.getById?.(entityId) : null;
        if (selectedEntity) state.viewer.entities.remove(selectedEntity);
        if (state.capture_label_entity) state.viewer?.entities?.remove?.(state.capture_label_entity);
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
