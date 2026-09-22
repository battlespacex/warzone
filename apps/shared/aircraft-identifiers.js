export const AIRLINE_IATA_TO_ICAO = Object.freeze({
    AA: "AAL", AC: "ACA", AF: "AFR", BA: "BAW", CX: "CPA", DL: "DAL",
    EK: "UAE", EY: "ETD", FR: "RYR", KL: "KLM", LH: "DLH", QF: "QFA",
    PK: "PIA", QR: "QTR", SQ: "SIA", TK: "THY", U2: "EZY", UA: "UAL", W6: "WZZ", WS: "WJA",
});

const AIRLINE_ICAO_TO_IATA = Object.freeze(
    Object.fromEntries(Object.entries(AIRLINE_IATA_TO_ICAO).map(([iata, icao]) => [icao, iata]))
);

export function normalizeAircraftIdentifier(value = "") {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function getAircraftIdentifierCandidates(value = "") {
    const normalized = normalizeAircraftIdentifier(value);
    if (!normalized) return [];
    const candidates = new Set([normalized]);
    const iataMatch = normalized.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
    if (iataMatch && AIRLINE_IATA_TO_ICAO[iataMatch[1]]) {
        candidates.add(`${AIRLINE_IATA_TO_ICAO[iataMatch[1]]}${iataMatch[2]}`);
    }
    const icaoMatch = normalized.match(/^([A-Z]{3})(\d{1,4}[A-Z]?)$/);
    if (icaoMatch && AIRLINE_ICAO_TO_IATA[icaoMatch[1]]) {
        candidates.add(`${AIRLINE_ICAO_TO_IATA[icaoMatch[1]]}${icaoMatch[2]}`);
    }
    return [...candidates];
}

export function getAircraftIdentifierAliases(value = "") {
    const aliases = new Set();
    getAircraftIdentifierCandidates(value).forEach((candidate) => {
        aliases.add(candidate);
        const knownIata = Object.keys(AIRLINE_IATA_TO_ICAO).find((code) => candidate.startsWith(code) && /^\d/.test(candidate.slice(code.length)));
        const knownIcao = Object.keys(AIRLINE_ICAO_TO_IATA).find((code) => candidate.startsWith(code) && /^\d/.test(candidate.slice(code.length)));
        const prefix = knownIata || knownIcao || "";
        const flightMatch = prefix ? [candidate, prefix, candidate.slice(prefix.length)] : null;
        if (flightMatch) aliases.add(`${flightMatch[1]} ${flightMatch[2]}`);
    });
    return [...aliases];
}
