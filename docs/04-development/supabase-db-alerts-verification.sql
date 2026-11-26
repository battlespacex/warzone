SELECT category,status,count(*),count(*) FILTER(WHERE expires_at IS NULL) no_expiry
FROM public.active_alerts GROUP BY 1,2;
SELECT count(*) AS incorrect_owned_expiry FROM public.active_alerts a
JOIN public.events e ON a.alert_key=e.id::text WHERE a.category='escalation'
AND public.stratops_conflict_owned(e) AND a.expires_at IS DISTINCT FROM e.occurred_at+interval '72 hours';
SELECT count(*) AS corrections_backed_up FROM stratops_maintenance.alert_backup;
SELECT count(*) AS expired_still_active FROM public.active_alerts
WHERE meta->>'intelligence_pipeline'='conflict' AND status='active' AND expires_at<=now();
