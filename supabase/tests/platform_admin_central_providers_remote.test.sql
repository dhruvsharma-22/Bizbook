begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results (passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$
begin
  insert into pg_temp.test_plan values (expected);
  return '1..' || expected::text;
end;
$$;
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$
begin return pg_temp.record_test(passed, description); end;
$$;
create or replace function pg_temp.has_table(schema_name text, table_name text, description text)
returns boolean language plpgsql as $$
declare relation_exists boolean;
begin
  select to_regclass(format('%I.%I', schema_name, table_name)) is not null into relation_exists;
  return pg_temp.record_test(relation_exists, description);
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare expected_count integer; actual_count bigint; failure_count bigint; item record;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed) into actual_count, failure_count from pg_temp.test_results;
  return next '1..' || coalesce(expected_count, 0)::text;
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no::text || ' - ' || item.description;
  end loop;
  return next format('# assertions=%s failed=%s planned=%s', actual_count, failure_count, expected_count);
end;
$$;
select pg_temp.plan(30);

select pg_temp.has_table('public', 'platform_administrators', 'platform admin roles are stored in a dedicated table');
select pg_temp.has_table('public', 'platform_provider_connections', 'central provider metadata table exists');
select pg_temp.has_table('public', 'platform_admin_audit_events', 'platform admin audit log exists');
select pg_temp.has_table('public', 'platform_subscription_plans', 'platform subscription plans exist');
select pg_temp.has_table('public', 'institute_subscriptions', 'institute subscription assignments exist');
select pg_temp.has_table('public', 'platform_subscription_invoices', 'platform subscription invoices exist');
select pg_temp.has_table('public', 'platform_payment_attempts', 'platform payment attempts exist');
select pg_temp.has_table('public', 'platform_subscription_events', 'subscription status events exist');

select pg_temp.ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_administrators'::regclass),
  'platform administrator table has RLS enabled'
);
select pg_temp.ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_provider_connections'::regclass),
  'provider metadata table has RLS enabled'
);
select pg_temp.ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_subscription_invoices'::regclass),
  'invoice table has RLS enabled'
);
select pg_temp.ok(
  not has_table_privilege('authenticated', 'public.platform_administrators', 'SELECT'),
  'authenticated users cannot read or grant themselves platform roles'
);
select pg_temp.ok(
  not has_column_privilege('authenticated', 'public.platform_provider_connections', 'secret_reference', 'SELECT'),
  'authenticated administrators cannot read Vault secret references'
);
select pg_temp.ok(
  has_any_column_privilege('authenticated', 'public.platform_provider_connections', 'SELECT'),
  'platform administrators have column-limited provider metadata SELECT subject to RLS'
);
select pg_temp.ok(
  has_function_privilege('authenticated', 'bizbook_private.is_platform_administrator()', 'EXECUTE'),
  'authenticated sessions can check their own platform role'
);
select pg_temp.ok(
  not has_function_privilege('anon', 'bizbook_private.is_platform_administrator()', 'EXECUTE'),
  'anonymous users cannot query platform role status'
);
select pg_temp.ok(
  has_function_privilege('authenticated', 'public.save_platform_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'central credential RPC is executable by authenticated callers and checks platform role internally'
);
select pg_temp.ok(
  not has_function_privilege('anon', 'public.save_platform_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'anonymous users cannot configure platform providers'
);
select pg_temp.ok(
  not has_function_privilege('authenticated', 'public.get_platform_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'browser sessions cannot resolve provider secrets'
);
select pg_temp.ok(
  has_function_privilege('service_role', 'public.get_platform_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'trusted server jobs can resolve active central test credentials'
);
select pg_temp.ok(
  not has_function_privilege('authenticated', 'public.save_notification_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'institute managers cannot replace central notification credentials'
);
select pg_temp.ok(
  not has_function_privilege('service_role', 'public.get_notification_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'background jobs cannot resolve retired institute-scoped sender credentials'
);
select pg_temp.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_logs'
      and policyname = 'notification_logs_select_platform_admin'
  ),
  'platform administrators have an RLS-gated notification log read policy'
);
select pg_temp.ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'platform_payment_attempts_status_idx'
  ),
  'platform payment attempt status queries are indexed'
);
select pg_temp.ok(
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'institute_subscriptions'
      and constraint_type = 'FOREIGN KEY' and constraint_name = 'institute_subscriptions_institute_id_fkey'
  ),
  'subscription rows are tied to a coaching institute'
);
select pg_temp.ok(
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'platform_payment_attempts'
      and constraint_type = 'FOREIGN KEY' and constraint_name = 'platform_payment_attempts_invoice_tenant_fkey'
  ),
  'payment attempts are tied to invoices from the same institute'
);
select pg_temp.ok(
  exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and table_name = 'platform_subscription_invoices'
      and constraint_type = 'FOREIGN KEY' and constraint_name = 'platform_subscription_invoices_subscription_id_fkey'
  ),
  'subscription invoices can only reference subscriptions from the same institute'
);
select pg_temp.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_provider_connections'::regclass
      and conname = 'platform_provider_connections_provider_scope_provider_key'
  ),
  'one central connection exists per provider scope and provider'
);
select pg_temp.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.platform_payment_attempts'::regclass
      and conname = 'platform_payment_attempts_idempotency_key_key'
  ),
  'platform payment attempts have unique idempotency keys'
);
select pg_temp.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'institute_subscriptions'
      and policyname = 'institute_subscriptions_select_institute_manager'
  ),
  'coaching managers can see only their own subscription rows'
);

select * from pg_temp.finish();

rollback;
