// apps/worker/src/ais-worker.js
//
// Multi-source military AIS tracker. Provider adapters normalize observations;
// this file retains StratOps naval qualification and Supabase contracts.
//
// Ship type 35 = Military vessel (IMO standard)
// Name / hull-prefix matching is kept intentionally strict to avoid civilian traffic.
//
import { supabase } from "./supabase.js";
import { mergeNavalObservations } from "./tracking/merge.js";
import { runConfiguredProviders } from "./tracking/provider-health.js";
import { createNavalProviders } from "./tracking/naval/registry.js";

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
// AIS may publish historic hull identifiers or museum/retired contacts. Keep
// these out of the operational layer even when they resemble a military hull.
const NON_OPERATIONAL_NAVAL_PATTERNS = [
    /\bCV[-\s]?0?9\b/i, // USS Essex (CV-9), decommissioned in 1969.
    /\b(?:DECOMMISSIONED|RETIRED|MUSEUM(?:\s+SHIP)?|PRESERVED|SCRAPPED|STRICKEN|DISPOSED)\b/i,
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

function isKnownNonOperationalNavalContact(vessel = {}) {
    const identity = [
        vessel.name,
        vessel.callSign,
        vessel.status,
        vessel.operationalStatus,
        vessel.operational_status,
        vessel.serviceStatus,
        vessel.service_status,
    ]
        .map(normalizeString)
        .filter(Boolean)
        .join(" ");
    return NON_OPERATIONAL_NAVAL_PATTERNS.some((pattern) => pattern.test(identity));
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

function isStrictMilitaryNavalContact(vessel) {
    if (isKnownNonOperationalNavalContact(vessel)) return false;
    const hasCivilianIdentity = isCivilianVesselName(vessel.name, vessel.callSign);
    const hasMilitaryIdentity = isMilitaryVesselName(vessel.name, vessel.callSign);
    if (hasCivilianIdentity && !hasMilitaryIdentity) {
        return false;
    }
    if (hasMilitaryIdentity) return true;
    return isMilitaryShipType(vessel.shipType) && !hasCivilianIdentity;
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
        dedupe_key: `ais-${vessel.trackIdentity}`,
        source_key: `ais-${vessel.trackIdentity}`,
        source_name: "AIS / AISStream.io",
        category: "military",
        subcategory: subcat,
        title,
        summary,
        lat,
        lon,
        severity: "medium",   // TEXT — valid value
        confidence: 75,          // INTEGER — was "high" (string) which caused the upsert error
        occurred_at: vessel.observedAt || new Date().toISOString(),
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
            sources: vessel.lastSourceObservations,
            source_count: vessel.sourceCount,
            corroboration: vessel.corroboration,
            source_confidence: vessel.sourceConfidence,
            source_disagreements: vessel.sourceDisagreements,
        },
    };
}

function buildNavalTrack(vessel) {
    const { mmsi, name, shipType, lat, lon, speed, heading, country, callSign, imoNumber } = vessel;
    const vesselClass = classifyVessel(name, shipType, callSign);
    const vesselLabel = name || callSign || `Military Vessel MMSI:${mmsi}`;

    return {
        track_key: `ais-${vessel.trackIdentity}`,
        track_type: "naval",
        category: "military",
        subcategory: vesselClass,
        source_name: "AIS / AISStream.io",
        title: country ? `${vesselLabel} — ${country}` : vesselLabel,
        lat,
        lon,
        altitude_ft: null,
        speed_kts: Number.isFinite(speed) ? Number(speed) : null,
        heading_deg: Number.isFinite(heading) ? Number(heading) : null,
        region: null,
        country: country || null,
        status: "active",
        occurred_at: vessel.observedAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
            mmsi,
            vessel_name: name || null,
            ship_type: shipType ?? null,
            vessel_class: vesselClass,
            call_sign: callSign || null,
            imo_number: imoNumber ?? null,
            sources: vessel.lastSourceObservations,
            source_count: vessel.sourceCount,
            corroboration: vessel.corroboration,
            source_confidence: vessel.sourceConfidence,
            source_disagreements: vessel.sourceDisagreements,
        },
    };
}

function buildNavalTrackHistoryRow(vessel) {
    const { mmsi, name, shipType, lat, lon, speed, heading, callSign } = vessel;
    if (!mmsi) return null;
    return {
        mmsi,
        vessel_name: name || callSign || `Military Vessel MMSI:${mmsi}`,
        ship_type: shipType ?? null,
        vessel_class: classifyVessel(name, shipType, callSign),
        lat,
        lon,
        speed_kts: Number.isFinite(speed) ? Number(speed) : null,
        heading_deg: Number.isFinite(heading) ? Number(heading) : null,
        status: "active",
        last_seen_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
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

async function upsertNavalTracks(tracks) {
    if (!tracks.length) return 0;
    const { error } = await supabase
        .from("tracks")
        .upsert(tracks, { onConflict: "track_key", ignoreDuplicates: false });
    if (error) {
        console.error("[ais] Naval tracks upsert error:", error.message);
        return 0;
    } else {
        console.log(`[ais] Upserted ${tracks.length} naval tracks`);
        return tracks.length;
    }
}

async function upsertNavalTrackHistory(rows) {
    if (!rows.length) return;
    const { error } = await supabase
        .from("naval_tracks_log")
        .upsert(rows, { onConflict: "mmsi", ignoreDuplicates: false });
    if (error) {
        console.error("[ais] Naval history upsert error:", error.message);
    } else {
        console.log(`[ais] Upserted ${rows.length} naval history rows`);
    }
}

function toLegacyVessel(observation) {
    return {
        mmsi: observation.mmsi,
        trackIdentity: observation.mmsi || (observation.imo ? `imo-${observation.imo}` : ""),
        imoNumber: observation.imo || null,
        callSign: observation.callsign || "",
        name: observation.vessel_name || "",
        lat: Number(observation.latitude),
        lon: Number(observation.longitude),
        speed: Number.isFinite(Number(observation.speed_kts)) ? Number(observation.speed_kts) : null,
        heading: Number.isFinite(Number(observation.heading_deg)) ? Number(observation.heading_deg) : null,
        shipType: observation.ship_type ?? null,
        country: observation.country || "",
        militaryHint: Boolean(observation.military_hint),
        sourceCount: observation.source_count || 1,
        corroboration: observation.corroboration || "single-source",
        sourceConfidence: observation.source_confidence || 60,
        lastSourceObservations: observation.last_source_observations || [],
        sourceDisagreements: observation.source_disagreements || 0,
        observedAt: observation.observed_at,
    };
}

export async function runAisWorker() {
    const providers = createNavalProviders();
    const providerResults = await runConfiguredProviders("ais", providers);
    const priority = new Map(providers.map((provider) => [provider.id, provider.priority]));
    const observations = providerResults.flatMap(({ provider, observations: items, diagnostics }) => {
        const providerMilitary = items.map(toLegacyVessel).filter((vessel) => isStrictMilitaryNavalContact(vessel)).length;
        if (provider.id === "aisstream") {
            console.log(`[ais:aisstream] received=${diagnostics?.received || 0} unique=${diagnostics?.unique || 0} positions=${diagnostics?.positions || 0} static=${diagnostics?.static || 0} candidates=${items.length} military=${providerMilitary}`);
        } else {
            console.log(`[ais:${provider.id}] fetched=${items.length} military=${providerMilitary}`);
        }
        return items.map((item) => ({ ...item, priority: priority.get(item.source) ?? 999 }));
    });

    const canonical = mergeNavalObservations(observations, {
        freshnessMs: Number(process.env.NAVAL_CORROBORATION_WINDOW_MS) || 10 * 60_000,
        maxSpeedKts: Number(process.env.NAVAL_MAX_PLAUSIBLE_SPEED_KTS) || 80,
    });
    const military = canonical
        .map(toLegacyVessel)
        .filter((vessel) => isStrictMilitaryNavalContact(vessel));
    const corroborated = military.filter((vessel) => vessel.sourceCount > 1).length;
    console.log(`[ais] candidates=${canonical.length} military=${military.length} canonical=${military.length} corroborated=${corroborated}`);

    const events = military.map(buildNavalEvent);
    const tracks = military.map(buildNavalTrack);
    const historyRows = military.map(buildNavalTrackHistoryRow).filter(Boolean);
    await upsertNavalEvents(events);
    const upserted = await upsertNavalTracks(tracks);
    await upsertNavalTrackHistory(historyRows);
    console.log(`[ais] upserted=${upserted}`);
}
