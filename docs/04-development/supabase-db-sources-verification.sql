-- Run the preflight counts again. Singly missing/NULL-parent records must remain preserved.
SELECT event_id,raw_item_id,support_type,count(*) FROM public.event_sources
GROUP BY 1,2,3 HAVING count(*)>1 ORDER BY 4 DESC LIMIT 100;
SELECT has_function_privilege('anon','public.stratops_link_event_sources(jsonb)','EXECUTE') anon_must_be_false,
 has_function_privilege('service_role','public.stratops_link_event_sources(jsonb)','EXECUTE') worker_must_be_true;
SELECT * FROM stratops_maintenance.controls WHERE name='source_orphans';
