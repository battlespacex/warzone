import { fetchJson } from "../../http.js";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";
let cachedToken = null;
let tokenExpiresAt = 0;

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

async function accessToken(clientId, clientSecret, fetchImpl) {
    if (cachedToken && Date.now() < tokenExpiresAt - 30_000) return cachedToken;
    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
    });
    const data = await fetchJson(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    }, { fetchImpl });
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in) || 1800) * 1000;
    return cachedToken;
}

function normalizeState(state, now = Date.now()) {
    const observedSeconds = numberOrNull(state?.[4] ?? state?.[3]);
    const verticalRateMs = numberOrNull(state?.[11]);
    return {
        domain: "aircraft",
        source: "opensky",
        observed_at: new Date(observedSeconds ? observedSeconds * 1000 : now).toISOString(),
        icao24: String(state?.[0] || "").trim().toLowerCase(),
        registration: "",
        callsign: String(state?.[1] || "").trim().replace(/\s+/g, ""),
        country: String(state?.[2] || "").trim(),
        longitude: numberOrNull(state?.[5]),
        latitude: numberOrNull(state?.[6]),
        altitude_ft: numberOrNull(state?.[7]) == null ? null : Math.round(Number(state[7]) * 3.28084),
        on_ground: Boolean(state?.[8]),
        speed_kts: numberOrNull(state?.[9]) == null ? null : Number(state[9]) * 1.943844,
        heading_deg: numberOrNull(state?.[10]),
        vertical_rate_fpm: verticalRateMs == null ? null : verticalRateMs * 196.8504,
        squawk: String(state?.[14] || "").trim(),
        aircraft_type: "",
        model: "",
        operator: "",
        military_hint: false,
    };
}

export function createOpenSkyProvider({ enabled, clientId, clientSecret, baseUrl, fetchImpl } = {}) {
    const configured = Boolean(enabled && clientId && clientSecret);
    return {
        id: "opensky",
        enabled: configured,
        async fetchObservations() {
            const fetchStates = async () => {
                const token = await accessToken(clientId, clientSecret, fetchImpl);
                return fetchJson(baseUrl || STATES_URL, {
                    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
                }, { fetchImpl });
            };
            let data;
            try {
                data = await fetchStates();
            } catch (error) {
                if (Number(error?.status) !== 401 || !cachedToken) throw error;
                resetOpenSkyToken();
                data = await fetchStates();
            }
            return (Array.isArray(data?.states) ? data.states : []).map((state) => normalizeState(state));
        },
    };
}

export function resetOpenSkyToken() {
    cachedToken = null;
    tokenExpiresAt = 0;
}
