-- READ ONLY. Run in the Warzone production Supabase SQL Editor before any
-- deployment approval. Export the single result row as CSV or copy its text.
-- This checks current catalog state; it does not read operational rows.
WITH target_tables(table_name) AS (
    VALUES ('events'), ('tracks'), ('aircraft_tracks_log'), ('naval_tracks_log')
),
key_targets(table_name, column_name) AS (
    VALUES ('events','dedupe_key'), ('events','source_key'),
           ('tracks','track_key'), ('aircraft_tracks_log','track_key'),
           ('naval_tracks_log','mmsi')
),
key_checks AS (
    SELECT k.table_name, k.column_name, EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid
        WHERE i.indrelid = to_regclass(format('public.%I', k.table_name))
          AND a.attname = k.column_name AND NOT a.attisdropped
          AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
          AND i.indkey[0] = a.attnum
    ) AS valid_unique_index
    FROM key_targets k
),
tables AS (
    SELECT c.oid, c.relname, c.relreplident, c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (SELECT table_name FROM target_tables)
      AND c.relkind IN ('r','p')
),
publication AS (
    SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename IN (SELECT table_name FROM target_tables)
)
SELECT clock_timestamp() AS checked_at,
       current_database() AS database_name,
       current_setting('server_version') AS postgres_version,
       (SELECT count(*) FROM tables) AS table_count_expected_4,
       (SELECT count(*) FROM pg_attribute a JOIN tables t ON t.oid = a.attrelid
        WHERE a.attnum > 0 AND NOT a.attisdropped) AS column_count_expected_87,
       (SELECT count(*) FROM pg_index i JOIN tables t ON t.oid = i.indrelid)
           AS index_count_expected_20,
       (SELECT count(*) FROM pg_constraint c JOIN tables t ON t.oid = c.conrelid)
           AS constraint_count_expected_7,
       (SELECT count(*) FROM pg_index i JOIN tables t ON t.oid = i.indrelid
        WHERE NOT i.indisvalid OR NOT i.indisready) AS invalid_or_unready_indexes_expected_0,
       (SELECT jsonb_object_agg(table_name || '.' || column_name, valid_unique_index)
        FROM key_checks) AS conflict_target_checks_all_true,
       (SELECT count(*) FROM pg_trigger tr JOIN tables t ON t.oid = tr.tgrelid
        WHERE NOT tr.tgisinternal) AS noninternal_trigger_count_expected_0,
       (SELECT count(*) FROM tables WHERE relreplident = 'd')
           AS default_replica_identity_count_expected_4,
       (SELECT jsonb_object_agg(relname, relrowsecurity) FROM tables)
           AS rls_flags_expected_events_tracks_false_histories_true,
       (SELECT coalesce(array_agg(tablename ORDER BY tablename), ARRAY[]::name[])
        FROM publication) AS realtime_members_expected_events_tracks,
       (SELECT pubupdate AND NOT puballtables FROM pg_publication
        WHERE pubname = 'supabase_realtime') AS realtime_update_enabled_expected_true,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='stratops_skip_identical_ais_event_update')
           AS candidate_function_count_expected_0,
       (SELECT count(*) FROM pg_attribute a
        WHERE a.attrelid=to_regclass('public.events')
          AND a.attname IN ('dedupe_key','source_key','report_type')
          AND a.atttypid='text'::regtype AND NOT a.attisdropped)
           AS required_events_text_columns_expected_3;
