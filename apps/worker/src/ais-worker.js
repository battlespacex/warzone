// apps/worker/src/ais-worker.js
//
// Naval military vessel tracker — AISStream.io (free tier WebSocket API)
// Requires: AISSTREAM_API_KEY in .env (free at https://aisstream.io)
//
// Ship type 35 = Military vessel (IMO standard)
// Also catches known naval vessel names + MMSI ranges for military
//
// Runs as a time-boxed WebSocket session (60 seconds) every cron cycle.
// Collects naval contacts → deduplicates → inserts into Supabase.

import WebSocket from "ws";
import { supabase } from "./supabase.js";

// ─── Military MMSI ranges ─────────────────────────────────────────────────────
// Global coverage — all major naval powers. Ship type 35 is the primary filter;
// MMSI ranges catch vessels that don't broadcast type 35.
const MILITARY_MMSI_RANGES = [
    [0, 9999999],            // 00xxxxxxx = group/military special
    [970000000, 979999999],  // NATO exercise callsigns
    // Americas
    [338000000, 338999999], [316000000, 316999999], [725000000, 725999999],
    [701000000, 701999999], [720000000, 720999999],
    // Europe
    [232000000, 235999999], [226000000, 227999999], [211000000, 218999999],
    [247000000, 247999999], [224000000, 225999999], [244000000, 245999999],
    [265000000, 266999999], [257000000, 259999999], [219000000, 219999999],
    [240000000, 241999999], [271000000, 271999999], [278000000, 278999999],
    [230000000, 230999999], [248000000, 248999999], [261000000, 261999999],
    // Russia
    [273000000, 273999999],
    // Middle East
    [422000000, 422999999], [428000000, 428999999], [447000000, 447999999],
    [453000000, 453999999], [466000000, 466999999],
    // Asia Pacific
    [412000000, 412999999], [431000000, 432999999], [440000000, 441999999],
    [419000000, 419999999], [463000000, 463999999], [503000000, 503999999],
    [525000000, 525999999], [533000000, 533999999], [567000000, 567999999],
    [574000000, 574999999], [576000000, 576999999], [445000000, 445999999],
    [548000000, 548999999], [512000000, 512999999],
    // Africa / Other
    [620000000, 620999999], [672000000, 672999999], [654000000, 654999999],
];

// Global bounding boxes — full world coverage in 2 halves
const MONITORING_BOXES = [
    [-180, -90, 0, 90],   // Western hemisphere
    [0, -90, 180, 90],    // Eastern hemisphere
];
function isMilitaryMmsi(mmsi) {
    if (!mmsi) return false;
    const n = parseInt(mmsi, 10);
    if (!Number.isFinite(n)) return false;
    return MILITARY_MMSI_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

// ─── Naval vessel name patterns ───────────────────────────────────────────────

const NAVAL_NAME_PATTERNS = [
    /\bUSS\b/i,      // US Navy
    /\bHMS\b/i,      // Royal Navy
    /\bRFS\b/i,      // Russian Federation Ship
    /\bRFN\b/i,
    /\bBNS\b/i,
    /\bINS\b/i,      // Indian Navy Ship
    /\bPNS\b/i,      // Pakistan Navy Ship
    /\bCNS\b/i,      // Chinese Navy Ship
    /\bFFG[-\s]?\d/i,   // Frigate designation
    /\bDDG[-\s]?\d/i,   // Destroyer
    /\bSSN[-\s]?\d/i,   // Nuclear sub
    /\bCVN[-\s]?\d/i,   // Carrier
    /\bLHD[-\s]?\d/i,   // Amphibious assault
    /CARRIER/i,
    /DESTROYER/i,
    /FRIGATE/i,
    /CORVETTE/i,
    /CRUISER/i,
    /SUBMARINE/i,
    /PATROL\s?VESSEL/i,
    /MINESWEEPER/i,
    /REPLENISHMENT/i,
];

function isMilitaryVesselName(name) {
    if (!name) return false;
    return NAVAL_NAME_PATTERNS.some(r => r.test(name));
}

// ─── Ship type 35 = military ──────────────────────────────────────────────────
// AIS ship types: https://www.itu.int/rec/R-REC-M.1371/en
// 35 = Military ops. We also include 50-59 (special craft) when MMSI matches.

function isMilitaryShipType(shipType) {
    const t = Number(shipType);
    return t === 35 || (t >= 50 && t <= 57);  // 50-57 = special craft, pilot vessels etc
}

// ─── Vessel type classification ───────────────────────────────────────────────

function classifyVessel(name, shipType) {
    const n = (name || "").toUpperCase();
    if (/CVN|CARRIER|LHD|LHA/.test(n)) return "carrier";
    if (/DDG|DESTROYER/.test(n)) return "destroyer";
    if (/FFG|CG|CRUISER|FRIGATE/.test(n)) return "frigate";
    if (/SSN|SUBMARINE|SUB/.test(n)) return "submarine";
    if (/REPLENISHMENT|SUPPLY|AOR|AOE/.test(n)) return "logistics";
    if (/PATROL|PC|PG/.test(n)) return "patrol";
    if (/MINE|MCM/.test(n)) return "minesweeper";
    return "naval";
}

// ─── Seen cache ───────────────────────────────────────────────────────────────

const SEEN_CACHE = new Map();
const SEEN_TTL_MS = 60 * 60 * 1000;  // 1 hour for naval (slower moving)

function pruneSeen() {
    const cutoff = Date.now() - SEEN_TTL_MS;
    for (const [k, v] of SEEN_CACHE) {
        if (v < cutoff) SEEN_CACHE.delete(k);
    }
}

function wasSeen(mmsi) {
    const t = SEEN_CACHE.get(mmsi);
    return t && (Date.now() - t) < SEEN_TTL_MS;
}

function markSeen(mmsi) {
    SEEN_CACHE.set(mmsi, Date.now());
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

function buildNavalEvent(vessel) {
    const { mmsi, name, shipType, lat, lon, speed, heading, country } = vessel;
    const subcat = classifyVessel(name, shipType);
    const speedKt = speed ? speed.toFixed(1) : null;

    const displayName = name
        ? `${subcat.toUpperCase()} ${name}`
        : `Military Vessel MMSI:${mmsi}`;

    const title = country
        ? `${displayName} — ${country}`
        : displayName;

    const summary = [
        name ? `Vessel: ${name}` : null,
        speedKt ? `Speed: ${speedKt} kt` : null,
        heading != null ? `Heading: ${Math.round(heading)}°` : null,
        country ? `Flag: ${country}` : null,
        `MMSI: ${mmsi}`,
    ].filter(Boolean).join(" · ");

    return {
        // dedupe_key is the unique conflict field used by the events table
        dedupe_key: `ais-${mmsi}`,
        source_key: `ais-${mmsi}`,
        source_name: "AIS / AISStream.io",
        category: "military",
        subcategory: subcat,
        title,
        summary,
        lat,
        lon,
        severity: "medium",   // TEXT — valid value
        confidence: 75,          // INTEGER — was "high" (string) which caused the upsert error
        occurred_at: new Date().toISOString(),
        report_type: "signal",
        metadata: {
            mmsi,
            vessel_name: name || null,
            ship_type: shipType || null,
            vessel_class: subcat,
            speed_kts: speedKt ? parseFloat(speedKt) : null,
            heading: heading != null ? Math.round(heading) : null,
            country: country || null,
        },
    };
}

async function upsertNavalEvents(events) {
    if (!events.length) return;

    // onConflict: "dedupe_key" — this is the unique column on the events table.
    // "source_key" has no unique constraint so the old upsert was silently failing.
    const { error } = await supabase
        .from("events")
        .upsert(events, { onConflict: "dedupe_key", ignoreDuplicates: false });

    if (error) {
        console.error("[ais] Supabase upsert error:", error.message);
    } else {
        console.log(`[ais] Upserted ${events.length} naval vessel events`);
    }
}

// ─── AISStream WebSocket session ──────────────────────────────────────────────
// Opens a WebSocket, collects for SESSION_DURATION_MS, then closes.

const SESSION_DURATION_MS = 60 * 1000;   // 60 seconds per cron cycle
const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";

// Bounding boxes to monitor. Covers key naval operational zones.
// Add / remove as needed. Each box: [minLon, minLat, maxLon, maxLat]


export async function runAisWorker() {
    const label = "[ais]";
    const apiKey = process.env.AISSTREAM_API_KEY;

    if (!apiKey) {
        console.warn(`${label} AISSTREAM_API_KEY not set — skipping AIS worker`);
        console.warn(`${label} Get a free key at https://aisstream.io`);
        return;
    }

    pruneSeen();

    const collected = new Map();   // mmsi → vessel object

    return new Promise((resolve) => {
        const ws = new WebSocket(AISSTREAM_URL);
        let settled = false;

        const finish = async () => {
            if (settled) return;
            settled = true;
            ws.close();

            const military = [...collected.values()];
            console.log(`${label} Collected ${military.length} military vessels`);

            const toInsert = military.map(buildNavalEvent);
            await upsertNavalEvents(toInsert);
            resolve();
        };

        const timeout = setTimeout(finish, SESSION_DURATION_MS);

        ws.on("open", () => {
            console.log(`${label} Connected to AISStream`);

            const subscription = {
                APIKey: apiKey,
                BoundingBoxes: MONITORING_BOXES,
                FilterMessageTypes: ["PositionReport", "ShipStaticData"],
            };

            ws.send(JSON.stringify(subscription));
        });

        ws.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const mtype = msg.MessageType;
                const meta = msg.MetaData || {};
                const mmsi = String(meta.MMSI || "");

                if (!mmsi || wasSeen(mmsi)) return;

                // Extract position from PositionReport
                if (mtype === "PositionReport") {
                    const pos = msg.Message?.PositionReport;
                    if (!pos) return;

                    const lat = pos.Latitude;
                    const lon = pos.Longitude;
                    const speed = pos.Sog;    // speed over ground in knots
                    const heading = pos.TrueHeading ?? pos.Cog;
                    const shipType = pos.ShipType ?? meta.ShipType;

                    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

                    const name = meta.ShipName || "";
                    const country = meta.ShipName ? "" : "";   // not in PositionReport

                    const isMil =
                        isMilitaryShipType(shipType) ||
                        isMilitaryMmsi(mmsi) ||
                        isMilitaryVesselName(name);

                    if (!isMil) return;

                    // Merge with existing entry if ShipStaticData arrived first
                    const existing = collected.get(mmsi) || {};
                    collected.set(mmsi, {
                        ...existing,
                        mmsi, lat, lon, speed, heading,
                        name: name || existing.name || "",
                        shipType: shipType ?? existing.shipType,
                        country: existing.country || "",
                    });
                    markSeen(mmsi);
                }

                // Enrich with ShipStaticData (name, country, ship type)
                if (mtype === "ShipStaticData") {
                    const info = msg.Message?.ShipStaticData;
                    if (!info) return;

                    const name = info.Name?.trim() || meta.ShipName?.trim() || "";
                    const country = info.Country || "";
                    const shipType = info.Type ?? meta.ShipType;

                    const isMil =
                        isMilitaryShipType(shipType) ||
                        isMilitaryMmsi(mmsi) ||
                        isMilitaryVesselName(name);

                    if (!isMil) return;

                    const existing = collected.get(mmsi) || {};
                    if (existing.lat == null) return;   // no position yet, skip

                    collected.set(mmsi, {
                        ...existing,
                        mmsi,
                        name: name || existing.name || "",
                        shipType: shipType ?? existing.shipType,
                        country: country || existing.country || "",
                    });
                    markSeen(mmsi);
                }

            } catch (err) {
                console.error(`${label} Message parse error:`, err.message);
            }
        });

        ws.on("error", (err) => {
            console.error(`${label} WebSocket error:`, err.message);
            clearTimeout(timeout);
            finish();
        });

        ws.on("close", () => {
            clearTimeout(timeout);
            finish();
        });
    });
}