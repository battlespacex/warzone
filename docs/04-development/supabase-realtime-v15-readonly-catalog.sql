-- Run READ ONLY in the production Supabase SQL Editor; export result as CSV.
-- Reveals schema metadata, not table rows or database credentials.
SELECT c.relname AS table_name, a.attnum AS ordinal, a.attname AS column_name,
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null, a.attidentity AS identity_kind,
       a.attgenerated AS generated_kind,
       pg_get_expr(d.adbin, d.adrelid) AS default_expression,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'public'
  AND c.relname IN ('events','tracks','aircraft_tracks_log','naval_tracks_log')
ORDER BY c.relname, a.attnum;

-- Export this result separately to verify actual index readiness.
SELECT t.relname AS table_name, ix.relname AS index_name,
       x.indisunique AS is_unique, x.indisvalid AS is_valid,
       x.indisready AS is_ready, x.indpred IS NULL AS is_nonpartial,
       pg_get_indexdef(ix.oid) AS index_definition
FROM pg_index x
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ix ON ix.oid = x.indexrelid
WHERE n.nspname = 'public'
  AND t.relname IN ('events','tracks','aircraft_tracks_log','naval_tracks_log')
ORDER BY t.relname, ix.relname;

-- Export separately if any of the four tables has RLS enabled.
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('events','tracks','aircraft_tracks_log','naval_tracks_log')
ORDER BY tablename, policyname;
