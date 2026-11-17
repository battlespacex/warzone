-- Review and apply manually before enabling the new backend in production.
begin;
create table if not exists public.stratops_provider_quota (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  version bigint not null default 0,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.stratops_provider_quota enable row level security;
revoke all on public.stratops_provider_quota from public, anon, authenticated;
grant select,insert,update,delete on public.stratops_provider_quota to service_role;

create or replace function public.stratops_quota_read(p_key text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r public.stratops_provider_quota;
begin
  insert into public.stratops_provider_quota(key) values(p_key) on conflict do nothing;
  select * into strict r from public.stratops_provider_quota where key=p_key;
  return jsonb_build_object('version',r.version,'state',r.state);
end $$;

create or replace function public.stratops_quota_cas(p_key text,p_version bigint,p_state jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare changed integer;
begin
  update public.stratops_provider_quota set state=p_state,version=version+1,updated_at=now()
    where key=p_key and version=p_version;
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.stratops_quota_read(text) from public,anon,authenticated;
revoke all on function public.stratops_quota_cas(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.stratops_quota_read(text) to service_role;
grant execute on function public.stratops_quota_cas(text,bigint,jsonb) to service_role;
commit;
-- Rollback after stopping all new workers: drop the two functions. Retain the
-- table/counters for later recovery; deleting usage could allow double spending.
