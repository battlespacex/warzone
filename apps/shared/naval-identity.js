// AIS is an observation, not a naval registry. No name/prefix/country rule here
// confers military ownership, a ship class or a model identity.
const text = (value) => String(value ?? "").trim();
const digits = (value) => text(value).replace(/\D/g, "").replace(/^0+$/, "");
const categories = new Set(["carrier", "destroyer", "frigate", "corvette", "cruiser", "submarine",
    "amphibious", "landing_ship", "patrol", "auxiliary", "logistics", "minesweeper", "intelligence", "tug"]);

export function navalIdentifiers(vessel = {}) {
    const m = vessel.metadata || {};
    return { mmsi: digits(vessel.mmsi || m.mmsi), imo: digits(vessel.imo || vessel.imoNumber || m.imo_number || m.imo),
        callsign: text(vessel.callsign || vessel.callSign || m.call_sign || m.callsign).toUpperCase() };
}

export function reportedNavalCategory(vessel = {}) {
    const m = vessel.metadata || {};
    const value = vessel.ship_type ?? vessel.shipType ?? m.ship_type;
    const code = Number(vessel.ship_type_code ?? vessel.shipTypeCode ?? m.ship_type_code ?? value);
    if ([31, 32, 52].includes(code) || /\b(tug|towing)\b/i.test(text(value))) return "tug";
    if ((code >= 60 && code <= 89) || [30, 36, 37].includes(code)
        || /\b(cargo|tanker|ferry|passenger|yacht|fishing|container|bulk carrier)\b/i.test(text(value))) return "commercial";
    return "unknown";
}

export function resolveNavalIdentity(vessel = {}, { records = [], trustEmbedded = true } = {}) {
    const m = vessel.metadata || {};
    const ids = navalIdentifiers(vessel);
    const reported = reportedNavalCategory(vessel);
    const candidates = [...records];
    if (trustEmbedded && (vessel.identity_verification || m.identity_verification)) {
        candidates.push(vessel.identity_verification || m.identity_verification);
    }
    const anchored = candidates.filter((r) => r && r.status === "verified" && text(r.source)
        && Number.isFinite(Date.parse(r.verified_at)) && r.identifiers
        && ((/^\d{9}$/.test(ids.mmsi) && ids.mmsi === digits(r.identifiers.mmsi))
            || (/^[1-9]\d{6}$/.test(ids.imo) && ids.imo === digits(r.identifiers.imo))));
    const at = Date.parse(vessel.observedAt || vessel.observed_at || vessel.occurred_at || m.observed_at || "");
    const valid = anchored.filter((r) => (!r.valid_from || (Number.isFinite(at) && at >= Date.parse(r.valid_from)))
        && (!r.valid_until || (Number.isFinite(at) && at <= Date.parse(r.valid_until))));
    const conflicts = Array.isArray(m.identity_conflicts) ? [...m.identity_conflicts] : [];
    for (const r of valid) for (const key of ["mmsi", "imo", "callsign"]) {
        const expected = key === "callsign" ? text(r.identifiers[key]).toUpperCase() : digits(r.identifiers[key]);
        if (ids[key] && expected && ids[key] !== expected) conflicts.push(`${key}_conflict`);
    }
    for (const r of valid) {
        if ((reported === "tug" || reported === "commercial") && r.military_status === "military"
            && !["tug", "auxiliary", "logistics"].includes(r.category)) conflicts.push("ais_type_conflict");
        const length = Number(vessel.length_m || m.length_m);
        if (length > 0 && Number(r.length_m) > 0 && Math.max(length / r.length_m, r.length_m / length) > 2) {
            conflicts.push("dimensions_conflict");
        }
    }
    if (new Set(valid.map((r) => JSON.stringify([r.military_status, r.operator, r.naval_force, r.ship_class, r.category]))).size > 1) {
        conflicts.push("registry_conflict");
    }
    const record = conflicts.length ? null : valid[0] || null;
    const status = record && ["military", "commercial"].includes(record.military_status)
        ? record.military_status : (reported === "tug" || reported === "commercial") ? "commercial" : "unknown";
    const category = record && categories.has(record.category) ? record.category : reported === "tug" ? "tug" : "unknown";
    return {
        identifiers: ids, military_status: conflicts.length ? "unknown" : status,
        verification_status: conflicts.length ? "conflict" : record ? "verified" : "unverified",
        category, ship_class: record ? text(record.ship_class) : "",
        operator: record ? text(record.operator) : "", naval_force: record ? text(record.naval_force) : "",
        flag_state: record ? text(record.flag_state) : text(vessel.flag_country || m.flag_country || vessel.country || m.country),
        vessel_name: record ? text(record.vessel_name) : "",
        source: record ? text(record.source) : "", verified_at: record ? record.verified_at : null,
        length_m: record && Number(record.length_m) > 0 && Number(record.length_m) <= 500 ? Number(record.length_m) : null,
        identity_verification: record, conflicts,
    };
}

// Only verified identity selects specialized silhouettes. The frontend's generic
// GLB fallback is a visual placeholder and never grants vessel class or affiliation.
export function selectVerifiedNavalModel(identity) {
    if (identity?.verification_status !== "verified" || identity.military_status !== "military") return "";
    const shipClass = identity.ship_class.toLowerCase();
    if (identity.category === "destroyer" && /\bzumwalt\b/.test(shipClass)) return "Vessel-Zumwalt";
    if (identity.category === "frigate") return "Vessel-Frigate";
    if (identity.category === "intelligence") return "Vessel-ISR";
    if (identity.category === "submarine") return "Submarine-SSN";
    if (identity.category === "carrier") {
        const force = identity.naval_force.toLowerCase();
        if (force === "us navy") return "Carrier-US";
        if (force === "royal navy") return "Carrier-HMS";
        if (force === "french navy") return "Carrier-France";
        if (force === "pla navy") return "Carrier-Fujian";
        if (force === "russian navy") return "Carrier-Russian";
    }
    if (identity.category === "amphibious") return "Carrier-LHD";
    return "";
}
