begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixtures (
  owner_id uuid,
  support_id uuid,
  institute_id text,
  plan_name text,
  provider_reference text,
  plan_id uuid,
  subscription_id uuid,
  invoice_id uuid,
  invoice_number text,
  idempotency_key text
);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results(passed, description) values(coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$
begin insert into pg_temp.test_plan values(expected); return '1..' || expected::text; end;
$$;
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$ begin return pg_temp.record_test(passed, description); end; $$;
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
do $$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$$;

select pg_temp.plan(22);

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'platform-privacy-owner-' || gen_random_uuid()::text || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'platform-privacy-support-' || gen_random_uuid()::text || '@example.invalid');
insert into pg_temp.fixtures(owner_id, support_id, institute_id, plan_name, provider_reference, invoice_number, idempotency_key)
select
  (select id from auth.users where email like 'platform-privacy-owner-%@example.invalid' order by created_at desc limit 1),
  (select id from auth.users where email like 'platform-privacy-support-%@example.invalid' order by created_at desc limit 1),
  'privacy-test-' || replace(gen_random_uuid()::text, '-', ''),
  'Private synthetic plan ' || replace(gen_random_uuid()::text, '-', ''),
  'synthetic-private-ref-' || replace(gen_random_uuid()::text, '-', ''),
  'PRIVACY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  gen_random_uuid()::text;
insert into public.coaching_institutes(id, business_name)
select institute_id, 'Synthetic Privacy Test Institute' from pg_temp.fixtures;
insert into public.platform_administrators(user_id, role)
select owner_id, 'owner' from pg_temp.fixtures
union all select support_id, 'support' from pg_temp.fixtures;
insert into public.platform_subscription_plans(name, monthly_price, annual_price, is_available)
select plan_name, 10, 100, false from pg_temp.fixtures;

-- Store fixture IDs through a separate deterministic lookup, avoiding assumptions about existing rows.
update pg_temp.fixtures set plan_id = (
  select p.id from public.platform_subscription_plans p join pg_temp.fixtures f on p.name = f.plan_name
);
insert into public.institute_subscriptions(institute_id, plan_id, status)
select institute_id, plan_id, 'active' from pg_temp.fixtures;
update pg_temp.fixtures set subscription_id = (
  select s.id from public.institute_subscriptions s join pg_temp.fixtures f using (institute_id) where s.plan_id = f.plan_id
);
insert into public.platform_subscription_invoices(
  institute_id, subscription_id, invoice_number, billing_period_start, billing_period_end, amount
)
select institute_id, subscription_id, invoice_number, now(), now() + interval '30 days', 10 from pg_temp.fixtures;
update pg_temp.fixtures set invoice_id = (
  select i.id from public.platform_subscription_invoices i join pg_temp.fixtures f using (institute_id) where i.invoice_number = f.invoice_number
);
insert into public.platform_payment_attempts(
  invoice_id, institute_id, provider, status, idempotency_key, attempt_number
)
select invoice_id, institute_id, 'razorpay', 'created', idempotency_key, 1 from pg_temp.fixtures;
insert into public.platform_provider_connections(provider_scope, provider, account_reference, connection_status)
select 'payment', 'razorpay', provider_reference, 'pending' from pg_temp.fixtures
on conflict (provider_scope, provider) do update
set account_reference = excluded.account_reference, connection_status = excluded.connection_status;
insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id)
select owner_id, 'synthetic_privacy_event', 'institute', institute_id from pg_temp.fixtures;
insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type)
select institute_id, subscription_id, owner_id, 'synthetic_privacy_event' from pg_temp.fixtures;
insert into public.notification_logs(institute_id, channel, event_type, delivery_status, recipient_fingerprint)
select institute_id, 'Email', 'synthetic_privacy_event', 'Sent', 'synthetic-fingerprint' from pg_temp.fixtures;

select pg_temp.ok(not has_function_privilege('anon', 'public.get_platform_admin_role()', 'EXECUTE'), 'anonymous role cannot inspect platform role');
select pg_temp.ok(has_function_privilege('authenticated', 'public.get_platform_admin_role()', 'EXECUTE'), 'authenticated sessions can resolve their own platform role');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.platform_admin_overview(text,integer,integer)', 'EXECUTE'), 'the unfiltered legacy overview RPC is not callable by browser sessions');
select pg_temp.ok(has_function_privilege('authenticated', 'public.platform_admin_overview_safe(text,integer,integer)', 'EXECUTE'), 'browser sessions use the role-aware overview RPC');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.platform_administrators', 'SELECT'), 'platform role rows are not directly selectable');

select set_config('request.jwt.claim.sub', (select support_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select support_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select set_config('test.provider_reference', (select provider_reference from pg_temp.fixtures), true);
select set_config('test.plan_name', (select plan_name from pg_temp.fixtures), true);
select set_config('test.idempotency_key', (select idempotency_key from pg_temp.fixtures), true);
set local role authenticated;
select pg_temp.ok(public.get_platform_admin_role() = 'support', 'role lookup reports support for the signed-in support account');
select pg_temp.ok(public.is_platform_administrator(), 'support remains authorized for support workflows');
select pg_temp.ok(public.platform_admin_overview_safe(null, 10, 0)->>'current_role' = 'support', 'safe overview identifies support role');
select pg_temp.ok(public.platform_admin_overview_safe(null, 10, 0)->'institutes' = '[]'::jsonb, 'support overview contains no institute directory');
select pg_temp.ok(public.platform_admin_overview_safe(null, 10, 0)->'invoices' = '[]'::jsonb, 'support overview contains no invoices');
select pg_temp.ok(public.platform_admin_overview_safe(null, 10, 0)->'payment_attempts' = '[]'::jsonb, 'support overview contains no payment attempts');
select pg_temp.ok((select count(*) = 0 from public.platform_provider_connections), 'RLS hides provider metadata from support');
select pg_temp.ok((select count(*) = 0 from public.platform_admin_audit_events), 'RLS hides platform audit events from support');
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_invoices), 'RLS hides cross-institute invoices from support');
select pg_temp.ok((select count(*) = 0 from public.platform_payment_attempts), 'RLS hides cross-institute payment attempts from support');
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_plans where name = current_setting('test.plan_name')), 'RLS hides unavailable plan details from support');
select pg_temp.ok((select count(*) = 0 from public.institute_subscriptions), 'RLS hides subscription records from support');
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_events), 'RLS hides subscription audit events from support');
select pg_temp.ok((select count(*) = 0 from public.notification_logs), 'RLS hides global delivery logs from support');
reset role;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(public.platform_admin_overview_safe(null, 100, 0)->>'current_role' = 'owner', 'owner receives the complete administrative overview');
select pg_temp.ok((select count(*) = 1 from public.platform_provider_connections where account_reference = current_setting('test.provider_reference')), 'owner can read central provider metadata');
select pg_temp.ok((select count(*) = 1 from public.platform_payment_attempts where idempotency_key = current_setting('test.idempotency_key')), 'owner can read subscription payment attempts');
reset role;

select * from pg_temp.finish();
do $$
declare expected_count integer; actual_count bigint; failure_count bigint;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed) into actual_count, failure_count from pg_temp.test_results;
  if actual_count <> expected_count or failure_count <> 0 then
    raise exception 'platform role privacy test failed: % assertions, % failed, % planned', actual_count, failure_count, expected_count;
  end if;
end;
$$;
rollback;
