import { fetchJson } from "../../http.js";

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function observedAt(value) {
    const parsed = Date.parse(value || "");
    return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

export function createMarineTrafficProvider({ enabled, apiKey, baseUrl, fetchImpl } = {}) {
    // MarineTraffic/Kpler assigns service-specific endpoints per account. Keep
    // this adapter disabled until the official customer endpoint and API key
    // are both supplied; no undocumented default endpoint is assumed.
    const configured = Boolean(enabled && apiKey && baseUrl);
    return {
        id: "marinetraffic",
        enabled: configured,
        async fetchObservations() {
            const url = new URL(baseUrl);
            url.searchParams.set("api_key", apiKey);
            const data = await fetchJson(url.toString(), {}, { fetchImpl });
            const rows = Array.isArray(data) ? data : (data?.data || data?.vessels || []);
            return rows.map((row) => ({
                domain: "naval",
                source: "marinetraffic",
                observed_at: observedAt(row.TIMESTAMP || row.timestamp),
                mmsi: String(row.MMSI || row.mmsi || "").replace(/\D/g, ""),
                imo: String(row.IMO || row.imo || "").replace(/\D/g, ""),
                callsign: String(row.CALLSIGN || row.callsign || "").trim(),
                vessel_name: String(row.SHIPNAME || row.name || "").trim(),
                latitude: numberOrNull(row.LAT ?? row.latitude),
                longitude: numberOrNull(row.LON ?? row.longitude),
                speed_kts: row.SPEED != null
                    ? (numberOrNull(row.SPEED) == null ? null : numberOrNull(row.SPEED) / 10)
                    : numberOrNull(row.speed),
                heading_deg: numberOrNull(row.HEADING ?? row.heading),
                course_deg: row.COURSE != null
                    ? (numberOrNull(row.COURSE) == null ? null : numberOrNull(row.COURSE) / 10)
                    : numberOrNull(row.course),
                ship_type: row.SHIPTYPE ?? row.ship_type ?? null,
                country: String(row.FLAG || row.country || "").trim(),
                military_hint: Number(row.SHIPTYPE ?? row.ship_type) === 35,
            }));
        },
    };
}
