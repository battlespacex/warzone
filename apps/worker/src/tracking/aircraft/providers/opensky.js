import { fetchJson } from "../../http.js";

const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
const STATES_URL = "https://opensky-network.org/api/states/all";
const DEFAULT_MINIMUM_INTERVAL_MS = 15 * 60 * 1000;
const METERS_TO_FEET = 3.28084;
const METERS_PER_SECOND_TO_KNOTS = 1.943844;
const METERS_PER_SECOND_TO_FEET_PER_MINUTE = 196.8504;
const POSITION_SOURCE_NAMES = Object.freeze({
    0: "ads-b",
    1: "asterix",
    2: "mlat",
    3: "flarm",
});
const MILITARY_CALLSIGN_PATTERNS = [
    /^(?:RCH|REACH)\d+[A-Z]*$/,
    /^ASCOT[A-Z0-9]+$/,
    /^(?:FORTE|AWACS|SENTRY|NAEW|TEXACO|SHELL|NATO|NCHO|RRR|CNV|EVAC)[A-Z0-9]*$/,
];
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

function statesUrl(baseUrl) {
    const url = new URL(baseUrl || STATES_URL);
    url.searchParams.set("extended", "1");
    return url.toString();
}

export function hasOpenSkyMilitaryEvidence({ callsign = "" } = {}) {
    const normalizedCallsign = String(callsign || "").trim().replace(/\s+/g, "").toUpperCase();
    return MILITARY_CALLSIGN_PATTERNS.some((pattern) => pattern.test(normalizedCallsign));
}

export function normalizeOpenSkyState(state, { now = Date.now() } = {}) {
    const timePosition = numberOrNull(state?.[3]);
    const lastContact = numberOrNull(state?.[4]);
    const observedSeconds = timePosition ?? lastContact;
    const verticalRateMs = numberOrNull(state?.[11]);
    const barometricAltitudeMeters = numberOrNull(state?.[7]);
    const geometricAltitudeMeters = numberOrNull(state?.[13]);
    const velocityMs = numberOrNull(state?.[9]);
    const positionSourceCode = numberOrNull(state?.[16]);
    const category = numberOrNull(state?.[17]);
    const icao24 = String(state?.[0] || "").trim().toLowerCase();
    const callsign = String(state?.[1] || "").trim().replace(/\s+/g, "");
    const hasPositionTimestamp = timePosition != null;
    const militaryHint = hasOpenSkyMilitaryEvidence({ icao24, callsign });
    return {
        domain: "aircraft",
        source: "opensky",
        observed_at: new Date(observedSeconds != null ? observedSeconds * 1000 : now).toISOString(),
        icao24,
        registration: "",
        callsign,
        country: String(state?.[2] || "").trim(),
        time_position: timePosition,
        last_contact: lastContact,
        longitude: hasPositionTimestamp ? numberOrNull(state?.[5]) : null,
        latitude: hasPositionTimestamp ? numberOrNull(state?.[6]) : null,
        altitude_ft: barometricAltitudeMeters == null ? null : barometricAltitudeMeters * METERS_TO_FEET,
        altitude_geom_ft: geometricAltitudeMeters == null ? null : geometricAltitudeMeters * METERS_TO_FEET,
        on_ground: Boolean(state?.[8]),
        speed_kts: velocityMs == null ? null : velocityMs * METERS_PER_SECOND_TO_KNOTS,
        heading_deg: numberOrNull(state?.[10]),
        vertical_rate_fpm: verticalRateMs == null ? null : verticalRateMs * METERS_PER_SECOND_TO_FEET_PER_MINUTE,
        squawk: String(state?.[14] || "").trim(),
        spi: Boolean(state?.[15]),
        position_source: POSITION_SOURCE_NAMES[positionSourceCode] || "unknown",
        position_source_code: positionSourceCode,
        position_age_seconds: timePosition == null ? null : Math.max(0, (now / 1000) - timePosition),
        adsb_category: category,
        aircraft_type: "",
        model: "",
        operator: "",
        military_hint: militaryHint,
        military_evidence: militaryHint ? "opensky-callsign" : "",
    };
}

export function createOpenSkyProvider({
    enabled,
    clientId,
    clientSecret,
    baseUrl,
    minimumIntervalMs = DEFAULT_MINIMUM_INTERVAL_MS,
    fetchImpl,
} = {}) {
    const configured = Boolean(enabled);
    const authenticated = Boolean(clientId && clientSecret);
    return {
        id: "opensky",
        enabled: configured,
        minimumIntervalMs: Math.max(60_000, Number(minimumIntervalMs) || DEFAULT_MINIMUM_INTERVAL_MS),
        async fetchObservations() {
            const fetchStates = async () => {
                const headers = { Accept: "application/json", "User-Agent": "stratops-warzone/1.0" };
                if (authenticated) {
                    const token = await accessToken(clientId, clientSecret, fetchImpl);
                    headers.Authorization = `Bearer ${token}`;
                }
                return fetchJson(statesUrl(baseUrl), { headers }, { fetchImpl });
            };
            let data;
            try {
                data = await fetchStates();
            } catch (error) {
                if (!authenticated || Number(error?.status) !== 401 || !cachedToken) throw error;
                resetOpenSkyToken();
                data = await fetchStates();
            }
            const states = Array.isArray(data?.states) ? data.states : [];
            const responseNow = numberOrNull(data?.time);
            const now = responseNow == null ? Date.now() : responseNow * 1000;
            const observations = states.map((state) => normalizeOpenSkyState(state, { now }));
            return {
                observations,
                diagnostics: {
                    fetched: states.length,
                    normalized: observations.length,
                    valid: observations.filter((item) => item.icao24 && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).length,
                    military_candidates: observations.filter((item) => item.military_hint).length,
                    authenticated,
                },
            };
        },
    };
}

export function resetOpenSkyToken() {
    cachedToken = null;
    tokenExpiresAt = 0;
}
