begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$
begin
  insert into pg_temp.test_results(passed, description)
  values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.throws_ok(statement text, expected_state text, description text)
returns boolean language plpgsql as $$
declare actual_state text;
begin
  execute statement;
  insert into pg_temp.test_results(passed, description) values (false, description || ' (did not throw)');
  return false;
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate;
  insert into pg_temp.test_results(passed, description)
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
  execute pg_catalog.format('grant usage on schema %I to authenticated, service_role', temp_schema_name);
  execute pg_catalog.format('grant insert, select on %I.test_results to authenticated, service_role', temp_schema_name);
end;
$grant_temp_usage$;

insert into auth.users (id, aud, role, email) values
  ('18181818-1818-4818-8818-181818181818', 'authenticated', 'authenticated', 'admission-cancel-owner@example.invalid'),
  ('19191919-1919-4919-8919-191919191919', 'authenticated', 'authenticated', 'admission-cancel-accountant@example.invalid');
insert into public.coaching_institutes (id, business_name)
values ('admission-cancel-institute', 'Admission Cancellation Test');
insert into public.branches (id, institute_id, name)
values ('admission-cancel-branch', 'admission-cancel-institute', 'Cancellation Test Branch');
insert into public.user_memberships (institute_id, user_id, role, access_scope)
values
  ('admission-cancel-institute', '18181818-1818-4818-8818-181818181818', 'owner', 'branches'),
  ('admission-cancel-institute', '19191919-1919-4919-8919-191919191919', 'accountant', 'branches');
insert into public.membership_branch_access (institute_id, user_id, branch_id, granted_by)
values
  ('admission-cancel-institute', '18181818-1818-4818-8818-181818181818', 'admission-cancel-branch', '18181818-1818-4818-8818-181818181818'),
  ('admission-cancel-institute', '19191919-1919-4919-8919-191919191919', 'admission-cancel-branch', '18181818-1818-4818-8818-181818181818');
insert into public.students (id, institute_id, branch_id, name, total_fee, admission_fee)
values ('admission-cancel-student', 'admission-cancel-institute', 'admission-cancel-branch', 'Cancellation Test Student', 100, 0);
insert into public.student_installments (id, institute_id, branch_id, student_id, sequence_number, scheduled_amount, due_date)
values ('admission-cancel-installment', 'admission-cancel-institute', 'admission-cancel-branch', 'admission-cancel-student', 1, 100, current_date);
insert into public.payment_connections (institute_id, provider, environment, connection_status)
values ('admission-cancel-institute', 'razorpay', 'test', 'active');

select set_config('request.jwt.claim.sub', '18181818-1818-4818-8818-181818181818', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"18181818-1818-4818-8818-181818181818","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.ok(
  not has_function_privilege('anon', 'public.cancel_student_admission(text,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_student_admission(text,text,text)', 'EXECUTE'),
  'Only authenticated callers can invoke the cancellation RPC'
);
select pg_temp.throws_ok(
  $$select public.cancel_student_admission('admission-cancel-institute', 'admission-cancel-student', '   ')$$,
  '22023', 'A cancellation reason is mandatory'
);

select public.record_manual_payment(
  'admission-cancel-institute', 'admission-cancel-branch', 'admission-cancel-student', 'Fee', 25, 'Cash', (now() at time zone 'Asia/Kolkata')::date,
  p_allocations := '[{"installment_id":"admission-cancel-installment","amount":25}]'::jsonb,
  p_idempotency_key := 'admission-cancel-receipt-1'
);
select set_config('request.jwt.claim.sub', '19191919-1919-4919-8919-191919191919', true);
select set_config('request.jwt.claims', '{"sub":"19191919-1919-4919-8919-191919191919","role":"authenticated"}', true);
select pg_temp.throws_ok(
  $$select public.cancel_student_admission('admission-cancel-institute', 'admission-cancel-student', 'Accountant cannot cancel')$$,
  '42501', 'Accountants cannot cancel admissions'
);

select set_config('request.jwt.claim.sub', '18181818-1818-4818-8818-181818181818', true);
select set_config('request.jwt.claims', '{"sub":"18181818-1818-4818-8818-181818181818","role":"authenticated"}', true);
select pg_temp.ok(
  public.create_online_payment_order_intent(
    'admission-cancel-institute', 'admission-cancel-branch', 'admission-cancel-student', 'razorpay', 'Fee', 10,
    'admission-cancel-installment', 10, 'admission-cancel-order-1'
  )->>'order_status' = 'Processing',
  'Online order intent can be created for an active admission'
);
select pg_temp.throws_ok(
  $$select public.cancel_student_admission('admission-cancel-institute', 'admission-cancel-student', 'Parent withdrew')$$,
  '55P03', 'Unresolved payment blocks cancellation'
);

reset role;
update public.payment_orders
   set provider_order_id = 'admission-cancel-provider-order', order_status = 'Pending'
 where institute_id = 'admission-cancel-institute' and idempotency_key = 'admission-cancel-order-1';
set local role authenticated;
select public.create_payment_checkout_link(
  (select id from public.payment_orders where institute_id = 'admission-cancel-institute' and idempotency_key = 'admission-cancel-order-1'),
  repeat('a', 64)
);
reset role;
update public.payment_orders set order_status = 'Failed'
 where institute_id = 'admission-cancel-institute' and idempotency_key = 'admission-cancel-order-1';
set local role authenticated;

select pg_temp.ok(
  public.cancel_student_admission('admission-cancel-institute', 'admission-cancel-student', 'Parent withdrew')->>'status' = 'cancelled',
  'Owner cancellation records its reason and closes the active admission'
);
select pg_temp.ok(
  (select archived_at is not null and admission_cancelled_at is not null
      and admission_cancellation_reason = 'Parent withdrew'
   from public.students where id = 'admission-cancel-student'),
  'Cancellation timestamp, reason, and archived state persist together'
);
select pg_temp.ok(
  (select count(*) = 1 and sum(amount) = 25 from public.payments
    where institute_id = 'admission-cancel-institute' and student_id = 'admission-cancel-student')
  and (select count(*) = 1 and sum(amount) = 25 from public.payment_allocations
    where institute_id = 'admission-cancel-institute' and student_id = 'admission-cancel-student')
  and not exists (select 1 from public.refunds where institute_id = 'admission-cancel-institute'),
  'Cancellation preserves the receipt and allocation and creates no refund'
);
reset role;
select pg_temp.ok(
  exists (select 1 from public.payment_checkout_links l join public.payment_orders o
    on o.id = l.payment_order_id and o.institute_id = l.institute_id
    where o.institute_id = 'admission-cancel-institute'
      and o.student_id = 'admission-cancel-student' and l.revoked_at is not null),
  'Outstanding parent checkout capabilities are revoked'
);
set local role authenticated;
select pg_temp.ok(
  public.cancel_student_admission('admission-cancel-institute', 'admission-cancel-student', 'Parent withdrew')->>'status' = 'already_cancelled',
  'Identical retries are idempotent'
);
select pg_temp.throws_ok(
  $$select public.cancel_student_admission('admission-cancel-institute', 'admission-cancel-student', 'Changed reason')$$,
  '23505', 'A retry cannot rewrite the recorded cancellation reason'
);
select pg_temp.throws_ok(
  $$select public.record_manual_payment('admission-cancel-institute', 'admission-cancel-branch', 'admission-cancel-student', 'Fee', 1, 'Cash', (now() at time zone 'Asia/Kolkata')::date)$$,
  '22023', 'Manual receipts cannot be added after cancellation'
);
select pg_temp.throws_ok(
  $$select public.create_online_payment_order_intent('admission-cancel-institute', 'admission-cancel-branch', 'admission-cancel-student', 'razorpay', 'Fee', 1, 'admission-cancel-installment', 1, 'admission-cancel-after-close')$$,
  '22023', 'Online checkout cannot be started after cancellation'
);
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.ok(
  public.resolve_payment_checkout_link(repeat('a', 64)) is null,
  'Parent checkout resolver fails closed after the admission is archived'
);
reset role;
select pg_temp.finish();
rollback;
