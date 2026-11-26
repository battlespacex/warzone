-- GROUP 5 MANUAL ONLY. No index is blindly recreated and no existing index is dropped.
-- First run preflight. Execute any resulting CREATE INDEX CONCURRENTLY statement ALONE,
-- outside a transaction, only after reviewing its plan and existing equivalent indexes.
BEGIN;
CREATE OR REPLACE FUNCTION public.stratops_increment_copernicus_usage(p_date date,p_deltas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE field text; amount numeric; updated_row public.copernicus_usage_daily%ROWTYPE;
BEGIN
 FOR field IN SELECT jsonb_object_keys(p_deltas) LOOP
  IF field NOT IN ('catalog_requests_attempted','process_requests_attempted','successful_images_generated',
   'estimated_processing_units','http_429_responses','failed_requests','skipped_events','cache_hits','last_error_code') THEN
   RAISE EXCEPTION 'Unknown usage counter';
  END IF;
  IF field<>'last_error_code' THEN
   amount:=(p_deltas->>field)::numeric;
   IF amount<0 THEN RAISE EXCEPTION 'Usage counter cannot decrease'; END IF;
  END IF;
 END LOOP;
 INSERT INTO public.copernicus_usage_daily(utc_date) VALUES(p_date) ON CONFLICT DO NOTHING;
 UPDATE public.copernicus_usage_daily SET
  catalog_requests_attempted=catalog_requests_attempted+COALESCE((p_deltas->>'catalog_requests_attempted')::integer,0),
  process_requests_attempted=process_requests_attempted+COALESCE((p_deltas->>'process_requests_attempted')::integer,0),
  successful_images_generated=successful_images_generated+COALESCE((p_deltas->>'successful_images_generated')::integer,0),
  estimated_processing_units=estimated_processing_units+COALESCE((p_deltas->>'estimated_processing_units')::numeric,0),
  http_429_responses=http_429_responses+COALESCE((p_deltas->>'http_429_responses')::integer,0),
  failed_requests=failed_requests+COALESCE((p_deltas->>'failed_requests')::integer,0),
  skipped_events=skipped_events+COALESCE((p_deltas->>'skipped_events')::integer,0),
  cache_hits=cache_hits+COALESCE((p_deltas->>'cache_hits')::integer,0),
  last_request_at=CASE WHEN p_deltas ?| ARRAY['catalog_requests_attempted','process_requests_attempted','failed_requests','http_429_responses'] THEN now() ELSE last_request_at END,
  last_successful_request_at=CASE WHEN p_deltas ?| ARRAY['successful_images_generated','cache_hits'] THEN now() ELSE last_successful_request_at END,
  last_error_code=CASE WHEN p_deltas ? 'last_error_code' THEN left(p_deltas->>'last_error_code',80) ELSE last_error_code END,
  updated_at=now() WHERE utc_date=p_date RETURNING * INTO updated_row;
 RETURN to_jsonb(updated_row);
END $$;
REVOKE ALL ON FUNCTION public.stratops_increment_copernicus_usage(date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stratops_increment_copernicus_usage(date,jsonb) TO service_role;
COMMIT;
-- Atomic counters supplement, and do not replace, existing provider quota CAS/admission guards.
