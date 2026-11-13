-- Correct live branch scoping, reconciliation visibility, and institute-local overdue dates.
-- This is additive because 20261014000100 is already recorded remotely but its policy change
-- is absent from the live catalog. No business rows are rewritten.

create or replace function bizbook_private.can_access_branch(p_institute_id text, p_branch_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.user_memberships m
    where m.institute_id = p_institute_id
      and m.user_id = (select auth.uid())
      and m.is_active
      and (
        (p_branch_id is null and m.access_scope = 'institute')
        or (
          p_branch_id is not null
          and exists (
            select 1
            from public.branches b
            where b.institute_id = p_institute_id
              and b.id = p_branch_id
              and b.is_active
          )
          and (
            m.access_scope = 'institute'
            or exists (
              select 1
              from public.membership_branch_access mba
              where mba.institute_id = m.institute_id
                and mba.user_id = m.user_id
                and mba.branch_id = p_branch_id
            )
          )
        )
      )
  );
$$;

alter policy branches_select_accessible on public.branches
  using (
    bizbook_private.can_manage_institute(institute_id)
    or bizbook_private.can_access_branch(institute_id, id)
  );

alter policy reconciliation_select_finance on public.payment_reconciliation_records
  using (
    bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and (
      bizbook_private.can_access_branch(institute_id, null)
      or (
        payment_id is not null
        and exists (
          select 1
          from public.payments p
          where p.id = payment_reconciliation_records.payment_id
            and p.institute_id = payment_reconciliation_records.institute_id
            and bizbook_private.can_access_branch(p.institute_id, p.branch_id)
        )
      )
    )
  );

create or replace view public.installment_balances
with (security_invoker = true)
as
select
  i.id as installment_id,
  i.institute_id,
  i.branch_id,
  i.student_id,
  i.sequence_number,
  i.scheduled_amount,
  i.due_date,
  i.status as scheduled_status,
  greatest(0::numeric, coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0))::numeric(12,2) as paid_amount,
  case when i.status = 'Cancelled' then 0::numeric(12,2)
    else greatest(0::numeric, i.scheduled_amount - greatest(0::numeric, coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0)))::numeric(12,2)
  end as outstanding_amount,
  case
    when i.status = 'Cancelled' then 'Cancelled'
    when greatest(0::numeric, i.scheduled_amount - greatest(0::numeric, coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0))) = 0 then 'Paid'
    when coalesce(a.allocated_amount, 0) - coalesce(r.refunded_amount, 0) > 0 then 'Partially Paid'
    when i.due_date is not null and i.due_date < (now() at time zone inst.time_zone)::date then 'Overdue'
    else 'Pending'
  end as balance_status
from public.student_installments i
join public.coaching_institutes inst on inst.id = i.institute_id
left join lateral (
  select sum(pa.amount) as allocated_amount
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id and p.institute_id = pa.institute_id
  where pa.institute_id = i.institute_id
    and pa.installment_id = i.id
    and p.status in ('Paid', 'Partially Refunded', 'Refunded')
) a on true
left join lateral (
  select sum(ra.amount) as refunded_amount
  from public.refund_allocations ra
  join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
  where ra.institute_id = i.institute_id
    and ra.payment_allocation_id in (
      select pa.id from public.payment_allocations pa
      where pa.institute_id = i.institute_id and pa.installment_id = i.id
    )
    and r.status = 'Completed'
) r on true;
