-- Supplement to the five group preflights. READ ONLY; no RPCs or DDL executed.
-- Keep returned definitions/ACLs private. Run each statement separately if your
-- client returns only the final result set. Do not substitute estimates for counts.
SELECT now() captured_at,current_setting('server_version') postgres_version,
 current_setting('transaction_read_only') transaction_read_only;

SELECT c.relname,count(a.attnum)::integer columns,c.relrowsecurity,c.relforcerowsecurity,
 pg_get_userbyid(c.relowner) owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE n.nspname='public' AND c.relkind IN ('r','p') GROUP BY c.oid ORDER BY c.relname;

SELECT table_name,column_name,udt_name,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position;
SELECT c.relname,co.conname,co.contype,co.convalidated,co.condeferrable,
 pg_get_constraintdef(co.oid) definition
FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
WHERE c.relnamespace='public'::regnamespace OR co.confrelid IN
 (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) ORDER BY 1,2;
SELECT c.relname,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid) definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE c.relnamespace='public'::regnamespace ORDER BY 1,2;
SELECT p.oid::regprocedure::text identity,pg_get_userbyid(p.proowner) owner,
 p.prosecdef,p.proconfig,p.provolatile,p.prorettype::regtype::text returns,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 pg_get_functiondef(p.oid) definition
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') ORDER BY 1;
SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT * FROM pg_views WHERE schemaname='public';
SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('v','m') AND EXISTS(
 SELECT 1 FROM pg_rewrite rw JOIN pg_depend d ON d.objid=rw.oid AND d.classid='pg_rewrite'::regclass
 JOIN pg_class parent ON parent.oid=d.refobjid AND d.refclassid='pg_class'::regclass
 WHERE rw.ev_class=c.oid AND parent.relnamespace='public'::regnamespace);

-- Inventory existing cleanup, without invoking any function or scheduling jobs.
SELECT p.oid::regprocedure::text identity,pg_get_functiondef(p.oid) definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind='f'
 AND p.prosrc ~* '(delete|truncate)[[:space:][:print:]]*(event_sources|events|raw_items|conflict_feed_items|event_satellite_observations|operational_reports)';
SELECT extname,extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_stat_statements');
-- Only if pg_cron exists: separately SELECT jobid,jobname,schedule,command FROM cron.job;
-- External worker timers are not database jobs; verify deployed worker version separately.

-- Circular and permanent hold preview. No existing maintenance functions needed.
WITH docs AS MATERIALIZED (
 SELECT to_jsonb(r)::text doc FROM public.operational_reports r
 UNION ALL SELECT to_jsonb(r)::text FROM public.operational_report_snapshots r
), refs AS MATERIALIZED (
 SELECT DISTINCT (regexp_matches(doc,
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','g'))[1]::uuid id FROM docs
), flags AS (
 SELECT e.id,e.occurred_at,COALESCE(e.report_type='conflict' OR e.dedupe_key LIKE 'conflict-feed:%'
  OR e.metadata->>'intelligence_pipeline'='conflict',false) owned,
 EXISTS(SELECT 1 FROM public.event_sources s WHERE s.event_id=e.id) source_hold,
 EXISTS(SELECT 1 FROM public.event_satellite_observations o WHERE o.event_id=e.id) satellite_hold,
 EXISTS(SELECT 1 FROM refs r WHERE r.id=e.id) report_hold FROM public.events e
)
SELECT owned,count(*) expired,count(*) FILTER(WHERE source_hold) source_held,
 count(*) FILTER(WHERE satellite_hold) satellite_held,count(*) FILTER(WHERE report_hold) report_held,
 count(*) FILTER(WHERE NOT(source_hold OR satellite_hold OR report_hold)) candidates_without_dependencies
FROM flags WHERE occurred_at<=now()-CASE WHEN owned THEN interval '72 hours' ELSE interval '7 days' END GROUP BY owned;

SELECT count(DISTINCT r.id) raw_rows_older_7d_held_by_sources,
 count(DISTINCT r.id) FILTER(WHERE NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id))
 held_by_missing_event_source_history
FROM public.raw_items r JOIN public.event_sources s ON s.raw_item_id=r.id
WHERE r.created_at<now()-interval '7 days';
SELECT COALESCE(e.report_type='conflict' OR e.dedupe_key LIKE 'conflict-feed:%'
 OR e.metadata->>'intelligence_pipeline'='conflict',false) owned,o.status,count(*) observations,
 count(*) FILTER(WHERE o.storage_key IS NOT NULL) with_storage_key
FROM public.event_satellite_observations o JOIN public.events e ON e.id=o.event_id
WHERE e.occurred_at<=now()-interval '72 hours' GROUP BY 1,2 ORDER BY 1,2;
SELECT status,count(*) FROM public.operational_reports GROUP BY status;
SELECT status,count(*) FROM public.operational_72hour_jobs GROUP BY status;
