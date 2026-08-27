const EARTH_RADIUS_KM = 6371;

function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIdentity(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function selectAircraftMilitaryCandidates(observations = []) {
    const safeObservations = Array.isArray(observations) ? observations : [];
    const militaryOnlyProviderIcaos = new Set(
        safeObservations
            .filter((item) => String(item?.source || item?.provider || "").toLowerCase() !== "opensky")
            .filter((item) => item?.military_hint === true || item?.provider_military_flag === true)
            .map((item) => normalizeIdentity(item?.icao24).toLowerCase())
            .filter(Boolean)
    );
    return safeObservations.filter((item) => {
        const source = String(item?.source || item?.provider || "").trim().toLowerCase();
        if (source !== "opensky") return true;
        const icao24 = normalizeIdentity(item?.icao24).toLowerCase();
        return item?.military_hint === true
            || item?.provider_military_flag === true
            || (icao24 && militaryOnlyProviderIcaos.has(icao24));
    });
}

export function haversineKm(a, b) {
    const lat1 = numberOrNull(a?.latitude);
    const lon1 = numberOrNull(a?.longitude);
    const lat2 = numberOrNull(b?.latitude);
    const lon2 = numberOrNull(b?.longitude);
    if ([lat1, lon1, lat2, lon2].some((value) => value == null)) return Infinity;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const x = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function isPlausiblePair(a, b, maxSpeedKts) {
    const elapsedHours = Math.abs(timestamp(a.observed_at) - timestamp(b.observed_at)) / 3_600_000;
    const distanceNm = haversineKm(a, b) / 1.852;
    if (!Number.isFinite(distanceNm)) return false;
    if (elapsedHours < (1 / 3600)) return distanceNm <= Math.max(2, maxSpeedKts / 3600);
    return (distanceNm / elapsedHours) <= maxSpeedKts;
}

function corroboration(count) {
    if (count >= 3) return "multi-source";
    if (count === 2) return "corroborated";
    return "single-source";
}

function choosePosition(observations, maxSpeedKts) {
    const positioned = observations
        .filter((item) => Number.isFinite(numberOrNull(item.latitude)) && Number.isFinite(numberOrNull(item.longitude)))
        .sort((a, b) => timestamp(b.observed_at) - timestamp(a.observed_at) || a.priority - b.priority);
    if (positioned.length <= 1) return { position: positioned[0] || null, disagreements: 0 };
    for (const candidate of positioned) {
        const support = positioned.filter((other) => other === candidate || isPlausiblePair(candidate, other, maxSpeedKts)).length;
        if (support >= Math.min(2, positioned.length)) {
            return { position: candidate, disagreements: positioned.length - support };
        }
    }
    return { position: positioned[0], disagreements: positioned.length - 1 };
}

function mergeGroup(observations, { domain, freshnessMs, maxSpeedKts, fields, identity }) {
    const newestAt = Math.max(...observations.map((item) => timestamp(item.observed_at)));
    const recent = observations.filter((item) => newestAt - timestamp(item.observed_at) <= freshnessMs);
    const usable = recent.length ? recent : observations;
    const ordered = [...usable].sort((a, b) => timestamp(b.observed_at) - timestamp(a.observed_at) || a.priority - b.priority);
    const { position, disagreements } = choosePosition(ordered, maxSpeedKts);
    if (!position) return null;
    const merged = { ...position };
    for (const field of fields) {
        const candidate = [...ordered]
            .sort((a, b) => a.priority - b.priority || timestamp(b.observed_at) - timestamp(a.observed_at))
            .find((item) => item[field] !== null && item[field] !== undefined && item[field] !== "");
        if (candidate) merged[field] = candidate[field];
    }
    const sourceObservations = [...new Map(usable.map((item) => [item.source, item])).values()]
        .sort((a, b) => a.priority - b.priority)
        .map((item) => ({
            provider: item.source,
            observed_at: item.observed_at,
            age_ms: Math.max(0, newestAt - timestamp(item.observed_at)),
            ...(item.metadata?.attribution ? { attribution: item.metadata.attribution } : {}),
        }));
    merged.domain = domain;
    merged.identity = identity;
    merged.sources = sourceObservations.map((item) => item.provider);
    merged.source_count = sourceObservations.length;
    merged.corroboration = corroboration(sourceObservations.length);
    merged.source_confidence = Math.min(95, 60 + Math.max(0, sourceObservations.length - 1) * 15 - disagreements * 5);
    merged.last_source_observations = sourceObservations;
    merged.source_disagreements = disagreements;
    merged.military_hint = usable.some((item) => item.military_hint === true);
    merged.provider_military_flag = usable.some((item) => item.provider_military_flag === true);
    delete merged.raw;
    return merged;
}

function groupByIdentity(observations, identityFor) {
    const groups = new Map();
    const ungrouped = [];
    for (const observation of observations) {
        const identity = identityFor(observation);
        if (!identity) {
            ungrouped.push(observation);
            continue;
        }
        if (!groups.has(identity)) groups.set(identity, []);
        groups.get(identity).push(observation);
    }
    return { groups, ungrouped };
}

export function mergeAircraftObservations(observations, options = {}) {
    const freshnessMs = Number(options.freshnessMs) || 90_000;
    const maxSpeedKts = Number(options.maxSpeedKts) || 1800;
    const normalized = observations.map((item) => ({
        ...item,
        source: String(item.source || item.provider || "").trim().toLowerCase(),
        provider: String(item.provider || item.source || "").trim().toLowerCase(),
        military_hint: item.military_hint === true || item.provider_military_flag === true,
        provider_military_flag: item.military_hint === true || item.provider_military_flag === true,
        icao24: normalizeIdentity(item.icao24).toLowerCase(),
        registration: normalizeIdentity(item.registration),
        callsign: normalizeIdentity(item.callsign),
        priority: Number.isFinite(item.priority) ? item.priority : 999,
    }));
    const { groups, ungrouped } = groupByIdentity(normalized, (item) => {
        if (item.icao24) return `icao:${item.icao24}`;
        if (item.registration) return `registration:${item.registration}`;
        return null;
    });
    // Callsign-only observations remain isolated unless there is exactly one nearby,
    // recent canonical group with that non-generic callsign.
    for (const item of ungrouped) {
        const callsign = item.callsign;
        const matches = callsign && callsign.length >= 4
            ? [...groups.entries()].filter(([, group]) => group.some((candidate) => candidate.callsign === callsign && isPlausiblePair(item, candidate, maxSpeedKts)))
            : [];
        if (matches.length === 1) matches[0][1].push(item);
    }
    return [...groups.entries()]
        .map(([identity, group]) => mergeGroup(group, {
            domain: "aircraft", freshnessMs, maxSpeedKts, identity,
            fields: ["icao24", "registration", "callsign", "aircraft_type", "model", "operator", "country", "squawk", "on_ground", "altitude_geom_ft", "vertical_rate_fpm", "adsb_category", "adsb_message_type", "db_flags", "position_source", "position_age_seconds"],
        }))
        .filter(Boolean);
}

export function mergeNavalObservations(observations, options = {}) {
    const freshnessMs = Number(options.freshnessMs) || 10 * 60_000;
    const maxSpeedKts = Number(options.maxSpeedKts) || 80;
    const normalized = observations.map((item) => ({
        ...item,
        source: String(item.source || item.provider || "").trim().toLowerCase(),
        provider: String(item.provider || item.source || "").trim().toLowerCase(),
        military_hint: item.military_hint === true || item.provider_military_flag === true,
        provider_military_flag: item.military_hint === true || item.provider_military_flag === true,
        mmsi: String(item.mmsi || "").replace(/\D/g, ""),
        imo: String(item.imo || "").replace(/\D/g, ""),
        callsign: normalizeIdentity(item.callsign),
        vessel_name: String(item.vessel_name || "").trim(),
        priority: Number.isFinite(item.priority) ? item.priority : 999,
    }));
    const mmsiCandidatesByImo = new Map();
    for (const item of normalized) {
        if (!item.imo || !item.mmsi) continue;
        if (!mmsiCandidatesByImo.has(item.imo)) mmsiCandidatesByImo.set(item.imo, new Set());
        mmsiCandidatesByImo.get(item.imo).add(item.mmsi);
    }
    const mmsiByImo = new Map(
        [...mmsiCandidatesByImo.entries()]
            .filter(([, mmsiValues]) => mmsiValues.size === 1)
            .map(([imo, mmsiValues]) => [imo, [...mmsiValues][0]])
    );
    const { groups, ungrouped } = groupByIdentity(normalized, (item) => {
        if (item.mmsi) return `mmsi:${item.mmsi}`;
        if (item.imo && mmsiByImo.has(item.imo)) return `mmsi:${mmsiByImo.get(item.imo)}`;
        if (item.imo) return `imo:${item.imo}`;
        return null;
    });
    for (const item of ungrouped) {
        const candidates = [...groups.entries()].filter(([, group]) => group.some((candidate) => {
            const identityMatches = (item.callsign && item.callsign === candidate.callsign)
                || (item.vessel_name && item.vessel_name.toUpperCase() === String(candidate.vessel_name || "").toUpperCase());
            return identityMatches && haversineKm(item, candidate) <= 5 && isPlausiblePair(item, candidate, maxSpeedKts);
        }));
        if (candidates.length === 1) candidates[0][1].push(item);
    }
    return [...groups.entries()]
        .map(([identity, group]) => {
            const merged = mergeGroup(group, {
            domain: "naval", freshnessMs, maxSpeedKts, identity,
            fields: ["mmsi", "imo", "callsign", "vessel_name", "ship_type", "ship_type_code", "nav_status", "operating_status", "country", "operator"],
            });
            if (merged) {
                merged.metadata = Object.assign(
                    {},
                    ...[...group]
                        .sort((a, b) => b.priority - a.priority)
                        .map((item) => item.metadata || {})
                );
            }
            return merged;
        })
        .filter(Boolean);
}
