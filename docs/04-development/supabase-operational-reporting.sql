-- StratOps operational reporting schema
-- Apply in Supabase SQL editor before enabling REPORTING_ENABLED=true.
-- This stores summarized snapshots and generated report metadata only.
-- It does not duplicate full raw events and does not change existing event retention.

create table if not exists public.operational_report_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  generated_at timestamptz not null default now(),
  scope_type text not null default 'global',
  scope_key text not null default 'global',
  scope_value text,
  scope_label text not null default 'Global',
  region text,
  country text,
  aoi jsonb,
  event_total integer not null default 0,
  category_totals jsonb not null default '{}'::jsonb,
  severity_totals jsonb not null default '{}'::jsonb,
  confidence_totals jsonb not null default '{}'::jsonb,
  aircraft_total integer not null default 0,
  naval_total integer not null default 0,
  alerts_total integer not null default 0,
  airspace_total integer not null default 0,
  cyber_total integer not null default 0,
  gnss_total integer not null default 0,
  satellite_total integer not null default 0,
  escalation_score integer not null default 0,
  highest_confidence_events jsonb not null default '[]'::jsonb,
  highest_severity_events jsonb not null default '[]'::jsonb,
  top_operational_clusters jsonb not null default '[]'::jsonb,
  regional_summary text,
  trend_metrics jsonb not null default '{}'::jsonb,
  chart_data jsonb not null default '{}'::jsonb,
  map_snapshot_reference text,
  satellite_summary jsonb not null default '{}'::jsonb,
  generated_summary text,
  report_version text not null,
  normalization_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'operational_report_snapshots_scope_check'
  ) then
    alter table public.operational_report_snapshots
      add constraint operational_report_snapshots_scope_check
      check (scope_type in ('global','region','country','aoi'));
  end if;
end $$;

create unique index if not exists operational_report_snapshots_date_scope_idx
  on public.operational_report_snapshots (snapshot_date, scope_key);

create index if not exists operational_report_snapshots_scope_idx
  on public.operational_report_snapshots (scope_type, scope_key, snapshot_date desc);

create table if not exists public.operational_reports (
  id uuid primary key default gen_random_uuid(),
  report_key text not null unique,
  report_type text not null,
  scope_type text not null default 'global',
  scope_key text not null default 'global',
  scope_value text,
  scope_label text not null default 'Global',
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'generating',
  report_body jsonb not null default '{}'::jsonb,
  snapshot_ids uuid[] not null default '{}',
  generated_summary text,
  pdf_url text,
  pdf_storage_key text,
  pdf_etag text,
  download_token text,
  expires_at timestamptz,
  report_version text not null,
  normalization_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'operational_reports_type_check'
  ) then
    alter table public.operational_reports
      add constraint operational_reports_type_check
      check (report_type in ('daily','weekly'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'operational_reports_scope_check'
  ) then
    alter table public.operational_reports
      add constraint operational_reports_scope_check
      check (scope_type in ('global','region','country','aoi'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'operational_reports_status_check'
  ) then
    alter table public.operational_reports
      add constraint operational_reports_status_check
      check (status in ('generating','available','failed','expired'));
  end if;
end $$;

create index if not exists operational_reports_public_idx
  on public.operational_reports (report_type, scope_type, period_start desc)
  where status = 'available';

create index if not exists operational_reports_expiry_idx
  on public.operational_reports (expires_at)
  where expires_at is not null;

alter table public.operational_report_snapshots enable row level security;
alter table public.operational_reports enable row level security;

drop policy if exists "service role manages operational report snapshots" on public.operational_report_snapshots;
create policy "service role manages operational report snapshots"
  on public.operational_report_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manages operational reports" on public.operational_reports;
create policy "service role manages operational reports"
  on public.operational_reports for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
