-- GROUP 2 READ ONLY. Export this output and back up the database before migration.
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('events','tracks','active_alerts','raw_items','worker_state','event_sources','source_registry','conflict_feed_items');
SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.role_table_grants
WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type;
SELECT grantee,table_name,column_name,privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND grantee IN ('anon','authenticated','PUBLIC');
SELECT r.rolname,r.rolbypassrls,m.roleid::regrole AS inherited_role FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member=r.oid WHERE r.rolname IN ('anon','authenticated','service_role');
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl;
SELECT role_name,has_schema_privilege(role_name,'public','CREATE') can_create_public_objects
FROM unnest(ARRAY['anon','authenticated','service_role']) role_name;
-- Callable SECURITY DEFINER routines are a separate attack surface. Review before declaring least privilege complete.
SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 pg_get_functiondef(p.oid) definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef AND p.prokind='f';
SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime';
