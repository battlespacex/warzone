import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { MILITARY_BASES } from "../assets/js/warzone-military-bases-data.js";

const COUNTRIES_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
const LOCAL_COUNTRIES_PATH = path.join(os.tmpdir(), "countries.geojson");
const OUTPUT_PATH = path.resolve("dev/assets/js/warzone-military-base-host-overrides.generated.js");

const NAME_ALIASES = new Map(Object.entries({
    "United States of America": "United States",
    "US Naval Base Guantanamo Bay": "Cuba",
    "Baykonur Cosmodrome": "Kazakhstan",
    "Akrotiri Sovereign Base Area": "Cyprus",
    "Hong Kong S.A.R.": "China",
    "United States Minor Outlying Islands": "United States",
    "Siachen Glacier": "India",
    "Cura\u00e7ao": "Curacao",
}));

const DECLARED_ALIASES = new Map(Object.entries({
    "UAE": "United Arab Emirates",
    "BIOT": "British Indian Ocean Territory",
    "Greenland ( Denmark)": "Greenland",
    "Greenland (Denmark)": "Greenland",
    "Guam (US)": "Guam",
    "Soviet Union/ Kazakhstan": "Kazakhstan",
    "Soviet Union/ Kazakhstan (Operated by Russia)": "Kazakhstan",
    "Soviet Union/ Russia": "Russia",
    "West Germany": "Germany",
    "Nazi-occupied Poland": "Poland",
    "French Algeria": "Algeria",
    "French Polynesia": "France",
    "Zaire": "Democratic Republic of the Congo",
}));

const INTENTIONAL_DISPLAY_COUNTRIES = new Set([
    "Ukraine (occ)",
]);

function download(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`download failed ${res.statusCode}`));
                res.resume();
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).on("error", reject);
    });
}

async function readCountries() {
    try {
        return JSON.parse(await fs.readFile(LOCAL_COUNTRIES_PATH, "utf8"));
    } catch {
        const body = await download(COUNTRIES_URL);
        await fs.writeFile(LOCAL_COUNTRIES_PATH, body, "utf8");
        return JSON.parse(body);
    }
}

function isPointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersects = ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function isPointInPolygon(point, polygon) {
    if (!isPointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) {
        if (isPointInRing(point, polygon[i])) return false;
    }
    return true;
}

function isPointInGeometry(point, geometry) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return isPointInPolygon(point, geometry.coordinates);
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.some((polygon) => isPointInPolygon(point, polygon));
    }
    return false;
}

function normalizeName(value = "") {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeComparable(value = "") {
    const normalized = normalizeName(value);
    return normalizeName(DECLARED_ALIASES.get(normalized) || NAME_ALIASES.get(normalized) || normalized).toLowerCase();
}

function displayHostCountry(hostCountry, lat, lon) {
    if (hostCountry === "France" && lat >= 2 && lat <= 6 && lon >= -55.5 && lon <= -51) {
        return "French Guiana";
    }
    const aliased = NAME_ALIASES.get(hostCountry) || hostCountry;
    return aliased.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function findHostCountry(featureCollection, lat, lon) {
    const point = [lon, lat];
    const match = featureCollection.features.find((feature) => isPointInGeometry(point, feature.geometry));
    return match?.properties?.name || "";
}

const countries = await readCountries();
const overrides = {};
const mismatches = [];

for (const base of MILITARY_BASES) {
    const lat = Number(base.lat ?? base.coordinates?.lat);
    const lon = Number(base.lon ?? base.coordinates?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const declaredCountry = normalizeName(base.country);
    if (!declaredCountry || INTENTIONAL_DISPLAY_COUNTRIES.has(declaredCountry)) continue;

    const hostCountry = displayHostCountry(findHostCountry(countries, lat, lon), lat, lon);
    if (!hostCountry) continue;

    if (normalizeComparable(declaredCountry) === normalizeComparable(hostCountry)) continue;

    overrides[base.id] = hostCountry;
    mismatches.push({
        id: base.id,
        name: base.name,
        declaredCountry,
        hostCountry,
        lat,
        lon,
        sourceLayer: base.sourceLayer || base.metadata?.originalCategory || "",
    });
}

const file = `// Generated by dev/tools/generate-military-base-host-overrides.mjs.\n` +
    `// Host-country corrections are derived from country polygons and base coordinates.\n` +
    `export const MILITARY_BASE_HOST_COUNTRY_OVERRIDES = Object.freeze(${JSON.stringify(overrides, null, 4)});\n`;

await fs.writeFile(OUTPUT_PATH, file, "utf8");

console.log(JSON.stringify({
    totalBases: MILITARY_BASES.length,
    generatedOverrides: Object.keys(overrides).length,
    output: OUTPUT_PATH,
    mismatchSample: mismatches.slice(0, 20),
}, null, 2));
if (process.argv.includes("--verbose")) {
    mismatches.forEach((row) => {
        console.log(`${row.id} | ${row.name} | ${row.declaredCountry} -> ${row.hostCountry} | ${row.lat.toFixed(5)},${row.lon.toFixed(5)} | ${row.sourceLayer}`);
    });
}
