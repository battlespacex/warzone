-- GROUP 4 READ ONLY. These counts have NOT been inferred from table size.
SELECT count(*) total,
 count(*) FILTER(WHERE s.event_id IS NOT NULL AND e.id IS NULL) missing_event,
 count(*) FILTER(WHERE s.raw_item_id IS NOT NULL AND r.id IS NULL) missing_raw,
 count(*) FILTER(WHERE s.event_id IS NOT NULL AND s.raw_item_id IS NOT NULL AND e.id IS NULL AND r.id IS NULL) both_missing,
 count(*) FILTER(WHERE s.event_id IS NULL OR s.raw_item_id IS NULL) incomplete_identifiers
FROM public.event_sources s LEFT JOIN public.events e ON e.id=s.event_id LEFT JOIN public.raw_items r ON r.id=s.raw_item_id;
SELECT event_id,raw_item_id,support_type,count(*) FROM public.event_sources
GROUP BY 1,2,3 HAVING count(*)>1 ORDER BY 4 DESC LIMIT 100;
SELECT s.* FROM public.event_sources s WHERE s.event_id IS NOT NULL AND s.raw_item_id IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id)
AND NOT EXISTS(SELECT 1 FROM public.raw_items r WHERE r.id=s.raw_item_id) ORDER BY s.id LIMIT 100;
-- Do NOT treat singly missing parents or NULL identifiers as proven disposable history.
EXPLAIN (COSTS,VERBOSE) SELECT s.id FROM public.event_sources s
WHERE NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=s.event_id)
AND NOT EXISTS(SELECT 1 FROM public.raw_items r WHERE r.id=s.raw_item_id) LIMIT 1000;
