-- StratOps core Supabase schema
-- Run this in Supabase Dashboard -> SQL Editor.
-- It creates the public tables used by the frontend, worker, API, and billing routes.

create extension if not exists pgcrypto;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique,
  source_key text unique,
  category text default 'signal',
  subcategory text,
  subtype text,
  title text not null default '',
  summary text,
  source_name text,
  source_url text,
  occurred_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  expires_at timestamptz,
  lat double precision,
  lon double precision,
  display_lat double precision,
  display_lon double precision,
  location_label text,
  country text,
  country_code text,
  region text,
  actor_side text,
  target_side text,
  weapon_type text,
  target_type text,
  impact_type text,
  report_type text,
  severity text,
  status text default 'signal',
  confidence integer default 50,
  priority_score integer,
  source_count integer default 1,
  airspace_status text default 'unknown',
  cyber_status text default 'unknown',
  fir_code text,
  tags text[] default '{}',
  metadata jsonb default '{}'::jsonb,
  meta jsonb default '{}'::jsonb,
  feed_name text
);

create index if not exists events_occurred_at_idx on public.events (occurred_at desc);
create index if not exists events_updated_at_idx on public.events (updated_at desc);
create index if not exists events_category_idx on public.events (category);
create index if not exists events_report_type_idx on public.events (report_type);
create index if not exists events_location_idx on public.events (lat, lon);

create table if not exists public.active_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text unique not null,
  category text default 'alert',
  region text,
  title text not null default '',
  summary text,
  status text default 'active',
  source_name text,
  source_url text,
  started_at timestamptz default now(),
  updated_at timestamptz default now(),
  expires_at timestamptz,
  cleared_at timestamptz,
  meta jsonb default '{}'::jsonb
);

create index if not exists active_alerts_status_updated_idx on public.active_alerts (status, updated_at desc);

create table if not exists public.airspace_status (
  id uuid primary key default gen_random_uuid(),
  region text unique not null,
  country_code text,
  status text default 'normal',
  title text default 'Airspace status',
  summary text,
  source_name text,
  source_url text,
  fir_code text,
  lat double precision,
  lon double precision,
  updated_at timestamptz default now(),
  expires_at timestamptz
);

create index if not exists airspace_status_updated_idx on public.airspace_status (updated_at desc);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  track_key text unique not null,
  track_type text,
  category text,
  subcategory text,
  source_name text,
  title text,
  lat double precision,
  lon double precision,
  altitude_ft double precision,
  speed_kts double precision,
  heading_deg double precision,
  region text,
  country text,
  status text default 'active',
  occurred_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create index if not exists tracks_type_category_updated_idx on public.tracks (track_type, category, updated_at desc);
create index if not exists tracks_location_idx on public.tracks (lat, lon);

create table if not exists public.aircraft_tracks_log (
  id uuid primary key default gen_random_uuid(),
  track_key text unique not null,
  subtype text,
  lat double precision,
  lon double precision,
  altitude_ft double precision,
  speed_kts double precision,
  heading_deg double precision,
  status text default 'active',
  last_seen_at timestamptz default now(),
  ended_at timestamptz
);

create index if not exists aircraft_tracks_log_last_seen_idx on public.aircraft_tracks_log (last_seen_at desc);

create table if not exists public.raw_items (
  id uuid primary key default gen_random_uuid(),
  source_name text,
  source_type text,
  parser text,
  external_id text,
  url text,
  raw_title text,
  raw_text text,
  raw_payload jsonb default '{}'::jsonb,
  published_at timestamptz,
  location_hint text,
  hash text,
  created_at timestamptz default now()
);

create index if not exists raw_items_created_at_idx on public.raw_items (created_at desc);
create index if not exists raw_items_hash_idx on public.raw_items (hash);

create table if not exists public.event_clusters (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lon double precision not null,
  event_count integer default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists event_clusters_updated_idx on public.event_clusters (updated_at desc);

create table if not exists public.worker_state (
  state_key text primary key,
  last_message_id bigint default 0,
  updated_at timestamptz default now()
);

create table if not exists public.source_registry (
  source_name text primary key,
  enabled boolean default true,
  promotion_mode text default 'normal',
  default_confidence integer
);

create table if not exists public.stratops_subscriptions (
  email text primary key,
  user_id text,
  plan text not null default 'free',
  status text not null default 'none',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists stratops_subscriptions_user_id_idx
  on public.stratops_subscriptions (user_id);

create index if not exists stratops_subscriptions_stripe_subscription_id_idx
  on public.stratops_subscriptions (stripe_subscription_id);

alter table public.events enable row level security;
alter table public.active_alerts enable row level security;
alter table public.airspace_status enable row level security;
alter table public.tracks enable row level security;
alter table public.aircraft_tracks_log enable row level security;
alter table public.raw_items enable row level security;
alter table public.event_clusters enable row level security;
alter table public.worker_state enable row level security;
alter table public.source_registry enable row level security;
alter table public.stratops_subscriptions enable row level security;

drop policy if exists "public read events" on public.events;
create policy "public read events"
  on public.events for select
  to anon, authenticated
  using (true);

drop policy if exists "public read active alerts" on public.active_alerts;
create policy "public read active alerts"
  on public.active_alerts for select
  to anon, authenticated
  using (true);

drop policy if exists "public read airspace status" on public.airspace_status;
create policy "public read airspace status"
  on public.airspace_status for select
  to anon, authenticated
  using (true);

drop policy if exists "public read tracks" on public.tracks;
create policy "public read tracks"
  on public.tracks for select
  to anon, authenticated
  using (true);

drop policy if exists "public read aircraft track log" on public.aircraft_tracks_log;
create policy "public read aircraft track log"
  on public.aircraft_tracks_log for select
  to anon, authenticated
  using (true);

drop policy if exists "public read source registry" on public.source_registry;
create policy "public read source registry"
  on public.source_registry for select
  to anon, authenticated
  using (true);

-- Tell Supabase/PostgREST to reload its schema cache after the new tables exist.
notify pgrst, 'reload schema';
