// apps/worker/src/index.js
import dotenv from "dotenv";
dotenv.config({
    path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.local"
});
console.log("RUNNING WORKER INDEX FROM apps/worker/src/index.js");
import http from "http";
import cron from "node-cron";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { supabase } from "./supabase.js";
import crypto from "crypto";
async function saveRawItem({
    source_name,
    source_type,
    parser,
    external_id,
    url,
    title,
    text,
    payload,
    published_at,
    location_hint
}) {
    try {
        const hash = crypto
            .createHash("md5")
            .update((text || "") + (external_id || ""))
            .digest("hex");
        const { error } = await supabase
            .from("raw_items")
            .insert([
                {
                    source_name,
                    source_type,
                    parser,
                    external_id,
                    url,
                    raw_title: title,
                    raw_text: text,
                    raw_payload: payload,
                    published_at,
                    location_hint,
                    hash
                }
            ]);
        if (error) {
            console.error("RAW INSERT ERROR:", error);
        }
    } catch (err) {
        console.error("RAW ITEM FAIL:", err);
    }
}
import { runAdsbWorker } from "./adsb-worker.js";
import { runAisWorker } from "./ais-worker.js";
import { startOrefPoller, handleIsraelWarRoomMessage } from "./warzone-siren-poller.js";
async function getSourceConfig(sourceName) {
    if (!sourceName) return null;
    const { data, error } = await supabase
        .from("source_registry")
        .select("*")
        .eq("source_name", sourceName)
        .single();
    if (error) return null;
    return data;
}
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("warzone worker running");
}).listen(PORT);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourcesPath = path.join(__dirname, "sources.json");
const rawSources = fs.readFileSync(sourcesPath, "utf-8");
function interpolateEnvPlaceholders(str) {
    return String(str || "").replace(/\$\{([A-Z0-9_]+)\}/g, (_, key) => process.env[key] || "");
}
const sources = JSON.parse(interpolateEnvPlaceholders(rawSources));
let isWorkerRunning = false;
/* ----------------------------------------
 * Telegram config
 * -------------------------------------- */
const TELEGRAM_API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH || "";
const TELEGRAM_SESSION = process.env.TELEGRAM_SESSION || "";
const TELEGRAM_DEFAULT_CHANNELS = String(process.env.TELEGRAM_CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
let telegramClient = null;
let telegramReady = false;
/* ----------------------------------------
 * Shared caches / constants
 * -------------------------------------- */
const geocodeCache = new Map();
let lastGeocodeAt = 0;
const DEFAULT_FIRMS_BBOX = process.env.FIRMS_BBOX || "24,29,48,38";
const REGION_BBOX = parseBBox(process.env.REGION_BBOX || DEFAULT_FIRMS_BBOX);
const TRACKED_AIRSPACE_COUNTRIES = String(
    process.env.AIRSPACE_COUNTRIES || "Iran,Israel,Lebanon,Syria,Iraq"
)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const MILITARY_CALLSIGN_HINTS = String(
    process.env.MILITARY_CALLSIGN_HINTS ||
    "RCH,RRR,QID,HOMER,FORTE,LAGR,ASCOT,DUKE,NATO,BAF,SVF,MC,HKY,ROGUE,REACH,TANKER,SHELL,TEXACO,GOLD,BLUE,NACHO,DRAGO,OMAHA"
)
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
const TELEGRAM_RELEVANT_KEYWORDS = [
    "missile",
    "ballistic",
    "cruise missile",
    "rocket",
    "drone",
    "uav",
    "shahed",
    "loitering munition",
    "airstrike",
    "air strike",
    "bombardment",
    "artillery",
    "shelling",
    "barrage",
    "naval strike",
    "warship",
    "frigate",
    "destroyer",
    "submarine",
    "carrier",
    "fleet",
    "fighter jet",
    "f-18",
    "f-35",
    "b-1",
    "b-2",
    "b-52",
    "siren",
    "sirens",
    "alert",
    "red alert",
    "air raid",
    "air raid alert",
    "warning",
    "interception",
    "intercepted",
    "air defense",
    "air-defence",
    "interceptor",
    "explosion",
    "blast",
    "notam",
    "airspace"
];
const GENERIC_RELEVANT_KEYWORDS = [
    "missile",
    "ballistic missile",
    "cruise missile",
    "hypersonic missile",
    "rocket attack",
    "rocket barrage",
    "drone strike",
    "drone attack",
    "uav strike",
    "shahed",
    "kamikaze drone",
    "loitering munition",
    "air strike",
    "airstrike",
    "air raid",
    "bombardment",
    "artillery strike",
    "artillery barrage",
    "shelling",
    "barrage",
    "warship",
    "naval strike",
    "fleet deployment",
    "fighter jet",
    "combat aircraft",
    "sortie",
    "scramble",
    "intercept",
    "interception",
    "air defense",
    "air-defence",
    "siren",
    "sirens",
    "red alert",
    "take shelter",
    "military base attack",
    "airbase attack",
    "airbase strike",
    "notam",
    "airspace closed",
    "airspace restricted",
    "airspace violation",
    "troop movement",
    "military convoy",
    "submarine spotted",
    "carrier group",
    "destroyer",
    "frigate",
    "military operation",
    "special operation",
    "ground offensive",
    "cyber attack",
    "cyberattack"
];
const HARD_MILITARY_TERMS = [
    "missile",
    "ballistic missile",
    "cruise missile",
    "drone",
    "uav",
    "shahed",
    "airstrike",
    "air strike",
    "fighter jet",
    "bomber",
    "artillery",
    "rocket attack",
    "warship",
    "frigate",
    "destroyer",
    "carrier",
    "fleet",
    "naval attack",
    "military base",
    "airbase",
    "air defense",
    "troop movement",
    "sortie",
    "interceptor",
    "submarine"
];
const STOP_LOCATION_WORDS = new Set([
    "breaking",
    "urgent",
    "update",
    "updates",
    "reports",
    "report",
    "confirmed",
    "unconfirmed",
    "alert",
    "sirens",
    "missile",
    "missiles",
    "rocket",
    "rockets",
    "drone",
    "drones",
    "uav",
    "airstrike",
    "strike",
    "airstrikes",
    "explosion",
    "explosions",
    "military",
    "naval",
    "fleet",
    "warship",
    "fighter",
    "fighters",
    "jet",
    "jets",
    "airspace",
    "defense",
    "defence",
    "warning",
    "ongoing",
    "multiple",
    "heavy",
    "massive",
    "possible",
    "incoming",
    "launch",
    "launched",
    "launches",
    "impact",
    "impacts",
    "intercepted",
    "interception"
]);
const HARD_MILITARY_AIRCRAFT_CODES = new Set([
    // US / NATO fighters
    "F14", "F15", "F16", "F18", "F22", "F35", "A10", "AV8", "EA18", "F5", "F4",
    // European fighters / strike
    "EUFI", "TORN", "RAFA", "M2K", "M346", "JAS3", "GRIP", "ALPH",
    // Russian / Soviet fighters / strike / bomber
    "SU24", "SU25", "SU27", "SU30", "SU30MKI", "SU30MKK", "SU30SM", "SU33", "SU34", "SU35", "SU57",
    "MIG21", "MIG23", "MIG25", "MIG27", "MIG29", "MIG31",
    "TU22", "TU95", "TU160",
    // Chinese fighters / strike / bomber
    "J7", "J8", "J10", "J11", "J15", "J16", "J20", "JH7", "H6",
    // Pakistan / India / regional / trainers
    "JF17", "TEJA", "LCA", "M2000", "MIR2", "MIR3",
    // AWACS / AEW / ISR
    "E3", "E3TF", "E3CF", "E7", "E8", "A50", "A100", "KJ200", "KJ500", "ZDK03", "SAAB340", "SAAB2000",
    "RC135", "R135", "EP3", "P8", "P3", "IL20", "TU214R", "RQ4",
    // Tankers / refuelers
    "KC10", "KC30", "KC46", "KC135", "IL78", "K35R", "K30T", "A330MRTT", "A310MRTT",
    // Transport / lift
    "C17", "C130", "C27J", "C295", "C5", "A400", "A124", "AN12", "AN22", "AN26", "AN72", "IL76", "Y20",
    // Helicopters / tiltrotor / gunships
    "AH1", "AH64", "H47", "CH47", "UH1", "UH60", "V22", "MI8", "MI17", "MI24", "MI25", "MI28", "MI35", "KA52",
    "KA27", "Z10", "Z19", "Z20", "SA330", "AS532", "EC725",
    // Maritime / naval aviation
    "P8A", "P3C", "S3B", "SH60", "MH60", "KA31"
]);
const HARD_MILITARY_OPERATORS = [
    "AIR FORCE",
    "US AIR FORCE",
    "USAF",
    "ROYAL AIR FORCE",
    "RAF",
    "LUFTWAFFE",
    "NATO",
    "US NAVY",
    "NAVY",
    "ARMY",
    "MARINES",
    "QATAR EMIRI AIR FORCE",
    "ISRAEL AIR FORCE",
    "RUSSIAN AIR FORCE",
    "RUSSIAN AEROSPACE FORCES",
    "PAKISTAN AIR FORCE",
    "INDIAN AIR FORCE",
    "PEOPLE'S LIBERATION ARMY AIR FORCE",
    "PLAAF",
    "PEOPLE'S LIBERATION ARMY NAVY",
    "PLANAF",
    "TURKISH AIR FORCE",
    "SAUDI AIR FORCE",
    "ROYAL SAUDI AIR FORCE",
    "UAE AIR FORCE",
    "EMIRATES AIR FORCE",
    "EGYPTIAN AIR FORCE",
    "IRANIAN AIR FORCE",
    "IRGC AEROSPACE",
    "FRENCH AIR AND SPACE FORCE",
    "ARMEE DE L'AIR",
    "ITALIAN AIR FORCE",
    "AERONAUTICA MILITARE",
    "SPANISH AIR FORCE",
    "HELLENIC AIR FORCE",
    "ALGERIAN AIR FORCE",
    "IRAQI AIR FORCE",
    "SYRIAN AIR FORCE",
    "JORDANIAN AIR FORCE",
    "OMAN AIR FORCE",
    "KUWAIT AIR FORCE",
    "BAHRAIN AIR FORCE"
];
function looksLikeMilitaryAircraftCode(code) {
    const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!clean) return false;
    if (HARD_MILITARY_AIRCRAFT_CODES.has(clean)) return true;
    return (
        clean.startsWith("F1") ||
        clean.startsWith("F2") ||
        clean.startsWith("F3") ||
        clean.startsWith("SU") ||
        clean.startsWith("MIG") ||
        clean.startsWith("TU") ||
        clean.startsWith("J1") ||
        clean.startsWith("J2") ||
        clean.startsWith("H6") ||
        clean.startsWith("KC") ||
        clean.startsWith("IL") ||
        clean.startsWith("RC") ||
        clean.startsWith("E3") ||
        clean.startsWith("E7") ||
        clean.startsWith("A5") ||
        clean.startsWith("KJ") ||
        clean.startsWith("C1") ||
        clean.startsWith("C2") ||
        clean.startsWith("AN") ||
        clean.startsWith("AH") ||
        clean.startsWith("UH") ||
        clean.startsWith("MI") ||
        clean.startsWith("KA") ||
        clean.startsWith("Z1") ||
        clean.startsWith("Z2")
    );
}
/* ----------------------------------------
 * Generic helpers
 * -------------------------------------- */
function deriveAircraftRole(row) {
    const code = String(
        row?.aircraft?.icaoCode ||
        row?.aircraft?.model ||
        row?.aircraft_type ||
        row?.type ||
        ""
    ).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const callsign = String(
        row?.callsign ||
        row?.flight?.icaoNumber ||
        row?.flight?.number ||
        ""
    ).toUpperCase();
    if (/(KC10|KC30|KC46|KC135|IL78|K35R|K30T|A330MRTT|A310MRTT)/.test(code) || /(SHELL|TEXACO|TANKER)/.test(callsign)) return "tanker";
    if (/(E3|E7|E8|A50|A100|KJ200|KJ500|ZDK03|SAAB340|SAAB2000)/.test(code)) return "awacs";
    if (/(RC135|R135|EP3|P8|P3|IL20|TU214R|RQ4|FORTE)/.test(code) || /(FORTE)/.test(callsign)) return "isr";
    if (/(B52|B1|B2|TU22|TU95|TU160|H6)/.test(code)) return "bomber";
    if (/(F14|F15|F16|F18|F22|F35|A10|AV8|EA18|F5|F4|EUFI|TORN|RAFA|M2K|M346|JAS3|GRIP|SU24|SU25|SU27|SU30|SU30MKI|SU30MKK|SU30SM|SU33|SU34|SU35|SU57|MIG21|MIG23|MIG25|MIG27|MIG29|MIG31|J7|J8|J10|J11|J15|J16|J20|JH7|JF17|TEJA|LCA|M2000|MIR2|MIR3)/.test(code)) return "fighter";
    if (/(C17|C130|C27J|C295|C5|A400|A124|AN12|AN22|AN26|AN72|IL76|Y20)/.test(code) || /(RCH|REACH|ASCOT)/.test(callsign)) return "transport";
    if (/(AH1|AH64|H47|CH47|UH1|UH60|V22|MI8|MI17|MI24|MI25|MI28|MI35|KA52|KA27|Z10|Z19|Z20|SA330|AS532|EC725)/.test(code)) return "helicopter";
    if (/(P8A|P3C|S3B|SH60|MH60|KA31)/.test(code)) return "maritime_patrol";
    return "military_aircraft";
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
}
function toArray(value) {
    return Array.isArray(value) ? value : [];
}
function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function toTelegramChannelKey(value) {
    return String(value || "")
        .trim()
        .replace(/^https?:\/\/t\.me\//i, "")
        .replace(/^@/, "")
        .replace(/\/+$/, "");
}
function makeTelegramStateKey(channelKey) {
    return `telegram:${channelKey}`;
}
function buildTelegramMessageUrl(channelKey, messageId) {
    if (!channelKey || String(channelKey).startsWith("-100")) return "";
    return `https://t.me/${channelKey}/${messageId}`;
}
function sanitizeTag(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function uniqueTags(values) {
    return [...new Set(values.map(sanitizeTag).filter(Boolean))];
}
function parseBBox(value) {
    const parts = String(value || "")
        .split(",")
        .map((x) => Number(x.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return null;
    }
    const [minLon, minLat, maxLon, maxLat] = parts;
    return { minLon, minLat, maxLon, maxLat };
}
function isWithinBBox(lat, lon, bbox = REGION_BBOX) {
    if (!bbox) return true;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    return (
        lon >= bbox.minLon &&
        lon <= bbox.maxLon &&
        lat >= bbox.minLat &&
        lat <= bbox.maxLat
    );
}
function buildSourceUrl(baseUrl, params = {}) {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        url.searchParams.set(key, String(value));
    }
    return url.toString();
}
function splitCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === `"` && inQuotes && next === `"`) {
            current += `"`;
            i += 1;
            continue;
        }
        if (char === `"`) {
            inQuotes = !inQuotes;
            continue;
        }
        if (char === "," && !inQuotes) {
            result.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    result.push(current);
    return result;
}
function parseCsv(text) {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (!lines.length) return [];
    const headers = splitCsvLine(lines[0]).map((h) => h.trim());
    return lines.slice(1).map((line) => {
        const values = splitCsvLine(line);
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = values[index] ?? "";
        });
        return obj;
    });
}
function normalizeOccurredAt(value) {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
}
function combineDateAndTime(dateValue, timeValue) {
    const datePart = String(dateValue || "").trim();
    const timePart = String(timeValue || "").trim();
    if (!datePart) return new Date().toISOString();
    if (!timePart) {
        const d = new Date(`${datePart}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    const padded = timePart.padStart(4, "0");
    const hh = padded.slice(0, 2);
    const mm = padded.slice(2, 4);
    const d = new Date(`${datePart}T${hh}:${mm}:00Z`);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
function containsRelevantKeyword(text, extraKeywords = []) {
    const lower = normalizeText(text).toLowerCase();
    const all = [...new Set([...GENERIC_RELEVANT_KEYWORDS, ...extraKeywords.map((x) => String(x).toLowerCase())])];
    return all.some((keyword) => lower.includes(keyword));
}
function cleanLocationCandidate(value) {
    return String(value || "")
        .replace(/^[\s,:;.\-  ]+/, "")
        .replace(/[\s,:;.\-  ]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
}
function isGoodLocationCandidate(value) {
    const cleaned = cleanLocationCandidate(value);
    if (!cleaned) return false;
    if (cleaned.length < 3 || cleaned.length > 80) return false;
    const lower = cleaned.toLowerCase();
    if (STOP_LOCATION_WORDS.has(lower)) return false;
    if (/^\d+$/.test(cleaned)) return false;
    if (/^(today|tonight|yesterday|tomorrow|morning|evening|afternoon)$/i.test(cleaned)) return false;
    return true;
}
function extractLocationCandidates(text) {
    const candidates = [];
    const normalized = String(text || "").replace(/\n/g, " ");
    const patterns = [
        /\b(?:in|near|over|around|at)\s+([A-Z][A-Za-z.' -]+(?:[\s-][A-Z][A-Za-z.' -]+){0,3}(?:,\s*[A-Z][A-Za-z.' -]+(?:[\s-][A-Z][A-Za-z.' -]+){0,2})?)/g,
        /\b(?:north of|south of|east of|west of)\s+([A-Z][A-Za-z.' -]+(?:[\s-][A-Z][A-Za-z.' -]+){0,3}(?:,\s*[A-Z][A-Za-z.' -]+(?:[\s-][A-Z][A-Za-z.' -]+){0,2})?)/g,
        /\b([A-Z][A-Za-z.' -]+(?:[\s-][A-Z][A-Za-z.' -]+){0,2},\s*[A-Z][A-Za-z.' -]+(?:[\s-][A-Z][A-Za-z.' -]+){0,2})\b/g
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(normalized)) !== null) {
            const raw = match[1];
            const cleaned = cleanLocationCandidate(raw);
            if (!isGoodLocationCandidate(cleaned)) continue;
            if (cleaned.length > 40) continue;
            if (/\b(road|street|avenue|county|council|partnership|brigade|command|division|battalion|launcher|facility|damage)\b/i.test(cleaned)) continue;
            candidates.push(cleaned);
        }
    }
    return [...new Set(candidates)].slice(0, 4);
}
function extractCoordinatesFromText(text) {
    const match = String(text || "").match(/(-?\d{1,2}\.\d{2,8})\s*[, ]\s*(-?\d{1,3}\.\d{2,8})/);
    if (!match) return null;
    const lat = safeNumber(match[1]);
    const lon = safeNumber(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
}
async function geocodeLocation(query) {
    const key = cleanLocationCandidate(query).toLowerCase();
    if (!key) return null;
    if (geocodeCache.has(key)) {
        return geocodeCache.get(key);
    }
    const now = Date.now();
    const elapsed = now - lastGeocodeAt;
    if (elapsed < 1100) {
        await sleep(1100 - elapsed);
    }
    try {
        const response = await axios.get("https://nominatim.openstreetmap.org/search", {
            params: {
                q: query,
                format: "jsonv2",
                limit: 1,
                addressdetails: 1,
            },
            headers: {
                "User-Agent": "warzone-worker/1.0",
                Accept: "application/json"
            },
            timeout: 15000
        });
        lastGeocodeAt = Date.now();
        const item = Array.isArray(response.data) ? response.data[0] : null;
        if (!item) {
            geocodeCache.set(key, null);
            return null;
        }
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            geocodeCache.set(key, null);
            return null;
        }
        // Build short clean label: "City, Country" — not full Nominatim display_name
        const addr = item.address || {};
        const city =
            addr.city ||
            addr.town ||
            addr.village ||
            addr.municipality ||
            addr.county ||
            addr.state_district ||
            addr.state ||
            item.name ||
            "";
        const country = addr.country || "";
        const label = [city, country].filter(Boolean).join(", ") || query;
        const result = { lat, lon, label };
        geocodeCache.set(key, result);
        return result;
    } catch (error) {
        console.error("Geocode error:", query, error.response?.status || error.message);
        geocodeCache.set(key, null);
        return null;
    }
}
async function resolveLocationFromText(text, options = {}) {
    const coordinateMatch = extractCoordinatesFromText(text);
    if (coordinateMatch) {
        return {
            lat: coordinateMatch.lat,
            lon: coordinateMatch.lon,
            label: `${coordinateMatch.lat}, ${coordinateMatch.lon}`
        };
    }
    const candidates = extractLocationCandidates(text);
    for (const candidate of candidates) {
        const geocoded = await geocodeLocation(candidate);
        if (!geocoded) continue;
        if (!Number.isFinite(geocoded.lat) || !Number.isFinite(geocoded.lon)) continue;
        if (options.requireBBox !== false && !isWithinBBox(geocoded.lat, geocoded.lon)) {
            continue;
        }
        return geocoded;
    }
    return null;
}
function makeDedupeKey(item, feed) {
    const title = (item.title || "").toLowerCase().slice(0, 120);
    const location = (item.location_label || "").toLowerCase();
    const category = (item.category || "").toLowerCase();
    const time = item.occurred_at
        ? new Date(item.occurred_at).toISOString().slice(0, 16) // minute-level
        : "";
    return [
        feed.name || "feed",
        category,
        title,
        location,
        time
    ].join("|");
}
function derivePriorityScore(event) {
    if (!event) return 0;
    const category = String(event.category || "").toLowerCase();
    const severity = String(event.severity || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const target = String(event.target_type || "").toLowerCase();
    let score = 40;
    if (category === "strike") score += 35;
    else if (category === "alert") score += 25;
    else if (category === "cyber") score += 20;
    else if (category === "recon") score += 15;
    else if (category === "military") score += 18;
    else if (category === "naval") score += 18;
    else if (category === "conflict") score += 20;
    else if (category === "network") score += 18;
    if (severity === "critical") score += 20;
    else if (severity === "high") score += 12;
    else if (severity === "medium") score += 6;
    if ([
        "ballistic missile",
        "cruise missile",
        "missile",
        "drone",
        "air strike",
        "fighter aircraft",
        "artillery",
        "submarine",
        "frigate",
        "destroyer",
        "cyber"
    ].includes(weapon)) {
        score += 10;
    }
    if ([
        "airbase",
        "military facility",
        "naval asset",
        "radar site",
        "airport",
        "port",
        "energy infrastructure",
        "digital infrastructure",
        "communications infrastructure"
    ].includes(target)) {
        score += 8;
    }
    return Math.min(100, score);
}
function deriveConfidence(event) {
    if (!event) return 40;
    let score = 40;
    const source = (event.source_name || "").toLowerCase();
    const summary = (event.summary || "").toLowerCase();
    const category = (event.category || "").toLowerCase();
    if (source.includes("official") || source.includes("alert")) score += 30;
    else if (source.includes("adsb") || source.includes("ais")) score += 25;
    else if (source.includes("telegram")) score += 10;
    else if (source.includes("reddit")) score -= 10;
    if (/missile|ballistic|airstrike|explosion/.test(summary)) score += 20;
    if (/confirmed|intercepted|official/.test(summary)) score += 15;
    if (category === "strike") score += 15;
    if (category === "alert") score += 10;
    return Math.max(10, Math.min(95, score));
}
// ── Source / location helpers ─────────────────────────────────────────────────
function cleanSourceName(raw) {
    if (!raw) return "Unknown";
    let s = String(raw).trim();
    s = s.replace(/^https?:\/\/(www\.)?/i, "");
    s = s.replace(/\.(com|org|net|io|gov|mil)(\/.*)?$/i, "");
    s = s.replace(/^Telegram\s*\/\s*/i, "TG / ");
    s = s.replace(/^Reddit\s+/i, "r/");
    return s.slice(0, 40).trim();
}
async function resolveRedditLocation(post) {
    const titleLocation = await resolveLocationFromText(post.title || "", { requireBBox: false });
    if (titleLocation) return titleLocation;
    return resolveLocationFromText((post.selftext || "").slice(0, 500), { requireBBox: false });
}
function extractGdeltCoords(item) {
    const lat = Number(item.actiongeo_lat || item.locationlat || 0);
    const lon = Number(item.actiongeo_long || item.locationlon || 0);
    const label = item.actiongeo_fullname || item.locationname || "";
    return { lat, lon, label };
}
function deriveNetworkSeverity(kind, scope = "unknown") {
    if (kind === "internet_outage" && scope === "country") return "critical";
    if (kind === "connectivity_loss" && scope === "asn") return "high";
    if (kind === "service_blocking") return "medium";
    return "low";
}
// Civilian noise — if any of these appear, reject immediately
const CIVILIAN_NOISE_TERMS = [
    // Crime
    "murder", "homicide", "manslaughter", "stabbing", "stab victim",
    "robbery", "armed robbery", "carjacking", "kidnapping", "abduction",
    "domestic violence", "domestic abuse", "sexual assault", "rape",
    "gang shooting", "drive-by", "mass shooting", "school shooting",
    "nightclub shooting", "bar fight", "brawl",
    // Law enforcement civilian
    "police chase", "police arrest", "drug bust", "drug raid",
    "narcotics", "trafficking bust", "fbi raid", "swat team",
    "sheriff", "deputy", "police officer killed", "cop shot",
    "law enforcement", "criminal investigation", "crime scene",
    "death toll", "civilians killed by police",
    // Accidents
    "car accident", "traffic accident", "road accident", "vehicle crash",
    "train derailment", "plane crash", "bus crash",
    "construction accident", "workplace accident", "industrial accident",
    "gas leak", "gas explosion", "boiler explosion", "pipeline leak",
    "house fire", "building fire", "apartment fire", "forest fire",
    "wildfire update", "chemical spill",
    // Civilian emergency
    "earthquake", "flood", "hurricane", "typhoon", "tsunami warning",
    "tornado", "landslide", "avalanche",
    "hospital attack", "school attack", "church attack", "mosque attack",
    // Politics / diplomacy / noise
    "election", "vote", "ballot", "parliament", "congress", "senate",
    "sanctions", "ceasefire talks", "peace talks", "diplomacy",
    "trade war", "tariff", "stock market", "economy", "inflation",
    "protest", "demonstration", "rally", "strike workers",
    "refugee", "migrant", "immigration",
    // Media noise
    "opinion", "editorial", "analysis only", "podcast", "interview",
    "subscribe", "follow us", "click here", "more details soon",
    "developing story", "video in link", "see thread", "live now",
    "breaking news alert", "just in", "weather alert", "storm warning"
];
function isGarbageEvent(event) {
    if (!event) return true;
    const title = normalizeText(event.title || "");
    const summary = normalizeText(event.summary || "");
    const combined = `${title} ${summary}`.toLowerCase();
    // Basic content checks
    if (!title || !summary) return true;
    if (title.length < 10) return true;
    if (summary.length < 15) return true;
    // Reject pure noise titles
    if (/^(breaking|update|urgent|alert|reports?|video|watch|developing)$/i.test(title)) return true;
    // Reject URL-only summaries
    if (/^https?:\/\//i.test(summary)) return true;
    // Reject civilian noise — strict block
    if (CIVILIAN_NOISE_TERMS.some((term) => combined.includes(term))) return true;
    // Must contain at least one hard military signal
    const hasRelevant =
        containsRelevantKeyword(combined, TELEGRAM_RELEVANT_KEYWORDS) ||
        HARD_MILITARY_TERMS.some((term) => combined.includes(term));
    if (!hasRelevant) return true;
    return false;
}
function isMilitaryRelevantEvent(event) {
    if (!event) return false;
    const category = String(event.category || "").toLowerCase();
    const weapon = String(event.weapon_type || "").toLowerCase();
    const reportType = String(event.report_type || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    const summary = String(event.summary || "").toLowerCase();
    const combined = `${title} ${summary} ${weapon}`;
    // Hard reject civilian noise first — takes priority over everything
    if (CIVILIAN_NOISE_TERMS.some((term) => combined.includes(term))) return false;
    // Trusted military report types always pass
    if ([
        "flight_tracking", "siren_alert", "notam",
        "thermal_anomaly", "seismic", "cyber", "network",
        "osint", "conflict"
    ].includes(reportType)) return true;
    // Trusted military categories always pass
    if ([
        "strike", "military", "alert", "airspace",
        "cyber", "recon", "thermal", "signal", "network"
    ].includes(category)) return true;
    // Must contain hard military terms
    if (HARD_MILITARY_TERMS.some((term) => combined.includes(term))) return true;
    // Pass seismic only if near conflict zone
    // (USGS already filters by bbox so this is fine)
    if (category === "seismic") return true;
    return false;
}
function deriveEventStatus(event) {
    const confidence = Number(event?.confidence || 0);
    const source = String(event?.source_name || "").toLowerCase();
    const summary = String(event?.summary || "").toLowerCase();
    if (confidence >= 85 || source.includes("official") || /confirmed|official|verified/.test(summary)) {
        return "verified";
    }
    if (confidence >= 60) {
        return "developing";
    }
    return "signal";
}
function applyEscalation(existing, incoming) {
    const out = {};
    const baseConf = Number(existing?.confidence || 50);
    const inc = Number(incoming?.confidence || 50);
    // boost confidence on corroboration
    const boosted = Math.min(95, Math.max(baseConf, inc) + 5);
    out.confidence = boosted;
    // escalate status
    const statusOrder = ["signal", "developing", "verified"];
    const cur = String(existing?.status || "signal");
    let idx = statusOrder.indexOf(cur);
    if (boosted >= 85) idx = 2;
    else if (boosted >= 60) idx = Math.max(idx, 1);
    out.status = statusOrder[idx] || "signal";
    // increment sources
    out.source_count = (existing?.source_count || 1) + 1;
    out.updated_at = new Date().toISOString();
    return out;
}
/* ----------------------------------------
 * Supabase helpers
 * -------------------------------------- */
async function insertEvent(event) {
    try {
        await saveRawItem({
            source_name: event.source_name || "unknown",
            source_type: "worker",
            parser: "main",
            external_id: event.dedupe_key || null,
            url: event.source_url || null,
            title: event.title || "",
            text: event.summary || "",
            payload: event,
            published_at: event.occurred_at || new Date().toISOString(),
            location_hint: event.location_label || null
        });
        let payload = { ...event };
        // FIX: ensure confidence is numeric
        if (typeof payload.confidence === "string") {
            const map = { low: 30, medium: 50, high: 80, verified: 95 };
            payload.confidence = map[payload.confidence.toLowerCase()] || 50;
        }
        let { error } = await supabase.from("events").insert([payload]);
        if (error && /priority_score/i.test(error.message || "")) {
            delete payload.priority_score;
            const retry = await supabase.from("events").insert([payload]);
            error = retry.error || null;
        }
        if (error) {
            console.error("Insert error:", error.message);
            return false;
        }
        console.log("Event inserted:", event.title);
        return true;
    } catch (err) {
        console.error("InsertEvent FAIL:", err);
        return false;
    }
}
async function upsertActiveAlert(alert) {
    const { error } = await supabase
        .from("active_alerts")
        .upsert(
            {
                alert_key: alert.alert_key,
                category: alert.category || "alert",
                region: alert.region,
                title: alert.title,
                summary: alert.summary || "",
                status: alert.status || "active",
                source_name: alert.source_name || "",
                source_url: alert.source_url || "",
                updated_at: new Date().toISOString(),
                started_at: alert.started_at || new Date().toISOString(),
                expires_at: alert.expires_at || null
            },
            { onConflict: "alert_key" }
        );
    if (error) {
        console.error("Active alert upsert error:", error.message);
    }
}
async function clearExpiredAlerts() {
    const { error } = await supabase
        .from("active_alerts")
        .update({
            status: "cleared",
            cleared_at: new Date().toISOString()
        })
        .eq("status", "active")
        .lt("expires_at", new Date().toISOString());
    if (error) {
        console.error("Active alert cleanup error:", error.message);
    }
}
async function upsertAirspaceStatus(status) {
    const payload = {
        region: status.region || "Unknown",
        country_code: status.country_code || "",
        status: status.status || "normal",
        title: status.title || "Airspace status",
        summary: status.summary || "",
        source_name: status.source_name || "",
        source_url: status.source_url || "",
        fir_code: status.fir_code || "",
        updated_at: new Date().toISOString(),
        expires_at: status.expires_at || null,
        lat: Number.isFinite(status.lat) ? status.lat : null,
        lon: Number.isFinite(status.lon) ? status.lon : null
    };
    const { error } = await supabase
        .from("airspace_status")
        .upsert(payload, { onConflict: "region" });
    if (error) {
        console.error("Airspace status upsert error:", error.message);
    }
}
async function eventExists(dedupeKey) {
    const { data, error } = await supabase
        .from("events")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .limit(1);
    if (error) {
        console.error("Lookup error:", error.message);
        return false;
    }
    return Array.isArray(data) && data.length > 0;
}
async function getWorkerState(stateKey) {
    const { data, error } = await supabase
        .from("worker_state")
        .select("state_key,last_message_id")
        .eq("state_key", stateKey)
        .maybeSingle();
    if (error) {
        console.error("Worker state read error:", error.message);
        return null;
    }
    return data || null;
}
async function setWorkerState(stateKey, lastMessageId) {
    const { error } = await supabase
        .from("worker_state")
        .upsert(
            {
                state_key: stateKey,
                last_message_id: Number(lastMessageId) || 0,
                updated_at: new Date().toISOString()
            },
            { onConflict: "state_key" }
        );
    if (error) {
        console.error("Worker state write error:", error.message);
    }
}
async function similarEventExists(event) {
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return false;
    const eventTime = new Date(event.occurred_at).getTime();
    if (!Number.isFinite(eventTime)) return false;
    const fromTime = new Date(eventTime - 60 * 60 * 1000).toISOString(); // 1 hr
    const toTime = new Date(eventTime + 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from("events")
        .select("id, title, lat, lon")
        .gte("occurred_at", fromTime)
        .lte("occurred_at", toTime)
        .limit(50);
    if (error) {
        console.error("Similarity lookup error:", error.message);
        return false;
    }
    for (const row of data || []) {
        const latDiff = Math.abs(Number(row.lat) - Number(event.lat));
        const lonDiff = Math.abs(Number(row.lon) - Number(event.lon));
        const sameArea = latDiff < 0.3 && lonDiff < 0.3;
        const titleA = (row.title || "").toLowerCase();
        const titleB = (event.title || "").toLowerCase();
        const sameTitle =
            titleA.includes(titleB.slice(0, 20)) ||
            titleB.includes(titleA.slice(0, 20));
        if (sameArea && sameTitle) {
            return true;
        }
    }
    return false;
}
async function findSimilarEvent(event) {
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return null;
    const eventTime = new Date(event.occurred_at).getTime();
    if (!Number.isFinite(eventTime)) return null;
    const fromTime = new Date(eventTime - 60 * 60 * 1000).toISOString();
    const toTime = new Date(eventTime + 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
        .from("events")
        .select("*")
        .gte("occurred_at", fromTime)
        .lte("occurred_at", toTime)
        .limit(20);
    if (error) {
        console.error("Find similar error:", error.message);
        return null;
    }
    for (const row of data || []) {
        const latDiff = Math.abs(Number(row.lat) - Number(event.lat));
        const lonDiff = Math.abs(Number(row.lon) - Number(event.lon));
        const sameArea = latDiff < 0.3 && lonDiff < 0.3;
        const titleA = (row.title || "").toLowerCase();
        const titleB = (event.title || "").toLowerCase();
        const sameTitle =
            titleA.includes(titleB.slice(0, 20)) ||
            titleB.includes(titleA.slice(0, 20));
        if (sameArea && sameTitle) {
            return row;
        }
    }
    return null;
}
async function findOrCreateCluster(event) {
    const lat = Number(event?.lat);
    const lon = Number(event?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const { data, error } = await supabase
        .from("event_clusters")
        .select("*")
        .limit(50);
    if (error) {
        console.error("Cluster fetch error:", error.message);
        return null;
    }
    for (const cluster of data || []) {
        const latDiff = Math.abs(Number(cluster.lat) - lat);
        const lonDiff = Math.abs(Number(cluster.lon) - lon);
        if (latDiff < 0.5 && lonDiff < 0.5) {
            return cluster;
        }
    }
    const { data: newCluster, error: createError } = await supabase
        .from("event_clusters")
        .insert([
            {
                lat,
                lon,
                event_count: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        ])
        .select()
        .single();
    if (createError) {
        console.error("Cluster create error:", createError.message);
        return null;
    }
    return newCluster;
}
async function insertEventIfValid(event) {
    if (!event) return false;
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) return false;
    const sourceConfig = await getSourceConfig(event.feed_name || event.source_name);
    if (sourceConfig) {
        if (sourceConfig.enabled === false) return false;
        if (sourceConfig.promotion_mode === "restricted") return false;
    }
    if ((event.title || "").length < 10) return false;
    if (!event.summary || event.summary.length < 15) return false;
    if (isGarbageEvent(event)) return false;
    if (!isMilitaryRelevantEvent(event)) return false;
    const exists = await eventExists(event.dedupe_key);
    if (exists) return false;
    event.priority_score = derivePriorityScore(event);
    if (!Number.isFinite(event.confidence)) {
        event.confidence = deriveConfidence(event);
    }
    if (sourceConfig && Number.isFinite(Number(sourceConfig.default_confidence))) {
        event.confidence = Number(sourceConfig.default_confidence);
    }
    if (typeof deriveEventStatus === "function") {
        event.status = deriveEventStatus(event);
    }
    const existing = await findSimilarEvent(event);
    if (existing) {
        const update = applyEscalation(existing, event);
        await supabase
            .from("events")
            .update(update)
            .eq("id", existing.id);
        // 🔥 ESCALATION ALERT
        if (update.status === "verified" || update.confidence >= 85) {
            await upsertActiveAlert({
                alert_key: existing.id,
                category: "escalation",
                region: event.location_label || "unknown",
                title: existing.title || event.title,
                summary: event.summary,
                source_name: event.source_name,
                source_url: event.source_url,
                started_at: existing.occurred_at
            });
        }
        console.log("Merged+Escalated:", existing.title);
        return true;
    }
    return insertEvent(event);
}
async function pruneStaleData() {
    const now = new Date();
    // Events older than 7 days
    const eventsCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: eventsError } = await supabase
        .from("events")
        .delete()
        .lt("occurred_at", eventsCutoff);
    if (eventsError) console.error("Events prune error:", eventsError.message);
    else console.log("[prune] Events older than 7 days removed");
    // Aircraft tracks older than 24 hours
    const aircraftCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { error: aircraftError } = await supabase
        .from("aircraft_tracks_log")
        .delete()
        .lt("last_seen_at", aircraftCutoff);
    if (aircraftError) console.error("Aircraft prune error:", aircraftError.message);
    else console.log("[prune] Aircraft tracks older than 24 hours removed");
    // Raw items older than 48 hours
    const rawCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const { error: rawError } = await supabase
        .from("raw_items")
        .delete()
        .lt("created_at", rawCutoff);
    if (rawError) console.error("Raw items prune error:", rawError.message);
    else console.log("[prune] Raw items older than 48 hours removed");
    // Event clusters older than 7 days
    const clusterCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: clusterError } = await supabase
        .from("event_clusters")
        .delete()
        .lt("updated_at", clusterCutoff);
    if (clusterError) console.error("Cluster prune error:", clusterError.message);
    else console.log("[prune] Old event clusters removed");
}
/* ----------------------------------------
 * ACLED
 * -------------------------------------- */
async function getAcledToken() {
    const response = await axios.post(
        "https://acleddata.com/oauth/token",
        new URLSearchParams({
            username: process.env.ACLED_EMAIL || "",
            password: process.env.ACLED_PASSWORD || "",
            grant_type: "password",
            client_id: "acled"
        }).toString(),
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            timeout: 20000
        }
    );
    if (!response.data?.access_token) {
        throw new Error("ACLED token not received");
    }
    return response.data.access_token;
}
async function fetchAcledEvents() {
    const token = await getAcledToken();
    const response = await axios.get("https://api.acleddata.com/acled/read", {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
        },
        params: { limit: 50 },
        timeout: 20000
    });
    return response.data;
}
function normalizeAcledEvent(item, feed) {
    return {
        category: feed.category || "conflict",
        title: item.event_type || "ACLED event",
        summary: item.sub_event_type || item.notes || "ACLED conflict event",
        source_name: "ACLED",
        source_url: "https://acleddata.com",
        occurred_at: normalizeOccurredAt(item.event_date),
        lat: Number(item.latitude),
        lon: Number(item.longitude),
        location_label: [item.location, item.admin1, item.country].filter(Boolean).join(", ") || "Unknown location",
        confidence: 75,
        actor_side: "unknown",
        target_side: "unknown",
        weapon_type: "unknown",
        target_type: "unknown",
        impact_type: "unknown",
        report_type: "conflict",
        severity: "medium",
        country_code: item.iso || "",
        tags: ["acled"],
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "ACLED",
            item.event_id_cnty || "",
            item.event_date || "",
            item.latitude || "",
            item.longitude || ""
        ].join("|")
    };
}
/* ----------------------------------------
 * UCDP
 * -------------------------------------- */
function normalizeUcdpEvent(item, feed) {
    const lat = Number(item.latitude);
    const lon = Number(item.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const country = String(item.country || "");
    const region = String(item.region || "");
    const dyad = String(item.dyad_name || "");
    const conflict = String(item.conflict_name || "");
    const deaths = Number(item.best || 0);
    let severity = "low";
    if (deaths >= 25) severity = "critical";
    else if (deaths >= 10) severity = "high";
    else if (deaths >= 1) severity = "medium";
    let category = "strike";
    const text = `${dyad} ${conflict}`.toLowerCase();
    if (text.includes("air") || text.includes("drone") || text.includes("missile")) category = "strike";
    else if (text.includes("naval") || text.includes("sea")) category = "military";
    else if (text.includes("cyber")) category = "cyber";
    // Extract sides
    const sides = dyad.split(" - ");
    const actorSide = sides[0] || "unknown";
    const targetSide = sides[1] || "unknown";
    return {
        category,
        title: `${conflict || "Armed conflict"} — ${country}`,
        summary: normalizeText(
            `${dyad}. Conflict: ${conflict}. ` +
            `Region: ${region}. ` +
            `${deaths > 0 ? `Estimated casualties: ${deaths}.` : ""}`
        ).slice(0, 1500),
        source_name: "UCDP",
        source_url: "https://ucdp.uu.se/",
        occurred_at: normalizeOccurredAt(item.date_start || item.date_end),
        lat,
        lon,
        location_label: [item.where_prec === 1 ? item.where_description : "", country]
            .filter(Boolean).join(", ") || "Unknown location",
        confidence: 78,
        actor_side: actorSide,
        target_side: targetSide,
        weapon_type: text.includes("air") ? "air strike" :
            text.includes("drone") ? "drone" :
                text.includes("artillery") ? "artillery" :
                    text.includes("missile") ? "missile" : "unknown",
        target_type: "unknown",
        impact_type: deaths > 0 ? "lethal" : "unknown",
        report_type: "conflict",
        severity,
        country_code: item.country_id || "",
        tags: uniqueTags(["ucdp", "conflict", country.toLowerCase()]),
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "UCDP",
            item.id || "",
            item.date_start || "",
            lat,
            lon
        ].join("|")
    };
}
async function processUcdpFeed(feed) {
    try {
        // Token is required since April 2025 — stored in .env.production as UCDP_ACCESS_TOKEN
        // Header name per UCDP docs: x-ucdp-access-token
        const token = process.env.UCDP_ACCESS_TOKEN || "";
        if (!token) {
            console.warn("[UCDP] UCDP_ACCESS_TOKEN not set — requests will likely return 401. Add it to .env.production");
        }
        // Build URL from feed config — sources.json already points to v25.1
        // Add pagesize=100 if not already in URL, and support pagination
        const baseUrl = feed.url.includes("pagesize") ? feed.url : `${feed.url}&pagesize=100`;
        let allItems = [];
        let page = 1;
        const MAX_PAGES = 3; // max 300 events per cycle — stay well inside 5k/day quota
        while (page <= MAX_PAGES) {
            const url = `${baseUrl}&page=${page}`;
            const response = await axios.get(url, {
                timeout: 20000,
                headers: {
                    "x-ucdp-access-token": token,
                    "User-Agent": "warzone-worker/1.0",
                    "Accept": "application/json"
                }
            });
            const items = Array.isArray(response.data?.Result) ? response.data.Result : [];
            if (!items.length) break; // no more pages
            allItems = allItems.concat(items);
            console.log(`[UCDP] Page ${page}: ${items.length} events (total so far: ${allItems.length})`);
            // If fewer than pagesize returned, we've hit the last page
            if (items.length < 100) break;
            page++;
        }
        console.log(`[UCDP] Total fetched: ${allItems.length} events`);
        for (const item of allItems) {
            const event = normalizeUcdpEvent(item, feed);
            if (!event) continue;
            await insertEventIfValid(event);
        }
    } catch (error) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
            console.error("[UCDP] Auth failed — check UCDP_ACCESS_TOKEN in .env.production. Status:", status);
        } else {
            console.error("[UCDP] Feed error:", status || error.message);
        }
    }
}
/* ----------------------------------------
 * RSS Military Feed Parser
 * No new npm dependency — uses axios (already imported) +
 * lightweight regex XML extraction. Parses standard RSS 2.0
 * and Atom feeds. Every item is filtered through HARD_MILITARY_TERMS
 * before being saved — zero civilian noise gets through.
 * -------------------------------------- */
// Extract text content between an XML tag
function rssTag(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}(?:[^>]*)><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (!m) return "";
    return (m[1] || m[2] || "").trim();
}
// Extract all <item> or <entry> blocks from RSS/Atom XML
function rssItems(xml) {
    const tag = /<entry[\s>]/.test(xml) ? "entry" : "item";
    const re = new RegExp(`<${tag}[\\s>]([\\s\\S]*?)<\\/${tag}>`, "gi");
    const items = [];
    let m;
    while ((m = re.exec(xml)) !== null) items.push(m[1]);
    return items;
}
// Check if text passes the military filter
function passesMilitaryFilter(text) {
    const lower = String(text || "").toLowerCase();
    return HARD_MILITARY_TERMS.some(term => lower.includes(term));
}
// Map RSS category/feed name to event category
function rssCategory(feedCategory, text) {
    const t = String(text || "").toLowerCase();
    if (feedCategory) return feedCategory;
    if (t.includes("cyber") || t.includes("hack")) return "cyber";
    if (t.includes("airspace") || t.includes("notam") || t.includes("flight")) return "military";
    if (t.includes("naval") || t.includes("ship") || t.includes("fleet")) return "military";
    return "strike";
}
// Map severity from text signals
function rssSeverity(text) {
    const t = String(text || "").toLowerCase();
    if (/ballistic|hypersonic|nuclear|icbm|carrier strike/.test(t)) return "critical";
    if (/missile strike|airstrike|air strike|killed|casualties|destroyed/.test(t)) return "high";
    if (/drone|uav|artillery|shelling|rocket/.test(t)) return "medium";
    return "low";
}
// Normalize an RSS item into an event object
function normalizeRssItem(item, feed) {
    const title = rssTag(item, "title") || rssTag(item, "summary") || "";
    const summary = rssTag(item, "description") || rssTag(item, "content") || rssTag(item, "content:encoded") || rssTag(item, "summary") || "";
    const link = rssTag(item, "link") || rssTag(item, "id") || "";
    const pubDate = rssTag(item, "pubDate") || rssTag(item, "published") || rssTag(item, "updated") || rssTag(item, "dc:date") || "";
    const fullText = `${title} ${summary}`;
    if (!passesMilitaryFilter(fullText)) return null;
    const cleanTitle = normalizeText(title).slice(0, 240);
    const cleanSummary = normalizeText(summary).slice(0, 1500);
    if (!cleanTitle) return null;
    const category = rssCategory(feed.category, fullText);
    const severity = rssSeverity(fullText);
    // Generate a stable dedupe key from source + title hash
    const dedupeKey = [
        "RSS",
        feed.source_name || feed.name || "rss",
        cleanTitle.slice(0, 80).toLowerCase().replace(/\s+/g, "_")
    ].join("|");
    return {
        category,
        severity,
        title: cleanTitle,
        summary: cleanSummary,
        source_name: feed.source_name || feed.name || "RSS",
        source_url: link || feed.url || "",
        occurred_at: normalizeOccurredAt(pubDate),
        lat: null,
        lon: null,
        location_label: feed.region || "Global",
        confidence: 55,
        weapon_type: "",
        target_type: "unknown",
        impact_type: "unknown",
        report_type: "news",
        country_code: feed.country_code || "",
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        tags: uniqueTags(["rss", ...(feed.tags || [])]),
        dedupe_key: dedupeKey,
    };
}
async function processRssFeed(feed) {
    try {
        const response = await axios.get(feed.url, {
            timeout: 18000,
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; StratOpsWorker/1.0; +https://stratops.battlespacex.com)",
                "Accept": "application/rss+xml, application/xml, application/atom+xml, text/xml, */*",
                "Cache-Control": "no-cache"
            },
            responseType: "text"
        });
        const xml = typeof response.data === "string" ? response.data : String(response.data);
        const items = rssItems(xml);
        console.log(`[RSS] ${feed.name}: ${items.length} items fetched`);
        let saved = 0;
        for (const item of items.slice(0, 30)) {
            const event = normalizeRssItem(item, feed);
            if (!event) continue;
            await insertEventIfValid(event);
            saved++;
        }
        console.log(`[RSS] ${feed.name}: ${saved} military items saved`);
    } catch (err) {
        console.warn(`[RSS] ${feed.name} failed:`, err.response?.status || err.message);
    }
}
async function processNotamFeed(feed) {
    // Uses the FAA NOTAM API — free, no key needed
    // Fetches active NOTAMs relevant to military/conflict zones
    const MILITARY_NOTAM_KEYWORDS = [
        "restricted", "prohibited", "danger area",
        "military", "air defense", "weapons",
        "missile", "rocket", "drone", "uav",
        "temporary flight restriction", "tfr",
        "combat", "warzone", "conflict",
        "interception", "scramble"
    ];
    // Use FAA Digital NOTAM Service — free REST API
    const NOTAM_API_URL = "https://external-api.faa.gov/notamapi/v1/notams";
    try {
        const response = await axios.get(NOTAM_API_URL, {
            timeout: 20000,
            params: {
                pageSize: 50,
                pageNum: 1,
                notamType: "NOTAM",
            },
            headers: {
                "Accept": "application/json",
                "User-Agent": "warzone-worker/1.0",
                "client_id": process.env.FAA_CLIENT_ID || "",
                "client_secret": process.env.FAA_CLIENT_SECRET || "",
            }
        });
        const items = Array.isArray(response.data?.items)
            ? response.data.items
            : [];
        console.log(`[NOTAM] Fetched ${items.length} NOTAMs`);
        for (const item of items) {
            try {
                const text = String(
                    item?.properties?.coreNOTAMData?.notam?.text ||
                    item?.properties?.coreNOTAMData?.notam?.purpose ||
                    ""
                ).toLowerCase();
                // Only process NOTAMs with military-relevant content
                const isMilitaryNotam = MILITARY_NOTAM_KEYWORDS.some(
                    (kw) => text.includes(kw)
                );
                if (!isMilitaryNotam) continue;
                const location = item?.properties?.coreNOTAMData?.notam?.location || "";
                const notamId = item?.properties?.coreNOTAMData?.notam?.id || "";
                const startDate = item?.properties?.coreNOTAMData?.notam?.effectiveStart;
                const endDate = item?.properties?.coreNOTAMData?.notam?.effectiveEnd;
                // Try to get coordinates
                const coords = item?.geometry?.coordinates;
                let lat = null;
                let lon = null;
                if (Array.isArray(coords) && coords.length >= 2) {
                    lon = Number(coords[0]);
                    lat = Number(coords[1]);
                }
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    // Try geocoding the location code
                    const geocoded = await geocodeLocation(location);
                    if (!geocoded) continue;
                    lat = geocoded.lat;
                    lon = geocoded.lon;
                }
                let status = "restricted";
                if (text.includes("prohibited")) status = "closed";
                else if (text.includes("danger")) status = "restricted";
                else if (text.includes("temporary flight restriction") || text.includes("tfr")) status = "restricted";
                const title = `NOTAM ${notamId} — ${location} ${status.toUpperCase()}`;
                const summary = normalizeText(
                    item?.properties?.coreNOTAMData?.notam?.text || "Military NOTAM active"
                ).slice(0, 1500);
                const event = {
                    category: "airspace",
                    title: title.slice(0, 160),
                    summary,
                    source_name: "FAA NOTAM",
                    source_url: "https://notams.aim.faa.gov/",
                    occurred_at: normalizeOccurredAt(startDate),
                    lat,
                    lon,
                    location_label: location || "Unknown",
                    confidence: 85,
                    actor_side: "unknown",
                    target_side: "unknown",
                    weapon_type: "unknown",
                    target_type: "airspace",
                    impact_type: "infrastructure",
                    report_type: "notam",
                    severity: status === "closed" ? "critical" : "high",
                    country_code: "",
                    tags: uniqueTags(["notam", "airspace", status, location]),
                    airspace_status: status,
                    cyber_status: "unknown",
                    fir_code: location,
                    dedupe_key: [
                        "NOTAM",
                        notamId,
                        startDate || "",
                        lat,
                        lon
                    ].join("|")
                };
                await insertEventIfValid(event);
                await upsertAirspaceStatus({
                    region: location || "Unknown",
                    country_code: "",
                    status,
                    title: event.title,
                    summary: event.summary,
                    source_name: "FAA NOTAM",
                    source_url: "https://notams.aim.faa.gov/",
                    fir_code: location,
                    expires_at: normalizeOccurredAt(endDate),
                    lat,
                    lon
                });
            } catch (err) {
                console.error("[NOTAM] Item parse error:", err.message);
            }
        }
    } catch (error) {
        console.warn("[NOTAM] Fetch failed:", error.response?.status || error.message);
    }
}
/* ----------------------------------------
 * EONET
 * -------------------------------------- */
function normalizeEonetEvent(item, feed) {
    const geometry = Array.isArray(item.geometry) ? item.geometry[0] : null;
    const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    return {
        category: feed.category || "fire",
        title: item.title || "NASA EONET event",
        summary: Array.isArray(item.categories) ? item.categories.map((c) => c.title).join(", ") : "NASA EONET event",
        source_name: "NASA EONET",
        source_url: item.sources?.[0]?.url || "https://eonet.gsfc.nasa.gov",
        occurred_at: normalizeOccurredAt(geometry?.date),
        lat,
        lon,
        location_label: item.title || "Unknown location",
        confidence: 70,
        actor_side: "nature",
        target_side: "unknown",
        weapon_type: "unknown",
        target_type: "wildfire",
        impact_type: "environment",
        report_type: "hazard",
        severity: "medium",
        country_code: "",
        tags: ["eonet", "wildfire"],
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "EONET",
            item.id || "",
            geometry?.date || "",
            lat || "",
            lon || ""
        ].join("|")
    };
}
/* ----------------------------------------
 * GDELT
 * -------------------------------------- */
function normalizeGdeltEvent(item, feed) {
    const { lat, lon, label: gdeltLabel } = extractGdeltCoords(item);
    const title = item.title || "GDELT event";
    const summary = item.seendate || "GDELT detected news signal";
    const sourceUrl = item.url || "https://gdeltproject.org";
    const text = `${title} ${summary}`.toLowerCase();
    const hasHardMilitaryTerm = HARD_MILITARY_TERMS.some((term) => text.includes(term));
    const hasFeedKeyword =
        text.includes("military") ||
        text.includes("missile") ||
        text.includes("drone") ||
        text.includes("airspace") ||
        text.includes("naval") ||
        text.includes("fighter") ||
        text.includes("artillery") ||
        text.includes("cyber");

    if (!hasHardMilitaryTerm && !hasFeedKeyword) return null;
    let actorSide = "unknown";
    if (text.includes("military") || text.includes("army") || text.includes("air force") || text.includes("navy")) {
        actorSide = "state_actor";
    }
    if (text.includes("militia") || text.includes("rebel") || text.includes("insurgent") || text.includes("proxy")) {
        actorSide = "non_state_actor";
    }
    let weaponType = "unknown";
    if (text.includes("ballistic missile")) weaponType = "ballistic missile";
    else if (text.includes("cruise missile")) weaponType = "cruise missile";
    else if (text.includes("missile")) weaponType = "missile";
    else if (text.includes("drone")) weaponType = "drone";
    else if (text.includes("airstrike") || text.includes("air strike")) weaponType = "air strike";
    else if (text.includes("fighter jet") || text.includes("fighter")) weaponType = "fighter aircraft";
    else if (text.includes("submarine")) weaponType = "submarine";
    else if (text.includes("frigate")) weaponType = "frigate";
    else if (text.includes("destroyer")) weaponType = "destroyer";
    else if (text.includes("naval")) weaponType = "naval platform";
    else if (text.includes("artillery")) weaponType = "artillery";
    else if (text.includes("cyber")) weaponType = "cyber";
    let targetType = "unknown";
    if (text.includes("airport")) targetType = "airport";
    else if (text.includes("airbase") || text.includes("air base")) targetType = "airbase";
    else if (text.includes("base")) targetType = "military facility";
    else if (text.includes("warship") || text.includes("ship") || text.includes("vessel")) targetType = "naval asset";
    else if (text.includes("port")) targetType = "port";
    else if (text.includes("radar")) targetType = "radar site";
    else if (text.includes("city") || text.includes("urban")) targetType = "urban area";
    else if (text.includes("oil") || text.includes("energy")) targetType = "energy infrastructure";
    else if (text.includes("network") || text.includes("system") || text.includes("server")) targetType = "digital infrastructure";
    let severity = "low";
    if (text.includes("multiple explosions") || text.includes("wave of strikes") || text.includes("barrage")) severity = "critical";
    else if (text.includes("massive") || text.includes("major") || text.includes("heavy")) severity = "high";
    else if (
        text.includes("missile") ||
        text.includes("drone") ||
        text.includes("airstrike") ||
        text.includes("air strike") ||
        text.includes("naval") ||
        text.includes("artillery") ||
        text.includes("cyber")
    ) {
        severity = "medium";
    }
    let category = "military";
    if (
        text.includes("missile") ||
        text.includes("drone") ||
        text.includes("airstrike") ||
        text.includes("air strike") ||
        text.includes("artillery")
    ) {
        category = "strike";
    } else if (text.includes("naval") || text.includes("warship") || text.includes("fleet") || text.includes("frigate") || text.includes("destroyer") || text.includes("submarine")) {
        category = "military";
    } else if (text.includes("fighter jet") || text.includes("sortie") || text.includes("patrol") || text.includes("bomber")) {
        category = "recon";
    } else if (text.includes("cyber") || text.includes("ransomware") || text.includes("vulnerability")) {
        category = "cyber";
    }
    return {
        category,
        title,
        summary,
        source_name: "GDELT",
        source_url: sourceUrl,
        occurred_at: normalizeOccurredAt(item.seendate),
        lat,
        lon,
        location_label: gdeltLabel || "Unknown location",
        confidence: 40,
        actor_side: actorSide,
        target_side: "unknown",
        weapon_type: weaponType,
        target_type: targetType,
        impact_type: targetType === "urban area" ? "civilian" : "military",
        report_type: "signal",
        severity,
        country_code: "",
        tags: ["gdelt"],
        airspace_status: "unknown",
        cyber_status: category === "cyber" ? "elevated" : "unknown",
        fir_code: "",
        dedupe_key: [
            "GDELT",
            sourceUrl,
            lat || "",
            lon || ""
        ].join("|")
    };
}
/* ----------------------------------------
 * Static seed / events-array
 * -------------------------------------- */
function buildSeedEvent(item, feed) {
    return {
        category: item.category || feed.category || "strike",
        title: item.title || "Untitled event",
        summary: item.summary || "",
        source_name: item.source_name || feed.name || "Unknown source",
        source_url: item.source_url || feed.url,
        occurred_at: normalizeOccurredAt(item.occurred_at),
        lat: Number(item.lat),
        lon: Number(item.lon),
        location_label: item.location_label || "Unknown location",
        confidence: Number(item.confidence ?? 50),
        actor_side: item.actor_side || "unknown",
        target_side: item.target_side || "unknown",
        weapon_type: item.weapon_type || "unknown",
        target_type: item.target_type || "unknown",
        impact_type: item.impact_type || "unknown",
        report_type: item.report_type || "strike",
        severity: item.severity || "medium",
        country_code: item.country_code || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        airspace_status: item.airspace_status || "unknown",
        cyber_status: item.cyber_status || "unknown",
        fir_code: item.fir_code || "",
        dedupe_key: makeDedupeKey(item, feed)
    };
}
/* ----------------------------------------
 * Telegram helpers
 * -------------------------------------- */
async function ensureTelegramClient() {
    if (telegramReady && telegramClient) return telegramClient;
    if (!TELEGRAM_API_ID || !TELEGRAM_API_HASH || !TELEGRAM_SESSION) {
        throw new Error("Telegram env vars missing: TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION");
    }
    telegramClient = new TelegramClient(
        new StringSession(TELEGRAM_SESSION),
        TELEGRAM_API_ID,
        TELEGRAM_API_HASH,
        { connectionRetries: 5 }
    );
    try {
        await telegramClient.connect();
    } catch (err) {
        console.error("Telegram connection failed, retrying...", err.message);
        try {
            await telegramClient.disconnect();
        } catch { }
        await new Promise((r) => setTimeout(r, 3000));
        await telegramClient.connect();
    }
    const authorized = await telegramClient.isUserAuthorized();
    if (!authorized) {
        throw new Error("Telegram client is not authorized. Recreate TELEGRAM_SESSION.");
    }
    telegramReady = true;
    console.log("Telegram connected");
    return telegramClient;
}
function isRelevantTelegramText(text, feed) {
    const lower = normalizeText(text).toLowerCase();
    if (!lower) return false;
    const customKeywords = toArray(feed?.keywords).map((x) => String(x).toLowerCase());
    const allKeywords = [...new Set([...TELEGRAM_RELEVANT_KEYWORDS, ...customKeywords])];
    const hasRelevantKeyword = allKeywords.some((keyword) => lower.includes(keyword));
    if (!hasRelevantKeyword) return false;
    const strongTacticalSignals = [
        "missile",
        "ballistic missile",
        "cruise missile",
        "rocket",
        "drone",
        "uav",
        "shahed",
        "airstrike",
        "air strike",
        "bombardment",
        "shelling",
        "artillery",
        "sirens",
        "siren",
        "air raid",
        "red alert",
        "intercepted",
        "interception",
        "air defense",
        "warship",
        "frigate",
        "destroyer",
        "submarine",
        "fighter jet",
        "f-18",
        "f-35",
        "b-1",
        "b-2",
        "b-52",
        "notam",
        "airspace"
    ];
    const isTactical = strongTacticalSignals.some((keyword) => lower.includes(keyword));
    if (!isTactical) return false;
    const noisePatterns = [
        "opinion",
        "analysis",
        "thread",
        "podcast",
        "interview",
        "editorial",
        "market",
        "geopolitics weekly",
        "subscribe",
        "follow us",
        "breaking news:",
        "live now"
    ];
    if (noisePatterns.some((pattern) => lower.includes(pattern))) {
        return false;
    }
    return true;
}
function getTelegramChannels(feed) {
    const feedChannels = toArray(feed.channels)
        .map(toTelegramChannelKey)
        .filter(Boolean);
    const channels = feedChannels.length ? feedChannels : TELEGRAM_DEFAULT_CHANNELS;
    return [...new Set(channels)];
}
function extractTelegramText(msg) {
    return String(msg?.message || msg?.rawText || msg?.text || "").trim();
}
function detectTelegramCategory(text) {
    const t = text.toLowerCase();
    if (/(missile|ballistic|cruise missile|rocket barrage|rocket launch)/i.test(t)) return "strike";
    if (/(drone|uav|shahed|loitering munition)/i.test(t)) return "strike";
    if (/(air raid|sirens|red alert|warning)/i.test(t)) return "alert";
    if (/(airstrike|air strike|bombardment|raid)/i.test(t)) return "strike";
    if (/(naval|warship|frigate|destroyer|submarine|carrier|fleet)/i.test(t)) return "military";
    if (/(fighter jet|sortie|patrol|recon)/i.test(t)) return "recon";
    if (/(notam|airspace)/i.test(t)) return "airspace";
    if (/(cyber|ransomware|vulnerability|malware)/i.test(t)) return "cyber";
    return "military";
}
function detectTelegramSeverity(text) {
    const t = text.toLowerCase();
    if (/(massive|huge|major|heavy|multiple impacts|barrage|wave of strikes|confirmed hit|critical)/i.test(t)) return "critical";
    if (/(missile|drone|airstrike|air strike|explosion|naval|shelling|artillery)/i.test(t)) return "high";
    if (/(siren|warning|alert|interception|intercepted|notam|airspace|cyber)/i.test(t)) return "medium";
    return "low";
}
function detectTelegramWeaponType(text) {
    const t = text.toLowerCase();
    if (t.includes("ballistic missile")) return "ballistic missile";
    if (t.includes("cruise missile")) return "cruise missile";
    if (t.includes("missile")) return "missile";
    if (t.includes("drone") || t.includes("uav") || t.includes("shahed")) return "drone";
    if (t.includes("airstrike") || t.includes("air strike")) return "air strike";
    if (t.includes("fighter jet") || t.includes("fighter")) return "fighter aircraft";
    if (t.includes("submarine")) return "submarine";
    if (t.includes("frigate")) return "frigate";
    if (t.includes("destroyer")) return "destroyer";
    if (t.includes("artillery")) return "artillery";
    if (t.includes("rocket")) return "rocket";
    if (t.includes("cyber")) return "cyber";
    return "unknown";
}
function detectTelegramTargetType(text) {
    const t = text.toLowerCase();
    if (t.includes("airport")) return "airport";
    if (t.includes("airbase") || t.includes("air base")) return "airbase";
    if (t.includes("base")) return "military facility";
    if (t.includes("warship") || t.includes("ship") || t.includes("vessel")) return "naval asset";
    if (t.includes("port")) return "port";
    if (t.includes("radar")) return "radar site";
    if (t.includes("city") || t.includes("urban") || t.includes("residential")) return "urban area";
    if (t.includes("oil") || t.includes("energy") || t.includes("refinery")) return "energy infrastructure";
    if (t.includes("civilian")) return "civilian area";
    if (t.includes("network") || t.includes("server") || t.includes("system")) return "digital infrastructure";
    return "unknown";
}
function detectTelegramImpactType(targetType) {
    if (targetType === "urban area" || targetType === "civilian area") return "civilian";
    if (
        targetType === "airport" ||
        targetType === "airbase" ||
        targetType === "military facility" ||
        targetType === "naval asset" ||
        targetType === "radar site"
    ) {
        return "military";
    }
    if (targetType === "energy infrastructure" || targetType === "port") return "infrastructure";
    if (targetType === "digital infrastructure") return "digital";
    return "unknown";
}
function detectTelegramActorSide(text) {
    const t = text.toLowerCase();
    if (/(army|military|air force|navy|state media|ministry of defense|defence ministry)/i.test(t)) {
        return "state_actor";
    }
    if (/(militia|proxy|insurgent|rebels|houthis|hezbollah|hamas)/i.test(t)) {
        return "non_state_actor";
    }
    return "unknown";
}
function detectTelegramConfidence(text) {
    const t = text.toLowerCase();
    if (/(confirmed|visual confirmation|footage|video|geolocated)/i.test(t)) return 82;
    if (/(reportedly|reports|unconfirmed|claims)/i.test(t)) return 58;
    return 68;
}
function extractTelegramTags(text, channelKey, extraTags = []) {
    const lower = text.toLowerCase();
    const tags = [...extraTags];
    const keywordTags = [
        "missile",
        "ballistic",
        "cruise-missile",
        "rocket",
        "drone",
        "uav",
        "shahed",
        "airstrike",
        "siren",
        "air-raid",
        "interception",
        "air-defense",
        "naval",
        "frigate",
        "destroyer",
        "submarine",
        "carrier",
        "fleet",
        "fighter-jet",
        "artillery",
        "shelling",
        "explosion",
        "airspace",
        "notam",
        "cyber"
    ];
    for (const tag of keywordTags) {
        const testValue = tag.replace(/-/g, " ");
        if (lower.includes(testValue)) {
            tags.push(tag);
        }
    }
    if (channelKey) {
        tags.push(`telegram-${sanitizeTag(channelKey)}`);
    }
    return uniqueTags(tags);
}
async function normalizeTelegramEvent(msg, feed, channelKey) {
    const rawText = extractTelegramText(msg);
    if (!rawText) return null;
    if (!isRelevantTelegramText(rawText, feed)) return null;
    const location = await resolveLocationFromText(rawText, { requireBBox: false });
    if (!location) return null;
    const normalizedText = normalizeText(rawText);
    const category = detectTelegramCategory(rawText);
    const severity = detectTelegramSeverity(rawText);
    const weaponType = detectTelegramWeaponType(rawText);
    const targetType = detectTelegramTargetType(rawText);
    const impactType = detectTelegramImpactType(targetType);
    const actorSide = detectTelegramActorSide(rawText);
    const confidence = detectTelegramConfidence(rawText);
    const firstLine = rawText.split("\n").map((line) => line.trim()).find(Boolean) || normalizedText;
    const title = firstLine.slice(0, 160) || "Telegram OSINT event";
    const summary = normalizedText.slice(0, 1500);
    return {
        category,
        title,
        summary,
        source_name: cleanSourceName(`Telegram / ${channelKey}`),
        source_url: buildTelegramMessageUrl(channelKey, msg.id),
        occurred_at: msg.date?.toISOString?.() || new Date().toISOString(),
        lat: Number(location.lat),
        lon: Number(location.lon),
        location_label: location.label || "Unknown location",
        confidence,
        actor_side: actorSide,
        target_side: "unknown",
        weapon_type: weaponType,
        target_type: targetType,
        impact_type: impactType,
        report_type: "osint",
        severity,
        country_code: "",
        tags: extractTelegramTags(rawText, channelKey, toArray(feed.tags)),
        airspace_status: category === "airspace" ? "restricted" : "unknown",
        cyber_status: category === "cyber" ? "elevated" : "unknown",
        fir_code: "",
        dedupe_key: [
            "TELEGRAM",
            channelKey,
            msg.id || "",
            msg.date?.toISOString?.() || ""
        ].join("|")
    };
}
async function processTelegramFeed(feed) {
    const client = await ensureTelegramClient();
    const channels = getTelegramChannels(feed);
    const limit = Number(feed.limit || 25);
    if (!channels.length) {
        console.log("Telegram parser skipped, no channels configured");
        return;
    }
    for (const rawChannel of channels) {
        const channelKey = toTelegramChannelKey(rawChannel);
        const stateKey = makeTelegramStateKey(channelKey);
        console.log("Fetching Telegram channel:", channelKey);
        let entity;
        try {
            entity = await client.getEntity(
                rawChannel.startsWith("@") ? rawChannel : channelKey
            );
        } catch (error) {
            console.error("Telegram entity resolve failed:", channelKey, error.message);
            continue;
        }
        const state = await getWorkerState(stateKey);
        const lastSeenId = Number(state?.last_message_id || 0);
        let newestSeenId = lastSeenId;
        try {
            for await (const msg of client.iterMessages(entity, { limit })) {
                if (!msg?.id) continue;
                if (msg.id <= lastSeenId) break;
                if (msg.id > newestSeenId) {
                    newestSeenId = msg.id;
                }
                try {
                    const event = await normalizeTelegramEvent(msg, feed, channelKey);
                    if (!event) continue;
                    // ── IsraelWarRoom + tzevaadom: route through siren poller ──
                    const isWarRoom = /IsraelWarRoom/i.test(channelKey);
                    const isTzeva = /tzevaadom/i.test(channelKey);
                    if (isWarRoom || isTzeva) {
                        const rawText = msg.message || msg.text || "";
                        await handleIsraelWarRoomMessage(rawText).catch(e =>
                            console.error("[siren-tg] handler error:", e.message)
                        );
                    }
                    const inserted = await insertEventIfValid(event);
                    if (inserted && event.category === "alert") {
                        await upsertActiveAlert({
                            alert_key: `siren:${sanitizeTag(event.location_label || "unknown")}`,
                            category: "alert",
                            region: event.location_label || "Unknown region",
                            title: event.title,
                            summary: event.summary,
                            source_name: event.source_name,
                            source_url: event.source_url,
                            started_at: event.occurred_at,
                            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
                        });
                    }
                    if (inserted && event.category === "airspace") {
                        await upsertAirspaceStatus({
                            region: event.location_label || "Unknown region",
                            country_code: event.country_code || "",
                            status: "restricted",
                            title: event.title,
                            summary: event.summary,
                            source_name: event.source_name,
                            source_url: event.source_url,
                            lat: event.lat,
                            lon: event.lon
                        });
                    }
                } catch (error) {
                    console.error("Telegram message parse error:", channelKey, msg.id, error.message);
                }
            }
            if (newestSeenId > lastSeenId) {
                await setWorkerState(stateKey, newestSeenId);
            }
        } catch (error) {
            console.error("Telegram channel read failed:", channelKey, error.message);
        }
    }
}
/* ----------------------------------------
 * Reddit
 * -------------------------------------- */
function isRelevantRedditPost(post) {
    const text = `${post?.title || ""} ${post?.selftext || ""}`.toLowerCase();
    const strongSignals = [
        "missile",
        "ballistic missile",
        "cruise missile",
        "drone",
        "uav",
        "shahed",
        "airstrike",
        "air strike",
        "rocket",
        "artillery",
        "shelling",
        "fighter jet",
        "warship",
        "frigate",
        "destroyer",
        "tank",
        "apc",
        "ifv",
        "helicopter",
        "sortie",
        "interception",
        "combat footage",
        "strike",
        "launch"
    ];
    const rejectSignals = [
        "opinion",
        "analysis only",
        "discussion",
        "megathread",
        "politics",
        "sanctions",
        "ceasefire talks",
        "diplomacy",
        "editorial",
        "podcast",
        "interview"
    ];
    const hasStrongSignal = strongSignals.some((term) => text.includes(term));
    const hasRejectSignal = rejectSignals.some((term) => text.includes(term));
    return hasStrongSignal && !hasRejectSignal;
}
async function normalizeRedditPost(post, feed) {
    if (!post || !isRelevantRedditPost(post)) return null;
    const text = `${post.title || ""} ${post.selftext || ""}`;
    const location = await resolveRedditLocation(post);
    if (!location) return null;
    const lower = text.toLowerCase();
    let weaponType = "unknown";
    if (lower.includes("ballistic missile")) weaponType = "ballistic missile";
    else if (lower.includes("cruise missile")) weaponType = "cruise missile";
    else if (lower.includes("hypersonic missile")) weaponType = "hypersonic missile";
    else if (lower.includes("glide bomb")) weaponType = "glide bomb";
    else if (lower.includes("kamikaze") || lower.includes("loitering munition")) weaponType = "kamikaze drone";
    else if (lower.includes("fpv drone") || lower.includes("fpv")) weaponType = "fpv drone";
    else if (lower.includes("ucav")) weaponType = "ucav";
    else if (lower.includes("uav") || lower.includes("drone")) weaponType = "drone";
    else if (lower.includes("rocket")) weaponType = "rocket";
    else if (lower.includes("artillery") || lower.includes("howitzer")) weaponType = "artillery";
    else if (lower.includes("airstrike") || lower.includes("air strike") || lower.includes("air raid")) weaponType = "air strike";
    else if (lower.includes("missile")) weaponType = "missile";
    let severity = "medium";
    if (/(massive|huge|major|heavy|multiple|barrage|wave)/i.test(text)) severity = "high";
    if (/(critical|catastrophic)/i.test(text)) severity = "critical";
    return {
        category: feed.category || "strike",
        title: normalizeText(post.title || "Reddit report").slice(0, 160),
        summary: normalizeText(post.selftext || post.title || "Reddit conflict report").slice(0, 1500),
        source_name: cleanSourceName(feed.name),
        source_url: post.permalink ? `https://www.reddit.com${post.permalink}` : feed.url,
        occurred_at: post.created_utc
            ? new Date(post.created_utc * 1000).toISOString()
            : new Date().toISOString(),
        lat: Number(location.lat),
        lon: Number(location.lon),
        location_label: location.label || post.subreddit_name_prefixed || "Reddit",
        confidence: 35,
        actor_side: "unknown",
        target_side: "unknown",
        weapon_type: weaponType,
        target_type: "unknown",
        impact_type: "unknown",
        report_type: "reddit",
        severity,
        country_code: "",
        tags: uniqueTags([
            "reddit",
            post.subreddit || "unknown",
            weaponType
        ]),
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "REDDIT",
            post.id || "",
            post.created_utc || "",
            location.lat || "",
            location.lon || ""
        ].join("|")
    };
}
async function processRedditFeed(feed) {
    const response = await axios.get(feed.url, {
        headers: {
            "User-Agent": process.env.REDDIT_USER_AGENT || "web:warzone-osint-bot:1.0 (by /u/warzonebot)"
        },
        timeout: 15000
    });
    const posts = response.data?.data?.children
        ?.map((item) => item?.data)
        .filter(Boolean) || [];
    for (const post of posts) {
        try {
            const event = await normalizeRedditPost(post, feed);
            if (!event) continue;
            await insertEventIfValid(event);
        } catch (error) {
            console.error("Reddit parse error:", feed.name, post?.id, error.message);
        }
    }
}
/* ----------------------------------------
 * USGS
 * -------------------------------------- */
function normalizeUsgsEvent(feature, feed) {
    const coords = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const mag = Number(feature?.properties?.mag);
    const place = feature?.properties?.place || "Unknown location";
    const time = feature?.properties?.time ? new Date(feature.properties.time).toISOString() : new Date().toISOString();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!isWithinBBox(lat, lon)) return null;
    if (Number.isFinite(mag) && mag < 1.5) return null;
    return {
        category: feed.category || "signal",
        title: `Seismic anomaly ${Number.isFinite(mag) ? `M${mag.toFixed(1)}` : ""} near ${place}`.trim(),
        summary: `USGS seismic event detected near ${place}${Number.isFinite(mag) ? ` with magnitude ${mag.toFixed(1)}` : ""}.`,
        source_name: "USGS",
        source_url: feature?.properties?.url || feed.url,
        occurred_at: time,
        lat,
        lon,
        location_label: place,
        confidence: Number.isFinite(mag) ? Math.min(75, Math.max(30, Math.round(mag * 12))) : 35,
        actor_side: "unknown",
        target_side: "unknown",
        weapon_type: "unknown",
        target_type: "ground anomaly",
        impact_type: "unknown",
        report_type: "seismic",
        severity: Number.isFinite(mag) && mag >= 4.5 ? "high" : "medium",
        country_code: "",
        tags: uniqueTags(["usgs", "seismic", "earthquake"]),
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "USGS",
            feature?.id || "",
            time,
            lat,
            lon
        ].join("|")
    };
}
async function processUsgsFeed(feed) {
    const response = await axios.get(feed.url, {
        timeout: 15000,
        headers: {
            "User-Agent": "warzone-worker/1.0",
            Accept: "application/json"
        }
    });
    const items = Array.isArray(response.data?.features) ? response.data.features : [];
    for (const item of items) {
        const event = normalizeUsgsEvent(item, feed);
        if (!event) continue;
        await insertEventIfValid(event);
    }
}
/* ----------------------------------------
 * NASA FIRMS
 * -------------------------------------- */
function normalizeFirmsRow(row, feed) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!isWithinBBox(lat, lon)) return null;
    const confidenceRaw = row.confidence || row.conf || "";
    const confidenceText = String(confidenceRaw).toLowerCase();
    let confidence = 45;
    if (confidenceText === "n" || confidenceText === "nominal") confidence = 52;
    else if (confidenceText === "h" || confidenceText === "high") confidence = 70;
    else if (confidenceText === "l" || confidenceText === "low") confidence = 35;
    else if (Number.isFinite(Number(confidenceRaw))) confidence = Number(confidenceRaw);
    const bright = Number(row.bright_ti4 || row.brightness || row.bright_t31 || 0);
    let severity = "medium";
    if (bright >= 340) severity = "high";
    if (bright >= 360) severity = "critical";
    const occurredAt = combineDateAndTime(row.acq_date, row.acq_time);
    return {
        category: feed.category || "thermal",
        title: `Thermal anomaly detected near ${lat.toFixed(3)}, ${lon.toFixed(3)}`,
        summary: `NASA FIRMS detected a thermal anomaly at ${lat.toFixed(3)}, ${lon.toFixed(3)}. Confidence: ${confidenceRaw || "unknown"}.`,
        source_name: "NASA FIRMS",
        source_url: "https://firms.modaps.eosdis.nasa.gov/",
        occurred_at: occurredAt,
        lat,
        lon,
        location_label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
        confidence: Math.min(95, Math.max(20, Number(confidence) || 45)),
        actor_side: "unknown",
        target_side: "unknown",
        weapon_type: "unknown",
        target_type: "heat source",
        impact_type: "unknown",
        report_type: "thermal_anomaly",
        severity,
        country_code: row.country_id || "",
        tags: uniqueTags(["firms", "thermal", "heat", "viirs"]),
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "FIRMS",
            occurredAt,
            lat,
            lon,
            row.satellite || "",
            row.instrument || ""
        ].join("|")
    };
}
async function processFirmsFeed(feed) {
    if (!process.env.NASA_FIRMS_MAP_KEY) {
        console.log("FIRMS skipped: NASA_FIRMS_MAP_KEY missing");
        return;
    }
    const response = await axios.get(feed.url, {
        timeout: 20000,
        headers: {
            "User-Agent": "warzone-worker/1.0",
            Accept: "text/csv"
        }
    });
    const rows = parseCsv(response.data);
    for (const row of rows) {
        const event = normalizeFirmsRow(row, feed);
        if (!event) continue;
        await insertEventIfValid(event);
    }
}
/* ----------------------------------------
 * Manual alerts
 * -------------------------------------- */
async function processManualAlertsFeed(feed) {
    if (!feed.url) {
        console.log("Manual alerts skipped: url missing");
        return;
    }
    const response = await axios.get(feed.url, {
        timeout: 15000,
        headers: {
            "Cache-Control": "no-cache",
            "User-Agent": "warzone-worker/1.0"
        }
    });
    const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    const alerts = Array.isArray(payload?.alerts) ? payload.alerts : [];
    for (const item of alerts) {
        if (String(item.status || "").toLowerCase() !== "active") continue;
        const region = item.region || item.location_label || "Unknown region";
        const alertKey = item.alert_key || `manual-alert:${sanitizeTag(region)}`;
        await upsertActiveAlert({
            alert_key: alertKey,
            category: item.category || "alert",
            region,
            title: item.title || `SIRENS REPORTED IN ${String(region).toUpperCase()}`,
            summary: item.summary || "",
            status: "active",
            source_name: item.source_name || feed.name,
            source_url: item.source_url || feed.url,
            started_at: item.started_at || new Date().toISOString(),
            expires_at: item.expires_at || new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const event = {
                category: "alert",
                title: item.title || `SIRENS REPORTED IN ${String(region).toUpperCase()}`,
                summary: item.summary || "Manual siren alert",
                source_name: item.source_name || feed.name,
                source_url: item.source_url || feed.url,
                occurred_at: normalizeOccurredAt(item.started_at),
                lat,
                lon,
                location_label: item.location_label || region,
                confidence: Number(item.confidence ?? 90),
                actor_side: "unknown",
                target_side: "unknown",
                weapon_type: "unknown",
                target_type: "urban area",
                impact_type: "civilian",
                report_type: "siren_alert",
                severity: item.severity || "high",
                country_code: item.country_code || "",
                tags: uniqueTags(["siren", "alert", region]),
                airspace_status: "unknown",
                cyber_status: "unknown",
                fir_code: item.fir_code || "",
                dedupe_key: [
                    "MANUAL_ALERT",
                    alertKey,
                    item.started_at || "",
                    lat,
                    lon
                ].join("|")
            };
            await insertEventIfValid(event);
        }
    }
}
/* ----------------------------------------
 * Manual airspace
 * -------------------------------------- */
async function processManualAirspaceFeed(feed) {
    if (!feed.url) {
        console.log("Manual airspace skipped: url missing");
        return;
    }
    const response = await axios.get(feed.url, {
        timeout: 15000,
        headers: {
            "Cache-Control": "no-cache",
            "User-Agent": "warzone-worker/1.0"
        }
    });
    const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
    const statuses = Array.isArray(payload?.statuses) ? payload.statuses : [];
    for (const item of statuses) {
        const lat = Number(item.lat);
        const lon = Number(item.lon);
        await upsertAirspaceStatus({
            region: item.region || "Unknown",
            country_code: item.country_code || "",
            status: item.status || "normal",
            title: item.title || "Airspace status",
            summary: item.summary || "",
            source_name: item.source_name || feed.name,
            source_url: item.source_url || feed.url,
            fir_code: item.fir_code || "",
            expires_at: item.expires_at || null,
            lat: Number.isFinite(lat) ? lat : null,
            lon: Number.isFinite(lon) ? lon : null
        });
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const event = {
            category: "airspace",
            title: item.title || `${item.region || "Region"} airspace ${item.status || "status"}`,
            summary: item.summary || "Manual airspace status update",
            source_name: item.source_name || feed.name,
            source_url: item.source_url || feed.url,
            occurred_at: new Date().toISOString(),
            lat,
            lon,
            location_label: item.region || "Unknown",
            confidence: Number(item.confidence ?? 85),
            actor_side: "unknown",
            target_side: "unknown",
            weapon_type: "unknown",
            target_type: "airspace",
            impact_type: "infrastructure",
            report_type: "airspace_status",
            severity: item.status === "closed" ? "critical" : item.status === "restricted" ? "high" : "low",
            country_code: item.country_code || "",
            tags: uniqueTags(["airspace", item.status || "normal", item.region || "unknown"]),
            airspace_status: item.status || "normal",
            cyber_status: "unknown",
            fir_code: item.fir_code || "",
            dedupe_key: [
                "MANUAL_AIRSPACE",
                item.region || "",
                item.status || "",
                item.expires_at || ""
            ].join("|")
        };
        await insertEventIfValid(event);
    }
}
/* ----------------------------------------
 * Airspace API
 * -------------------------------------- */
async function processAviationEdgeFeed(feed) {
    if (!process.env.AVIATION_EDGE_API_KEY) {
        console.log("AviationEdge skipped: AVIATION_EDGE_API_KEY missing");
        return;
    }
    for (const country of TRACKED_AIRSPACE_COUNTRIES) {
        try {
            const url = buildSourceUrl(feed.url, {
                key: process.env.AVIATION_EDGE_API_KEY,
                country
            });
            const response = await axios.get(url, {
                timeout: 20000,
                headers: {
                    "User-Agent": "warzone-worker/1.0",
                    Accept: "application/json"
                }
            });
            const rows = Array.isArray(response.data) ? response.data : [];
            for (const row of rows) {
                const title = row?.title || row?.notam || `${country} NOTAM`;
                const summary = row?.message || row?.text || row?.notam || "NOTAM update";
                const text = `${title} ${summary}`.toLowerCase();
                let status = "normal";
                if (/(closed|closure|suspended)/i.test(text)) status = "closed";
                else if (/(restricted|restriction|danger|warning|military activity)/i.test(text)) status = "restricted";
                const lat = safeNumber(row?.latitude);
                const lon = safeNumber(row?.longitude);
                await upsertAirspaceStatus({
                    region: country,
                    country_code: row?.countryCode || "",
                    status,
                    title,
                    summary,
                    source_name: feed.name,
                    source_url: row?.link || feed.url,
                    fir_code: row?.fir || "",
                    expires_at: normalizeOccurredAt(row?.endDate || row?.validTo),
                    lat,
                    lon
                });
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                    const event = {
                        category: "airspace",
                        title,
                        summary,
                        source_name: feed.name,
                        source_url: row?.link || feed.url,
                        occurred_at: normalizeOccurredAt(row?.startDate || row?.issued || new Date().toISOString()),
                        lat,
                        lon,
                        location_label: country,
                        confidence: 78,
                        actor_side: "unknown",
                        target_side: "unknown",
                        weapon_type: "unknown",
                        target_type: "airspace",
                        impact_type: "infrastructure",
                        report_type: "notam",
                        severity: status === "closed" ? "critical" : status === "restricted" ? "high" : "low",
                        country_code: row?.countryCode || "",
                        tags: uniqueTags(["airspace", "notam", status, country]),
                        airspace_status: status,
                        cyber_status: "unknown",
                        fir_code: row?.fir || "",
                        dedupe_key: [
                            "AVIATIONEDGE",
                            country,
                            title,
                            row?.issued || "",
                            row?.fir || ""
                        ].join("|")
                    };
                    await insertEventIfValid(event);
                }
            }
        } catch (error) {
            console.error("AviationEdge country fetch failed:", country, error.response?.status || error.message);
        }
    }
}
/* ----------------------------------------
 * Cyber feed
 * -------------------------------------- */
function normalizeCyberKevItem(item, feed) {
    const vendor = normalizeText(item?.vendorProject || "");
    const product = normalizeText(item?.product || "");
    const cve = normalizeText(item?.cveID || "");
    const titleBits = [cve, vendor, product].filter(Boolean);
    const title = titleBits.length ? `CISA KEV ${titleBits.join(" - ")}` : "CISA KEV alert";
    const summary = normalizeText(
        item?.shortDescription ||
        item?.vulnerabilityName ||
        "Known exploited vulnerability listed by CISA."
    );
    const dateAdded = normalizeOccurredAt(item?.dateAdded || item?.dueDate || new Date().toISOString());
    const notesText = `${summary} ${item?.knownRansomwareCampaignUse || ""}`.toLowerCase();
    let severity = "medium";
    if (notesText.includes("ransomware")) severity = "high";
    return {
        category: feed.category || "cyber",
        title: title.slice(0, 160),
        summary: summary.slice(0, 1500),
        source_name: "CISA KEV",
        source_url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        occurred_at: dateAdded,
        lat: 38.8977,
        lon: -77.0365,
        location_label: "Washington, DC, United States",
        confidence: 88,
        actor_side: "unknown",
        target_side: "unknown",
        weapon_type: "cyber",
        target_type: "digital infrastructure",
        impact_type: "digital",
        report_type: "cyber",
        severity,
        country_code: "US",
        tags: uniqueTags([
            "cyber",
            "kev",
            cve,
            vendor,
            product,
            item?.knownRansomwareCampaignUse ? "ransomware" : ""
        ]),
        airspace_status: "unknown",
        cyber_status: "elevated",
        fir_code: "",
        dedupe_key: [
            "CISA_KEV",
            cve,
            item?.dateAdded || "",
            vendor,
            product
        ].join("|")
    };
}
async function processCyberFeed(feed) {
    const response = await axios.get(feed.url, {
        timeout: 20000,
        headers: {
            "User-Agent": "warzone-worker/1.0",
            Accept: "application/json"
        }
    });
    const vulns =
        toArray(response.data?.vulnerabilities).length
            ? response.data.vulnerabilities
            : toArray(response.data);
    for (const item of vulns.slice(0, 100)) {
        const event = normalizeCyberKevItem(item, feed);
        await insertEventIfValid(event);
    }
}
/* ----------------------------------------
 * ADS-B / military flights
 * -------------------------------------- */
function looksMilitaryFlight(row) {
    const flightCode = String(
        row?.callsign ||
        row?.flight?.icaoNumber ||
        row?.flight?.iataNumber ||
        row?.flight?.number ||
        ""
    ).toUpperCase().trim();
    const aircraftCode = String(
        row?.aircraft?.icaoCode ||
        row?.aircraft?.model ||
        row?.aircraft_type ||
        row?.type ||
        ""
    ).toUpperCase().trim();
    const operatorName = String(
        row?.airline?.name ||
        row?.operator ||
        row?.owner ||
        row?.origin_country ||
        ""
    ).toUpperCase().trim();
    if (looksLikeMilitaryAircraftCode(aircraftCode)) return true;
    if (MILITARY_CALLSIGN_HINTS.some((hint) => flightCode.includes(hint))) return true;
    if (HARD_MILITARY_OPERATORS.some((name) => operatorName.includes(name))) return true;
    if (/^(RCH|RRR|QID|FORTE|ASCOT|DUKE|SHELL|TEXACO|REACH|SVF|MC|HKY|BLUE|GOLD|NACHO|DRAGO|OMAHA|ROGUE|HOMER|LAGR)/.test(flightCode)) {
        return true;
    }
    return false;
}
function normalizeMilitaryFlight(row, feed) {
    const lat = safeNumber(row?.geography?.latitude);
    const lon = safeNumber(row?.geography?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!isWithinBBox(lat, lon, REGION_BBOX)) return null;
    if (!looksMilitaryFlight(row)) return null;
    const airlineName = row?.airline?.name || row?.operator || "";
    const flightCode =
        row?.flight?.icaoNumber ||
        row?.flight?.iataNumber ||
        row?.flight?.number ||
        row?.callsign ||
        row?.aircraft?.icao24 ||
        "Unknown";
    const aircraftCode = row?.aircraft?.icaoCode || row?.aircraft?.model || row?.aircraft?.icao24 || "unknown";
    const aircraftRole = deriveAircraftRole(row);
    const status = row?.status || "active";
    const altitude = row?.geography?.altitude;
    const heading = row?.geography?.direction;
    const speed = row?.geography?.speed;
    const dep = row?.departure?.icaoCode || row?.departure?.iataCode || "";
    const arr = row?.arrival?.icaoCode || row?.arrival?.iataCode || "";
    if (!["fighter", "bomber", "awacs", "tanker", "transport", "isr", "helicopter", "maritime_patrol", "military_aircraft"].includes(aircraftRole)) {
        return null;
    }
    return {
        category: "military",
        title: `${aircraftRole.replace(/_/g, " ")} activity: ${flightCode || aircraftCode || "Unknown"}`,
        summary: normalizeText(
            `${airlineName} ${flightCode} ${aircraftCode}. Role: ${aircraftRole}. Status: ${status}. ` +
            `${dep ? `Departure: ${dep}. ` : ""}` +
            `${arr ? `Arrival: ${arr}. ` : ""}` +
            `${altitude ? `Altitude: ${altitude}. ` : ""}` +
            `${speed ? `Speed: ${speed}. ` : ""}` +
            `${heading ? `Heading: ${heading}.` : ""}`
        ).slice(0, 1500),
        source_name: feed.name,
        source_url: "https://aviation-edge.com/",
        occurred_at: normalizeOccurredAt(row?.system?.updated || new Date().toISOString()),
        lat,
        lon,
        location_label: `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
        confidence: 72,
        actor_side: "state_actor",
        target_side: "unknown",
        weapon_type: aircraftRole,
        target_type: "airspace",
        impact_type: "military",
        report_type: "flight_tracking",
        severity: ["fighter", "bomber", "awacs", "tanker"].includes(aircraftRole) ? "high" : "medium",
        country_code: "",
        tags: uniqueTags([
            "adsb",
            "military-flight",
            aircraftRole,
            aircraftCode,
            flightCode
        ]),
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "",
        dedupe_key: [
            "MIL_FLIGHT",
            aircraftRole,
            flightCode,
            row?.system?.updated || "",
            lat,
            lon
        ].join("|")
    };
}
async function processMilitaryFlightsFeed(feed) {
    if (!process.env.AVIATION_EDGE_API_KEY) {
        console.log("Military flights skipped: AVIATION_EDGE_API_KEY missing");
        return;
    }
    try {
        const response = await axios.get(feed.url, {
            params: {
                key: process.env.AVIATION_EDGE_API_KEY
            },
            timeout: 20000,
            headers: {
                "User-Agent": "warzone-worker/1.0",
                Accept: "application/json"
            }
        });
        const rows = Array.isArray(response.data) ? response.data : [];
        for (const row of rows) {
            const event = normalizeMilitaryFlight(row, feed);
            if (!event) continue;
            await insertEventIfValid(event);
        }
    } catch (error) {
        console.error("Military flights fetch failed:", error.response?.status || error.message);
    }
}
/* ----------------------------------------
 * Network disruption feeds
 * -------------------------------------- */
function mapCloudflareOutage(item) {
    if (!item || typeof item !== "object") return null;
    const locationLabel =
        item.location ||
        item.locationName ||
        item.name ||
        item.country ||
        item.countryName ||
        item.asn_name ||
        item.as_name ||
        item.entity ||
        item.title ||
        "";
    const startedAt =
        item.startTime ||
        item.started_at ||
        item.start_date ||
        item.datetime ||
        item.time ||
        item.since ||
        new Date().toISOString();
    const endedAt =
        item.endTime ||
        item.ended_at ||
        item.end_date ||
        null;
    const scopeText = normalizeText(
        [
            item.outageType,
            item.cause,
            item.eventType,
            item.severity,
            item.status
        ].filter(Boolean).join(" ")
    ).toLowerCase();
    const scope = /(asn|autonomous system|network)/i.test(locationLabel) ? "asn" : "country";
    const kind = /(asn|autonomous system|network)/i.test(scopeText) ? "connectivity_loss" : "internet_outage";
    const severity = deriveNetworkSeverity(kind, scope);
    return {
        title: `Internet outage detected${locationLabel ? ` in ${locationLabel}` : ""}`,
        summary: normalizeText(
            [
                item.description,
                item.cause,
                item.outageType,
                item.status
            ].filter(Boolean).join(". ")
        ) || "Cloudflare Radar outage signal.",
        occurred_at: normalizeOccurredAt(startedAt),
        expires_at: endedAt ? normalizeOccurredAt(endedAt) : null,
        location_label: locationLabel || "Unknown location",
        severity,
        tags: uniqueTags(["cloudflare-radar", "internet-outage", scopeText]),
        dedupe_key: [
            "CF_RADAR",
            locationLabel || "",
            startedAt || "",
            endedAt || ""
        ].join("|")
    };
}
function mapIodaOutage(item) {
    if (!item || typeof item !== "object") return null;
    const locationLabel =
        item.country ||
        item.entity ||
        item.name ||
        item.location ||
        item.country_name ||
        item.label ||
        "";
    const startedAt =
        item.start ||
        item.started_at ||
        item.start_time ||
        item.timestamp ||
        item.time ||
        new Date().toISOString();
    const valueText = normalizeText(
        [
            item.level,
            item.status,
            item.cause
        ].filter(Boolean).join(" ")
    ).toLowerCase();
    const severity = deriveNetworkSeverity("connectivity_loss", "asn");
    return {
        title: `Connectivity disruption detected${locationLabel ? ` in ${locationLabel}` : ""}`,
        summary: normalizeText(
            [
                item.summary,
                item.status,
                item.cause
            ].filter(Boolean).join(". ")
        ) || "IODA outage signal.",
        occurred_at: normalizeOccurredAt(startedAt),
        location_label: locationLabel || "Unknown location",
        severity,
        tags: uniqueTags(["ioda", "internet-outage", valueText]),
        dedupe_key: [
            "IODA",
            locationLabel || "",
            startedAt || ""
        ].join("|")
    };
}
function mapOoniObservation(item) {
    if (!item || typeof item !== "object") return null;
    const locationLabel =
        item.probe_cc_name ||
        item.probe_country ||
        item.location ||
        item.country_name ||
        item.country ||
        item.probe_cc ||
        "";
    const networkName =
        item.asn_name ||
        item.network_name ||
        item.probe_asn ||
        "";
    const testName =
        item.test_name ||
        item.measurement_uid ||
        "blocking observation";
    const failureText = normalizeText(
        [
            item.anomaly,
            item.blocking,
            item.failure,
            item.confirmed
        ].filter(Boolean).join(" ")
    ).toLowerCase();
    const severity = deriveNetworkSeverity("service_blocking");
    return {
        title: `Network blocking signal${locationLabel ? ` in ${locationLabel}` : ""}`,
        summary: normalizeText(
            [
                `Test: ${testName}`,
                networkName ? `Network: ${networkName}` : "",
                item.anomaly ? `Anomaly: ${item.anomaly}` : "",
                item.failure ? `Failure: ${item.failure}` : "",
                item.confirmed ? `Confirmed: ${item.confirmed}` : ""
            ].filter(Boolean).join(". ")
        ),
        occurred_at: normalizeOccurredAt(item.measurement_start_time || item.created_at || item.timestamp || new Date().toISOString()),
        location_label: locationLabel || "Unknown location",
        severity,
        tags: uniqueTags(["ooni", "blocking", "censorship", item.test_name || ""]),
        dedupe_key: [
            "OONI",
            locationLabel || "",
            item.measurement_uid || item.id || "",
            item.measurement_start_time || item.created_at || ""
        ].join("|")
    };
}
async function finalizeNetworkEvent(baseEvent, feed, extra = {}) {
    if (!baseEvent) return null;
    const location = await resolveLocationFromText(baseEvent.location_label || "", { requireBBox: false });
    if (!location) return null;
    return {
        category: feed.category || "network",
        title: baseEvent.title || `${feed.name} signal`,
        summary: baseEvent.summary || `${feed.name} detected a network disruption.`,
        source_name: feed.name,
        source_url: extra.source_url || feed.url || "",
        occurred_at: normalizeOccurredAt(baseEvent.occurred_at),
        lat: Number(location.lat),
        lon: Number(location.lon),
        location_label: location.label || baseEvent.location_label || "Unknown location",
        confidence: Number(extra.confidence ?? 72),
        actor_side: "unknown",
        target_side: "unknown",
        weapon_type: "network disruption",
        target_type: "communications infrastructure",
        impact_type: "digital",
        report_type: extra.report_type || "network",
        severity: baseEvent.severity || "medium",
        country_code: extra.country_code || "",
        tags: uniqueTags([...(baseEvent.tags || []), "network"]),
        airspace_status: "unknown",
        cyber_status: "elevated",
        fir_code: "",
        dedupe_key: baseEvent.dedupe_key
    };
}
async function processCloudflareRadarFeed(feed) {
    if (!process.env.CLOUDFLARE_RADAR_TOKEN) {
        console.log("Cloudflare Radar skipped: CLOUDFLARE_RADAR_TOKEN missing");
        return;
    }
    const response = await axios.get(feed.url, {
        timeout: 20000,
        headers: {
            Authorization: `Bearer ${process.env.CLOUDFLARE_RADAR_TOKEN}`,
            Accept: "application/json",
            "User-Agent": "warzone-worker/1.0"
        }
    });
    const results =
        toArray(response.data?.result?.outages).length ? response.data.result.outages :
            toArray(response.data?.result).length ? response.data.result :
                toArray(response.data?.outages).length ? response.data.outages :
                    toArray(response.data?.data);
    for (const item of results.slice(0, 25)) {
        const mapped = mapCloudflareOutage(item);
        const event = await finalizeNetworkEvent(mapped, feed, {
            report_type: "internet_outage",
            source_url: item?.url || feed.url,
            country_code: item?.countryCode || item?.country_code || ""
        });
        if (!event) continue;
        await insertEventIfValid(event);
    }
}
async function processIodaFeed(feed) {
    const response = await axios.get(feed.url, {
        timeout: 20000,
        headers: {
            Accept: "application/json",
            "User-Agent": "warzone-worker/1.0"
        }
    });
    const results =
        toArray(response.data?.results).length ? response.data.results :
            toArray(response.data?.events).length ? response.data.events :
                toArray(response.data?.data).length ? response.data.data :
                    toArray(response.data);
    for (const item of results.slice(0, 25)) {
        const mapped = mapIodaOutage(item);
        const event = await finalizeNetworkEvent(mapped, feed, {
            report_type: "internet_outage",
            source_url: item?.url || feed.url,
            country_code: item?.countryCode || item?.country_code || ""
        });
        if (!event) continue;
        await insertEventIfValid(event);
    }
}
async function processOoniFeed(feed) {
    const response = await axios.get(feed.url, {
        timeout: 20000,
        headers: {
            Accept: "application/json",
            "User-Agent": "warzone-worker/1.0"
        }
    });
    const results =
        toArray(response.data?.results).length ? response.data.results :
            toArray(response.data?.measurements).length ? response.data.measurements :
                toArray(response.data?.data).length ? response.data.data :
                    toArray(response.data);
    for (const item of results.slice(0, 25)) {
        const mapped = mapOoniObservation(item);
        const event = await finalizeNetworkEvent(mapped, feed, {
            report_type: "network_blocking",
            source_url: item?.url || feed.url,
            country_code: item?.probe_cc || item?.country_code || ""
        });
        if (!event) continue;
        await insertEventIfValid(event);
    }
}
/* ----------------------------------------
 * Main feed processor
 * -------------------------------------- */
async function processFeed(feed) {
    console.log("Fetching:", feed.name, feed.url || "[telegram]");
    if (feed.parser === "telegram") {
        await processTelegramFeed(feed);
        return;
    }
    if (feed.parser === "reddit") {
        await processRedditFeed(feed);
        return;
    }
    if (feed.parser === "usgs") {
        await processUsgsFeed(feed);
        return;
    }
    if (feed.parser === "firms") {
        await processFirmsFeed(feed);
        return;
    }
    if (feed.parser === "alerts-array") {
        await processManualAlertsFeed(feed);
        return;
    }
    if (feed.parser === "airspace-manual") {
        await processManualAirspaceFeed(feed);
        return;
    }
    if (feed.parser === "airspace-api") {
        await processAviationEdgeFeed(feed);
        return;
    }
    if (feed.parser === "cyber") {
        await processCyberFeed(feed);
        return;
    }
    if (feed.parser === "network-cloudflare") {
        await processCloudflareRadarFeed(feed);
        return;
    }
    if (feed.parser === "network-ioda") {
        await processIodaFeed(feed);
        return;
    }
    if (feed.parser === "network-ooni") {
        await processOoniFeed(feed);
        return;
    }
    if (feed.parser === "adsb-military") {
        await processMilitaryFlightsFeed(feed);
        return;
    }
    if (feed.parser === "acled") {
        const payload = await fetchAcledEvents();
        const items = Array.isArray(payload?.data) ? payload.data : [];
        for (const item of items) {
            const event = normalizeAcledEvent(item, feed);
            await insertEventIfValid(event);
        }
        return;
    }
    if (feed.parser === "ucdp") {
        await processUcdpFeed(feed);
        return;
    }
    if (feed.parser === "gdelt") {
        try {
            const response = await axios.get(feed.url, {
                params: {
                    query: feed.query,
                    mode: feed.mode || "ArtList",
                    format: feed.format || "json",
                    maxrecords: Number(feed.maxrecords || 50),
                    sort: feed.sort || "DateDesc",
                    timespan: feed.timespan || "12h"
                },
                timeout: 45000,
                headers: {
                    Accept: "application/json"
                }
            });

            const items = Array.isArray(response.data?.articles) ? response.data.articles : [];

            console.log(`[GDELT] fetched ${items.length} article candidates`);

            for (const item of items) {
                const event = normalizeGdeltEvent(item, feed);
                if (!event) continue;
                await insertEventIfValid(event);
            }

            return;
        } catch (error) {
            console.warn("[GDELT] Fetch failed:", error.response?.status || error.message);
            return;
        }
    }
    if (feed.parser === "eonet") {
        try {
            const response = await axios.get(feed.url, {
                params: {
                    status: "open",
                    limit: 50,
                    category: "wildfires"
                },
                timeout: 20000
            });
            const items = Array.isArray(response.data?.events) ? response.data.events : [];
            for (const item of items) {
                const event = normalizeEonetEvent(item, feed);
                await insertEventIfValid(event);
            }
        } catch (error) {
            console.error("EONET skipped this cycle:", error.response?.status || error.message);
        }
        return;
    }
    if (feed.parser === "events-array") {
        const response = await axios.get(feed.url, {
            timeout: 15000,
            headers: { "Cache-Control": "no-cache" }
        });
        const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
        const items = Array.isArray(payload?.events) ? payload.events : [];
        for (const item of items) {
            const event = buildSeedEvent(item, feed);
            await insertEventIfValid(event);
        }
        return;
    }
    if (feed.parser === "notam-api") {
        await processNotamFeed(feed);
        return;
    }
    if (feed.parser === "rss") {
        await processRssFeed(feed);
        return;
    }
    console.log("Skipped unsupported parser:", feed.parser);
}
/* ----------------------------------------
 * Worker loop
 * -------------------------------------- */
async function runWorker() {
    if (isWorkerRunning) {
        console.log("Previous worker cycle still running, skipping this tick");
        return;
    }
    isWorkerRunning = true;
    try {
        const adsbFeed = sources.feeds.find(f => f.type === "adsb-opensky");
        const aisFeed = sources.feeds.find(f => f.type === "ais-stream");
        if (adsbFeed?.enabled !== false)
            await runAdsbWorker().catch(err => console.error("[adsb]", err.message));
        if (aisFeed?.enabled !== false)
            await runAisWorker().catch(err => console.error("[ais]", err.message));
        const activeFeeds = toArray(sources.feeds).filter((feed) =>
            feed.enabled !== false &&
            feed.type !== "adsb-opensky" &&
            feed.type !== "ais-stream"
        );
        for (const feed of activeFeeds) {
            try {
                await processFeed(feed);
            } catch (err) {
                console.error("Feed error:", feed.name, err.message);
            }
        }
        try {
            await clearExpiredAlerts();
        } catch (err) {
            console.error("Alert cleanup error:", err.message);
        }
        try {
            await pruneStaleData();
        } catch (err) {
            console.error("Data pruning error:", err.message);
        }
    } finally {
        isWorkerRunning = false;
    }
}
cron.schedule("*/5 * * * *", () => {
    runWorker();
});
// ── Pikud HaOref real-time siren poller (1.5s interval) ──────────────────────
// Runs independently of the 5-min cron — sidetracks into warzone-siren-poller.js
startOrefPoller();
console.log("Worker started");
runWorker();