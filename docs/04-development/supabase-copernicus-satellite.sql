-- StratOps Copernicus satellite context schema
-- Apply in Supabase SQL editor before enabling COPERNICUS_ENABLED=true.

create table if not exists public.copernicus_usage_daily (
  utc_date date primary key,
  catalog_requests_attempted integer not null default 0,
  process_requests_attempted integer not null default 0,
  successful_images_generated integer not null default 0,
  estimated_processing_units numeric not null default 0,
  http_429_responses integer not null default 0,
  failed_requests integer not null default 0,
  skipped_events integer not null default 0,
  cache_hits integer not null default 0,
  last_request_at timestamptz,
  rate_limited_until timestamptz,
  last_successful_request_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_satellite_observations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  status text not null default 'pending',
  provider text not null default 'copernicus',
  collection text,
  observation_type text,
  acquisition_time timestamptz,
  event_time_relation text,
  cloud_cover numeric,
  bbox jsonb,
  centre_latitude double precision,
  centre_longitude double precision,
  source_item_id text,
  image_url text,
  storage_key text,
  mime_type text,
  width integer,
  height integer,
  byte_size integer,
  checksum text,
  etag text,
  cache_key text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  error_code text,
  error_message_sanitized text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_satellite_observations_status_check'
  ) then
    alter table public.event_satellite_observations
      add constraint event_satellite_observations_status_check
      check (status in ('pending','searching','processing','available','unavailable','retryable_error','permanent_error','expired'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_satellite_observations_relation_check'
  ) then
    alter table public.event_satellite_observations
      add constraint event_satellite_observations_relation_check
      check (event_time_relation is null or event_time_relation in ('before','after','unknown'));
  end if;
end $$;

create unique index if not exists event_satellite_observations_event_unique_idx
  on public.event_satellite_observations (event_id);

create unique index if not exists event_satellite_observations_event_cache_unique_idx
  on public.event_satellite_observations (event_id, cache_key)
  where cache_key is not null;

create index if not exists event_satellite_observations_status_idx
  on public.event_satellite_observations (status);

create index if not exists event_satellite_observations_expires_idx
  on public.event_satellite_observations (expires_at);

create index if not exists event_satellite_observations_cache_idx
  on public.event_satellite_observations (cache_key)
  where cache_key is not null;

create index if not exists event_satellite_observations_acquisition_idx
  on public.event_satellite_observations (acquisition_time desc);

create index if not exists event_satellite_observations_retry_idx
  on public.event_satellite_observations (status, next_retry_at);

alter table public.copernicus_usage_daily enable row level security;
alter table public.event_satellite_observations enable row level security;

drop policy if exists "service role manages copernicus usage" on public.copernicus_usage_daily;
create policy "service role manages copernicus usage"
  on public.copernicus_usage_daily for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manages satellite observations" on public.event_satellite_observations;
create policy "service role manages satellite observations"
  on public.event_satellite_observations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
