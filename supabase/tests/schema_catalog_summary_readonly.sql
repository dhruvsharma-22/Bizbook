-- Read-only inventory for the authorized test database. This query returns counts only.
select jsonb_build_object(
  'public_tables', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ),
  'public_tables_rls_enabled', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  ),
  'public_policies', (select count(*) from pg_policies where schemaname = 'public'),
  'validated_foreign_keys', (
    select count(*) from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace and convalidated
  ),
  'unvalidated_foreign_keys', (
    select count(*) from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace and not convalidated
  ),
  'public_views', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  ),
  'security_invoker_views', (
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and coalesce(c.reloptions, array[]::text[]) @> array['security_invoker=true']
  ),
  'invalid_indexes', (
    select count(*) from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and (not i.indisvalid or not i.indisready)
  ),
  'application_definers_callable_by_anon', (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private') and p.prosecdef
      and p.proname <> 'rls_auto_enable'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'application_definers_without_fixed_search_path', (
    select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'bizbook_private') and p.prosecdef
      and p.proname <> 'rls_auto_enable'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
        where cfg.setting like 'search_path=%'
      )
  ),
  'storage_buckets', (select count(*) from storage.buckets),
  'public_storage_buckets', (select count(*) from storage.buckets where public),
  'private_institute_logo_buckets', (
    select count(*) from storage.buckets
    where id = 'bizbook-institute-logos' and name = 'bizbook-institute-logos' and not public
  ),
  'storage_policies', (select count(*) from pg_policies where schemaname = 'storage'),
  'subscription_visibility_test_residuals', jsonb_build_object(
    'auth_users', (select count(*) from auth.users where email like 'subscription-a-%@example.invalid' or email like 'subscription-b-%@example.invalid'),
    'institutes', (select count(*) from public.coaching_institutes where id like 'subscription-visibility-%'),
    'memberships', (select count(*) from public.user_memberships where institute_id like 'subscription-visibility-%'),
    'subscriptions', (select count(*) from public.institute_subscriptions where institute_id like 'subscription-visibility-%'),
    'plans', (select count(*) from public.platform_subscription_plans where name like 'Visibility Test %'),
    'invoices', (select count(*) from public.platform_subscription_invoices where invoice_number like 'VIS-A-%' or invoice_number like 'VIS-B-%'),
    'payment_attempts', (select count(*) from public.platform_payment_attempts where institute_id like 'subscription-visibility-%')
  )
) as catalog_summary;
