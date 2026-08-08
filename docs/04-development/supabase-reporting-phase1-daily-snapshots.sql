-- StratOps Reporting Phase 1: persistent, versioned daily snapshot foundation.
-- Prerequisite: apply supabase-operational-reporting.sql if the base reporting
-- tables do not already exist. This migration is additive and preserves all
-- existing snapshots and report records.

alter table public.operational_report_snapshots
  add column if not exists snapshot_key text,
  add column if not exists snapshot_version integer not null default 1,
  add column if not exists window_start timestamptz,
  add column if not exists window_end timestamptz,
  add column if not exists intelligence_total integer not null default 0,
  add column if not exists report_item_total integer not null default 0,
  add column if not exists source_family_total integer not null default 0,
  add column if not exists snapshot_data jsonb not null default '{}'::jsonb,
  add column if not exists report_manifest jsonb not null default '{}'::jsonb;

update public.operational_report_snapshots
set
  snapshot_key = coalesce(
    nullif(snapshot_key, ''),
    'daily:' || snapshot_date::text || ':' || scope_key || ':v' || snapshot_version::text
  ),
  window_start = coalesce(window_start, (snapshot_date::text || 'T00:00:00Z')::timestamptz),
  window_end = coalesce(window_end, ((snapshot_date + 1)::text || 'T00:00:00Z')::timestamptz),
  report_item_total = case
    when report_item_total = 0 then event_total + intelligence_total
    else report_item_total
  end
where
  snapshot_key is null
  or snapshot_key = ''
  or window_start is null
  or window_end is null;

alter table public.operational_report_snapshots
  alter column snapshot_key set not null,
  alter column window_start set not null,
  alter column window_end set not null;

create unique index if not exists operational_report_snapshots_key_idx
  on public.operational_report_snapshots (snapshot_key);

create index if not exists operational_report_snapshots_window_idx
  on public.operational_report_snapshots (window_start, window_end, scope_key);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'operational_report_snapshots_version_check'
  ) then
    alter table public.operational_report_snapshots
      add constraint operational_report_snapshots_version_check
      check (snapshot_version > 0);
  end if;
end $$;

comment on column public.operational_report_snapshots.snapshot_key is
  'Deterministic daily snapshot identity: date + scope + snapshot schema version.';
comment on column public.operational_report_snapshots.snapshot_data is
  'Structured report-ready events, broad intelligence, aggregates, quality, geography and cluster summaries.';
comment on column public.operational_report_snapshots.report_manifest is
  'Traceability and deterministic future report/S3 object-key manifest; generated image selections remain empty in Phase 1.';
