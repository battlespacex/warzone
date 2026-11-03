-- Read-only StratOps preflight. Safe to run in Supabase SQL Editor.
SELECT t.tablename, t.rowsecurity AS rls_enabled,
 has_table_privilege('anon',format('%I.%I',t.schemaname,t.tablename),'SELECT') AS anon_select,
 has_table_privilege('anon',format('%I.%I',t.schemaname,t.tablename),'INSERT,UPDATE,DELETE') AS anon_all_write,
 has_table_privilege('authenticated',format('%I.%I',t.schemaname,t.tablename),'SELECT') AS authenticated_select,
 has_table_privilege('authenticated',format('%I.%I',t.schemaname,t.tablename),'INSERT,UPDATE,DELETE') AS authenticated_all_write
FROM pg_tables t WHERE schemaname='public'
 AND tablename IN ('events','active_alerts','tracks','raw_items','worker_state')
ORDER BY t.tablename;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public'
 AND tablename IN ('events','active_alerts','tracks','raw_items','worker_state','stratops_access')
ORDER BY tablename,policyname;

SELECT schemaname, tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime'
 AND schemaname='public'
 AND tablename IN ('events','active_alerts','tracks');
