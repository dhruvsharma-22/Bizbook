-- Read-only verification of application routine hardening on the linked test project.
select jsonb_pretty(jsonb_build_object(
  'application_routine_count', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private')
  ),
  'security_definer_routines', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'settings', p.proconfig,
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE')
    ) order by n.nspname, p.proname, p.oid), '[]'::jsonb)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private') and p.prosecdef
  ),
  'definers_without_search_path_setting', (
    select coalesce(jsonb_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '[]'::jsonb)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private') and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting where setting like 'search_path=%')
  )
)) as routine_facts;
