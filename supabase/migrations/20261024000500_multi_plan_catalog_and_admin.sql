-- Support multiple code-defined BizBook plans with owner-managed pricing.
-- Each plan uses the same product feature set; only the name, amounts,
-- availability dates and billing-day lengths are managed in Company Admin.

create unique index if not exists platform_subscription_plans_name_ci_uidx
  on public.platform_subscription_plans (lower(btrim(name)));

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
    'trial_days', p.trial_days,
    'can_purchase',
      (p.available_from is null or p.available_from <= (statement_timestamp() at time zone 'Asia/Kolkata')::date)
      and (p.available_until is null or p.available_until >= (statement_timestamp() at time zone 'Asia/Kolkata')::date),
    'availability_status', case
      when p.available_from is not null and p.available_from > (statement_timestamp() at time zone 'Asia/Kolkata')::date then 'upcoming'
      when p.available_until is not null and p.available_until < (statement_timestamp() at time zone 'Asia/Kolkata')::date then 'expired'
      else 'available'
    end
  ) order by p.created_at, p.name), '[]'::jsonb)
  from public.platform_subscription_plans as p
  where p.is_available
    and p.monthly_price > 0
    and p.annual_price > 0;
$$;
revoke all on function public.get_public_subscription_plans() from public;
grant execute on function public.get_public_subscription_plans() to anon, authenticated;

create or replace function public.save_platform_subscription_plan_pricing(
  p_plan_id uuid,
  p_name text,
  p_monthly_price numeric,
  p_annual_price numeric,
  p_monthly_compare_at_price numeric,
  p_annual_compare_at_price numeric,
  p_available_from date,
  p_available_until date,
  p_monthly_duration_days integer,
  p_annual_duration_days integer,
  p_is_available boolean
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
  v_created boolean := p_plan_id is null;
  v_name text := btrim(coalesce(p_name, ''));
  v_features jsonb := jsonb_build_object('items', jsonb_build_array(
    'Student admission records and fee schedules',
    'Attendance tracking, staff records and payroll',
    'Fee and advance receipts, allocations and refund tracking',
    'Outstanding installment and overdue fee reports',
    'Expense ledger, monthly expense reminders and payment records',
    'Institute dashboard and financial reports',
    'Role-based team access'
  ));
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if length(v_name) not between 2 and 80
     or v_name ~ '[[:cntrl:]]'
     or p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 9999999999.99
     or p_annual_price is null or p_annual_price <= 0 or p_annual_price > 9999999999.99
     or (p_monthly_compare_at_price is not null and
         (p_monthly_compare_at_price < p_monthly_price or p_monthly_compare_at_price > 9999999999.99))
     or (p_annual_compare_at_price is not null and
         (p_annual_compare_at_price < p_annual_price or p_annual_compare_at_price > 9999999999.99))
     or (p_available_from is not null and p_available_until is not null and p_available_until < p_available_from)
     or p_monthly_duration_days is null or p_monthly_duration_days not between 1 and 3660
     or p_annual_duration_days is null or p_annual_duration_days not between 1 and 3660
     or p_is_available is null then
    raise exception using errcode = '22023', message = 'Plan details, prices, billing days, or availability dates are invalid';
  end if;
  if exists (
    select 1 from public.platform_subscription_plans p
     where lower(btrim(p.name)) = lower(v_name)
       and (p_plan_id is null or p.id <> p_plan_id)
  ) then
    raise exception using errcode = '23505', message = 'A plan with this name already exists';
  end if;

  if p_plan_id is null then
    insert into public.platform_subscription_plans(
      name, description, monthly_price, annual_price,
      monthly_compare_at_price, annual_compare_at_price,
      monthly_duration_days, annual_duration_days,
      trial_days, student_limit, staff_limit, branch_limit, features,
      is_available, available_from, available_until
    ) values (
      v_name, 'A complete BizBook workspace for an institute.',
      p_monthly_price, p_annual_price,
      p_monthly_compare_at_price, p_annual_compare_at_price,
      p_monthly_duration_days, p_annual_duration_days,
      0, null, null, null, v_features,
      p_is_available, p_available_from, p_available_until
    ) returning * into v_plan;
  else
    select * into v_plan
      from public.platform_subscription_plans
     where id = p_plan_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'The selected plan does not exist';
    end if;
    update public.platform_subscription_plans
       set name = v_name,
           description = 'A complete BizBook workspace for an institute.',
           monthly_price = p_monthly_price,
           annual_price = p_annual_price,
           monthly_compare_at_price = p_monthly_compare_at_price,
           annual_compare_at_price = p_annual_compare_at_price,
           monthly_duration_days = p_monthly_duration_days,
           annual_duration_days = p_annual_duration_days,
           features = v_features,
           is_available = p_is_available,
           available_from = p_available_from,
           available_until = p_available_until
     where id = p_plan_id
     returning * into v_plan;
  end if;
  v_id := v_plan.id;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (
    v_actor,
    case when v_created then 'subscription_plan_created' else 'subscription_plan_updated' end,
    'subscription_plan',
    v_id::text,
    jsonb_build_object(
      'name', v_name,
      'monthly_price', p_monthly_price,
      'annual_price', p_annual_price,
      'monthly_compare_at_price', p_monthly_compare_at_price,
      'annual_compare_at_price', p_annual_compare_at_price,
      'available_from', p_available_from,
      'available_until', p_available_until,
      'monthly_duration_days', p_monthly_duration_days,
      'annual_duration_days', p_annual_duration_days,
      'is_available', p_is_available
    )
  );
  return v_id;
end;
$$;
revoke all on function public.save_platform_subscription_plan_pricing(
  uuid, text, numeric, numeric, numeric, numeric, date, date, integer, integer, boolean
) from public, anon;
grant execute on function public.save_platform_subscription_plan_pricing(
  uuid, text, numeric, numeric, numeric, numeric, date, date, integer, integer, boolean
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
