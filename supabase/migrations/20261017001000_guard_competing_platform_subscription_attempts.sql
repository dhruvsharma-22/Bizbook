-- Forward correction: serialize invoice finalization and hold competing attempts for reconciliation.

create or replace function public.finalize_platform_subscription_payment(
  p_attempt_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_provider_amount numeric,
  p_currency text,
  p_provider_event_id text,
  p_event_type text,
  p_payload_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.platform_payment_attempts%rowtype;
  v_invoice_id uuid;
  v_competing_attempt_exists boolean := false;
  v_invoice public.platform_subscription_invoices%rowtype;
  v_subscription public.institute_subscriptions%rowtype;
  v_invoice_snapshot public.platform_subscription_invoices%rowtype;
  v_result_status text;
  v_subscription_status text;
  v_should_activate boolean := false;
  v_old_status text;
  v_duplicate_provider_payment boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_attempt_id is null or p_provider_order_id is null
     or length(p_provider_order_id) not between 1 and 200
     or p_provider_status is null or p_provider_status not in ('captured', 'pending', 'authorized', 'failed', 'cancelled')
     or p_provider_event_id is null or length(p_provider_event_id) not between 1 and 255
     or p_event_type is null or length(p_event_type) not between 1 and 120
     or (p_payload_sha256 is not null and p_payload_sha256 !~ '^[a-f0-9]{64}$') then
    raise exception using errcode = '22023', message = 'Provider payment result is invalid';
  end if;
  if p_provider_status = 'captured'
     and (p_provider_payment_id is null or length(p_provider_payment_id) not between 1 and 200
          or p_provider_amount is null or p_provider_amount <= 0 or p_currency is distinct from 'INR') then
    raise exception using errcode = '22023', message = 'Captured payment details are invalid';
  end if;

  -- Serialize all provider finalizers for one invoice before locking an attempt.
  -- This prevents concurrent callbacks for different attempts from deadlocking
  -- or independently settling the same invoice.
  select a.invoice_id into v_invoice_id
    from public.platform_payment_attempts a where a.id = p_attempt_id;
  if not found then raise exception using errcode = 'P0002', message = 'Payment attempt was not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_invoice_id::text, 0));

  select * into v_attempt from public.platform_payment_attempts where id = p_attempt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payment attempt was not found'; end if;
  if v_attempt.provider_order_id is distinct from p_provider_order_id then
    raise exception using errcode = '23514', message = 'Provider order does not match the saved attempt';
  end if;
  if exists (
    select 1 from public.platform_subscription_payment_events e
     where e.provider = v_attempt.provider and e.provider_event_id = p_provider_event_id
  ) then
    return jsonb_build_object('status', 'duplicate_event', 'attempt_id', v_attempt.id,
                              'invoice_id', v_attempt.invoice_id);
  end if;

  -- Lock subscription before invoice, matching invoice issuance's lock order.
  select * into v_invoice_snapshot from public.platform_subscription_invoices
   where id = v_attempt.invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice was not found'; end if;
  if v_invoice_snapshot.subscription_id is not null then
    select * into v_subscription from public.institute_subscriptions
     where id = v_invoice_snapshot.subscription_id and institute_id = v_attempt.institute_id
     for update;
  end if;
  select * into v_invoice from public.platform_subscription_invoices
   where id = v_attempt.invoice_id for update;
  if v_invoice.institute_id <> v_attempt.institute_id
     or v_invoice.subscription_id is distinct from v_invoice_snapshot.subscription_id then
    raise exception using errcode = '23514', message = 'Invoice ownership changed during reconciliation';
  end if;

  v_old_status := v_attempt.status;
  v_result_status := p_provider_status;
  if v_attempt.status = 'paid' then
    if p_provider_status = 'captured' and v_attempt.provider_payment_id = p_provider_payment_id then
      v_result_status := 'duplicate_event';
    elsif p_provider_status = 'captured' then
      -- A second capture on one provider order is recorded for reconciliation;
      -- retain the first verified payment reference on the attempt row.
      v_result_status := 'reconciliation_required';
    else
      -- Late pending/failure events cannot downgrade an already verified capture.
      v_result_status := 'paid';
    end if;
  elsif p_provider_status = 'captured' then
    select exists (
      select 1 from public.platform_payment_attempts other
       where other.invoice_id = v_attempt.invoice_id
         and other.id <> v_attempt.id
         and other.status in ('created', 'pending', 'authorized', 'reconciliation_required')
    ) into v_competing_attempt_exists;
    if v_competing_attempt_exists then
      -- A late capture can race with a retry after the prior order appeared failed.
      -- Keep the invoice open and hold this capture for explicit reconciliation.
      v_result_status := 'reconciliation_required';
    elsif v_invoice.status not in ('open', 'past_due') then
      v_result_status := 'reconciliation_required';
    elsif v_invoice.amount <> p_provider_amount or v_invoice.currency <> p_currency then
      v_result_status := 'reconciliation_required';
    elsif v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id <> p_provider_payment_id then
      v_result_status := 'reconciliation_required';
    elsif exists (
      select 1 from public.platform_payment_attempts other
       where other.provider = v_attempt.provider
         and other.provider_payment_id = p_provider_payment_id
         and other.id <> v_attempt.id
    ) then
      v_result_status := 'reconciliation_required';
      v_duplicate_provider_payment := true;
    elsif v_invoice.subscription_id is null or v_subscription.id is null then
      v_result_status := 'reconciliation_required';
    elsif v_invoice.status = 'paid' then
      v_result_status := 'reconciliation_required';
    else
      v_result_status := 'paid';
      v_should_activate := v_subscription.status in ('trialing', 'active', 'past_due');
    end if;
  elsif v_attempt.status in ('failed', 'cancelled') and p_provider_status in ('pending', 'authorized') then
    -- Stale non-terminal provider events cannot reopen a terminal attempt.
    v_result_status := v_attempt.status;
  elsif v_attempt.status = 'reconciliation_required' then
    v_result_status := 'reconciliation_required';
  end if;

  if v_result_status in ('pending', 'authorized', 'failed', 'cancelled') then
    update public.platform_payment_attempts
       set status = v_result_status,
           provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
           safe_error_code = case when v_result_status = 'failed' then 'provider_reported_failure' else null end,
           verified_at = case when v_result_status in ('failed', 'cancelled') then now() else verified_at end
     where id = v_attempt.id;
  elsif v_result_status = 'paid' then
    update public.platform_payment_attempts
       set status = 'paid', provider_payment_id = p_provider_payment_id,
           safe_error_code = null, verified_at = now()
     where id = v_attempt.id;
    update public.platform_subscription_invoices
       set status = 'paid', paid_at = now()
     where id = v_invoice.id;
    if v_should_activate then
      update public.institute_subscriptions
         set status = 'active', current_period_start = v_invoice.billing_period_start,
             current_period_end = v_invoice.billing_period_end, grace_period_ends_at = null
       where id = v_subscription.id and institute_id = v_invoice.institute_id;
      v_subscription_status := 'active';
    else
      v_subscription_status := v_subscription.status;
    end if;
  elsif v_result_status = 'reconciliation_required' then
    update public.platform_payment_attempts
       set status = 'reconciliation_required',
           provider_payment_id = case when v_duplicate_provider_payment then provider_payment_id
                                      else coalesce(provider_payment_id, p_provider_payment_id) end,
           safe_error_code = case
             when v_invoice.amount <> coalesce(p_provider_amount, -1) then 'amount_mismatch'
             when v_invoice.currency <> coalesce(p_currency, '') then 'currency_mismatch'
             when v_competing_attempt_exists then 'competing_subscription_attempt'
             when v_invoice.status = 'paid' then 'invoice_already_paid'
             else 'payment_requires_manual_reconciliation'
           end,
           verified_at = now()
     where id = v_attempt.id;
  end if;

  insert into public.platform_subscription_payment_events(
    attempt_id, invoice_id, institute_id, provider, provider_event_id,
    provider_order_id, provider_payment_id, event_type, observed_status,
    result_status, payload_sha256
  ) values (
    v_attempt.id, v_attempt.invoice_id, v_attempt.institute_id, v_attempt.provider,
    p_provider_event_id, p_provider_order_id, p_provider_payment_id, p_event_type,
    p_provider_status, v_result_status, p_payload_sha256
  );

  if v_result_status <> v_old_status and v_result_status <> 'duplicate_event' then
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (null, 'subscription_payment_' || v_result_status, 'subscription_payment_attempt', v_attempt.id::text,
            jsonb_build_object('invoice_id', v_invoice.id, 'provider', v_attempt.provider,
                               'event_type', p_event_type, 'provider_payment_id', p_provider_payment_id));
    insert into public.platform_subscription_events(
      institute_id, subscription_id, actor_user_id, event_type, reason, details
    ) values (
      v_invoice.institute_id, v_invoice.subscription_id, null, 'subscription_payment_' || v_result_status,
      null, jsonb_build_object('invoice_id', v_invoice.id, 'attempt_id', v_attempt.id,
                               'provider', v_attempt.provider, 'event_type', p_event_type)
    );
  end if;

  return jsonb_build_object('status', v_result_status, 'attempt_id', v_attempt.id,
                            'invoice_id', v_invoice.id, 'subscription_status', v_subscription_status);
end;
$$;

revoke all on function public.finalize_platform_subscription_payment(uuid, text, text, text, numeric, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_platform_subscription_payment(uuid, text, text, text, numeric, text, text, text, text) to service_role;
