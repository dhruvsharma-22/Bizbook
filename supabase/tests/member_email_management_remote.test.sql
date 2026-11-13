begin;

create temporary table assertions (n bigint generated always as identity, passed boolean not null, label text not null);
create temporary table fixture (owner_id uuid, admin_id uuid, member_id uuid, unverified_id uuid, institute_id text, other_institute_id text, branch_id text, other_branch_id text, member_email text, unverified_email text);
create or replace function pg_temp.ok(passed boolean, label text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin insert into pg_temp.assertions(passed,label) values(coalesce(passed,false),label); return coalesce(passed,false); end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare item record; total bigint; failures bigint;
begin
  select count(*),count(*) filter(where not passed) into total,failures from pg_temp.assertions;
  return next '1..'||total::text;
  for item in select * from pg_temp.assertions order by n loop
    return next case when item.passed then 'ok ' else 'not ok ' end||item.n::text||' - '||item.label;
  end loop;
  return next format('# assertions=%s failed=%s',total,failures);
end;
$$;
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid=pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated',temp_schema_name);
end;
$grant_temp_usage$;

insert into pg_temp.fixture values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'member-email-'||replace(gen_random_uuid()::text,'-',''),
  'member-email-other-'||replace(gen_random_uuid()::text,'-',''),
  'member-email-branch-'||replace(gen_random_uuid()::text,'-',''),
  'member-email-other-branch-'||replace(gen_random_uuid()::text,'-',''),
  'bizbook-email-member-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid',
  'bizbook-email-unverified-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid'
);
insert into auth.users(id,aud,role,email,email_confirmed_at)
select owner_id,'authenticated','authenticated','bizbook-email-owner-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid',now() from pg_temp.fixture
union all
select admin_id,'authenticated','authenticated','bizbook-email-admin-'||replace(gen_random_uuid()::text,'-','')||'@example.invalid',now() from pg_temp.fixture
union all
select member_id,'authenticated','authenticated',member_email,now() from pg_temp.fixture
union all
select unverified_id,'authenticated','authenticated',unverified_email,null from pg_temp.fixture;
insert into public.coaching_institutes(id,business_name) select institute_id,'Member email test' from pg_temp.fixture;
insert into public.coaching_institutes(id,business_name) select other_institute_id,'Member email other test' from pg_temp.fixture;
insert into public.branches(id,institute_id,name)
select branch_id,institute_id,'Member email branch' from pg_temp.fixture
union all select other_branch_id,other_institute_id,'Member email other branch' from pg_temp.fixture;
insert into public.user_memberships(institute_id,user_id,role,access_scope)
select institute_id,owner_id,'owner','institute' from pg_temp.fixture
union all select institute_id,admin_id,'administrator','institute' from pg_temp.fixture;
grant select on pg_temp.fixture to authenticated;

select pg_temp.ok(
  has_function_privilege('authenticated','public.list_institute_members(text)','EXECUTE')
  and has_function_privilege('authenticated','public.grant_institute_membership_by_email(text,text,text,text,text[])','EXECUTE')
  and not has_function_privilege('anon','public.list_institute_members(text)','EXECUTE')
  and not has_function_privilege('anon','public.grant_institute_membership_by_email(text,text,text,text,text[])','EXECUTE'),
  'member email lookup and grant functions are authenticated-only'
);

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',(select owner_id::text from pg_temp.fixture),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select owner_id from pg_temp.fixture),'role','authenticated')::text,true);
set local role authenticated;

select pg_temp.ok(
  (select count(*)=2 and bool_and(email is not null and email<>'') from public.list_institute_members((select institute_id from pg_temp.fixture))),
  'owner can see member email addresses only for their institute'
);
select public.grant_institute_membership_by_email(
  (select institute_id from pg_temp.fixture),upper((select member_email from pg_temp.fixture)),'staff','branches',array[(select branch_id from pg_temp.fixture)]
);
select pg_temp.ok(
  exists(select 1 from public.user_memberships m,pg_temp.fixture f where m.institute_id=f.institute_id and m.user_id=f.member_id and m.role='staff' and m.access_scope='branches' and m.is_active)
  and exists(select 1 from public.membership_branch_access a,pg_temp.fixture f where a.institute_id=f.institute_id and a.user_id=f.member_id and a.branch_id=f.branch_id),
  'owner grants existing verified email a branch-scoped role atomically'
);
select pg_temp.ok(
  not exists(select 1 from public.list_institute_members((select institute_id from pg_temp.fixture)) m where m.user_id=(select unverified_id from pg_temp.fixture)),
  'member directory remains scoped to actual institute members'
);

do $$
begin
  begin
    perform public.grant_institute_membership_by_email((select institute_id from pg_temp.fixture),(select unverified_email from pg_temp.fixture),'staff','institute','{}');
    perform pg_temp.ok(false,'unverified email cannot receive membership');
  exception when sqlstate '22023' then perform pg_temp.ok(true,'unverified email cannot receive membership');
  end;
  begin
    perform public.grant_institute_membership_by_email((select institute_id from pg_temp.fixture),(select member_email from pg_temp.fixture),'staff','branches',array[(select other_branch_id from pg_temp.fixture)]);
    perform pg_temp.ok(false,'branch grant cannot target an unauthorized branch');
  exception when sqlstate '22023' then perform pg_temp.ok(true,'branch grant cannot target an unauthorized branch');
  end;
  begin
    perform public.grant_institute_membership_by_email((select institute_id from pg_temp.fixture),(select member_email from pg_temp.fixture),'staff','branches','{}');
    perform pg_temp.ok(false,'branch-scoped grant requires an explicit branch');
  exception when sqlstate '22023' then perform pg_temp.ok(true,'branch-scoped grant requires an explicit branch');
  end;
end;
$$;
select pg_temp.ok(
  not exists(select 1 from public.user_memberships m,pg_temp.fixture f where m.institute_id=f.institute_id and m.user_id=f.unverified_id),
  'rejected email requests create no membership'
);

select set_config('request.jwt.claim.sub',(select admin_id::text from pg_temp.fixture),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',(select admin_id from pg_temp.fixture),'role','authenticated')::text,true);
do $$
begin
  begin
    perform public.grant_institute_membership_by_email((select institute_id from pg_temp.fixture),(select member_email from pg_temp.fixture),'administrator','institute','{}');
    perform pg_temp.ok(false,'administrator cannot grant another administrator role');
  exception when sqlstate '42501' then perform pg_temp.ok(true,'administrator cannot grant another administrator role');
  end;
end;
$$;

select * from pg_temp.finish();
rollback;
