-- PRODUCTION RELEASE CANDIDATE. DO NOT RUN UNTIL A FRESH READ-ONLY V1.7
-- PREFLIGHT HAS BEEN REVIEWED AND THE USER EXPLICITLY APPROVES DEPLOYMENT.
-- The trigger function and trigger definition below match the V1.4 local
-- staging migration that passed the V1.6 replay. No rows or tables are removed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
DECLARE dedupe_attnum smallint;
BEGIN
    IF to_regclass('stratops_v14.local_only_gate') IS NOT NULL THEN
        RAISE EXCEPTION 'Local staging database detected; use the staging migration instead';
    END IF;
    IF to_regclass('public.events') IS NULL THEN
        RAISE EXCEPTION 'public.events is missing';
    END IF;
    IF (SELECT relreplident FROM pg_class
        WHERE oid = 'public.events'::regclass) <> 'd' THEN
        RAISE EXCEPTION 'events replica identity differs from reviewed DEFAULT';
    END IF;
    IF (SELECT count(*) FROM pg_attribute
        WHERE attrelid='public.events'::regclass
          AND attname IN ('dedupe_key','source_key','report_type')
          AND atttypid='text'::regtype AND NOT attisdropped) <> 3 THEN
        RAISE EXCEPTION 'Required events columns differ from reviewed text columns';
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
        RAISE EXCEPTION 'Unexpected existing events trigger; review before installing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='stratops_skip_identical_ais_event_update'
    ) THEN
        RAISE EXCEPTION 'Candidate function already exists; review before installing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = 'events'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_publication
        WHERE pubname='supabase_realtime' AND pubupdate AND NOT puballtables
    ) THEN
        RAISE EXCEPTION 'events Realtime UPDATE publication differs from reviewed configuration';
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
