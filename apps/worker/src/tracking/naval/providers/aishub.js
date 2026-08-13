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

export function createAisHubProvider({ enabled, username, baseUrl, fetchImpl, minimumIntervalMs = 60_000 } = {}) {
    const configured = Boolean(enabled && username);
    return {
        id: "aishub",
        enabled: configured,
        minimumIntervalMs: Math.max(60_000, Number(minimumIntervalMs) || 60_000),
        async fetchObservations() {
            const url = new URL(baseUrl || "https://data.aishub.net/ws.php");
            url.searchParams.set("username", username);
            url.searchParams.set("format", "1");
            url.searchParams.set("output", "json");
            url.searchParams.set("compress", "0");
            const data = await fetchJson(url.toString(), {}, { fetchImpl });
            const responseError = data?.[0]?.ERROR;
            if (responseError && String(responseError) !== "0") {
                throw new Error(`AISHub response error ${String(responseError).slice(0, 120)}`);
            }
            const rows = Array.isArray(data?.[1]) ? data[1] : [];
            return rows.map((row) => ({
                domain: "naval",
                source: "aishub",
                observed_at: observedAt(row.TIME),
                mmsi: String(row.MMSI || "").replace(/\D/g, ""),
                imo: String(row.IMO || "").replace(/\D/g, ""),
                callsign: String(row.CALLSIGN || "").trim(),
                vessel_name: String(row.NAME || "").trim(),
                latitude: numberOrNull(row.LATITUDE),
                longitude: numberOrNull(row.LONGITUDE),
                speed_kts: numberOrNull(row.SOG),
                heading_deg: numberOrNull(row.HEADING),
                course_deg: numberOrNull(row.COG),
                ship_type: row.TYPE ?? null,
                country: String(row.COUNTRY || "").trim(),
                military_hint: Number(row.TYPE) === 35,
            }));
        },
    };
}
