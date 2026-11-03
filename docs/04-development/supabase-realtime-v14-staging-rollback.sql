-- EXECUTABLE STAGING-ONLY ROLLBACK PROPOSAL. NOT EXECUTED.
-- Removes only the V1.4 trigger/function from an isolated local Supabase stack.
-- Do not use with a linked or production project.

BEGIN;
DO $guard$
BEGIN
    IF to_regclass('stratops_v14.local_only_gate') IS NULL THEN
        RAISE EXCEPTION 'V1.4 local-only gate missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stratops_v14.local_only_gate
                   WHERE token = 'isolated-local-supabase-v14') THEN
        RAISE EXCEPTION 'V1.4 local-only gate missing';
    END IF;
END;
$guard$;
DROP TRIGGER zzzz_stratops_skip_identical_ais_event_update ON public.events;
DROP FUNCTION public.stratops_skip_identical_ais_event_update();
COMMIT;
