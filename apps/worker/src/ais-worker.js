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
// Format: [start, end]
// MMSI: 9-digit number. Country code = first 3 digits (MID).
// Military vessels often use MMSI starting with 00 (no country = mil/special)

const MILITARY_MMSI_RANGES = [
    // IMO maritime mobile service identities starting with 00 = ship groups / mil
    [0, 9999999],   // 00xxxxxxx = group call / military (common pattern)
    // US Navy (MID 338)
    [338000000, 338999999],
    // Russian Navy (MID 273)
    [273000000, 273999999],
    // Chinese PLAN (MID 412)
    [412000000, 412999999],
    // UK Royal Navy (MID 232, 233, 234, 235)
    [232000000, 235999999],
    // French Marine Nationale (MID 226, 227)
    [226000000, 227999999],
    // NATO / exercise callsigns
    [970000000, 979999999],
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
        source_key: `ais-${mmsi}`,
        source_name: "AIS / AISStream.io",
        category: "military",
        subcategory: subcat,
        title,
        summary,
        lat,
        lon,
        severity: "medium",
        confidence: "high",
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

    const { error } = await supabase
        .from("events")
        .upsert(events, { onConflict: "source_key", ignoreDuplicates: false });

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
const MONITORING_BOXES = [
    // Mediterranean Sea
    [-6, 30, 36, 46],
    // Red Sea + Gulf of Aden
    [32, 11, 52, 30],
    // Persian Gulf
    [48, 22, 60, 30],
    // Black Sea
    [28, 40, 42, 47],
    // South China Sea
    [100, 0, 122, 24],
    // East China Sea + Korean Strait
    [118, 24, 135, 40],
    // North Atlantic (GIUK gap)
    [-40, 55, 10, 75],
    // Western Pacific
    [125, 5, 160, 40],
    // Arabian Sea
    [55, 5, 75, 28],
    // Baltic Sea
    [10, 53, 32, 66],
];

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