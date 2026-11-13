begin;
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table subscription_fixtures (
  user_no_trial uuid, user_trial uuid, user_second_trial uuid, user_admin uuid,
  no_trial_institute text, trial_institute text, repeat_institute text, second_trial_institute text,
  plan_one uuid, plan_two uuid, plan_three uuid, invoice_id uuid, cancel_invoice_id uuid
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
do $$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
  execute pg_catalog.format('grant select, insert, update on %I.subscription_fixtures to authenticated', temp_schema_name);
end;
$$;
select pg_temp.plan(32);
insert into subscription_fixtures default values;
insert into auth.users(id, aud, role, email)
values
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-none-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-trial-one-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-trial-two-' || gen_random_uuid() || '@example.invalid'),
  (gen_random_uuid(), 'authenticated', 'authenticated', 'bizbook-sub-admin-' || gen_random_uuid() || '@example.invalid');
update subscription_fixtures set
  user_no_trial = (select id from auth.users where email like 'bizbook-sub-none-%' order by created_at desc limit 1),
  user_trial = (select id from auth.users where email like 'bizbook-sub-trial-one-%' order by created_at desc limit 1),
  user_second_trial = (select id from auth.users where email like 'bizbook-sub-trial-two-%' order by created_at desc limit 1),
  user_admin = (select id from auth.users where email like 'bizbook-sub-admin-%' order by created_at desc limit 1);
insert into public.platform_administrators(user_id, role, granted_by)
  values ((select user_admin from subscription_fixtures), 'owner', null);
with p as (
  insert into public.platform_subscription_plans(name, description, monthly_price, annual_price,
    monthly_duration_days, annual_duration_days, features, is_available)
  values ('Remote Trial Basic ' || substr(gen_random_uuid()::text, 1, 8), 'Trial test plan', 500, 5000, 30, 365,
    '["Student workspace", "Reports"]'::jsonb, true) returning id
)
update subscription_fixtures set plan_one = (select id from p);
with p as (
  insert into public.platform_subscription_plans(name, description, monthly_price, annual_price,
    monthly_duration_days, annual_duration_days, features, is_available)
  values ('Remote Trial Plus ' || substr(gen_random_uuid()::text, 1, 8), 'Upgrade test plan', 900, 9000, 31, 366,
    '["Student workspace", "Payroll", "Reports"]'::jsonb, true) returning id
)
update subscription_fixtures set plan_two = (select id from p);
update public.platform_subscription_settings
  set trial_enabled = false, trial_duration_days = 7, trial_plan_id = null, trial_for_new_accounts = true
  where singleton;

select set_config('request.jwt.claim.sub', (select user_admin::text from subscription_fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_admin from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
update subscription_fixtures set plan_three = public.save_platform_subscription_plan_details(
  null, 'Remote Config Plan ' || substr(gen_random_uuid()::text, 1, 8), 'Saved plan editor fields',
  125, 1200, 150, 1500, null, null, 30, 365, 200, 10, 1,
  '["Students", "Payroll", "Reports"]'::jsonb, true, true
);
select pg_temp.ok((select p.description = 'Saved plan editor fields' and p.monthly_price = 125
  and p.student_limit = 200 and p.staff_limit = 10 and p.branch_limit = 1 and p.is_recommended
  and jsonb_array_length(p.features) = 3 from public.platform_subscription_plans p
  where p.id = (select plan_three from subscription_fixtures)),
  'company owner can persist plan description, prices, limits, features and recommendation');
select public.save_platform_subscription_trial_config(true, 14, (select plan_three from subscription_fixtures), true);
select pg_temp.ok((public.get_platform_subscription_trial_config()->>'enabled')::boolean
  and (public.get_platform_subscription_trial_config()->>'duration_days')::integer = 14
  and public.get_platform_subscription_trial_config()->>'plan_id' = (select plan_three::text from subscription_fixtures),
  'company owner can save and read back the new-account trial policy');
select public.save_platform_subscription_trial_config(false, 14, null, true);
select public.delete_platform_subscription_plan((select plan_three from subscription_fixtures));
select pg_temp.ok(not exists (select 1 from public.platform_subscription_plans where id = (select plan_three from subscription_fixtures)),
  'an unused plan can be safely deleted from the company catalog');
reset role;

select set_config('request.jwt.claim.sub', (select user_no_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_no_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.save_platform_subscription_trial_config(false, 14, null, true);
    perform pg_temp.ok(false, 'ordinary institute owners cannot edit company-wide trial policy');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'ordinary institute owners cannot edit company-wide trial policy');
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select user_no_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_no_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
update subscription_fixtures set no_trial_institute = public.create_coaching_institute_with_configured_trial('No Trial ' || substr(gen_random_uuid()::text, 1, 8));
select pg_temp.ok(not exists (select 1 from public.institute_subscriptions where institute_id = (select no_trial_institute from subscription_fixtures)),
  'institute account setup does not assign a paid plan or trial when trials are disabled');
select pg_temp.ok(not has_table_privilege('anon', 'public.platform_subscription_settings', 'SELECT'),
  'anonymous users cannot read private company trial settings');
select pg_temp.ok(not has_function_privilege('anon', 'public.save_platform_subscription_trial_config(boolean,integer,uuid,boolean)', 'EXECUTE'),
  'anonymous users cannot change company trial settings');
reset role;

update public.platform_subscription_settings set trial_enabled = true, trial_duration_days = 7,
  trial_plan_id = (select plan_one from subscription_fixtures), trial_for_new_accounts = true where singleton;
select set_config('request.jwt.claim.sub', (select user_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
update subscription_fixtures set trial_institute = public.create_coaching_institute_with_configured_trial('Trial Institute ' || substr(gen_random_uuid()::text, 1, 8));
select pg_temp.ok(exists (select 1 from public.institute_subscriptions s join subscription_fixtures f on f.trial_institute = s.institute_id
  where s.status = 'trialing' and s.plan_id = f.plan_one and s.trial_ends_at > s.current_period_start),
  'eligible new institute receives the configured trial plan, not a paid subscription');
reset role;
select pg_temp.ok((select duration_days = 7 from public.platform_trial_grants where institute_id = (select trial_institute from subscription_fixtures)),
  'trial duration is snapshotted from the saved company setting');
update public.platform_subscription_settings set trial_duration_days = 30 where singleton;
select pg_temp.ok((select ends_at = (select trial_ends_at from public.institute_subscriptions where institute_id = (select trial_institute from subscription_fixtures))
  from public.platform_trial_grants where institute_id = (select trial_institute from subscription_fixtures)),
  'changing the company trial duration does not extend an existing trial');

select set_config('request.jwt.claim.sub', (select user_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
update subscription_fixtures set repeat_institute = public.create_coaching_institute_with_configured_trial('Repeat Institute ' || substr(gen_random_uuid()::text, 1, 8));
select pg_temp.ok(not exists (select 1 from public.institute_subscriptions where institute_id = (select repeat_institute from subscription_fixtures)),
  'an existing account cannot receive another automatic trial for an additional institute');
reset role;

select set_config('request.jwt.claim.sub', (select user_second_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_second_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
update subscription_fixtures set second_trial_institute = public.create_coaching_institute_with_configured_trial('Trial Thirty ' || substr(gen_random_uuid()::text, 1, 8));
reset role;
select pg_temp.ok((select duration_days = 30 from public.platform_trial_grants where institute_id = (select second_trial_institute from subscription_fixtures)),
  'new eligible accounts use the latest saved trial length');

select set_config('request.jwt.claim.sub', (select user_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(has_function_privilege('authenticated', 'public.start_subscription_plan_purchase(text,uuid,text)', 'EXECUTE'),
  'authenticated sessions may request purchases through the membership-checked RPC');
select pg_temp.ok(not has_function_privilege('anon', 'public.start_subscription_plan_purchase(text,uuid,text)', 'EXECUTE'),
  'anonymous sessions cannot request plan purchases');
update subscription_fixtures f set invoice_id = (public.start_subscription_plan_purchase(f.trial_institute, f.plan_two, 'annual')->>'invoice_id')::uuid;
select pg_temp.ok((select i.amount = p.annual_price from public.platform_subscription_invoices i
  join subscription_fixtures f on f.invoice_id = i.id join public.platform_subscription_plans p on p.id = f.plan_two),
  'invoice amount is read from the saved annual plan price, not the browser');
select pg_temp.ok((select i.billing_period_end - i.billing_period_start = interval '366 days'
  from public.platform_subscription_invoices i where i.id = (select invoice_id from subscription_fixtures)),
  'invoice period uses the annual service-day value saved on the selected plan');
select pg_temp.ok((select s.status = 'trialing' and s.pending_plan_id = f.plan_two
  from public.institute_subscriptions s join subscription_fixtures f on f.trial_institute = s.institute_id),
  'plan upgrade remains pending and does not activate before verified payment');
do $$
begin
  begin
    perform public.start_subscription_plan_purchase((select trial_institute from subscription_fixtures),
      (select plan_one from subscription_fixtures), 'monthly');
    perform pg_temp.ok(false, 'another plan cannot create a competing open invoice');
  exception when sqlstate '55000' then
    perform pg_temp.ok(true, 'another plan cannot create a competing open invoice');
  end;
  begin
    perform public.start_subscription_plan_purchase((select trial_institute from subscription_fixtures),
      (select plan_two from subscription_fixtures), 'annual');
    perform pg_temp.ok(true, 'an idempotent retry reuses the same open invoice');
  exception when others then
    perform pg_temp.ok(false, 'an idempotent retry reuses the same open invoice');
  end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', (select user_second_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_second_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.start_subscription_plan_purchase((select trial_institute from subscription_fixtures),
      (select plan_two from subscription_fixtures), 'annual');
    perform pg_temp.ok(false, 'a different institute cannot purchase or inspect this institute subscription');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'a different institute cannot purchase or inspect this institute subscription');
  end;
end;
$$;
reset role;
select pg_temp.ok(not has_function_privilege('anon', 'public.delete_platform_subscription_plan(uuid)', 'EXECUTE'),
  'plan deletion is unavailable to anonymous sessions');
update public.institute_subscriptions s set status = 'active', current_period_start = i.billing_period_start,
  current_period_end = i.billing_period_end from public.platform_subscription_invoices i
  where s.institute_id = (select trial_institute from subscription_fixtures)
    and i.id = (select invoice_id from subscription_fixtures);
select pg_temp.ok((select s.status = 'active' and s.plan_id = f.plan_two and s.pending_plan_id is null
  and s.billing_cycle = 'annual' and s.current_period_end > s.current_period_start
  from public.institute_subscriptions s join subscription_fixtures f on f.trial_institute = s.institute_id),
  'the activation hook applies the selected plan and period on the trusted active-status transition');
select set_config('request.jwt.claim.sub', (select user_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(
  public.list_workspace_updates((select trial_institute from subscription_fixtures))->'subscription'->>'plan_name'
    = (select name from public.platform_subscription_plans where id = (select plan_two from subscription_fixtures))
  and public.list_workspace_updates((select trial_institute from subscription_fixtures))->'subscription'->>'status' = 'active'
  and public.list_workspace_updates((select trial_institute from subscription_fixtures))->'subscription'->>'current_period_end' is not null,
  'workspace status returns saved plan, status and actual expiration timestamp');
reset role;
select pg_temp.ok((select count(*) = 1 from public.platform_subscription_invoices where id = (select invoice_id from subscription_fixtures) and status = 'open'),
  'the activation hook alone does not mark an invoice paid');
select set_config('request.jwt.claim.sub', (select user_admin::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_admin from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.set_platform_institute_free_access((select trial_institute from subscription_fixtures), true, 'Rollback-only complimentary access test');
select pg_temp.ok((select s.free_access_enabled and s.status = 'active'
    and i.status = 'open' from public.institute_subscriptions s
    join subscription_fixtures f on f.trial_institute = s.institute_id
    join public.platform_subscription_invoices i on i.id = f.invoice_id),
  'Company Admin can grant access without changing subscription status or marking an invoice paid');
select public.set_platform_institute_free_access((select trial_institute from subscription_fixtures), false, 'Rollback-only access reset');
select pg_temp.ok(not (select s.free_access_enabled from public.institute_subscriptions s
  where s.institute_id = (select trial_institute from subscription_fixtures)),
  'Company Admin can revoke the complimentary access override');
reset role;
select pg_temp.ok((select count(*) = 0 from public.platform_trial_grants where user_id = (select user_no_trial from subscription_fixtures)),
  'no trial grant is stored for an account created while trials are disabled');

select set_config('request.jwt.claim.sub', (select user_no_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_no_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
update subscription_fixtures f set cancel_invoice_id =
  (public.start_subscription_plan_purchase(f.no_trial_institute, f.plan_two, 'monthly')->>'invoice_id')::uuid;
reset role;

insert into public.platform_payment_attempts(invoice_id, institute_id, provider, status, idempotency_key, attempt_number, initiated_by)
select f.cancel_invoice_id, f.no_trial_institute, 'razorpay', 'created', 'cancel-test-' || gen_random_uuid()::text, 1, f.user_no_trial
from subscription_fixtures f;
select set_config('request.jwt.claim.sub', (select user_no_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_no_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.cancel_unstarted_subscription_invoice((select cancel_invoice_id from subscription_fixtures));
    perform pg_temp.ok(false, 'a started provider checkout cannot be cancelled as an unstarted request');
  exception when sqlstate '55000' then
    perform pg_temp.ok(true, 'a started provider checkout cannot be cancelled as an unstarted request');
  end;
end; $$;
reset role;
delete from public.platform_payment_attempts where invoice_id = (select cancel_invoice_id from subscription_fixtures);
select set_config('request.jwt.claim.sub', (select user_no_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_no_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(public.cancel_unstarted_subscription_invoice((select cancel_invoice_id from subscription_fixtures))->>'status' = 'void',
  'institute owner can cancel an unpaid invoice before a provider attempt starts');
select pg_temp.ok((select i.status = 'void' and s.status = 'expired' and s.plan_id is null
    and s.pending_plan_id is null and s.pending_billing_cycle is null
  from public.platform_subscription_invoices i join public.institute_subscriptions s on s.id = i.subscription_id
  where i.id = (select cancel_invoice_id from subscription_fixtures)),
  'cancelling the first checkout voids its invoice and removes the unpurchased plan assignment');
reset role;

select set_config('request.jwt.claim.sub', (select user_second_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_second_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.cancel_unstarted_subscription_invoice((select cancel_invoice_id from subscription_fixtures));
    perform pg_temp.ok(false, 'another institute owner cannot cancel this plan invoice');
  exception when sqlstate '42501' then
    perform pg_temp.ok(true, 'another institute owner cannot cancel this plan invoice');
  end;
end; $$;
reset role;

select set_config('request.jwt.claim.sub', (select user_no_trial::text from subscription_fixtures), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select user_no_trial from subscription_fixtures), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok((public.start_subscription_plan_purchase((select no_trial_institute from subscription_fixtures),
  (select plan_two from subscription_fixtures), 'monthly')->>'invoice_id') is not null,
  'a replacement plan can be purchased after the unstarted request is cancelled');
reset role;

select count(*) = 32 as planned_assertions from test_results;
select * from pg_temp.finish();
rollback;
