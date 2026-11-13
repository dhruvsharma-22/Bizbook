-- Support administrators can manage platform support tickets, but do not need
-- institute directory, billing, provider, or platform audit data.

create or replace function public.get_platform_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pa.role
  from public.platform_administrators pa
  where auth.role() = 'authenticated'
    and pa.user_id = (select auth.uid());
$$;
revoke all on function public.get_platform_admin_role() from public, anon;
grant execute on function public.get_platform_admin_role() to authenticated;

-- Keep the existing full overview RPC for trusted owner/operator composition,
-- but remove direct browser execution and expose a role-aware wrapper instead.
revoke all on function public.platform_admin_overview(text, integer, integer) from public, anon, authenticated;

create or replace function public.platform_admin_overview_safe(
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'Authenticated platform access is required';
  end if;
  select pa.role into v_role
  from public.platform_administrators pa
  where pa.user_id = (select auth.uid());
  if v_role is null then
    raise exception using errcode = '42501', message = 'Platform administrator access is required';
  end if;
  if v_role = 'support' then
    return jsonb_build_object(
      'current_role', v_role,
      'institute_total', 0,
      'institutes', '[]'::jsonb,
      'plans', '[]'::jsonb,
      'subscriptions', '[]'::jsonb,
      'invoices', '[]'::jsonb,
      'payment_attempts', '[]'::jsonb,
      'administrators', '[]'::jsonb,
      'audit_events', '[]'::jsonb,
      'subscription_events', '[]'::jsonb
    );
  end if;
  if v_role not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = 'Platform operations access is required';
  end if;
  return public.platform_admin_overview(p_search, p_limit, p_offset);
end;
$$;
revoke all on function public.platform_admin_overview_safe(text, integer, integer) from public, anon;
grant execute on function public.platform_admin_overview_safe(text, integer, integer) to authenticated;

-- RLS is also a boundary for callers that query exposed tables directly.
drop policy platform_provider_connections_select_admin on public.platform_provider_connections;
create policy platform_provider_connections_select_admin
  on public.platform_provider_connections for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

drop policy platform_admin_audit_events_select_admin on public.platform_admin_audit_events;
create policy platform_admin_audit_events_select_admin
  on public.platform_admin_audit_events for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

drop policy platform_subscription_invoices_select_admin on public.platform_subscription_invoices;
create policy platform_subscription_invoices_select_admin
  on public.platform_subscription_invoices for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

drop policy platform_payment_attempts_select_admin on public.platform_payment_attempts;
create policy platform_payment_attempts_select_admin
  on public.platform_payment_attempts for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

drop policy platform_subscription_plans_select_admin on public.platform_subscription_plans;
create policy platform_subscription_plans_select_admin
  on public.platform_subscription_plans for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

drop policy institute_subscriptions_select_admin on public.institute_subscriptions;
create policy institute_subscriptions_select_admin
  on public.institute_subscriptions for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

drop policy platform_subscription_events_select_admin on public.platform_subscription_events;
create policy platform_subscription_events_select_admin
  on public.platform_subscription_events for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));

-- Delivery metadata is still operational data. Keep it available to institute managers
-- under the existing tenant policy and platform owners/operators, not support-only roles.
drop policy notification_logs_select_platform_admin on public.notification_logs;
create policy notification_logs_select_platform_admin
  on public.notification_logs for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));
