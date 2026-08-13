import { fetchJson } from "../../http.js";
import { navalValue, normalizeNavalObservation } from "../normalize.js";

export function normalizeMarineTrafficRow(row = {}, options = {}) {
    const shipType = navalValue(row, "SHIPTYPE", "TYPE", "ship_type");
    return normalizeNavalObservation("marinetraffic", {
        observed_at: navalValue(row, "TIMESTAMP", "timestamp", "LAST_POS"),
        mmsi: navalValue(row, "MMSI", "mmsi"),
        imo: navalValue(row, "IMO", "imo"),
        callsign: navalValue(row, "CALLSIGN", "callsign"),
        vessel_name: navalValue(row, "SHIPNAME", "NAME", "name"),
        latitude: navalValue(row, "LAT", "LATITUDE", "latitude"),
        longitude: navalValue(row, "LON", "LONGITUDE", "longitude"),
        speed_kts: navalValue(row, "SPEED", "SOG", "speed"),
        heading_deg: navalValue(row, "HEADING", "heading"),
        course_deg: navalValue(row, "COURSE", "COG", "course"),
        nav_status: navalValue(row, "NAVSTAT", "nav_status"),
        ship_type: shipType,
        ship_type_code: shipType,
        operator: navalValue(row, "OPERATOR", "operator"),
        country: navalValue(row, "FLAG", "COUNTRY", "country"),
        provider_military_flag: Number(shipType) === 35,
        metadata: { destination: navalValue(row, "DESTINATION", "DEST", "destination") },
    }, options);
}

export function createMarineTrafficProvider({ enabled, apiKey, baseUrl, minimumIntervalMs = 60_000, fetchImpl } = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && apiKey && baseUrl);
    return {
        id: "marinetraffic",
        enabled: configured,
        disabledReason: requested && apiKey && !baseUrl ? "INCOMPLETE_CONFIGURATION" : (requested && !apiKey ? "MISSING_CREDENTIALS" : "DISABLED_BY_CONFIG"),
        minimumIntervalMs: Math.max(10_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const url = new URL(baseUrl);
            url.searchParams.set("api_key", apiKey);
            const data = await fetchJson(url.toString(), {}, { fetchImpl });
            const rows = Array.isArray(data) ? data : (data?.data || data?.vessels || []);
            const observations = rows.map((row) => normalizeMarineTrafficRow(row));
            return {
                observations,
                diagnostics: {
                    fetched: rows.length,
                    normalized: observations.length,
                    valid: observations.filter((item) => item.mmsi && item.latitude != null && item.longitude != null).length,
                },
            };
        },
    };
}
