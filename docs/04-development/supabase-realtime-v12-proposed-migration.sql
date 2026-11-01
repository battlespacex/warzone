-- V1.2 PROPOSAL ONLY. Read-only catalog inspection is executable below.
-- Do not execute the commented migration against production without schema review,
-- staging tests, explicit approval, and a coordinated worker/frontend release.
-- The Supabase REST OpenAPI response does not expose unique indexes, triggers,
-- publication membership, or the effects of existing trigger functions.
-- User-run production SQL reports relevant unique indexes, no non-internal
-- triggers, DEFAULT replica identity, and only events/tracks in Realtime.
-- Exact index/constraint definitions still require text or CSV review.

-- 1. Verify actual columns and defaults.
SELECT c.relname AS table_name, a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY c.relname, a.attnum;

-- 2. Verify all conflict targets, uniqueness, and primary keys.
SELECT c.relname AS table_name, con.conname AS constraint_name,
       con.contype AS constraint_type, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY c.relname, con.conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY tablename, indexname;

-- 3. Review all non-internal row and statement triggers before changing UPSERTs.
-- In particular, an INSERT trigger may run even on an INSERT ... ON CONFLICT path.
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled,
       pg_get_triggerdef(t.oid) AS trigger_definition,
       t.tgfoid::regprocedure AS function_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- 4. Verify publication membership and replica identity.
SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE schemaname = 'public'
  AND tablename IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY pubname, tablename;

SELECT c.relname AS table_name, c.relreplident AS replica_identity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY c.relname;

/*
CANDIDATE MIGRATION, NOT EXECUTABLE IN THIS FILE.
Only prepare an executable version after verifying the catalog results above,
the order and side effects of existing triggers, and staging behavior.

The current AIS worker upserts public.events by dedupe_key. This guard would
suppress only a truly identical AIS signal UPDATE; any changed timestamp,
position, metadata, source attribution, status, or other column still updates.
It does not touch tracks or history, whose heartbeat fields are meaningful.

BEGIN;

-- Abort if production/staging drifted from the reviewed schema. A single-column,
-- non-partial valid unique index on dedupe_key is required by the AIS UPSERT.
DO $guard$
DECLARE dedupe_attnum smallint;
BEGIN
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
        RAISE EXCEPTION 'events.dedupe_key is not a valid single-column unique conflict target';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.events'::regclass AND NOT t.tgisinternal
    ) THEN
        RAISE EXCEPTION 'Unexpected existing events trigger; review before installing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = 'events'
    ) THEN
        RAISE EXCEPTION 'events publication membership changed; review before installing';
    END IF;
END;
$guard$;

CREATE FUNCTION public.stratops_skip_identical_ais_event_update()
RETURNS trigger
LANGUAGE plpgsql
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

-- Name/order must be checked against existing BEFORE UPDATE triggers.
CREATE TRIGGER zzzz_stratops_skip_identical_ais_event_update
BEFORE UPDATE ON public.events
FOR EACH ROW
WHEN (OLD.report_type = 'signal'
      AND OLD.source_key LIKE 'ais-%'
      AND OLD.dedupe_key LIKE 'ais-%')
EXECUTE FUNCTION public.stratops_skip_identical_ais_event_update();

COMMIT;

STAGING REGRESSION CASES:
  absent vessel -> INSERT; repeat exact vessel -> no UPDATE/WAL message;
  changed lat/lon -> UPDATE; newer occurred_at with same position -> UPDATE;
  changed metadata/source/status -> UPDATE; old source timestamp remains old;
  unrelated signal and aircraft events -> unchanged legacy behavior;
  DELETE/cleanup -> unchanged; two concurrent workers -> no duplicate row;
  worker error and transaction rollback -> no lost valid observation.
Check affected row counts, trigger side effects, Postgres Changes deliveries,
API/CTR/AOI/reporting behavior, the 90-second missing-contact grace, and the
45-minute source-stale naval purge.

ROLLBACK AFTER APPROVAL/RELEASE:
BEGIN;
DROP TRIGGER zzzz_stratops_skip_identical_ais_event_update ON public.events;
DROP FUNCTION public.stratops_skip_identical_ais_event_update();
COMMIT;
*/
