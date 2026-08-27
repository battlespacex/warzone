import { fetchJson } from "../../http.js";
import { navalValue, normalizeNavalObservation } from "../normalize.js";

export function normalizeOpenAisFeature(feature = {}, { now = Date.now() } = {}) {
    const row = feature.properties || feature;
    const coordinates = feature.geometry?.coordinates || row.coordinates || [];
    return normalizeNavalObservation("openais", {
        observed_at: navalValue(row, "time_bucket", "timestamp", "observed_at"),
        mmsi: navalValue(row, "mmsi", "MMSI"),
        imo: navalValue(row, "imo", "IMO"),
        callsign: navalValue(row, "callsign", "call_sign"),
        vessel_name: navalValue(row, "name", "vessel_name"),
        latitude: navalValue(row, "lat", "latitude") ?? coordinates[1],
        longitude: navalValue(row, "lon", "longitude") ?? coordinates[0],
        speed_kts: navalValue(row, "sog", "speed_kts"),
        course_deg: navalValue(row, "cog", "course_deg"),
        heading_deg: navalValue(row, "heading", "heading_deg"),
        nav_status: navalValue(row, "nav_status", "nav_description"),
        ship_type: navalValue(row, "type_and_cargo", "type", "ship_type"),
        country: navalValue(row, "flag", "country"),
        metadata: { openais_sub_type: navalValue(row, "sub_type"), draught: navalValue(row, "draught") },
    }, { now });
}

export function createOpenAisProvider({ enabled, baseUrl, collectionPath = "/collections/postgisftw.latest_positions/items.json", apiToken, limit = 1000, minimumIntervalMs = 60_000, fetchImpl } = {}) {
    const configured = enabled === true && Boolean(baseUrl);
    return {
        id: "openais",
        enabled: configured,
        disabledReason: enabled !== true ? "DISABLED_BY_CONFIG" : "MISSING_BASE_URL",
        minimumIntervalMs: Math.max(60_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const url = new URL(collectionPath, String(baseUrl).replace(/\/?$/, "/"));
            url.searchParams.set("limit", String(Math.max(1, Math.min(5000, Number(limit) || 1000))));
            const headers = { Accept: "application/geo+json,application/json" };
            if (apiToken) headers.Authorization = `Bearer ${apiToken}`;
            const data = await fetchJson(url.toString(), { headers }, { fetchImpl });
            const rows = Array.isArray(data?.features) ? data.features : (Array.isArray(data) ? data : []);
            const observations = rows.map((row) => normalizeOpenAisFeature(row));
            return { observations, diagnostics: { fetched: rows.length, normalized: observations.length, valid: observations.filter((item) => item.latitude != null && item.longitude != null).length } };
        },
    };
}
