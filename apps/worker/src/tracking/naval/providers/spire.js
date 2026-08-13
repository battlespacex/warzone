import { fetchJson } from "../../http.js";
import { navalValue, normalizeNavalObservation } from "../normalize.js";

const QUERY = `query StratOpsVessels($first: Int!) {
  vessels(first: $first) {
    nodes {
      id
      staticData { name imo mmsi callsign shipType flag }
      lastPositionUpdate { latitude longitude timestamp course heading speed navigationalStatus collectionType }
    }
  }
}`;

export function normalizeSpireRow(record = {}, options = {}) {
    const staticData = record.staticData || record.static_data || record.vessel || record;
    const position = record.lastPositionUpdate || record.last_known_position || record.position || record;
    const geometry = position.geometry?.coordinates || record.geometry?.coordinates || [];
    const shipType = navalValue(staticData, "shipType", "ship_type", "type");
    return normalizeNavalObservation("spire", {
        observed_at: navalValue(position, "timestamp", "updated_at"),
        mmsi: navalValue(staticData, "mmsi", "MMSI") ?? navalValue(position, "mmsi", "MMSI"),
        imo: navalValue(staticData, "imo", "IMO"),
        vessel_name: navalValue(staticData, "name", "vessel_name"),
        callsign: navalValue(staticData, "callsign", "call_sign"),
        latitude: navalValue(position, "latitude", "lat") ?? geometry[1],
        longitude: navalValue(position, "longitude", "lon") ?? geometry[0],
        speed_kts: navalValue(position, "speed", "speed_kts"),
        course_deg: navalValue(position, "course", "course_deg"),
        heading_deg: navalValue(position, "heading", "heading_deg"),
        nav_status: navalValue(position, "navigationalStatus", "status", "nav_status"),
        ship_type: shipType,
        ship_type_code: shipType,
        operator: navalValue(staticData, "operator", "owner"),
        country: navalValue(staticData, "flag", "country"),
        provider_military_flag: Number(shipType) === 35,
        metadata: { collection_type: navalValue(position, "collectionType", "collection_type") },
    }, options);
}

export function createSpireProvider({ enabled, token, baseUrl, minimumIntervalMs = 60_000, fetchImpl } = {}) {
    const requested = enabled === true;
    const configured = Boolean(requested && token && baseUrl);
    return {
        id: "spire",
        enabled: configured,
        disabledReason: requested && token && !baseUrl ? "INCOMPLETE_CONFIGURATION" : (requested && !token ? "MISSING_CREDENTIALS" : "DISABLED_BY_CONFIG"),
        minimumIntervalMs: Math.max(10_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const data = await fetchJson(baseUrl, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ query: QUERY, variables: { first: 1000 } }),
            }, { fetchImpl });
            if (Array.isArray(data?.errors) && data.errors.length) {
                throw new Error(`Spire: ${data.errors[0]?.message || "query failed"}`);
            }
            const rows = data?.data?.vessels?.nodes || data?.vessels || data?.data || [];
            const observations = (Array.isArray(rows) ? rows : []).map((row) => normalizeSpireRow(row));
            return {
                observations,
                diagnostics: {
                    fetched: Array.isArray(rows) ? rows.length : 0,
                    normalized: observations.length,
                    valid: observations.filter((item) => item.mmsi && item.latitude != null && item.longitude != null).length,
                },
            };
        },
    };
}
