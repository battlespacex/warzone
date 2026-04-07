// apps/worker/src/ais-worker.js
//
// Naval military vessel tracker — AISStream.io (free tier WebSocket API)
// Requires: AISSTREAM_API_KEY in .env (free at https://aisstream.io)
//
// Ship type 35 = Military vessel (IMO standard)
// Name / hull-prefix matching is kept intentionally strict to avoid civilian traffic.
//
// Runs as a time-boxed WebSocket session (60 seconds) every cron cycle.
// Collects naval contacts → deduplicates → inserts into Supabase.

import WebSocket from "ws";
import { supabase } from "./supabase.js";

// AISStream expects each bounding box as [[minLat, minLon], [maxLat, maxLon]].
const MONITORING_BOXES = [
    [[-90, -180], [90, 180]],
];

// ─── Naval vessel name patterns ───────────────────────────────────────────────

const NAVAL_NAME_PATTERNS = [
    /\bUSS\b/i,      // US Navy
    /\bUSNS\b/i,     // US Navy auxiliary / Military Sealift Command
    /\bHMS\b/i,      // Royal Navy
    /\bRFA\b/i,      // Royal Fleet Auxiliary
    /\bRFS\b/i,      // Russian Federation Ship
    /\bRFN\b/i,
    /\bBNS\b/i,
    /\bINS\b/i,      // Indian Navy Ship
    /\bPNS\b/i,      // Pakistan Navy Ship
    /\bCNS\b/i,      // Chinese Navy Ship
    /\bTCG\b/i,      // Turkish Navy
    /\bJS\s+[A-Z0-9]/i, // Japan Maritime Self-Defense Force
    /\bFFG[-\s]?\d+\b/i,
    /\bDDG[-\s]?\d+\b/i,
    /\bSSN[-\s]?\d+\b/i,
    /\bSSBN[-\s]?\d+\b/i,
    /\bCVN[-\s]?\d+\b/i,
    /\bLHD[-\s]?\d+\b/i,
    /\bLHA[-\s]?\d+\b/i,
    /\bLPD[-\s]?\d+\b/i,
    /\bAOR[-\s]?\d+\b/i,
    /\bAOE[-\s]?\d+\b/i,
    /\bT-AO[-\s]?\d+\b/i,
    /\bT-AKE[-\s]?\d+\b/i,
    /CARRIER/i,
    /DESTROYER/i,
    /FRIGATE/i,
    /CORVETTE/i,
    /CRUISER/i,
    /SUBMARINE/i,
    /AMPHIBIOUS ASSAULT/i,
    /MINE COUNTERMEASURE/i,
    /MINESWEEPER/i,
    /REPLENISHMENT/i,
    /FLEET OILER/i,
    /COMBAT SUPPORT SHIP/i,
];

function normalizeString(value) {
    return String(value || "").trim();
}

function isMilitaryVesselName(name, callSign = "") {
    const haystacks = [normalizeString(name), normalizeString(callSign)].filter(Boolean);
    return haystacks.some((value) => NAVAL_NAME_PATTERNS.some((pattern) => pattern.test(value)));
}

// ─── Ship type 35 = military ──────────────────────────────────────────────────
// AIS ship types: 35 = Military ops.
// Keep this strict so we do not ingest civilian pilot boats, service craft, or cargo.

function isMilitaryShipType(shipType) {
    const t = Number(shipType);
    return t === 35;
}

// ─── Vessel type classification ───────────────────────────────────────────────

function classifyVessel(name, shipType) {
    const n = (name || "").toUpperCase();
    if (/CVN|CARRIER|LHD|LHA/.test(n)) return "carrier";
    if (/DDG|DESTROYER/.test(n)) return "destroyer";
    if (/FFG|CG|CRUISER|FRIGATE/.test(n)) return "frigate";
    if (/SSN|SUBMARINE|SUB/.test(n)) return "submarine";
    if (/REPLENISHMENT|AOR|AOE|T-AO|T-AKE|FLEET OILER|COMBAT SUPPORT/.test(n)) return "logistics";
    if (/PATROL|OPV|PC|PG/.test(n)) return "patrol";
    if (/MINE|MCM|MINESWEEPER/.test(n)) return "minesweeper";
    if (Number(shipType) === 35) return "naval";
    return "naval";
}

function getMessageMeta(msg) {
    return msg.MetaData || msg.Metadata || {};
}

function getMessageMmsi(msg, meta) {
    return String(
        meta.MMSI ||
        msg.Message?.PositionReport?.UserID ||
        msg.Message?.ShipStaticData?.UserID ||
        ""
    );
}

function readStaticFields(info, meta) {
    const reportA = info?.ReportA || {};
    const reportB = info?.ReportB || {};

    return {
        name: normalizeString(
            info?.Name ||
            reportA?.Name ||
            meta.ShipName
        ),
        country: normalizeString(info?.Country || meta.Country),
        shipType: info?.Type ?? reportB?.ShipType ?? meta.ShipType ?? null,
        callSign: normalizeString(info?.CallSign || reportB?.CallSign || meta.CallSign),
        imoNumber: info?.ImoNumber ?? reportB?.ImoNumber ?? null,
    };
}

function readPositionFields(pos, meta) {
    return {
        lat: pos?.Latitude,
        lon: pos?.Longitude,
        speed: pos?.Sog,
        heading: pos?.TrueHeading ?? pos?.Cog,
        shipType: pos?.ShipType ?? meta.ShipType ?? null,
        name: normalizeString(meta.ShipName),
    };
}

function isStrictMilitaryNavalContact(vessel) {
    return (
        isMilitaryShipType(vessel.shipType) ||
        isMilitaryVesselName(vessel.name, vessel.callSign)
    );
}

function mergeVesselState(position = {}, staticInfo = {}, previous = {}) {
    return {
        ...previous,
        ...position,
        ...staticInfo,
        name: staticInfo.name || position.name || previous.name || "",
        shipType: staticInfo.shipType ?? position.shipType ?? previous.shipType ?? null,
        country: staticInfo.country || previous.country || "",
        callSign: staticInfo.callSign || previous.callSign || "",
        imoNumber: staticInfo.imoNumber ?? previous.imoNumber ?? null,
    };
}

// ─── Supabase upsert ──────────────────────────────────────────────────────────

function buildNavalEvent(vessel) {
    const { mmsi, name, shipType, lat, lon, speed, heading, country, callSign, imoNumber } = vessel;
    const subcat = classifyVessel(name, shipType);
    const speedKt = Number.isFinite(speed) ? speed.toFixed(1) : null;

    const vesselLabel = name || callSign || `Military Vessel MMSI:${mmsi}`;
    const displayName = `${subcat.toUpperCase()} ${vesselLabel}`;

    const title = country
        ? `${displayName} — ${country}`
        : displayName;

    const summary = [
        name ? `Vessel: ${name}` : null,
        speedKt ? `Speed: ${speedKt} kt` : null,
        heading != null ? `Heading: ${Math.round(heading)}°` : null,
        country ? `Flag: ${country}` : null,
        callSign ? `Call Sign: ${callSign}` : null,
        imoNumber ? `IMO: ${imoNumber}` : null,
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
            call_sign: callSign || null,
            imo_number: imoNumber || null,
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

// Bounding boxes to monitor. Each box is [[minLat, minLon], [maxLat, maxLon]].


export async function runAisWorker() {
    const label = "[ais]";
    const apiKey = process.env.AISSTREAM_API_KEY;

    if (!apiKey) {
        console.warn(`${label} AISSTREAM_API_KEY not set — skipping AIS worker`);
        console.warn(`${label} Get a free key at https://aisstream.io`);
        return;
    }

    const positionsByMmsi = new Map();
    const staticByMmsi = new Map();
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
                if (msg?.error) {
                    console.error(`${label} Subscription error:`, msg.error);
                    return;
                }

                const mtype = msg.MessageType;
                const meta = getMessageMeta(msg);
                const mmsi = getMessageMmsi(msg, meta);

                if (!mmsi) return;

                // Extract position from PositionReport
                if (mtype === "PositionReport") {
                    const pos = msg.Message?.PositionReport;
                    if (!pos) return;

                    const position = readPositionFields(pos, meta);
                    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return;

                    positionsByMmsi.set(mmsi, {
                        ...(positionsByMmsi.get(mmsi) || {}),
                        ...position,
                    });

                    const merged = mergeVesselState(
                        positionsByMmsi.get(mmsi),
                        staticByMmsi.get(mmsi),
                        collected.get(mmsi)
                    );

                    if (!isStrictMilitaryNavalContact(merged)) return;

                    collected.set(mmsi, {
                        ...merged,
                        mmsi,
                    });
                }

                // Enrich with ShipStaticData (name, country, ship type)
                if (mtype === "ShipStaticData") {
                    const info = msg.Message?.ShipStaticData;
                    if (!info) return;

                    staticByMmsi.set(mmsi, {
                        ...(staticByMmsi.get(mmsi) || {}),
                        ...readStaticFields(info, meta),
                    });

                    const merged = mergeVesselState(
                        positionsByMmsi.get(mmsi),
                        staticByMmsi.get(mmsi),
                        collected.get(mmsi)
                    );

                    if (!Number.isFinite(merged.lat) || !Number.isFinite(merged.lon)) return;
                    if (!isStrictMilitaryNavalContact(merged)) return;

                    collected.set(mmsi, {
                        ...merged,
                        mmsi,
                    });
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
