-- Return the same in-flight idempotent intent without creating a second provider order.
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
    return jsonb_build_object('created', false, 'order_id', v_order.id, 'provider_order_id', null, 'order_status', v_order.order_status);
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
      return jsonb_build_object('created', false, 'order_id', v_order.id, 'provider_order_id', null, 'order_status', v_order.order_status);
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
    return jsonb_build_object('created', false, 'order_id', v_order.id, 'provider_order_id', null, 'order_status', v_order.order_status);
  end if;
  insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
  values (p_institute_id, p_branch_id, 'payment_order', v_order.id, 'INSERT', v_actor_id,
    jsonb_build_object('provider', p_provider, 'receipt_kind', p_receipt_kind, 'amount', p_amount,
      'allocation_amount', p_allocation_amount, 'status', 'Processing'));
  return jsonb_build_object('created', true, 'order_id', v_order.id, 'order_status', 'Processing');
end;
$$;
