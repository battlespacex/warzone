// apps/worker/src/adsb-worker.js
//
// Military ADS-B tracker — ADS-B One (api.adsb.one/v2/mil)
// Free, no API key, no commercial restrictions, community-run.
//
// Improvements over OpenSky version:
//   - ADS-B One /v2/mil returns ONLY military aircraft — no filtering needed
//   - Response includes aircraft type code (t), registration (r), operator (ownOp)
//   - Full ICAO type → human readable model name lookup table
//   - ICAO hex → country/registration prefix lookup
//   - Altitude already in feet (no conversion needed)
//   - Speed already in knots
//   - Much better coverage: 400-500 military aircraft vs ~50 from OpenSky

import fetch from "node-fetch";
import { supabase } from "./supabase.js";

// ─── ICAO Type Code → Human Readable Model Name ────────────────────────────
// ADS-B One returns the ICAO aircraft type designator in the `t` field.
// This maps those codes to proper names shown in the UI.
const ICAO_TYPE_NAMES = {
    // US Fighters / Strike
    "F16": "F-16 Fighting Falcon",
    "F16C": "F-16C Fighting Falcon",
    "F16D": "F-16D Fighting Falcon",
    "F15": "F-15 Eagle",
    "F15C": "F-15C Eagle",
    "F15D": "F-15D Eagle",
    "F15E": "F-15E Strike Eagle",
    "F18": "F/A-18 Hornet",
    "F18C": "F/A-18C Hornet",
    "F18D": "F/A-18D Hornet",
    "F18E": "F/A-18E Super Hornet",
    "F18F": "F/A-18F Super Hornet",
    "F22": "F-22 Raptor",
    "F22A": "F-22A Raptor",
    "F35": "F-35 Lightning II",
    "F35A": "F-35A Lightning II",
    "F35B": "F-35B Lightning II",
    "F35C": "F-35C Lightning II",
    "A10": "A-10 Thunderbolt II",
    "A10C": "A-10C Thunderbolt II",
    "AV8B": "AV-8B Harrier II",
    "EA18": "EA-18G Growler",
    "F14": "F-14 Tomcat",
    // US Bombers
    "B1": "B-1B Lancer",
    "B1B": "B-1B Lancer",
    "B2": "B-2 Spirit",
    "B2A": "B-2A Spirit",
    "B52": "B-52 Stratofortress",
    "B52H": "B-52H Stratofortress",
    // US Tankers
    "KC10": "KC-10 Extender",
    "KC30": "KC-30 / A330 MRTT",
    "KC46": "KC-46 Pegasus",
    "K35R": "KC-135 Stratotanker",
    "KC135": "KC-135 Stratotanker",
    // US Transports
    "C17": "C-17 Globemaster III",
    "C17A": "C-17A Globemaster III",
    "C130": "C-130 Hercules",
    "C130J": "C-130J Super Hercules",
    "C5": "C-5 Galaxy",
    "C5M": "C-5M Super Galaxy",
    "C27J": "C-27J Spartan",
    "C295": "C-295 Airlifter",
    // US ISR / Special Mission
    "RC135": "RC-135 Rivet Joint",
    "E3": "E-3 Sentry (AWACS)",
    "E3TF": "E-3 Sentry (AWACS)",
    "E3CF": "E-3 Sentry (AWACS)",
    "E7": "E-7A Wedgetail (AEW)",
    "E7A": "E-7A Wedgetail (AEW)",
    "E8": "E-8C Joint STARS",
    "EP3": "EP-3 Aries II (SIGINT)",
    "P8": "P-8A Poseidon",
    "P8A": "P-8A Poseidon",
    "P3": "P-3 Orion",
    "P3C": "P-3C Orion",
    "RQ4": "RQ-4 Global Hawk (UAV)",
    "U2": "U-2 Dragon Lady",
    "SR71": "SR-71 Blackbird",
    // US Helicopters
    "AH64": "AH-64 Apache",
    "AH1": "AH-1 Cobra/Viper",
    "UH60": "UH-60 Black Hawk",
    "H60": "H-60 Black Hawk",
    "SH60": "SH-60 Seahawk",
    "MH60": "MH-60 Black Hawk",
    "CH47": "CH-47 Chinook",
    "H47": "CH-47 Chinook",
    "CH53": "CH-53 Stallion",
    "MH53": "MH-53 Pave Low / Sea Dragon",
    "V22": "V-22 Osprey",
    "MV22": "MV-22 Osprey",
    "CV22": "CV-22 Osprey",
    // Russian Aircraft
    "SU24": "Su-24 Fencer",
    "SU25": "Su-25 Frogfoot",
    "SU27": "Su-27 Flanker",
    "SU30": "Su-30 Flanker-C",
    "SU33": "Su-33 Flanker-D",
    "SU34": "Su-34 Fullback",
    "SU35": "Su-35S Flanker-E",
    "SU57": "Su-57 Felon",
    "MIG21": "MiG-21 Fishbed",
    "MIG29": "MiG-29 Fulcrum",
    "MIG31": "MiG-31 Foxhound",
    "MIG35": "MiG-35 Fulcrum-F",
    "TU22": "Tu-22M Backfire",
    "TU95": "Tu-95 Bear",
    "TU160": "Tu-160 Blackjack",
    "TU134": "Tu-134",
    "TU154": "Tu-154",
    "IL76": "Il-76 Candid",
    "IL78": "Il-78 Midas (Tanker)",
    "IL20": "Il-20 Coot-A (SIGINT)",
    "IL38": "Il-38 May (Maritime Patrol)",
    "IL96": "Il-96",
    "A50": "A-50 Mainstay (AWACS)",
    "A100": "A-100 Premier (AWACS)",
    "AN12": "An-12 Cub",
    "AN22": "An-22 Antei",
    "AN26": "An-26 Curl",
    "AN72": "An-72 Coaler",
    "AN124": "An-124 Ruslan",
    "MI8": "Mi-8 Hip",
    "MI17": "Mi-17 Hip-H",
    "MI24": "Mi-24 Hind",
    "MI25": "Mi-25 Hind-D",
    "MI28": "Mi-28 Havoc",
    "MI28N": "Mi-28N Havoc",
    "MI28NM": "Mi-28NM Havoc",
    "MI35": "Mi-35 Hind-E",
    "KA50": "Ka-50 Hokum-A",
    "KA52": "Ka-52 Alligator",
    "KA27": "Ka-27 Helix",
    // Chinese Aircraft
    "J10": "J-10 Vigorous Dragon",
    "J11": "J-11 Flanker-L",
    "J15": "J-15 Flying Shark",
    "J16": "J-16 Strike Flanker",
    "J20": "J-20 Mighty Dragon",
    "H6": "H-6 Badger (Bomber)",
    "H6K": "H-6K Badger (Bomber)",
    "JH7": "JH-7 Flying Leopard",
    "KJ200": "KJ-200 (AEW)",
    "KJ500": "KJ-500 (AEW)",
    "Y20": "Y-20 Kunpeng (Transport)",
    "Z10": "Z-10 Attack Helicopter",
    "Z19": "Z-19 Harbin (Scout)",
    // European Fighters
    "EUFI": "Eurofighter Typhoon",
    "TYFN": "Eurofighter Typhoon",
    "RAFA": "Dassault Rafale",
    "RAFM": "Dassault Rafale M",
    "TORN": "Panavia Tornado",
    "GRHP": "BAE Harrier GR",
    "JAS3": "JAS 39 Gripen",
    "GRIF": "JAS 39 Gripen",
    "M2K": "Mirage 2000",
    "M2KN": "Mirage 2000N",
    "M2KC": "Mirage 2000C",
    "F1": "Mirage F1",
    "ALPH": "Alpha Jet",
    // Other Notable
    "JF17": "JF-17 Thunder",
    "TEJA": "HAL Tejas",
    "F7": "Chengdu F-7",
    "T50": "KAI T-50 Golden Eagle",
    "HAWK": "BAE Hawk",
    "MB339": "Aermacchi MB-339",
    "G222": "Alenia G.222",
    "CN235": "CASA CN-235",
    "A400": "Airbus A400M Atlas",
    "A330": "A330 MRTT",
    "KJ2K": "KJ-2000 (AWACS)",
};

// ─── ICAO Hex Prefix → Country ──────────────────────────────────────────────
// Maps the first 3 hex chars of ICAO address to country
const ICAO_COUNTRY_MAP = [
    { prefix: "AE", country: "United States", flag: "🇺🇸" },
    { prefix: "43", country: "United Kingdom", flag: "🇬🇧" },
    { prefix: "3B", country: "France", flag: "🇫🇷" },
    { prefix: "3C", country: "Germany", flag: "🇩🇪" },
    { prefix: "3D", country: "Italy", flag: "🇮🇹" },
    { prefix: "34", country: "Spain", flag: "🇪🇸" },
    { prefix: "48", country: "Netherlands", flag: "🇳🇱" },
    { prefix: "44", country: "Belgium", flag: "🇧🇪" },
    { prefix: "45", country: "Denmark", flag: "🇩🇰" },
    { prefix: "47", country: "Norway", flag: "🇳🇴" },
    { prefix: "4A", country: "Sweden", flag: "🇸🇪" },
    { prefix: "46", country: "Finland", flag: "🇫🇮" },
    { prefix: "4B", country: "Turkey", flag: "🇹🇷" },
    { prefix: "49", country: "Poland", flag: "🇵🇱" },
    { prefix: "73", country: "Israel", flag: "🇮🇱" },
    { prefix: "10", country: "Russia", flag: "🇷🇺" },
    { prefix: "11", country: "Russia", flag: "🇷🇺" },
    { prefix: "12", country: "Russia", flag: "🇷🇺" },
    { prefix: "13", country: "Russia", flag: "🇷🇺" },
    { prefix: "14", country: "Russia", flag: "🇷🇺" },
    { prefix: "15", country: "Russia", flag: "🇷🇺" },
    { prefix: "50", country: "Ukraine", flag: "🇺🇦" },
    { prefix: "76", country: "Pakistan", flag: "🇵🇰" },
    { prefix: "80", country: "India", flag: "🇮🇳" },
    { prefix: "81", country: "India", flag: "🇮🇳" },
    { prefix: "78", country: "China", flag: "🇨🇳" },
    { prefix: "79", country: "China", flag: "🇨🇳" },
    { prefix: "7A", country: "China", flag: "🇨🇳" },
    { prefix: "7B", country: "China", flag: "🇨🇳" },
    { prefix: "84", country: "Japan", flag: "🇯🇵" },
    { prefix: "71", country: "South Korea / Saudi Arabia", flag: "🇰🇷" },
    { prefix: "7C", country: "Australia", flag: "🇦🇺" },
    { prefix: "C0", country: "Canada", flag: "🇨🇦" },
    { prefix: "89", country: "UAE", flag: "🇦🇪" },
    { prefix: "06", country: "Qatar", flag: "🇶🇦" },
    { prefix: "01", country: "Egypt", flag: "🇪🇬" },
    { prefix: "70", country: "Iran", flag: "🇮🇷" },
    { prefix: "74", country: "Saudi Arabia", flag: "🇸🇦" },
    { prefix: "C8", country: "Brazil", flag: "🇧🇷" },
    { prefix: "68", country: "South Africa", flag: "🇿🇦" },
];

function getCountryFromIcao(hex) {
    if (!hex || hex.length < 2) return null;
    const upper = hex.toUpperCase();
    // Try 2-char prefix first
    const match2 = ICAO_COUNTRY_MAP.find(e => upper.startsWith(e.prefix));
    if (match2) return match2;
    return null;
}

// ─── Aircraft Role Classification ──────────────────────────────────────────
// Uses the ADS-B One `t` field (ICAO type code) first, falls back to callsign

const FIGHTER_CODES = new Set([
    "F16", "F16C", "F16D", "F15", "F15C", "F15D", "F15E", "F18", "F18C", "F18D", "F18E", "F18F",
    "F22", "F22A", "F35", "F35A", "F35B", "F35C", "A10", "A10C", "AV8B", "EA18", "F14", "F4",
    "EUFI", "TYFN", "RAFA", "RAFM", "TORN", "JAS3", "GRIF", "M2K", "M2KN", "M2KC", "F1",
    "SU24", "SU25", "SU27", "SU30", "SU33", "SU34", "SU35", "SU57",
    "MIG21", "MIG29", "MIG31", "MIG35", "J10", "J11", "J15", "J16", "J20", "JH7",
    "JF17", "TEJA", "T50", "F5", "F5E", "MIRF",
]);

const BOMBER_CODES = new Set([
    "B1", "B1B", "B2", "B2A", "B52", "B52H", "TU22", "TU95", "TU160", "H6", "H6K",
]);

const TANKER_CODES = new Set([
    "KC10", "KC30", "KC46", "K35R", "KC135", "IL78", "A330", "A310", "KA30",
]);

const AWACS_CODES = new Set([
    "E3", "E3TF", "E3CF", "E7", "E7A", "E8", "A50", "A100", "KJ200", "KJ500", "KJ2K",
]);

const ISR_CODES = new Set([
    "RC135", "EP3", "P8", "P8A", "P3", "P3C", "U2", "IL20", "IL38", "SR71",
]);

const UAV_CODES = new Set([
    "MQ1", "MQ9", "MQ9A", "MQ9B", "RQ1", "RQ4", "MQ4C", "RQ7", "RQ170",
]);

const TRANSPORT_CODES = new Set([
    "C17", "C17A", "C130", "C130J", "C5", "C5M", "C27J", "C295", "A400", "AN12", "AN22",
    "AN26", "AN72", "AN124", "IL76", "Y20", "CN235", "G222",
]);

const HELI_CODES = new Set([
    "AH64", "AH1", "UH60", "H60", "SH60", "MH60", "CH47", "H47", "V22", "MV22", "CV22",
    "CH53", "MH53", "MI8", "MI17", "MI24", "MI25", "MI28", "MI28N", "MI28NM", "MI35", "KA50", "KA52", "KA27", "Z10", "Z19", "SA342",
    "AS532", "EC725", "NH90", "H225", "EC665", "H145",
]);

const TRAINER_CODES = new Set([
    "T6", "T6A", "T6B", "T6C", "T38", "T38A", "T38C", "L29", "L39", "L59",
    "Hawk", "HAWK", "PC7", "PC9", "PC21", "G115", "G120", "KT1", "CJ6",
    "K8", "JL8", "M311", "M345", "MB326", "MB339", "SF26",
]);

const CIVILIAN_AIRLINER_CODES = new Set([
    "A220", "A318", "A319", "A320", "A20N", "A21N", "A321", "A330", "A332", "A333", "A338",
    "A339", "A340", "A342", "A343", "A345", "A346", "A350", "A359", "A35K", "A380", "A388",
    "B712", "B717", "B721", "B722", "B731", "B732", "B733", "B734", "B735", "B736", "B737",
    "B738", "B739", "B37M", "B38M", "B39M", "B3XM", "B741", "B742", "B743", "B744", "B748",
    "B752", "B753", "B762", "B763", "B764", "B772", "B77L", "B77W", "B778", "B779", "B787",
    "B788", "B789", "B78X", "E170", "E175", "E190", "E195", "CRJ2", "CRJ7", "CRJ9", "CRJX",
    "AT72", "AT75", "DH8A", "DH8B", "DH8C", "DH8D", "BCS1", "BCS3",
]);

const TRAINING_ACTIVITY_PATTERNS = [
    /\bTRAINER\b/i,
    /\bBASIC TRAINER\b/i,
    /\bPRIMARY TRAINER\b/i,
    /\bADVANCED TRAINER\b/i,
    /\bJET TRAINER\b/i,
    /\bFLIGHT TRAINING\b/i,
    /\bPILOT TRAINING\b/i,
    /\bTRAINING AIRCRAFT\b/i,
    /\bTRAINING (FLIGHT|ACTIVITY|MISSION|SORTIE)\b/i,
    /\bMILITARY TRAINING AIRCRAFT\b/i,
];
const TRAINER_SPECIAL_OPERATIONAL_PATTERNS = [
    /\bFA-?50\b/i,
    /\bYAK(?:OVLEV)?[-\s]?130\b/i,
    /\bM-?346FA\b/i,
    /\bA-?29\b/i,
    /\bSUPER TUCANO\b/i,
    /\bAT-?6\b/i,
    /\bWOLVERINE\b/i,
    /\bBLACK ?HAWK\b/i,
    /\bSEAHAWK\b/i,
    /\bHAWKEYE\b/i,
];
const TRAINER_PLATFORM_PATTERNS = [
    /\b(?:AERO\s+)?L-?(?:29|39|59)\b/i,
    /\bDELFIN\b/i,
    /\bALBATROS\b/i,
    /\bSUPER ALBATROS\b/i,
    /\bALPHA JET\b/i,
    /\b(?:BAE\s+)?HAWK(?:\s+(?:T[12]|100|200))?\b/i,
    /(^|[^A-Z0-9])T-?6[ABC]?\b/i,
    /\bTEXAN II\b/i,
    /\bBEECHCRAFT\s+T-?6\b/i,
    /\bCT-?156\b/i,
    /\bHARVARD II\b/i,
    /\b(?:PILATUS\s+)?PC-?(?:7|9|21)(?:\s*(?:MKII|M))?\b/i,
    /\bGROB\s+G-?(?:115|120A?|120TP)\b/i,
    /\bG-?(?:115|120A?|120TP)\b/i,
    /(^|[^A-Z0-9])T-?38[AC]?\b/i,
    /\bTALON\b/i,
    /\b(?:BOEING\s+)?T-?7A?\b/i,
    /\bRED HAWK\b/i,
    /\b(?:KAI\s+)?KT-?1\b/i,
    /\bWOONGBI\b/i,
    /\b(?:HONGDU\s+|NANCHANG\s+)?CJ-?6\b/i,
    /\bYAK(?:OVLEV)?[-\s]?(?:52|152)\b/i,
    /\bPZL-?130\b/i,
    /\bORLIK\b/i,
    /\bSF-?260(?:EA)?\b/i,
    /\bDIAMOND\s+DA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bDA(?:20|40|42)\b.*\bTRAINER\b/i,
    /\bEMB-?312\b/i,
    /\bTUCANO\b/i,
    /\bK-?8\b/i,
    /\bJL-?8\b/i,
    /\bKARAKORUM\b/i,
    /\bM-?311\b/i,
    /\bM-?345\b/i,
    /\bM-?346(?!FA)\b/i,
    /\bMB-?(?:326|339)\b/i,
    /\bJET PROVOST\b/i,
    /\bSCOTTISH AVIATION BULLDOG\b/i,
    /\bBULLDOG\b/i,
    /\bCT-?114\b/i,
    /\bTUTOR\b/i,
    /\bJL-?10\b/i,
    /\bL-?15\b/i,
];

function classifyByTypeCode(typeCode) {
    if (!typeCode) return null;
    const t = typeCode.toUpperCase();
    if (FIGHTER_CODES.has(t)) return "fighter";
    if (BOMBER_CODES.has(t)) return "bomber";
    if (TANKER_CODES.has(t)) return "tanker";
    if (AWACS_CODES.has(t)) return "awacs";
    if (UAV_CODES.has(t)) return "uav";
    if (ISR_CODES.has(t)) return "isr";
    if (TRANSPORT_CODES.has(t)) return "transport";
    if (HELI_CODES.has(t)) return "helicopter";
    if (TRAINER_CODES.has(t)) return "trainer";
    return null;
}

const CALLSIGN_ROLE_RULES = [
    { role: "awacs", patterns: [/AWACS/i, /SENTRY/i, /NAEW/i, /PHALCON/i, /ERIEYE/i, /\bE3\b/i, /\bE7\b/i, /KJ/i] },
    { role: "tanker", patterns: [/TEXACO/i, /SHELL/i, /TANKER/i, /EXTENDER/i, /PEGASUS/i, /\bKC/i] },
    { role: "uav", patterns: [/GLOBAL.?HAWK/i, /REAPER/i, /PREDATOR/i, /GENERAL.?ATOMIC/i, /GA.?ASI/i, /SKY.?GUARDIAN/i, /SEA.?GUARDIAN/i, /PROTECTOR/i] },
    { role: "isr", patterns: [/RIVET/i, /COBRA.?BALL/i, /DRAGON.?LADY/i, /JSTAR/i, /FORTE/i, /POSEIDON/i, /ORION/i] },
    { role: "bomber", patterns: [/\bB52\b/i, /\bB1\b/i, /\bB2\b/i, /\bTU160\b/i, /\bTU95\b/i] },
    { role: "transport", patterns: [/REACH/i, /RCH/i, /ASCOT/i, /ATLAS/i, /HERCULES/i, /GLOBEMASTER/i] },
    { role: "fighter", patterns: [/\bF35\b/i, /\bF22\b/i, /\bF16\b/i, /\bF15\b/i, /\bF18\b/i, /RAPTOR/i, /TYPHOON/i, /RAFALE/i, /GRIPEN/i] },
    { role: "helicopter", patterns: [/APACHE/i, /BLACKHAWK/i, /CHINOOK/i, /OSPREY/i] },
];

function classifyByCallsign(callsign) {
    if (!callsign) return null;
    const cs = callsign.toUpperCase();
    for (const rule of CALLSIGN_ROLE_RULES) {
        if (rule.patterns.some(rx => rx.test(cs))) return rule.role;
    }
    return null;
}

function classifyByModelName(modelName = "") {
    const haystack = String(modelName || "").toUpperCase();
    if (!haystack) return null;
    if (/(AWACS|AEW|WEDGETAIL|HAWKEYE|SENTRY|E-3\b|E3\b|E-7\b|E7\b|A-50\b|A50\b|PHALCON|ERIEYE|KJ-200\b|KJ200\b|KJ-500\b|KJ500\b|KJ-2000\b|KJ2000\b)/.test(haystack)) return "awacs";
    if (/(UAV\b|UCAV\b|UAS\b|DRONE\b|MQ-?1\b|MQ-?9[AB]?\b|RQ-?1\b|RQ-?4\b|MQ-?4C\b|GLOBAL HAWK|TRITON|REAPER|PREDATOR|GENERAL ATOMIC|GA-?ASI|SKYGUARDIAN|SKY GUARDIAN|SEAGUARDIAN|SEA GUARDIAN|PROTECTOR(?: RG-?1)?)/.test(haystack)) return "uav";
    if (/(RIVET JOINT|COBRA BALL|COMBAT SENT|RECON|RECONNAISSANCE|SURVEILLANCE|POSEIDON|ORION|RC-135\b|RC135\b|EP-3\b|EP3\b|P-8\b|P8\b|P-3\b|P3\b)/.test(haystack)) return "recon";
    if (/(ISR\b|GLOBAL HAWK|TRITON|JSTARS|E-8\b|E8\b|RQ-4\b|RQ4\b|SPECIAL MISSION)/.test(haystack)) return "isr";
    if (/(TANKER|REFUEL|REFUELLER|PEGASUS|EXTENDER|STRATOTANKER|KC-135\b|KC135\b|KC-46\b|KC46\b|KC-10\b|KC10\b|A330 MRTT\b|MRTT\b|VOYAGER\b|IL-78\b|IL78\b|YY-20\b|YY20\b)/.test(haystack)) return "tanker";
    if (/(TRANSPORT|AIRLIFT|CARGO|LOGISTICS|GLOBEMASTER|HERCULES|ATLAS\b|A400M\b|C-17\b|C17\b|C-5\b|C5\b|C-130\b|HC-130\b|MC-130\b|C130\b|C-40\b|C40\b|AN-124\b|AN124\b|AN-12\b|AN12\b|IL-76\b|IL76\b|Y-20\b|Y20\b|CN-235\b|CN235\b|C295\b)/.test(haystack)) return "transport";
    if (/(HELICOPTER|BLACK HAWK|BLACKHAWK|APACHE|CHINOOK|OSPREY|SEAHAWK|SUPER STALLION|KING STALLION|UH-60\b|UH60\b|HH-60\b|HH60\b|MH-60\b|MH60\b|H-60\b|H60\b|CH-47\b|CH47\b|CH-53\b|CH53\b|V-22\b|V22\b|MI-8\b|MI8\b|MI-17\b|MI17\b|MI-24\b|MI24\b|MI-28(?:NM|N)?\b|MI28(?:NM|N)?\b|MI-35\b|MI35\b|KA-27\b|KA27\b|KA-50\b|KA50\b|HOKUM\b|KA-52\b|KA52\b)/.test(haystack)) return "helicopter";
    if (/(BOMBER|B-1\b|B1\b|B-2\b|B2\b|B-52\b|B52\b|TU-95\b|TU95\b|TU-160\b|TU160\b|H-6\b|H6\b|AC-130\b|AC130\b|SPECTRE|SPOOKY)/.test(haystack)) return "bomber";
    if (isExcludedTrainerAircraftText(haystack)) return "trainer";
    if (/(FIGHTER|INTERCEPTOR|MULTIROLE|HORNET|SUPER HORNET|STRIKE EAGLE|RAPTOR|LIGHTNING II|WARTHOG|TYPHOON|EUROFIGHTER|RAFALE|GRIPEN|MIRAGE|TOMCAT|F-15\b|F15\b|F-16\b|F16\b|F-18\b|F18\b|FA-18\b|F\/A-18\b|F-22\b|F22\b|F-35\b|F35\b|A-10\b|A10\b|SU-27\b|SU27\b|SU-30\b|SU30\b|SU-35\b|SU35\b|MIG-29\b|MIG29\b|MIG-31\b|MIG31\b|J-10\b|J10\b|J-16\b|J16\b|J-20\b|J20\b|TEJAS\b|JF-17\b|JF17\b)/.test(haystack)) return "fighter";
    return null;
}

function classifyAircraft(typeCode, callsign, icao, modelName = "") {
    return classifyByTypeCode(typeCode)
        || classifyByCallsign(callsign)
        || classifyByModelName(modelName)
        || "military";
}
function isExcludedTrainerAircraftText(text = "") {
    const haystack = String(text || "");
    if (!haystack) return false;
    const hasTrainingActivity = TRAINING_ACTIVITY_PATTERNS.some((pattern) => pattern.test(haystack));
    if (
        !hasTrainingActivity &&
        TRAINER_SPECIAL_OPERATIONAL_PATTERNS.some((pattern) => pattern.test(haystack))
    ) {
        return false;
    }
    return hasTrainingActivity || TRAINER_PLATFORM_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isExcludedTrainerAircraft(a = {}) {
    return isExcludedTrainerAircraftText([
        a.typeCode,
        a.modelName,
        a.operator,
        a.callsign,
        a.reg,
        a.country,
    ].filter(Boolean).join(" "));
}

const MILITARY_AIRCRAFT_OVERRIDE_PATTERNS = [
    /AIR FORCE/i,
    /\bUSAF\b/i,
    /\bRAF\b/i,
    /\bRCAF\b/i,
    /\bRNAF\b/i,
    /\bIAF\b/i,
    /\bPAF\b/i,
    /\bUAEAF\b/i,
    /NAVY/i,
    /NAVAL/i,
    /ARMY/i,
    /MARINES/i,
    /COAST GUARD/i,
    /MRTT/i,
    /VOYAGER/i,
    /STRATOTANKER/i,
    /EXTENDER/i,
    /PEGASUS/i,
    /AWACS/i,
    /\bAEW\b/i,
    /WEDGETAIL/i,
    /SENTRY/i,
    /PHALCON/i,
    /ERIEYE/i,
    /POSEIDON/i,
    /ORION/i,
    /RIVET JOINT/i,
    /COBRA BALL/i,
    /GLOBAL HAWK/i,
    /TRITON/i,
    /SPECIAL MISSION/i,
    /HERCULES/i,
    /GLOBEMASTER/i,
    /BLACK HAWK/i,
    /BLACKHAWK/i,
    /APACHE/i,
    /CHINOOK/i,
    /SEAHAWK/i,
    /OSPREY/i,
    /HAWKEYE/i,
    /STALLION/i,
    /\bC-17\b/i,
    /\bC17\b/i,
    /\bC-130\b/i,
    /\bC130\b/i,
    /\bKC-135\b/i,
    /\bKC135\b/i,
    /\bKC-46\b/i,
    /\bKC46\b/i,
    /\bKC-10\b/i,
    /\bKC10\b/i,
    /\bP-8\b/i,
    /\bP8\b/i,
    /\bE-3\b/i,
    /\bE3\b/i,
    /\bE-7\b/i,
    /\bE7\b/i,
    /\bRC-135\b/i,
    /\bRC135\b/i,
    /\bF-35\b/i,
    /\bF35\b/i,
    /\bF-16\b/i,
    /\bF16\b/i,
];

function hasMilitaryAircraftOverride(a = {}, role = "") {
    if (["fighter", "bomber", "awacs", "isr", "recon", "tanker", "helicopter", "uav", "drone"].includes(String(role || "").toLowerCase())) {
        return true;
    }
    const haystack = [
        a.typeCode,
        a.modelName,
        a.operator,
        a.callsign,
        a.reg,
    ]
        .filter(Boolean)
        .join(" ");
    return MILITARY_AIRCRAFT_OVERRIDE_PATTERNS.some((pattern) => pattern.test(haystack));
}

function isLikelyCivilianAirliner(a = {}, role = "") {
    const typeCode = String(a.typeCode || "").trim().toUpperCase();
    const haystack = [
        a.modelName,
        a.operator,
        a.callsign,
        a.reg,
    ]
        .filter(Boolean)
        .join(" ")
        .toUpperCase();

    if (hasMilitaryAircraftOverride(a, role)) return false;

    if (CIVILIAN_AIRLINER_CODES.has(typeCode)) return true;

    return /(AIRBUS\s+A-?(220|318|319|320|321|330|340|350|380)\b|BOEING\s+7(17|27|37|47|57|67|77|87)\b|EMBRAER\s+E-?(170|175|190|195)\b|CRJ[- ]?(200|700|900|1000)\b|ATR[- ]?7(2|5)\b|DASH ?8\b)/.test(haystack);
}

// ─── ADS-B One Fetch ────────────────────────────────────────────────────────

const AIRCRAFT_FEED_URLS = [
    process.env.AIRCRAFT_FEED_URL || "https://api.airplanes.live/v2/mil",
    "https://api.adsb.one/v2/mil",
];

async function fetchAdsbOneMilitary() {
    const errors = [];
    for (const url of AIRCRAFT_FEED_URLS) {
        try {
            const res = await fetch(url, {
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "stratops-warzone/1.0",
                },
                timeout: 25000,
            });

            if (!res.ok) {
                const body = await res.text().catch(() => "");
                throw new Error(`${url} HTTP ${res.status}: ${body.slice(0, 200)}`);
            }

            const data = await res.json();
            if (data.msg && data.msg !== "No error") {
                throw new Error(`${url} error: ${data.msg}`);
            }

            return Array.isArray(data.ac) ? data.ac : [];
        } catch (err) {
            errors.push(err.message);
        }
    }
    throw new Error(errors.join(" | "));
}

// ─── Parse ADS-B One Aircraft Record ──────────────────────────────────────
// ADS-B One fields (all already in correct units):
// hex      - ICAO 24-bit address
// flight   - callsign (trimmed)
// r        - registration (tail number)
// t        - ICAO aircraft type code
// desc     - type description
// ownOp    - owner/operator name
// lat, lon - position
// alt_baro - barometric altitude (FEET — already converted)
// gs       - ground speed (KNOTS — already converted)
// track    - true heading
// squawk   - squawk code
// mil      - true if military flag set
// category - ADS-B emitter category

function parseAdsbOneAircraft(ac) {
    const icao = String(ac.hex || "").toLowerCase().trim();
    const callsign = String(ac.flight || "").trim().replace(/\s+/g, "");
    const reg = String(ac.r || "").trim();
    const typeCode = String(ac.t || "").trim().toUpperCase();
    const desc = String(ac.desc || "").trim();
    const operator = String(ac.ownOp || "").trim();
    const lat = Number(ac.lat);
    const lon = Number(ac.lon);
    const altFt = ac.alt_baro != null ? Math.round(Number(ac.alt_baro)) : null;
    const speedKt = ac.gs != null ? Math.round(Number(ac.gs)) : null;
    const heading = ac.track != null ? Math.round(Number(ac.track)) : null;
    const squawk = String(ac.squawk || "").trim();
    const onGround = ac.alt_baro === "ground" || altFt === 0;

    // Enrich: get human-readable model name
    const modelName = ICAO_TYPE_NAMES[typeCode] || desc || typeCode || null;

    // Enrich: get country from ICAO hex
    const countryInfo = getCountryFromIcao(icao);
    const country = operator
        ? null  // use operator instead if available
        : (countryInfo?.country || ac.origin_country || null);

    return {
        icao,
        callsign,
        reg,
        typeCode,
        modelName,
        operator,
        country: countryInfo?.country || ac.origin_country || "Unknown",
        flag: countryInfo?.flag || "",
        lat,
        lon,
        altFt,
        speedKt,
        heading,
        squawk,
        onGround,
    };
}

// ─── Deduplication Cache ────────────────────────────────────────────────────

const SEEN_CACHE = new Map();
const SEEN_TTL_MS = 45 * 60 * 1000; // 45 min — don't re-insert same aircraft

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

// ─── Build Supabase Payloads ────────────────────────────────────────────────

function buildAdsbEvent(a) {
    const role = classifyAircraft(a.typeCode, a.callsign, a.icao, a.modelName);

    // Build a clean, informative title
    // Priority: ModelName > typeCode > callsign > ICAO hex
    const displayName = a.modelName || a.typeCode || a.callsign || a.icao.toUpperCase();
    const displayId = a.callsign || a.reg || a.icao.toUpperCase();
    const displayOrg = a.operator || a.country;

    const title = `${a.flag} ${displayName} — ${displayId} (${displayOrg})`.trim();

    const summaryParts = [
        a.modelName ? `Aircraft: ${a.modelName}` : null,
        a.typeCode ? `Type: ${a.typeCode}` : null,
        a.callsign ? `Callsign: ${a.callsign}` : null,
        a.reg ? `Reg: ${a.reg}` : null,
        a.operator ? `Operator: ${a.operator}` : null,
        a.country ? `Country: ${a.country}` : null,
        a.altFt != null ? `Altitude: ${a.altFt.toLocaleString()} ft` : null,
        a.speedKt != null ? `Speed: ${a.speedKt} kt` : null,
        a.heading != null ? `Heading: ${a.heading}°` : null,
        a.squawk ? `Squawk: ${a.squawk}` : null,
        `Role: ${role}`,
    ].filter(Boolean);

    return {
        source_key: `adsb-${a.icao}`,
        source_name: "ADS-B One / Military",
        category: "military",
        subcategory: role,
        title,
        summary: summaryParts.join(" · "),
        lat: a.lat,
        lon: a.lon,
        severity: ["fighter", "bomber", "awacs", "isr"].includes(role) ? "high" : "medium",
        confidence: ["fighter", "bomber", "awacs", "isr"].includes(role) ? 85 : 72,
        occurred_at: new Date().toISOString(),
        report_type: "flight_tracking",
        weapon_type: role,
        actor_side: "state_actor",
        target_side: "unknown",
        target_type: "airspace",
        impact_type: "military",
        country_code: "",
        tags: ["adsb", "military", role, a.country].filter(Boolean),
        metadata: {
            icao: a.icao,
            callsign: a.callsign || null,
            registration: a.reg || null,
            type_code: a.typeCode || null,
            model_name: a.modelName || null,
            operator: a.operator || null,
            country: a.country,
            role,
            altitude_ft: a.altFt,
            speed_kts: a.speedKt,
            heading: a.heading,
            squawk: a.squawk || null,
            on_ground: a.onGround,
        },
        // Required fields with defaults
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        location_label: `${a.lat?.toFixed(3)}, ${a.lon?.toFixed(3)}`,
        dedupe_key: `ADSB|${a.icao}|${new Date().toISOString().slice(0, 16)}`,
    };
}

function buildAdsbTrack(a) {
    const role = classifyAircraft(a.typeCode, a.callsign, a.icao, a.modelName);
    const displayName = a.modelName || a.typeCode || a.callsign || a.icao.toUpperCase();
    const displayId = a.callsign || a.reg || a.icao.toUpperCase();
    const displayOrg = a.operator || a.country;

    return {
        track_key: `adsb-${a.icao}`,
        track_type: "aircraft",
        category: "military",
        subcategory: role,
        source_name: "ADS-B One / Military",
        title: `${a.flag} ${displayName} — ${displayId} (${displayOrg})`.trim(),
        lat: a.lat,
        lon: a.lon,
        altitude_ft: a.altFt,
        speed_kts: a.speedKt,
        heading_deg: a.heading,
        region: null,
        country: a.country || null,
        status: "active",
        occurred_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
            icao: a.icao,
            callsign: a.callsign || null,
            registration: a.reg || null,
            type_code: a.typeCode || null,
            model_name: a.modelName || null,
            operator: a.operator || null,
            country: a.country,
            role,
            altitude_ft: a.altFt,
            speed_kts: a.speedKt,
            heading: a.heading,
            squawk: a.squawk || null,
            on_ground: a.onGround,
        },
    };
}

function buildAdsbTrackHistoryRow(track) {
    return {
        track_key: track.track_key,
        subtype: track.subcategory || null,
        lat: track.lat,
        lon: track.lon,
        altitude_ft: track.altitude_ft,
        speed_kts: track.speed_kts,
        heading_deg: track.heading_deg,
        status: track.status || "active",
        last_seen_at: track.updated_at || new Date().toISOString(),
        ended_at: null,
    };
}

// ─── Supabase Writes ────────────────────────────────────────────────────────

async function upsertAdsbEvents(events) {
    if (!events.length) return;
    const { error } = await supabase
        .from("events")
        .upsert(events, { onConflict: "source_key", ignoreDuplicates: false });
    if (error) console.error("[adsb] Events upsert error:", error.message);
    else console.log(`[adsb] Upserted ${events.length} military aircraft events`);
}

async function upsertAdsbTracks(tracks) {
    if (!tracks.length) return;
    const { error } = await supabase
        .from("tracks")
        .upsert(tracks, { onConflict: "track_key", ignoreDuplicates: false });
    if (error) console.error("[adsb] Tracks upsert error:", error.message);
    else console.log(`[adsb] Upserted ${tracks.length} military aircraft tracks`);
}

async function upsertAdsbTrackHistory(rows) {
    if (!rows.length) return;
    const { error } = await supabase
        .from("aircraft_tracks_log")
        .upsert(rows, { onConflict: "track_key", ignoreDuplicates: false });
    if (error) console.error("[adsb] Track history upsert error:", error.message);
    else console.log(`[adsb] Upserted ${rows.length} recent aircraft history rows`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runAdsbWorker() {
    const label = "[adsb]";
    console.log(`${label} Starting ADS-B One military scan...`);

    pruneSeen();

    let rawAircraft;
    try {
        rawAircraft = await fetchAdsbOneMilitary();
    } catch (err) {
        console.error(`${label} ADS-B One fetch failed:`, err.message);
        return;
    }

    console.log(`${label} ADS-B One returned ${rawAircraft.length} military aircraft`);

    const processed = [];
    const eventCandidates = [];
    for (const ac of rawAircraft) {
        const a = parseAdsbOneAircraft(ac);
        const role = classifyAircraft(a.typeCode, a.callsign, a.icao, a.modelName);

        // Skip invalid positions
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
        if (a.lat === 0 && a.lon === 0) continue;

        // Skip ground traffic
        if (a.onGround) continue;

        // StratOps ignores training aircraft entirely: no live track, event,
        // alert, counter, or history row should be produced from these contacts.
        if (role === "trainer" || isExcludedTrainerAircraft(a)) continue;

        // ADS-B One /mil still leaks civilian airliners sometimes. Reject those here
        // unless there is a strong military-specific marker.
        if (isLikelyCivilianAirliner(a, role)) continue;

        processed.push(a);
        if (!wasSeen(a.icao)) {
            eventCandidates.push(a);
            markSeen(a.icao);
        }
    }

    console.log(`${label} Processing ${processed.length} airborne military aircraft`);
    console.log(`${label} New event candidates ${eventCandidates.length}`);

    if (!processed.length) {
        console.log(`${label} No aircraft tracks to upsert`);
        return;
    }

    const events = eventCandidates.map(buildAdsbEvent);
    const tracks = processed.map(buildAdsbTrack);
    const historyRows = tracks.map(buildAdsbTrackHistoryRow);

    await upsertAdsbEvents(events);
    await upsertAdsbTracks(tracks);
    await upsertAdsbTrackHistory(historyRows);

    // Log breakdown by role
    const roleCounts = {};
    for (const a of processed) {
        const role = classifyAircraft(a.typeCode, a.callsign, a.icao, a.modelName);
        roleCounts[role] = (roleCounts[role] || 0) + 1;
    }
    console.log(`${label} Role breakdown:`, roleCounts);
}
