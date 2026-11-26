function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !["fetched_at", "ingested_at"].includes(key)).map((key) => [key, canonical(value[key])]));
  return value;
}

export async function saveRawEvidence(db, row, now = Date.now()) {
  // Only reuse recent evidence: ordinary seven-day pruning cannot race this reuse window.
  const previous = await db.from("raw_items").select("id,source_name,url,raw_title,raw_text,raw_payload,published_at,parser,source_type,external_id")
    .eq("hash", row.hash).eq("source_name", row.source_name)
    .gte("created_at", new Date(now - 24 * 3600000).toISOString()).order("created_at", { ascending: false }).limit(10);
  const signature = (value) => JSON.stringify(canonical(Object.fromEntries(
    ["raw_title", "raw_text", "raw_payload", "published_at", "parser", "source_type", "external_id", "url"].map((key) => [key,
      key === "published_at" && value[key] ? new Date(value[key]).toISOString() : value[key] ?? null]))));
  const old = !previous.error && previous.data?.find((item) => signature(item) === signature(row));
  if (old) return { data: { id: old.id, source_name: old.source_name, url: old.url }, deduplicated: true };
  const saved = await db.from("raw_items").insert([row]).select("id,source_name,url").maybeSingle();
  return { ...saved, deduplicated: false };
}
