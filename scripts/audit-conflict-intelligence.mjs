// READ ONLY against Supabase. Optional bounded publication recovery emits proposals, never writes rows.
import { mkdir, writeFile } from "node:fs/promises";
import { supabase } from "../apps/worker/src/supabase.js";
import { readConflictBackfill } from "../apps/worker/src/conflict-retention.js";
import { normalizeConflictItemToEventPayload } from "../apps/worker/src/intelligence-normalizer.js";
import { extractMiddleEastEyePublication } from "../apps/worker/src/conflict-article-publication.js";
import { CONFLICT_RETENTION_MS, isActiveConflictItem } from "../apps/shared/conflict-retention.js";

const now = Date.now();
const rows = await readConflictBackfill(supabase, { now });
const result = { read_only: true, snapshot_at: new Date(now).toISOString(), collected_reports_72h: rows.length,
  stored_coordinates: 0, eligible_reports: 0, expired_original_occurrence: 0, normalization_failures: 0,
  rejection_reasons: {}, eligible_report_regions: {} };
for (const row of rows) {
  if (row.lat != null && row.lon != null) result.stored_coordinates++;
  try {
    const normalized = normalizeConflictItemToEventPayload(row);
    const reason = row.is_conflict_relevant === false ? "not_conflict_relevant" : normalized.reason;
    if (reason !== "eligible") result.rejection_reasons[reason] = (result.rejection_reasons[reason] || 0) + 1;
    else if (!isActiveConflictItem(normalized.event, now)) result.expired_original_occurrence++;
    else {
      result.eligible_reports++;
      const region = normalized.event.metadata.normalization.event_region || "unassigned";
      result.eligible_report_regions[region] = (result.eligible_report_regions[region] || 0) + 1;
    }
  } catch { result.normalization_failures++; }
}
const undated = await supabase.from("conflict_feed_items").select("id", { head: true, count: "exact" })
  .eq("source_id", "middle-east-eye-live").is("published_at", null);
if (undated.error) throw new Error(`Undated diagnostic failed: ${undated.error.code}`);
result.mee_undated_reports = undated.count;
await mkdir(".generated", { recursive: true });
await writeFile(".generated/conflict-intelligence-audit.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

const argument = process.argv.find((value) => value.startsWith("--recover-undated="));
const limit = argument ? Number(argument.split("=")[1]) : 0;
if (!Number.isInteger(limit) || limit < 0 || limit > 10) throw new Error("Recovery proposal limit must be between 0 and 10");
if (limit) {
  const { data, error } = await supabase.from("conflict_feed_items").select("id,url")
    .eq("source_id", "middle-east-eye-live").is("published_at", null)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Recovery selection failed: ${error.code}`);
  const proposals = [];
  for (const row of data || []) {
    const url = new URL(row.url);
    if (url.protocol !== "https:" || url.hostname !== "www.middleeasteye.net" || !url.pathname.startsWith("/live-blog/live-blog-update/")) continue;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), redirect: "error" });
      if (!response.ok) { proposals.push({ id: row.id, status: response.status }); continue; }
      const publication = extractMiddleEastEyePublication(await response.text());
      proposals.push({ id: row.id, url: row.url, publication,
        requires_historical_review: publication ? Date.parse(publication.value) <= now - CONFLICT_RETENTION_MS : true });
    } catch { proposals.push({ id: row.id, fetch_failed: true }); }
  }
  await writeFile(".generated/conflict-publication-recovery-proposals.json", JSON.stringify(proposals, null, 2));
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const updates = proposals.filter((row) => row.publication && !row.requires_historical_review).map((row) =>
    `UPDATE public.conflict_feed_items SET published_at = ${quote(row.publication.value)}::timestamptz,\n` +
    `  raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{_publication_timestamp}', ${quote(JSON.stringify(row.publication))}::jsonb)\n` +
    `WHERE id = ${quote(row.id)}::uuid AND url = ${quote(row.url)} AND source_id = 'middle-east-eye-live' AND published_at IS NULL\n` +
    `  AND ${quote(row.publication.value)}::timestamptz > now() - interval '72 hours' AND ${quote(row.publication.value)}::timestamptz <= now();`);
  await writeFile(".generated/conflict-publication-recovery-proposals.sql",
    "-- MANUAL REVIEW ONLY. Source publication is not a confirmed incident occurrence time.\n" +
    "-- Historical proposals stay untouched: archive/recovery requires separate approval.\nBEGIN;\n" + updates.join("\n") + "\nCOMMIT;\n");
  console.log(JSON.stringify({ recovery_proposals: proposals.length, reliable_publication_dates: proposals.filter((row) => row.publication).length,
    manual_recent_updates: updates.length, database_writes: 0 }));
}
