BEGIN;
DROP FUNCTION IF EXISTS public.stratops_increment_copernicus_usage(date,jsonb);
COMMIT;
-- Accumulated counters remain intact. Worker retains the legacy fallback until code rollback.
-- No DROP INDEX: the three user-created indexes and all pre-existing unique indexes must remain.
-- A separately approved removal of an index created from candidate DDL requires fresh dependency review.
