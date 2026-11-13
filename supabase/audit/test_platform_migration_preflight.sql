-- Read-only preflight against the linked test project; no business rows or secrets are read.
with expected_core(name) as (
  values
    ('profiles'), ('coaching_institutes'), ('user_memberships'), ('branches'),
    ('membership_branch_access'), ('students'), ('staff'), ('attendance_records'),
    ('student_installments'), ('payments'), ('payment_allocations'), ('refunds'),
    ('refund_allocations'), ('salary_payments'), ('expenses'), ('audit_logs'),
    ('notification_logs'), ('payment_connections'), ('payment_orders'), ('webhook_events'),
    ('payment_reconciliation_records')
)
select jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'core_tables_missing', (
    select coalesce(jsonb_agg(e.name order by e.name), '[]'::jsonb)
    from expected_core e
    where to_regclass('public.' || quote_ident(e.name)) is null
  ),
  'public_bizbook_tables', (
    select coalesce(jsonb_agg(jsonb_build_object('name', c.relname, 'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity) order by c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not like 'spatial_%'
  ),
  'core_tables_without_rls', (
    select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname in (select name from expected_core) and not c.relrowsecurity
  ),
  'credential_migration_140003_present', jsonb_build_object(
    'notification_provider_connections', to_regclass('public.notification_provider_connections') is not null,
    'save_notification_provider_credentials', to_regprocedure('public.save_notification_provider_credentials(text,text,text,jsonb)') is not null,
    'get_notification_provider_credentials', to_regprocedure('public.get_notification_provider_credentials(text,text,boolean)') is not null
  ),
  'central_admin_objects_present', jsonb_build_object(
    'platform_administrators', to_regclass('public.platform_administrators') is not null,
    'platform_provider_connections', to_regclass('public.platform_provider_connections') is not null,
    'platform_subscription_plans', to_regclass('public.platform_subscription_plans') is not null,
    'institute_subscriptions', to_regclass('public.institute_subscriptions') is not null,
    'platform_admin_role_function', to_regprocedure('bizbook_private.is_platform_administrator()') is not null
  ),
  'security_invoker_views', (
    select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' and c.reloptions @> array['security_invoker=true']
  )
));
