-- Server-verified online payment operations. Existing order rows are retained; new
-- payment intents carry their accounting target so webhook processing is atomic.

alter table public.payment_orders
  add column receipt_kind text,
  add column installment_id text,
  add column allocation_amount numeric(12,2),
  add column request_fingerprint text,
  add column safe_error_code text;

alter table public.payment_orders
  add constraint payment_orders_receipt_kind_check
    check (receipt_kind is null or receipt_kind in ('Fee', 'Advance')),
  add constraint payment_orders_allocation_amount_check
    check (allocation_amount is null or allocation_amount >= 0),
  add constraint payment_orders_intent_shape_check
    check (receipt_kind is null or (
      allocation_amount is not null
      and ((receipt_kind = 'Fee' and installment_id is not null and allocation_amount = amount)
        or (receipt_kind = 'Advance' and ((installment_id is null and allocation_amount = 0)
          or (installment_id is not null and allocation_amount > 0 and allocation_amount <= amount))))
    )),
  add constraint payment_orders_installment_fkey
    foreign key (installment_id, institute_id, student_id)
    references public.student_installments(id, institute_id, student_id) on delete restrict;

alter table public.payment_connections
  add column last_verified_at timestamptz,
  add column last_verified_reference text;

create index payment_orders_reserved_installment_idx
  on public.payment_orders (institute_id, student_id, installment_id, order_status)
  where installment_id is not null and order_status in ('Processing', 'Pending', 'Authorized');

create or replace function public.activate_payment_connection_after_sandbox_check(
  p_institute_id text, p_provider text, p_actor_user_id uuid, p_provider_order_reference text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_connection_id text; v_verified_at timestamptz := now();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_institute_id is null or p_provider not in ('razorpay', 'cashfree')
     or p_actor_user_id is null or nullif(btrim(p_provider_order_reference), '') is null
     or length(p_provider_order_reference) > 200 then
    raise exception using errcode = '22023', message = 'Provider verification details are invalid';
  end if;
  if not exists (
    select 1 from public.user_memberships m
    join public.coaching_institutes i on i.id = m.institute_id
    where m.institute_id = p_institute_id and m.user_id = p_actor_user_id
      and m.is_active and m.role in ('owner', 'administrator') and i.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Institute administrator access is required';
  end if;
  update public.payment_connections c
     set connection_status = 'active', last_verified_at = v_verified_at,
         last_verified_reference = p_provider_order_reference
   where c.institute_id = p_institute_id and c.provider = p_provider
     and c.environment = 'test' and c.connection_status = 'pending'
  returning c.id into v_connection_id;
  if v_connection_id is null then
    raise exception using errcode = 'P0002', message = 'A pending test provider configuration was not found';
  end if;
  insert into public.audit_logs (institute_id, entity_type, entity_id, action, actor_id, metadata)
  values (p_institute_id, 'payment_connection', v_connection_id, 'UPDATE', p_actor_user_id,
          jsonb_build_object('provider', p_provider, 'environment', 'test',
            'verification', 'sandbox_order_created', 'provider_order_reference', p_provider_order_reference,
            'connection_status', 'active'));
  return jsonb_build_object('provider', p_provider, 'environment', 'test',
    'connection_status', 'active', 'last_verified_at', v_verified_at);
end;
$$;

revoke all on function public.activate_payment_connection_after_sandbox_check(text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.activate_payment_connection_after_sandbox_check(text, text, uuid, text)
  to service_role;

create or replace function public.create_online_payment_order_intent(
  p_institute_id text, p_branch_id text, p_student_id text, p_provider text,
  p_receipt_kind text, p_amount numeric, p_installment_id text,
  p_allocation_amount numeric, p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_student_branch_id text;
  v_installment_status text;
  v_outstanding numeric(12,2);
  v_reserved numeric(12,2);
  v_fingerprint text;
  v_order public.payment_orders%rowtype;
  v_rows integer;
begin
  if auth.role() is distinct from 'authenticated' or v_actor_id is null
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception using errcode = '42501', message = 'Authorized institute financial access is required';
  end if;
  if p_provider not in ('razorpay', 'cashfree')
     or p_receipt_kind not in ('Fee', 'Advance')
     or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_allocation_amount is null or p_allocation_amount < 0
     or p_allocation_amount <> round(p_allocation_amount, 2)
     or nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 128 then
    raise exception using errcode = '22023', message = 'Payment order details are invalid';
  end if;
  if not exists (
    select 1 from public.payment_connections c
    where c.institute_id = p_institute_id and c.provider = p_provider
      and c.environment = 'test' and c.connection_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'A verified test payment connection is required';
  end if;
  select s.branch_id into v_student_branch_id
    from public.students s
   where s.id = p_student_id and s.institute_id = p_institute_id
     and s.archived_at is null and bizbook_private.can_access_branch(s.institute_id, s.branch_id);
  if not found or p_branch_id is distinct from v_student_branch_id then
    raise exception using errcode = '22023', message = 'Student is unavailable in the selected institute branch';
  end if;
  if (p_receipt_kind = 'Fee' and (p_installment_id is null or p_allocation_amount <> p_amount))
     or (p_receipt_kind = 'Advance' and (
       (p_installment_id is null and p_allocation_amount <> 0)
       or (p_installment_id is not null and (p_allocation_amount <= 0 or p_allocation_amount > p_amount)))) then
    raise exception using errcode = '22023', message = 'Payment allocation details are invalid';
  end if;

  v_fingerprint := md5(concat_ws('|', p_institute_id, coalesce(p_branch_id, ''), p_student_id,
    p_provider, p_receipt_kind, p_amount::text, coalesce(p_installment_id, ''),
    p_allocation_amount::text));
  select o.* into v_order from public.payment_orders o
   where o.institute_id = p_institute_id and o.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_order.request_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '23505', message = 'The idempotency key was used for different payment details';
    end if;
    if v_order.provider_order_id is not null then
      return jsonb_build_object('created', false, 'order_id', v_order.id,
        'provider_order_id', v_order.provider_order_id, 'order_status', v_order.order_status);
    end if;
    if v_order.order_status = 'Failed' then
      raise exception using errcode = '23505', message = 'The previous provider order failed; submit with a new idempotency key';
    end if;
    raise exception using errcode = '55P03', message = 'This payment order is already being created';
  end if;

  if p_installment_id is not null then
    select i.status into v_installment_status
      from public.student_installments i
     where i.id = p_installment_id and i.institute_id = p_institute_id
       and i.student_id = p_student_id and i.branch_id is not distinct from p_branch_id
     for update;
    if not found or v_installment_status = 'Cancelled' then
      raise exception using errcode = '22023', message = 'The selected installment is unavailable';
    end if;
    -- A matching request may have committed while this transaction waited for
    -- the installment lock. Return it before treating its own reservation as
    -- someone else's reserved balance.
    select o.* into v_order from public.payment_orders o
     where o.institute_id = p_institute_id and o.idempotency_key = p_idempotency_key
     for update;
    if found then
      if v_order.request_fingerprint is distinct from v_fingerprint then
        raise exception using errcode = '23505', message = 'The idempotency key was used for different payment details';
      end if;
      if v_order.provider_order_id is not null then
        return jsonb_build_object('created', false, 'order_id', v_order.id,
          'provider_order_id', v_order.provider_order_id, 'order_status', v_order.order_status);
      end if;
      raise exception using errcode = '55P03', message = 'This payment order is already being created';
    end if;
    select b.outstanding_amount into v_outstanding
      from public.installment_balances b
     where b.installment_id = p_installment_id and b.institute_id = p_institute_id;
    select coalesce(sum(o.allocation_amount), 0) into v_reserved
      from public.payment_orders o
     where o.institute_id = p_institute_id and o.installment_id = p_installment_id
       and o.order_status in ('Processing', 'Pending', 'Authorized');
    if coalesce(p_allocation_amount, 0) > coalesce(v_outstanding, 0) - coalesce(v_reserved, 0) then
      raise exception using errcode = '23514', message = 'The installment balance is reserved by another order or already paid';
    end if;
  end if;

  insert into public.payment_orders (
    institute_id, branch_id, student_id, provider, idempotency_key, amount, currency,
    order_status, receipt_kind, installment_id, allocation_amount, request_fingerprint, created_by
  ) values (
    p_institute_id, p_branch_id, p_student_id, p_provider, p_idempotency_key, p_amount, 'INR',
    'Processing', p_receipt_kind, p_installment_id, p_allocation_amount, v_fingerprint, v_actor_id
  ) on conflict (institute_id, idempotency_key) do nothing;
  get diagnostics v_rows = row_count;
  select o.* into v_order from public.payment_orders o
   where o.institute_id = p_institute_id and o.idempotency_key = p_idempotency_key
   for update;
  if not found or v_order.request_fingerprint is distinct from v_fingerprint then
    raise exception using errcode = '23505', message = 'The idempotency key was used for different payment details';
  end if;
  if v_rows = 0 then
    if v_order.provider_order_id is not null then
      return jsonb_build_object('created', false, 'order_id', v_order.id,
        'provider_order_id', v_order.provider_order_id, 'order_status', v_order.order_status);
    end if;
    if v_order.order_status = 'Failed' then
      raise exception using errcode = '23505', message = 'The previous provider order failed; submit with a new idempotency key';
    end if;
    raise exception using errcode = '55P03', message = 'This payment order is already being created';
  end if;
  insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
  values (p_institute_id, p_branch_id, 'payment_order', v_order.id, 'INSERT', v_actor_id,
    jsonb_build_object('provider', p_provider, 'receipt_kind', p_receipt_kind, 'amount', p_amount,
      'allocation_amount', p_allocation_amount, 'status', 'Processing'));
  return jsonb_build_object('created', true, 'order_id', v_order.id, 'order_status', 'Processing');
end;
$$;

create or replace function public.bind_online_provider_order(
  p_order_id text, p_provider_order_id text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order public.payment_orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if nullif(btrim(p_order_id), '') is null or nullif(btrim(p_provider_order_id), '') is null
     or length(p_provider_order_id) > 200 then
    raise exception using errcode = '22023', message = 'Provider order reference is invalid';
  end if;
  select * into v_order from public.payment_orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payment order was not found'; end if;
  if v_order.provider_order_id = p_provider_order_id then return; end if;
  if v_order.order_status <> 'Processing' or v_order.provider_order_id is not null then
    raise exception using errcode = '23505', message = 'Payment order cannot be bound to another provider order';
  end if;
  update public.payment_orders set provider_order_id = p_provider_order_id, order_status = 'Pending', safe_error_code = null
   where id = p_order_id;
  insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
  values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
    jsonb_build_object('provider', v_order.provider, 'status', 'Pending', 'provider_order_reference', p_provider_order_id));
end;
$$;

create or replace function public.fail_online_provider_order_creation(p_order_id text, p_safe_error_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_order public.payment_orders%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_safe_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise exception using errcode = '22023', message = 'Provider error code is invalid';
  end if;
  update public.payment_orders set order_status = 'Failed', safe_error_code = p_safe_error_code
   where id = p_order_id and order_status = 'Processing' and provider_order_id is null
  returning * into v_order;
  if found then
    insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
    values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
      jsonb_build_object('provider', v_order.provider, 'status', 'Failed', 'safe_error_code', p_safe_error_code));
  end if;
end;
$$;

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
  v_reconciliation_status text;
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

revoke all on function public.create_online_payment_order_intent(text, text, text, text, text, numeric, text, numeric, text)
  from public, anon;
grant execute on function public.create_online_payment_order_intent(text, text, text, text, text, numeric, text, numeric, text)
  to authenticated;
revoke all on function public.bind_online_provider_order(text, text),
  public.fail_online_provider_order_creation(text, text),
  public.process_online_payment_status(text, text, text, text, numeric, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bind_online_provider_order(text, text),
  public.fail_online_provider_order_creation(text, text),
  public.process_online_payment_status(text, text, text, text, numeric, text, text, text, text)
  to service_role;

comment on function public.create_online_payment_order_intent(text, text, text, text, text, numeric, text, numeric, text)
  is 'Creates an authenticated, idempotent test-mode payment intent and reserves requested installment allocation capacity.';
comment on function public.process_online_payment_status(text, text, text, text, numeric, text, text, text, text)
  is 'Service-role-only finalization after server-side provider verification; records one receipt and optional allocations atomically.';
