-- READ ONLY. Run after migration, then again after a scheduled worker cycle.
SELECT * FROM stratops_maintenance.controls WHERE name IN ('conflict','working_history');
SELECT count(*) AS physically_retained_for_dependencies FROM public.events e
WHERE public.stratops_conflict_owned(e) AND e.occurred_at<=now()-interval '72 hours'
 AND public.stratops_event_has_dependents(e.id);
SELECT to_regprocedure('public.maintain_conflict_intelligence_72h()') AS maintenance_function;
SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname IN ('stratops_conflict_feed_preserve_age', 'stratops_conflict_event_preserve_age');
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE 'stratops_conflict%';
SELECT has_function_privilege('service_role', 'public.maintain_conflict_intelligence_72h()', 'EXECUTE') AS worker_can_execute,
  has_function_privilege('anon', 'public.maintain_conflict_intelligence_72h()', 'EXECUTE') AS anon_must_be_false,
  has_function_privilege('authenticated', 'public.maintain_conflict_intelligence_72h()', 'EXECUTE') AS authenticated_must_be_false;

SELECT report_type,
  count(*) FILTER (WHERE occurred_at > now() - interval '72 hours' AND occurred_at <= now()) AS retained,
  count(*) FILTER (WHERE occurred_at <= now() - interval '72 hours') AS awaiting_cleanup,
  count(*) FILTER (WHERE occurred_at > now()) AS future_dated_for_review
FROM public.events WHERE report_type = 'conflict' OR dedupe_key LIKE 'conflict-feed:%' OR metadata->>'intelligence_pipeline' = 'conflict'
GROUP BY report_type;
SELECT COALESCE(metadata->'normalization'->>'event_region', NULLIF(country_code,''), 'unassigned') AS event_region,
  count(*) FROM public.events
WHERE (report_type = 'conflict' OR dedupe_key LIKE 'conflict-feed:%' OR metadata->>'intelligence_pipeline' = 'conflict')
  AND occurred_at > now() - interval '72 hours' AND occurred_at <= now()
GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FILTER (WHERE published_at > now() - interval '72 hours' AND published_at <= now()) AS retained,
  count(*) FILTER (WHERE published_at <= now() - interval '72 hours') AS awaiting_cleanup,
  count(*) FILTER (WHERE published_at IS NULL) AS undated_for_review
FROM public.conflict_feed_items;
SELECT dedupe_key, count(*) FROM public.events WHERE dedupe_key LIKE 'conflict-feed:%'
GROUP BY dedupe_key HAVING count(*) > 1;
SELECT url, count(*) FROM public.conflict_feed_items GROUP BY url HAVING count(*) > 1;
-- If pg_cron is installed, separately run:
-- SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname = 'stratops-conflict-retention-72h';
-- SELECT jobid, status, return_message, start_time, end_time FROM cron.job_run_details
-- WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'stratops-conflict-retention-72h')
-- ORDER BY start_time DESC LIMIT 10;
