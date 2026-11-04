import { supabase } from "./supabase.js";

const LOOKUP_BATCH_SIZE = 200;

function identity(value) {
    return String(value || "").trim();
}

function sourceName(vessel) {
    const providers = [...new Set((vessel.lastSourceObservations || [])
        .map((item) => identity(item.provider)).filter(Boolean))];
    return providers.join(", ") || "AIS source unspecified";
}

function aliasesFor(vessel, previous = []) {
    const aliases = [
        ...(Array.isArray(previous) ? previous : []),
        vessel.mmsi && `mmsi:${vessel.mmsi}`,
        vessel.imoNumber && `imo:${vessel.imoNumber}`,
        vessel.callSign && `callsign:${vessel.callSign}`,
        vessel.name && `name:${vessel.name}`,
    ];
    return [...new Set(aliases.filter(Boolean).map((item) => String(item).trim()))];
}

export function buildPrivateNavalHistoryRows(vessels = [], existing = []) {
    const byMmsi = new Map();
    const byImo = new Map();
    for (const row of existing) {
        if (row.mmsi) byMmsi.set(identity(row.mmsi), row);
        if (row.imo) byImo.set(identity(row.imo), row);
    }
    const assets = new Map();
    const points = [];
    for (const vessel of vessels) {
        const mmsi = identity(vessel.mmsi);
        const imo = identity(vessel.imoNumber);
        const observedAtMs = Date.parse(vessel.observedAt || "");
        if ((!mmsi && !imo) || !Number.isFinite(observedAtMs) ||
            !Number.isFinite(vessel.lat) || !Number.isFinite(vessel.lon)) continue;
        const byMmsiRow = mmsi ? byMmsi.get(mmsi) : null;
        const byImoRow = imo ? byImo.get(imo) : null;
        if (byMmsiRow && byImoRow && byMmsiRow.asset_key !== byImoRow.asset_key) {
            throw new Error("Conflicting naval identifiers require manual reconciliation");
        }
        const previous = byImoRow || byMmsiRow || null;
        if (previous?.imo && imo && previous.imo !== imo) {
            throw new Error("A naval MMSI is associated with conflicting IMO identities");
        }
        const assetKey = previous?.asset_key || (imo ? `imo-${imo}` : `mmsi-${mmsi}`);
        const observedAt = new Date(observedAtMs).toISOString();
        const previousSeenMs = Date.parse(previous?.last_seen_at || "");
        const previousFirstSeenMs = Date.parse(previous?.first_seen_at || "");
        const newest = !Number.isFinite(previousSeenMs) || observedAtMs >= previousSeenMs;
        const aliases = aliasesFor(vessel, previous?.aliases);
        const asset = {
            asset_key: assetKey,
            mmsi: newest ? (mmsi || previous?.mmsi || null) : (previous?.mmsi || null),
            imo: imo || previous?.imo || null,
            callsign: newest ? (vessel.callSign || previous?.callsign || null) : (previous?.callsign || null),
            vessel_name: newest ? (vessel.name || previous?.vessel_name || null) : (previous?.vessel_name || null),
            vessel_class: newest ? (vessel.vesselClass || previous?.vessel_class || "naval") : previous.vessel_class,
            operator: newest ? (vessel.operator || previous?.operator || null) : (previous?.operator || null),
            country: newest ? (vessel.country || previous?.country || null) : (previous?.country || null),
            aliases,
            first_seen_at: Number.isFinite(previousFirstSeenMs)
                ? new Date(Math.min(previousFirstSeenMs, observedAtMs)).toISOString() : observedAt,
            last_seen_at: newest ? observedAt : previous.last_seen_at,
            lat: newest ? vessel.lat : previous.lat,
            lon: newest ? vessel.lon : previous.lon,
            speed_kts: newest ? vessel.speed : previous.speed_kts,
            heading_deg: newest ? vessel.heading : previous.heading_deg,
            source_name: newest ? sourceName(vessel) : previous.source_name,
            source_confidence: newest ? Number(vessel.sourceConfidence || 0) : previous.source_confidence,
            qualification_level: previous?.qualification_level === "confirmed" ||
                !["military_ship_type", "provider_military_flag"].includes(vessel.qualificationReason)
                ? "confirmed" : "probable",
            qualification_reason: newest ? (vessel.qualificationReason || "unknown")
                : (previous.qualification_reason || "unknown"),
            search_text: [mmsi, imo, vessel.callSign, vessel.name, ...aliases]
                .filter(Boolean).join(" ").toLowerCase(),
        };
        assets.set(assetKey, asset);
        if (mmsi) byMmsi.set(mmsi, asset);
        if (imo) byImo.set(imo, asset);
        points.push({
            asset_key: assetKey,
            observed_at: observedAt,
            lat: vessel.lat,
            lon: vessel.lon,
            speed_kts: vessel.speed,
            heading_deg: vessel.heading,
            source_name: sourceName(vessel),
            source_confidence: Number(vessel.sourceConfidence || 0),
        });
    }
    return { assets: [...assets.values()], points };
}

async function readExisting(client, field, values) {
    const result = [];
    for (let index = 0; index < values.length; index += LOOKUP_BATCH_SIZE) {
        const { data, error } = await client.from("naval_asset_history").select("*")
            .in(field, values.slice(index, index + LOOKUP_BATCH_SIZE));
        if (error) throw error;
        result.push(...(data || []));
    }
    return result;
}

export async function persistPrivateNavalHistory(vessels = [], client = supabase) {
    if (!vessels.length) return { assets: 0, points: 0 };
    const mmsis = [...new Set(vessels.map((vessel) => identity(vessel.mmsi)).filter(Boolean))];
    const imos = [...new Set(vessels.map((vessel) => identity(vessel.imoNumber)).filter(Boolean))];
    const existingByKey = new Map();
    for (const row of [
        ...await readExisting(client, "mmsi", mmsis),
        ...await readExisting(client, "imo", imos),
    ]) existingByKey.set(row.asset_key, row);
    const { assets, points } = buildPrivateNavalHistoryRows(vessels, [...existingByKey.values()]);
    if (!assets.length) return { assets: 0, points: 0 };
    const assetWrite = await client.from("naval_asset_history").upsert(assets, { onConflict: "asset_key" });
    if (assetWrite.error) throw assetWrite.error;
    const pointWrite = await client.from("naval_position_history").upsert(points, {
        onConflict: "asset_key,observed_at,lat,lon", ignoreDuplicates: true,
    });
    if (pointWrite.error) throw pointWrite.error;
    return { assets: assets.length, points: points.length };
}
