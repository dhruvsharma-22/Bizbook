-- Let an institute manager replace a self-service invoice before checkout has
-- created any provider attempt. Once an attempt exists, reconciliation is
-- required so a late provider capture cannot be mistaken for a cancelled order.
create or replace function public.cancel_unstarted_subscription_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_invoice public.platform_subscription_invoices%rowtype;
  v_subscription public.institute_subscriptions%rowtype;
  v_new_checkout boolean;
  v_reason text := 'Unstarted plan checkout cancelled by institute owner or administrator';
begin
  if v_user is null or auth.role() is distinct from 'authenticated' or p_invoice_id is null then
    raise exception using errcode = '42501', message = 'Sign in with an institute owner or administrator account';
  end if;

  select * into v_invoice from public.platform_subscription_invoices where id = p_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'The plan payment was not found'; end if;
  if not bizbook_private.can_manage_institute(v_invoice.institute_id) then
    raise exception using errcode = '42501', message = 'Institute owner or administrator access is required';
  end if;

  -- Match the purchase RPC lock order (subscription, then invoice) to avoid
  -- racing a second purchase. The provider-attempt RPC also locks the invoice.
  select * into v_subscription from public.institute_subscriptions
    where id = v_invoice.subscription_id and institute_id = v_invoice.institute_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'The subscription was not found'; end if;
  select * into v_invoice from public.platform_subscription_invoices
    where id = p_invoice_id and subscription_id = v_subscription.id for update;
  if not found then raise exception using errcode = 'P0002', message = 'The plan payment was not found'; end if;

  if v_invoice.status = 'void' then
    return jsonb_build_object('invoice_id', v_invoice.id, 'status', 'void', 'already_cancelled', true);
  end if;
  if v_invoice.status not in ('open', 'past_due') then
    raise exception using errcode = '55000', message = 'Only an unpaid plan request can be cancelled';
  end if;
  if exists (select 1 from public.platform_payment_attempts where invoice_id = v_invoice.id) then
    raise exception using errcode = '55000', message = 'Checkout has already started; resume or reconcile this payment before choosing another plan';
  end if;

  v_new_checkout := v_subscription.status = 'past_due'
    and v_subscription.current_period_start is null
    and v_subscription.current_period_end is null
    and v_subscription.trial_ends_at is null;

  update public.platform_subscription_invoices set status = 'void' where id = v_invoice.id;
  update public.institute_subscriptions set
    status = case when v_new_checkout then 'expired' else status end,
    plan_id = case when v_new_checkout then null else plan_id end,
    pending_plan_id = null,
    pending_billing_cycle = null
    where id = v_subscription.id;

  insert into public.platform_subscription_events(institute_id, subscription_id, actor_user_id, event_type, reason, details)
    values (v_invoice.institute_id, v_subscription.id, v_user, 'subscription_invoice_voided', v_reason,
      jsonb_build_object('invoice_id', v_invoice.id, 'invoice_number', v_invoice.invoice_number));
  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (v_user, 'subscription_invoice_voided', 'subscription_invoice', v_invoice.id::text,
      jsonb_build_object('institute_id', v_invoice.institute_id, 'reason', v_reason));

  return jsonb_build_object('invoice_id', v_invoice.id, 'status', 'void', 'already_cancelled', false);
end;
$$;

revoke all on function public.cancel_unstarted_subscription_invoice(uuid) from public, anon;
grant execute on function public.cancel_unstarted_subscription_invoice(uuid) to authenticated;
