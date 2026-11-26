import { CONFLICT_RETENTION_MS, isConflictIntelligenceEvent, originalConflictTimestamp } from "./conflict-retention.js";

export function conflictEscalationLifetime(event = {}, now = Date.now()) {
  if (!isConflictIntelligenceEvent(event)) return null;
  const timestamp = originalConflictTimestamp(event);
  if (timestamp === null) return null;
  const expiry = timestamp + CONFLICT_RETENTION_MS;
  return {
    started_at: new Date(timestamp).toISOString(), expires_at: new Date(expiry).toISOString(),
    status: expiry <= now ? "cleared" : "active",
    meta: { intelligence_pipeline: "conflict", event_id: event.id || null, original_event_at: new Date(timestamp).toISOString() },
  };
}
