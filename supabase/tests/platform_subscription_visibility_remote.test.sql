begin;

create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixtures (
  institute_user_a uuid,
  institute_user_b uuid,
  institute_a text,
  institute_b text,
  plan_id uuid,
  invoice_a uuid,
  invoice_b uuid
);
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into pg_temp.test_results(passed, description) values (coalesce(passed, false), description);
  return coalesce(passed, false);
end;
$$;
create or replace function pg_temp.plan(expected integer)
returns text language plpgsql as $$
begin
  insert into pg_temp.test_plan values (expected);
  return '1..' || expected::text;
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  expected_count integer;
  actual_count bigint;
  failure_count bigint;
  item record;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed)
    into actual_count, failure_count from pg_temp.test_results;
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
grant select on pg_temp.fixtures to authenticated;
select pg_temp.plan(9);

insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'subscription-a-' || gen_random_uuid()::text || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'subscription-b-' || gen_random_uuid()::text || '@example.invalid');
insert into pg_temp.fixtures(institute_user_a, institute_user_b, institute_a, institute_b)
select
  (select id from auth.users where email like 'subscription-a-%@example.invalid' order by created_at desc limit 1),
  (select id from auth.users where email like 'subscription-b-%@example.invalid' order by created_at desc limit 1),
  'subscription-visibility-a-' || replace(gen_random_uuid()::text, '-', ''),
  'subscription-visibility-b-' || replace(gen_random_uuid()::text, '-', '');

insert into public.coaching_institutes(id, business_name)
select institute_a, 'Subscription Visibility A' from pg_temp.fixtures
union all
select institute_b, 'Subscription Visibility B' from pg_temp.fixtures;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_a, institute_user_a, 'owner', 'institute' from pg_temp.fixtures
union all
select institute_b, institute_user_b, 'owner', 'institute' from pg_temp.fixtures;
with new_plan as (
  insert into public.platform_subscription_plans(name, monthly_price, annual_price, is_available)
  values ('Visibility Test ' || gen_random_uuid()::text, 25.00, 250.00, true)
  returning id
)
update pg_temp.fixtures set plan_id = (select id from new_plan);
insert into public.institute_subscriptions(institute_id, plan_id, status, billing_cycle, current_period_start, current_period_end)
select institute_a, plan_id, 'active', 'monthly', now(), now() + interval '1 month' from pg_temp.fixtures
union all
select institute_b, plan_id, 'active', 'monthly', now(), now() + interval '1 month' from pg_temp.fixtures;
insert into public.platform_subscription_invoices(
  institute_id, subscription_id, invoice_number, billing_period_start, billing_period_end, amount, status, due_at
)
select f.institute_a, s.id, 'VIS-A-' || gen_random_uuid()::text, now(), now() + interval '1 month', 25.00, 'open', now() + interval '7 days'
from pg_temp.fixtures f join public.institute_subscriptions s on s.institute_id = f.institute_a
union all
select f.institute_b, s.id, 'VIS-B-' || gen_random_uuid()::text, now(), now() + interval '1 month', 25.00, 'open', now() + interval '7 days'
from pg_temp.fixtures f join public.institute_subscriptions s on s.institute_id = f.institute_b;
update pg_temp.fixtures f set
  invoice_a = (select id from public.platform_subscription_invoices where institute_id = f.institute_a),
  invoice_b = (select id from public.platform_subscription_invoices where institute_id = f.institute_b);
insert into public.platform_payment_attempts(
  invoice_id, institute_id, provider, status, idempotency_key, attempt_number
)
select invoice_a, institute_a, 'razorpay', 'pending', gen_random_uuid()::text, 1 from pg_temp.fixtures
union all
select invoice_b, institute_b, 'cashfree', 'pending', gen_random_uuid()::text, 1 from pg_temp.fixtures;

select set_config('request.jwt.claim.sub', (select institute_user_a::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select institute_user_a from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok((select count(*) = 1 from public.institute_subscriptions where institute_id = (select institute_a from pg_temp.fixtures)), 'institute owner can read the assigned subscription');
select pg_temp.ok((select count(*) = 0 from public.institute_subscriptions where institute_id = (select institute_b from pg_temp.fixtures)), 'institute owner cannot read another institute subscription');
select pg_temp.ok((select count(*) = 1 from public.platform_subscription_plans where id = (select plan_id from pg_temp.fixtures)), 'institute owner can read the assigned available plan');
select pg_temp.ok((select count(*) = 1 from public.platform_subscription_invoices where id = (select invoice_a from pg_temp.fixtures)), 'institute owner can read its invoice');
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_invoices where id = (select invoice_b from pg_temp.fixtures)), 'institute owner cannot read another institute invoice');
select pg_temp.ok((select count(*) = 1 from public.platform_payment_attempts where invoice_id = (select invoice_a from pg_temp.fixtures)), 'institute owner can read its payment attempt');
select pg_temp.ok((select count(*) = 0 from public.platform_payment_attempts where invoice_id = (select invoice_b from pg_temp.fixtures)), 'institute owner cannot read another institute payment attempt');
reset role;

update public.user_memberships set role = 'accountant'
where institute_id = (select institute_a from pg_temp.fixtures)
  and user_id = (select institute_user_a from pg_temp.fixtures);
select set_config('request.jwt.claim.sub', (select institute_user_a::text from pg_temp.fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select institute_user_a from pg_temp.fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_invoices where id = (select invoice_a from pg_temp.fixtures)), 'accountant role cannot read billing invoices');
reset role;

update public.user_memberships set role = 'owner', access_scope = 'branches'
where institute_id = (select institute_a from pg_temp.fixtures)
  and user_id = (select institute_user_a from pg_temp.fixtures);
set local role authenticated;
select pg_temp.ok((select count(*) = 0 from public.platform_subscription_invoices where id = (select invoice_a from pg_temp.fixtures)), 'branch-scoped owner cannot read institute-wide billing records');
reset role;

select * from pg_temp.finish();
rollback;
