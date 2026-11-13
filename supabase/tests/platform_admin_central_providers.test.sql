begin;
select plan(30);

select has_table('public', 'platform_administrators', 'platform admin roles are stored in a dedicated table');
select has_table('public', 'platform_provider_connections', 'central provider metadata table exists');
select has_table('public', 'platform_admin_audit_events', 'platform admin audit log exists');
select has_table('public', 'platform_subscription_plans', 'platform subscription plans exist');
select has_table('public', 'institute_subscriptions', 'institute subscription assignments exist');
select has_table('public', 'platform_subscription_invoices', 'platform subscription invoices exist');
select has_table('public', 'platform_payment_attempts', 'platform payment attempts exist');
select has_table('public', 'platform_subscription_events', 'subscription status events exist');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_administrators'::regclass),
  'platform administrator table has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_provider_connections'::regclass),
  'provider metadata table has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_subscription_invoices'::regclass),
  'invoice table has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_administrators', 'SELECT'),
  'authenticated users cannot read or grant themselves platform roles'
);
select ok(
  not has_column_privilege('authenticated', 'public.platform_provider_connections', 'secret_reference', 'SELECT'),
  'authenticated administrators cannot read Vault secret references'
);
select ok(
  has_any_column_privilege('authenticated', 'public.platform_provider_connections', 'SELECT'),
  'platform administrators have column-limited provider metadata SELECT subject to RLS'
);
select ok(
  has_function_privilege('authenticated', 'bizbook_private.is_platform_administrator()', 'EXECUTE'),
  'authenticated sessions can check their own platform role'
);
select ok(
  not has_function_privilege('anon', 'bizbook_private.is_platform_administrator()', 'EXECUTE'),
  'anonymous users cannot query platform role status'
);
select ok(
  has_function_privilege('authenticated', 'public.save_platform_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'central credential RPC is executable by authenticated callers and checks platform role internally'
);
select ok(
  not has_function_privilege('anon', 'public.save_platform_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'anonymous users cannot configure platform providers'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_platform_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'browser sessions cannot resolve provider secrets'
);
select ok(
  has_function_privilege('service_role', 'public.get_platform_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'trusted server jobs can resolve active central test credentials'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_notification_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'institute managers cannot replace central notification credentials'
);
select ok(
  not has_function_privilege('service_role', 'public.get_notification_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'background jobs cannot resolve retired institute-scoped sender credentials'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_logs'
      and policyname = 'notification_logs_select_platform_admin'
  ),
  'platform administrators have an RLS-gated notification log read policy'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'platform_payment_attempts_status_idx'
  ),
  'platform payment attempt status queries are indexed'
);
select ok(
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'institute_subscriptions'
      and constraint_type = 'FOREIGN KEY' and constraint_name = 'institute_subscriptions_institute_id_fkey'
  ),
  'subscription rows are tied to a coaching institute'
);
select ok(
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'platform_payment_attempts'
      and constraint_type = 'FOREIGN KEY' and constraint_name = 'platform_payment_attempts_invoice_tenant_fkey'
  ),
  'payment attempts are tied to invoices from the same institute'
);
select ok(
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'platform_subscription_invoices'
      and constraint_type = 'FOREIGN KEY' and constraint_name = 'platform_subscription_invoices_subscription_id_fkey'
  ),
  'subscription invoices can only reference subscriptions from the same institute'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_provider_connections'::regclass
      and conname = 'platform_provider_connections_provider_scope_provider_key'
  ),
  'one central connection exists per provider scope and provider'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_payment_attempts'::regclass
      and conname = 'platform_payment_attempts_idempotency_key_key'
  ),
  'platform payment attempts have unique idempotency keys'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'institute_subscriptions'
      and policyname = 'institute_subscriptions_select_institute_manager'
  ),
  'coaching managers can see only their own subscription rows'
);

select * from finish();
rollback;
