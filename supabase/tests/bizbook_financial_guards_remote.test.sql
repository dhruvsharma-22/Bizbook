begin;

-- Temporary TAP-compatible assertions for the remote Management API path.
-- All helper objects are in pg_temp and disappear with the final ROLLBACK.
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);

create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into pg_temp.test_results (passed, description)
  values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;

create or replace function pg_temp.plan(expected integer)
returns text
language plpgsql
as $$
begin
  insert into pg_temp.test_plan values (expected);
  return '1..' || expected::text;
end;
$$;

create or replace function pg_temp.ok(passed boolean, description text)
returns boolean
language plpgsql
as $$
begin
  return pg_temp.record_test(passed, description);
end;
$$;

create or replace function pg_temp."is"(actual anyelement, expected anyelement, description text)
returns boolean
language plpgsql
as $$
begin
  return pg_temp.record_test(actual is not distinct from expected, description);
end;
$$;

create or replace function pg_temp.lives_ok(statement text, description text)
returns boolean
language plpgsql
as $$
begin
  execute statement;
  return pg_temp.record_test(true, description);
exception when others then
  return pg_temp.record_test(false, description || ' (unexpected SQLSTATE ' || SQLSTATE || ')');
end;
$$;

create or replace function pg_temp.throws_ok(
  statement text,
  expected_state text,
  expected_message text,
  description text
)
returns boolean
language plpgsql
as $$
declare
  actual_state text;
  actual_message text;
begin
  execute statement;
  return pg_temp.record_test(false, description || ' (statement did not throw)');
exception when others then
  get stacked diagnostics
    actual_state = returned_sqlstate,
    actual_message = message_text;
  return pg_temp.record_test(
    actual_state = expected_state and actual_message = expected_message,
    case
      when actual_state = expected_state and actual_message = expected_message then description
      else description || ' (got ' || actual_state || ': ' || actual_message || ')'
    end
  );
end;
$$;

create or replace function pg_temp.finish()
returns setof text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  expected_count integer;
  actual_count integer;
  failed_count integer;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed)
    into actual_count, failed_count
    from pg_temp.test_results;

  return next '1..' || coalesce(expected_count, 0)::text;
  return query
    select
      case when passed then 'ok ' else 'not ok ' end
      || assertion_no::text || ' - ' || description
    from pg_temp.test_results
    order by assertion_no;

  if expected_count is null then
    return next 'not ok 0 - plan was not set';
  elsif actual_count <> expected_count then
    return next 'not ok 0 - planned ' || expected_count::text
      || ' assertions but ran ' || actual_count::text;
  end if;

  return next '# assertions=' || actual_count::text || ' failed=' || failed_count::text;
end;
$$;

set local search_path = pg_temp, public, extensions, bizbook_private, auth;
do language plpgsql $grant_temp_usage$
declare
  temp_schema_name text;
begin
  select nspname into temp_schema_name
  from pg_catalog.pg_namespace
  where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;
select pg_temp.plan(48);

insert into auth.users (id, aud, role, email)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'authenticated',
  'authenticated',
  'bizbook-financial-guards@example.invalid'
);
insert into auth.users (id, aud, role, email)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'authenticated',
  'authenticated',
  'bizbook-manager-visibility@example.invalid'
);

insert into public.coaching_institutes (id, business_name)
values
  ('inactive-branch-institute', 'Inactive Branch Test'),
  ('financial-guard-institute', 'Financial Guard Test'),
  ('unrelated-institute', 'Unrelated Institute Test');

insert into public.branches (id, institute_id, name, is_active)
values
  ('inactive-test-branch', 'inactive-branch-institute', 'Inactive', false),
  ('assigned-active-branch', 'inactive-branch-institute', 'Assigned', true),
  ('unassigned-active-branch', 'inactive-branch-institute', 'Unassigned', true),
  ('attendance-other-branch', 'financial-guard-institute', 'Attendance Other Branch', true);

insert into public.user_memberships (institute_id, user_id, role, access_scope)
values
  ('inactive-branch-institute', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accountant', 'branches'),
  ('inactive-branch-institute', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner', 'institute'),
  ('financial-guard-institute', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accountant', 'institute');

insert into public.membership_branch_access (institute_id, user_id, branch_id)
values
  ('inactive-branch-institute', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'inactive-test-branch'),
  ('inactive-branch-institute', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'assigned-active-branch');

insert into public.students (id, institute_id, name)
values
  ('financial-guard-student', 'financial-guard-institute', 'Test Student'),
  ('unrelated-student', 'unrelated-institute', 'Unrelated Student'),
  ('branchless-student', 'inactive-branch-institute', 'Branchless Student'),
  ('assigned-branch-student', 'inactive-branch-institute', 'Assigned Student'),
  ('unassigned-branch-student', 'inactive-branch-institute', 'Unassigned Student');

update public.students
set branch_id = case id
  when 'assigned-branch-student' then 'assigned-active-branch'
  when 'unassigned-branch-student' then 'unassigned-active-branch'
end
where id in ('assigned-branch-student', 'unassigned-branch-student');

insert into public.payments (id, institute_id, branch_id, student_id, receipt_kind, amount, payment_date, method, mode, status)
values
  ('assigned-branch-payment', 'inactive-branch-institute', 'assigned-active-branch', 'assigned-branch-student', 'Fee', 10, current_date, 'Cash', 'Manual', 'Paid'),
  ('unassigned-branch-payment', 'inactive-branch-institute', 'unassigned-active-branch', 'unassigned-branch-student', 'Fee', 10, current_date, 'Cash', 'Manual', 'Paid');

insert into public.payment_reconciliation_records (
  id, institute_id, provider, payment_id, provider_transaction_reference,
  provider_amount, reconciliation_status
)
values
  ('assigned-branch-reconciliation', 'inactive-branch-institute', 'razorpay', 'assigned-branch-payment', 'assigned-branch-provider-ref', 10, 'Matched'),
  ('unassigned-branch-reconciliation', 'inactive-branch-institute', 'razorpay', 'unassigned-branch-payment', 'unassigned-branch-provider-ref', 10, 'Matched'),
  ('unlinked-branch-reconciliation', 'inactive-branch-institute', 'razorpay', null, 'unlinked-branch-provider-ref', 10, 'Unmatched');

select pg_temp."is"(
  (select count(*) from public.students
    where parent_email_opt_in or whatsapp_opt_in),
  0::bigint,
  'Legacy student rows default to no automated reminder consent.'
);

insert into public.staff (id, institute_id, name, monthly_salary, salary_calculation_mode)
values ('financial-guard-staff', 'financial-guard-institute', 'Test Staff', 3000, 'Fixed');

select pg_temp.throws_ok(
  $$insert into public.attendance_records (id, institute_id, branch_id, staff_id, attendance_date, status)
    values ('mismatched-attendance-branch', 'financial-guard-institute', 'attendance-other-branch',
      'financial-guard-staff', current_date, 'Absent')$$,
  '23514',
  'Attendance branch must match the staff member branch.',
  'Attendance cannot be assigned to a branch different from the staff member branch.'
);

insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, status)
values ('unpaid-installment', 'financial-guard-institute', 'financial-guard-student', 1, 1000, 'Pending');

set local time zone 'Etc/GMT+12';
update public.coaching_institutes set time_zone = 'Pacific/Kiritimati'
where id = 'financial-guard-institute';
insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, due_date, status)
values ('timezone-overdue-installment', 'financial-guard-institute', 'financial-guard-student', 2, 1000, current_date, 'Pending');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

select pg_temp.ok(
  not bizbook_private.can_access_branch('inactive-branch-institute', 'inactive-test-branch'),
  'Inactive branches cannot be read through branch access.'
);
select pg_temp.ok(
  not bizbook_private.can_write_branch('inactive-branch-institute', 'inactive-test-branch'),
  'Inactive branches cannot be written through branch access.'
);
select pg_temp.ok(
  not bizbook_private.can_access_branch('inactive-branch-institute', null),
  'Branch-scoped members cannot read institute-wide rows with a null branch.'
);

set local role authenticated;
select pg_temp."is"(
  (select count(*) from public.branches where id = 'inactive-test-branch'),
  0::bigint,
  'RLS hides an inactive branch from its formerly assigned member.'
);
select pg_temp."is"(
  (select count(*) from public.students where id = 'unrelated-student'),
  0::bigint,
  'RLS hides a different institute student from this user.'
);
select pg_temp."is"(
  (select count(*) from public.students where id = 'branchless-student'),
  0::bigint,
  'RLS hides institute-wide student rows from a branch-scoped member.'
);
select pg_temp."is"(
  (select count(*) from public.students where id = 'assigned-branch-student'),
  1::bigint,
  'RLS exposes a student in an assigned active branch.'
);
select pg_temp."is"(
  (select count(*) from public.students where id = 'unassigned-branch-student'),
  0::bigint,
  'RLS hides a student in an unassigned branch.'
);
select pg_temp."is"(
  (select count(*) from public.payment_reconciliation_records
    where id in ('assigned-branch-reconciliation', 'unassigned-branch-reconciliation', 'unlinked-branch-reconciliation')),
  1::bigint,
  'Branch-scoped finance users see only reconciliation rows linked to an authorized branch payment.'
);
reset role;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select pg_temp."is"(
  (select count(*) from public.branches where id = 'inactive-test-branch'),
  1::bigint,
  'Institute managers can see inactive branches they manage.'
);
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

select pg_temp."is"(
  (select balance_status from public.installment_balances where installment_id = 'timezone-overdue-installment'),
  'Overdue',
  'Installment overdue status uses the institute local business date.'
);
update public.coaching_institutes set time_zone = 'Asia/Kolkata'
where id = 'financial-guard-institute';
reset time zone;

select pg_temp.throws_ok(
  $$update public.student_installments set status = 'Paid' where id = 'unpaid-installment'$$,
  '23514',
  'An installment cannot be marked paid while a balance remains.',
  'An installment with an outstanding balance cannot be marked paid.'
);

update public.student_installments
set due_date = (now() at time zone 'Asia/Kolkata')::date + 10
where id = 'unpaid-installment';
select pg_temp."is"(
  (select reminder_schedule_version from public.student_installments where id = 'unpaid-installment'),
  2,
  'Changing the due date increments the reminder schedule version.'
);

insert into public.notification_logs (
  institute_id, channel, event_type, delivery_status,
  reminder_installment_id, reminder_number, reminder_schedule_version,
  reminder_due_date, idempotency_key, attempt_count
) values (
  'financial-guard-institute', 'Email', 'installment_reminder', 'Processing',
  'unpaid-installment', 1, 2, (now() at time zone 'Asia/Kolkata')::date + 10,
  'financial-guard:unpaid-installment:1:2', 1
);
insert into public.notification_logs (
  institute_id, channel, event_type, delivery_status,
  reminder_installment_id, reminder_number, reminder_schedule_version,
  reminder_due_date, idempotency_key, attempt_count
) values (
  'financial-guard-institute', 'Email', 'installment_reminder', 'Processing',
  'unpaid-installment', 1, 2, (now() at time zone 'Asia/Kolkata')::date + 10,
  'financial-guard:unpaid-installment:1:2', 1
) on conflict (idempotency_key) do nothing;
select pg_temp."is"(
  (select count(*) from public.notification_logs
    where idempotency_key = 'financial-guard:unpaid-installment:1:2'),
  1::bigint,
  'A reminder stage and schedule version produce one idempotent delivery log.'
);

select pg_temp.throws_ok(
  $$insert into public.expenses (institute_id, title, category, amount, expense_date, method)
    values ('financial-guard-institute', 'Future expense', 'Other',
      10, (now() at time zone 'Asia/Kolkata')::date + 1, 'Cash')$$,
  '22023',
  'Expense date cannot be in the future.',
  'Future expenses are rejected by the database.'
);

select pg_temp.throws_ok(
  $$select public.record_manual_payment(
    'financial-guard-institute', null, 'financial-guard-student', 'Fee', 100, 'Cash',
    (now() at time zone 'Asia/Kolkata')::date + 1
  )$$,
  '22023',
  'Manual payment details are invalid.',
  'Future manual payment dates are rejected.'
);

select pg_temp.throws_ok(
  $$select public.record_salary_payment(
    'financial-guard-institute', null, 'financial-guard-staff', '2026-10', 3000, now() + interval '1 day'
  )$$,
  '22023',
  'Salary payment details are invalid.',
  'Future salary payment dates are rejected.'
);

select pg_temp.lives_ok(
  $$select public.record_manual_payment(
    p_institute_id := 'financial-guard-institute',
    p_branch_id := null,
    p_student_id := 'financial-guard-student',
    p_receipt_kind := 'Fee',
    p_amount := 100,
    p_method := 'Cash',
    p_payment_date := (now() at time zone 'Asia/Kolkata')::date,
    p_allocations := '[{"installment_id":"unpaid-installment","amount":40}]'::jsonb,
    p_payment_id := 'manual-today-receipt'
  )$$,
  'A payment dated today in the institute time zone is accepted.'
);

select pg_temp.lives_ok(
  $$select public.record_salary_payment(
    p_institute_id := 'financial-guard-institute',
    p_branch_id := null,
    p_staff_id := 'financial-guard-staff',
    p_payroll_month := '2026-10',
    p_amount := 3000,
    p_paid_at := ((now() at time zone 'Asia/Kolkata')::date + time '12:00') at time zone 'Asia/Kolkata'
  )$$,
  'A salary recorded for today in the institute time zone is accepted.'
);

select pg_temp.lives_ok(
  $$insert into public.expenses (id, institute_id, title, category, amount, expense_date, method)
    values ('today-business-expense', 'financial-guard-institute', 'Today expense', 'Other',
      10, (now() at time zone 'Asia/Kolkata')::date, 'Cash')$$,
  'An expense dated today in the institute time zone is accepted.'
);

select pg_temp.throws_ok(
  $$update public.coaching_institutes set time_zone = 'Not/A-Time-Zone'
    where id = 'financial-guard-institute'$$,
  '22023',
  'Institute time zone must be a valid IANA time zone.',
  'Invalid institute time zones are rejected.'
);

insert into public.payments (id, institute_id, student_id, receipt_kind, amount, payment_date, method, mode, status)
values
  ('ordinary-fee-receipt', 'financial-guard-institute', 'financial-guard-student', 'Fee', 100, current_date, 'Cash', 'Manual', 'Paid'),
  ('advance-receipt', 'financial-guard-institute', 'financial-guard-student', 'Advance', 200, current_date, 'Cash', 'Manual', 'Paid');

select pg_temp."is"(
  (select type from public.payment_history where id = 'ordinary-fee-receipt'),
  'Fee',
  'Ordinary fee receipts retain their Fee history classification.'
);
select pg_temp."is"(
  (select type from public.payment_history where id = 'advance-receipt'),
  'Advance',
  'Advance receipts are explicitly classified in payment history.'
);

select pg_temp."is"(
  (select paid_amount from public.installment_balances where installment_id = 'unpaid-installment'),
  40::numeric,
  'A partial fee allocation remains paid against its installment.'
);
select pg_temp."is"(
  (select outstanding_amount from public.installment_balances where installment_id = 'unpaid-installment'),
  960::numeric,
  'The installment outstanding balance subtracts only its recorded allocation.'
);
select pg_temp."is"(
  (select count(*) from public.financial_activity
    where source_type = 'receipt' and source_id = 'manual-today-receipt'),
  1::bigint,
  'A fee receipt is counted once in financial activity regardless of allocations.'
);
select pg_temp."is"(
  (select count(*) from public.payment_history where id = 'manual-today-receipt'),
  1::bigint,
  'A fee receipt appears once in payment history.'
);

select pg_temp.lives_ok(
  $$select public.allocate_advance('advance-receipt', 'unpaid-installment', 80)$$,
  'An existing advance receipt can be allocated to an eligible installment.'
);
select pg_temp."is"(
  (select available_advance from public.advance_balances where payment_id = 'advance-receipt'),
  120::numeric,
  'Available advance subtracts the allocation without changing the receipt amount.'
);
select pg_temp."is"(
  (select count(*) from public.financial_activity
    where source_type = 'receipt' and source_id = 'advance-receipt'),
  1::bigint,
  'An advance receipt is counted once; its allocation is not a new inflow.'
);

select pg_temp.lives_ok(
  $$select public.request_refund(
    p_payment_id := 'manual-today-receipt', p_amount := 10,
    p_reason := 'Synthetic pending refund test', p_mode := 'Manual',
    p_refund_id := 'fee-pending-refund'
  )$$,
  'A valid manual refund request is recorded as pending.'
);
select pg_temp.throws_ok(
  $$select public.request_refund(
    p_payment_id := 'manual-today-receipt', p_amount := 91,
    p_reason := 'Synthetic over-refund test', p_mode := 'Manual',
    p_refund_id := 'fee-over-refund'
  )$$,
  '23514',
  'Refund requests exceed the refundable receipt balance.',
  'Pending refunds reserve receipt capacity and prevent over-refunds.'
);
select pg_temp."is"(
  (select count(*) from public.financial_activity
    where source_type = 'refund' and source_id = 'fee-pending-refund'),
  0::bigint,
  'A pending fee refund does not reduce collections.'
);
select pg_temp.lives_ok(
  $$select public.complete_manual_refund('fee-pending-refund')$$,
  'A pending manual refund can be completed through the database operation.'
);
select pg_temp."is"(
  (select status from public.payments where id = 'manual-today-receipt'),
  'Partially Refunded',
  'A completed partial refund updates the receipt state.'
);
select pg_temp."is"(
  (select amount from public.financial_activity
    where source_type = 'refund' and source_id = 'fee-pending-refund'),
  -10::numeric,
  'A completed fee refund reduces collections by its completed amount.'
);

select pg_temp.lives_ok(
  $$select public.request_refund(
    p_payment_id := 'advance-receipt', p_amount := 20,
    p_reason := 'Synthetic advance refund test', p_mode := 'Manual',
    p_refund_id := 'advance-pending-refund'
  )$$,
  'An unallocated advance can reserve a valid refund amount.'
);
select pg_temp."is"(
  (select available_advance from public.advance_balances where payment_id = 'advance-receipt'),
  100::numeric,
  'A pending refund reserves the unallocated advance balance.'
);
select pg_temp."is"(
  (select count(*) from public.financial_activity
    where source_type = 'refund' and source_id = 'advance-pending-refund'),
  0::bigint,
  'A pending advance refund is not reported as a completed cash outflow.'
);
select pg_temp.lives_ok(
  $$select public.complete_manual_refund('advance-pending-refund')$$,
  'A pending manual advance refund can be completed.'
);
select pg_temp."is"(
  (select available_advance from public.advance_balances where payment_id = 'advance-receipt'),
  100::numeric,
  'A completed unallocated advance refund remains deducted from available credit.'
);
select pg_temp."is"(
  (select amount from public.financial_activity
    where source_type = 'refund' and source_id = 'advance-pending-refund'),
  -20::numeric,
  'Only the completed advance refund is recorded as an outflow.'
);

select pg_temp."is"(
  (select count(*) from public.financial_activity
    where source_type = 'salary_payment' and source_id = 'financial-guard-staff:2026-10'),
  1::bigint,
  'A salary payment is counted once in financial activity.'
);
select pg_temp."is"(
  (select count(*) from public.payment_history where id = 'financial-guard-staff:2026-10'),
  1::bigint,
  'A salary payment appears once in payment history.'
);
select pg_temp."is"(
  (select category from public.financial_activity
    where source_type = 'expense' and source_id = 'today-business-expense'),
  'business_expense',
  'A business expense is classified as an expense rather than a receipt.'
);
select pg_temp."is"(
  (select amount from public.financial_activity
    where source_type = 'expense' and source_id = 'today-business-expense'),
  -10::numeric,
  'A business expense is recorded as a negative outflow.'
);

select * from pg_temp.finish();
rollback;
