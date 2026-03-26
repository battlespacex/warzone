// apps/worker/src/adsb-worker.js
//
// Expanded military ADS-B tracker — OpenSky Network
// Focus: military-only aircraft and helicopters, with broader global coverage.
// Runs every 5 minutes via the main worker cron.
//
// Notes:
// - OpenSky state vectors do NOT reliably expose aircraft model/type for every aircraft.
// - Detection therefore uses a mix of:
//   1) military ICAO hex ranges
//   2) military callsign prefixes / patterns
//   3) operator / country heuristics
// - Classification aims to cover major military categories across top air forces:
//   fighters, bombers, awacs, isr, tankers, transports, maritime patrol, helicopters, uav
//
// Output: events inserted into Supabase `events` table, category = "military"
//         subcategory = fighter / bomber / awacs / isr / tanker / transport / maritime_patrol / helicopter / uav / military

import fetch from "node-fetch";
import { supabase } from "./supabase.js";

// ───────────────────────────────────────────────────────────────────────────────
// Military ICAO hex ranges
// Broad military-oriented allocations plus public community-known allocations.
// These are useful, but not perfect. Callsign logic is also used.
// ───────────────────────────────────────────────────────────────────────────────

const MILITARY_ICAO_RANGES = [
    // United States
    [0xAE0000, 0xAEFFFF],
    // United Kingdom
    [0x43C000, 0x43CFFF],
    [0x43E000, 0x43EFFF],
    // France
    [0x3B0000, 0x3B7FFF],
    // Germany
    [0x3C0000, 0x3CFFFF],
    // Italy
    [0x3D0000, 0x3DFFFF],
    // Spain
    [0x340000, 0x34FFFF],
    // Netherlands
    [0x480000, 0x487FFF],
    // Belgium
    [0x448000, 0x44FFFF],
    // Poland
    [0x488000, 0x48FFFF],
    // Sweden
    [0x4A8000, 0x4AFFFF],
    // Norway
    [0x47C000, 0x47CFFF],
    // Turkey
    [0x4B8000, 0x4B8FFF],
    // Israel
    [0x738000, 0x73FFFF],
    // Russia (broad, can include non-military)
    [0x100000, 0x1FFFFF],
    // Ukraine (broad, heuristic support)
    [0x500000, 0x50FFFF],
    // Pakistan
    [0x760000, 0x76FFFF],
    // India (partial / broad)
    [0x800000, 0x83FFFF],
    // China (partial / broad)
    [0x780000, 0x7BFFFF],
    // Japan
    [0x840000, 0x847FFF],
    // South Korea
    [0x718000, 0x71FFFF],
    // Australia
    [0x7C0000, 0x7C3FFF],
    // Canada
    [0xC00000, 0xC03FFF],
    // UAE
    [0x896000, 0x896FFF],
    // Saudi Arabia (broad helper)
    [0x710000, 0x717FFF],
    // Egypt (broad helper)
    [0x010000, 0x017FFF],
    // Qatar (broad helper)
    [0x06A000, 0x06AFFF],
    // NATO AWACS known
    [0x3C6540, 0x3C6540],
];

function isMilitaryIcao(hexStr) {
    if (!hexStr || hexStr.length < 6) return false;
    const val = parseInt(hexStr, 16);
    if (!Number.isFinite(val)) return false;
    return MILITARY_ICAO_RANGES.some(([lo, hi]) => val >= lo && val <= hi);
}

// ───────────────────────────────────────────────────────────────────────────────
// Callsign and operator libraries
// ───────────────────────────────────────────────────────────────────────────────

const MILITARY_CALLSIGN_PREFIXES = [
    // US / NATO / generic tactical
    "RCH", "REACH", "FORTE", "BOXER", "HAVOC", "DARK", "FURY", "VIPER", "DUKE",
    "BARON", "KNIFE", "DOOM", "GHOST", "SKULL", "REAPER", "DRACO", "PANTHER",
    "HAWK", "EAGLE", "COBRA", "RAPTOR", "SABRE", "LANCE", "SWORD", "DAGGER",
    "SPEAR", "ARROW", "MAGMA", "IRON", "STEEL", "ANVIL", "HAMMER", "OMAHA",
    "BLUE", "GOLD", "NACHO", "TEXACO", "SHELL", "ROGUE", "HOMER", "LAGR",
    "MC", "SVF", "HKY", "QID", "RRR", "ASCOT", "COMET", "TARTAN", "COTAM",
    "GAF", "NATO", "NAEW", "AWACS", "SENTRY", "RIVET", "POSEIDON", "ORION",
    "GLOBEMASTER", "HERCULES", "ATLAS", "TANKER", "JSTAR", "SIGINT", "INTEL",
    "DRAGON", "VIPR", "PAT", "ARMY", "NAVY", "MARINE", "VMFA", "VFA", "NAVAIR",

    // Russia / CIS style
    "RFF", "VVS", "RF", "RUAF", "BKR", "VQ", "SU", "MIG", "TU", "IL",

    // China
    "PLAAF", "PLANAF", "KJ", "JH", "J", "Y", "H", "Z",

    // India / Pakistan
    "IAF", "PAF", "JF", "TEJ", "RINO", "RAJ", "SURAJ", "INDIA", "PAKAF",

    // Israel / Middle East
    "IAF", "QAF", "UAF", "RSAF", "EAF", "IRIAF", "IRGC", "RJAF", "KAF", "BAF", "OAF",

    // Europe / other
    "RCH", "ASCOT", "RAFALE", "TYPHOON", "EURO", "GRIPEN", "LUFT", "ARMEE"
];

const MILITARY_CALLSIGN_PATTERNS = [
    /^[A-Z]{2,8}\d{1,4}[A-Z0-9]?$/,

    // Special mission / role hints
    /AWACS/i,
    /SENTRY/i,
    /RIVET/i,
    /COBRA\s?BALL/i,
    /DRAGON\s?LADY/i,
    /GLOBAL\s?HAWK/i,
    /JSTAR/i,
    /POSEIDON/i,
    /ORION/i,
    /HERCULES/i,
    /GLOBEMASTER/i,
    /STRATOTANKER/i,
    /EXTENDER/i,
    /PEGASUS/i,
    /PHALCON/i,
    /ERIEYE/i,

    // Major platform family hints in callsigns when present
    /F35/i,
    /F22/i,
    /F16/i,
    /F15/i,
    /F18/i,
    /B52/i,
    /B1/i,
    /B2/i,
    /SU27/i,
    /SU30/i,
    /SU34/i,
    /SU35/i,
    /SU57/i,
    /MIG29/i,
    /MIG31/i,
    /J10/i,
    /J11/i,
    /J16/i,
    /J20/i,
    /JF17/i,
    /RAFALE/i,
    /TYPHOON/i,
    /GRIPEN/i,
    /MIRAGE/i,
    /TEJAS/i,
    /APACHE/i,
    /BLACKHAWK/i,
    /CHINOOK/i
];

const OPERATOR_HINTS = [
    "AIR FORCE",
    "AEROSPACE FORCES",
    "AIR AND SPACE FORCE",
    "ARMEE DE L'AIR",
    "AERONAUTICA MILITARE",
    "ROYAL AIR FORCE",
    "US AIR FORCE",
    "USAF",
    "US NAVY",
    "NAVY",
    "ARMY",
    "MARINES",
    "LUFTWAFFE",
    "NATO",
    "ISRAEL AIR FORCE",
    "RUSSIAN AIR FORCE",
    "RUSSIAN AEROSPACE FORCES",
    "PAKISTAN AIR FORCE",
    "INDIAN AIR FORCE",
    "PLAAF",
    "PLANAF",
    "PEOPLE'S LIBERATION ARMY AIR FORCE",
    "TURKISH AIR FORCE",
    "ROYAL SAUDI AIR FORCE",
    "SAUDI AIR FORCE",
    "EMIRATES AIR FORCE",
    "QATAR EMIRI AIR FORCE",
    "EGYPTIAN AIR FORCE",
    "IRANIAN AIR FORCE",
    "IRGC AEROSPACE",
    "JAPAN AIR SELF DEFENSE FORCE",
    "JASDF",
    "ROKAF",
    "ROYAL AUSTRALIAN AIR FORCE",
    "RAAF",
    "ROYAL CANADIAN AIR FORCE",
    "RCAF",
    "UKRAINIAN AIR FORCE",
    "FRENCH AIR FORCE",
    "GERMAN AIR FORCE",
    "ITALIAN AIR FORCE"
];

function isMilitaryCallsign(callsign) {
    if (!callsign) return false;
    const cs = callsign.trim().toUpperCase();
    if (!cs || cs.length < 2) return false;

    if (MILITARY_CALLSIGN_PREFIXES.some((p) => cs.startsWith(p))) return true;
    if (MILITARY_CALLSIGN_PATTERNS.some((r) => r.test(cs))) return true;

    return false;
}

function operatorLooksMilitary(country) {
    const text = String(country || "").toUpperCase();
    if (!text) return false;
    return OPERATOR_HINTS.some((hint) => text.includes(hint));
}

// ───────────────────────────────────────────────────────────────────────────────
// Role classification
// Broad library for major aircraft families and mission roles.
// Since OpenSky usually does not expose exact model, callsign-based coverage is used.
// ───────────────────────────────────────────────────────────────────────────────

const ROLE_RULES = [
    {
        role: "awacs",
        patterns: [
            /AWACS/, /SENTRY/, /NAEW/, /PHALCON/, /ERIEYE/,
            /\bE3\b/, /\bE7\b/, /\bE8\b/, /\bA50\b/, /\bA100\b/,
            /\bKJ200\b/, /\bKJ500\b/, /\bZDK03\b/, /GLOBAL.?EYE/, /SAAB.?340/, /SAAB.?2000/
        ]
    },
    {
        role: "tanker",
        patterns: [
            /TANKER/, /TEXACO/, /SHELL/, /STRATOTANKER/, /EXTENDER/, /PEGASUS/,
            /\bKC10\b/, /\bKC30\b/, /\bKC46\b/, /\bKC135\b/, /\bIL78\b/, /\bA330MRTT\b/, /\bA310MRTT\b/
        ]
    },
    {
        role: "isr",
        patterns: [
            /RIVET/, /COBRA.?BALL/, /DRAGON.?LADY/, /GLOBAL.?HAWK/, /JSTAR/, /SIGINT/, /INTEL/,
            /\bRC135\b/, /\bEP3\b/, /\bRQ4\b/, /\bIL20\b/, /\bTU214R\b/, /FORTE/
        ]
    },
    {
        role: "maritime_patrol",
        patterns: [
            /POSEIDON/, /ORION/, /SUBHUNTER/, /ASW/,
            /\bP8\b/, /\bP8A\b/, /\bP3\b/, /\bP3C\b/, /\bIL38\b/, /\bTU142\b/, /\bATLANTIQUE\b/, /\bKA31\b/
        ]
    },
    {
        role: "bomber",
        patterns: [
            /\bB52\b/, /\bB1\b/, /\bB2\b/, /\bTU22\b/, /\bTU95\b/, /\bTU160\b/, /\bH6\b/
        ]
    },
    {
        role: "fighter",
        patterns: [
            /\bF14\b/, /\bF15\b/, /\bF16\b/, /\bF18\b/, /\bF22\b/, /\bF35\b/, /\bA10\b/, /\bAV8\b/, /\bEA18\b/,
            /\bSU24\b/, /\bSU25\b/, /\bSU27\b/, /\bSU30\b/, /\bSU30MKI\b/, /\bSU30MKK\b/, /\bSU30SM\b/, /\bSU33\b/, /\bSU34\b/, /\bSU35\b/, /\bSU57\b/,
            /\bMIG21\b/, /\bMIG23\b/, /\bMIG25\b/, /\bMIG27\b/, /\bMIG29\b/, /\bMIG31\b/,
            /\bJ7\b/, /\bJ8\b/, /\bJ10\b/, /\bJ11\b/, /\bJ15\b/, /\bJ16\b/, /\bJ20\b/, /\bJH7\b/,
            /\bJF17\b/, /\bTEJAS\b/, /\bLCA\b/, /\bRAFALE\b/, /\bTYPHOON\b/, /\bGRIPEN\b/, /\bMIRAGE\b/, /\bEUROFIGHTER\b/,
            /RAPTOR/, /VIPER/, /EAGLE/, /COBRA/, /PANTHER/, /SABRE/
        ]
    },
    {
        role: "transport",
        patterns: [
            /HERCULES/, /ATLAS/, /GLOBEMASTER/, /STRATEGIC.?AIRLIFT/, /TRANSPORT/,
            /\bC17\b/, /\bC130\b/, /\bC27J\b/, /\bC295\b/, /\bC5\b/, /\bA400\b/, /\bA124\b/, /\bAN12\b/, /\bAN22\b/, /\bAN26\b/, /\bAN72\b/, /\bIL76\b/, /\bY20\b/
        ]
    },
    {
        role: "helicopter",
        patterns: [
            /APACHE/, /CHINOOK/, /BLACKHAWK/, /HIND/, /HAVOC/, /ALLIGATOR/, /HIP/,
            /\bAH1\b/, /\bAH64\b/, /\bCH47\b/, /\bUH60\b/, /\bV22\b/, /\bMI8\b/, /\bMI17\b/, /\bMI24\b/, /\bMI25\b/, /\bMI28\b/, /\bMI35\b/, /\bKA52\b/, /\bZ10\b/, /\bZ19\b/, /\bZ20\b/
        ]
    },
    {
        role: "uav",
        patterns: [
            /UAV/, /DRONE/, /MQ9/, /MQ1/, /BAYRAKTAR/, /AKINCI/, /SHAHED/, /WING.?LOONG/, /CH.?4/
        ]
    }
];

function classifyAircraft(callsign, icao, country) {
    const cs = String(callsign || "").toUpperCase();
    const cc = String(country || "").toUpperCase();

    for (const rule of ROLE_RULES) {
        if (rule.patterns.some((rx) => rx.test(cs))) {
            return rule.role;
        }
    }

    const icaoInt = parseInt(icao || "0", 16);

    // Strong US military ICAO fallback
    if (icaoInt >= 0xAE0000 && icaoInt <= 0xAEFFFF) return "fighter";

    // Country/operator fallback
    if (operatorLooksMilitary(cc)) return "military";

    return "military";
}

// ───────────────────────────────────────────────────────────────────────────────
// OpenSky fetch
// ───────────────────────────────────────────────────────────────────────────────

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

function buildOpenSkyURL() {
    const user = process.env.OPENSKY_USER;
    const pass = process.env.OPENSKY_PASS;
    if (user && pass) {
        return `https://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@opensky-network.org/api/states/all`;
    }
    return OPENSKY_URL;
}

async function fetchOpenSkyStates() {
    const url = buildOpenSkyURL();
    const res = await fetch(url, {
        headers: { "Accept": "application/json" },
        timeout: 20000,
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenSky HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.states || [];
}

// OpenSky state vector indices:
// 0 icao24, 1 callsign, 2 origin_country, 5 lon, 6 lat, 7 baro_altitude,
// 8 on_ground, 9 velocity, 10 true_track, 13 geo_altitude, 14 squawk

function parseState(state) {
    const icao = String(state[0] || "").toLowerCase();
    const callsign = String(state[1] || "").trim();
    const country = String(state[2] || "");
    const lon = state[5];
    const lat = state[6];
    const alt = state[7] ?? state[13];
    const onGround = state[8];
    const speed = state[9];
    const heading = state[10];
    const squawk = String(state[14] || "");

    return { icao, callsign, country, lon, lat, alt, onGround, speed, heading, squawk };
}

// ───────────────────────────────────────────────────────────────────────────────
// Deduplication
// ───────────────────────────────────────────────────────────────────────────────

const SEEN_CACHE = new Map();
const SEEN_TTL_MS = 45 * 60 * 1000;

function pruneSeen() {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [k, v] of SEEN_CACHE) {
        if (v < cutoff) SEEN_CACHE.delete(k);
    }
}

function wasSeen(icao) {
    const t = SEEN_CACHE.get(icao);
    return t && (Date.now() - t) < SEEN_TTL_MS;
}

function markSeen(icao) {
    SEEN_CACHE.set(icao, Date.now());
}

// ───────────────────────────────────────────────────────────────────────────────
// Event builder / Supabase
// ───────────────────────────────────────────────────────────────────────────────

function buildAdsbEvent(aircraft) {
    const { icao, callsign, country, lon, lat, alt, speed, heading, squawk } = aircraft;

    const subcat = classifyAircraft(callsign, icao, country);
    const altFt = alt ? Math.round(alt * 3.28084) : null;
    const speedKt = speed ? Math.round(speed * 1.944) : null;

    const title = callsign
        ? `${subcat.toUpperCase()} ${callsign} — ${country}`
        : `${subcat.toUpperCase()} ${icao.toUpperCase()} — ${country}`;

    const summary = [
        callsign ? `Callsign: ${callsign}` : null,
        subcat ? `Role: ${subcat}` : null,
        altFt ? `Altitude: ${altFt.toLocaleString()} ft` : null,
        speedKt ? `Speed: ${speedKt} kt` : null,
        heading != null ? `Heading: ${Math.round(heading)}°` : null,
        squawk ? `Squawk: ${squawk}` : null,
        country ? `Origin: ${country}` : null,
    ].filter(Boolean).join(" · ");

    return {
        source_key: `adsb-${icao}`,
        source_name: "ADS-B / OpenSky Network",
        category: "military",
        subcategory: subcat,
        title,
        summary,
        lat,
        lon,
        severity: ["fighter", "bomber", "awacs", "tanker"].includes(subcat) ? "high" : "medium",
        confidence: "high",
        occurred_at: new Date().toISOString(),
        report_type: "signal",
        metadata: {
            icao,
            callsign: callsign || null,
            role: subcat,
            altitude_ft: altFt,
            speed_kts: speedKt,
            heading: heading != null ? Math.round(heading) : null,
            squawk: squawk || null,
            country,
            on_ground: false,
        },
    };
}

async function upsertAdsbEvents(events) {
    if (!events.length) return;

    const { error } = await supabase
        .from("events")
        .upsert(events, { onConflict: "source_key", ignoreDuplicates: false });

    if (error) {
        console.error("[adsb] Supabase upsert error:", error.message);
    } else {
        console.log(`[adsb] Upserted ${events.length} military aircraft events`);
    }
}

function buildAdsbTrack(aircraft) {
    const { icao, callsign, country, lon, lat, alt, speed, heading, squawk } = aircraft;

    const subcat = classifyAircraft(callsign, icao, country);
    const altFt = alt ? Math.round(alt * 3.28084) : null;
    const speedKt = speed ? Math.round(speed * 1.944) : null;

    const title = callsign
        ? `${subcat.toUpperCase()} ${callsign} — ${country}`
        : `${subcat.toUpperCase()} ${icao.toUpperCase()} — ${country}`;

    return {
        track_key: `adsb-${icao}`,
        track_type: "aircraft",
        category: "military",
        subcategory: subcat,
        source_name: "ADS-B / OpenSky Network",
        title,
        lat,
        lon,
        altitude_ft: altFt,
        speed_kts: speedKt,
        heading_deg: heading != null ? Math.round(heading) : null,
        region: null,
        country: country || null,
        status: "active",
        occurred_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
            icao,
            callsign: callsign || null,
            role: subcat,
            altitude_ft: altFt,
            speed_kts: speedKt,
            heading: heading != null ? Math.round(heading) : null,
            squawk: squawk || null,
            country,
            on_ground: false,
        },
    };
}

async function upsertAdsbTracks(tracks) {
    if (!tracks.length) return;

    const { error } = await supabase
        .from("tracks")
        .upsert(tracks, { onConflict: "track_key", ignoreDuplicates: false });

    if (error) {
        console.error("[adsb] Supabase tracks upsert error:", error.message);
    } else {
        console.log(`[adsb] Upserted ${tracks.length} military aircraft tracks`);
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────

export async function runAdsbWorker() {
    const label = "[adsb]";
    console.log(`${label} Starting ADS-B military scan...`);

    pruneSeen();

    let states;
    try {
        states = await fetchOpenSkyStates();
    } catch (err) {
        console.error(`${label} OpenSky fetch failed:`, err.message);
        return;
    }

    console.log(`${label} Fetched ${states.length} total aircraft states`);

    const military = [];
    for (const state of states) {
        const a = parseState(state);

        if (a.onGround) continue;
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
        if (wasSeen(a.icao)) continue;

        const militaryMatch =
            isMilitaryIcao(a.icao) ||
            isMilitaryCallsign(a.callsign) ||
            operatorLooksMilitary(a.country);

        if (!militaryMatch) continue;

        military.push(a);
        markSeen(a.icao);
    }

    console.log(`${label} Detected ${military.length} military aircraft`);

    const toInsert = military.map(buildAdsbEvent);
    const toTracks = military.map(buildAdsbTrack);

    await upsertAdsbEvents(toInsert);
    await upsertAdsbTracks(toTracks);
}
