SELECT i.relname,x.indisvalid,x.indisready,pg_get_indexdef(i.oid),s.idx_scan
FROM pg_class i JOIN pg_index x ON x.indexrelid=i.oid LEFT JOIN pg_stat_user_indexes s ON s.indexrelid=i.oid
WHERE i.relname IN ('idx_tracks_type_category_updated','idx_active_alerts_expiry','idx_active_alerts_recent','stratops_health_events_source_url');
SELECT now() captured_at,relname,n_tup_ins,n_tup_upd,n_tup_del,n_tup_hot_upd FROM pg_stat_user_tables ORDER BY relname;
SELECT has_function_privilege('anon','public.stratops_increment_copernicus_usage(date,jsonb)','EXECUTE') anon_must_be_false;
-- Repeat preflight EXPLAIN plans and compare equivalent workloads. No production speedup is claimed before this comparison.
