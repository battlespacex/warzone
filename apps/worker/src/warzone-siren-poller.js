// warzone-siren-poller.js
//
// Real-time siren & red-alert poller for StrikeMap / Warzone backend.
//
// Data sources:
//   1. Pikud HaOref official API  — https://www.oref.org.il/WarningMessages/alert/alerts.json
//      • Polls every 1.5 s (official site itself polls every 1 s)
//      • Requires Israeli IP  →  EC2 must be in il-central-1 (Tel Aviv)
//        OR set env OREF_PROXY=http://user:pass@proxy-il:port
//      • Returns empty body / {} when no active alert
//
//   2. IsraelWarRoom Telegram channel  — already wired into the main Telegram client
//      • This module exports `handleIsraelWarRoomMessage(text)` which the main
//        Telegram handler calls when a message arrives from that channel.
//
// Output:
//   • Upserts into Supabase `active_alerts` table
//   • Broadcasts a Supabase Realtime event so the frontend `warzone-realtime.js`
//     can call `showSirenAlert()` immediately without waiting for a poll cycle
//
// Env vars consumed:
//   OREF_PROXY          optional HTTP proxy for oref.org.il (non-IL servers)
//   OREF_POLL_MS        poll interval in ms          (default: 1500)
//   OREF_ENABLED        set "false" to disable        (default: true)
//   SUPABASE_URL        (shared with main worker)
//   SUPABASE_SERVICE_KEY(shared with main worker)

import axios from "axios";
import { supabase } from "./supabase.js";

// ─── Pikud HaOref API ──────────────────────────────────────────────────────────

const OREF_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json";
const OREF_HISTORY = "https://www.oref.org.il/WarningMessages/History/AlertsHistory.json";
const OREF_POLL_MS = Number(process.env.OREF_POLL_MS || 1500);
const OREF_ENABLED = process.env.OREF_ENABLED !== "false";

// Required headers — oref.org.il blocks requests without Referer + XHR header
const OREF_HEADERS = {
    "Referer": "https://www.oref.org.il/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
};

// ─── Alert category → metadata ────────────────────────────────────────────────
// Source: Pikud HaOref `cat` field (unofficial but stable since 2021)
const OREF_CATEGORIES = {
    1: { label: "Missiles & Rockets", level: "red", severity: "critical", sound: true },
    2: { label: "Hostile Aircraft", level: "red", severity: "critical", sound: true },
    3: { label: "Earthquake", level: "orange", severity: "high", sound: false },
    4: { label: "Radiological Incident", level: "red", severity: "critical", sound: true },
    5: { label: "Tsunami Warning", level: "red", severity: "critical", sound: true },
    6: { label: "Hazardous Materials", level: "orange", severity: "high", sound: true },
    7: { label: "Terrorist Infiltration", level: "red", severity: "critical", sound: true },
    13: { label: "Unconventional Missile", level: "red", severity: "critical", sound: true },
    20: { label: "Drill", level: "yellow", severity: "low", sound: false },
    // fallback
    0: { label: "General Alert", level: "orange", severity: "high", sound: true },
};

// ─── Israeli city → lat/lon ───────────────────────────────────────────────────
// Covers the ~60 most-alerted cities. Expand as needed.
// Names match Pikud HaOref's English transliteration (from their own API responses).
const CITY_COORDS = {
    // Tel Aviv metro
    "Tel Aviv - East": [32.0735, 34.8070],
    "Tel Aviv - North": [32.1050, 34.7905],
    "Tel Aviv - South": [32.0490, 34.7810],
    "Tel Aviv": [32.0853, 34.7818],
    "Jaffa - North": [32.0480, 34.7540],
    "Jaffa - South": [32.0255, 34.7525],
    "Bat Yam": [32.0209, 34.7498],
    "Holon": [32.0105, 34.7792],
    "Rishon LeZion - West": [31.9780, 34.7770],
    "Rishon LeZion - East": [31.9780, 34.8040],
    "Rishon LeZion": [31.9730, 34.7877],
    "Petah Tikva": [32.0888, 34.8879],
    "Bnei Brak": [32.0818, 34.8339],
    "Ramat Gan": [32.0704, 34.8237],
    "Givatayim": [32.0706, 34.8121],
    "Herzliya": [32.1626, 34.8448],
    "Ra'anana": [32.1837, 34.8694],
    "Kfar Saba": [32.1774, 34.9074],
    "Netanya": [32.3215, 34.8532],
    "Hadera": [32.4339, 34.9186],

    // Haifa & North
    "Haifa - Hadar & Downtown": [32.8150, 34.9950],
    "Haifa - Carmel & Lower City": [32.7940, 34.9896],
    "Haifa - North Haifa & Bay": [32.8330, 34.9837],
    "Kiryat Ata": [32.8054, 35.1049],
    "Kiryat Bialik": [32.8227, 35.0756],
    "Kiryat Motzkin": [32.8375, 35.0741],
    "Nahariya": [33.0080, 35.0981],
    "Akko": [32.9261, 35.0758],
    "Kiryat Shmona": [33.2071, 35.5695],
    "Safed": [32.9648, 35.4960],
    "Tiberias": [32.7955, 35.5317],
    "Carmiel": [32.9139, 35.2985],
    "Katzrin": [32.9870, 35.6835],

    // Jerusalem & center
    "Jerusalem - City Center": [31.7767, 35.2345],
    "Jerusalem - East": [31.7767, 35.2360],
    "Jerusalem": [31.7683, 35.2137],
    "Modi'in": [31.8948, 35.0099],
    "Lod": [31.9523, 34.8952],
    "Ramla": [31.9296, 34.8711],
    "Rehovot": [31.8939, 34.8114],

    // South
    "Be'er Sheva - North": [31.2647, 34.7917],
    "Be'er Sheva": [31.2518, 34.7913],
    "Ashdod - A,B": [31.8180, 34.6470],
    "Ashdod - C,D": [31.8044, 34.6553],
    "Ashdod - H,Marina": [31.7960, 34.6520],
    "Ashdod": [31.8044, 34.6553],
    "Ashkelon": [31.6688, 34.5742],
    "Ashkelon - North": [31.6900, 34.5700],
    "Ashkelon - South": [31.6500, 34.5600],
    "Sderot": [31.5240, 34.5956],
    "Netivot": [31.4223, 34.5869],
    "Ofakim": [31.3164, 34.6210],
    "Dimona": [31.0653, 35.0324],
    "Eilat": [29.5581, 34.9482],
    "Kibbutz Nir Am": [31.4917, 34.5486],
    "Kibbutz Kfar Aza": [31.4643, 34.5421],
    "Kibbutz Be'eri": [31.3882, 34.4985],
    "Kibbutz Nahal Oz": [31.4597, 34.5198],

    // West Bank envelope / Gaza envelope
    "Sha'ar Hanegev": [31.5290, 34.6213],
    "Hof Ashkelon": [31.5700, 34.5330],
    "Eshkol": [31.2640, 34.4840],
    "Sdot Negev": [31.3980, 34.5765],

    // Lebanon border
    "Metula": [33.2830, 35.5793],
    "Shlomi": [33.0700, 35.1500],
    "Maalot-Tarshiha": [33.0148, 35.2712],
    "Rosh Hanikra": [33.0930, 35.1010],
};

// Fallback: rough region centroids when city not in the map
const REGION_CENTROIDS = {
    "northern israel": [32.9000, 35.2000],
    "southern israel": [31.0000, 34.8000],
    "central israel": [32.0000, 34.9000],
    "tel aviv area": [32.0853, 34.7818],
    "haifa area": [32.7940, 34.9896],
    "jerusalem area": [31.7683, 35.2137],
    "gaza envelope": [31.4600, 34.5100],
    "israel": [31.5000, 35.0000],
};

function cityToCoords(cityName) {
    // Try exact match
    if (CITY_COORDS[cityName]) return CITY_COORDS[cityName];

    // Try case-insensitive substring match
    const lower = cityName.toLowerCase();
    for (const [key, coords] of Object.entries(CITY_COORDS)) {
        if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
            return coords;
        }
    }

    // Try region centroids
    for (const [region, coords] of Object.entries(REGION_CENTROIDS)) {
        if (lower.includes(region)) return coords;
    }

    // Default: center of Israel
    return [31.5, 35.0];
}

// ─── Deduplication ────────────────────────────────────────────────────────────
// Track the last alert ID seen so we don't re-fire the same alert on every poll
let _lastOrefAlertId = null;
let _lastOrefCities = "";

function alertIsNew(alert) {
    const id = String(alert.id || "");
    const cities = (alert.data || []).join(",");

    // Same ID = definitely same alert
    if (id && id === _lastOrefAlertId) return false;

    // Same city list within 30s = likely same alert with no ID
    if (!id && cities === _lastOrefCities) return false;

    _lastOrefAlertId = id || null;
    _lastOrefCities = cities;
    return true;
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function upsertSirenAlert(payload) {
    const { error } = await supabase
        .from("active_alerts")
        .upsert(payload, { onConflict: "alert_key" });

    if (error) {
        console.error("[oref] Supabase upsert error:", error.message);
    }
}

async function broadcastSirenEvent(sirenPayload) {
    // Broadcast via Supabase Realtime so the frontend `warzone-realtime.js`
    // receives it on the `warzone:sirens` channel instantly.
    const channel = supabase.channel("warzone:sirens");
    await channel.send({
        type: "broadcast",
        event: "siren",
        payload: sirenPayload,
    });
    // Immediately unsubscribe — this is fire-and-forget
    await supabase.removeChannel(channel);
}

// ─── Pikud HaOref response → normalized alert ─────────────────────────────────
// Raw alert shape:
//   { id: "134168709720000000", cat: "1", title: "ירי טילים ורקטות",
//     data: ["תל אביב - מזרח", "חיפה"], desc: "היכנסו למרחב המוגן" }
//
// Note: `data` is city names in Hebrew. We use the English city list separately
// from the History endpoint when needed.
//
async function processOrefAlert(raw) {
    if (!raw || typeof raw !== "object" || !raw.data) return;
    if (!Array.isArray(raw.data) || raw.data.length === 0) return;
    if (!alertIsNew(raw)) return;

    const cat = Number(raw.cat || 1);
    const meta = OREF_CATEGORIES[cat] || OREF_CATEGORIES[0];
    const alertId = String(raw.id || Date.now());
    const cities = raw.data; // Hebrew city names from the live API
    const title_he = raw.title || "התראה";
    const desc_he = raw.desc || "";

    // Attempt to fetch English city names from the history endpoint
    // (the live endpoint always returns Hebrew city names)
    let citiesEn = await fetchEnglishCityNames(alertId);
    if (!citiesEn.length) {
        // Fallback: use Hebrew names as-is — frontend can display them
        citiesEn = cities;
    }

    console.log(`[oref] 🚨 Alert [cat:${cat}] ${meta.label}: ${citiesEn.slice(0, 5).join(", ")}${citiesEn.length > 5 ? ` +${citiesEn.length - 5} more` : ""}`);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 min TTL
    const regionLabel = summariseRegion(citiesEn);
    const alertKey = `oref:${alertId}`;

    // ── 1. Upsert into active_alerts (drives the siren banner + Airspace widget) ──
    await upsertSirenAlert({
        alert_key: alertKey,
        category: "siren",
        region: regionLabel,
        title: `${meta.label.toUpperCase()} — ${regionLabel}`,
        summary: `${citiesEn.slice(0, 8).join(", ")}${citiesEn.length > 8 ? ` and ${citiesEn.length - 8} more areas` : ""}`,
        status: "active",
        source_name: "Pikud HaOref",
        source_url: "https://www.oref.org.il/",
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        meta: {
            oref_id: alertId,
            oref_cat: cat,
            cities_he: cities,
            cities_en: citiesEn,
            level: meta.level,
            severity: meta.severity,
            sound: meta.sound,
        },
    });

    // ── 2. Broadcast realtime siren event to frontend ──────────────────────────
    // Frontend warzone-realtime.js handles `warzone:sirens` → calls showSirenAlert()
    await broadcastSirenEvent({
        title: regionLabel,
        meta: `via Pikud HaOref · ${citiesEn.slice(0, 4).join(", ")}${citiesEn.length > 4 ? ` +${citiesEn.length - 4}` : ""}`,
        level: meta.level,      // "red" | "orange" | "yellow"
        sound: meta.sound,
        cities: citiesEn,
        category: meta.label,
        oref_id: alertId,
    });

    // ── 3. Insert geo-events for each city onto the map ────────────────────────
    for (const city of citiesEn.slice(0, 20)) { // cap at 20 to avoid Supabase spam
        const [lat, lon] = cityToCoords(city);
        await insertSirenEventToMap({
            city,
            lat,
            lon,
            alertId,
            meta,
            regionLabel,
            citiesEn,
            now,
        });
    }
}

// ─── Fetch English city names from history endpoint ───────────────────────────
// The live alerts.json only has Hebrew names. The history endpoint
// sometimes returns the same alert in English within 2–5 seconds.
// We do one quick attempt and fall back to transliteration if needed.
let _englishCityCache = new Map(); // alertId → string[]

async function fetchEnglishCityNames(alertId) {
    if (_englishCityCache.has(alertId)) return _englishCityCache.get(alertId);

    try {
        const res = await axios.get(OREF_HISTORY, {
            timeout: 4000,
            headers: OREF_HEADERS,
            ...(process.env.OREF_PROXY ? { proxy: parseProxy(process.env.OREF_PROXY) } : {}),
        });

        const history = Array.isArray(res.data) ? res.data : [];
        // History items: { alertDate, title, data (city name), category }
        // Find recent items that match our timing
        const recent = history.slice(0, 30).map(h => h.data).filter(Boolean);
        if (recent.length) {
            _englishCityCache.set(alertId, recent);
            // Expire cache after 10 minutes
            setTimeout(() => _englishCityCache.delete(alertId), 10 * 60 * 1000);
            return recent;
        }
    } catch {
        // Silently fall back — history endpoint is non-critical
    }

    return [];
}

// ─── Insert a single siren event to the map ───────────────────────────────────

async function insertSirenEventToMap({ city, lat, lon, alertId, meta, regionLabel, citiesEn, now }) {
    const dedupeKey = `OREF|${alertId}|${city}`;

    // Check if already inserted (avoid duplicate map points on repeated polls)
    const { data: existing } = await supabase
        .from("events")
        .select("id")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();

    if (existing) return;

    const { error } = await supabase.from("events").insert({
        category: "alert",
        subcategory: "siren",
        title: `${meta.label.toUpperCase()} — ${city}`,
        summary: `Red alert activated in ${city}. ${citiesEn.length > 1 ? `Also: ${citiesEn.filter(c => c !== city).slice(0, 4).join(", ")}` : ""}`,
        source_name: "Pikud HaOref",
        source_url: "https://www.oref.org.il/",
        occurred_at: now.toISOString(),
        lat,
        lon,
        location_label: city,
        confidence: 95,
        actor_side: "unknown",
        target_side: "civilian",
        weapon_type: "unknown",
        target_type: "urban area",
        impact_type: "civilian",
        report_type: "siren_alert",
        severity: meta.severity,
        country_code: "IL",
        tags: ["siren", "red-alert", "oref", meta.label.toLowerCase().replace(/ /g, "-")],
        airspace_status: "unknown",
        cyber_status: "unknown",
        fir_code: "LLLL",
        dedupe_key: dedupeKey,
    });

    if (error) console.error("[oref] Map event insert error:", error.message);
}

// ─── Summarise a city list into a short region label ─────────────────────────

function summariseRegion(cities) {
    if (!cities.length) return "Israel";

    // If all in Tel Aviv area
    const hasTLV = cities.some(c => /tel aviv|jaffa|bat yam|holon|rishon|ramat gan/i.test(c));
    const hasHaifa = cities.some(c => /haifa|kiryat/i.test(c));
    const hasJerusalem = cities.some(c => /jerusalem/i.test(c));
    const hasSouth = cities.some(c => /sderot|ashdod|ashkelon|be.er sheva|negev/i.test(c));
    const hasNorth = cities.some(c => /kiryat shmona|nahariya|safed|tiberias|galil/i.test(c));

    const regions = [];
    if (hasTLV) regions.push("Tel Aviv Area");
    if (hasHaifa) regions.push("Haifa Area");
    if (hasJerusalem) regions.push("Jerusalem Area");
    if (hasSouth) regions.push("Southern Israel");
    if (hasNorth) regions.push("Northern Israel");

    if (regions.length) return regions.join(", ");
    if (cities.length <= 3) return cities.join(", ");
    return `${cities.slice(0, 2).join(", ")} and ${cities.length - 2} more areas`;
}

// ─── Pikud HaOref poll loop ───────────────────────────────────────────────────

let _orefPollTimer = null;

async function pollOref() {
    try {
        const res = await axios.get(OREF_URL, {
            timeout: 3000,
            headers: OREF_HEADERS,
            // oref.org.il geo-blocks non-Israeli IPs.
            // Set OREF_PROXY env var if your EC2 is outside il-central-1.
            ...(process.env.OREF_PROXY ? { proxy: parseProxy(process.env.OREF_PROXY) } : {}),
            // Prevent axios from caching the response
            params: { _: Date.now() },
            validateStatus: s => s < 500,
        });

        // No active alert → empty body, empty object, or empty `data` array
        const body = res.data;
        if (!body || (typeof body === "object" && !body.id && !body.data?.length)) return;

        await processOrefAlert(body);

    } catch (err) {
        // Connection refused / timeout / geo-blocked — log quietly
        if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
            console.warn("[oref] Connection issue (is EC2 in il-central-1?):", err.code);
        } else if (err.response?.status === 403) {
            console.warn("[oref] 403 — geo-blocked or bad headers. Set OREF_PROXY env var.");
        } else {
            console.warn("[oref] Poll error:", err.message);
        }
    }
}

function startOrefPoller() {
    if (!OREF_ENABLED) {
        console.log("[oref] Poller disabled (OREF_ENABLED=false)");
        return;
    }

    console.log(`[oref] Starting Pikud HaOref siren poller — interval: ${OREF_POLL_MS}ms`);

    // Run immediately on start
    pollOref();

    // Then on a tight interval
    _orefPollTimer = setInterval(pollOref, OREF_POLL_MS);
}

function stopOrefPoller() {
    if (_orefPollTimer) {
        clearInterval(_orefPollTimer);
        _orefPollTimer = null;
    }
}

// ─── IsraelWarRoom Telegram parser ───────────────────────────────────────────
//
// Called by the main Telegram handler in index.js when a message arrives
// from the IsraelWarRoom channel.
//
// Message patterns:
//   🚨 URGENT: Rockets fired toward Tel Aviv
//   ⚠️ Sirens in Northern Israel (Kiryat Shmona, Metula, Shlomi)
//   🔴 Red Alert in Ashkelon, Sderot
//   AIR RAID — Central Israel
//
const IWR_SIREN_RE = /(?:🚨|🔴|⚠️|red alert|tzeva adom|siren|air raid|rocket|missile|hostile aircraft)/i;
const IWR_CITY_RE = /(?:in|toward|over|near)\s+([A-Z][a-z\s,'-]+?)(?:\.|$|\n|and)/gi;

export async function handleIsraelWarRoomMessage(text) {
    if (!IWR_SIREN_RE.test(text)) return; // Not a siren/alert message

    console.log("[IsraelWarRoom] 📢 Alert message:", text.slice(0, 120));

    // Extract mentioned cities
    const mentionedCities = [];
    let m;
    while ((m = IWR_CITY_RE.exec(text)) !== null) {
        const city = m[1].trim().replace(/,$/, "");
        if (city.length > 2) mentionedCities.push(city);
    }

    // Also scan for known cities directly in text
    for (const city of Object.keys(CITY_COORDS)) {
        if (text.includes(city)) mentionedCities.push(city);
    }

    const uniqueCities = [...new Set(mentionedCities)];

    // Determine level
    const level = /🚨|red alert|tzeva adom|rocket|missile/i.test(text) ? "red" : "orange";
    const regionLabel = uniqueCities.length ? summariseRegion(uniqueCities) : "Israel";
    const alertKey = `iwr:${Date.now()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    // Upsert alert
    await upsertSirenAlert({
        alert_key: alertKey,
        category: "siren",
        region: regionLabel,
        title: `ALERT — ${regionLabel}`,
        summary: text.slice(0, 300),
        status: "active",
        source_name: "IsraelWarRoom (Telegram)",
        source_url: "https://t.me/IsraelWarRoom/",
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        meta: { cities_en: uniqueCities, level, source: "telegram" },
    });

    // Broadcast to frontend
    await broadcastSirenEvent({
        title: regionLabel,
        meta: `via @IsraelWarRoom · ${text.slice(0, 80)}`,
        level,
        sound: level === "red",
        cities: uniqueCities,
        category: "Telegram Report",
    });

    // Map events for located cities
    for (const city of uniqueCities.slice(0, 10)) {
        const [lat, lon] = cityToCoords(city);
        await insertSirenEventToMap({
            city, lat, lon,
            alertId: alertKey,
            meta: { level, severity: level === "red" ? "critical" : "high", label: "Alert" },
            regionLabel,
            citiesEn: uniqueCities,
            now,
        });
    }
}

// ─── Tzevaadom.co.il (optional — same data as oref.org.il, use as fallback) ──
// tzevaadom.co.il re-publishes the same Pikud HaOref data.
// If oref.org.il is geo-blocking you AND you have no proxy, this is an alternative.
// Their Telegram channel @tzevaadom_en is the most reliable fallback.
// Set env TZEVAADOM_TELEGRAM=@tzevaadom_en to monitor it via the main Telegram client.
// No separate polling needed — the main Telegram handler will pick it up.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseProxy(proxyUrl) {
    try {
        const u = new URL(proxyUrl);
        return {
            protocol: u.protocol.replace(":", ""),
            host: u.hostname,
            port: Number(u.port),
            auth: u.username ? { username: u.username, password: u.password } : undefined,
        };
    } catch {
        return undefined;
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export {
    startOrefPoller,
    stopOrefPoller,
    CITY_COORDS,
    OREF_CATEGORIES,
    cityToCoords,
};