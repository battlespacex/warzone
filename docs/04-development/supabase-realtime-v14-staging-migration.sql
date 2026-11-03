-- EXECUTABLE STAGING-ONLY PROPOSAL. NOT EXECUTED.
-- Requires the local-only gate installed by supabase-realtime-v14-local-stage-setup.sql.
-- Confirm the target is an isolated local Supabase database before execution.
-- Never use this file with a linked project, production SQL Editor, db push,
-- or production credentials. No application table or row is removed.

BEGIN;
DO $guard$
DECLARE dedupe_attnum smallint;
BEGIN
    IF to_regclass('stratops_v14.local_only_gate') IS NULL THEN
        RAISE EXCEPTION 'V1.4 local-only gate missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stratops_v14.local_only_gate
                   WHERE token = 'isolated-local-supabase-v14') THEN
        RAISE EXCEPTION 'V1.4 local-only gate missing';
    END IF;
    IF to_regclass('public.events') IS NULL THEN
        RAISE EXCEPTION 'public.events missing from isolated staging schema';
    END IF;
    IF (SELECT relreplident FROM pg_class
        WHERE oid = 'public.events'::regclass) <> 'd' THEN
        RAISE EXCEPTION 'events replica identity differs from production DEFAULT';
    END IF;
    SELECT attnum INTO dedupe_attnum FROM pg_attribute
    WHERE attrelid = 'public.events'::regclass
      AND attname = 'dedupe_key' AND NOT attisdropped;
    IF dedupe_attnum IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = 'public.events'::regclass
          AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
          AND i.indkey[0] = dedupe_attnum
    ) THEN
        RAISE EXCEPTION 'events.dedupe_key is not a valid unique conflict target';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.events'::regclass AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION 'Unexpected existing events trigger';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = 'events'
    ) THEN
        RAISE EXCEPTION 'events missing from local supabase_realtime publication';
    END IF;
END;
$guard$;

CREATE FUNCTION public.stratops_skip_identical_ais_event_update()
RETURNS trigger LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    IF OLD.report_type = 'signal'
       AND OLD.source_key LIKE 'ais-%'
       AND OLD.dedupe_key LIKE 'ais-%'
       AND NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER zzzz_stratops_skip_identical_ais_event_update
BEFORE UPDATE ON public.events
FOR EACH ROW
WHEN (OLD.report_type = 'signal'
      AND OLD.source_key LIKE 'ais-%'
      AND OLD.dedupe_key LIKE 'ais-%')
EXECUTE FUNCTION public.stratops_skip_identical_ais_event_update();
COMMIT;
