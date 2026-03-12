// assets/js/warzone-globe.js
import * as Cesium from "cesium";

/* ---------- Data sources ---------- */
const BORDER_SOURCES = {
    countries: "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
    provinces: "",
    cities: "",
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
    switch (String(category || "").toLowerCase()) {
        case "strike":
            return cssVar("--warzone-strike", "#ff0753");
        case "recon":
            return cssVar("--warzone-recon", "#ff4d07");
        case "military":
            return cssVar("--warzone-military", "#56d80e");
        case "alert":
            return cssVar("--warzone-alert-color", "#ff2a2a");
        case "airspace":
            return cssVar("--warzone-airspace-color", "#00d8b2");
        case "cyber":
            return cssVar("--warzone-cyber-color", "#9b7bff");
        case "thermal":
            return cssVar("--warzone-thermal-color", "#ff7a00");
        case "signal":
            return cssVar("--warzone-signal-color", "#ffd24d");
        default:
            return cssVar("--warzone-default", "#ff7a45");
    }
}

function getSeverityRadius(event) {
    const base = numberVar("--warzone-event-ring-size", 55000);  // 55km base — visible and bold

    switch (event?.severity) {
        case "critical": return base * 1.8;
        case "high": return base * 1.45;
        case "medium": return base * 1.15;
        case "low": return base * 0.9;
        default: return base;
    }
}

// ── Cluster radius scales with count ─────────────────────────────────────────
function getClusterRadius(event) {
    const count = Number(event._clusterCount || 1);
    const base = getSeverityRadius(event);
    if (count <= 1) return base;
    // Logarithmic scale: 10 events → ~2x radius, 50 events → ~3x
    return base * (1 + Math.log10(count) * 0.9);
}

function getHeatRadius(event) {
    switch (event?.severity) {
        case "critical": return 110000;
        case "high": return 85000;
        case "medium": return 65000;
        default: return 50000;
    }
}

function isRenderableEvent(event) {
    return (
        event &&
        Number.isFinite(Number(event.lat)) &&
        Number.isFinite(Number(event.lon))
    );
}

/* ---------- Marker canvases ---------- */
function createMarkerCanvas(colorCss, count = 1) {
    const key = `${colorCss}|${count > 1 ? "cluster" : "single"}`;
    if (markerCache.has(key)) return markerCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;

    const ctx = canvas.getContext("2d");
    const cx = 48;
    const cy = 48;

    ctx.clearRect(0, 0, 96, 96);

    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 30);
    glow.addColorStop(0, colorCss);
    glow.addColorStop(0.25, "rgba(255,255,255,0.15)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();

    if (count > 1) {
        // Cluster: filled circle + count text
        ctx.fillStyle = colorCss;
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 18, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 18px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = count > 99 ? "99+" : String(count);
        ctx.fillText(label, cx, cy);
    } else {
        // Single event: original dot
        ctx.fillStyle = colorCss;
        ctx.beginPath();
        ctx.arc(cx, cy, 9, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.stroke();
    }

    const dataUrl = canvas.toDataURL("image/png");
    markerCache.set(key, dataUrl);
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

// ─── PRIMITIVE-BASED EVENT RENDERING ─────────────────────────────────────────
// Markers: BillboardCollection (1 draw call for all dots)
// Rings + fills: viewer.entities with suspendEvents (world-space meters — correct size at all zooms)
// Hybrid approach: best of both worlds
// ─────────────────────────────────────────────────────────────────────────────

let __billboards = null;      // BillboardCollection — marker dots only
const __primMap = new Map(); // eventId → { billboard, prim, outlinePrim }

function ensurePrimitiveCollections(viewer) {
    if (__billboards) return;
    __billboards = viewer.scene.primitives.add(
        new Cesium.BillboardCollection({ scene: viewer.scene })
    );
}

function clearEventEntities(viewer) {
    ensurePrimitiveCollections(viewer);
    __billboards.removeAll();
    for (const { prim, outlinePrim } of __primMap.values()) {
        if (prim) try { viewer.scene.primitives.remove(prim); } catch { }
        if (outlinePrim) try { viewer.scene.primitives.remove(outlinePrim); } catch { }
    }
    __primMap.clear();
}

function addEventEntity(viewer, event) {
    if (!isRenderableEvent(event)) return null;
    ensurePrimitiveCollections(viewer);

    const id = String(event.id || Math.random());
    const colorCss = getCategoryColorCss(event.category);
    const color = Cesium.Color.fromCssColorString(colorCss);
    const count = Number(event._clusterCount || 1);
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 50);

    // Remove existing if re-adding
    if (__primMap.has(id)) {
        const prev = __primMap.get(id);
        try { __billboards.remove(prev.billboard); } catch { }
        if (prev.prim) try { viewer.scene.primitives.remove(prev.prim); } catch { }
        if (prev.outlinePrim) try { viewer.scene.primitives.remove(prev.outlinePrim); } catch { }
        __primMap.delete(id);
    }

    const showMarkers = boolVar("--warzone-event-markers-visible", true);
    const showRings = boolVar("--warzone-event-rings-visible", true);
    const radius = getClusterRadius(event);
    const markerImg = createMarkerCanvas(colorCss, count);
    const markerScale = count > 1
        ? numberVar("--warzone-marker-scale", 1) * Math.min(1.4, 1 + Math.log10(count) * 0.15)
        : numberVar("--warzone-marker-scale", 1);
    const baseFillAlpha = numberVar("--warzone-event-ring-fill-alpha", 0.22);
    const fillAlpha = count > 1
        ? Math.max(0.06, baseFillAlpha - (Math.log10(count) * 0.03))
        : baseFillAlpha;
    const outlineAlpha = count > 1
        ? numberVar("--warzone-event-ring-outline-alpha", 0.82) * 0.7
        : numberVar("--warzone-event-ring-outline-alpha", 0.82);

    // 1. Marker dot — BillboardCollection (fast, batched)
    const billboard = __billboards.add({
        position: pos,
        image: markerImg,
        scale: markerScale,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: showMarkers,
        id: `event-${id}`,
    });

    // 2. Ring + fill — GeometryInstance batched into scene primitives
    // This is world-space (meters) like entity ellipse, but batched = 1 draw call per add
    let prim = null;
    if (showRings) {
        try {
            const instances = [
                // Fill
                new Cesium.GeometryInstance({
                    id: `event-fill-${id}`,
                    geometry: new Cesium.EllipseGeometry({
                        center: Cesium.Cartesian3.fromDegrees(lon, lat),
                        semiMajorAxis: radius,
                        semiMinorAxis: radius,
                        vertexFormat: Cesium.EllipseGeometry.VERTEX_FORMAT,
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            color.withAlpha(fillAlpha)
                        ),
                    },
                }),
            ];

            prim = viewer.scene.primitives.add(new Cesium.Primitive({
                geometryInstances: instances,
                appearance: new Cesium.PerInstanceColorAppearance({
                    flat: true,
                    translucent: true,
                }),
                asynchronous: false,  // sync compile — no pop-in
                allowPicking: false,
            }));

            // Outline ring as separate GroundPolyline-style ellipse outline
            const outlinePrim = viewer.scene.primitives.add(new Cesium.Primitive({
                geometryInstances: new Cesium.GeometryInstance({
                    id: `event-ring-${id}`,
                    geometry: new Cesium.EllipseOutlineGeometry({
                        center: Cesium.Cartesian3.fromDegrees(lon, lat),
                        semiMajorAxis: radius,
                        semiMinorAxis: radius,
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            color.withAlpha(outlineAlpha)
                        ),
                    },
                }),
                appearance: new Cesium.PerInstanceColorAppearance({
                    flat: true,
                    translucent: true,
                    renderState: { lineWidth: Math.min(2, viewer.scene.maximumAliasedLineWidth) },
                }),
                asynchronous: false,
                allowPicking: false,
            }));

            __primMap.set(id, { billboard, prim, outlinePrim, event });
            return { billboard, prim, outlinePrim };

        } catch (e) {
            // GeometryInstance failed (e.g. invalid coords) — skip ring
        }
    }

    __primMap.set(id, { billboard, prim: null, outlinePrim: null, event });
    return { billboard };
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
    viewer.scene.maximumRenderTimeChange = 1.0;
    viewer.resolutionScale = window.devicePixelRatio > 1 ? 0.85 : 1.0;  // 0.75 was too blurry

    // Performance: reduce GPU load
    viewer.scene.fog.enabled = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = false;
    }
    viewer.scene.globe.tileCacheSize = 100;
    viewer.scene.globe.maximumScreenSpaceError = 2.5;  // restored — 4 was too coarse/slow
    viewer.scene.globe.preloadSiblings = false;
    viewer.scene.globe.preloadAncestors = false;
    viewer.scene.globe.loadingDescendantLimit = 4;

    if (viewer.scene.postProcessStages?.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = boolVar("--warzone-fxaa-enabled", true);
    }

    viewer.scene.msaaSamples = numberVar("--warzone-msaa-samples", 1);

    // Destroy Cesium's default screenSpaceEventHandler.
    // By default it runs a GPU pick raycast on EVERY pointer event (click, move, hover)
    // to find selected entities — this causes 500–1000ms INP stalls.
    // We don't use Cesium's built-in selection system (infoBox/selectionIndicator are off),
    // so destroying it is safe. Camera controls are on screenSpaceCameraController (unaffected).
    if (viewer.screenSpaceEventHandler && !viewer.screenSpaceEventHandler.isDestroyed()) {
        viewer.screenSpaceEventHandler.destroy();
    }
}

function tuneImageryLayer(layer, prefix = "--warzone-map") {
    if (!layer) return;

    layer.brightness = numberVar(`${prefix}-brightness`, 0.65);
    layer.contrast = numberVar(`${prefix}-contrast`, 1.2);
    layer.gamma = numberVar(`${prefix}-gamma`, 0.85);
    layer.saturation = numberVar(`${prefix}-saturation`, 0.2);
    layer.hue = numberVar(`${prefix}-hue`, 0);    // raw value — Cesium cycles at 2π, 170 ≈ 0.44rad which gives correct tint
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

// Border layer collections — one per layer, populated in addGeoJsonBorderLayer
const __borderCollections = {};

function addPolylineForRing(viewer, ring, options) {
    const coords = flattenRingToDegrees(ring);
    if (coords.length < 4) return;

    // Get or create a PolylineCollection for this layer.
    // PolylineCollection renders ALL lines as a single GPU draw call — far faster
    // than viewer.entities which evaluates every entity dynamically every frame.
    const key = options.collectionKey || "default";
    if (!__borderCollections[key]) {
        __borderCollections[key] = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    }
    const col = __borderCollections[key];

    col.add({
        positions: Cesium.Cartesian3.fromDegreesArray(coords),
        width: options.width,
        material: Cesium.Material.fromType("Color", {
            color: options.color,
        }),
        loop: false,
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
            const countryName = (
                feature.properties?.ADMIN ||
                feature.properties?.name ||
                feature.properties?.NAME || ""
            ).toUpperCase();

            if (geometry.type === "Polygon") {
                const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                if (rings[0]) addPolylineForRing(viewer, rings[0], { color, width, countryName, collectionKey: config.name });
            } else if (geometry.type === "MultiPolygon") {
                const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const polygon of polygons) {
                    const rings = Array.isArray(polygon) ? polygon : [];
                    if (rings[0]) addPolylineForRing(viewer, rings[0], { color, width, countryName, collectionKey: config.name });
                }
            } else if (geometry.type === "LineString") {
                addPolylineForRing(viewer, geometry.coordinates, { color, width, countryName, collectionKey: config.name });
            } else if (geometry.type === "MultiLineString") {
                const lines = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const line of lines) addPolylineForRing(viewer, line, { color, width, countryName, collectionKey: config.name });
            }
        }

        console.log(`${config.name} borders added:`, features.length);
    } catch (error) {
        console.warn(`${config.name} borders skipped:`, error);
    }
}

async function addBorderLayers(viewer) {
    // Fetch and cache country GeoJSON globally — used by highlightAlertRegion
    try {
        const gj = await fetchGeoJson(BORDER_SOURCES.countries);
        window.__warzoneCountryGeoJson = gj;
    } catch { }

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

    // 1. Satellite base imagery
    const baseProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
    );

    // 2. ArcGIS place name labels — kept separate so they survive satellite toggle
    const labelsProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer"
    );

    const baseLayer = viewer.imageryLayers.addImageryProvider(baseProvider);
    const labelsLayer = viewer.imageryLayers.addImageryProvider(labelsProvider);

    tuneImageryLayer(baseLayer, "--warzone-map");
    tuneImageryLayer(labelsLayer, "--warzone-labels");
    labelsLayer.alpha = numberVar("--warzone-labels-alpha", 0.95);

    // Re-apply after CSS vars parsed
    requestAnimationFrame(() => {
        tuneImageryLayer(baseLayer, "--warzone-map");
        tuneImageryLayer(labelsLayer, "--warzone-labels");
        labelsLayer.alpha = numberVar("--warzone-labels-alpha", 0.95);
        viewer.scene.requestRender();
    });

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
        const count = Number(entity.properties?.clusterCount?.getValue?.() ?? 1);

        if (entity.billboard && !entity.properties?.isEventOutline?.getValue?.()) {
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
                const normalRadius = getClusterRadius({
                    severity: entity.properties?.severity?.getValue?.() ?? "medium",
                    _clusterCount: count,
                });
                const baseFillAlpha = numberVar("--warzone-event-ring-fill-alpha", 0.14);
                const fillAlpha = count > 1
                    ? Math.max(0.06, baseFillAlpha - (Math.log10(count) * 0.03))
                    : baseFillAlpha;

                entity.ellipse.show = true;
                entity.ellipse.semiMinorAxis = normalRadius;
                entity.ellipse.semiMajorAxis = normalRadius;
                entity.ellipse.material = color.withAlpha(fillAlpha);
                entity.ellipse.outline = true;
                entity.ellipse.outlineColor = color.withAlpha(
                    count > 1
                        ? numberVar("--warzone-event-ring-outline-alpha", 0.82) * 0.7
                        : numberVar("--warzone-event-ring-outline-alpha", 0.82)
                );
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

    return { t: clamped, lon, lat, height, cart: Cesium.Cartesian3.fromDegrees(lon, lat, height) };
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
        try { viewer.entities.remove(entity); } catch { }
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

    if (Number.isFinite(explicitRadius) && explicitRadius > 0) return explicitRadius;

    const targetScope = String(
        event?.target_scope || event?.target_type || event?.location_scope || ""
    ).toLowerCase();

    if (targetScope.includes("country") || targetScope.includes("national"))
        return numberVar("--warzone-incoming-highlight-radius-country", 260000);

    if (
        targetScope.includes("province") ||
        targetScope.includes("state") ||
        targetScope.includes("region") ||
        targetScope.includes("governorate")
    )
        return numberVar("--warzone-incoming-highlight-radius-region", 180000);

    return numberVar("--warzone-incoming-highlight-radius-city", 120000);
}

function makeIncomingWarningEntity(viewer, missileId, event, lon, lat) {
    const color = Cesium.Color.fromCssColorString(cssVar("--warzone-incoming-highlight-color", "#ff2a2a"));
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
        const color = Cesium.Color.fromCssColorString(cssVar("--warzone-incoming-highlight-color", "#ff2a2a"));

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
    if (track) track.highlightFrame = requestAnimationFrame(tick);
}

function makeImpactPulseEntities(viewer, missileId, lon, lat) {
    const stroke = cssVar("--warzone-missile-impact-color", "#ff2a2a");
    const img = createRingCanvas(stroke, 512, numberVar("--warzone-missile-impact-ring-line-width", 10));
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
    if (track) track.entities.push(...rings);

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
    if (track) track.impactFxFrame = requestAnimationFrame(tick);
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

    if (track) track.launchFxFrame = requestAnimationFrame(tick);

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

        segments.push({ entity: segment, t0, t1, baseAlpha });
        track.entities.push(segment);
    }

    track.segmentEntities = segments;
}

function fadeOutMissileTrack(viewer, missileId, durationMs = 1800) {
    ensureMissileStore(viewer);

    const track = viewer.__warzoneMissiles.get(missileId);
    if (!track || track.isFading) return;

    track.isFading = true;

    if (track.cleanupTimer) { clearTimeout(track.cleanupTimer); track.cleanupTimer = null; }
    if (track.highlightFrame) { cancelAnimationFrame(track.highlightFrame); track.highlightFrame = null; }

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
                segment.entity.polyline.material = activeTrack.lineBaseColor.withAlpha(segment.baseAlpha * fade);
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


/* ---------- Drone path (slow, low altitude, zigzag) ---------- */
function buildDroneState(originLon, originLat, impactLon, impactLat, steps = 80) {
    const positions = [];
    const samples = [];

    // Drones fly LOW — max 500m altitude, slight zigzag
    const peakHeight = 400;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const lon = lerp(originLon, impactLon, t);
        const lat = lerp(originLat, impactLat, t);

        // Very shallow arc + small lateral drift (zigzag)
        const arc = Math.sin(Math.PI * t) * peakHeight;
        const zigzag = Math.sin(t * Math.PI * 6) * 0.08;   // subtle weave
        const height = arc;

        const cart = Cesium.Cartesian3.fromDegrees(lon + zigzag, lat, height);
        positions.push(cart);
        samples.push({ t, lon: lon + zigzag, lat, height, cart });
    }

    return { positions, samples };
}

function isDroneEvent(event) {
    const weapon = String(event?.weapon_type || "").toLowerCase();
    const subcat = String(event?.subcategory || "").toLowerCase();
    const title = String(event?.title || "").toLowerCase();
    return (
        weapon.includes("drone") || weapon.includes("uav") ||
        subcat.includes("drone") || subcat.includes("uav") ||
        title.includes("shahed") || title.includes("drone") ||
        title.includes("kamikaze")
    );
}

function animateMissileTrack(viewer, event) {
    const originLon = Number(event.origin_lon);
    const originLat = Number(event.origin_lat);
    const impactLon = Number(event.impact_lon ?? event.lon);
    const impactLat = Number(event.impact_lat ?? event.lat);

    if (
        !Number.isFinite(originLon) || !Number.isFinite(originLat) ||
        !Number.isFinite(impactLon) || !Number.isFinite(impactLat)
    ) return null;

    const samePoint =
        Math.abs(originLat - impactLat) < 0.01 &&
        Math.abs(originLon - impactLon) < 0.01;

    if (samePoint) return null;

    ensureMissileStore(viewer);

    const missileId = `missile-${String(event.id || `${++viewer.__warzoneMissileSeq}`)}`;

    if (viewer.__warzoneMissiles.has(missileId)) clearOneMissileTrack(viewer, missileId);

    const peakHeight =
        event.severity === "critical"
            ? numberVar("--warzone-missile-peak-height-critical", 820000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-peak-height-high", 620000)
                : numberVar("--warzone-missile-peak-height-medium", 460000);

    // Drones are slower than missiles
    const durationMs = Number(
        event.animation_duration_ms ||
        (isDroneEvent(event)
            ? 14000   // drone: 14 seconds to travel
            : event.severity === "critical"
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

    // Drone events: slow low path. Missiles: high arc.
    const useDronePath = isDroneEvent(event);

    const { positions, samples } = useDronePath
        ? buildDroneState(originLon, originLat, impactLon, impactLat, 80)
        : buildArcState(
            originLon, originLat, impactLon, impactLat,
            peakHeight,
            Math.max(64, numberVar("--warzone-missile-steps", 120))
        );

    const launchColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-launch-color", "#ff2a2a"));
    const impactColor = Cesium.Color.fromCssColorString(cssVar("--warzone-missile-impact-color", "#ff2a2a"));

    const track = {
        id: missileId,
        entities: [],
        flightFrame: null, launchFxFrame: null, impactFxFrame: null,
        fadeFrame: null, highlightFrame: null, cleanupTimer: null,
        isFading: false, hasImpacted: false,
        segmentEntities: [], segmentPositions: [],
        launchMarker: null, impactMarker: null,
        lineBaseColor: useDronePath
            ? Cesium.Color.fromCssColorString("#ff8c00")   // drone = amber/orange
            : Cesium.Color.fromCssColorString(cssVar("--warzone-missile-line-color", "#ff2a2a")),
        lastImpactCart: null,
        warningOuter: null, warningInner: null, warningCore: null,
        warningBaseRadius: 0, alertSoundActive: false, impactSoundPlayed: false,
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
            if (eased <= segment.t0) return [positions[0], positions[0]];

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
            fadeOutMissileTrack(viewer, missileId, numberVar("--warzone-missile-fadeout-duration", 1800));
        }, persistMs);
    };

    track.flightFrame = requestAnimationFrame(step);
    return missileId;
}

// ─── Country border pulse highlight ───────────────────────────────────────────
// Highlights the actual country polygon border (not a circle)
// Finds matching country from cached GeoJSON, draws pulsing polylines on border
// ─────────────────────────────────────────────────────────────────────────────

// Point-in-polygon — ray casting
function pointInPolygon(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function findCountryFeature(lon, lat) {
    const geojson = window.__warzoneCountryGeoJson;
    if (!geojson?.features) return null;
    for (const feature of geojson.features) {
        const geo = feature?.geometry;
        if (!geo) continue;
        const polygons = geo.type === "Polygon"
            ? [geo.coordinates]
            : geo.type === "MultiPolygon" ? geo.coordinates : [];
        for (const poly of polygons) {
            if (poly[0] && pointInPolygon(lon, lat, poly[0])) return feature;
        }
    }
    return null;
}

function clearAlertHighlight(viewer) {
    if (viewer.__alertHighlightEntities) {
        viewer.entities.suspendEvents();
        viewer.__alertHighlightEntities.forEach(e => {
            try { viewer.entities.remove(e); } catch { }
        });
        viewer.entities.resumeEvents();
        viewer.__alertHighlightEntities = null;
    }
    if (viewer.__alertHighlightRAF) {
        cancelAnimationFrame(viewer.__alertHighlightRAF);
        viewer.__alertHighlightRAF = null;
    }
    if (viewer.__alertHighlightTimer) {
        clearTimeout(viewer.__alertHighlightTimer);
        viewer.__alertHighlightTimer = null;
    }
}

function buildBorderPositions(geometry, heightM = 4000) {
    // Returns array of Cartesian3[] — one per polygon outer ring.
    // heightM above ellipsoid ensures the highlight renders ON TOP of
    // the ground-clamped teal country borders (no Z-fighting).
    const results = [];
    const polygons = geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon" ? geometry.coordinates : [];

    for (const poly of polygons) {
        if (!poly[0] || poly[0].length < 3) continue;
        const positions = poly[0].map(([lon, lat]) =>
            Cesium.Cartesian3.fromDegrees(lon, lat, heightM)
        );
        if (positions.length > 2) results.push(positions);
    }
    return results;
}

function highlightAlertRegion(viewer, event) {
    clearAlertHighlight(viewer);
    if (!event || !Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lon))) return;

    const lon = Number(event.lon);
    const lat = Number(event.lat);
    const startTime = Date.now();

    // ── CSS var–driven config ────────────────────────────────────────────────
    // Override any of these in your :root to change color / timing / duration
    const BORDER_COLOR = cssVar("--warzone-highlight-border-color", "#ff2020");
    const FILL_COLOR = cssVar("--warzone-highlight-fill-color", "#cc0000");
    const BORDER_WIDTH = numberVar("--warzone-highlight-border-width", 5);
    const PULSE_SPEED = numberVar("--warzone-highlight-pulse-speed", 700);   // ms per cycle
    const DURATION = numberVar("--warzone-highlight-duration", 14000);  // auto-clear ms
    // ────────────────────────────────────────────────────────────────────────

    let phase = 0;
    const feature = findCountryFeature(lon, lat);
    const newEntities = [];

    if (feature?.geometry) {
        // NOTE: We do NOT hide the teal borders anymore.
        // The highlight polylines sit at 4000m height (set in buildBorderPositions)
        // so they always render cleanly ON TOP of the ground-clamped teal borders.

        const ringArrays = buildBorderPositions(feature.geometry, 4000);
        for (const positions of ringArrays) {
            // Soft outer glow — thin, low alpha
            newEntities.push(viewer.entities.add({
                polyline: {
                    positions,
                    width: BORDER_WIDTH + 3,
                    clampToGround: false,
                    arcType: Cesium.ArcType.RHUMB,
                    material: new Cesium.ColorMaterialProperty(
                        new Cesium.CallbackProperty(() => {
                            phase = ((Date.now() - startTime) / PULSE_SPEED) % (Math.PI * 2);
                            return Cesium.Color.fromCssColorString(BORDER_COLOR).withAlpha(
                                0.15 + Math.abs(Math.sin(phase)) * 0.2
                            );
                        }, false)
                    ),
                },
            }));
            // Sharp inner line — 1px clean
            newEntities.push(viewer.entities.add({
                polyline: {
                    positions,
                    width: BORDER_WIDTH,
                    clampToGround: false,
                    arcType: Cesium.ArcType.RHUMB,
                    material: new Cesium.ColorMaterialProperty(
                        new Cesium.CallbackProperty(() =>
                            Cesium.Color.fromCssColorString(BORDER_COLOR).withAlpha(
                                0.75 + Math.abs(Math.sin(phase)) * 0.25
                            ), false)
                    ),
                },
            }));
        }

        // Pulsing fill — all polygon pieces
        const geo = feature.geometry;
        const polys = geo.type === "Polygon" ? [geo.coordinates] : geo.coordinates;
        for (const poly of polys) {
            if (!poly[0] || poly[0].length < 4) continue;
            const flat = poly[0].flat();
            if (flat.length < 4) continue;
            newEntities.push(viewer.entities.add({
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(
                        Cesium.Cartesian3.fromDegreesArray(flat)
                    ),
                    material: new Cesium.ColorMaterialProperty(
                        new Cesium.CallbackProperty(() =>
                            Cesium.Color.fromCssColorString(FILL_COLOR).withAlpha(
                                0.09 + Math.abs(Math.sin(phase)) * 0.15
                            ), false)
                    ),
                    height: 0,
                    classificationType: Cesium.ClassificationType.TERRAIN,
                },
            }));
        }

    } else {
        // Fallback — no polygon match
        newEntities.push(viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            ellipse: {
                semiMinorAxis: 200000,
                semiMajorAxis: 200000,
                material: Cesium.Color.TRANSPARENT,
                outline: true,
                outlineColor: new Cesium.CallbackProperty(() => {
                    phase = ((Date.now() - startTime) / PULSE_SPEED) % (Math.PI * 2);
                    return Cesium.Color.fromCssColorString(BORDER_COLOR).withAlpha(
                        0.5 + Math.abs(Math.sin(phase)) * 0.5
                    );
                }, false),
                outlineWidth: 4,
                height: 0,
            },
        }));
    }

    viewer.__alertHighlightEntities = newEntities;

    function tick() {
        if (!viewer.__alertHighlightEntities) return;
        viewer.scene.requestRender();
        viewer.__alertHighlightRAF = requestAnimationFrame(tick);
    }
    viewer.__alertHighlightRAF = requestAnimationFrame(tick);

    viewer.__alertHighlightTimer = setTimeout(() => {
        clearAlertHighlight(viewer);
        viewer.scene.requestRender();
    }, DURATION);
}

/* ---------- Globe init ---------- */
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
        terrain: undefined,
        creditContainer: creditsEl || undefined,
    });

    applyViewerStyle(viewer);

    // Map loader disabled — shown only by warzone-boot.js during initial page load,
    // then hidden once the globe is ready. No tile/movement triggers.

    const { baseLayer, labelsLayer } = await addArcGisLayers(viewer);
    viewer.__imageryBase = baseLayer;
    viewer.__imageryLabels = labelsLayer;
    setInitialCamera(viewer);
    await addBorderLayers(viewer);

    ensureMissileStore(viewer);
    ensureAudioStore(viewer);

    viewer.scene.requestRender();

    // Re-cluster events when zoom changes significantly
    let __lastAlt = 0;
    let __reclusterTimer = null;
    viewer.camera.moveEnd.addEventListener(() => {
        try {
            const alt = viewer.camera.positionCartographic.height;
            // Only re-cluster if zoom changed significantly (2x difference)
            if (Math.abs(alt - __lastAlt) / Math.max(alt, __lastAlt, 1) > 0.4) {
                __lastAlt = alt;
                clearTimeout(__reclusterTimer);
                __reclusterTimer = setTimeout(() => {
                    // Tell essential.js to re-sync globe clusters
                    window.__warzoneGlobeNeedsRecluster = true;
                    window.dispatchEvent(new CustomEvent("wz:recluster"));
                }, 600);
            }
        } catch { }
    });

    viewer.__warzone = {
        // Border layer collections keyed by name ("Country", "Province", "City")
        // Set .show = true/false on each to toggle border layers.
        borderCollections: __borderCollections,

        addEvent(event) {
            if (!isRenderableEvent(event)) return null;
            const entity = addEventEntity(viewer, event);
            viewer.scene.requestRender();
            return entity;
        },

        addEvents(events = []) {
            const valid = Array.isArray(events) ? events.filter(isRenderableEvent) : [];
            if (!valid.length) return;
            valid.forEach((event) => addEventEntity(viewer, event));
            viewer.scene.requestRender();
        },

        clearEventEntities() { clearEventEntities(viewer); },
        focusRegion,
        refocusMiddleEast() {
            const cam = getStartCameraConfig();
            focusRegion(viewer, cam.lon, cam.lat, numberVar("--warzone-focus-height", 2350000));
        },
        setMapMode(mode) { setMapMode(viewer, mode); },
        setTerrainVisible(visible) {
            // Only hide the satellite base imagery — labels (cities/countries) always stay on
            if (viewer.__imageryBase) viewer.__imageryBase.show = visible;
            viewer.scene.requestRender();
        },

        /**
         * setPerformanceMode(visibleEventCount)
         * Dynamically adjusts Cesium render settings based on how many events
         * are currently visible on the globe.
         *
         *  0 events  → idle mode   — render only on user interaction (very low GPU)
         *  1–30      → light mode  — moderate render rate
         *  31+       → full mode   — normal render rate (missiles, tracks, pulses active)
         */
        setPerformanceMode(visibleCount = 0) {
            const s = viewer.scene;
            const baseResolution = window.devicePixelRatio > 1 ? 0.85 : 1.0;

            if (visibleCount === 0) {
                // Idle — render only on interaction, coarser tiles to save GPU
                s.requestRenderMode = true;
                s.maximumRenderTimeChange = 2.0;   // still re-render for borders/labels
                viewer.resolutionScale = baseResolution;
                s.globe.maximumScreenSpaceError = 3.5;
            } else if (visibleCount <= 30) {
                // Light — moderate render rate
                s.requestRenderMode = true;
                s.maximumRenderTimeChange = 1.5;
                viewer.resolutionScale = baseResolution;
                s.globe.maximumScreenSpaceError = 2.5;
            } else {
                // Full — missiles / pulse animations need continuous frames
                s.requestRenderMode = true;
                s.maximumRenderTimeChange = 0.5;
                viewer.resolutionScale = baseResolution;
                s.globe.maximumScreenSpaceError = 2.0;
            }
        },
        isTerrainVisible() {
            return viewer.__imageryBase ? viewer.__imageryBase.show : true;
        },
        highlightAlertRegion(event) { highlightAlertRegion(viewer, event); },
        clearAlertHighlight() { clearAlertHighlight(viewer); },
        animateMissileTrack(event) { return animateMissileTrack(viewer, event); },
        clearMissileTrack(id) {
            if (id) clearOneMissileTrack(viewer, id);
            else clearAllMissileTracks(viewer);
        },
        clearAllMissileTracks() { clearAllMissileTracks(viewer); },
        startAlertLoopSound() { startMissileAlertSound(viewer); },
        stopAlertLoopSound() { stopMissileAlertSound(viewer); },
        playImpactSound() { playImpactSound(viewer); },
    };

    return viewer;
}