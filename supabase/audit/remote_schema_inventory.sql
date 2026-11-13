-- Read-only catalog inventory for the linked BizBook test project.
-- Contains no customer or financial rows and performs no writes.
select jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'schemas', (
    select coalesce(jsonb_agg(jsonb_build_object('name', n.nspname, 'owner', r.rolname) order by n.nspname), '[]'::jsonb)
    from pg_catalog.pg_namespace n
    join pg_catalog.pg_roles r on r.oid = n.nspowner
    where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
  ),
  'tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', ns.nspname,
      'name', c.relname,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'columns', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'nullable', not a.attnotnull,
          'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid),
          'identity', a.attidentity
        ) order by a.attnum), '[]'::jsonb)
        from pg_catalog.pg_attribute a
        left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ),
      'constraints', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'type', con.contype,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
        ) order by con.conname), '[]'::jsonb)
        from pg_catalog.pg_constraint con where con.conrelid = c.oid
      ),
      'indexes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'name', idx.relname,
          'unique', ix.indisunique,
          'valid', ix.indisvalid,
          'definition', pg_catalog.pg_get_indexdef(ix.indexrelid)
        ) order by idx.relname), '[]'::jsonb)
        from pg_catalog.pg_index ix
        join pg_catalog.pg_class idx on idx.oid = ix.indexrelid
        where ix.indrelid = c.oid
      )
    ) order by ns.nspname, c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'views', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', ns.nspname,
      'name', c.relname,
      'options', c.reloptions,
      'definition', pg_catalog.pg_get_viewdef(c.oid, true)
    ) order by ns.nspname, c.relname), '[]'::jsonb)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname in ('public', 'bizbook_private') and c.relkind in ('v', 'm')
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', ns.nspname,
      'table', c.relname,
      'name', t.tgname,
      'definition', pg_catalog.pg_get_triggerdef(t.oid, true)
    ) order by ns.nspname, c.relname, t.tgname), '[]'::jsonb)
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
    where not t.tgisinternal and ns.nspname in ('public', 'bizbook_private')
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', schemaname,
      'table', tablename,
      'name', policyname,
      'permissive', permissive,
      'roles', roles,
      'command', cmd,
      'using', qual,
      'with_check', with_check
    ) order by schemaname, tablename, policyname), '[]'::jsonb)
    from pg_catalog.pg_policies
    where schemaname in ('public', 'bizbook_private')
  ),
  'routines', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema', ns.nspname,
      'name', p.proname,
      'signature', pg_catalog.pg_get_function_identity_arguments(p.oid),
      'kind', p.prokind,
      'security_definer', p.prosecdef,
      'settings', p.proconfig,
      'acl', p.proacl
    ) order by ns.nspname, p.proname, p.oid), '[]'::jsonb)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname in ('public', 'bizbook_private')
  ),
  'table_privileges', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'grantee', grantee,
      'table_schema', table_schema,
      'table_name', table_name,
      'privilege', privilege_type
    ) order by table_schema, table_name, grantee, privilege_type), '[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  ),
  'sequences', (
    select coalesce(jsonb_agg(jsonb_build_object('schema', sequence_schema, 'name', sequence_name, 'type', data_type) order by sequence_schema, sequence_name), '[]'::jsonb)
    from information_schema.sequences
    where sequence_schema in ('public', 'bizbook_private')
  )
)) as inventory;
