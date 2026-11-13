begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table fixtures (
  owner_id uuid not null,
  outsider_id uuid not null,
  institute_id text not null,
  student_id text not null,
  installment_id text not null,
  payment_id text not null,
  allocation_id text not null,
  first_refund_id text not null,
  second_refund_id text not null
);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$
begin
  insert into pg_temp.test_results (passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.throws_ok(statement text, expected_state text, description text)
returns boolean language plpgsql as $$
declare actual_state text;
begin
  execute statement;
  insert into pg_temp.test_results (passed, description) values (false, description || ' (did not throw)');
  return false;
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate;
  insert into pg_temp.test_results (passed, description)
  values (actual_state = expected_state, description || case when actual_state = expected_state then '' else ' (SQLSTATE ' || actual_state || ')' end);
  return actual_state = expected_state;
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql as $$
declare item record; failures bigint;
begin
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no || ' - ' || item.description;
  end loop;
  select count(*) into failures from pg_temp.test_results where not passed;
  return next '# assertions=' || (select count(*)::text from pg_temp.test_results) || ' failed=' || failures;
end;
$$;
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;

insert into pg_temp.fixtures values (
  gen_random_uuid(), gen_random_uuid(), 'online-refund-' || replace(gen_random_uuid()::text, '-', ''),
  'refund-student-' || replace(gen_random_uuid()::text, '-', ''),
  'refund-installment-' || replace(gen_random_uuid()::text, '-', ''),
  'refund-payment-' || replace(gen_random_uuid()::text, '-', ''),
  'refund-allocation-' || replace(gen_random_uuid()::text, '-', ''),
  gen_random_uuid()::text, gen_random_uuid()::text
);
insert into auth.users (id, aud, role, email)
select owner_id, 'authenticated', 'authenticated', 'online-refund-owner-' || replace(owner_id::text, '-', '') || '@example.invalid'
from pg_temp.fixtures
union all
select outsider_id, 'authenticated', 'authenticated', 'online-refund-outsider-' || replace(outsider_id::text, '-', '') || '@example.invalid'
from pg_temp.fixtures;
insert into public.coaching_institutes (id, business_name)
select institute_id, 'Online Refund Test' from pg_temp.fixtures;
insert into public.user_memberships (institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;
insert into public.students (id, institute_id, name)
select student_id, institute_id, 'Online Refund Student' from pg_temp.fixtures;
insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, due_date)
select installment_id, institute_id, student_id, 1, 100, current_date from pg_temp.fixtures;
insert into public.payments (
  id, institute_id, student_id, receipt_kind, amount, payment_date, method, mode, status,
  provider, provider_order_id, provider_payment_id, verified_at
)
select payment_id, institute_id, student_id, 'Fee', 100, current_date, 'Online', 'Online', 'Paid',
  'razorpay', 'order_refund_test', 'pay_refund_test', now()
from pg_temp.fixtures;
insert into public.payment_allocations (
  id, institute_id, payment_id, student_id, installment_id, allocation_kind, amount
)
select allocation_id, institute_id, payment_id, student_id, installment_id, 'Fee', 80 from pg_temp.fixtures;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.request_online_refund(text,numeric,text,jsonb,text)', 'EXECUTE'),
  'anonymous callers cannot request provider refunds'
);
select pg_temp.ok(
  has_function_privilege('authenticated', 'public.request_online_refund(text,numeric,text,jsonb,text)', 'EXECUTE'),
  'authenticated callers can request refunds subject to the RPC authorization checks'
);
select pg_temp.ok(
  not has_function_privilege('authenticated', 'public.record_online_refund_status(text,text,text,text,text,numeric,text,text)', 'EXECUTE'),
  'authenticated callers cannot write provider refund status'
);
select pg_temp.ok(
  has_function_privilege('service_role', 'public.record_online_refund_status(text,text,text,text,text,numeric,text,text)', 'EXECUTE'),
  'only the trusted server role can write provider refund status'
);

select pg_temp.ok(
  (public.request_online_refund(f.payment_id, 10, 'Duplicate fee',
    jsonb_build_array(jsonb_build_object('payment_allocation_id', f.allocation_id, 'amount', 10)), f.first_refund_id)->>'created') = 'true',
  'authorized finance user creates an online refund reservation'
) from pg_temp.fixtures f;
select pg_temp.ok(
  (public.request_online_refund(f.payment_id, 10, 'Duplicate fee',
    jsonb_build_array(jsonb_build_object('payment_allocation_id', f.allocation_id, 'amount', 10)), f.first_refund_id)->>'created') = 'false',
  'exact retry with the same UUID returns the original refund'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.request_online_refund(%L, 11, 'Duplicate fee', jsonb_build_array(jsonb_build_object('payment_allocation_id', %L, 'amount', 11)), %L)$q$,
    f.payment_id, f.allocation_id, f.first_refund_id),
  '23505', 'reusing a refund idempotency UUID for changed details is rejected'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.request_online_refund(%L, 91, 'Over refund', '[]'::jsonb, %L)$q$,
    f.payment_id, gen_random_uuid()::text),
  '23514', 'pending refund reservations prevent over-refunding the receipt'
) from pg_temp.fixtures f;

select set_config('request.jwt.claim.sub', (select outsider_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select outsider_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select pg_temp.throws_ok(
  format($q$select public.request_online_refund(%L, 10, 'Unauthorized', '[]'::jsonb, %L)$q$,
    f.payment_id, gen_random_uuid()::text),
  '42501', 'users without finance membership cannot request a provider refund'
) from pg_temp.fixtures f;
select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);

select pg_temp.throws_ok(
  format($q$select public.request_online_refund(%L, 0, 'Invalid amount', '[]'::jsonb, %L)$q$,
    f.payment_id, gen_random_uuid()::text),
  '22023', 'zero-value refund request is rejected'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.request_online_refund(%L, 1, 'Invalid allocation', '[{"payment_allocation_id":"missing","amount":1}]'::jsonb, %L)$q$,
    f.payment_id, gen_random_uuid()::text),
  '23503', 'refund allocations must reference an allocation of the same receipt'
) from pg_temp.fixtures f;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
select pg_temp.throws_ok(
  format($q$select public.record_online_refund_status(%L, 'cashfree', 'rfnd_wrong_provider', 'pay_refund_test', 'order_refund_test', 10, 'INR', 'Processing')$q$,
    f.first_refund_id),
  '23514', 'provider mismatch is rejected before recording a refund'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.record_online_refund_status(%L, 'razorpay', 'rfnd_wrong_payment', 'pay_wrong', 'order_refund_test', 10, 'INR', 'Processing')$q$,
    f.first_refund_id),
  '23514', 'provider payment mismatch is rejected'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.record_online_refund_status(%L, 'razorpay', 'rfnd_wrong_order', 'pay_refund_test', 'order_wrong', 10, 'INR', 'Processing')$q$,
    f.first_refund_id),
  '23514', 'provider order mismatch is rejected'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.record_online_refund_status(%L, 'razorpay', 'rfnd_wrong_amount', 'pay_refund_test', 'order_refund_test', 11, 'INR', 'Processing')$q$,
    f.first_refund_id),
  '23514', 'provider amount mismatch is rejected'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.record_online_refund_status(%L, 'razorpay', 'rfnd_wrong_currency', 'pay_refund_test', 'order_refund_test', 10, 'USD', 'Processing')$q$,
    f.first_refund_id),
  '22023', 'non-INR provider currency is rejected'
) from pg_temp.fixtures f;

select public.record_online_refund_status(f.first_refund_id, 'razorpay', 'rfnd_remote_first',
  'pay_refund_test', 'order_refund_test', 10, 'INR', 'Processing') from pg_temp.fixtures f;
select pg_temp.ok(
  (select r.status = 'Processing' and r.provider_refund_reference = 'rfnd_remote_first'
     and p.status = 'Paid'
   from public.refunds r join public.payments p on p.id = r.payment_id
   where r.id = (select first_refund_id from pg_temp.fixtures)),
  'processing provider status does not alter the receipt ledger'
);
select pg_temp.ok(
  (public.record_online_refund_status(f.first_refund_id, 'razorpay', 'rfnd_remote_first',
    'pay_refund_test', 'order_refund_test', 10, 'INR', 'Completed')->>'status') = 'Completed',
  'provider-confirmed refund completion is recorded'
) from pg_temp.fixtures f;
select pg_temp.ok(
  (select r.completed_at is not null and r.completed_by is null and p.status = 'Partially Refunded'
   from public.refunds r join public.payments p on p.id = r.payment_id
   where r.id = (select first_refund_id from pg_temp.fixtures)),
  'completed online refund updates exactly one receipt status'
);
select pg_temp.ok(
  (public.record_online_refund_status(f.first_refund_id, 'razorpay', 'rfnd_remote_first',
    'pay_refund_test', 'order_refund_test', 10, 'INR', 'Completed')->>'duplicate') = 'true',
  'replayed provider completion is idempotent'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.record_online_refund_status(%L, 'razorpay', 'rfnd_rebound', 'pay_refund_test', 'order_refund_test', 10, 'INR', 'Completed')$q$,
    f.first_refund_id),
  '23514', 'terminal refund cannot be rebound to a different provider refund'
) from pg_temp.fixtures f;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select pg_temp.ok(
  (public.request_online_refund(f.payment_id, 90, 'Remaining receipt',
    jsonb_build_array(jsonb_build_object('payment_allocation_id', f.allocation_id, 'amount', 70)), f.second_refund_id)->>'created') = 'true',
  'a later partial refund can reserve the exact remaining receipt balance'
) from pg_temp.fixtures f;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
select public.record_online_refund_status(f.second_refund_id, 'razorpay', 'rfnd_remote_second',
  'pay_refund_test', 'order_refund_test', 90, 'INR', 'Completed') from pg_temp.fixtures f;
select pg_temp.ok(
  (select p.status = 'Refunded' and (select sum(r.amount) from public.refunds r
      where r.payment_id = p.id and r.status = 'Completed') = p.amount
   from public.payments p where p.id = (select payment_id from pg_temp.fixtures)),
  'cumulative full refund updates the receipt to Refunded exactly once'
);
select pg_temp.ok(
  (select count(*) >= 4 from public.audit_logs a
   where a.entity_type = 'refunds' and a.entity_id in (
     (select first_refund_id from pg_temp.fixtures), (select second_refund_id from pg_temp.fixtures))),
  'refund request and provider state changes are included in audit history'
);

select * from pg_temp.finish();
rollback;
