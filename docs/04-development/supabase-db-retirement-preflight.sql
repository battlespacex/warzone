-- READ ONLY, AFTER retirement installation; controls stay OFF.
-- Exact expanded source policy. Pre-install both-missing counts are not a delete target.
SELECT count(*) source_retirement_candidates FROM public.event_sources s
WHERE s.event_id IS NOT NULL AND s.raw_item_id IS NOT NULL
AND s.created_at<now()-interval '7 days'
AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id)
AND NOT public.stratops_report_references(s.id)
AND NOT public.stratops_report_references(s.event_id,s.raw_item_id::text);
SELECT count(*) observation_retirement_candidates FROM public.event_satellite_observations o
WHERE o.status='expired' AND o.expires_at<=now()-interval '7 days'
AND o.storage_key IS NULL AND o.image_url IS NULL
AND EXISTS(SELECT 1 FROM stratops_maintenance.preview_retirements r WHERE r.observation_id=o.id)
AND NOT public.stratops_report_references(o.id)
AND NOT public.stratops_report_references(o.event_id);
SELECT count(*) cleared_escalation_candidates FROM public.active_alerts a
WHERE category='escalation' AND status='cleared'
AND cleared_at<now()-interval '90 days' AND updated_at<now()-interval '90 days'
AND (meta->>'intelligence_pipeline'='conflict' OR meta->>'maintenance_reason'='reviewed_stale_orphan_escalation')
AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id::text=a.alert_key)
AND NOT public.stratops_report_references(a.id,a.alert_key);
SELECT count(*) generating_reports_must_be_zero FROM public.operational_reports WHERE status='generating';
SELECT name,enabled,backup_reference IS NOT NULL has_backup_reference FROM stratops_maintenance.controls ORDER BY name;
