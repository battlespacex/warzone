import * as Cesium from "cesium";

let __rangeEntities = [];

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

    if (text.includes("sam") || text.includes("air defense")) {
        return RANGE_PRESETS.sam;
    }

    return null;
}

export function clearRanges(viewer) {
    __rangeEntities.forEach(e => viewer.entities.remove(e));
    __rangeEntities = [];
}

export function renderRanges(viewer, events) {

    clearRanges(viewer);

    const outlineWidth = cssNum("--range-outline-width", 1.4);

    events.forEach(event => {

        const preset = getRangePreset(event);
        if (!preset) return;

        const lat = Number(event.lat);
        const lon = Number(event.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const baseColor = cssColor(preset.color, "#33d9ff");
        const opacity = cssNum(preset.opacity, 0.08);

        const entity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),

            ellipse: {
                semiMajorAxis: preset.radius,
                semiMinorAxis: preset.radius,
                height: 0,

                material: baseColor.withAlpha(opacity),

                outline: true,
                outlineColor: baseColor.withAlpha(0.7),
                outlineWidth: outlineWidth,
            }
        });

        __rangeEntities.push(entity);
    });
}