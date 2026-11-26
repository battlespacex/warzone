-- GROUP 2 READ ONLY. Export this output and back up the database before migration.
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('events','tracks','active_alerts','raw_items','worker_state','event_sources','source_registry','conflict_feed_items');
SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type,is_grantable FROM information_schema.role_table_grants
WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type;
SELECT grantee,table_name,column_name,privilege_type FROM information_schema.column_privileges
WHERE table_schema='public' AND grantee IN ('anon','authenticated','PUBLIC');
-- information_schema grant views can be empty for a read-only audit role that is not
-- a member of the grantee roles. Empty output above does NOT mean no grants exist.
SELECT c.relname,r.role_name,c.relacl,
 has_table_privilege(r.role_name,c.oid,'SELECT') can_select,
 has_table_privilege(r.role_name,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') can_mutate_or_administer,
 CASE WHEN current_setting('server_version_num')::integer>=170000
 THEN has_table_privilege(r.role_name,c.oid,'MAINTAIN') ELSE false END can_maintain,
 has_any_column_privilege(r.role_name,c.oid,'INSERT,UPDATE,REFERENCES') any_column_mutation
FROM pg_class c CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r(role_name)
WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY 1,2;
SELECT c.relname,a.attname,x.grantee,x.privilege_type,x.is_grantable
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
CROSS JOIN LATERAL aclexplode(a.attacl) x
WHERE c.relnamespace='public'::regnamespace AND a.attnum>0 AND NOT a.attisdropped;
SELECT r.rolname,r.rolbypassrls,m.roleid::regrole AS inherited_role FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member=r.oid WHERE r.rolname IN ('anon','authenticated','service_role');
WITH RECURSIVE memberships AS (
 SELECT r.rolname root,r.oid role_oid,ARRAY[r.oid] path,0 depth
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')
 UNION ALL SELECT m.root,a.roleid,m.path||a.roleid,m.depth+1
 FROM memberships m JOIN pg_auth_members a ON a.member=m.role_oid
 WHERE NOT a.roleid=ANY(m.path)
)
SELECT m.root,m.depth,r.rolname,r.rolinherit,r.rolsuper,r.rolbypassrls,
 pg_has_role(m.root,r.oid,'USAGE') inherited_now
FROM memberships m JOIN pg_roles r ON r.oid=m.role_oid ORDER BY 1,2,3;
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
