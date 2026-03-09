// apps/worker/src/index.js
import "dotenv/config";
import http from "http";
import cron from "node-cron";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { supabase } from "./supabase.js";

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("warzone worker running");
}).listen(PORT);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sourcesPath = path.join(__dirname, "sources.json");
const rawSources = fs.readFileSync(sourcesPath, "utf-8");

const sources = JSON.parse(
    rawSources.replace(/\$\{SEED_FEED_URL\}/g, process.env.SEED_FEED_URL || "")
);

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
    "strike",
    "bombardment",
    "siren",
    "sirens",
    "air raid",
    "red alert",
    "interception",
    "intercepted",
    "interceptor",
    "air defense",
    "air defence",
    "anti-air",
    "naval",
    "warship",
    "frigate",
    "destroyer",
    "submarine",
    "carrier",
    "fleet",
    "sortie",
    "fighter jet",
    "fighter",
    "military alert",
    "military activity",
    "explosion",
    "explosions",
    "blast",
    "artillery",
    "shelling",
    "barrage",
    "raid"
];

const STOP_LOCATION_WORDS = new Set([
    "breaking",
    "urgent",
    "update",
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

/* ----------------------------------------
 * Generic helpers
 * -------------------------------------- */
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

/* ----------------------------------------
 * Supabase helpers
 * -------------------------------------- */
async function insertEvent(event) {
    const { error } = await supabase.from("events").insert([event]);

    if (error) {
        console.error("Insert error:", error.message);
        return false;
    }

    console.log("Event inserted:", event.title);
    return true;
}

function makeDedupeKey(item, feed) {
    if (item.dedupe_key) return item.dedupe_key;

    return [
        feed.name || "feed",
        item.title || "untitled",
        item.occurred_at || "",
        item.location_label || "",
        item.lat ?? "",
        item.lon ?? ""
    ].join("|");
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
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon) || !event.occurred_at) {
        return false;
    }

    const eventTime = new Date(event.occurred_at).getTime();
    if (!Number.isFinite(eventTime)) return false;

    const fromTime = new Date(eventTime - 90 * 60 * 1000).toISOString();
    const toTime = new Date(eventTime + 90 * 60 * 1000).toISOString();

    const { data, error } = await supabase
        .from("events")
        .select("id, category, weapon_type, lat, lon, occurred_at, source_name")
        .gte("occurred_at", fromTime)
        .lte("occurred_at", toTime)
        .eq("category", event.category)
        .limit(50);

    if (error) {
        console.error("Similarity lookup error:", error.message);
        return false;
    }

    for (const row of data || []) {
        const latDiff = Math.abs(Number(row.lat) - Number(event.lat));
        const lonDiff = Math.abs(Number(row.lon) - Number(event.lon));
        const sameArea = latDiff <= 0.5 && lonDiff <= 0.5;
        const sameWeapon = String(row.weapon_type || "unknown") === String(event.weapon_type || "unknown");

        if (sameArea && sameWeapon) {
            return true;
        }
    }

    return false;
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
        occurred_at: item.event_date || new Date().toISOString(),
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
        tags: [],
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
        occurred_at: geometry?.date || new Date().toISOString(),
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
        tags: [],
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
    const lat = Number(item.locationlat);
    const lon = Number(item.locationlon);
    const title = item.title || "GDELT event";
    const summary = item.seendate || "GDELT detected news signal";
    const sourceUrl = item.url || "https://gdeltproject.org";
    const text = `${title} ${summary}`.toLowerCase();

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
    else if (text.includes("naval")) weaponType = "naval platform";
    else if (text.includes("artillery")) weaponType = "artillery";

    let targetType = "unknown";
    if (text.includes("airport")) targetType = "airport";
    else if (text.includes("airbase") || text.includes("air base")) targetType = "airbase";
    else if (text.includes("base")) targetType = "military facility";
    else if (text.includes("warship") || text.includes("ship") || text.includes("vessel")) targetType = "naval asset";
    else if (text.includes("port")) targetType = "port";
    else if (text.includes("radar")) targetType = "radar site";
    else if (text.includes("city") || text.includes("urban")) targetType = "urban area";
    else if (text.includes("oil") || text.includes("energy")) targetType = "energy infrastructure";

    let severity = "low";
    if (text.includes("massive") || text.includes("major") || text.includes("heavy")) severity = "high";
    if (text.includes("multiple explosions") || text.includes("wave of strikes") || text.includes("barrage")) severity = "critical";
    else if (
        text.includes("missile") ||
        text.includes("drone") ||
        text.includes("airstrike") ||
        text.includes("air strike") ||
        text.includes("naval") ||
        text.includes("artillery")
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
    } else if (text.includes("naval") || text.includes("warship") || text.includes("fleet")) {
        category = "military";
    } else if (text.includes("fighter jet") || text.includes("sortie") || text.includes("patrol")) {
        category = "recon";
    }

    return {
        category,
        title,
        summary,
        source_name: "GDELT",
        source_url: sourceUrl,
        occurred_at: item.seendate || new Date().toISOString(),
        lat,
        lon,
        location_label: item.locationname || "Unknown location",
        confidence: 40,
        actor_side: actorSide,
        target_side: "unknown",
        weapon_type: weaponType,
        target_type: targetType,
        impact_type: targetType === "urban area" ? "civilian" : "military",
        report_type: "signal",
        severity,
        country_code: "",
        tags: [],
        airspace_status: "unknown",
        cyber_status: "unknown",
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
        occurred_at: item.occurred_at || new Date().toISOString(),
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
        {
            connectionRetries: 5
        }
    );

    await telegramClient.connect();

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

    return allKeywords.some((keyword) => lower.includes(keyword));
}

function getTelegramChannels(feed) {
    const feedChannels = toArray(feed.channels)
        .map(toTelegramChannelKey)
        .filter(Boolean);

    const channels = feedChannels.length ? feedChannels : TELEGRAM_DEFAULT_CHANNELS;
    return [...new Set(channels)];
}

function extractTelegramText(msg) {
    return normalizeText(msg?.message || msg?.rawText || msg?.text || "");
}

function extractCoordinatesFromText(text) {
    const match = text.match(/(-?\d{1,2}\.\d{2,8})\s*[, ]\s*(-?\d{1,3}\.\d{2,8})/);
    if (!match) return null;

    const lat = safeNumber(match[1]);
    const lon = safeNumber(match[2]);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return { lat, lon };
}

function cleanLocationCandidate(value) {
    return String(value || "")
        .replace(/^[\s,:;.\-–—]+/, "")
        .replace(/[\s,:;.\-–—]+$/, "")
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
        /\b(?:in|near|over|around|at|off|outside)\s+([A-Z][A-Za-z.'’-]+(?:[\s-][A-Z][A-Za-z.'’-]+){0,4}(?:,\s*[A-Z][A-Za-z.'’-]+(?:[\s-][A-Z][A-Za-z.'’-]+){0,3})?)/g,
        /\b(?:north of|south of|east of|west of)\s+([A-Z][A-Za-z.'’-]+(?:[\s-][A-Z][A-Za-z.'’-]+){0,4}(?:,\s*[A-Z][A-Za-z.'’-]+(?:[\s-][A-Z][A-Za-z.'’-]+){0,3})?)/g,
        /\b([A-Z][A-Za-z.'’-]+(?:[\s-][A-Z][A-Za-z.'’-]+){0,3},\s*[A-Z][A-Za-z.'’-]+(?:[\s-][A-Z][A-Za-z.'’-]+){0,3})\b/g,
        /#([A-Z][A-Za-z0-9_-]{2,})/g
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(normalized)) !== null) {
            const raw = match[1];
            const cleaned = cleanLocationCandidate(raw);
            if (isGoodLocationCandidate(cleaned)) {
                candidates.push(cleaned.replace(/_/g, " "));
            }
        }
    }

    return [...new Set(candidates)].slice(0, 5);
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
                limit: 1
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

        const result = {
            lat: Number(item.lat),
            lon: Number(item.lon),
            label: item.display_name || query
        };

        if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) {
            geocodeCache.set(key, null);
            return null;
        }

        geocodeCache.set(key, result);
        return result;
    } catch (error) {
        console.error("Geocode error:", query, error.response?.status || error.message);
        geocodeCache.set(key, null);
        return null;
    }
}

function detectTelegramCategory(text) {
    const t = text.toLowerCase();

    if (/(missile|ballistic|cruise missile|rocket barrage|rocket launch)/i.test(t)) return "strike";
    if (/(drone|uav|shahed|loitering munition)/i.test(t)) return "strike";
    if (/(air raid|sirens|red alert|warning)/i.test(t)) return "alert";
    if (/(airstrike|air strike|bombardment|raid)/i.test(t)) return "strike";
    if (/(naval|warship|frigate|destroyer|submarine|carrier|fleet)/i.test(t)) return "military";
    if (/(fighter jet|sortie|patrol|recon)/i.test(t)) return "recon";
    return "military";
}

function detectTelegramSeverity(text) {
    const t = text.toLowerCase();

    if (/(massive|huge|major|heavy|multiple impacts|barrage|wave of strikes|confirmed hit|critical)/i.test(t)) return "critical";
    if (/(missile|drone|airstrike|air strike|explosion|naval|shelling|artillery)/i.test(t)) return "high";
    if (/(siren|warning|alert|interception|intercepted)/i.test(t)) return "medium";
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
        "explosion"
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

async function resolveTelegramLocation(text) {
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
        if (geocoded) {
            return geocoded;
        }
    }

    return null;
}

async function normalizeTelegramEvent(msg, feed, channelKey) {
    const text = extractTelegramText(msg);
    if (!text) return null;
    if (!isRelevantTelegramText(text, feed)) return null;

    const location = await resolveTelegramLocation(text);
    if (!location) return null;

    const category = detectTelegramCategory(text);
    const severity = detectTelegramSeverity(text);
    const weaponType = detectTelegramWeaponType(text);
    const targetType = detectTelegramTargetType(text);
    const impactType = detectTelegramImpactType(targetType);
    const actorSide = detectTelegramActorSide(text);
    const confidence = detectTelegramConfidence(text);

    const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || text;
    const title = firstLine.slice(0, 160) || "Telegram OSINT event";
    const summary = text.slice(0, 1500);

    return {
        category,
        title,
        summary,
        source_name: `Telegram / ${channelKey}`,
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
        tags: extractTelegramTags(text, channelKey, toArray(feed.tags)),
        airspace_status: "unknown",
        cyber_status: "unknown",
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
            entity = await client.getEntity(rawChannel.startsWith("@") ? rawChannel : channelKey);
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
                    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;

                    const exists = await eventExists(event.dedupe_key);
                    if (exists) continue;

                    const similarExists = await similarEventExists(event);
                    if (similarExists) continue;

                    await insertEvent(event);
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
 * Main feed processor
 * -------------------------------------- */
async function processFeed(feed) {
    console.log("Fetching:", feed.name, feed.url || "[telegram]");

    if (feed.parser === "telegram") {
        await processTelegramFeed(feed);
        return;
    }

    if (feed.parser === "acled") {
        const payload = await fetchAcledEvents();
        const items = Array.isArray(payload?.data) ? payload.data : [];

        for (const item of items) {
            const event = normalizeAcledEvent(item, feed);
            const exists = await eventExists(event.dedupe_key);

            if (exists) continue;
            if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;

            await insertEvent(event);
        }

        return;
    }

    if (feed.parser === "gdelt") {
        const response = await axios.get(feed.url, {
            params: {
                query: '("missile" OR "ballistic missile" OR "cruise missile" OR "drone strike" OR "air strike" OR "airstrike" OR "fighter jet" OR "military base" OR "airbase" OR "air defense" OR "naval attack" OR "warship" OR "fleet" OR "artillery strike" OR "rocket attack")',
                mode: "ArtList",
                format: "json",
                maxrecords: 25,
                sort: "DateDesc",
                timespan: "24h"
            },
            timeout: 45000
        });

        const items = Array.isArray(response.data?.articles) ? response.data.articles : [];

        for (const item of items) {
            const event = normalizeGdeltEvent(item, feed);
            const exists = await eventExists(event.dedupe_key);

            if (exists) continue;
            if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;

            await insertEvent(event);
        }

        return;
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
                const exists = await eventExists(event.dedupe_key);

                if (exists) continue;
                if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;

                await insertEvent(event);
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
            const exists = await eventExists(event.dedupe_key);

            if (exists) continue;
            if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;

            await insertEvent(event);
        }

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
        const activeFeeds = sources.feeds.filter((feed) => feed.enabled !== false);

        for (const feed of activeFeeds) {
            try {
                await processFeed(feed);
            } catch (err) {
                console.error("Feed error:", feed.name, err.message);
            }
        }
    } finally {
        isWorkerRunning = false;
    }
}

cron.schedule("*/5 * * * *", () => {
    runWorker();
});

console.log("Worker started");
runWorker();