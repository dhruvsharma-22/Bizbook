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
  if coalesce(failures,0)>0 then raise exception 'legacy profile import regression failed: %',(
    select string_agg(n||' - '||description, '; ' order by n) from pg_temp.test_results where not passed
  ); end if;
end; $$;
create temporary table import_results (filled_fields text[], skipped_fields text[], was_already_imported boolean);
grant insert, select on pg_temp.import_results to authenticated;
do $grant_temp_access$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated',temp_schema_name);
end;
$grant_temp_access$;

select pg_temp.check((select relrowsecurity from pg_class where oid='public.legacy_business_profile_imports'::regclass),'Profile import mapping has RLS enabled.');
select pg_temp.check(not has_table_privilege('authenticated','public.legacy_business_profile_imports','INSERT,UPDATE,DELETE'),'Authenticated clients cannot write import mappings directly.');
select pg_temp.check(
  has_function_privilege('authenticated','public.import_legacy_business_profile(text,jsonb,boolean)','EXECUTE')
  and not has_function_privilege('anon','public.import_legacy_business_profile(text,jsonb,boolean)','EXECUTE')
  and not has_function_privilege('service_role','public.import_legacy_business_profile(text,jsonb,boolean)','EXECUTE'),
  'Profile import RPC is authenticated-only.'
);
select pg_temp.check((select prosecdef from pg_proc where oid='public.import_legacy_business_profile(text,jsonb,boolean)'::regprocedure),'Profile import RPC uses SECURITY DEFINER.');
select pg_temp.check((select translate(proconfig[1], '"', '')='search_path=' from pg_proc where oid='public.import_legacy_business_profile(text,jsonb,boolean)'::regprocedure),'Profile import RPC pins an empty search_path.');

insert into auth.users(id,aud,role,email) values
 ('b1111111-1111-4111-8111-111111111111','authenticated','authenticated','legacy-profile-owner@example.invalid'),
 ('b2222222-2222-4222-8222-222222222222','authenticated','authenticated','legacy-profile-branch-admin@example.invalid'),
 ('b3333333-3333-4333-8333-333333333333','authenticated','authenticated','legacy-profile-accountant@example.invalid'),
 ('b4444444-4444-4444-8444-444444444444','authenticated','authenticated','legacy-profile-other-owner@example.invalid');
insert into public.coaching_institutes(id,business_name,phone,email)
values ('legacy-profile-import-institute','Existing Institute Name','9999999999','existing@example.invalid'),
       ('legacy-profile-import-other','Other Profile Institute',null,null);
insert into public.user_memberships(institute_id,user_id,role,access_scope) values
 ('legacy-profile-import-institute','b1111111-1111-4111-8111-111111111111','owner','institute'),
 ('legacy-profile-import-institute','b2222222-2222-4222-8222-222222222222','administrator','branches'),
 ('legacy-profile-import-institute','b3333333-3333-4333-8333-333333333333','accountant','institute'),
 ('legacy-profile-import-other','b4444444-4444-4444-8444-444444444444','owner','institute');

select set_config('request.jwt.claim.sub','b1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
set local role authenticated;
insert into pg_temp.import_results
select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute',
 '{"businessName":"Legacy Name","ownerName":"Legacy Owner","phone":"8888888888","email":"legacy@example.test","address":"10 Main Road","pincode":"560001"}'::jsonb,
 true
);
select pg_temp.check((select count(*)=1 and not bool_or(was_already_imported) from pg_temp.import_results),'Institute-wide owner imports reviewed profile fields.');
reset role;
select pg_temp.check(
 (select owner_name='Legacy Owner' and email='existing@example.invalid' and phone='9999999999' and address='10 Main Road' and pincode='560001'
  from public.coaching_institutes where id='legacy-profile-import-institute'),
 'Blank fields were filled; existing institute name, phone, and email were not overwritten.'
);
select pg_temp.check(
 (select imported_fields @> array['ownerName','address','pincode'] and skipped_fields @> array['businessName','phone','email']
  from public.legacy_business_profile_imports where institute_id='legacy-profile-import-institute'),
 'Mapping records field names only and identifies skipped existing values.'
);
select pg_temp.check(
 (select source_fingerprint ~ '^[0-9a-f]{64}$' from public.legacy_business_profile_imports where institute_id='legacy-profile-import-institute'),
 'Source fingerprint is server-generated SHA-256.'
);
select pg_temp.check(
 (select metadata ? 'filled_fields' and not (metadata::text like '%legacy@example.test%')
  from public.audit_logs where entity_type='legacy_business_profile_import' and institute_id='legacy-profile-import-institute'),
 'Audit records field names without writing profile values.'
);
select pg_temp.expect_error($$select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute','{"ownerName":"Changed Owner"}'::jsonb,true
)$$,'23505','This legacy business profile changed after a previous import.','Changed profile retries are rejected.');

set local role authenticated;
insert into pg_temp.import_results
select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute',
 '{"businessName":"Legacy Name","ownerName":"Legacy Owner","phone":"8888888888","email":"legacy@example.test","address":"10 Main Road","pincode":"560001"}'::jsonb,
 true
);
reset role;
select pg_temp.check((select count(*)=2 and bool_or(was_already_imported) and count(distinct filled_fields)=1 from pg_temp.import_results),'Exact retry returns the prior import result without updating again.');
select pg_temp.expect_error($$select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute','{"ownerName":"Owner","arbitrary":"value"}'::jsonb,true
)$$,'22023','Legacy profile fields or explicit no-overwrite confirmation are invalid.','Unknown profile fields are rejected.');
select pg_temp.expect_error($$select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute','{"phone":"+919876543210"}'::jsonb,true
)$$,'22023','Legacy profile fields or explicit no-overwrite confirmation are invalid.','Invalid phone format is rejected by the database.');
select pg_temp.expect_error($$select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute','{"ownerName":"Owner"}'::jsonb,false
)$$,'22023','Legacy profile fields or explicit no-overwrite confirmation are invalid.','Missing explicit no-overwrite confirmation is rejected.');
reset role;

select set_config('request.jwt.claim.sub','b2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_error($$select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute','{"city":"Test City"}'::jsonb,true
)$$,'42501','Authorized institute administrator access is required.','Branch-scoped administrator cannot import institute profile data.');
reset role;

select set_config('request.jwt.claim.sub','b3333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"b3333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.expect_error($$select * from public.import_legacy_business_profile(
 'legacy-profile-import-institute','{"city":"Test City"}'::jsonb,true
)$$,'42501','Authorized institute administrator access is required.','Accountant cannot import institute profile data.');
select pg_temp.check((select count(*)=0 from public.legacy_business_profile_imports),'Other institute role cannot read profile import mappings.');
reset role;

select set_config('request.jwt.claim.sub','b4444444-4444-4444-8444-444444444444',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"b4444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.check((select count(*)=0 from public.legacy_business_profile_imports),'Other institute owner cannot read profile import mappings.');
reset role;

select * from pg_temp.finish();
rollback;
