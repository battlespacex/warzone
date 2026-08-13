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
    /\bWARSHIP\b/i,
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
        vessel.navStatus,
        vessel.operatingStatus,
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

function identifierSet(value) {
    return new Set(String(value || "").split(",").map((item) => item.replace(/\D/g, "")).filter(Boolean));
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

export function qualifyMilitaryVessel(vessel, {
    knownMilitaryMmsi = identifierSet(process.env.NAVAL_KNOWN_MILITARY_MMSI),
    knownMilitaryImo = identifierSet(process.env.NAVAL_KNOWN_MILITARY_IMO),
} = {}) {
    if (isKnownNonOperationalNavalContact(vessel)) return { accepted: false, reason: "non_operational" };
    const hasCivilianIdentity = isCivilianVesselName(`${vessel.name || ""} ${vessel.shipType || ""}`, vessel.callSign);
    const hasMilitaryIdentity = isMilitaryVesselName(`${vessel.name || ""} ${vessel.shipType || ""} ${vessel.operator || ""}`, vessel.callSign);
    if (hasCivilianIdentity && !hasMilitaryIdentity) {
        return { accepted: false, reason: "rejected_civilian" };
    }
    if (knownMilitaryMmsi.has(String(vessel.mmsi || ""))) return { accepted: true, reason: "known_military_mmsi" };
    if (knownMilitaryImo.has(String(vessel.imoNumber || ""))) return { accepted: true, reason: "known_military_imo" };
    if (hasMilitaryIdentity) return { accepted: true, reason: "military_name_match" };
    if (vessel.providerMilitaryFlag === true) return { accepted: true, reason: "provider_military_flag" };
    if (isMilitaryShipType(vessel.shipType) && !hasCivilianIdentity) return { accepted: true, reason: "military_ship_type" };
    return { accepted: false, reason: "rejected_civilian" };
}

export function isMilitaryVessel(vessel, options) {
    return qualifyMilitaryVessel(vessel, options).accepted;
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

export function buildNavalTrack(vessel) {
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

async function endReconciledNavalTracks(trackKeys) {
    if (!trackKeys.length) return;
    const { error } = await supabase
        .from("tracks")
        .update({ status: "ended", updated_at: new Date().toISOString() })
        .in("track_key", trackKeys);
    if (error) console.error("[ais] Temporary naval track reconciliation error:", error.message);
}

function toLegacyVessel(observation) {
    const finiteOrNull = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    };
    return {
        mmsi: observation.mmsi,
        trackIdentity: observation.mmsi || (observation.imo ? `imo-${observation.imo}` : ""),
        imoNumber: observation.imo || null,
        callSign: observation.callsign || "",
        name: observation.vessel_name || "",
        lat: finiteOrNull(observation.latitude),
        lon: finiteOrNull(observation.longitude),
        speed: finiteOrNull(observation.speed_kts),
        heading: finiteOrNull(observation.heading_deg),
        shipType: observation.ship_type ?? null,
        country: observation.country || "",
        militaryHint: Boolean(observation.military_hint),
        providerMilitaryFlag: Boolean(observation.provider_military_flag),
        navStatus: observation.nav_status || "",
        operatingStatus: observation.operating_status || "",
        operator: observation.operator || "",
        sourceCount: observation.source_count || 1,
        corroboration: observation.corroboration || "single-source",
        sourceConfidence: observation.source_confidence || 60,
        lastSourceObservations: observation.last_source_observations || [],
        sourceDisagreements: observation.source_disagreements || 0,
        observedAt: observation.observed_at,
    };
}

const temporaryTrackByImo = new Map();
const reportedDisabledProviders = new Set();

const defaultPersistence = Object.freeze({
    upsertEvents: upsertNavalEvents,
    upsertTracks: upsertNavalTracks,
    upsertHistory: upsertNavalTrackHistory,
    endAliases: endReconciledNavalTracks,
});

export async function runAisWorker(options = {}) {
    const ownsProviders = !Array.isArray(options.providers);
    const providers = ownsProviders ? createNavalProviders() : options.providers;
    const persistence = options.persistence || defaultPersistence;
    const logger = options.logger || console;
    for (const provider of providers) {
        if (provider.enabled !== false) continue;
        if (reportedDisabledProviders.has(provider.id) && options.reportProviderStates !== true) continue;
        logger.log?.(`[ais:${provider.id}] DISABLED${provider.disabledReason ? ` ${provider.disabledReason}` : ""}`);
        reportedDisabledProviders.add(provider.id);
    }

    const liveProviders = providers.filter((provider) => provider.enrichmentOnly !== true);
    const enrichmentProviders = providers.filter((provider) => provider.enrichmentOnly === true);
    const providerResults = await runConfiguredProviders("ais", liveProviders, { logger });
    if (ownsProviders) {
        for (const provider of providers) provider.shutdown?.();
    }
    const priority = new Map(providers.map((provider) => [provider.id, provider.priority]));
    let aisStreamDiagnostics = null;
    let observations = providerResults.flatMap(({ provider, observations: items, diagnostics }) => {
        const providerMilitary = items.map(toLegacyVessel).filter((vessel) => isMilitaryVessel(vessel)).length;
        if (provider.id === "aisstream") {
            aisStreamDiagnostics = diagnostics || {};
            if (diagnostics?.connected) logger.log?.("[ais:aisstream] CONNECTED");
            logger.log?.(`[ais:aisstream] received=${diagnostics?.received || 0} position=${diagnostics?.position || 0} static=${diagnostics?.static || 0} unique_mmsi=${diagnostics?.unique_mmsi || 0} candidates=${items.length} military=${providerMilitary}`);
        } else {
            logger.log?.(`[ais:${provider.id}] fetched=${diagnostics?.fetched ?? items.length} normalized=${diagnostics?.normalized ?? items.length} valid=${diagnostics?.valid ?? items.length} military=${providerMilitary}`);
        }
        return items.map((item) => ({ ...item, priority: priority.get(item.source || provider.id) ?? 999 }));
    });

    for (const provider of enrichmentProviders) {
        if (provider.enabled === false) continue;
        const liveMmsi = [...new Set(observations.map((item) => String(item.mmsi || "").replace(/\D/g, "")).filter(Boolean))];
        const cached = provider.getCachedObservations?.(liveMmsi) || [];
        const cachedMmsi = new Set(cached.map((item) => item.mmsi));
        observations.push(...cached.map((item) => ({ ...item, priority: priority.get(provider.id) ?? 999 })));

        const lookupCandidate = observations
            .filter((item) => item.source !== provider.id && item.mmsi && !cachedMmsi.has(item.mmsi))
            .map((item) => ({ item, vessel: toLegacyVessel(item) }))
            .find(({ vessel }) => isMilitaryVessel(vessel))?.item;
        if (!lookupCandidate) {
            if (cached.length) logger.log?.(`[ais:${provider.id}] cache_hits=${cached.length}`);
            else if (options.reportProviderStates === true) logger.log?.(`[ais:${provider.id}] DEGRADED idle_no_enrichment_candidate`);
            continue;
        }

        const enrichmentResult = await runConfiguredProviders("ais", [{
            ...provider,
            fetchObservations: () => provider.fetchObservations({ mmsis: [lookupCandidate.mmsi] }),
        }], { logger });
        for (const result of enrichmentResult) {
            const diagnostics = result.diagnostics || {};
            const status = diagnostics.quota_blocked || diagnostics.interval_blocked ? "DEGRADED" : "HEALTHY";
            logger.log?.(`[ais:${provider.id}] ${status} fetched=${result.observations.length} cached=${diagnostics.cached === true ? 1 : 0} quota_remaining=${diagnostics.quota_remaining ?? "unknown"}`);
            observations.push(...result.observations.map((item) => ({ ...item, priority: priority.get(provider.id) ?? 999 })));
        }
    }

    const canonical = mergeNavalObservations(observations, {
        freshnessMs: Number(process.env.NAVAL_CORROBORATION_WINDOW_MS) || 5 * 60_000,
        maxSpeedKts: Number(process.env.NAVAL_MAX_PLAUSIBLE_SPEED_KTS) || 80,
    });
    const qualificationCounts = {
        known_military_mmsi: 0,
        known_military_imo: 0,
        military_name_match: 0,
        provider_military_flag: 0,
        military_ship_type: 0,
        non_operational: 0,
        rejected_civilian: 0,
    };
    const military = [];
    for (const observation of canonical) {
        const vessel = toLegacyVessel(observation);
        const qualification = qualifyMilitaryVessel(vessel);
        qualificationCounts[qualification.reason] = (qualificationCounts[qualification.reason] || 0) + 1;
        if (qualification.accepted) military.push(vessel);
    }
    const corroborated = military.filter((vessel) => vessel.sourceCount > 1).length;
    const validPosition = observations.filter((item) => item.latitude != null && item.longitude != null && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))).length;
    logger.log?.(`[ais] raw=${observations.length} valid_position=${validPosition} known_military_mmsi=${qualificationCounts.known_military_mmsi} known_military_imo=${qualificationCounts.known_military_imo} military_name_match=${qualificationCounts.military_name_match} military_ship_type=${qualificationCounts.military_ship_type + qualificationCounts.provider_military_flag} rejected_civilian=${qualificationCounts.rejected_civilian} non_operational=${qualificationCounts.non_operational} canonical=${military.length} corroborated=${corroborated}`);

    const events = military.map(buildNavalEvent);
    const tracks = military.map(buildNavalTrack);
    const historyRows = military.map(buildNavalTrackHistoryRow).filter(Boolean);
    const aliasesToEnd = [];
    for (const vessel of military) {
        const imo = String(vessel.imoNumber || "");
        if (!imo) continue;
        if (!vessel.mmsi) {
            temporaryTrackByImo.set(imo, `ais-${vessel.trackIdentity}`);
            continue;
        }
        const temporaryKey = temporaryTrackByImo.get(imo);
        const canonicalKey = `ais-${vessel.trackIdentity}`;
        if (temporaryKey && temporaryKey !== canonicalKey) aliasesToEnd.push(temporaryKey);
        temporaryTrackByImo.delete(imo);
    }
    await persistence.endAliases?.([...new Set(aliasesToEnd)]);
    await persistence.upsertEvents(events);
    const upserted = await persistence.upsertTracks(tracks);
    await persistence.upsertHistory(historyRows);
    logger.log?.(`[ais] candidates=${canonical.length} military=${military.length} canonical=${military.length} corroborated=${corroborated} upserted=${upserted}`);

    return {
        provider_count: providers.length,
        raw: observations.length,
        valid_position: validPosition,
        military: military.length,
        canonical: military.length,
        corroborated,
        upserted,
        qualification: qualificationCounts,
        aisstream: aisStreamDiagnostics,
    };
}

export async function runVesselApiDiagnostic(mmsi, { logger = console } = {}) {
    const provider = createNavalProviders().find((item) => item.id === "vesselapi");
    if (!provider?.enabled) {
        logger.log?.(`[ais:vesselapi] DISABLED${provider?.disabledReason ? ` ${provider.disabledReason}` : ""}`);
        return { observation: null, diagnostics: { disabled: true } };
    }
    const result = await provider.lookupVesselByMmsi(mmsi, { automatic: false });
    const status = result.diagnostics?.quota_blocked ? "DEGRADED" : "HEALTHY";
    logger.log?.(`[ais:vesselapi] ${status} mmsi=${String(mmsi || "").replace(/\D/g, "")} cached=${result.diagnostics?.cached === true ? 1 : 0} quota_remaining=${result.diagnostics?.quota_remaining ?? "unknown"}`);
    return result;
}
