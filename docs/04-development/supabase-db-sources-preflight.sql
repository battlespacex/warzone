-- GROUP 4 READ ONLY. These counts have NOT been inferred from table size.
-- Baseline BOTH-parent-missing policy before retirement installation. After
-- retirement installation, use supabase-db-retirement-preflight.sql instead:
-- that policy also includes aged missing-event history and approved report releases.
SELECT count(*) total,
 count(*) FILTER(WHERE s.event_id IS NOT NULL AND e.id IS NULL) missing_event,
 count(*) FILTER(WHERE s.raw_item_id IS NOT NULL AND r.id IS NULL) missing_raw,
 count(*) FILTER(WHERE s.event_id IS NOT NULL AND s.raw_item_id IS NOT NULL AND e.id IS NULL AND r.id IS NULL) both_missing,
 count(*) FILTER(WHERE s.event_id IS NULL OR s.raw_item_id IS NULL) incomplete_identifiers
FROM public.event_sources s LEFT JOIN public.events e ON e.id=s.event_id LEFT JOIN public.raw_items r ON r.id=s.raw_item_id;
SELECT event_id,raw_item_id,support_type,count(*) FROM public.event_sources
GROUP BY 1,2,3 HAVING count(*)>1 ORDER BY 4 DESC LIMIT 100;
-- Initial plan only. This parent-only plan does not measure the report guard RPC.
EXPLAIN (COSTS,VERBOSE) SELECT s.id FROM public.event_sources s
WHERE s.event_id IS NOT NULL AND s.raw_item_id IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id)
AND NOT EXISTS(SELECT 1 FROM public.raw_items r WHERE r.id=s.raw_item_id) LIMIT 1000;

-- A single materialized report scan avoids scanning all report JSON for each of
-- 1.5 million candidates. Canonical lower-case UUID substrings match the
-- report helper's literal UUID::text checks, including IDs embedded in text.
-- Include references to the link row itself as well as its two absent parents.
WITH docs AS MATERIALIZED (
 SELECT to_jsonb(r)::text doc FROM public.operational_reports r
 UNION ALL SELECT to_jsonb(r)::text FROM public.operational_report_snapshots r
), refs AS MATERIALIZED (
 SELECT DISTINCT (regexp_matches(doc,
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','g'))[1]::uuid id FROM docs
), candidates AS (
 SELECT s.id,s.event_id,s.raw_item_id FROM public.event_sources s
 WHERE s.event_id IS NOT NULL AND s.raw_item_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id)
 AND NOT EXISTS(SELECT 1 FROM public.raw_items r WHERE r.id=s.raw_item_id)
)
SELECT count(*) both_missing_nonnull,
 count(*) FILTER(WHERE e.id IS NOT NULL OR r.id IS NOT NULL OR link.id IS NOT NULL) held_by_reports,
 count(*) FILTER(WHERE e.id IS NULL AND r.id IS NULL AND link.id IS NULL) candidates_after_report_exclusions,
 NOT EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating') report_generation_clear
FROM candidates s LEFT JOIN refs e ON e.id=s.event_id
 LEFT JOIN refs r ON r.id=s.raw_item_id LEFT JOIN refs link ON link.id=s.id;
-- Counts are a snapshot and need historical-semantics/export approval. Do NOT
-- treat singly missing parents, NULL identifiers or report-held rows as disposable.
-- After installing SQL in an isolated database, EXPLAIN the real RPC candidate
-- SELECT including stratops_report_references; the parent-only plan is insufficient.
