-- GROUP 3 READ ONLY. Export affected rows before enabling historical corrections.
SELECT category,status,count(*),count(*) FILTER(WHERE expires_at IS NULL) no_expiry,
 count(*) FILTER(WHERE updated_at<now()-interval '30 days') unchanged_30d
FROM public.active_alerts GROUP BY 1,2 ORDER BY 3 DESC;
-- Proven conflict parents; generic alert category alone is not ownership.
SELECT a.id,a.alert_key,a.started_at,a.expires_at,e.occurred_at,
 e.occurred_at+interval '72 hours' proposed_expiry
FROM public.active_alerts a JOIN public.events e ON a.alert_key=e.id::text
WHERE a.category='escalation' AND (e.report_type='conflict' OR e.dedupe_key LIKE 'conflict-feed:%'
 OR e.metadata->>'intelligence_pipeline'='conflict') AND a.expires_at IS NULL;
-- Separate MANUAL review population. Not assumed to be conflict-owned.
SELECT count(*) AS stale_orphan_escalations FROM public.active_alerts a
WHERE a.category='escalation' AND a.status='active' AND a.expires_at IS NULL
 AND a.started_at<now()-interval '30 days' AND a.updated_at<now()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id::text=a.alert_key);
SELECT * FROM public.active_alerts a WHERE category='escalation' AND status='active'
 AND expires_at IS NULL AND started_at<now()-interval '30 days' AND updated_at<now()-interval '30 days'
 AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id::text=a.alert_key)
ORDER BY updated_at LIMIT 100;
