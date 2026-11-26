-- GROUP 3. Foundation prerequisite. Installs bounded correction; does not run it.
BEGIN;
CREATE TABLE IF NOT EXISTS stratops_maintenance.alert_backup (
 id uuid PRIMARY KEY, row_data jsonb NOT NULL, captured_at timestamptz NOT NULL DEFAULT now(), applied_updated_at timestamptz
);
REVOKE ALL ON stratops_maintenance.alert_backup FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.stratops_correct_conflict_alerts(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate record; corrected integer:=0; lifetime timestamptz; applied timestamptz;
BEGIN
 FOR candidate IN SELECT a.id,to_jsonb(a) old_row,e.occurred_at,e.id event_id
  FROM public.active_alerts a JOIN public.events e ON a.alert_key=e.id::text
  WHERE a.category='escalation' AND public.stratops_conflict_owned(e)
   AND (a.expires_at IS NULL OR a.expires_at<>e.occurred_at+interval '72 hours')
  LIMIT LEAST(GREATEST(p_limit,1),1000) FOR UPDATE OF a SKIP LOCKED
 LOOP
  INSERT INTO stratops_maintenance.alert_backup(id,row_data) VALUES(candidate.id,candidate.old_row) ON CONFLICT DO NOTHING;
  lifetime:=candidate.occurred_at+interval '72 hours';
  UPDATE public.active_alerts SET started_at=candidate.occurred_at,expires_at=lifetime,
   status=CASE WHEN lifetime<=now() AND status='active' THEN 'cleared' ELSE status END,
   cleared_at=CASE WHEN lifetime<=now() AND status='active' THEN now() ELSE cleared_at END,
   meta=COALESCE(meta,'{}'::jsonb)||jsonb_build_object('intelligence_pipeline','conflict','event_id',candidate.event_id,
    'original_event_at',candidate.occurred_at),updated_at=now() WHERE id=candidate.id RETURNING updated_at INTO applied;
  UPDATE stratops_maintenance.alert_backup SET applied_updated_at=applied WHERE id=candidate.id;
  corrected:=corrected+1;
 END LOOP;
 RETURN jsonb_build_object('corrected',corrected);
END $$;

CREATE OR REPLACE FUNCTION public.stratops_archive_stale_escalations(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE candidate public.active_alerts%ROWTYPE; changed integer:=0; applied timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM stratops_maintenance.controls WHERE name='historical_escalations'
  AND enabled AND backup_reference IS NOT NULL AND reviewed_at IS NOT NULL) THEN
  RETURN jsonb_build_object('enabled',false,'reason','separate_historical_review_required');
 END IF;
 FOR candidate IN SELECT a.* FROM public.active_alerts a
  WHERE category='escalation' AND status='active' AND expires_at IS NULL
   AND started_at<now()-interval '30 days' AND updated_at<now()-interval '30 days'
   AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id::text=a.alert_key)
  ORDER BY updated_at LIMIT LEAST(GREATEST(p_limit,1),1000) FOR UPDATE SKIP LOCKED
 LOOP
  INSERT INTO stratops_maintenance.alert_backup(id,row_data) VALUES(candidate.id,to_jsonb(candidate)) ON CONFLICT DO NOTHING;
  UPDATE public.active_alerts SET status='cleared',cleared_at=now(),
   meta=COALESCE(meta,'{}'::jsonb)||'{"maintenance_reason":"reviewed_stale_orphan_escalation"}'::jsonb,updated_at=now()
   WHERE id=candidate.id RETURNING updated_at INTO applied;
  UPDATE stratops_maintenance.alert_backup SET applied_updated_at=applied WHERE id=candidate.id;
  changed:=changed+1;
 END LOOP;
 RETURN jsonb_build_object('cleared',changed,'deleted',0);
END $$;
REVOKE ALL ON FUNCTION public.stratops_correct_conflict_alerts(integer),public.stratops_archive_stale_escalations(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stratops_correct_conflict_alerts(integer),public.stratops_archive_stale_escalations(integer) TO service_role;
COMMIT;
-- After reviewing preflight/export: SELECT public.stratops_correct_conflict_alerts(500);
-- Historical orphans require a SEPARATE reviewed control enablement, then bounded calls.
