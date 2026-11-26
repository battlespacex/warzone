-- Reverse dependency order: roll back alert/source groups and conflict maintenance first.
BEGIN;
UPDATE stratops_maintenance.controls SET enabled=false;
DROP FUNCTION IF EXISTS public.stratops_prune_working_history();
DROP FUNCTION IF EXISTS stratops_maintenance.prune_event_batch(boolean,integer);
DROP FUNCTION IF EXISTS public.stratops_satellite_preview_is_pinned(uuid,text);
DROP FUNCTION IF EXISTS public.stratops_event_has_dependents(uuid);
DROP FUNCTION IF EXISTS public.stratops_report_references(uuid,text);
DROP FUNCTION IF EXISTS public.stratops_conflict_owned(public.events);
COMMIT;
-- Keep private backup/control tables for audit. No schema CASCADE, user data or index drops.
