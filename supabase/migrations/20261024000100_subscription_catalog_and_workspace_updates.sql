-- Public plan catalog, new institute subscription onboarding, and durable workspace updates.

alter table public.platform_subscription_plans
  add column if not exists monthly_compare_at_price numeric(12,2),
  add column if not exists annual_compare_at_price numeric(12,2);

comment on column public.platform_subscription_plans.monthly_compare_at_price is
  'Optional reference price displayed crossed out when it exceeds the actual monthly price.';
comment on column public.platform_subscription_plans.annual_compare_at_price is
  'Optional reference price displayed crossed out when it exceeds the actual annual price.';

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
    'trial_days', p.trial_days,
    'student_limit', p.student_limit,
    'staff_limit', p.staff_limit,
    'branch_limit', p.branch_limit,
    'features', p.features
  ) order by p.monthly_price, p.name), '[]'::jsonb)
  from public.platform_subscription_plans p
  where p.is_available;
$$;
revoke all on function public.get_public_subscription_plans() from public;
grant execute on function public.get_public_subscription_plans() to anon, authenticated;

create or replace function public.save_platform_subscription_plan_with_markdown(
  p_plan_id uuid, p_name text, p_description text, p_monthly_price numeric,
  p_annual_price numeric, p_monthly_compare_at_price numeric,
  p_annual_compare_at_price numeric, p_trial_days integer,
  p_student_limit integer, p_staff_limit integer, p_branch_limit integer,
  p_features jsonb, p_is_available boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if (p_monthly_compare_at_price is not null and
      (p_monthly_compare_at_price < p_monthly_price or p_monthly_compare_at_price > 9999999999.99))
     or (p_annual_compare_at_price is not null and
      (p_annual_compare_at_price < p_annual_price or p_annual_compare_at_price > 9999999999.99)) then
    raise exception using errcode = '22023', message = 'Reference prices must be at least the plan price';
  end if;

  v_id := public.save_platform_subscription_plan(
    p_plan_id, p_name, p_description, p_monthly_price, p_annual_price,
    p_trial_days, p_student_limit, p_staff_limit, p_branch_limit,
    p_features, p_is_available
  );
  update public.platform_subscription_plans
     set monthly_compare_at_price = p_monthly_compare_at_price,
         annual_compare_at_price = p_annual_compare_at_price
   where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.save_platform_subscription_plan_with_markdown(
  uuid, text, text, numeric, numeric, numeric, numeric, integer,
  integer, integer, integer, jsonb, boolean
) from public, anon;
grant execute on function public.save_platform_subscription_plan_with_markdown(
  uuid, text, text, numeric, numeric, numeric, numeric, integer,
  integer, integer, integer, jsonb, boolean
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
   where id = p_plan_id and is_available
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'The selected plan is no longer available';
  end if;

  v_price := case p_billing_cycle when 'annual' then v_plan.annual_price else v_plan.monthly_price end;
  if coalesce(p_start_trial, false) and v_plan.trial_days <= 0 then
    raise exception using errcode = '22023', message = 'This plan does not currently include a free trial';
  end if;

  -- The existing onboarding function creates the institute and owner membership in this transaction.
  v_institute_id := public.create_coaching_institute(p_business_name);
  if coalesce(p_start_trial, false) then
    v_status := 'trialing';
    v_trial_end := v_now + make_interval(days => v_plan.trial_days);
    v_period_end := v_trial_end;
  elsif v_price = 0 then
    v_status := 'active';
    v_period_end := null;
  else
    -- Keep paid access pending until the provider confirms invoice settlement.
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

create table public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 2000),
  is_published boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_published = (published_at is not null))
);
create index platform_announcements_published_idx
  on public.platform_announcements (published_at desc) where is_published;
alter table public.platform_announcements enable row level security;
create policy platform_announcements_select_admin
  on public.platform_announcements for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));
revoke all on public.platform_announcements from public, anon, authenticated;
grant select on public.platform_announcements to authenticated;
grant all on public.platform_announcements to service_role;

create table public.platform_notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  institute_id text not null references public.coaching_institutes(id) on delete cascade,
  notification_key text not null check (length(notification_key) between 1 and 180),
  read_at timestamptz not null default now(),
  primary key (user_id, institute_id, notification_key)
);
alter table public.platform_notification_reads enable row level security;
revoke all on public.platform_notification_reads from public, anon, authenticated;
grant all on public.platform_notification_reads to service_role;

create or replace function public.save_platform_announcement(
  p_announcement_id uuid, p_title text, p_body text, p_is_published boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid := coalesce(p_announcement_id, gen_random_uuid());
  v_exists boolean;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner', 'operator']::text[]) then
    raise exception using errcode = '42501', message = 'Platform operator access is required';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120
     or p_body is null or length(btrim(p_body)) not between 1 and 2000
     or p_is_published is null then
    raise exception using errcode = '22023', message = 'Announcement content is invalid';
  end if;

  select exists(select 1 from public.platform_announcements where id = v_id) into v_exists;
  insert into public.platform_announcements(
    id, title, body, is_published, published_at, created_by, updated_by
  ) values (
    v_id, btrim(p_title), btrim(p_body), p_is_published,
    case when p_is_published then clock_timestamp() else null end, v_actor, v_actor
  ) on conflict (id) do update set
    title = excluded.title,
    body = excluded.body,
    is_published = excluded.is_published,
    published_at = excluded.published_at,
    updated_by = excluded.updated_by,
    updated_at = now();

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_actor,
    case when not v_exists then 'platform_announcement_created' when p_is_published then 'platform_announcement_published' else 'platform_announcement_unpublished' end,
    'platform_announcement', v_id::text,
    jsonb_build_object('title', btrim(p_title), 'is_published', p_is_published));
  return v_id;
end;
$$;
revoke all on function public.save_platform_announcement(uuid, text, text, boolean) from public, anon;
grant execute on function public.save_platform_announcement(uuid, text, text, boolean) to authenticated;

create or replace function public.list_workspace_updates(p_institute_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_subscription jsonb := null;
  v_notifications jsonb := '[]'::jsonb;
begin
  if v_user is null or auth.role() is distinct from 'authenticated'
     or not exists (
       select 1 from public.user_memberships m
        where m.institute_id = p_institute_id and m.user_id = v_user and m.is_active
     ) then
    raise exception using errcode = '42501', message = 'Active institute membership is required';
  end if;

  select jsonb_build_object(
    'plan_name', p.name,
    'status', s.status,
    'billing_cycle', s.billing_cycle,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'plan_monthly_price', p.monthly_price,
    'plan_annual_price', p.annual_price
  ) into v_subscription
    from public.institute_subscriptions s
    left join public.platform_subscription_plans p on p.id = s.plan_id
   where s.institute_id = p_institute_id;

  with update_items as (
    select
      'announcement:' || a.id::text || ':' || floor(extract(epoch from a.published_at) * 1000)::bigint::text as notification_key,
      'announcement'::text as kind,
      a.title,
      a.body as message,
      a.published_at as created_at
    from public.platform_announcements a
    where a.is_published and a.published_at is not null
    union all
    select
      'subscription:' || e.id::text as notification_key,
      'subscription'::text as kind,
      initcap(replace(e.event_type, '_', ' ')) as title,
      case
        when e.event_type = 'subscription_assigned' then 'Your ' || coalesce(e.details->>'billing_cycle', 'selected') || ' plan is set to ' || coalesce(e.details->>'status', 'active') || '.'
        when e.event_type = 'subscription_updated' then 'Your plan or subscription status was updated to ' || coalesce(e.details->>'status', 'a new setting') || '.'
        when e.event_type = 'subscription_trial_started' then 'Your free trial has started.'
        when e.event_type = 'subscription_payment_paid' then 'Payment verified. Your subscription is active.'
        when e.event_type = 'subscription_invoice_requested' then 'A plan invoice is ready in Subscription & Invoices.'
        when e.event_type = 'subscription_activated_free' then 'Your free plan is active.'
        else coalesce(nullif(e.reason, ''), nullif(e.details->>'subscription_status', ''), nullif(e.details->>'status', ''), 'Your subscription details have been updated.')
      end as message,
      e.created_at
    from public.platform_subscription_events e
    where e.institute_id = p_institute_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', u.notification_key,
    'kind', u.kind,
    'title', u.title,
    'message', u.message,
    'created_at', u.created_at,
    'is_read', (r.notification_key is not null)
  ) order by u.created_at desc), '[]'::jsonb)
    into v_notifications
    from (
      select * from update_items order by created_at desc limit 30
    ) u
    left join public.platform_notification_reads r
      on r.user_id = v_user and r.institute_id = p_institute_id and r.notification_key = u.notification_key;

  return jsonb_build_object('subscription', v_subscription, 'notifications', v_notifications);
end;
$$;
revoke all on function public.list_workspace_updates(text) from public, anon;
grant execute on function public.list_workspace_updates(text) to authenticated;

create or replace function public.mark_workspace_updates_read(p_institute_id text, p_notification_keys text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_key text;
  v_parts text[];
  v_id uuid;
  v_version bigint;
  v_count integer := 0;
begin
  if v_user is null or auth.role() is distinct from 'authenticated'
     or not exists (
       select 1 from public.user_memberships m
        where m.institute_id = p_institute_id and m.user_id = v_user and m.is_active
     ) then
    raise exception using errcode = '42501', message = 'Active institute membership is required';
  end if;
  if coalesce(array_length(p_notification_keys, 1), 0) > 50 then
    raise exception using errcode = '22023', message = 'Too many notification keys';
  end if;

  foreach v_key in array coalesce(p_notification_keys, array[]::text[]) loop
    v_parts := string_to_array(v_key, ':');
    if array_length(v_parts, 1) = 3 and v_parts[1] = 'announcement'
       and v_parts[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       and v_parts[3] ~ '^[0-9]{1,16}$' then
      v_id := v_parts[2]::uuid;
      v_version := v_parts[3]::bigint;
      if exists (
        select 1 from public.platform_announcements a
         where a.id = v_id and a.is_published
           and floor(extract(epoch from a.published_at) * 1000)::bigint = v_version
      ) then
        insert into public.platform_notification_reads(user_id, institute_id, notification_key)
        values (v_user, p_institute_id, v_key) on conflict do nothing;
        v_count := v_count + 1;
      end if;
    elsif array_length(v_parts, 1) = 2 and v_parts[1] = 'subscription'
       and v_parts[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_id := v_parts[2]::uuid;
      if exists (
        select 1 from public.platform_subscription_events e
         where e.id = v_id and e.institute_id = p_institute_id
      ) then
        insert into public.platform_notification_reads(user_id, institute_id, notification_key)
        values (v_user, p_institute_id, v_key) on conflict do nothing;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.mark_workspace_updates_read(text, text[]) from public, anon;
grant execute on function public.mark_workspace_updates_read(text, text[]) to authenticated;

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
  v_end := v_start + case v_subscription.billing_cycle when 'annual' then interval '1 year' else interval '1 month' end;
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
          jsonb_build_object('invoice_id', v_invoice_id, 'amount', v_price, 'billing_cycle', v_subscription.billing_cycle));
  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_invoice_number,
                            'amount', v_price, 'status', 'open', 'reused', false);
end;
$$;
revoke all on function public.create_self_service_subscription_invoice(text) from public, anon;
grant execute on function public.create_self_service_subscription_invoice(text) to authenticated;

