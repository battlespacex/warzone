import { fetchJson } from "../../http.js";
import { normalizeReadsbAircraft } from "./readsb.js";

const DEFAULT_BASE_URL = "https://api.adsb.lol";
const DEFAULT_POSITION_MAX_AGE_SECONDS = 90;

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function validPosition(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180
        && !(latitude === 0 && longitude === 0);
}

function endpointUrl(baseUrl) {
    const value = String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
    if (/\/v2\/mil$/i.test(value)) return value;
    if (/\/v2$/i.test(value)) return `${value}/mil`;
    return `${value}/v2/mil`;
}

function selectAircraftPosition(record, maxAgeSeconds) {
    const currentLat = numberOrNull(record?.lat);
    const currentLon = numberOrNull(record?.lon);
    const currentAge = numberOrNull(record?.seen_pos ?? record?.seen) ?? 0;
    if (validPosition(currentLat, currentLon) && currentAge <= maxAgeSeconds) {
        return { latitude: currentLat, longitude: currentLon, ageSeconds: currentAge, source: "current" };
    }

    const lastLat = numberOrNull(record?.lastPosition?.lat);
    const lastLon = numberOrNull(record?.lastPosition?.lon);
    const lastAge = numberOrNull(record?.lastPosition?.seen_pos);
    if (validPosition(lastLat, lastLon) && lastAge != null && lastAge <= maxAgeSeconds) {
        return { latitude: lastLat, longitude: lastLon, ageSeconds: lastAge, source: "lastPosition" };
    }

    return { latitude: null, longitude: null, ageSeconds: null, source: "none" };
}

export function normalizeAdsbLolAircraft(record = {}, {
    now = Date.now(),
    positionMaxAgeSeconds = DEFAULT_POSITION_MAX_AGE_SECONDS,
} = {}) {
    const maxAgeSeconds = Math.max(1, Number(positionMaxAgeSeconds) || DEFAULT_POSITION_MAX_AGE_SECONDS);
    const position = selectAircraftPosition(record, maxAgeSeconds);
    const normalized = normalizeReadsbAircraft({
        ...record,
        lat: position.latitude,
        lon: position.longitude,
        seen_pos: position.ageSeconds,
    }, { source: "adsb_lol", militaryHint: true, now });
    const dbFlags = numberOrNull(record.dbFlags);

    return {
        ...normalized,
        provider: "adsb_lol",
        provider_military_flag: dbFlags != null && (dbFlags & 1) === 1,
        military_hint: true,
        altitude_geom_ft: numberOrNull(record.alt_geom),
        vertical_rate_fpm: numberOrNull(record.baro_rate ?? record.geom_rate),
        adsb_category: String(record.category || "").trim(),
        adsb_message_type: String(record.type || "").trim(),
        db_flags: dbFlags,
        position_source: position.source,
        position_age_seconds: position.ageSeconds,
    };
}

export function createAdsbLolProvider({
    enabled,
    baseUrl,
    positionMaxAgeSeconds = DEFAULT_POSITION_MAX_AGE_SECONDS,
    fetchImpl,
} = {}) {
    return {
        id: "adsb_lol",
        enabled: enabled !== false,
        async fetchObservations() {
            const data = await fetchJson(endpointUrl(baseUrl), {
                headers: { Accept: "application/json", "User-Agent": "stratops-warzone/1.0" },
            }, { fetchImpl });
            if (data?.msg && data.msg !== "No error") throw new Error(String(data.msg));
            const records = Array.isArray(data?.ac) ? data.ac : [];
            const observations = records.map((record) => normalizeAdsbLolAircraft(record, { positionMaxAgeSeconds }));
            const valid = observations.filter((item) => item.icao24 && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).length;
            return {
                observations,
                diagnostics: {
                    fetched: records.length,
                    normalized: observations.length,
                    valid,
                    reported_total: Number(data?.total) || records.length,
                },
            };
        },
    };
}

