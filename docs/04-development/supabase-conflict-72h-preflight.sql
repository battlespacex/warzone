-- READ ONLY. Run before the migration; save results and take a database backup.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('events', 'conflict_feed_items')
ORDER BY table_name, ordinal_position;

SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid)
FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('events', 'conflict_feed_items');
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('events', 'conflict_feed_items');
SELECT conrelid::regclass AS referencing_table, confrelid::regclass AS referenced_table,
  conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE contype = 'f' AND (conrelid IN ('public.events'::regclass, 'public.conflict_feed_items'::regclass)
  OR confrelid IN ('public.events'::regclass, 'public.conflict_feed_items'::regclass));
SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid), pg_get_functiondef(t.tgfoid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgrelid IN ('public.events'::regclass, 'public.conflict_feed_items'::regclass)
AND NOT t.tgisinternal;
SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('events', 'conflict_feed_items');
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
WHERE c.oid IN ('public.events'::regclass, 'public.conflict_feed_items'::regclass);
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
-- If pg_cron is installed, separately inspect: SELECT jobid, jobname, schedule, command FROM cron.job;
-- Review ALL existing scheduled deletion functions before enabling this job.
SELECT p.proname, pg_get_functiondef(p.oid) FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.prosrc ~* '(delete|truncate)[[:space:][:print:]]*(events|conflict_feed_items)';

SELECT url, count(*) FROM public.conflict_feed_items GROUP BY url HAVING count(*) > 1;
SELECT dedupe_key, count(*) FROM public.events
WHERE dedupe_key LIKE 'conflict-feed:%' GROUP BY dedupe_key HAVING count(*) > 1;
-- Stop and investigate duplicates; do not delete them just to make the migration pass.
SELECT status,count(*) FROM public.operational_reports GROUP BY status;
SELECT s.event_id,s.id AS observation_id,s.status,s.storage_key IS NOT NULL AS has_s3_reference
FROM public.event_satellite_observations s JOIN public.events e ON e.id=s.event_id
WHERE e.occurred_at<=now()-interval '72 hours'
 AND (e.report_type='conflict' OR e.dedupe_key LIKE 'conflict-feed:%' OR e.metadata->>'intelligence_pipeline'='conflict');
-- Preview includes held candidates; actual deletion excludes ALL satellite/source/report dependencies.

-- Preview legacy rows that the migration will mark as belonging to the conflict pipeline.
SELECT e.report_type, count(*) AS proven_promoter_matches FROM public.events e
WHERE e.report_type IN ('news','osint','reddit','strike')
  AND e.metadata->>'intelligence_pipeline' IS NULL
  AND EXISTS (SELECT 1 FROM public.conflict_feed_items f
    WHERE f.url = e.source_url AND f.is_conflict_relevant IS TRUE
      AND f.source_id IS NOT NULL AND e.metadata->>'source_id' = f.source_id)
GROUP BY e.report_type;
-- Unmatched news/OSINT is deliberately outside this migration's deletion scope.
SELECT e.report_type, count(*) AS unrelated_or_unproven FROM public.events e
WHERE e.report_type IN ('news','osint') AND e.metadata->>'intelligence_pipeline' IS NULL
  AND COALESCE(e.dedupe_key, '') NOT LIKE 'conflict-feed:%'
  AND NOT EXISTS (SELECT 1 FROM public.conflict_feed_items f WHERE f.url = e.source_url
    AND f.source_id IS NOT NULL AND e.metadata->>'source_id' = f.source_id)
GROUP BY e.report_type;

SELECT report_type, count(*) FILTER (WHERE occurred_at > now() - interval '72 hours'
  AND occurred_at <= now()) AS retained,
  count(*) FILTER (WHERE occurred_at <= now() - interval '72 hours') AS expired
FROM public.events WHERE report_type = 'conflict' OR dedupe_key LIKE 'conflict-feed:%' OR metadata->>'intelligence_pipeline' = 'conflict'
GROUP BY report_type;
SELECT count(*) FILTER (WHERE published_at > now() - interval '72 hours' AND published_at <= now()) AS retained,
  count(*) FILTER (WHERE published_at IS NULL) AS undated_for_review
FROM public.conflict_feed_items;
