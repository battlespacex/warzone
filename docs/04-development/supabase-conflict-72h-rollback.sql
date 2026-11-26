-- MANUAL rollback. Expired/deleted records require restoration from a backup.
BEGIN;
UPDATE stratops_maintenance.controls SET enabled=false WHERE name IN ('conflict','working_history');
DO $$
DECLARE job_record record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR job_record IN SELECT jobid FROM cron.job WHERE jobname = 'stratops-conflict-retention-72h' LOOP
      PERFORM cron.unschedule(job_record.jobid);
    END LOOP;
  END IF;
END $$;
DROP TRIGGER IF EXISTS stratops_conflict_feed_preserve_age ON public.conflict_feed_items;
DROP TRIGGER IF EXISTS stratops_conflict_event_preserve_age ON public.events;
-- Remove only markers added through this migration's exact URL PLUS source-ID backfill.
UPDATE public.events SET metadata = metadata - 'intelligence_pipeline' - '_conflict_retention_scope_backfill'
WHERE metadata->>'_conflict_retention_scope_backfill' = 'true'
  AND metadata->>'intelligence_pipeline' = 'conflict';
DROP FUNCTION IF EXISTS public.stratops_preserve_conflict_age();
DROP FUNCTION IF EXISTS public.maintain_conflict_intelligence_72h();
COMMIT;
