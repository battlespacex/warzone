-- MANUAL ONLY. First run foundation.sql and sources-migration.sql to restore
-- their original safe helper/prune implementations, with controls OFF.
-- Do not rerun the retirement migration afterwards unless reinstalling deliberately.
BEGIN;
UPDATE stratops_maintenance.controls SET enabled=false;
DROP TRIGGER IF EXISTS stratops_report_lock ON public.operational_reports;
DROP TRIGGER IF EXISTS stratops_snapshot_lock ON public.operational_report_snapshots;
DROP TRIGGER IF EXISTS stratops_report_pins ON public.operational_reports;
DROP TRIGGER IF EXISTS stratops_snapshot_pins ON public.operational_report_snapshots;
DROP TRIGGER IF EXISTS stratops_source_parents ON public.event_sources;
DROP TRIGGER IF EXISTS stratops_preview_receipt ON public.event_satellite_observations;
DROP FUNCTION IF EXISTS stratops_maintenance.invalidate_preview_receipt();
DROP FUNCTION IF EXISTS public.stratops_prune_retired_observations(integer);
DROP FUNCTION IF EXISTS stratops_maintenance.index_report();
DROP FUNCTION IF EXISTS stratops_maintenance.lock_report_write();
DROP FUNCTION IF EXISTS stratops_maintenance.check_source_parents();
DROP FUNCTION IF EXISTS public.stratops_prune_cleared_escalations(integer);
DROP FUNCTION IF EXISTS public.stratops_record_preview_retirement(uuid,text);
COMMIT;
-- Keep private pins/documents/releases/receipts for audit. Never CASCADE.
-- Deleted operational rows need the reviewed external export to restore.
