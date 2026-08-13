function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

export function normalizeReadsbAircraft(record, { source, militaryHint = false, now = Date.now() }) {
    const ageSeconds = numberOrNull(record.seen_pos ?? record.seen);
    return {
        domain: "aircraft",
        source,
        observed_at: new Date(now - Math.max(0, ageSeconds || 0) * 1000).toISOString(),
        icao24: String(record.hex || "").replace(/^~/, "").trim().toLowerCase(),
        registration: String(record.r || "").trim(),
        callsign: String(record.flight || "").trim().replace(/\s+/g, ""),
        latitude: numberOrNull(record.lat),
        longitude: numberOrNull(record.lon),
        altitude_ft: record.alt_baro === "ground" ? 0 : numberOrNull(record.alt_baro),
        speed_kts: numberOrNull(record.gs),
        heading_deg: numberOrNull(record.track ?? record.true_heading ?? record.mag_heading),
        aircraft_type: String(record.t || "").trim().toUpperCase(),
        model: String(record.desc || "").trim(),
        operator: String(record.ownOp || "").trim(),
        country: String(record.origin_country || "").trim(),
        military_hint: Boolean(record.mil || militaryHint),
        squawk: String(record.squawk || "").trim(),
        on_ground: record.alt_baro === "ground" || record.airground === "G+",
    };
}

export function observationsFromReadsb(data, options) {
    if (data?.msg && data.msg !== "No error") throw new Error(String(data.msg));
    return (Array.isArray(data?.ac) ? data.ac : [])
        .map((record) => normalizeReadsbAircraft(record, options));
}
