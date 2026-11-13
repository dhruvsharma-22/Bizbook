-- Prevent financial allocations from changing the retained history of archived students.
-- Lock order is payment -> student (SHARE) -> installment. Student archival takes
-- an UPDATE lock on the student row, so an allocation cannot race past a completed archive.
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
  v_student_archived_at timestamptz;
begin
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found or v_actor_id is null
    or not bizbook_private.has_institute_role(v_payment.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_payment.institute_id, v_payment.branch_id) then
    raise exception 'Authorized receipt access is required.' using errcode = '42501';
  end if;
  select s.archived_at into v_student_archived_at
  from public.students s
  where s.id = v_payment.student_id and s.institute_id = v_payment.institute_id
  for share;
  if not found or v_student_archived_at is not null then
    raise exception 'Archived students cannot receive advance allocations.' using errcode = '23514';
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

comment on function public.allocate_advance(text, text, numeric)
  is 'Atomically allocates an existing receipt balance to an active student installment; an allocation is not a new inflow.';
