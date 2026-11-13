begin;

select plan(47);

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
  ('unassigned-active-branch', 'inactive-branch-institute', 'Unassigned', true);

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

select is(
  (select count(*) from public.students
    where parent_email_opt_in or whatsapp_opt_in),
  0::bigint,
  'Legacy student rows default to no automated reminder consent.'
);

insert into public.staff (id, institute_id, name, monthly_salary, salary_calculation_mode)
values ('financial-guard-staff', 'financial-guard-institute', 'Test Staff', 3000, 'Fixed');

insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, status)
values ('unpaid-installment', 'financial-guard-institute', 'financial-guard-student', 1, 1000, 'Pending');

set local time zone 'Etc/GMT+12';
update public.coaching_institutes set time_zone = 'Pacific/Kiritimati'
where id = 'financial-guard-institute';
insert into public.student_installments (id, institute_id, student_id, sequence_number, scheduled_amount, due_date, status)
values ('timezone-overdue-installment', 'financial-guard-institute', 'financial-guard-student', 2, 1000, current_date, 'Pending');

select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

select ok(
  not bizbook_private.can_access_branch('inactive-branch-institute', 'inactive-test-branch'),
  'Inactive branches cannot be read through branch access.'
);
select ok(
  not bizbook_private.can_write_branch('inactive-branch-institute', 'inactive-test-branch'),
  'Inactive branches cannot be written through branch access.'
);
select ok(
  not bizbook_private.can_access_branch('inactive-branch-institute', null),
  'Branch-scoped members cannot read institute-wide rows with a null branch.'
);

set local role authenticated;
select is(
  (select count(*) from public.branches where id = 'inactive-test-branch'),
  0::bigint,
  'RLS hides an inactive branch from its formerly assigned member.'
);
select is(
  (select count(*) from public.students where id = 'unrelated-student'),
  0::bigint,
  'RLS hides a different institute student from this user.'
);
select is(
  (select count(*) from public.students where id = 'branchless-student'),
  0::bigint,
  'RLS hides institute-wide student rows from a branch-scoped member.'
);
select is(
  (select count(*) from public.students where id = 'assigned-branch-student'),
  1::bigint,
  'RLS exposes a student in an assigned active branch.'
);
select is(
  (select count(*) from public.students where id = 'unassigned-branch-student'),
  0::bigint,
  'RLS hides a student in an unassigned branch.'
);
select is(
  (select count(*) from public.payment_reconciliation_records
    where id in ('assigned-branch-reconciliation', 'unassigned-branch-reconciliation', 'unlinked-branch-reconciliation')),
  1::bigint,
  'Branch-scoped finance users see only reconciliation rows linked to an authorized branch payment.'
);
reset role;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
set local role authenticated;
select is(
  (select count(*) from public.branches where id = 'inactive-test-branch'),
  1::bigint,
  'Institute managers can see inactive branches they manage.'
);
reset role;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

select is(
  (select balance_status from public.installment_balances where installment_id = 'timezone-overdue-installment'),
  'Overdue',
  'Installment overdue status uses the institute local business date.'
);
update public.coaching_institutes set time_zone = 'Asia/Kolkata'
where id = 'financial-guard-institute';
reset time zone;

select throws_ok(
  $$update public.student_installments set status = 'Paid' where id = 'unpaid-installment'$$,
  '23514',
  'An installment cannot be marked paid while a balance remains.',
  'An installment with an outstanding balance cannot be marked paid.'
);

update public.student_installments
set due_date = (now() at time zone 'Asia/Kolkata')::date + 10
where id = 'unpaid-installment';
select is(
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
select is(
  (select count(*) from public.notification_logs
    where idempotency_key = 'financial-guard:unpaid-installment:1:2'),
  1::bigint,
  'A reminder stage and schedule version produce one idempotent delivery log.'
);

select throws_ok(
  $$insert into public.expenses (institute_id, title, category, amount, expense_date, method)
    values ('financial-guard-institute', 'Future expense', 'Other',
      10, (now() at time zone 'Asia/Kolkata')::date + 1, 'Cash')$$,
  '22023',
  'Expense date cannot be in the future.',
  'Future expenses are rejected by the database.'
);

select throws_ok(
  $$select public.record_manual_payment(
    'financial-guard-institute', null, 'financial-guard-student', 'Fee', 100, 'Cash',
    (now() at time zone 'Asia/Kolkata')::date + 1
  )$$,
  '22023',
  'Manual payment details are invalid.',
  'Future manual payment dates are rejected.'
);

select throws_ok(
  $$select public.record_salary_payment(
    'financial-guard-institute', null, 'financial-guard-staff', '2026-10', 3000, now() + interval '1 day'
  )$$,
  '22023',
  'Salary payment details are invalid.',
  'Future salary payment dates are rejected.'
);

select lives_ok(
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

select lives_ok(
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

select lives_ok(
  $$insert into public.expenses (id, institute_id, title, category, amount, expense_date, method)
    values ('today-business-expense', 'financial-guard-institute', 'Today expense', 'Other',
      10, (now() at time zone 'Asia/Kolkata')::date, 'Cash')$$,
  'An expense dated today in the institute time zone is accepted.'
);

select throws_ok(
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

select is(
  (select type from public.payment_history where id = 'ordinary-fee-receipt'),
  'Fee',
  'Ordinary fee receipts retain their Fee history classification.'
);
select is(
  (select type from public.payment_history where id = 'advance-receipt'),
  'Advance',
  'Advance receipts are explicitly classified in payment history.'
);

select is(
  (select paid_amount from public.installment_balances where installment_id = 'unpaid-installment'),
  40::numeric,
  'A partial fee allocation remains paid against its installment.'
);
select is(
  (select outstanding_amount from public.installment_balances where installment_id = 'unpaid-installment'),
  960::numeric,
  'The installment outstanding balance subtracts only its recorded allocation.'
);
select is(
  (select count(*) from public.financial_activity
    where source_type = 'receipt' and source_id = 'manual-today-receipt'),
  1::bigint,
  'A fee receipt is counted once in financial activity regardless of allocations.'
);
select is(
  (select count(*) from public.payment_history where id = 'manual-today-receipt'),
  1::bigint,
  'A fee receipt appears once in payment history.'
);

select lives_ok(
  $$select public.allocate_advance('advance-receipt', 'unpaid-installment', 80)$$,
  'An existing advance receipt can be allocated to an eligible installment.'
);
select is(
  (select available_advance from public.advance_balances where payment_id = 'advance-receipt'),
  120::numeric,
  'Available advance subtracts the allocation without changing the receipt amount.'
);
select is(
  (select count(*) from public.financial_activity
    where source_type = 'receipt' and source_id = 'advance-receipt'),
  1::bigint,
  'An advance receipt is counted once; its allocation is not a new inflow.'
);

select lives_ok(
  $$select public.request_refund(
    p_payment_id := 'manual-today-receipt', p_amount := 10,
    p_reason := 'Synthetic pending refund test', p_mode := 'Manual',
    p_refund_id := 'fee-pending-refund'
  )$$,
  'A valid manual refund request is recorded as pending.'
);
select throws_ok(
  $$select public.request_refund(
    p_payment_id := 'manual-today-receipt', p_amount := 91,
    p_reason := 'Synthetic over-refund test', p_mode := 'Manual',
    p_refund_id := 'fee-over-refund'
  )$$,
  '23514',
  'Refund requests exceed the refundable receipt balance.',
  'Pending refunds reserve receipt capacity and prevent over-refunds.'
);
select is(
  (select count(*) from public.financial_activity
    where source_type = 'refund' and source_id = 'fee-pending-refund'),
  0::bigint,
  'A pending fee refund does not reduce collections.'
);
select lives_ok(
  $$select public.complete_manual_refund('fee-pending-refund')$$,
  'A pending manual refund can be completed through the database operation.'
);
select is(
  (select status from public.payments where id = 'manual-today-receipt'),
  'Partially Refunded',
  'A completed partial refund updates the receipt state.'
);
select is(
  (select amount from public.financial_activity
    where source_type = 'refund' and source_id = 'fee-pending-refund'),
  -10::numeric,
  'A completed fee refund reduces collections by its completed amount.'
);

select lives_ok(
  $$select public.request_refund(
    p_payment_id := 'advance-receipt', p_amount := 20,
    p_reason := 'Synthetic advance refund test', p_mode := 'Manual',
    p_refund_id := 'advance-pending-refund'
  )$$,
  'An unallocated advance can reserve a valid refund amount.'
);
select is(
  (select available_advance from public.advance_balances where payment_id = 'advance-receipt'),
  100::numeric,
  'A pending refund reserves the unallocated advance balance.'
);
select is(
  (select count(*) from public.financial_activity
    where source_type = 'refund' and source_id = 'advance-pending-refund'),
  0::bigint,
  'A pending advance refund is not reported as a completed cash outflow.'
);
select lives_ok(
  $$select public.complete_manual_refund('advance-pending-refund')$$,
  'A pending manual advance refund can be completed.'
);
select is(
  (select available_advance from public.advance_balances where payment_id = 'advance-receipt'),
  100::numeric,
  'A completed unallocated advance refund remains deducted from available credit.'
);
select is(
  (select amount from public.financial_activity
    where source_type = 'refund' and source_id = 'advance-pending-refund'),
  -20::numeric,
  'Only the completed advance refund is recorded as an outflow.'
);

select is(
  (select count(*) from public.financial_activity
    where source_type = 'salary_payment' and source_id = 'financial-guard-staff:2026-10'),
  1::bigint,
  'A salary payment is counted once in financial activity.'
);
select is(
  (select count(*) from public.payment_history where id = 'financial-guard-staff:2026-10'),
  1::bigint,
  'A salary payment appears once in payment history.'
);
select is(
  (select category from public.financial_activity
    where source_type = 'expense' and source_id = 'today-business-expense'),
  'business_expense',
  'A business expense is classified as an expense rather than a receipt.'
);
select is(
  (select amount from public.financial_activity
    where source_type = 'expense' and source_id = 'today-business-expense'),
  -10::numeric,
  'A business expense is recorded as a negative outflow.'
);

select * from finish();
rollback;
