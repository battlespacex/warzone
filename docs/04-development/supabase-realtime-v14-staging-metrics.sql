-- READ-ONLY. Run against the isolated local database before and after each
-- replay phase; compare deltas, not cumulative counts. Other writers must be off.

SELECT clock_timestamp() AS sampled_at, relname,
       n_tup_ins, n_tup_upd, n_tup_del,
       n_dead_tup
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY relname;

SELECT clock_timestamp() AS sampled_at, wal_bytes, wal_records
FROM pg_stat_wal;

SELECT t.relname AS table_name, ix.relname AS index_name,
       i.indisunique AS is_unique, i.indisvalid AS is_valid,
       i.indisready AS is_ready, i.indpred IS NULL AS is_nonpartial,
       pg_get_indexdef(ix.oid) AS index_definition
FROM pg_index i
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ix ON ix.oid = i.indexrelid
WHERE n.nspname = 'public'
  AND t.relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY t.relname, ix.relname;

SELECT t.tgrelid::regclass AS table_name, t.tgname,
       pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
WHERE t.tgrelid IN ('public.events'::regclass, 'public.tracks'::regclass)
  AND NOT t.tgisinternal
ORDER BY 1, 2;

SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY tablename;

SELECT c.relname AS table_name, c.relreplident AS replica_identity
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('events', 'tracks', 'aircraft_tracks_log', 'naval_tracks_log')
ORDER BY c.relname;
