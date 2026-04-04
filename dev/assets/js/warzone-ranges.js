// File Path: /assets/js/warzone-ranges.js
import * as Cesium from "cesium";

let __rangeEntities = [];
const __rangeImageCache = new Map();

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
    gradient.addColorStop(0.00, toRgba(opacity * 0.00));
    gradient.addColorStop(0.22, toRgba(opacity * 0.10));
    gradient.addColorStop(0.48, toRgba(opacity * 0.30));
    gradient.addColorStop(0.68, toRgba(opacity * 0.55));
    gradient.addColorStop(0.82, toRgba(opacity * 0.34));
    gradient.addColorStop(0.92, toRgba(opacity * 0.14));
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

    events.forEach((event) => {
        const preset = getRangePreset(event);
        if (!preset) return;

        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

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
