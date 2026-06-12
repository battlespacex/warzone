-- StratOps status_feed_items schema
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.status_feed_items (
  id uuid primary key default gen_random_uuid(),
  source_id text,
  source_name text not null,
  source_type text,
  source_category text,
  title text not null,
  summary text,
  url text,
  guid text unique,
  published_at timestamptz,
  fetched_at timestamptz default now(),
  region text,
  country text,
  lat double precision,
  lon double precision,
  severity text default 'unknown',
  category text default 'general',
  confidence_score integer default 0,
  is_status_relevant boolean default false,
  raw jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists status_feed_items_url_unique_idx
  on public.status_feed_items (url)
  where url is not null;

create index if not exists status_feed_items_published_at_idx
  on public.status_feed_items (published_at desc);

create index if not exists status_feed_items_category_idx
  on public.status_feed_items (category);

create index if not exists status_feed_items_source_name_idx
  on public.status_feed_items (source_name);

create index if not exists status_feed_items_country_idx
  on public.status_feed_items (country);

create index if not exists status_feed_items_severity_idx
  on public.status_feed_items (severity);

create index if not exists status_feed_items_location_idx
  on public.status_feed_items (lat, lon);

alter table public.status_feed_items enable row level security;

drop policy if exists "public read status feed items" on public.status_feed_items;
create policy "public read status feed items"
  on public.status_feed_items for select
  to anon, authenticated
  using (true);

