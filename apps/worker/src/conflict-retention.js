import { CONFLICT_RETENTION_MS } from "../../shared/conflict-retention.js";

// Replay the stored global backlog; no additional provider requests or region bounds.
export async function readConflictBackfill(db, { now = Date.now(), pageSize = 500 } = {}) {
  const items = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("conflict_feed_items").select("*")
      .gt("published_at", new Date(now - CONFLICT_RETENTION_MS).toISOString())
      .lte("published_at", new Date(now).toISOString())
      .order("published_at", { ascending: true }).order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    items.push(...(data || []));
    if ((data || []).length < pageSize) return items;
  }
}

export async function maintainConflictRetention(db, logger = console) {
  const { data, error } = await db.rpc("maintain_conflict_intelligence_72h");
  if (error) {
    logger.warn?.(`[conflict] retention maintenance unavailable (${error.code || "database error"}); check the manual 72-hour migration`);
    return { ok: false, migration_required: error.code === "PGRST202" || error.code === "42883" };
  }
  logger.log?.(`[conflict] retention ${JSON.stringify(data)}`);
  return { ok: true, ...data };
}
