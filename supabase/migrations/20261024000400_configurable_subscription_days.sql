-- The Company Admin controls the service-day length used by each subscription
-- cycle. Existing rows receive the standard 30/365 day defaults.

alter table public.platform_subscription_plans
  add column if not exists monthly_duration_days integer not null default 30,
  add column if not exists annual_duration_days integer not null default 365;

alter table public.platform_subscription_plans
  drop constraint if exists platform_subscription_plans_monthly_duration_days_check;
alter table public.platform_subscription_plans
  add constraint platform_subscription_plans_monthly_duration_days_check
  check (monthly_duration_days between 1 and 3660);
alter table public.platform_subscription_plans
  drop constraint if exists platform_subscription_plans_annual_duration_days_check;
alter table public.platform_subscription_plans
  add constraint platform_subscription_plans_annual_duration_days_check
  check (annual_duration_days between 1 and 3660);

comment on column public.platform_subscription_plans.monthly_duration_days is
  'Number of service days included in one monthly subscription invoice.';
comment on column public.platform_subscription_plans.annual_duration_days is
  'Number of service days included in one yearly subscription invoice.';

create or replace function public.get_public_subscription_plans()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'monthly_price', p.monthly_price,
    'annual_price', p.annual_price,
    'monthly_compare_at_price', p.monthly_compare_at_price,
    'annual_compare_at_price', p.annual_compare_at_price,
    'available_from', p.available_from,
    'available_until', p.available_until,
    'monthly_duration_days', p.monthly_duration_days,
    'annual_duration_days', p.annual_duration_days,
    'can_purchase',
      (p.available_from is null or p.available_from <= (statement_timestamp() at time zone 'Asia/Kolkata')::date)
      and (p.available_until is null or p.available_until >= (statement_timestamp() at time zone 'Asia/Kolkata')::date),
    'availability_status', case
      when p.available_from is not null and p.available_from > (statement_timestamp() at time zone 'Asia/Kolkata')::date then 'upcoming'
      when p.available_until is not null and p.available_until < (statement_timestamp() at time zone 'Asia/Kolkata')::date then 'expired'
      else 'available'
    end
  ) order by p.created_at), '[]'::jsonb)
  from (
    select plan.*
      from public.platform_subscription_plans as plan
     where plan.name = 'BizBook Complete'
       and plan.is_available
       and plan.monthly_price > 0
       and plan.annual_price > 0
     order by plan.created_at asc
     limit 1
  ) as p;
$$;
revoke all on function public.get_public_subscription_plans() from public;
grant execute on function public.get_public_subscription_plans() to anon, authenticated;

drop function public.save_platform_plan_pricing(numeric, numeric, numeric, numeric, date, date);
create function public.save_platform_plan_pricing(
  p_monthly_price numeric,
  p_annual_price numeric,
  p_monthly_compare_at_price numeric,
  p_annual_compare_at_price numeric,
  p_available_from date,
  p_available_until date,
  p_monthly_duration_days integer,
  p_annual_duration_days integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan public.platform_subscription_plans%rowtype;
  v_id uuid;
  v_created boolean := false;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 9999999999.99
     or p_annual_price is null or p_annual_price <= 0 or p_annual_price > 9999999999.99
     or (p_monthly_compare_at_price is not null and
         (p_monthly_compare_at_price < p_monthly_price or p_monthly_compare_at_price > 9999999999.99))
     or (p_annual_compare_at_price is not null and
         (p_annual_compare_at_price < p_annual_price or p_annual_compare_at_price > 9999999999.99))
     or (p_available_from is not null and p_available_until is not null and p_available_until < p_available_from)
     or p_monthly_duration_days is null or p_monthly_duration_days not between 1 and 3660
     or p_annual_duration_days is null or p_annual_duration_days not between 1 and 3660 then
    raise exception using errcode = '22023', message = 'Plan prices, billing days, or availability dates are invalid';
  end if;

  select * into v_plan
    from public.platform_subscription_plans
   where name = 'BizBook Complete'
   order by created_at asc
   limit 1
   for update;
  if not found then
    v_created := true;
    insert into public.platform_subscription_plans(
      name, description, monthly_price, annual_price,
      monthly_compare_at_price, annual_compare_at_price,
      monthly_duration_days, annual_duration_days,
      trial_days, student_limit, staff_limit, branch_limit, features,
      is_available, available_from, available_until
    ) values (
      'BizBook Complete',
      'A complete shared workspace for managing an institute.',
      p_monthly_price, p_annual_price,
      p_monthly_compare_at_price, p_annual_compare_at_price,
      p_monthly_duration_days, p_annual_duration_days,
      0, null, null, null,
      jsonb_build_object('items', jsonb_build_array(
        'Student admission records and fee schedules',
        'Attendance tracking, staff records and payroll',
        'Fee and advance receipts, allocations and refund tracking',
        'Outstanding installment and overdue fee reports',
        'Expense ledger, monthly expense reminders and payment records',
        'Institute dashboard and financial reports',
        'Role-based team access'
      )),
      true, p_available_from, p_available_until
    ) returning * into v_plan;
  else
    update public.platform_subscription_plans
       set monthly_price = p_monthly_price,
           annual_price = p_annual_price,
           monthly_compare_at_price = p_monthly_compare_at_price,
           annual_compare_at_price = p_annual_compare_at_price,
           available_from = p_available_from,
           available_until = p_available_until,
           monthly_duration_days = p_monthly_duration_days,
           annual_duration_days = p_annual_duration_days,
           is_available = true
     where id = v_plan.id
     returning * into v_plan;
  end if;
  v_id := v_plan.id;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (
    v_actor,
    case when v_created then 'subscription_plan_pricing_created' else 'subscription_plan_pricing_updated' end,
    'subscription_plan',
    v_id::text,
    jsonb_build_object(
      'name', v_plan.name,
      'monthly_price', p_monthly_price,
      'annual_price', p_annual_price,
      'monthly_compare_at_price', p_monthly_compare_at_price,
      'annual_compare_at_price', p_annual_compare_at_price,
      'available_from', p_available_from,
      'available_until', p_available_until,
      'monthly_duration_days', p_monthly_duration_days,
      'annual_duration_days', p_annual_duration_days
    )
  );
  return v_id;
end;
$$;
revoke all on function public.save_platform_plan_pricing(
  numeric, numeric, numeric, numeric, date, date, integer, integer
) from public, anon;
grant execute on function public.save_platform_plan_pricing(
  numeric, numeric, numeric, numeric, date, date, integer, integer
) to authenticated;

create or replace function public.create_coaching_institute_with_plan(
  p_business_name text,
  p_plan_id uuid,
  p_billing_cycle text,
  p_start_trial boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.platform_subscription_plans%rowtype;
  v_institute_id text;
  v_subscription_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_status text;
  v_now timestamptz := statement_timestamp();
  v_today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  v_period_end timestamptz;
  v_trial_end timestamptz;
  v_price numeric(12,2);
  v_duration_days integer;
begin
  if v_user_id is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '28000', message = 'Verified account sign-in is required';
  end if;
  if p_business_name is null or length(btrim(p_business_name)) not between 1 and 100
     or p_billing_cycle is null or p_billing_cycle not in ('monthly', 'annual')
     or p_start_trial is null then
    raise exception using errcode = '22023', message = 'Institute name or billing cycle is invalid';
  end if;

  select * into v_plan
    from public.platform_subscription_plans
   where id = p_plan_id
     and name = 'BizBook Complete'
     and is_available
     and monthly_price > 0
     and annual_price > 0
     and (available_from is null or available_from <= v_today)
     and (available_until is null or available_until >= v_today)
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'The selected plan is not available for new institutes on this date';
  end if;

  v_price := case p_billing_cycle when 'annual' then v_plan.annual_price else v_plan.monthly_price end;
  v_duration_days := case p_billing_cycle when 'annual' then v_plan.annual_duration_days else v_plan.monthly_duration_days end;
  if coalesce(p_start_trial, false) and v_plan.trial_days <= 0 then
    raise exception using errcode = '22023', message = 'This plan does not currently include a free trial';
  end if;

  v_institute_id := public.create_coaching_institute(p_business_name);
  if coalesce(p_start_trial, false) then
    v_status := 'trialing';
    v_trial_end := v_now + make_interval(days => v_plan.trial_days);
    v_period_end := v_trial_end;
  else
    v_status := 'past_due';
    v_period_end := v_now + make_interval(days => v_duration_days);
  end if;

  insert into public.institute_subscriptions(
    institute_id, plan_id, status, billing_cycle, trial_ends_at,
    current_period_start, current_period_end
  ) values (
    v_institute_id, v_plan.id, v_status, p_billing_cycle, v_trial_end,
    v_now, v_period_end
  ) returning id into v_subscription_id;

  insert into public.platform_subscription_events(
    institute_id, subscription_id, actor_user_id, event_type, reason, details
  ) values (
    v_institute_id, v_subscription_id, v_user_id,
    case when v_status = 'trialing' then 'subscription_trial_started' else 'subscription_selected' end,
    null,
    jsonb_build_object('plan_id', v_plan.id, 'billing_cycle', p_billing_cycle,
                       'duration_days', v_duration_days, 'status', v_status)
  );

  if v_status = 'past_due' then
    v_invoice_number := 'BBI-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));
    insert into public.platform_subscription_invoices(
      institute_id, subscription_id, invoice_number, billing_period_start,
      billing_period_end, amount, currency, status, due_at
    ) values (
      v_institute_id, v_subscription_id, v_invoice_number, v_now,
      v_period_end, v_price, 'INR', 'open', v_now + interval '7 days'
    ) returning id into v_invoice_id;
  end if;

  return jsonb_build_object(
    'institute_id', v_institute_id,
    'subscription_id', v_subscription_id,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'trial_ends_at', v_trial_end
  );
end;
$$;
revoke all on function public.create_coaching_institute_with_plan(text, uuid, text, boolean) from public, anon;
grant execute on function public.create_coaching_institute_with_plan(text, uuid, text, boolean) to authenticated;

create or replace function public.create_self_service_subscription_invoice(p_institute_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_subscription public.institute_subscriptions%rowtype;
  v_plan public.platform_subscription_plans%rowtype;
  v_existing public.platform_subscription_invoices%rowtype;
  v_price numeric(12,2);
  v_duration_days integer;
  v_now timestamptz := statement_timestamp();
  v_start timestamptz;
  v_end timestamptz;
  v_invoice_id uuid;
  v_invoice_number text;
begin
  if v_user is null or auth.role() is distinct from 'authenticated'
     or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception using errcode = '42501', message = 'Institute owner or administrator access is required';
  end if;
  select * into v_subscription from public.institute_subscriptions
   where institute_id = p_institute_id for update;
  if not found or v_subscription.plan_id is null
     or v_subscription.status not in ('trialing', 'past_due', 'expired', 'active', 'cancelled') then
    raise exception using errcode = '23514', message = 'A payable subscription plan is required';
  end if;
  select * into v_plan from public.platform_subscription_plans where id = v_subscription.plan_id;
  if not found then raise exception using errcode = 'P0002', message = 'Assigned plan was not found'; end if;
  v_price := case v_subscription.billing_cycle when 'annual' then v_plan.annual_price else v_plan.monthly_price end;
  v_duration_days := case v_subscription.billing_cycle when 'annual' then v_plan.annual_duration_days else v_plan.monthly_duration_days end;

  select * into v_existing from public.platform_subscription_invoices
   where institute_id = p_institute_id and subscription_id = v_subscription.id
     and status in ('open', 'past_due')
   order by created_at desc limit 1 for update;
  if found then
    if v_subscription.status in ('expired', 'cancelled') then
      update public.institute_subscriptions set status = 'past_due' where id = v_subscription.id;
    end if;
    return jsonb_build_object('invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
                              'amount', v_existing.amount, 'status', v_existing.status, 'reused', true);
  end if;

  if v_price = 0 then
    update public.institute_subscriptions
       set status = 'active', trial_ends_at = null,
           current_period_start = v_now, current_period_end = null
     where id = v_subscription.id;
    insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type, details)
    values (p_institute_id, v_subscription.id, v_user, 'subscription_activated_free',
            jsonb_build_object('plan_id', v_subscription.plan_id, 'billing_cycle', v_subscription.billing_cycle));
    return jsonb_build_object('invoice_id', null, 'status', 'active', 'free', true);
  end if;

  v_start := greatest(v_now, coalesce(v_subscription.current_period_end, v_now), coalesce(v_subscription.trial_ends_at, v_now));
  v_end := v_start + make_interval(days => v_duration_days);
  v_invoice_number := 'BBI-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));
  insert into public.platform_subscription_invoices(
    institute_id, subscription_id, invoice_number, billing_period_start,
    billing_period_end, amount, currency, status, due_at
  ) values (
    p_institute_id, v_subscription.id, v_invoice_number, v_start,
    v_end, v_price, 'INR', 'open', v_now + interval '7 days'
  ) returning id into v_invoice_id;

  if v_subscription.status in ('expired', 'cancelled') then
    update public.institute_subscriptions set status = 'past_due' where id = v_subscription.id;
  end if;

  insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type, details)
  values (p_institute_id, v_subscription.id, v_user, 'subscription_invoice_requested',
          jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_price,
                             'billing_cycle', v_subscription.billing_cycle, 'duration_days', v_duration_days));
  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
                            'amount', v_price, 'status', 'open', 'reused', false,
                            'duration_days', v_duration_days);
end;
$$;
revoke all on function public.create_self_service_subscription_invoice(text) from public, anon;
grant execute on function public.create_self_service_subscription_invoice(text) to authenticated;
