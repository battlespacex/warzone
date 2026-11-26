// The manual migration supplies an atomic, advisory-locked batch RPC.
export async function linkEventSources(db, rows = []) {
  rows = rows.map((row) => ({ ...row, support_type: row.support_type === undefined ? "supporting" : row.support_type }));
  if (!rows.length) return { inserted_count: 0, duplicate_count: 0 };
  const result = await db.rpc("stratops_link_event_sources", { p_rows: rows });
  if (!result.error) return result.data;
  // Until installation, keep the existing flow working without blind duplicate inserts.
  if (!["PGRST202", "42883"].includes(result.error.code)) throw result.error;
  let inserted = 0;
  for (const row of rows) {
    let query = db.from("event_sources").select("id").eq("event_id", row.event_id).eq("raw_item_id", row.raw_item_id);
    query = row.support_type ? query.eq("support_type", row.support_type) : query.is("support_type", null);
    const previous = await query.limit(1);
    if (previous.error) throw previous.error;
    if (previous.data?.length) continue;
    const saved = await db.from("event_sources").insert([row]);
    if (saved.error) throw saved.error;
    inserted++;
  }
  return { inserted_count: inserted, duplicate_count: rows.length - inserted, atomic: false, migration_required: true };
}
