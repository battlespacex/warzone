-- MANUAL. Restores lifecycle fields only; does not overwrite later operational content.
BEGIN;
UPDATE stratops_maintenance.controls SET enabled=false WHERE name='historical_escalations';
UPDATE public.active_alerts a SET status=b.row_data->>'status',
 started_at=(b.row_data->>'started_at')::timestamptz,expires_at=(b.row_data->>'expires_at')::timestamptz,
 cleared_at=(b.row_data->>'cleared_at')::timestamptz,meta=NULLIF(b.row_data->'meta','null'::jsonb)
FROM stratops_maintenance.alert_backup b WHERE a.id=b.id
 AND a.updated_at IS NOT DISTINCT FROM b.applied_updated_at;
DROP FUNCTION IF EXISTS public.stratops_correct_conflict_alerts(integer);
DROP FUNCTION IF EXISTS public.stratops_archive_stale_escalations(integer);
COMMIT;
-- Keep backup rows for audit. Rows changed after correction require individual review.
