-- Idempotent, provider-confirmed online refunds. Manual refund functions remain separate.

create or replace function public.request_online_refund(
  p_payment_id text,
  p_amount numeric,
  p_reason text,
  p_allocation_breakdown jsonb,
  p_refund_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_refund public.refunds%rowtype;
  v_existing_allocations jsonb;
  v_requested_allocations jsonb;
  v_created_id text;
begin
  if p_refund_id is null or p_refund_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
    or p_reason is null or length(btrim(p_reason)) not between 1 and 500
    or p_allocation_breakdown is null or jsonb_typeof(p_allocation_breakdown) <> 'array' then
    raise exception 'A refund idempotency UUID and allocation list are required.' using errcode = '22023';
  end if;

  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found or v_actor is null
    or not bizbook_private.has_institute_role(v_payment.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_payment.institute_id, v_payment.branch_id) then
    raise exception 'Authorized receipt access is required.' using errcode = '42501';
  end if;
  if v_payment.mode <> 'Online' or v_payment.provider is null
    or v_payment.status not in ('Paid', 'Partially Refunded') then
    raise exception 'Only a verified, refundable online receipt can use provider refunds.' using errcode = '22023';
  end if;

  select r.* into v_refund from public.refunds r where r.id = p_refund_id for update;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'payment_allocation_id', ra.payment_allocation_id, 'amount', ra.amount
    ) order by ra.payment_allocation_id), '[]'::jsonb)
    into v_existing_allocations
    from public.refund_allocations ra
    where ra.refund_id = v_refund.id and ra.institute_id = v_refund.institute_id;

    select coalesce(jsonb_agg(jsonb_build_object(
      'payment_allocation_id', nullif(btrim(x.value->>'payment_allocation_id'), ''),
      'amount', (x.value->>'amount')::numeric(12,2)
    ) order by nullif(btrim(x.value->>'payment_allocation_id'), '')), '[]'::jsonb)
    into v_requested_allocations
    from jsonb_array_elements(p_allocation_breakdown) as x(value);

    if v_refund.institute_id <> v_payment.institute_id or v_refund.payment_id <> v_payment.id
      or v_refund.mode <> 'Online' or v_refund.requested_by is distinct from v_actor
      or v_refund.amount <> p_amount or v_refund.reason <> btrim(coalesce(p_reason, ''))
      or v_existing_allocations <> v_requested_allocations then
      raise exception 'The refund idempotency UUID was already used for different details.' using errcode = '23505';
    end if;
    return jsonb_build_object('refund_id', v_refund.id, 'status', v_refund.status,
      'provider_refund_reference', v_refund.provider_refund_reference, 'created', false);
  end if;

  v_created_id := public.request_refund(
    p_payment_id, p_amount, p_reason, 'Online', p_allocation_breakdown, p_refund_id
  );
  select r.* into v_refund from public.refunds r where r.id = v_created_id;
  return jsonb_build_object('refund_id', v_refund.id, 'status', v_refund.status,
    'provider_refund_reference', v_refund.provider_refund_reference, 'created', true);
end;
$$;

create or replace function public.record_online_refund_status(
  p_refund_id text,
  p_provider text,
  p_provider_refund_reference text,
  p_provider_payment_id text,
  p_provider_order_id text,
  p_provider_amount numeric,
  p_currency text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds%rowtype;
  v_payment public.payments%rowtype;
  v_completed_total numeric(12,2);
  v_next_status text;
begin
  if p_refund_id is null or p_provider is null or p_provider not in ('razorpay', 'cashfree')
    or p_provider_refund_reference is null or length(btrim(p_provider_refund_reference)) not between 1 and 255
    or p_provider_payment_id is null or length(btrim(p_provider_payment_id)) not between 1 and 255
    or p_provider_order_id is null or length(btrim(p_provider_order_id)) not between 1 and 255
    or p_provider_amount is null or p_provider_amount <= 0 or p_provider_amount <> round(p_provider_amount, 2)
    or p_currency is distinct from 'INR'
    or p_status is null or p_status not in ('Processing', 'Completed', 'Failed', 'Cancelled') then
    raise exception 'Provider refund status details are invalid.' using errcode = '22023';
  end if;

  -- Follow the same payment-then-refund lock order used by request_refund.
  -- This avoids a deadlock when status reconciliation overlaps a new request.
  select r.* into v_refund from public.refunds r where r.id = p_refund_id;
  if not found or v_refund.mode <> 'Online' then
    raise exception 'Online refund was not found.' using errcode = '22023';
  end if;
  select p.* into v_payment from public.payments p
  where p.id = v_refund.payment_id and p.institute_id = v_refund.institute_id for update;
  if not found then
    raise exception 'The original online payment was not found.' using errcode = '23503';
  end if;
  select r.* into v_refund from public.refunds r where r.id = p_refund_id for update;
  if not found then
    raise exception 'Online refund was not found.' using errcode = '22023';
  end if;
  if v_payment.mode <> 'Online' or v_payment.provider <> p_provider
    or v_payment.provider_payment_id is distinct from p_provider_payment_id
    or v_payment.provider_order_id is distinct from p_provider_order_id
    or v_payment.currency is distinct from p_currency
    or v_refund.amount <> p_provider_amount then
    raise exception 'Provider refund does not match the original receipt and exact amount.' using errcode = '23514';
  end if;

  if v_refund.status in ('Completed', 'Failed', 'Cancelled') then
    if v_refund.provider_refund_reference is distinct from p_provider_refund_reference then
      raise exception 'A terminal refund cannot be rebound to another provider refund.' using errcode = '23514';
    end if;
    return jsonb_build_object('refund_id', v_refund.id, 'status', v_refund.status, 'duplicate', true);
  end if;
  if v_refund.provider_refund_reference is not null
     and v_refund.provider_refund_reference is distinct from p_provider_refund_reference then
    raise exception 'An online refund cannot be rebound to another provider refund.' using errcode = '23514';
  end if;

  v_next_status := p_status;
  update public.refunds
  set provider_refund_reference = p_provider_refund_reference,
      status = v_next_status,
      completed_at = case when v_next_status = 'Completed' then coalesce(completed_at, now()) else null end,
      completed_by = null,
      updated_at = now()
  where id = v_refund.id;

  if v_next_status = 'Completed' then
    select coalesce(sum(r.amount), 0) into v_completed_total
    from public.refunds r
    where r.institute_id = v_refund.institute_id and r.payment_id = v_refund.payment_id
      and r.status = 'Completed';
    update public.payments
    set status = case when v_completed_total >= v_payment.amount then 'Refunded' else 'Partially Refunded' end,
        updated_at = now()
    where id = v_payment.id and institute_id = v_payment.institute_id;
  end if;

  return jsonb_build_object('refund_id', v_refund.id, 'status', v_next_status, 'duplicate', false);
end;
$$;

revoke all on function public.request_online_refund(text, numeric, text, jsonb, text) from public, anon;
grant execute on function public.request_online_refund(text, numeric, text, jsonb, text) to authenticated;
revoke all on function public.record_online_refund_status(text, text, text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.record_online_refund_status(text, text, text, text, text, numeric, text, text)
  to service_role;

comment on function public.request_online_refund(text, numeric, text, jsonb, text)
  is 'Creates an online refund reservation with stable, exact-detail idempotency for an authorized finance user.';
comment on function public.record_online_refund_status(text, text, text, text, text, numeric, text, text)
  is 'Service-role-only update after a provider refund API response is fetched and matched to exact payment, order, currency, and amount.';
