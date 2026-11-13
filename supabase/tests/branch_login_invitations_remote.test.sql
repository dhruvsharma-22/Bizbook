begin;

-- All Auth/business fixtures are synthetic and transaction-scoped. This suite ends with ROLLBACK.
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table fixtures (
  owner_id uuid,
  invited_id uuid,
  institute_id text,
  branch_id text,
  branch_email text,
  invited_email text
);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results(passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare item record; total bigint; failures bigint;
begin
  select count(*), count(*) filter (where not passed) into total, failures from pg_temp.test_results;
  return next '1..' || total::text;
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no::text || ' - ' || item.description;
  end loop;
  return next format('# assertions=%s failed=%s', total, failures);
end;
$$;
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
  execute pg_catalog.format('grant select, update on %I.fixtures to authenticated', temp_schema_name);
end;
$grant_temp_usage$;

insert into pg_temp.fixtures
select gen_random_uuid(), gen_random_uuid(),
       'invite-test-' || replace(gen_random_uuid()::text, '-', ''),
       'invite-branch-' || replace(gen_random_uuid()::text, '-', ''),
       'branch-contact-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid',
       'new-member-' || replace(gen_random_uuid()::text, '-', '') || '@example.invalid';

insert into auth.users(id, aud, role, email, email_confirmed_at)
select owner_id, 'authenticated', 'authenticated',
       'invite-owner-' || replace(owner_id::text, '-', '') || '@example.invalid', now()
from pg_temp.fixtures;
insert into public.coaching_institutes(id, business_name)
select institute_id, 'Branch Invitation Test Institute' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;

insert into public.branches(institute_id, name, branch_login_email, is_active)
select institute_id, 'Invitation Test Branch', branch_email, true from pg_temp.fixtures;
reset role;
update pg_temp.fixtures fixture
set branch_id = branch.id
from public.branches branch
where branch.institute_id = fixture.institute_id
  and branch.branch_login_email = fixture.branch_email;
set local role authenticated;
select pg_temp.ok(
  exists (
    select 1 from pg_temp.fixtures fixture,
      lateral public.list_member_access_invitations(fixture.institute_id) invitation
    where lower(invitation.email) = lower(fixture.branch_email)
      and invitation.role = 'staff'
      and invitation.access_scope = 'branches'
      and invitation.branch_ids = array[fixture.branch_id]
  ),
  'creating a branch creates a pending branch-only staff invitation for its login email'
);

select pg_temp.ok(
  (public.create_member_access_invitation(
    fixture.institute_id, fixture.invited_email, 'accountant', 'branches', array[fixture.branch_id]
  )->>'status') = 'invited',
  'owner can invite a new email that has no Auth account yet'
) from pg_temp.fixtures fixture;
select pg_temp.ok(
  not exists (
    select 1 from public.user_memberships membership, pg_temp.fixtures fixture
    where membership.institute_id = fixture.institute_id and membership.user_id = fixture.invited_id
  ),
  'an invitation does not create membership before the email owner verifies OTP'
);

reset role;
insert into auth.users(id, aud, role, email, email_confirmed_at)
select invited_id, 'authenticated', 'authenticated', invited_email, now() from pg_temp.fixtures;
select set_config('request.jwt.claim.sub', (select invited_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select invited_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(
  public.accept_pending_member_access_invitations() = 1,
  'a verified new account claims the matching pending invitation'
);
select pg_temp.ok(
  exists (
    select 1 from public.user_memberships membership, pg_temp.fixtures fixture
    where membership.institute_id = fixture.institute_id
      and membership.user_id = fixture.invited_id
      and membership.role = 'accountant'
      and membership.access_scope = 'branches'
      and membership.is_active
  ) and exists (
    select 1 from public.membership_branch_access access_row, pg_temp.fixtures fixture
    where access_row.institute_id = fixture.institute_id
      and access_row.user_id = fixture.invited_id
      and access_row.branch_id = fixture.branch_id
  ),
  'claim applies the invited role and branch assignment together'
);
select pg_temp.ok(
  public.accept_pending_member_access_invitations() = 0,
  'repeated invitation claims are idempotent'
);

reset role;
select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
do $duplicate_membership_check$
declare
  fixture record;
  duplicate_rejected boolean := false;
begin
  select * into fixture from pg_temp.fixtures;
  begin
    perform public.create_member_access_invitation(
      fixture.institute_id, fixture.invited_email, 'staff', 'branches', array[fixture.branch_id]
    );
  exception when unique_violation then
    duplicate_rejected := true;
  end;
  perform pg_temp.ok(
    duplicate_rejected,
    'owner cannot add a second membership for an email already in this institute'
  );
end;
$duplicate_membership_check$;
update public.branches branch
set is_active = false
from pg_temp.fixtures fixture
where branch.institute_id = fixture.institute_id and branch.id = fixture.branch_id;
select pg_temp.ok(
  not exists (
    select 1 from pg_temp.fixtures fixture,
      lateral public.list_member_access_invitations(fixture.institute_id) invitation
    where lower(invitation.email) = lower(fixture.branch_email)
  ),
  'deactivating a branch revokes its unclaimed branch-email invitation'
);
reset role;
select pg_temp.ok(
  not exists (
    select 1 from public.branches branch, pg_temp.fixtures fixture
    where branch.id = fixture.branch_id and branch.is_active
  ),
  'deactivated branch is absent from active branch choices'
);

select * from pg_temp.finish();
rollback;
