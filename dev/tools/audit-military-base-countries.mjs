import { MILITARY_BASES } from "../assets/js/warzone-military-bases-data.js";
import { MILITARY_BASE_HOST_COUNTRY_OVERRIDES } from "../assets/js/warzone-military-base-host-overrides.generated.js";
import {
    inferMilitaryBaseCountryFromCoordinates,
    normalizeMilitaryBaseDisplayData,
} from "../assets/js/warzone-military-base-quality.js";

const rows = MILITARY_BASES.map((base) => {
    const lat = Number(base.lat ?? base.coordinates?.lat);
    const lon = Number(base.lon ?? base.coordinates?.lon);
    const inferredCountry = inferMilitaryBaseCountryFromCoordinates(lat, lon);
    const normalized = normalizeMilitaryBaseDisplayData(base);
    return {
        id: base.id,
        name: base.name,
        declaredCountry: base.country || "",
        inferredCountry,
        displayCountry: normalized.country || "",
        quality: normalized.countryQuality,
        generatedOverride: MILITARY_BASE_HOST_COUNTRY_OVERRIDES[base.id] || "",
        lat,
        lon,
    };
});

const invalidCoordinates = rows.filter((row) => !Number.isFinite(row.lat) || !Number.isFinite(row.lon));
const corrected = rows.filter((row) => ["coordinate_corrected", "host_country_corrected"].includes(row.quality));
const generatedCorrected = rows.filter((row) => row.generatedOverride);
const notInferred = rows.filter((row) => !row.inferredCountry);

console.log(JSON.stringify({
    total: rows.length,
    invalidCoordinates: invalidCoordinates.length,
    generatedHostCountryOverrides: generatedCorrected.length,
    totalCorrectedForDisplay: corrected.length,
    notInferred: notInferred.length,
    sampleCorrected: corrected.slice(0, 30).map((row) => ({
        id: row.id,
        name: row.name,
        country: `${row.declaredCountry || "Unknown"} -> ${row.displayCountry}`,
        coordinates: `${row.lat.toFixed(5)},${row.lon.toFixed(5)}`,
        quality: row.quality,
    })),
}, null, 2));

if (invalidCoordinates.length) {
    console.log("\nInvalid coordinates:");
    invalidCoordinates.forEach((row) => {
        console.log(`${row.id} | ${row.name} | ${row.lat},${row.lon}`);
    });
}
