-- Configurable new-account trials, administrator-owned plan details, and
-- institute-selected plan purchases. Existing invoices keep their snapshots.

alter table public.platform_subscription_plans
  add column if not exists is_recommended boolean not null default false;

alter table public.institute_subscriptions
  add column if not exists pending_plan_id uuid references public.platform_subscription_plans(id) on delete restrict,
  add column if not exists pending_billing_cycle text check (pending_billing_cycle is null or pending_billing_cycle in ('monthly', 'annual'));

create table if not exists public.platform_subscription_settings (
  singleton boolean primary key default true check (singleton),
  trial_enabled boolean not null default false,
  trial_duration_days integer not null default 14 check (trial_duration_days between 1 and 365),
  trial_plan_id uuid references public.platform_subscription_plans(id) on delete restrict,
  trial_for_new_accounts boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (not trial_enabled or trial_plan_id is not null)
);
insert into public.platform_subscription_settings(singleton, trial_enabled, trial_duration_days, trial_for_new_accounts)
values (true, false, 14, true)
on conflict (singleton) do nothing;
alter table public.platform_subscription_settings enable row level security;
revoke all on public.platform_subscription_settings from public, anon, authenticated;
grant all on public.platform_subscription_settings to service_role;

create table if not exists public.platform_trial_grants (
  user_id uuid primary key references auth.users(id) on delete restrict,
  institute_id text not null unique references public.coaching_institutes(id) on delete restrict,
  plan_id uuid not null references public.platform_subscription_plans(id) on delete restrict,
  started_at timestamptz not null,
  ends_at timestamptz not null,
  duration_days integer not null check (duration_days between 1 and 365),
  created_at timestamptz not null default now(),
  check (ends_at > started_at)
);
alter table public.platform_trial_grants enable row level security;
revoke all on public.platform_trial_grants from public, anon, authenticated;
grant all on public.platform_trial_grants to service_role;

create or replace function public.save_platform_subscription_plan_details(
  p_plan_id uuid,
  p_name text,
  p_description text,
  p_monthly_price numeric,
  p_annual_price numeric,
  p_monthly_compare_at_price numeric,
  p_annual_compare_at_price numeric,
  p_available_from date,
  p_available_until date,
  p_monthly_duration_days integer,
  p_annual_duration_days integer,
  p_student_limit integer,
  p_staff_limit integer,
  p_branch_limit integer,
  p_features jsonb,
  p_is_recommended boolean,
  p_is_available boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan_id uuid;
  v_old_name text;
  v_name text := btrim(coalesce(p_name, ''));
  v_feature_count integer;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if length(v_name) not between 2 and 80 or v_name ~ '[[:cntrl:]]'
     or p_description is null or length(btrim(p_description)) > 500
     or p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price > 9999999999.99
     or p_annual_price is null or p_annual_price <= 0 or p_annual_price > 9999999999.99
     or (p_monthly_compare_at_price is not null and (p_monthly_compare_at_price < p_monthly_price or p_monthly_compare_at_price > 9999999999.99))
     or (p_annual_compare_at_price is not null and (p_annual_compare_at_price < p_annual_price or p_annual_compare_at_price > 9999999999.99))
     or (p_available_from is not null and p_available_until is not null and p_available_until < p_available_from)
     or p_monthly_duration_days is null or p_monthly_duration_days not between 1 and 3660
     or p_annual_duration_days is null or p_annual_duration_days not between 1 and 3660
     or p_student_limit is not null and p_student_limit < 0
     or p_staff_limit is not null and p_staff_limit < 0
     or p_branch_limit is not null and p_branch_limit < 0
     or p_features is null or jsonb_typeof(p_features) <> 'array'
     or p_is_recommended is null or p_is_available is null then
    raise exception using errcode = '22023', message = 'Plan details, features, prices, or availability are invalid';
  end if;
  select count(*) into v_feature_count from jsonb_array_elements(p_features) as f(value)
   where jsonb_typeof(f.value) <> 'string' or length(btrim(f.value #>> '{}')) not between 1 and 120;
  if jsonb_array_length(p_features) > 20 or v_feature_count > 0 then
    raise exception using errcode = '22023', message = 'Plan features must be up to 20 nonempty text items';
  end if;
  if exists (select 1 from public.platform_subscription_plans p
    where lower(btrim(p.name)) = lower(v_name) and (p_plan_id is null or p.id <> p_plan_id)) then
    raise exception using errcode = '23505', message = 'A plan with this name already exists';
  end if;

  if p_plan_id is null then
    insert into public.platform_subscription_plans(
      name, description, monthly_price, annual_price, monthly_compare_at_price, annual_compare_at_price,
      monthly_duration_days, annual_duration_days, trial_days, student_limit, staff_limit, branch_limit,
      features, is_recommended, is_available, available_from, available_until
    ) values (
      v_name, nullif(btrim(p_description), ''), p_monthly_price, p_annual_price,
      p_monthly_compare_at_price, p_annual_compare_at_price, p_monthly_duration_days,
      p_annual_duration_days, 0, p_student_limit, p_staff_limit, p_branch_limit,
      p_features, p_is_recommended, p_is_available, p_available_from, p_available_until
    ) returning id into v_plan_id;
  else
    select name into v_old_name from public.platform_subscription_plans where id = p_plan_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Plan was not found'; end if;
    update public.platform_subscription_plans set
      name = v_name, description = nullif(btrim(p_description), ''),
      monthly_price = p_monthly_price, annual_price = p_annual_price,
      monthly_compare_at_price = p_monthly_compare_at_price, annual_compare_at_price = p_annual_compare_at_price,
      monthly_duration_days = p_monthly_duration_days, annual_duration_days = p_annual_duration_days,
      student_limit = p_student_limit, staff_limit = p_staff_limit, branch_limit = p_branch_limit,
      features = p_features, is_recommended = p_is_recommended,
      is_available = p_is_available, available_from = p_available_from, available_until = p_available_until
    where id = p_plan_id returning id into v_plan_id;
  end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_actor, case when p_plan_id is null then 'subscription_plan_created' else 'subscription_plan_updated' end,
    'subscription_plan', v_plan_id::text,
    jsonb_build_object('name', v_name, 'monthly_price', p_monthly_price, 'annual_price', p_annual_price,
      'is_available', p_is_available, 'is_recommended', p_is_recommended,
      'student_limit', p_student_limit, 'staff_limit', p_staff_limit, 'branch_limit', p_branch_limit));
  return v_plan_id;
end;
$$;
revoke all on function public.save_platform_subscription_plan_details(uuid,text,text,numeric,numeric,numeric,numeric,date,date,integer,integer,integer,integer,integer,jsonb,boolean,boolean) from public, anon;
grant execute on function public.save_platform_subscription_plan_details(uuid,text,text,numeric,numeric,numeric,numeric,date,date,integer,integer,integer,integer,integer,jsonb,boolean,boolean) to authenticated;

create or replace function public.delete_platform_subscription_plan(p_plan_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_name text;
begin
  if auth.role() is distinct from 'authenticated' or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  select name into v_name from public.platform_subscription_plans where id = p_plan_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Plan was not found'; end if;
  if exists (select 1 from public.institute_subscriptions where plan_id = p_plan_id or pending_plan_id = p_plan_id)
     or exists (select 1 from public.platform_trial_grants where plan_id = p_plan_id)
     or exists (select 1 from public.platform_subscription_settings where trial_plan_id = p_plan_id) then
    raise exception using errcode = '23503', message = 'Plan has subscription or trial history; deactivate it instead of deleting';
  end if;
  delete from public.platform_subscription_plans where id = p_plan_id;
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_actor, 'subscription_plan_deleted', 'subscription_plan', p_plan_id::text, jsonb_build_object('name', v_name));
end;
$$;
revoke all on function public.delete_platform_subscription_plan(uuid) from public, anon;
grant execute on function public.delete_platform_subscription_plan(uuid) to authenticated;

create or replace function public.get_platform_subscription_trial_config()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not bizbook_private.has_platform_role(array['owner','operator']::text[]) then
    raise exception using errcode = '42501', message = 'Platform administration access is required';
  end if;
  select jsonb_build_object('enabled', s.trial_enabled, 'duration_days', s.trial_duration_days,
    'plan_id', s.trial_plan_id, 'for_new_accounts', s.trial_for_new_accounts,
    'updated_at', s.updated_at,
    'plan_name', p.name, 'plan_features', p.features,
    'student_limit', p.student_limit, 'staff_limit', p.staff_limit, 'branch_limit', p.branch_limit)
    into v_result from public.platform_subscription_settings s
    left join public.platform_subscription_plans p on p.id = s.trial_plan_id
    where s.singleton;
  return coalesce(v_result, jsonb_build_object('enabled', false, 'duration_days', 14, 'plan_id', null, 'for_new_accounts', true));
end;
$$;
revoke all on function public.get_platform_subscription_trial_config() from public, anon;
grant execute on function public.get_platform_subscription_trial_config() to authenticated;

create or replace function public.save_platform_subscription_trial_config(
  p_enabled boolean, p_duration_days integer, p_plan_id uuid, p_for_new_accounts boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_plan_name text; v_result jsonb;
begin
  if auth.role() is distinct from 'authenticated' or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_enabled is null or p_for_new_accounts is null or p_duration_days is null or p_duration_days not between 1 and 365 then
    raise exception using errcode = '22023', message = 'Trial configuration is invalid';
  end if;
  if p_enabled then
    select name into v_plan_name from public.platform_subscription_plans
      where id = p_plan_id and is_available and monthly_price > 0 and annual_price > 0 for share;
    if not found then raise exception using errcode = '22023', message = 'Choose an available priced plan for trial access'; end if;
  end if;
  insert into public.platform_subscription_settings(singleton, trial_enabled, trial_duration_days, trial_plan_id, trial_for_new_accounts, updated_by, updated_at)
    values (true, p_enabled, p_duration_days, case when p_enabled then p_plan_id else null end, p_for_new_accounts, v_actor, now())
  on conflict (singleton) do update set trial_enabled = excluded.trial_enabled,
    trial_duration_days = excluded.trial_duration_days, trial_plan_id = excluded.trial_plan_id,
    trial_for_new_accounts = excluded.trial_for_new_accounts, updated_by = excluded.updated_by, updated_at = now();
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, 'subscription_trial_configuration_updated', 'subscription_settings', 'singleton',
      jsonb_build_object('enabled', p_enabled, 'duration_days', p_duration_days, 'plan_id', p_plan_id,
                         'plan_name', v_plan_name, 'for_new_accounts', p_for_new_accounts));
  select public.get_platform_subscription_trial_config() into v_result;
  return v_result;
end;
$$;
revoke all on function public.save_platform_subscription_trial_config(boolean,integer,uuid,boolean) from public, anon;
grant execute on function public.save_platform_subscription_trial_config(boolean,integer,uuid,boolean) to authenticated;

create or replace function public.create_coaching_institute_with_configured_trial(p_business_name text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_institute text; v_setting public.platform_subscription_settings%rowtype;
  v_plan public.platform_subscription_plans%rowtype; v_now timestamptz := statement_timestamp(); v_end timestamptz;
begin
  if v_user is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '28000', message = 'Authenticated account is required';
  end if;
  if p_business_name is null or length(btrim(p_business_name)) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Institute name must contain 1 to 100 characters';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 1));
  v_institute := public.create_coaching_institute(p_business_name);
  select * into v_setting from public.platform_subscription_settings where singleton for share;
  if not found or not v_setting.trial_enabled or not v_setting.trial_for_new_accounts then return v_institute; end if;
  if exists (select 1 from public.platform_trial_grants where user_id = v_user)
     or exists (select 1 from public.user_memberships m where m.user_id = v_user and m.institute_id <> v_institute and m.is_active) then
    return v_institute;
  end if;
  select * into v_plan from public.platform_subscription_plans
    where id = v_setting.trial_plan_id and is_available and monthly_price > 0 and annual_price > 0 for share;
  if not found then return v_institute; end if;
  v_end := v_now + make_interval(days => v_setting.trial_duration_days);
  insert into public.institute_subscriptions(institute_id, plan_id, status, billing_cycle, trial_ends_at, current_period_start, current_period_end)
    values (v_institute, v_plan.id, 'trialing', 'monthly', v_end, v_now, v_end);
  insert into public.platform_trial_grants(user_id, institute_id, plan_id, started_at, ends_at, duration_days)
    values (v_user, v_institute, v_plan.id, v_now, v_end, v_setting.trial_duration_days);
  insert into public.platform_subscription_events(institute_id, actor_user_id, event_type, details)
    values (v_institute, v_user, 'subscription_trial_started',
      jsonb_build_object('plan_id', v_plan.id, 'plan_name', v_plan.name, 'duration_days', v_setting.trial_duration_days,
                         'trial_ends_at', v_end, 'source', 'company_trial_configuration'));
  return v_institute;
end;
$$;
revoke all on function public.create_coaching_institute_with_configured_trial(text) from public, anon;
grant execute on function public.create_coaching_institute_with_configured_trial(text) to authenticated;

create or replace function public.start_subscription_plan_purchase(p_institute_id text, p_plan_id uuid, p_billing_cycle text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_sub public.institute_subscriptions%rowtype; v_plan public.platform_subscription_plans%rowtype;
  v_price numeric(12,2); v_days integer; v_start timestamptz; v_end timestamptz;
  v_invoice_id uuid; v_invoice_number text; v_existing public.platform_subscription_invoices%rowtype;
  v_today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date; v_now timestamptz := statement_timestamp();
begin
  if v_user is null or auth.role() is distinct from 'authenticated'
     or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception using errcode = '42501', message = 'Institute owner or administrator access is required';
  end if;
  if p_billing_cycle not in ('monthly','annual') then raise exception using errcode = '22023', message = 'Billing cycle is invalid'; end if;
  select * into v_plan from public.platform_subscription_plans
    where id = p_plan_id and is_available and monthly_price > 0 and annual_price > 0
      and (available_from is null or available_from <= v_today)
      and (available_until is null or available_until >= v_today) for share;
  if not found then raise exception using errcode = 'P0002', message = 'This plan is not currently available'; end if;
  v_price := case p_billing_cycle when 'annual' then v_plan.annual_price else v_plan.monthly_price end;
  v_days := case p_billing_cycle when 'annual' then v_plan.annual_duration_days else v_plan.monthly_duration_days end;
  select * into v_sub from public.institute_subscriptions where institute_id = p_institute_id for update;
  if found then
    if v_sub.status = 'suspended' then raise exception using errcode = '23514', message = 'Suspended subscriptions require Company Admin review'; end if;
    select * into v_existing from public.platform_subscription_invoices
      where institute_id = p_institute_id and subscription_id = v_sub.id and status in ('open','past_due')
      order by created_at desc limit 1 for update;
    if found then
      if v_existing.amount = v_price and v_sub.pending_plan_id = p_plan_id and v_sub.pending_billing_cycle = p_billing_cycle then
        return jsonb_build_object('invoice_id', v_existing.id, 'invoice_number', v_existing.invoice_number,
          'amount', v_existing.amount, 'status', v_existing.status, 'reused', true);
      end if;
      raise exception using errcode = '55000', message = 'An unpaid invoice already exists. Pay or resolve it before choosing another plan';
    end if;
    v_start := greatest(v_now, coalesce(v_sub.current_period_end, v_now), coalesce(v_sub.trial_ends_at, v_now));
    update public.institute_subscriptions set pending_plan_id = p_plan_id, pending_billing_cycle = p_billing_cycle where id = v_sub.id;
  else
    v_start := v_now;
    insert into public.institute_subscriptions(institute_id, plan_id, status, billing_cycle, pending_plan_id, pending_billing_cycle)
      values (p_institute_id, p_plan_id, 'past_due', p_billing_cycle, p_plan_id, p_billing_cycle)
      returning * into v_sub;
  end if;
  v_end := v_start + make_interval(days => v_days);
  v_invoice_number := 'BBI-' || to_char(v_now at time zone 'UTC', 'YYYYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 8));
  insert into public.platform_subscription_invoices(institute_id, subscription_id, invoice_number, billing_period_start,
      billing_period_end, amount, currency, status, due_at)
    values (p_institute_id, v_sub.id, v_invoice_number, v_start, v_end, v_price, 'INR', 'open', v_now + interval '7 days')
    returning id into v_invoice_id;
  insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type, details)
    values (p_institute_id, v_sub.id, v_user, 'subscription_plan_purchase_requested',
      jsonb_build_object('invoice_id', v_invoice_id, 'plan_id', p_plan_id, 'billing_cycle', p_billing_cycle,
                         'amount', v_price, 'duration_days', v_days));
  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
    'amount', v_price, 'status', 'open', 'reused', false, 'duration_days', v_days);
end;
$$;
revoke all on function public.start_subscription_plan_purchase(text,uuid,text) from public, anon;
grant execute on function public.start_subscription_plan_purchase(text,uuid,text) to authenticated;

create or replace function public.assign_platform_subscription_with_reason(
  p_institute_id text, p_plan_id uuid, p_status text, p_billing_cycle text,
  p_trial_ends_at timestamptz, p_period_start timestamptz,
  p_period_end timestamptz, p_grace_period_ends_at timestamptz, p_reason text
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_id uuid; v_old public.institute_subscriptions%rowtype; v_new boolean; v_available boolean;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.role() is distinct from 'authenticated' or not bizbook_private.has_platform_role(array['owner','operator']::text[]) then
    raise exception using errcode = '42501', message = 'Platform operator access is required';
  end if;
  if v_reason !~ '[[:graph:]]' or length(v_reason) > 1000
     or p_status is null or p_status not in ('trialing','active','past_due','suspended','cancelled','expired')
     or p_billing_cycle is null or p_billing_cycle not in ('monthly','annual')
     or (p_period_start is not null and p_period_end is not null and p_period_end < p_period_start)
     or (p_status = 'trialing' and p_trial_ends_at is null) then
    raise exception using errcode = '22023', message = 'Subscription values and an audit reason are required';
  end if;
  if not exists (select 1 from public.coaching_institutes where id = p_institute_id) then
    raise exception using errcode = 'P0002', message = 'Institute was not found';
  end if;
  if p_plan_id is not null then
    select is_available into v_available from public.platform_subscription_plans where id = p_plan_id;
    if not found then raise exception using errcode = 'P0002', message = 'Plan was not found'; end if;
    if not v_available then raise exception using errcode = '22023', message = 'Unavailable plans cannot be newly assigned'; end if;
  end if;
  select * into v_old from public.institute_subscriptions where institute_id = p_institute_id for update;
  v_new := not found;
  insert into public.institute_subscriptions(institute_id, plan_id, status, billing_cycle, trial_ends_at,
      current_period_start, current_period_end, grace_period_ends_at, pending_plan_id, pending_billing_cycle)
    values (p_institute_id, p_plan_id, p_status, p_billing_cycle, p_trial_ends_at,
      p_period_start, p_period_end, p_grace_period_ends_at, null, null)
    on conflict (institute_id) do update set plan_id = excluded.plan_id, status = excluded.status,
      billing_cycle = excluded.billing_cycle, trial_ends_at = excluded.trial_ends_at,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
      grace_period_ends_at = excluded.grace_period_ends_at, pending_plan_id = null, pending_billing_cycle = null
    returning id into v_id;
  insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type, reason, details)
    values (p_institute_id, v_id, v_actor, case when v_new then 'subscription_assigned' else 'subscription_updated' end,
      v_reason, jsonb_build_object('previous_plan_id', case when v_new then null else v_old.plan_id end,
        'plan_id', p_plan_id, 'previous_status', case when v_new then null else v_old.status end,
        'status', p_status, 'billing_cycle', p_billing_cycle, 'trial_ends_at', p_trial_ends_at,
        'period_start', p_period_start, 'period_end', p_period_end));
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, case when v_new then 'subscription_assigned' else 'subscription_updated' end,
      'institute_subscription', v_id::text, jsonb_build_object('institute_id', p_institute_id,
        'plan_id', p_plan_id, 'status', p_status, 'reason', v_reason));
  return v_id;
end;
$$;
revoke all on function public.assign_platform_subscription_with_reason(text,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text) from public, anon;
grant execute on function public.assign_platform_subscription_with_reason(text,uuid,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text) to authenticated;

-- The existing trusted payment finalizer changes a subscription to active only
-- after provider capture. This trigger then applies the requested plan atomically.
create or replace function bizbook_private.apply_paid_pending_subscription_plan()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status = 'active' and new.pending_plan_id is not null then
    new.plan_id := new.pending_plan_id;
    new.billing_cycle := coalesce(new.pending_billing_cycle, new.billing_cycle);
    new.pending_plan_id := null;
    new.pending_billing_cycle := null;
    new.trial_ends_at := null;
  end if;
  return new;
end;
$$;
revoke all on function bizbook_private.apply_paid_pending_subscription_plan() from public, anon, authenticated;
create trigger apply_paid_pending_subscription_plan
  before update of status on public.institute_subscriptions
  for each row execute function bizbook_private.apply_paid_pending_subscription_plan();

create or replace function public.get_public_subscription_plans()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description,
    'monthly_price', p.monthly_price, 'annual_price', p.annual_price,
    'monthly_compare_at_price', p.monthly_compare_at_price, 'annual_compare_at_price', p.annual_compare_at_price,
    'available_from', p.available_from, 'available_until', p.available_until,
    'monthly_duration_days', p.monthly_duration_days, 'annual_duration_days', p.annual_duration_days,
    'features', p.features, 'student_limit', p.student_limit, 'staff_limit', p.staff_limit,
    'branch_limit', p.branch_limit, 'is_recommended', p.is_recommended,
    'can_purchase', (p.available_from is null or p.available_from <= (statement_timestamp() at time zone 'Asia/Kolkata')::date)
      and (p.available_until is null or p.available_until >= (statement_timestamp() at time zone 'Asia/Kolkata')::date),
    'availability_status', case
      when p.available_from is not null and p.available_from > (statement_timestamp() at time zone 'Asia/Kolkata')::date then 'upcoming'
      when p.available_until is not null and p.available_until < (statement_timestamp() at time zone 'Asia/Kolkata')::date then 'expired'
      else 'available' end
  ) order by p.is_recommended desc, p.created_at, p.name), '[]'::jsonb)
  from public.platform_subscription_plans p
  where p.is_available and p.monthly_price > 0 and p.annual_price > 0;
$$;
revoke all on function public.get_public_subscription_plans() from public;
grant execute on function public.get_public_subscription_plans() to anon, authenticated;

create or replace function public.list_workspace_updates(p_institute_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_user uuid := auth.uid(); v_subscription jsonb := null; v_notifications jsonb := '[]'::jsonb;
begin
  if v_user is null or auth.role() is distinct from 'authenticated'
     or not exists (select 1 from public.user_memberships m where m.institute_id = p_institute_id and m.user_id = v_user and m.is_active) then
    raise exception using errcode = '42501', message = 'Active institute membership is required';
  end if;
  select jsonb_build_object('plan_name', p.name, 'status', s.status, 'billing_cycle', s.billing_cycle,
    'trial_ends_at', s.trial_ends_at, 'current_period_start', s.current_period_start,
    'current_period_end', s.current_period_end, 'grace_period_ends_at', s.grace_period_ends_at,
    'pending_plan_name', pp.name, 'pending_billing_cycle', s.pending_billing_cycle)
    into v_subscription from public.institute_subscriptions s
    left join public.platform_subscription_plans p on p.id = s.plan_id
    left join public.platform_subscription_plans pp on pp.id = s.pending_plan_id
    where s.institute_id = p_institute_id;
  with update_items as (
    select 'announcement:' || a.id::text || ':' || floor(extract(epoch from a.published_at) * 1000)::bigint::text as notification_key,
      'announcement'::text as kind, a.title, a.body as message, a.published_at as created_at
      from public.platform_announcements a where a.is_published and a.published_at is not null
    union all
    select 'subscription:' || e.id::text, 'subscription'::text,
      initcap(replace(e.event_type, '_', ' ')),
      case when e.event_type = 'subscription_trial_started' then 'Your free trial has started.'
        when e.event_type = 'subscription_payment_paid' then 'Payment verified. Your subscription is active.'
        when e.event_type = 'subscription_invoice_requested' or e.event_type = 'subscription_plan_purchase_requested' then 'A plan invoice is ready in Subscription & Invoices.'
        else coalesce(nullif(e.reason, ''), nullif(e.details->>'subscription_status', ''), nullif(e.details->>'status', ''), 'Your subscription details have been updated.') end,
      e.created_at from public.platform_subscription_events e where e.institute_id = p_institute_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', u.notification_key, 'kind', u.kind, 'title', u.title,
    'message', u.message, 'created_at', u.created_at, 'is_read', r.notification_key is not null) order by u.created_at desc), '[]'::jsonb)
    into v_notifications from (select * from update_items order by created_at desc limit 30) u
    left join public.platform_notification_reads r on r.user_id = v_user and r.institute_id = p_institute_id and r.notification_key = u.notification_key;
  return jsonb_build_object('subscription', v_subscription, 'notifications', v_notifications);
end;
$$;
revoke all on function public.list_workspace_updates(text) from public, anon;
grant execute on function public.list_workspace_updates(text) to authenticated;
