-- Ignore stale non-captured provider events after a terminal payment state.
create or replace function public.process_online_payment_status(
  p_provider text, p_provider_order_id text, p_provider_payment_id text,
  p_provider_status text, p_provider_amount numeric, p_currency text,
  p_provider_event_id text default null, p_event_type text default null, p_payload_sha256 text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.payment_orders%rowtype;
  v_event_id uuid;
  v_existing_event public.webhook_events%rowtype;
  v_payment_id text;
  v_business_date date;
  v_outstanding numeric(12,2);
  v_other_reserved numeric(12,2);
  v_rows integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_provider is null or p_provider not in ('razorpay', 'cashfree')
     or p_provider_status is null
     or p_provider_status not in ('captured', 'authorized', 'pending', 'failed', 'cancelled')
     or nullif(btrim(p_provider_order_id), '') is null
     or (p_provider_event_id is not null and (length(p_provider_event_id) > 255 or p_event_type is null
       or length(p_event_type) > 120 or p_payload_sha256 is null
       or p_payload_sha256 !~ '^[0-9a-f]{64}$')) then
    raise exception using errcode = '22023', message = 'Verified provider payment details are invalid';
  end if;
  select * into v_order from public.payment_orders o
   where o.provider = p_provider and o.provider_order_id = p_provider_order_id
   for update;
  if not found then return jsonb_build_object('status', 'unmatched_provider_order'); end if;

  if p_provider_event_id is not null then
    insert into public.webhook_events (institute_id, provider, provider_event_id, event_type, payload_sha256, processing_status)
    values (v_order.institute_id, p_provider, p_provider_event_id, p_event_type, p_payload_sha256, 'Processing')
    on conflict (provider, provider_event_id) do nothing returning id into v_event_id;
    if v_event_id is null then
      select * into v_existing_event from public.webhook_events e
       where e.provider = p_provider and e.provider_event_id = p_provider_event_id for update;
      if v_existing_event.institute_id <> v_order.institute_id
         or v_existing_event.payload_sha256 <> p_payload_sha256 then
        raise exception using errcode = '23505', message = 'Provider event identifier conflicts with existing event data';
      end if;
      if v_existing_event.processing_status = 'Processed' or v_existing_event.processing_status = 'Ignored' then
        return jsonb_build_object('status', 'duplicate_event', 'payment_id', v_order.payment_id);
      end if;
      update public.webhook_events set processing_status = 'Processing', processed_at = null
       where id = v_existing_event.id returning id into v_event_id;
    end if;
  end if;

  if v_order.order_status = 'Captured' and v_order.payment_id is not null then
    if v_event_id is not null then
      update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
    end if;
    return jsonb_build_object('status', 'captured', 'payment_id', v_order.payment_id, 'duplicate', true);
  end if;

  if v_order.order_status in ('Failed', 'Cancelled')
     and p_provider_status in ('authorized', 'pending', 'failed', 'cancelled') then
    if v_event_id is not null then
      update public.webhook_events set processing_status = 'Ignored', processed_at = now() where id = v_event_id;
    end if;
    return jsonb_build_object('status', lower(v_order.order_status), 'ignored', true);
  end if;
  if p_provider_status = 'captured' then
    if p_provider_payment_id is null or length(p_provider_payment_id) > 200 then
      raise exception using errcode = '22023', message = 'Captured provider payment reference is missing';
    end if;
    if p_provider_amount is null or p_provider_amount <> v_order.amount or p_currency is distinct from v_order.currency then
      insert into public.payment_reconciliation_records (
        institute_id, provider, provider_transaction_reference, provider_amount, currency,
        reconciliation_status, notes
      ) values (v_order.institute_id, p_provider, p_provider_payment_id,
        greatest(coalesce(p_provider_amount, 0), 0), 'INR', 'Amount Mismatch',
        'Provider reports captured payment with amount or currency different from the stored order; provider currency was not INR.')
      on conflict (institute_id, provider, provider_transaction_reference) do nothing;
      update public.payment_orders set safe_error_code = 'provider_amount_mismatch' where id = v_order.id;
      insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
      values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
        jsonb_build_object('provider', p_provider, 'status', 'reconciliation_required',
          'safe_error_code', 'provider_amount_mismatch'));
      if v_event_id is not null then
        update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
      end if;
      return jsonb_build_object('status', 'reconciliation_required');
    end if;
    if v_order.installment_id is not null then
      perform 1 from public.student_installments i
       where i.id = v_order.installment_id and i.institute_id = v_order.institute_id
         and i.student_id = v_order.student_id for update;
      select b.outstanding_amount into v_outstanding from public.installment_balances b
       where b.installment_id = v_order.installment_id and b.institute_id = v_order.institute_id;
      select coalesce(sum(o.allocation_amount), 0) into v_other_reserved
        from public.payment_orders o
       where o.institute_id = v_order.institute_id and o.installment_id = v_order.installment_id
         and o.id <> v_order.id and o.order_status in ('Processing', 'Pending', 'Authorized');
      if coalesce(v_order.allocation_amount, 0) > coalesce(v_outstanding, 0) - coalesce(v_other_reserved, 0) then
        insert into public.payment_reconciliation_records (
          institute_id, provider, provider_transaction_reference, provider_amount, currency,
          reconciliation_status, notes
        ) values (v_order.institute_id, p_provider, p_provider_payment_id, p_provider_amount,
          v_order.currency, 'Unmatched', 'Captured provider payment could not be allocated because the installment capacity changed.')
        on conflict (institute_id, provider, provider_transaction_reference) do nothing;
        update public.payment_orders set safe_error_code = 'allocation_capacity_changed' where id = v_order.id;
        insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
        values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
          jsonb_build_object('provider', p_provider, 'status', 'reconciliation_required',
            'safe_error_code', 'allocation_capacity_changed'));
        if v_event_id is not null then
          update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
        end if;
        return jsonb_build_object('status', 'reconciliation_required');
      end if;
    end if;
    select (now() at time zone i.time_zone)::date into v_business_date
      from public.coaching_institutes i where i.id = v_order.institute_id;
    insert into public.payments (
      institute_id, branch_id, student_id, receipt_kind, amount, currency, payment_date,
      method, mode, status, provider, provider_order_id, provider_payment_id,
      verified_at, idempotency_key, request_fingerprint, note, created_by
    ) values (
      v_order.institute_id, v_order.branch_id, v_order.student_id, v_order.receipt_kind,
      v_order.amount, v_order.currency, v_business_date, 'Online', 'Online', 'Paid', p_provider,
      p_provider_order_id, p_provider_payment_id, now(), 'online-order:' || v_order.id,
      v_order.request_fingerprint, 'Verified server-side against payment provider.', v_order.created_by
    ) returning id into v_payment_id;
    if coalesce(v_order.allocation_amount, 0) > 0 then
      insert into public.payment_allocations (
        institute_id, payment_id, student_id, installment_id, allocation_kind, amount, created_by
      ) values (
        v_order.institute_id, v_payment_id, v_order.student_id, v_order.installment_id,
        v_order.receipt_kind, v_order.allocation_amount, v_order.created_by
      );
    end if;
    update public.payment_orders set order_status = 'Captured', payment_id = v_payment_id,
      safe_error_code = null where id = v_order.id;
    insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
    values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
      jsonb_build_object('provider', p_provider, 'status', 'Captured', 'payment_id', v_payment_id));
    insert into public.payment_reconciliation_records (
      institute_id, provider, payment_id, provider_transaction_reference, provider_amount,
      currency, reconciliation_status, reconciled_by, notes
    ) values (
      v_order.institute_id, p_provider, v_payment_id, p_provider_payment_id, p_provider_amount,
      v_order.currency, 'Matched', v_order.created_by,
      'Provider status and amount were verified server-side before posting the receipt.'
    ) on conflict (institute_id, provider, provider_transaction_reference) do nothing;
    if v_event_id is not null then
      update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
    end if;
    return jsonb_build_object('status', 'captured', 'payment_id', v_payment_id);
  end if;

  update public.payment_orders set order_status = case p_provider_status
      when 'authorized' then 'Authorized' when 'pending' then 'Processing'
      when 'failed' then 'Failed' when 'cancelled' then 'Cancelled' end,
    safe_error_code = case when p_provider_status in ('failed', 'cancelled') then 'provider_' || p_provider_status else null end
   where id = v_order.id and order_status <> 'Captured';
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
    values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
      jsonb_build_object('provider', p_provider, 'status', p_provider_status,
        'safe_error_code', case when p_provider_status in ('failed', 'cancelled') then 'provider_' || p_provider_status else null end));
  end if;
  if v_event_id is not null then
    update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
  end if;
  return jsonb_build_object('status', p_provider_status);
end;
$$;
