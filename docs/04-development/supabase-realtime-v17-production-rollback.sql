-- PRODUCTION ROLLBACK CANDIDATE. DO NOT RUN WITHOUT AN APPROVED RELEASE
-- OR INCIDENT RESPONSE DECISION. Removes only this release's trigger/function.
-- The transaction aborts if the named trigger was replaced or is absent.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
    IF to_regclass('stratops_v14.local_only_gate') IS NOT NULL THEN
        RAISE EXCEPTION 'Local staging database detected; use the staging rollback instead';
    END IF;
    IF to_regclass('public.events') IS NULL THEN
        RAISE EXCEPTION 'public.events is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid='public.events'::regclass
          AND t.tgname='zzzz_stratops_skip_identical_ais_event_update'
          AND NOT t.tgisinternal
          AND t.tgfoid='public.stratops_skip_identical_ais_event_update()'::regprocedure
    ) THEN
        RAISE EXCEPTION 'Expected AIS trigger/function pair is absent or changed';
    END IF;
END;
$guard$;
DROP TRIGGER zzzz_stratops_skip_identical_ais_event_update ON public.events;
DROP FUNCTION public.stratops_skip_identical_ais_event_update();
COMMIT;
