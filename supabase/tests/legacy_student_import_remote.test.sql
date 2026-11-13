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
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actual_state text; actual_message text;
begin
  execute p_sql;
  insert into pg_temp.test_results(passed, description) values (true, description);
  return true;
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate, actual_message = message_text;
  insert into pg_temp.test_results(passed, description) values (false, description || ' (unexpected ' || actual_state || ': ' || actual_message || ')');
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
  insert into pg_temp.test_results(passed, description) values (actual_state = expected_state and actual_message = expected_message, description);
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
select pg_temp.plan(16);

insert into auth.users (id, aud, role, email)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'authenticated', 'authenticated', 'legacy-import-owner@example.invalid');
insert into auth.users (id, aud, role, email)
values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'authenticated', 'authenticated', 'legacy-import-other@example.invalid');
insert into auth.users (id, aud, role, email)
values ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'legacy-import-accountant@example.invalid');
insert into auth.users (id, aud, role, email)
values ('88888888-8888-4888-8888-888888888888', 'authenticated', 'authenticated', 'legacy-import-branch-owner@example.invalid');
insert into public.coaching_institutes (id, business_name) values
  ('legacy-import-institute', 'Legacy Import Test Institute'),
  ('legacy-import-other-institute', 'Other Import Test Institute');
insert into public.branches (id, institute_id, name) values
  ('legacy-import-branch', 'legacy-import-institute', 'Import Branch'),
  ('legacy-import-other-branch', 'legacy-import-institute', 'Other Branch');
insert into public.user_memberships (institute_id, user_id, role, access_scope) values
  ('legacy-import-institute', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'owner', 'institute'),
  ('legacy-import-institute', '11111111-1111-4111-8111-111111111111', 'accountant', 'institute'),
  ('legacy-import-institute', '88888888-8888-4888-8888-888888888888', 'owner', 'branches'),
  ('legacy-import-other-institute', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'owner', 'institute');
insert into public.membership_branch_access (institute_id, user_id, branch_id)
values ('legacy-import-institute', '88888888-8888-4888-8888-888888888888', 'legacy-import-branch');

select set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}', true);
set local role authenticated;

select pg_temp.ok(
  not has_table_privilege('authenticated', 'public.legacy_student_imports', 'INSERT'),
  'Authenticated clients cannot insert import mappings directly.'
);
select pg_temp.ok(
  has_function_privilege('authenticated', 'public.import_legacy_student_record(text,text,text,text,text,text,jsonb,jsonb,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.import_legacy_student_record(text,text,text,text,text,text,jsonb,jsonb,boolean)', 'EXECUTE'),
  'The import RPC is executable by authenticated users only.'
);
select pg_temp.lives_ok(
  $$select * from public.import_legacy_student_record(
    'legacy-import-institute', 'legacy-import-branch', 'bizbook-students-staff-v1', 'old-student-1', repeat('a',64),
    '22222222-2222-4222-8222-222222222222',
    '{"name":"Legacy Student","gender":"Other","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100,"legacyData":{"importedFrom":"legacy-browser"}}'::jsonb,
    '[{"id":"22222222-2222-4222-8222-222222222222:fee:1","sequenceNumber":1,"amount":80,"dueDate":"2026-12-01"}]'::jsonb,
    true
  )$$,
  'An authorized owner can import one student with a fully unpaid schedule.'
);
select pg_temp.is((select count(*) from public.students where id = '22222222-2222-4222-8222-222222222222' and institute_id = 'legacy-import-institute'), 1::bigint,
  'The student record is created in the authorized institute.');
select pg_temp.is((select count(*) from public.student_installments where student_id = '22222222-2222-4222-8222-222222222222' and institute_id = 'legacy-import-institute'), 2::bigint,
  'Admission and scheduled installments are created atomically.');
select pg_temp.is((select count(*) from public.legacy_student_imports where source_record_id = 'old-student-1'), 1::bigint,
  'A source fingerprint mapping is recorded once.');
select pg_temp.is((select count(*) from public.audit_logs where entity_type = 'legacy_student_import' and entity_id in (select id::text from public.legacy_student_imports)), 1::bigint,
  'The import operation creates an audit event without storing source payload.');
select pg_temp.is((
  select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'legacy_student_imports'
    and column_name in ('payload', 'source_payload', 'raw_record')
), 0::bigint, 'Raw source records are not stored in the import mapping table.');
select pg_temp.is((
  select was_already_imported from public.import_legacy_student_record(
    'legacy-import-institute', 'legacy-import-branch', 'bizbook-students-staff-v1', 'old-student-1', repeat('a',64),
    '33333333-3333-4333-8333-333333333333',
    '{"name":"Different retry payload is ignored","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100}'::jsonb,
    '[{"id":"33333333-3333-4333-8333-333333333333:fee:1","sequenceNumber":1,"amount":80}]'::jsonb,
    true
  )
), true, 'An exact source retry returns the existing mapping without modifying the student.');
select pg_temp.is((
  select imported_student_id from public.import_legacy_student_record(
    'legacy-import-institute', 'legacy-import-branch', 'bizbook-students-staff-v1', 'old-student-1', repeat('a',64),
    '33333333-3333-4333-8333-333333333333',
    '{"name":"Different retry payload is ignored","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100}'::jsonb,
    '[{"id":"33333333-3333-4333-8333-333333333333:fee:1","sequenceNumber":1,"amount":80}]'::jsonb,
    true
  )
), '22222222-2222-4222-8222-222222222222'::text, 'A retry cannot replace the imported target ID.');
select pg_temp.is((select count(*) from public.students where institute_id = 'legacy-import-institute'), 1::bigint,
  'A retry does not create a duplicate student.');
reset role;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.throws_ok(
  $$select * from public.import_legacy_student_record(
    'legacy-import-institute', 'legacy-import-branch', 'bizbook-students-staff-v1', 'old-student-1', repeat('b',64),
    '44444444-4444-4444-8444-444444444444',
    '{"name":"Changed","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100}'::jsonb,
    '[{"id":"44444444-4444-4444-8444-444444444444:fee:1","sequenceNumber":1,"amount":80}]'::jsonb, true
  )$$,
  '23505', 'This legacy source record changed after a previous import.',
  'Changing a source record under the same source identity is rejected.'
);
select pg_temp.throws_ok(
  $$select * from public.import_legacy_student_record(
    'legacy-import-institute', 'legacy-import-branch', 'unknown-key', 'source-2', repeat('c',64),
    '55555555-5555-4555-8555-555555555555',
    '{"name":"Changed","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100}'::jsonb,
    '[{"id":"55555555-5555-4555-8555-555555555555:fee:1","sequenceNumber":1,"amount":80}]'::jsonb, true
  )$$,
  '22023', 'Legacy student import details or confirmation are invalid.',
  'Only the supported student legacy source is accepted.'
);
select pg_temp.throws_ok(
  $$select * from public.import_legacy_student_record(
    'legacy-import-institute', 'legacy-import-other-branch', 'bizbook-students-staff-v1', 'source-3', repeat('d',64),
    '66666666-6666-4666-8666-666666666666',
    '{"name":"Changed","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100}'::jsonb,
    '[{"id":"66666666-6666-4666-8666-666666666666:fee:1","sequenceNumber":1,"amount":80}]'::jsonb, true
  )$$,
  '42501', 'Authorized institute administrator access is required.',
  'A branch-scoped owner cannot import into a different branch.'
);

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.throws_ok(
  $$select * from public.import_legacy_student_record(
    'legacy-import-institute', null, 'bizbook-students-staff-v1', 'accountant-source', repeat('e',64),
    '77777777-7777-4777-8777-777777777777',
    '{"name":"Changed","parentName":"Parent","course":"Math","admissionFee":20,"totalFee":100}'::jsonb,
    '[{"id":"77777777-7777-4777-8777-777777777777:fee:1","sequenceNumber":1,"amount":80}]'::jsonb, true
  )$$,
  '42501', 'Authorized institute administrator access is required.',
  'An accountant cannot run a master-data import.'
);

reset role;
select set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-4fff-8fff-ffffffffffff","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.is((select count(*) from public.legacy_student_imports), 0::bigint,
  'Another institute cannot read the import mapping.');

select * from pg_temp.finish();
rollback;
