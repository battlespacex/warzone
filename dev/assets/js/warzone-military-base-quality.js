import { MILITARY_BASE_HOST_COUNTRY_OVERRIDES } from "./warzone-military-base-host-overrides.generated.js";

// Military base display-data quality guards.
// Imported datasets can contain owner/origin country fields. The UI country
// label represents the physical host country for the plotted coordinates.

const BASE_COUNTRY_OVERRIDES = Object.freeze({
    "mil_marshall-isl-svobodny-cosmodrome-25160": "Russia",
    "mil_australia-tilla-satellite-launch-center-30009": "Pakistan",
    "mil_australia-sonmiani-satellite-launch-center-89367": "Pakistan",
    "mil_argentina-palmachim-air-force-base-80692": "Israel",
    "mil_united-state-jingyu-25470": "China",
    "mil_soviet-union-el-arenosillo-50342": "Spain",
    "mil_south-korea-highdown-test-site-82329": "United Kingdom",
    "mil_indonesia-vik-47183": "Iceland",
});
const COORDINATE_CORRECTABLE_SOURCE_LAYERS = new Set([
    "rocket launch sites",
]);

const COUNTRY_ALIASES = Object.freeze({
    "biot": "British Indian Ocean Territory",
    "greenland ( denmark)": "Greenland",
    "greenland (denmark)": "Greenland",
    "guam (us)": "Guam",
    "nazi-occupied poland": "Poland",
    "soviet union/ kazakhstan": "Kazakhstan",
    "soviet union/kazakhstan": "Kazakhstan",
    "soviet union/ kazakhstan (operated by russia)": "Kazakhstan",
    "soviet union/kazakhstan (operated by russia)": "Kazakhstan",
    "soviet union/ russia": "Russia",
    "soviet union/russia": "Russia",
    "ukraine (occ)": "Ukraine",
    "uae": "UAE",
    "united arab emirates": "UAE",
});

const COUNTRY_RULES = Object.freeze([
    { country: "Bahrain", boxes: [[25.5, 50.2, 26.5, 50.9]] },
    { country: "Belgium", boxes: [[49.4, 2.5, 51.6, 6.5]] },
    { country: "Germany", boxes: [[47, 5, 56, 16]] },
    { country: "Denmark", boxes: [[54, 8, 58, 16]] },
    { country: "Djibouti", boxes: [[10, 41, 13, 44]] },
    { country: "Estonia", boxes: [[57, 21, 60, 29]] },
    { country: "French Guiana", boxes: [[2, -55.5, 6, -51]] },
    { country: "Guam", boxes: [[13.1, 144.5, 13.8, 145.1]] },
    { country: "Hungary", boxes: [[45, 16, 49, 23]] },
    { country: "Kuwait", boxes: [[28, 46, 31, 49]] },
    { country: "Latvia", boxes: [[55, 20, 59, 29]] },
    { country: "Lithuania", boxes: [[53, 20, 57, 27]] },
    { country: "Maldives", boxes: [[-1, 72, 8, 74]] },
    { country: "Netherlands", boxes: [[50, 3, 54, 8]] },
    { country: "Qatar", boxes: [[24, 50, 27, 52]] },
    { country: "Singapore", boxes: [[1, 103, 2, 104]] },
    { country: "Taiwan", boxes: [[21, 119, 26, 123]] },
    { country: "UAE", boxes: [[22, 51, 27, 57]] },
    { country: "Pakistan", boxes: [[23, 60, 38, 78]] },
    { country: "India", boxes: [[6, 68, 36, 98]] },
    { country: "Afghanistan", boxes: [[29, 60, 39, 75]] },
    { country: "Algeria", boxes: [[18, -9, 38, 12]] },
    { country: "Argentina", boxes: [[-56, -74, -21, -53]] },
    { country: "Australia", boxes: [[-44, 112, -10, 154]] },
    { country: "Brazil", boxes: [[-34, -74, 6, -34]] },
    { country: "Burkina Faso", boxes: [[9, -6, 16, 3]] },
    { country: "Cameroon", boxes: [[1, 8, 14, 17]] },
    { country: "Canada", boxes: [[41, -141, 84, -52]] },
    { country: "Chad", boxes: [[7, 13, 24, 24]] },
    { country: "Egypt", boxes: [[21, 24, 32, 37]] },
    { country: "Ethiopia", boxes: [[3, 33, 15, 48]] },
    { country: "France", boxes: [[41, -5, 52, 10]] },
    { country: "French Polynesia", boxes: [[-28, -155, -7, -134]] },
    { country: "Greece", boxes: [[34, 19, 42, 30]] },
    { country: "Greenland", boxes: [[59, -74, 84, -11]] },
    { country: "Iceland", boxes: [[63, -25, 67, -13]] },
    { country: "Indonesia", boxes: [[-11, 95, 6, 141]] },
    { country: "Iraq", boxes: [[29, 38, 38, 49]] },
    { country: "Israel", boxes: [[29, 34, 34, 36]] },
    { country: "Iran", boxes: [[24, 44, 40, 64]] },
    { country: "Italy", boxes: [[35, 6, 48, 19]] },
    { country: "Kazakhstan", boxes: [[40, 46, 56, 88]] },
    { country: "Kenya", boxes: [[-5, 33, 6, 42]] },
    { country: "Kyrgyzstan", boxes: [[39, 69, 44, 81]] },
    { country: "Libya", boxes: [[19, 9, 34, 26]] },
    { country: "Marshall Islands", boxes: [[4, 160, 15, 173]] },
    { country: "Mauritania", boxes: [[14, -18, 28, -4]] },
    { country: "New Zealand", boxes: [[-48, 166, -34, 179]] },
    { country: "Niger", boxes: [[11, 0, 24, 16]] },
    { country: "North Korea", boxes: [[37, 124, 43, 131]] },
    { country: "South Korea", boxes: [[33, 124, 39, 132]] },
    { country: "Japan", boxes: [[24, 122, 46, 146]] },
    { country: "Norway", boxes: [[57, 4, 72, 32]] },
    { country: "Peru", boxes: [[-19, -82, 0, -68]] },
    { country: "Philippines", boxes: [[4, 116, 22, 127]] },
    { country: "Poland", boxes: [[49, 14, 55, 25]] },
    { country: "Romania", boxes: [[43, 20, 49, 30]] },
    { country: "Saudi Arabia", boxes: [[16, 34, 33, 56]] },
    { country: "Seychelles", boxes: [[-10, 46, 0, 57]] },
    { country: "Somalia", boxes: [[-2, 40, 12, 52]] },
    { country: "South Africa", boxes: [[-35, 16, -22, 33]] },
    { country: "Spain", boxes: [[35, -10, 44, 5]] },
    { country: "Sweden", boxes: [[55, 10, 70, 25]] },
    { country: "Syria", boxes: [[32, 35, 38, 43]] },
    { country: "Tunisia", boxes: [[30, 7, 38, 12]] },
    { country: "Turkey", boxes: [[35, 25, 43, 45]] },
    { country: "Ukraine", boxes: [[44, 22, 53, 41]] },
    { country: "United Kingdom", boxes: [[49, -8, 61, 2]] },
    { country: "United States", boxes: [[24, -125, 50, -66], [51, -170, 72, -130], [18, -161, 23, -154]] },
    { country: "Uzbekistan", boxes: [[37, 55, 46, 74]] },
    { country: "China", boxes: [[18, 73, 54, 135]] },
    { country: "Russia", boxes: [[41, 19, 82, 180], [41, -180, 72, -168]] },
]);

function normalizeCountryName(value = "") {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    return COUNTRY_ALIASES[key] || normalized;
}

function isPointInBox(lat, lon, box) {
    const [minLat, minLon, maxLat, maxLon] = box;
    if (lat < minLat || lat > maxLat) return false;
    if (minLon <= maxLon) return lon >= minLon && lon <= maxLon;
    return lon >= minLon || lon <= maxLon;
}

export function inferMilitaryBaseCountryFromCoordinates(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
    const match = COUNTRY_RULES.find((rule) => rule.boxes.some((box) => isPointInBox(latitude, longitude, box)));
    return match?.country || "";
}

function isDeclaredCountryCompatible(declaredCountry, inferredCountry) {
    const declared = normalizeCountryName(declaredCountry).toLowerCase();
    const inferred = normalizeCountryName(inferredCountry).toLowerCase();
    if (!declared || !inferred) return true;
    return declared === inferred || declared.includes(inferred) || inferred.includes(declared);
}

function countryContainsPoint(country, lat, lon) {
    const normalized = normalizeCountryName(country).toLowerCase();
    if (!normalized) return false;
    return COUNTRY_RULES
        .filter((rule) => rule.country.toLowerCase() === normalized)
        .some((rule) => rule.boxes.some((box) => isPointInBox(lat, lon, box)));
}

function isCoordinateCorrectionEligible(base = {}) {
    if (MILITARY_BASE_HOST_COUNTRY_OVERRIDES[base.id] || BASE_COUNTRY_OVERRIDES[base.id]) return true;
    const candidates = [
        base.sourceLayer,
        base.metadata?.originalCategory,
        base.metadata?.originalProperties?.SourceLayer,
    ]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
    return candidates.some((value) => COORDINATE_CORRECTABLE_SOURCE_LAYERS.has(value));
}

export function normalizeMilitaryBaseDisplayData(base = {}) {
    const lat = Number(base.lat ?? base.coordinates?.lat);
    const lon = Number(base.lon ?? base.coordinates?.lon);
    const originalCountry = String(base.country || "").trim();
    const hostOverrideCountry = MILITARY_BASE_HOST_COUNTRY_OVERRIDES[base.id] || "";
    const manualOverrideCountry = BASE_COUNTRY_OVERRIDES[base.id] || "";
    const overrideCountry = hostOverrideCountry || manualOverrideCountry;
    const inferredCountry = overrideCountry || (isCoordinateCorrectionEligible(base)
        ? inferMilitaryBaseCountryFromCoordinates(lat, lon)
        : "");
    const declaredCountryAlreadyFits = !overrideCountry && countryContainsPoint(originalCountry, lat, lon);
    const shouldCorrectCountry = inferredCountry &&
        !declaredCountryAlreadyFits &&
        !isDeclaredCountryCompatible(originalCountry, inferredCountry);
    return {
        ...base,
        lat,
        lon,
        country: shouldCorrectCountry ? inferredCountry : normalizeCountryName(originalCountry || inferredCountry || ""),
        countryQuality: shouldCorrectCountry
            ? (hostOverrideCountry ? "host_country_corrected" : "coordinate_corrected")
            : "declared",
        originalCountry: shouldCorrectCountry ? originalCountry : "",
        inferredCountry,
    };
}
