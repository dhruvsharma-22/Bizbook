begin;
create temporary table test_results (assertion_no bigint generated always as identity primary key, passed boolean not null, description text not null);
create temporary table test_plan (expected integer not null);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin insert into pg_temp.test_results(passed, description) values (coalesce(passed, false), description); return coalesce(passed, false); end; $$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$ begin insert into pg_temp.test_plan values(expected); return '1..' || expected::text; end; $$;
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$ begin return pg_temp.record_test(passed, description); end; $$;
create or replace function pg_temp.is(p_actual anyelement, p_expected anyelement, description text)
returns boolean language plpgsql as $$ begin return pg_temp.record_test(p_actual is not distinct from p_expected, description); end; $$;
create or replace function pg_temp.lives_ok(p_sql text, description text)
returns boolean language plpgsql as $$
declare actual_state text; actual_message text;
begin
  execute p_sql;
  insert into pg_temp.test_results(passed, description) values (true, description);
  return true;
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate, actual_message = message_text;
  insert into pg_temp.test_results(passed, description) values (false, description || ' (unexpected SQL error ' || actual_state || ': ' || actual_message || ')');
  return false;
end; $$;
create or replace function pg_temp.throws_ok(p_sql text, expected_state text, expected_message text, description text)
returns boolean language plpgsql as $$
declare actual_state text; actual_message text;
begin
  execute p_sql;
  insert into pg_temp.test_results(passed, description) values (false, description || ' (expected error was not raised)');
  return false;
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate, actual_message = message_text;
  insert into pg_temp.test_results(passed, description)
  values (actual_state = expected_state and actual_message = expected_message, description);
  return actual_state = expected_state and actual_message = expected_message;
end; $$;
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
end; $$;
do $grant_temp_access$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
  execute pg_catalog.format('grant insert, select on %I.test_results, %I.test_plan to authenticated', temp_schema_name, temp_schema_name);
end;
$grant_temp_access$;
select pg_temp.plan(38);

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
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.lives_ok(
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
select pg_temp.is(
  (select total_fee from public.students where id = 'student-operation-student'),
  200::numeric,
  'The normalized student fee is persisted.'
);
select pg_temp.is(
  (select legacy_data->'unknownStudentField'->>'source' from public.students where id = 'student-operation-student'),
  'legacy',
  'Unknown student legacy fields are retained.'
);
select pg_temp.is(
  (select count(*) from public.student_installments where student_id = 'student-operation-student'),
  3::bigint,
  'The admission fee and both schedule installments are created in the same transaction.'
);
select pg_temp.is(
  (select scheduled_amount from public.student_installments where student_id = 'student-operation-student' and sequence_number = 0),
  20::numeric,
  'The admission fee is represented by its own installment balance.'
);

select pg_temp.lives_ok(
  $$select public.record_manual_payment(
    'student-operation-institute', null, 'student-operation-student', 'Fee', 50, 'Cash',
    (now() at time zone 'Asia/Kolkata')::date,
    p_allocations := '[{"installment_id":"student-operation-installment-1","amount":40}]'::jsonb,
    p_payment_id := 'student-operation-partial-payment'
  )$$,
  'A partial payment can be allocated to a student installment.'
);
select pg_temp.is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-1'),
  40::numeric,
  'The installment balance reports the actual partial amount paid.'
);
select pg_temp.is(
  (select outstanding_amount from public.installment_balances where installment_id = 'student-operation-installment-1'),
  40::numeric,
  'The installment balance preserves the remaining amount after partial payment.'
);
select pg_temp.is(
  (select receipt_count from public.student_receipt_balances where student_id = 'student-operation-student'),
  1::bigint,
  'One actual payment row produces one student receipt.'
);
select pg_temp.is(
  (select receipt_total from public.student_receipt_balances where student_id = 'student-operation-student'),
  50::numeric,
  'The allocation does not create a second receipt amount.'
);
select pg_temp.lives_ok(
  $$select public.request_refund(
    p_payment_id := 'student-operation-partial-payment',
    p_amount := 10,
    p_reason := 'Test pending refund',
    p_mode := 'Manual',
    p_refund_id := 'student-operation-refund'
  )$$,
  'A pending refund can reserve unallocated receipt capacity.'
);
select pg_temp.throws_ok(
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
select pg_temp.is(
  (select net_receipts from public.student_receipt_balances where student_id = 'student-operation-student'),
  50::numeric,
  'A pending refund does not reduce student receipt totals.'
);
select pg_temp.lives_ok(
  $$select public.complete_manual_refund('student-operation-refund')$$,
  'An authorized manual refund can be completed.'
);
select pg_temp.is(
  (select net_receipts from public.student_receipt_balances where student_id = 'student-operation-student'),
  40::numeric,
  'A completed refund reduces net receipts exactly once.'
);
select pg_temp.lives_ok(
  $$select public.record_manual_payment(
    'student-operation-institute', null, 'student-operation-student', 'Advance', 30, 'Cash',
    (now() at time zone 'Asia/Kolkata')::date,
    p_payment_id := 'student-operation-advance'
  )$$,
  'A standalone advance receipt can be recorded.'
);
select pg_temp.is(
  (select receipt_count from public.student_receipt_balances where student_id = 'student-operation-student'),
  2::bigint,
  'The fee receipt and advance receipt each count once.'
);
select pg_temp.is(
  (select receipt_total from public.student_receipt_balances where student_id = 'student-operation-student'),
  80::numeric,
  'The advance contributes its actual receipt amount once.'
);
select pg_temp.is(
  (select net_receipts from public.student_receipt_balances where student_id = 'student-operation-student'),
  70::numeric,
  'Student net receipts subtract only the completed refund.'
);
select pg_temp.lives_ok(
  $$select public.allocate_advance('student-operation-advance', 'student-operation-installment-2', 15)$$,
  'An advance receipt can be allocated to an installment.'
);
select pg_temp.is(
  (select receipt_total from public.student_receipt_balances where student_id = 'student-operation-student'),
  80::numeric,
  'Allocating an advance does not create another receipt or inflow.'
);
select pg_temp.is(
  (select receipt_count from public.student_receipt_balances where student_id = 'student-operation-student'),
  2::bigint,
  'Advance allocation does not increment the receipt count.'
);
select pg_temp.is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-2'),
  15::numeric,
  'Advance allocation updates installment paid amount without changing receipt totals.'
);

select pg_temp.lives_ok(
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
select pg_temp.is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-1'),
  40::numeric,
  'Editing a schedule does not alter the payment allocation.'
);
select pg_temp.is(
  (select paid_amount from public.installment_balances where installment_id = 'student-operation-installment-2'),
  15::numeric,
  'Editing a schedule preserves the amount allocated from an advance.'
);
select pg_temp.is(
  (select legacy_data->>'unknownInstallmentField' from public.student_installments where id = 'student-operation-installment-1'),
  'keep-1',
  'Unknown installment fields are retained during schedule edits.'
);

select pg_temp.throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":80,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":99.99,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'Installments must equal the remaining fee after the admission fee.',
  'A one-paise schedule mismatch is rejected.'
);
select pg_temp.throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":80,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":99,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'Installments must equal the remaining fee after the admission fee.',
  'A schedule with a mismatched total is rejected.'
);
select pg_temp.throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":39,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":141,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'An installment cannot be reduced below its net paid amount.',
  'A paid allocation cannot be reduced by a schedule edit.'
);
select pg_temp.throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-2","amount":180,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'An installment with payment history cannot be removed.',
  'An installment with a receipt allocation cannot be removed.'
);
select pg_temp.throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', 'student-operation-branch', 'student-operation-student',
    pg_temp.student_record_payload(),
    '[{"id":"student-operation-installment-1","amount":40,"dueDate":"2026-11-01"},{"id":"student-operation-installment-2","amount":140,"dueDate":"2026-12-01"}]'::jsonb
  )$$,
  '23514',
  'A student with payment history cannot be moved to another branch.',
  'A student with receipts cannot be moved to a different branch.'
);

select pg_temp.lives_ok(
  $$select public.archive_student_record('student-operation-institute', 'student-operation-student')$$,
  'An institute owner can archive a student.'
);
select pg_temp.ok(
  (select archived_at is not null from public.students where id = 'student-operation-student'),
  'Archiving retains the student row and records its archive time.'
);
select pg_temp.is(
  (select count(*) from public.student_installments where student_id = 'student-operation-student'),
  3::bigint,
  'Archiving retains installment history.'
);
select pg_temp.throws_ok(
  $$select public.allocate_advance('student-operation-advance', 'student-operation-installment-2', 1)$$,
  '23514',
  'Archived students cannot receive advance allocations.',
  'An archived student retains history but cannot receive new financial allocations.'
);
select pg_temp.throws_ok(
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
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.throws_ok(
  $$select public.save_student_record(
    'student-operation-institute', null, 'another-student',
    pg_temp.student_record_payload(), '[]'::jsonb
  )$$,
  '42501',
  'Authorized institute administrator access is required.',
  'An accountant cannot create student master records.'
);

select * from pg_temp.finish();
rollback;
