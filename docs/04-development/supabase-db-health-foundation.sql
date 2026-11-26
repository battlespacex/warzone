-- GROUP 1 prerequisite. MANUAL ONLY, after a backup and preflight review.
-- Installs private controls and dependency guards; every destructive control starts OFF.
-- Review EXPLAIN plans first; source-parent lookup indexes already exist in the supplied 90-index inventory.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE SCHEMA IF NOT EXISTS stratops_maintenance;
REVOKE ALL ON SCHEMA stratops_maintenance FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS stratops_maintenance.controls (
  name text PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
  cursor_id uuid, backup_reference text, reviewed_at timestamptz
);
REVOKE ALL ON ALL TABLES IN SCHEMA stratops_maintenance FROM PUBLIC, anon, authenticated;
INSERT INTO stratops_maintenance.controls(name) VALUES
  ('conflict'), ('working_history'), ('source_orphans'), ('historical_escalations')
ON CONFLICT DO NOTHING;
UPDATE stratops_maintenance.controls SET enabled=false;

CREATE OR REPLACE FUNCTION public.stratops_conflict_owned(e public.events)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
 SELECT COALESCE((e).report_type = 'conflict' OR (e).dedupe_key LIKE 'conflict-feed:%'
   OR (e).metadata->>'intelligence_pipeline' = 'conflict', false)
$$;

CREATE OR REPLACE FUNCTION public.stratops_report_references(p_id uuid, p_token text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.operational_reports r
   WHERE strpos(to_jsonb(r)::text, p_id::text) > 0
      OR (NULLIF(p_token,'') IS NOT NULL AND strpos(to_jsonb(r)::text, p_token) > 0))
 OR EXISTS (SELECT 1 FROM public.operational_report_snapshots r
   WHERE strpos(to_jsonb(r)::text, p_id::text) > 0
      OR (NULLIF(p_token,'') IS NOT NULL AND strpos(to_jsonb(r)::text, p_token) > 0))
$$;

CREATE OR REPLACE FUNCTION public.stratops_event_has_dependents(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.event_satellite_observations WHERE event_id = p_id)
 OR EXISTS (SELECT 1 FROM public.event_sources WHERE event_id = p_id)
 OR public.stratops_report_references(p_id)
$$;

CREATE OR REPLACE FUNCTION public.stratops_satellite_preview_is_pinned(p_event_id uuid, p_storage_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT public.stratops_report_references(p_event_id, p_storage_key)
 OR EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating')
 OR EXISTS (SELECT 1 FROM public.event_satellite_observations o WHERE o.storage_key=p_storage_key
   AND (public.stratops_report_references(o.event_id,p_storage_key)
     OR public.stratops_report_references(o.id)))
$$;

CREATE OR REPLACE FUNCTION stratops_maintenance.prune_event_batch(p_conflict boolean, p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  key_name text := CASE WHEN p_conflict THEN 'conflict' ELSE 'working_history' END;
  state stratops_maintenance.controls%ROWTYPE;
  candidate public.events%ROWTYPE;
  checked integer := 0; removed integer := 0; held integer := 0; last_id uuid;
  cutoff timestamptz := now() - CASE WHEN p_conflict THEN interval '72 hours' ELSE interval '7 days' END;
BEGIN
  IF EXISTS(SELECT 1 FROM public.operational_reports WHERE status='generating') THEN
    RETURN jsonb_build_object('enabled',false,'reason','report_generation_in_progress');
  END IF;
  SELECT * INTO state FROM stratops_maintenance.controls WHERE name = key_name FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT state.enabled OR NULLIF(state.backup_reference,'') IS NULL OR state.reviewed_at IS NULL THEN
    RETURN jsonb_build_object('enabled',false,'reason','backup_and_dependency_review_required');
  END IF;
  FOR candidate IN SELECT e.* FROM public.events e
    WHERE public.stratops_conflict_owned(e) = p_conflict AND e.occurred_at <= cutoff
      AND (state.cursor_id IS NULL OR e.id > state.cursor_id)
    ORDER BY e.id LIMIT LEAST(GREATEST(p_limit,1),500) FOR UPDATE SKIP LOCKED
  LOOP
    checked := checked + 1; last_id := candidate.id;
    IF public.stratops_event_has_dependents(candidate.id) THEN held := held + 1;
    ELSE
      DELETE FROM public.events WHERE id = candidate.id;
      removed := removed + 1;
    END IF;
  END LOOP;
  UPDATE stratops_maintenance.controls SET cursor_id = CASE WHEN checked = 0 THEN NULL ELSE last_id END WHERE name = key_name;
  RETURN jsonb_build_object('enabled',true,'checked',checked,'deleted',removed,'held_for_dependencies',held);
END $$;

CREATE OR REPLACE FUNCTION public.stratops_prune_working_history()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE outcome jsonb; raw_count integer := 0;
BEGIN
  outcome := stratops_maintenance.prune_event_batch(false,100);
  IF COALESCE((outcome->>'enabled')::boolean,false) THEN
    WITH candidates AS (
      SELECT r.id FROM public.raw_items r WHERE r.created_at < now() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM public.event_sources s WHERE s.raw_item_id = r.id)
        AND NOT public.stratops_report_references(r.id)
      ORDER BY r.created_at LIMIT 100 FOR UPDATE SKIP LOCKED
    ) DELETE FROM public.raw_items r USING candidates c WHERE r.id = c.id;
    GET DIAGNOSTICS raw_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('events',outcome,'raw_deleted',raw_count);
END $$;

REVOKE ALL ON FUNCTION public.stratops_conflict_owned(public.events),
 public.stratops_report_references(uuid,text), public.stratops_event_has_dependents(uuid),
 public.stratops_satellite_preview_is_pinned(uuid,text), public.stratops_prune_working_history()
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stratops_conflict_owned(public.events),
 public.stratops_report_references(uuid,text), public.stratops_event_has_dependents(uuid),
 public.stratops_satellite_preview_is_pinned(uuid,text), public.stratops_prune_working_history() TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA stratops_maintenance FROM PUBLIC, anon, authenticated;
COMMIT;

-- ONLY after external backups, source/report/S3 dependency review, and EXPLAIN review:
-- UPDATE stratops_maintenance.controls SET enabled=true, backup_reference='YOUR VERIFIED BACKUP REFERENCE', reviewed_at=now()
-- WHERE name IN ('conflict','working_history');
-- Controls are private; ordinary clients and the worker cannot enable them through REST.
