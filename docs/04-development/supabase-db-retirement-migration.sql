-- MANUAL ONLY, after foundation/source/conflict/alert groups. Never invokes cleanup.
BEGIN;
SET LOCAL lock_timeout='3s';
UPDATE stratops_maintenance.controls SET enabled=false;
INSERT INTO stratops_maintenance.controls(name) VALUES('cleared_escalations') ON CONFLICT DO NOTHING;
INSERT INTO stratops_maintenance.controls(name) VALUES('satellite_retirement') ON CONFLICT DO NOTHING;
UPDATE stratops_maintenance.controls SET enabled=false;
-- Serialize report publication and retirement. Never use an asynchronously refreshed pin cache.
LOCK TABLE public.operational_reports,public.operational_report_snapshots IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS stratops_maintenance.report_documents (
 kind text NOT NULL,id uuid NOT NULL,doc text NOT NULL,PRIMARY KEY(kind,id)
);
CREATE TABLE IF NOT EXISTS stratops_maintenance.report_pins (
 kind text NOT NULL,report_id uuid NOT NULL,ref uuid NOT NULL,PRIMARY KEY(kind,report_id,ref)
);
CREATE INDEX IF NOT EXISTS report_pins_ref ON stratops_maintenance.report_pins(ref);
CREATE TABLE IF NOT EXISTS stratops_maintenance.report_releases (
 kind text NOT NULL,id uuid NOT NULL,backup_reference text NOT NULL CHECK(length(trim(backup_reference))>0),
 reviewed_at timestamptz NOT NULL,PRIMARY KEY(kind,id)
);
CREATE TABLE IF NOT EXISTS stratops_maintenance.preview_retirements (
 observation_id uuid PRIMARY KEY,retired_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION stratops_maintenance.invalidate_preview_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.storage_key IS NOT NULL OR NEW.image_url IS NOT NULL THEN
  DELETE FROM stratops_maintenance.preview_retirements WHERE observation_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stratops_preview_receipt ON public.event_satellite_observations;
CREATE TRIGGER stratops_preview_receipt BEFORE INSERT OR UPDATE OF storage_key,image_url
ON public.event_satellite_observations FOR EACH ROW EXECUTE FUNCTION stratops_maintenance.invalidate_preview_receipt();
REVOKE ALL ON ALL TABLES IN SCHEMA stratops_maintenance FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION stratops_maintenance.index_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE key_id uuid; document text;
BEGIN
 PERFORM pg_advisory_xact_lock(190087,72);
 IF TG_OP='DELETE' THEN
  key_id:=CASE WHEN TG_TABLE_NAME='operational_reports' THEN (to_jsonb(OLD)->>'id')::uuid ELSE (to_jsonb(OLD)->>'snapshot_id')::uuid END;
 ELSE
  document:=to_jsonb(NEW)::text;
  key_id:=CASE WHEN TG_TABLE_NAME='operational_reports' THEN (to_jsonb(NEW)->>'id')::uuid ELSE (to_jsonb(NEW)->>'snapshot_id')::uuid END;
 END IF;
 DELETE FROM stratops_maintenance.report_pins WHERE kind=TG_TABLE_NAME AND report_id=key_id;
 DELETE FROM stratops_maintenance.report_documents WHERE kind=TG_TABLE_NAME AND id=key_id;
 -- Any report change revokes a previously reviewed release and re-pins its evidence.
 DELETE FROM stratops_maintenance.report_releases WHERE kind=TG_TABLE_NAME AND id=key_id;
 IF TG_OP<>'DELETE' THEN
  INSERT INTO stratops_maintenance.report_documents VALUES(TG_TABLE_NAME,key_id,document);
  INSERT INTO stratops_maintenance.report_pins
   SELECT DISTINCT TG_TABLE_NAME,key_id,(regexp_matches(document,
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','g'))[1]::uuid;
 END IF;
 RETURN NULL;
END $$;
-- BEFORE statement lock precedes row modification, including concurrent publication.
CREATE OR REPLACE FUNCTION stratops_maintenance.lock_report_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM pg_advisory_xact_lock(190087,72); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS stratops_report_lock ON public.operational_reports;
CREATE TRIGGER stratops_report_lock BEFORE INSERT OR UPDATE OR DELETE ON public.operational_reports
FOR EACH STATEMENT EXECUTE FUNCTION stratops_maintenance.lock_report_write();
DROP TRIGGER IF EXISTS stratops_snapshot_lock ON public.operational_report_snapshots;
CREATE TRIGGER stratops_snapshot_lock BEFORE INSERT OR UPDATE OR DELETE ON public.operational_report_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION stratops_maintenance.lock_report_write();
DROP TRIGGER IF EXISTS stratops_report_pins ON public.operational_reports;
CREATE TRIGGER stratops_report_pins AFTER INSERT OR UPDATE OR DELETE ON public.operational_reports
FOR EACH ROW EXECUTE FUNCTION stratops_maintenance.index_report();
DROP TRIGGER IF EXISTS stratops_snapshot_pins ON public.operational_report_snapshots;
CREATE TRIGGER stratops_snapshot_pins AFTER INSERT OR UPDATE OR DELETE ON public.operational_report_snapshots
FOR EACH ROW EXECUTE FUNCTION stratops_maintenance.index_report();
-- Rebuild once on installation; preserve explicitly approved releases on retries.
DELETE FROM stratops_maintenance.report_pins;
DELETE FROM stratops_maintenance.report_documents;
INSERT INTO stratops_maintenance.report_documents
 SELECT 'operational_reports',id,to_jsonb(r)::text FROM public.operational_reports r
 UNION ALL SELECT 'operational_report_snapshots',snapshot_id,to_jsonb(r)::text FROM public.operational_report_snapshots r;
INSERT INTO stratops_maintenance.report_pins
 SELECT DISTINCT kind,id,(regexp_matches(doc,
 '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','g'))[1]::uuid
 FROM stratops_maintenance.report_documents;

CREATE OR REPLACE FUNCTION public.stratops_report_references(p_id uuid,p_token text DEFAULT NULL)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM stratops_maintenance.report_pins p WHERE p.ref=p_id
 AND NOT EXISTS(SELECT 1 FROM stratops_maintenance.report_releases r WHERE r.kind=p.kind AND r.id=p.report_id))
 OR CASE WHEN p_token ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN EXISTS(SELECT 1 FROM stratops_maintenance.report_pins p WHERE p.ref=p_token::uuid
 AND NOT EXISTS(SELECT 1 FROM stratops_maintenance.report_releases r WHERE r.kind=p.kind AND r.id=p.report_id))
 WHEN NULLIF(p_token,'') IS NOT NULL THEN EXISTS(
 SELECT 1 FROM stratops_maintenance.report_documents d WHERE strpos(d.doc,p_token)>0
 AND NOT EXISTS(SELECT 1 FROM stratops_maintenance.report_releases r WHERE r.kind=d.kind AND r.id=d.id)) ELSE false END
$$;

-- Receipt only after the worker has successfully deleted the storage object.
-- NULL storage keys on historical rows are NOT proof of successful retirement.
CREATE OR REPLACE FUNCTION public.stratops_record_preview_retirement(p_observation_id uuid,p_storage_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(190087,72);
 UPDATE public.event_satellite_observations SET storage_key=NULL,image_url=NULL
 WHERE id=p_observation_id AND status='expired' AND storage_key=p_storage_key;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO stratops_maintenance.preview_retirements(observation_id) VALUES(p_observation_id)
 ON CONFLICT(observation_id) DO UPDATE SET retired_at=now();
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION stratops_maintenance.prune_event_batch(p_conflict boolean,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE state stratops_maintenance.controls%ROWTYPE; e public.events%ROWTYPE;
 s record; o record; raw_id uuid; raw_ids uuid[]; held boolean;
 checked integer:=0; removed integer:=0; links integer:=0; observations integer:=0; raws integer:=0; last_id uuid;
 key_name text:=CASE WHEN p_conflict THEN 'conflict' ELSE 'working_history' END;
BEGIN
 IF NOT pg_try_advisory_xact_lock(190087,72) THEN RETURN jsonb_build_object('enabled',false,'reason','report_lock_busy'); END IF;
 SELECT * INTO state FROM stratops_maintenance.controls WHERE name=key_name FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR NOT state.enabled OR NULLIF(trim(state.backup_reference),'') IS NULL OR state.reviewed_at IS NULL
 THEN RETURN jsonb_build_object('enabled',false); END IF;
 IF EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating') THEN RETURN jsonb_build_object('enabled',false,'reason','report_generation_in_progress'); END IF;
 FOR e IN SELECT * FROM public.events x WHERE public.stratops_conflict_owned(x)=p_conflict
 AND occurred_at<=now()-CASE WHEN p_conflict THEN interval '72 hours' ELSE interval '7 days' END
 AND (state.cursor_id IS NULL OR x.id>state.cursor_id) ORDER BY x.id
 LIMIT LEAST(GREATEST(p_limit,1),100) FOR UPDATE SKIP LOCKED LOOP
  checked:=checked+1; last_id:=e.id; held:=public.stratops_report_references(e.id); raw_ids:=ARRAY[]::uuid[];
  -- Hold high-fanout parents for separate review rather than running unbounded child work.
  IF (SELECT count(*) FROM (SELECT 1 FROM public.event_sources WHERE event_id=e.id LIMIT 1001) q)>1000
   OR (SELECT count(*) FROM (SELECT 1 FROM public.event_satellite_observations WHERE event_id=e.id LIMIT 101) q)>100 THEN CONTINUE; END IF;
  FOR s IN SELECT * FROM public.event_sources WHERE event_id=e.id ORDER BY id FOR UPDATE LOOP
   IF s.raw_item_id IS NULL OR public.stratops_report_references(s.id,s.raw_item_id::text) THEN held:=true; END IF;
   raw_ids:=array_append(raw_ids,s.raw_item_id);
  END LOOP;
  FOR o IN SELECT * FROM public.event_satellite_observations WHERE event_id=e.id ORDER BY id FOR UPDATE LOOP
   IF o.status<>'expired' OR o.storage_key IS NOT NULL OR o.image_url IS NOT NULL
    OR o.expires_at IS NULL OR o.expires_at>now()-interval '7 days'
    OR NOT EXISTS(SELECT 1 FROM stratops_maintenance.preview_retirements r WHERE r.observation_id=o.id)
    OR public.stratops_report_references(o.id) THEN held:=true; END IF;
  END LOOP;
  IF held THEN CONTINUE; END IF;
  -- The parent lock blocks source linking; lock shared raw parents in a stable order.
  PERFORM 1 FROM public.raw_items WHERE id=ANY(raw_ids) ORDER BY id FOR UPDATE;
  DELETE FROM public.event_sources WHERE event_id=e.id; GET DIAGNOSTICS links=ROW_COUNT;
  DELETE FROM stratops_maintenance.preview_retirements WHERE observation_id IN
   (SELECT id FROM public.event_satellite_observations WHERE event_id=e.id);
  DELETE FROM public.event_satellite_observations WHERE event_id=e.id; GET DIAGNOSTICS observations=ROW_COUNT;
  DELETE FROM public.events WHERE id=e.id; removed:=removed+1;
  FOREACH raw_id IN ARRAY raw_ids LOOP
   DELETE FROM public.raw_items r WHERE r.id=raw_id AND r.created_at<now()-interval '7 days'
    AND NOT EXISTS(SELECT 1 FROM public.event_sources x WHERE x.raw_item_id=r.id)
    AND NOT public.stratops_report_references(r.id);
   IF FOUND THEN raws:=raws+1; END IF;
  END LOOP;
 END LOOP;
 UPDATE stratops_maintenance.controls SET cursor_id=CASE WHEN checked=0 THEN NULL ELSE last_id END WHERE name=key_name;
 RETURN jsonb_build_object('enabled',true,'checked',checked,'deleted',removed,'raw_deleted',raws);
END $$;

-- Nullable historical links remain intact. New references must have surviving parents;
-- these locks also protect shared evidence against concurrent coordinated retirement.
CREATE OR REPLACE FUNCTION stratops_maintenance.check_source_parents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.event_id IS NOT NULL THEN
  PERFORM 1 FROM public.events WHERE id=NEW.event_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source event missing'; END IF;
 END IF;
 IF NEW.raw_item_id IS NOT NULL THEN
  PERFORM 1 FROM public.raw_items WHERE id=NEW.raw_item_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source raw item missing'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stratops_source_parents ON public.event_sources;
CREATE TRIGGER stratops_source_parents BEFORE INSERT OR UPDATE OF event_id,raw_item_id ON public.event_sources
FOR EACH ROW EXECUTE FUNCTION stratops_maintenance.check_source_parents();

CREATE OR REPLACE FUNCTION public.stratops_prune_cleared_escalations(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE removed integer;
BEGIN
 PERFORM pg_advisory_xact_lock(190087,72);
 PERFORM 1 FROM stratops_maintenance.controls WHERE name='cleared_escalations' AND enabled
 AND NULLIF(trim(backup_reference),'') IS NOT NULL AND reviewed_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating') THEN RETURN jsonb_build_object('enabled',false); END IF;
 WITH candidates AS (SELECT a.id FROM public.active_alerts a WHERE category='escalation' AND status='cleared'
 AND cleared_at<now()-interval '90 days' AND updated_at<now()-interval '90 days'
 AND (meta->>'intelligence_pipeline'='conflict' OR meta->>'maintenance_reason'='reviewed_stale_orphan_escalation')
 AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id::text=a.alert_key)
 AND NOT public.stratops_report_references(a.id,a.alert_key)
 ORDER BY a.id LIMIT LEAST(GREATEST(p_limit,1),500) FOR UPDATE SKIP LOCKED)
 DELETE FROM public.active_alerts a USING candidates c WHERE a.id=c.id;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN jsonb_build_object('deleted',removed);
END $$;
-- Independent observation lifecycle: a retained parent must not permanently hold
-- an unpinned, expired observation with a verified storage retirement receipt.
CREATE OR REPLACE FUNCTION public.stratops_prune_retired_observations(p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE o record; removed integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(190087,72) THEN RETURN jsonb_build_object('enabled',false); END IF;
 PERFORM 1 FROM stratops_maintenance.controls WHERE name='satellite_retirement' AND enabled
 AND NULLIF(trim(backup_reference),'') IS NOT NULL AND reviewed_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating') THEN RETURN jsonb_build_object('enabled',false); END IF;
 FOR o IN SELECT x.id FROM public.event_satellite_observations x
 WHERE x.status='expired' AND x.expires_at<=now()-interval '7 days'
 AND x.storage_key IS NULL AND x.image_url IS NULL
 AND EXISTS(SELECT 1 FROM stratops_maintenance.preview_retirements r WHERE r.observation_id=x.id)
 AND NOT public.stratops_report_references(x.id)
 AND NOT public.stratops_report_references(x.event_id)
 ORDER BY x.id LIMIT LEAST(GREATEST(p_limit,1),100) FOR UPDATE SKIP LOCKED LOOP
  DELETE FROM stratops_maintenance.preview_retirements WHERE observation_id=o.id;
  DELETE FROM public.event_satellite_observations WHERE id=o.id;
  removed:=removed+1;
 END LOOP;
 RETURN jsonb_build_object('deleted',removed);
END $$;
-- Historical links with a missing event can also retire after seven days, without
-- deleting shared raw evidence or rewriting nullable source-history identifiers.
CREATE OR REPLACE FUNCTION public.stratops_prune_source_orphans(p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='3s' AS $$
DECLARE s public.event_sources%ROWTYPE; removed integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(190087,72) THEN RETURN jsonb_build_object('enabled',false); END IF;
 PERFORM 1 FROM stratops_maintenance.controls WHERE name='source_orphans' AND enabled
 AND NULLIF(trim(backup_reference),'') IS NOT NULL AND reviewed_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating') THEN RETURN jsonb_build_object('enabled',false); END IF;
 FOR s IN SELECT * FROM public.event_sources x WHERE x.event_id IS NOT NULL AND x.raw_item_id IS NOT NULL
 AND x.created_at<now()-interval '7 days'
 AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=x.event_id)
 AND NOT public.stratops_report_references(x.id)
 AND NOT public.stratops_report_references(x.event_id,x.raw_item_id::text)
 ORDER BY x.id LIMIT LEAST(GREATEST(p_limit,1),1000) FOR UPDATE SKIP LOCKED LOOP
  PERFORM 1 FROM public.raw_items WHERE id=s.raw_item_id FOR UPDATE;
  DELETE FROM public.event_sources WHERE id=s.id; removed:=removed+1;
  DELETE FROM public.raw_items r WHERE r.id=s.raw_item_id AND r.created_at<now()-interval '7 days'
  AND NOT EXISTS(SELECT 1 FROM public.event_sources x WHERE x.raw_item_id=r.id)
  AND NOT public.stratops_report_references(r.id);
 END LOOP;
 RETURN jsonb_build_object('deleted',removed);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA stratops_maintenance FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.stratops_record_preview_retirement(uuid,text),public.stratops_prune_cleared_escalations(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stratops_record_preview_retirement(uuid,text),public.stratops_prune_cleared_escalations(integer) TO service_role;
REVOKE ALL ON FUNCTION public.stratops_prune_retired_observations(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stratops_prune_retired_observations(integer) TO service_role;
COMMIT;
