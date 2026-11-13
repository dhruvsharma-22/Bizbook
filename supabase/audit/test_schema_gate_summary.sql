-- Read-only aggregate security and migration summary for the authorized test project.
-- No business rows, identifiers, function bodies, or secret material are returned.
select jsonb_build_object(
  'public_table_count', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'public_tables_without_rls', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  ),
  'public_view_count', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
  ),
  'public_views_without_security_invoker', (
    select count(*) from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and not coalesce('security_invoker=true' = any(c.reloptions), false)
  ),
  'public_policy_count', (
    select count(*) from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
  ),
  'public_foreign_key_count', (
    select count(*) from pg_catalog.pg_constraint f
    join pg_catalog.pg_class c on c.oid = f.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and f.contype = 'f'
  ),
  'unvalidated_public_foreign_keys', (
    select count(*) from pg_catalog.pg_constraint f
    join pg_catalog.pg_class c on c.oid = f.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and f.contype = 'f' and not f.convalidated
  ),
  'invalid_public_indexes', (
    select count(*) from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and (not i.indisvalid or not i.indisready)
  ),
  'application_security_definer_functions_with_anon_execute', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private')
      and p.prokind = 'f'
      and p.prosecdef
      and pg_catalog.pg_get_function_result(p.oid) <> 'event_trigger'
      and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'application_security_definer_functions_without_fixed_search_path', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private')
      and p.prokind = 'f'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  'local_migration_rows_applied', (
    select count(*) from supabase_migrations.schema_migrations
  )
);
