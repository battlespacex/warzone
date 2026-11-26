-- GROUP 2 MANUAL ONLY. No auth/subscription data or existing private-history read policies change.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE TABLE IF NOT EXISTS stratops_maintenance.security_table_state (
 table_name text PRIMARY KEY, rls boolean NOT NULL, forced boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS stratops_maintenance.security_acl_state (
 table_name text NOT NULL, role_name text NOT NULL, privilege text NOT NULL,
 column_name text NOT NULL DEFAULT '', grantable boolean NOT NULL,
 PRIMARY KEY(table_name,role_name,privilege,column_name)
);
REVOKE ALL ON stratops_maintenance.security_table_state,stratops_maintenance.security_acl_state FROM PUBLIC,anon,authenticated;
DO $$
DECLARE target text; relation regclass; column_record record; protected boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role' AND rolbypassrls) THEN RAISE EXCEPTION 'Review service-role RLS access before applying'; END IF;
END $$;
DO $$
DECLARE target text; relation regclass; column_record record; protected boolean;
BEGIN
 FOREACH target IN ARRAY ARRAY['events','tracks','active_alerts','raw_items','worker_state','event_sources','source_registry','conflict_feed_items','event_clusters','airspace_status','naval_tracks_log','status_feed_items','aircraft_tracks_log','operational_reports','content_translations','copernicus_usage_daily','gnss_interference_cells','operational_72hour_jobs','stratops_provider_quota','event_satellite_observations','operational_report_snapshots'] LOOP
  relation:=to_regclass('public.'||target);
  protected:=target IN ('events','tracks','active_alerts','raw_items','worker_state','event_sources','source_registry','conflict_feed_items');
  IF relation IS NULL THEN RAISE EXCEPTION 'Expected application table % missing',target; END IF;
  IF NOT EXISTS(SELECT 1 FROM stratops_maintenance.security_table_state WHERE table_name=target) THEN
   INSERT INTO stratops_maintenance.security_table_state SELECT target,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=relation;
   INSERT INTO stratops_maintenance.security_acl_state(table_name,role_name,privilege,grantable)
   SELECT target,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable
   FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
   WHERE c.oid=relation AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated','service_role'));
   INSERT INTO stratops_maintenance.security_acl_state(table_name,role_name,privilege,column_name,grantable)
   SELECT target,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,x.privilege_type,a.attname,x.is_grantable
   FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
   WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
    AND (x.grantee=0 OR pg_get_userbyid(x.grantee) IN ('anon','authenticated','service_role'));
  END IF;
  IF protected THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',target);
  ELSE EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.%I FROM PUBLIC,anon,authenticated',target); END IF;
  FOR column_record IN SELECT attname FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped LOOP
   IF protected THEN EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC,anon,authenticated',column_record.attname,target);
   ELSE EXECUTE format('REVOKE INSERT (%I),UPDATE (%I),REFERENCES (%I) ON TABLE public.%I FROM PUBLIC,anon,authenticated',column_record.attname,column_record.attname,column_record.attname,target); END IF;
  END LOOP;
  IF protected THEN EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',target); END IF;
  IF target IN ('events','tracks','active_alerts') THEN
   IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=relation AND NOT polpermissive AND polcmd IN ('r','*')) THEN
    RAISE EXCEPTION 'Review restrictive SELECT policies on % before enabling guest reads',target;
   END IF;
   EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon,authenticated',target);
   IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=relation AND polname='stratops_health_public_read_v1') THEN
    EXECUTE format('CREATE POLICY stratops_health_public_read_v1 ON public.%I FOR SELECT TO anon,authenticated USING (true)',target);
   END IF;
  END IF;
  IF target IN ('raw_items','worker_state','event_sources','source_registry','conflict_feed_items') AND
    (has_table_privilege('anon',relation,'SELECT') OR has_table_privilege('authenticated',relation,'SELECT')) THEN
   RAISE EXCEPTION 'Inherited internal read access remains on %; review memberships',target; END IF;
  EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',target);
  IF has_table_privilege('anon',relation,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR has_table_privilege('authenticated',relation,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
   RAISE EXCEPTION 'Inherited client write privileges remain on %; review memberships instead of silently changing roles',target;
  END IF;
 END LOOP;
END $$;
COMMIT;
-- No change to auth users, subscriptions, premium naval history, report authorization or global default privileges.
-- Review preflight SECURITY DEFINER RPCs separately; table ACLs alone cannot secure an unrelated unsafe RPC.
