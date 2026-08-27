import { fetchJson } from "../../http.js";
import { navalNumber, navalValue, normalizeNavalObservation } from "../normalize.js";

const KMH_TO_KNOTS = 0.5399568;

export function normalizeMarinePlanRow(row = {}, { now = Date.now() } = {}) {
    const point = navalValue(row, "point", "location", "coordinates");
    const coordinates = Array.isArray(point) ? point : String(point || "").split(",").map(Number);
    const speedKmh = navalNumber(navalValue(row, "speed", "speed_kmh"));
    return normalizeNavalObservation("marineplan", {
        observed_at: navalValue(row, "timestamp", "time", "updated"),
        mmsi: navalValue(row, "mmsi", "MMSI"),
        imo: navalValue(row, "imo", "IMO"),
        callsign: navalValue(row, "callsign", "callSign"),
        vessel_name: navalValue(row, "name", "shipName"),
        latitude: navalValue(row, "lat", "latitude") ?? coordinates[0],
        longitude: navalValue(row, "lon", "longitude") ?? coordinates[1],
        speed_kts: speedKmh == null ? null : speedKmh * KMH_TO_KNOTS,
        course_deg: navalValue(row, "bearing", "course", "cog"),
        heading_deg: navalValue(row, "heading"),
        ship_type: navalValue(row, "type", "shipType"),
        metadata: { destination: navalValue(row, "destinationname", "destination"), draught: navalValue(row, "draught") },
    }, { now });
}

export function createMarinePlanProvider({ enabled, apiKey, area, baseUrl = "https://ais.marineplan.com", maxAgeSeconds = 1800, minimumIntervalMs = 60_000, fetchImpl } = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && apiKey && area);
    return {
        id: "marineplan",
        enabled: configured,
        disabledReason: !requested ? "DISABLED_BY_CONFIG" : (!apiKey ? "MISSING_CREDENTIALS" : "MISSING_AREA"),
        minimumIntervalMs: Math.max(60_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const url = new URL("/location/2/locations.json", baseUrl);
            url.searchParams.set("area", area);
            url.searchParams.set("maxage", String(Math.max(60, Number(maxAgeSeconds) || 1800)));
            url.searchParams.set("moving", "1");
            url.searchParams.set("source", "AIS");
            url.searchParams.set("key", apiKey);
            const data = await fetchJson(url.toString(), {}, { fetchImpl });
            const rows = Array.isArray(data) ? data : (data?.ships || data?.locations || data?.data || []);
            const observations = (Array.isArray(rows) ? rows : []).map((row) => normalizeMarinePlanRow(row));
            return { observations, diagnostics: { fetched: rows.length, normalized: observations.length, valid: observations.filter((item) => item.latitude != null && item.longitude != null).length } };
        },
    };
}
