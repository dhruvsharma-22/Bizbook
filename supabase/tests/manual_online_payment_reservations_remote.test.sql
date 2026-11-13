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
  online_order_id text
);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$
begin
  insert into pg_temp.test_results (passed, description)
  values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.throws_ok(statement text, expected_state text, description text)
returns boolean language plpgsql as $$
declare actual_state text;
begin
  execute statement;
  insert into pg_temp.test_results (passed, description)
  values (false, description || ' (did not throw)');
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

insert into auth.users (id, aud, role, email)
values (gen_random_uuid(), 'authenticated', 'authenticated',
  'manual-online-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid');
insert into pg_temp.fixtures (owner_id, institute_id, student_id, installment_id)
select u.id, 'manual-online-' || replace(gen_random_uuid()::text, '-', ''),
  'manual-student-' || replace(gen_random_uuid()::text, '-', ''),
  'manual-installment-' || replace(gen_random_uuid()::text, '-', '')
from auth.users u order by u.created_at desc limit 1;
insert into public.coaching_institutes (id, business_name)
select institute_id, 'Manual and Online Receipt Test' from pg_temp.fixtures;
insert into public.user_memberships (institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;
insert into public.students (id, institute_id, name)
select student_id, institute_id, 'Manual and Online Student' from pg_temp.fixtures;
insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, due_date)
select installment_id, institute_id, student_id, 1, 100, current_date from pg_temp.fixtures;
insert into public.payment_connections (institute_id, provider, environment, connection_status)
select institute_id, 'razorpay', 'test', 'active' from pg_temp.fixtures;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);

update pg_temp.fixtures f set online_order_id = (
  public.create_online_payment_order_intent(
    f.institute_id, null, f.student_id, 'razorpay', 'Fee', 60.00, f.installment_id, 60.00,
    'manual-online-order-' || replace(gen_random_uuid()::text, '-', '')
  )->>'order_id'
);
select pg_temp.ok(
  (select o.order_status = 'Processing' and o.allocation_amount = 60.00
   from public.payment_orders o join pg_temp.fixtures f on f.online_order_id = o.id),
  'online checkout reserves 60 of the shared 100 balance'
);

select pg_temp.throws_ok(
  format($q$select public.record_manual_payment(%L,null,%L,'Fee',41.00,'Cash',current_date,null,null,
    jsonb_build_array(jsonb_build_object('installment_id',%L,'amount',41.00)),%L,null)$q$,
    f.institute_id, f.student_id, f.installment_id, 'manual-over-reserved-' || replace(gen_random_uuid()::text, '-', '')),
  '23514',
  'manual receipt cannot consume balance already reserved by online checkout'
) from pg_temp.fixtures f;

select public.record_manual_payment(
  f.institute_id, null, f.student_id, 'Fee', 40.00, 'Cash', current_date,
  null, 'Synthetic manual receipt',
  jsonb_build_array(jsonb_build_object('installment_id', f.installment_id, 'amount', 40.00)),
  'manual-under-reserved-' || replace(gen_random_uuid()::text, '-', ''), null
)
from pg_temp.fixtures f;
select pg_temp.ok(
  (select count(*) = 1 and min(p.mode) = 'Manual' and sum(pa.amount) = 40.00
   from public.payments p join public.payment_allocations pa on pa.payment_id = p.id and pa.institute_id = p.institute_id
   where p.institute_id = (select institute_id from pg_temp.fixtures)),
  'manual receipt records normally within the unreserved balance'
);

select pg_temp.throws_ok(
  format($q$select public.create_online_payment_order_intent(%L,null,%L,'razorpay','Fee',1.00,%L,1.00,%L)$q$,
    f.institute_id, f.student_id, f.installment_id, 'manual-online-overlap-' || replace(gen_random_uuid()::text, '-', '')),
  '23514',
  'online checkout cannot reserve more than the balance left after manual receipts'
) from pg_temp.fixtures f;

select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select owner_id from pg_temp.fixtures), 'role', 'service_role')::text, true);
select public.bind_online_provider_order(f.online_order_id, 'order_manual_online_test') from pg_temp.fixtures f;
select (public.process_online_payment_status(
  'razorpay', 'order_manual_online_test', 'pay_manual_online_test',
  'captured', 60.00, 'INR', 'event_manual_online_test', 'payment.captured', repeat('c', 64)
)->>'status') = 'captured'
from pg_temp.fixtures;

select pg_temp.ok(
  (select count(distinct p.mode) = 2 and count(*) = 2
       and sum(p.amount) = 100.00 and sum(pa.amount) = 100.00
   from public.payments p
   join public.payment_allocations pa on pa.payment_id = p.id and pa.institute_id = p.institute_id
   where p.institute_id = (select institute_id from pg_temp.fixtures)),
  'manual and provider-confirmed online receipts coexist in one ledger without over-allocating'
);

select * from pg_temp.finish();
rollback;
