-- MANUAL ONLY. Run preflight first and review existing triggers/jobs.
-- This transaction installs protections; it does not run cleanup or delete records.
BEGIN;

-- Establish legacy ownership only through an exact URL AND the old promoter's source-ID metadata.
-- No blanket news/OSINT scope; explicit markers on new events use the same policy.
UPDATE public.events e SET metadata = COALESCE(e.metadata, '{}'::jsonb) ||
  '{"intelligence_pipeline":"conflict","_conflict_retention_scope_backfill":true}'::jsonb
WHERE e.report_type IN ('news','osint','reddit','strike')
  AND (e.metadata IS NULL OR jsonb_typeof(e.metadata) = 'object')
  AND e.metadata->>'intelligence_pipeline' IS NULL
  AND EXISTS (SELECT 1 FROM public.conflict_feed_items f
    WHERE f.url = e.source_url AND f.is_conflict_relevant IS TRUE
      AND f.source_id IS NOT NULL AND e.metadata->>'source_id' = f.source_id);

-- Index creation is staged separately in the performance group (CONCURRENTLY).
-- Existing unique upsert targets must already exist; never rebuild them under a blocking transaction.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
  WHERE i.indrelid='public.conflict_feed_items'::regclass AND i.indisunique AND i.indisvalid
   AND i.indpred IS NULL AND i.indnkeyatts=1 AND a.attname='url') THEN
  RAISE EXCEPTION 'Missing unique conflict_feed_items.url index: review preflight and concurrent indexing first';
 END IF;
 IF to_regprocedure('stratops_maintenance.prune_event_batch(boolean,integer)') IS NULL THEN
  RAISE EXCEPTION 'Apply supabase-db-health-foundation.sql first';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.stratops_preserve_conflict_age()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'conflict_feed_items' THEN
    NEW.published_at := LEAST(OLD.published_at, NEW.published_at);
    IF OLD.raw->>'_original_occurred_at' IS NOT NULL THEN
      NEW.raw := jsonb_set(COALESCE(NEW.raw, '{}'::jsonb), '{_original_occurred_at}',
        to_jsonb(LEAST((OLD.raw->>'_original_occurred_at')::timestamptz,
          (NEW.raw->>'_original_occurred_at')::timestamptz)));
    END IF;
  ELSIF OLD.report_type = 'conflict' OR OLD.dedupe_key LIKE 'conflict-feed:%' OR OLD.metadata->>'intelligence_pipeline' = 'conflict'
     OR NEW.report_type = 'conflict' OR NEW.dedupe_key LIKE 'conflict-feed:%' OR NEW.metadata->>'intelligence_pipeline' = 'conflict' THEN
    NEW.occurred_at := LEAST(OLD.occurred_at, NEW.occurred_at);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stratops_conflict_feed_preserve_age ON public.conflict_feed_items;
CREATE TRIGGER stratops_conflict_feed_preserve_age BEFORE UPDATE ON public.conflict_feed_items
FOR EACH ROW EXECUTE FUNCTION public.stratops_preserve_conflict_age();
DROP TRIGGER IF EXISTS stratops_conflict_event_preserve_age ON public.events;
CREATE TRIGGER stratops_conflict_event_preserve_age BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.stratops_preserve_conflict_age();

CREATE OR REPLACE FUNCTION public.maintain_conflict_intelligence_72h()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 snapshot_at timestamptz := now(); event_result jsonb; expired_reports integer := 0;
 retained_events bigint; retained_reports bigint; regions jsonb;
BEGIN
 event_result := stratops_maintenance.prune_event_batch(true,100);
 IF COALESCE((event_result->>'enabled')::boolean,false) THEN
  WITH wire_head AS (
   SELECT id FROM public.conflict_feed_items WHERE published_at IS NOT NULL
   ORDER BY published_at DESC, id DESC LIMIT 300
  ), candidates AS (
   SELECT f.id FROM public.conflict_feed_items f
   WHERE f.published_at <= snapshot_at - interval '72 hours'
    AND NOT EXISTS (SELECT 1 FROM wire_head w WHERE w.id=f.id)
    AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.source_url=f.url)
    AND NOT public.stratops_report_references(f.id,f.url)
   ORDER BY f.published_at LIMIT 250 FOR UPDATE SKIP LOCKED
  ) DELETE FROM public.conflict_feed_items f USING candidates c WHERE f.id=c.id;
  GET DIAGNOSTICS expired_reports = ROW_COUNT;
 END IF;
 SELECT count(*) INTO retained_events FROM public.events e
  WHERE public.stratops_conflict_owned(e) AND occurred_at > snapshot_at-interval '72 hours' AND occurred_at <= snapshot_at;
 SELECT count(*) INTO retained_reports FROM public.conflict_feed_items
  WHERE published_at > snapshot_at-interval '72 hours' AND published_at <= snapshot_at;
 SELECT COALESCE(jsonb_object_agg(region,total),'{}'::jsonb) INTO regions FROM (
  SELECT COALESCE(NULLIF(metadata->'normalization'->>'event_region',''),NULLIF(country_code,''),'unassigned') region,count(*) total
  FROM public.events e WHERE public.stratops_conflict_owned(e)
   AND occurred_at > snapshot_at-interval '72 hours' AND occurred_at <= snapshot_at GROUP BY 1
 ) distribution;
 RETURN jsonb_build_object('events',event_result,'expired_events',event_result->'deleted','expired_reports',expired_reports,
  'retained_events',retained_events,'retained_reports',retained_reports,'regions',regions);
END $$;
REVOKE ALL ON FUNCTION public.maintain_conflict_intelligence_72h() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_conflict_intelligence_72h() TO service_role;

-- No extension is installed here. The worker also calls this function after conflict sync.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('stratops-conflict-retention-72h', '*/15 * * * *',
      'select public.maintain_conflict_intelligence_72h();');
  ELSE
    RAISE NOTICE 'pg_cron unavailable: cleanup will run after worker conflict sync.';
  END IF;
END $$;
COMMIT;
