begin;

-- This suite verifies the exact RPCs used by /business/members. All fixtures
-- and helper objects are transaction-scoped and removed by the final ROLLBACK.
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table fixtures (
  owner_id uuid,
  admin_id uuid,
  staff_id uuid,
  branch_owner_id uuid,
  added_id uuid,
  second_owner_id uuid,
  institute_id text,
  other_institute_id text,
  branch_id text,
  other_branch_id text
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
end;
$grant_temp_usage$;

insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-members-owner-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-members-admin-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-members-staff-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-members-branch-owner-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-members-added-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-members-second-owner-' || gen_random_uuid() || '@example.invalid');

insert into pg_temp.fixtures
select
  (select id from auth.users where email like 'bizbook-members-owner-%' order by created_at desc limit 1),
  (select id from auth.users where email like 'bizbook-members-admin-%' order by created_at desc limit 1),
  (select id from auth.users where email like 'bizbook-members-staff-%' order by created_at desc limit 1),
  (select id from auth.users where email like 'bizbook-members-branch-owner-%' order by created_at desc limit 1),
  (select id from auth.users where email like 'bizbook-members-added-%' order by created_at desc limit 1),
  (select id from auth.users where email like 'bizbook-members-second-owner-%' order by created_at desc limit 1),
  'member-rpc-' || replace(gen_random_uuid()::text, '-', ''),
  'member-rpc-other-' || replace(gen_random_uuid()::text, '-', ''),
  'member-branch-' || replace(gen_random_uuid()::text, '-', ''),
  'member-other-branch-' || replace(gen_random_uuid()::text, '-', '');
grant select on pg_temp.fixtures to authenticated;

insert into public.coaching_institutes(id, business_name)
select institute_id, 'Member RPC Test Institute' from pg_temp.fixtures
union all
select other_institute_id, 'Member RPC Other Institute' from pg_temp.fixtures;
insert into public.branches(id, institute_id, name)
select branch_id, institute_id, 'Member RPC Active Branch' from pg_temp.fixtures
union all
select other_branch_id, other_institute_id, 'Member RPC Other Branch' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures
union all
select institute_id, admin_id, 'administrator', 'institute' from pg_temp.fixtures
union all
select institute_id, staff_id, 'staff', 'branches' from pg_temp.fixtures
union all
select institute_id, branch_owner_id, 'owner', 'branches' from pg_temp.fixtures
union all
select other_institute_id, owner_id, 'owner', 'institute' from pg_temp.fixtures;

select pg_temp.ok(
  has_function_privilege('authenticated', 'public.grant_institute_membership(text,uuid,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_membership_branch_access(text,uuid,text,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.deactivate_institute_membership(text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.grant_institute_membership(text,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_membership_branch_access(text,uuid,text,boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.deactivate_institute_membership(text,uuid)', 'EXECUTE'),
  'membership management RPCs are authenticated-only'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;

select public.grant_institute_membership(institute_id, staff_id, 'staff', 'branches') from pg_temp.fixtures;
select pg_temp.ok(
  exists(select 1 from public.user_memberships m, pg_temp.fixtures f where m.institute_id=f.institute_id and m.user_id=f.staff_id and m.role='staff' and m.access_scope='branches' and m.is_active),
  'owner can grant an existing user branch-scoped staff membership'
);
select public.set_membership_branch_access(institute_id, staff_id, branch_id, true) from pg_temp.fixtures;
select pg_temp.ok(
  exists(select 1 from public.membership_branch_access a, pg_temp.fixtures f where a.institute_id=f.institute_id and a.user_id=f.staff_id and a.branch_id=f.branch_id),
  'owner can grant an active branch assignment'
);
do $$
begin
  begin
    perform public.set_membership_branch_access(institute_id, staff_id, other_branch_id, true) from pg_temp.fixtures;
    perform pg_temp.ok(false, 'branch assignment cannot cross institute boundaries');
  exception when sqlstate '22023' then
    perform pg_temp.ok(true, 'branch assignment cannot cross institute boundaries');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select admin_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select admin_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.grant_institute_membership(institute_id, added_id, 'administrator', 'institute') from pg_temp.fixtures;
    perform pg_temp.ok(false, 'administrator cannot grant an elevated administrator role');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'administrator cannot grant an elevated administrator role');
  end;
  begin
    perform public.grant_institute_membership(institute_id, branch_owner_id, 'staff', 'branches') from pg_temp.fixtures;
    perform pg_temp.ok(false, 'administrator cannot change an owner membership');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'administrator cannot change an owner membership');
  end;
  begin
    perform public.grant_institute_membership(institute_id, admin_id, 'staff', 'branches') from pg_temp.fixtures;
    perform pg_temp.ok(false, 'a member cannot change their own role');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'a member cannot change their own role');
  end;
end;
$$;
select public.grant_institute_membership(institute_id, added_id, 'accountant', 'institute') from pg_temp.fixtures;
select pg_temp.ok(
  exists(select 1 from public.user_memberships m, pg_temp.fixtures f where m.institute_id=f.institute_id and m.user_id=f.added_id and m.role='accountant' and m.is_active),
  'administrator can grant a non-elevated role to an existing user'
);
select set_config('request.jwt.claim.sub', (select branch_owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select branch_owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.grant_institute_membership(institute_id, added_id, 'staff', 'institute') from pg_temp.fixtures;
    perform pg_temp.ok(false, 'branch-scoped owner cannot manage institute membership');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'branch-scoped owner cannot manage institute membership');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
select public.grant_institute_membership(institute_id, second_owner_id, 'owner', 'institute') from pg_temp.fixtures;
select set_config('request.jwt.claim.sub', (select admin_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select admin_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.grant_institute_membership(institute_id, second_owner_id, 'staff', 'institute') from pg_temp.fixtures;
    perform pg_temp.ok(false, 'administrator cannot change an owner role');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'administrator cannot change an owner role');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixtures), 'role', 'authenticated')::text, true);
do $$
begin
  begin
    perform public.deactivate_institute_membership(institute_id, owner_id) from pg_temp.fixtures;
    perform pg_temp.ok(false, 'a member cannot deactivate their own membership');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'a member cannot deactivate their own membership');
  end;
end;
$$;
select public.deactivate_institute_membership(institute_id, staff_id) from pg_temp.fixtures;
select pg_temp.ok(
  exists(select 1 from public.user_memberships m, pg_temp.fixtures f where m.institute_id=f.institute_id and m.user_id=f.staff_id and not m.is_active)
  and not exists(select 1 from public.membership_branch_access a, pg_temp.fixtures f where a.institute_id=f.institute_id and a.user_id=f.staff_id),
  'deactivation disables membership and removes active branch grants without deleting the account'
);
select public.grant_institute_membership(institute_id, staff_id, 'staff', 'branches') from pg_temp.fixtures;
select pg_temp.ok(
  exists(select 1 from public.user_memberships m, pg_temp.fixtures f where m.institute_id=f.institute_id and m.user_id=f.staff_id and m.is_active)
  and not exists(select 1 from public.membership_branch_access a, pg_temp.fixtures f where a.institute_id=f.institute_id and a.user_id=f.staff_id),
  'reactivating a member resets stale branch assignments'
);

select * from pg_temp.finish();
rollback;
