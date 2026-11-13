-- Manual payment and advance allocation operations.

create or replace function public.record_manual_payment(
  p_institute_id text, p_branch_id text, p_student_id text, p_receipt_kind text,
  p_amount numeric, p_method text, p_payment_date date,
  p_reference text default null, p_note text default null, p_allocations jsonb default '[]'::jsonb,
  p_idempotency_key text default null, p_payment_id text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_payment_id text;
  v_fingerprint text;
  v_existing public.payments%rowtype;
  v_item jsonb;
  v_installment_id text;
  v_allocation_amount numeric(12,2);
  v_raw_allocation numeric;
  v_allocated_total numeric(12,2) := 0;
  v_existing_paid numeric(12,2);
  v_scheduled_amount numeric(12,2);
  v_installment_status text;
  v_student_branch_id text;
  v_allocation_kind text;
  v_business_date date;
begin
  if v_actor_id is null
    or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized institute financial access is required.' using errcode = '42501';
  end if;
  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = p_institute_id;
  if p_receipt_kind not in ('Fee', 'Advance')
    or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Other')
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
    or p_payment_date is null or p_payment_date > v_business_date then
    raise exception 'Manual payment details are invalid.' using errcode = '22023';
  end if;
  if p_idempotency_key is not null and length(btrim(p_idempotency_key)) = 0 then
    raise exception 'An idempotency key cannot be blank.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'Payment allocations must be an array.' using errcode = '22023';
  end if;
  select s.branch_id into v_student_branch_id
  from public.students s
  where s.id = p_student_id and s.institute_id = p_institute_id and s.archived_at is null
    and bizbook_private.can_access_branch(s.institute_id, s.branch_id);
  if not found or p_branch_id is distinct from v_student_branch_id then
    raise exception 'Student is unavailable in the selected institute branch.' using errcode = '22023';
  end if;

  v_fingerprint := md5(concat_ws('|', p_student_id, p_branch_id, p_receipt_kind, p_amount::text,
    p_method, p_payment_date::text, coalesce(p_reference, ''), coalesce(p_note, ''), p_allocations::text));
  if p_idempotency_key is not null then
    select p.* into v_existing from public.payments p
    where p.institute_id = p_institute_id and p.idempotency_key = p_idempotency_key for update;
    if found then
      if v_existing.request_fingerprint is distinct from v_fingerprint then
        raise exception 'The idempotency key was already used for different payment details.' using errcode = '23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  v_payment_id := coalesce(nullif(btrim(p_payment_id), ''), gen_random_uuid()::text);
  insert into public.payments (
    id, institute_id, branch_id, student_id, receipt_kind, amount, payment_date,
    method, mode, status, provider_reference, idempotency_key, request_fingerprint, note, created_by
  ) values (
    v_payment_id, p_institute_id, p_branch_id, p_student_id, p_receipt_kind, p_amount, p_payment_date,
    p_method, 'Manual', 'Paid', nullif(btrim(p_reference), ''), p_idempotency_key,
    v_fingerprint, nullif(btrim(p_note), ''), v_actor_id
  ) on conflict (institute_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_payment_id;

  if v_payment_id is null then
    select p.* into v_existing from public.payments p
    where p.institute_id = p_institute_id and p.idempotency_key = p_idempotency_key;
    if not found or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'The idempotency key conflicts with another payment request.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  v_allocation_kind := case when p_receipt_kind = 'Advance' then 'Advance' else 'Fee' end;
  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    v_installment_id := nullif(btrim(v_item->>'installment_id'), '');
    v_raw_allocation := (v_item->>'amount')::numeric;
    if v_installment_id is null or v_raw_allocation is null or v_raw_allocation <= 0
      or v_raw_allocation <> round(v_raw_allocation, 2) then
      raise exception 'Each installment allocation requires a valid ID and positive paise amount.' using errcode = '22023';
    end if;
    v_allocation_amount := v_raw_allocation;
    v_allocated_total := v_allocated_total + v_allocation_amount;
    if v_allocated_total > p_amount then
      raise exception 'Allocations exceed the received payment amount.' using errcode = '23514';
    end if;

    select i.scheduled_amount, i.status into v_scheduled_amount, v_installment_status
    from public.student_installments i
    where i.id = v_installment_id and i.institute_id = p_institute_id and i.student_id = p_student_id
      and i.branch_id is not distinct from p_branch_id
    for update;
    if not found then
      raise exception 'Installment does not belong to the selected student and branch.' using errcode = '23503';
    end if;
    if v_installment_status = 'Cancelled' then
      raise exception 'A cancelled installment cannot receive a payment.' using errcode = '23514';
    end if;

    select
      coalesce((
        select sum(pa.amount)
        from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
        where pa.institute_id = p_institute_id and pa.installment_id = v_installment_id
          and p.status in ('Paid', 'Partially Refunded', 'Refunded')
      ), 0)
      - coalesce((
        select sum(ra.amount)
        from public.refund_allocations ra
        join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
        join public.payment_allocations pa on pa.id = ra.payment_allocation_id and pa.institute_id = ra.institute_id
        where pa.institute_id = p_institute_id and pa.installment_id = v_installment_id
          and r.status = 'Completed'
      ), 0)
    into v_existing_paid;

    if v_existing_paid + v_allocation_amount > v_scheduled_amount then
      raise exception 'Allocation exceeds the installment outstanding balance.' using errcode = '23514';
    end if;
    insert into public.payment_allocations (
      institute_id, payment_id, student_id, installment_id, allocation_kind, amount, created_by
    ) values (
      p_institute_id, v_payment_id, p_student_id, v_installment_id, v_allocation_kind, v_allocation_amount, v_actor_id
    );
  end loop;
  return v_payment_id;
end;
$$;

create or replace function public.allocate_advance(p_payment_id text, p_installment_id text, p_amount numeric)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_available numeric(12,2);
  v_scheduled numeric(12,2);
  v_paid numeric(12,2);
  v_status text;
  v_raw_amount numeric;
  v_allocation_id text;
begin
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found or v_actor_id is null
    or not bizbook_private.has_institute_role(v_payment.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_payment.institute_id, v_payment.branch_id) then
    raise exception 'Authorized receipt access is required.' using errcode = '42501';
  end if;
  v_raw_amount := p_amount;
  if v_payment.receipt_kind <> 'Advance' or v_payment.status not in ('Paid', 'Partially Refunded') or v_raw_amount is null
    or v_raw_amount <= 0 or v_raw_amount <> round(v_raw_amount, 2) then
    raise exception 'A paid advance receipt and positive paise amount are required.' using errcode = '22023';
  end if;
  select i.scheduled_amount, i.status into v_scheduled, v_status
  from public.student_installments i
  where i.id = p_installment_id and i.institute_id = v_payment.institute_id
    and i.student_id = v_payment.student_id and i.branch_id is not distinct from v_payment.branch_id
  for update;
  if not found or v_status = 'Cancelled' then
    raise exception 'Installment is unavailable for this receipt.' using errcode = '23503';
  end if;

  select greatest(0::numeric, v_payment.amount
    - coalesce((select sum(pa.amount) from public.payment_allocations pa
        where pa.institute_id = v_payment.institute_id and pa.payment_id = v_payment.id), 0)
    - coalesce((select sum(greatest(0::numeric, r.amount - coalesce(x.allocated, 0)))
        from public.refunds r
        left join lateral (
          select sum(ra.amount) as allocated from public.refund_allocations ra
          where ra.refund_id = r.id and ra.institute_id = r.institute_id and ra.payment_id = r.payment_id
        ) x on true
        where r.institute_id = v_payment.institute_id and r.payment_id = v_payment.id
          and r.status in ('Pending', 'Processing', 'Completed')), 0))
  into v_available;
  if v_raw_amount > v_available then
    raise exception 'Advance allocation exceeds the unallocated receipt balance.' using errcode = '23514';
  end if;

  select
    coalesce((select sum(pa.amount) from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
      where pa.institute_id = v_payment.institute_id and pa.installment_id = p_installment_id
        and p.status in ('Paid', 'Partially Refunded', 'Refunded')), 0)
    - coalesce((select sum(ra.amount) from public.refund_allocations ra
      join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
      where ra.institute_id = v_payment.institute_id
        and ra.payment_allocation_id in (select pa.id from public.payment_allocations pa
          where pa.institute_id = v_payment.institute_id and pa.installment_id = p_installment_id)
        and r.status = 'Completed'), 0)
  into v_paid;
  if v_paid + v_raw_amount > v_scheduled then
    raise exception 'Advance allocation exceeds the installment outstanding balance.' using errcode = '23514';
  end if;

  insert into public.payment_allocations (
    institute_id, payment_id, student_id, installment_id, allocation_kind, amount, created_by
  ) values (
    v_payment.institute_id, v_payment.id, v_payment.student_id, p_installment_id, 'Advance', v_raw_amount, v_actor_id
  ) returning id into v_allocation_id;
  return v_allocation_id;
end;
$$;

revoke all on function public.record_manual_payment(text, text, text, text, numeric, text, date, text, text, jsonb, text, text) from public, anon;
revoke all on function public.allocate_advance(text, text, numeric) from public, anon;
grant execute on function public.record_manual_payment(text, text, text, text, numeric, text, date, text, text, jsonb, text, text) to authenticated;
grant execute on function public.allocate_advance(text, text, numeric) to authenticated;
comment on function public.record_manual_payment(text, text, text, text, numeric, text, date, text, text, jsonb, text, text)
  is 'Atomically records one manual receipt and optional allocations; institute-scoped idempotency prevents duplicate submission.';
comment on function public.allocate_advance(text, text, numeric)
  is 'Atomically allocates existing receipt balance; an allocation is not a new inflow.';

