BEGIN;
UPDATE stratops_maintenance.controls SET enabled=false WHERE name='source_orphans';
DROP FUNCTION IF EXISTS public.stratops_prune_source_orphans(integer);
DROP FUNCTION IF EXISTS public.stratops_link_event_sources(jsonb);
COMMIT;
-- Deleted orphan rows cannot be reconstructed: restore the reviewed external export if required.
-- No historical source-link deletion or new uniqueness constraint is installed by this migration.
