import * as Cesium from "cesium";

/* ---------- Data sources ---------- */
const BORDER_SOURCES = {
    countries: "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
    provinces: "/assets/others/provinces.geojson",
    cities: "/assets/others/cities.geojson",
};

const markerCache = new Map();
const ringCanvasCache = new Map();

/* ---------- CSS helpers ---------- */
function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function numberVar(name, fallback) {
    const raw = cssVar(name, String(fallback));
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function boolVar(name, fallback = false) {
    const value = cssVar(name, fallback ? "1" : "0").toLowerCase();
    return value === "1" || value === "true" || value === "yes";
}

function stringVar(name, fallback = "") {
    return cssVar(name, fallback);
}

function stripCssUrl(value = "") {
    return String(value)
        .trim()
        .replace(/^url\((.*)\)$/i, "$1")
        .replace(/^["']|["']$/g, "")
        .trim();
}

function readCssAssetPath(name, fallback = "") {
    return stripCssUrl(stringVar(name, fallback));
}

function colorFromCssVar(name, fallback, alpha = 1) {
    return Cesium.Color.fromCssColorString(cssVar(name, fallback)).withAlpha(alpha);
}

/* ---------- Math helpers ---------- */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

/* ---------- Event helpers ---------- */
function getCategoryColorCss(category) {
    switch (category) {
        case "strike":
            return cssVar("--warzone-strike", "#ff5a4f");
        case "recon":
            return cssVar("--warzone-recon", "#57b8ff");
        case "military":
            return cssVar("--warzone-military", "#ffb020");
        default:
            return cssVar("--warzone-default", "#ff7a45");
    }
}

function getSeverityRadius(event) {
    const base = numberVar("--warzone-event-ring-size", 70000);

    switch (event?.severity) {
        case "critical":
            return base * 2;
        case "high":
            return base * 1.55;
        case "medium":
            return base * 1.2;
        case "low":
            return base;
        default:
            return base * 1.08;
    }
}

function getHeatRadius(event) {
    switch (event?.severity) {
        case "critical":
            return 240000;
        case "high":
            return 180000;
        case "medium":
            return 135000;
        default:
            return 100000;
    }
}

function normalizeEvents(events) {
    if (!Array.isArray(events)) return [];

    return events
        .map((item, index) => ({
            id: item.id || `event-${index + 1}`,
            title: item.title || "Untitled event",
            summary: item.summary || "",
            category: item.category || "strike",
            severity: item.severity || "medium",
            lat: Number(item.lat),
            lon: Number(item.lon),
            origin_lat: Number(item.origin_lat),
            origin_lon: Number(item.origin_lon),
            origin_label: item.origin_label || "",
            impact_lat: Number(item.impact_lat ?? item.lat),
            impact_lon: Number(item.impact_lon ?? item.lon),
            impact_label: item.impact_label || item.location_label || "",
            location_label: item.location_label || "Unknown location",
            occurred_at: item.occurred_at || "",
            confidence: Number(item.confidence ?? 50),
            animation_duration_ms: Number(item.animation_duration_ms),
            persist_ms: Number(item.persist_ms),
            target_type: item.target_type || "",
            target_scope: item.target_scope || "",
            location_scope: item.location_scope || "",
            highlight_radius_m: Number(item.highlight_radius_m),
            target_radius_m: Number(item.target_radius_m),
            incoming_highlight_radius_m: Number(item.incoming_highlight_radius_m),
        }))
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}

/* ---------- Marker canvases ---------- */
function createMarkerCanvas(colorCss) {
    if (markerCache.has(colorCss)) return markerCache.get(colorCss);

    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;

    const ctx = canvas.getContext("2d");
    const cx = 48;
    const cy = 48;

    ctx.clearRect(0, 0, 96, 96);

    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 30);
    glow.addColorStop(0, colorCss);
    glow.addColorStop(0.25, "rgba(255,255,255,0.15)");
    glow.addColorStop(1, "rgba(0,0,0,0)");

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = colorCss;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    const dataUrl = canvas.toDataURL("image/png");
    markerCache.set(colorCss, dataUrl);
    return dataUrl;
}

function createRingCanvas(strokeCss = "#ff2a2a", size = 512, lineWidth = 20) {
    const key = `${strokeCss}|${size}|${lineWidth}`;
    if (ringCanvasCache.has(key)) return ringCanvasCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    const r = (size - lineWidth * 2) / 2;

    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = strokeCss;
    ctx.stroke();

    const dataUrl = canvas.toDataURL("image/png");
    ringCanvasCache.set(key, dataUrl);
    return dataUrl;
}

/* ---------- Event entities ---------- */
function createEventEntity(event) {
    const colorCss = getCategoryColorCss(event.category);
    const color = Cesium.Color.fromCssColorString(colorCss);
    const marker = createMarkerCanvas(colorCss);
    const radius = getSeverityRadius(event);
    const heatRadius = getHeatRadius(event);

    const showEventMarkers = boolVar("--warzone-event-markers-visible", true);
    const showEventRings = boolVar("--warzone-event-rings-visible", true);

    const fillAlpha = numberVar("--warzone-event-ring-fill-alpha", 0.14);

    return {
        id: event.id,
        name: event.title,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat),
        billboard: {
            image: marker,
            scale: numberVar("--warzone-marker-scale", 1),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: showEventMarkers,
        },
        ellipse: {
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: color.withAlpha(fillAlpha),
            outline: false,
            height: 0,
            show: showEventRings,
        },
        properties: {
            title: event.title,
            summary: event.summary,
            category: event.category,
            severity: event.severity,
            location_label: event.location_label,
            occurred_at: event.occurred_at,
            confidence: event.confidence,
            heatRadius,
            radius,
            origin_lat: event.origin_lat,
            origin_lon: event.origin_lon,
            origin_label: event.origin_label,
            impact_lat: event.impact_lat,
            impact_lon: event.impact_lon,
            impact_label: event.impact_label,
        },
    };
}

function addEventEntity(viewer, event) {
    const entity = viewer.entities.add(createEventEntity(event));

    const colorCss = getCategoryColorCss(event.category);
    const outlineAlpha = numberVar("--warzone-event-ring-outline-alpha", 0.82);
    const outlineWidth = numberVar("--warzone-event-ring-outline-width", 3);
    const radius = getSeverityRadius(event);
    const showEventRings = boolVar("--warzone-event-rings-visible", true);

    const ringImage = createRingCanvas(
        colorCss,
        512,
        Math.max(2, Math.round(outlineWidth))
    );

    const ringEntity = viewer.entities.add({
        id: `${event.id}-outline`,
        position: Cesium.Cartesian3.fromDegrees(event.lon, event.lat, 10),
        billboard: {
            image: ringImage,
            scale: radius / 256,
            color: Cesium.Color.WHITE.withAlpha(outlineAlpha),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            show: showEventRings,
        },
        properties: {
            isEventOutline: true,
            category: event.category,
            severity: event.severity,
            heatRadius: getHeatRadius(event),
            radius,
        },
    });

    return { entity, ringEntity };
}

/* ---------- Viewer style ---------- */
function applyViewerStyle(viewer) {
    viewer.scene.skyBox.show = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
    viewer.scene.backgroundColor = colorFromCssVar("--warzone-space", "#02050b", 1);

    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.baseColor = colorFromCssVar("--warzone-globe-base", "#08111a", 1);
    viewer.scene.globe.depthTestAgainstTerrain = false;
    viewer.scene.globe.translucency.enabled = false;

    viewer.scene.fog.enabled = false;

    if (viewer.scene.screenSpaceCameraController) {
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableCollisionDetection = false;
        ctrl.inertiaSpin = numberVar("--warzone-camera-inertia-spin", 0.86);
        ctrl.inertiaTranslate = numberVar("--warzone-camera-inertia-translate", 0.82);
        ctrl.inertiaZoom = numberVar("--warzone-camera-inertia-zoom", 0.72);
        ctrl.maximumZoomDistance = numberVar("--warzone-camera-max-zoom", 22000000);
        ctrl.minimumZoomDistance = numberVar("--warzone-camera-min-zoom", 12000);
    }

    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
    viewer.resolutionScale = numberVar("--warzone-resolution-scale", 1);

    if (viewer.scene.postProcessStages?.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = boolVar("--warzone-fxaa-enabled", true);
    }

    viewer.scene.msaaSamples = numberVar("--warzone-msaa-samples", 1);
}

function tuneImageryLayer(layer, prefix = "--warzone-map") {
    if (!layer) return;

    layer.brightness = numberVar(`${prefix}-brightness`, 0.65);
    layer.contrast = numberVar(`${prefix}-contrast`, 1.2);
    layer.gamma = numberVar(`${prefix}-gamma`, 0.85);
    layer.saturation = numberVar(`${prefix}-saturation`, 0.2);
    layer.hue = numberVar(`${prefix}-hue`, 0);
    layer.alpha = numberVar(`${prefix}-alpha`, 1);
}

function getStartCameraConfig() {
    return {
        lon: numberVar("--warzone-start-lon", 47.8),
        lat: numberVar("--warzone-start-lat", 30.2),
        height: numberVar("--warzone-start-height", 2350000),
        heading: numberVar("--warzone-start-heading", 0),
        pitch: numberVar("--warzone-start-pitch", -82),
        roll: numberVar("--warzone-start-roll", 0),
    };
}

function setInitialCamera(viewer) {
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            numberVar("--warzone-start-lon", 47.8),
            numberVar("--warzone-start-lat", 30.2),
            numberVar("--warzone-start-height", 2350000)
        ),
        orientation: {
            heading: Cesium.Math.toRadians(numberVar("--warzone-start-heading", 0)),
            pitch: Cesium.Math.toRadians(numberVar("--warzone-start-pitch", -82)),
            roll: Cesium.Math.toRadians(numberVar("--warzone-start-roll", 0)),
        },
    });

    viewer.scene.requestRender();
}

function focusRegion(
    viewer,
    lon = numberVar("--warzone-start-lon", 47.8),
    lat = numberVar("--warzone-start-lat", 30.2),
    height = numberVar("--warzone-focus-height", 2350000)
) {
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        orientation: {
            heading: Cesium.Math.toRadians(numberVar("--warzone-start-heading", 0)),
            pitch: Cesium.Math.toRadians(numberVar("--warzone-start-pitch", -82)),
            roll: Cesium.Math.toRadians(numberVar("--warzone-start-roll", 0)),
        },
        duration: 0.9,
    });
}

/* ---------- Borders ---------- */
function flattenRingToDegrees(ring) {
    const out = [];

    for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2) continue;

        const lon = Number(coord[0]);
        const lat = Number(coord[1]);

        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        out.push(lon, lat);
    }

    return out;
}

function addPolylineForRing(viewer, ring, options) {
    const coords = flattenRingToDegrees(ring);
    if (coords.length < 4) return;

    viewer.entities.add({
        polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords),
            width: options.width,
            material: options.color,
            clampToGround: false,
        },
    });
}

async function fetchGeoJson(url) {
    if (!url) return null;

    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) {
        throw new Error(`GeoJSON fetch failed: ${response.status}`);
    }

    return response.json();
}

async function addGeoJsonBorderLayer(viewer, config) {
    if (!config?.url) return;

    try {
        const geojson = await fetchGeoJson(config.url);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        const color = colorFromCssVar(
            config.colorVar,
            config.fallbackColor,
            numberVar(config.alphaVar, config.fallbackAlpha)
        );
        const width = numberVar(config.widthVar, config.fallbackWidth);

        for (const feature of features) {
            const geometry = feature?.geometry;
            if (!geometry) continue;

            if (geometry.type === "Polygon") {
                const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                if (rings[0]) addPolylineForRing(viewer, rings[0], { color, width });
            } else if (geometry.type === "MultiPolygon") {
                const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const polygon of polygons) {
                    const rings = Array.isArray(polygon) ? polygon : [];
                    if (rings[0]) addPolylineForRing(viewer, rings[0], { color, width });
                }
            } else if (geometry.type === "LineString") {
                addPolylineForRing(viewer, geometry.coordinates, { color, width });
            } else if (geometry.type === "MultiLineString") {
                const lines = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const line of lines) addPolylineForRing(viewer, line, { color, width });
            }
        }

        console.log(`${config.name} borders added:`, features.length);
    } catch (error) {
        console.warn(`${config.name} borders skipped:`, error);
    }
}

async function addBorderLayers(viewer) {
    await addGeoJsonBorderLayer(viewer, {
        name: "Country",
        url: BORDER_SOURCES.countries,
        colorVar: "--warzone-country-border",
        fallbackColor: "#33e1ff",
        alphaVar: "--warzone-country-border-alpha",
        fallbackAlpha: 0.72,
        widthVar: "--warzone-country-border-width",
        fallbackWidth: 1.4,
    });

    await addGeoJsonBorderLayer(viewer, {
        name: "Province",
        url: BORDER_SOURCES.provinces,
        colorVar: "--warzone-province-border",
        fallbackColor: "#2ab6ff",
        alphaVar: "--warzone-province-border-alpha",
        fallbackAlpha: 0.55,
        widthVar: "--warzone-province-border-width",
        fallbackWidth: 1,
    });

    await addGeoJsonBorderLayer(viewer, {
        name: "City",
        url: BORDER_SOURCES.cities,
        colorVar: "--warzone-city-border",
        fallbackColor: "#78d5ff",
        alphaVar: "--warzone-city-border-alpha",
        fallbackAlpha: 0.38,
        widthVar: "--warzone-city-border-width",
        fallbackWidth: 0.8,
    });
}

async function addArcGisLayers(viewer) {
    viewer.imageryLayers.removeAll();

    const baseProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
    );

    const labelsProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer"
    );

    const baseLayer = viewer.imageryLayers.addImageryProvider(baseProvider);
    tuneImageryLayer(baseLayer, "--warzone-map");

    const labelsLayer = viewer.imageryLayers.addImageryProvider(labelsProvider);
    tuneImageryLayer(labelsLayer, "--warzone-labels");
    labelsLayer.alpha = numberVar("--warzone-labels-alpha", 0.95);

    return { baseLayer, labelsLayer };
}

/* ---------- Map mode ---------- */
function setMapMode(viewer, mode = "map") {
    const entities = viewer.entities.values;

    for (const entity of entities) {
        if (!entity.properties) continue;

        const heatRadius = Number(entity.properties?.heatRadius?.getValue?.() ?? 140000);
        const category = String(entity.properties?.category?.getValue?.() ?? "strike");
        const colorCss = getCategoryColorCss(category);
        const color = Cesium.Color.fromCssColorString(colorCss);

        if (entity.billboard) {
            const allowMarker = boolVar("--warzone-event-markers-visible", true);
            entity.billboard.show = mode !== "heatmap" && allowMarker;
        }

        if (entity.ellipse) {
            const allowRing = boolVar("--warzone-event-rings-visible", true);
            if (!allowRing) {
                entity.ellipse.show = false;
                continue;
            }

            if (mode === "heatmap") {
                entity.ellipse.show = true;
                entity.ellipse.semiMinorAxis = heatRadius;
                entity.ellipse.semiMajorAxis = heatRadius;
                entity.ellipse.material = color.withAlpha(0.32);
                entity.ellipse.outline = false;
            } else {
                const normalRadius = getSeverityRadius({
                    severity: entity.properties?.severity?.getValue?.() ?? "medium",
                });
                entity.ellipse.show = true;
                entity.ellipse.semiMinorAxis = normalRadius;
                entity.ellipse.semiMajorAxis = normalRadius;
                entity.ellipse.material = color.withAlpha(numberVar("--warzone-event-ring-fill-alpha", 0.14));
                entity.ellipse.outline = true;
                entity.ellipse.outlineColor = color.withAlpha(numberVar("--warzone-event-ring-outline-alpha", 0.82));
            }
        }
    }

    viewer.scene.requestRender();
}

/* ---------- Missile geometry ---------- */
function buildArcState(originLon, originLat, impactLon, impactLat, peakHeight = 420000, steps = 96) {
    const positions = [];
    const samples = [];

    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const lon = lerp(originLon, impactLon, t);
        const lat = lerp(originLat, impactLat, t);
        const arc = Math.sin(Math.PI * t);
        const height = arc * peakHeight;

        const cart = Cesium.Cartesian3.fromDegrees(lon, lat, height);
        positions.push(cart);
        samples.push({ t, lon, lat, height, cart });
    }

    return { positions, samples };
}

function interpolateSample(samples, t) {
    const clamped = clamp01(t);

    if (clamped <= 0) return samples[0];
    if (clamped >= 1) return samples[samples.length - 1];

    const maxIndex = samples.length - 1;
    const scaled = clamped * maxIndex;
    const i0 = Math.floor(scaled);
    const i1 = Math.min(i0 + 1, maxIndex);
    const localT = scaled - i0;

    const a = samples[i0];
    const b = samples[i1];

    const lon = lerp(a.lon, b.lon, localT);
    const lat = lerp(a.lat, b.lat, localT);
    const height = lerp(a.height, b.height, localT);

    return {
        t: clamped,
        lon,
        lat,
        height,
        cart: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    };
}

function alphaRampFromOrigin(t) {
    const fadeStart = numberVar("--warzone-missile-origin-fade-start", 0);
    const fadeEnd = numberVar("--warzone-missile-origin-fade-end", 0.3);
    const alphaMin = numberVar("--warzone-missile-origin-alpha-min", 0.2);
    const alphaMax = numberVar("--warzone-missile-origin-alpha-max", 1);

    if (t <= fadeStart) return alphaMin;
    if (t >= fadeEnd) return alphaMax;

    const local = (t - fadeStart) / Math.max(0.0001, fadeEnd - fadeStart);
    return lerp(alphaMin, alphaMax, easeInOutCubic(local));
}

/* ---------- Audio ---------- */
function safeCreateAudio(src, volume = 1, loop = false) {
    try {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.loop = loop;
        audio.volume = clamp01(volume);
        return audio;
    } catch {
        return null;
    }
}

function ensureAudioStore(viewer) {
    if (viewer.__warzoneAudio) return viewer.__warzoneAudio;

    const alertSrc = readCssAssetPath("--warzone-sound-alert-loop", "/assets/audio/warzone-alert-loop.mp3");
    const impactSrc = readCssAssetPath("--warzone-sound-impact", "/assets/audio/warzone-impact.mp3");

    viewer.__warzoneAudio = {
        alertLoop: safeCreateAudio(alertSrc, numberVar("--warzone-sound-alert-volume", 0.65), true),
        impactSrc,
        impactVolume: clamp01(numberVar("--warzone-sound-impact-volume", 0.9)),
        activeAlertCount: 0,
    };

    return viewer.__warzoneAudio;
}

function startMissileAlertSound(viewer) {
    const store = ensureAudioStore(viewer);
    store.activeAlertCount += 1;

    if (store.activeAlertCount === 1 && store.alertLoop) {
        try {
            store.alertLoop.currentTime = 0;
            store.alertLoop.play().catch(() => { });
        } catch { }
    }
}

function stopMissileAlertSound(viewer) {
    const store = ensureAudioStore(viewer);
    store.activeAlertCount = Math.max(0, store.activeAlertCount - 1);

    if (store.activeAlertCount === 0 && store.alertLoop) {
        try {
            store.alertLoop.pause();
            store.alertLoop.currentTime = 0;
        } catch { }
    }
}

function playImpactSound(viewer) {
    const store = ensureAudioStore(viewer);
    if (!store.impactSrc) return;

    try {
        const audio = new Audio(store.impactSrc);
        audio.preload = "auto";
        audio.volume = store.impactVolume;
        audio.currentTime = 0;
        audio.play().catch(() => { });
    } catch { }
}

/* ---------- Missile store ---------- */
function ensureMissileStore(viewer) {
    if (!viewer.__warzoneMissiles) viewer.__warzoneMissiles = new Map();
    if (!viewer.__warzoneMissileSeq) viewer.__warzoneMissileSeq = 0;
    if (!viewer.__warzoneMissileOrder) viewer.__warzoneMissileOrder = [];
}

function clearOneMissileTrack(viewer, missileId) {
    ensureMissileStore(viewer);

    const track = viewer.__warzoneMissiles.get(missileId);
    if (!track) return;

    if (track.flightFrame) cancelAnimationFrame(track.flightFrame);
    if (track.launchFxFrame) cancelAnimationFrame(track.launchFxFrame);
    if (track.impactFxFrame) cancelAnimationFrame(track.impactFxFrame);
    if (track.fadeFrame) cancelAnimationFrame(track.fadeFrame);
    if (track.highlightFrame) cancelAnimationFrame(track.highlightFrame);
    if (track.cleanupTimer) clearTimeout(track.cleanupTimer);

    if (track.alertSoundActive) {
        stopMissileAlertSound(viewer);
        track.alertSoundActive = false;
    }

    for (const entity of track.entities || []) {
        try {
            viewer.entities.remove(entity);
        } catch { }
    }

    viewer.__warzoneMissiles.delete(missileId);
    viewer.__warzoneMissileOrder = viewer.__warzoneMissileOrder.filter((id) => id !== missileId);
}

function clearAllMissileTracks(viewer) {
    ensureMissileStore(viewer);

    for (const missileId of viewer.__warzoneMissiles.keys()) {
        clearOneMissileTrack(viewer, missileId);
    }
}

function enforceMissileCap(viewer) {
    ensureMissileStore(viewer);

    const maxActive = Math.max(1, numberVar("--warzone-max-active-missiles", 12));

    while (viewer.__warzoneMissileOrder.length > maxActive) {
        const oldestId = viewer.__warzoneMissileOrder[0];
        if (!oldestId) break;
        clearOneMissileTrack(viewer, oldestId);
    }
}

/* ---------- Warning + impact FX ---------- */
function getIncomingHighlightRadius(event) {
    const explicitRadius =
        Number(event?.highlight_radius_m) ||
        Number(event?.target_radius_m) ||
        Number(event?.incoming_highlight_radius_m);

    if (Number.isFinite(explicitRadius) && explicitRadius > 0) {
        return explicitRadius;
    }

    const targetScope = String(
        event?.target_scope ||
        event?.target_type ||
        event?.location_scope ||
        ""
    ).toLowerCase();

    if (targetScope.includes("country") || targetScope.includes("national")) {
        return numberVar("--warzone-incoming-highlight-radius-country", 260000);
    }

    if (
        targetScope.includes("province") ||
        targetScope.includes("state") ||
        targetScope.includes("region") ||
        targetScope.includes("governorate")
    ) {
        return numberVar("--warzone-incoming-highlight-radius-region", 180000);
    }

    return numberVar("--warzone-incoming-highlight-radius-city", 120000);
}

function makeIncomingWarningEntity(viewer, missileId, event, lon, lat) {
    const color = Cesium.Color.fromCssColorString(
        cssVar("--warzone-incoming-highlight-color", "#ff2a2a")
    );
    const radius = getIncomingHighlightRadius(event);
    const height = numberVar("--warzone-warning-height", 4000);

    const warning = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        ellipse: {
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: color.withAlpha(0.95),
            outlineWidth: numberVar("--warzone-incoming-highlight-outline-width", 6),
            height,
        },
    });

    const inner = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        ellipse: {
            semiMinorAxis: radius * 0.58,
            semiMajorAxis: radius * 0.58,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: color.withAlpha(0.75),
            outlineWidth: Math.max(2, numberVar("--warzone-incoming-highlight-outline-width", 6) - 2),
            height,
        },
    });

    const core = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height + 1000),
        billboard: {
            image: createRingCanvas(cssVar("--warzone-incoming-highlight-color", "#ff2a2a"), 256, 14),
            scale: 0.22,
            color: Cesium.Color.WHITE.withAlpha(1),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });

    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.entities.push(warning, inner, core);
        track.warningOuter = warning;
        track.warningInner = inner;
        track.warningCore = core;
        track.warningBaseRadius = radius;
    }

    return { warning, inner, core };
}

function hideIncomingWarning(track) {
    if (track?.warningOuter) track.warningOuter.show = false;
    if (track?.warningInner) track.warningInner.show = false;
    if (track?.warningCore) track.warningCore.show = false;
}

function animateIncomingWarning(viewer, missileId) {
    const tick = () => {
        const track = viewer.__warzoneMissiles.get(missileId);
        if (!track || track.isFading || track.hasImpacted) return;

        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
        const color = Cesium.Color.fromCssColorString(
            cssVar("--warzone-incoming-highlight-color", "#ff2a2a")
        );

        if (track.warningOuter?.ellipse) {
            const r = track.warningBaseRadius * (0.92 + pulse * 0.16);
            track.warningOuter.ellipse.semiMinorAxis = r;
            track.warningOuter.ellipse.semiMajorAxis = r;
            track.warningOuter.ellipse.outlineColor = color.withAlpha(0.72 + pulse * 0.28);
        }

        if (track.warningInner?.ellipse) {
            const r = track.warningBaseRadius * (0.5 + pulse * 0.12);
            track.warningInner.ellipse.semiMinorAxis = r;
            track.warningInner.ellipse.semiMajorAxis = r;
            track.warningInner.ellipse.outlineColor = color.withAlpha(0.5 + pulse * 0.35);
        }

        if (track.warningCore?.billboard) {
            track.warningCore.billboard.scale = 0.18 + pulse * 0.18;
            track.warningCore.billboard.color = Cesium.Color.WHITE.withAlpha(0.5 + pulse * 0.45);
        }

        viewer.scene.requestRender();
        track.highlightFrame = requestAnimationFrame(tick);
    };

    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.highlightFrame = requestAnimationFrame(tick);
    }
}

function makeImpactPulseEntities(viewer, missileId, lon, lat) {
    const stroke = cssVar("--warzone-missile-impact-color", "#ff2a2a");
    const img = createRingCanvas(
        stroke,
        512,
        numberVar("--warzone-missile-impact-ring-line-width", 10)
    );
    const height = numberVar("--warzone-missile-impact-height", 5000);

    const rings = [];
    const ringCount = Math.max(3, numberVar("--warzone-missile-impact-ring-count", 3));

    for (let i = 0; i < ringCount; i += 1) {
        const ring = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, height),
            billboard: {
                image: img,
                scale: 0.03,
                color: Cesium.Color.WHITE.withAlpha(0.01),
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
        rings.push(ring);
    }

    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.entities.push(...rings);
    }

    return rings;
}

function animateImpactPulse(viewer, missileId, rings) {
    const startedAt = performance.now();

    const cycles = Math.max(1, numberVar("--warzone-missile-impact-cycles", 3));
    const cycleDuration = Math.max(1200, numberVar("--warzone-missile-impact-cycle-duration", 5580));
    const staggerMs = Math.max(80, numberVar("--warzone-missile-impact-ring-stagger-ms", 620));

    const minScale = numberVar("--warzone-missile-impact-ring-min-scale", 0.02);
    const maxScale = numberVar("--warzone-missile-impact-ring-max-scale", 0.30);
    const alphaMax = clamp01(numberVar("--warzone-missile-impact-ring-alpha-max", 0.60));

    const totalDuration = cycles * cycleDuration;

    const tick = () => {
        const track = viewer.__warzoneMissiles.get(missileId);
        if (!track) return;

        const elapsed = performance.now() - startedAt;

        const globalFadeWindow = Math.min(1600, cycleDuration * 0.35);
        const globalFadeStart = totalDuration - globalFadeWindow;
        const globalFade =
            elapsed <= globalFadeStart
                ? 1
                : 1 - easeInOutCubic(clamp01((elapsed - globalFadeStart) / globalFadeWindow));

        if (elapsed >= totalDuration) {
            try {
                for (const ring of rings) viewer.entities.remove(ring);
                track.entities = track.entities.filter((e) => !rings.includes(e));
            } catch { }
            track.impactFxFrame = null;
            viewer.scene.requestRender();
            return;
        }

        const cycleTime = elapsed % cycleDuration;
        const activeWindow = cycleDuration * 0.9;

        for (let i = 0; i < rings.length; i += 1) {
            const ring = rings[i];
            if (!ring?.billboard) continue;

            const localElapsed = cycleTime - (i * staggerMs);

            if (localElapsed <= 0 || localElapsed >= activeWindow) {
                ring.billboard.scale = minScale;
                ring.billboard.color = Cesium.Color.WHITE.withAlpha(0);
                continue;
            }

            const t = clamp01(localElapsed / activeWindow);
            const grow = easeOutCubic(t);
            const scale = lerp(minScale, maxScale, grow);

            let alpha;
            if (t < 0.14) {
                alpha = alphaMax * easeOutCubic(t / 0.14);
            } else {
                const fadeT = clamp01((t - 0.14) / 0.86);
                alpha = alphaMax * Math.pow(1 - fadeT, 2.15);
            }

            alpha *= globalFade;

            ring.billboard.scale = scale;
            ring.billboard.color = Cesium.Color.WHITE.withAlpha(alpha);
        }

        viewer.scene.requestRender();
        track.impactFxFrame = requestAnimationFrame(tick);
    };

    const track = viewer.__warzoneMissiles.get(missileId);
    if (track) {
        track.impactFxFrame = requestAnimationFrame(tick);
    }
}

function makeLaunchFlashEntity(viewer, missileId, lon, lat, color = Cesium.Color.ORANGE) {
    const createdAt = performance.now();
    const track = viewer.__warzoneMissiles.get(missileId);

    const launchRing = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        ellipse: {
            semiMinorAxis: 1,
            semiMajorAxis: 1,
            material: color.withAlpha(0.18),
            outline: true,
            outlineColor: color.withAlpha(0.85),
            outlineWidth: 2,
            height: 0,
        },
    });

    const launchPoint = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
            pixelSize: 8,
            color: Cesium.Color.WHITE.withAlpha(0.95),
            outlineColor: color.withAlpha(0.95),
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });

    const tick = () => {
        const activeTrack = viewer.__warzoneMissiles.get(missileId);
        if (!activeTrack) return;

        const elapsed = performance.now() - createdAt;
        const duration = Math.max(300, numberVar("--warzone-missile-launch-flash-duration", 900));
        const t = clamp01(elapsed / duration);

        if (t >= 1) {
            try {
                viewer.entities.remove(launchRing);
                viewer.entities.remove(launchPoint);
                activeTrack.entities = activeTrack.entities.filter(
                    (entity) => entity !== launchRing && entity !== launchPoint
                );
            } catch { }
            activeTrack.launchFxFrame = null;
            viewer.scene.requestRender();
            return;
        }

        const radius = Math.round(12000 + easeOutCubic(t) * numberVar("--warzone-missile-launch-ring-size", 65000));
        const alpha = Math.max(0, 0.28 - t * 0.24);

        if (launchRing.ellipse) {
            launchRing.ellipse.semiMinorAxis = radius;
            launchRing.ellipse.semiMajorAxis = radius;
            launchRing.ellipse.material = color.withAlpha(alpha * 0.35);
            launchRing.ellipse.outlineColor = color.withAlpha(alpha + 0.2);
        }

        if (launchPoint.point) {
            launchPoint.point.pixelSize = 8 + (1 - t) * 7;
            launchPoint.point.color = Cesium.Color.WHITE.withAlpha(0.45 + (1 - t) * 0.5);
            launchPoint.point.outlineColor = color.withAlpha(0.65 + (1 - t) * 0.25);
        }

        viewer.scene.requestRender();
        activeTrack.launchFxFrame = requestAnimationFrame(tick);
    };

    if (track) {
        track.launchFxFrame = requestAnimationFrame(tick);
    }

    return [launchRing, launchPoint];
}

function createMissileSegmentEntities(viewer, track, positions) {
    const segmentCount = Math.max(6, Math.floor(numberVar("--warzone-missile-segment-count", 22)));
    const width = numberVar("--warzone-missile-line-width", 5);
    const lineAlpha = numberVar("--warzone-missile-line-alpha", 1);

    const segments = [];

    for (let i = 0; i < segmentCount; i += 1) {
        const t0 = i / segmentCount;
        const t1 = (i + 1) / segmentCount;
        const baseAlpha = alphaRampFromOrigin((t0 + t1) * 0.5) * lineAlpha;

        const segment = viewer.entities.add({
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    const item = track.segmentPositions?.[i];
                    return item && item.length >= 2 ? item : [positions[0], positions[0]];
                }, false),
                width,
                material: track.lineBaseColor.withAlpha(baseAlpha),
                clampToGround: false,
            },
        });

        segments.push({
            entity: segment,
            t0,
            t1,
            baseAlpha,
        });

        track.entities.push(segment);
    }

    track.segmentEntities = segments;
}

function fadeOutMissileTrack(viewer, missileId, durationMs = 1800) {
    ensureMissileStore(viewer);

    const track = viewer.__warzoneMissiles.get(missileId);
    if (!track || track.isFading) return;

    track.isFading = true;

    if (track.cleanupTimer) {
        clearTimeout(track.cleanupTimer);
        track.cleanupTimer = null;
    }

    if (track.highlightFrame) {
        cancelAnimationFrame(track.highlightFrame);
        track.highlightFrame = null;
    }

    const startedAt = performance.now();
    const launchColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-launch-color", "#ff2a2a"));
    const impactColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-impact-color", "#ff2a2a"));

    const step = () => {
        const activeTrack = viewer.__warzoneMissiles.get(missileId);
        if (!activeTrack) return;

        const elapsed = performance.now() - startedAt;
        const t = clamp01(elapsed / durationMs);
        const fade = 1 - easeInOutCubic(t);

        if (Array.isArray(activeTrack.segmentEntities)) {
            for (const segment of activeTrack.segmentEntities) {
                if (!segment?.entity?.polyline) continue;
                segment.entity.polyline.material =
                    activeTrack.lineBaseColor.withAlpha(segment.baseAlpha * fade);
            }
        }

        if (activeTrack.launchMarker?.point) {
            activeTrack.launchMarker.point.color = launchColor.withAlpha(fade);
            activeTrack.launchMarker.point.outlineColor = Cesium.Color.WHITE.withAlpha(fade);
        }

        if (activeTrack.impactMarker?.point) {
            activeTrack.impactMarker.point.color = impactColor.withAlpha(0.92 * fade);
            activeTrack.impactMarker.point.outlineColor = impactColor.withAlpha(0.35 * fade);
        }

        if (activeTrack.launchMarker?.label) {
            activeTrack.launchMarker.label.fillColor = launchColor.withAlpha(fade);
            activeTrack.launchMarker.label.outlineColor = Cesium.Color.BLACK.withAlpha(fade);
        }

        if (activeTrack.impactMarker?.label) {
            activeTrack.impactMarker.label.fillColor = impactColor.withAlpha(fade);
            activeTrack.impactMarker.label.outlineColor = Cesium.Color.BLACK.withAlpha(fade);
        }

        viewer.scene.requestRender();

        if (t < 1) {
            activeTrack.fadeFrame = requestAnimationFrame(step);
            return;
        }

        activeTrack.fadeFrame = null;
        clearOneMissileTrack(viewer, missileId);
        viewer.scene.requestRender();
    };

    track.fadeFrame = requestAnimationFrame(step);
}

function animateMissileTrack(viewer, event) {
    const originLon = Number(event.origin_lon);
    const originLat = Number(event.origin_lat);
    const impactLon = Number(event.impact_lon ?? event.lon);
    const impactLat = Number(event.impact_lat ?? event.lat);

    if (
        !Number.isFinite(originLon) ||
        !Number.isFinite(originLat) ||
        !Number.isFinite(impactLon) ||
        !Number.isFinite(impactLat)
    ) {
        return null;
    }

    ensureMissileStore(viewer);

    const missileId = String(event.id || `missile-${++viewer.__warzoneMissileSeq}`);

    if (viewer.__warzoneMissiles.has(missileId)) {
        clearOneMissileTrack(viewer, missileId);
    }

    const peakHeight =
        event.severity === "critical"
            ? numberVar("--warzone-missile-peak-height-critical", 820000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-peak-height-high", 620000)
                : numberVar("--warzone-missile-peak-height-medium", 460000);

    const durationMs = Number(
        event.animation_duration_ms ||
        (event.severity === "critical"
            ? numberVar("--warzone-missile-duration-critical", 9000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-duration-high", 7500)
                : numberVar("--warzone-missile-duration-medium", 6200))
    );

    const persistMs = Number(
        event.persist_ms ||
        (event.severity === "critical"
            ? numberVar("--warzone-missile-persist-critical", 12000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-persist-high", 10000)
                : numberVar("--warzone-missile-persist-medium", 8000))
    );

    const { positions, samples } = buildArcState(
        originLon,
        originLat,
        impactLon,
        impactLat,
        peakHeight,
        Math.max(64, numberVar("--warzone-missile-steps", 120))
    );

    const launchColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-launch-color", "#ff2a2a"));
    const impactColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-impact-color", "#ff2a2a"));

    const track = {
        id: missileId,
        entities: [],
        flightFrame: null,
        launchFxFrame: null,
        impactFxFrame: null,
        fadeFrame: null,
        highlightFrame: null,
        cleanupTimer: null,
        isFading: false,
        hasImpacted: false,
        segmentEntities: [],
        segmentPositions: [],
        launchMarker: null,
        impactMarker: null,
        lineBaseColor: Cesium.Color.fromCssColorString(cssVar("--warzone-missile-line-color", "#ff2a2a")),
        lastImpactCart: null,
        warningOuter: null,
        warningInner: null,
        warningCore: null,
        warningBaseRadius: 0,
        alertSoundActive: false,
        impactSoundPlayed: false,
    };

    viewer.__warzoneMissiles.set(missileId, track);
    viewer.__warzoneMissileOrder.push(missileId);
    enforceMissileCap(viewer);

    createMissileSegmentEntities(viewer, track, positions);

    const launchMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(originLon, originLat),
        point: {
            pixelSize: 10,
            color: launchColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
            show: false,
            text: event.origin_label || "Launch",
            font: "bold 14px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -34),
            fillColor: launchColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    track.entities.push(launchMarker);
    track.launchMarker = launchMarker;

    const impactMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(impactLon, impactLat, numberVar("--warzone-impact-marker-height", 4000)),
        point: {
            pixelSize: 7,
            color: impactColor.withAlpha(0.98),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.2),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
            show: false,
            text: event.impact_label || event.location_label || "Impact",
            font: "bold 14px sans-serif",
            pixelOffset: new Cesium.Cartesian2(0, -40),
            fillColor: impactColor,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    track.entities.push(impactMarker);
    track.impactMarker = impactMarker;

    makeIncomingWarningEntity(viewer, missileId, event, impactLon, impactLat);

    const launchFx = makeLaunchFlashEntity(viewer, missileId, originLon, originLat, launchColor);
    track.entities.push(...launchFx);

    startMissileAlertSound(viewer);
    track.alertSoundActive = true;

    if (boolVar("--warzone-missile-auto-focus", true)) {
        viewer.camera.flyTo({
            destination: Cesium.Rectangle.fromDegrees(
                Math.min(originLon, impactLon) - 2.8,
                Math.min(originLat, impactLat) - 2.2,
                Math.max(originLon, impactLon) + 2.8,
                Math.max(originLat, impactLat) + 2.2
            ),
            duration: numberVar("--warzone-missile-focus-duration", 0.95),
        });
    }

    animateIncomingWarning(viewer, missileId);

    const startedAt = performance.now();

    const step = () => {
        const activeTrack = viewer.__warzoneMissiles.get(missileId);
        if (!activeTrack || activeTrack.isFading) return;

        const elapsed = performance.now() - startedAt;
        const t = clamp01(elapsed / durationMs);
        const eased = easeInOutCubic(t);

        const current = interpolateSample(samples, eased);
        activeTrack.lastImpactCart = current.cart;

        const segmentGap = clamp01(numberVar("--warzone-missile-segment-gap", 0.02));

        activeTrack.segmentPositions = activeTrack.segmentEntities.map((segment) => {
            if (eased <= segment.t0) {
                return [positions[0], positions[0]];
            }

            const visibleEnd = Math.min(eased, segment.t1);
            const localEnd = interpolateSample(samples, visibleEnd).cart;
            const localStartT = Math.max(segment.t0, 0);

            if (visibleEnd <= localStartT + segmentGap) {
                const p = interpolateSample(samples, visibleEnd).cart;
                return [p, p];
            }

            const localStart = interpolateSample(samples, localStartT).cart;
            return [localStart, localEnd];
        });

        viewer.scene.requestRender();

        if (t < 1) {
            activeTrack.flightFrame = requestAnimationFrame(step);
            return;
        }

        activeTrack.flightFrame = null;

        if (activeTrack.alertSoundActive) {
            stopMissileAlertSound(viewer);
            activeTrack.alertSoundActive = false;
        }

        if (!activeTrack.impactSoundPlayed) {
            playImpactSound(viewer);
            activeTrack.impactSoundPlayed = true;
        }

        activeTrack.hasImpacted = true;
        hideIncomingWarning(activeTrack);

        const pulseEntities = makeImpactPulseEntities(viewer, missileId, impactLon, impactLat);
        animateImpactPulse(viewer, missileId, pulseEntities);

        viewer.scene.requestRender();

        activeTrack.cleanupTimer = setTimeout(() => {
            fadeOutMissileTrack(
                viewer,
                missileId,
                numberVar("--warzone-missile-fadeout-duration", 1800)
            );
        }, persistMs);
    };

    track.flightFrame = requestAnimationFrame(step);
    return missileId;
}

function clearAlertHighlight(viewer) {
    if (viewer.__warzoneAlertEntity) {
        viewer.entities.remove(viewer.__warzoneAlertEntity);
        viewer.__warzoneAlertEntity = null;
    }
}

function highlightAlertRegion(viewer, event) {
    clearAlertHighlight(viewer);

    if (!event || !Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lon))) return;

    const radius =
        event.severity === "critical" ? 420000 :
            event.severity === "high" ? 320000 :
                event.severity === "medium" ? 240000 :
                    180000;

    viewer.__warzoneAlertEntity = viewer.entities.add({
        id: `alert-highlight-${Date.now()}`,
        position: Cesium.Cartesian3.fromDegrees(Number(event.lon), Number(event.lat), 3000),
        ellipse: {
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.RED.withAlpha(0.95),
            outlineWidth: 4,
            height: 3000,
        },
    });

    viewer.scene.requestRender();

    setTimeout(() => {
        clearAlertHighlight(viewer);
        viewer.scene.requestRender();
    }, 9000);
}

export async function initWarzoneGlobe() {
    const globeEl = document.getElementById("warzone-globe");
    const creditsEl = document.getElementById("warzone-map-credits");

    if (!globeEl) return null;

    const viewer = new Cesium.Viewer(globeEl, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: false,
        scene3DOnly: true,
        requestRenderMode: true,
        skyAtmosphere: false,
        terrain: undefined,
        creditContainer: creditsEl || undefined,
    });

    applyViewerStyle(viewer);
    await addArcGisLayers(viewer);
    setInitialCamera(viewer);
    await addBorderLayers(viewer);

    ensureMissileStore(viewer);
    ensureAudioStore(viewer);

    viewer.scene.requestRender();

    viewer.__warzone = {
        addEvent(event) {
            const entity = addEventEntity(viewer, event);
            viewer.scene.requestRender();
            return entity;
        },
        addEvents(events = []) {
            const normalized = normalizeEvents(events);
            normalized.forEach((event) => addEventEntity(viewer, event));
            viewer.scene.requestRender();
        },
        focusRegion,
        refocusMiddleEast() {
            const cam = getStartCameraConfig();
            focusRegion(viewer, cam.lon, cam.lat, numberVar("--warzone-focus-height", 2350000));
        },
        setMapMode(mode) {
            setMapMode(viewer, mode);
        },
        highlightAlertRegion(event) {
            highlightAlertRegion(viewer, event);
        },
        clearAlertHighlight() {
            clearAlertHighlight(viewer);
        },
        animateMissileTrack(event) {
            return animateMissileTrack(viewer, event);
        },
        clearMissileTrack(id) {
            if (id) {
                clearOneMissileTrack(viewer, id);
            } else {
                clearAllMissileTracks(viewer);
            }
        },
        clearAllMissileTracks() {
            clearAllMissileTracks(viewer);
        },
        startAlertLoopSound() {
            startMissileAlertSound(viewer);
        },
        stopAlertLoopSound() {
            stopMissileAlertSound(viewer);
        },
        playImpactSound() {
            playImpactSound(viewer);
        },
    };

    return viewer;
}