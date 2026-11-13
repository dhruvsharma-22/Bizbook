-- Additive Platform Admin operations. Existing business rows and financial records are not changed.
-- There is deliberately no browser bootstrap and no automatic billing suspension policy here.

alter table public.coaching_institutes
  add column account_status text not null default 'active'
    check (account_status in ('active', 'suspended')),
  add column suspension_reason text,
  add column suspended_at timestamptz,
  add column suspended_by uuid references auth.users(id) on delete set null;

create index coaching_institutes_account_status_created_idx
  on public.coaching_institutes (account_status, created_at desc);

-- The app's session guard calls Supabase RPC in the exposed public schema.
create or replace function public.is_platform_administrator()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select bizbook_private.is_platform_administrator();
$$;
revoke all on function public.is_platform_administrator() from public, anon;
grant execute on function public.is_platform_administrator() to authenticated;

create or replace function bizbook_private.has_platform_role(p_roles text[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.platform_administrators pa
    where pa.user_id = (select auth.uid()) and pa.role = any (p_roles)
  );
$$;
revoke all on function bizbook_private.has_platform_role(text[]) from public, anon;
grant execute on function bizbook_private.has_platform_role(text[]) to authenticated;

-- First administrator provisioning is callable only with a server-side service-role JWT.
-- Serialize concurrent calls and refuse to replace or bypass an existing administrator set.
create or replace function public.provision_first_platform_owner(p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception using errcode = '22023', message = 'The verified Auth user does not exist';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bizbook:first-platform-owner', 0));
  if exists (select 1 from public.platform_administrators) then
    raise exception using errcode = '23505', message = 'Platform administrator provisioning is already initialized';
  end if;
  insert into public.platform_administrators(user_id, role, granted_by)
  values (p_user_id, 'owner', null);
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (null, 'first_owner_provisioned', 'platform_administrator', p_user_id::text,
          jsonb_build_object('method', 'trusted_service_role'));
end;
$$;
revoke all on function public.provision_first_platform_owner(uuid) from public, anon, authenticated;
grant execute on function public.provision_first_platform_owner(uuid) to service_role;

create or replace function public.set_platform_admin_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_old_role text;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_role is null or p_role not in ('owner', 'operator', 'support') then
    raise exception using errcode = '22023', message = 'Unsupported platform administrator role';
  end if;
  select role into v_old_role from public.platform_administrators where user_id = p_user_id for update;
  if not found then
    if not exists (select 1 from auth.users where id = p_user_id) then
      raise exception using errcode = 'P0002', message = 'The verified Auth user does not exist';
    end if;
    insert into public.platform_administrators(user_id, role, granted_by)
    values (p_user_id, p_role, v_actor);
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, 'platform_admin_added', 'platform_administrator', p_user_id::text,
            jsonb_build_object('to', p_role));
    return;
  end if;
  if v_old_role = 'owner' and p_role <> 'owner'
     and (select count(*) from public.platform_administrators where role = 'owner') <= 1 then
    raise exception using errcode = '23514', message = 'The last platform owner cannot be demoted';
  end if;
  if v_old_role is distinct from p_role then
    update public.platform_administrators set role = p_role, granted_by = v_actor where user_id = p_user_id;
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, 'platform_admin_role_changed', 'platform_administrator', p_user_id::text,
            jsonb_build_object('from', v_old_role, 'to', p_role));
  end if;
end;
$$;

create or replace function public.remove_platform_admin(p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_old_role text;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  select role into v_old_role from public.platform_administrators where user_id = p_user_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Platform administrator was not found'; end if;
  if v_old_role = 'owner'
     and (select count(*) from public.platform_administrators where role = 'owner') <= 1 then
    raise exception using errcode = '23514', message = 'The last platform owner cannot be removed';
  end if;
  delete from public.platform_administrators where user_id = p_user_id;
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_actor, 'platform_admin_removed', 'platform_administrator', p_user_id::text,
          jsonb_build_object('previous_role', v_old_role));
end;
$$;

create or replace function public.set_platform_institute_status(
  p_institute_id text, p_status text, p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_old_status text; v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner', 'operator']::text[]) then
    raise exception using errcode = '42501', message = 'Platform operator access is required';
  end if;
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception using errcode = '22023', message = 'Unsupported institute status';
  end if;
  if p_status = 'suspended' and (v_reason is null or length(v_reason) > 1000) then
    raise exception using errcode = '22023', message = 'A suspension reason of at most 1000 characters is required';
  end if;
  select account_status into v_old_status from public.coaching_institutes where id = p_institute_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Institute was not found'; end if;
  if v_old_status is distinct from p_status then
    update public.coaching_institutes
       set account_status = p_status,
           suspension_reason = case when p_status = 'suspended' then v_reason else null end,
           suspended_at = case when p_status = 'suspended' then now() else null end,
           suspended_by = case when p_status = 'suspended' then v_actor else null end
     where id = p_institute_id;
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, case when p_status = 'suspended' then 'institute_suspended' else 'institute_reactivated' end,
            'coaching_institute', p_institute_id,
            jsonb_build_object('from', v_old_status, 'to', p_status, 'reason', v_reason));
  end if;
  return jsonb_build_object('institute_id', p_institute_id, 'account_status', p_status);
end;
$$;

create or replace function public.save_platform_subscription_plan(
  p_plan_id uuid, p_name text, p_description text, p_monthly_price numeric,
  p_annual_price numeric, p_trial_days integer, p_student_limit integer,
  p_staff_limit integer, p_branch_limit integer, p_features jsonb, p_is_available boolean
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_id uuid := coalesce(p_plan_id, gen_random_uuid());
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 100
     or p_monthly_price is null or p_monthly_price < 0 or p_monthly_price > 9999999999.99
     or p_annual_price is null or p_annual_price < 0 or p_annual_price > 9999999999.99
     or p_trial_days is null or p_trial_days not between 0 and 365
     or (p_student_limit is not null and p_student_limit < 0)
     or (p_staff_limit is not null and p_staff_limit < 0)
     or (p_branch_limit is not null and p_branch_limit < 0)
     or jsonb_typeof(coalesce(p_features, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_features, '{}'::jsonb)::text) > 8192 then
    raise exception using errcode = '22023', message = 'Plan fields are invalid';
  end if;
  insert into public.platform_subscription_plans(
    id, name, description, monthly_price, annual_price, trial_days,
    student_limit, staff_limit, branch_limit, features, is_available
  ) values (
    v_id, btrim(p_name), nullif(btrim(p_description), ''), p_monthly_price, p_annual_price,
    p_trial_days, p_student_limit, p_staff_limit, p_branch_limit,
    coalesce(p_features, '{}'::jsonb), coalesce(p_is_available, false)
  ) on conflict (id) do update set
    name = excluded.name, description = excluded.description,
    monthly_price = excluded.monthly_price, annual_price = excluded.annual_price,
    trial_days = excluded.trial_days, student_limit = excluded.student_limit,
    staff_limit = excluded.staff_limit, branch_limit = excluded.branch_limit,
    features = excluded.features, is_available = excluded.is_available;
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_actor, case when p_plan_id is null then 'subscription_plan_created' else 'subscription_plan_updated' end,
          'subscription_plan', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'is_available', coalesce(p_is_available, false)));
  return v_id;
end;
$$;

create or replace function public.assign_platform_subscription(
  p_institute_id text, p_plan_id uuid, p_status text, p_billing_cycle text,
  p_trial_ends_at timestamptz, p_period_start timestamptz,
  p_period_end timestamptz, p_grace_period_ends_at timestamptz
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_id uuid; v_old public.institute_subscriptions%rowtype;
  v_is_new boolean; v_plan_available boolean;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner', 'operator']::text[]) then
    raise exception using errcode = '42501', message = 'Platform operator access is required';
  end if;
  if p_status is null or p_status not in ('trialing', 'active', 'past_due', 'suspended', 'cancelled', 'expired')
     or p_billing_cycle is null or p_billing_cycle not in ('monthly', 'annual')
     or (p_period_start is not null and p_period_end is not null and p_period_end < p_period_start) then
    raise exception using errcode = '22023', message = 'Subscription fields are invalid';
  end if;
  if not exists (select 1 from public.coaching_institutes where id = p_institute_id) then
    raise exception using errcode = 'P0002', message = 'Institute was not found';
  end if;
  if p_plan_id is not null then
    select is_available into v_plan_available from public.platform_subscription_plans where id = p_plan_id;
    if not found then raise exception using errcode = 'P0002', message = 'Subscription plan was not found'; end if;
    if not v_plan_available then raise exception using errcode = '22023', message = 'Unavailable plans cannot be newly assigned'; end if;
  end if;
  select * into v_old from public.institute_subscriptions where institute_id = p_institute_id for update;
  v_is_new := not found;
  insert into public.institute_subscriptions(
    institute_id, plan_id, status, billing_cycle, trial_ends_at,
    current_period_start, current_period_end, grace_period_ends_at
  ) values (
    p_institute_id, p_plan_id, p_status, p_billing_cycle, p_trial_ends_at,
    p_period_start, p_period_end, p_grace_period_ends_at
  ) on conflict (institute_id) do update set
    plan_id = excluded.plan_id, status = excluded.status, billing_cycle = excluded.billing_cycle,
    trial_ends_at = excluded.trial_ends_at, current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end, grace_period_ends_at = excluded.grace_period_ends_at
  returning id into v_id;
  insert into public.platform_subscription_events(
    institute_id, subscription_id, actor_user_id, event_type, reason, details
  ) values (
    p_institute_id, v_id, v_actor, case when v_is_new then 'subscription_assigned' else 'subscription_updated' end,
    null, jsonb_build_object(
      'previous_plan_id', case when v_is_new then null else v_old.plan_id end,
      'plan_id', p_plan_id,
      'previous_status', case when v_is_new then null else v_old.status end,
      'status', p_status,
      'billing_cycle', p_billing_cycle
    )
  );
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_actor, case when v_is_new then 'subscription_assigned' else 'subscription_updated' end,
          'institute_subscription', v_id::text,
          jsonb_build_object('institute_id', p_institute_id, 'plan_id', p_plan_id, 'status', p_status));
  return v_id;
end;
$$;

create or replace function public.issue_platform_subscription_invoice(
  p_institute_id text, p_invoice_number text,
  p_period_start timestamptz, p_period_end timestamptz, p_due_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_sub public.institute_subscriptions%rowtype;
  v_price numeric(12,2); v_invoice_id uuid; v_created boolean := false; v_existing public.platform_subscription_invoices%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner', 'operator']::text[]) then
    raise exception using errcode = '42501', message = 'Platform operator access is required';
  end if;
  if p_invoice_number is null or length(btrim(p_invoice_number)) not between 1 and 64
     or p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception using errcode = '22023', message = 'Invoice fields are invalid';
  end if;
  select * into v_sub from public.institute_subscriptions
   where institute_id = p_institute_id for update;
  if not found or v_sub.plan_id is null or v_sub.status not in ('active', 'trialing', 'past_due') then
    raise exception using errcode = '23514', message = 'An active subscription with a plan is required to issue an invoice';
  end if;
  select case v_sub.billing_cycle when 'annual' then annual_price else monthly_price end
    into v_price from public.platform_subscription_plans where id = v_sub.plan_id;
  if v_price is null then raise exception using errcode = '23514', message = 'The assigned plan is unavailable'; end if;
  insert into public.platform_subscription_invoices(
    institute_id, subscription_id, invoice_number, billing_period_start,
    billing_period_end, amount, currency, status, due_at
  ) values (
    p_institute_id, v_sub.id, btrim(p_invoice_number), p_period_start,
    p_period_end, v_price, 'INR', 'open', p_due_at
  ) on conflict (invoice_number) do nothing returning id into v_invoice_id;
  if v_invoice_id is null then
    select * into v_existing from public.platform_subscription_invoices
     where invoice_number = btrim(p_invoice_number) for update;
    if v_existing.institute_id <> p_institute_id
       or v_existing.subscription_id <> v_sub.id
       or v_existing.billing_period_start <> p_period_start
       or v_existing.billing_period_end <> p_period_end
       or v_existing.amount <> v_price then
      raise exception using errcode = '23505', message = 'Invoice number is already used for different invoice data';
    end if;
    v_invoice_id := v_existing.id;
  else
    v_created := true;
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, 'subscription_invoice_issued', 'subscription_invoice', v_invoice_id::text,
            jsonb_build_object('institute_id', p_institute_id, 'invoice_number', btrim(p_invoice_number),
                               'amount', v_price, 'currency', 'INR'));
  end if;
  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', btrim(p_invoice_number),
                            'amount', v_price, 'currency', 'INR', 'status', 'open', 'created', v_created);
end;
$$;

create or replace function public.platform_admin_overview(
  p_search text default null, p_limit integer default 100, p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_role text;
begin
  select role into v_role from public.platform_administrators where user_id = auth.uid();
  if auth.role() is distinct from 'authenticated' or v_role is null then
    raise exception using errcode = '42501', message = 'Platform administrator access is required';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0 or p_offset > 50000 then
    raise exception using errcode = '22023', message = 'Pagination values are invalid';
  end if;
  return jsonb_build_object(
    'current_role', v_role,
    'institute_total', (select count(*) from public.coaching_institutes i
      where nullif(btrim(p_search), '') is null
         or i.business_name ilike '%' || left(btrim(p_search), 100) || '%'
         or i.id ilike '%' || left(btrim(p_search), 100) || '%'
         or coalesce(i.email, '') ilike '%' || left(btrim(p_search), 100) || '%'),
    'institutes', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (
        select i.id, i.business_name, i.owner_name, i.email, i.phone, i.created_at,
               i.account_status, i.suspension_reason,
               (select count(*) from public.branches b where b.institute_id = i.id and b.is_active) as active_branches,
               (select count(*) from public.students s where s.institute_id = i.id and s.archived_at is null) as active_students,
               (select count(*) from public.staff st where st.institute_id = i.id and st.archived_at is null) as active_staff,
               sub.id as subscription_id, sub.status as subscription_status, sub.billing_cycle,
               sub.current_period_end, sub.grace_period_ends_at,
               plan.id as plan_id, plan.name as plan_name,
               plan.student_limit, plan.staff_limit, plan.branch_limit
        from public.coaching_institutes i
        left join public.institute_subscriptions sub on sub.institute_id = i.id
        left join public.platform_subscription_plans plan on plan.id = sub.plan_id
        where nullif(btrim(p_search), '') is null
           or i.business_name ilike '%' || left(btrim(p_search), 100) || '%'
           or i.id ilike '%' || left(btrim(p_search), 100) || '%'
           or coalesce(i.email, '') ilike '%' || left(btrim(p_search), 100) || '%'
        order by i.created_at desc, i.id
        limit p_limit offset p_offset
      ) q
    ), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(to_jsonb(p) order by p.name) from public.platform_subscription_plans p), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.updated_at desc)
      from (select s.id, s.institute_id, i.business_name, s.plan_id, p.name as plan_name,
                   s.status, s.billing_cycle, s.trial_ends_at, s.current_period_start,
                   s.current_period_end, s.grace_period_ends_at, s.created_at, s.updated_at
            from public.institute_subscriptions s
            join public.coaching_institutes i on i.id = s.institute_id
            left join public.platform_subscription_plans p on p.id = s.plan_id
            order by s.updated_at desc limit 100) q
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (select inv.id, inv.institute_id, i.business_name, inv.subscription_id, inv.invoice_number,
                   inv.billing_period_start, inv.billing_period_end, inv.amount, inv.currency,
                   inv.status, inv.due_at, inv.paid_at, inv.created_at
            from public.platform_subscription_invoices inv
            join public.coaching_institutes i on i.id = inv.institute_id
            order by inv.created_at desc limit 100) q
    ), '[]'::jsonb),
    'payment_attempts', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (select a.id, a.invoice_id, inv.invoice_number, a.institute_id, i.business_name,
                   a.provider, a.provider_order_id, a.provider_payment_id, a.status,
                   a.verified_at, a.attempt_number, a.safe_error_code, a.created_at
            from public.platform_payment_attempts a
            join public.platform_subscription_invoices inv on inv.id = a.invoice_id
            join public.coaching_institutes i on i.id = a.institute_id
            order by a.created_at desc limit 100) q
    ), '[]'::jsonb),
    'administrators', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', user_id, 'role', role, 'granted_by', granted_by, 'created_at', created_at)
                       order by created_at)
      from public.platform_administrators
    ), '[]'::jsonb),
    'audit_events', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (select id, actor_user_id, action, target_type, target_id, details, created_at
            from public.platform_admin_audit_events order by created_at desc limit 100) q
    ), '[]'::jsonb),
    'subscription_events', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.created_at desc)
      from (select e.id, e.institute_id, i.business_name, e.subscription_id, e.actor_user_id,
                   e.event_type, e.reason, e.details, e.created_at
            from public.platform_subscription_events e
            join public.coaching_institutes i on i.id = e.institute_id
            order by e.created_at desc limit 100) q
    ), '[]'::jsonb)
  );
end;
$$;

-- Explicit institute suspension is enforced through all tenant membership/branch helpers.
-- Subscription delinquency is not an automatic lockout; no billing policy was approved.
create or replace function bizbook_private.has_institute_access(p_institute_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and i.account_status = 'active'
  );
$$;

create or replace function bizbook_private.has_institute_role(p_institute_id text, p_roles text[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and m.role = any(p_roles) and i.account_status = 'active'
  );
$$;

create or replace function bizbook_private.can_access_branch(p_institute_id text, p_branch_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and i.account_status = 'active'
      and (p_branch_id is null or exists (
        select 1 from public.branches b where b.institute_id = p_institute_id
          and b.id = p_branch_id and b.is_active
      ))
      and (p_branch_id is null or m.access_scope = 'institute' or exists (
        select 1 from public.membership_branch_access mba where mba.institute_id = m.institute_id
          and mba.user_id = m.user_id and mba.branch_id = p_branch_id
      ))
  );
$$;

create or replace function bizbook_private.can_manage_institute(p_institute_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and m.access_scope = 'institute'
      and m.role in ('owner', 'administrator') and i.account_status = 'active'
  );
$$;

create or replace function bizbook_private.can_write_branch(p_institute_id text, p_branch_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = (select auth.uid())
      and m.is_active and i.account_status = 'active'
      and (p_branch_id is null or exists (
        select 1 from public.branches b where b.institute_id = p_institute_id
          and b.id = p_branch_id and b.is_active
      ))
      and (m.access_scope = 'institute' or (p_branch_id is not null and exists (
        select 1 from public.membership_branch_access mba where mba.institute_id = m.institute_id
          and mba.user_id = m.user_id and mba.branch_id = p_branch_id
      )))
  );
$$;

-- Quota checks serialize per subscription row. Existing data is preserved; a limit only
-- prevents future active records when an institute has an assigned plan with a finite cap.
create or replace function bizbook_private.enforce_student_plan_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_limit integer; v_count bigint;
begin
  if new.archived_at is not null or (tg_op = 'UPDATE' and old.archived_at is null) then return new; end if;
  select p.student_limit into v_limit
  from public.institute_subscriptions s join public.platform_subscription_plans p on p.id = s.plan_id
  where s.institute_id = new.institute_id for update of s;
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.students where institute_id = new.institute_id
    and archived_at is null and id <> new.id;
  if v_count >= v_limit then
    raise exception using errcode = '23514', message = 'The assigned plan student limit has been reached';
  end if;
  return new;
end;
$$;

create or replace function bizbook_private.enforce_staff_plan_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_limit integer; v_count bigint;
begin
  if new.archived_at is not null or (tg_op = 'UPDATE' and old.archived_at is null) then return new; end if;
  select p.staff_limit into v_limit
  from public.institute_subscriptions s join public.platform_subscription_plans p on p.id = s.plan_id
  where s.institute_id = new.institute_id for update of s;
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.staff where institute_id = new.institute_id
    and archived_at is null and id <> new.id;
  if v_count >= v_limit then
    raise exception using errcode = '23514', message = 'The assigned plan staff limit has been reached';
  end if;
  return new;
end;
$$;

create or replace function bizbook_private.enforce_branch_plan_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_limit integer; v_count bigint;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active) then return new; end if;
  select p.branch_limit into v_limit
  from public.institute_subscriptions s join public.platform_subscription_plans p on p.id = s.plan_id
  where s.institute_id = new.institute_id for update of s;
  if v_limit is null then return new; end if;
  select count(*) into v_count from public.branches where institute_id = new.institute_id
    and is_active and id <> new.id;
  if v_count >= v_limit then
    raise exception using errcode = '23514', message = 'The assigned plan branch limit has been reached';
  end if;
  return new;
end;
$$;

create trigger students_plan_limit before insert or update of archived_at on public.students
  for each row execute function bizbook_private.enforce_student_plan_limit();
create trigger staff_plan_limit before insert or update of archived_at on public.staff
  for each row execute function bizbook_private.enforce_staff_plan_limit();
create trigger branches_plan_limit before insert or update of is_active on public.branches
  for each row execute function bizbook_private.enforce_branch_plan_limit();

-- Provider credential writes remain test-only and are restricted to platform owners.
create or replace function bizbook_private.guard_platform_provider_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not bizbook_private.has_platform_role(array['owner']::text[]) then
    raise exception using errcode = '42501', message = 'Platform owner access is required to change provider settings';
  end if;
  return new;
end;
$$;
create trigger platform_provider_connections_owner_write
  before insert or update or delete on public.platform_provider_connections
  for each row execute function bizbook_private.guard_platform_provider_write();

revoke all on function public.set_platform_admin_role(uuid, text) from public, anon;
revoke all on function public.remove_platform_admin(uuid) from public, anon;
revoke all on function public.set_platform_institute_status(text, text, text) from public, anon;
revoke all on function public.save_platform_subscription_plan(uuid, text, text, numeric, numeric, integer, integer, integer, integer, jsonb, boolean) from public, anon;
revoke all on function public.assign_platform_subscription(text, uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon;
revoke all on function public.issue_platform_subscription_invoice(text, text, timestamptz, timestamptz, timestamptz) from public, anon;
revoke all on function public.platform_admin_overview(text, integer, integer) from public, anon;
grant execute on function public.set_platform_admin_role(uuid, text) to authenticated;
grant execute on function public.remove_platform_admin(uuid) to authenticated;
grant execute on function public.set_platform_institute_status(text, text, text) to authenticated;
grant execute on function public.save_platform_subscription_plan(uuid, text, text, numeric, numeric, integer, integer, integer, integer, jsonb, boolean) to authenticated;
grant execute on function public.assign_platform_subscription(text, uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.issue_platform_subscription_invoice(text, text, timestamptz, timestamptz, timestamptz) to authenticated;
grant execute on function public.platform_admin_overview(text, integer, integer) to authenticated;

comment on column public.coaching_institutes.account_status is
  'Explicit platform-level access switch. Subscription payment status does not auto-suspend an institute without an approved billing policy.';
