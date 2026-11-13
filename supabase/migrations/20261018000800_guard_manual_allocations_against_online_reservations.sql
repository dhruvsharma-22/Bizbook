-- Keep manual and online receipts on one installment ledger. A pending online
-- order reserves part of an installment; manual/advance allocations may use
-- only the unreserved remainder. The installment row lock serializes this
-- check with online order creation and provider finalization.

create or replace function bizbook_private.guard_manual_allocation_reservations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_mode text;
  v_scheduled_amount numeric(12,2);
  v_paid_amount numeric(12,2);
  v_completed_refunds numeric(12,2);
  v_reserved_amount numeric(12,2);
begin
  select p.mode into v_payment_mode
    from public.payments p
   where p.institute_id = new.institute_id and p.id = new.payment_id;

  if v_payment_mode is distinct from 'Manual' then
    return new;
  end if;

  select i.scheduled_amount into v_scheduled_amount
    from public.student_installments i
   where i.institute_id = new.institute_id
     and i.id = new.installment_id
     and i.student_id = new.student_id
   for update;

  if not found then
    raise exception using errcode = '23503', message = 'Installment does not belong to the selected student and institute';
  end if;

  select coalesce(sum(pa.amount), 0)::numeric(12,2)
    into v_paid_amount
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
   where pa.institute_id = new.institute_id
     and pa.installment_id = new.installment_id
     and p.status in ('Paid', 'Partially Refunded', 'Refunded');

  select coalesce(sum(ra.amount), 0)::numeric(12,2)
    into v_completed_refunds
    from public.refund_allocations ra
    join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
    join public.payment_allocations pa on pa.id = ra.payment_allocation_id and pa.institute_id = ra.institute_id
   where pa.institute_id = new.institute_id
     and pa.installment_id = new.installment_id
     and r.status = 'Completed';

  select coalesce(sum(o.allocation_amount), 0)::numeric(12,2)
    into v_reserved_amount
    from public.payment_orders o
   where o.institute_id = new.institute_id
     and o.installment_id = new.installment_id
     and o.order_status in ('Processing', 'Pending', 'Authorized');

  if v_paid_amount - v_completed_refunds + new.amount + v_reserved_amount > v_scheduled_amount then
    raise exception using errcode = '23514',
      message = 'This installment has an active online checkout reservation or insufficient remaining balance';
  end if;

  return new;
end;
$$;

revoke all on function bizbook_private.guard_manual_allocation_reservations() from public, anon, authenticated;

drop trigger if exists manual_allocation_reservation_guard on public.payment_allocations;
create trigger manual_allocation_reservation_guard
  before insert on public.payment_allocations
  for each row execute function bizbook_private.guard_manual_allocation_reservations();

comment on function bizbook_private.guard_manual_allocation_reservations() is
  'Serializes manual installment allocations against active online payment reservations to prevent over-collection.';
