-- Keep one code-defined customer offer and let the platform owner set its
-- monthly/yearly prices plus the date window for new subscriptions.

alter table public.platform_subscription_plans
  add column if not exists available_from date,
  add column if not exists available_until date;

alter table public.platform_subscription_plans
  drop constraint if exists platform_subscription_plans_availability_dates_check;
alter table public.platform_subscription_plans
  add constraint platform_subscription_plans_availability_dates_check
  check (available_from is null or available_until is null or available_until >= available_from);

comment on column public.platform_subscription_plans.available_from is
  'First institute-local date on which new subscriptions may select this plan; null means no start boundary.';
comment on column public.platform_subscription_plans.available_until is
  'Last institute-local date on which new subscriptions may select this plan; null means no end boundary.';

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

create or replace function public.save_platform_plan_pricing(
  p_monthly_price numeric,
  p_annual_price numeric,
  p_monthly_compare_at_price numeric,
  p_annual_compare_at_price numeric,
  p_available_from date,
  p_available_until date
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
     or (p_available_from is not null and p_available_until is not null and p_available_until < p_available_from) then
    raise exception using errcode = '22023', message = 'Plan prices or availability dates are invalid';
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
      trial_days, student_limit, staff_limit, branch_limit, features,
      is_available, available_from, available_until
    ) values (
      'BizBook Complete',
      'A complete shared workspace for managing an institute.',
      p_monthly_price, p_annual_price,
      p_monthly_compare_at_price, p_annual_compare_at_price,
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
      'available_until', p_available_until
    )
  );
  return v_id;
end;
$$;

-- Retire the old owner RPC that accepted editable plan policy and metadata.
revoke all on function public.save_platform_subscription_plan_with_markdown(
  uuid, text, text, numeric, numeric, numeric, numeric, integer,
  integer, integer, integer, jsonb, boolean
) from public, anon, authenticated;
revoke all on function public.save_platform_plan_pricing(
  numeric, numeric, numeric, numeric, date, date
) from public, anon;
grant execute on function public.save_platform_plan_pricing(
  numeric, numeric, numeric, numeric, date, date
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
  if coalesce(p_start_trial, false) and v_plan.trial_days <= 0 then
    raise exception using errcode = '22023', message = 'This plan does not currently include a free trial';
  end if;

  v_institute_id := public.create_coaching_institute(p_business_name);
  if coalesce(p_start_trial, false) then
    v_status := 'trialing';
    v_trial_end := v_now + make_interval(days => v_plan.trial_days);
    v_period_end := v_trial_end;
  elsif v_price = 0 then
    v_status := 'active';
    v_period_end := null;
  else
    v_status := 'past_due';
    v_period_end := v_now + case p_billing_cycle when 'annual' then interval '1 year' else interval '1 month' end;
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
    jsonb_build_object('plan_id', v_plan.id, 'billing_cycle', p_billing_cycle, 'status', v_status)
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
