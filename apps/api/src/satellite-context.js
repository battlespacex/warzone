const PUBLIC_SATELLITE_STATUSES = new Set(["available", "pending", "searching", "processing", "retryable_error"]);
const SATELLITE_CONTEXT_EVENT_BATCH_SIZE = 100;

function toPublicSatelliteContext(row = {}) {
  const status = String(row.status || "").toLowerCase();
  if (!PUBLIC_SATELLITE_STATUSES.has(status)) return null;
  if (status === "available" && !/^https?:\/\//i.test(String(row.image_url || ""))) return null;

  const isRadar = String(row.observation_type || "").toLowerCase() === "sar_radar" ||
    String(row.collection || "").toLowerCase() === "sentinel-1-grd";

  return {
    id: row.id,
    status,
    provider: "Copernicus",
    collection: row.collection || "",
    observationType: row.observation_type || "",
    acquisitionTime: row.acquisition_time || null,
    eventTimeRelation: row.event_time_relation || "unknown",
    cloudCover: Number.isFinite(Number(row.cloud_cover)) ? Number(row.cloud_cover) : null,
    imageUrl: status === "available" ? row.image_url : null,
    mimeType: row.mime_type || null,
    width: Number.isFinite(Number(row.width)) ? Number(row.width) : null,
    height: Number.isFinite(Number(row.height)) ? Number(row.height) : null,
    byteSize: Number.isFinite(Number(row.byte_size)) ? Number(row.byte_size) : null,
    updatedAt: row.updated_at || null,
    imageryType: isRadar ? "SAR radar" : "Natural colour",
    approximateResolution: isRadar ? "10 m" : "10 m",
    disclaimer: "Latest available satellite observation for contextual reference. It is not live imagery and does not independently confirm the reported event or its cause.",
    radarDisclaimer: isRadar
      ? "Synthetic-aperture radar imagery. Brightness and contrast do not represent natural visible colour."
      : null,
  };
}

async function attachSatelliteContextToEvents(supabase, events = []) {
  const source = Array.isArray(events) ? events : [];
  const eventIds = [...new Set(source.map((event) => event?.id).filter(Boolean))];
  if (!eventIds.length) return source;

  try {
    const batches = [];
    for (let index = 0; index < eventIds.length; index += SATELLITE_CONTEXT_EVENT_BATCH_SIZE) {
      batches.push(eventIds.slice(index, index + SATELLITE_CONTEXT_EVENT_BATCH_SIZE));
    }
    const batchResults = await Promise.all(batches.map((batch) => supabase
      .from("event_satellite_observations")
      .select("id, event_id, status, collection, observation_type, acquisition_time, event_time_relation, cloud_cover, image_url, mime_type, width, height, byte_size, updated_at")
      .in("event_id", batch)
      .in("status", [...PUBLIC_SATELLITE_STATUSES])
      .order("updated_at", { ascending: false })));
    const data = batchResults
      .filter((result) => !result.error)
      .flatMap((result) => result.data || [])
      .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));

    const byEvent = new Map();
    for (const row of data || []) {
      if (byEvent.has(row.event_id)) continue;
      const publicContext = toPublicSatelliteContext(row);
      if (publicContext) byEvent.set(row.event_id, publicContext);
    }

    return source.map((event) => {
      const satelliteContext = byEvent.get(event.id);
      return satelliteContext ? { ...event, satellite_context: satelliteContext } : event;
    });
  } catch {
    return source;
  }
}

export {
  attachSatelliteContextToEvents,
  toPublicSatelliteContext,
};
