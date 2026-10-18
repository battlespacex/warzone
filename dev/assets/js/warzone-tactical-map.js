import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getMapSources, getMapSelection, matchesMapFilter, rememberMapSelection, onMapDataChange } from "./warzone-map-bridge.js";
import { isLayerEnabled } from "./warzone-layers.js";
import { readTacticalTheme, tacticalStyle, syncTacticalTheme } from "./warzone-tactical-style.js";

const altitude = (type, r) => type === "naval" ? 0 : type === "satellite"
    ? Math.max(0, Number(r.altitudeKm) * 1000 || 0)
    : Math.max(0, Number(r.altitude_ft) * .3048 || Number(r.altitude_m) || 0);

const collection = (features = []) => ({ type: "FeatureCollection", features });
const validPoint = (record) => record && record.lon != null && record.lat != null
    && Number.isFinite(Number(record.lon)) && Number.isFinite(Number(record.lat))
    && Math.abs(Number(record.lat)) <= 90 && Math.abs(Number(record.lon)) <= 180;
const point = (id, record, properties) => ({ type: "Feature", id,
    geometry: { type: "Point", coordinates: [Number(record.lon), Number(record.lat)] }, properties });
const wrap = (value) => ((value + 180) % 360 + 360) % 360 - 180;

// Split at the antimeridian instead of drawing a trans-world trail.
function pathGeometry(history = []) {
    const segments = [];
    let segment = [];
    history.slice(-500).forEach((record) => {
        if (!validPoint(record)) return;
        const coord = [Number(record.lon), Number(record.lat)];
        if (segment.length && Math.abs(coord[0] - segment[segment.length - 1][0]) > 180) {
            if (segment.length > 1) segments.push(segment);
            segment = [];
        }
        segment.push(coord);
    });
    if (segment.length > 1) segments.push(segment);
    return { type: "MultiLineString", coordinates: segments };
}

function gridData() {
    const features = [];
    for (let lon = -180; lon < 180; lon += 15) features.push({
        type: "Feature", geometry: { type: "LineString", coordinates: [[lon, -85], [lon, 85]] }, properties: {},
    });
    for (let lat = -75; lat <= 75; lat += 15) features.push({
        type: "Feature", geometry: { type: "LineString", coordinates: [[-180, lat], [0, lat], [180, lat]] }, properties: {},
    });
    return collection(features);
}

// A handful of shared texture-atlas icons, never one canvas/DOM node per asset.
function installIcons(map, theme) {
    const shapes = {
        aircraft: [[16, 2], [19, 13], [29, 20], [29, 23], [19, 20], [19, 26], [23, 29], [9, 29], [13, 26], [13, 20], [3, 23], [3, 20], [13, 13]],
        helicopter: [[14, 4], [18, 4], [19, 15], [23, 20], [19, 24], [17, 24], [17, 29], [15, 29], [15, 24], [13, 24], [9, 20], [13, 15]],
        naval: [[16, 2], [23, 13], [23, 28], [9, 28], [9, 13]],
        submarine: [[16, 2], [20, 8], [20, 24], [16, 30], [12, 24], [12, 8]],
        satellite: [[13, 11], [19, 11], [19, 21], [13, 21]],
        events: [[16, 5], [27, 26], [5, 26]],
        bases: [[6, 6], [26, 6], [26, 26], [6, 26]],
        gnss: [[16, 3], [29, 16], [16, 29], [3, 16]],
    };
    Object.entries(shapes).forEach(([name, vertices]) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext("2d");
        ctx.scale(2, 2);
        const type = name === "helicopter" ? "aircraft" : name === "submarine" ? "naval" : name;
        ctx.fillStyle = theme[type + "-color"] || theme["event-color"];
        ctx.beginPath();
        vertices.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
        ctx.closePath();
        ctx.fill();
        if (name === "helicopter") ctx.fillRect(2, 9, 28, 2);
        if (name === "satellite") { ctx.fillRect(2, 8, 8, 16); ctx.fillRect(22, 8, 8, 16); }
        const data = ctx.getImageData(0, 0, 64, 64);
        if (map.hasImage(name)) map.updateImage(name, data);
        else map.addImage(name, data, { pixelRatio: 2 });
    });
}

function addOperationalLayers(map) {
    for (const id of ["tracks", "selection", "paths", "areas"]) map.addSource(id, { type: "geojson", data: collection() });
    map.addSource("grid", { type: "geojson", data: gridData() });
    map.addLayer({ id: "grid", type: "line", source: "grid", paint: { "line-width": .5 } });
    map.addLayer({ id: "intel-areas", type: "fill", source: "areas", paint: { "fill-opacity": .18 } });
    map.addLayer({ id: "track-path", type: "line", source: "paths", paint: { "line-width": 1.5, "line-opacity": .8 } });
    const markerOnly = ["!=", ["get", "focused3d"], true];
    map.addLayer({ id: "track-dots", type: "circle", source: "tracks", maxzoom: 5, filter: markerOnly,
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 5, 4] } });
    map.addLayer({ id: "track-icons", type: "symbol", source: "tracks", minzoom: 4, filter: markerOnly,
        layout: { "icon-image": ["get", "icon"], "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map", "icon-allow-overlap": true } });
    map.addLayer({ id: "track-labels", type: "symbol", source: "tracks", minzoom: 7, filter: markerOnly,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"],
            "text-offset": [0, 1.5], "text-anchor": "top", "text-max-width": 12, "text-padding": 12 },
        paint: { "text-halo-width": 1.5 } });
    // Separate one-feature source keeps the selected contact visible at all zooms.
    map.addLayer({ id: "selected-icon", type: "symbol", source: "selection", filter: markerOnly,
        layout: { "icon-image": ["get", "icon"], "icon-size": 1, "icon-rotate": ["get", "heading"],
            "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true } });
}

export async function createTacticalMap(container, camera, host) {
    const initializedAt = performance.now();
    let theme = readTacticalTheme();
    const map = new maplibregl.Map({
        container, style: tacticalStyle(theme), ...camera, attributionControl: false,
        minZoom: -4, maxZoom: 18, maxPitch: 85, renderWorldCopies: false, fadeDuration: 0,
        canvasContextAttributes: { antialias: true },
    });
    let dispose = () => map.remove();
    const ready = new Promise((resolve, reject) => {
        const cleanup = () => { map.off("render", rendered); map.off("webglcontextlost", lost); };
        const rendered = () => {
            if (!map.getCanvas().width || !map.getCanvas().height || !map.getLayer("track-dots")) return;
            cleanup(); resolve(true);
        };
        const lost = () => { cleanup(); reject(new Error("Tactical WebGL context lost before first frame")); };
        map.on("render", rendered);
        map.once("webglcontextlost", lost);
    });
    // The caller awaits this after renderer creation; handle early failures too.
    void ready.catch(() => {});
    try {
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-left");
        await new Promise((resolve, reject) => {
            const cleanup = () => { map.off("style.load", loaded); map.off("error", failed); };
            const loaded = () => { cleanup(); resolve(); };
            const failed = (event) => {
                if (event.sourceId || event.tile) return;
                cleanup(); reject(event.error || new Error("Tactical style initialization failed"));
            };
            // Local style readiness does not wait for remote tiles, DEM or glyphs.
            map.once("style.load", loaded);
            map.on("error", failed);
        });
    map.setProjection({ type: "globe" });
    addOperationalLayers(map);
    installIcons(map, theme);
    syncTacticalTheme(map, theme);
    const diagnosticsEnabled = typeof __STRATOPS_DEV_TOOLS__ !== "undefined" && __STRATOPS_DEV_TOOLS__
        && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const stats = { initializationMs: performance.now() - initializedAt, batches: 0, changedFeatures: 0,
        lastBatchMs: 0, lastUpdateAt: 0, renderedFrameIntervals: [], startedAt: performance.now() };
    const previous = new Map();
    const records = new Map();
    let timer = 0;
    let removed = false;
    let paused = false;
    let lastThemeKey = JSON.stringify(theme);
    let lastSelectionKey = "";
    let lastPathKey = "";
    let lastAreasKey = "";
    let lastFrame = 0;
    let layersKey = "";
    let lastFollowPoint = "";
    let themeObserver = null;
    let modelLayer = null;
    let modelImport = null;
    let modelAssets = [];
    let focusedTrail = null;
    let focusedRecord = null;
    let dataDirty = true;
    let dataQueued = false;
    const invalidateData = () => {
        dataDirty = true;
        if (dataQueued || removed) return;
        dataQueued = true;
        queueMicrotask(() => {
            dataQueued = false;
            if (!removed) {
                try { refresh(); } catch (error) { host.notice("Tactical update failed: " + error.message); }
            }
        });
    };
    const unsubscribe = onMapDataChange(invalidateData);
    const registryEvents = ["wz:aircraft-log-updated", "wz:naval-log-updated"];
    registryEvents.forEach((name) => document.addEventListener(name, invalidateData));
    function syncModels(assets) {
        modelAssets = assets;
        if (modelLayer) { modelLayer.setAssets(assets); return; }
        if (!assets.length || modelImport) return;
        modelImport = import("./warzone-tactical-models.js").then(({ createTacticalModelLayer }) => {
            if (removed) return;
            const layer = createTacticalModelLayer(host.notice, () => { if (!removed) refresh(); });
            map.addLayer(layer);
            modelLayer = layer;
            modelLayer.setPaused(paused);
            modelLayer.setAssets(modelAssets);
            modelLayer.setTrail(focusedTrail);
        }).catch((error) => host.notice("Tactical 3D unavailable: " + error.message + ". Satellite remains available."));
    }
    dispose = () => {
        if (removed) return;
        removed = true; clearTimeout(timer);
        unsubscribe();
        registryEvents.forEach((name) => document.removeEventListener(name, invalidateData));
        document.removeEventListener("visibilitychange", visibility);
        themeObserver?.disconnect();
        map.remove(); records.clear(); previous.clear();
    };

    function syncLayers() {
        const flags = ["terrain", "map-labels", "country-borders"].map(isLayerEnabled);
        const key = flags.join("|");
        if (key === layersKey) return;
        layersKey = key;
        const visible = (id, show) => map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
        visible("relief", flags[0]);
        for (const id of ["country-labels", "city-labels", "water-labels", "mountain-labels"]) visible(id, flags[1]);
        visible("countries", flags[2]); visible("states", flags[2]);
    }
    function syncFocusElevation(type, record) {
        map.setCenterClampedToGround(!record);
        const elevation = record ? altitude(type, record) : 0;
        if (map.getCenterElevation() !== elevation) map.setCenterElevation(elevation);
    }
    function refresh() {
        if (removed || paused || document.hidden) return;
        dataDirty = false;
        const started = performance.now();
        const nextTheme = readTacticalTheme();
        const themeKey = JSON.stringify(nextTheme);
        if (themeKey !== lastThemeKey) {
            theme = nextTheme; lastThemeKey = themeKey;
            installIcons(map, theme); syncTacticalTheme(map, theme);
        }
        syncLayers();
        const selected = getMapSelection();
        const next = new Map();
        const areas = [];
        const assets = [];
        records.clear();
        const bounds = map.getBounds();
        const center = map.getCenter();
        const halfWidth = Math.min(180, (bounds.getEast() - bounds.getWest()) * .65);
        const paddingLat = (bounds.getNorth() - bounds.getSouth()) * .15;
        let selectedFeature = null;
        let selectedRecord = null;
        getMapSources().forEach((adapter, type) => {
            if (adapter.layer && !isLayerEnabled(adapter.layer)) return;
            let snapshot;
            try { snapshot = adapter.snapshot(); }
            catch (error) {
                host.notice(type + " data temporarily unavailable: " + error.message);
                return;
            }
            for (const record of snapshot) {
                if (!validPoint(record) || !matchesMapFilter(type, record)) continue;
                const assetId = String(record.track_key ?? record.id ?? "");
                if (!assetId) continue;
                const id = type + ":" + assetId;
                const isSelected = selected?.type === type && selected.id === assetId;
                const formation = record.metadata?.simulation === "formation-dev-tuner";
                if (!isSelected && (Math.abs(wrap(Number(record.lon) - center.lng)) > halfWidth
                    || Number(record.lat) < bounds.getSouth() - paddingLat || Number(record.lat) > bounds.getNorth() + paddingLat)) continue;
                if (type !== "satellite" && (isSelected || formation) && adapter.model) {
                    try {
                        assets.push({ key: id, type, record, selected: isSelected,
                            pose: adapter.pose?.(record),
                            descriptor: adapter.model(record), color: theme["selected-color"] });
                    } catch (error) {
                        host.notice("Model metadata unavailable for " + assetId + ": " + error.message);
                    }
                }
                let icon = type;
                if (type === "aircraft" && /heli/i.test(record.subcategory || record.type || "")) icon = "helicopter";
                if (type === "naval" && /sub/i.test(record.subcategory || "")) icon = "submarine";
                const properties = { type, assetId, icon, heading: Number(record.heading_deg) || 0,
                    focused3d: Boolean((isSelected || formation) && modelLayer?.hasModel(id)),
                    label: String(record.callsign || record.vessel_name || record.title || record.name || assetId).slice(0, 100) };
                const feature = point(id, record, properties);
                records.set(id, record);
                next.set(id, { feature, signature: JSON.stringify(feature) });
                if (isSelected) { selectedFeature = feature; selectedRecord = record; }
                // Render actual supplied GNSS boundaries, not fabricated coverage.
                if (type === "gnss" && record.polygon?.length >= 3) {
                    const ring = record.polygon.filter(validPoint).map((p) => [Number(p.lon), Number(p.lat)]);
                    if (ring.length >= 3) {
                        ring.push(ring[0]);
                        areas.push({ type: "Feature", id, geometry: { type: "Polygon", coordinates: [ring] }, properties });
                    }
                }
            }
        });
        const add = [], update = [], remove = [];
        next.forEach(({ feature, signature }, id) => {
            if (!previous.has(id)) add.push(feature);
            else if (previous.get(id) !== signature) update.push({ id, newGeometry: feature.geometry,
                addOrUpdateProperties: Object.entries(feature.properties).map(([key, value]) => ({ key, value })) });
        });
        previous.forEach((_, id) => { if (!next.has(id)) remove.push(id); });
        if (add.length || update.length || remove.length) {
            map.getSource("tracks").updateData({ add, update, remove });
            previous.clear();
            next.forEach(({ signature }, id) => previous.set(id, signature));
            stats.batches++; stats.changedFeatures += add.length + update.length + remove.length;
        }
        const selectionKey = JSON.stringify(selectedFeature);
        if (selectionKey !== lastSelectionKey) {
            map.getSource("selection").setData(collection(selectedFeature ? [selectedFeature] : []));
            lastSelectionKey = selectionKey;
        }
        focusedRecord = selectedRecord;
        const adapter = getMapSources().get(selected?.type);
        focusedTrail = selectedRecord && adapter?.trail ? adapter.trail(selectedRecord) : null;
        // Keep airborne trail altitude instead of projecting its history onto sea level.
        const geometry = pathGeometry(focusedTrail ? [] : selectedRecord?.path_history);
        const pathKey = JSON.stringify(geometry);
        if (pathKey !== lastPathKey) {
            map.getSource("paths").setData(collection(geometry.coordinates.length
                ? [{ type: "Feature", geometry, properties: {} }] : []));
            lastPathKey = pathKey;
        }
        const areasKey = JSON.stringify(areas);
        if (areasKey !== lastAreasKey) { map.getSource("areas").setData(collection(areas)); lastAreasKey = areasKey; }
        syncModels(assets);
        modelLayer?.setTrail(focusedTrail);
        host.showSelection(selected, selectedRecord, selectedRecord ? map.project([selectedRecord.lon, selectedRecord.lat]) : null);
        const coords = selectedFeature?.geometry.coordinates;
        const followPoint = coords?.join(",") || "";
        if (!selected?.follow) lastFollowPoint = "";
        if (coords && selected.follow && !map.isMoving() && followPoint !== lastFollowPoint) {
            const nearestLon = map.getCenter().lng + wrap(coords[0] - map.getCenter().lng);
            syncFocusElevation(selected.type, selectedRecord);
            map.easeTo({ center: [nearestLon, coords[1]], duration: 450 });
            lastFollowPoint = followPoint;
        }
        stats.lastBatchMs = performance.now() - started;
        stats.lastUpdateAt = performance.now();
    }
    function schedule() {
        clearTimeout(timer); timer = 0;
        if (removed || paused || document.hidden) return;
        timer = setTimeout(() => {
            // Enabled orbital propagation is time-dependent even without new feed data.
            try { if (dataDirty || isLayerEnabled("orbital-assets")) refresh(); }
            catch (error) { host.notice("Tactical update interrupted: " + error.message + ". Satellite remains available."); }
            finally { schedule(); }
        }, 1000);
    }
    function visibility() {
        if (paused) return;
        if (document.hidden) { clearTimeout(timer); timer = 0; map.stop(); }
        else { map.resize(); refresh(); schedule(); }
    }
    function manualPan(event) {
        if (!event.originalEvent) return;
        const selected = getMapSelection();
        if (selected?.follow) rememberMapSelection({ ...selected, follow: false });
    }
    map.on("dragstart", manualPan);
    map.on("render", () => {
        if (removed || paused || document.hidden) return;
        const selected = getMapSelection();
        if (!selected || !focusedRecord) return;
        const key = selected.type + ":" + selected.id;
        const screen = modelLayer?.hasModel(key) ? modelLayer.screenPosition(key)
            : map.transform.isLocationOccluded(maplibregl.LngLat.convert([focusedRecord.lon, focusedRecord.lat]))
                ? null : map.project([focusedRecord.lon, focusedRecord.lat]);
        host.showSelection(selected, focusedRecord, screen);
    });
    let rotationAt = 0;
    map.on("render", () => {
        const rotation = window.__globeRotation;
        if (removed || paused || document.hidden || !rotation?.enabled || rotation.paused) {
            rotationAt = 0;
            return;
        }
        const now = performance.now();
        const elapsed = rotationAt ? Math.min(.1, (now - rotationAt) / 1000) : 0;
        rotationAt = now;
        if (!map.isMoving() && elapsed) map.jumpTo({
            bearing: map.getBearing() + (Number(rotation.speed) || .2) * elapsed,
        }, { stratopsRotationFrame: true });
        map.triggerRepaint();
    });
    // Wheel zoom does not unlock; subsequent follow only changes center, never zoom.
    map.on("moveend", (event) => {
        if (removed || event.stratopsRotationFrame) return;
        refresh();
        document.dispatchEvent(new CustomEvent("wz:tactical-camera-settled"));
    });
    map.on("click", (event) => {
        const selected = getMapSelection();
        const screen = selected && modelLayer?.screenPosition(selected.type + ":" + selected.id);
        if (screen && Math.hypot(screen.x - event.point.x, screen.y - event.point.y) < 40) {
            host.select(selected.type, selected.id);
            return;
        }
        const hits = map.queryRenderedFeatures([
            [event.point.x - 7, event.point.y - 7], [event.point.x + 7, event.point.y + 7],
        ], { layers: ["selected-icon", "track-icons", "track-dots", "intel-areas"] });
        const feature = hits[0];
        if (feature) host.select(feature.properties.type, feature.properties.assetId);
    });
    if (diagnosticsEnabled) map.on("render", () => {
        const now = performance.now();
        if (lastFrame && now - lastFrame < 250) {
            stats.renderedFrameIntervals.push(now - lastFrame);
            if (stats.renderedFrameIntervals.length > 120) stats.renderedFrameIntervals.shift();
        }
        lastFrame = now;
    });
    map.on("error", () => host.notice("Some map resources could not load. Live contacts may still be available; Satellite remains available."));
    document.addEventListener("visibilitychange", visibility);
    themeObserver = new MutationObserver(() => {
        dataDirty = true;
        if (!document.hidden) refresh();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    refresh(); schedule();
    return {
        map,
        ready,
        projectPoint(point) {
            if (map.transform.isLocationOccluded(maplibregl.LngLat.convert([point.lon, point.lat]))) return null;
            const model = map.transform.getMatrixForModel([point.lon, point.lat], Number(point.height) || 0);
            const projection = map.transform.getProjectionDataForCustomLayer().mainMatrix;
            const x = model[12], y = model[13], z = model[14];
            const w = projection[3] * x + projection[7] * y + projection[11] * z + projection[15];
            if (!(w > 0)) return null;
            return {
                x: ((projection[0] * x + projection[4] * y + projection[8] * z + projection[12]) / w + 1) * map.getCanvas().clientWidth / 2,
                y: (1 - (projection[1] * x + projection[5] * y + projection[9] * z + projection[13]) / w) * map.getCanvas().clientHeight / 2,
            };
        },
        requestRender: () => map.triggerRepaint(),
        refresh,
        pause() {
            paused = true;
            clearTimeout(timer); timer = 0;
            modelLayer?.setPaused(true);
            map.stop();
        },
        resume() {
            paused = false;
            modelLayer?.setPaused(false);
            map.resize(); refresh(); schedule();
        },
        setView(mode) {
            if (!["2d", "3d"].includes(mode)) return false;
            map.easeTo({ pitch: mode === "2d" || getMapSelection()?.type === "satellite" ? 0 : 45, duration: 500 });
            return true;
        },
        clearFocus() {
            syncFocusElevation("", null);
            map.setMaxZoom(18);
            modelLayer?.setAssets(modelAssets.filter((asset) => asset.record.metadata?.simulation === "formation-dev-tuner"));
        },
        select(type, id, options = {}) {
            if (type === "satellite") return false; // Native orbital focus is routed by the host.
            const adapter = getMapSources().get(type);
            if (!adapter || (adapter.layer && !isLayerEnabled(adapter.layer))) return false;
            const record = records.get(type + ":" + id) || adapter.snapshot().find((item) => String(item.track_key ?? item.id) === id);
            if (!validPoint(record) || !matchesMapFilter(type, record)) return false;
            syncFocusElevation(type, record);
            const formationKey = record.metadata?.formation_key;
            const group = formationKey ? adapter.snapshot().filter((r) => validPoint(r) &&
                r.metadata?.formation_key === formationKey && matchesMapFilter(type, r)) : [];
            const focusCamera = { ...adapter.camera?.(record), ...options };
            let zoom = type === "naval" ? 12 : 11;
            if (group.length > 1 || options.rangeMeters) {
                const span = Math.max(Number(options.rangeMeters) || 0, ...group.map((r) =>
                    Math.hypot(wrap(r.lon - record.lon) * Math.cos(record.lat * Math.PI / 180), r.lat - record.lat) * 111320));
                const mpp = Math.max(1, span * 3 / Math.max(1, Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight)));
                zoom = Math.log2(40075016.686 * Math.cos(record.lat * Math.PI / 180) / (512 * mpp));
            }
            if (group.length <= 1 && Number(focusCamera.rangeMeters) > 0) {
                const height = Math.max(1, Number(focusCamera.rangeMeters) * Math.sin(Math.abs(Number(focusCamera.pitchDegrees) || 45) * Math.PI / 180));
                const mpp = height * 2 * Math.tan(map.getVerticalFieldOfView() * Math.PI / 360) / Math.max(1, map.getCanvas().clientHeight);
                zoom = Math.log2(40075016.686 * Math.cos(record.lat * Math.PI / 180) / (512 * mpp));
            }
            map.easeTo({ center: [record.lon, record.lat], zoom: Math.max(-4, Math.min(16, zoom)),
                pitch: Math.max(0, Math.min(85, 90 + (Number(focusCamera.pitchDegrees) || -45))), duration: 650 });
            return record;
        },
        camera: () => ({ center: map.getCenter().toArray(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }),
        diagnostics: () => diagnosticsEnabled ? {
            ...stats, cachedFeatures: previous.size,
            renderedFrameMeanMs: stats.renderedFrameIntervals.length
                ? stats.renderedFrameIntervals.reduce((sum, ms) => sum + ms, 0) / stats.renderedFrameIntervals.length : null,
            renderedFps: stats.renderedFrameIntervals.length
                ? 1000 * stats.renderedFrameIntervals.length / stats.renderedFrameIntervals.reduce((sum, ms) => sum + ms, 0) : null,
            visibleFeatures: map.queryRenderedFeatures({ layers: ["track-icons", "track-dots"] }).length,
            enabledLayers: map.getStyle().layers.filter((layer) => layer.layout?.visibility !== "none").length,
            batchHz: stats.batches / Math.max(1, (performance.now() - stats.startedAt) / 1000),
            jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
            models: modelLayer?.diagnostics() || null,
            note: "Rendered frame intervals exclude idle gaps; not a benchmark or guaranteed FPS.",
        } : null,
        destroy: dispose,
    };
    } catch (error) {
        dispose();
        throw error;
    }
}
