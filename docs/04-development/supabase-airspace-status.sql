-- StratOps airspace_status schema repair
-- Run in Supabase SQL Editor for the current project.

create extension if not exists pgcrypto;

create table if not exists public.airspace_status (
  id uuid primary key default gen_random_uuid()
);

alter table public.airspace_status
  add column if not exists region text,
  add column if not exists country_code text default '',
  add column if not exists status text default 'unknown',
  add column if not exists title text default 'Airspace status',
  add column if not exists summary text default '',
  add column if not exists source_name text default '',
  add column if not exists source_url text default '',
  add column if not exists fir_code text default '',
  add column if not exists updated_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists created_at timestamptz default now();

create unique index if not exists airspace_status_region_unique_idx
  on public.airspace_status (region)
  where region is not null;

create index if not exists airspace_status_updated_at_idx
  on public.airspace_status (updated_at desc);

create index if not exists airspace_status_status_idx
  on public.airspace_status (status);

create index if not exists airspace_status_country_code_idx
  on public.airspace_status (country_code);
