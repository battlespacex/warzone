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
    /\bUSS\b/i,
    /\bUSNS\b/i,
    /\bHMS\b/i,
    /\bRFA\b/i,
    /\bHMAS\b/i,
    /\bHMCS\b/i,
    /\bHMNZS\b/i,
    /\bHNLMS\b/i,
    /\bORP\b/i,
    /\bNRP\b/i,
    /\bBRP\b/i,
    /\bBAP\b/i,
    /\bARA\b/i,
    /\bROKS\b/i,
    /\bKRI\b/i,
    /\bKDB\b/i,
    /\bINS\b/i,
    /\bPNS\b/i,
    /\bTCG\b/i,
    /\bJDS\b/i,
    /\bJS\s+[A-Z0-9]/i,
    /\bFGS\b/i,
    /\bIRIS\b/i,
    /\bRFS\b/i,
    /\bSLNS\b/i,
    /\bRBNS\b/i,
    /\bHSWMS\b/i,
    /\bITS\b/i,
    /\bSPS\b/i,
    /\bBNS\b/i,
    /\bFFG[-\s]?\d+\b/i,
    /\bDDG[-\s]?\d+\b/i,
    /\bCG[-\s]?\d+\b/i,
    /\bSSN[-\s]?\d+\b/i,
    /\bSSBN[-\s]?\d+\b/i,
    /\bSSK[-\s]?\d+\b/i,
    /\bCVN[-\s]?\d+\b/i,
    /\bCV[-\s]?\d+\b/i,
    /\bLHD[-\s]?\d+\b/i,
    /\bLHA[-\s]?\d+\b/i,
    /\bLPD[-\s]?\d+\b/i,
    /\bLPH[-\s]?\d+\b/i,
    /\bLSD[-\s]?\d+\b/i,
    /\bLST[-\s]?\d+\b/i,
    /\bAOR[-\s]?\d+\b/i,
    /\bAOE[-\s]?\d+\b/i,
    /\bT-AO[-\s]?\d+\b/i,
    /\bT-AKE[-\s]?\d+\b/i,
    /\bT-AKR[-\s]?\d+\b/i,
    /\bUS NAVY\b/i,
    /\bMILITARY SEALIFT COMMAND\b/i,
    /\bROYAL NAVY\b/i,
    /\bROYAL AUSTRALIAN NAVY\b/i,
    /\bROYAL CANADIAN NAVY\b/i,
    /\bROYAL NEW ZEALAND NAVY\b/i,
    /\bROYAL NETHERLANDS NAVY\b/i,
    /\bDUTCH NAVY\b/i,
    /\bGERMAN NAVY\b/i,
    /\bFRENCH NAVY\b/i,
    /\bITALIAN NAVY\b/i,
    /\bSPANISH NAVY\b/i,
    /\bPORTUGUESE NAVY\b/i,
    /\bPOLISH NAVY\b/i,
    /\bINDIAN NAVY\b/i,
    /\bPAKISTAN NAVY\b/i,
    /\bJMSDF\b/i,
    /\bJAPAN MARITIME SELF[- ]DEFENSE FORCE\b/i,
    /\bREPUBLIC OF KOREA NAVY\b/i,
    /\bROK NAVY\b/i,
    /\bPLA NAVY\b/i,
    /\bPLAN\b/i,
    /\bTURKISH NAVY\b/i,
    /\bRUSSIAN NAVY\b/i,
    /\bIRIN\b/i,
    /\bIRGCN\b/i,
    /\bSINGAPORE NAVY\b/i,
    /\bRSN\b/i,
    /\bROYAL SAUDI NAVAL FORCES\b/i,
    /\bEGYPTIAN NAVY\b/i,
    /\bBRAZILIAN NAVY\b/i,
    /\bARGENTINE NAVY\b/i,
    /\bPERUVIAN NAVY\b/i,
    /\bPHILIPPINE NAVY\b/i,
    /\bBANGLADESH NAVY\b/i,
    /\bBELGIAN NAVY\b/i,
    /\bROYAL BRUNEI NAVY\b/i,
    /\bINDONESIAN NAVY\b/i,
    /\bUKRAINIAN NAVY\b/i,
    /\bGUIDED MISSILE DESTROYER\b/i,
    /\bDESTROYER\b/i,
    /\bGUIDED MISSILE CRUISER\b/i,
    /\bFRIGATE\b/i,
    /\bCORVETTE\b/i,
    /\bSUBMARINE\b/i,
    /\bAIRCRAFT CARRIER\b/i,
    /\bHELICOPTER CARRIER\b/i,
    /\bLIGHT CARRIER\b/i,
    /\bAMPHIBIOUS ASSAULT\b/i,
    /\bLANDING HELICOPTER DOCK\b/i,
    /\bLANDING PLATFORM DOCK\b/i,
    /\bAMPHIBIOUS TRANSPORT DOCK\b/i,
    /\bMINE COUNTERMEASURE\b/i,
    /\bMINEHUNTER\b/i,
    /\bMINESWEEPER\b/i,
    /\bREPLENISHMENT\b/i,
    /\bFLEET OILER\b/i,
    /\bCOMBAT SUPPORT SHIP\b/i,
    /\bOFFSHORE PATROL VESSEL\b/i,
    /\bMISSILE BOAT\b/i,
    /\bFAST ATTACK CRAFT\b/i,
];
const CIVILIAN_VESSEL_PATTERNS = [
    /\bMV\b/i,
    /\bM\/V\b/i,
    /\bMT\b/i,
    /\bFV\b/i,
    /\bSV\b/i,
    /\bMY\b/i,
    /\bRV\b/i,
    /\bGENERAL CARGO\b/i,
    /\bBULK CARRIER\b/i,
    /\bCAR CARRIER\b/i,
    /\bVEHICLE CARRIER\b/i,
    /\bCONTAINER\b/i,
    /\bCONTAINER SHIP\b/i,
    /\bTANKER\b/i,
    /\bCHEMICAL TANKER\b/i,
    /\bCRUDE OIL\b/i,
    /\bLNG\b/i,
    /\bLPG\b/i,
    /\bCARGO\b/i,
    /\bFERRY\b/i,
    /\bCRUISE\b/i,
    /\bPASSENGER\b/i,
    /\bYACHT\b/i,
    /\bDREDGER\b/i,
    /\bTUG\b/i,
    /\bTRAWLER\b/i,
    /\bFREIGHTER\b/i,
    /\bFEEDER\b/i,
    /\bCOASTER\b/i,
    /\bLIVESTOCK\b/i,
    /\bREEFER\b/i,
    /\bHOPPER\b/i,
    /\bRO-RO\b/i,
    /\bROLL ON ROLL OFF\b/i,
    /\bSUPPLY VESSEL\b/i,
    /\bOFFSHORE SUPPORT\b/i,
    /\bPLATFORM SUPPLY\b/i,
    /\bANCHOR HANDLING\b/i,
    /\bWORKBOAT\b/i,
    /\bRESEARCH VESSEL\b/i,
    /\bSURVEY VESSEL\b/i,
    /\bCABLE LAYER\b/i,
    /\bPILOT\b/i,
];
const NAVAL_CLASS_PATTERNS = {
    carrier: /\bCVN[-\s]?\d+\b|\bCV[-\s]?\d+\b|AIRCRAFT CARRIER|HELICOPTER CARRIER|LIGHT CARRIER/i,
    destroyer: /\bDDG[-\s]?\d+\b|DESTROYER|GUIDED MISSILE DESTROYER/i,
    frigate: /\bFFG[-\s]?\d+\b|FRIGATE/i,
    corvette: /CORVETTE/i,
    cruiser: /\bCG[-\s]?\d+\b|CRUISER|GUIDED MISSILE CRUISER/i,
    submarine: /\bSSN[-\s]?\d+\b|\bSSBN[-\s]?\d+\b|\bSSK[-\s]?\d+\b|SUBMARINE/i,
    logistics: /\bAOR[-\s]?\d+\b|\bAOE[-\s]?\d+\b|\bT-AO[-\s]?\d+\b|\bT-AKE[-\s]?\d+\b|\bT-AKR[-\s]?\d+\b|REPLENISHMENT|FLEET OILER|COMBAT SUPPORT|SUPPLY SHIP/i,
    patrol: /PATROL|OFFSHORE PATROL VESSEL|\bOPV\b|FAST ATTACK|FAST ATTACK CRAFT|MISSILE BOAT|GUNBOAT/i,
    minesweeper: /MINE COUNTERMEASURE|MINEHUNTER|MINESWEEPER|\bMCM\b|\bMHC\b/i,
    amphibious: /\bLHD[-\s]?\d+\b|\bLHA[-\s]?\d+\b|\bLPD[-\s]?\d+\b|\bLPH[-\s]?\d+\b|\bLSD[-\s]?\d+\b|\bLST[-\s]?\d+\b|AMPHIBIOUS ASSAULT|LANDING HELICOPTER DOCK|LANDING PLATFORM DOCK|AMPHIBIOUS TRANSPORT DOCK|LANDING SHIP/i,
};

function normalizeString(value) {
    return String(value || "").trim();
}

function matchesPatternList(patterns, values) {
    return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function isCivilianVesselName(name, callSign = "") {
    const haystacks = [normalizeString(name), normalizeString(callSign)].filter(Boolean);
    return matchesPatternList(CIVILIAN_VESSEL_PATTERNS, haystacks);
}

function isMilitaryVesselName(name, callSign = "") {
    const haystacks = [normalizeString(name), normalizeString(callSign)].filter(Boolean);
    return matchesPatternList(NAVAL_NAME_PATTERNS, haystacks);
}

// ─── Ship type 35 = military ──────────────────────────────────────────────────
// AIS ship types: 35 = Military ops.
// Keep this strict so we do not ingest civilian pilot boats, service craft, or cargo.

function isMilitaryShipType(shipType) {
    const t = Number(shipType);
    return t === 35;
}

// ─── Vessel type classification ───────────────────────────────────────────────

function classifyVessel(name, shipType, callSign = "") {
    const n = (name || "").toUpperCase();
    const c = (callSign || "").toUpperCase();
    const haystack = `${n} ${c}`.trim();
    if (NAVAL_CLASS_PATTERNS.carrier.test(haystack)) return "carrier";
    if (NAVAL_CLASS_PATTERNS.destroyer.test(haystack)) return "destroyer";
    if (NAVAL_CLASS_PATTERNS.cruiser.test(haystack)) return "destroyer";
    if (NAVAL_CLASS_PATTERNS.frigate.test(haystack)) return "frigate";
    if (NAVAL_CLASS_PATTERNS.corvette.test(haystack)) return "corvette";
    if (NAVAL_CLASS_PATTERNS.submarine.test(haystack)) return "submarine";
    if (NAVAL_CLASS_PATTERNS.logistics.test(haystack)) return "logistics";
    if (NAVAL_CLASS_PATTERNS.patrol.test(haystack)) return "patrol";
    if (NAVAL_CLASS_PATTERNS.minesweeper.test(haystack)) return "minesweeper";
    if (NAVAL_CLASS_PATTERNS.amphibious.test(haystack)) return "naval";
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
    const hasCivilianIdentity = isCivilianVesselName(vessel.name, vessel.callSign);
    const hasMilitaryIdentity = isMilitaryVesselName(vessel.name, vessel.callSign);
    if (hasCivilianIdentity && !hasMilitaryIdentity) {
        return false;
    }
    if (hasMilitaryIdentity) return true;
    return isMilitaryShipType(vessel.shipType) && !hasCivilianIdentity;
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
    const subcat = classifyVessel(name, shipType, callSign);
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

function isAisCertificateExpiryError(err) {
    const message = String(err?.message || err || "").toLowerCase();
    return message.includes("certificate has expired");
}

function createAisWebSocket({ allowInsecureTls = false } = {}) {
    return allowInsecureTls
        ? new WebSocket(AISSTREAM_URL, { rejectUnauthorized: false })
        : new WebSocket(AISSTREAM_URL);
}


export async function runAisWorker() {
    const label = "[ais]";
    const apiKey = process.env.AISSTREAM_API_KEY;
    const allowInsecureTlsFallback = String(process.env.AISSTREAM_ALLOW_INSECURE_TLS_FALLBACK || "1") !== "0";

    if (!apiKey) {
        console.warn(`${label} AISSTREAM_API_KEY not set — skipping AIS worker`);
        console.warn(`${label} Get a free key at https://aisstream.io`);
        return;
    }

    const positionsByMmsi = new Map();
    const staticByMmsi = new Map();
    const collected = new Map();   // mmsi → vessel object

    return new Promise((resolve) => {
        let settled = false;
        let timeout = null;
        let ws = null;
        let retriedWithInsecureTls = false;

        const finish = async () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (ws) {
                try {
                    ws.close();
                } catch {
                    // ignore socket shutdown errors on finish
                }
            }

            const military = [...collected.values()];
            console.log(`${label} Collected ${military.length} military vessels`);

            const toInsert = military.map(buildNavalEvent);
            await upsertNavalEvents(toInsert);
            resolve();
        };

        const bindSocket = (socket, allowInsecureTls = false) => {
            ws = socket;
            clearTimeout(timeout);
            timeout = setTimeout(finish, SESSION_DURATION_MS);

            socket.on("open", () => {
                if (socket !== ws || settled) return;
                console.log(
                    allowInsecureTls
                        ? `${label} Connected to AISStream (TLS verification disabled fallback)`
                        : `${label} Connected to AISStream`
                );

                const subscription = {
                    APIKey: apiKey,
                    BoundingBoxes: MONITORING_BOXES,
                    FilterMessageTypes: ["PositionReport", "ShipStaticData"],
                };

                socket.send(JSON.stringify(subscription));
            });

            socket.on("message", (raw) => {
                if (socket !== ws || settled) return;
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

            socket.on("error", (err) => {
                if (socket !== ws || settled) return;
                if (
                    allowInsecureTlsFallback &&
                    !allowInsecureTls &&
                    !retriedWithInsecureTls &&
                    isAisCertificateExpiryError(err)
                ) {
                    retriedWithInsecureTls = true;
                    console.warn(`${label} AISStream certificate expired; retrying with TLS verification disabled`);
                    clearTimeout(timeout);
                    try {
                        socket.terminate?.();
                    } catch {
                        // ignore termination errors during retry
                    }
                    bindSocket(createAisWebSocket({ allowInsecureTls: true }), true);
                    return;
                }
                console.error(`${label} WebSocket error:`, err.message);
                clearTimeout(timeout);
                finish();
            });

            socket.on("close", () => {
                if (socket !== ws || settled) return;
                clearTimeout(timeout);
                finish();
            });
        };

        bindSocket(createAisWebSocket(), false);
    });
}
