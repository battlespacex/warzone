// File Path: /assets/js/warzone-globe.js
import * as Cesium from "cesium";
import { resolveDisplayCoordinates } from "./warzone-location-resolver.js";
import { isStratOpsFeatureEnabled } from "./stratops-feature-config.js";
import {
    buildSpatialEventClusters,
    classifyEventDomain,
    getClusterDistanceKm,
    scoreToRadius,
} from "./warzone-event-cluster-model.js";
import {
    ZOOM_UX_STATES,
    getClusterBucketForZoomState,
    getZoomUxState,
    selectCollisionSafeLabels,
} from "./warzone-map-zoom-ux.js";
/* ---------- Data sources ---------- */
const BORDER_SOURCES = {
    countries: [
        "/assets/data/ne_110m_admin_0_countries.geojson",
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    ],
    provinces: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
    cities: "https://raw.githubusercontent.com/drei01/geojson-world-cities/master/cities.geojson",
};
const PLACE_LABELS = [
    { name: "RIYADH", lon: 46.6753, lat: 24.7136, type: "city" },
    { name: "JEDDAH", lon: 39.1979, lat: 21.4858, type: "city" },
    { name: "MAKKAH", lon: 39.8579, lat: 21.3891, type: "province" },
    { name: "EASTERN PROVINCE", lon: 49.6833, lat: 24.0, type: "province" },
    { name: "KUWAIT CITY", lon: 47.9774, lat: 29.3759, type: "city" },
    { name: "DOHA", lon: 51.531, lat: 25.2854, type: "city" },
    { name: "ABU DHABI", lon: 54.3773, lat: 24.4539, type: "city" },
    { name: "DUBAI", lon: 55.2708, lat: 25.2048, type: "city" },
    { name: "MUSCAT", lon: 58.4059, lat: 23.588, type: "city" },
    { name: "TEHRAN", lon: 51.389, lat: 35.6892, type: "city" },
    { name: "ISFAHAN", lon: 51.6776, lat: 32.6539, type: "city" },
    { name: "BAGHDAD", lon: 44.3661, lat: 33.3152, type: "city" },
    { name: "BASRA", lon: 47.7835, lat: 30.5085, type: "city" },
    { name: "AMMAN", lon: 35.9304, lat: 31.9539, type: "city" },
    { name: "DAMASCUS", lon: 36.2765, lat: 33.5138, type: "city" },
    { name: "TEL AVIV", lon: 34.7818, lat: 32.0853, type: "city" },
    { name: "GAZA", lon: 34.4668, lat: 31.5017, type: "city" },
    { name: "SANAA", lon: 44.191, lat: 15.3694, type: "city" },
    { name: "ADEN", lon: 45.0187, lat: 12.7855, type: "city" },
    { name: "KARACHI", lon: 67.0011, lat: 24.8607, type: "city" },
    { name: "ISLAMABAD", lon: 73.0479, lat: 33.6844, type: "city" },
    { name: "LAHORE", lon: 74.3587, lat: 31.5204, type: "city" },
    { name: "BALOCHISTAN", lon: 65.0, lat: 28.5, type: "province" },
    { name: "SINDH", lon: 68.8, lat: 26.3, type: "province" },
    { name: "PUNJAB", lon: 72.4, lat: 31.0, type: "province" },
    { name: "NEW DELHI", lon: 77.209, lat: 28.6139, type: "city" },
    { name: "MUMBAI", lon: 72.8777, lat: 19.076, type: "city" },
    { name: "GUJARAT", lon: 71.1924, lat: 22.2587, type: "province" },
    { name: "MAHARASHTRA", lon: 75.7139, lat: 19.7515, type: "province" },
    { name: "BEIJING", lon: 116.4074, lat: 39.9042, type: "city" },
    { name: "SHANGHAI", lon: 121.4737, lat: 31.2304, type: "city" },
    { name: "GUANGDONG", lon: 113.2665, lat: 23.1322, type: "province" },
    { name: "TAIWAN", lon: 120.9605, lat: 23.6978, type: "province" },
    { name: "TAIPEI", lon: 121.5654, lat: 25.033, type: "city" },
    { name: "HANOI", lon: 105.8342, lat: 21.0278, type: "city" },
    { name: "HO CHI MINH CITY", lon: 106.6297, lat: 10.8231, type: "city" },
    { name: "MANILA", lon: 120.9842, lat: 14.5995, type: "city" },
    { name: "SOUTH CHINA SEA", lon: 114.5, lat: 12.0, type: "sea" },
    { name: "SPRATLY ISLANDS", lon: 114.3, lat: 10.0, type: "sea" },
    { name: "TOKYO", lon: 139.6917, lat: 35.6895, type: "city" },
    { name: "OSAKA", lon: 135.5023, lat: 34.6937, type: "city" },
    { name: "OKINAWA", lon: 127.6792, lat: 26.2124, type: "province" },
    { name: "SEOUL", lon: 126.978, lat: 37.5665, type: "city" },
    { name: "BUSAN", lon: 129.0756, lat: 35.1796, type: "city" },
    { name: "KYIV", lon: 30.5234, lat: 50.4501, type: "city" },
    { name: "DONBAS", lon: 37.8, lat: 48.2, type: "province" },
    { name: "CRIMEA", lon: 34.2, lat: 45.3, type: "province" },
    { name: "MOSCOW", lon: 37.6173, lat: 55.7558, type: "city" },
    { name: "ST PETERSBURG", lon: 30.3351, lat: 59.9343, type: "city" },
];
const RAISED_REGION_EXPLICIT_ISO2 = {
    middle_east: new Set(["AE", "BH", "CY", "EG", "IL", "IQ", "IR", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"]),
    levant: new Set(["CY", "EG", "IL", "JO", "LB", "PS", "SY", "TR"]),
    ukraine: new Set(["UA", "RU", "BY", "PL", "RO", "MD", "LT", "LV", "EE"]),
};
const RAISED_REGION_CONTINENT_MATCH = {
    africa: "AFRICA",
    europe: "EUROPE",
    north_america: "NORTH AMERICA",
    south_america: "SOUTH AMERICA",
    oceania: "OCEANIA",
};
const RAISED_REGION_SUBREGION_MATCH = {
    central_asia: new Set(["CENTRAL ASIA"]),
    south_asia: new Set(["SOUTHERN ASIA"]),
    east_asia: new Set(["EASTERN ASIA", "SOUTH-EASTERN ASIA"]),
    latin_america: new Set(["CENTRAL AMERICA", "CARIBBEAN"]),
};
const markerCache = new Map();
const ringCanvasCache = new Map();
const eventLabelCanvasCache = new Map();
const MARKER_CACHE_MAX_ITEMS = 220;
const RING_CACHE_MAX_ITEMS = 40;
const SATELLITE_BADGE_CACHE_KEY = "event-satellite-badge";
const SATELLITE_IMAGERY_MARKER_CACHE_KEY = "satellite-imagery-marker";
const __eventEntityIds = new Set();
const __eventPulseEntities = new Set();
const __EVENT_LOD_STATE = {
    mode: "map",
    cameraHeight: 2350000,
};
const ADAPTIVE_QUALITY_PROFILES = ["normal", "balanced", "conservative", "safe"];
const STARTUP_CAMERA = {
    lon: 40,
    lat: 22,
    height: 5800000,
    heading: 0,
    pitch: -90,
    roll: 0,
};
function clearEventMarkerVisualCaches() {
    markerCache.clear();
    ringCanvasCache.clear();
    eventLabelCanvasCache.clear();
}
function normalizeAdaptiveProfile(profile = "normal") {
    const value = String(profile || "").toLowerCase();
    return ADAPTIVE_QUALITY_PROFILES.includes(value) ? value : "normal";
}
function getAdaptiveProfileCaps(profile = "normal") {
    switch (normalizeAdaptiveProfile(profile)) {
        case "balanced":
            return {
                maxResolutionScale: 1.0,
                maxMsaaSamples: 1,
                minSse: 1.85,
                maxTileCache: 520,
                forcePreloadSiblingsFalse: true,
                forceFxaaEnabled: false,
            };
        case "conservative":
            return {
                maxResolutionScale: 0.9,
                maxMsaaSamples: 1,
                minSse: 2.35,
                maxTileCache: 420,
                forcePreloadSiblingsFalse: true,
                forceFxaaEnabled: false,
            };
        case "safe":
            return {
                maxResolutionScale: 0.8,
                maxMsaaSamples: 1,
                minSse: 2.9,
                maxTileCache: 280,
                forcePreloadSiblingsFalse: true,
                forceFxaaEnabled: false,
            };
        default:
            return {
                maxResolutionScale: 2,
                maxMsaaSamples: 8,
                minSse: 0.8,
                maxTileCache: 1200,
                forcePreloadSiblingsFalse: false,
                forceFxaaEnabled: false,
            };
    }
}
function setLimitedCache(map, key, value, maxItems = 200) {
    if (!(map instanceof Map)) return value;
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    const max = Math.max(8, Number(maxItems || 200));
    while (map.size > max) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
    }
    return value;
}
function getEventEntityCount() {
    return __eventEntityIds.size;
}
function getCameraHeight(viewer) {
    try {
        return Number(viewer?.camera?.positionCartographic?.height || 0);
    } catch {
        return 0;
    }
}
function shouldClusterEvents(viewer) {
    return getCameraHeight(viewer) > numberVar("--warzone-event-cluster-height", 1800000);
}
function getEventClusterZoomBucket(viewer) {
    const height = getCameraHeight(viewer);
    if (height > 9500000) return "world";
    if (height > 5200000) return "theater";
    if (height > 2600000) return "regional";
    if (height > 1200000) return "local";
    if (height > 620000) return "district";
    return "street";
}
function getEventClusterPrecision(viewer) {
    const base = numberVar("--warzone-event-cluster-precision", 0.18);
    switch (getEventClusterZoomBucket(viewer)) {
        case "world":
            return Math.max(base, 0.9);
        case "theater":
            return Math.max(base, 0.62);
        case "regional":
            return Math.max(base, 0.38);
        case "local":
            return Math.max(base, 0.24);
        case "district":
            return Math.min(base, 0.14);
        default:
            return Math.min(base, 0.08);
    }
}
function getEventClusterSplitCount(viewer, totalCount = 1) {
    const count = Math.max(1, Math.round(Number(totalCount) || 1));
    if (count < 2) return 1;
    switch (getEventClusterZoomBucket(viewer)) {
        case "world":
        case "theater":
        case "regional":
        case "local":
            return 1;
        case "district":
            return count >= 20 ? Math.min(2, count) : 1;
        default:
            if (count >= 48) return Math.min(4, Math.ceil(count / 14));
            if (count >= 24) return 2;
            return 1;
    }
}
function distanceMetersBetween(a = {}, b = {}) {
    const lat1 = Cesium.Math.toRadians(Number(a.lat));
    const lon1 = Cesium.Math.toRadians(Number(a.lon));
    const lat2 = Cesium.Math.toRadians(Number(b.lat));
    const lon2 = Cesium.Math.toRadians(Number(b.lon));
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * (Math.sin(dLon / 2) ** 2);
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function averageEventItems(items = []) {
    const valid = items.filter((item) => Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lon)));
    if (!valid.length) return null;
    const total = valid.reduce((sum, item) => sum + getEventClusterCount(item), 0) || valid.length;
    return {
        lat: valid.reduce((sum, item) => sum + Number(item.lat) * getEventClusterCount(item), 0) / total,
        lon: valid.reduce((sum, item) => sum + Number(item.lon) * getEventClusterCount(item), 0) / total,
        count: total,
    };
}
function getGroupLocationSpreadMeters(items = [], center = {}) {
    return items.reduce((max, item) => Math.max(max, distanceMetersBetween(center, item)), 0);
}
function shouldShowEventRingsAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-event-ring-max-height", 6500000);
}
function shouldShowEventMarkerPulseAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-event-marker-pulse-max-height", 3600000);
}
function shouldShowEventOutlinesAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-event-outline-max-height", 1800000);
}
function getMaxRenderableEventsAtHeight(cameraHeight = 0) {
    const base = Math.max(40, numberVar("--warzone-max-renderable-events", 240));
    if (cameraHeight > 8500000) return Math.max(base, 420);
    if (cameraHeight > 5000000) return Math.max(base, 340);
    if (cameraHeight > 2600000) return Math.max(base, 280);
    return Math.max(base, 220);
}
function getMaxRenderableEvents(viewer) {
    const height = getCameraHeight(viewer);
    return getMaxRenderableEventsAtHeight(height);
}
function getClusterSeverityRank(severity = "") {
    switch (String(severity || "").trim().toLowerCase()) {
        case "critical": return 4;
        case "high": return 3;
        case "medium": return 2;
        case "low": return 1;
        default: return 0;
    }
}
function getEmbeddedClusterEvents(event = {}) {
    const embedded = Array.isArray(event?._clusterEvents)
        ? event._clusterEvents
        : (Array.isArray(event?.cluster_events) ? event.cluster_events : []);
    return embedded
        .filter((item) => {
            const lat = Number(item?.lat ?? item?.display_lat);
            const lon = Number(item?.lon ?? item?.display_lon);
            return Number.isFinite(lat) && Number.isFinite(lon);
        })
        .map((item, index) => ({
            ...event,
            ...item,
            id: item?.id || `${event.id || "cluster"}-child-${index}`,
            lat: Number(item.lat ?? item.display_lat),
            lon: Number(item.lon ?? item.display_lon),
            cluster_count: Number(item.cluster_count || item._clusterCount || 1),
            _clusterCount: Number(item.cluster_count || item._clusterCount || 1),
            _clusterEvents: Array.isArray(item?._clusterEvents) ? item._clusterEvents : [item],
        }));
}
function expandEventsForLocationClustering(events = []) {
    const expanded = [];
    for (const event of Array.isArray(events) ? events : []) {
        const children = getEmbeddedClusterEvents(event);
        if (children.length > 1) {
            expanded.push(...children);
            continue;
        }
        expanded.push(event);
    }
    return expanded;
}
function clusterEventsForDisplayLegacy(events = [], precisionDeg = 0.32, maxItems = 520, viewer = window.__warzoneViewer) {
    const groups = new Map();
    for (const event of expandEventsForLocationClustering(events)) {
        const lat = Number(event?.lat);
        const lon = Number(event?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const key = `${Math.round(lat / precisionDeg)}:${Math.round(lon / precisionDeg)}`;
        if (!groups.has(key)) {
            groups.set(key, {
                lat,
                lon,
                items: [event],
            });
        } else {
            const group = groups.get(key);
            const n = group.items.length;
            group.lat = (group.lat * n + lat) / (n + 1);
            group.lon = (group.lon * n + lon) / (n + 1);
            group.items.push(event);
        }
    }
    const expandedGroups = [];
    for (const group of groups.values()) {
        const items = Array.isArray(group.items) ? group.items : [];
        const totalCount = items.reduce((acc, item) => acc + getEventClusterCount(item), 0);
        let splitCount = getEventClusterSplitCount(viewer, totalCount);
        if (splitCount <= 1) {
            expandedGroups.push(group);
            continue;
        }
        const sortedItems = items
            .slice()
            .sort((a, b) => {
                const severityDelta = getClusterSeverityRank(b?.severity) - getClusterSeverityRank(a?.severity);
                if (severityDelta) return severityDelta;
                return new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0);
            });
        const chunks = Array.from({ length: splitCount }, () => []);
        sortedItems.forEach((item, index) => {
            const itemCount = getEventClusterCount(item);
            if (itemCount <= 1) {
                chunks[index % splitCount].push(item);
                return;
            }
            for (let chunkIndex = 0; chunkIndex < splitCount; chunkIndex += 1) {
                const base = Math.floor(itemCount / splitCount);
                const extra = chunkIndex < (itemCount % splitCount) ? 1 : 0;
                const chunkCount = base + extra;
                if (chunkCount <= 0) continue;
                chunks[chunkIndex].push({
                    ...item,
                    id: `${item.id || "event"}-split-${chunkIndex}`,
                    cluster_count: chunkCount,
                    _clusterCount: chunkCount,
                    _clusterEvents: Array.isArray(item?._clusterEvents)
                        ? item._clusterEvents.slice(chunkIndex, chunkIndex + chunkCount)
                        : [item],
                });
            }
        });
        const center = { lat: group.lat, lon: group.lon };
        const hasRealSpread = getGroupLocationSpreadMeters(items, center)
            >= Math.max(1000, numberVar("--warzone-event-cluster-real-split-min-km", 18) * 1000);
        if (!hasRealSpread) {
            expandedGroups.push(group);
            continue;
        }
        chunks.forEach((chunk, index) => {
            if (!chunk.length) return;
            const chunkCenter = averageEventItems(chunk);
            expandedGroups.push({
                lat: chunkCenter?.lat ?? group.lat,
                lon: chunkCenter?.lon ?? group.lon,
                items: chunk,
                subclusterIndex: index,
                splitGroupId: `${group.lat.toFixed(3)}:${group.lon.toFixed(3)}`,
                splitParentLat: group.lat,
                splitParentLon: group.lon,
            });
        });
    }
    return expandedGroups
        .map((group, index) => {
            const items = group.items;
            const clusterCount = items.reduce((acc, item) => {
                const itemCount = Number(item?.cluster_count || item?._clusterCount || 1);
                return acc + (Number.isFinite(itemCount) && itemCount > 0 ? itemCount : 1);
            }, 0);
            const clusterEvents = items
                .flatMap((item) => (Array.isArray(item?._clusterEvents) ? item._clusterEvents : [item]))
                .filter(Boolean)
                .slice(0, 24);
            const critical = items.some((e) => String(e?.severity || "").toLowerCase() === "critical");
            const high = items.some((e) => String(e?.severity || "").toLowerCase() === "high");
            const latest = items
                .slice()
                .sort((a, b) => new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0))[0] || items[0];
            const categoryKey = String(latest?.category || "default").trim() || "default";
            const getClusterSatelliteContext = (item) => {
                const context = item?.satellite_context || item?.satelliteContext || null;
                const imageUrl = String(context?.imageUrl || context?.image_url || "").trim();
                if (String(context?.status || "").toLowerCase() !== "available") return null;
                if (!/^https?:\/\//i.test(imageUrl)) return null;
                return context;
            };
            const satelliteContext = getClusterSatelliteContext(latest)
                || getClusterSatelliteContext(clusterEvents.find(getClusterSatelliteContext) || null);
            return {
                ...latest,
                id: clusterCount > 1
                    ? `cluster-${categoryKey}-${group.lat.toFixed(3)}-${group.lon.toFixed(3)}-${Number(group.subclusterIndex || 0)}`
                    : (latest?.id || `event-${index + 1}`),
                lat: group.lat,
                lon: group.lon,
                title: clusterCount > 1 ? `${clusterCount} related events` : latest?.title,
                summary: clusterCount > 1 ? `${clusterCount} related events are grouped in this operational area.` : latest?.summary,
                severity: critical ? "critical" : (high ? "high" : (latest?.severity || "medium")),
                cluster_count: clusterCount,
                _clusterCount: clusterCount,
                _clusterEvents: clusterEvents,
                _splitGroupId: group.splitGroupId || "",
                _splitIndex: Number(group.subclusterIndex || 0),
                _splitParentLat: Number.isFinite(Number(group.splitParentLat)) ? Number(group.splitParentLat) : null,
                _splitParentLon: Number.isFinite(Number(group.splitParentLon)) ? Number(group.splitParentLon) : null,
                satellite_context: satelliteContext,
                satellite_available: !!satelliteContext,
            };
        })
        .sort((a, b) => (Number(b.cluster_count || 1) - Number(a.cluster_count || 1)))
        .slice(0, maxItems);
}
function getEventZoomState(viewer) {
    return getZoomUxState(getCameraHeight(viewer), {
        regionalMinHeight: numberVar("--hotspot-zoom-regional-min-height", 5200000),
        localStackMinHeight: numberVar("--hotspot-zoom-local-stack-min-height", 2600000),
        localityMinHeight: numberVar("--hotspot-zoom-locality-min-height", 620000),
    });
}
function getEventClusterDistanceKm(viewer) {
    const bucket = getEventClusterZoomBucket(viewer);
    const zoomState = getEventZoomState(viewer);
    if (zoomState === ZOOM_UX_STATES.EVENT) return 0;
    const presentationBucket = getClusterBucketForZoomState(zoomState, bucket);
    return Math.max(0, numberVar(`--hotspot-cluster-distance-${presentationBucket}-km`, getClusterDistanceKm(presentationBucket)));
}
function clusterEventsForDisplay(events = [], precisionDeg = 0.32, maxItems = 520, viewer = window.__warzoneViewer) {
    const zoomState = getEventZoomState(viewer);
    const zoomBucket = getClusterBucketForZoomState(zoomState, getEventClusterZoomBucket(viewer));
    return buildSpatialEventClusters(events, {
        zoomBucket,
        distanceKm: getEventClusterDistanceKm(viewer),
        dominanceThreshold: numberVar("--hotspot-dominance-threshold", 0.48),
        dominanceMargin: numberVar("--hotspot-dominance-margin", 0.12),
        pulseCap: numberVar("--hotspot-pulse-cap", 12),
    }).slice(0, maxItems);
}
function getEventClusterItems(event = {}) {
    const items = Array.isArray(event?._clusterEvents) && event._clusterEvents.length
        ? event._clusterEvents
        : [event];
    return items.filter(Boolean);
}
function getEventClusterCount(event = {}) {
    const direct = Number(event?.cluster_count || event?._clusterCount || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return Math.max(1, getEventClusterItems(event).length);
}
function getScreenPointForEvent(viewer, event = {}) {
    try {
        const scene = viewer?.scene;
        const lon = Number(event?.lon);
        const lat = Number(event?.lat);
        if (!scene || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
        const fn = Cesium.SceneTransforms.worldToWindowCoordinates
            || Cesium.SceneTransforms.wgs84ToWindowCoordinates;
        if (!fn) return null;
        const point = fn(scene, Cesium.Cartesian3.fromDegrees(lon, lat, 0));
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        return { x: point.x, y: point.y };
    } catch {
        return null;
    }
}
function getEventTransitionMs() {
    return Math.max(0, numberVar("--warzone-event-cluster-transition-ms", 680));
}
function getNowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}
function getTransitionProgress(event = {}) {
    const duration = Math.max(1, Number(event?._transitionMs || 0));
    const start = Number(event?._transitionStartMs || 0);
    if (!(duration > 0) || !(start > 0)) return 1;
    return Math.max(0, Math.min(1, (getNowMs() - start) / duration));
}
function getAnimatedEventCoordinates(event = {}) {
    const targetLat = Number(event?.lat);
    const targetLon = Number(event?.lon);
    const fromLat = Number(event?._fromLat);
    const fromLon = Number(event?._fromLon);
    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLon)) return null;
    if (!Number.isFinite(fromLat) || !Number.isFinite(fromLon)) {
        return { lat: targetLat, lon: targetLon };
    }
    const progress = easeOutCubic(getTransitionProgress(event));
    return {
        lat: fromLat + (targetLat - fromLat) * progress,
        lon: fromLon + (targetLon - fromLon) * progress,
    };
}
function createEventPositionProperty(event = {}) {
    const targetLat = Number(event?.lat);
    const targetLon = Number(event?.lon);
    const fromLat = Number(event?._fromLat);
    const fromLon = Number(event?._fromLon);
    if (
        !Number.isFinite(fromLat) ||
        !Number.isFinite(fromLon) ||
        !Number.isFinite(targetLat) ||
        !Number.isFinite(targetLon) ||
        getEventTransitionMs() <= 0
    ) {
        return Cesium.Cartesian3.fromDegrees(targetLon, targetLat);
    }
    return new Cesium.CallbackProperty(() => {
        const coords = getAnimatedEventCoordinates(event);
        return Cesium.Cartesian3.fromDegrees(coords.lon, coords.lat);
    }, false);
}
function getAnimatedEventCount(event = {}) {
    const target = Math.max(1, Math.round(Number(event?.cluster_count || event?._clusterCount || 1)));
    const from = Math.max(1, Math.round(Number(event?._fromCount || target)));
    if (from === target) return target;
    const progress = easeOutCubic(getTransitionProgress(event));
    return Math.max(1, Math.round(from + (target - from) * progress));
}
function createEventMarkerImageProperty(event = {}, colorCss = "#f51e58") {
    const from = Math.round(Number(event?._fromCount || 0));
    const target = Math.round(Number(event?.cluster_count || event?._clusterCount || 1));
    if (!(from > 0) || from === target || getEventTransitionMs() <= 0) {
        return createClusterMarkerCanvas(colorCss, Math.max(1, target), event.severity);
    }
    return new Cesium.CallbackProperty(() => (
        createClusterMarkerCanvas(colorCss, getAnimatedEventCount(event), event.severity)
    ), false);
}
function mergeEventMarkerGroup(group, index = 0) {
    const entries = Array.isArray(group?.entries) ? group.entries : [];
    if (!entries.length) return null;
    const allItems = entries.flatMap((entry) => getEventClusterItems(entry.event));
    const clusterCount = entries.reduce((sum, entry) => sum + getEventClusterCount(entry.event), 0);
    const weightSum = entries.reduce((sum, entry) => sum + Math.max(1, entry.count), 0) || 1;
    const lat = entries.reduce((sum, entry) => sum + Number(entry.event.lat) * Math.max(1, entry.count), 0) / weightSum;
    const lon = entries.reduce((sum, entry) => sum + Number(entry.event.lon) * Math.max(1, entry.count), 0) / weightSum;
    const latest = allItems
        .slice()
        .sort((a, b) => {
            const severityDelta = getClusterSeverityRank(b?.severity) - getClusterSeverityRank(a?.severity);
            if (severityDelta) return severityDelta;
            return new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0);
        })[0] || entries[0].event;
    const critical = allItems.some((event) => String(event?.severity || "").toLowerCase() === "critical");
    const high = allItems.some((event) => String(event?.severity || "").toLowerCase() === "high");
    const categoryKey = String(latest?.category || "default").trim() || "default";
    const getSatelliteContext = (item) => {
        const context = item?.satellite_context || item?.satelliteContext || null;
        const imageUrl = String(context?.imageUrl || context?.image_url || "").trim();

        if (String(context?.status || "").toLowerCase() !== "available") return null;
        if (!/^https?:\/\//i.test(imageUrl)) return null;

        return context;
    };

    const satelliteSource =
        allItems.find((item) => getSatelliteContext(item)) || null;

    const satelliteContext = getSatelliteContext(satelliteSource);
    if (entries.length === 1 && clusterCount <= 1) {
        return {
            ...entries[0].event,
            lat,
            lon,
        };
    }
    return {
        ...latest,
        id: `screen-cluster-${categoryKey}-${lat.toFixed(3)}-${lon.toFixed(3)}-${index}`,
        lat,
        lon,
        title: `${clusterCount} related events`,
        summary: `${clusterCount} related events are grouped in this operational area.`,
        severity: critical ? "critical" : (high ? "high" : (latest?.severity || "medium")),
        cluster_count: clusterCount,
        _clusterCount: clusterCount,
        _clusterEvents: allItems,
        satellite_context: satelliteContext,
        satellite_available: !!satelliteContext,
    };
}
function mergeOverlappingEventMarkers(viewer, events = [], maxItems = 520) {
    if (!viewer || !Array.isArray(events) || events.length < 2) return events;
    const groups = [];
    const sorted = events
        .slice()
        .sort((a, b) => getEventClusterCount(b) - getEventClusterCount(a));
    for (const event of sorted) {
        const point = getScreenPointForEvent(viewer, event);
        const count = getEventClusterCount(event);
        const radius = getEventMarkerSizePx(count) * 0.5;
        if (!point) {
            groups.push({ x: 0, y: 0, radius, count, projectable: false, entries: [{ event, count }] });
            continue;
        }
        let target = null;
        for (const group of groups) {
            if (group.projectable === false) continue;
            const groupSplitId = String(group.entries?.[0]?.event?._splitGroupId || "");
            const eventSplitId = String(event?._splitGroupId || "");
            const distance = Math.hypot(group.x - point.x, group.y - point.y);
            const sameSplitGroup = groupSplitId && eventSplitId && groupSplitId === eventSplitId;
            const mergeDistance = (group.radius + radius) * (sameSplitGroup ? 1.18 : 0.88);
            if (distance <= mergeDistance) {
                target = group;
                break;
            }
        }
        if (!target) {
            groups.push({ x: point.x, y: point.y, radius, count, projectable: true, entries: [{ event, count }] });
            continue;
        }
        const nextWeight = target.count + count;
        target.x = ((target.x * target.count) + (point.x * count)) / nextWeight;
        target.y = ((target.y * target.count) + (point.y * count)) / nextWeight;
        target.radius = Math.max(target.radius, radius, getEventMarkerSizePx(nextWeight) * 0.5);
        target.count = nextWeight;
        target.entries.push({ event, count });
    }
    return groups
        .map((group, index) => mergeEventMarkerGroup(group, index))
        .filter(Boolean)
        .slice(0, maxItems);
}
function addClusterParentRings(events = []) {
    const groups = new Map();
    for (const event of Array.isArray(events) ? events : []) {
        const splitId = String(event?._splitGroupId || "");
        if (!splitId) continue;
        if (!groups.has(splitId)) groups.set(splitId, []);
        groups.get(splitId).push(event);
    }
    const parentRings = [];
    for (const [splitId, items] of groups.entries()) {
        if (!Array.isArray(items) || items.length < 2) continue;
        const center = {
            lat: Number(items[0]._splitParentLat),
            lon: Number(items[0]._splitParentLon),
        };
        const fallbackCenter = averageEventItems(items);
        const ringCenter = Number.isFinite(center.lat) && Number.isFinite(center.lon) ? center : fallbackCenter;
        if (!ringCenter) continue;
        const maxDistance = items.reduce((max, item) => Math.max(max, distanceMetersBetween(ringCenter, item)), 0);
        const minRadius = Math.max(1000, numberVar("--warzone-event-cluster-parent-ring-min-km", 120) * 1000);
        const padding = Math.max(0, numberVar("--warzone-event-cluster-parent-ring-padding-km", 45) * 1000);
        const maxRadius = Math.max(minRadius, numberVar("--warzone-event-cluster-parent-ring-max-km", 420) * 1000);
        const radius = Math.max(minRadius, Math.min(maxRadius, maxDistance + padding));
        const totalCount = items.reduce((sum, item) => sum + getEventClusterCount(item), 0);
        const strongest = items
            .slice()
            .sort((a, b) => getClusterSeverityRank(b?.severity) - getClusterSeverityRank(a?.severity))[0] || items[0];
        parentRings.push({
            ...strongest,
            id: `cluster-parent-ring-${splitId}`,
            lat: ringCenter.lat,
            lon: ringCenter.lon,
            cluster_count: totalCount,
            _clusterCount: totalCount,
            _isClusterParentRing: true,
            _parentRingRadius: radius,
            _splitGroupId: splitId,
        });
    }
    const filteredParentRings = parentRings
        .slice()
        .sort((a, b) => Number(b?._parentRingRadius || 0) - Number(a?._parentRingRadius || 0))
        .filter((ring, index, sorted) => {
            const radius = Number(ring?._parentRingRadius || 0);
            if (!(radius > 0)) return false;
            return !sorted.slice(0, index).some((larger) => {
                const largerRadius = Number(larger?._parentRingRadius || 0);
                if (!(largerRadius > 0)) return false;
                const distance = distanceMetersBetween(larger, ring);
                if (!Number.isFinite(distance)) return false;
                const contained = distance + radius <= largerRadius * 1.12;
                const centerNested = distance <= Math.max(22000, largerRadius * 0.24);
                const mostlyOverlapping =
                    distance <= (largerRadius + radius) * 0.42
                    && radius <= largerRadius * 0.94;
                return contained || centerNested || mostlyOverlapping;
            });
        });
    return [...events, ...filteredParentRings].slice(0, Math.max(events.length, events.length + filteredParentRings.length));
}
function prepareEventsForCurrentZoom(viewer, events = []) {
    const normalized = normalizeEvents(events);
    const maxItems = getMaxRenderableEvents(viewer);
    if (window.__stratopsReportCaptureMode === true) {
        const reportClusters = normalized.filter((event) => event.is_report_cluster_summary === true);
        const sourceEvents = normalized.filter((event) => event.is_report_cluster_summary !== true);
        return [
            ...clusterEventsForDisplay(sourceEvents, getEventClusterPrecision(viewer), maxItems, viewer),
            ...reportClusters,
        ]
            .sort((left, right) => Number(right.weighted_activity_score || 0) - Number(left.weighted_activity_score || 0))
            .slice(0, maxItems);
    }
    return clusterEventsForDisplay(normalized, getEventClusterPrecision(viewer), maxItems, viewer);
}
function eventDistanceDeg(a = {}, b = {}) {
    const alat = Number(a.lat);
    const alon = Number(a.lon);
    const blat = Number(b.lat);
    const blon = Number(b.lon);
    if (![alat, alon, blat, blon].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    return Math.hypot(alat - blat, alon - blon);
}
function averageEvents(events = []) {
    const valid = events.filter((event) => !event?._isClusterParentRing && Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lon)));
    if (!valid.length) return null;
    const total = valid.reduce((sum, event) => sum + getEventClusterCount(event), 0) || valid.length;
    return {
        lat: valid.reduce((sum, event) => sum + Number(event.lat) * getEventClusterCount(event), 0) / total,
        lon: valid.reduce((sum, event) => sum + Number(event.lon) * getEventClusterCount(event), 0) / total,
        count: total,
    };
}
function findEventTransitionAnchor(previous = [], event = {}) {
    const byId = previous.find((prev) => String(prev?.id || "") === String(event?.id || ""));
    if (byId) return { lat: Number(byId.lat), lon: Number(byId.lon), count: getEventClusterCount(byId) };
    const splitId = String(event?._splitGroupId || "");
    if (splitId) {
        const splitGroup = previous.filter((prev) => String(prev?._splitGroupId || "") === splitId);
        const averaged = averageEvents(splitGroup);
        if (averaged) return averaged;
    }
    const category = String(event?.category || "");
    let nearest = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const prev of previous) {
        if (category && String(prev?.category || "") !== category) continue;
        const distance = eventDistanceDeg(prev, event);
        if (distance < nearestDistance) {
            nearest = prev;
            nearestDistance = distance;
        }
    }
    return nearest && nearestDistance <= numberVar("--warzone-event-cluster-transition-anchor-deg", 2.8)
        ? { lat: Number(nearest.lat), lon: Number(nearest.lon), count: getEventClusterCount(nearest) }
        : null;
}
function applyEventClusterTransitions(viewer, prepared = []) {
    const previous = Array.isArray(viewer?.__warzoneLastPreparedEvents)
        ? viewer.__warzoneLastPreparedEvents
        : [];
    const duration = getEventTransitionMs();
    if (!previous.length || !(duration > 0)) return prepared;
    const start = getNowMs();
    return prepared.map((event) => {
        if (event?._isClusterParentRing) return event;
        if (getEventClusterCount(event) <= 1) return event;
        const anchor = findEventTransitionAnchor(previous, event);
        if (!anchor) return event;
        const distance = eventDistanceDeg(anchor, event);
        const fromCount = Math.max(1, Math.round(Number(anchor.count || 1)));
        const toCount = getEventClusterCount(event);
        if (distance < 0.01 && fromCount === toCount) return event;
        return {
            ...event,
            _fromLat: anchor.lat,
            _fromLon: anchor.lon,
            _fromCount: fromCount,
            _transitionStartMs: start,
            _transitionMs: duration,
        };
    });
}
function refreshEventClustersForZoom(viewer) {
    const sourceEvents = viewer?.__warzoneLastSourceEvents;
    if (!viewer || !Array.isArray(sourceEvents) || !sourceEvents.length) {
        applyEventLod(viewer);
        return;
    }
    const nextBucket = getEventClusterZoomBucket(viewer);
    if (viewer.__warzoneLastClusterBucket === nextBucket) {
        applyEventLod(viewer);
        return;
    }
    viewer.__warzoneLastClusterBucket = nextBucket;
    const prepared = applyEventClusterTransitions(viewer, prepareEventsForCurrentZoom(viewer, sourceEvents));
    const ringEntityCap = Math.max(40, Math.round(numberVar("--warzone-event-ring-entity-cap", 160)));
    const shouldDisableRingsForBatch = prepared.length > ringEntityCap;
    reconcileEventEntities(viewer, prepared, {
        disableEllipse: shouldDisableRingsForBatch,
        disableOutline: shouldDisableRingsForBatch,
        suppressMarkers: viewer.__warzoneSuppressEventMarkers === true,
    });
    viewer.__warzoneLastPreparedEvents = prepared.map((event) => ({
        id: event.id,
        lat: event.lat,
        lon: event.lon,
        category: event.category,
        cluster_count: event.cluster_count,
        _clusterCount: event._clusterCount,
        _splitGroupId: event._splitGroupId || "",
        _isClusterParentRing: event._isClusterParentRing === true,
        _parentRingRadius: event._parentRingRadius || 0,
    }));
}
function applyEventLod(viewer) {
    if (!viewer) return;
    const mode = viewer.__warzoneMapMode || __EVENT_LOD_STATE.mode || "map";
    const cameraHeight = getCameraHeight(viewer);
    const zoomState = getEventZoomState(viewer);
    const showIndividualEvents = zoomState === ZOOM_UX_STATES.EVENT;
    const allowMarkers = boolVar("--warzone-event-markers-visible", true);
    const allowRings = boolVar("--warzone-event-rings-visible", true);
    const suppressMarkers = viewer.__warzoneSuppressEventMarkers === true;
    const eventEntityCount = getEventEntityCount();
    const ringBudget = Math.max(80, numberVar("--warzone-event-ring-budget", 200));
    const outlineBudget = Math.max(60, numberVar("--warzone-event-outline-budget", 140));
    const showRingsByZoom = shouldShowEventRingsAtCurrentZoom(viewer);
    const showOutlinesByZoom =
        shouldShowEventOutlinesAtCurrentZoom(viewer) &&
        eventEntityCount <= outlineBudget;
    __EVENT_LOD_STATE.mode = mode;
    __EVENT_LOD_STATE.cameraHeight = cameraHeight;
    const entities = viewer.entities.values;
    const canvas = viewer.scene?.canvas;
    const labelMaxVisible = (canvas?.clientWidth || 0) <= 720
        ? numberVar("--event-marker-label-max-visible-small", 18)
        : numberVar("--event-marker-label-max-visible", 36);
    const visibleEventLabelIds = showIndividualEvents && mode !== "heatmap" && !suppressMarkers
        ? selectCollisionSafeLabels(entities.flatMap((entity) => {
            if (!entity?.properties || !getEntityPropertyValue(entity, "isEventCountLabel", false)) return [];
            if (Number(getEntityPropertyValue(entity, "cluster_count", 1)) !== 1) return [];
            const lat = Number(getEntityPropertyValue(entity, "lat", NaN));
            const lon = Number(getEntityPropertyValue(entity, "lon", NaN));
            const screen = getScreenPointForEvent(viewer, { lat, lon });
            if (!screen) return [];
            const text = String(getEntityPropertyValue(entity, "event_marker_label", "Event"));
            const severityRank = { low: 1, medium: 2, high: 3, critical: 4 }[String(getEntityPropertyValue(entity, "severity", "medium")).toLowerCase()] || 2;
            const activityScore = Math.max(0, Number(getEntityPropertyValue(entity, "activity_score", 0)) || 0);
            const labelWidth = Math.max(64, Math.min(148, 24 + text.length * 7));
            return [{
                id: entity.id,
                screen,
                width: labelWidth,
                height: 28,
                centerOffsetX: numberVar("--event-marker-label-offset-x", 30) + labelWidth / 2,
                priority: severityRank * 1000 + activityScore,
            }];
        }), {
            viewportWidth: canvas?.clientWidth || Number.POSITIVE_INFINITY,
            viewportHeight: canvas?.clientHeight || Number.POSITIVE_INFINITY,
            viewportPad: numberVar("--event-marker-label-viewport-pad", 8),
            gapPx: numberVar("--event-marker-label-collision-gap", 8),
            maxVisible: labelMaxVisible,
        })
        : new Set();
    for (const entity of entities) {
        if (!entity?.properties) continue;
        const isEventOutline = !!entity.properties?.isEventOutline?.getValue?.();
        const isEventFill = !!entity.properties?.isEventFill?.getValue?.();
        const isEventMarkerFill = !!entity.properties?.isEventMarkerFill?.getValue?.();
        const isEventCountLabel = !!entity.properties?.isEventCountLabel?.getValue?.();
        const isEventPulse = !!entity.properties?.isEventPulse?.getValue?.();
        const isEventClusterParentRing = !!entity.properties?.isEventClusterParentRing?.getValue?.();
        const isSatelliteImageryMarker = !!entity.properties?.isSatelliteImageryMarker?.getValue?.();
        const isReportClusterSummary = window.__stratopsReportCaptureMode === true
            && entity.properties?.is_report_cluster_summary?.getValue?.() === true;
        const heatRadius = Number(entity.properties?.heatRadius?.getValue?.() ?? 140000);
        const category = String(entity.properties?.category?.getValue?.() ?? "strike");
        const severity = String(entity.properties?.severity?.getValue?.() ?? "medium");
        const dominantDomain = String(entity.properties?.dominant_domain?.getValue?.() ?? "");
        const activityScore = Number(entity.properties?.activity_score?.getValue?.() ?? 0);
        // Read cluster_count stored by createEventEntity — clusters keep their scaled radius
        const clusterCount = Number(entity.properties?.cluster_count?.getValue?.() ?? 1);
        const isCluster = clusterCount > 1;
        if (isSatelliteImageryMarker) {
            const satelliteVisible =
                viewer.__warzoneSatelliteImageryLayerVisible !== false;

            entity.show = satelliteVisible;

            if (entity.billboard) {
                entity.billboard.show = satelliteVisible;
            }

            continue;
        }
        const colorCss = getEventMarkerColorCss({ category, dominant_domain: dominantDomain });
        const color = Cesium.Color.fromCssColorString(colorCss);
        const baseRadius = getSeverityRadius({ severity, cluster_count: clusterCount });
        if (isEventCountLabel) {
            const markerLabel = String(entity.properties?.event_marker_label?.getValue?.() ?? "Event");
            const showCountLabel = (isReportClusterSummary && entity.properties?.report_label_visible?.getValue?.() === true)
                || (mode !== "heatmap"
                    && !suppressMarkers
                    && showIndividualEvents
                    && clusterCount === 1
                    && visibleEventLabelIds.has(String(entity.id)));
            if (entity.billboard) {
                const billboardConfig = createEventMarkerTextLabel(markerLabel);
                entity.billboard.show = showCountLabel;
                entity.billboard.image = billboardConfig.image;
                entity.billboard.width = billboardConfig.width;
                entity.billboard.height = billboardConfig.height;
                entity.billboard.pixelOffset = billboardConfig.pixelOffset;
                entity.billboard.eyeOffset = billboardConfig.eyeOffset;
                entity.billboard.disableDepthTestDistance = billboardConfig.disableDepthTestDistance;
            }
            if (entity.label) {
                const labelConfig = isReportClusterSummary
                    ? createReportClusterLabel({
                        cluster_count: clusterCount,
                        location_label: entity.properties?.location_label?.getValue?.() || "OPERATIONAL AREA",
                        dominant_domain: entity.properties?.dominant_domain?.getValue?.() || category,
                        report_label: entity.properties?.report_label?.getValue?.() || null,
                    })
                    : clusterCount === 1
                        ? createEventMarkerTextLabel(markerLabel)
                        : createClusterCountLabel(clusterCount);
                entity.label.show = showCountLabel && !!labelConfig;
                if (labelConfig) {
                    entity.label.text = labelConfig.text;
                    entity.label.font = labelConfig.font;
                    entity.label.fillColor = labelConfig.fillColor;
                    entity.label.outlineColor = labelConfig.outlineColor;
                    entity.label.outlineWidth = labelConfig.outlineWidth;
                    entity.label.style = labelConfig.style;
                    entity.label.pixelOffset = labelConfig.pixelOffset;
                    entity.label.eyeOffset = labelConfig.eyeOffset;
                    entity.label.disableDepthTestDistance = labelConfig.disableDepthTestDistance;
                    entity.label.zIndex = labelConfig.zIndex;
                    entity.label.showBackground = labelConfig.showBackground === true;
                    if (labelConfig.backgroundColor) entity.label.backgroundColor = labelConfig.backgroundColor;
                    if (labelConfig.backgroundPadding) entity.label.backgroundPadding = labelConfig.backgroundPadding;
                }
            }
            continue;
        }
        if (isEventClusterParentRing && entity.ellipse) {
            entity.ellipse.show = mode === "heatmap" && allowRings && showRingsByZoom;
            entity.ellipse.material = Cesium.Color.TRANSPARENT;
            entity.ellipse.outline = true;
            entity.ellipse.outlineColor = Cesium.Color.fromCssColorString(getEventHotspotColorCss({ category, dominant_domain: dominantDomain })).withAlpha(0.96);
            entity.ellipse.outlineWidth = Math.max(1, numberVar(`--hotspot-severity-${severity}-width`, numberVar("--hotspot-border-width", 4)));
            continue;
        }
        const fillAlpha = isCluster
            ? Math.min(numberVar("--warzone-event-ring-fill-alpha", 0.14) * 1.6, 0.38)
            : numberVar("--warzone-event-ring-fill-alpha", 0.14);
        if (isEventOutline || isEventFill || isEventPulse) {
            if (isEventMarkerFill) {
                const showMarkerFill = isReportClusterSummary || (mode !== "heatmap"
                    && !suppressMarkers
                    && allowMarkers
                    && showIndividualEvents
                    && !isCluster);
                if (entity.billboard) {
                    entity.billboard.show = showMarkerFill;
                    entity.billboard.width = getEventMarkerSizePx(clusterCount, activityScore);
                    entity.billboard.height = getEventMarkerSizePx(clusterCount, activityScore) * getEventMarkerPerspectiveSquash(viewer);
                    entity.billboard.scaleByDistance = getEventMarkerScaleByDistance();
                    entity.billboard.color = Cesium.Color.WHITE.withAlpha(1);
                }
                if (entity.ellipse) {
                    entity.ellipse.show = false;
                    clearEventEllipsePulse(entity);
                }
                continue;
            }
            if (entity.billboard) {
                const showBillboard = isEventPulse
                    ? mode !== "heatmap" && allowMarkers && !suppressMarkers && showIndividualEvents && !isCluster && shouldShowEventMarkerPulseAtCurrentZoom(viewer)
                    : mode !== "heatmap" && allowRings && showRingsByZoom;
                entity.billboard.show = showBillboard;
                if (!showBillboard) clearEventEllipsePulse(entity);
            }
            if (entity.ellipse) {
                const showPulse = mode !== "heatmap" && allowRings && showRingsByZoom && showIndividualEvents && !isCluster;
                entity.ellipse.show = showPulse;
                if (showPulse && isEventPulse) {
                    const pulseRadius = Math.max(2000, numberVar("--warzone-event-pulse-radius", 22000));
                    const pulseAlpha = numberVar("--warzone-event-pulse-fill-alpha", 0.18);
                    applyEventEllipsePulse(entity, pulseRadius, color, pulseAlpha, {
                        id: entity.id,
                        event_id: entity.properties?.event_id?.getValue?.(),
                        category,
                        severity,
                        cluster_count: clusterCount,
                        lat: entity.properties?.lat?.getValue?.(),
                        lon: entity.properties?.lon?.getValue?.(),
                    });
                } else {
                    clearEventEllipsePulse(entity);
                }
            }
            continue;
        }
        if (entity.billboard) {
            entity.billboard.show = false;
        }
        if (entity.label) {
            entity.label.show = false;
        }
        if (mode === "heatmap" && allowRings && showRingsByZoom) {
            ensureEventEllipse(entity, baseRadius, color, fillAlpha);
        }
        if (entity.ellipse) {
            if (!allowRings || !showRingsByZoom) {
                clearEventEllipsePulse(entity);
                entity.ellipse.show = false;
                continue;
            }
            entity.ellipse.show = true;
            if (mode === "heatmap") {
                clearEventEllipsePulse(entity);
                entity.ellipse.semiMinorAxis = heatRadius;
                entity.ellipse.semiMajorAxis = heatRadius;
                entity.ellipse.material = color.withAlpha(0.24);
                entity.ellipse.outline = false;
            } else {
                clearEventEllipsePulse(entity);
                entity.ellipse.semiMinorAxis = baseRadius;
                entity.ellipse.semiMajorAxis = baseRadius;
                entity.ellipse.material = color.withAlpha(fillAlpha);
                entity.ellipse.outline = false;
                entity.ellipse.outlineWidth = 0;
            }
        }
    }
    viewer.scene.requestRender();
    startEventPulseRenderLoop(viewer);
}
function attachEventLodController(viewer) {
    if (!viewer || viewer.__warzoneEventLodAttached) return;
    viewer.__warzoneEventLodAttached = true;
    let pending = false;
    const run = () => {
        pending = false;
        refreshEventClustersForZoom(viewer);
    };
    const queue = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(run);
    };
    viewer.camera.moveEnd.addEventListener(queue);
    viewer.scene.postRender.addEventListener(() => {
        const currentHeight = getCameraHeight(viewer);
        if (Math.abs(currentHeight - (__EVENT_LOD_STATE.cameraHeight || 0)) > 250000) {
            queue();
        }
    });
    if (!viewer.__warzoneEventPulseVisibilityBound) {
        viewer.__warzoneEventPulseVisibilityBound = true;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                stopEventPulseRenderLoop(viewer);
                return;
            }
            applyEventLod(viewer);
        }, { passive: true });
    }
}
function getFocusedAssetPerformanceCaps(profile = "normal") {
    switch (normalizeAdaptiveProfile(profile)) {
        case "balanced":
            return {
                resolutionCap: 0.9,
                msaaCap: 1,
                sseFloor: 2.2,
                tileCacheCap: 128,
                maxRenderTime: 0.24,
            };
        case "conservative":
            return {
                resolutionCap: 0.82,
                msaaCap: 1,
                sseFloor: 2.6,
                tileCacheCap: 110,
                maxRenderTime: 0.2,
            };
        case "safe":
            return {
                resolutionCap: 0.74,
                msaaCap: 1,
                sseFloor: 3.0,
                tileCacheCap: 96,
                maxRenderTime: 0.18,
            };
        default:
            return {
                resolutionCap: 0.96,
                msaaCap: 1,
                sseFloor: 1.9,
                tileCacheCap: 140,
                maxRenderTime: 0.24,
            };
    }
}
function rememberEventEntity(entity) {
    if (!entity?.id) return;
    __eventEntityIds.add(String(entity.id));
}
function forgetEventEntity(entityId) {
    if (!entityId) return;
    __eventEntityIds.delete(String(entityId));
}
function registerEventPulseEntity(entity) {
    if (entity) __eventPulseEntities.add(entity);
}
function unregisterEventPulseEntity(entity) {
    if (entity) __eventPulseEntities.delete(entity);
}
function removeExistingEventEntity(viewer, entityId) {
    if (!viewer || !entityId) return;

    const ids = [
        String(entityId),
        `${String(entityId)}-pulse`,
        `${String(entityId)}-fill`,
        `${String(entityId)}-count`,
        `${String(entityId)}-outline`,
        `${String(entityId)}-satellite`,
        `${String(entityId)}-satellite-imagery`,
        `${String(entityId)}-satellite-imagery-ring`,
    ];

    for (const id of ids) {
        try {
            const existing = viewer.entities.getById(id);

            if (existing) {
                unregisterEventPulseEntity(existing);
                viewer.entities.remove(existing);
            }
        } catch { }

        forgetEventEntity(id);
    }
}
function cancelPendingEventSync(viewer) {
    if (!viewer) return;
    viewer.__warzoneEventSyncToken = Number(viewer.__warzoneEventSyncToken || 0) + 1;
    if (viewer.__warzoneEventSyncRaf) {
        try {
            cancelAnimationFrame(viewer.__warzoneEventSyncRaf);
        } catch {
            // ignore
        }
        viewer.__warzoneEventSyncRaf = 0;
    }
}
function buildEventRenderSignature(event = {}) {
    const id = String(event.id || "");
    const occurredAt = String(event.occurred_at || "");
    const category = String(event.category || "");
    const severity = String(event.severity || "");
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const clusterCount = Number(event.cluster_count || event._clusterCount || 1);
    const activityScore = Number(event.weighted_activity_score || event._activityScore || 0);
    const dominantDomain = String(event.dominant_domain || event._dominantDomain || "");
    const pulseMode = event.pulse_eligible === true ? String(event.pulse_mode || "subtle") : "none";
    const isParentRing = event?._isClusterParentRing === true ? "1" : "0";
    const parentRingRadius = Number(event?._parentRingRadius || event?.parent_ring_radius || 0);
    const satelliteContext = event?.satellite_context || event?.satelliteContext || null;
    const satelliteStatus = String(satelliteContext?.status || "");
    const satelliteImageUrl = String(satelliteContext?.imageUrl || satelliteContext?.image_url || "");
    const latKey = Number.isFinite(lat) ? lat.toFixed(4) : "x";
    const lonKey = Number.isFinite(lon) ? lon.toFixed(4) : "x";
    const clusterKey = Number.isFinite(clusterCount) ? String(clusterCount) : "1";
    const parentRingKey = Number.isFinite(parentRingRadius) ? parentRingRadius.toFixed(0) : "0";
    return `${id}|${occurredAt}|${category}|${severity}|${clusterKey}|${activityScore.toFixed(3)}|${dominantDomain}|${pulseMode}|${latKey}|${lonKey}|${isParentRing}|${parentRingKey}|${satelliteStatus}|${satelliteImageUrl}`;
}
function reconcileEventEntities(viewer, events = [], options = {}) {
    if (!viewer) return;
    cancelPendingEventSync(viewer);
    const token = Number(viewer.__warzoneEventSyncToken || 0);
    const prevState =
        viewer.__warzoneEventRenderState instanceof Map
            ? viewer.__warzoneEventRenderState
            : new Map();
    const nextState = new Map();
    const nextEventsById = new Map();
    for (const event of Array.isArray(events) ? events : []) {
        const id = String(event?.id || "").trim();
        if (!id) continue;
        nextEventsById.set(id, event);
    }
    for (const [id, event] of nextEventsById.entries()) {
        nextState.set(id, buildEventRenderSignature(event));
    }
    const removeIds = [];
    for (const prevId of prevState.keys()) {
        if (!nextState.has(prevId)) {
            removeIds.push(prevId);
        }
    }
    const upsertEvents = [];
    for (const event of nextEventsById.values()) {
        const id = String(event?.id || "").trim();
        if (!id) continue;
        const nextSig = nextState.get(id);
        const prevSig = prevState.get(id);
        if (prevSig !== nextSig) {
            upsertEvents.push(event);
        }
    }
    if (!removeIds.length && !upsertEvents.length) {
        applyEventLod(viewer);
        viewer.scene.requestRender();
        return;
    }
    const chunkSize = Math.max(20, Math.round(numberVar("--warzone-event-sync-chunk-size", 56)));
    const disableEllipse = options?.disableEllipse === true;
    const disableOutline = options?.disableOutline === true || disableEllipse;
    const suppressMarkers = options?.suppressMarkers === true;
    const step = (removeIndex, upsertIndex) => {
        if (Number(viewer.__warzoneEventSyncToken || 0) !== token) return;
        let ops = 0;
        if (viewer.entities?.suspendEvents) viewer.entities.suspendEvents();
        while (removeIndex < removeIds.length && ops < chunkSize) {
            removeExistingEventEntity(viewer, removeIds[removeIndex]);
            removeIndex += 1;
            ops += 1;
        }
        while (upsertIndex < upsertEvents.length && ops < chunkSize) {
            addEventEntity(viewer, upsertEvents[upsertIndex], {
                disableEllipse,
                disableOutline,
                suppressMarkers,
            });
            upsertIndex += 1;
            ops += 1;
        }
        if (viewer.entities?.resumeEvents) viewer.entities.resumeEvents();
        const done = removeIndex >= removeIds.length && upsertIndex >= upsertEvents.length;
        if (done) {
            viewer.__warzoneEventSyncRaf = 0;
            viewer.__warzoneEventRenderState = nextState;
            applyEventLod(viewer);
            viewer.scene.requestRender();
            return;
        }
        viewer.scene.requestRender();
        viewer.__warzoneEventSyncRaf = requestAnimationFrame(() => step(removeIndex, upsertIndex));
    };
    step(0, 0);
}
function clearTrackedEventEntities(viewer) {
    cancelPendingEventSync(viewer);
    const ids = Array.from(__eventEntityIds);
    if (viewer?.entities?.suspendEvents) viewer.entities.suspendEvents();
    for (const id of ids) {
        try {
            const entity = viewer.entities.getById(id);
            if (entity) viewer.entities.remove(entity);
        } catch { }
    }
    if (viewer?.entities?.resumeEvents) viewer.entities.resumeEvents();
    __eventEntityIds.clear();
    __eventPulseEntities.clear();
    if (viewer) {
        viewer.__warzoneEventRenderState = new Map();
    }
    stopEventPulseRenderLoop(viewer);
    viewer.scene.requestRender();
}
function setTrackedEventLayerVisible(viewer, layerId = "", visible = true) {
    const targetLayerId = String(layerId || "").trim();
    if (!viewer || !targetLayerId) return;
    const show = visible !== false;
    for (const id of __eventEntityIds) {
        const entity = viewer.entities?.getById?.(id);
        let entityLayerId = String(getEntityPropertyValue(entity, "layer_id", "") || "").trim();
        if (!entityLayerId) {
            const parentEventId = String(getEntityPropertyValue(entity, "event_id", "") || "").trim();
            if (parentEventId) {
                const parentEntity = viewer.entities?.getById?.(parentEventId);
                entityLayerId = String(getEntityPropertyValue(parentEntity, "layer_id", "") || "").trim();
            }
        }
        if (entityLayerId !== targetLayerId) continue;
        entity.show = show;
    }
    viewer.scene.requestRender?.();
}
function setSatelliteImageryLayerVisible(viewer, visible = true) {
    if (!viewer) return false;
    const show = visible !== false;
    viewer.__warzoneSatelliteImageryLayerVisible = show;
    for (const id of __eventEntityIds) {
        const entity = viewer.entities?.getById?.(id);
        if (!isSatelliteImageryMarkerEntity(entity)) continue;
        entity.show = show;
        if (entity.billboard) entity.billboard.show = show;
    }
    viewer.scene?.requestRender?.();
    return show;
}
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
function cssPixelNumberVar(name, fallback) {
    const raw = cssVar(name, String(fallback));
    const parsed = Number(String(raw).replace(/px$/i, "").trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}
function cssLengthPixelVar(name, fallback) {
    const raw = cssVar(name, `${fallback}px`).trim().toLowerCase();
    const match = raw.match(/^(-?\d+(?:\.\d+)?)(px|rem)?$/);
    if (!match) return fallback;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return fallback;
    if (match[2] === "rem") {
        const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        return value * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
    }
    return value;
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
            return cssVar("--warzone-strike-color", "#ff5a4f");
        case "recon":
        case "recon_intel":
            return cssVar("--warzone-recon-color", "#57b8ff");
        case "military":
        case "ground_activity":
            return cssVar("--warzone-military-color", "#56d80e");
        case "air_activity":
            return cssVar("--warzone-air-activity-color", "#57b8ff");
        case "naval_activity":
            return cssVar("--warzone-naval-activity-color", "#9b7bff");
        case "alert":
            return cssVar("--warzone-alert-color", "#ff2a2a");
        case "airspace":
            return cssVar("--warzone-airspace-color", "#00d8b2");
        case "cyber":
            return cssVar("--warzone-cyber-color", "#9b7bff");
        case "thermal":
            return cssVar("--warzone-thermal-color", "#ff7a00");
        case "signal":
        case "seismic":
            return cssVar("--warzone-signal-color", "#ffd24d");
        case "unknown_activity":
            return cssVar("--warzone-default-color", "#ff7a45");
        default:
            return cssVar("--warzone-default-color", "#ff7a45");
    }
}
function getSeverityRadius(event) {
    return scoreToRadius(event?.weighted_activity_score || event?._activityScore || 0, {
        min: numberVar("--hotspot-ground-radius-min", 18000),
        max: numberVar("--hotspot-ground-radius-max", 120000),
        scoreAtMax: numberVar("--hotspot-score-at-max", 80),
    });
}
function getEventMarkerSizePx(count = 1, activityScore = 0) {
    const eventSize = Math.max(16, numberVar("--event-marker-size", numberVar("--warzone-event-marker-size", 44)));
    if (!(Number(count) > 1)) return eventSize;
    return scoreToRadius(activityScore, {
        min: Math.max(eventSize, numberVar("--hotspot-size-min", 48)),
        max: Math.max(eventSize, numberVar("--hotspot-size-max", 96)),
        scoreAtMax: numberVar("--hotspot-score-at-max", 80),
    });
}
function getEventMarkerScaleByDistance() {
    const nearDistance = Math.max(1, numberVar("--warzone-event-marker-scale-near-distance", 600000));
    const farDistance = Math.max(nearDistance + 1, numberVar("--warzone-event-marker-scale-far-distance", 12000000));
    const nearScale = Math.max(0.05, numberVar("--warzone-event-marker-scale-near", 1.45));
    const farScale = Math.max(0.05, numberVar("--warzone-event-marker-scale-far", 0.52));
    return new Cesium.NearFarScalar(nearDistance, nearScale, farDistance, farScale);
}
function getEventMarkerPerspectiveSquash(viewer) {
    const pitch = Math.abs(Number(viewer?.camera?.pitch ?? (-Math.PI / 2)));
    const topDownPitch = Math.PI / 2;
    const horizonRatio = Math.max(0, Math.min(1, 1 - (pitch / topDownPitch)));
    const maxSquash = Math.max(0, Math.min(0.86, numberVar("--warzone-event-marker-perspective-squash", 0.72)));
    return 1 - horizonRatio * maxSquash;
}
function getEventMarkerMetersPerPixel(entity, viewer = window.__warzoneViewer) {
    const scene = viewer?.scene;
    const camera = viewer?.camera;
    const position = entity?.position?.getValue?.(Cesium.JulianDate.now()) || null;
    if (!scene || !camera || !position) {
        return Math.max(40, numberVar("--warzone-event-marker-meters-per-pixel-fallback", 120));
    }
    try {
        const metersPerPixel = camera.getPixelSize(
            new Cesium.BoundingSphere(position, 1),
            Math.max(1, Number(scene.drawingBufferWidth || scene.canvas?.width || 1)),
            Math.max(1, Number(scene.drawingBufferHeight || scene.canvas?.height || 1))
        );
        if (Number.isFinite(metersPerPixel) && metersPerPixel > 0) return metersPerPixel;
    } catch { }
    return Math.max(40, numberVar("--warzone-event-marker-meters-per-pixel-fallback", 120));
}
function getEventRingBillboardScale(event = {}) {
    const base = Math.max(1, numberVar("--warzone-event-ring-size", 70000));
    const radius = Math.max(base, getSeverityRadius(event));
    const pixelSize = Math.max(72, Math.min(180, Math.sqrt(radius / base) * 84));
    return pixelSize / 512;
}
function getEventFillBillboardScale(event = {}) {
    const baseScale = getEventRingBillboardScale(event);
    const pixelSize = Math.max(38, Math.min(72, baseScale * 512 * 0.52));
    return pixelSize / 512;
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
function hashEventPulseSeed(event = {}) {
    const seed = [
        event?.id,
        event?.event_id,
        event?.title,
        event?.category,
        event?.severity,
        event?.lat,
        event?.lon,
    ].filter((value) => value !== undefined && value !== null && value !== "").join("|");
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
function getEventPulseSettings(event = {}) {
    const globalEnabled = boolVar("--warzone-event-ring-pulse-enabled", true);
    const pulseMode = event?.pulse_eligible === true ? String(event?.pulse_mode || "subtle") : "none";
    const enabled = globalEnabled && pulseMode !== "none";
    const hash = hashEventPulseSeed(event);
    const group = hash % 3;
    const durationVars = [
        "--warzone-event-ring-pulse-duration-a",
        "--warzone-event-ring-pulse-duration-b",
        "--warzone-event-ring-pulse-duration-c",
    ];
    const fallbackDurations = [2200, 3000, 3900];
    const baseDuration = numberVar("--hotspot-pulse-duration", numberVar(durationVars[group], fallbackDurations[group]));
    const durationMs = Math.max(1400, baseDuration * (pulseMode === "strong" ? 0.72 : 1));
    return {
        enabled,
        pulseMode,
        durationMs,
        offsetMs: ((hash >>> 3) % 1000) / 1000 * durationMs,
        radiusScale: Math.max(0, numberVar(
            pulseMode === "strong" ? "--hotspot-pulse-strong-scale" : "--hotspot-pulse-subtle-scale",
            pulseMode === "strong" ? 0.18 : 0.1
        )),
        alphaScale: Math.max(0, numberVar(
            pulseMode === "strong" ? "--hotspot-pulse-strong-alpha" : "--hotspot-pulse-subtle-alpha",
            pulseMode === "strong" ? 0.7 : 0.35
        )),
    };
}
function getEventPulseValue(settings) {
    if (!settings?.enabled) return 0;
    const now = typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    return ((now + settings.offsetMs) % settings.durationMs) / settings.durationMs;
}
function getEventPulsedRadius(radius, settings) {
    if (!settings?.enabled) return radius;
    const progress = getEventPulseValue(settings);
    const release = 1 - Math.pow(1 - progress, 2.2);
    return radius * (1 + release * settings.radiusScale);
}
function getEventPulsedFillAlpha(fillAlpha, settings) {
    if (!settings?.enabled) return fillAlpha;
    const progress = getEventPulseValue(settings);
    const fade = Math.pow(1 - progress, 1.35);
    const alpha = fillAlpha * Math.max(0, fade) * Math.max(0.10, settings.alphaScale);
    return Math.max(0.01, Math.min(alpha, 0.42));
}
function clearEventEllipsePulse(entity) {
    if (!entity) return;
    unregisterEventPulseEntity(entity);
    delete entity.__wzPulseBaseRadius;
    delete entity.__wzPulseBaseScale;
    delete entity.__wzMarkerBaseSizePx;
    delete entity.__wzPulseSettings;
    delete entity.__wzPulseColor;
    delete entity.__wzPulseFillAlpha;
}
function ensureEventEllipse(entity, radius, color, fillAlpha) {
    if (!entity || entity.ellipse) return;
    entity.ellipse = new Cesium.EllipseGraphics({
        semiMinorAxis: radius,
        semiMajorAxis: radius,
        material: color.withAlpha(fillAlpha),
        outline: false,
        outlineWidth: 0,
        height: 0,
        show: true,
    });
}
function applyEventPulseFrame(entity) {
    const settings = entity.__wzPulseSettings || {};
    const ellipse = entity?.ellipse;
    const markerBaseSizePx = Number(entity?.__wzMarkerBaseSizePx);
    if (ellipse && Number.isFinite(markerBaseSizePx) && markerBaseSizePx > 0) {
        const metersPerPixel = getEventMarkerMetersPerPixel(entity);
        if (!settings?.enabled) {
            const radiusMeters = Math.max(1, metersPerPixel * markerBaseSizePx * 0.5);
            ellipse.semiMinorAxis = radiusMeters;
            ellipse.semiMajorAxis = radiusMeters;
            if (entity.__wzPulseColor && Number.isFinite(entity.__wzPulseFillAlpha)) {
                const maxAlpha = Math.max(0, Math.min(0.70, entity.__wzPulseFillAlpha));
                ellipse.material = entity.__wzPulseColor.withAlpha(maxAlpha);
            }
        } else {
            const progress = getEventPulseValue(settings);
            const release = 1 - Math.pow(1 - progress, 2.2);
            const fade = Math.pow(1 - progress, 1.35);
            const pulseDiameterPx = markerBaseSizePx * (0.78 + release * 0.32);
            const radiusMeters = Math.max(1, metersPerPixel * pulseDiameterPx * 0.5);
            ellipse.semiMinorAxis = radiusMeters;
            ellipse.semiMajorAxis = radiusMeters;
            if (entity.__wzPulseColor && Number.isFinite(entity.__wzPulseFillAlpha)) {
                const maxAlpha = Math.max(0, Math.min(0.70, entity.__wzPulseFillAlpha));
                const alpha = Math.max(0, Math.min(maxAlpha, maxAlpha * fade));
                ellipse.material = entity.__wzPulseColor.withAlpha(alpha);
            }
        }
    }
    const baseRadius = Number(entity?.__wzPulseBaseRadius);
    if (ellipse && Number.isFinite(baseRadius) && baseRadius > 0) {
        const nextRadius = getEventPulsedRadius(baseRadius, settings);
        ellipse.semiMinorAxis = nextRadius;
        ellipse.semiMajorAxis = nextRadius;
        if (entity.__wzPulseColor && Number.isFinite(entity.__wzPulseFillAlpha)) {
            ellipse.material = entity.__wzPulseColor.withAlpha(
                getEventPulsedFillAlpha(entity.__wzPulseFillAlpha, settings)
            );
        }
    }
    const billboard = entity?.billboard;
    const baseSizePx = Number(entity?.__wzPulseBaseSizePx);
    if (billboard && Number.isFinite(baseSizePx) && baseSizePx > 0) {
        const squash = getEventMarkerPerspectiveSquash(window.__warzoneViewer);
        if (!settings?.enabled) {
            billboard.width = baseSizePx;
            billboard.height = baseSizePx * squash;
            billboard.scale = 1;
            billboard.color = Cesium.Color.WHITE.withAlpha(1);
            return;
        }
        const progress = getEventPulseValue(settings);
        const release = 1 - Math.pow(1 - progress, 2.2);
        const fade = Math.pow(1 - progress, 1.45);
        const pulseSize = baseSizePx * (0.92 + release * settings.radiusScale);
        billboard.width = pulseSize;
        billboard.height = pulseSize * squash;
        billboard.scale = 1;
        const maxAlpha = Math.max(0.1, Math.min(1, numberVar("--warzone-event-pulse-alpha-max", 0.96)));
        const alpha = Math.max(0, Math.min(maxAlpha, fade * maxAlpha));
        billboard.color = Cesium.Color.WHITE.withAlpha(alpha);
    }
    if (entity?.__wzTransitionOnly && getTransitionProgress(entity.__wzTransitionEvent || {}) >= 1) {
        unregisterEventPulseEntity(entity);
        delete entity.__wzTransitionOnly;
        delete entity.__wzTransitionEvent;
    }
}
function getCategoryCssKey(category) {
    switch (String(category || "").toLowerCase()) {
        case "strike": return "strike";
        case "recon":
        case "recon_intel": return "recon";
        case "military":
        case "ground_activity": return "military";
        case "air_activity": return "air-activity";
        case "naval_activity": return "naval-activity";
        case "alert": return "alert";
        case "airspace": return "airspace";
        case "cyber": return "cyber";
        case "thermal": return "thermal";
        case "signal":
        case "seismic": return "signal";
        default: return "default";
    }
}
function getEventDomain(eventOrCategory) {
    if (eventOrCategory && typeof eventOrCategory === "object") {
        return String(eventOrCategory.dominant_domain || eventOrCategory._dominantDomain || classifyEventDomain(eventOrCategory)).toUpperCase();
    }
    return classifyEventDomain({ category: eventOrCategory });
}
function getEventDomainColorCss(eventOrCategory) {
    const domain = getEventDomain(eventOrCategory).toLowerCase();
    const key = domain === "air_defence" ? "airdefence" : domain;
    return cssVar(`--activity-${key}`, getCategoryColorCss(eventOrCategory?.category || eventOrCategory));
}
function getEventMarkerColorCss(eventOrCategory) {
    return getEventDomainColorCss(eventOrCategory);
}
function getEventPulseColorCss(eventOrCategory) {
    return getEventDomainColorCss(eventOrCategory);
}
function getEventHotspotColorCss(eventOrCategory) {
    return getEventDomainColorCss(eventOrCategory);
}
function updateEventPulseFrame(viewer) {
    if (!viewer) return;
    for (const entity of __eventPulseEntities) {
        applyEventPulseFrame(entity);
    }
}
function applyEventEllipsePulse(entity, radius, color, fillAlpha, event = {}) {
    const ellipse = entity?.ellipse;
    if (!ellipse) return;
    const settings = getEventPulseSettings(event);
    entity.__wzPulseBaseRadius = radius;
    entity.__wzPulseSettings = settings;
    entity.__wzPulseColor = color;
    entity.__wzPulseFillAlpha = fillAlpha;
    registerEventPulseEntity(entity);
    ellipse.show = true;
    ellipse.outline = false;
    ellipse.outlineWidth = 0;
    ellipse.material = color.withAlpha(fillAlpha);
    applyEventPulseFrame(entity);
}
function applyEventBillboardPulse(entity, baseScale, fillAlpha, event = {}) {
    const billboard = entity?.billboard;
    if (!billboard) return;
    const settings = getEventPulseSettings(event);
    entity.__wzPulseBaseSizePx = baseScale;
    entity.__wzPulseSettings = settings;
    entity.__wzPulseFillAlpha = fillAlpha;
    registerEventPulseEntity(entity);
    billboard.show = true;
    applyEventPulseFrame(entity);
}
function applyEventMarkerEllipsePulse(entity, baseSizePx, color, fillAlpha, event = {}) {
    const ellipse = entity?.ellipse;
    if (!ellipse) return;
    const settings = getEventPulseSettings(event);
    entity.__wzMarkerBaseSizePx = baseSizePx;
    entity.__wzPulseBaseSizePx = baseSizePx;
    entity.__wzPulseSettings = settings;
    entity.__wzPulseColor = color;
    entity.__wzPulseFillAlpha = fillAlpha;
    registerEventPulseEntity(entity);
    ellipse.show = true;
    ellipse.outline = false;
    ellipse.outlineWidth = 0;
    ellipse.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    applyEventPulseFrame(entity);
}
function isEntityGraphicVisible(graphic) {
    if (!graphic) return false;
    const show = graphic.show;
    if (show === undefined) return true;
    if (typeof show === "boolean") return show;
    try {
        return show.getValue?.() !== false;
    } catch {
        return true;
    }
}
function shouldRunEventPulseRenderLoop(viewer) {
    if (document.hidden || viewer?.__warzoneSuppressEventMarkers === true) return false;
    const hasVisiblePulse = Array.from(__eventPulseEntities).some((entity) => (
        entity?.__wzPulseSettings?.enabled === true &&
        (isEntityGraphicVisible(entity.ellipse) || isEntityGraphicVisible(entity.billboard))
    ));
    return Boolean(
        viewer &&
        boolVar("--warzone-event-ring-pulse-enabled", true) &&
        hasVisiblePulse
    );
}
function startEventPulseRenderLoop(viewer) {
    if (!viewer || viewer.__warzoneEventPulseRaf) return;
    let lastRenderAt = 0;
    const tick = (now) => {
        viewer.__warzoneEventPulseRaf = 0;
        if (!shouldRunEventPulseRenderLoop(viewer)) return;
        const fps = Math.max(1, numberVar("--warzone-event-ring-pulse-fps", 36));
        if (now - lastRenderAt >= 1000 / fps) {
            lastRenderAt = now;
            updateEventPulseFrame(viewer);
            viewer.scene?.requestRender?.();
        }
        viewer.__warzoneEventPulseRaf = requestAnimationFrame(tick);
    };
    viewer.__warzoneEventPulseRaf = requestAnimationFrame(tick);
}
function stopEventPulseRenderLoop(viewer) {
    if (!viewer?.__warzoneEventPulseRaf) return;
    cancelAnimationFrame(viewer.__warzoneEventPulseRaf);
    viewer.__warzoneEventPulseRaf = 0;
}
function normalizeEvents(events) {
    if (!Array.isArray(events)) return [];
    const optionalNumber = (value) => (
        value === null || value === undefined || value === "" ? null : Number(value)
    );
    return events
        .map((item, index) => {
            const base = {
                id: item.id || `event-${index + 1}`,
                title: item.display_title || item.title || "Activity update",
                summary: item.display_summary || item.summary || "",
                category: item.category || "strike",
                severity: item.severity || "medium",
                source_lat: optionalNumber(item.source_lat),
                source_lon: optionalNumber(item.source_lon),
                lat: optionalNumber(item.lat),
                lon: optionalNumber(item.lon),
                origin_lat: optionalNumber(item.origin_lat),
                origin_lon: optionalNumber(item.origin_lon),
                origin_label: item.origin_label || "",
                impact_lat: optionalNumber(item.impact_lat ?? item.lat),
                impact_lon: optionalNumber(item.impact_lon ?? item.lon),
                impact_label: item.impact_label || item.display_location_label || item.location_label || "",
                location_label: item.display_location_label || item.location_label || "",
                display_title: item.display_title || item.title || "Activity update",
                display_summary: item.display_summary || item.summary || "",
                display_source_name: item.display_source_name || "",
                display_location_label: item.display_location_label || "",
                source_name: item.source_name || "",
                satellite_context: item.satellite_context || item.satelliteContext || null,
                satellite_available: item.satellite_available === true || item.satelliteAvailable === true,
                cluster_count: Number(item.cluster_count || item._clusterCount || 0) || undefined,
                _clusterCount: Number(item.cluster_count || item._clusterCount || 0) || undefined,
                actual_event_count: Number(item.actual_event_count || item.cluster_count || item._clusterCount || 0) || undefined,
                event_ids: Array.isArray(item.event_ids) ? item.event_ids : [],
                weighted_activity_score: Number(item.weighted_activity_score || item._activityScore || 0),
                dominant_domain: item.dominant_domain || item._dominantDomain || "",
                domain_distribution: item.domain_distribution && typeof item.domain_distribution === "object"
                    ? item.domain_distribution
                    : null,
                centroid: item.centroid && typeof item.centroid === "object" ? item.centroid : null,
                bounds: item.bounds && typeof item.bounds === "object" ? item.bounds : null,
                is_report_cluster_summary: item.is_report_cluster_summary === true,
                report_label_visible: item.report_label_visible === true,
                report_label: item.report_label && typeof item.report_label === "object" ? item.report_label : null,
                _clusterEvents: Array.isArray(item._clusterEvents)
                    ? item._clusterEvents
                    : (Array.isArray(item.cluster_events) ? item.cluster_events : []),
                media: item.media || null,
                primary_image: item.primary_image || item.primaryImage || null,
                additional_images: Array.isArray(item.additional_images)
                    ? item.additional_images
                    : (Array.isArray(item.additionalImages) ? item.additionalImages : []),
                image_source: item.image_source || item.imageSource || "",
                image_caption: item.image_caption || item.imageCaption || "",
                image_credit: item.image_credit || item.imageCredit || "",
                image_type: item.image_type || item.imageType || "",
                map_eligible: item.map_eligible,
                mapEligible: item.mapEligible,
                report_type: item.report_type || "",
                tags: Array.isArray(item.tags) ? item.tags : [],
                metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
                location_precision: item.location_precision || "",
                location_confidence: Number(item.location_confidence || 0),
                corroboration_state: item.corroboration_state || item.verification_state || "",
                independent_source_family_count: Number(item.independent_source_family_count || 1),
                source_tier: item.source_tier || "",
                confidence_score: Number(item.confidence_score ?? item.confidence ?? 50),
                country: item.country || item.countryName || "",
                city: item.city || "",
                province: item.province || item.state || item.admin1 || "",
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
            };
            const placement = resolveDisplayCoordinates(base);
            return {
                ...base,
                display_lat: placement.lat,
                display_lon: placement.lon,
                display_source: placement.reason,
                display_precision: placement.precision,
                inferred_place_type: placement.placeType,
                inferred_country_code: placement.countryCode,
                inferred_country_name: placement.countryName,
                inferred_place_name: placement.resolvedPlaceName,
                location_mismatch: placement.mismatch,
                lat: placement.lat,
                lon: placement.lon
            };
        })
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
}
/* ---------- Marker canvases ---------- */
function colorCssWithAlpha(colorCss, alpha = 1) {
    try {
        const color = Cesium.Color.fromCssColorString(colorCss);
        const r = Math.round(color.red * 255);
        const g = Math.round(color.green * 255);
        const b = Math.round(color.blue * 255);
        return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
    } catch {
        return colorCss;
    }
}
function createMarkerCanvas(colorCss) {
    const sz = Math.max(128, Math.min(512, Math.round(numberVar("--warzone-event-marker-single-canvas-size", 256))));
    const borderColorCss = cssVar("--warzone-event-marker-border-color", colorCss);
    const borderAlpha = Math.max(0, Math.min(1, numberVar("--warzone-event-marker-border-alpha", 0.38)));
    const borderWidthPx = Math.max(0, numberVar("--warzone-event-marker-border-width", 9));
    const key = `marker:${colorCss}:${borderColorCss}:${borderAlpha}:${borderWidthPx}:${sz}`;
    if (markerCache.has(key)) return markerCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d");
    const cx = sz / 2;
    const cy = sz / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = colorCssWithAlpha(colorCss, numberVar("--warzone-event-marker-fill-alpha", 0.82));
    ctx.beginPath();
    ctx.arc(cx, cy, sz * 0.242, 0, Math.PI * 2);
    ctx.fill();
    if (borderWidthPx > 0 && borderAlpha > 0) {
        const screenMarkerSize = Math.max(1, getEventMarkerSizePx(1));
        const lineWidth = Math.max(1, borderWidthPx * (sz / screenMarkerSize));
        ctx.strokeStyle = colorCssWithAlpha(borderColorCss === "currentColor" ? colorCss : borderColorCss, borderAlpha);
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min((sz / 2) - lineWidth / 2, (sz * 0.242) + lineWidth / 2), 0, Math.PI * 2);
        ctx.stroke();
    }
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(markerCache, key, dataUrl, MARKER_CACHE_MAX_ITEMS);
    return dataUrl;
}
// Cluster marker with embedded count text; avoids duplicate Cesium labels at close zoom.
function createClusterMarkerCanvas(colorCss, count, severity = "medium") {
    const discScale = Math.max(0.28, Math.min(0.82, numberVar("--warzone-event-marker-disc-scale", 0.58)));
    const severityKey = String(severity || "medium").toLowerCase();
    const borderColorCss = cssVar(`--hotspot-severity-${severityKey}-color`, cssVar("--warzone-event-marker-border-color", colorCss));
    const borderAlpha = Math.max(0, Math.min(1, numberVar(`--hotspot-severity-${severityKey}-alpha`, 0.86)));
    const borderWidthPx = Math.max(0, numberVar(`--event-marker-ring-width-${severityKey}`, numberVar(`--hotspot-severity-${severityKey}-width`, numberVar("--hotspot-border-width", 4))));
    const glowPx = Math.max(0, numberVar(`--event-marker-ring-glow-${severityKey}`, numberVar(`--hotspot-severity-${severityKey}-glow`, numberVar("--hotspot-glow", 12))));
    const canvasSize = Math.max(512, Math.min(2048, Math.round(numberVar("--warzone-event-marker-canvas-size", 1024))));
    const key = `cluster:${colorCss}:${Math.min(count, 999)}:${discScale}:${borderColorCss}:${borderAlpha}:${borderWidthPx}:${glowPx}:${canvasSize}`;
    if (markerCache.has(key)) return markerCache.get(key);
    const sz = canvasSize;
    const cx = sz / 2;
    const cy = sz / 2;
    const discR = Math.min((158 + Math.log2(Math.max(count, 2)) * 14) * (sz / 512), sz * discScale);
    const canvas = document.createElement("canvas");
    canvas.width = sz;
    canvas.height = sz;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = colorCssWithAlpha(colorCss, numberVar("--warzone-event-marker-fill-alpha", 0.82));
    ctx.shadowColor = colorCssWithAlpha(borderColorCss, borderAlpha * 0.72);
    ctx.shadowBlur = glowPx * (sz / 256);
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (borderWidthPx > 0 && borderAlpha > 0) {
        const screenMarkerSize = Math.max(1, getEventMarkerSizePx(count));
        const lineWidth = Math.max(1, borderWidthPx * (sz / screenMarkerSize));
        const ringR = Math.min((sz / 2) - (lineWidth / 2) - 4, discR + (lineWidth / 2));
        if (ringR > 0) {
            ctx.strokeStyle = colorCssWithAlpha(borderColorCss === "currentColor" ? colorCss : borderColorCss, borderAlpha);
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(markerCache, key, dataUrl, MARKER_CACHE_MAX_ITEMS);
    return dataUrl;
}
function createEventPulseRingCanvas(colorCss = "#f51e58", size = 512) {
    const lineWidth = Math.max(1, Math.min(32, numberVar("--warzone-event-pulse-line-width", 8)));
    const innerScale = Math.max(0.20, Math.min(0.48, numberVar("--warzone-event-pulse-ring-inner-scale", 0.40)));
    const key = `event-pulse-ring|${colorCss}|${size}|${lineWidth}|${innerScale}`;
    if (ringCanvasCache.has(key)) return ringCanvasCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = colorCssWithAlpha(colorCss, 1);
    ctx.lineCap = "round";
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = colorCssWithAlpha(colorCss, 0.55);
    ctx.shadowBlur = lineWidth * 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, size * innerScale, 0, Math.PI * 2);
    ctx.stroke();
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(ringCanvasCache, key, dataUrl, RING_CACHE_MAX_ITEMS);
    return dataUrl;
}
function createSatelliteBadgeCanvas() {
    if (markerCache.has(SATELLITE_BADGE_CACHE_KEY)) return markerCache.get(SATELLITE_BADGE_CACHE_KEY);
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 144;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(8, 17, 26, 0.92)";
    ctx.strokeStyle = cssVar("--color-teal-glow", "#18e2db");
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(24, 16);
    ctx.lineTo(168, 16);
    ctx.lineTo(168, 102);
    ctx.lineTo(144, 128);
    ctx.lineTo(24, 128);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = cssVar("--color-teal-glow", "#18e2db");
    ctx.font = "900 44px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SAT", 96, 74);
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(markerCache, SATELLITE_BADGE_CACHE_KEY, dataUrl, MARKER_CACHE_MAX_ITEMS);
    return dataUrl;
}
function createSatelliteImageryRingCanvas() {
    const ringColor = cssVar(
        "--warzone-satellite-imagery-ring-color",
        "#18e2db"
    );

    const ringAlpha = clamp01(
        numberVar("--warzone-satellite-imagery-ring-alpha", 0.75)
    );

    const ringSizePx = Math.max(
        8,
        numberVar("--warzone-satellite-imagery-ring-size-px", 62)
    );

    const ringWidthPx = Math.max(
        1,
        numberVar("--warzone-satellite-imagery-ring-width-px", 2)
    );

    const cacheKey =
        `${SATELLITE_IMAGERY_MARKER_CACHE_KEY}:ring:` +
        `${ringColor}:${ringAlpha}:${ringSizePx}:${ringWidthPx}`;

    if (markerCache.has(cacheKey)) {
        return markerCache.get(cacheKey);
    }

    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);

    const scaledWidth = ringWidthPx * (size / ringSizePx);

    ctx.strokeStyle = colorCssWithAlpha(ringColor, ringAlpha);
    ctx.lineWidth = scaledWidth;

    ctx.beginPath();
    ctx.arc(
        size / 2,
        size / 2,
        (size / 2) - scaledWidth - 4,
        0,
        Math.PI * 2
    );
    ctx.stroke();

    const dataUrl = canvas.toDataURL("image/png");

    setLimitedCache(
        markerCache,
        cacheKey,
        dataUrl,
        MARKER_CACHE_MAX_ITEMS
    );

    return dataUrl;
}
function createClusterCountLabel(count = 1) {
    if (!(count >= 1)) return undefined;
    const text = count > 999 ? "999+" : String(Math.max(1, count));
    const fontSize = count > 99
        ? cssVar("--warzone-event-count-font-size-100plus", "20px")
        : count > 9
            ? cssVar("--warzone-event-count-font-size-10plus", "24px")
            : cssVar("--warzone-event-count-font-size", "26px");
    return {
        text,
        font: `800 ${fontSize} ${stringVar("--heading-font", "system-ui, Arial, sans-serif")}`,
        fillColor: colorFromCssVar("--warzone-event-marker-text-color", "#ffffff", 0.98),
        outlineColor: Cesium.Color.TRANSPARENT,
        outlineWidth: 0,
        style: Cesium.LabelStyle.FILL,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, 0),
        eyeOffset: new Cesium.Cartesian3(0, 0, -5000),
        disableDepthTestDistance: Math.max(0, numberVar("--warzone-event-marker-depth-test-distance", 0)),
        zIndex: 1000,
        showBackground: false,
    };
}
function createReportClusterLabel(event = {}) {
    const count = Math.max(1, Number(event.cluster_count || event.actual_event_count || 1));
    const reportLabel = event.report_label && typeof event.report_label === "object" ? event.report_label : {};
    const location = String(reportLabel.location || event.location_label || event.display_location_label || "OPERATIONAL AREA").trim().toUpperCase();
    const domain = String(reportLabel.domain || event.dominant_domain || event.category || "MIXED").replace(/_/g, " ").trim().toUpperCase();
    return {
        text: `${count} EVENT${count === 1 ? "" : "S"}\n${location}\n${domain}`,
        font: `800 15px ${stringVar("--heading-font", "system-ui, Arial, sans-serif")}`,
        fillColor: colorFromCssVar("--warzone-event-marker-text-color", "#ffffff", 0.98),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.96),
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(34, 0),
        eyeOffset: new Cesium.Cartesian3(0, 0, -5000),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        zIndex: 1100,
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.76),
        backgroundPadding: new Cesium.Cartesian2(8, 6),
    };
}
function getEventMarkerText(event = {}) {
    const title = String(event.title || event.display_title || "").toLowerCase();
    const domain = getEventDomain(event);
    if (domain === "AIR") return /\b(?:uav|drone)\b/.test(title) ? "UAV Activity" : "Air Activity";
    if (domain === "STRIKE") {
        if (/\b(?:explosion|blast|detonation)\b/.test(title)) return "Explosion";
        if (/\bairstrike\b/.test(title)) return "Airstrike";
        return "Strike";
    }
    const labels = {
        MISSILE: "Missile",
        ARTILLERY: "Artillery",
        AIR_DEFENCE: "Air Defence",
        MARITIME: "Maritime",
        CYBER: "Cyber",
        GNSS: "GNSS",
        ALERT: "Alert",
        MIXED: "Event",
    };
    return labels[domain] || "Event";
}
function formatEventMarkerLabelText(text = "Event") {
    return String(text || "Event").trim().replace(/\s+/g, " ").toUpperCase();
}
function measureTrackedCanvasText(ctx, text, letterSpacing = 0) {
    const characters = Array.from(text);
    return characters.reduce((width, character, index) => (
        width + ctx.measureText(character).width + (index < characters.length - 1 ? letterSpacing : 0)
    ), 0);
}
function drawTrackedCanvasText(ctx, text, x, y, letterSpacing = 0) {
    let cursorX = x;
    Array.from(text).forEach((character, index, characters) => {
        ctx.fillText(character, cursorX, y);
        cursorX += ctx.measureText(character).width + (index < characters.length - 1 ? letterSpacing : 0);
    });
}
function createEventMarkerTextBillboard(text = "Event") {
    const normalized = formatEventMarkerLabelText(text);
    const pixelRatio = Math.max(4, Math.min(6, (Number(window.devicePixelRatio) || 1) * 3));
    const fontSize = Math.max(1, cssLengthPixelVar("--event-marker-label-size", 12));
    const letterSpacing = Math.max(0, cssLengthPixelVar("--event-marker-label-letter-spacing", 1));
    const fontWeight = Math.max(100, Math.min(900, numberVar("--event-marker-label-font-weight", 600)));
    const fontFamily = stringVar("--text-font", "system-ui, Arial, sans-serif");
    const paddingX = Math.max(0, cssLengthPixelVar("--event-marker-label-padding-x", 8));
    const paddingTop = Math.max(0, cssLengthPixelVar("--event-marker-label-padding-top", 8));
    const paddingBottom = Math.max(0, cssLengthPixelVar("--event-marker-label-padding-bottom", 6));
    const cutSize = Math.max(0, cssLengthPixelVar("--event-marker-label-cut-size", 10));
    const background = cssVar("--color-bg-dark", "rgba(32,38,49,0.85)");
    const foreground = cssVar("--warzone-event-marker-text-color", "#ffffff");
    const font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const cacheKey = [normalized, pixelRatio, font, letterSpacing, paddingX, paddingTop, paddingBottom, cutSize, background, foreground].join("|");
    if (eventLabelCanvasCache.has(cacheKey)) return eventLabelCanvasCache.get(cacheKey);

    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    measureContext.font = font;
    const textWidth = Math.ceil(measureTrackedCanvasText(measureContext, normalized, letterSpacing));
    const lineHeight = Math.ceil(fontSize * 1.2);
    const logicalWidth = Math.max(1, Math.ceil(textWidth + paddingX * 2));
    const logicalHeight = Math.max(1, Math.ceil(lineHeight + paddingTop + paddingBottom));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(logicalWidth * pixelRatio);
    canvas.height = Math.ceil(logicalHeight * pixelRatio);
    const ctx = canvas.getContext("2d");
    ctx.scale(pixelRatio, pixelRatio);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(logicalWidth, 0);
    ctx.lineTo(logicalWidth, logicalHeight - cutSize);
    ctx.lineTo(logicalWidth - cutSize, logicalHeight);
    ctx.lineTo(0, logicalHeight);
    ctx.closePath();
    ctx.fillStyle = background;
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = foreground;
    ctx.textBaseline = "top";
    drawTrackedCanvasText(ctx, normalized, paddingX, paddingTop, letterSpacing);
    const result = { image: canvas, width: logicalWidth, height: logicalHeight };
    setLimitedCache(eventLabelCanvasCache, cacheKey, result, 48);
    return result;
}
function createEventMarkerTextLabel(text = "Event") {
    const label = createEventMarkerTextBillboard(text);
    return {
        image: label.image,
        width: label.width,
        height: label.height,
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(numberVar("--event-marker-label-offset-x", 30), 0),
        eyeOffset: new Cesium.Cartesian3(0, 0, -5000),
        disableDepthTestDistance: Math.max(0, numberVar("--warzone-event-marker-depth-test-distance", 0)),
    };
}
function createEventCountEntity(event) {
    const count = Number(event?.cluster_count || 1);
    const eventMarkerLabel = getEventMarkerText(event);
    const isReportCluster = window.__stratopsReportCaptureMode === true && event.is_report_cluster_summary === true;
    const label = isReportCluster ? createReportClusterLabel(event) : (count > 1 ? createClusterCountLabel(count) : null);
    const billboard = !isReportCluster && count === 1 ? createEventMarkerTextLabel(eventMarkerLabel) : null;
    if (!label && !billboard) return null;
    return {
        id: `${event.id}-count`,
        position: createEventPositionProperty(event),
        ...(label ? {
            label: {
                ...label,
                show: getEventZoomState(window.__warzoneViewer) === ZOOM_UX_STATES.EVENT && count === 1,
            }
        } : {}),
        ...(billboard ? {
            billboard: {
                ...billboard,
                show: getEventZoomState(window.__warzoneViewer) === ZOOM_UX_STATES.EVENT,
            }
        } : {}),
        properties: {
            event_id: event.id,
            isEventCountLabel: true,
            event_marker_label: eventMarkerLabel,
            layer_id: event._layerId || event.layer_id || "",
            category: event.category,
            severity: event.severity,
            cluster_count: count,
            activity_score: Number(event.weighted_activity_score || event._activityScore || 0),
            dominant_domain: event.dominant_domain || event._dominantDomain || classifyEventDomain(event),
            location_label: event.location_label || event.display_location_label || "",
            is_report_cluster_summary: event.is_report_cluster_summary === true,
            report_label_visible: event.report_label_visible === true,
            report_label: event.report_label || null,
            lat: event.lat,
            lon: event.lon,
        },
    };
}
function createRingCanvas(strokeCss = "#f51e58", size = 512, lineWidth = 20) {
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
    setLimitedCache(ringCanvasCache, key, dataUrl, RING_CACHE_MAX_ITEMS);
    return dataUrl;
}
function createTacticalStrikeLabel(text, accentCss) {
    const cleanText = String(text || "ACTIVITY")
        .replace(/(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]|[\uFE0E\uFE0F\u200D\u20E3])/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase() || "ACTIVITY";
    const pixelRatio = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
    const fontSize = Math.max(11, cssPixelNumberVar("--hotspot-label-size", 14));
    const lineHeight = Math.ceil(fontSize * 1.25);
    const horizontalPadding = 12;
    const verticalPadding = 8;
    const shadowPadding = 10;
    const cutSize = 9;
    const maxTextWidth = 240;
    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    const fontFamily = cssVar("--heading-font", "sans-serif");
    const font = `800 ${fontSize}px ${fontFamily}`;
    measureContext.font = font;
    if ("letterSpacing" in measureContext) measureContext.letterSpacing = "1.2px";
    const words = cleanText.split(" ");
    const lines = [];
    let currentLine = "";
    for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (!currentLine || measureContext.measureText(candidate).width <= maxTextWidth) {
            currentLine = candidate;
            continue;
        }
        lines.push(currentLine);
        currentLine = word;
        if (lines.length === 2) break;
    }
    if (lines.length < 2 && currentLine) lines.push(currentLine);
    const consumed = lines.join(" ");
    if (consumed.length < cleanText.length && lines.length) {
        let finalLine = lines[lines.length - 1].replace(/[.\s]+$/, "");
        while (finalLine.length > 1 && measureContext.measureText(`${finalLine}…`).width > maxTextWidth) {
            finalLine = finalLine.slice(0, -1).trimEnd();
        }
        lines[lines.length - 1] = `${finalLine}…`;
    }
    const textWidth = Math.min(
        maxTextWidth,
        Math.max(...lines.map((line) => measureContext.measureText(line).width), fontSize * 5)
    );
    const boxWidth = Math.ceil(textWidth + horizontalPadding * 2);
    const boxHeight = Math.ceil(lines.length * lineHeight + verticalPadding * 2);
    const logicalWidth = boxWidth + shadowPadding * 2;
    const logicalHeight = boxHeight + shadowPadding * 2;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(logicalWidth * pixelRatio);
    canvas.height = Math.ceil(logicalHeight * pixelRatio);
    const ctx = canvas.getContext("2d");
    ctx.scale(pixelRatio, pixelRatio);
    ctx.imageSmoothingEnabled = true;
    const x = shadowPadding;
    const y = shadowPadding;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + boxWidth - cutSize, y);
    ctx.lineTo(x + boxWidth, y + cutSize);
    ctx.lineTo(x + boxWidth, y + boxHeight);
    ctx.lineTo(x + cutSize, y + boxHeight);
    ctx.lineTo(x, y + boxHeight - cutSize);
    ctx.closePath();
    ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = cssVar("--hotspot-stack-background", "rgba(7, 13, 19, 0.94)");
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = accentCss;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = accentCss;
    ctx.fillRect(x, y + 1, 4, boxHeight - 2);
    ctx.fillStyle = cssVar("--color-text-heading", "#f2f5f7");
    ctx.font = font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1.2px";
    ctx.textBaseline = "top";
    lines.forEach((line, index) => {
        ctx.fillText(line, x + horizontalPadding, y + verticalPadding + index * lineHeight, maxTextWidth);
    });
    ctx.restore();
    return { image: canvas, width: logicalWidth, height: logicalHeight };
}
function createEventCircleCanvas(colorCss = "#f51e58", size = 512) {
    const key = `event-circle|${colorCss}|${size}`;
    if (ringCanvasCache.has(key)) return ringCanvasCache.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.46;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = colorCss;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    const dataUrl = canvas.toDataURL("image/png");
    setLimitedCache(ringCanvasCache, key, dataUrl, RING_CACHE_MAX_ITEMS);
    return dataUrl;
}
function normalizeEventSourceUrl(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const direct = raw.match(/^https?:\/\/[^\s<>"']+/i);
    if (direct) return direct[0];
    const embedded = raw.match(/https?:\/\/[^\s<>"']+/i);
    return embedded ? embedded[0] : "";
}
function resolveGlobeEventSourceUrl(event = {}) {
    const metadata = event?.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
        ? event.metadata
        : {};
    const candidates = [
        event?.source_url,
        event?.sourceUrl,
        event?.source_link,
        event?.sourceLink,
        event?.external_url,
        event?.article_url,
        event?.post_url,
        event?.canonical_url,
        event?.url,
        event?.link,
        metadata.source_url,
        metadata.sourceUrl,
        metadata.source_link,
        metadata.sourceLink,
        metadata.external_url,
        metadata.article_url,
        metadata.post_url,
        metadata.canonical_url,
        metadata.url,
        metadata.link,
    ];
    for (const candidate of candidates) {
        const url = normalizeEventSourceUrl(candidate);
        if (url) return url;
    }
    return "";
}
function hasAvailableSatellitePreview(event = {}) {
    const context = event?.satellite_context || event?.satelliteContext || null;
    const imageUrl = String(context?.imageUrl || context?.image_url || "").trim();
    return String(context?.status || "").toLowerCase() === "available" && /^https?:\/\//i.test(imageUrl);
}
function buildSatelliteImageryEntityProperties(event, count, extra = {}) {
    return {
        event_id: event.id,
        isSatelliteImageryMarker: true,

        layer_id: event._layerId || event.layer_id || "",
        cluster_count: count,

        lat: event.lat,
        lon: event.lon,

        title: event.title,
        display_title: event.display_title,

        summary: event.summary,
        display_summary: event.display_summary,

        display_location_label: event.display_location_label,
        location_label: event.location_label,

        occurred_at: event.occurred_at,

        source_name: event.source_name,
        display_source_name: event.display_source_name,
        source_url: resolveGlobeEventSourceUrl(event),

        satellite_context:
            event.satellite_context ||
            event.satelliteContext ||
            null,

        ...extra,
    };
}

function createEventSatelliteBadgeEntity(event, options = {}) {
    if (!hasAvailableSatellitePreview(event)) return null;

    const count = Number(event?.cluster_count || 1);

    const markerSizePx = Math.max(
        16,
        numberVar("--warzone-satellite-imagery-marker-size-px", 48)
    );

    const offsetX = numberVar(
        "--warzone-satellite-imagery-offset-x-px",
        28
    );

    const offsetY = numberVar(
        "--warzone-satellite-imagery-offset-y-px",
        -28
    );

    const eyeOffsetZ = numberVar(
        "--warzone-satellite-imagery-eye-offset-z",
        -12000
    );

    const iconUrl = readCssAssetPath(
        "--warzone-satellite-imagery-icon-url",
        "/assets/images/icons/satellite-observation.png"
    );

    const iconAlpha = clamp01(
        numberVar("--warzone-satellite-imagery-icon-alpha", 1)
    );

    const iconColor = colorFromCssVar(
        "--warzone-satellite-imagery-icon-color",
        "#18e2db",
        iconAlpha
    );

    const satelliteVisible =
        options?.satelliteImageryVisible !== false;

    return {
        id: `${event.id}-satellite-imagery`,

        position: createEventPositionProperty(event),

        billboard: {
            image: iconUrl,

            width: markerSizePx,
            height: markerSizePx,

            color: iconColor,

            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,

            pixelOffset: new Cesium.Cartesian2(
                offsetX,
                offsetY
            ),

            eyeOffset: new Cesium.Cartesian3(
                0,
                0,
                eyeOffsetZ
            ),

            heightReference:
                Cesium.HeightReference.CLAMP_TO_GROUND,

            disableDepthTestDistance:
                Number.POSITIVE_INFINITY,

            show: satelliteVisible,
        },

        properties:
            buildSatelliteImageryEntityProperties(
                event,
                count
            ),
    };
}

function createEventSatelliteRingEntity(event, options = {}) {
    if (!hasAvailableSatellitePreview(event)) return null;

    if (!boolVar(
        "--warzone-satellite-imagery-ring-enabled",
        true
    )) {
        return null;
    }

    const count = Number(event?.cluster_count || 1);

    const ringSizePx = Math.max(
        20,
        numberVar(
            "--warzone-satellite-imagery-ring-size-px",
            62
        )
    );

    const offsetX = numberVar(
        "--warzone-satellite-imagery-offset-x-px",
        28
    );

    const offsetY = numberVar(
        "--warzone-satellite-imagery-offset-y-px",
        -28
    );

    const eyeOffsetZ = numberVar(
        "--warzone-satellite-imagery-eye-offset-z",
        -12000
    );

    const satelliteVisible =
        options?.satelliteImageryVisible !== false;

    return {
        id: `${event.id}-satellite-imagery-ring`,

        position: createEventPositionProperty(event),

        billboard: {
            image: createSatelliteImageryRingCanvas(),

            width: ringSizePx,
            height: ringSizePx,

            color: Cesium.Color.WHITE,

            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,

            pixelOffset: new Cesium.Cartesian2(
                offsetX,
                offsetY
            ),

            /* Slightly behind the PNG, but still above normal events */
            eyeOffset: new Cesium.Cartesian3(
                0,
                0,
                eyeOffsetZ + 200
            ),

            heightReference:
                Cesium.HeightReference.CLAMP_TO_GROUND,

            disableDepthTestDistance:
                Number.POSITIVE_INFINITY,

            show: satelliteVisible,
        },

        properties:
            buildSatelliteImageryEntityProperties(
                event,
                count,
                {
                    isSatelliteImageryRing: true,
                }
            ),
    };
}
function createEventMarkerFillEntity(event, options = {}) {
    const colorCss = getEventMarkerColorCss(event);
    const color = Cesium.Color.fromCssColorString(colorCss);
    const count = Number(event?.cluster_count || 1);
    const isCluster = count > 1;
    const showEventMarkers = boolVar("--warzone-event-markers-visible", true);
    const suppressMarkers = options?.suppressMarkers === true;
    const showMarker = !suppressMarkers
        && showEventMarkers
        && !isCluster
        && getEventZoomState(window.__warzoneViewer) === ZOOM_UX_STATES.EVENT;
    const fillAlpha = Math.max(0.02, Math.min(1, numberVar("--warzone-event-marker-fill-alpha", 0.82)));
    const markerSizePx = getEventMarkerSizePx(count, event.weighted_activity_score || event._activityScore);
    const markerSquash = getEventMarkerPerspectiveSquash(window.__warzoneViewer);
    return {
        id: `${event.id}-fill`,
        position: createEventPositionProperty(event),
        billboard: {
            image: createEventMarkerImageProperty(event, colorCss),
            width: markerSizePx,
            height: markerSizePx * markerSquash,
            color: Cesium.Color.WHITE,
            scaleByDistance: getEventMarkerScaleByDistance(),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Math.max(0, numberVar("--warzone-event-marker-depth-test-distance", 0)),
            show: showMarker,
        },
        ellipse: {
            semiMinorAxis: 1,
            semiMajorAxis: 1,
            material: color.withAlpha(fillAlpha),
            outline: false,
            outlineWidth: 0,
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            show: showMarker,
        },
        properties: {
            event_id: event.id,
            isEventFill: true,
            isEventMarkerFill: true,
            is_report_cluster_summary: event.is_report_cluster_summary === true,
            layer_id: event._layerId || event.layer_id || "",
            category: event.category,
            severity: event.severity,
            cluster_count: count,
            dominant_domain: event.dominant_domain || event._dominantDomain || classifyEventDomain(event),
            activity_score: Number(event.weighted_activity_score || event._activityScore || 0),
            lat: event.lat,
            lon: event.lon,
        },
    };
}
function createEventMarkerPulseEntity(event, options = {}) {
    const settings = getEventPulseSettings(event);
    if (!settings.enabled) return null;
    const colorCss = getEventPulseColorCss(event);
    const count = Number(event?.cluster_count || 1);
    const markerSizePx = getEventMarkerSizePx(count, event.weighted_activity_score || event._activityScore);
    const startScale = Math.max(0.8, Math.min(1.6, numberVar("--warzone-event-pulse-start-scale", 1.08)));
    const pulseSizePx = Math.max(markerSizePx * startScale, markerSizePx + 6);
    const suppressMarkers = options?.suppressMarkers === true;
    return {
        id: `${event.id}-pulse`,
        position: createEventPositionProperty(event),
        billboard: {
            image: createEventPulseRingCanvas(colorCss, 512),
            width: pulseSizePx,
            height: pulseSizePx * getEventMarkerPerspectiveSquash(window.__warzoneViewer),
            color: Cesium.Color.WHITE.withAlpha(numberVar("--warzone-event-pulse-alpha-max", 0.96)),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Math.max(0, numberVar("--warzone-event-marker-depth-test-distance", 0)),
            show: !suppressMarkers
                && count === 1
                && getEventZoomState(window.__warzoneViewer) === ZOOM_UX_STATES.EVENT
                && shouldShowEventMarkerPulseAtCurrentZoom(window.__warzoneViewer),
        },
        properties: {
            event_id: event.id,
            isEventPulse: true,
            layer_id: event._layerId || event.layer_id || "",
            category: event.category,
            severity: event.severity,
            cluster_count: count,
            dominant_domain: event.dominant_domain || event._dominantDomain || classifyEventDomain(event),
            activity_score: Number(event.weighted_activity_score || event._activityScore || 0),
            lat: event.lat,
            lon: event.lon,
        },
    };
}
/* ---------- Event entities ---------- */
function createEventEntity(event, options = {}) {
    const count = Number(event?.cluster_count || 1);
    const isCluster = count > 1;
    const isParentRing = event?._isClusterParentRing === true;
    const radius = isParentRing
        ? Math.max(1000, Number(event?._parentRingRadius || 0))
        : getSeverityRadius(event); // already scaled by cluster_count
    const heatRadius = getHeatRadius(event);
    const showEventMarkers = boolVar("--warzone-event-markers-visible", true);
    const suppressMarkers = options?.suppressMarkers === true;
    const showEventRings = isParentRing;
    // Clusters always show their marker (count badge) regardless of zoom CSS var
    const showMarker = !suppressMarkers && (isCluster || showEventMarkers);
    const sourceUrl = resolveGlobeEventSourceUrl(event);
    const clusterEvents = Array.isArray(event?._clusterEvents)
        ? event._clusterEvents
            .filter(Boolean)
            .slice(0, 24)
            .map((item) => ({
                id: item?.id || "",
                title: item?.title || "",
                summary: item?.summary || "",
                display_title: item?.display_title || "",
                display_summary: item?.display_summary || "",
                display_source_name: item?.display_source_name || item?.source_name || "",
                category: item?.category || "",
                severity: item?.severity || "",
                location_label: item?.location_label || item?.impact_label || item?.country || "",
                display_location_label: item?.display_location_label || "",
                occurred_at: item?.occurred_at || "",
                confidence: item?.confidence,
                lat: item?.lat,
                lon: item?.lon,
                weapon_type: item?.weapon_type || "",
                source_url: resolveGlobeEventSourceUrl(item),
                satellite_context: item?.satellite_context || null,
                satellite_available: item?.satellite_available === true,
                media: item?.media || null,
                primary_image: item?.primary_image || null,
                additional_images: Array.isArray(item?.additional_images) ? item.additional_images : [],
                image_source: item?.image_source || "",
                image_caption: item?.image_caption || "",
                image_credit: item?.image_credit || "",
                image_type: item?.image_type || "",
            }))
        : [];
    return {
        id: event.id,
        name: event.title,
        position: createEventPositionProperty(event),
        label: undefined,
        ellipse: showEventRings ? {
            semiMinorAxis: radius,
            semiMajorAxis: radius,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(getEventHotspotColorCss(event)).withAlpha(0.96),
            outlineWidth: Math.max(1, numberVar(`--hotspot-severity-${String(event.severity || "medium").toLowerCase()}-width`, numberVar("--hotspot-border-width", 4))),
            height: 0,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            show: true,
        } : undefined,
        properties: {
            event_id: event.id,
            isEventClusterParentRing: isParentRing,
            layer_id: event._layerId || event.layer_id || "",
            title: event.title,
            summary: event.summary,
            display_title: event.display_title,
            display_summary: event.display_summary,
            display_source_name: event.display_source_name,
            display_location_label: event.display_location_label,
            source_name: event.source_name,
            category: event.category,
            severity: event.severity,
            cluster_count: count,
            dominant_domain: event.dominant_domain || event._dominantDomain || classifyEventDomain(event),
            activity_score: Number(event.weighted_activity_score || event._activityScore || 0),
            weighted_activity_score: Number(event.weighted_activity_score || event._activityScore || 0),
            pulse_mode: event.pulse_mode || "none",
            pulse_eligible: event.pulse_eligible === true,
            cluster_events: clusterEvents,
            event_ids: Array.isArray(event.event_ids) ? event.event_ids : [event.id],
            actual_event_count: Number(event.actual_event_count || count),
            cluster_bounds: event.bounds || null,
            cluster_centroid: event.centroid || null,
            domain_distribution: event.domain_distribution || null,
            latest_event_time: event.latest_event_time || event.occurred_at || null,
            trend_inputs: event.trend_inputs || null,
            lat: event.lat,
            lon: event.lon,
            location_label: event.location_label,
            occurred_at: event.occurred_at,
            confidence: event.confidence,
            heatRadius,
            radius,
            parent_ring_radius: radius,
            weapon_type: event.weapon_type,
            source_url: sourceUrl,
            satellite_context: event.satellite_context || null,
            satellite_available: event.satellite_available === true,
            media: event.media || null,
            primary_image: event.primary_image || null,
            additional_images: Array.isArray(event.additional_images) ? event.additional_images : [],
            image_source: event.image_source || "",
            image_caption: event.image_caption || "",
            image_credit: event.image_credit || "",
            image_type: event.image_type || "",
            origin_lat: event.origin_lat,
            origin_lon: event.origin_lon,
            origin_label: event.origin_label,
            impact_lat: event.impact_lat,
            impact_lon: event.impact_lon,
            impact_label: event.impact_label,
        },
    };
}
function addEventEntity(viewer, event, options = {}) {
    removeExistingEventEntity(viewer, event?.id);
    const entity = viewer.entities.add(createEventEntity(event, options));
    if (event?._isClusterParentRing === true) {
        rememberEventEntity(entity);
        return { entity, fillEntity: null, countEntity: null, satelliteBadgeEntity: null, ringEntity: entity, pulseEntity: null };
    }
    const fillEntity = viewer.entities.add(createEventMarkerFillEntity(event, options));
    const countEntityConfig = createEventCountEntity(event);
    const countEntity = countEntityConfig ? viewer.entities.add(countEntityConfig) : null;
    const pulseEntityConfig = createEventMarkerPulseEntity(event, options);
    const pulseEntity = pulseEntityConfig ? viewer.entities.add(pulseEntityConfig) : null;
    const satelliteOptions = {
        ...options,
        satelliteImageryVisible:
            viewer.__warzoneSatelliteImageryLayerVisible !== false,
    };

    /* Add ring FIRST */
    const satelliteRingEntityConfig =
        createEventSatelliteRingEntity(
            event,
            satelliteOptions
        );

    const satelliteRingEntity =
        satelliteRingEntityConfig
            ? viewer.entities.add(satelliteRingEntityConfig)
            : null;

    /* Add icon AFTER ring so it is visually above it */
    const satelliteBadgeEntityConfig =
        createEventSatelliteBadgeEntity(
            event,
            satelliteOptions
        );

    const satelliteBadgeEntity =
        satelliteBadgeEntityConfig
            ? viewer.entities.add(satelliteBadgeEntityConfig)
            : null;
    const count = Number(event?.cluster_count || 1);
    const markerSizePx = getEventMarkerSizePx(count, event.weighted_activity_score || event._activityScore);
    if (fillEntity?.ellipse) fillEntity.ellipse.show = false;
    if (
        fillEntity &&
        (
            Number.isFinite(Number(event?._fromLat)) ||
            Number.isFinite(Number(event?._fromLon)) ||
            Number(event?._fromCount || 0) > 0
        )
    ) {
        fillEntity.__wzTransitionOnly = true;
        fillEntity.__wzTransitionEvent = event;
        registerEventPulseEntity(fillEntity);
    }
    if (pulseEntity) {
        applyEventBillboardPulse(
            pulseEntity,
            Math.max(markerSizePx * Math.max(0.8, Math.min(1.6, numberVar("--warzone-event-pulse-start-scale", 1.08))), markerSizePx + 6),
            0.72,
            event
        );
    }
    rememberEventEntity(entity);
    rememberEventEntity(fillEntity);
    rememberEventEntity(countEntity);
    rememberEventEntity(pulseEntity);
    rememberEventEntity(satelliteRingEntity);
    rememberEventEntity(satelliteBadgeEntity);
    startEventPulseRenderLoop(viewer);
    return { entity, fillEntity, countEntity, satelliteBadgeEntity, ringEntity: null, pulseEntity };
}
function getEntityPropertyValue(entity, key, fallback = "") {
    if (!entity?.properties) return fallback;
    try {
        const value = entity.properties?.[key]?.getValue?.();
        return value == null ? fallback : value;
    } catch {
        return fallback;
    }
}
function isEventMarkerEntity(entity) {
    if (!entity) return false;
    const isEventOutline = !!getEntityPropertyValue(entity, "isEventOutline", false);
    const isEventFill = !!getEntityPropertyValue(entity, "isEventFill", false);
    if (isEventOutline || isEventFill) return false;
    const clusterCount = Number(getEntityPropertyValue(entity, "cluster_count", NaN));
    return Number.isFinite(clusterCount) && clusterCount > 0;
}
function isEventSatelliteBadgeEntity(entity) {
    return !!getEntityPropertyValue(entity, "isEventSatelliteBadge", false);
}
function isSatelliteImageryMarkerEntity(entity) {
    return !!getEntityPropertyValue(entity, "isSatelliteImageryMarker", false);
}
function resolvePickedEventMarkerEntity(viewer, picked) {
    const pickedEntity = picked?.id;
    if (!pickedEntity) return null;
    if (isSatelliteImageryMarkerEntity(pickedEntity)) return null;
    if (!!getEntityPropertyValue(pickedEntity, "isEventCountLabel", false)) {
        const pickedId = String(pickedEntity.id || "");
        const parentId = pickedId.endsWith("-count") ? pickedId.slice(0, -6) : "";
        const parentEntity = parentId ? viewer?.entities?.getById?.(parentId) : null;
        return isEventMarkerEntity(parentEntity) ? parentEntity : null;
    }
    if (isEventSatelliteBadgeEntity(pickedEntity)) {
        const parentId = String(getEntityPropertyValue(pickedEntity, "event_id", "") || "");
        const parentEntity = parentId ? viewer?.entities?.getById?.(parentId) : null;
        return isEventMarkerEntity(parentEntity) ? parentEntity : null;
    }
    if (isEventMarkerEntity(pickedEntity)) return pickedEntity;
    const isEventOutline = !!getEntityPropertyValue(pickedEntity, "isEventOutline", false);
    const isEventFill = !!getEntityPropertyValue(pickedEntity, "isEventFill", false);
    if (!isEventOutline && !isEventFill) return null;
    const pickedId = String(pickedEntity.id || "");
    const markerId = pickedId.endsWith("-outline")
        ? pickedId.slice(0, -8)
        : pickedId.endsWith("-fill")
            ? pickedId.slice(0, -5)
            : pickedId;
    if (!markerId || !viewer?.entities?.getById) return null;
    const markerEntity = viewer.entities.getById(markerId);
    if (!isEventMarkerEntity(markerEntity)) return null;
    return markerEntity;
}
function resolvePickedSatelliteImageryMarkerEntity(picked) {
    const pickedEntity = picked?.id;
    return isSatelliteImageryMarkerEntity(pickedEntity) ? pickedEntity : null;
}
function buildPickedEventDetail(entity, screenPosition = null, viewer = null) {
    const clusterCount = Math.max(1, Number(getEntityPropertyValue(entity, "cluster_count", 1) || 1));
    const clusterEventsRaw = getEntityPropertyValue(entity, "cluster_events", []);
    const clusterEvents = Array.isArray(clusterEventsRaw) ? clusterEventsRaw.slice(0, 8) : [];
    let anchorCartesian = null;
    let lat = Number(getEntityPropertyValue(entity, "lat", NaN));
    let lon = Number(getEntityPropertyValue(entity, "lon", NaN));
    const activeViewer = viewer || window.__warzoneViewer || null;
    const hasScreenPosition =
        Number.isFinite(screenPosition?.x) && Number.isFinite(screenPosition?.y);
    if (activeViewer?.scene && hasScreenPosition) {
        try {
            if (activeViewer.scene.pickPositionSupported) {
                anchorCartesian = activeViewer.scene.pickPosition(screenPosition) || null;
            }
        } catch {
            anchorCartesian = null;
        }
        if (!anchorCartesian) {
            try {
                anchorCartesian = activeViewer.camera?.pickEllipsoid?.(
                    screenPosition,
                    activeViewer.scene.globe?.ellipsoid
                ) || null;
            } catch {
                anchorCartesian = null;
            }
        }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        try {
            const position = entity?.position?.getValue?.(Cesium.JulianDate.now());
            if (position) {
                const cartographic = Cesium.Cartographic.fromCartesian(position);
                lat = Cesium.Math.toDegrees(cartographic.latitude);
                lon = Cesium.Math.toDegrees(cartographic.longitude);
            }
        } catch {
            lat = Number.NaN;
            lon = Number.NaN;
        }
    }
    return {
        entityId: String(entity?.id || "").trim(),
        id: String(getEntityPropertyValue(entity, "event_id", entity.id || "")),
        title: String(getEntityPropertyValue(entity, "display_title", getEntityPropertyValue(entity, "title", ""))),
        summary: String(getEntityPropertyValue(entity, "display_summary", getEntityPropertyValue(entity, "summary", ""))),
        displayTitle: String(getEntityPropertyValue(entity, "display_title", getEntityPropertyValue(entity, "title", ""))),
        displaySummary: String(getEntityPropertyValue(entity, "display_summary", getEntityPropertyValue(entity, "summary", ""))),
        sourceName: String(getEntityPropertyValue(entity, "display_source_name", getEntityPropertyValue(entity, "source_name", ""))),
        category: String(getEntityPropertyValue(entity, "category", "")),
        severity: String(getEntityPropertyValue(entity, "severity", "")),
        clusterCount,
        lat,
        lon,
        locationLabel: String(getEntityPropertyValue(entity, "display_location_label", getEntityPropertyValue(entity, "location_label", ""))),
        occurredAt: String(getEntityPropertyValue(entity, "occurred_at", "")),
        confidence: getEntityPropertyValue(entity, "confidence", null),
        weaponType: String(getEntityPropertyValue(entity, "weapon_type", "")),
        sourceUrl: String(getEntityPropertyValue(entity, "source_url", "")),
        satelliteContext: getEntityPropertyValue(entity, "satellite_context", null),
        satelliteAvailable: !!getEntityPropertyValue(entity, "satellite_available", false),
        media: getEntityPropertyValue(entity, "media", null),
        primaryImage: getEntityPropertyValue(entity, "primary_image", null),
        additionalImages: getEntityPropertyValue(entity, "additional_images", []),
        imageSource: String(getEntityPropertyValue(entity, "image_source", "")),
        imageCaption: String(getEntityPropertyValue(entity, "image_caption", "")),
        imageCredit: String(getEntityPropertyValue(entity, "image_credit", "")),
        imageType: String(getEntityPropertyValue(entity, "image_type", "")),
        clusterEvents,
        anchorCartesian: anchorCartesian
            && Number.isFinite(anchorCartesian.x)
            && Number.isFinite(anchorCartesian.y)
            && Number.isFinite(anchorCartesian.z)
            ? {
                x: Number(anchorCartesian.x),
                y: Number(anchorCartesian.y),
                z: Number(anchorCartesian.z),
            }
            : null,
        screenPosition: screenPosition && Number.isFinite(screenPosition.x) && Number.isFinite(screenPosition.y)
            ? { x: Number(screenPosition.x), y: Number(screenPosition.y) }
            : null,
    };
}
function buildPickedSatelliteImageryDetail(entity, screenPosition = null, viewer = null) {
    const parentId = String(getEntityPropertyValue(entity, "event_id", "") || "");
    const parentEntity = parentId ? viewer?.entities?.getById?.(parentId) : null;
    const parentDetail = parentEntity ? buildPickedEventDetail(parentEntity, screenPosition, viewer) : {};
    return {
        ...parentDetail,
        entityId: String(entity?.id || ""),
        id: parentId || String(entity?.id || ""),
        title: parentDetail.title || String(getEntityPropertyValue(entity, "display_title", getEntityPropertyValue(entity, "title", ""))),
        displayTitle: parentDetail.displayTitle || String(getEntityPropertyValue(entity, "display_title", getEntityPropertyValue(entity, "title", ""))),
        summary: parentDetail.summary || String(getEntityPropertyValue(entity, "display_summary", getEntityPropertyValue(entity, "summary", ""))),
        displaySummary: parentDetail.displaySummary || String(getEntityPropertyValue(entity, "display_summary", getEntityPropertyValue(entity, "summary", ""))),
        sourceName: parentDetail.sourceName || String(getEntityPropertyValue(entity, "display_source_name", getEntityPropertyValue(entity, "source_name", ""))),
        sourceUrl: parentDetail.sourceUrl || String(getEntityPropertyValue(entity, "source_url", "")),
        lat: Number.isFinite(Number(parentDetail.lat)) ? Number(parentDetail.lat) : Number(getEntityPropertyValue(entity, "lat", NaN)),
        lon: Number.isFinite(Number(parentDetail.lon)) ? Number(parentDetail.lon) : Number(getEntityPropertyValue(entity, "lon", NaN)),
        locationLabel: parentDetail.locationLabel || String(getEntityPropertyValue(entity, "display_location_label", getEntityPropertyValue(entity, "location_label", ""))),
        occurredAt: parentDetail.occurredAt || String(getEntityPropertyValue(entity, "occurred_at", "")),
        satelliteContext: parentDetail.satelliteContext || getEntityPropertyValue(entity, "satellite_context", null),
        satelliteAvailable: true,
        screenPosition: screenPosition && Number.isFinite(screenPosition.x) && Number.isFinite(screenPosition.y)
            ? { x: Number(screenPosition.x), y: Number(screenPosition.y) }
            : null,
    };
}
function bindEventMarkerPicking(viewer) {
    if (!viewer || viewer.__warzoneEventMarkerPickBound) return;
    viewer.__warzoneEventMarkerPickBound = true;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    viewer.__warzoneEventMarkerPickHandler = handler;
    handler.setInputAction((movement) => {
        const picked = movement?.endPosition ? viewer.scene.pick(movement.endPosition) : null;
        const satelliteEntity = resolvePickedSatelliteImageryMarkerEntity(picked);
        const eventEntity = resolvePickedEventMarkerEntity(viewer, picked);
        viewer.scene.canvas.style.cursor = satelliteEntity || eventEntity ? "pointer" : "";
        viewer.scene.canvas.title = satelliteEntity ? "Satellite Observation - open imagery viewer" : (eventEntity ? "Click event circle for details" : "");
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction((movement) => {
        if (!movement?.position) return;
        const picked = viewer.scene.pick(movement.position);
        const satelliteEntity = resolvePickedSatelliteImageryMarkerEntity(picked);
        if (satelliteEntity) {
            document.dispatchEvent(new CustomEvent("wz:satellite-imagery-selected", {
                detail: buildPickedSatelliteImageryDetail(satelliteEntity, movement.position, viewer),
            }));
            viewer.scene.requestRender();
            return;
        }
        const eventEntity = resolvePickedEventMarkerEntity(viewer, picked);
        const openSatellite = isEventSatelliteBadgeEntity(picked?.id);
        if (!eventEntity) {
            document.dispatchEvent(new CustomEvent("wz:event-marker-cleared", {
                detail: { source: "globe-click" },
            }));
            return;
        }
        document.dispatchEvent(new CustomEvent("wz:event-marker-selected", {
            detail: { ...buildPickedEventDetail(eventEntity, movement.position, viewer), openSatellite },
        }));
        viewer.scene.requestRender();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
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
    // Keep close-zoom detail sharp, then let performance mode raise SSE while moving.
    const initialSse = Math.max(0.9, Math.min(4.5, numberVar("--warzone-globe-max-screen-space-error", 1.4)));
    viewer.scene.globe.maximumScreenSpaceError = initialSse;
    viewer.scene.globe.tileCacheSize = Math.max(
        220,
        Math.min(720, Math.round(numberVar("--warzone-globe-tile-cache-size", 900)))
    );
    viewer.scene.globe.loadingDescendantLimit = Math.max(
        8,
        Math.min(72, Math.round(numberVar("--warzone-globe-loading-descendant-limit", 48)))
    );
    viewer.scene.globe.preloadAncestors = boolVar("--warzone-globe-preload-ancestors", true);
    viewer.scene.globe.preloadSiblings = boolVar("--warzone-globe-preload-siblings", false);
    viewer.scene.fog.enabled = false;
    // Stabilize satellite tone: prevent HDR auto-exposure pumping during tile refresh/motion.
    try {
        if ("highDynamicRange" in viewer.scene) {
            viewer.scene.highDynamicRange = false;
        }
    } catch {
        // Older Cesium builds may expose this flag as read-only.
    }
    if (viewer.scene.screenSpaceCameraController) {
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableCollisionDetection = false;
        ctrl.inertiaSpin = numberVar("--warzone-camera-inertia-spin", 0.86);
        ctrl.inertiaTranslate = numberVar("--warzone-camera-inertia-translate", 0.82);
        ctrl.inertiaZoom = numberVar("--warzone-camera-inertia-zoom", 0.72);
        ctrl.zoomFactor = numberVar("--warzone-camera-zoom-factor", 7.5);
        ctrl.maximumZoomDistance = numberVar("--warzone-camera-max-zoom", 20000000);
        ctrl.minimumZoomDistance = numberVar("--warzone-camera-min-zoom", 100);
    }
    viewer.scene.requestRenderMode = true;
    viewer.scene.maximumRenderTimeChange = Infinity;
    viewer.resolutionScale = Math.max(0.7, Math.min(numberVar("--warzone-resolution-scale", 1), 1.22));
    if (viewer.scene.postProcessStages?.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = boolVar("--warzone-fxaa-enabled", true);
    }
    viewer.scene.msaaSamples = Math.max(1, Math.min(Math.round(numberVar("--warzone-msaa-samples", 1)), 4));
    applyMapColorMixer(viewer, "--warzone-map");
}
function clampCameraZoomDistance(viewer) {
    if (!viewer?.camera?.positionCartographic) return;
    const maxZoomDistance = numberVar("--warzone-camera-max-zoom", 20000000);
    const minZoomDistance = numberVar("--warzone-camera-min-zoom", 100);
    const cartographic = viewer.camera.positionCartographic;
    const currentHeight = Number(cartographic.height || 0);
    if (!Number.isFinite(currentHeight)) return;
    const nextHeight = Math.max(minZoomDistance, Math.min(maxZoomDistance, currentHeight));
    if (Math.abs(nextHeight - currentHeight) < 1) return;
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
            cartographic.longitude,
            cartographic.latitude,
            nextHeight
        ),
        orientation: {
            heading: viewer.camera.heading,
            pitch: viewer.camera.pitch,
            roll: viewer.camera.roll,
        },
    });
    viewer.scene.requestRender?.();
}
function clamp2DCameraCenter(viewer) {
    if (!viewer?.scene || getSceneMode(viewer) !== "2d") return;
    const cartographic = viewer.camera?.positionCartographic;
    if (!cartographic) return;
    const maxLatDeg = Math.max(70, Math.min(85.04, numberVar("--warzone-2d-max-latitude", 84.9)));
    const maxLatRad = Cesium.Math.toRadians(maxLatDeg);
    const maxLonRad = Math.PI;
    const currentLon = Number(cartographic.longitude || 0);
    const clampedLon = Cesium.Math.clamp(currentLon, -maxLonRad, maxLonRad);
    const clampedLat = Cesium.Math.clamp(Number(cartographic.latitude || 0), -maxLatRad, maxLatRad);
    const currentLat = Number(cartographic.latitude || 0);
    if (!Number.isFinite(currentLat)) return;
    if (
        Math.abs(clampedLon - currentLon) < 1e-7 &&
        Math.abs(clampedLat - currentLat) < 1e-7
    ) {
        return;
    }
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromRadians(
            clampedLon,
            clampedLat,
            Number(cartographic.height || numberVar("--warzone-camera-min-zoom", 100))
        ),
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
        },
    });
    viewer.scene.requestRender?.();
}
function clamp2DProjectedViewport(viewer) {
    if (!viewer?.scene || getSceneMode(viewer) !== "2d") return;
    const camera = viewer.camera;
    const projection = viewer.scene.mapProjection || camera?._projection;
    const frustum = camera?.frustum?.offCenterFrustum || camera?.frustum;
    if (!camera?.position || !projection || !frustum) return;
    const maxLatDeg = Math.max(70, Math.min(85.04, numberVar("--warzone-2d-max-latitude", 84.9)));
    const maxProjected = projection.project(
        Cesium.Cartographic.fromDegrees(180, maxLatDeg, 0)
    );
    const maxY = Math.abs(Number(maxProjected?.y || 0));
    const halfWidth = Math.abs(Number(frustum.right || 0) - Number(frustum.left || 0)) * 0.5;
    const halfHeight = Math.abs(Number(frustum.top || 0) - Number(frustum.bottom || 0)) * 0.5;
    if (![maxY, halfWidth, halfHeight].every(Number.isFinite)) return;
    if (halfHeight >= maxY) return;

    const yLimit = Math.max(0, maxY - halfHeight);
    const nextX = Number(camera.position.x || 0);
    const nextY = Cesium.Math.clamp(Number(camera.position.y || 0), -yLimit, yLimit);
    if (
        Math.abs(nextX - Number(camera.position.x || 0)) < 0.5 &&
        Math.abs(nextY - Number(camera.position.y || 0)) < 0.5
    ) {
        return;
    }
    camera.position.x = nextX;
    camera.position.y = nextY;
    camera.setView({
        destination: camera.position,
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
        },
        convert: false,
    });
    viewer.scene.requestRender?.();
}
function normalize2DCameraOrientation(viewer) {
    if (!viewer?.scene || getSceneMode(viewer) !== "2d") return;
    const camera = viewer.camera;
    const heading = Number(camera.heading || 0);
    const pitch = Number(camera.pitch || 0);
    const roll = Number(camera.roll || 0);
    if (
        Math.abs(heading) < 1e-5 &&
        Math.abs(pitch + Cesium.Math.PI_OVER_TWO) < 1e-5 &&
        Math.abs(roll) < 1e-5
    ) {
        return;
    }
    camera.setView({
        destination: camera.position,
        orientation: {
            heading: 0,
            pitch: -Cesium.Math.PI_OVER_TWO,
            roll: 0,
        },
        convert: false,
    });
    viewer.scene.requestRender?.();
}
function apply2DControllerBounds(viewer) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    if (!controller || !viewer?.camera) return;
    if (!viewer.__warzone2DControllerDefaults) {
        viewer.__warzone2DControllerDefaults = {
            maximumTranslateFactor: Number(controller.maximumTranslateFactor),
            maximumZoomFactor: Number(viewer.camera.maximumZoomFactor),
            enableRotate: controller.enableRotate,
            enableTilt: controller.enableTilt,
        };
    }
    if ("maximumTranslateFactor" in controller) {
        controller.maximumTranslateFactor = Math.max(0.92, Math.min(1.08, numberVar("--warzone-2d-max-translate-factor", 0.98)));
    }
    viewer.camera.maximumZoomFactor = Math.max(1, Math.min(8, numberVar("--warzone-2d-max-zoom-factor", 4)));
    controller.enableRotate = false;
    controller.enableTilt = false;
}
function restore2DControllerBounds(viewer) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    const defaults = viewer?.__warzone2DControllerDefaults;
    if (!controller || !defaults || !viewer?.camera) return;
    if ("maximumTranslateFactor" in controller && Number.isFinite(defaults.maximumTranslateFactor)) {
        controller.maximumTranslateFactor = defaults.maximumTranslateFactor;
    }
    if (Number.isFinite(defaults.maximumZoomFactor)) {
        viewer.camera.maximumZoomFactor = defaults.maximumZoomFactor;
    }
    controller.enableRotate = defaults.enableRotate !== false;
    controller.enableTilt = defaults.enableTilt !== false;
}
function syncSceneModeBounds(viewer) {
    if (!viewer?.scene) return;
    const mode = getSceneMode(viewer);
    if (mode === "2d") {
        apply2DControllerBounds(viewer);
        normalize2DCameraOrientation(viewer);
        clamp2DCameraCenter(viewer);
        clamp2DProjectedViewport(viewer);
    } else {
        restore2DControllerBounds(viewer);
    }
}
function attach2DCameraBoundsGuard(viewer) {
    if (!viewer || viewer.__warzone2DBoundsGuardBound) return;
    viewer.__warzone2DBoundsGuardBound = true;
    let queued = false;
    const queueClamp = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            clamp2DCameraCenter(viewer);
            clamp2DProjectedViewport(viewer);
        });
    };
    viewer.camera.moveEnd.addEventListener(queueClamp);
    viewer.scene.postRender.addEventListener(() => {
        if (getSceneMode(viewer) !== "2d") return;
        const cartographic = viewer.camera?.positionCartographic;
        if (!cartographic) return;
        const maxLatDeg = Math.max(70, Math.min(85.04, numberVar("--warzone-2d-max-latitude", 84.9)));
        const maxLatRad = Cesium.Math.toRadians(maxLatDeg);
        if (Math.abs(Number(cartographic.latitude || 0)) > (maxLatRad + 1e-6)) {
            queueClamp();
        }
        clamp2DProjectedViewport(viewer);
    });
    viewer.scene.morphComplete.addEventListener(() => {
        syncSceneModeBounds(viewer);
    });
}
function attachCameraZoomLimiter(viewer) {
    if (!viewer || viewer.__warzoneCameraZoomLimiterBound) return;
    viewer.__warzoneCameraZoomLimiterBound = true;
    let queued = false;
    const queueClamp = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            clampCameraZoomDistance(viewer);
        });
    };
    viewer.camera.moveEnd.addEventListener(queueClamp);
    viewer.scene.postRender.addEventListener(() => {
        const height = getCameraHeight(viewer);
        const cameraCtrl = viewer.scene?.screenSpaceCameraController;
        const maxZoomDistance = Number(cameraCtrl?.maximumZoomDistance || numberVar("--warzone-camera-max-zoom", 20000000));
        const minZoomDistance = Number(cameraCtrl?.minimumZoomDistance || numberVar("--warzone-camera-min-zoom", 100));
        if (height > maxZoomDistance + 1000 || height < minZoomDistance - 1000) {
            queueClamp();
        }
    });
    queueClamp();
}
function tuneImageryLayer(layer, prefix = "--warzone-map") {
    if (!layer) return;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const baseBrightness = numberVar(`${prefix}-brightness`, 0.65);
    const baseSaturation = numberVar(`${prefix}-saturation`, 0.2);
    const baseHue = numberVar(`${prefix}-hue`, 0);
    const tint = numberVar(`${prefix}-tint`, 0);
    const warmth = numberVar(`${prefix}-warmth`, 0);
    const warmthPositive = Math.max(0, warmth);
    const warmthNegative = Math.max(0, -warmth);

    layer.brightness = clamp(
        baseBrightness + (warmthPositive * 0.1) - (warmthNegative * 0.08),
        0,
        3
    );
    layer.contrast = numberVar(`${prefix}-contrast`, 1.2);
    layer.gamma = numberVar(`${prefix}-gamma`, 0.85);
    layer.saturation = clamp(
        baseSaturation + (tint * 0.25) + (warmthPositive * 0.18) - (warmthNegative * 0.12),
        0,
        3
    );
    layer.hue = baseHue + (tint * 0.35) - (warmth * 0.22);
    layer.alpha = numberVar(`${prefix}-alpha`, 1);
    layer.maximumAnisotropy = Math.max(1, numberVar("--warzone-imagery-max-anisotropy", 16));
}
function shouldShowCityLabelsAtCurrentZoom(viewer) {
    return getCameraHeight(viewer) <= numberVar("--warzone-labels-max-height", 3000000);
}
function updateLabelsLayerVisibility(viewer) {
    if (!viewer) return;
    if (viewer.__warzoneCtrImagerySuspended === true) {
        if (viewer.__imageryLabels) viewer.__imageryLabels.show = false;
        if (viewer.__countryLabelDataSource) viewer.__countryLabelDataSource.show = false;
        if (viewer.__placeLabelDataSource) viewer.__placeLabelDataSource.show = false;
        return;
    }
    const contourReady = viewer.__contourLayerVisible === true && viewer.__contourOverlayState?.hasVisibleContours === true;
    const terrainVisible = viewer.__terrainVisible !== false && !contourReady;
    const zoomVisible = shouldShowCityLabelsAtCurrentZoom(viewer);
    const mapLabelsEnabled = viewer.__warzoneMapLabelsVisible === true;
    const countryLabelsEnabled = mapLabelsEnabled || boolVar("--warzone-country-labels-enabled", false);
    const detailedLabelsEnabled = mapLabelsEnabled || boolVar("--warzone-places-layer-enabled", false);
    viewer.__labelsVisibleByZoom = zoomVisible;
    const hasDetailedPlaceLayer = !!viewer.__imageryLabels;
    if (viewer.__imageryLabels) {
        viewer.__imageryLabels.show = detailedLabelsEnabled && terrainVisible && zoomVisible;
    }
    if (viewer.__countryLabelDataSource) {
        viewer.__countryLabelDataSource.show =
            countryLabelsEnabled
            && terrainVisible
            && (!hasDetailedPlaceLayer || !zoomVisible);
    }
    if (viewer.__placeLabelDataSource) {
        viewer.__placeLabelDataSource.show = detailedLabelsEnabled && terrainVisible && zoomVisible;
    }
}
function setMapLabelsLayerVisible(viewer, visible = true) {
    if (!viewer) return false;
    const show = visible !== false;
    viewer.__warzoneMapLabelsVisible = show;
    if (show && !viewer.__countryLabelDataSource) {
        addCountryNameLabels(viewer)
            .then(() => {
                updateLabelsLayerVisibility(viewer);
                viewer.scene?.requestRender?.();
            })
            .catch(() => { });
    }
    if (show && !viewer.__placeLabelDataSource) {
        addPlaceNameLabels(viewer);
    }
    updateLabelsLayerVisibility(viewer);
    viewer.scene?.requestRender?.();
    return show;
}
function getImageryLayerIndex(collection, layer) {
    if (!collection || !layer) return -1;
    const length = Number(collection.length || 0);
    for (let index = 0; index < length; index += 1) {
        if (collection.get?.(index) === layer) return index;
    }
    return -1;
}
function removeImageryLayerIfPresent(collection, layer) {
    const index = getImageryLayerIndex(collection, layer);
    if (index < 0) return false;
    try {
        collection.remove(layer, false);
        return true;
    } catch {
        return false;
    }
}
function addImageryLayerIfMissing(collection, layer, preferredIndex = Number.POSITIVE_INFINITY) {
    if (!collection || !layer || getImageryLayerIndex(collection, layer) >= 0) return false;
    try {
        const index = Math.max(0, Math.min(Number(collection.length || 0), Number(preferredIndex || 0)));
        collection.add(layer, index);
        return true;
    } catch {
        try {
            collection.add(layer);
            return true;
        } catch {
            return false;
        }
    }
}
function suspendCtrImagery(viewer, options = {}) {
    if (!viewer?.imageryLayers) return false;
    if (viewer.__warzoneCtrImageryThemeActive === true) return true;
    const collection = viewer.imageryLayers;
    const globe = viewer.scene?.globe || null;
    const state = {
        reason: String(options.reason || "ctr"),
        baseLayer: viewer.__imageryBase || null,
        labelsLayer: viewer.__imageryLabels || null,
        baseIndex: getImageryLayerIndex(collection, viewer.__imageryBase),
        labelsIndex: getImageryLayerIndex(collection, viewer.__imageryLabels),
        baseShow: viewer.__imageryBase?.show !== false,
        labelsShow: viewer.__imageryLabels?.show !== false,
        baseAlpha: Number(viewer.__imageryBase?.alpha),
        baseBrightness: Number(viewer.__imageryBase?.brightness),
        baseSaturation: Number(viewer.__imageryBase?.saturation),
        baseContrast: Number(viewer.__imageryBase?.contrast),
        baseGamma: Number(viewer.__imageryBase?.gamma),
        baseMaximumAnisotropy: Number(viewer.__imageryBase?.maximumAnisotropy),
        satelliteVisible: viewer.__satelliteVisible !== false,
        terrainVisible: viewer.__terrainVisible !== false,
        greyedSatelliteVisible: viewer.__warzoneGreyedSatelliteVisible === true,
        baseColor: globe?.baseColor ? Cesium.Color.clone(globe.baseColor) : null,
    };
    if (state.baseLayer && getImageryLayerIndex(collection, state.baseLayer) < 0) {
        addImageryLayerIfMissing(collection, state.baseLayer, state.baseIndex);
    }
    viewer.__warzoneCtrImageryState = state;
    viewer.__warzoneCtrImagerySuspended = false;
    viewer.__warzoneCtrImageryThemeActive = true;
    viewer.__satelliteVisible = true;
    viewer.__warzoneGreyedSatelliteVisible = true;
    if (viewer.__imageryBase) {
        viewer.__imageryBase.show = true;
        viewer.__imageryBase.alpha = clamp01(numberVar("--warzone-contour-imagery-alpha", 0.58));
        viewer.__imageryBase.brightness = numberVar("--warzone-contour-imagery-brightness", 0.42);
        viewer.__imageryBase.saturation = numberVar("--warzone-contour-imagery-saturation", 0);
        viewer.__imageryBase.contrast = numberVar("--warzone-contour-imagery-contrast", 1.18);
        viewer.__imageryBase.gamma = numberVar("--warzone-contour-imagery-gamma", 1.23);
        viewer.__imageryBase.maximumAnisotropy = Math.max(1, Math.min(2, numberVar("--warzone-ctr-imagery-max-anisotropy", 1)));
    }
    if (viewer.__imageryLabels) viewer.__imageryLabels.show = false;
    if (globe) {
        globe.baseColor = colorFromCssVar("--warzone-ctr-globe-base-color", "#07111c", 1);
    }
    updateLabelsLayerVisibility(viewer);
    viewer.scene?.requestRender?.();
    return true;
}
function restoreCtrImagery(viewer, options = {}) {
    if (!viewer?.imageryLayers || !viewer.__warzoneCtrImageryState) return false;
    const collection = viewer.imageryLayers;
    const state = viewer.__warzoneCtrImageryState || {};
    addImageryLayerIfMissing(collection, state.baseLayer, state.baseIndex);
    addImageryLayerIfMissing(collection, state.labelsLayer, state.labelsIndex);
    viewer.__imageryBase = state.baseLayer || viewer.__imageryBase || null;
    viewer.__imageryLabels = state.labelsLayer || viewer.__imageryLabels || null;
    if (viewer.__imageryBase) {
        viewer.__imageryBase.show = state.baseShow !== false;
        if (Number.isFinite(state.baseAlpha)) viewer.__imageryBase.alpha = state.baseAlpha;
        if (Number.isFinite(state.baseBrightness)) viewer.__imageryBase.brightness = state.baseBrightness;
        if (Number.isFinite(state.baseSaturation)) viewer.__imageryBase.saturation = state.baseSaturation;
        if (Number.isFinite(state.baseContrast)) viewer.__imageryBase.contrast = state.baseContrast;
        if (Number.isFinite(state.baseGamma)) viewer.__imageryBase.gamma = state.baseGamma;
        if (Number.isFinite(state.baseMaximumAnisotropy)) viewer.__imageryBase.maximumAnisotropy = state.baseMaximumAnisotropy;
    }
    if (viewer.__imageryLabels) viewer.__imageryLabels.show = state.labelsShow !== false;
    viewer.__satelliteVisible = options.forceSatellite === true ? true : state.satelliteVisible !== false;
    viewer.__terrainVisible = state.terrainVisible !== false;
    viewer.__warzoneGreyedSatelliteVisible = state.greyedSatelliteVisible === true;
    viewer.__warzoneCtrImagerySuspended = false;
    viewer.__warzoneCtrImageryThemeActive = false;
    viewer.__warzoneCtrImageryState = null;
    if (viewer.scene?.globe && state.baseColor) {
        viewer.scene.globe.baseColor = state.baseColor;
    }
    applyRenderedTerrainVisibility(viewer);
    viewer.scene?.requestRender?.();
    return true;
}
function enterCtrMode(viewer, options = {}) {
    if (!viewer) return false;
    viewer.__warzoneCtrModeActive = true;
    suspendCtrImagery(viewer, options);
    return true;
}
function exitCtrMode(viewer, options = {}) {
    if (!viewer) return false;
    viewer.__warzoneCtrModeActive = false;
    restoreCtrImagery(viewer, options);
    applyRenderedTerrainVisibility(viewer);
    return true;
}
function applyRenderedTerrainVisibility(viewer) {
    if (!viewer) return;
    if (viewer.__warzoneCtrImagerySuspended === true) {
        updateLabelsLayerVisibility(viewer);
        viewer.scene?.requestRender?.();
        return;
    }
    const greyedSatellite = viewer.__warzoneGreyedSatelliteVisible === true;
    const show = viewer.__satelliteVisible !== false
        && viewer.__terrainVisible !== false;
    if (viewer.__imageryBase) {
        viewer.__imageryBase.show = show;
        if (greyedSatellite) {
            viewer.__imageryBase.alpha = clamp01(numberVar("--warzone-contour-imagery-alpha", 0.58));
            viewer.__imageryBase.brightness = numberVar("--warzone-contour-imagery-brightness", 0.42);
            viewer.__imageryBase.saturation = numberVar("--warzone-contour-imagery-saturation", 0);
            viewer.__imageryBase.contrast = numberVar("--warzone-contour-imagery-contrast", 1.18);
            viewer.__imageryBase.gamma = numberVar("--warzone-contour-imagery-gamma", 1.23);
        } else {
            tuneImageryLayer(viewer.__imageryBase, "--warzone-map");
        }
    }
    updateLabelsLayerVisibility(viewer);
}
function restoreDefaultRenderedMap(viewer) {
    if (!viewer) return false;
    const hadCtrState = viewer.__warzoneCtrImagerySuspended === true
        || viewer.__warzoneCtrImageryThemeActive === true
        || !!viewer.__warzoneCtrImageryState;
    exitCtrMode(viewer, { reason: "restore-default" });
    const state = getContourOverlayState(viewer);
    if (state) {
        if (state.buildTimer) {
            clearTimeout(state.buildTimer);
            state.buildTimer = 0;
        }
        state.buildToken += 1;
        state.centerLon = Number.NaN;
        state.centerLat = Number.NaN;
        state.centerHeight = 0;
        state.hasVisibleContours = false;
    }
    viewer.__contourLayerVisible = false;
    viewer.__contourGridLayerVisible = false;
    scheduleContourDemCacheRelease(viewer);
    viewer.__warzoneContourPausedFocusedTerrain = false;
    if (!hadCtrState) {
        viewer.__satelliteVisible = true;
        viewer.__warzoneGreyedSatelliteVisible = false;
    }
    clearContourOverlay(viewer);
    applyContourLayerState(viewer);
    applyRenderedTerrainVisibility(viewer);
    updateLabelsLayerVisibility(viewer);
    viewer.scene?.requestRender?.();
    return true;
}
function attachLabelsZoomController(viewer) {
    if (!viewer || viewer.__warzoneLabelsZoomBound) return;
    viewer.__warzoneLabelsZoomBound = true;
    let raf = 0;
    const queue = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            updateLabelsLayerVisibility(viewer);
            viewer.scene.requestRender?.();
        });
    };
    viewer.camera.moveEnd.addEventListener(queue);
    viewer.scene.postRender.addEventListener(() => {
        const h = getCameraHeight(viewer);
        if (!Number.isFinite(h)) return;
        const prev = Number(viewer.__labelsLastCameraHeight || 0);
        if (Math.abs(h - prev) >= 120000) {
            viewer.__labelsLastCameraHeight = h;
            queue();
        }
    });
    queue();
}
function getFeatureBoundsCenter(geometry) {
    if (!geometry || !geometry.type) return null;
    const getRingCenter = (ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return null;
        let minLon = Infinity;
        let maxLon = -Infinity;
        let minLat = Infinity;
        let maxLat = -Infinity;
        let count = 0;
        for (const coord of ring) {
            if (!Array.isArray(coord) || coord.length < 2) continue;
            const lon = Number(coord[0]);
            const lat = Number(coord[1]);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            count += 1;
        }
        if (count < 3) return null;
        return {
            lon: (minLon + maxLon) / 2,
            lat: (minLat + maxLat) / 2,
        };
    };
    const getRingArea = (ring) => {
        if (!Array.isArray(ring) || ring.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < ring.length; i += 1) {
            const curr = ring[i];
            const next = ring[(i + 1) % ring.length];
            const x1 = Number(curr?.[0]);
            const y1 = Number(curr?.[1]);
            const x2 = Number(next?.[0]);
            const y2 = Number(next?.[1]);
            if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
                continue;
            }
            area += (x1 * y2) - (x2 * y1);
        }
        return Math.abs(area) * 0.5;
    };
    if (geometry.type === "Polygon") {
        const ring = Array.isArray(geometry.coordinates?.[0]) ? geometry.coordinates[0] : null;
        const center = getRingCenter(ring);
        if (center) return center;
    }
    if (geometry.type === "MultiPolygon") {
        let bestRing = null;
        let bestArea = 0;
        const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
        for (const polygon of polygons) {
            const ring = Array.isArray(polygon?.[0]) ? polygon[0] : null;
            if (!ring) continue;
            const area = getRingArea(ring);
            if (area > bestArea) {
                bestArea = area;
                bestRing = ring;
            }
        }
        const center = getRingCenter(bestRing);
        if (center) return center;
    }
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let count = 0;
    const pushPoint = (coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return;
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        count += 1;
    };
    const walkCoords = (coords) => {
        if (!Array.isArray(coords)) return;
        if (coords.length >= 2 && Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
            pushPoint(coords);
            return;
        }
        for (const entry of coords) {
            walkCoords(entry);
        }
    };
    walkCoords(geometry.coordinates);
    if (count === 0) return null;
    return {
        lon: (minLon + maxLon) / 2,
        lat: (minLat + maxLat) / 2,
    };
}
function readCountryName(feature) {
    const props = feature?.properties || {};
    return String(
        props.ADMIN ||
        props.NAME ||
        props.name ||
        props.COUNTRY ||
        props.country ||
        ""
    ).trim();
}
async function addCountryNameLabels(viewer) {
    if (!viewer) return;
    if (!viewer.__countryLabelDataSource) {
        viewer.__countryLabelDataSource = new Cesium.CustomDataSource("warzone-country-labels");
        viewer.dataSources.add(viewer.__countryLabelDataSource);
    }
    const ds = viewer.__countryLabelDataSource;
    const entities = ds.entities;
    entities.removeAll();
    try {
        const geojson = await fetchGeoJson(BORDER_SOURCES.countries);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        const labelScale = numberVar("--warzone-country-label-scale", 0.72);
        const nearDistance = numberVar("--warzone-country-label-near-distance", 300000);
        const farDistance = numberVar("--warzone-country-label-far-distance", 16000000);
        const nearMultiplier = numberVar("--warzone-country-label-near-multiplier", 1);
        const farMultiplier = numberVar("--warzone-country-label-far-multiplier", 0.28);
        const nearScale = Math.max(0.05, labelScale * nearMultiplier);
        const farScale = Math.max(0.05, labelScale * farMultiplier);
        const labelColor = colorFromCssVar("--warzone-country-label-color", "#eef0f5", 0.92);
        const outlineColor = colorFromCssVar("--warzone-country-label-outline", "#101111", 0.78);
        const outlineWidth = numberVar("--warzone-country-label-outline-width", 2);
        const labelFont = stringVar(
            "--warzone-country-label-font",
            "700 18px Chakra Petch, Oxanium, sans-serif"
        );
        for (const feature of features) {
            const name = readCountryName(feature);
            if (!name) continue;
            const center = getFeatureBoundsCenter(feature?.geometry);
            if (!center) continue;
            entities.add({
                position: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 1000),
                label: {
                    text: name.toUpperCase(),
                    font: labelFont,
                    scale: labelScale,
                    scaleByDistance: new Cesium.NearFarScalar(
                        nearDistance,
                        nearScale,
                        farDistance,
                        farScale
                    ),
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    fillColor: labelColor,
                    outlineColor,
                    outlineWidth,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                },
            });
        }
    } catch (error) {
        void error;
    }
    updateLabelsLayerVisibility(viewer);
    viewer.scene.requestRender?.();
}
function addPlaceNameLabels(viewer) {
    if (!viewer) return;
    if (!viewer.__placeLabelDataSource) {
        viewer.__placeLabelDataSource = new Cesium.CustomDataSource("warzone-place-labels");
        viewer.dataSources.add(viewer.__placeLabelDataSource);
    }
    const ds = viewer.__placeLabelDataSource;
    const entities = ds.entities;
    entities.removeAll();
    const cityFont = stringVar("--warzone-place-label-font", "800 13px Oxanium, sans-serif");
    const provinceFont = stringVar("--warzone-province-label-font", cityFont);
    const seaFont = stringVar("--warzone-sea-label-font", provinceFont);
    const cityScale = numberVar("--warzone-place-label-scale", 0.9);
    const provinceScale = numberVar("--warzone-province-label-scale", 0.82);
    const seaScale = numberVar("--warzone-sea-label-scale", 0.78);
    const nearDistance = numberVar("--warzone-place-label-near-distance", 600000);
    const farDistance = numberVar("--warzone-place-label-far-distance", 9000000);
    const labelColor = colorFromCssVar("--warzone-place-label-color", "#eef0f5", 0.9);
    const provinceColor = colorFromCssVar("--warzone-province-label-color", "#9fd7ff", 0.78);
    const seaColor = colorFromCssVar("--warzone-sea-label-color", "#18e2db", 0.72);
    const outlineColor = colorFromCssVar("--warzone-place-label-outline", "#061018", 0.86);
    const outlineWidth = numberVar("--warzone-place-label-outline-width", 2);
    const getTypeStyle = (type = "city") => {
        if (type === "sea") {
            return { font: seaFont, scale: seaScale, color: seaColor, height: 1200 };
        }
        if (type === "province") {
            return { font: provinceFont, scale: provinceScale, color: provinceColor, height: 1100 };
        }
        return { font: cityFont, scale: cityScale, color: labelColor, height: 1000 };
    };
    PLACE_LABELS.forEach((place) => {
        const style = getTypeStyle(place.type);
        entities.add({
            position: Cesium.Cartesian3.fromDegrees(place.lon, place.lat, style.height),
            label: {
                text: String(place.name || "").toUpperCase(),
                font: style.font,
                scale: style.scale,
                scaleByDistance: new Cesium.NearFarScalar(
                    nearDistance,
                    style.scale,
                    farDistance,
                    style.scale
                ),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, farDistance),
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: style.color,
                outlineColor,
                outlineWidth,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
        });
    });
    updateLabelsLayerVisibility(viewer);
    viewer.scene.requestRender?.();
}
const MAP_COLOR_MIXER_FRAGMENT = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
uniform float u_red;
uniform float u_green;
uniform float u_blue;
uniform float u_cyan;
uniform float u_magenta;
uniform float u_yellow;
void main() {
    vec4 source = texture(colorTexture, v_textureCoordinates);
    vec3 rgb = source.rgb;

    rgb.r *= max(u_red, 0.0);
    rgb.g *= max(u_green, 0.0);
    rgb.b *= max(u_blue, 0.0);

    float cyan = u_cyan;
    float magenta = u_magenta;
    float yellow = u_yellow;

    rgb.r = clamp(rgb.r + (-cyan * 0.24) + (magenta * 0.24) + (yellow * 0.16), 0.0, 1.0);
    rgb.g = clamp(rgb.g + (cyan * 0.24) + (-magenta * 0.24) + (yellow * 0.16), 0.0, 1.0);
    rgb.b = clamp(rgb.b + (cyan * 0.24) + (magenta * 0.24) + (-yellow * 0.24), 0.0, 1.0);

    out_FragColor = vec4(rgb, source.a);
}
`;
function getMapColorMixerSettings(prefix = "--warzone-map") {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    return {
        red: clamp(numberVar(`${prefix}-red-level`, 1), 0, 2),
        green: clamp(numberVar(`${prefix}-green-level`, 1), 0, 2),
        blue: clamp(numberVar(`${prefix}-blue-level`, 1), 0, 2),
        cyan: clamp(numberVar(`${prefix}-cyan-level`, 0), -1, 1),
        magenta: clamp(numberVar(`${prefix}-magenta-level`, 0), -1, 1),
        yellow: clamp(numberVar(`${prefix}-yellow-level`, 0), -1, 1),
    };
}
function hasMapColorMixerOverrides(settings) {
    return (
        Math.abs(settings.red - 1) > 0.0001 ||
        Math.abs(settings.green - 1) > 0.0001 ||
        Math.abs(settings.blue - 1) > 0.0001 ||
        Math.abs(settings.cyan) > 0.0001 ||
        Math.abs(settings.magenta) > 0.0001 ||
        Math.abs(settings.yellow) > 0.0001
    );
}
function ensureMapColorMixerStage(viewer) {
    if (!viewer?.scene?.postProcessStages) return null;
    const existing = viewer.__warzoneMapColorMixerStage;
    if (existing && !existing.isDestroyed?.()) return existing;
    try {
        const stage = new Cesium.PostProcessStage({
            name: "warzone-map-color-mixer",
            fragmentShader: MAP_COLOR_MIXER_FRAGMENT,
            uniforms: {
                u_red: 1,
                u_green: 1,
                u_blue: 1,
                u_cyan: 0,
                u_magenta: 0,
                u_yellow: 0,
            },
        });
        viewer.scene.postProcessStages.add(stage);
        viewer.__warzoneMapColorMixerStage = stage;
        return stage;
    } catch {
        return null;
    }
}
function applyMapColorMixer(viewer, prefix = "--warzone-map") {
    const stage = ensureMapColorMixerStage(viewer);
    if (!stage) return;
    const settings = getMapColorMixerSettings(prefix);
    stage.uniforms.u_red = settings.red;
    stage.uniforms.u_green = settings.green;
    stage.uniforms.u_blue = settings.blue;
    stage.uniforms.u_cyan = settings.cyan;
    stage.uniforms.u_magenta = settings.magenta;
    stage.uniforms.u_yellow = settings.yellow;
    stage.enabled = hasMapColorMixerOverrides(settings);
}
function getStartCameraConfig() {
    return {
        lon: numberVar("--warzone-start-lon", STARTUP_CAMERA.lon),
        lat: numberVar("--warzone-start-lat", STARTUP_CAMERA.lat),
        height: numberVar("--warzone-start-height", STARTUP_CAMERA.height),
        heading: numberVar("--warzone-start-heading", STARTUP_CAMERA.heading),
        pitch: numberVar("--warzone-start-pitch", STARTUP_CAMERA.pitch),
        roll: numberVar("--warzone-start-roll", STARTUP_CAMERA.roll),
    };
}
function setInitialCamera(viewer) {
    const camera = getStartCameraConfig();
    viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
            camera.lon,
            camera.lat,
            camera.height
        ),
        orientation: {
            heading: Cesium.Math.toRadians(camera.heading),
            pitch: Cesium.Math.toRadians(camera.pitch),
            roll: Cesium.Math.toRadians(camera.roll),
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
function startStartupGlobeRotation(viewer) {
    if (!viewer?.scene || viewer.__warzoneStartupRotation?.active) return;
    const state = {
        active: true,
        lastTime: 0,
        speedDeg: Math.max(0.001, Math.min(numberVar("--warzone-startup-rotation-speed", 0.52), 3)),
    };
    const rotate = () => {
        if (!state.active) return;
        if (getSceneMode(viewer) !== "3d") {
            state.lastTime = 0;
            return;
        }
        const now = performance.now();
        if (!state.lastTime) {
            state.lastTime = now;
            viewer.scene.requestRender?.();
            return;
        }

        const dt = Math.min(Math.max(0, (now - state.lastTime) / 1000), 0.05);
        state.lastTime = now;

        viewer.camera.rotate(
            Cesium.Cartesian3.UNIT_Z,
            -(state.speedDeg * Cesium.Math.RADIANS_PER_DEGREE) * dt
        );

        viewer.scene.requestRender?.();
    };
    state.rotate = rotate;
    viewer.__warzoneStartupRotation = state;
    viewer.scene.postRender.addEventListener(rotate);
    viewer.scene.requestRender?.();
}
function stopStartupGlobeRotation(viewer) {
    const state = viewer?.__warzoneStartupRotation;
    if (!viewer?.scene || !state) return;
    state.active = false;
    if (state.rotate) {
        viewer.scene.postRender.removeEventListener(state.rotate);
    }
    viewer.__warzoneStartupRotation = null;
    viewer.scene.requestRender?.();
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
function ringToCartesianPositions(ring, height = 0) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const positions = [];
    for (const coord of ring) {
        if (!Array.isArray(coord) || coord.length < 2) continue;
        const lon = Number(coord[0]);
        const lat = Number(coord[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        positions.push(Cesium.Cartesian3.fromDegrees(lon, lat, height));
    }
    return positions;
}
function buildPolygonHierarchyFromRings(rings) {
    if (!Array.isArray(rings) || !rings.length) return null;
    const outer = ringToCartesianPositions(rings[0]);
    if (outer.length < 3) return null;
    const holes = rings
        .slice(1)
        .map((ring) => {
            const positions = ringToCartesianPositions(ring);
            return positions.length >= 3 ? new Cesium.PolygonHierarchy(positions) : null;
        })
        .filter(Boolean);
    return new Cesium.PolygonHierarchy(outer, holes);
}
function addRaisedRegionPolygon(viewer, rings) {
    const hierarchy = buildPolygonHierarchyFromRings(rings);
    if (!hierarchy || !viewer?.__raisedRegionDataSource?.entities) return;
    const entities = viewer.__raisedRegionDataSource.entities;
    const height = Math.max(1000, numberVar("--warzone-raised-region-height", 32000));
    const sideAlpha = clamp01(numberVar("--warzone-raised-region-side-alpha", 0.18));
    const fillAlpha = clamp01(numberVar("--warzone-raised-region-fill-alpha", 0.10));
    const outlineAlpha = clamp01(numberVar("--warzone-raised-region-outline-alpha", 0.78));
    const fillColor = colorFromCssVar("--warzone-raised-region-color", "#18e2db", 1);
    const outlineWidth = Math.max(1, numberVar("--warzone-raised-region-outline-width", 2.4));
    entities.add({
        polygon: {
            hierarchy,
            height,
            extrudedHeight: 0,
            material: fillColor.withAlpha(fillAlpha),
            closeTop: true,
            closeBottom: false,
            outline: false,
            perPositionHeight: false,
        },
    });
    entities.add({
        polygon: {
            hierarchy,
            height,
            extrudedHeight: 0,
            material: fillColor.withAlpha(sideAlpha),
            closeTop: false,
            closeBottom: false,
            outline: false,
            perPositionHeight: false,
        },
    });
    const outlinePositions = ringToCartesianPositions(rings[0], height + 600);
    if (outlinePositions.length >= 3) {
        outlinePositions.push(outlinePositions[0]);
        entities.add({
            polyline: {
                positions: outlinePositions,
                width: outlineWidth,
                material: fillColor.withAlpha(outlineAlpha),
                clampToGround: false,
            },
        });
    }
}
function normalizeFeatureProp(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}
function featureMatchesRaisedRegion(feature, regionId = "") {
    const id = String(regionId || "").trim();
    if (!id || id === "global") return false;
    const props = feature?.properties || {};
    const iso2 = normalizeFeatureProp(props.ISO_A2_EH || props.ISO_A2 || "");
    const continent = normalizeFeatureProp(props.CONTINENT || "");
    const subregion = normalizeFeatureProp(props.SUBREGION || "");
    if (RAISED_REGION_EXPLICIT_ISO2[id]?.has(iso2)) return true;
    const continentMatch = RAISED_REGION_CONTINENT_MATCH[id];
    if (continentMatch && continent === continentMatch) return true;
    return RAISED_REGION_SUBREGION_MATCH[id]?.has(subregion) === true;
}
async function ensureRaisedRegionLoaded(viewer, region = null) {
    if (!viewer) return;
    const regionId = String(region?.id || "middle_east").trim();
    if (!regionId || regionId === "global") return;
    if (viewer.__raisedRegionLoaded === regionId) return;
    if (viewer.__raisedRegionLoadPromise) return viewer.__raisedRegionLoadPromise;
    if (!viewer.__raisedRegionDataSource) {
        viewer.__raisedRegionDataSource = new Cesium.CustomDataSource("warzone-raised-region");
        viewer.dataSources.add(viewer.__raisedRegionDataSource);
    }
    const ds = viewer.__raisedRegionDataSource;
    ds.entities.removeAll();
    viewer.__raisedRegionLoadPromise = fetchGeoJson(BORDER_SOURCES.countries)
        .then((geojson) => {
            const features = Array.isArray(geojson?.features) ? geojson.features : [];
            ds.entities.suspendEvents?.();
            for (const feature of features) {
                if (!featureMatchesRaisedRegion(feature, regionId)) continue;
                const geometry = feature?.geometry;
                if (geometry?.type === "Polygon") {
                    addRaisedRegionPolygon(viewer, geometry.coordinates);
                } else if (geometry?.type === "MultiPolygon") {
                    const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                    for (const polygon of polygons) {
                        addRaisedRegionPolygon(viewer, polygon);
                    }
                }
            }
            ds.entities.resumeEvents?.();
            viewer.__raisedRegionLoaded = regionId;
        })
        .catch(() => {
            viewer.__raisedRegionLoaded = false;
        })
        .finally(() => {
            viewer.__raisedRegionLoadPromise = null;
        });
    return viewer.__raisedRegionLoadPromise;
}
function applyRaisedRegionVisibility(viewer, visible, region = null) {
    if (!viewer) return;
    const regionId = String(region?.id || "middle_east").trim();
    const show = !!visible && regionId && regionId !== "global";
    viewer.__raisedRegionVisible = show;
    if (!viewer.__raisedRegionDataSource) {
        viewer.__raisedRegionDataSource = new Cesium.CustomDataSource("warzone-raised-region");
        viewer.dataSources.add(viewer.__raisedRegionDataSource);
    }
    viewer.__raisedRegionDataSource.show = show;
    if (show && viewer.__raisedRegionLoaded !== regionId) {
        ensureRaisedRegionLoaded(viewer, region).then(() => {
            if (viewer.__raisedRegionDataSource) {
                viewer.__raisedRegionDataSource.show = viewer.__raisedRegionVisible === true;
            }
            viewer.scene?.requestRender?.();
        });
    }
    viewer.scene?.requestRender?.();
}
function getBorderEntityCollection(viewer) {
    if (viewer.__borderDataSource?.entities) {
        return viewer.__borderDataSource.entities;
    }
    return viewer.entities;
}
function stopBorderFadeAnimation(viewer) {
    if (viewer?.__borderFadeRaf) {
        cancelAnimationFrame(viewer.__borderFadeRaf);
        viewer.__borderFadeRaf = 0;
    }
}
function applyBorderVisibilityAlpha(viewer, visibilityAlpha) {
    if (!viewer) return;
    const alphaMultiplier = clamp01(Number(visibilityAlpha));
    viewer.__borderVisibilityAlpha = alphaMultiplier;
    const fallbackBaseColor =
        viewer.__borderFallbackColor ||
        (viewer.__borderFallbackColor = colorFromCssVar("--warzone-country-border", "#33e1ff", 1));
    const hasVisibleAlpha = alphaMultiplier > 0.001;
    if (viewer.__borderDataSource) {
        viewer.__borderDataSource.show = hasVisibleAlpha;
    }
    if (!Array.isArray(viewer.__borderEntities)) return;
    viewer.__borderEntities.forEach((entity) => {
        if (!entity?.polyline) return;
        const baseColor = entity.__borderBaseColor || fallbackBaseColor;
        const baseAlphaRaw = Number(entity.__borderBaseAlpha);
        const baseAlpha = Number.isFinite(baseAlphaRaw) ? clamp01(baseAlphaRaw) : 1;
        const nextAlpha = clamp01(baseAlpha * alphaMultiplier);
        entity.polyline.material = baseColor.withAlpha(nextAlpha);
        entity.show = nextAlpha > 0.001;
    });
}
function animateBorderVisibility(viewer, targetAlpha, options = {}) {
    if (!viewer) return;
    const startAlphaRaw = Number(viewer.__borderVisibilityAlpha);
    const startAlpha = Number.isFinite(startAlphaRaw)
        ? clamp01(startAlphaRaw)
        : (viewer.__borderLayersVisible !== false ? 1 : 0);
    const clampedTarget = clamp01(Number(targetAlpha));
    const requestedDuration = Number(options?.duration);
    const duration = Number.isFinite(requestedDuration)
        ? Math.max(0, requestedDuration)
        : Math.max(0, numberVar("--warzone-border-fade-duration", 620));
    if (Math.abs(clampedTarget - startAlpha) < 0.001 || duration <= 0) {
        stopBorderFadeAnimation(viewer);
        applyBorderVisibilityAlpha(viewer, clampedTarget);
        viewer.scene?.requestRender?.();
        return;
    }
    stopBorderFadeAnimation(viewer);
    const startedAt = performance.now();
    const step = (now) => {
        const t = clamp01((now - startedAt) / duration);
        const eased = easeInOutCubic(t);
        const next = lerp(startAlpha, clampedTarget, eased);
        applyBorderVisibilityAlpha(viewer, next);
        viewer.scene?.requestRender?.();
        if (t >= 1) {
            viewer.__borderFadeRaf = 0;
            return;
        }
        viewer.__borderFadeRaf = requestAnimationFrame(step);
    };
    viewer.__borderFadeRaf = requestAnimationFrame(step);
}
function addPolylineForRing(viewer, ring, options) {
    const coords = flattenRingToDegrees(ring);
    if (coords.length < 4) return;
    const baseColor = options?.baseColor || colorFromCssVar("--warzone-country-border", "#33e1ff", 1);
    const baseAlphaRaw = Number(options?.alpha);
    const baseAlpha = Number.isFinite(baseAlphaRaw) ? clamp01(baseAlphaRaw) : 1;
    const visibilityAlphaRaw = Number(viewer.__borderVisibilityAlpha);
    const visibilityAlpha = Number.isFinite(visibilityAlphaRaw)
        ? clamp01(visibilityAlphaRaw)
        : (viewer.__borderLayersVisible !== false ? 1 : 0);
    const initialAlpha = clamp01(baseAlpha * visibilityAlpha);
    const entity = getBorderEntityCollection(viewer).add({
        polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(coords),
            width: options.width,
            material: baseColor.withAlpha(initialAlpha),
            // Keep country borders at the lowest map layer.
            clampToGround: true,
            zIndex: 0,
        },
    });
    if (!Array.isArray(viewer.__borderEntities)) {
        viewer.__borderEntities = [];
    }
    entity.__borderBaseColor = baseColor.withAlpha(1);
    entity.__borderBaseAlpha = baseAlpha;
    entity.show = initialAlpha > 0.001;
    viewer.__borderEntities.push(entity);
}
function setBorderLayersVisible(viewer, visible, options = {}) {
    if (!viewer) return Promise.resolve(false);

    const show = !!visible;
    viewer.__borderLayersVisible = show;

    if (show && !viewer.__borderLayersLoaded) {
        return ensureBorderLayersLoaded(viewer).then(() => {
            if (viewer.__borderLayersVisible !== show) return false;

            void options;
            stopBorderFadeAnimation(viewer);
            applyBorderVisibilityAlpha(viewer, 1);
            viewer.scene?.requestRender?.();

            return true;
        });
    }

    void options;
    stopBorderFadeAnimation(viewer);
    applyBorderVisibilityAlpha(viewer, show ? 1 : 0);
    viewer.scene?.requestRender?.();

    return Promise.resolve(show);
}
async function fetchGeoJson(url) {
    const candidates = Array.isArray(url) ? url.filter(Boolean) : [url];
    if (!candidates.length) return null;
    let lastError = null;
    for (const candidate of candidates) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(candidate, {
                cache: "force-cache",
                signal: controller.signal,
            });
            if (!response.ok) {
                lastError = new Error(`GeoJSON fetch failed: ${response.status} (${candidate})`);
                continue;
            }
            return await response.json();
        } catch (error) {
            lastError = error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }
    throw lastError || new Error("GeoJSON fetch failed");
}
async function addGeoJsonBorderLayer(viewer, config) {
    if (!config?.url) return;
    try {
        const geojson = await fetchGeoJson(config.url);
        const features = Array.isArray(geojson?.features) ? geojson.features : [];
        const baseColor = colorFromCssVar(
            config.colorVar,
            config.fallbackColor,
            1
        );
        const baseAlpha = clamp01(numberVar(config.alphaVar, config.fallbackAlpha));
        const width = numberVar(config.widthVar, config.fallbackWidth);
        for (const feature of features) {
            const geometry = feature?.geometry;
            if (!geometry) continue;
            if (geometry.type === "Polygon") {
                const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                if (rings[0]) addPolylineForRing(viewer, rings[0], { baseColor, alpha: baseAlpha, width });
            } else if (geometry.type === "MultiPolygon") {
                const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const polygon of polygons) {
                    const rings = Array.isArray(polygon) ? polygon : [];
                    if (rings[0]) addPolylineForRing(viewer, rings[0], { baseColor, alpha: baseAlpha, width });
                }
            } else if (geometry.type === "LineString") {
                addPolylineForRing(viewer, geometry.coordinates, { baseColor, alpha: baseAlpha, width });
            } else if (geometry.type === "MultiLineString") {
                const lines = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
                for (const line of lines) addPolylineForRing(viewer, line, { baseColor, alpha: baseAlpha, width });
            }
        }
    } catch (error) {
        void error;
    }
}
async function addBorderLayers(viewer) {
    if (!Array.isArray(viewer.__borderEntities)) {
        viewer.__borderEntities = [];
    }
    if (!viewer.__borderDataSource) {
        viewer.__borderDataSource = new Cesium.CustomDataSource("warzone-borders");
        viewer.dataSources.add(viewer.__borderDataSource);
        viewer.__borderDataSource.show = viewer.__borderLayersVisible !== false;
    }
    const entities = viewer.__borderDataSource.entities;
    entities.suspendEvents?.();
    await addGeoJsonBorderLayer(viewer, {
        name: "Country",
        url: BORDER_SOURCES.countries,
        colorVar: "--warzone-country-border",
        fallbackColor: "#18e2db",
        alphaVar: "--warzone-country-border-alpha",
        fallbackAlpha: 0.72,
        widthVar: "--warzone-country-border-width",
        fallbackWidth: 1.4,
    });
    entities.resumeEvents?.();
    const initialVisibility = Number.isFinite(Number(viewer.__borderVisibilityAlpha))
        ? Number(viewer.__borderVisibilityAlpha)
        : (viewer.__borderLayersVisible !== false ? 1 : 0);
    applyBorderVisibilityAlpha(viewer, initialVisibility);
}
function ensureBorderLayersLoaded(viewer) {
    if (!viewer) return Promise.resolve();
    if (viewer.__borderLayersLoaded) return Promise.resolve();
    if (viewer.__borderLayerLoadPromise) return viewer.__borderLayerLoadPromise;
    viewer.__borderLayerLoadPromise = addBorderLayers(viewer)
        .then(() => {
            viewer.__borderLayersLoaded = true;
        })
        .catch(() => {
            // keep retries possible on future toggles
        })
        .finally(() => {
            viewer.__borderLayerLoadPromise = null;
        });
    return viewer.__borderLayerLoadPromise;
}
async function addArcGisLayers(viewer) {
    if (!viewer?.imageryLayers) return { baseLayer: null, labelsLayer: null };
    if (viewer.__warzoneEntryMapImageryVisible === false) {
        viewer.imageryLayers.removeAll();
        viewer.__imageryBase = null;
        viewer.__imageryLabels = null;
        updateMapCredits();
        return { baseLayer: null, labelsLayer: null };
    }

    const generation = Number(viewer.__warzoneImageryGeneration || 0);
    viewer.imageryLayers.removeAll();
    const baseProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        { enablePickFeatures: false }
    );
    if (viewer.__warzoneEntryMapImageryVisible === false || generation !== Number(viewer.__warzoneImageryGeneration || 0)) {
        viewer.imageryLayers.removeAll();
        viewer.__imageryBase = null;
        viewer.__imageryLabels = null;
        return { baseLayer: null, labelsLayer: null };
    }

    const baseLayer = viewer.imageryLayers.addImageryProvider(baseProvider);
    tuneImageryLayer(baseLayer, "--warzone-map");
    let labelsLayer = null;
    if (boolVar("--warzone-places-layer-enabled", false)) {
        const labelsProvider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
            "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer",
            { enablePickFeatures: false }
        );
        if (viewer.__warzoneEntryMapImageryVisible !== false && generation === Number(viewer.__warzoneImageryGeneration || 0)) {
            labelsLayer = viewer.imageryLayers.addImageryProvider(labelsProvider);
            tuneImageryLayer(labelsLayer, "--warzone-labels");
        }
    }
    const show = viewer.__terrainVisible !== false;
    baseLayer.show = show;
    if (labelsLayer) labelsLayer.show = show;
    viewer.__imageryBase = baseLayer;
    viewer.__imageryLabels = labelsLayer;
    updateMapCredits();
    updateLabelsLayerVisibility(viewer);
    return { baseLayer, labelsLayer };
}

function setEntryMapImageryVisible(viewer, visible) {
    if (!viewer?.imageryLayers) return Promise.resolve(false);
    const show = visible !== false;
    viewer.__warzoneEntryMapImageryVisible = show;
    viewer.__warzoneImageryGeneration = Number(viewer.__warzoneImageryGeneration || 0) + 1;

    if (!show) {
        viewer.imageryLayers.removeAll();
        viewer.__imageryBase = null;
        viewer.__imageryLabels = null;
        updateMapCredits();
        viewer.scene?.requestRender?.();
        return Promise.resolve(false);
    }

    viewer.__warzoneImageryReadyPromise = addArcGisLayers(viewer)
        .then((result) => {
            viewer.scene?.requestRender?.();
            return !!result?.baseLayer;
        })
        .catch((error) => {
            console.warn("ArcGIS imagery provider failed; continuing without ion imagery fallback:", error);
            return false;
        });
    return viewer.__warzoneImageryReadyPromise;
}

function applyEntrySceneLayerSwitches(viewer) {
    if (!viewer || !document.body.classList.contains("wz-pre-entry-active")) return;

    const showMapImagery = numberVar("--wz-entry-show-map-imagery", 1) !== 0;
    const showBorders = numberVar("--wz-entry-show-borders", 0) !== 0;

    setEntryMapImageryVisible(viewer, showMapImagery);
    setBorderLayersVisible(viewer, showBorders, { immediate: true });

    viewer.scene?.requestRender?.();
}

function setContourGridLayerVisible(viewer, visible) {
    const show = !!visible;
    viewer.__contourGridLayerVisible = show;
    if (show) {
        retainContourDemCache();
        enterCtrMode(viewer, { reason: "contour-grid-on" });
    }
    document.documentElement.style.setProperty("--warzone-contour-grid-enabled", show ? "1" : "0");
    const state = getContourOverlayState(viewer);
    if (show) {
        const center = Number.isFinite(state?.gridCenterLon) && Number.isFinite(state?.gridCenterLat)
            ? { lon: state.gridCenterLon, lat: state.gridCenterLat }
            : getContourFallbackCenter(viewer);
        ensureContourGridPrimitive(viewer, center, { force: true });
    } else if (state?.gridPrimitive) {
        state.gridPrimitive.show = false;
    }
    if (viewer.__contourLayerVisible === true) {
        if (state) state.buildToken += 1;
        void buildContourOverlay(viewer, {
            force: true,
            reason: "contour-grid-toggle",
        });
    } else if (!show) {
        if (viewer.__contourLayerVisible !== true) exitCtrMode(viewer, { reason: "contour-grid-off" });
        clearContourOverlay(viewer);
        scheduleContourDemCacheRelease(viewer);
    }
    viewer.scene?.requestRender?.();
    return show;
}

function updateMapCredits() {
    const creditsEl = document.getElementById("warzone-map-credits");
    if (!creditsEl) return;
    creditsEl.setAttribute("aria-label", "Map credits and data attribution");
    creditsEl.querySelectorAll("img").forEach((img) => {
        if (!img.alt) {
            img.alt = img.className.includes("battlespacex") ? "BattlespaceX" : "Map credit";
        }
        img.decoding = "async";
    });
}
function getCesiumCreditContainer(globeEl) {
    if (!globeEl || typeof document === "undefined") return undefined;
    const existing = document.getElementById("warzone-cesium-credit-container");
    if (existing) return existing;
    const container = document.createElement("div");
    container.id = "warzone-cesium-credit-container";
    container.hidden = true;
    container.setAttribute("aria-hidden", "true");
    globeEl.appendChild(container);
    return container;
}
function getContourOverlayState(viewer) {
    if (!viewer) return null;
    if (!viewer.__contourOverlayState) {
        viewer.__contourOverlayState = {
            dataSource: null,
            terrainProvider: null,
            terrainProviderPromise: null,
            buildTimer: 0,
            buildPromise: null,
            buildQueued: false,
            buildQueuedForce: false,
            buildQueuedReason: "",
            buildToken: 0,
            clearTimer: 0,
            clearToken: 0,
            centerLon: Number.NaN,
            centerLat: Number.NaN,
            centerHeight: 0,
            hasFocusPosition: false,
            focusProfile: "",
            lastBuiltLon: Number.NaN,
            lastBuiltLat: Number.NaN,
            lastBuiltAt: 0,
            hasVisibleContours: false,
            gridPrimitive: null,
            gridCenterLon: Number.NaN,
            gridCenterLat: Number.NaN,
            gridRadiusMeters: 0,
            gridIntervalMeters: 0,
        };
    }
    return viewer.__contourOverlayState;
}
async function ensureContourOverlayDataSource(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return null;
    if (state.dataSource) return state.dataSource;
    const dataSource = new Cesium.CustomDataSource("warzone-contour-overlay");
    state.dataSource = dataSource;
    await Promise.resolve(viewer.dataSources.add(dataSource));
    return dataSource;
}
function applyContourLayerState(viewer) {
    const state = getContourOverlayState(viewer);
    const show = viewer?.__contourLayerVisible === true;
    if (state?.dataSource) {
        state.dataSource.show = show;
    }
    if (state?.gridPrimitive) {
        state.gridPrimitive.show = viewer?.__contourGridLayerVisible === true;
        raiseContourGridPrimitive(viewer);
    }
}
function raiseContourGridPrimitive(viewer) {
    const state = getContourOverlayState(viewer);
    const primitive = state?.gridPrimitive;
    if (!primitive || !viewer?.scene?.primitives?.raiseToTop) return false;
    try {
        viewer.scene.primitives.raiseToTop(primitive);
        return true;
    } catch {
        return false;
    }
}
function clearContourOverlay(viewer) {
    const state = getContourOverlayState(viewer);
    if (state) state.hasVisibleContours = false;
    if (!state?.dataSource) return;
    state.clearToken += 1;
    if (state.clearTimer) {
        clearTimeout(state.clearTimer);
        state.clearTimer = 0;
    }
    state.dataSource.entities.removeAll();
    state.dataSource.show = false;
    viewer.scene?.requestRender?.();
}
function clearContourOverlayDeferred(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return;
    state.hasVisibleContours = false;
    state.clearToken += 1;
    const clearToken = state.clearToken;
    if (state.clearTimer) {
        clearTimeout(state.clearTimer);
        state.clearTimer = 0;
    }
    const dataSource = state.dataSource;
    if (!dataSource?.entities) return;
    dataSource.show = false;
    viewer.scene?.requestRender?.();
    const removeChunk = () => {
        if (state.clearToken !== clearToken) return;
        const values = dataSource.entities.values || [];
        const batchSize = 90;
        for (let index = 0; index < batchSize && values.length; index += 1) {
            dataSource.entities.remove(values[values.length - 1]);
        }
        if (values.length) {
            state.clearTimer = window.setTimeout(removeChunk, 16);
            return;
        }
        state.clearTimer = 0;
        viewer.scene?.requestRender?.();
    };
    state.clearTimer = window.setTimeout(removeChunk, 16);
}
function isContourBuildCurrent(viewer, state, buildToken) {
    return (viewer?.__contourLayerVisible === true || viewer?.__contourGridLayerVisible === true) && state?.buildToken === buildToken;
}
async function ensureContourTerrainProvider(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return null;
    if (state.terrainProvider) return state.terrainProvider;
    if (state.terrainProviderPromise) return state.terrainProviderPromise;
    state.terrainProviderPromise = Promise.resolve()
        .then(() => createFocusedTerrainProvider())
        .then((provider) => {
            state.terrainProvider = provider || null;
            return state.terrainProvider;
        })
        .catch((error) => {
            console.warn("Focused terrain provider failed to load:", error);
            state.terrainProvider = null;
            return null;
        })
        .finally(() => {
            state.terrainProviderPromise = null;
        });
    return state.terrainProviderPromise;
}
function getFocusedTerrainProviderMode() {
    return String(window.__stratopsConfig?.focusedTerrainProvider || "arcgis").trim().toLowerCase();
}
function getFocusedTerrainArcGisUrl() {
    return String(
        window.__stratopsConfig?.focusedTerrainArcGisUrl ||
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
    ).trim();
}
function getFocusedTerrainArcGisToken() {
    return String(window.__stratopsConfig?.focusedTerrainArcGisToken || "").trim();
}
async function createArcGisFocusedTerrainProvider() {
    if (!Cesium.ArcGISTiledElevationTerrainProvider?.fromUrl) return null;
    const url = getFocusedTerrainArcGisUrl();
    if (!url) return null;
    const token = getFocusedTerrainArcGisToken();
    const options = token ? { token } : {};
    const provider = await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(url, options);
    provider.__warzoneArcGisUrl = url;
    return provider;
}
async function createFocusedTerrainProvider() {
    const mode = getFocusedTerrainProviderMode();
    if (mode !== "flat") {
        try {
            const arcGisTerrain = await createArcGisFocusedTerrainProvider();
            if (arcGisTerrain) {
                arcGisTerrain.__warzoneProviderKind = "arcgis";
                return arcGisTerrain;
            }
        } catch (error) {
            console.warn("ArcGIS focused terrain provider failed; using flat globe fallback:", error);
        }
        try {
            if (typeof Cesium.createWorldTerrainAsync === "function") {
                const worldTerrain = await Cesium.createWorldTerrainAsync({
                    requestVertexNormals: true,
                    requestWaterMask: false,
                });
                if (worldTerrain) {
                    worldTerrain.__warzoneProviderKind = "cesium-world";
                    return worldTerrain;
                }
            }
        } catch (error) {
            console.warn("Cesium world terrain provider failed; using flat globe fallback:", error);
        }
    }
    if (mode === "flat") {
        const flatTerrain = new Cesium.EllipsoidTerrainProvider();
        flatTerrain.__warzoneProviderKind = "flat";
        return flatTerrain;
    }
    return null;
}
async function enableFocusedTerrain(viewer) {
    if (!viewer) return false;
    if (!viewer.__warzoneFlatTerrainProvider) {
        viewer.__warzoneFlatTerrainProvider = viewer.terrainProvider;
    }
    const terrainProvider = await ensureContourTerrainProvider(viewer);
    if (!terrainProvider || terrainProvider.__warzoneProviderKind === "flat") return false;
    viewer.terrainProvider = terrainProvider;
    viewer.__warzoneFocusedTerrainFallbackFlat = terrainProvider.__warzoneProviderKind === "flat";
    viewer.__terrainVisible = true;
    viewer.__satelliteVisible = true;
    if (viewer.scene) {
        const globe = viewer.scene.globe;
        if (globe && !Number.isFinite(viewer.__warzoneFlatTerrainMaximumScreenSpaceError)) {
            viewer.__warzoneFlatTerrainMaximumScreenSpaceError = Number(globe.maximumScreenSpaceError);
        }
        if (globe && viewer.__warzoneFlatTerrainDepthTestAgainstTerrain === undefined) {
            viewer.__warzoneFlatTerrainDepthTestAgainstTerrain = globe.depthTestAgainstTerrain;
        }
        if (globe) {
            const focusedDetail = Math.max(1.5, numberVar("--warzone-focus-terrain-detail", 6));
            globe.maximumScreenSpaceError = Math.min(Number(globe.maximumScreenSpaceError) || focusedDetail, focusedDetail);
            globe.depthTestAgainstTerrain = false;
        }
        const defaultExaggeration = numberVar("--warzone-topography-exaggeration", 1);
        viewer.scene.verticalExaggeration = Math.max(1, numberVar("--warzone-focus-terrain-exaggeration", defaultExaggeration));
        viewer.scene.verticalExaggerationRelativeHeight = 0;
        applyRenderedTerrainVisibility(viewer);
        viewer.scene.requestRender?.();
    }
    viewer.__warzoneFocusedTerrainActive = true;
    dispatchFocusedTerrainChanged(viewer);
    return true;
}
function disableFocusedTerrain(viewer) {
    if (!viewer) return false;

    if (viewer.__warzoneFocusedTerrainActive !== true) {
        return false;
    }
    if (viewer.__warzoneFlatTerrainProvider) {
        viewer.terrainProvider = viewer.__warzoneFlatTerrainProvider;
    } else {
        viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    if (viewer.scene) {
        const globe = viewer.scene.globe;
        if (globe && Number.isFinite(viewer.__warzoneFlatTerrainMaximumScreenSpaceError)) {
            globe.maximumScreenSpaceError = viewer.__warzoneFlatTerrainMaximumScreenSpaceError;
        }
        if (globe && viewer.__warzoneFlatTerrainDepthTestAgainstTerrain !== undefined) {
            globe.depthTestAgainstTerrain = viewer.__warzoneFlatTerrainDepthTestAgainstTerrain;
        }
        viewer.scene.verticalExaggeration = 1;
        viewer.scene.verticalExaggerationRelativeHeight = 0;
        viewer.scene.requestRender?.();
    }
    viewer.__warzoneFocusedTerrainActive = false;
    dispatchFocusedTerrainChanged(viewer);
    return true;
}
function contourDistanceMeters(lonA, latA, lonB, latB) {
    if (![lonA, latA, lonB, latB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const latMeters = 111320;
    const avgLatRad = Cesium.Math.toRadians((latA + latB) * 0.5);
    const lonMeters = Math.max(1, Math.cos(avgLatRad) * latMeters);
    const dx = (lonA - lonB) * lonMeters;
    const dy = (latA - latB) * latMeters;
    return Math.hypot(dx, dy);
}
function getContourOverlayRadiusMeters() {
    return getContourOverlayRadii().outerRadius;
}
function getContourFocusProfile(viewer = null) {
    const state = viewer ? getContourOverlayState(viewer) : null;
    const profile = String(state?.focusProfile || "").toLowerCase();
    return profile === "naval" ? "naval" : "aircraft";
}
function numberVarForContourProfile(viewer, suffix, fallback) {
    const profile = getContourFocusProfile(viewer);
    return numberVar(`--warzone-live-${profile}-contour-${suffix}`, numberVar(`--warzone-live-contour-${suffix}`, fallback));
}
function getContourOverlayRadii(viewer = null) {
    const profile = getContourFocusProfile(viewer);
    const strongFallback = profile === "naval" ? 90000 : 220000;
    const blurFallback = profile === "naval" ? 40000 : 60000;
    const fadeFallback = profile === "naval" ? 30000 : 30000;
    const strongRadius = Math.max(40000, Math.min(240000, numberVarForContourProfile(viewer, "radius", strongFallback)));
    const blurRadius = Math.max(0, Math.min(90000, numberVarForContourProfile(viewer, "blur", blurFallback)));
    const fadeRadius = Math.max(0, Math.min(70000, numberVarForContourProfile(viewer, "fade", fadeFallback)));
    const outerRadius = Math.max(strongRadius + 25000, Math.min(320000, strongRadius + blurRadius + fadeRadius));
    return { strongRadius, outerRadius };
}
function getContourSamplePaddingMeters() {
    return Math.max(30000, Math.min(180000, numberVar("--warzone-contour-sample-padding", 85000)));
}
function smoothContourFade(value) {
    const t = clamp01(value);
    return t * t * (3 - (2 * t));
}
function getContourChainAlphaScale(points = [], centerLon, centerLat, strongRadius, outerRadius) {
    if (!Array.isArray(points) || !points.length) return 0;
    if (boolVar("--warzone-live-aircraft-contour-focus-radius-enabled", false) !== true) return 1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += Math.max(1, Math.floor(points.length / 8))) {
        const point = points[index];
        nearestDistance = Math.min(
            nearestDistance,
            contourDistanceMeters(centerLon, centerLat, Number(point?.lon), Number(point?.lat))
        );
    }
    const lastPoint = points[points.length - 1];
    nearestDistance = Math.min(
        nearestDistance,
        contourDistanceMeters(centerLon, centerLat, Number(lastPoint?.lon), Number(lastPoint?.lat))
    );
    if (!Number.isFinite(nearestDistance) || nearestDistance >= outerRadius) return 0;
    if (nearestDistance <= strongRadius) return 1;
    const fadeT = (nearestDistance - strongRadius) / Math.max(1, outerRadius - strongRadius);
    return Math.max(0, 1 - smoothContourFade(fadeT));
}
function getContourGridSampleSize() {
    return Math.max(34, Math.min(96, Math.round(numberVar("--warzone-contour-grid-size", 82))));
}
function getContourTerrainSampleLevel() {
    return Math.max(6, Math.min(14, Math.round(numberVar("--warzone-contour-sample-level", 11))));
}
const TERRARIUM_TILE_SIZE = 256;
const contourTerrariumTileCache = new Map();
const CONTOUR_DEM_CACHE_RELEASE_DELAY_MS = 90 * 1000;
let contourDemCacheReleaseTimer = 0;
let contourDemWarningShown = false;
function updateContourDemCacheDiagnostics() {
    window.__warzoneContourDemCacheSize = contourTerrariumTileCache.size;
}
function retainContourDemCache() {
    if (!contourDemCacheReleaseTimer) return;
    window.clearTimeout(contourDemCacheReleaseTimer);
    contourDemCacheReleaseTimer = 0;
}
function scheduleContourDemCacheRelease(viewer) {
    if (viewer?.__contourLayerVisible === true || viewer?.__contourGridLayerVisible === true) {
        retainContourDemCache();
        return;
    }
    if (contourDemCacheReleaseTimer || !contourTerrariumTileCache.size) return;
    contourDemCacheReleaseTimer = window.setTimeout(() => {
        contourDemCacheReleaseTimer = 0;
        if (viewer?.__contourLayerVisible === true || viewer?.__contourGridLayerVisible === true) return;
        contourTerrariumTileCache.clear();
        updateContourDemCacheDiagnostics();
    }, CONTOUR_DEM_CACHE_RELEASE_DELAY_MS);
}
function hasSampledContourHeights(samplePositions = []) {
    if (!Array.isArray(samplePositions) || !samplePositions.length) return false;
    const validCount = samplePositions.reduce((count, position) => (
        count + (Number.isFinite(Number(position?.height)) ? 1 : 0)
    ), 0);
    return validCount >= 24 && (validCount / samplePositions.length) >= 0.08;
}
function getContourTerrariumZoom() {
    return Math.max(6, Math.min(12, Math.round(numberVar("--warzone-contour-dem-zoom", 10))));
}
function getContourTerrariumTileTemplate() {
    return stringVar("--warzone-contour-dem-url", "/__warzone/terrain/terrarium/{z}/{x}/{y}.png");
}
function getContourTerrariumTileUrl(z, x, y) {
    return getContourTerrariumTileTemplate()
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
}
function getContourTerrariumTileUrls(z, x, y) {
    const primary = getContourTerrariumTileUrl(z, x, y);
    const fallback = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    return Array.from(new Set([primary, fallback].filter(Boolean)));
}
function getTerrariumTilePoint(lon, lat, zoom) {
    const n = 2 ** zoom;
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const lonWrapped = ((Number(lon) + 180) % 360 + 360) % 360 - 180;
    const latRad = Cesium.Math.toRadians(safeLat);
    const xFloat = ((lonWrapped + 180) / 360) * n;
    const yFloat = (1 - (Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI)) * 0.5 * n;
    const x = Math.max(0, Math.min(n - 1, Math.floor(xFloat)));
    const y = Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
    const pixelX = Math.max(0, Math.min(TERRARIUM_TILE_SIZE - 1, Math.floor((xFloat - x) * TERRARIUM_TILE_SIZE)));
    const pixelY = Math.max(0, Math.min(TERRARIUM_TILE_SIZE - 1, Math.floor((yFloat - y) * TERRARIUM_TILE_SIZE)));
    return { z: zoom, x, y, pixelX, pixelY };
}
function trimTerrariumTileCache() {
    const maxTiles = Math.max(24, Math.min(180, Math.round(numberVar("--warzone-contour-dem-tile-cache", 96))));
    while (contourTerrariumTileCache.size > maxTiles) {
        const oldestKey = contourTerrariumTileCache.keys().next().value;
        if (!oldestKey) break;
        contourTerrariumTileCache.delete(oldestKey);
    }
    updateContourDemCacheDiagnostics();
}
function loadTerrariumTilePixels(z, x, y) {
    retainContourDemCache();
    const key = `${z}/${x}/${y}`;
    const cached = contourTerrariumTileCache.get(key);
    if (cached) return cached;
    const promise = new Promise((resolve) => {
        const urls = getContourTerrariumTileUrls(z, x, y);
        let urlIndex = 0;
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = TERRARIUM_TILE_SIZE;
                canvas.height = TERRARIUM_TILE_SIZE;
                const context = canvas.getContext("2d", { willReadFrequently: true });
                context.drawImage(image, 0, 0, TERRARIUM_TILE_SIZE, TERRARIUM_TILE_SIZE);
                resolve(context.getImageData(0, 0, TERRARIUM_TILE_SIZE, TERRARIUM_TILE_SIZE).data);
            } catch (error) {
                if (urlIndex < urls.length - 1) {
                    urlIndex += 1;
                    image.src = urls[urlIndex];
                    return;
                }
                if (!contourDemWarningShown) {
                    contourDemWarningShown = true;
                    console.warn("Contour DEM tile decode failed. Real contour lines need /__warzone/terrain/terrarium/... or a CORS-readable DEM tile source.", error);
                }
                resolve(null);
            }
        };
        image.onerror = () => {
            if (urlIndex < urls.length - 1) {
                urlIndex += 1;
                image.src = urls[urlIndex];
                return;
            }
            if (!contourDemWarningShown) {
                contourDemWarningShown = true;
                console.warn("Contour DEM tiles unavailable. Real contour lines need /__warzone/terrain/terrarium/... to return PNG tiles.");
            }
            resolve(null);
        };
        image.src = urls[urlIndex];
    });
    contourTerrariumTileCache.set(key, promise);
    trimTerrariumTileCache();
    return promise;
}
function readTerrariumHeight(tilePixels, pixelX, pixelY) {
    if (!tilePixels) return Number.NaN;
    const index = ((pixelY * TERRARIUM_TILE_SIZE) + pixelX) * 4;
    const r = Number(tilePixels[index]);
    const g = Number(tilePixels[index + 1]);
    const b = Number(tilePixels[index + 2]);
    if (![r, g, b].every(Number.isFinite)) return Number.NaN;
    return (r * 256) + g + (b / 256) - 32768;
}
async function sampleTerrariumContourTerrain(samplePositions = []) {
    if (
        !Array.isArray(samplePositions) ||
        !samplePositions.length ||
        boolVar("--warzone-contour-dem-enabled", true) !== true ||
        typeof Image === "undefined" ||
        typeof document === "undefined"
    ) {
        return false;
    }
    const zoom = getContourTerrariumZoom();
    const tileGroups = new Map();
    let centerLonTotal = 0;
    let centerLatTotal = 0;
    let centerCount = 0;
    samplePositions.forEach((position, index) => {
        const lon = Cesium.Math.toDegrees(position.longitude);
        const lat = Cesium.Math.toDegrees(position.latitude);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        centerLonTotal += lon;
        centerLatTotal += lat;
        centerCount += 1;
        const tilePoint = getTerrariumTilePoint(lon, lat, zoom);
        const key = `${tilePoint.z}/${tilePoint.x}/${tilePoint.y}`;
        if (!tileGroups.has(key)) tileGroups.set(key, { tilePoint, samples: [], lonTotal: 0, latTotal: 0, count: 0 });
        const group = tileGroups.get(key);
        group.lonTotal += lon;
        group.latTotal += lat;
        group.count += 1;
        tileGroups.get(key).samples.push({ index, pixelX: tilePoint.pixelX, pixelY: tilePoint.pixelY });
    });
    const maxTiles = Math.max(8, Math.min(96, Math.round(numberVar("--warzone-contour-dem-max-tiles", 42))));
    const centerLon = centerCount ? centerLonTotal / centerCount : 0;
    const centerLat = centerCount ? centerLatTotal / centerCount : 0;
    const groups = Array.from(tileGroups.values())
        .sort((a, b) => {
            const aLon = a.count ? a.lonTotal / a.count : centerLon;
            const aLat = a.count ? a.latTotal / a.count : centerLat;
            const bLon = b.count ? b.lonTotal / b.count : centerLon;
            const bLat = b.count ? b.latTotal / b.count : centerLat;
            return contourDistanceMeters(aLon, aLat, centerLon, centerLat) - contourDistanceMeters(bLon, bLat, centerLon, centerLat);
        })
        .slice(0, maxTiles);
    await Promise.all(groups.map(async (group) => {
        const pixels = await loadTerrariumTilePixels(group.tilePoint.z, group.tilePoint.x, group.tilePoint.y);
        if (!pixels) return;
        group.samples.forEach((sample) => {
            const target = samplePositions[sample.index];
            const height = readTerrariumHeight(pixels, sample.pixelX, sample.pixelY);
            if (target && Number.isFinite(height)) {
                target.height = height;
            }
        });
    }));
    return hasSampledContourHeights(samplePositions);
}
function getArcGisContourSampleUrl(terrainProvider) {
    const url = String(terrainProvider?.__warzoneArcGisUrl || getFocusedTerrainArcGisUrl() || "").trim();
    return url ? `${url.replace(/\/+$/, "")}/getSamples` : "";
}
async function sampleArcGisContourTerrain(terrainProvider, samplePositions = []) {
    const sampleUrl = getArcGisContourSampleUrl(terrainProvider);
    if (!sampleUrl || !Array.isArray(samplePositions) || !samplePositions.length || typeof fetch !== "function") {
        return false;
    }
    const batchSize = Math.max(80, Math.min(420, Math.round(numberVar("--warzone-contour-arcgis-batch-size", 280))));
    for (let offset = 0; offset < samplePositions.length; offset += batchSize) {
        const batch = samplePositions.slice(offset, offset + batchSize);
        const geometry = {
            points: batch.map((position) => [
                Cesium.Math.toDegrees(position.longitude),
                Cesium.Math.toDegrees(position.latitude),
            ]),
            spatialReference: { wkid: 4326 },
        };
        const body = new URLSearchParams();
        body.set("f", "json");
        body.set("geometryType", "esriGeometryMultipoint");
        body.set("geometry", JSON.stringify(geometry));
        body.set("returnFirstValueOnly", "true");
        body.set("interpolation", "RSP_BilinearInterpolation");
        const token = getFocusedTerrainArcGisToken();
        if (token) body.set("token", token);
        try {
            const response = await fetch(sampleUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                },
                body,
            });
            if (!response.ok) return false;
            const payload = await response.json();
            if (payload?.error) {
                console.warn("ArcGIS contour sample failed:", payload.error);
                return false;
            }
            const samples = Array.isArray(payload?.samples) ? payload.samples : [];
            samples.forEach((sample, sampleIndex) => {
                const locationId = Number.isFinite(Number(sample?.locationId)) ? Number(sample.locationId) : sampleIndex;
                const target = batch[locationId];
                const height = Number(sample?.value);
                if (target && Number.isFinite(height)) {
                    target.height = height;
                }
            });
        } catch (error) {
            console.warn("ArcGIS contour sample request failed:", error);
            return false;
        }
    }
    return hasSampledContourHeights(samplePositions);
}
async function sampleContourTerrain(terrainProvider, samplePositions = []) {
    if (!Array.isArray(samplePositions) || !samplePositions.length) return false;
    const sampledTerrarium = await sampleTerrariumContourTerrain(samplePositions);
    if (sampledTerrarium) return true;
    if (!terrainProvider) return hasSampledContourHeights(samplePositions);
    if (terrainProvider.__warzoneProviderKind === "arcgis") {
        const sampledArcGis = await sampleArcGisContourTerrain(terrainProvider, samplePositions);
        return sampledArcGis;
    }
    if (typeof Cesium.sampleTerrain === "function") {
        try {
            await Cesium.sampleTerrain(terrainProvider, getContourTerrainSampleLevel(), samplePositions);
            return hasSampledContourHeights(samplePositions);
        } catch (error) {
            console.warn("Contour terrain sample failed:", error);
            return false;
        }
    }
    return hasSampledContourHeights(samplePositions);
}
function getContourFallbackCenter(viewer) {
    const canvas = viewer?.scene?.canvas;
    const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
    if (canvas && viewer?.camera) {
        try {
            const screenCenter = new Cesium.Cartesian2(
                Math.max(0, canvas.clientWidth * 0.5),
                Math.max(0, canvas.clientHeight * 0.5)
            );
            const picked = viewer.camera.pickEllipsoid(screenCenter, ellipsoid);
            if (picked) {
                const cartographic = ellipsoid.cartesianToCartographic(picked);
                if (cartographic) {
                    return {
                        lon: Cesium.Math.toDegrees(cartographic.longitude),
                        lat: Cesium.Math.toDegrees(cartographic.latitude),
                        height: Number(cartographic.height || 0),
                    };
                }
            }
        } catch { }
    }
    const cameraCartographic = viewer?.camera?.positionCartographic;
    if (cameraCartographic) {
        return {
            lon: Cesium.Math.toDegrees(cameraCartographic.longitude),
            lat: Cesium.Math.toDegrees(cameraCartographic.latitude),
            height: Number(cameraCartographic.height || 0),
        };
    }
    return null;
}
function clampContourBuildArea(area) {
    if (!area) return area;
    const maxSpanMeters = Math.max(120000, Math.min(1800000, numberVar("--warzone-contour-max-build-span", 650000)));
    const widthMeters = Number(area.widthMeters || 0);
    const heightMeters = Number(area.heightMeters || 0);
    if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters) || widthMeters <= 0 || heightMeters <= 0) return area;
    const scale = Math.min(1, maxSpanMeters / widthMeters, maxSpanMeters / heightMeters);
    if (scale >= 0.999) return area;
    const nextWidth = widthMeters * scale;
    const nextHeight = heightMeters * scale;
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(area.centerLat)) * latMeters);
    const halfLon = (nextWidth * 0.5) / lonMeters;
    const halfLat = (nextHeight * 0.5) / latMeters;
    return {
        minLon: area.centerLon - halfLon,
        maxLon: area.centerLon + halfLon,
        minLat: Math.max(-84, area.centerLat - halfLat),
        maxLat: Math.min(84, area.centerLat + halfLat),
        centerLon: area.centerLon,
        centerLat: area.centerLat,
        widthMeters: nextWidth,
        heightMeters: nextHeight,
        halfDiagonalMeters: Math.hypot(nextWidth, nextHeight) * 0.5,
    };
}
function getContourCenteredBuildArea(viewer, centerLon, centerLat, spanMeters = null) {
    const latMeters = 111320;
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(centerLat)) * latMeters);
    const { strongRadius, outerRadius } = getContourOverlayRadii(viewer);
    const samplePadding = getContourSamplePaddingMeters();
    const defaultSpan = Math.max(
        numberVar("--warzone-contour-local-span", 240000),
        (outerRadius + samplePadding) * 2
    );
    const span = Math.max(60000, Math.min(820000, Number(spanMeters ?? defaultSpan)));
    const halfLon = (span * 0.5) / lonMeters;
    const halfLat = (span * 0.5) / latMeters;
    return {
        minLon: centerLon - halfLon,
        maxLon: centerLon + halfLon,
        minLat: Math.max(-84, centerLat - halfLat),
        maxLat: Math.min(84, centerLat + halfLat),
        centerLon,
        centerLat,
        widthMeters: span,
        heightMeters: span,
        halfDiagonalMeters: Math.SQRT2 * span * 0.5,
        visibleStrongRadiusMeters: strongRadius,
        visibleOuterRadiusMeters: outerRadius,
        samplePaddingMeters: samplePadding,
    };
}
function getContourViewportBuildArea(viewer, centerLon, centerLat, options = {}) {
    const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
    const rect = viewer?.camera?.computeViewRectangle?.(ellipsoid);
    const latMeters = 111320;
    if (rect) {
        let west = Cesium.Math.toDegrees(rect.west);
        let east = Cesium.Math.toDegrees(rect.east);
        const south = Math.max(-84, Cesium.Math.toDegrees(rect.south));
        const north = Math.min(84, Cesium.Math.toDegrees(rect.north));
        if (east < west) east += 360;
        const latSpan = Math.max(0.01, north - south);
        const lonSpan = Math.max(0.01, east - west);
        const margin = Math.max(0.02, Math.min(0.35, numberVar("--warzone-contour-viewport-margin", 0.18)));
        const marginMinLat = Math.max(-84, south - (latSpan * margin));
        const marginMaxLat = Math.min(84, north + (latSpan * margin));
        const marginMinLon = west - (lonSpan * margin);
        const marginMaxLon = east + (lonSpan * margin);
        const marginMidLat = (marginMinLat + marginMaxLat) * 0.5;
        const marginMidLon = (marginMinLon + marginMaxLon) * 0.5;
        const marginLonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(marginMidLat)) * latMeters);
        const marginWidthMeters = Math.abs(marginMaxLon - marginMinLon) * marginLonMeters;
        const marginHeightMeters = Math.abs(marginMaxLat - marginMinLat) * latMeters;
        const baseOverscanMeters = Math.max(60000, Math.min(320000, numberVar("--warzone-contour-viewport-overscan-meters", 180000)));
        const heightDrivenOverscanMeters = Number.isFinite(Number(options.centerHeight))
            ? Math.max(baseOverscanMeters, Math.min(320000, Number(options.centerHeight) * 5))
            : baseOverscanMeters;
        const halfLonOverscan = (heightDrivenOverscanMeters * 0.5) / marginLonMeters;
        const halfLatOverscan = (heightDrivenOverscanMeters * 0.5) / latMeters;
        const minLat = Math.max(-84, marginMinLat - halfLatOverscan);
        const maxLat = Math.min(84, marginMaxLat + halfLatOverscan);
        const minLon = marginMinLon - halfLonOverscan;
        const maxLon = marginMaxLon + halfLonOverscan;
        const midLat = (minLat + maxLat) * 0.5;
        const midLon = (minLon + maxLon) * 0.5;
        const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(midLat)) * latMeters);
        const widthMeters = Math.max(marginWidthMeters, Math.abs(maxLon - minLon) * lonMeters);
        const heightMeters = Math.max(marginHeightMeters, Math.abs(maxLat - minLat) * latMeters);
        if (Number.isFinite(widthMeters) && Number.isFinite(heightMeters) && widthMeters > 500 && heightMeters > 500) {
            const area = {
                minLon,
                maxLon,
                minLat,
                maxLat,
                centerLon: midLon,
                centerLat: midLat,
                widthMeters,
                heightMeters,
                halfDiagonalMeters: Math.hypot(widthMeters, heightMeters) * 0.5,
            };
            return options.clamp === false ? area : clampContourBuildArea(area);
        }
    }
    const { outerRadius } = getContourOverlayRadii(viewer);
    const lonMeters = Math.max(1, Math.cos(Cesium.Math.toRadians(centerLat)) * latMeters);
    const lonDelta = outerRadius / lonMeters;
    const latDelta = outerRadius / latMeters;
    const fallbackArea = {
        minLon: centerLon - lonDelta,
        maxLon: centerLon + lonDelta,
        minLat: Math.max(-84, centerLat - latDelta),
        maxLat: Math.min(84, centerLat + latDelta),
        centerLon,
        centerLat,
        widthMeters: outerRadius * 2,
        heightMeters: outerRadius * 2,
        halfDiagonalMeters: Math.SQRT2 * outerRadius,
    };
    return options.clamp === false ? fallbackArea : clampContourBuildArea(fallbackArea);
}
function getContourGridDimensions(area) {
    const base = getContourGridSampleSize();
    const aspect = Math.max(0.35, Math.min(3.5, Number(area?.widthMeters || 1) / Math.max(1, Number(area?.heightMeters || 1))));
    let cols = Math.round(base * Math.sqrt(aspect));
    let rows = Math.round(base / Math.sqrt(aspect));
    cols = Math.max(32, Math.min(112, cols));
    rows = Math.max(32, Math.min(112, rows));
    const maxSamples = Math.max(900, Math.min(5600, Math.round(numberVar("--warzone-contour-max-samples", 1800))));
    while ((cols + 1) * (rows + 1) > maxSamples && cols > 32 && rows > 32) {
        cols = Math.max(32, Math.floor(cols * 0.94));
        rows = Math.max(32, Math.floor(rows * 0.94));
    }
    return { rows, cols };
}
function smoothContourGridHeights(grid, passes = 1) {
    if (!Array.isArray(grid) || grid.length < 3 || !Array.isArray(grid[0]) || grid[0].length < 3) return;
    const totalPasses = Math.max(0, Math.min(5, Math.round(Number(passes || 0))));
    for (let pass = 0; pass < totalPasses; pass += 1) {
        const nextHeights = grid.map((row) => row.map((point) => Number(point?.height)));
        for (let row = 1; row < grid.length - 1; row += 1) {
            for (let col = 1; col < grid[row].length - 1; col += 1) {
                let total = 0;
                let weight = 0;
                for (let dy = -1; dy <= 1; dy += 1) {
                    for (let dx = -1; dx <= 1; dx += 1) {
                        const height = Number(grid[row + dy]?.[col + dx]?.height);
                        if (!Number.isFinite(height)) continue;
                        const sampleWeight = dx === 0 && dy === 0 ? 3 : 1;
                        total += height * sampleWeight;
                        weight += sampleWeight;
                    }
                }
                if (weight > 0) nextHeights[row][col] = total / weight;
            }
        }
        grid.forEach((rowPoints, row) => {
            rowPoints.forEach((point, col) => {
                const height = Number(nextHeights[row]?.[col]);
                if (Number.isFinite(height)) point.height = height;
            });
        });
    }
}
function getContourGridHeightRange(grid) {
    let minHeight = Number.POSITIVE_INFINITY;
    let maxHeight = Number.NEGATIVE_INFINITY;
    grid.forEach((rowPoints) => {
        rowPoints.forEach((point) => {
            const height = Number(point?.height);
            if (!Number.isFinite(height)) return;
            minHeight = Math.min(minHeight, height);
            maxHeight = Math.max(maxHeight, height);
        });
    });
    return { minHeight, maxHeight };
}
function ensureContourGridCoordinates(grid) {
    if (!Array.isArray(grid)) return;
    grid.forEach((rowPoints) => {
        rowPoints.forEach((point) => {
            if (!Number.isFinite(point.lon)) point.lon = Cesium.Math.toDegrees(point.longitude);
            if (!Number.isFinite(point.lat)) point.lat = Cesium.Math.toDegrees(point.latitude);
        });
    });
}
function getContourLevels(minHeight, maxHeight, area = null) {
    const relief = Math.max(0, maxHeight - minHeight);
    if (!Number.isFinite(relief) || relief < 0.6) return [];
    const configuredSpacing = Math.max(4, Math.min(280, numberVar("--warzone-live-contour-spacing", numberVar("--warzone-live-aircraft-contour-spacing", 70))));
    const targetLineCount = Math.max(10, Math.min(34, Math.round(numberVar("--warzone-contour-target-lines", 28))));
    const adaptiveSpacing = Math.max(1, relief / targetLineCount);
    const diagonalKm = Math.max(0, Number(area?.halfDiagonalMeters || 0) / 1000);
    const scaleSpacing = diagonalKm > 800
        ? 120
        : diagonalKm > 480
            ? 80
            : diagonalKm > 260
                ? 45
                : diagonalKm > 140
                    ? 28
                    : 14;
    const step = Math.max(1, Math.min(320, Math.max(configuredSpacing, adaptiveSpacing, scaleSpacing)));
    const start = Math.ceil(minHeight / step) * step;
    const end = Math.floor(maxHeight / step) * step;
    const levels = [];
    for (let level = start; level <= end; level += step) {
        levels.push(Math.round(level * 10) / 10);
        if (levels.length >= targetLineCount + 4) break;
    }
    if (!levels.length && relief >= 0.6) {
        const fallbackStep = Math.max(0.5, relief / 6);
        for (let level = minHeight + fallbackStep; level < maxHeight; level += fallbackStep) {
            levels.push(Math.round(level * 10) / 10);
            if (levels.length >= 8) break;
        }
    }
    return levels;
}
function destroyContourGridPrimitive(viewer) {
    const state = getContourOverlayState(viewer);
    const primitive = state?.gridPrimitive;
    if (primitive) {
        try {
            viewer?.scene?.primitives?.remove?.(primitive);
        } catch { }
    }
    state.gridPrimitive = null;
}
function updateContourGridPrimitiveCenter(viewer, position = null) {
    const state = getContourOverlayState(viewer);
    const primitive = state?.gridPrimitive;
    const lon = Number(position?.lon ?? state?.gridCenterLon ?? state?.centerLon);
    const lat = Number(position?.lat ?? state?.gridCenterLat ?? state?.centerLat);
    if (!primitive || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    state.gridCenterLon = lon;
    state.gridCenterLat = lat;
    const heightOffset = Math.max(8, numberVar("--warzone-contour-grid-height-offset", 70));
    primitive.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(lon, lat, heightOffset)
    );
    primitive.show = viewer.__contourGridLayerVisible === true;
    raiseContourGridPrimitive(viewer);
    viewer.scene?.requestRender?.();
    return true;
}
function chooseOperationalGridIntervalMeters(radius) {
    const target = Math.max(1000, Number(radius || 0) / 4);
    const candidates = [1000, 2000, 5000, 10000, 25000, 50000, 100000];
    return candidates.find((value) => value >= target) || candidates[candidates.length - 1];
}
function addContourGridRing(collection, radiusMeters, options = {}) {
    if (!collection || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return 0;
    const segments = Math.max(96, Math.min(256, Math.round(numberVar("--warzone-contour-grid-ring-segments", 160))));
    const positions = [];
    for (let index = 0; index <= segments; index += 1) {
        const angle = (Math.PI * 2 * index) / segments;
        positions.push(new Cesium.Cartesian3(
            Math.cos(angle) * radiusMeters,
            Math.sin(angle) * radiusMeters,
            0
        ));
    }
    collection.add({
        positions,
        width: Math.max(0.4, Math.min(5, Number(options.width || 1.4))),
        material: Cesium.Material.fromType("Color", {
            color: options.color || Cesium.Color.WHITE.withAlpha(0.35),
        }),
    });
    return 1;
}
function ensureContourGridPrimitive(viewer, center = null, options = {}) {
    if (!viewer?.scene?.primitives || boolVar("--warzone-contour-grid-enabled", true) !== true) return 0;
    const state = getContourOverlayState(viewer);
    if (!state) return 0;
    if (options.force === true) destroyContourGridPrimitive(viewer);
    if (state.gridPrimitive) {
        updateContourGridPrimitiveCenter(viewer, center);
        return Number(state.gridPrimitive.length || 0);
    }
    const gridColorVar = "--warzone-contour-grid-color";
    const gridAlphaVar = "--warzone-contour-grid-alpha";
    const gridMajorAlphaVar = "--warzone-contour-grid-major-alpha";
    const gridWidthVar = "--warzone-contour-grid-width";
    const color = colorFromCssVar(gridColorVar, "#18f4ff", 1);
    const ringColor = colorFromCssVar("--warzone-contour-grid-ring-color", cssVar(gridColorVar, "#18f4ff"), 1);
    const alpha = clamp01(numberVar(gridAlphaVar, 0.16));
    const majorAlpha = clamp01(numberVar(gridMajorAlphaVar, 0.24));
    const width = Math.max(0.35, Math.min(2.4, numberVar(gridWidthVar, 0.62)));
    const ringWidth = Math.max(0.35, Math.min(5, numberVar("--warzone-contour-grid-ring-width", width * 1.4)));
    const ringAlpha = clamp01(numberVar("--warzone-contour-grid-ring-alpha", Math.max(majorAlpha, 0.42)));
    const innerRingAlpha = clamp01(numberVar("--warzone-contour-grid-ring-inner-alpha", Math.max(alpha, 0.28)));
    const innerRingScale = Math.max(0.15, Math.min(0.95, numberVar("--warzone-contour-grid-ring-inner-scale", 0.58)));
    const majorEvery = Math.max(2, Math.round(numberVar("--warzone-contour-grid-major-every", 4)));
    const radius = Math.max(5000, Math.min(80000, numberVar("--warzone-contour-grid-radius", 30000)));
    const intervalMeters = chooseOperationalGridIntervalMeters(radius);
    const rows = Math.max(4, Math.min(18, Math.round((radius * 2) / intervalMeters)));
    const cols = rows;
    const fadeStart = Math.max(0, Math.min(radius - 500, numberVar("--warzone-contour-grid-fade-start", 24000)));
    const segments = Math.max(6, Math.min(18, Math.round(numberVar("--warzone-contour-grid-fade-segments", 10))));
    const centerClearRadius = Math.max(0, Math.min(radius * 0.72, numberVar("--warzone-contour-grid-center-clear-radius", 0)));
    const collection = new Cesium.PolylineCollection();
    const addSegmentedLine = (fixedOffset, horizontal, major = false) => {
        const halfLength = Math.sqrt(Math.max(0, (radius * radius) - (fixedOffset * fixedOffset)));
        if (halfLength <= 1) return;
        const baseAlpha = major ? majorAlpha : alpha;
        for (let segment = 0; segment < segments; segment += 1) {
            const start = lerp(-halfLength, halfLength, segment / segments);
            const end = lerp(-halfLength, halfLength, (segment + 1) / segments);
            const midpoint = (start + end) * 0.5;
            const distance = Math.hypot(fixedOffset, midpoint);
            if (centerClearRadius > 0 && distance < centerClearRadius) continue;
            const fadeT = distance <= fadeStart
                ? 0
                : (distance - fadeStart) / Math.max(1, radius - fadeStart);
            const fade = Math.max(0, 1 - smoothContourFade(fadeT));
            if (fade <= 0.015) continue;
            const startPosition = horizontal
                ? new Cesium.Cartesian3(start, fixedOffset, 0)
                : new Cesium.Cartesian3(fixedOffset, start, 0);
            const endPosition = horizontal
                ? new Cesium.Cartesian3(end, fixedOffset, 0)
                : new Cesium.Cartesian3(fixedOffset, end, 0);
            collection.add({
                positions: [startPosition, endPosition],
                width: major ? width * 1.35 : width,
                material: Cesium.Material.fromType("Color", {
                    color: color.withAlpha(baseAlpha * fade),
                }),
            });
        }
    };
    for (let row = 0; row <= rows; row += 1) {
        const y = lerp(-radius, radius, row / rows);
        addSegmentedLine(y, true, row % majorEvery === 0);
    }
    for (let col = 0; col <= cols; col += 1) {
        const x = lerp(-radius, radius, col / cols);
        addSegmentedLine(x, false, col % majorEvery === 0);
    }
    if (boolVar("--warzone-contour-grid-ring-enabled", true) === true) {
        addContourGridRing(collection, radius * innerRingScale, {
            width: ringWidth * 0.86,
            color: ringColor.withAlpha(innerRingAlpha),
        });
        addContourGridRing(collection, radius, {
            width: ringWidth,
            color: ringColor.withAlpha(ringAlpha),
        });
    }
    state.gridIntervalMeters = intervalMeters;
    state.gridRadiusMeters = radius;
    state.gridPrimitive = viewer.scene.primitives.add(collection);
    updateContourGridPrimitiveCenter(viewer, center);
    raiseContourGridPrimitive(viewer);
    return Number(collection.length || 0);
}
function splitContourPolylineByRadius(points = [], centerLon, centerLat, outerRadius) {
    if (!Array.isArray(points) || points.length < 2 || !Number.isFinite(outerRadius) || outerRadius <= 0) return [];
    const result = [];
    let current = [];
    const maxChunkPoints = Math.max(6, Math.min(28, Math.round(numberVar("--warzone-contour-fade-chunk-points", 14))));
    const flush = () => {
        if (current.length >= 2) result.push(current);
        current = [];
    };
    const includePoint = (point) => {
        const distance = contourDistanceMeters(centerLon, centerLat, Number(point?.lon), Number(point?.lat));
        return Number.isFinite(distance) && distance <= outerRadius;
    };
    points.forEach((point) => {
        if (includePoint(point)) {
            current.push(point);
            if (current.length >= maxChunkPoints) {
                const carry = current[current.length - 1];
                flush();
                current = [carry];
            }
            return;
        }
        flush();
    });
    flush();
    return result;
}
function smoothContourPolyline(points = [], passes = 1) {
    if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points.slice() : [];
    let result = points.slice();
    const totalPasses = Math.max(0, Math.min(5, Number(passes || 0)));
    for (let pass = 0; pass < totalPasses; pass += 1) {
        if (result.length < 3) break;
        const next = [result[0]];
        for (let index = 0; index < result.length - 1; index += 1) {
            const current = result[index];
            const following = result[index + 1];
            next.push({
                lon: lerp(current.lon, following.lon, 0.25),
                lat: lerp(current.lat, following.lat, 0.25),
                height: lerp(current.height, following.height, 0.25),
            });
            next.push({
                lon: lerp(current.lon, following.lon, 0.75),
                lat: lerp(current.lat, following.lat, 0.75),
                height: lerp(current.height, following.height, 0.75),
            });
        }
        next.push(result[result.length - 1]);
        if (next.length >= 3) {
            const relaxed = [next[0]];
            for (let index = 1; index < next.length - 1; index += 1) {
                const previous = next[index - 1];
                const current = next[index];
                const following = next[index + 1];
                const avgLon = (previous.lon + current.lon + following.lon) / 3;
                const avgLat = (previous.lat + current.lat + following.lat) / 3;
                const avgHeight = (previous.height + current.height + following.height) / 3;
                relaxed.push({
                    lon: lerp(current.lon, avgLon, 0.18),
                    lat: lerp(current.lat, avgLat, 0.18),
                    height: lerp(current.height, avgHeight, 0.18),
                });
            }
            relaxed.push(next[next.length - 1]);
            result = relaxed;
        } else {
            result = next;
        }
    }
    return result;
}
function joinContourSegments(segments = []) {
    const quantize = (point) => `${Math.round(point.lon * 10000)}:${Math.round(point.lat * 10000)}`;
    const adjacency = new Map();
    const used = new Array(segments.length).fill(false);
    segments.forEach((segment, index) => {
        [segment.a, segment.b].forEach((point, endpoint) => {
            const key = quantize(point);
            if (!adjacency.has(key)) adjacency.set(key, []);
            adjacency.get(key).push({ index, endpoint });
        });
    });
    const chains = [];
    const appendConnected = (points, forward = true) => {
        let keepWalking = true;
        while (keepWalking) {
            keepWalking = false;
            const edgePoint = forward ? points[points.length - 1] : points[0];
            const key = quantize(edgePoint);
            const candidates = adjacency.get(key) || [];
            for (const candidate of candidates) {
                if (used[candidate.index]) continue;
                used[candidate.index] = true;
                const segment = segments[candidate.index];
                const nextPoint = candidate.endpoint === 0 ? segment.b : segment.a;
                if (forward) points.push(nextPoint);
                else points.unshift(nextPoint);
                keepWalking = true;
                break;
            }
        }
    };
    segments.forEach((segment, index) => {
        if (used[index]) return;
        used[index] = true;
        const points = [segment.a, segment.b];
        appendConnected(points, true);
        appendConnected(points, false);
        chains.push(points);
    });
    return chains;
}
function buildContourSegments(grid, level) {
    const segments = [];
    const rows = grid.length - 1;
    const cols = grid[0]?.length - 1 || 0;
    const interpolateEdge = (a, b, fallbackHeight = level) => {
        const delta = b.height - a.height;
        const t = Math.abs(delta) < 1e-6 ? 0.5 : clamp01((level - a.height) / delta);
        return {
            lon: lerp(a.lon, b.lon, t),
            lat: lerp(a.lat, b.lat, t),
            height: fallbackHeight,
        };
    };
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const topLeft = grid[row][col];
            const topRight = grid[row][col + 1];
            const bottomRight = grid[row + 1][col + 1];
            const bottomLeft = grid[row + 1][col];
            const edges = [];
            if ((topLeft.height >= level) !== (topRight.height >= level)) edges.push(interpolateEdge(topLeft, topRight));
            if ((topRight.height >= level) !== (bottomRight.height >= level)) edges.push(interpolateEdge(topRight, bottomRight));
            if ((bottomRight.height >= level) !== (bottomLeft.height >= level)) edges.push(interpolateEdge(bottomRight, bottomLeft));
            if ((bottomLeft.height >= level) !== (topLeft.height >= level)) edges.push(interpolateEdge(bottomLeft, topLeft));
            if (edges.length === 2) {
                segments.push({ a: edges[0], b: edges[1] });
            } else if (edges.length === 4) {
                const averageHeight = (topLeft.height + topRight.height + bottomRight.height + bottomLeft.height) * 0.25;
                if (averageHeight >= level) {
                    segments.push({ a: edges[0], b: edges[1] });
                    segments.push({ a: edges[2], b: edges[3] });
                } else {
                    segments.push({ a: edges[0], b: edges[3] });
                    segments.push({ a: edges[1], b: edges[2] });
                }
            }
        }
    }
    return segments;
}
async function buildContourOverlay(viewer, options = {}) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    if (state.buildPromise) {
        state.buildQueued = true;
        state.buildQueuedForce = state.buildQueuedForce || options.force === true;
        state.buildQueuedReason = options.reason || state.buildQueuedReason;
        return state.buildPromise;
    }
    state.buildPromise = (async () => {
        const buildToken = state.buildToken;
        const contourVisible = viewer.__contourLayerVisible === true;
        const gridVisible = viewer.__contourGridLayerVisible === true;
        const visible = contourVisible || gridVisible;
        if (!visible) {
            clearContourOverlay(viewer);
            return false;
        }
        if (!Number.isFinite(state.centerLon) || !Number.isFinite(state.centerLat)) {
            const fallbackCenter = getContourFallbackCenter(viewer);
            if (fallbackCenter) {
                state.centerLon = fallbackCenter.lon;
                state.centerLat = fallbackCenter.lat;
                state.centerHeight = fallbackCenter.height;
                state.hasFocusPosition = false;
            }
        }
        if (!Number.isFinite(state.centerLon) || !Number.isFinite(state.centerLat)) {
            clearContourOverlay(viewer);
            return false;
        }
        const centerLon = state.centerLon;
        const centerLat = state.centerLat;
        const refreshDistance = Math.max(900, numberVar("--warzone-contour-refresh-distance", 2400));
        if (
            options.force !== true &&
            contourDistanceMeters(centerLon, centerLat, state.lastBuiltLon, state.lastBuiltLat) < refreshDistance &&
            (Date.now() - state.lastBuiltAt) < 550
        ) {
            return false;
        }
        const dataSource = await ensureContourOverlayDataSource(viewer);
        if (!isContourBuildCurrent(viewer, state, buildToken)) return false;
        const terrainProvider = state.terrainProvider || null;
        const focusProfile = getContourFocusProfile(viewer);
        const useFocusedRadius =
            state.hasFocusPosition === true &&
            boolVar(`--warzone-live-${focusProfile}-contour-focus-radius-enabled`, boolVar("--warzone-live-contour-focus-radius-enabled", false)) === true;
        const area = useFocusedRadius
            ? getContourCenteredBuildArea(viewer, centerLon, centerLat)
            : clampContourBuildArea(getContourViewportBuildArea(
                viewer,
                centerLon,
                centerLat,
                {
                    centerHeight: state.centerHeight,
                    clamp: false,
                }
            ));
        const gridDimensions = getContourGridDimensions(area);
        const grid = [];
        const samplePositions = [];
        for (let row = 0; row <= gridDimensions.rows; row += 1) {
            const rowPoints = [];
            const lat = lerp(area.minLat, area.maxLat, row / Math.max(1, gridDimensions.rows));
            for (let col = 0; col <= gridDimensions.cols; col += 1) {
                const lon = lerp(area.minLon, area.maxLon, col / Math.max(1, gridDimensions.cols));
                const sample = Cesium.Cartographic.fromDegrees(lon, lat, 0);
                samplePositions.push(sample);
                rowPoints.push(sample);
            }
            grid.push(rowPoints);
        }
        const contourColorVar = "--warzone-live-contour-color";
        const contourLineWidthVar = "--warzone-contour-line-width";
        const contourHaloAlphaVar = "--warzone-contour-halo-alpha";
        const contourHaloWidthVar = "--warzone-contour-halo-width";
        const color = colorFromCssVar(contourColorVar, cssVar(`--warzone-live-${focusProfile}-contour-color`, "#18e2db"), 1);
        const baseAlpha = clamp01(numberVar("--warzone-live-contour-alpha", numberVar(`--warzone-live-${focusProfile}-contour-alpha`, 0.34)));
        const minAlpha = clamp01(numberVar("--warzone-live-contour-min-alpha", numberVar(`--warzone-live-${focusProfile}-contour-min-alpha`, 0.012)));
        const lineWidth = Math.max(0.55, numberVar(contourLineWidthVar, 1.35));
        const haloAlpha = Math.max(0.02, clamp01(numberVar(contourHaloAlphaVar, 0.16)));
        const majorEvery = Math.max(2, Math.round(numberVar("--warzone-live-contour-major-every", numberVar(`--warzone-live-${focusProfile}-contour-major-every`, 5))));
        const majorWidthScale = Math.max(1, numberVar("--warzone-live-contour-major-width-scale", numberVar(`--warzone-live-${focusProfile}-contour-major-width-scale`, 1.65)));
        const elevationWidthScale = Math.max(0, numberVar("--warzone-contour-elevation-width-scale", 0.28));
        const haloWidth = Math.max(0, numberVar(contourHaloWidthVar, 4.6));
        const heightOffset = Math.max(8, numberVar("--warzone-contour-height-offset", 95));
        const smoothingPasses = Math.max(0, Math.min(5, Math.round(numberVar("--warzone-contour-smoothing-passes", 2))));
        const maxLines = Math.max(120, Math.min(700, Math.round(numberVar("--warzone-contour-max-lines", 520))));
        state.clearToken += 1;
        if (state.clearTimer) {
            clearTimeout(state.clearTimer);
            state.clearTimer = 0;
        }
        const gridLineCount = gridVisible
            ? ensureContourGridPrimitive(viewer, {
                lon: Number.isFinite(state.gridCenterLon) ? state.gridCenterLon : centerLon,
                lat: Number.isFinite(state.gridCenterLat) ? state.gridCenterLat : centerLat,
            }, { force: options.force === true })
            : 0;
        if (state.gridPrimitive) state.gridPrimitive.show = gridVisible;
        if (!contourVisible) {
            dataSource.entities.removeAll();
            dataSource.show = false;
            state.hasVisibleContours = false;
            state.lastBuiltLon = centerLon;
            state.lastBuiltLat = centerLat;
            state.lastBuiltAt = Date.now();
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return gridLineCount > 0;
        }
        const sampled = await sampleContourTerrain(terrainProvider, samplePositions);
        if (!isContourBuildCurrent(viewer, state, buildToken)) return false;
        const validSampleHeights = samplePositions
            .map((position) => Number(position?.height))
            .filter(Number.isFinite)
            .sort((a, b) => a - b);
        const hasRealSamples = sampled && validSampleHeights.length >= 24 && (validSampleHeights.length / samplePositions.length) >= 0.08;
        const fillHeight = validSampleHeights[Math.floor(validSampleHeights.length * 0.5)] || 0;
        grid.forEach((rowPoints) => {
            rowPoints.forEach((point) => {
                const height = Number(point?.height);
                point.height = hasRealSamples && Number.isFinite(height) ? height : fillHeight;
                point.lon = Cesium.Math.toDegrees(point.longitude);
                point.lat = Cesium.Math.toDegrees(point.latitude);
            });
        });
        if (!hasRealSamples) {
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return gridLineCount > 0 || state.hasVisibleContours === true;
        }
        smoothContourGridHeights(grid, numberVar("--warzone-contour-height-smoothing-passes", 3));
        let { minHeight, maxHeight } = getContourGridHeightRange(grid);
        let levels = getContourLevels(minHeight, maxHeight, area);
        if (!levels.length) {
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return gridLineCount > 0 || state.hasVisibleContours === true;
        }
        const { strongRadius, outerRadius } = getContourOverlayRadii();
        const contourStrongRadius = Number.isFinite(Number(area?.visibleStrongRadiusMeters))
            ? Number(area.visibleStrongRadiusMeters)
            : strongRadius;
        const contourOuterRadius = Math.max(
            contourStrongRadius + 1000,
            Number.isFinite(Number(area?.visibleOuterRadiusMeters))
                ? Number(area.visibleOuterRadiusMeters)
                : outerRadius
        );
        const reliefRange = Math.max(1, maxHeight - minHeight);
        let lineCount = 0;
        const pendingContourEntities = [];
        levels.forEach((level, levelIndex) => {
            if (lineCount >= maxLines) return;
            const segments = buildContourSegments(grid, level);
            const chains = joinContourSegments(segments);
            const isMajor = levelIndex % majorEvery === 0 || levelIndex === 0 || levelIndex === levels.length - 1;
            const elevationT = clamp01((level - minHeight) / reliefRange);
            const widthScale = (1 + (elevationT * elevationWidthScale)) * (isMajor ? majorWidthScale : 1);
            chains.forEach((chain, chainIndex) => {
                if (lineCount >= maxLines) return;
                if (!Array.isArray(chain) || chain.length < 2) return;
                const smoothed = smoothContourPolyline(chain, smoothingPasses);
                const visibleSegments = [smoothed];
                visibleSegments.forEach((visibleSegment, segmentIndex) => {
                    if (lineCount >= maxLines) return;
                    const alphaScale = getContourChainAlphaScale(
                        visibleSegment,
                        centerLon,
                        centerLat,
                        contourStrongRadius,
                        contourOuterRadius
                    );
                    if (alphaScale <= 0.001) return;
                    const chainAlpha = Math.max(minAlpha, (isMajor ? Math.min(0.88, baseAlpha * 1.35) : Math.min(0.72, baseAlpha * 1.12)) * alphaScale);
                    const positions = visibleSegment.map((point) => Cesium.Cartesian3.fromDegrees(
                        point.lon,
                        point.lat,
                        Math.max(heightOffset, point.height + heightOffset)
                    ));
                    if (haloWidth > 0) {
                        pendingContourEntities.push({
                            id: `contour-halo-${Math.round(level)}-${chainIndex}-${segmentIndex}`,
                            polyline: {
                                positions,
                                width: (lineWidth * widthScale) + haloWidth,
                                clampToGround: false,
                                arcType: Cesium.ArcType.GEODESIC,
                                material: new Cesium.PolylineGlowMaterialProperty({
                                    glowPower: Math.min(0.95, (isMajor ? haloAlpha * 1.55 : haloAlpha * 1.25) * Math.max(0.45, alphaScale)),
                                    taperPower: 0.55,
                                    color: color.withAlpha(Math.min(0.58, chainAlpha * haloAlpha * (isMajor ? 1.25 : 0.9))),
                                }),
                            },
                        });
                    }
                    const mainMaterial = new Cesium.PolylineGlowMaterialProperty({
                        glowPower: Math.min(
                            0.24,
                            (state.hasFocusPosition === true ? 0.07 : 0.04) +
                            ((isMajor ? 0.055 : 0.03) * Math.max(0.5, alphaScale))
                        ),
                        taperPower: state.hasFocusPosition === true ? 0.82 : 0.68,
                        color: color.withAlpha(chainAlpha),
                    });
                    pendingContourEntities.push({
                        id: `contour-${Math.round(level)}-${chainIndex}-${segmentIndex}`,
                        polyline: {
                            positions,
                            width: lineWidth * widthScale,
                            clampToGround: false,
                            arcType: Cesium.ArcType.GEODESIC,
                            material: mainMaterial,
                        },
                    });
                    lineCount += 1;
                });
            });
        });
        if (!isContourBuildCurrent(viewer, state, buildToken)) return false;
        if (lineCount <= 0 && gridLineCount <= 0) {
            applyRenderedTerrainVisibility(viewer);
            viewer.scene.requestRender?.();
            return state.hasVisibleContours === true;
        }
        dataSource.entities.removeAll();
        pendingContourEntities.forEach((entityDefinition) => dataSource.entities.add(entityDefinition));
        state.hasVisibleContours = lineCount > 0;
        dataSource.show = lineCount > 0;
        raiseContourGridPrimitive(viewer);
        state.lastBuiltLon = centerLon;
        state.lastBuiltLat = centerLat;
        state.lastBuiltAt = Date.now();
        applyContourLayerState(viewer);
        applyRenderedTerrainVisibility(viewer);
        viewer.scene.requestRender?.();
        return true;
    })()
        .catch((error) => {
            console.warn("Contour overlay build failed:", error);
            if (!state.lastBuiltAt) clearContourOverlay(viewer);
            return false;
        })
        .finally(() => {
            state.buildPromise = null;
            if (state.buildQueued) {
                const queuedForce = state.buildQueuedForce;
                const queuedReason = state.buildQueuedReason;
                state.buildQueued = false;
                state.buildQueuedForce = false;
                state.buildQueuedReason = "";
                void buildContourOverlay(viewer, {
                    force: queuedForce,
                    reason: queuedReason || "queued-refresh",
                });
            }
        });
    return state.buildPromise;
}
function queueContourOverlayBuild(viewer, options = {}) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    if (state.buildTimer) {
        clearTimeout(state.buildTimer);
        state.buildTimer = 0;
    }
    const delayMs = Math.max(60, Math.min(260, Math.round(Number(options.delayMs || 140))));
    state.buildTimer = window.setTimeout(() => {
        state.buildTimer = 0;
        void buildContourOverlay(viewer, {
            force: options.force === true,
            reason: options.reason || "queued-build",
        });
    }, delayMs);
    return true;
}
function setContourFocusPosition(viewer, position = null, options = {}) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    const lon = Number(position?.lon);
    const lat = Number(position?.lat);
    const height = Number(position?.height || 0);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        state.centerLon = Number.NaN;
        state.centerLat = Number.NaN;
        state.centerHeight = 0;
        state.hasFocusPosition = false;
        state.focusProfile = "";
        clearContourOverlay(viewer);
        return false;
    }
    state.centerLon = lon;
    state.centerLat = lat;
    state.centerHeight = Number.isFinite(height) ? height : 0;
    state.hasFocusPosition = true;
    state.focusProfile = String(options.profile || options.assetType || "").toLowerCase();
    setContourGridCenter(viewer, { lon, lat, height: state.centerHeight });
    state.buildToken += 1;
    if (viewer.__contourLayerVisible === true) {
        queueContourOverlayBuild(viewer, {
            force: options.force === true,
            reason: options.reason || "focus-position-update",
            delayMs: options.delayMs || 120,
        });
    }
    return true;
}
function clearContourFocusPosition(viewer) {
    const state = getContourOverlayState(viewer);
    if (!state) return;
    if (state.buildTimer) {
        clearTimeout(state.buildTimer);
        state.buildTimer = 0;
    }
    state.centerLon = Number.NaN;
    state.centerLat = Number.NaN;
    state.centerHeight = 0;
    state.hasFocusPosition = false;
    state.focusProfile = "";
    state.gridCenterLon = Number.NaN;
    state.gridCenterLat = Number.NaN;
    const fallbackCenter = getContourFallbackCenter(viewer);
    if (fallbackCenter) setContourGridCenter(viewer, fallbackCenter);
    state.buildToken += 1;
    clearContourOverlayDeferred(viewer);
}

function setContourGridCenter(viewer, position = null) {
    const state = getContourOverlayState(viewer);
    if (!state) return false;
    const lon = Number(position?.lon);
    const lat = Number(position?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    state.gridCenterLon = lon;
    state.gridCenterLat = lat;
    if (!state.gridPrimitive && viewer.__contourGridLayerVisible === true) {
        ensureContourGridPrimitive(viewer, { lon, lat });
        return !!state.gridPrimitive;
    }
    return updateContourGridPrimitiveCenter(viewer, { lon, lat });
}
function refreshContourFromViewport(viewer, options = {}) {
    const state = getContourOverlayState(viewer);
    const center = getContourFallbackCenter(viewer);
    if (!state || !center) return false;
    state.centerLon = center.lon;
    state.centerLat = center.lat;
    state.centerHeight = Number.isFinite(center.height) ? center.height : 0;
    state.hasFocusPosition = false;
    setContourGridCenter(viewer, center);
    state.buildToken += 1;
    if (viewer.__contourLayerVisible === true) {
        queueContourOverlayBuild(viewer, {
            force: options.force === true,
            reason: options.reason || "viewport-contour-refresh",
            delayMs: options.delayMs || 120,
        });
    }
    viewer.scene?.requestRender?.();
    return true;
}
function bindContourViewportRefresh(viewer) {
    if (!viewer?.camera || viewer.__warzoneContourViewportRefreshBound) return;
    viewer.__warzoneContourViewportRefreshBound = true;
    let refreshTimer = 0;
    let moving = false;
    let lastMotionRefreshAt = 0;
    const queueRefresh = (delayMs = 260) => {
        if (viewer.__contourLayerVisible !== true) return;
        const contourState = getContourOverlayState(viewer);
        if (contourState?.hasFocusPosition === true) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => {
            refreshTimer = 0;
            if (viewer.__contourLayerVisible !== true) return;
            const activeContourState = getContourOverlayState(viewer);
            if (activeContourState?.hasFocusPosition === true) return;
            refreshContourFromViewport(viewer, {
                force: false,
                reason: "camera-move-contour-refresh",
            });
        }, Math.max(160, Math.min(900, Number(delayMs || 260))));
    };
    viewer.camera.moveStart.addEventListener(() => {
        moving = true;
    });
    viewer.camera.moveEnd.addEventListener(() => queueRefresh(260));
    viewer.camera.moveEnd.addEventListener(() => {
        moving = false;
    });
    viewer.scene?.postRender?.addEventListener(() => {
        if (moving !== true || viewer.__contourLayerVisible !== true) return;
        const contourState = getContourOverlayState(viewer);
        if (contourState?.hasFocusPosition === true) return;
        const now = Date.now();
        if ((now - lastMotionRefreshAt) < 320) return;
        lastMotionRefreshAt = now;
        queueRefresh(120);
    });
}
function dispatchContourLayerChanged(viewer) {
    document.dispatchEvent(new CustomEvent("wz:contour-layer-changed", {
        detail: {
            visible: viewer?.__contourLayerVisible === true,
        },
    }));
}
function dispatchFocusedTerrainChanged(viewer) {
    document.dispatchEvent(new CustomEvent("wz:focused-terrain-changed", {
        detail: {
            visible: viewer?.__warzoneFocusedTerrainActive === true,
        },
    }));
}
async function setContourLayerVisible(viewer, visible = false) {
    if (!viewer) return false;
    const nextVisible = Boolean(visible);

    /*
     * Do not repeatedly clear imagery, contour entities and cache when
     * contour/grid are already disabled.
     */
    if (
        !nextVisible &&
        viewer.__contourLayerVisible !== true &&
        viewer.__contourGridLayerVisible !== true
    ) {
        return false;
    }

    viewer.__contourLayerVisible = nextVisible;
    if (viewer.__contourLayerVisible) retainContourDemCache();
    if (viewer.__contourLayerVisible) {
        enterCtrMode(viewer, { reason: "contour-layer-on" });
    }
    applyRenderedTerrainVisibility(viewer);
    if (viewer.__contourLayerVisible) {
        const state = getContourOverlayState(viewer);
        if (!Number.isFinite(state?.centerLon) || !Number.isFinite(state?.centerLat)) {
            const fallbackCenter = getContourFallbackCenter(viewer);
            if (fallbackCenter) {
                state.centerLon = fallbackCenter.lon;
                state.centerLat = fallbackCenter.lat;
                state.centerHeight = fallbackCenter.height;
                state.hasFocusPosition = false;
            }
        }
        if (!Number.isFinite(state?.centerLon) || !Number.isFinite(state?.centerLat)) {
            viewer.__contourLayerVisible = false;
            if (viewer.__contourGridLayerVisible !== true) exitCtrMode(viewer, { reason: "contour-no-center" });
            clearContourOverlay(viewer);
            applyRenderedTerrainVisibility(viewer);
            applyContourLayerState(viewer);
            dispatchContourLayerChanged(viewer);
            return false;
        }
        state.buildToken += 1;
        applyRenderedTerrainVisibility(viewer);
        queueContourOverlayBuild(viewer, {
            force: true,
            reason: "toggle-on",
            delayMs: 90,
        });
    } else {
        const state = getContourOverlayState(viewer);
        if (state) state.buildToken += 1;
        if (viewer.__contourGridLayerVisible === true) {
            queueContourOverlayBuild(viewer, {
                force: true,
                reason: "contour-off-grid-on",
                delayMs: 40,
            });
        } else {
            exitCtrMode(viewer, { reason: "contour-layer-off" });
            clearContourOverlay(viewer);
            scheduleContourDemCacheRelease(viewer);
        }
    }
    applyContourLayerState(viewer);
    applyRenderedTerrainVisibility(viewer);
    dispatchContourLayerChanged(viewer);
    viewer.scene?.requestRender?.();
    return viewer.__contourLayerVisible === true;
}
/* ---------- Map mode ---------- */
function normalizeSceneMode(mode = "") {
    const raw = String(mode || "").trim().toLowerCase();
    if (raw === "2d" || raw === "flat") return "2d";
    if (raw === "3d" || raw === "globe") return "3d";
    return "";
}
function getSceneMode(viewer) {
    if (!viewer?.scene) return "3d";
    const sceneMode = viewer.scene.mode;
    if (sceneMode === Cesium.SceneMode.SCENE2D) return "2d";
    if (sceneMode === Cesium.SceneMode.MORPHING) {
        return normalizeSceneMode(viewer.__warzoneSceneTransitionTarget || viewer.__warzoneSceneMode) || "3d";
    }
    return "3d";
}
function isInteractiveSceneModeSource(source = "") {
    const value = String(source || "").trim().toLowerCase();
    return value === "manual" || value === "map-mode" || value === "ui";
}
function startSceneModeTransitionLoader(viewer, durationSeconds = 1.2) {
    if (typeof window === "undefined") return () => { };
    const token = Symbol("warzone-scene-mode-loader");
    const previousKeepVisible = window.__wzKeepSiteLoaderVisible === true;
    const previousKeepUntil = Number(window.__wzKeepSiteLoaderVisibleUntil || 0);
    const holdMs = Math.max(2400, Math.min(7200, Math.round(Number(durationSeconds || 0) * 1000) + 2800));
    viewer.__warzoneSceneModeLoaderToken = token;
    window.__wzKeepSiteLoaderVisible = true;
    window.__wzKeepSiteLoaderVisibleUntil = Date.now() + holdMs;
    window.SiteLoader?.start?.();
    return () => {
        if (viewer.__warzoneSceneModeLoaderToken !== token) return;
        delete viewer.__warzoneSceneModeLoaderToken;
        const shouldRestoreKeep = previousKeepVisible && previousKeepUntil > Date.now();
        window.__wzKeepSiteLoaderVisible = shouldRestoreKeep;
        window.__wzKeepSiteLoaderVisibleUntil = shouldRestoreKeep ? previousKeepUntil : 0;
        window.SiteLoader?.stop?.();
    };
}
function setSceneMode(viewer, mode = "3d", options = {}) {
    if (!viewer?.scene) return "3d";
    const nextMode = normalizeSceneMode(mode);
    if (!nextMode) return getSceneMode(viewer);
    const source = String(options?.source || "system");
    const interactiveTransition = isInteractiveSceneModeSource(source);
    const isMorphing = viewer.scene.mode === Cesium.SceneMode.MORPHING;
    if (isMorphing) {
        const transitionTarget = normalizeSceneMode(viewer.__warzoneSceneTransitionTarget);
        if (interactiveTransition) {
            viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + 9000;
        }
        return transitionTarget || normalizeSceneMode(viewer.__warzoneSceneMode) || getSceneMode(viewer);
    }
    if (viewer.__warzoneSceneModeTransitionActive === true) {
        const transitionTarget = normalizeSceneMode(viewer.__warzoneSceneTransitionTarget);
        if (interactiveTransition) {
            viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + 9000;
        }
        return transitionTarget || getSceneMode(viewer);
    }
    const currentMode = getSceneMode(viewer);
    if (currentMode === nextMode) {
        viewer.__warzoneSceneMode = currentMode;
        if (interactiveTransition) {
            viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + 8000;
            document.dispatchEvent(new CustomEvent("wz:scene-mode-refocus-requested", {
                detail: { mode: nextMode, source },
            }));
        }
        return currentMode;
    }
    const requestedDuration = Number(options?.duration);
    const defaultDuration = Math.max(0.2, Math.min(numberVar("--warzone-scene-morph-duration", 1.15), 3));
    const baseDuration = Number.isFinite(requestedDuration)
        ? Math.max(0, Math.min(requestedDuration, 3))
        : defaultDuration;
    const minInteractiveDuration = interactiveTransition
        ? Math.max(0.85, Math.min(numberVar("--warzone-scene-interactive-min-duration", 1.15), 2.4))
        : 0;
    const duration = Math.max(baseDuration, minInteractiveDuration);
    const stopLoader = interactiveTransition
        ? startSceneModeTransitionLoader(viewer, duration)
        : null;
    if (interactiveTransition) {
        viewer.__warzoneSceneModeRefocusManagedUntil = Date.now() + Math.max(8000, Math.round(duration * 1000) + 5200);
    }
    let finalizeTimer = 0;
    let finalized = false;
    let removeMorphComplete = null;
    const finalizeSceneTransition = () => {
        if (finalized) return;
        finalized = true;
        if (finalizeTimer) {
            clearTimeout(finalizeTimer);
            finalizeTimer = 0;
        }
        if (typeof removeMorphComplete === "function") {
            removeMorphComplete();
            removeMorphComplete = null;
        }
        viewer.__warzoneSceneMode = nextMode;
        viewer.__warzoneSceneTransitionTarget = null;
        viewer.__warzoneSceneModeTransitionActive = false;
        syncSceneModeBounds(viewer);
        stopLoader?.();
        if (interactiveTransition) {
            document.dispatchEvent(new CustomEvent("wz:scene-mode-refocus-requested", {
                detail: { mode: nextMode, source },
            }));
        }
        viewer.scene.requestRender?.();
    };
    try {
        viewer.__warzoneSceneTransitionTarget = nextMode;
        viewer.__warzoneSceneModeTransitionActive = true;
        removeMorphComplete = viewer.scene.morphComplete?.addEventListener?.(finalizeSceneTransition) || null;
        finalizeTimer = window.setTimeout(finalizeSceneTransition, Math.max(900, Math.round(duration * 1000) + 1200));
        if (nextMode === "2d") {
            viewer.scene.morphTo2D(duration);
        } else {
            viewer.scene.morphTo3D(duration);
        }
    } catch {
        if (finalizeTimer) clearTimeout(finalizeTimer);
        if (typeof removeMorphComplete === "function") removeMorphComplete();
        viewer.__warzoneSceneTransitionTarget = null;
        viewer.__warzoneSceneModeTransitionActive = false;
        stopLoader?.();
        return currentMode;
    }
    viewer.__warzoneSceneMode = nextMode;
    document.dispatchEvent(new CustomEvent("wz:scene-mode-changed", {
        detail: {
            mode: nextMode,
            source,
        },
    }));
    viewer.scene.requestRender();
    return nextMode;
}
function setMapMode(viewer, mode = "map") {
    const sceneMode = normalizeSceneMode(mode);
    if (sceneMode) {
        return setSceneMode(viewer, sceneMode, { source: "map-mode" });
    }
    viewer.__warzoneMapMode = mode;
    applyEventLod(viewer);
    return viewer.__warzoneMapMode;
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
    if (!isStratOpsFeatureEnabled("system.audio")) return null;
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
    const alertSrc = readCssAssetPath("--warzone-sound-alert-loop", "/assets/audio/stratops-siren.mp3");
    const impactSrc = readCssAssetPath("--warzone-sound-impact", "");
    viewer.__warzoneAudio = {
        alertLoop: safeCreateAudio(alertSrc, numberVar("--warzone-sound-alert-volume", 0.65), true),
        impactSrc,
        impactVolume: clamp01(numberVar("--warzone-sound-impact-volume", 0.9)),
        activeAlertCount: 0,
    };
    return viewer.__warzoneAudio;
}
function startMissileAlertSound(viewer) {
    if (!isStratOpsFeatureEnabled("system.audio")) return;
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
    return;
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
        if (activeTrack.launchMarker?.billboard) {
            activeTrack.launchMarker.billboard.color = Cesium.Color.WHITE.withAlpha(fade);
        }
        if (activeTrack.impactMarker?.billboard) {
            activeTrack.impactMarker.billboard.color = Cesium.Color.WHITE.withAlpha(fade);
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
    const requestedPersistMs = Number(
        event.persist_ms ||
        (event.severity === "critical"
            ? numberVar("--warzone-missile-persist-critical", 12000)
            : event.severity === "high"
                ? numberVar("--warzone-missile-persist-high", 10000)
                : numberVar("--warzone-missile-persist-medium", 8000))
    );
    const completedHoldMinMs = Math.max(
        10000,
        numberVar("--warzone-missile-completed-hold-min", 10000)
    );
    const persistMs = Math.max(
        completedHoldMinMs,
        Number.isFinite(requestedPersistMs) ? requestedPersistMs : completedHoldMinMs
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
    const launchLabel = createTacticalStrikeLabel(event.origin_label || "Launch", cssVar("--warzone-missile-launch-color", "#ff2a2a"));
    const launchMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(originLon, originLat),
        point: {
            pixelSize: 10,
            color: launchColor,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        billboard: {
            image: launchLabel.image,
            width: launchLabel.width,
            height: launchLabel.height,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    });
    track.entities.push(launchMarker);
    track.launchMarker = launchMarker;
    const impactLabel = createTacticalStrikeLabel(event.impact_label || event.location_label || "Impact", cssVar("--warzone-missile-impact-color", "#ff2a2a"));
    const impactMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(impactLon, impactLat, numberVar("--warzone-impact-marker-height", 4000)),
        point: {
            pixelSize: 7,
            color: impactColor.withAlpha(0.98),
            outlineColor: Cesium.Color.WHITE.withAlpha(0.2),
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        billboard: {
            image: impactLabel.image,
            width: impactLabel.width,
            height: impactLabel.height,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -16),
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
    if (viewer.__warzoneAlertPulseFrame) {
        try { cancelAnimationFrame(viewer.__warzoneAlertPulseFrame); } catch { }
        viewer.__warzoneAlertPulseFrame = null;
    }
    if (viewer.__warzoneAlertCleanupTimer) {
        clearTimeout(viewer.__warzoneAlertCleanupTimer);
        viewer.__warzoneAlertCleanupTimer = null;
    }
    if (viewer.__warzoneAlertEntities) {
        viewer.__warzoneAlertEntities.forEach((e) => {
            try { viewer.entities.remove(e); } catch { }
        });
        viewer.__warzoneAlertEntities = null;
    }
    if (viewer.__warzoneAlertEntity) {
        try { viewer.entities.remove(viewer.__warzoneAlertEntity); } catch { }
        viewer.__warzoneAlertEntity = null;
    }
}
function highlightAlertRegion(viewer, event) {
    clearAlertHighlight(viewer);
    if (!event || !Number.isFinite(Number(event.lat)) || !Number.isFinite(Number(event.lon))) return;
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    const severity = String(event.severity || "high").toLowerCase();
    const baseRadius = severity === "critical" ? 180000 : severity === "high" ? 140000 : 100000;
    const pulseDurationMs = Math.max(280, numberVar("--warzone-highlight-pulse-speed", 700));
    const highlightDurationMs = Math.max(1000, numberVar("--warzone-highlight-duration", 14000));
    const entities = [];
    const fill = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 2000),
        ellipse: {
            semiMinorAxis: baseRadius,
            semiMajorAxis: baseRadius,
            material: Cesium.Color.fromCssColorString("#fd3741").withAlpha(0.15),
            outline: false,
            height: 2000,
        },
    });
    entities.push(fill);
    const outerRing = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 3000),
        ellipse: {
            semiMinorAxis: baseRadius * 1.45,
            semiMajorAxis: baseRadius * 1.45,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#fd3741").withAlpha(0.7),
            outlineWidth: 5,
            height: 3000,
        },
    });
    entities.push(outerRing);
    const innerRing = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 4000),
        ellipse: {
            semiMinorAxis: baseRadius * 0.56,
            semiMajorAxis: baseRadius * 0.56,
            material: Cesium.Color.TRANSPARENT,
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#fd3741").withAlpha(0.9),
            outlineWidth: 5,
            height: 4000,
        },
    });
    entities.push(innerRing);
    viewer.__warzoneAlertEntities = entities;
    viewer.__warzoneAlertEntity = entities[0];
    const alertColor = Cesium.Color.fromCssColorString("#fd3741");
    const tick = () => {
        if (!viewer.__warzoneAlertEntities?.length) return;
        const pulse = 0.5 + 0.5 * Math.sin((performance.now() / pulseDurationMs) * Math.PI * 2);
        if (fill?.ellipse) {
            const r = baseRadius * (0.92 + pulse * 0.16);
            fill.ellipse.semiMinorAxis = r;
            fill.ellipse.semiMajorAxis = r;
            fill.ellipse.material = alertColor.withAlpha(0.06 + pulse * 0.14);
        }
        if (outerRing?.ellipse) {
            const r = baseRadius * (1.18 + pulse * 0.40);
            outerRing.ellipse.semiMinorAxis = r;
            outerRing.ellipse.semiMajorAxis = r;
            outerRing.ellipse.outlineColor = alertColor.withAlpha(0.28 + pulse * 0.54);
        }
        if (innerRing?.ellipse) {
            const r = baseRadius * (0.36 + pulse * 0.28);
            innerRing.ellipse.semiMinorAxis = r;
            innerRing.ellipse.semiMajorAxis = r;
            innerRing.ellipse.outlineColor = alertColor.withAlpha(0.24 + pulse * 0.62);
        }
        viewer.scene.requestRender();
        viewer.__warzoneAlertPulseFrame = requestAnimationFrame(tick);
    };
    viewer.__warzoneAlertPulseFrame = requestAnimationFrame(tick);
    viewer.scene.requestRender();
    viewer.__warzoneAlertCleanupTimer = setTimeout(() => {
        clearAlertHighlight(viewer);
        viewer.scene.requestRender();
    }, highlightDurationMs);
}
function labelCesiumCredits(creditsEl) {
    if (!creditsEl || typeof MutationObserver === "undefined") return;
    const applyLabels = () => {
        creditsEl.setAttribute("aria-label", "Map imagery credits");
        creditsEl.querySelectorAll("img").forEach((img) => {
            if (!img.hasAttribute("alt")) {
                img.setAttribute("alt", "Map provider credit");
            }
        });
        creditsEl.querySelectorAll("a").forEach((link) => {
            if (!link.getAttribute("aria-label")) {
                const imgAlt = link.querySelector("img")?.getAttribute("alt");
                const label = imgAlt || link.textContent?.trim() || "Map imagery credit";
                link.setAttribute("aria-label", label);
            }
        });
    };
    applyLabels();
    const observer = new MutationObserver(applyLabels);
    observer.observe(creditsEl, { childList: true, subtree: true });
}
export async function initWarzoneGlobe() {
    const globeEl = document.getElementById("warzone-globe");
    const creditsEl = document.getElementById("warzone-map-credits");
    if (!globeEl) return null;
    const cesiumCreditsEl = getCesiumCreditContainer(globeEl);
    const isReportCaptureMode = window.__stratopsReportCaptureMode === true;
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
        scene3DOnly: false,
        mapMode2D: Cesium.MapMode2D.ROTATE,
        mapProjection: new Cesium.WebMercatorProjection(Cesium.Ellipsoid.WGS84),
        requestRenderMode: true,
        contextOptions: {
            webgl: {
                antialias: true,
                powerPreference: "high-performance",
                preserveDrawingBuffer: isReportCaptureMode,
            },
        },
        skyAtmosphere: false,
        terrain: undefined,
        creditContainer: cesiumCreditsEl || creditsEl || undefined,
        imageryProvider: false,
    });
    labelCesiumCredits(cesiumCreditsEl);
    updateMapCredits();
    viewer.__terrainVisible = true;
    viewer.__raisedRegionVisible = false;
    viewer.__raisedRegionLoaded = false;
    viewer.__raisedRegionLoadPromise = null;
    viewer.__raisedRegionDataSource = null;
    viewer.__warzoneSceneMode = getSceneMode(viewer);
    viewer.__warzoneAdaptiveProfile = "normal";
    viewer.__warzoneSuppressEventMarkers = false;
    viewer.__warzoneEntryMapImageryVisible = numberVar("--wz-entry-show-map-imagery", 1) !== 0;
    viewer.__borderLayersVisible = false;
    viewer.__borderVisibilityAlpha = 0;
    viewer.__borderLayersLoaded = false;
    viewer.__borderLayerLoadPromise = null;
    viewer.__borderEntities = [];
    viewer.__warzoneFlatTerrainProvider = viewer.terrainProvider;
    viewer.__warzoneFocusedTerrainActive = false;
    applyViewerStyle(viewer);
    setInitialCamera(viewer);
    if (!isReportCaptureMode) {
        startStartupGlobeRotation(viewer);
    }
    attachCameraZoomLimiter(viewer);
    attach2DCameraBoundsGuard(viewer);
    syncSceneModeBounds(viewer);
    ensureMissileStore(viewer);
    ensureAudioStore(viewer);
    attachEventLodController(viewer);
    attachLabelsZoomController(viewer);
    bindEventMarkerPicking(viewer);
    viewer.scene.requestRender();
    viewer.__warzoneImageryReadyPromise = setEntryMapImageryVisible(
        viewer,
        viewer.__warzoneEntryMapImageryVisible !== false
    );
    viewer.__warzoneMapLabelsVisible = boolVar("--warzone-country-labels-enabled", false)
        || boolVar("--warzone-places-layer-enabled", false);
    if (viewer.__warzoneMapLabelsVisible) {
        addCountryNameLabels(viewer)
            .then(() => {
                viewer.scene.requestRender();
            })
            .catch(() => { });
        addPlaceNameLabels(viewer);
    }
    viewer.__warzone = {
        addEvent(event) {
            const prepared = prepareEventsForCurrentZoom(viewer, [event])[0];
            if (!prepared) return null;
            const entity = addEventEntity(viewer, prepared);
            applyEventLod(viewer);
            viewer.scene.requestRender();
            return entity;
        },
        addEvents(events = []) {
            viewer.__warzoneLastSourceEvents = Array.isArray(events) ? events.slice() : [];
            viewer.__warzoneLastClusterBucket = getEventClusterZoomBucket(viewer);
            const prepared = applyEventClusterTransitions(viewer, prepareEventsForCurrentZoom(viewer, events));
            const ringEntityCap = Math.max(40, Math.round(numberVar("--warzone-event-ring-entity-cap", 160)));
            const shouldDisableRingsForBatch = prepared.length > ringEntityCap;
            reconcileEventEntities(viewer, prepared, {
                disableEllipse: shouldDisableRingsForBatch,
                disableOutline: shouldDisableRingsForBatch,
                suppressMarkers: viewer.__warzoneSuppressEventMarkers === true,
            });
            viewer.__warzoneLastPreparedEvents = prepared.map((event) => ({
                id: event.id,
                cluster_id: event.cluster_id || event.id,
                event_ids: Array.isArray(event.event_ids) ? event.event_ids.slice() : [event.id],
                lat: event.lat,
                lon: event.lon,
                category: event.category,
                severity: event.severity,
                dominant_domain: event.dominant_domain || event._dominantDomain || classifyEventDomain(event),
                domain_distribution: event.domain_distribution ? { ...event.domain_distribution } : null,
                weighted_activity_score: Number(event.weighted_activity_score || event._activityScore || 0),
                actual_event_count: Number(event.actual_event_count || event.cluster_count || event._clusterCount || 1),
                cluster_count: event.cluster_count,
                _clusterCount: event._clusterCount,
                center_method: event.center_method || (Number(event.cluster_count || 1) > 1 ? "weighted_medoid" : "event_coordinate"),
                centroid: event.centroid ? { ...event.centroid } : { lat: event.lat, lon: event.lon },
                bounds: event.bounds ? { ...event.bounds } : {
                    south: event.lat,
                    north: event.lat,
                    west: event.lon,
                    east: event.lon,
                    crosses_antimeridian: false,
                },
                latest_event_time: event.latest_event_time || event.occurred_at || null,
                _splitGroupId: event._splitGroupId || "",
                _isClusterParentRing: event._isClusterParentRing === true,
                _parentRingRadius: event._parentRingRadius || 0,
            }));
            viewer.scene?.requestRender?.();
        },
        refreshEventMarkerVisuals() {
            clearEventMarkerVisualCaches();
            if (Array.isArray(viewer.__warzoneLastSourceEvents) && viewer.__warzoneLastSourceEvents.length) {
                this.addEvents(viewer.__warzoneLastSourceEvents);
            } else {
                applyEventLod(viewer);
                viewer.scene?.requestRender?.();
            }
        },
        setEventMarkersSuppressed(suppressed) {
            const next = !!suppressed;
            if (viewer.__warzoneSuppressEventMarkers === next) return;
            viewer.__warzoneSuppressEventMarkers = next;
            applyEventLod(viewer);
            viewer.scene.requestRender?.();
        },
        clearEventEntities() {
            clearTrackedEventEntities(viewer);
        },
        setEventLayerVisible(layerId, visible) {
            setTrackedEventLayerVisible(viewer, layerId, visible);
        },
        setSatelliteImageryLayerVisible(visible) {
            return setSatelliteImageryLayerVisible(viewer, visible);
        },
        isSatelliteImageryLayerVisible() {
            return viewer.__warzoneSatelliteImageryLayerVisible !== false;
        },
        setMapLabelsLayerVisible(visible) {
            return setMapLabelsLayerVisible(viewer, visible);
        },
        isMapLabelsLayerVisible() {
            return viewer.__warzoneMapLabelsVisible === true;
        },
        removeEvent(eventId) {
            removeExistingEventEntity(viewer, eventId);
            viewer.scene.requestRender();
        },
        focusRegion,
        getViewportBounds() {
            const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
            if (!rect) return null;
            const west = Cesium.Math.toDegrees(rect.west);
            const south = Cesium.Math.toDegrees(rect.south);
            const east = Cesium.Math.toDegrees(rect.east);
            const north = Cesium.Math.toDegrees(rect.north);
            return {
                minLon: west,
                minLat: south,
                maxLon: east,
                maxLat: north
            };
        },
        refocusMiddleEast() {
            const cam = getStartCameraConfig();
            focusRegion(viewer, cam.lon, cam.lat, numberVar("--warzone-focus-height", 2350000));
        },
        setMapMode(mode) {
            setMapMode(viewer, mode);
        },
        setSceneMode(mode, options = {}) {
            return setSceneMode(viewer, mode, options);
        },
        stopStartupRotation() {
            stopStartupGlobeRotation(viewer);
        },
        startStartupRotation() {
            startStartupGlobeRotation(viewer);
        },
        getSceneMode() {
            return getSceneMode(viewer);
        },
        getEventClusterBucket() {
            return getEventClusterZoomBucket(viewer);
        },
        getEventClusterSnapshot() {
            const camera = viewer.camera?.positionCartographic;
            const zoomState = getEventZoomState(viewer);
            const zoomBucket = getClusterBucketForZoomState(zoomState, getEventClusterZoomBucket(viewer));
            return {
                version: "phase6-pre-reporting-v1",
                captured_at: new Date().toISOString(),
                zoom_state: zoomState,
                zoom_bucket: zoomBucket,
                camera: camera ? {
                    longitude: Cesium.Math.toDegrees(camera.longitude),
                    latitude: Cesium.Math.toDegrees(camera.latitude),
                    height: Number(camera.height || 0),
                    heading: Number(viewer.camera.heading || 0),
                    pitch: Number(viewer.camera.pitch || 0),
                    roll: Number(viewer.camera.roll || 0),
                } : null,
                clusters: (viewer.__warzoneLastPreparedEvents || []).map((cluster) => ({
                    ...cluster,
                    event_ids: Array.isArray(cluster.event_ids) ? cluster.event_ids.slice() : [],
                    centroid: cluster.centroid ? { ...cluster.centroid } : null,
                    bounds: cluster.bounds ? { ...cluster.bounds } : null,
                    domain_distribution: cluster.domain_distribution ? { ...cluster.domain_distribution } : null,
                })),
            };
        },
        refreshMapTuning() {
            if (viewer.__imageryBase) {
                tuneImageryLayer(viewer.__imageryBase, "--warzone-map");
            }
            if (viewer.__imageryLabels) {
                tuneImageryLayer(viewer.__imageryLabels, "--warzone-labels");
            }
            void buildContourOverlay(viewer, {
                force: true,
                reason: "refresh-map-tuning",
            });
            applyContourLayerState(viewer);
            updateLabelsLayerVisibility(viewer);
            applyMapColorMixer(viewer, "--warzone-map");
            viewer.scene.requestRender();
        },
        setEntryMapImageryVisible(visible) {
            return setEntryMapImageryVisible(viewer, visible);
        },
        isEntryMapImageryVisible() {
            return viewer.__warzoneEntryMapImageryVisible !== false && !!viewer.__imageryBase;
        },
        setTerrainVisible(visible) {
            const show = !!visible;
            viewer.__terrainVisible = show;
            applyRenderedTerrainVisibility(viewer);
            applyContourLayerState(viewer);
            updateLabelsLayerVisibility(viewer);
            viewer.scene.requestRender();
        },
        isTerrainVisible() {
            return !!(
                viewer.__imageryBase &&
                viewer.__imageryBase.show
            );
        },
        setSatelliteVisible(visible) {
            viewer.__satelliteVisible = !!visible;
            applyRenderedTerrainVisibility(viewer);
            viewer.scene?.requestRender?.();
            return viewer.__satelliteVisible === true;
        },
        isSatelliteVisible() {
            return viewer.__satelliteVisible !== false && viewer.__imageryBase?.show !== false;
        },
        setGreyedSatelliteVisible(visible) {
            viewer.__warzoneGreyedSatelliteVisible = !!visible;
            applyRenderedTerrainVisibility(viewer);
            viewer.scene?.requestRender?.();
            return viewer.__warzoneGreyedSatelliteVisible === true;
        },
        isGreyedSatelliteVisible() {
            return viewer.__warzoneGreyedSatelliteVisible === true;
        },
        enterCtrMode(options = {}) {
            return enterCtrMode(viewer, options);
        },
        exitCtrMode(options = {}) {
            return exitCtrMode(viewer, options);
        },
        isCtrModeActive() {
            return viewer.__warzoneCtrModeActive === true;
        },
        setContourGridVisible(visible) {
            return setContourGridLayerVisible(viewer, visible);
        },
        isContourGridVisible() {
            return viewer.__contourGridLayerVisible === true;
        },
        setContourGridCenter(position) {
            return setContourGridCenter(viewer, position);
        },
        enableFocusedTerrain() {
            return enableFocusedTerrain(viewer);
        },
        disableFocusedTerrain() {
            return disableFocusedTerrain(viewer);
        },
        isFocusedTerrainActive() {
            return viewer.__warzoneFocusedTerrainActive === true;
        },
        setContourLayerVisible(visible) {
            return setContourLayerVisible(viewer, visible);
        },
        restoreDefaultMapRender() {
            return restoreDefaultRenderedMap(viewer);
        },
        toggleContourLayer() {
            return setContourLayerVisible(viewer, viewer.__contourLayerVisible !== true);
        },
        isContourLayerVisible() {
            return viewer.__contourLayerVisible === true;
        },
        setContourFocusPosition(position, options = {}) {
            return setContourFocusPosition(viewer, position, options);
        },
        refreshContourFromViewport(options = {}) {
            return refreshContourFromViewport(viewer, options);
        },
        clearContourFocusPosition() {
            clearContourFocusPosition(viewer);
        },
        setRaisedRegionVisible(visible, region = null) {
            applyRaisedRegionVisibility(viewer, visible, region);
        },
        isRaisedRegionVisible() {
            return viewer.__raisedRegionVisible === true;
        },
        setBorderLayersVisible(visible, options = {}) {
            const result = setBorderLayersVisible(viewer, visible, options);
            viewer.scene.requestRender();
            return result;
        },
        isBorderLayersVisible() {
            return viewer.__borderLayersVisible !== false;
        },
        setAdaptiveQualityProfile(profile = "normal") {
            const normalized = normalizeAdaptiveProfile(profile);
            viewer.__warzoneAdaptiveProfile = normalized;
            const count = Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0));
            this.setPerformanceMode(count);
            viewer.scene.requestRender?.();
            return normalized;
        },
        getAdaptiveQualityProfile() {
            return normalizeAdaptiveProfile(viewer.__warzoneAdaptiveProfile);
        },
        setPerformanceMode(visibleCount = 0) {
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
            const count = Math.max(0, Number(visibleCount || 0));
            const adaptiveProfile = normalizeAdaptiveProfile(viewer.__warzoneAdaptiveProfile);
            const noLayerMode = count <= 0;
            const adaptiveCaps = getAdaptiveProfileCaps(noLayerMode ? "normal" : adaptiveProfile);
            const hardMaxResolutionScale = clamp(numberVar("--warzone-resolution-hard-max", 1.22), 0.7, 1.4);
            const hardMaxMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-msaa-hard-max", 2)));
            const baseResolution = clamp(numberVar("--warzone-resolution-scale", 1), 0.5, 2);
            const baseMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-msaa-samples", 1)));
            const baseFxaaEnabled = boolVar("--warzone-fxaa-enabled", true);
            const idleResolutionMin = clamp(numberVar("--warzone-idle-resolution-min", 1), 0.8, 2);
            const idleMsaaMin = Math.max(1, Math.round(numberVar("--warzone-idle-msaa-min", 2)));
            const movingResolutionFloor = clamp(numberVar("--warzone-moving-resolution-scale", 0.9), 0.68, 2);
            const movingMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-moving-msaa-samples", 1)));
            const baseTileCache = Math.max(
                220,
                Math.min(1200, Math.round(numberVar("--warzone-globe-tile-cache-size", 900)))
            );
            const loadingTileCache = Math.max(
                140,
                Math.min(baseTileCache, Math.round(numberVar("--warzone-globe-tile-cache-loading", Math.max(180, baseTileCache * 0.52))))
            );
            const movingTileCache = Math.max(
                180,
                Math.min(baseTileCache, Math.round(numberVar("--warzone-globe-tile-cache-moving", Math.max(220, baseTileCache * 0.66))))
            );
            const heavyTileCache = Math.max(
                140,
                Math.min(baseTileCache, Math.round(numberVar("--warzone-globe-tile-cache-heavy", Math.max(180, baseTileCache * 0.52))))
            );
            const baseLoadingDescendantLimit = Math.max(
                6,
                Math.min(72, Math.round(numberVar("--warzone-globe-loading-descendant-limit", 48)))
            );
            const busyLoadingDescendantLimit = Math.max(
                4,
                Math.min(baseLoadingDescendantLimit, Math.round(numberVar("--warzone-globe-loading-descendant-limit-busy", 10)))
            );
            const loadingQueueThreshold = Math.max(
                1,
                Math.round(numberVar("--warzone-globe-loading-queue-threshold", 8))
            );
            const basePreloadSiblings = boolVar("--warzone-globe-preload-siblings", false);
            const cameraHeight = getCameraHeight(viewer);
            const is2DMode = getSceneMode(viewer) === "2d";
            const isCameraMoving = viewer.__warzoneCameraMoving === true;
            const tileLoadQueueSize = Math.max(0, Number(viewer.__warzoneTileLoadQueueSize || 0));
            const tileLoadBusy = tileLoadQueueSize >= loadingQueueThreshold || viewer.__warzoneTileLoadBusy === true;
            const liveSelection = window.__warzoneLiveTrackSelection || {};
            const focusDiagnostics = window.__warzoneFocusDiagnostics || {};
            const isAircraftFocusMode = String(liveSelection.mode || "") === "focus" && Boolean(liveSelection.trackKey);
            const isFocusedAssetMode =
                (focusDiagnostics.state === "active" || focusDiagnostics.state === "temporarily_suspended")
                && Boolean(String(focusDiagnostics.assetId || "").trim());
            const focusedAssetCaps = getFocusedAssetPerformanceCaps(adaptiveProfile);
            const focusSharpHeight = Math.max(30000, numberVar("--warzone-focus-sharp-height", 120000));
            const closeSharpHeight = Math.max(focusSharpHeight, numberVar("--warzone-close-sharp-height", 450000));
            const nearSharpHeight = Math.max(250000, numberVar("--warzone-near-sharp-height", 1800000));
            const focusResolutionScale = clamp(numberVar("--warzone-focus-resolution-scale", 1.16), 0.8, 2);
            const closeResolutionScale = clamp(numberVar("--warzone-close-resolution-scale", 1.08), 0.8, 2);
            const focusMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-focus-msaa-samples", 2)));
            const closeMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-close-msaa-samples", 2)));
            const focusPerformanceResolutionScale = clamp(numberVar("--warzone-focus-performance-resolution-scale", 0.72), 0.5, hardMaxResolutionScale);
            const focusPerformanceMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-focus-performance-msaa-samples", 1)));
            const focusPerformanceSse = clamp(numberVar("--warzone-focus-performance-screen-space-error", 3.4), 1.8, 6);
            const focusPerformanceTileCache = Math.max(96, Math.round(numberVar("--warzone-focus-performance-tile-cache", 160)));
            const focusPerformanceRenderTime = clamp(numberVar("--warzone-focus-performance-render-time", 0.18), 0.12, 0.8);
            const baseSse = clamp(numberVar("--warzone-globe-max-screen-space-error", 1.4), 0.9, 4.5);
            const closeSse = clamp(numberVar("--warzone-globe-close-screen-space-error", 1.15), 0.8, 2.5);
            const movingSse = clamp(numberVar("--warzone-globe-moving-screen-space-error", Math.max(baseSse * 1.45, 1.9)), 1.2, 6);
            let nextResolution = baseResolution;
            let nextMaximumRenderTime = Infinity;
            let nextMsaaSamples = baseMsaaSamples;
            let nextFxaaEnabled = baseFxaaEnabled;
            let nextSse = baseSse;
            let nextTileCache = baseTileCache;
            let nextLoadingDescendantLimit = baseLoadingDescendantLimit;
            let nextPreloadSiblings = basePreloadSiblings;
            if (count > 0) {
                if (count <= 60) {
                    nextMaximumRenderTime = 1.25;
                } else if (count <= 140) {
                    nextMaximumRenderTime = 0.95;
                    nextResolution = Math.max(0.88, baseResolution * 0.9);
                    nextMsaaSamples = 1;
                } else if (count <= 260) {
                    nextMaximumRenderTime = 0.78;
                    nextResolution = Math.max(0.8, baseResolution * 0.84);
                    nextMsaaSamples = 1;
                } else {
                    nextMaximumRenderTime = 0.58;
                    nextResolution = Math.max(0.74, baseResolution * 0.76);
                    nextMsaaSamples = 1;
                    nextFxaaEnabled = baseFxaaEnabled;
                    nextSse = Math.max(nextSse, Math.max(1.7, baseSse));
                }
            }
            if (count > 320) {
                nextTileCache = Math.min(nextTileCache, heavyTileCache);
                nextPreloadSiblings = false;
            } else if (count > 160) {
                nextTileCache = Math.min(nextTileCache, movingTileCache);
                nextPreloadSiblings = false;
            }
            // Keep icon edges readable when camera is settled.
            if (!isCameraMoving) {
                nextResolution = Math.max(nextResolution, Math.max(baseResolution, idleResolutionMin));
                nextMsaaSamples = Math.max(nextMsaaSamples, baseMsaaSamples, idleMsaaMin);
            }
            // Focus zoom: prioritize clarity around very-close tracking views.
            if (cameraHeight <= focusSharpHeight) {
                nextResolution = Math.max(nextResolution, Math.max(baseResolution, focusResolutionScale));
                nextMsaaSamples = Math.max(nextMsaaSamples, focusMsaaSamples);
                nextFxaaEnabled = baseFxaaEnabled;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, 0.24);
                nextSse = Math.min(nextSse, Math.min(baseSse, closeSse));
            } else if (cameraHeight <= closeSharpHeight) {
                // Close zoom (~30k-40k and nearby): keep map very clear without heavy overdraw.
                nextResolution = Math.max(nextResolution, Math.max(baseResolution, closeResolutionScale));
                nextMsaaSamples = Math.max(nextMsaaSamples, closeMsaaSamples);
                nextFxaaEnabled = baseFxaaEnabled;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, 0.36);
                nextSse = Math.min(nextSse, Math.min(baseSse, closeSse));
            } else if (cameraHeight <= nearSharpHeight) {
                // General near-zoom floor for readability.
                nextResolution = Math.max(1, baseResolution);
                nextMsaaSamples = Math.max(1, Math.min(2, baseMsaaSamples));
                nextFxaaEnabled = baseFxaaEnabled;
                nextSse = Math.min(nextSse, Math.max(1.25, baseSse));
            }
            if (isCameraMoving) {
                // While camera is moving, keep interaction responsive by easing quality cost.
                nextResolution = Math.max(
                    movingResolutionFloor,
                    Math.min(nextResolution, Math.max(movingResolutionFloor, baseResolution * 0.88))
                );
                nextMsaaSamples = Math.max(1, Math.min(nextMsaaSamples, movingMsaaSamples));
                nextFxaaEnabled = baseFxaaEnabled;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, 0.5);
                nextSse = Math.max(nextSse, movingSse);
                nextTileCache = Math.min(nextTileCache, movingTileCache);
                nextPreloadSiblings = false;
            }
            if (tileLoadBusy && !is2DMode) {
                nextResolution = Math.min(
                    nextResolution,
                    clamp(numberVar("--warzone-globe-loading-resolution-scale", 1.05), 0.5, 1.25)
                );
                nextMsaaSamples = Math.max(1, Math.round(numberVar("--warzone-globe-loading-msaa-samples", 2)));
                nextFxaaEnabled = true;
                nextSse = Math.max(
                    nextSse,
                    clamp(numberVar("--warzone-globe-loading-screen-space-error", 3.1), 1.4, 6)
                );
                nextTileCache = Math.min(nextTileCache, loadingTileCache);
                nextLoadingDescendantLimit = Math.min(nextLoadingDescendantLimit, busyLoadingDescendantLimit);
                nextPreloadSiblings = false;
            }
            const focusSceneSettled = isFocusedAssetMode && !isCameraMoving && !tileLoadBusy;
            if (isFocusedAssetMode) {
                if (focusSceneSettled) {
                    nextResolution = Math.max(nextResolution, focusPerformanceResolutionScale);
                    nextMsaaSamples = Math.max(nextMsaaSamples, focusPerformanceMsaaSamples);
                    nextSse = Math.min(nextSse, focusPerformanceSse);
                } else {
                    // Keep the focused GLB readable while camera motion or tile loading is active.
                    nextResolution = Math.max(nextResolution, Math.min(baseResolution, 1));
                    nextMsaaSamples = Math.max(nextMsaaSamples, Math.min(2, focusMsaaSamples));
                }
                nextFxaaEnabled = true;
                nextMaximumRenderTime = Math.min(nextMaximumRenderTime, focusPerformanceRenderTime, focusedAssetCaps.maxRenderTime);
                nextTileCache = Math.min(nextTileCache, focusPerformanceTileCache, focusedAssetCaps.tileCacheCap);
                if (tileLoadBusy) {
                    nextLoadingDescendantLimit = Math.min(nextLoadingDescendantLimit, Math.max(4, busyLoadingDescendantLimit - 2));
                }
                nextPreloadSiblings = false;
            }
            if (adaptiveCaps.forceFxaaEnabled) {
                nextFxaaEnabled = true;
            }
            nextResolution = Math.min(nextResolution, adaptiveCaps.maxResolutionScale);
            nextMsaaSamples = Math.min(nextMsaaSamples, adaptiveCaps.maxMsaaSamples);
            nextSse = Math.max(nextSse, adaptiveCaps.minSse);
            nextTileCache = Math.min(nextTileCache, adaptiveCaps.maxTileCache);
            if (adaptiveCaps.forcePreloadSiblingsFalse) {
                nextPreloadSiblings = false;
            }
            if (isFocusedAssetMode) {
                nextResolution = Math.min(nextResolution, focusedAssetCaps.resolutionCap);
                nextMsaaSamples = Math.min(nextMsaaSamples, focusedAssetCaps.msaaCap);
                nextSse = Math.max(nextSse, focusedAssetCaps.sseFloor);
                nextTileCache = Math.min(nextTileCache, focusedAssetCaps.tileCacheCap);
            }
            nextResolution = Math.min(nextResolution, hardMaxResolutionScale);
            nextMsaaSamples = Math.min(nextMsaaSamples, hardMaxMsaaSamples);
            nextSse = clamp(nextSse, 0.8, 6);
            nextTileCache = Math.max(140, Math.min(720, Math.round(nextTileCache)));
            nextLoadingDescendantLimit = Math.max(4, Math.min(72, Math.round(nextLoadingDescendantLimit)));
            if (is2DMode) {
                // Keep 2D map luminance stable: avoid adaptive quality oscillation that can look like
                // dark/light pumping while tiles stream and counters update.
                nextResolution = baseResolution;
                nextMaximumRenderTime = Infinity;
                nextMsaaSamples = baseMsaaSamples;
                nextFxaaEnabled = baseFxaaEnabled;
                nextSse = baseSse;
                nextTileCache = baseTileCache;
                nextLoadingDescendantLimit = baseLoadingDescendantLimit;
                nextPreloadSiblings = basePreloadSiblings;
            }
            const prevPerfState = viewer.__warzonePerformanceState || {};
            if (prevPerfState.resolutionScale !== nextResolution) {
                viewer.resolutionScale = nextResolution;
            }
            if (prevPerfState.maximumRenderTimeChange !== nextMaximumRenderTime) {
                viewer.scene.maximumRenderTimeChange = nextMaximumRenderTime;
            }
            if (prevPerfState.maximumScreenSpaceError !== nextSse) {
                viewer.scene.globe.maximumScreenSpaceError = nextSse;
            }
            if (Number.isFinite(nextMsaaSamples) && prevPerfState.msaaSamples !== nextMsaaSamples) {
                viewer.scene.msaaSamples = nextMsaaSamples;
            }
            if (viewer.scene.postProcessStages?.fxaa && prevPerfState.fxaaEnabled !== nextFxaaEnabled) {
                viewer.scene.postProcessStages.fxaa.enabled = nextFxaaEnabled;
            }
            if (prevPerfState.tileCacheSize !== nextTileCache) {
                viewer.scene.globe.tileCacheSize = nextTileCache;
            }
            if (prevPerfState.loadingDescendantLimit !== nextLoadingDescendantLimit) {
                viewer.scene.globe.loadingDescendantLimit = nextLoadingDescendantLimit;
            }
            if (prevPerfState.preloadSiblings !== nextPreloadSiblings) {
                viewer.scene.globe.preloadSiblings = nextPreloadSiblings;
            }
            viewer.__warzonePerformanceState = {
                resolutionScale: nextResolution,
                maximumRenderTimeChange: nextMaximumRenderTime,
                maximumScreenSpaceError: nextSse,
                msaaSamples: nextMsaaSamples,
                fxaaEnabled: nextFxaaEnabled,
                tileCacheSize: nextTileCache,
                loadingDescendantLimit: nextLoadingDescendantLimit,
                preloadSiblings: nextPreloadSiblings,
                visibleCount: count,
                cameraHeight,
                isCameraMoving,
                isAircraftFocusMode,
                isFocusedAssetMode,
                tileLoadQueueSize,
                tileLoadBusy,
                adaptiveProfile,
            };
            viewer.scene.requestRenderMode = true;
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
    if (typeof window !== "undefined") {
        window.__warzone = viewer.__warzone;
    }
    if (!viewer.__warzonePerfZoomBound) {
        viewer.__warzonePerfZoomBound = true;
        let perfRaf = 0;
        let moveSettleTimer = 0;
        const queuePerfSync = () => {
            if (perfRaf) return;
            perfRaf = requestAnimationFrame(() => {
                perfRaf = 0;
                const count = Math.max(0, Number(viewer.__warzonePerformanceState?.visibleCount || 0));
                viewer.__warzone?.setPerformanceMode?.(count);
                viewer.scene.requestRender?.();
            });
        };
        viewer.camera.moveStart.addEventListener(() => {
            clearTimeout(moveSettleTimer);
            viewer.__warzoneCameraMoving = true;
            queuePerfSync();
        });
        viewer.camera.moveEnd.addEventListener(queuePerfSync);
        viewer.camera.moveEnd.addEventListener(() => {
            clearTimeout(moveSettleTimer);
            moveSettleTimer = window.setTimeout(() => {
                viewer.__warzoneCameraMoving = false;
                queuePerfSync();
            }, 360);
        });
        if (viewer.scene?.globe?.tileLoadProgressEvent?.addEventListener) {
            let tileLoadSettleTimer = 0;
            viewer.scene.globe.tileLoadProgressEvent.addEventListener((queueLength = 0) => {
                const nextQueueSize = Math.max(0, Number(queueLength || 0));
                viewer.__warzoneTileLoadQueueSize = nextQueueSize;
                const busy = nextQueueSize > 0;
                if (busy) {
                    if (tileLoadSettleTimer) {
                        window.clearTimeout(tileLoadSettleTimer);
                        tileLoadSettleTimer = 0;
                    }
                    if (viewer.__warzoneTileLoadBusy !== true) {
                        viewer.__warzoneTileLoadBusy = true;
                        queuePerfSync();
                    }
                    return;
                }
                if (tileLoadSettleTimer) {
                    window.clearTimeout(tileLoadSettleTimer);
                }
                tileLoadSettleTimer = window.setTimeout(() => {
                    tileLoadSettleTimer = 0;
                    if (viewer.__warzoneTileLoadBusy !== false || viewer.__warzoneTileLoadQueueSize !== 0) {
                        viewer.__warzoneTileLoadBusy = false;
                        viewer.__warzoneTileLoadQueueSize = 0;
                        queuePerfSync();
                    }
                }, 520);
            });
        }
    }
    if (document?.fonts?.ready && !viewer.__warzoneEventMarkerFontsRefreshBound) {
        viewer.__warzoneEventMarkerFontsRefreshBound = true;
        document.fonts.ready
            .then(() => {
                viewer.__warzone?.refreshEventMarkerVisuals?.();
            })
            .catch(() => { });
    }
    applyEntrySceneLayerSwitches(viewer);
    bindContourViewportRefresh(viewer);
    return viewer;
}
