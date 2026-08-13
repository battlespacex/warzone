import { fetchJson } from "../../http.js";
import {
    navalValue,
    normalizeNavalObservation,
} from "../normalize.js";

const DEFAULT_BASE_URL = "https://api.vesselfinder.com";

function endpointUrl(baseUrl) {
    const value = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    return /\/(?:livedata|vessels)(?:\?|$)/i.test(value) ? value : `${value}/livedata`;
}

export function normalizeVesselFinderRow(record = {}, options = {}) {
    const row = record.AIS || record.ais || record;
    const shipType = navalValue(row, "TYPE", "ship_type");
    return normalizeNavalObservation("vesselfinder", {
        observed_at: navalValue(row, "TIMESTAMP", "timestamp"),
        mmsi: navalValue(row, "MMSI", "mmsi"),
        imo: navalValue(row, "IMO", "imo"),
        vessel_name: navalValue(row, "NAME", "name", "SHIPNAME"),
        callsign: navalValue(row, "CALLSIGN", "callsign"),
        latitude: navalValue(row, "LATITUDE", "LAT", "latitude"),
        longitude: navalValue(row, "LONGITUDE", "LON", "longitude"),
        speed_kts: navalValue(row, "SPEED", "SOG", "speed"),
        course_deg: navalValue(row, "COURSE", "COG", "course"),
        heading_deg: navalValue(row, "HEADING", "heading"),
        nav_status: navalValue(row, "NAVSTAT", "nav_status"),
        ship_type: shipType,
        ship_type_code: shipType,
        country: navalValue(row, "FLAG", "COUNTRY", "country"),
        provider_military_flag: Number(shipType) === 35,
        metadata: {
            source_class: navalValue(row, "SRC", "src"),
            destination: navalValue(row, "DESTINATION", "DEST", "destination"),
        },
    }, options);
}

export function createVesselFinderProvider({
    enabled,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    minimumIntervalMs = 60_000,
    fetchImpl,
} = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && apiKey && baseUrl);
    return {
        id: "vesselfinder",
        enabled: configured,
        disabledReason: requested && !apiKey ? "MISSING_CREDENTIALS" : (requested && !baseUrl ? "INCOMPLETE_CONFIGURATION" : "DISABLED_BY_CONFIG"),
        minimumIntervalMs: Math.max(60_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const url = new URL(endpointUrl(baseUrl));
            url.searchParams.set("userkey", apiKey);
            url.searchParams.set("format", "json");
            const data = await fetchJson(url.toString(), {}, { fetchImpl });
            const rows = Array.isArray(data) ? data : (data?.vessels || data?.data || []);
            const observations = rows.map((row) => normalizeVesselFinderRow(row));
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
