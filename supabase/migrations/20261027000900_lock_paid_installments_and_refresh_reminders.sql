-- Lock installment terms after a payment, and prevent an active checkout from
-- retaining an outdated amount or due date.
create or replace function bizbook_private.guard_installment_terms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_net_paid numeric(12,2);
  v_terms_changed boolean;
begin
  v_terms_changed := new.scheduled_amount is distinct from old.scheduled_amount
    or new.due_date is distinct from old.due_date;
  if not v_terms_changed then
    return new;
  end if;

  select greatest(0::numeric,
    coalesce((select sum(pa.amount)
      from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
      where pa.institute_id = old.institute_id and pa.installment_id = old.id
        and p.status in ('Paid', 'Partially Refunded', 'Refunded')), 0)
    - coalesce((select sum(ra.amount)
      from public.refund_allocations ra
      join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
      join public.payment_allocations pa on pa.id = ra.payment_allocation_id and pa.institute_id = ra.institute_id
      where pa.institute_id = old.institute_id and pa.installment_id = old.id
        and r.status = 'Completed'), 0)
  ) into v_net_paid;

  if old.status in ('Paid', 'Partially Paid') or v_net_paid > 0 then
    raise exception 'An installment with a recorded payment cannot be changed.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.payment_orders o
    where o.institute_id = old.institute_id
      and o.installment_id = old.id
      and o.order_status in ('Processing', 'Pending', 'Authorized')
  ) then
    raise exception 'An installment with an active online checkout cannot be changed.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function bizbook_private.guard_installment_terms() from public, anon, authenticated;
drop trigger if exists installment_terms_guard on public.student_installments;
create trigger installment_terms_guard
before update of scheduled_amount, due_date on public.student_installments
for each row execute function bizbook_private.guard_installment_terms();

-- A changed amount starts a new reminder schedule version just like a changed
-- due date, so future reminders use the new installment balance and terms.
create or replace function bizbook_private.bump_reminder_schedule_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.due_date is distinct from old.due_date
     or new.scheduled_amount is distinct from old.scheduled_amount then
    new.reminder_schedule_version := old.reminder_schedule_version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists installment_reminder_schedule_version on public.student_installments;
create trigger installment_reminder_schedule_version
before update of due_date, scheduled_amount on public.student_installments
for each row execute function bizbook_private.bump_reminder_schedule_version();

comment on function bizbook_private.guard_installment_terms() is
  'Prevents edits to installment amount or due date after any payment and while an online checkout reserves the installment.';
