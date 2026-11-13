begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixture (institute_id text, staff_id text);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin insert into pg_temp.test_results(passed, description) values (coalesce(passed, false), description); return coalesce(passed, false); end; $$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$ begin insert into pg_temp.test_plan values(expected); return '1..' || expected::text; end; $$;
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$ begin return pg_temp.record_test(passed, description); end; $$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare expected_count integer; actual_count bigint; failure_count bigint; item record;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter(where not passed) into actual_count, failure_count from pg_temp.test_results;
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
select pg_temp.plan(4);

select pg_temp.ok((select prosecdef from pg_proc where oid = 'bizbook_private.prevent_future_attendance()'::regprocedure),
  'the business-date trigger reads institute time zone inside a security-definer boundary');
select pg_temp.ok((select array_to_string(proconfig, ',') like '%search_path=%' from pg_proc where oid = 'bizbook_private.prevent_future_attendance()'::regprocedure),
  'the attendance date trigger pins its search path');

with created as (
  insert into public.coaching_institutes(id, business_name, account_status, time_zone)
  values ('attendance-date-' || replace(gen_random_uuid()::text, '-', ''), 'Attendance date test', 'active', 'Asia/Kolkata')
  returning id
)
insert into pg_temp.fixture(institute_id, staff_id)
select id, 'attendance-staff-' || replace(gen_random_uuid()::text, '-', '') from created;
insert into public.staff(id, institute_id, name)
select staff_id, institute_id, 'Synthetic attendance staff' from pg_temp.fixture;

insert into public.attendance_records(institute_id, staff_id, attendance_date, status)
select institute_id, staff_id, (now() at time zone 'Asia/Kolkata')::date, 'Present' from pg_temp.fixture;
select pg_temp.ok(true, 'attendance on the current institute-local business date is accepted');

do $$
declare rejected boolean := false;
begin
  begin
    insert into public.attendance_records(institute_id, staff_id, attendance_date, status)
    select institute_id, staff_id, (now() at time zone 'Asia/Kolkata')::date + 1, 'Absent' from pg_temp.fixture;
  exception when check_violation then rejected := true;
  end;
  perform pg_temp.ok(rejected, 'future absence is rejected before it can affect payroll');
end;
$$;

select * from pg_temp.finish();
rollback;
