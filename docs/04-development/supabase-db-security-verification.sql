SELECT t,role_name,has_table_privilege(role_name,'public.'||t,'SELECT') can_select,
 has_table_privilege(role_name,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') must_not_write
FROM unnest(ARRAY['events','tracks','active_alerts','raw_items','worker_state','event_sources','source_registry','conflict_feed_items']) t
CROSS JOIN unnest(ARRAY['anon','authenticated']) role_name ORDER BY t,role_name;
SELECT c.relname,c.relrowsecurity FROM pg_class c WHERE c.oid IN
 ('public.events'::regclass,'public.tracks'::regclass,'public.active_alerts'::regclass,'public.raw_items'::regclass,'public.worker_state'::regclass);
SELECT table_name,column_name,grantee,privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND grantee IN ('anon','authenticated')
AND privilege_type IN ('INSERT','UPDATE','REFERENCES');
SELECT c.relname,role_name,has_table_privilege(role_name,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') must_be_false
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN unnest(ARRAY['anon','authenticated']) role_name
WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'stratops_subscriptions';
-- Role smoke test is read-only; run after migration and inspect application entry/Reatime separately.
BEGIN;
SET LOCAL ROLE anon;
SELECT id FROM public.events LIMIT 1;
SELECT id FROM public.tracks LIMIT 1;
SELECT id FROM public.active_alerts LIMIT 1;
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT id FROM public.events LIMIT 1;
SELECT id FROM public.tracks LIMIT 1;
SELECT id FROM public.active_alerts LIMIT 1;
ROLLBACK;
-- Rerun SECURITY DEFINER and inherited-role diagnostics; verify service_role retains required access.
