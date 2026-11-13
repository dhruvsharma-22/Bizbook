begin;
create temporary table test_results (n bigint generated always as identity, passed boolean not null, description text not null);
create or replace function pg_temp.check(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin insert into pg_temp.test_results(passed, description) values(coalesce(passed,false),description); return coalesce(passed,false); end; $$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_message text, p_description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actual_state text; actual_message text;
begin
  execute p_sql;
  insert into pg_temp.test_results(passed,description) values(false,p_description||' (error not raised)'); return false;
exception when others then
  get stacked diagnostics actual_state=returned_sqlstate, actual_message=message_text;
  insert into pg_temp.test_results(passed,description) values(actual_state=p_state and actual_message=p_message,p_description);
  return actual_state=p_state and actual_message=p_message;
end; $$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare item record; failures bigint;
begin
  select count(*) filter(where not passed) into failures from pg_temp.test_results;
  for item in select * from pg_temp.test_results order by n loop
    return next case when item.passed then 'ok ' else 'not ok ' end||item.n||' - '||item.description;
  end loop;
  return next 'assertions='||(select count(*) from pg_temp.test_results)||' failed='||coalesce(failures,0);
  if coalesce(failures,0)>0 then raise exception 'legacy staff import regression failed'; end if;
end; $$;
do $grant_temp_access$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated',temp_schema_name);
end;
$grant_temp_access$;
select pg_temp.check((select relrowsecurity from pg_class where oid='public.legacy_staff_imports'::regclass),'Import mapping RLS is enabled.');
select pg_temp.check(not has_table_privilege('authenticated','public.legacy_staff_imports','INSERT,UPDATE,DELETE'),'Authenticated clients cannot mutate import mappings directly.');
select pg_temp.check(
  has_function_privilege('authenticated','public.import_legacy_staff_record(text,text,text,text,text,text,text,text,text,text,text,date,numeric,smallint,numeric,numeric,text,boolean,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.import_legacy_staff_record(text,text,text,text,text,text,text,text,text,text,text,date,numeric,smallint,numeric,numeric,text,boolean,boolean)','EXECUTE'),
  'Import RPC is authenticated-only.'
);

insert into auth.users(id,aud,role,email) values
 ('a1111111-1111-4111-8111-111111111111','authenticated','authenticated','legacy-staff-owner@example.invalid'),
 ('a2222222-2222-4222-8222-222222222222','authenticated','authenticated','legacy-staff-accountant@example.invalid'),
 ('a3333333-3333-4333-8333-333333333333','authenticated','authenticated','legacy-staff-branch-owner@example.invalid'),
 ('a4444444-4444-4444-8444-444444444444','authenticated','authenticated','legacy-staff-other@example.invalid');
insert into public.coaching_institutes(id,business_name) values
 ('legacy-staff-import-institute','Legacy Staff Import Test Institute'),('legacy-staff-import-other','Other Staff Import Test Institute');
insert into public.branches(id,institute_id,name) values
 ('legacy-staff-import-branch','legacy-staff-import-institute','Import Branch'),
 ('legacy-staff-import-branch-other','legacy-staff-import-institute','Other Branch');
insert into public.user_memberships(institute_id,user_id,role,access_scope) values
 ('legacy-staff-import-institute','a1111111-1111-4111-8111-111111111111','owner','institute'),
 ('legacy-staff-import-institute','a2222222-2222-4222-8222-222222222222','accountant','institute'),
 ('legacy-staff-import-institute','a3333333-3333-4333-8333-333333333333','owner','branches'),
 ('legacy-staff-import-other','a4444444-4444-4444-8444-444444444444','owner','institute');
insert into public.membership_branch_access(institute_id,user_id,branch_id)
values('legacy-staff-import-institute','a3333333-3333-4333-8333-333333333333','legacy-staff-import-branch');

select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.check((select imported_staff_id='b1111111-1111-4111-8111-111111111111' and not was_already_imported from public.import_legacy_staff_record(
 'legacy-staff-import-institute','legacy-staff-import-branch','bizbook-students-staff-v1','old-staff-1',repeat('a',64),
 'b1111111-1111-4111-8111-111111111111','Meera Sharma','Female','9876543210','9876543210','Teacher','2025-06-01',25000.00,5::smallint,250.00,null,'AttendanceBased',true,true
)),'Owner imports one staff profile and current salary settings.');
reset role;
select pg_temp.check((select count(*)=1 and min(monthly_salary)=25000 from public.staff where id='b1111111-1111-4111-8111-111111111111'),'Staff row is stored once with exact compensation.');
select pg_temp.check((select count(*)=1 from public.legacy_staff_imports where source_record_id='old-staff-1'),'Idempotency fingerprint mapping is stored once.');
select pg_temp.check((select count(*)=1 from public.audit_logs where entity_type='legacy_staff_import' and entity_id in(select id::text from public.legacy_staff_imports where source_record_id='old-staff-1')),'Import audit event is recorded.');
select pg_temp.check((select legacy_data->>'import_mode'='profile_only' and not(legacy_data?'raw_record') from public.staff where id='b1111111-1111-4111-8111-111111111111'),'Only restricted import metadata is stored, with no raw row.');
select pg_temp.check((select count(*)=0 from public.attendance_records where staff_id='b1111111-1111-4111-8111-111111111111'),'Import creates no attendance rows.');
select pg_temp.check((select count(*)=0 from public.salary_payments where staff_id='b1111111-1111-4111-8111-111111111111'),'Import creates no salary-payment rows.');
set local role authenticated;
select pg_temp.check((select was_already_imported from public.import_legacy_staff_record(
 'legacy-staff-import-institute','legacy-staff-import-branch','bizbook-students-staff-v1','old-staff-1',repeat('a',64),
 'b2222222-2222-4222-8222-222222222222','Retry ignored','Female','9876543210','9876543210','Teacher','2025-06-01',25000.00,5::smallint,250.00,null,'AttendanceBased',true,true
)),'Exact retry returns existing import.');
reset role;
select pg_temp.check((select count(*)=1 from public.staff where institute_id='legacy-staff-import-institute'),'Retry does not duplicate staff.');
select pg_temp.expect_error($$select * from public.import_legacy_staff_record(
 'legacy-staff-import-institute','legacy-staff-import-branch','bizbook-students-staff-v1','old-staff-1',repeat('b',64),
 'b3333333-3333-4333-8333-333333333333','Changed source','Female','9876543210','9876543210','Teacher','2025-06-01',25000.00,5::smallint,250.00,null,'AttendanceBased',true,true
)$$,'23505','This legacy source record changed after a previous import.','Changed source fingerprint is rejected.');
select pg_temp.expect_error($$select * from public.import_legacy_staff_record(
 'legacy-staff-import-institute',null,'unsupported-key','source-2',repeat('c',64),'b4444444-4444-4444-8444-444444444444',
 'Invalid',null,null,null,'Teacher',null,25000.001,5::smallint,0,null,'AttendanceBased',true,true
)$$,'22023','Legacy staff import details or confirmation are invalid.','Unsupported source and sub-paise amount are rejected.');
reset role;

select set_config('request.jwt.claim.sub','a3333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_error($$select * from public.import_legacy_staff_record(
 'legacy-staff-import-institute','legacy-staff-import-branch-other','bizbook-students-staff-v1','branch-source',repeat('d',64),
 'b5555555-5555-4555-8555-555555555555','Branch staff',null,null,null,'Teacher',null,25000.00,5::smallint,0,null,'AttendanceBased',true,true
)$$,'42501','Authorized institute administrator access is required.','Branch-scoped owner cannot import to an unassigned branch.');
reset role;

select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_error($$select * from public.import_legacy_staff_record(
 'legacy-staff-import-institute',null,'bizbook-students-staff-v1','accountant-source',repeat('e',64),
 'b6666666-6666-4666-8666-666666666666','Accountant denied',null,null,null,'Teacher',null,25000.00,5::smallint,0,null,'AttendanceBased',true,true
)$$,'42501','Authorized institute administrator access is required.','Accountant cannot run owner-only staff import.');
reset role;

select set_config('request.jwt.claim.sub','a4444444-4444-4444-8444-444444444444',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.check((select count(*)=0 from public.legacy_staff_imports),'Different institute cannot read import mappings.');

select * from pg_temp.finish();
rollback;
