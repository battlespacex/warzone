-- Production Copernicus product lookup index: inspect first, apply only if absent.
-- Run this read-only query in the production Supabase SQL editor or a direct SQL session.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'event_satellite_observations'
order by indexname;

-- Compare every returned definition. An equivalent index has source_item_id as
-- its leading key and covers rows with status = 'available'. Do not add another.
-- If no equivalent index exists, run the statement below separately, outside
-- a transaction block. Do not execute the entire schema setup script online.
--
-- create index concurrently if not exists event_satellite_observations_source_item_idx
--   on public.event_satellite_observations (source_item_id)
--   where status = 'available' and source_item_id is not null;
