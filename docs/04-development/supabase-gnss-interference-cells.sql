-- StratOps gnss_interference_cells schema
-- Run in Supabase SQL Editor when moving from staged demo data to persisted cells.

create extension if not exists pgcrypto;

create table if not exists public.gnss_interference_cells (
  id uuid primary key default gen_random_uuid(),
  cell_id text unique,
  grid_id text,
  lat double precision not null,
  lon double precision not null,
  polygon jsonb,
  cell_boundary jsonb,
  severity text default 'unknown',
  affected_percent double precision default 0,
  sample_count integer default 0,
  confidence text default 'low',
  country text,
  region text,
  observed_at timestamptz,
  updated_at timestamptz default now(),
  expires_at timestamptz,
  source_label text default 'GNSS Jamming Monitor',
  is_public boolean default true,
  is_active boolean default true,
  is_demo boolean default false,
  source_provider text,
  source_provider_url text,
  raw_payload jsonb default '{}'::jsonb,
  debug jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists gnss_interference_cells_updated_at_idx
  on public.gnss_interference_cells (updated_at desc);

create index if not exists gnss_interference_cells_region_idx
  on public.gnss_interference_cells (region);

create index if not exists gnss_interference_cells_country_idx
  on public.gnss_interference_cells (country);

create index if not exists gnss_interference_cells_severity_idx
  on public.gnss_interference_cells (severity);

create index if not exists gnss_interference_cells_location_idx
  on public.gnss_interference_cells (lat, lon);

alter table public.gnss_interference_cells enable row level security;

drop policy if exists "public read gnss Jamming cells" on public.gnss_interference_cells;
create policy "public read gnss Jamming cells"
  on public.gnss_interference_cells for select
  to anon, authenticated
  using (is_public = true and is_active = true);
