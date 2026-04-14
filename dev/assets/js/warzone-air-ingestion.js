// File Path: /assets/js/warzone-air-ingestion.js

import { upsertLiveTrack, clearLiveTrack } from "./warzone-live-airforce.js";
import { isLayerEnabled } from "./warzone-layers.js";
// Note: no direct Supabase writes from frontend — all track data is client-side only
const AIRPLANES_LIVE_URL = "https://api.airplanes.live/v2/mil";
const POLL_INTERVAL_MS = 2000;
const FETCH_TIMEOUT_MS = 9000;
const TRACK_STALE_MS = 90000;
const SOURCE_NAME = "airplanes.live";
const SOURCE_PRIORITY = {
    airplanes_live: 100,
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
let __pollTimer = null;
let __isFetching = false;
let __fetchInFlightSince = 0;
let __activeFetchController = null;
let __visibilitySyncBound = false;
const __sourceTrackStore = new Map();
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
function isPublicAirFallbackEnabled() {
    return window.__stratopsConfig?.enablePublicAirFallback === true;
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
    const haystack = [typeCode, desc, callsign].filter(Boolean).join(" ");
    if (isSpecialIsrCommandRecord(record)) {
        return "isr";
    }
    if (isSpecialVipGovernmentRecord(record)) {
        return "vip";
    }
    if (isLikelyCivilianAirlinerRecord(record)) {
        return "civilian";
    }
    // AWACS / AEW&C / airborne early warning
    if (/(awacs|aew&c|aewc|airborne early warning|early warning|e-3\b|e3\b|sentry\b|e-7\b|e7\b|wedgetail\b|e-2\b|e2\b|hawkeye\b|a-50\b|a50\b|a-100\b|a100\b|kj-2000\b|kj2000\b|kj-500\b|kj500\b|erieye\b|phalcon\b|netra\b)/.test(haystack)) {
        return "awacs";
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
    // UAV / UCAV / drones
    if (/(drone\b|uav\b|ucav\b|uas\b|mq-1\b|mq1\b|predator\b|mq-9\b|mq9\b|reaper\b|mq-20\b|mq20\b|avenger\b|rq-1\b|rq1\b|rq-4\b|rq4\b|global hawk\b|rq-7\b|rq7\b|shadow\b|rq-170\b|rq170\b|sentinel\b|mq-4c\b|mq4c\b|triton\b|tb2\b|bayraktar\b|akinci\b|anka\b|aksungur\b|heron\b|hermes\b|wing loong\b|wingloong\b|ch-4\b|ch4\b|ch-5\b|ch5\b|wj-700\b|wj700\b|shahed\b|mohajer\b|ababil\b|switchblade\b|lancet\b|orlan\b|forpost\b|okhotnik\b)/.test(haystack)) {
        return "uav";
    }
    // Helicopters / rotorcraft / gunships
    if (/(heli\b|helicopter\b|rotary wing\b|rotorcraft\b|ah-1\b|ah1\b|cobra\b|ah-64\b|ah64\b|apache\b|uh-60\b|uh60\b|black hawk\b|blackhawk\b|hh-60\b|hh60\b|mh-60\b|mh60\b|seahawk\b|ch-47\b|ch47\b|chinook\b|ch-53\b|ch53\b|stallion\b|super stallion\b|king stallion\b|uh-1\b|uh1\b|huey\b|v-22\b|v22\b|osprey\b|mi-8\b|mi8\b|mi-17\b|mi17\b|hip\b|mi-24\b|mi24\b|hind\b|mi-28\b|mi28\b|havoc\b|ka-27\b|ka27\b|helix\b|ka-29\b|ka29\b|ka-31\b|ka31\b|ka-52\b|ka52\b|alligator\b|z-9\b|z9\b|z-10\b|z10\b|z-19\b|z19\b|z-20\b|z20\b|nh90\b|aw101\b|merlin\b|aw159\b|wildcat\b|lynx\b|ec665\b|tiger\b|h145m\b|dhruv\b|prahchand\b|light combat helicopter\b)/.test(haystack)) {
        return "helicopter";
    }
    // Trainers
    if (/(trainer\b|advanced trainer\b|jet trainer\b|t-6\b|t6\b|t-38\b|t38\b|hawk\b|m-346\b|m346\b|yak-130\b|yak130\b|jl-10\b|jl10\b|l-15\b|l15\b|k-8\b|k8\b|kt-1\b|kt1\b|pc-21\b|pc21\b)/.test(haystack)) {
        return "trainer";
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
    const altitudeFeet = asFiniteNumber(record.alt_baro, 0);
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
        source: "airplanes_live",
        category: "military",
        subcategory: subtype,
        registration,
        type_code: typeCode,
        model_name: modelName,
        lat: asFiniteNumber(record.lat, NaN),
        lon: asFiniteNumber(record.lon, NaN),
        altitude_ft: altitudeFeet,
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
function clearAllPublicAirTracks() {
    for (const trackKey of __activeTrackKeys) {
        clearLiveTrack(trackKey);
    }
    __activeTrackKeys.clear();
    __sourceTrackStore.clear();
    __canonicalTrackStore.clear();
    __identityCanonicalIndex.clear();
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
    const response = await fetchWithTimeout(AIRPLANES_LIVE_URL, { signal });
    if (!response.ok) {
        throw new Error(`airplanes.live request failed (${response.status})`);
    }
    const payload = await response.json();
    return Array.isArray(payload?.ac) ? payload.ac : [];
}
async function refreshPublicAirTracks(options = {}) {
    const force = options?.force === true;
    if (__isFetching) {
        if (!force) return;
        try {
            __activeFetchController?.abort?.();
        } catch { }
    }
    if (document.visibilityState === "hidden" && !force) return;
    if (!isPublicAirFallbackEnabled()) {
        clearAllPublicAirTracks();
        return;
    }
    __isFetching = true;
    __fetchInFlightSince = Date.now();
    const fetchController = new AbortController();
    __activeFetchController = fetchController;
    try {
        if (!isLayerEnabled("aircraft")) {
            clearAllPublicAirTracks();
            return;
        }
        const records = await fetchAirplanesLiveRecords(fetchController.signal);
        const seenThisPass = new Set();
        for (const record of records) {
            const normalized = normalizeAirplanesLiveRecord(record);
            if (!isTrackRenderable(normalized)) continue;
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
            if (normalized.subcategory === "trainer") continue;
            const canonicalKey = resolveCanonicalKey(normalized);
            const existingCanonical = __canonicalTrackStore.get(canonicalKey);
            if (existingCanonical?.track_key) {
                normalized.track_key = String(existingCanonical.track_key);
            }
            const merged = mergeTrack(existingCanonical, normalized);
            __sourceTrackStore.set(normalized.track_key, normalized);
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
            console.warn("[warzone-air-ingestion] refresh failed:", error);
        }
    } finally {
        if (__activeFetchController === fetchController) {
            __activeFetchController = null;
        }
        __isFetching = false;
        __fetchInFlightSince = 0;
    }
}
async function logAircraftTrack(track) { }
async function markAircraftEnded(trackKey) { }
export async function refreshPublicAirTracksNow(options = {}) {
    if (!isPublicAirFallbackEnabled()) return;
    await refreshPublicAirTracks(options);
}
export function startPublicAirIngestion() {
    if (!isPublicAirFallbackEnabled()) return;
    if (__pollTimer) return;
    refreshPublicAirTracks();
    __pollTimer = window.setInterval(refreshPublicAirTracks, POLL_INTERVAL_MS);
    if (!__visibilitySyncBound) {
        __visibilitySyncBound = true;
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
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
            refreshPublicAirTracks({ force: true }).catch(() => { });
        }, { passive: true });
    }
}
export function stopPublicAirIngestion() {
    if (__pollTimer) {
        window.clearInterval(__pollTimer);
        __pollTimer = null;
    }
    clearAllPublicAirTracks();
}
