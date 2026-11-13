begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixtures (
  owner_id uuid, support_id uuid, branch_owner_id uuid, institute_id text, branch_id text,
  plan_id uuid, subscription_id uuid, invoice_id uuid, invoice_two_id uuid, invoice_number text, invoice_two_number text,
  first_attempt_id uuid, second_attempt_id uuid, third_attempt_id uuid,
  first_order_id text, second_order_id text, third_order_id text
);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results (passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$ begin insert into pg_temp.test_plan values (expected); return '1..' || expected::text; end; $$;
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
  execute pg_catalog.format('grant select on %I.fixtures to authenticated', temp_schema_name);
end;
$$;

select pg_temp.plan(43);
select pg_temp.ok(to_regclass('public.platform_subscription_payment_events') is not null,
  'subscription provider event ledger exists');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.platform_subscription_payment_events'::regclass),
  'subscription provider event ledger has RLS enabled');
select pg_temp.ok(not has_table_privilege('anon', 'public.platform_subscription_payment_events', 'SELECT'),
  'anonymous users cannot read subscription provider events');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.platform_subscription_payment_events', 'INSERT'),
  'authenticated users cannot forge subscription provider events');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.start_platform_subscription_payment_attempt(uuid,text,text,uuid)', 'EXECUTE'),
  'browser sessions cannot create trusted payment attempts directly');
select pg_temp.ok(has_function_privilege('service_role', 'public.start_platform_subscription_payment_attempt(uuid,text,text,uuid)', 'EXECUTE'),
  'trusted server can start subscription payment attempts');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.bind_platform_subscription_provider_order(uuid,text)', 'EXECUTE'),
  'browser sessions cannot bind provider order references');
select pg_temp.ok(has_function_privilege('service_role', 'public.bind_platform_subscription_provider_order(uuid,text)', 'EXECUTE'),
  'trusted server can bind provider order references');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.finalize_platform_subscription_payment(uuid,text,text,text,numeric,text,text,text,text)', 'EXECUTE'),
  'browser sessions cannot finalize subscription payments');
select pg_temp.ok(has_function_privilege('service_role', 'public.finalize_platform_subscription_payment(uuid,text,text,text,numeric,text,text,text,text)', 'EXECUTE'),
  'trusted server can finalize provider-verified subscription payments');
select pg_temp.ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.finalize_platform_subscription_payment(uuid,text,text,text,numeric,text,text,text,text)'::regprocedure)) > 0,
  'provider finalizers serialize by invoice before locking individual attempts');
select pg_temp.ok((select count(*) = 2 from pg_constraint where conrelid = 'public.platform_subscription_payment_events'::regclass and contype = 'f'),
  'provider event rows have attempt and invoice tenant-consistent foreign keys');
select pg_temp.ok(exists(select 1 from pg_constraint where conrelid = 'public.platform_subscription_payment_events'::regclass and conname = 'platform_subscription_payment_events_provider_event_unique'),
  'provider event identifiers are unique per gateway');
select pg_temp.ok((select count(*) = 2 from pg_indexes where schemaname = 'public' and tablename = 'platform_subscription_payment_events'
  and indexname in ('platform_subscription_payment_events_invoice_time_idx', 'platform_subscription_payment_events_attempt_time_idx')),
  'provider event ledger has invoice-time and attempt-time indexes');

insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-pay-owner@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-pay-support@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-pay-branch-owner@example.invalid');
insert into pg_temp.fixtures(owner_id, support_id, branch_owner_id, institute_id, branch_id, plan_id, subscription_id,
  invoice_id, invoice_two_id, invoice_number, invoice_two_number, first_order_id, second_order_id)
select
  (select id from auth.users where email = 'bizbook-sub-pay-owner@example.invalid'),
  (select id from auth.users where email = 'bizbook-sub-pay-support@example.invalid'),
  (select id from auth.users where email = 'bizbook-sub-pay-branch-owner@example.invalid'),
  'sub-settle-' || replace(gen_random_uuid()::text, '-', ''),
  'sub-branch-' || replace(gen_random_uuid()::text, '-', ''),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'BBTEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  'BBTEST-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  'order_sub_test_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  'order_sub_test_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
insert into public.coaching_institutes(id, business_name)
select institute_id, 'Subscription settlement remote test' from pg_temp.fixtures;
insert into public.branches(id, institute_id, name)
select branch_id, institute_id, 'Branch scope test' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, branch_owner_id, 'owner', 'branches' from pg_temp.fixtures;
insert into public.membership_branch_access(institute_id, user_id, branch_id)
select institute_id, branch_owner_id, branch_id from pg_temp.fixtures;
insert into public.platform_administrators(user_id, role, granted_by)
select owner_id, 'owner', null from pg_temp.fixtures;
insert into public.platform_administrators(user_id, role, granted_by)
select support_id, 'support', (select owner_id from pg_temp.fixtures) from pg_temp.fixtures;
insert into public.platform_subscription_plans(id, name, monthly_price, annual_price, is_available)
select plan_id, 'Remote settlement plan', 100, 1000, true from pg_temp.fixtures;
insert into public.institute_subscriptions(id, institute_id, plan_id, status, billing_cycle,
  current_period_start, current_period_end)
select subscription_id, institute_id, plan_id, 'trialing', 'monthly',
  '2026-10-01T00:00:00Z', '2026-10-31T23:59:59Z' from pg_temp.fixtures;
insert into public.platform_subscription_invoices(id, institute_id, subscription_id, invoice_number,
  billing_period_start, billing_period_end, amount, currency, status, due_at)
select invoice_id, institute_id, subscription_id, invoice_number,
  '2026-11-01T00:00:00Z', '2026-11-30T23:59:59Z', 100, 'INR', 'open', now() + interval '7 days'
from pg_temp.fixtures;
insert into public.platform_subscription_invoices(id, institute_id, subscription_id, invoice_number,
  billing_period_start, billing_period_end, amount, currency, status, due_at)
select invoice_two_id, institute_id, subscription_id, invoice_two_number,
  '2026-12-01T00:00:00Z', '2026-12-31T23:59:59Z', 100, 'INR', 'open', now() + interval '37 days'
from pg_temp.fixtures;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
do $$
declare result jsonb; attempt_id uuid; order_id text;
begin
  result := public.start_platform_subscription_payment_attempt(
    (select invoice_id from pg_temp.fixtures), 'razorpay', 'subscription-test-idempotency-0001',
    (select owner_id from pg_temp.fixtures));
  attempt_id := (result->>'attempt_id')::uuid;
  perform pg_temp.ok(result->>'created' = 'true' and result->>'status' = 'created' and (result->>'amount')::numeric = 100,
    'trusted server creates an attempt using the exact open invoice amount');
  update pg_temp.fixtures set first_attempt_id = attempt_id where true;
  begin
    perform public.start_platform_subscription_payment_attempt(
      (select invoice_id from pg_temp.fixtures), 'cashfree', 'subscription-branch-owner-key-0001',
      (select branch_owner_id from pg_temp.fixtures));
    perform pg_temp.ok(false, 'branch-scoped owner cannot initiate institute subscription billing');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'branch-scoped owner cannot initiate institute subscription billing');
  end;
  result := public.start_platform_subscription_payment_attempt(
    (select invoice_id from pg_temp.fixtures), 'razorpay', 'subscription-test-idempotency-0001',
    (select owner_id from pg_temp.fixtures));
  perform pg_temp.ok(result->>'created' = 'false' and (result->>'attempt_id')::uuid = attempt_id,
    'identical retries return the same payment attempt');
  begin
    perform public.start_platform_subscription_payment_attempt(
      (select invoice_id from pg_temp.fixtures), 'cashfree', 'subscription-test-idempotency-0001',
      (select owner_id from pg_temp.fixtures));
    perform pg_temp.ok(false, 'idempotency key cannot be reused for another provider');
  exception when unique_violation then
    perform pg_temp.ok(true, 'idempotency key cannot be reused for another provider');
  end;
  begin
    perform public.start_platform_subscription_payment_attempt(
      (select invoice_id from pg_temp.fixtures), 'cashfree', 'subscription-test-idempotency-0003',
      (select owner_id from pg_temp.fixtures));
    perform pg_temp.ok(false, 'an unresolved provider attempt blocks a second order');
  exception when object_not_in_prerequisite_state then
    perform pg_temp.ok(true, 'an unresolved provider attempt blocks a second order');
  end;
  update pg_temp.fixtures set first_order_id = 'order_sub_first_000001' where true;
  order_id := (select first_order_id from pg_temp.fixtures);
  result := public.bind_platform_subscription_provider_order(attempt_id, order_id);
  perform pg_temp.ok(result->>'status' = 'pending' and result->>'provider_order_id' = order_id,
    'provider order is bound once and marks the attempt pending');
  begin
    perform public.bind_platform_subscription_provider_order(attempt_id, 'order_sub_different_0001');
    perform pg_temp.ok(false, 'attempt cannot be rebound to a different provider order');
  exception when unique_violation then
    perform pg_temp.ok(true, 'attempt cannot be rebound to a different provider order');
  end;
  result := public.finalize_platform_subscription_payment(attempt_id, order_id, 'pay_sub_bad_amount',
    'captured', 99, 'INR', 'event-sub-bad-amount', 'payment.captured', null);
  perform pg_temp.ok(result->>'status' = 'reconciliation_required',
    'captured amount mismatch is held for reconciliation');
  perform pg_temp.ok((select status = 'open' from public.platform_subscription_invoices where id = (select invoice_id from pg_temp.fixtures)),
    'amount mismatch never settles an invoice');

  result := public.start_platform_subscription_payment_attempt(
    (select invoice_two_id from pg_temp.fixtures), 'razorpay', 'subscription-test-idempotency-0002',
    (select owner_id from pg_temp.fixtures));
  attempt_id := (result->>'attempt_id')::uuid;
  update pg_temp.fixtures set second_attempt_id = attempt_id where true;
  result := public.bind_platform_subscription_provider_order(attempt_id, 'order_sub_second_000001');
  order_id := result->>'provider_order_id';
  update pg_temp.fixtures set second_order_id = order_id where true;
  result := public.finalize_platform_subscription_payment(attempt_id, order_id, 'pay_sub_initial_failure',
    'failed', null, 'INR', 'event-sub-initial-failure', 'payment.failed', null);
  perform pg_temp.ok(result->>'status' = 'failed', 'provider failure makes the first invoice attempt retryable');
  perform pg_temp.ok((select status = 'failed' and provider_payment_id is null
    from public.platform_payment_attempts where id = attempt_id),
    'a failed payment ID is not stored as the canonical captured payment reference');
  perform pg_temp.ok(exists(select 1 from public.platform_subscription_payment_events
    where provider_event_id = 'event-sub-initial-failure' and provider_payment_id = 'pay_sub_initial_failure'),
    'failed payment references remain available in sanitized event history');

  result := public.start_platform_subscription_payment_attempt(
    (select invoice_two_id from pg_temp.fixtures), 'razorpay', 'subscription-test-idempotency-0004',
    (select owner_id from pg_temp.fixtures));
  attempt_id := (result->>'attempt_id')::uuid;
  update pg_temp.fixtures set third_attempt_id = attempt_id where true;
  result := public.bind_platform_subscription_provider_order(attempt_id, 'order_sub_second_000002');
  order_id := result->>'provider_order_id';
  update pg_temp.fixtures set third_order_id = order_id where true;
  perform pg_temp.ok(result->>'status' = 'pending', 'a fresh idempotent attempt can follow a provider-confirmed failure');

  result := public.finalize_platform_subscription_payment(
    (select second_attempt_id from pg_temp.fixtures), (select second_order_id from pg_temp.fixtures),
    'pay_sub_success_0001', 'captured', 100, 'INR', 'event-sub-late-capture', 'payment.captured', repeat('a', 64));
  perform pg_temp.ok(result->>'status' = 'reconciliation_required',
    'late capture is held while a retry order remains unresolved');
  perform pg_temp.ok((select status = 'open' from public.platform_subscription_invoices where id = (select invoice_two_id from pg_temp.fixtures)),
    'competing unresolved attempt prevents premature invoice settlement');

  result := public.finalize_platform_subscription_payment(
    (select third_attempt_id from pg_temp.fixtures), (select third_order_id from pg_temp.fixtures),
    'pay_sub_retry_failure', 'failed', null, 'INR', 'event-sub-retry-failure', 'payment.failed', null);
  perform pg_temp.ok(result->>'status' = 'failed', 'provider status reconciliation can close the competing retry');
  result := public.finalize_platform_subscription_payment(
    (select second_attempt_id from pg_temp.fixtures), (select second_order_id from pg_temp.fixtures),
    'pay_sub_success_0001', 'captured', 100, 'INR', 'event-sub-confirmed-late-capture', 'payment.captured', repeat('a', 64));
  perform pg_temp.ok(result->>'status' = 'paid', 'exact capture settles after the competing retry is confirmed failed');
  perform pg_temp.ok((select status = 'paid' and paid_at is not null from public.platform_subscription_invoices where id = (select invoice_two_id from pg_temp.fixtures)),
    'settlement records invoice paid status and timestamp atomically');
  perform pg_temp.ok((select status = 'active' and current_period_start = '2026-12-01T00:00:00Z'::timestamptz
    and current_period_end = '2026-12-31T23:59:59Z'::timestamptz and grace_period_ends_at is null
    from public.institute_subscriptions where id = (select subscription_id from pg_temp.fixtures)),
    'settlement advances only the invoiced subscription period');
  result := public.finalize_platform_subscription_payment(
    (select second_attempt_id from pg_temp.fixtures), (select second_order_id from pg_temp.fixtures),
    'pay_sub_success_0001', 'captured', 100, 'INR', 'event-sub-confirmed-late-capture', 'payment.captured', repeat('a', 64));
  perform pg_temp.ok(result->>'status' = 'duplicate_event', 'replayed provider event is idempotently recognized');
  result := public.finalize_platform_subscription_payment(
    (select second_attempt_id from pg_temp.fixtures), (select second_order_id from pg_temp.fixtures),
    'pay_sub_unrelated_failure', 'failed', null, 'INR', 'event-sub-late-failure', 'payment.failed', null);
  perform pg_temp.ok(result->>'status' = 'paid'
    and (select status = 'paid' and provider_payment_id = 'pay_sub_success_0001'
         from public.platform_payment_attempts where id = (select second_attempt_id from pg_temp.fixtures)),
    'late failure events cannot replace the captured payment reference or downgrade a paid attempt');
  result := public.finalize_platform_subscription_payment(
    (select third_attempt_id from pg_temp.fixtures), (select third_order_id from pg_temp.fixtures),
    'pay_sub_retry_late_capture', 'captured', 100, 'INR', 'event-sub-retry-late-capture', 'payment.captured', null);
  perform pg_temp.ok(result->>'status' = 'reconciliation_required'
    and (select status = 'reconciliation_required' and safe_error_code = 'invoice_already_paid'
         from public.platform_payment_attempts where id = (select third_attempt_id from pg_temp.fixtures)),
    'late capture from a competing order requires reconciliation after invoice settlement');
  perform pg_temp.ok((select status = 'paid' from public.platform_subscription_invoices where id = (select invoice_two_id from pg_temp.fixtures)),
    'a competing provider capture does not downgrade the already-paid invoice');
  perform pg_temp.ok((select count(*) = 7 from public.platform_subscription_payment_events where institute_id = (select institute_id from pg_temp.fixtures)),
    'sanitized settlement events are retained for reconciliation');
  perform pg_temp.ok((select count(*) >= 4 from public.platform_admin_audit_events where target_type = 'subscription_payment_attempt'),
    'payment settlement and reconciliation append audit events');
  perform pg_temp.ok((select count(*) = 6 from public.platform_subscription_events where subscription_id = (select subscription_id from pg_temp.fixtures)),
    'settlement and reconciliation append subscription lifecycle events');
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok((select count(*) = 7 from public.platform_subscription_payment_events where institute_id = (select institute_id from pg_temp.fixtures)),
  'institute owner can read its sanitized subscription payment history');
reset role;
select set_config('request.jwt.claim.sub', (select support_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select support_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_payment_events where institute_id = (select institute_id from pg_temp.fixtures)),
  'platform support role cannot read private provider event history');
reset role;
select pg_temp.ok((select count(*) = 42 from pg_temp.test_results), 'test suite records all planned assertions');
select * from pg_temp.finish();
rollback;
