export function navalText(value) {
    return String(value ?? "").trim();
}

export function navalDigits(value) {
    return navalText(value).replace(/\D/g, "");
}

export function navalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function navalObservedAt(value, fallback = Date.now()) {
    const numeric = navalNumber(value);
    if (numeric != null) {
        const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        const date = new Date(milliseconds);
        if (Number.isFinite(date.getTime())) return date.toISOString();
    }
    const parsed = Date.parse(navalText(value));
    return new Date(Number.isFinite(parsed) ? parsed : fallback).toISOString();
}

export function navalValue(row, ...keys) {
    if (!row || typeof row !== "object") return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
        const matched = Object.keys(row).find((candidate) => candidate.toLowerCase() === String(key).toLowerCase());
        if (matched) return row[matched];
    }
    return undefined;
}

export function validNavalCoordinates(latitude, longitude) {
    return Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180
        && !(latitude === 0 && longitude === 0);
}

export function normalizeNavalObservation(provider, values = {}, { now = Date.now() } = {}) {
    const latitude = navalNumber(values.latitude);
    const longitude = navalNumber(values.longitude);
    return {
        domain: "naval",
        source: provider,
        provider,
        observed_at: navalObservedAt(values.observed_at, now),
        mmsi: navalDigits(values.mmsi),
        imo: navalDigits(values.imo),
        vessel_name: navalText(values.vessel_name),
        callsign: navalText(values.callsign),
        latitude: validNavalCoordinates(latitude, longitude) ? latitude : null,
        longitude: validNavalCoordinates(latitude, longitude) ? longitude : null,
        speed_kts: navalNumber(values.speed_kts),
        course_deg: navalNumber(values.course_deg),
        heading_deg: navalNumber(values.heading_deg),
        nav_status: navalText(values.nav_status),
        operating_status: navalText(values.operating_status),
        ship_type: values.ship_type ?? null,
        ship_type_code: navalNumber(values.ship_type_code ?? values.ship_type),
        operator: navalText(values.operator),
        country: navalText(values.country),
        provider_military_flag: values.provider_military_flag === true,
        military_hint: values.military_hint === true || values.provider_military_flag === true,
        metadata: values.metadata && typeof values.metadata === "object" ? values.metadata : {},
    };
}
