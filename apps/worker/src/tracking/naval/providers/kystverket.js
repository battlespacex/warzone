import { fetchJson } from "../../http.js";
import { navalValue, navalNumber, normalizeNavalObservation, validNavalCoordinates } from "../normalize.js";

// Norwegian Coastal Administration (Kystverket) public AIS realtime GeoJSON.
// The public service excludes vessel classes restricted by Norwegian open-data rules.
// Attribution: Norwegian Coastal Administration; Norwegian Licence for Open Government Data.
const DEFAULT_URL = "https://kystdatahuset.kystverket.no/ws/api/ais/realtime/geojson";

export function normalizeKystverketFeature(feature = {}, { now = Date.now(), maxAgeMs = 30 * 60_000 } = {}) {
    const row = feature?.properties || {};
    if (!row || typeof row !== "object") return null;
    const coordinates = feature?.geometry?.coordinates;
    // LatestPositions uses LineString geometry. Take only the final observed point;
    // never fabricate intermediate vessel movements.
    const point = Array.isArray(coordinates?.[0]) ? coordinates[coordinates.length - 1] : coordinates;
    const lon = navalNumber(navalValue(row, "longitude", "lon", "lng") ?? point?.[0]);
    const lat = navalNumber(navalValue(row, "latitude", "lat") ?? point?.[1]);
    const mmsi = String(navalValue(row, "mmsi", "MMSI") ?? "").replace(/\D/g, "");
    if (!/^\d{9}$/.test(mmsi) || !validNavalCoordinates(lat, lon)) return null;
    const rawTime = navalValue(row, "msgtime", "msg_time", "timestamp", "time", "timeStamp", "dateTime", "datetime", "lastUpdate", "lastSeen", "positionTime", "positionTimestamp");
    if (rawTime == null || rawTime === "") return null;
    const numeric = Number(rawTime);
    const time = Number.isFinite(numeric) && String(rawTime).trim()
        ? new Date(numeric < 1e10 ? numeric * 1000 : numeric)
        : new Date(rawTime);
    const timestamp = time.getTime();
    if (!Number.isFinite(timestamp) || timestamp > now + 2 * 60_000 || now - timestamp > maxAgeMs) return null;
    return normalizeNavalObservation("kystverket", {
        observed_at: time.toISOString(),
        mmsi,
        imo: navalValue(row, "imo", "imoNumber"),
        callsign: navalValue(row, "callSign", "callsign"),
        vessel_name: navalValue(row, "name", "shipName", "vesselName"),
        latitude: lat,
        longitude: lon,
        speed_kts: navalValue(row, "sog", "speedOverGround", "speed"),
        course_deg: navalValue(row, "cog", "courseOverGround", "course"),
        heading_deg: navalValue(row, "heading", "trueHeading"),
        ship_type: navalValue(row, "shipType", "type"),
        ship_type_code: navalValue(row, "shipType", "type"),
        nav_status: navalValue(row, "navigationalStatus", "navStatus"),
        metadata: {
            attribution: "Norwegian Coastal Administration (Kystverket), NLOD",
            source_url: "https://kystdatahuset.kystverket.no/ws/swagger/index.html",
            national_scope: "Norwegian waters and adjacent coverage"
        }
    }, { now });
}

export function createKystverketProvider({
    enabled = false, baseUrl = DEFAULT_URL, minimumIntervalMs = 15 * 60_000,
    maxAgeMs = 30 * 60_000, maxRecords = 12000, fetchImpl
} = {}) {
    return {
        id: "kystverket",
        enabled: enabled === true,
        disabledReason: enabled === true ? undefined : "DISABLED_BY_CONFIG",
        minimumIntervalMs: Math.max(15 * 60_000, Number(minimumIntervalMs) || 15 * 60_000),
        async fetchObservations() {
            const data = await fetchJson(baseUrl, {
                headers: { Accept: "application/geo+json, application/json", "User-Agent": "StratOps/1.0" }
            }, { fetchImpl });
            if (!Array.isArray(data?.features)) throw new Error("Unexpected Kystverket GeoJSON response");
            const seen = new Map();
            for (const feature of data.features.slice(0, Math.min(20000, Math.max(1, maxRecords)))) {
                const row = normalizeKystverketFeature(feature, { maxAgeMs });
                if (!row) continue;
                const previous = seen.get(row.mmsi);
                if (!previous || Date.parse(row.observed_at) > Date.parse(previous.observed_at)) seen.set(row.mmsi, row);
            }
            const observations = [...seen.values()];
            return { observations, diagnostics: {
                fetched: data.features.length, normalized: observations.length,
                valid: observations.length, capped: data.features.length > maxRecords
            } };
        }
    };
}
