// File Path: /assets/js/warzone-ranges.js
import * as Cesium from "cesium";

let __rangeEntities = [];
const __rangeImageCache = new Map();
const RANGE_RENDER = {
    maxHeight: 9000000,
    maxCount: 1,
    maxOverlap: 0.2,
};

function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v || fallback).trim();
}

function cssColor(name, fallback) {
    return Cesium.Color.fromCssColorString(cssVar(name, fallback));
}

function cssNum(name, fallback) {
    const v = parseFloat(cssVar(name, fallback));
    return Number.isFinite(v) ? v : fallback;
}

const RANGE_PRESETS = {
    awacs: { radius: 400000, color: "--range-awacs-color", opacity: "--range-awacs-opacity" },
    fighter: { radius: 180000, color: "--range-fighter-color", opacity: "--range-fighter-opacity" },
    carrier: { radius: 600000, color: "--range-carrier-color", opacity: "--range-carrier-opacity" },
    destroyer: { radius: 120000, color: "--range-destroyer-color", opacity: "--range-destroyer-opacity" },
    sam: { radius: 250000, color: "--range-sam-color", opacity: "--range-sam-opacity" },
};

function getRangePreset(event) {
    const sub = String(
        event.subcategory ||
        event.subtype ||
        event.type ||
        ""
    ).toLowerCase();

    const weapon = String(event.weapon_type || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const text = `${sub} ${weapon} ${title}`;

    if (text.includes("awacs")) return RANGE_PRESETS.awacs;
    if (text.includes("fighter")) return RANGE_PRESETS.fighter;
    if (text.includes("carrier")) return RANGE_PRESETS.carrier;
    if (text.includes("destroyer") || text.includes("frigate")) return RANGE_PRESETS.destroyer;
    if (text.includes("sam") || text.includes("air defense")) return RANGE_PRESETS.sam;

    return null;
}

function getSoftRangeImage(colorCss, opacity) {
    const key = `${colorCss}|${opacity}`;
    if (__rangeImageCache.has(key)) return __rangeImageCache.get(key);

    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext("2d");
    const center = size / 2;
    const color = Cesium.Color.fromCssColorString(colorCss);

    const toRgba = (alpha) => {
        const a = Math.max(0, Math.min(1, alpha));
        return `rgba(${Math.round(color.red * 255)}, ${Math.round(color.green * 255)}, ${Math.round(color.blue * 255)}, ${a})`;
    };

    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0.00, toRgba(opacity * 0.10));
    gradient.addColorStop(0.55, toRgba(opacity * 0.10));
    gradient.addColorStop(0.82, toRgba(opacity * 0.07));
    gradient.addColorStop(0.94, toRgba(opacity * 0.02));
    gradient.addColorStop(1.00, toRgba(0));

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/png");
    __rangeImageCache.set(key, dataUrl);
    return dataUrl;
}
function getCameraHeight(viewer) {
    try {
        return Number(viewer?.camera?.positionCartographic?.height || 0);
    } catch {
        return 0;
    }
}
function shouldRenderRanges(viewer) {
    return getCameraHeight(viewer) <= RANGE_RENDER.maxHeight;
}
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = Cesium.Math.toRadians(lat2 - lat1);
    const dLon = Cesium.Math.toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(Cesium.Math.toRadians(lat1)) *
        Math.cos(Cesium.Math.toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function getCircleOverlapRatio(r1, r2, d) {
    if (d >= r1 + r2) return 0;
    const smaller = Math.min(r1, r2);
    if (d <= Math.abs(r1 - r2)) return 1;
    const r1Sq = r1 * r1;
    const r2Sq = r2 * r2;
    const alpha = 2 * Math.acos((d * d + r1Sq - r2Sq) / (2 * d * r1));
    const beta = 2 * Math.acos((d * d + r2Sq - r1Sq) / (2 * d * r2));
    const area1 = 0.5 * r1Sq * (alpha - Math.sin(alpha));
    const area2 = 0.5 * r2Sq * (beta - Math.sin(beta));
    const overlapArea = area1 + area2;
    const smallerArea = Math.PI * smaller * smaller;
    return overlapArea / smallerArea;
}
function getRangePriority(candidate) {
    const text = String(
        candidate?.event?.subcategory ||
        candidate?.event?.subtype ||
        candidate?.event?.title ||
        ""
    ).toLowerCase();
    if (text.includes("awacs")) return 6;
    if (text.includes("fighter")) return 5;
    if (text.includes("sam") || text.includes("air defense")) return 4;
    if (text.includes("carrier")) return 3;
    if (text.includes("destroyer") || text.includes("frigate")) return 2;
    return 1;
}
function getSpatialBucketKey(lat, lon, radiusMeters = 0) {
    const bucketDeg = Math.max(1.4, (radiusMeters / 111320) * 0.85);
    return `${Math.round(lat / bucketDeg)}:${Math.round(lon / bucketDeg)}`;
}
function selectRangeCandidates(events = []) {
    const candidates = events
        .map((event) => {
            const preset = getRangePreset(event);
            const lat = Number(event.lat);
            const lon = Number(event.lon);
            if (!preset || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            return { event, preset, lat, lon };
        })
        .filter(Boolean)
        .sort((a, b) => {
            const priorityDelta = getRangePriority(b) - getRangePriority(a);
            if (priorityDelta !== 0) return priorityDelta;
            return b.preset.radius - a.preset.radius;
        });
    const selected = [];
    const usedBuckets = new Set();
    for (const candidate of candidates) {
        const bucketKey = getSpatialBucketKey(candidate.lat, candidate.lon, candidate.preset.radius);
        if (usedBuckets.has(bucketKey)) {
            continue;
        }
        let shouldSkip = false;
        for (const existing of selected) {
            const distance = getDistanceMeters(candidate.lat, candidate.lon, existing.lat, existing.lon);
            const overlap = getCircleOverlapRatio(candidate.preset.radius, existing.preset.radius, distance);
            if (overlap > RANGE_RENDER.maxOverlap) {
                shouldSkip = true;
                break;
            }
        }
        if (!shouldSkip) {
            selected.push(candidate);
            usedBuckets.add(bucketKey);
        }
        if (selected.length >= RANGE_RENDER.maxCount) break;
    }
    return selected;
}

export function clearRanges(viewer) {
    if (viewer) {
        __rangeEntities.forEach((e) => {
            try {
                viewer.entities.remove(e);
            } catch {
                // ignore entity removal failures
            }
        });
    }
    __rangeEntities = [];
}

export function renderRanges(viewer, events) {
    clearRanges(viewer);
    if (!viewer || !Array.isArray(events) || !events.length) return;
    if (!shouldRenderRanges(viewer)) {
        viewer.scene?.requestRender?.();
        return;
    }

    const candidates = selectRangeCandidates(events);
    if (!candidates.length) {
        viewer.scene?.requestRender?.();
        return;
    }

    candidates.forEach(({ event, preset, lat, lon }) => {

        const colorCss = cssVar(preset.color, "#33d9ff");
        const baseColor = cssColor(preset.color, "#33d9ff");
        const opacity = Math.max(0.04, Math.min(cssNum(preset.opacity, 0.08), 0.18));
        const image = getSoftRangeImage(colorCss, opacity);

        const entity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            ellipse: {
                semiMajorAxis: preset.radius,
                semiMinorAxis: preset.radius,
                height: 0,
                material: new Cesium.ImageMaterialProperty({
                    image,
                    transparent: true,
                    color: Cesium.Color.WHITE.withAlpha(1),
                }),
                outline: false,
                outlineColor: baseColor.withAlpha(0),
                outlineWidth: 0,
                classificationType: Cesium.ClassificationType.BOTH,
            }
        });

        __rangeEntities.push(entity);
    });
}
