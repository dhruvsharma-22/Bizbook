-- Refund reservations, manual completion, salary recording and expense reversal.

create or replace function public.request_refund(
  p_payment_id text, p_amount numeric, p_reason text, p_mode text,
  p_allocation_breakdown jsonb default '[]'::jsonb, p_refund_id text default null
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_refund_id text;
  v_item jsonb;
  v_allocation_id text;
  v_amount numeric(12,2);
  v_raw_amount numeric;
  v_allocated numeric(12,2) := 0;
  v_reserved numeric(12,2);
  v_allocation_total numeric(12,2);
  v_prior_refunds numeric(12,2);
  v_prior_unallocated numeric(12,2);
  v_available_advance numeric(12,2);
begin
  select p.* into v_payment from public.payments p where p.id = p_payment_id for update;
  if not found or v_actor_id is null
    or not bizbook_private.has_institute_role(v_payment.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_payment.institute_id, v_payment.branch_id) then
    raise exception 'Authorized receipt access is required.' using errcode = '42501';
  end if;
  if v_payment.status not in ('Paid', 'Partially Refunded')
    or p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
    or p_reason is null or length(btrim(p_reason)) = 0
    or p_mode is null or p_mode not in ('Manual', 'Online')
    or p_allocation_breakdown is null or jsonb_typeof(p_allocation_breakdown) <> 'array' then
    raise exception 'Refund details must be valid positive paise amounts.' using errcode = '22023';
  end if;
  if p_mode = 'Online' and v_payment.mode <> 'Online' then
    raise exception 'An online refund requires an online provider payment.' using errcode = '22023';
  end if;

  select coalesce(sum(r.amount), 0) into v_prior_refunds
  from public.refunds r
  where r.institute_id = v_payment.institute_id and r.payment_id = v_payment.id
    and r.status in ('Pending', 'Processing', 'Completed');
  if v_prior_refunds + p_amount > v_payment.amount then
    raise exception 'Refund requests exceed the refundable receipt balance.' using errcode = '23514';
  end if;

  v_refund_id := coalesce(nullif(btrim(p_refund_id), ''), gen_random_uuid()::text);
  insert into public.refunds (
    id, institute_id, branch_id, payment_id, student_id, amount, reason, mode, requested_by
  ) values (
    v_refund_id, v_payment.institute_id, v_payment.branch_id, v_payment.id,
    v_payment.student_id, p_amount, btrim(p_reason), p_mode, v_actor_id
  );

  for v_item in select value from jsonb_array_elements(p_allocation_breakdown)
  loop
    v_allocation_id := nullif(btrim(v_item->>'payment_allocation_id'), '');
    v_raw_amount := (v_item->>'amount')::numeric;
    if v_allocation_id is null or v_raw_amount is null or v_raw_amount <= 0
      or v_raw_amount <> round(v_raw_amount, 2) then
      raise exception 'Each refund allocation requires an original allocation and positive paise amount.' using errcode = '22023';
    end if;
    v_amount := v_raw_amount;
    select pa.amount into v_allocation_total
    from public.payment_allocations pa
    where pa.id = v_allocation_id and pa.institute_id = v_payment.institute_id and pa.payment_id = v_payment.id
    for update;
    if not found then
      raise exception 'Refund allocation must reference this receipt.' using errcode = '23503';
    end if;
    select coalesce(sum(ra.amount), 0) into v_reserved
    from public.refund_allocations ra
    join public.refunds r on r.id = ra.refund_id and r.institute_id = ra.institute_id
    where ra.payment_allocation_id = v_allocation_id and ra.institute_id = v_payment.institute_id
      and r.status in ('Pending', 'Processing', 'Completed');
    if v_reserved + v_amount > v_allocation_total then
      raise exception 'Refund allocation exceeds the eligible original installment payment.' using errcode = '23514';
    end if;
    v_allocated := v_allocated + v_amount;
    if v_allocated > p_amount then
      raise exception 'Refund allocation details exceed the refund amount.' using errcode = '23514';
    end if;
    insert into public.refund_allocations (
      institute_id, refund_id, payment_id, payment_allocation_id, amount
    ) values (
      v_payment.institute_id, v_refund_id, v_payment.id, v_allocation_id, v_amount
    );
  end loop;

  select coalesce(sum(greatest(0::numeric, r.amount - coalesce(x.allocated, 0))), 0)
  into v_prior_unallocated
  from public.refunds r
  left join lateral (
    select sum(ra.amount) as allocated from public.refund_allocations ra
    where ra.refund_id = r.id and ra.institute_id = r.institute_id and ra.payment_id = r.payment_id
  ) x on true
  where r.institute_id = v_payment.institute_id and r.payment_id = v_payment.id
    and r.id <> v_refund_id and r.status in ('Pending', 'Processing', 'Completed');
  select coalesce(sum(pa.amount), 0) into v_allocation_total
  from public.payment_allocations pa
  where pa.institute_id = v_payment.institute_id and pa.payment_id = v_payment.id;
  v_available_advance := greatest(0::numeric, v_payment.amount - v_allocation_total - v_prior_unallocated);
  if p_amount - v_allocated > v_available_advance then
    raise exception 'Refund exceeds available unallocated advance balance.' using errcode = '23514';
  end if;
  return v_refund_id;
end;
$$;

create or replace function public.complete_manual_refund(p_refund_id text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_refund public.refunds%rowtype;
  v_completed_total numeric(12,2);
  v_payment_amount numeric(12,2);
begin
  select r.* into v_refund from public.refunds r where r.id = p_refund_id for update;
  if not found or auth.uid() is null
    or not bizbook_private.has_institute_role(v_refund.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_refund.institute_id, v_refund.branch_id) then
    raise exception 'Authorized refund access is required.' using errcode = '42501';
  end if;
  if v_refund.mode <> 'Manual' or v_refund.status not in ('Pending', 'Processing') then
    raise exception 'Only a pending manual refund can be confirmed here.' using errcode = '22023';
  end if;

  update public.refunds
  set status = 'Completed', completed_at = now(), completed_by = auth.uid(), updated_at = now()
  where id = v_refund.id;
  select coalesce(sum(r.amount), 0) into v_completed_total
  from public.refunds r
  where r.institute_id = v_refund.institute_id and r.payment_id = v_refund.payment_id and r.status = 'Completed';
  select p.amount into v_payment_amount from public.payments p
  where p.id = v_refund.payment_id and p.institute_id = v_refund.institute_id for update;
  update public.payments
  set status = case when v_completed_total >= v_payment_amount then 'Refunded' else 'Partially Refunded' end,
      updated_at = now()
  where id = v_refund.payment_id and institute_id = v_refund.institute_id;
end;
$$;

create or replace function public.record_salary_payment(
  p_institute_id text, p_branch_id text, p_staff_id text, p_payroll_month text,
  p_amount numeric, p_paid_at timestamptz, p_method text default null,
  p_reference text default null, p_notes text default null,
  p_manual_adjustment numeric default null
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_month_start date;
  v_unpaid_days integer := 0;
  v_attendance_deduction numeric(12,2) := 0;
  v_base_payable numeric(12,2);
  v_expected_amount numeric(12,2);
  v_time_zone text;
  v_business_date date;
begin
  if auth.uid() is null
    or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized institute financial access is required.' using errcode = '42501';
  end if;
  select i.time_zone, (now() at time zone i.time_zone)::date
    into v_time_zone, v_business_date
  from public.coaching_institutes i where i.id = p_institute_id;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
    or p_paid_at is null or p_payroll_month is null or p_staff_id is null
    or (p_paid_at at time zone v_time_zone)::date > v_business_date
    or p_payroll_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
    or (p_method is not null and p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other'))
    or (p_manual_adjustment is not null and p_manual_adjustment <> round(p_manual_adjustment, 2)) then
    raise exception 'Salary payment details are invalid.' using errcode = '22023';
  end if;
  select s.* into v_staff from public.staff s
  where s.id = p_staff_id and s.institute_id = p_institute_id and s.archived_at is null
    and bizbook_private.can_access_branch(s.institute_id, s.branch_id)
  for update;
  if not found or p_branch_id is distinct from v_staff.branch_id then
    raise exception 'Staff member is unavailable in the selected institute branch.' using errcode = '22023';
  end if;
  v_month_start := make_date(left(p_payroll_month, 4)::integer, right(p_payroll_month, 2)::integer, 1);
  if v_staff.manual_payable_amount is null
     and v_staff.attendance_enabled
     and v_staff.salary_calculation_mode = 'AttendanceBased' then
    select count(*)::integer into v_unpaid_days
    from public.attendance_records a
    where a.institute_id = p_institute_id and a.staff_id = p_staff_id
      and a.attendance_date >= greatest(v_month_start, coalesce(v_staff.joining_date, v_month_start))
      and a.attendance_date < (v_month_start + interval '1 month')::date
      and a.status in ('Absent', 'Leave');
    v_attendance_deduction := round(v_unpaid_days * v_staff.per_day_leave_cut, 2);
  end if;
  v_base_payable := coalesce(
    v_staff.manual_payable_amount,
    greatest(0, v_staff.monthly_salary - v_attendance_deduction)
  );
  v_expected_amount := greatest(0, round(v_base_payable + coalesce(p_manual_adjustment, 0), 2));
  if v_expected_amount <= 0 or p_amount <> v_expected_amount then
    raise exception 'Salary amount must equal the current full payable amount (%).', v_expected_amount
      using errcode = '22023';
  end if;
  insert into public.salary_payments (
    institute_id, branch_id, staff_id, payroll_month, base_salary, manual_payable_amount,
    amount, paid_at, method, reference, notes, salary_calculation_mode,
    attendance_deduction, manual_adjustment, created_by
  ) values (
    p_institute_id, p_branch_id, p_staff_id, p_payroll_month, v_staff.monthly_salary,
    v_staff.manual_payable_amount, p_amount, p_paid_at, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''), v_staff.salary_calculation_mode,
    v_attendance_deduction, coalesce(p_manual_adjustment, 0), auth.uid()
  );
end;
$$;

create or replace function public.void_expense(p_expense_id text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
begin
  select e.* into v_expense from public.expenses e where e.id = p_expense_id for update;
  if not found or auth.uid() is null
    or not bizbook_private.has_institute_role(v_expense.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_expense.institute_id, v_expense.branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;
  if v_expense.voided_at is not null or p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A valid reason is required to void an active expense.' using errcode = '22023';
  end if;
  update public.expenses
  set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason), updated_at = now()
  where id = p_expense_id;
end;
$$;

revoke all on function public.request_refund(text, numeric, text, text, jsonb, text) from public, anon;
revoke all on function public.complete_manual_refund(text) from public, anon;
revoke all on function public.record_salary_payment(text, text, text, text, numeric, timestamptz, text, text, text, numeric) from public, anon;
revoke all on function public.void_expense(text, text) from public, anon;
grant execute on function public.request_refund(text, numeric, text, text, jsonb, text) to authenticated;
grant execute on function public.complete_manual_refund(text) to authenticated;
grant execute on function public.record_salary_payment(text, text, text, text, numeric, timestamptz, text, text, text, numeric) to authenticated;
grant execute on function public.void_expense(text, text) to authenticated;

comment on function public.request_refund(text, numeric, text, text, jsonb, text)
  is 'Creates a pending refund and reserves its balance under a receipt row lock. Online completion requires provider confirmation outside this function.';
comment on function public.complete_manual_refund(text)
  is 'Confirms only a pending manual refund; online provider refunds cannot be completed through this client function.';

