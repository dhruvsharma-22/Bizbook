-- Company Admin may grant or revoke a subscription-fee waiver for one institute.
-- This is an access entitlement, never a payment or invoice settlement.
alter table public.institute_subscriptions
  add column free_access_enabled boolean not null default false;

create or replace function public.set_platform_institute_free_access(
  p_institute_id text, p_enabled boolean, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_subscription_id uuid;
  v_old_enabled boolean;
  v_previous_enabled boolean := false;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_platform_role(array['owner', 'operator']::text[]) then
    raise exception using errcode = '42501', message = 'Company Admin access is required';
  end if;
  if p_institute_id is null or length(btrim(p_institute_id)) not between 1 and 100
     or p_enabled is null or v_reason !~ '[[:graph:]]' or length(v_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Institute, access selection, and audit reason are required';
  end if;
  if not exists (select 1 from public.coaching_institutes where id = p_institute_id and account_status = 'active') then
    raise exception using errcode = 'P0002', message = 'Active institute was not found';
  end if;

  select id, free_access_enabled into v_subscription_id, v_old_enabled
    from public.institute_subscriptions where institute_id = p_institute_id for update;
  if not found then
    if not p_enabled then return null; end if;
    insert into public.institute_subscriptions(institute_id, status, billing_cycle, free_access_enabled)
      values (p_institute_id, 'expired', 'monthly', p_enabled)
      returning id, free_access_enabled into v_subscription_id, v_old_enabled;
  elsif v_old_enabled is distinct from p_enabled then
    v_previous_enabled := v_old_enabled;
    update public.institute_subscriptions set free_access_enabled = p_enabled
      where id = v_subscription_id;
  else
    return v_subscription_id;
  end if;

  insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type, reason, details)
    values (p_institute_id, v_subscription_id, v_actor,
      case when p_enabled then 'subscription_free_access_enabled' else 'subscription_free_access_disabled' end,
      v_reason, jsonb_build_object('free_access_enabled', p_enabled, 'previous_free_access_enabled', v_previous_enabled));
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_actor, case when p_enabled then 'subscription_free_access_enabled' else 'subscription_free_access_disabled' end,
      'institute_subscription', v_subscription_id::text,
      jsonb_build_object('institute_id', p_institute_id, 'free_access_enabled', p_enabled, 'reason', v_reason));
  return v_subscription_id;
end;
$$;
revoke all on function public.set_platform_institute_free_access(text, boolean, text) from public, anon;
grant execute on function public.set_platform_institute_free_access(text, boolean, text) to authenticated;

-- A successful paid checkout replaces the complimentary entitlement with a
-- time-bounded paid term, so the old override cannot outlive that term.
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
    new.free_access_enabled := false;
  end if;
  return new;
end;
$$;
revoke all on function bizbook_private.apply_paid_pending_subscription_plan() from public, anon, authenticated;

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
    'pending_plan_name', pp.name, 'pending_billing_cycle', s.pending_billing_cycle,
    'free_access_enabled', s.free_access_enabled)
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
        when e.event_type in ('subscription_invoice_requested', 'subscription_plan_purchase_requested') then 'A plan payment is ready in Plans & Subscription.'
        when e.event_type = 'subscription_free_access_enabled' then 'BizBook Company Admin enabled complimentary access for this institute.'
        when e.event_type = 'subscription_free_access_disabled' then 'Complimentary access was removed. Review your plan status in Subscription.'
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
