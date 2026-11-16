-- Additive; run once through the existing Supabase SQL migration workflow.
begin;
create table if not exists public.naval_source (
 source_id text primary key, payload jsonb not null, cursor timestamptz
);
create table if not exists public.naval_evidence (
 evidence_id text primary key, source_id text not null references public.naval_source,
 external_id text not null, payload jsonb not null, unique(source_id, external_id)
);
create table if not exists public.naval_activity (
 activity_id text primary key, source_id text not null references public.naval_source,
 published_at timestamptz not null, valid_until timestamptz not null, payload jsonb not null,
 checked_at timestamptz not null default now()
);
alter table public.naval_activity add column if not exists checked_at timestamptz not null default now();
create index if not exists naval_activity_publication_idx on public.naval_activity (published_at desc);
create index if not exists naval_activity_expiration_idx on public.naval_activity (valid_until);
create index if not exists naval_activity_recheck_idx on public.naval_activity (source_id,checked_at);
alter table public.naval_source enable row level security;
alter table public.naval_evidence enable row level security;
alter table public.naval_activity enable row level security;
revoke all on public.naval_source,public.naval_evidence,public.naval_activity from anon,authenticated;
grant all on public.naval_source,public.naval_evidence,public.naval_activity to service_role;
commit;
-- Rollback after disabling worker/API feature: drop only these three new tables.
-- Export report history first. No existing AIS/history tables are altered.
