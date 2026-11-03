import { fetchJson } from "../../http.js";
import { navalNumber, normalizeNavalObservation, validNavalCoordinates } from "../normalize.js";

const TOKEN_URL = "https://id.barentswatch.no/connect/token";
const LATEST_URL = "https://live.ais.barentswatch.no/v1/latest/combined";
// Public Norwegian AIS with developer registration, OAuth client credentials and attribution.
export function normalizeBarentsWatchVessel(row = {}, { now = Date.now(), maxAgeMs = 30 * 60_000 } = {}) {
    const lat = navalNumber(row.latitude), lon = navalNumber(row.longitude);
    const mmsi = String(row.mmsi ?? "").replace(/\D/g, "");
    const ms = Date.parse(String(row.msgtime || ""));
    if (!/^\d{9}$/.test(mmsi) || !validNavalCoordinates(lat, lon) ||
        !Number.isFinite(ms) || ms > now + 120_000 || now - ms > maxAgeMs) return null;
    return normalizeNavalObservation("barentswatch", {
        observed_at: new Date(ms).toISOString(),
        mmsi, imo: row.imoNumber, callsign: row.callSign,
        vessel_name: row.name, latitude: lat, longitude: lon,
        speed_kts: row.speedOverGround, course_deg: row.courseOverGround,
        heading_deg: row.trueHeading, nav_status: row.navigationalStatus,
        ship_type: row.shipType, ship_type_code: row.shipType,
        metadata: { attribution: "Norwegian Coastal Administration / BarentsWatch, NLOD",
            source_url: "https://developer.barentswatch.no/docs/AIS/live-ais-api/" }
    }, { now });
}

export function createBarentsWatchProvider({
    enabled = false, clientId, clientSecret, tokenUrl = TOKEN_URL, baseUrl = LATEST_URL,
    maxAgeMs = 30 * 60_000, minimumIntervalMs = 10 * 60_000, fetchImpl
} = {}) {
    const configured = enabled === true && Boolean(clientId && clientSecret);
    let token = "";
    let expiresAt = 0;
    async function authenticate() {
        if (token && Date.now() < expiresAt - 60_000) return token;
        const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
            grant_type: "client_credentials", scope: "ais" });
        const data = await fetchJson(tokenUrl, {
            method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" }
        }, { fetchImpl });
        if (!data?.access_token) throw new Error("BarentsWatch authentication returned no token");
        token = data.access_token;
        expiresAt = Date.now() + Math.max(120, Number(data.expires_in) || 1800) * 1000;
        return token;
    }
    return {
        id: "barentswatch",
        enabled: configured,
        disabledReason: !enabled ? "DISABLED_BY_CONFIG" : configured ? undefined : "MISSING_CREDENTIALS",
        minimumIntervalMs: Math.max(600_000, Number(minimumIntervalMs) || 600_000),
        async fetchObservations() {
            async function fetchLatest() {
                const accessToken = await authenticate();
                return fetchJson(baseUrl, { headers: {
                    Authorization: `Bearer ${accessToken}`, Accept: "application/json",
                    "User-Agent": "StratOps/1.0"
                } }, { fetchImpl });
            }
            let data;
            try { data = await fetchLatest(); }
            catch (error) {
                if (error.status !== 401) throw error;
                token = ""; expiresAt = 0; data = await fetchLatest();
            }
            if (!Array.isArray(data)) throw new Error("Unexpected BarentsWatch latest AIS response");
            const byMmsi = new Map();
            for (const row of data.slice(0, 20_000)) {
                const observation = normalizeBarentsWatchVessel(row, { maxAgeMs });
                if (!observation) continue;
                const previous = byMmsi.get(observation.mmsi);
                if (!previous || Date.parse(observation.observed_at) > Date.parse(previous.observed_at)) {
                    byMmsi.set(observation.mmsi, observation);
                }
            }
            const observations = [...byMmsi.values()];
            return { observations, diagnostics: {
                fetched: data.length, normalized: observations.length, valid: observations.length,
                capped: data.length > 20_000
            } };
        }
    };
}
