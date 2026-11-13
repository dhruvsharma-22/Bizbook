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
  if coalesce(failures,0)>0 then
    raise exception 'legacy expense import regression failed: %',(
      select string_agg(n||' - '||description, '; ' order by n) from pg_temp.test_results where not passed
    );
  end if;
end; $$;
create temporary table import_results (expense_id text, was_already_imported boolean);
grant insert, select on pg_temp.import_results to authenticated;
do $grant_temp_access$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated',temp_schema_name);
end;
$grant_temp_access$;

select pg_temp.check((select relrowsecurity from pg_class where oid='public.legacy_expense_imports'::regclass),'Import mapping RLS is enabled.');
select pg_temp.check(not has_table_privilege('authenticated','public.legacy_expense_imports','INSERT,UPDATE,DELETE'),'Authenticated clients cannot mutate import mappings directly.');
select pg_temp.check(
  has_function_privilege('authenticated','public.import_legacy_expense_record_verified(text,text,text,text,text,text,numeric,date,text,text,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.import_legacy_expense_record_verified(text,text,text,text,text,text,numeric,date,text,text,boolean)','EXECUTE'),
  'Import RPC is authenticated-only.'
);
select pg_temp.check(not has_function_privilege('authenticated','public.import_legacy_expense_record(text,text,text,text,text,text,text,numeric,date,text,text,boolean)','EXECUTE') and not has_function_privilege('service_role','public.import_legacy_expense_record(text,text,text,text,text,text,text,numeric,date,text,text,boolean)','EXECUTE'),'Caller-fingerprint RPC is retired for every client role.');
select pg_temp.check((select prosecdef from pg_proc where oid='public.import_legacy_expense_record_verified(text,text,text,text,text,text,numeric,date,text,text,boolean)'::regprocedure),'Import RPC uses SECURITY DEFINER.');
select pg_temp.check((select translate(proconfig[1], '"', '')='search_path=' from pg_proc where oid='public.import_legacy_expense_record_verified(text,text,text,text,text,text,numeric,date,text,text,boolean)'::regprocedure),'Import RPC pins an empty search_path.');

insert into auth.users(id,aud,role,email) values
 ('a1111111-1111-4111-8111-111111111111','authenticated','authenticated','legacy-expense-owner@example.invalid'),
 ('a2222222-2222-4222-8222-222222222222','authenticated','authenticated','legacy-expense-accountant@example.invalid'),
 ('a3333333-3333-4333-8333-333333333333','authenticated','authenticated','legacy-expense-branch-owner@example.invalid'),
 ('a4444444-4444-4444-8444-444444444444','authenticated','authenticated','legacy-expense-other@example.invalid');
insert into public.coaching_institutes(id,business_name) values
 ('legacy-expense-import-institute','Legacy Expense Import Test Institute'),('legacy-expense-import-other','Other Expense Import Test Institute');
insert into public.branches(id,institute_id,name) values
 ('legacy-expense-import-branch','legacy-expense-import-institute','Import Branch'),
 ('legacy-expense-import-branch-other','legacy-expense-import-institute','Other Branch');
insert into public.user_memberships(institute_id,user_id,role,access_scope) values
 ('legacy-expense-import-institute','a1111111-1111-4111-8111-111111111111','owner','institute'),
 ('legacy-expense-import-institute','a2222222-2222-4222-8222-222222222222','accountant','institute'),
 ('legacy-expense-import-institute','a3333333-3333-4333-8333-333333333333','owner','branches'),
 ('legacy-expense-import-other','a4444444-4444-4444-8444-444444444444','owner','institute');
insert into public.membership_branch_access(institute_id,user_id,branch_id)
values('legacy-expense-import-institute','a3333333-3333-4333-8333-333333333333','legacy-expense-import-branch');

select set_config('request.jwt.claim.sub','a1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
insert into pg_temp.import_results
select imported_expense_id, was_already_imported from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute','legacy-expense-import-branch','bizbook-other-expenses-v1','legacy-row-1',
 'Electricity bill','Utilities',250.75,current_date-1,'UPI','June invoice',true
);
select pg_temp.check((select count(*)=1 and not bool_or(was_already_imported) from pg_temp.import_results),'Owner imports one reviewed expense.');
reset role;
select pg_temp.check((select count(*)=1 and min(amount)=250.75 and min(method)='UPI' from public.expenses where id in(select expense_id from pg_temp.import_results)),'Expense row has exact amount and method.');
select pg_temp.check((select count(*)=1 from public.expenses e join public.legacy_expense_imports i on i.expense_id=e.id and i.institute_id=e.institute_id where i.source_record_id='legacy-row-1' and e.branch_id='legacy-expense-import-branch' and i.branch_id=e.branch_id),'Expense and source mapping retain the explicitly selected branch.');
select pg_temp.check((select count(*)=1 from public.legacy_expense_imports where source_record_id='legacy-row-1'),'Source fingerprint mapping is stored once.');
select pg_temp.check((select source_fingerprint ~ '^[0-9a-f]{64}$' from public.legacy_expense_imports where source_record_id='legacy-row-1'),'SHA-256 fingerprint is generated and stored by the database.');
select pg_temp.check((select count(*)=1 from public.audit_logs where entity_type='legacy_expense_import' and entity_id in(select id::text from public.legacy_expense_imports where source_record_id='legacy-row-1')),'Import audit event is recorded.');
select pg_temp.check((select legacy_data->>'import_mode'='reviewed_legacy_expense' and not(legacy_data?'raw_record') and not(legacy_data?'originalRecord') from public.expenses where id in(select expense_id from pg_temp.import_results)),'Only restricted metadata is stored; raw browser row is not stored.');

set local role authenticated;
insert into pg_temp.import_results
select imported_expense_id, was_already_imported from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute','legacy-expense-import-branch','bizbook-other-expenses-v1','legacy-row-1',
 'Electricity bill','Utilities',250.75,current_date-1,'UPI','June invoice',true
);
reset role;
select pg_temp.check((select count(*)=2 and bool_or(was_already_imported) and count(distinct expense_id)=1 from pg_temp.import_results),'Matching retry returns same expense without duplication.');
select pg_temp.check((select count(*)=1 from public.expenses where institute_id='legacy-expense-import-institute' and legacy_data->>'source_record_id'='legacy-row-1'),'Retry created no duplicate expense.');
select pg_temp.expect_error($$select * from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute','legacy-expense-import-branch','bizbook-other-expenses-v1','legacy-row-1',
 'Changed title','Utilities',250.75,current_date-1,'UPI','June invoice',true
)$$,'23505','This legacy expense changed after a previous import.','Changed source fingerprint is rejected.');
select pg_temp.expect_error($$select * from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute',null,'unsupported-key','legacy-row-2',
 'Malformed','Utilities',250.755,current_date-1,'UPI',null,true
)$$,'22023','Legacy expense details or confirmation are invalid.','Unsupported source and sub-paise amount are rejected.');
select pg_temp.expect_error($$select * from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute',null,'bizbook-other-expenses-v1','legacy-row-3',
 'Future','Utilities',1,current_date+10,'UPI',null,true
)$$,'22023','Expense date cannot be after the institute business date.','Future expense date is rejected.');
select pg_temp.expect_error($$select * from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute',null,'bizbook-other-expenses-v1','unconfirmed',
 'Unconfirmed','Utilities',1,current_date-1,'UPI',null,false
)$$,'22023','Legacy expense details or confirmation are invalid.','Missing explicit historical-expense confirmation is rejected.');
reset role;

select set_config('request.jwt.claim.sub','a3333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a3333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_error($$select * from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute','legacy-expense-import-branch-other','bizbook-other-expenses-v1','branch-source',
 'Branch denied','Utilities',1,current_date-1,'Cash',null,true
)$$,'42501','Authorized institute administrator access is required.','Branch-scoped owner cannot import to an unassigned branch.');
reset role;

select set_config('request.jwt.claim.sub','a2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_error($$select * from public.import_legacy_expense_record_verified(
 'legacy-expense-import-institute',null,'bizbook-other-expenses-v1','accountant-source',
 'Accountant denied','Utilities',1,current_date-1,'Cash',null,true
)$$,'42501','Authorized institute administrator access is required.','Accountant cannot run owner-only expense import.');
reset role;

select set_config('request.jwt.claim.sub','a4444444-4444-4444-8444-444444444444',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"a4444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.check((select count(*)=0 from public.legacy_expense_imports),'Different institute cannot read import mappings.');
select * from pg_temp.finish();
rollback;
