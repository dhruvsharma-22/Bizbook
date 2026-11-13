-- Compact, read-only facts from the linked BizBook test project's catalogs.
-- Does not select business rows or modify the database.
select jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'schemas', (
    select coalesce(jsonb_agg(n.nspname order by n.nspname), '[]'::jsonb)
    from pg_catalog.pg_namespace n
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
  ),
  'public_tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'column_count', (select count(*) from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'constraint_count', (select count(*) from pg_catalog.pg_constraint con where con.conrelid = c.oid),
      'index_count', (select count(*) from pg_catalog.pg_index ix where ix.indrelid = c.oid),
      'invalid_indexes', (select count(*) from pg_catalog.pg_index ix where ix.indrelid = c.oid and not ix.indisvalid)
    ) order by c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'views', (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'security_invoker', coalesce(c.reloptions @> array['security_invoker=true'], false)) order by c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('v', 'm')
  ),
  'constraint_counts', (
    select coalesce(jsonb_object_agg(contype, count), '{}'::jsonb)
    from (select con.contype::text as contype, count(*) as count
      from pg_catalog.pg_constraint con join pg_catalog.pg_class c on c.oid = con.conrelid
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' group by con.contype) counts
  ),
  'indexes', (
    select jsonb_build_object('total', count(*), 'invalid', count(*) filter (where not ix.indisvalid))
    from pg_catalog.pg_index ix join pg_catalog.pg_class c on c.oid = ix.indrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace where ns.nspname = 'public'
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'name', t.tgname) order by c.relname, t.tgname), '[]'::jsonb)
    from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where not t.tgisinternal and ns.nspname = 'public'
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd, 'roles', roles, 'using', qual, 'with_check', with_check) order by tablename, policyname), '[]'::jsonb)
    from pg_catalog.pg_policies where schemaname = 'public'
  ),
  'routines', (
    select coalesce(jsonb_agg(jsonb_build_object('schema', ns.nspname, 'name', p.proname,
      'signature', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef, 'settings', p.proconfig,
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'))
      order by ns.nspname, p.proname, p.oid), '[]'::jsonb)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname in ('public', 'bizbook_private')
  ),
  'privileges', (
    select jsonb_build_object(
      'anon_select_tables', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
        from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege('anon', c.oid, 'SELECT')),
      'authenticated_table_mutations', (select coalesce(jsonb_agg(jsonb_build_object('table', c.relname, 'insert', has_table_privilege('authenticated', c.oid, 'INSERT'), 'update', has_table_privilege('authenticated', c.oid, 'UPDATE'), 'delete', has_table_privilege('authenticated', c.oid, 'DELETE')) order by c.relname), '[]'::jsonb)
        from pg_catalog.pg_class c join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relkind in ('r', 'p'))
  )),
  'sequences', (
    select coalesce(jsonb_agg(jsonb_build_object('schema', sequence_schema, 'name', sequence_name) order by sequence_schema, sequence_name), '[]'::jsonb)
    from information_schema.sequences where sequence_schema in ('public', 'bizbook_private')
  )
)) as catalog_facts;
