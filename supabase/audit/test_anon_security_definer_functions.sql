-- Read-only inventory of application SECURITY DEFINER routines callable by anon.
-- Function source is included for security review; do not expose database data.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) as return_type,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,
  p.proconfig as settings,
  p.proacl as acl,
  pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'bizbook_private')
  and p.prokind = 'f'
  and p.prosecdef
  and pg_catalog.pg_get_function_result(p.oid) <> 'event_trigger'
  and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
order by n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);
