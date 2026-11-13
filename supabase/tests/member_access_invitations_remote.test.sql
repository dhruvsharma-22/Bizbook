begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixtures (
  owner_id uuid, invitee_id uuid, other_id uuid,
  institute_a text, institute_b text, invitation_a uuid, invitation_b uuid
);
create or replace function pg_temp.record_test(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results(passed, description) values (coalesce(passed, false), description);
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

select pg_temp.plan(13);
insert into auth.users(id, aud, role, email, email_confirmed_at)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'member-invite-owner-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid', now()),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'member-invite-user-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid', now()),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'member-invite-other-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid', now());
insert into pg_temp.fixtures(owner_id, invitee_id, other_id, institute_a, institute_b)
select
  (select id from auth.users where email like 'member-invite-owner-%@example.invalid' order by created_at desc limit 1),
  (select id from auth.users where email like 'member-invite-user-%@example.invalid' order by created_at desc limit 1),
  (select id from auth.users where email like 'member-invite-other-%@example.invalid' order by created_at desc limit 1),
  'member-invite-a-' || replace(gen_random_uuid()::text, '-', ''),
  'member-invite-b-' || replace(gen_random_uuid()::text, '-', '');
insert into public.coaching_institutes(id, business_name)
select institute_a, 'Invitation Test Institute A' from pg_temp.fixtures
union all
select institute_b, 'Invitation Test Institute B' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_a, owner_id, 'owner', 'institute' from pg_temp.fixtures
union all
select institute_b, owner_id, 'owner', 'institute' from pg_temp.fixtures;

select pg_temp.ok(not has_function_privilege('anon', 'public.accept_member_access_invitation(uuid)', 'EXECUTE'), 'anonymous callers cannot accept member invitations');
select pg_temp.ok(has_function_privilege('authenticated', 'public.accept_member_access_invitation(uuid)', 'EXECUTE'), 'authenticated callers can use the email-bound acceptance action');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.accept_pending_member_access_invitations()', 'EXECUTE'), 'the old bulk auto-accept RPC remains disabled');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.grant_institute_membership(text,uuid,text,text)', 'EXECUTE'), 'browser callers cannot bypass invitation acceptance with direct UUID grants');

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
declare invite_email text; outcome jsonb;
begin
  select lower(email) into invite_email from auth.users where id = (select invitee_id from pg_temp.fixtures);
  outcome := public.create_member_access_invitation((select institute_a from pg_temp.fixtures), invite_email, 'accountant', 'institute', '{}');
  update pg_temp.fixtures set invitation_a = (outcome->>'invitation_id')::uuid;
  outcome := public.create_member_access_invitation((select institute_b from pg_temp.fixtures), invite_email, 'staff', 'institute', '{}');
  update pg_temp.fixtures set invitation_b = (outcome->>'invitation_id')::uuid;
  perform pg_temp.ok(outcome->>'status' = 'invited', 'owner creates an invitation record rather than granting access immediately');
  perform pg_temp.ok(not exists (
    select 1 from public.user_memberships where user_id = (select invitee_id from pg_temp.fixtures)
  ), 'creating invitations grants no institute membership');
  begin
    perform public.create_member_access_invitation((select institute_a from pg_temp.fixtures), 'not-registered-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid', 'staff', 'institute', '{}');
    perform pg_temp.ok(false, 'owner cannot invite an email that has not created and verified an account');
  exception when sqlstate '22023' then
    perform pg_temp.ok(true, 'owner cannot invite an email that has not created and verified an account');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select invitee_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select invitee_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select pg_temp.ok((select count(*) = 2 from public.list_my_member_access_invitations()), 'the signed-in account sees only its invitations across institutes');
select public.accept_member_access_invitation((select invitation_a from pg_temp.fixtures));
select pg_temp.ok(exists (
  select 1 from public.user_memberships where institute_id = (select institute_a from pg_temp.fixtures)
    and user_id = (select invitee_id from pg_temp.fixtures) and role = 'accountant' and is_active
), 'acceptance creates the invited role membership for the verified account');
select pg_temp.ok(not exists (
  select 1 from public.user_memberships where institute_id = (select institute_b from pg_temp.fixtures)
    and user_id = (select invitee_id from pg_temp.fixtures)
), 'accepting one institute invite does not accept another');
select pg_temp.ok((select status = 'pending' from public.member_access_invitations where id = (select invitation_b from pg_temp.fixtures)), 'other institute invitations remain pending until individually accepted');

select set_config('request.jwt.claim.sub', (select other_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select other_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select pg_temp.ok((select count(*) = 0 from public.list_my_member_access_invitations()), 'another signed-in account cannot discover invitations addressed to someone else');
do $$
begin
  begin
    perform public.accept_member_access_invitation((select invitation_b from pg_temp.fixtures));
    perform pg_temp.ok(false, 'a different account cannot accept an invitation addressed to someone else');
  exception when insufficient_privilege then
    perform pg_temp.ok(true, 'a different account cannot accept an invitation addressed to someone else');
  end;
end;
$$;

select * from pg_temp.finish();
rollback;
