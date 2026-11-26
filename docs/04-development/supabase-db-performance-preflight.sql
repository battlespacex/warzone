-- GROUP 5 READ ONLY. Complete index inventory and representative NON-executing plans.
SELECT c.relname,i.relname index_name,x.indisvalid,x.indisready,x.indisunique,
 pg_size_pretty(pg_relation_size(i.oid)) size,pg_get_indexdef(i.oid) definition,
 EXISTS(SELECT 1 FROM pg_constraint WHERE conindid=i.oid) constraint_backed
FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
WHERE c.relnamespace='public'::regnamespace ORDER BY c.relname,i.relname;
-- These three were manually created successfully. VERIFY; do not recreate them.
SELECT i.relname,x.indisvalid,x.indisready,pg_get_indexdef(i.oid),s.idx_scan
FROM pg_class i JOIN pg_index x ON x.indexrelid=i.oid LEFT JOIN pg_stat_user_indexes s ON s.indexrelid=i.oid
WHERE i.relname IN ('idx_tracks_type_category_updated','idx_active_alerts_expiry','idx_active_alerts_recent');
EXPLAIN (COSTS,VERBOSE) SELECT * FROM public.tracks WHERE track_type='aircraft' AND category='military'
AND updated_at>=now()-interval '30 minutes' ORDER BY updated_at DESC LIMIT 500;
EXPLAIN (COSTS,VERBOSE) SELECT id FROM public.active_alerts WHERE status='active' AND expires_at IS NOT NULL AND expires_at<now();
EXPLAIN (COSTS,VERBOSE) SELECT * FROM public.active_alerts WHERE status='active' ORDER BY updated_at DESC LIMIT 100;
SELECT relname,n_live_tup,n_dead_tup,n_tup_ins,n_tup_upd,n_tup_del,n_tup_hot_upd,
 last_autovacuum,last_autoanalyze,pg_total_relation_size(relid) total_bytes
FROM pg_stat_user_tables ORDER BY total_bytes DESC;
-- Dead-row estimates and index size do not prove bloat. Do not VACUUM FULL/REINDEX from these alone.
SELECT extname FROM pg_extension WHERE extname IN ('pg_stat_statements','pgstattuple');
-- If pg_stat_statements is present, export calls/rows/timing/WAL with captured_at before and after equivalent workloads.
-- Do not reset statistics: audit exports are cumulative and the supplied 22m28s sample is not an API-request count.

-- Optional missing-index candidate: output DDL ONLY if no usable leading source_url index exists.
SELECT 'CREATE INDEX CONCURRENTLY stratops_health_events_source_url ON public.events(source_url);' proposed_ddl
WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
 WHERE i.indrelid='public.events'::regclass AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND a.attname='source_url');
-- Existing event_sources(event_id), event_sources(raw_item_id), raw_items(hash), and conflict published-time indexes are reused.
-- Identical events dedupe-key indexes and the redundant-looking naval MMSI index require constraint/dependency review; no DROP is supplied.
