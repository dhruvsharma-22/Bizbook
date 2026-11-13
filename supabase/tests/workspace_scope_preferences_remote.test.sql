begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results (passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare item record; failures bigint;
begin
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no || ' - ' || item.description;
  end loop;
  select count(*) into failures from pg_temp.test_results where not passed;
  return next format('# assertions=%s failed=%s', (select count(*) from pg_temp.test_results), failures);
end;
$$;
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
end;
$grant_temp_usage$;

create temporary table profile_fixtures (first_user uuid not null, second_user uuid not null);
insert into pg_temp.profile_fixtures values (gen_random_uuid(), gen_random_uuid());
insert into auth.users (id, aud, role, email)
select first_user, 'authenticated', 'authenticated', 'scope-pref-a-' || first_user || '@example.invalid'
from pg_temp.profile_fixtures
union all
select second_user, 'authenticated', 'authenticated', 'scope-pref-b-' || second_user || '@example.invalid'
from pg_temp.profile_fixtures;
insert into public.profiles (id)
select first_user from pg_temp.profile_fixtures
union all
select second_user from pg_temp.profile_fixtures
on conflict (id) do nothing;
grant select on pg_temp.profile_fixtures to authenticated;

select pg_temp.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'workspace_preferences' and is_nullable = 'NO'
  ),
  'workspace preference is a required profile column'
);
select pg_temp.ok(
  has_column_privilege('authenticated', 'public.profiles', 'workspace_preferences', 'UPDATE'),
  'authenticated users can update their profile preference column'
);
select pg_temp.ok(
  not has_column_privilege('anon', 'public.profiles', 'workspace_preferences', 'UPDATE'),
  'anonymous users cannot update workspace preferences'
);
select pg_temp.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_self'
      and qual like '%auth.uid()%'
      and with_check like '%auth.uid()%'
  ),
  'profile preference updates remain limited by the self-only RLS policy'
);
select pg_temp.ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profile row-level security remains enabled'
);
select pg_temp.ok(
  (select pg_get_constraintdef(oid) like '%jsonb_typeof(workspace_preferences)%'
   from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_workspace_preferences_check'),
  'workspace preference payload must be a JSON object'
);

select set_config('request.jwt.claim.sub', (select first_user::text from pg_temp.profile_fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select first_user::text from pg_temp.profile_fixtures),
  'role', 'authenticated'
)::text, true);
set local role authenticated;
select pg_temp.ok(
  (select count(*) = 1 from public.profiles where id = (select first_user from pg_temp.profile_fixtures)),
  'a user can read their own profile preference'
);
select pg_temp.ok(
  (select count(*) = 0 from public.profiles where id = (select second_user from pg_temp.profile_fixtures)),
  'a user cannot read another account preference'
);
with changed as (
  update public.profiles
  set workspace_preferences = '{"instituteId":"scope-test","branchId":"branch-test"}'::jsonb
  where id = (select first_user from pg_temp.profile_fixtures)
  returning id
)
select pg_temp.ok((select count(*) = 1 from changed), 'a user can save their own workspace preference');
select pg_temp.ok(
  (select workspace_preferences = '{"instituteId":"scope-test","branchId":"branch-test"}'::jsonb
   from public.profiles where id = (select first_user from pg_temp.profile_fixtures)),
  'the saved preference is read back unchanged by its owner'
);
with changed as (
  update public.profiles
  set workspace_preferences = '{"instituteId":"unauthorized","branchId":"branch-test"}'::jsonb
  where id = (select second_user from pg_temp.profile_fixtures)
  returning id
)
select pg_temp.ok((select count(*) = 0 from changed), 'RLS rejects updates to another account preference');
select set_config('request.jwt.claim.sub', (select second_user::text from pg_temp.profile_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select second_user::text from pg_temp.profile_fixtures),
  'role', 'authenticated'
)::text, true);
select pg_temp.ok(
  (select count(*) = 1 from public.profiles where id = (select second_user from pg_temp.profile_fixtures)),
  'a second user can read only their own profile preference'
);
select pg_temp.ok(
  (select count(*) = 0 from public.profiles where id = (select first_user from pg_temp.profile_fixtures)),
  'a second user cannot read the first user preference'
);
reset role;

select * from pg_temp.finish();
rollback;
