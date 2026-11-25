import { maritimeAllocation } from "./maritime-allocations.js";
import { MILITARY_TAXONOMY } from "./military-taxonomy.js";
// AIS is an observation, not a naval registry. No name/prefix/country rule here
// confers military ownership, a ship class or a model identity.
const text = (value) => String(value ?? "").trim();
const digits = (value) => {
    const id = text(value).replace(/^IMO\s+/i, "");
    return /^\d+$/.test(id) && !/^0+$/.test(id) ? id : "";
};
const categories = new Set(["carrier", "destroyer", "frigate", "corvette", "cruiser", "submarine",
    "amphibious", "landing_ship", "patrol", "auxiliary", "logistics", "minesweeper", "intelligence", "tug"]);

export function validMmsi(value) {
    return /^\d{9}$/.test(text(value)) && !/^0+$/.test(text(value));
}

export function validImo(value) {
    const id = text(value).replace(/^IMO\s*/i, "");
    return /^[1-9]\d{6}$/.test(id) && [...id.slice(0, 6)].reduce((sum, n, index) => sum + Number(n) * (7 - index), 0) % 10 === Number(id[6]);
}

export function navalCandidateEvidence(vessel = {}) {
    const name = text(vessel.vessel_name || vessel.name).toUpperCase();
    const prefix = MILITARY_TAXONOMY.naval_prefixes.find(row => name.startsWith(row.prefix.toUpperCase() + " "));
    const reported = reportedNavalCategory(vessel);
    return { confidence: reported === "commercial" || reported === "tug" ? "unknown" : prefix || Number(vessel.ship_type || vessel.shipType) === 35 ? "candidate" : "unknown",
        prefix: prefix?.prefix || "", allocation: maritimeAllocation(vessel.mmsi),
        note: "Reported prefix, type and MID do not verify naval ownership or model identity." };
}

// Retain all matching records so contradictory evidence is never last-write-wins.
export function createNavalIdentityRegistry(records = []) {
    if (!Array.isArray(records)) throw new TypeError("Naval identity registry must be an array");
    const index = new Map();
    const validation = { records: records.length, duplicates: 0, rejected: [] };
    const seen = new Set();
    for (const [row, record] of records.entries()) {
        const ids = record?.identifiers || {};
        const valid = record?.status === "verified" && text(record.source) && Number.isFinite(Date.parse(record.verified_at))
            && (validMmsi(ids.mmsi) || validImo(ids.imo))
            && (!ids.imo || validImo(ids.imo)) && (!ids.mmsi || validMmsi(ids.mmsi))
            && (!record.valid_from || Number.isFinite(Date.parse(record.valid_from)))
            && (!record.valid_until || Number.isFinite(Date.parse(record.valid_until)));
        if (!valid) { validation.rejected.push(row); continue; }
        const signature = JSON.stringify(record);
        if (seen.has(signature)) { validation.duplicates++; continue; }
        seen.add(signature);
        for (const [kind, id] of Object.entries({ mmsi: ids.mmsi, imo: ids.imo })) {
            if (!id) continue;
            const key = `${kind}:${id}`;
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(record);
        }
    }
    return { validation, lookupCandidates(vessel) {
        const ids = navalIdentifiers(vessel);
        return [...new Set([...(index.get(`mmsi:${ids.mmsi}`) || []), ...(index.get(`imo:${ids.imo}`) || [])])];
    } };
}

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

// Reported vessel type is independent of verified ownership. Never inspect a
// vessel name, callsign, flag or name-derived frontend subtype here.
export function reportedVesselType(vessel = {}) {
    const m = vessel.metadata || {};
    const fields = [vessel.ship_type, vessel.shipType, vessel.ship_type_name, vessel.vessel_type,
        m.ship_type, m.shipType, m.ship_type_name, m.shipTypeName, m.vessel_type, m.vesselType];
    const aliases = { 'aircraft carrier': 'carrier', 'patrol vessel': 'patrol', 'patrol boat': 'patrol',
        'coast guard': 'patrol', 'coast guard cutter': 'patrol', 'naval auxiliary': 'auxiliary',
        'support ship': 'auxiliary', 'search and rescue': 'search_and_rescue', 'towing': 'tug' };
    for (const field of fields) {
        const value = text(field).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
        const category = aliases[value] || value.replace(/ /g, '_');
        if (categories.has(category) || ['cargo', 'tanker', 'passenger', 'fishing', 'search_and_rescue', 'law_enforcement', 'pilot', 'other'].includes(category)) return category;
    }
    const raw = vessel.ship_type_code ?? m.ship_type_code ?? fields.find(value => value != null && text(value) !== '');
    const code = Number(raw);
    if (code >= 70 && code <= 79) return 'cargo';
    if (code >= 80 && code <= 89) return 'tanker';
    if (code >= 60 && code <= 69) return 'passenger';
    return ({30:'fishing',31:'tug',32:'tug',50:'pilot',51:'search_and_rescue',52:'tug',55:'law_enforcement',90:'other'})[code] || 'unknown';
}

export function resolveNavalIdentity(vessel = {}, { records = [], trustEmbedded = true } = {}) {
    const m = vessel.metadata || {};
    const ids = navalIdentifiers(vessel);
    const reported = reportedNavalCategory(vessel);
    const candidates = typeof records.lookupCandidates === "function" ? records.lookupCandidates(vessel) : [...records];
    if (trustEmbedded && (vessel.identity_verification || m.identity_verification)) {
        candidates.push(vessel.identity_verification || m.identity_verification);
    }
    const anchored = candidates.filter((r) => r && r.status === "verified" && text(r.source)
        && Number.isFinite(Date.parse(r.verified_at)) && r.identifiers
        && ((/^\d{9}$/.test(ids.mmsi) && ids.mmsi === digits(r.identifiers.mmsi))
            || (validImo(ids.imo) && ids.imo === digits(r.identifiers.imo))));
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
    const category = record && categories.has(record.category) ? record.category : reportedVesselType(vessel);
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
        candidate_evidence: navalCandidateEvidence(vessel),
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
