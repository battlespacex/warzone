-- Apply once in Supabase SQL editor before enabling REPORTING_72H_ENABLED.
-- Idempotent; existing reports and daily snapshots are retained.
alter table public.operational_report_snapshots
  add column if not exists report_type text not null default 'daily';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operational_report_snapshots_type_check') then
    alter table public.operational_report_snapshots add constraint operational_report_snapshots_type_check
      check (report_type in ('daily', '72hour'));
  end if;
end $$;

-- The old date/scope unique index cannot distinguish daily and 72-hour snapshots.
drop index if exists public.operational_report_snapshots_date_scope_idx;
create unique index if not exists operational_report_snapshots_date_scope_type_idx
  on public.operational_report_snapshots (snapshot_date, scope_key, report_type);
create unique index if not exists operational_report_snapshots_daily_date_scope_idx
  on public.operational_report_snapshots (snapshot_date, scope_key)
  where report_type = 'daily';

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'operational_reports_type_check') then
    alter table public.operational_reports drop constraint operational_reports_type_check;
  end if;
  alter table public.operational_reports add constraint operational_reports_type_check
    check (report_type in ('daily', 'weekly', '72hour'));
end $$;

create unique index if not exists operational_reports_72hour_period_scope_idx
  on public.operational_reports (period_start, period_end, scope_key)
  where report_type = '72hour';

alter table public.operational_reports
  add column if not exists attempt_count integer not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists last_failure_stage text,
  add column if not exists last_failure_reason text;

create table if not exists public.operational_72hour_jobs (
  job_key text primary key,
  period_start timestamptz not null,
  period_end timestamptz not null,
  scope_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'failed', 'permanent_failure', 'completed')),
  owner_id text,
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  failed_stage text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (period_end = period_start + interval '72 hours')
);
create index if not exists operational_72hour_jobs_retry_idx
  on public.operational_72hour_jobs (status, next_retry_at, lease_expires_at);
alter table public.operational_72hour_jobs enable row level security;
revoke all on public.operational_72hour_jobs from anon, authenticated;
grant select, insert, update on public.operational_72hour_jobs to service_role;

create or replace function public.claim_operational_72hour_job(
  p_job_key text, p_period_start timestamptz, p_period_end timestamptz,
  p_scope_key text, p_owner text, p_lease_seconds integer, p_max_attempts integer
) returns table(token uuid, attempt integer)
language plpgsql security definer set search_path = public as $$
declare v_token uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  if p_period_end <> p_period_start + interval '72 hours' or p_lease_seconds < 60
     or p_max_attempts < 1 or length(p_job_key) > 300 or length(p_owner) > 200 then
    raise exception 'invalid 72-hour job claim';
  end if;
  update public.operational_72hour_jobs
     set status = 'permanent_failure', owner_id = null, claim_token = null,
         lease_expires_at = null, failed_stage = 'LEASE',
         last_error = 'Lease expired after maximum attempts', updated_at = now()
   where job_key = p_job_key and status = 'running' and lease_expires_at < now()
     and attempt_count >= p_max_attempts;
  if found then
    update public.operational_reports
       set status = 'failed', last_failure_stage = 'LEASE',
           last_failure_reason = 'Lease expired after maximum attempts', updated_at = now()
     where report_key = p_job_key and report_type = '72hour' and status = 'generating';
  end if;
  return query
    insert into public.operational_72hour_jobs as j
      (job_key, period_start, period_end, scope_key, status, owner_id, claim_token, lease_expires_at, attempt_count)
    select p_job_key, p_period_start, p_period_end, p_scope_key, 'running', p_owner,
           v_token, now() + make_interval(secs => p_lease_seconds), 1
    where not exists (select 1 from public.operational_reports r
                      where r.report_key = p_job_key and r.status in ('available', 'expired'))
    on conflict (job_key) do update
      set status = 'running', owner_id = p_owner, claim_token = v_token,
          lease_expires_at = now() + make_interval(secs => p_lease_seconds),
          attempt_count = j.attempt_count + 1, next_retry_at = null, updated_at = now()
      where j.period_start = p_period_start and j.period_end = p_period_end
        and j.scope_key = p_scope_key and j.status not in ('completed', 'permanent_failure')
        and (j.status <> 'running' or j.lease_expires_at < now())
        and (j.next_retry_at is null or j.next_retry_at <= now())
        and j.attempt_count < p_max_attempts
        and not exists (select 1 from public.operational_reports r
                        where r.report_key = p_job_key and r.status in ('available', 'expired'))
    returning claim_token, attempt_count;
end $$;

create or replace function public.renew_operational_72hour_job(
  p_job_key text, p_owner text, p_token uuid, p_lease_seconds integer
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  if p_lease_seconds < 60 then raise exception 'invalid lease'; end if;
  update public.operational_72hour_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where job_key = p_job_key and owner_id = p_owner and claim_token = p_token
     and status = 'running' and lease_expires_at > now();
  return found;
end $$;

create or replace function public.complete_operational_72hour_job(
  p_job_key text, p_owner text, p_token uuid, p_report_id uuid, p_report_body jsonb,
  p_pdf_url text, p_pdf_storage_key text, p_pdf_etag text,
  p_download_token text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_report public.operational_reports%rowtype;
        v_attempt integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  select attempt_count into v_attempt from public.operational_72hour_jobs
   where job_key = p_job_key and owner_id = p_owner and claim_token = p_token
     and status = 'running' and lease_expires_at > now() for update;
  if not found then return null; end if;
  update public.operational_reports
     set status = 'available', report_body = p_report_body, pdf_url = p_pdf_url,
         pdf_storage_key = p_pdf_storage_key, pdf_etag = p_pdf_etag,
         download_token = p_download_token, expires_at = p_expires_at, updated_at = now(),
         published_at = now(), attempt_count = v_attempt,
         last_failure_stage = null, last_failure_reason = null
   where id = p_report_id and report_key = p_job_key and report_type = '72hour'
   returning * into v_report;
  if not found then raise exception '72-hour report row missing for owned job'; end if;
  update public.operational_72hour_jobs
     set status = 'completed', owner_id = null, claim_token = null, lease_expires_at = null,
         completed_at = now(), updated_at = now(), failed_stage = null, last_error = null
   where job_key = p_job_key;
  return to_jsonb(v_report);
end $$;

create or replace function public.fail_operational_72hour_job(
  p_job_key text, p_owner text, p_token uuid, p_stage text, p_error text,
  p_retry_limit integer, p_retry_delay_seconds integer
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_attempt integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required'; end if;
  update public.operational_72hour_jobs
     set status = case when attempt_count >= p_retry_limit then 'permanent_failure' else 'failed' end,
         owner_id = null, claim_token = null, lease_expires_at = null,
         failed_stage = left(p_stage, 80), last_error = left(p_error, 500),
         next_retry_at = case when attempt_count >= p_retry_limit then null
              else now() + make_interval(secs => least(86400, p_retry_delay_seconds * power(2, least(attempt_count - 1, 8))::integer)) end,
         updated_at = now()
   where job_key = p_job_key and owner_id = p_owner and claim_token = p_token
     and status = 'running' and lease_expires_at > now()
   returning attempt_count into v_attempt;
  if not found then return false; end if;
  update public.operational_reports
     set status = 'failed', report_body = jsonb_set(coalesce(report_body, '{}'::jsonb),
         '{pipeline}', jsonb_build_object('stage', 'FAILED', 'failed_stage', left(p_stage, 80), 'error', left(p_error, 500))),
         attempt_count = v_attempt, last_failure_stage = left(p_stage, 80),
         last_failure_reason = left(p_error, 500), updated_at = now()
   where report_key = p_job_key and report_type = '72hour' and status = 'generating';
  return true;
end $$;

revoke all on function public.claim_operational_72hour_job(text,timestamptz,timestamptz,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.renew_operational_72hour_job(text,text,uuid,integer) from public, anon, authenticated;
revoke all on function public.complete_operational_72hour_job(text,text,uuid,uuid,jsonb,text,text,text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.fail_operational_72hour_job(text,text,uuid,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.claim_operational_72hour_job(text,timestamptz,timestamptz,text,text,integer,integer) to service_role;
grant execute on function public.renew_operational_72hour_job(text,text,uuid,integer) to service_role;
grant execute on function public.complete_operational_72hour_job(text,text,uuid,uuid,jsonb,text,text,text,text,timestamptz) to service_role;
grant execute on function public.fail_operational_72hour_job(text,text,uuid,text,text,integer,integer) to service_role;

-- Rollback: disable REPORTING_72H_ENABLED first. Retain job/report rows for audit.
-- Function permissions may be revoked and functions dropped after worker rollout is reversed.
