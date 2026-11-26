-- GROUP 4. Foundation prerequisite. No truncation, foreign keys or deduplication deletions.
BEGIN;
CREATE OR REPLACE FUNCTION public.stratops_link_event_sources(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb; event_ref uuid; raw_ref uuid; inserted integer:=0; duplicates integer:=0;
BEGIN
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>1000 THEN RAISE EXCEPTION 'Expected at most 1000 source links'; END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  event_ref:=(row_data->>'event_id')::uuid; raw_ref:=(row_data->>'raw_item_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(event_ref::text||':'||raw_ref::text,0));
  PERFORM 1 FROM public.events WHERE id=event_ref FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source-link event is missing'; END IF;
  PERFORM 1 FROM public.raw_items WHERE id=raw_ref FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source-link raw evidence is missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_sources WHERE event_id=event_ref AND raw_item_id=raw_ref
    AND support_type IS NOT DISTINCT FROM (CASE WHEN row_data ? 'support_type' THEN row_data->>'support_type' ELSE 'supporting' END)) THEN duplicates:=duplicates+1;
  ELSE
   INSERT INTO public.event_sources(event_id,raw_item_id,source_name,source_url,support_type,created_at)
   VALUES(event_ref,raw_ref,row_data->>'source_name',row_data->>'source_url',CASE WHEN row_data ? 'support_type' THEN row_data->>'support_type' ELSE 'supporting' END,COALESCE((row_data->>'created_at')::timestamptz,now()));
   inserted:=inserted+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('inserted_count',inserted,'duplicate_count',duplicates,'atomic',true);
END $$;
CREATE OR REPLACE FUNCTION public.stratops_prune_source_orphans(p_limit integer DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed integer:=0; candidate record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM stratops_maintenance.controls WHERE name='source_orphans'
  AND enabled AND backup_reference IS NOT NULL AND reviewed_at IS NOT NULL) THEN
  RETURN jsonb_build_object('enabled',false,'reason','orphan_export_and_review_required');
 END IF;
 FOR candidate IN
  SELECT s.id,s.event_id,s.raw_item_id FROM public.event_sources s WHERE event_id IS NOT NULL AND raw_item_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id)
   AND NOT EXISTS(SELECT 1 FROM public.raw_items r WHERE r.id=s.raw_item_id)
   AND NOT public.stratops_report_references(s.event_id,s.raw_item_id::text)
  ORDER BY s.id LIMIT LEAST(GREATEST(p_limit,1),5000) FOR UPDATE SKIP LOCKED
 LOOP
  IF pg_try_advisory_xact_lock(hashtextextended(candidate.event_id::text||':'||candidate.raw_item_id::text,0))
   AND NOT EXISTS(SELECT 1 FROM public.events WHERE id=candidate.event_id)
   AND NOT EXISTS(SELECT 1 FROM public.raw_items WHERE id=candidate.raw_item_id)
   AND NOT public.stratops_report_references(candidate.event_id,candidate.raw_item_id::text) THEN
    DELETE FROM public.event_sources WHERE id=candidate.id;
    removed:=removed+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('deleted',removed);
END $$;
REVOKE ALL ON FUNCTION public.stratops_link_event_sources(jsonb),public.stratops_prune_source_orphans(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stratops_link_event_sources(jsonb),public.stratops_prune_source_orphans(integer) TO service_role;
COMMIT;
-- After exporting BOTH-missing rows and reviewing actual counts/plans, enable source_orphans.
-- SELECT public.stratops_prune_source_orphans(1000); -- one reviewed batch, never a full reset
