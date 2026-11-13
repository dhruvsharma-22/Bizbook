begin;
select plan(38);

insert into auth.users (id, aud, role, email)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated', 'authenticated', 'bizbook-student-owner@example.invalid');
insert into auth.users (id, aud, role, email)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated', 'authenticated', 'bizbook-student-accountant@example.invalid');
insert into public.coaching_institutes (id, business_name)
values ('student-operation-institute', 'Student Operation Test');
insert into public.branches (id, institute_id, name)
values ('student-operation-branch', 'student-operation-institute', 'Test Branch');
insert into public.user_memberships (institute_id, user_id, role, access_scope)
values
  ('student-operation-institute', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner', 'institute'),
  ('student-operation-institute', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'accountant', 'institute');

create function pg_temp.student_record_payload(p_total numeric default 200, p_admission numeric default 20)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'name', 'Test Student',
    'gender', 'Female',
    'parentName', 'Test Parent',
    'parentEmail', 'parent@example.invalid',
    'parentEmailOptIn', false,
    'whatsappOptIn', false,
    'parentMobile', '9876543210',
    'whatsapp', '9876543210',
    'course', 'Mathematics',
    'className', 'Grade 8',
    'admissionDate', '2026-10-01',
    'admissionFee', p_admission,
    'totalFee', p_total,
    'legacyData', '{"unknownStudentField":{"source":"legacy"}}'::jsonb
  );
$$;

select set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
set local role authenticated;

select lives_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[
      {"id":"student-operation-installment-1","amount":80,"dueDate":"2026-11-01","legacyData":{"unknownInstallmentField":"keep-1"}},
      {"id":"student-operation-installment-2","amount":100,"dueDate":"2026-12-01","legacyData":{"unknownInstallmentField":"keep-2"}}
    ]'::jsonb
  )$$,
  'An institute owner can atomically create a student and a balanced installment schedule.'
);
select is(
  (select total_fee from public.students where id = 'student-operation-student'),
  200::numeric,
  'The normalized student fee is persisted.'
);
select is(
  (select legacy_data->'unknownStudentField'->>'source' from public.students where id = 'student-operation-student'),
  'legacy',
  'Unknown student legacy fields are retained.'
);
select is(
  (select count(*) from public.student_installments where student_id = 'student-operation-student'),
  3::bigint,
  'The admission fee and both schedule installments are created in the same transaction.'
);
select is(
  (select scheduled_amount from public.student_installments where student_id = 'student-operation-student' and sequence_number = 0),
  20::numeric,
  'The admission fee is represented by its own installment balance.'
);

select lives_ok(
  $$select public.record_manual_payment(
    'student-operation-institute', null, 'student-operation-student', 'Fee', 50, 'Cash',
    (now() at time zone 'Asia/Kolkata')::date,
    p_allocations := '[{"installment_id":"student-operation-installment-1","amount":40}]'::jsonb,
    p_payment_id := 'student-operation-partial-payment'
  )$$,
  'A partial payment can be allocated to a student installment.'
);
select is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-1'),
  40::numeric,
  'The installment balance reports the actual partial amount paid.'
);
select is(
  (select outstanding_amount from public.installment_balances where installment_id = 'student-operation-installment-1'),
  40::numeric,
  'The installment balance preserves the remaining amount after partial payment.'
);
select is(
  (select receipt_count from public.student_receipt_balances where student_id = 'student-operation-student'),
  1::bigint,
  'One actual payment row produces one student receipt.'
);
select is(
  (select receipt_total from public.student_receipt_balances where student_id = 'student-operation-student'),
  50::numeric,
  'The allocation does not create a second receipt amount.'
);
select lives_ok(
  $$select public.request_refund(
    p_payment_id := 'student-operation-partial-payment',
    p_amount := 10,
    p_reason := 'Test pending refund',
    p_mode := 'Manual',
    p_refund_id := 'student-operation-refund'
  )$$,
  'A pending refund can reserve unallocated receipt capacity.'
);
select throws_ok(
  $$select public.request_refund(
    p_payment_id := 'student-operation-partial-payment',
    p_amount := 40.01,
    p_reason := 'Exceeds amount remaining after pending reservation',
    p_mode := 'Manual',
    p_refund_id := 'student-operation-refund-over-limit'
  )$$,
  '23514',
  'Refund requests exceed the refundable receipt balance.',
  'A pending refund reserves capacity and prevents an overlapping request.'
);
select is(
  (select net_receipts from public.student_receipt_balances where student_id = 'student-operation-student'),
  50::numeric,
  'A pending refund does not reduce student receipt totals.'
);
select lives_ok(
  $$select public.complete_manual_refund('student-operation-refund')$$,
  'An authorized manual refund can be completed.'
);
select is(
  (select net_receipts from public.student_receipt_balances where student_id = 'student-operation-student'),
  40::numeric,
  'A completed refund reduces net receipts exactly once.'
);
select lives_ok(
  $$select public.record_manual_payment(
    'student-operation-institute', null, 'student-operation-student', 'Advance', 30, 'Cash',
    (now() at time zone 'Asia/Kolkata')::date,
    p_payment_id := 'student-operation-advance'
  )$$,
  'A standalone advance receipt can be recorded.'
);
select is(
  (select receipt_count from public.student_receipt_balances where student_id = 'student-operation-student'),
  2::bigint,
  'The fee receipt and advance receipt each count once.'
);
select is(
  (select receipt_total from public.student_receipt_balances where student_id = 'student-operation-student'),
  80::numeric,
  'The advance contributes its actual receipt amount once.'
);
select is(
  (select net_receipts from public.student_receipt_balances where student_id = 'student-operation-student'),
  70::numeric,
  'Student net receipts subtract only the completed refund.'
);
select lives_ok(
  $$select public.allocate_advance('student-operation-advance', 'student-operation-installment-2', 15)$$,
  'An advance receipt can be allocated to an installment.'
);
select is(
  (select receipt_total from public.student_receipt_balances where student_id = 'student-operation-student'),
  80::numeric,
  'Allocating an advance does not create another receipt or inflow.'
);
select is(
  (select receipt_count from public.student_receipt_balances where student_id = 'student-operation-student'),
  2::bigint,
  'Advance allocation does not increment the receipt count.'
);
select is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-2'),
  15::numeric,
  'Advance allocation updates installment paid amount without changing receipt totals.'
);

select lives_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[
      {"id":"student-operation-installment-1","amount":40,"dueDate":"2026-11-01","legacyData":{"unknownInstallmentField":"keep-1"}},
      {"id":"student-operation-installment-2","amount":140,"dueDate":"2026-12-01","legacyData":{"unknownInstallmentField":"keep-2"}}
    ]'::jsonb
  )$$,
  'A schedule can be revised while retaining its net paid amount.'
);
select is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-1'),
  40::numeric,
  'Editing a schedule does not alter the payment allocation.'
);
select is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-2'),
  15::numeric,
  'Editing a schedule preserves the amount allocated from an advance.'
);
select is(
  (select legacy_data->>'unknownInstallmentField' from public.student_installments where id = 'student-operation-installment-1'),
  'keep-1',
  'Unknown installment fields are retained during schedule edits.'
);

select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":80,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":99.99,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'Installments must equal the remaining fee after the admission fee.',
  'A one-paise schedule mismatch is rejected.'
);
select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":80,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":99,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'Installments must equal the remaining fee after the admission fee.',
  'A schedule with a mismatched total is rejected.'
);
select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":39,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":141,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'An installment cannot be reduced below its net paid amount.',
  'A paid allocation cannot be reduced by a schedule edit.'
);
select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-2","amount":180,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'An installment with payment history cannot be removed.',
  'An installment with a receipt allocation cannot be removed.'
);
select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', 'student-operation-branch', 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":40,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":140,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'A student with payment history cannot be moved to another branch.',
  'A student with receipts cannot be moved to a different branch.'
);

select lives_ok(
  $$select public.archive_student_record('student-operation-institute', 'student-operation-student')$$,
  'An institute owner can archive a student.'
);
select ok(
  (select archived_at is not null from public.students where id = 'student-operation-student'),
  'Archiving retains the student row and records its archive time.'
);
select is(
  (select count(*) from public.student_installments where student_id = 'student-operation-student'),
  3::bigint,
  'Archiving retains installment history.'
);
select throws_ok(
  $$select public.allocate_advance('student-operation-advance', 'student-operation-installment-2', 1)$$,
  '23514',
  'Archived students cannot receive advance allocations.',
  'An archived student retains history but cannot receive new financial allocations.'
);
select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":40,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":140,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'Archived students cannot be edited.',
  'An archived student cannot be edited through the record operation.'
);

reset role;
select set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
set local role authenticated;
select throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'another-student',
    pg_temp.student_record_payload(), '[]'::jsonb
  )$$,
  '42501',
  'Authorized institute administrator access is required.',
  'An accountant cannot create student master records.'
);

select * from finish();
rollback;
