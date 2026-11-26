// Occurrence/publication time only: receiving a report never renews its lifetime.
export const CONFLICT_RETENTION_HOURS = 72;
export const CONFLICT_RETENTION_MS = CONFLICT_RETENTION_HOURS * 60 * 60 * 1000;
// Legacy news rows can be matched for corroboration; this is NOT deletion ownership.
export const CONFLICT_EVENT_LOOKUP_FILTER = "and(report_type.in.(news,osint,conflict,reddit,strike),or(metadata->>intelligence_pipeline.is.null,metadata->>intelligence_pipeline.eq.conflict)),dedupe_key.like.conflict-feed:*,metadata->>intelligence_pipeline.eq.conflict";

export function isConflictIntelligenceEvent(event = {}) {
  return event.metadata?.intelligence_pipeline === "conflict" || event.report_type === "conflict" ||
    String(event.dedupe_key || "").startsWith("conflict-feed:");
}

export function originalConflictTimestamp(item = {}) {
  const timestamp = Date.parse(item.occurred_at || item.raw?._original_occurred_at || item.published_at || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isActiveConflictItem(item = {}, now = Date.now()) {
  const timestamp = originalConflictTimestamp(item);
  return timestamp !== null && timestamp > now - CONFLICT_RETENTION_MS && timestamp <= now;
}

export function earliestConflictDate(...values) {
  const timestamps = values.map((value) => Date.parse(value || "")).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
}

export function applyConflictRetentionQuery(query, now = Date.now()) {
  const cutoff = new Date(now - CONFLICT_RETENTION_MS).toISOString();
  // Retain the existing lifetimes of all independent operational systems.
  return query.or(`and(occurred_at.gt.${cutoff},occurred_at.lte.${new Date(now).toISOString()}),and(or(report_type.is.null,report_type.neq.conflict),or(dedupe_key.is.null,dedupe_key.not.like.conflict-feed:*),or(metadata->>intelligence_pipeline.is.null,metadata->>intelligence_pipeline.neq.conflict))`);
}
