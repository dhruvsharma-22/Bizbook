begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixture (user_id uuid, institute_id text, branch_a text, branch_b text);
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
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;
select pg_temp.plan(9);

select pg_temp.ok(not has_column_privilege('authenticated', 'public.staff', 'monthly_salary', 'SELECT'),
  'authenticated sessions cannot select staff monthly salary directly');
select pg_temp.ok(not has_column_privilege('authenticated', 'public.staff', 'per_day_leave_cut', 'SELECT'),
  'authenticated sessions cannot select staff leave deductions directly');
select pg_temp.ok(has_column_privilege('authenticated', 'public.staff', 'name', 'SELECT'),
  'authenticated sessions can still read the staff directory');
select pg_temp.ok(not has_function_privilege('anon', 'public.list_staff_compensation(text,text)', 'EXECUTE'),
  'anonymous sessions cannot call the compensation reader');
select pg_temp.ok(has_function_privilege('authenticated', 'public.list_staff_compensation(text,text)', 'EXECUTE'),
  'authenticated sessions can call the function, which enforces finance membership internally');
select pg_temp.ok((select prosecdef from pg_proc where oid = 'public.list_staff_compensation(text,text)'::regprocedure),
  'the compensation reader uses a security-definer boundary');
select pg_temp.ok((select array_to_string(proconfig, ',') like '%search_path=%' from pg_proc where oid = 'public.list_staff_compensation(text,text)'::regprocedure),
  'the compensation reader pins its search path');

insert into auth.users(id, aud, role, email)
values (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-compensation-staff@example.invalid');
insert into pg_temp.fixture(user_id, institute_id, branch_a, branch_b)
select id, 'staff-compensation-' || replace(gen_random_uuid()::text, '-', ''),
  'staff-branch-a-' || replace(gen_random_uuid()::text, '-', ''),
  'staff-branch-b-' || replace(gen_random_uuid()::text, '-', '')
from auth.users where email = 'bizbook-compensation-staff@example.invalid';
insert into public.coaching_institutes(id, business_name, account_status)
select institute_id, 'Staff compensation test', 'active' from pg_temp.fixture;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, user_id, 'staff', 'institute' from pg_temp.fixture;
insert into public.staff(id, institute_id, name, monthly_salary, per_day_leave_cut, salary_calculation_mode, attendance_enabled)
select 'compensation-staff-' || replace(gen_random_uuid()::text, '-', ''), institute_id,
  'Synthetic staff', 12500.50, 400.25, 'AttendanceBased', true from pg_temp.fixture;
select set_config('request.jwt.claim.sub', (select user_id::text from pg_temp.fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_id from pg_temp.fixture), 'role', 'authenticated')::text, true);

do $$
declare denied boolean := false;
begin
  begin
    perform count(*) from public.list_staff_compensation((select institute_id from pg_temp.fixture), null);
  exception when insufficient_privilege then denied := true;
  end;
  perform pg_temp.ok(denied, 'staff-role members are denied salary and deduction details');
end;
$$;

update public.user_memberships set role = 'accountant' where user_id = (select user_id from pg_temp.fixture);
select pg_temp.ok(
  (select count(*) = 1 and max(monthly_salary) = 12500.50
   from public.list_staff_compensation((select institute_id from pg_temp.fixture), null)),
  'active finance members receive compensation rows through the protected function'
);

select set_config('request.jwt.claim.sub', '', true);
select * from pg_temp.finish();
rollback;
