import { fetchJson } from "../../http.js";
import { navalValue, normalizeNavalObservation } from "../normalize.js";

export function normalizeAisHubRow(row = {}, options = {}) {
    const shipType = navalValue(row, "TYPE", "SHIPTYPE", "ship_type");
    return normalizeNavalObservation("aishub", {
        observed_at: navalValue(row, "TIME", "TIMESTAMP", "timestamp"),
        mmsi: navalValue(row, "MMSI", "mmsi"),
        imo: navalValue(row, "IMO", "imo"),
        callsign: navalValue(row, "CALLSIGN", "call_sign", "callsign"),
        vessel_name: navalValue(row, "NAME", "SHIPNAME", "name"),
        latitude: navalValue(row, "LATITUDE", "LAT", "latitude"),
        longitude: navalValue(row, "LONGITUDE", "LON", "longitude"),
        speed_kts: navalValue(row, "SPEED", "SOG", "speed"),
        heading_deg: navalValue(row, "HEADING", "heading"),
        course_deg: navalValue(row, "COURSE", "COG", "course"),
        nav_status: navalValue(row, "NAVSTAT", "nav_status"),
        ship_type: shipType,
        ship_type_code: shipType,
        operator: navalValue(row, "OPERATOR", "operator"),
        country: navalValue(row, "COUNTRY", "FLAG", "country"),
        provider_military_flag: Number(shipType) === 35,
        metadata: { destination: navalValue(row, "DESTINATION", "DEST", "destination") },
    }, options);
}

export function createAisHubProvider({ enabled, username, baseUrl, fetchImpl, minimumIntervalMs = 60_000 } = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && username);
    return {
        id: "aishub",
        enabled: configured,
        disabledReason: requested && !username ? "MISSING_CREDENTIALS" : "DISABLED_BY_CONFIG",
        minimumIntervalMs: Math.max(60_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const url = new URL(baseUrl || "https://data.aishub.net/ws.php");
            url.searchParams.set("username", username);
            url.searchParams.set("format", "1");
            url.searchParams.set("output", "json");
            url.searchParams.set("compress", "0");
            const data = await fetchJson(url.toString(), {}, { fetchImpl });
            const responseError = data?.[0]?.ERROR;
            if (responseError && !["0", "false"].includes(String(responseError).toLowerCase())) {
                throw new Error(`AISHub response error ${String(responseError).slice(0, 120)}`);
            }
            const rows = Array.isArray(data?.[1]) ? data[1] : [];
            const observations = rows.map((row) => normalizeAisHubRow(row));
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
