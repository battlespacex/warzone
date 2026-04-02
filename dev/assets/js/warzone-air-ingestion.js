// File Path: /assets/js/warzone-air-ingestion.js

import { upsertLiveTrack, clearLiveTrack } from "./warzone-live-airforce.js";
import { isLayerEnabled } from "./warzone-layers.js";
// Note: no direct Supabase writes from frontend — all track data is client-side only
const AIRPLANES_LIVE_URL = "https://api.airplanes.live/v2/mil";
const POLL_INTERVAL_MS = 20000;
const FETCH_TIMEOUT_MS = 9000;
const TRACK_STALE_MS = 90000;
const SOURCE_NAME = "airplanes.live";
const SOURCE_PRIORITY = {
    airplanes_live: 100,
};
let __pollTimer = null;
let __isFetching = false;
const __sourceTrackStore = new Map();
const __canonicalTrackStore = new Map();
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
    if (!key) return "Aircraft";
    return key.charAt(0).toUpperCase() + key.slice(1);
}
function getSourcePriority(source = "") {
    return SOURCE_PRIORITY[source] || 0;
}
function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, {
        ...options,
        signal: controller.signal,
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
    if (/(c-17\b|c17\b|globemaster\b|c-5\b|c5\b|galaxy\b|c-130\b|c130\b|hercules\b|a400m\b|atlas\b|an-124\b|an124\b|ruslan\b|an-12\b|an12\b|an-26\b|an26\b|an-32\b|an32\b|il-76\b|il76\b|y-20\b|y20\b|c-2\b|c2\b|c-27j\b|c27j\b|spartan\b|cn-235\b|cn235\b|c295\b|transall\b|transport\b|airlift\b|airlifter\b|cargo\b|logistics\b|tactical airlift\b)/.test(haystack)) {
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
    return "fighter";
}
function buildCanonicalKey(track = {}) {
    const icao24 = normalizeString(track.icao24 || "").toLowerCase();
    if (icao24) return `icao24:${icao24}`;
    const callsign = normalizeCallsign(track.callsign || "").toLowerCase();
    if (callsign) return `callsign:${callsign}`;
    return `synthetic:${track.track_key}`;
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
    const titleBase = isDisplayTextUsable(callsign)
        ? sanitizeDisplayText(callsign)
        : (isDisplayTextUsable(record.r || record.hex || "")
            ? sanitizeDisplayText(record.r || record.hex || "")
            : `${formatSubtypeTitle(subtype)} ${trackKey.slice(-6).toUpperCase()}`);
    return {
        track_key: trackKey,
        icao24: normalizeString(record.hex || "").toLowerCase(),
        callsign,
        title: titleBase,
        source_name: SOURCE_NAME,
        source: "airplanes_live",
        category: "military",
        subcategory: subtype,
        lat: asFiniteNumber(record.lat, NaN),
        lon: asFiniteNumber(record.lon, NaN),
        altitude_ft: altitudeFeet,
        speed_kts: asFiniteNumber(record.gs, 0),
        heading_deg: asFiniteNumber(record.track, 0),
        occurred_at: new Date().toISOString(),
        timestamp: nowMs(),
        metadata: {
            type: normalizeString(record.t || record.type || ""),
            registration: normalizeString(record.r || ""),
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
}
function cleanupStaleTracks() {
    const cutoff = nowMs() - TRACK_STALE_MS;
    for (const [canonicalKey, track] of __canonicalTrackStore.entries()) {
        if (asFiniteNumber(track.timestamp, 0) >= cutoff) continue;
        __canonicalTrackStore.delete(canonicalKey);
        if (track?.track_key) {
            __activeTrackKeys.delete(track.track_key);
            clearLiveTrack(track.track_key);
            markAircraftEnded(track.track_key);
        }
    }
}
async function fetchAirplanesLiveRecords() {
    const response = await fetchWithTimeout(AIRPLANES_LIVE_URL);
    if (!response.ok) {
        throw new Error(`airplanes.live request failed (${response.status})`);
    }
    const payload = await response.json();
    return Array.isArray(payload?.ac) ? payload.ac : [];
}
async function refreshPublicAirTracks() {
    if (__isFetching) return;
    __isFetching = true;
    try {
        if (!isLayerEnabled("aircraft")) {
            clearAllPublicAirTracks();
            return;
        }
        const records = await fetchAirplanesLiveRecords();
        const seenThisPass = new Set();
        for (const record of records) {
            const normalized = normalizeAirplanesLiveRecord(record);
            if (!isTrackRenderable(normalized)) continue;
            if (normalized.subcategory === "trainer") continue;
            const canonicalKey = buildCanonicalKey(normalized);
            const merged = mergeTrack(__canonicalTrackStore.get(canonicalKey), normalized);
            __sourceTrackStore.set(normalized.track_key, normalized);
            __canonicalTrackStore.set(canonicalKey, merged);
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
        console.warn("[warzone-air-ingestion] refresh failed:", error);
    } finally {
        __isFetching = false;
    }
}
async function logAircraftTrack(track) { }
async function markAircraftEnded(trackKey) { }
export function startPublicAirIngestion() {
    if (__pollTimer) return;
    refreshPublicAirTracks();
    __pollTimer = window.setInterval(refreshPublicAirTracks, POLL_INTERVAL_MS);
}
export function stopPublicAirIngestion() {
    if (__pollTimer) {
        window.clearInterval(__pollTimer);
        __pollTimer = null;
    }
    clearAllPublicAirTracks();
}
