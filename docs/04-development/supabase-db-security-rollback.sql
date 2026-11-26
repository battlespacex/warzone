-- Restores only client ACLs/RLS states captured by this group. No user records or policies are recreated.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $$
DECLARE state record; permission record; role_sql text; column_record record;
BEGIN
 FOR state IN SELECT * FROM stratops_maintenance.security_table_state LOOP
  EXECUTE format('DROP POLICY IF EXISTS stratops_health_public_read_v1 ON public.%I',state.table_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',state.table_name);
  FOR column_record IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass('public.'||state.table_name) AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',column_record.attname,state.table_name);
  END LOOP;
  FOR permission IN SELECT * FROM stratops_maintenance.security_acl_state WHERE table_name=state.table_name LOOP
   role_sql:=CASE WHEN permission.role_name='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(permission.role_name) END;
   EXECUTE format('GRANT %s%s ON TABLE public.%I TO %s%s',permission.privilege,
    CASE WHEN permission.column_name='' THEN '' ELSE format(' (%I)',permission.column_name) END,
    state.table_name,role_sql,CASE WHEN permission.grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I %s ROW LEVEL SECURITY',state.table_name,CASE WHEN state.rls THEN 'ENABLE' ELSE 'DISABLE' END);
  EXECUTE format('ALTER TABLE public.%I %s FORCE ROW LEVEL SECURITY',state.table_name,CASE WHEN state.forced THEN '' ELSE 'NO' END);
 END LOOP;
END $$;
COMMIT;
-- Keep private snapshots. Rollback restores potentially unsafe baseline privileges; review before use.
