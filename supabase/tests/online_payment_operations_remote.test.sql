begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table fixtures (
  owner_id uuid not null,
  institute_id text not null,
  student_id text not null,
  installment_id text not null,
  fee_order_id text,
  advance_order_id text,
  failed_order_id text,
  fee_payment_id text
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

insert into auth.users (id, aud, role, email)
values (gen_random_uuid(), 'authenticated', 'authenticated',
  'online-payment-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid');
insert into pg_temp.fixtures (owner_id, institute_id, student_id, installment_id)
select u.id, 'online-pay-' || replace(gen_random_uuid()::text, '-', ''),
  'online-student-' || replace(gen_random_uuid()::text, '-', ''),
  'online-installment-' || replace(gen_random_uuid()::text, '-', '')
from auth.users u order by u.created_at desc limit 1;
insert into public.coaching_institutes (id, business_name)
select institute_id, 'Online Payment Transaction Test' from pg_temp.fixtures;
insert into public.user_memberships (institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;
insert into public.students (id, institute_id, name)
select student_id, institute_id, 'Online Payment Student' from pg_temp.fixtures;
insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, due_date)
select installment_id, institute_id, student_id, 1, 100, current_date from pg_temp.fixtures;
insert into public.payment_connections (institute_id, provider, environment, connection_status)
select institute_id, 'razorpay', 'test', 'active' from pg_temp.fixtures;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);

select pg_temp.ok(
  not has_function_privilege('anon', 'public.create_online_payment_order_intent(text,text,text,text,text,numeric,text,numeric,text)', 'EXECUTE'),
  'anonymous callers cannot create provider payment intents'
);
select pg_temp.ok(
  not has_function_privilege('authenticated', 'public.process_online_payment_status(text,text,text,text,numeric,text,text,text,text)', 'EXECUTE'),
  'authenticated callers cannot finalize provider payments'
);
select pg_temp.ok(
  has_function_privilege('service_role', 'public.process_online_payment_status(text,text,text,text,numeric,text,text,text,text)', 'EXECUTE'),
  'trusted server role can call the payment finalization RPC'
);

update pg_temp.fixtures f set fee_order_id = (
  public.create_online_payment_order_intent(
    f.institute_id, null, f.student_id, 'razorpay', 'Fee', 50.00, f.installment_id, 50.00,
    'fee-' || replace(gen_random_uuid()::text, '-', '')
  )->>'order_id'
);
select pg_temp.ok(
  (select o.order_status = 'Processing' and o.receipt_kind = 'Fee' and o.allocation_amount = o.amount
     and o.installment_id = f.installment_id from public.payment_orders o join pg_temp.fixtures f on f.fee_order_id = o.id),
  'fee intent stores its exact installment target and reserves its amount'
);
select pg_temp.ok(
  (select r.result->>'created' = 'false'
      and r.result->>'order_id' = f.fee_order_id
      and r.result->>'provider_order_id' is null
      and r.result->>'order_status' = 'Processing'
   from lateral (select public.create_online_payment_order_intent(
    f.institute_id, null, f.student_id, 'razorpay', 'Fee', 50.00, f.installment_id, 50.00, o.idempotency_key
   ) as result) r),
  'identical idempotent order retry returns the same local order'
)
from pg_temp.fixtures f join public.payment_orders o on o.id = f.fee_order_id;
select pg_temp.throws_ok(
  format($q$select public.create_online_payment_order_intent(%L,null,%L,'razorpay','Fee',60.00,%L,60.00,'fee-over-reserved-0001')$q$,
    f.institute_id, f.student_id, f.installment_id),
  '23514',
  'a second concurrent fee order cannot reserve more than the remaining installment balance'
) from pg_temp.fixtures f;
select pg_temp.throws_ok(
  format($q$select public.create_online_payment_order_intent(%L,null,%L,'razorpay','Fee',51.00,%L,51.00,%L)$q$,
    f.institute_id, f.student_id, f.installment_id, o.idempotency_key),
  '23505',
  'reusing an idempotency key for changed money or target is rejected'
) from pg_temp.fixtures f join public.payment_orders o on o.id = f.fee_order_id;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
select public.bind_online_provider_order(f.fee_order_id, 'order_fee_remote_test')
from pg_temp.fixtures f;
select pg_temp.ok(
  (select order_status = 'Pending' and provider_order_id = 'order_fee_remote_test'
   from public.payment_orders where id = (select fee_order_id from pg_temp.fixtures)),
  'provider order reference is bound only by the trusted server function'
);
select pg_temp.ok(
  (public.process_online_payment_status('razorpay', 'order_fee_remote_test', 'pay_fee_remote_test',
    'authorized', 50.00, 'INR', 'event_fee_authorized', 'payment.authorized', repeat('a', 64))->>'status') = 'authorized',
  'provider authorization changes order state without recording a receipt'
);
select pg_temp.ok(
  (select count(*) = 0 from public.payments where provider_order_id = 'order_fee_remote_test'),
  'authorized but uncaptured payments do not count as receipts'
);
select pg_temp.ok(
  (public.process_online_payment_status('razorpay', 'order_fee_remote_test', 'pay_fee_remote_test',
    'captured', 50.00, 'INR', 'event_fee_captured', 'payment.captured', repeat('b', 64))->>'status') = 'captured',
  'server-confirmed captured fee is finalized'
);
select pg_temp.ok(
  (select p.status = 'Paid' and p.mode = 'Online' and p.verified_at is not null and p.amount = 50.00
   from public.payments p join pg_temp.fixtures f on p.id = (select payment_id from public.payment_orders where id = f.fee_order_id)),
  'captured fee creates one verified online receipt with provider amount intact'
);
select pg_temp.ok(
  (select count(*) = 1 and min(allocation_kind) = 'Fee' and sum(amount) = 50.00
   from public.payment_allocations where payment_id = (select payment_id from public.payment_orders where id = (select fee_order_id from pg_temp.fixtures))),
  'fee receipt allocation is linked once to its intended installment'
);
select pg_temp.ok(
  (public.process_online_payment_status('razorpay', 'order_fee_remote_test', 'pay_fee_remote_test',
    'captured', 50.00, 'INR', 'event_fee_captured', 'payment.captured', repeat('b', 64))->>'status') = 'duplicate_event',
  'replayed webhook event ID and body are idempotently acknowledged'
);
select pg_temp.ok(
  (select count(*) = 1 from public.payments where provider_order_id = 'order_fee_remote_test'),
  'replayed captured event cannot create another receipt'
);
select pg_temp.throws_ok(
  $q$select public.process_online_payment_status('razorpay', 'order_fee_remote_test', 'pay_fee_remote_test',
    'captured', 50.00, 'INR', 'event_fee_captured', 'payment.captured', repeat('c', 64))$q$,
  '23505',
  'reusing a provider event ID with a changed payload is rejected'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
update pg_temp.fixtures f set advance_order_id = (
  public.create_online_payment_order_intent(
    f.institute_id, null, f.student_id, 'razorpay', 'Advance', 30.00, f.installment_id, 10.00,
    'advance-' || replace(gen_random_uuid()::text, '-', '')
  )->>'order_id'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
select public.bind_online_provider_order(f.advance_order_id, 'order_advance_remote_test') from pg_temp.fixtures f;
select public.process_online_payment_status('razorpay', 'order_advance_remote_test', 'pay_advance_remote_test',
  'captured', 30.00, 'INR', 'event_advance_captured', 'payment.captured', repeat('d', 64));
select pg_temp.ok(
  (select p.receipt_kind = 'Advance' and p.amount = 30.00 and p.status = 'Paid'
   from public.payments p join public.payment_orders o on o.payment_id = p.id
   where o.id = (select advance_order_id from pg_temp.fixtures)),
  'advance collection becomes exactly one receipt for the full provider amount'
);
select pg_temp.ok(
  (select count(*) = 1 and min(allocation_kind) = 'Advance' and sum(amount) = 10.00
   from public.payment_allocations where payment_id = (select payment_id from public.payment_orders where id = (select advance_order_id from pg_temp.fixtures))),
  'advance allocation credits only its specified installment amount'
);
select pg_temp.ok(
  (select count(*) = 2 from public.payments where institute_id = (select institute_id from pg_temp.fixtures)),
  'fee and advance collections each appear once in the canonical receipt ledger'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
update pg_temp.fixtures f set failed_order_id = (
  public.create_online_payment_order_intent(
    f.institute_id, null, f.student_id, 'razorpay', 'Advance', 12.50, null, 0,
    'failed-' || replace(gen_random_uuid()::text, '-', '')
  )->>'order_id'
);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
select public.bind_online_provider_order(f.failed_order_id, 'order_failed_remote_test') from pg_temp.fixtures f;
select public.process_online_payment_status('razorpay', 'order_failed_remote_test', 'pay_failed_remote_test',
  'failed', 12.50, 'INR', 'event_failed_remote_test', 'payment.failed', repeat('e', 64));
select pg_temp.ok(
  (select order_status = 'Failed' and payment_id is null from public.payment_orders where id = (select failed_order_id from pg_temp.fixtures)),
  'failed provider payment releases its reservation without creating a receipt'
);
select pg_temp.ok(
  (select count(*) = 0 from public.payments where provider_order_id = 'order_failed_remote_test'),
  'failed provider payment does not enter collections'
);
select pg_temp.ok(
  (public.process_online_payment_status('razorpay', 'order_failed_remote_test', 'pay_failed_remote_test',
    'pending', 12.50, 'INR', 'event_failed_stale_pending', 'payment.pending', repeat('f', 64))->>'ignored') = 'true',
  'a delayed pending provider event is ignored after failure'
);
select pg_temp.ok(
  (select o.order_status = 'Failed' and e.processing_status = 'Ignored'
   from public.payment_orders o join public.webhook_events e on e.provider = o.provider
     and e.provider_event_id = 'event_failed_stale_pending'
   where o.id = (select failed_order_id from pg_temp.fixtures)),
  'terminal failed state stays terminal and stale webhook history is retained'
);
select pg_temp.ok(
  (public.process_online_payment_status('razorpay', 'order_failed_remote_test', 'pay_late_captured_remote_test',
    'captured', 12.50, 'INR', 'event_late_capture_after_failure', 'payment.captured', repeat('1', 64))->>'status') = 'captured',
  'a provider-confirmed late capture after an earlier failure is posted'
);
select pg_temp.ok(
  (select o.order_status = 'Captured' and count(p.id) = 1
   from public.payment_orders o left join public.payments p on p.id = o.payment_id
   where o.id = (select failed_order_id from pg_temp.fixtures)
   group by o.order_status),
  'late capture replaces the failed order state and creates exactly one receipt'
);
select pg_temp.ok(
  exists(select 1 from public.payment_reconciliation_records where provider_transaction_reference = 'pay_fee_remote_test' and reconciliation_status = 'Matched'),
  'captured receipt has a matched reconciliation record'
);
select pg_temp.ok(
  (public.process_online_payment_status('razorpay', 'order_fee_remote_test', 'pay_fee_second_capture_remote_test',
    'captured', 50.00, 'INR', 'event_fee_second_capture', 'payment.captured', repeat('f', 64))->>'status') = 'reconciliation_required',
  'a distinct second provider capture is routed to reconciliation'
);
select pg_temp.ok(
  (select count(*) = 1 from public.payments where provider_order_id = 'order_fee_remote_test')
  and exists(select 1 from public.payment_reconciliation_records
    where provider_transaction_reference = 'pay_fee_second_capture_remote_test' and reconciliation_status = 'Unmatched')
  and exists(select 1 from public.webhook_events
    where provider_event_id = 'event_fee_second_capture' and processing_status = 'Processed'),
  'second provider capture is visible in reconciliation without a duplicate receipt'
);
select pg_temp.ok(
  exists(select 1 from public.audit_logs where entity_type = 'payment_order' and entity_id = (select fee_order_id from pg_temp.fixtures)),
  'payment order creation is present in the institute audit log'
);
select * from pg_temp.finish();
rollback;
