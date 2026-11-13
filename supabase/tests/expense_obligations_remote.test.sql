begin;

-- Focused regression suite for migrations 20261018001000-01200.
-- Uses one synthetic owner/institute and rolls every fixture back.
create temporary table test_results (
  assertion_no bigint generated always as identity primary key,
  passed boolean not null,
  description text not null
);
create temporary table test_plan (expected integer not null);
create temporary table fixture as
select gen_random_uuid() as owner_id,
  ('expense-obligation-' || replace(gen_random_uuid()::text, '-', '')) as institute_id,
  gen_random_uuid() as rule_id,
  gen_random_uuid()::text as unpaid_expense_id,
  gen_random_uuid()::text as recurring_expense_id,
  gen_random_uuid()::text as duplicate_expense_id,
  (now() at time zone 'Asia/Kolkata')::date as business_date,
  date_trunc('month', now() at time zone 'Asia/Kolkata')::date as month_start;

create or replace function pg_temp.record_test(passed boolean, description text)
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
create or replace function pg_temp.ok(passed boolean, description text)
returns boolean language plpgsql as $$
begin
  return pg_temp.record_test(passed, description);
end;
$$;
create or replace function pg_temp.is(actual anyelement, expected anyelement, description text)
returns boolean language plpgsql as $$
begin
  return pg_temp.record_test(actual is not distinct from expected, description);
end;
$$;
create or replace function pg_temp.throws_ok(statement text, expected_state text, description text)
returns boolean language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actual_state text;
begin
  execute statement;
  return pg_temp.record_test(false, description || ' (did not throw)');
exception when others then
  get stacked diagnostics actual_state = returned_sqlstate;
  return pg_temp.record_test(actual_state = expected_state,
    description || case when actual_state = expected_state then '' else ' (SQLSTATE ' || actual_state || ')' end);
end;
$$;
create or replace function pg_temp.finish()
returns setof text language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare expected_count integer; actual_count bigint; failed_count bigint; item record;
begin
  select expected into expected_count from pg_temp.test_plan order by ctid desc limit 1;
  select count(*), count(*) filter (where not passed) into actual_count, failed_count from pg_temp.test_results;
  return next '1..' || coalesce(expected_count, 0)::text;
  for item in select * from pg_temp.test_results order by assertion_no loop
    return next case when item.passed then 'ok ' else 'not ok ' end || item.assertion_no::text || ' - ' || item.description;
  end loop;
  if actual_count <> expected_count then
    return next format('not ok 0 - planned %s assertions but ran %s', expected_count, actual_count);
  end if;
  return next format('# assertions=%s failed=%s planned=%s', actual_count, failed_count, expected_count);
end;
$$;
do $grant_temp_usage$
declare temp_schema_name text;
begin
  select nspname into temp_schema_name from pg_catalog.pg_namespace where oid = pg_catalog.pg_my_temp_schema();
  execute pg_catalog.format('grant usage on schema %I to authenticated', temp_schema_name);
  execute pg_catalog.format('grant select on %I.fixture to authenticated', temp_schema_name);
end;
$grant_temp_usage$;

insert into auth.users(id, aud, role, email, email_confirmed_at)
select owner_id, 'authenticated', 'authenticated',
  'expense-' || replace(owner_id::text, '-', '') || '@example.invalid', now()
from pg_temp.fixture;
insert into public.coaching_institutes(id, business_name)
select institute_id, 'Expense obligation test' from pg_temp.fixture;
insert into public.user_memberships(institute_id, user_id, role, access_scope)
select institute_id, owner_id, 'owner', 'institute' from pg_temp.fixture;

select pg_temp.plan(36);
select pg_temp.ok(to_regclass('public.recurring_expense_rules') is not null, 'fixed monthly expense rules table exists');
select pg_temp.ok(to_regprocedure('public.create_recurring_expense_rule(uuid,text,text,text,text,numeric,text,integer,date,text)') is not null, 'create rule RPC exists');
select pg_temp.ok(to_regprocedure('public.record_recurring_expense_payment(text,uuid,date,date,text)') is not null, 'recurring payment RPC exists');
select pg_temp.ok(to_regprocedure('public.record_expense_entry(text,text,text,text,text,numeric,date,text,date,date,text,text)') is not null, 'unpaid/paid expense entry RPC exists');
select pg_temp.ok(to_regprocedure('public.record_expense_payment(text,date,text)') is not null, 'expense settlement RPC exists');
select pg_temp.ok(not (select prosecdef from pg_proc where oid = 'public.expense_month_summary(text,text,date)'::regprocedure), 'monthly cash summary executes as caller');
select pg_temp.ok(not (select prosecdef from pg_proc where oid = 'public.expense_dashboard_summary(text,text,date)'::regprocedure), 'obligation summary executes as caller');
select pg_temp.ok(not has_function_privilege('anon', 'public.record_expense_entry(text,text,text,text,text,numeric,date,text,date,date,text,text)', 'EXECUTE'), 'anonymous users cannot record expenses');
select pg_temp.ok(has_function_privilege('authenticated', 'public.record_expense_entry(text,text,text,text,text,numeric,date,text,date,date,text,text)', 'EXECUTE'), 'authenticated users can use guarded expense entry');
select pg_temp.ok(not has_function_privilege('anon', 'public.record_recurring_expense_payment(text,uuid,date,date,text)', 'EXECUTE'), 'anonymous users cannot record monthly expense payments');
select pg_temp.ok(has_function_privilege('authenticated', 'public.record_recurring_expense_payment(text,uuid,date,date,text)', 'EXECUTE'), 'authenticated users can use guarded recurring payment RPC');

select set_config('request.jwt.claim.sub', (select owner_id::text from pg_temp.fixture), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', (select owner_id from pg_temp.fixture), 'role', 'authenticated')::text, true);
set local role authenticated;

select pg_temp.is(
  (select public.create_recurring_expense_rule(rule_id, institute_id, null, 'Rent', 'Rent', 75.00, 'Bank Transfer', 28, month_start, null) from pg_temp.fixture),
  (select public.create_recurring_expense_rule(rule_id, institute_id, null, 'Rent', 'Rent', 75.00, 'Bank Transfer', 28, month_start, null) from pg_temp.fixture),
  'same recurring rule request is idempotent');
select pg_temp.is((select count(*) from public.expenses where recurring_rule_id = (select rule_id from pg_temp.fixture)), 0::bigint, 'a reminder rule does not create an expense before payment');
select pg_temp.is(
  (select public.record_recurring_expense_payment(recurring_expense_id, rule_id, month_start, business_date, 'UPI') from pg_temp.fixture),
  (select public.record_recurring_expense_payment(recurring_expense_id, rule_id, month_start, business_date, 'UPI') from pg_temp.fixture),
  'retrying the same fixed-month payment returns the existing ledger expense');
select pg_temp.is((select count(*) from public.expenses where recurring_rule_id = (select rule_id from pg_temp.fixture) and recurring_due_month = (select month_start from pg_temp.fixture) and payment_status = 'paid'), 1::bigint, 'fixed-month payment creates exactly one paid expense');
select pg_temp.throws_ok(
  format('select public.record_recurring_expense_payment(%L,%L::uuid,%L::date,%L::date,%L)',
    (select duplicate_expense_id from pg_temp.fixture), (select rule_id from pg_temp.fixture),
    (select month_start from pg_temp.fixture), (select business_date from pg_temp.fixture), 'Cash'),
  '23505', 'a second receipt cannot pay the same rule-month');
select pg_temp.throws_ok(
  format('update public.expenses set amount = 99 where id = %L', (select recurring_expense_id from pg_temp.fixture)),
  '23514', 'a posted recurring expense cannot be edited in place');

select pg_temp.is(
  (select public.record_expense_entry(unpaid_expense_id, institute_id, null, 'Electricity', 'Utilities', 123.45, business_date, 'unpaid', business_date + 3, null, null, null) from pg_temp.fixture),
  (select unpaid_expense_id from pg_temp.fixture),
  'unpaid entry records an obligation without a payment method');
select pg_temp.is((select payment_status from public.expenses where id = (select unpaid_expense_id from pg_temp.fixture)), 'unpaid'::text, 'new obligation remains unpaid');
select pg_temp.is((select method from public.expenses where id = (select unpaid_expense_id from pg_temp.fixture)), null::text, 'unpaid obligation has no fabricated payment method');
select pg_temp.is((select month_total from public.expense_month_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))), 75.00::numeric, 'cash expense summary excludes unpaid obligations');
select pg_temp.is(
  (select recorded_month_total from public.expense_dashboard_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))),
  198.45::numeric, 'dashboard booked amount includes paid and unpaid expenses');
select pg_temp.is((select unpaid_total from public.expense_dashboard_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))), 123.45::numeric, 'dashboard exposes unpaid amount separately');
select pg_temp.is((select unpaid_count from public.expense_dashboard_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))), 1::bigint, 'dashboard counts unpaid obligations');
select pg_temp.is((select count(*) from public.payment_history where id = (select unpaid_expense_id from pg_temp.fixture)), 0::bigint, 'unpaid obligations do not appear as paid in payment history');
select pg_temp.is((select count(*) from public.financial_activity where source_id = (select unpaid_expense_id from pg_temp.fixture)), 0::bigint, 'unpaid obligations do not create cash-flow activity');

select pg_temp.is(
  (select public.record_expense_payment(unpaid_expense_id, business_date, 'Cash') from pg_temp.fixture),
  (select public.record_expense_payment(unpaid_expense_id, business_date, 'Cash') from pg_temp.fixture),
  'retrying the same settlement is idempotent');
select pg_temp.throws_ok(
  format('select public.record_expense_payment(%L,%L::date,%L)', (select unpaid_expense_id from pg_temp.fixture), (select business_date from pg_temp.fixture), 'UPI'),
  '23505', 'a paid expense cannot be silently settled again with different details');
select pg_temp.is((select month_total from public.expense_month_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))), 198.45::numeric, 'paid expense summary includes both actual settlements exactly once');
select pg_temp.is((select unpaid_total from public.expense_dashboard_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))), 0::numeric, 'settlement removes the obligation from unpaid total');
select pg_temp.is((select unpaid_count from public.expense_dashboard_summary((select institute_id from pg_temp.fixture), null, (select month_start from pg_temp.fixture))), 0::bigint, 'settlement removes the obligation from unpaid count');
select pg_temp.is((select count(*) from public.payment_history where id = (select unpaid_expense_id from pg_temp.fixture) and paid_at::date = (select business_date from pg_temp.fixture) and method = 'Cash'), 1::bigint, 'payment history shows the actual expense payment date and method');
select pg_temp.is((select count(*) from public.financial_activity where source_id = (select unpaid_expense_id from pg_temp.fixture) and activity_date = (select business_date from pg_temp.fixture) and direction = 'outflow'), 1::bigint, 'cash-flow report dates the outflow on settlement');
select pg_temp.throws_ok(
  format('select public.record_expense_payment(%L,%L::date,%L)', (select unpaid_expense_id from pg_temp.fixture), (select business_date + 1 from pg_temp.fixture), 'Cash'),
  '22023', 'future-dated expense settlement is rejected');
select pg_temp.is(
  (select public.pause_recurring_expense_rule(rule_id) from pg_temp.fixture),
  (select business_date from pg_temp.fixture),
  'pausing a fixed expense records its end date without deleting history');
select pg_temp.throws_ok(
  format('select public.record_recurring_expense_payment(%L,%L::uuid,%L::date,%L::date,%L)',
    (select duplicate_expense_id from pg_temp.fixture), (select rule_id from pg_temp.fixture),
    (select month_start from pg_temp.fixture), (select business_date from pg_temp.fixture), 'Cash'),
  '23514', 'paused monthly schedule cannot be paid again for an expired due date');

reset role;
select * from pg_temp.finish();
rollback;
