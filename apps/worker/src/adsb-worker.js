// apps/worker/src/adsb-worker.js
//
// Military ADS-B tracker — OpenSky Network (free, no auth required for basic use)
// Runs every 5 minutes via the main worker cron.
//
// Detection strategy (two layers):
//   1. ICAO hex prefix ranges known to be military
//   2. Callsign pattern matching for known military callsign prefixes
//
// Output: events inserted into Supabase `events` table, category = "military"
//         subcategory = aircraft type (fighter / tanker / awacs / recon / transport / patrol)

import fetch from "node-fetch";
import { supabase } from "./supabase.js";

// ─── Military ICAO hex ranges ─────────────────────────────────────────────────
// Source: ICAO allocations + public ADS-B community data
// Format: [start, end] as integers (hex string → parseInt(x, 16))

const MILITARY_ICAO_RANGES = [
    // United States Military
    [0xAE0000, 0xAEFFFF],   // USAF, USN, USMC, Army
    // United Kingdom
    [0x43C000, 0x43CFFF],   // RAF
    [0x43E000, 0x43EFFF],   // RAF extended
    // France
    [0x3B0000, 0x3B7FFF],   // Armée de l'Air
    // Germany
    [0x3C0000, 0x3CFFFF],   // Luftwaffe
    // Russia
    [0x100000, 0x1FFFFF],   // Russian military (broad — includes civil but rich in mil)
    // Israel
    [0x738000, 0x73FFFF],   // IAF
    // Turkey
    [0x4B8000, 0x4B8FFF],   // TurAF
    // Italy
    [0x3D0000, 0x3DFFFF],   // AMI
    // Spain
    [0x340000, 0x34FFFF],   // Ejército del Aire
    // Netherlands
    [0x480000, 0x487FFF],   // RNLAF
    // Belgium
    [0x448000, 0x44FFFF],   // BAF
    // Poland
    [0x488000, 0x48FFFF],   // Polish AF
    // Sweden
    [0x4A8000, 0x4AFFFF],   // Flygvapnet
    // Norway
    [0x47C000, 0x47CFFF],   // RNoAF
    // Australia
    [0x7C0000, 0x7C3FFF],   // RAAF
    // Canada
    [0xC00000, 0xC03FFF],   // RCAF
    // India
    [0x800000, 0x83FFFF],   // IAF (partially)
    // Pakistan
    [0x760000, 0x76FFFF],   // PAF
    // China
    [0x780000, 0x7BFFFF],   // PLAAF (partially)
    // Japan
    [0x840000, 0x847FFF],   // JASDF
    // South Korea
    [0x718000, 0x71FFFF],   // ROKAF
    // UAE
    [0x896000, 0x896FFF],   // UAEAF
    // NATO AWACS / E-3
    [0x3C6540, 0x3C6540],   // Known NATO AWACS squawk
];

function isMilitaryIcao(hexStr) {
    if (!hexStr || hexStr.length < 6) return false;
    const val = parseInt(hexStr, 16);
    return MILITARY_ICAO_RANGES.some(([lo, hi]) => val >= lo && val <= hi);
}

// ─── Military callsign patterns ───────────────────────────────────────────────

const MILITARY_CALLSIGN_PREFIXES = [
    // US Air Force / Air Mobility Command
    "RCH", "REACH", "BOXER", "FORTE", "HAVOC", "DARK",
    "JAKE", "FURY", "VIPER", "DUKE", "BARON", "KNIFE",
    "DOOM", "EVIL", "DEATH", "GHOST", "SKULL", "REAPER",
    "DRACO", "PANTHER", "HAWK", "EAGLE", "COBRA", "RAPTOR",
    "SABRE", "LANCE", "SWORD", "DAGGER", "SPEAR", "ARROW",
    "MAGMA", "IRON", "STEEL", "ANVIL", "HAMMER",
    // US Navy
    "NAVY", "VMFA", "VFA", "NAVAIR",
    // NATO
    "NATO", "NAEW",
    // UK RAF
    "RRR", "ASCOT", "COMET", "TARTAN",
    // German
    "GAF",
    // French AF
    "COTAM", "FAF",
    // Various AWACS
    "AWACS", "SENTRY",
    // ISR
    "OSB", "SIGINT", "INTEL",
    // Tanker
    "TANKER",
];

const MILITARY_CALLSIGN_PATTERNS = [
    /^[A-Z]{2,4}\d{2}[A-Z0-9]?$/,   // NATO-style tactical (e.g. RCH123, JAKE21)
    /AWACS/i,
    /SENTRY/i,
    /RIVET/i,    // RC-135 Rivet Joint
    /COBRA\s?BALL/i,
    /DRAGON\s?LADY/i,   // U-2
    /GLOBAL\s?HAWK/i,
    /JSTAR/i,
    /POSEIDON/i,   // P-8
    /ORION/i,      // P-3
    /HERCULES/i,
];

function isMilitaryCallsign(callsign) {
    if (!callsign) return false;
    const cs = callsign.trim().toUpperCase();
    if (!cs || cs.length < 3) return false;

    if (MILITARY_CALLSIGN_PREFIXES.some(p => cs.startsWith(p))) return true;
    if (MILITARY_CALLSIGN_PATTERNS.some(r => r.test(cs))) return true;

    return false;
}

// ─── Aircraft type classification ─────────────────────────────────────────────

function classifyAircraft(callsign, icao) {
    const cs = (callsign || "").toUpperCase();

    if (/AWACS|SENTRY|NAEW/.test(cs)) return "awacs";
    if (/REACH|RCH|ASCOT|COTAM|BOXER|FORTE/.test(cs)) return "tanker";
    if (/RIVET|COBRA.?BALL|DRAGON.?LADY|GLOBAL.?HAWK|JSTAR|SIGINT|OSB/.test(cs)) return "recon";
    if (/POSEIDON|ORION|P.?8|P.?3/.test(cs)) return "patrol";
    if (/HERCULES|ATLAS|STRATEGIC|TRANSPORT/.test(cs)) return "transport";
    // USAF range with fighter-like callsigns
    const icaoInt = parseInt(icao || "0", 16);
    if (icaoInt >= 0xAE0000 && icaoInt <= 0xAEFFFF) return "fighter";

    return "military";
}

// ─── OpenSky API fetch ─────────────────────────────────────────────────────────

const OPENSKY_URL = "https://opensky-network.org/api/states/all";

// Optional: add credentials if you have an OpenSky account (higher rate limits)
// export OPENSKY_USER=youruser OPENSKY_PASS=yourpass in .env
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
//  0: icao24    1: callsign  2: origin_country  3: time_position
//  4: last_contact  5: longitude  6: latitude  7: baro_altitude
//  8: on_ground  9: velocity  10: true_track  11: vertical_rate
//  12: sensors  13: geo_altitude  14: squawk  15: spi  16: position_source

function parseState(state) {
    const icao = String(state[0] || "").toLowerCase();
    const callsign = String(state[1] || "").trim();
    const country = String(state[2] || "");
    const lon = state[5];
    const lat = state[6];
    const alt = state[7] ?? state[13];    // baro alt, fallback geo alt
    const onGround = state[8];
    const speed = state[9];    // m/s
    const heading = state[10];   // degrees
    const squawk = String(state[14] || "");

    return { icao, callsign, country, lon, lat, alt, onGround, speed, heading, squawk };
}

// ─── Deduplication ────────────────────────────────────────────────────────────
// Track which ICAO we've seen in the last N minutes to avoid inserting
// an event for the same aircraft every 5 minutes.

const SEEN_CACHE = new Map();   // icao → last seen timestamp
const SEEN_TTL_MS = 45 * 60 * 1000;  // 45 minutes

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

// ─── Supabase upsert ──────────────────────────────────────────────────────────

function buildAdsbEvent(aircraft) {
    const { icao, callsign, country, lon, lat, alt, speed, heading, squawk } = aircraft;
    const subcat = classifyAircraft(callsign, icao);
    const altFt = alt ? Math.round(alt * 3.28084) : null;
    const speedKt = speed ? Math.round(speed * 1.944) : null;

    const title = callsign
        ? `${subcat.toUpperCase()} ${callsign} — ${country}`
        : `Military Aircraft ${icao.toUpperCase()} — ${country}`;

    const summary = [
        callsign ? `Callsign: ${callsign}` : null,
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
        lat: lat,
        lon: lon,
        severity: "medium",
        confidence: "high",
        occurred_at: new Date().toISOString(),
        report_type: "signal",
        // Extra metadata stored as JSONB if your schema supports it
        metadata: {
            icao,
            callsign: callsign || null,
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

    // Upsert on source_key so same ICAO within TTL doesn't create duplicates
    const { error } = await supabase
        .from("events")
        .upsert(events, { onConflict: "source_key", ignoreDuplicates: false });

    if (error) {
        console.error("[adsb] Supabase upsert error:", error.message);
    } else {
        console.log(`[adsb] Upserted ${events.length} military aircraft events`);
    }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runAdsbWorker() {
    const label = "[adsb]";
    console.log(`${label} Starting ADS-B military scan…`);

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

        // Skip: on ground, no position, already seen recently
        if (a.onGround) continue;
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
        if (wasSeen(a.icao)) continue;

        // Military check (ICAO range OR callsign pattern)
        if (!isMilitaryIcao(a.icao) && !isMilitaryCallsign(a.callsign)) continue;

        military.push(a);
        markSeen(a.icao);
    }

    console.log(`${label} Detected ${military.length} military aircraft`);

    const toInsert = military.map(buildAdsbEvent);
    await upsertAdsbEvents(toInsert);
}