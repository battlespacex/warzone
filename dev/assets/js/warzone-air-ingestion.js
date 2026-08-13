// File Path: /assets/js/warzone-air-ingestion.js

import { upsertLiveTrack, clearLiveTrack } from "./warzone-live-airforce.js";
import { isLayerEnabled } from "./warzone-layers.js";
import { getActiveRegion } from "./warzone-region-selector.js";
// Note: no direct Supabase writes from frontend — all track data is client-side only
const AIRCRAFT_PROXY_PATHS = ["/__warzone/aircraft-feed/mil", "/warzone/aircraft-feed/mil"];
const PUBLIC_AIRCRAFT_FEED_URL = "https://api.adsb.lol/v2/mil";
const POLL_INTERVAL_MS = 2000;
const FETCH_TIMEOUT_MS = 9000;
const TRACK_STALE_MS = 90000;
const FAILURE_BACKOFF_BASE_MS = 5000;
const FAILURE_BACKOFF_MAX_MS = 60000;
const SOURCE_NAME = "adsb.lol";
const SOURCE_PRIORITY = {
    adsb_lol: 100,
};
const CIVILIAN_AIRLINER_CODES = new Set([
    "A220", "A318", "A319", "A320", "A20N", "A21N", "A321", "A330", "A332", "A333", "A338",
    "A339", "A340", "A342", "A343", "A345", "A346", "A350", "A359", "A35K", "A380", "A388",
    "B712", "B717", "B721", "B722", "B731", "B732", "B733", "B734", "B735", "B736", "B737",
    "B738", "B739", "B37M", "B38M", "B39M", "B3XM", "B741", "B742", "B743", "B744", "B748",
    "B752", "B753", "B762", "B763", "B764", "B772", "B77L", "B77W", "B778", "B779", "B787",
    "B788", "B789", "B78X", "E170", "E175", "E190", "E195", "CRJ2", "CRJ7", "CRJ9", "CRJX",
    "AT72", "AT75", "DH8A", "DH8B", "DH8C", "DH8D", "BCS1", "BCS3",
]);
const CIVILIAN_UTILITY_PATTERNS = [
    /\bAIR TRACTOR\b/i,
    /\bAT-?802\b/i,
    /\bAT8T\b/i,
    /\bCROP DUSTER\b/i,
    /\bAGRICULT(URAL|URE)\b/i,
    /\bAERIAL APPLICAT(ION|OR)\b/i,
    /\bFIRE ?BOMBER\b/i,
    /\bWATER ?BOMBER\b/i,
    /\bFIREFIGHT(ING|ER)\b/i,
    /\bAIR SPRAY\b/i,
    /\bTHRUSH\b/i,
    /\bDROMADER\b/i,
];
const TRAINING_ACTIVITY_PATTERNS = [
    /\btrainer\b/i,
    /\bbasic trainer\b/i,
    /\bprimary trainer\b/i,
    /\badvanced trainer\b/i,
    /\bjet trainer\b/i,
    /\bflight training\b/i,
    /\bpilot training\b/i,
    /\btraining aircraft\b/i,
    /\btraining (flight|activity|mission|sortie)\b/i,
    /\bmilitary training aircraft\b/i,
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
const MILITARY_OVERRIDE_PATTERNS = [
    /AIR FORCE/i, /\bUSAF\b/i, /\bRAF\b/i, /\bRCAF\b/i, /\bIAF\b/i, /\bPAF\b/i,
    /NAVY/i, /NAVAL/i, /ARMY/i, /MARINES/i, /COAST GUARD/i,
    /MRTT/i, /VOYAGER/i, /STRATOTANKER/i, /EXTENDER/i, /PEGASUS/i,
    /AWACS/i, /\bAEW\b/i, /WEDGETAIL/i, /SENTRY/i, /PHALCON/i, /ERIEYE/i,
    /POSEIDON/i, /ORION/i, /RIVET JOINT/i, /COBRA BALL/i, /GLOBAL HAWK/i, /TRITON/i,
    /SPECIAL MISSION/i, /HERCULES/i, /GLOBEMASTER/i, /BLACK HAWK/i, /BLACKHAWK/i,
    /APACHE/i, /CHINOOK/i, /SEAHAWK/i, /OSPREY/i, /HAWKEYE/i, /STALLION/i,
    /\bA-?400M\b/i, /\bC-?17\b/i, /\bC-?130\b/i, /\bKC-?135\b/i, /\bKC-?46\b/i, /\bKC-?10\b/i,
    /\bP-?8\b/i, /\bE-?3\b/i, /\bE-?7\b/i, /\bRC-?135\b/i, /\bF-?35\b/i, /\bF-?16\b/i,
];
const SPECIAL_ISR_COMMAND_PATTERNS = [
    /DOOMSDAY/i, /NIGHTWATCH/i, /LOOKING GLASS/i, /TACAMO/i, /MERCURY/i,
    /\bE-?4B?\b/i, /\bE-?6B?\b/i, /\bIL-?80\b/i, /\bIL-?82\b/i,
];
const SPECIAL_VIP_GOV_PATTERNS = [
    /AIR FORCE ONE/i, /AIR FORCE TWO/i, /AIR INDIA ONE/i,
    /\bSAM\d{2,6}\b/i, /\bVENUS\d+\b/i, /\bEXEC1[FVP]\b/i,
    /\bVC-?25A?\b/i, /\bVC-?32A?\b/i, /\bC-?32A?\b/i, /\bC-?40B?\b/i,
    /\bA319CJ\b/i, /\bA320CJ\b/i, /\bBBJ\b/i, /\bACJ\b/i,
    /\bVVIP\b/i, /VIP TRANSPORT/i, /PRESIDENTIAL/i, /HEAD OF STATE/i, /PRIME MINISTER/i, /STATE FLIGHT/i,
    /\bCOTAM\d+\b/i, /SLO ROSSIYA/i, /\bIL-?96-?300PU\b/i, /\bIL-?96PU\b/i, /\bTU-?214PU\b/i,
    /KONRAD ADENAUER/i,
];
const COAST_GUARD_CASA_PATROL_PATTERNS = [
    /\b(hc ?144b?|c ?144b?|casa 144b?|ocean sentry)\b/i,
    /\b(uscg|u s coast guard|united states coast guard|coast guard)\b.*\b(cn ?235|c ?295|casa)\b/i,
    /\b(cn ?235|c ?295|casa)\b.*\b(uscg|u s coast guard|united states coast guard|coast guard)\b/i,
];
let __pollTimer = null;
let __pollingActive = false;
let __isFetching = false;
let __fetchInFlightSince = 0;
let __activeFetchController = null;
let __inFlightPromise = null;
let __failureCount = 0;
let __nextRetryAt = 0;
let __lastFailureHttpStatus = 0;
let __feedStatus = Object.freeze({ state: "stopped", httpStatus: 0, retryAt: 0 });
let __visibilitySyncBound = false;
const __canonicalTrackStore = new Map();
const __identityCanonicalIndex = new Map();
const __activeTrackKeys = new Set();
function nowMs() {
    return Date.now();
}
function asFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeString(value = "") {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function normalizeCallsign(value = "") {
    return normalizeString(value).replace(/^\.+|\.+$/g, "");
}
function sanitizeDisplayText(value = "") {
    return String(value || "")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/@[A-Za-z0-9_]+/g, " ")
        .replace(/[^\p{L}\p{N}\s.\-_/()]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function isDisplayTextUsable(value = "") {
    const clean = sanitizeDisplayText(value);
    if (!clean) return false;
    if (/^(unknown|empty|null|n\/a)$/i.test(clean)) return false;
    return /[A-Za-z0-9]/.test(clean);
}
function formatSubtypeTitle(subtype = "") {
    const key = String(subtype || "").toLowerCase();
    if (key === "awacs") return "AWACS";
    if (key === "isr") return "ISR";
    if (key === "uav") return "UAV";
    if (key === "vip") return "VIP/GOV";
    if (!key) return "Aircraft";
    return key.charAt(0).toUpperCase() + key.slice(1);
}
function getSourcePriority(source = "") {
    return SOURCE_PRIORITY[source] || 0;
}
function hasMilitaryOverrideText(value = "") {
    const text = String(value || "");
    return (
        MILITARY_OVERRIDE_PATTERNS.some((pattern) => pattern.test(text)) ||
        SPECIAL_ISR_COMMAND_PATTERNS.some((pattern) => pattern.test(text)) ||
        SPECIAL_VIP_GOV_PATTERNS.some((pattern) => pattern.test(text))
    );
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
function isSpecialIsrCommandRecord(record = {}) {
    const haystack = [
        record.flight,
        record.desc,
        record.category,
        record.type,
        record.t,
        record.r,
    ].filter(Boolean).join(" ");
    return SPECIAL_ISR_COMMAND_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isSpecialVipGovernmentRecord(record = {}) {
    const haystack = [
        record.flight,
        record.desc,
        record.category,
        record.type,
        record.t,
        record.r,
    ].filter(Boolean).join(" ");
    return SPECIAL_VIP_GOV_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isCoastGuardCasaPatrolRecord(record = {}) {
    const haystack = [
        record.desc,
        record.category,
        record.r,
        record.flight,
        record.type,
        record.t,
        record.ownOp,
        record.operator,
    ].filter(Boolean).join(" ");
    return COAST_GUARD_CASA_PATROL_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isLikelyCivilianAirlinerRecord(record = {}) {
    const typeCode = normalizeString(record.t || record.type || "").toUpperCase();
    const haystack = [
        record.desc,
        record.category,
        record.r,
        record.flight,
        record.type,
        record.t,
    ].filter(Boolean).join(" ");
    if (hasMilitaryOverrideText(haystack)) return false;
    if (CIVILIAN_AIRLINER_CODES.has(typeCode)) return true;
    return /(AIRBUS\s+A-?(220|318|319|320|321|330|340|350|380)\b|BOEING\s+7(17|27|37|47|57|67|77|87)\b|EMBRAER\s+E-?(170|175|190|195)\b|CRJ[- ]?(200|700|900|1000)\b|ATR[- ]?7(2|5)\b|DASH ?8\b)/i.test(haystack);
}
function isLikelyCivilianUtilityRecord(record = {}) {
    const typeCode = normalizeString(record.t || record.type || "").toUpperCase();
    const haystack = [
        record.desc,
        record.category,
        record.r,
        record.flight,
        record.type,
        record.t,
    ].filter(Boolean).join(" ");
    if (hasMilitaryOverrideText(haystack)) return false;
    if (typeCode === "AT8T" || typeCode === "AT82") return true;
    return CIVILIAN_UTILITY_PATTERNS.some((pattern) => pattern.test(haystack));
}
function isPublicAirFallbackEnabled() {
    const isLocalDevHost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "[::1]";
    if (window.__stratopsConfig?.enablePublicAirFallback !== true) return false;
    if (isLocalDevHost && window.__stratopsConfig?.allowLocalhostPublicAirFallback !== true) {
        return false;
    }
    return true;
}
function getAirplanesLiveFeedUrl() {
    const isLocalDevHost =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "[::1]";
    if (isLocalDevHost) return AIRCRAFT_PROXY_PATHS[0];
    return window.__stratopsConfig?.aircraftFeedUrl || PUBLIC_AIRCRAFT_FEED_URL;
}
function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const timeoutController = new AbortController();
    const externalSignal = options?.signal || null;
    if (externalSignal) {
        if (externalSignal.aborted) {
            timeoutController.abort();
        } else {
            externalSignal.addEventListener("abort", () => timeoutController.abort(), { once: true });
        }
    }
    const timer = window.setTimeout(() => timeoutController.abort(), timeoutMs);
    const { signal: _ignoredSignal, ...restOptions } = (options || {});
    return fetch(url, {
        ...restOptions,
        signal: timeoutController.signal,
        cache: "no-store",
    }).finally(() => {
        window.clearTimeout(timer);
    });
}
function classifySubtype(record = {}) {
    const typeCode = normalizeString(record.t || record.type || "").toLowerCase();
    const desc = normalizeString(record.desc || record.category || record.r || "").toLowerCase();
    const callsign = normalizeCallsign(record.flight || "").toLowerCase();
    const haystack = [typeCode, desc, callsign, record.r, record.ownOp, record.operator].filter(Boolean).join(" ");
    if (isSpecialIsrCommandRecord(record)) {
        return "isr";
    }
    if (isSpecialVipGovernmentRecord(record)) {
        return "vip";
    }
    if (isCoastGuardCasaPatrolRecord(record)) {
        return "civilian";
    }
    if (isLikelyCivilianUtilityRecord(record)) {
        return "civilian";
    }
    if (isLikelyCivilianAirlinerRecord(record)) {
        return "civilian";
    }
    if (isExcludedTrainerAircraftText(haystack)) {
        return "trainer";
    }
    // AWACS / AEW&C / airborne early warning
    if (/(awacs|aew&c|aewc|airborne early warning|early warning|e-3\b|e3\b|sentry\b|e-7\b|e7\b|wedgetail\b|e-2\b|e2\b|hawkeye\b|a-50\b|a50\b|a-100\b|a100\b|kj-2000\b|kj2000\b|kj-500\b|kj500\b|erieye\b|phalcon\b|netra\b)/.test(haystack)) {
        return "awacs";
    }
    // UAV / UCAV / drones. Keep this before ISR/recon so RQ-4/MQ-4C/MQ-9
    // render with drone assets instead of generic ISR aircraft fallbacks.
    if (/(drone\b|uav\b|ucav\b|uas\b|mq-1\b|mq1\b|predator\b|mq-9[ab]?\b|mq9[ab]?\b|reaper\b|general atomic(?:s)?\b|ga-?asi\b|skyguardian\b|sky guardian\b|seaguardian\b|sea guardian\b|protector(?:\s+rg-?1)?\b|mq-20\b|mq20\b|avenger\b|rq-1\b|rq1\b|rq-4\b|rq4\b|global hawk\b|rq-7\b|rq7\b|shadow\b|rq-170\b|rq170\b|sentinel\b|mq-4c\b|mq4c\b|triton\b|tb2\b|bayraktar\b|akinci\b|anka\b|aksungur\b|heron\b|hermes\b|wing loong\b|wingloong\b|ch-4\b|ch4\b|ch-5\b|ch5\b|wj-700\b|wj700\b|shahed\b|mohajer\b|ababil\b|switchblade\b|lancet\b|orlan\b|forpost\b|okhotnik\b)/.test(haystack)) {
        return "uav";
    }
    // Recon / SIGINT / ELINT / maritime patrol
    if (/(rc-135\b|rc135\b|rivet joint\b|cobra ball\b|combat sent\b|ep-3\b|ep3\b|aries\b|p-3\b|p3\b|orion\b|p-8\b|p8\b|poseidon\b|il-20\b|il20\b|tu-214r\b|tu214r\b|recon\b|reconnaissance\b|surveillance\b|maritime patrol\b|sigint\b|elint\b|sentinel r1\b|swordfish\b)/.test(haystack)) {
        return "recon";
    }
    // ISR / battlefield intelligence / special mission
    if (/(isr\b|intelligence\b|battlefield surveillance\b|ground surveillance\b|jstars\b|e-8\b|e8\b|ags\b|alliance ground surveillance\b|mq-4c\b|mq4c\b|triton\b|rq-4\b|rq4\b|global hawk\b|special mission\b)/.test(haystack)) {
        return "isr";
    }
    // Tanker / refueler
    if (/(kc-135\b|kc135\b|kc-46\b|kc46\b|kc-10\b|kc10\b|a330 mrtt\b|voyager kc2\b|voyager kc3\b|il-78\b|il78\b|yy-20\b|yy20\b|tanker\b|refuel\b|refueller\b|refuelling\b|aerial refuel\b|air to air refuel\b)/.test(haystack)) {
        return "tanker";
    }
    // Transport / airlift / logistics
    if (/(c-17\b|c17\b|globemaster\b|c-5\b|c5\b|galaxy\b|c-130\b|c130\b|hercules\b|a-?400m\b|atlas\b|an-124\b|an124\b|ruslan\b|an-12\b|an12\b|an-26\b|an26\b|an-32\b|an32\b|il-76\b|il76\b|y-20\b|y20\b|c-2\b|c2\b|c-27j\b|c27j\b|spartan\b|cn-235\b|cn235\b|c295\b|transall\b|transport\b|airlift\b|airlifter\b|cargo\b|logistics\b|tactical airlift\b)/.test(haystack)) {
        return "transport";
    }
    // Bombers / strike bombers / gunships
    if (/(b-1\b|b1\b|lancer\b|b-2\b|b2\b|spirit\b|b-52\b|b52\b|stratofortress\b|tu-95\b|tu95\b|bear\b|tu-160\b|tu160\b|blackjack\b|tu-22m\b|tu22m\b|backfire\b|h-6\b|h6\b|badger\b|su-24\b|su24\b|fencer\b|su-34\b|su34\b|fullback\b|ac-130\b|ac130\b|spectre\b|spooky\b|gunship\b|bomber\b|strategic bomber\b|strike bomber\b)/.test(haystack)) {
        return "bomber";
    }
    // Helicopters / rotorcraft / gunships
    if (/(heli\b|helicopter\b|rotary wing\b|rotorcraft\b|ah-1\b|ah1\b|cobra\b|ah-64\b|ah64\b|apache\b|uh-60\b|uh60\b|black hawk\b|blackhawk\b|hh-60\b|hh60\b|mh-60\b|mh60\b|seahawk\b|ch-47\b|ch47\b|chinook\b|ch-53\b|ch53\b|stallion\b|super stallion\b|king stallion\b|uh-1\b|uh1\b|huey\b|v-22\b|v22\b|osprey\b|mi-8\b|mi8\b|mi-17\b|mi17\b|hip\b|mi-24\b|mi24\b|hind\b|mi-28(?:nm|n)?\b|mi28(?:nm|n)?\b|mi-35\b|mi35\b|havoc\b|ka-27\b|ka27\b|helix\b|ka-29\b|ka29\b|ka-31\b|ka31\b|ka-50\b|ka50\b|hokum\b|ka-52\b|ka52\b|alligator\b|z-9\b|z9\b|z-10\b|z10\b|z-19\b|z19\b|z-20\b|z20\b|nh90\b|aw101\b|merlin\b|aw159\b|wildcat\b|lynx\b|ec665\b|tiger\b|h145m\b|dhruv\b|prahchand\b|light combat helicopter\b)/.test(haystack)) {
        return "helicopter";
    }
    // Fighters / interceptors / multirole / attack jets
    if (/(fighter\b|interceptor\b|multirole\b|air superiority\b|combat aircraft\b|f\/a-18\b|fa-18\b|fa18\b|hornet\b|super hornet\b|f-14\b|f14\b|tomcat\b|f-15\b|f15\b|eagle\b|strike eagle\b|f-16\b|f16\b|falcon\b|f-22\b|f22\b|raptor\b|f-35\b|f35\b|lightning ii\b|a-10\b|a10\b|warthog\b|f-117\b|f117\b|nighthawk\b|su-27\b|su27\b|flanker\b|su-30\b|su30\b|su-35\b|su35\b|su-57\b|su57\b|mig-21\b|mig21\b|mig-23\b|mig23\b|mig-25\b|mig25\b|mig-29\b|mig29\b|mig-31\b|mig31\b|fulcrum\b|foxhound\b|j-7\b|j7\b|j-8\b|j8\b|j-10\b|j10\b|j-11\b|j11\b|j-15\b|j15\b|j-16\b|j16\b|j-20\b|j20\b|fc-1\b|fc1\b|jf-17\b|jf17\b|thunder\b|tejas\b|rafale\b|mirage 2000\b|mirage\b|typhoon\b|eurofighter\b|gripen\b|f-2\b|f2\b|kfir\b|jas 39\b)/.test(haystack)) {
        return "fighter";
    }
    return "aircraft";
}
function buildCanonicalKey(track = {}) {
    const callsign = normalizeCallsign(track.callsign || "").toLowerCase();
    if (callsign) return `callsign:${callsign}`;
    const icao24 = normalizeString(track.icao24 || "").toLowerCase();
    if (icao24) return `icao24:${icao24}`;
    const registration = normalizeString(track.registration || "").toLowerCase();
    if (registration) return `reg:${registration}`;
    return `synthetic:${track.track_key}`;
}
function buildTrackIdentityKeys(track = {}) {
    const keys = [];
    const callsign = normalizeCallsign(track.callsign || track?.metadata?.callsign || "").toLowerCase();
    const icao24 = normalizeString(track.icao24 || track?.metadata?.icao || "").toLowerCase();
    const registration = normalizeString(track.registration || track?.metadata?.registration || "").toLowerCase();
    if (callsign) keys.push(`callsign:${callsign}`);
    if (icao24) keys.push(`icao24:${icao24}`);
    if (registration) keys.push(`reg:${registration}`);
    return keys;
}
function resolveCanonicalKey(track = {}) {
    const identityKeys = buildTrackIdentityKeys(track);
    for (const identityKey of identityKeys) {
        const canonicalKey = __identityCanonicalIndex.get(identityKey);
        if (canonicalKey) return canonicalKey;
    }
    return buildCanonicalKey(track);
}
function indexCanonicalIdentities(canonicalKey, track = {}) {
    if (!canonicalKey) return;
    for (const identityKey of buildTrackIdentityKeys(track)) {
        __identityCanonicalIndex.set(identityKey, canonicalKey);
    }
}
function clearCanonicalIdentityIndex(canonicalKey) {
    if (!canonicalKey) return;
    for (const [identityKey, mappedCanonicalKey] of __identityCanonicalIndex.entries()) {
        if (mappedCanonicalKey === canonicalKey) {
            __identityCanonicalIndex.delete(identityKey);
        }
    }
}
function buildTrackKey(record = {}) {
    const hex = normalizeString(record.hex || "").toLowerCase();
    if (hex) return `apl-${hex}`;
    const callsign = normalizeCallsign(record.flight || "").toLowerCase();
    if (callsign) return `apl-${callsign.replace(/[^a-z0-9]+/g, "-")}`;
    const lat = asFiniteNumber(record.lat, 0).toFixed(3);
    const lon = asFiniteNumber(record.lon, 0).toFixed(3);
    return `apl-${lat}-${lon}`;
}
function normalizeAirplanesLiveRecord(record = {}) {
    const trackKey = buildTrackKey(record);
    const subtype = classifySubtype(record);
    const callsign = normalizeCallsign(record.flight || "");
    const onGround =
        String(record.alt_baro || "").trim().toLowerCase() === "ground" ||
        record.on_ground === true ||
        record.ground === true;
    const parsedAltitudeFeet = Number(record.alt_baro);
    const altitudeFeet = onGround
        ? 0
        : (Number.isFinite(parsedAltitudeFeet) ? parsedAltitudeFeet : null);
    const typeCode = normalizeString(record.t || record.type || "").toUpperCase();
    const modelName = sanitizeDisplayText(record.desc || "");
    const registration = normalizeString(record.r || "");
    const identity = isDisplayTextUsable(callsign)
        ? sanitizeDisplayText(callsign)
        : (isDisplayTextUsable(registration || record.hex || "")
            ? sanitizeDisplayText(registration || record.hex || "")
            : "");
    const titleBase = isDisplayTextUsable(modelName)
        ? (identity ? `${modelName} — ${identity}` : modelName)
        : (isDisplayTextUsable(typeCode)
            ? (identity ? `${typeCode} — ${identity}` : typeCode)
            : (identity || `${formatSubtypeTitle(subtype)} ${trackKey.slice(-6).toUpperCase()}`));
    return {
        track_key: trackKey,
        icao24: normalizeString(record.hex || "").toLowerCase(),
        callsign,
        title: titleBase,
        source_name: SOURCE_NAME,
        source: "adsb_lol",
        category: "military",
        subcategory: subtype,
        registration,
        type_code: typeCode,
        model_name: modelName,
        lat: asFiniteNumber(record.lat, NaN),
        lon: asFiniteNumber(record.lon, NaN),
        altitude_ft: altitudeFeet,
        on_ground: onGround,
        speed_kts: asFiniteNumber(record.gs, 0),
        heading_deg: asFiniteNumber(record.track, 0),
        occurred_at: new Date().toISOString(),
        timestamp: nowMs(),
        metadata: {
            icao: normalizeString(record.hex || "").toLowerCase(),
            callsign,
            type: normalizeString(record.t || record.type || ""),
            registration,
            type_code: typeCode || null,
            model_name: modelName || null,
            country: null,
            source_type: normalizeString(record.type || ""),
            seen_seconds: asFiniteNumber(record.seen, 0),
            seen_pos_seconds: asFiniteNumber(record.seen_pos, 0),
            db_flags: asFiniteNumber(record.dbFlags, 0),
            on_ground: onGround,
        },
    };
}
function mergeTrack(existing, incoming) {
    if (!existing) {
        return {
            ...incoming,
            sources: [incoming.source],
        };
    }
    const incomingPriority = getSourcePriority(incoming.source);
    const existingPriority = getSourcePriority(existing.source);
    const incomingTs = asFiniteNumber(incoming.timestamp, 0);
    const existingTs = asFiniteNumber(existing.timestamp, 0);
    const shouldPreferIncoming =
        incomingTs > existingTs ||
        (incomingTs === existingTs && incomingPriority >= existingPriority);
    const merged = {
        ...(shouldPreferIncoming ? existing : incoming),
        ...(shouldPreferIncoming ? incoming : existing),
    };
    merged.sources = Array.from(
        new Set([...(existing.sources || [existing.source]).filter(Boolean), incoming.source].filter(Boolean))
    );
    if (!merged.track_key) {
        merged.track_key = incoming.track_key || existing.track_key;
    }
    return merged;
}
function isTrackRenderable(track = {}) {
    return Number.isFinite(track.lat) && Number.isFinite(track.lon);
}
function isCoordinateInsideBounds(lon, lat, bounds = {}) {
    return (
        Number.isFinite(lon) &&
        Number.isFinite(lat) &&
        lon >= Number(bounds.minLon) &&
        lon <= Number(bounds.maxLon) &&
        lat >= Number(bounds.minLat) &&
        lat <= Number(bounds.maxLat)
    );
}
function isTrackInsideActiveRegion(track = {}) {
    const region = getActiveRegion?.();
    if (!region || region.id === "global") return true;
    return isCoordinateInsideBounds(
        Number(track.lon),
        Number(track.lat),
        region.bounds || {}
    );
}
function clearAllPublicAirTracks() {
    for (const trackKey of __activeTrackKeys) {
        clearLiveTrack(trackKey);
    }
    __activeTrackKeys.clear();
    __canonicalTrackStore.clear();
    __identityCanonicalIndex.clear();
}
function restoreCachedPublicAirTracks() {
    if (!isLayerEnabled("aircraft")) return;
    cleanupStaleTracks();
    for (const track of __canonicalTrackStore.values()) {
        if (!track?.track_key || !isTrackRenderable(track) || !isTrackInsideActiveRegion(track)) continue;
        upsertLiveTrack(track);
        __activeTrackKeys.add(track.track_key);
    }
}
function cleanupStaleTracks() {
    const cutoff = nowMs() - TRACK_STALE_MS;
    for (const [canonicalKey, track] of __canonicalTrackStore.entries()) {
        if (asFiniteNumber(track.timestamp, 0) >= cutoff) continue;
        __canonicalTrackStore.delete(canonicalKey);
        clearCanonicalIdentityIndex(canonicalKey);
        if (track?.track_key) {
            __activeTrackKeys.delete(track.track_key);
            clearLiveTrack(track.track_key);
            markAircraftEnded(track.track_key);
        }
    }
}
async function fetchAirplanesLiveRecords(signal) {
    const response = await fetchWithTimeout(getAirplanesLiveFeedUrl(), { signal });
    if (!response.ok) {
        const error = new Error(`aircraft feed request failed (${response.status})`);
        error.httpStatus = Number(response.headers.get("X-Warzone-Upstream-Status") || response.status || 0);
        error.retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        throw error;
    }
    const payload = await response.json();
    return Array.isArray(payload?.ac) ? payload.ac : [];
}
async function refreshPublicAirTracks(options = {}) {
    const force = options?.force === true;
    if (__inFlightPromise) return __inFlightPromise;
    if (document.visibilityState === "hidden" && !force) return;
    if (!isPublicAirFallbackEnabled()) {
        clearAllPublicAirTracks();
        return;
    }
    if (!isLayerEnabled("aircraft")) return;
    if (!force && __nextRetryAt > Date.now()) return;

    __inFlightPromise = (async () => {
        __isFetching = true;
        __fetchInFlightSince = Date.now();
        const fetchController = new AbortController();
        __activeFetchController = fetchController;
        try {
            const records = await fetchAirplanesLiveRecords(fetchController.signal);
            __failureCount = 0;
            __nextRetryAt = 0;
            __lastFailureHttpStatus = 0;
            setFeedStatus("active");
            if (!isLayerEnabled("aircraft")) return;
            const seenThisPass = new Set();
            for (const record of records) {
                const normalized = normalizeAirplanesLiveRecord(record);
                if (!isTrackRenderable(normalized)) continue;
                if (!isTrackInsideActiveRegion(normalized)) {
                    const outsideCanonicalKey = resolveCanonicalKey(normalized);
                    const outsideExisting = __canonicalTrackStore.get(outsideCanonicalKey);
                    if (outsideExisting?.track_key) {
                        __activeTrackKeys.delete(outsideExisting.track_key);
                        clearLiveTrack(outsideExisting.track_key);
                    }
                    __canonicalTrackStore.delete(outsideCanonicalKey);
                    clearCanonicalIdentityIndex(outsideCanonicalKey);
                    continue;
                }
                if (normalized.subcategory === "civilian") {
                    const civilianCanonicalKey = resolveCanonicalKey(normalized);
                    const civilianExisting = __canonicalTrackStore.get(civilianCanonicalKey);
                    if (civilianExisting?.track_key) {
                        __activeTrackKeys.delete(civilianExisting.track_key);
                        clearLiveTrack(civilianExisting.track_key);
                    }
                    __canonicalTrackStore.delete(civilianCanonicalKey);
                    clearCanonicalIdentityIndex(civilianCanonicalKey);
                    continue;
                }
                if (normalized.subcategory === "trainer") {
                    const trainerCanonicalKey = resolveCanonicalKey(normalized);
                    const trainerExisting = __canonicalTrackStore.get(trainerCanonicalKey);
                    if (trainerExisting?.track_key) {
                        __activeTrackKeys.delete(trainerExisting.track_key);
                        clearLiveTrack(trainerExisting.track_key);
                    }
                    __canonicalTrackStore.delete(trainerCanonicalKey);
                    clearCanonicalIdentityIndex(trainerCanonicalKey);
                    continue;
                }
                const canonicalKey = resolveCanonicalKey(normalized);
                const existingCanonical = __canonicalTrackStore.get(canonicalKey);
                if (existingCanonical?.track_key) {
                    normalized.track_key = String(existingCanonical.track_key);
                }
                const merged = mergeTrack(existingCanonical, normalized);
                __canonicalTrackStore.set(canonicalKey, merged);
                indexCanonicalIdentities(canonicalKey, merged);
                seenThisPass.add(merged.track_key);
                upsertLiveTrack(merged);
                logAircraftTrack(merged);
                __activeTrackKeys.add(merged.track_key);
            }
            for (const trackKey of Array.from(__activeTrackKeys)) {
                if (seenThisPass.has(trackKey)) continue;
                const relatedCanonical = Array.from(__canonicalTrackStore.values()).find((track) => track.track_key === trackKey);
                if (!relatedCanonical) {
                    __activeTrackKeys.delete(trackKey);
                    clearLiveTrack(trackKey);
                }
            }
            cleanupStaleTracks();
        } catch (error) {
            if (String(error?.name || "") !== "AbortError") {
                __failureCount += 1;
                const exponentialDelay = Math.min(
                    FAILURE_BACKOFF_MAX_MS,
                    FAILURE_BACKOFF_BASE_MS * (2 ** Math.max(0, __failureCount - 1))
                );
                const retryAfterMs = Number(error?.retryAfterMs || 0);
                const backoffMs = Math.min(
                    FAILURE_BACKOFF_MAX_MS,
                    Math.max(exponentialDelay, Number.isFinite(retryAfterMs) ? retryAfterMs : 0)
                );
                __nextRetryAt = Date.now() + backoffMs;
                __lastFailureHttpStatus = Number(error?.httpStatus || 0);
                setFeedStatus("backoff", {
                    httpStatus: __lastFailureHttpStatus,
                    retryAt: __nextRetryAt,
                });
            }
        } finally {
            if (__activeFetchController === fetchController) {
                __activeFetchController = null;
            }
            __isFetching = false;
            __fetchInFlightSince = 0;
        }
    })().finally(() => {
        __inFlightPromise = null;
    });
    return __inFlightPromise;
}
async function logAircraftTrack(track) { }
async function markAircraftEnded(trackKey) { }
export async function refreshPublicAirTracksNow(options = {}) {
    if (!isPublicAirFallbackEnabled()) return;
    await refreshPublicAirTracks({ force: options?.force === true && __nextRetryAt <= Date.now() });
}
function schedulePublicAirPoll(delayMs = POLL_INTERVAL_MS) {
    if (!__pollingActive || __pollTimer) return;
    const delay = Math.max(0, Number(delayMs || 0));
    __pollTimer = window.setTimeout(async () => {
        __pollTimer = null;
        if (!__pollingActive) return;
        await refreshPublicAirTracks();
        if (!__pollingActive) return;
        schedulePublicAirPoll(Math.max(POLL_INTERVAL_MS, __nextRetryAt - Date.now()));
    }, delay);
}
export function startPublicAirIngestion() {
    if (!isPublicAirFallbackEnabled()) return;
    __pollingActive = true;
    restoreCachedPublicAirTracks();
    if (__nextRetryAt > Date.now()) {
        setFeedStatus("backoff", {
            httpStatus: __lastFailureHttpStatus,
            retryAt: __nextRetryAt,
        });
    }
    schedulePublicAirPoll(Math.max(0, __nextRetryAt - Date.now()));
    if (!__visibilitySyncBound) {
        __visibilitySyncBound = true;
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                if (__pollTimer) {
                    window.clearTimeout(__pollTimer);
                    __pollTimer = null;
                }
                try {
                    __activeFetchController?.abort?.();
                } catch { }
                return;
            }
            const isStaleInFlight =
                __isFetching &&
                __fetchInFlightSince > 0 &&
                (Date.now() - __fetchInFlightSince) > FETCH_TIMEOUT_MS;
            if (isStaleInFlight) {
                __isFetching = false;
            }
            schedulePublicAirPoll(Math.max(0, __nextRetryAt - Date.now()));
        }, { passive: true });
    }
}
export function stopPublicAirIngestion() {
    __pollingActive = false;
    if (__pollTimer) {
        window.clearTimeout(__pollTimer);
        __pollTimer = null;
    }
    try {
        __activeFetchController?.abort?.();
    } catch { }
    __activeFetchController = null;
    __isFetching = false;
    __fetchInFlightSince = 0;
    setFeedStatus("paused");
}
function parseRetryAfterMs(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const retryAt = new Date(raw).getTime();
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
}
function setFeedStatus(state, { httpStatus = 0, retryAt = 0 } = {}) {
    const next = Object.freeze({
        state: String(state || "stopped"),
        httpStatus: Number(httpStatus || 0),
        retryAt: Number(retryAt || 0),
    });
    const changed =
        next.state !== __feedStatus.state ||
        next.httpStatus !== __feedStatus.httpStatus ||
        next.retryAt !== __feedStatus.retryAt;
    __feedStatus = next;
    if (!changed) return;
    try {
        document.dispatchEvent(new CustomEvent("wz:aircraft-feed-state", { detail: next }));
    } catch { }
    if (next.state === "backoff") {
        const retrySeconds = Math.max(1, Math.ceil((next.retryAt - Date.now()) / 1000));
        console.warn(`[aircraft-feed] unavailable status=${next.httpStatus || "network"}; retrying in ${retrySeconds}s`);
    }
}
export function getPublicAirFeedStatus() {
    return { ...__feedStatus };
}
