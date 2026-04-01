// File Path: /assets/js/warzone-theaters.js
const THEATER_DEFINITIONS = [
    {
        id: "levant",
        label: "Levant Theater",
        region: "middle_east",
        lenses: ["live", "flashpoint", "all"],
        aliases: [
            "israel",
            "palestine",
            "gaza",
            "west bank",
            "lebanon",
            "syria",
            "damascus",
            "hezbollah"
        ],
        keywords: [
            "idf",
            "hamas",
            "hezbollah",
            "golan",
            "rafah",
            "southern lebanon"
        ],
        weight: 1.35
    },
    {
        id: "gulf",
        label: "Gulf Region",
        region: "middle_east",
        lenses: ["live", "standoff", "flashpoint", "all"],
        aliases: [
            "iran",
            "iraq",
            "saudi arabia",
            "uae",
            "united arab emirates",
            "qatar",
            "bahrain",
            "kuwait",
            "oman",
            "yemen",
            "red sea",
            "persian gulf",
            "gulf of oman",
            "strait of hormuz"
        ],
        keywords: [
            "houthi",
            "iranian",
            "gc",
            "islamic revolutionary guard",
            "shipping lane",
            "tanker",
            "hormuz"
        ],
        weight: 1.25
    },
    {
        id: "ukraine-front",
        label: "Ukraine Front",
        region: "ukraine",
        lenses: ["live", "flashpoint", "all"],
        aliases: [
            "ukraine",
            "russia",
            "crimea",
            "donetsk",
            "luhansk",
            "kharkiv",
            "kherson",
            "zaporizhzhia",
            "black sea"
        ],
        keywords: [
            "drone strike",
            "missile barrage",
            "frontline",
            "artillery",
            "black sea fleet"
        ],
        weight: 1.4
    },
    {
        id: "kashmir-corridor",
        label: "Kashmir Corridor",
        region: "south_asia",
        lenses: ["standoff", "flashpoint", "all"],
        aliases: [
            "india",
            "pakistan",
            "kashmir",
            "loc",
            "line of control",
            "jammu",
            "srinagar"
        ],
        keywords: [
            "cross-border fire",
            "loc",
            "air incursion",
            "ceasefire violation"
        ],
        weight: 1.2
    },
    {
        id: "taiwan-strait",
        label: "Taiwan Strait",
        region: "east_asia",
        lenses: ["standoff", "flashpoint", "all"],
        aliases: [
            "taiwan",
            "china",
            "taipei",
            "beijing",
            "fujian",
            "taiwan strait",
            "south china sea"
        ],
        keywords: [
            "pla",
            "sortie",
            "adiz",
            "naval drill",
            "encirclement"
        ],
        weight: 1.25
    },
    {
        id: "korean-peninsula",
        label: "Korean Peninsula",
        region: "east_asia",
        lenses: ["standoff", "flashpoint", "all"],
        aliases: [
            "north korea",
            "south korea",
            "pyongyang",
            "seoul",
            "dmz",
            "korean peninsula",
            "sea of japan"
        ],
        keywords: [
            "ballistic missile",
            "launch test",
            "dmz",
            "joint drill"
        ],
        weight: 1.2
    },
    {
        id: "sahel-horn",
        label: "Sahel / Horn of Africa",
        region: "africa",
        lenses: ["live", "flashpoint", "all"],
        aliases: [
            "mali",
            "niger",
            "burkina faso",
            "chad",
            "sudan",
            "south sudan",
            "ethiopia",
            "eritrea",
            "somalia",
            "djibouti",
            "horn of africa",
            "sahel"
        ],
        keywords: [
            "insurgent",
            "militia",
            "coup",
            "border clash",
            "paramilitary"
        ],
        weight: 1.15
    },
    {
        id: "western-pacific",
        label: "Western Pacific",
        region: "east_asia",
        lenses: ["standoff", "flashpoint", "all"],
        aliases: [
            "japan",
            "philippines",
            "okinawa",
            "east china sea",
            "philippine sea"
        ],
        keywords: [
            "carrier group",
            "maritime patrol",
            "island chain",
            "intercept"
        ],
        weight: 1.05
    }
];
function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\w\s/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}
function collectEventText(event = {}) {
    const fields = [
        event.country,
        event.countryName,
        event.state,
        event.region,
        event.city,
        event.location,
        event.location_label,
        event.impact_label,
        event.origin_label,
        event.name,
        event.title,
        event.summary,
        event.description,
        event.category,
        event.subcategory,
        event.subtype,
        event.type,
        event.weapon_type,
        event.actor,
        event.actor_side,
        event.target,
        event.target_side,
        Array.isArray(event.tags) ? event.tags.join(" ") : ""
    ];
    return normalizeText(uniqueStrings(fields).join(" "));
}
function getTheaterMatchScore(definition, haystack) {
    if (!haystack) return 0;
    let score = 0;
    for (const alias of definition.aliases || []) {
        const token = normalizeText(alias);
        if (token && haystack.includes(token)) score += 4;
    }
    for (const keyword of definition.keywords || []) {
        const token = normalizeText(keyword);
        if (token && haystack.includes(token)) score += 2;
    }
    return score;
}
export function resolveEventTheater(event = {}) {
    const haystack = collectEventText(event);
    if (!haystack) return null;
    let best = null;
    let bestScore = 0;
    for (const definition of THEATER_DEFINITIONS) {
        const score = getTheaterMatchScore(definition, haystack);
        if (score > bestScore) {
            best = definition;
            bestScore = score;
        }
    }
    if (!best || bestScore <= 0) return null;
    return {
        id: best.id,
        label: best.label,
        region: best.region,
        lenses: best.lenses,
        weight: best.weight,
        score: bestScore
    };
}
export function theaterMatchesRegion(theater, activeRegion) {
    if (!activeRegion || activeRegion.id === "global") return true;
    const regionId = activeRegion.id;
    const theaterRegion = theater?.region;
    if (theaterRegion === regionId) return true;
    if (regionId === "levant" && theaterRegion === "middle_east") return true;
    if (regionId === "ukraine" && theaterRegion === "europe") return true;
    return false;
}
export function getTheaterDefinitions() {
    return THEATER_DEFINITIONS;
}
export function getTheaterById(theaterId) {
    return THEATER_DEFINITIONS.find((item) => item.id === theaterId) || null;
}
