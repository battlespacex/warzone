-- Read-only. Run once in the existing Supabase SQL editor. No keys required.
-- Expected: all false for anon/authenticated; all true for service_role.
select role_name,
  has_function_privilege(role_name, 'public.stratops_quota_read(text)', 'EXECUTE') as can_read_rpc,
  has_function_privilege(role_name, 'public.stratops_quota_cas(text,bigint,jsonb)', 'EXECUTE') as can_write_rpc,
  has_table_privilege(role_name, 'public.stratops_provider_quota', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.stratops_provider_quota', 'INSERT') as can_insert,
  has_table_privilege(role_name, 'public.stratops_provider_quota', 'UPDATE') as can_update,
  has_table_privilege(role_name, 'public.stratops_provider_quota', 'DELETE') as can_delete
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);
