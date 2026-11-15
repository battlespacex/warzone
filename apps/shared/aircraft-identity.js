import { normalizeIcao24 } from "./aircraft-identifiers.js";
import { MILITARY_TAXONOMY } from "./military-taxonomy.js";

// State of registry, never military ownership. ICAO Annex 10 Table 9-1,
// reproduced in ICAO APIRG/26 WP03F12 Appendix A, inspected 2026-11-15.
export const AIRCRAFT_ALLOCATION_SOURCE = "https://www.icao.int/sites/default/files/ESAF/APIRG/APIRG-26/EN/WPs-ENG/APIRG26-WP03F12-App-Guidelines-for-ICAO-24-Bits-Adresses-Assignment.pdf";
const allocations = [
    ["A00000", "AFFFFF", "US", "United States"], ["780000", "7BFFFF", "CN", "China"],
    ["100000", "1FFFFF", "RU", "Russia"], ["800000", "83FFFF", "IN", "India"],
    ["760000", "767FFF", "PK", "Pakistan"], ["400000", "43FFFF", "GB", "United Kingdom"],
    ["380000", "3BFFFF", "FR", "France"], ["3C0000", "3FFFFF", "DE", "Germany"],
    ["300000", "33FFFF", "IT", "Italy"], ["4B8000", "4BFFFF", "TR", "Türkiye"],
    ["840000", "87FFFF", "JP", "Japan"], ["718000", "71FFFF", "KR", "South Korea"],
    ["7C0000", "7FFFFF", "AU", "Australia"], ["C00000", "C3FFFF", "CA", "Canada"],
    ["710000", "717FFF", "SA", "Saudi Arabia"], ["896000", "896FFF", "AE", "United Arab Emirates"],
    ["738000", "73FFFF", "IL", "Israel"], ["730000", "737FFF", "IR", "Iran"],
    ["010000", "017FFF", "EG", "Egypt"], ["8A0000", "8A7FFF", "ID", "Indonesia"],
    ["E40000", "E7FFFF", "BR", "Brazil"], ["340000", "37FFFF", "ES", "Spain"],
    ["480000", "487FFF", "NL", "Netherlands"], ["488000", "48FFFF", "PL", "Poland"],
    ["4A8000", "4AFFFF", "SE", "Sweden"], ["478000", "47FFFF", "NO", "Norway"],
    ["458000", "45FFFF", "DK", "Denmark"], ["460000", "467FFF", "FI", "Finland"],
    ["468000", "46FFFF", "GR", "Greece"], ["508000", "50FFFF", "UA", "Ukraine"],
    ["008000", "00FFFF", "ZA", "South Africa"], ["768000", "76FFFF", "SG", "Singapore"],
    ["750000", "757FFF", "MY", "Malaysia"], ["880000", "887FFF", "TH", "Thailand"],
    ["888000", "88FFFF", "VN", "Vietnam"], ["758000", "75FFFF", "PH", "Philippines"],
    ["06A000", "06A3FF", "QA", "Qatar"], ["706000", "706FFF", "KW", "Kuwait"],
    ["702000", "702FFF", "BD", "Bangladesh"], ["E00000", "E3FFFF", "AR", "Argentina"],
    ["E80000", "E80FFF", "CL", "Chile"], ["0AC000", "0ACFFF", "CO", "Colombia"],
    ["0D0000", "0D7FFF", "MX", "Mexico"], ["490000", "497FFF", "PT", "Portugal"],
].map(([start, end, iso2, country]) => ({ start: parseInt(start, 16), end: parseInt(end, 16), iso2, country }));

export function getAircraftAllocation(value) {
    const id = normalizeIcao24(value);
    if (!id) return null;
    const address = parseInt(id, 16);
    const row = allocations.find(item => address >= item.start && address <= item.end);
    return row ? { country: row.country, iso2: row.iso2, source: AIRCRAFT_ALLOCATION_SOURCE } : null;
}

const militaryOperator = /(?:\b(?:air forces?|aerospace forces?|navy|naval aviation|army|marines|marine corps|coast guard|military)$|^(?:usaf|usmc|usn|raf|rcaf|jmsdf|luftwaffe|aeronautica militare)$)/i;
const serviceNames = new Set(MILITARY_TAXONOMY.countries.flatMap(country => country.air_services.map(name => name.trim().toLowerCase())));
const isMilitaryOperator = operator => militaryOperator.test(operator) || String(operator).split(";").some(name => serviceNames.has(name.trim().toLowerCase()));
const militaryType = /\b(?:F[-/ ]?(?:16|18|22|35)|SU[- ]?(?:30|35)|RAFALE|TYPHOON|J[- ]?10|JF[- ]?17|AH[- ]?64|UH[- ]?60|CH[- ]?47|C[- ]?(?:130|17)|KC[- ]?135|E[- ]?3|P[- ]?8)\b/i;
const canonicalRegistration = value => String(value || "").toUpperCase().replace(/[\s-]/g, "");

export function resolveAircraftIdentity(observation = {}, { record = null } = {}) {
    const icao24 = normalizeIcao24(observation.icao24 ?? observation.icao ?? observation.metadata?.icao);
    const allocation = getAircraftAllocation(icao24);
    const evidence = [];
    const conflicts = [];
    const currentReg = canonicalRegistration(observation.registration);
    if (record && record.icao24 === icao24) {
        if (currentReg && record.registration && currentReg !== canonicalRegistration(record.registration)) conflicts.push("registration_conflict");
        evidence.push({ kind: "exact_icao24", source: record.source || "plane-alert-db", source_url: record.source_url,
            version: record.source_version, checked_at: record.checked_at, verified_at: record.verified_at || null,
            license: record.license || "ODbL-1.0", attribution: "SDR-Enthusiasts/plane-alert-db contributors" });
    } else record = null;
    const operator = observation.operator || record?.operator || "";
    const provider = observation.provider_military_flag === true || observation.military_hint === true;
    if (provider) evidence.push({ kind: "provider_military_classification", source: observation.source || observation.provider || "reported" });
    if (isMilitaryOperator(operator)) evidence.push({ kind: "reported_military_operator", source: observation.source || "reported" });
    const type = [observation.aircraft_type, observation.model].filter(Boolean).join(" ");
    if (militaryType.test(type)) evidence.push({ kind: "type_hint_only", source: "reported" });
    const confidence = conflicts.length ? "possible_military" : record || provider || isMilitaryOperator(operator)
        ? record?.verification_status === "verified" && record.source && Number.isFinite(Date.parse(record.verified_at)) ? "verified_military" : "strongly_supported_military"
        : evidence.length ? "possible_military" : "unknown";
    return { icao24, confidence, qualified: !conflicts.length && ["verified_military", "strongly_supported_military"].includes(confidence),
        country: allocation?.country || observation.country || "", allocation, evidence, conflicts,
        registration: observation.registration || record?.registration || "", operator,
        aircraft_type: observation.aircraft_type || record?.aircraft_type || "" };
}
