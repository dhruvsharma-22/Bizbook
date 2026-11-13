-- Track an expense obligation separately from its later full settlement.
-- Cash expense summaries and payment history include paid expenses only.
alter table public.expenses
  alter column method drop not null,
  add column payment_status text not null default 'paid',
  add column payment_due_date date,
  add column paid_at date;

update public.expenses
set paid_at = expense_date
where paid_at is null;

alter table public.expenses
  add constraint expenses_payment_status_valid check (payment_status in ('paid', 'unpaid')),
  add constraint expenses_payment_state_consistent check (
    (payment_status = 'paid' and method is not null and paid_at is not null)
    or (payment_status = 'unpaid' and method is null and paid_at is null and payment_due_date is not null)
  );

create or replace function bizbook_private.normalize_expense_payment_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_status = 'paid' then
    if new.method is null then
      raise exception 'A paid expense requires a payment method.' using errcode = '23514';
    end if;
    new.paid_at := coalesce(new.paid_at, new.expense_date);
  elsif new.payment_status = 'unpaid' then
    if new.payment_due_date is null then
      raise exception 'An unpaid expense requires a payment due date.' using errcode = '23514';
    end if;
    new.method := null;
    new.paid_at := null;
  else
    raise exception 'Expense payment status is invalid.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger expenses_normalize_payment_state
  before insert or update of payment_status, method, paid_at, payment_due_date on public.expenses
  for each row execute function bizbook_private.normalize_expense_payment_state();
revoke all on function bizbook_private.normalize_expense_payment_state() from public, anon, authenticated, service_role;

create or replace function public.record_expense_entry(
  p_expense_id text,
  p_institute_id text,
  p_branch_id text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_payment_status text,
  p_payment_due_date date,
  p_paid_at date,
  p_method text,
  p_notes text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_business_date date;
  v_fingerprint text;
  v_existing public.expenses%rowtype;
  v_expense_id text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_expense_id is null or p_expense_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_institute_id is null or length(btrim(p_institute_id)) = 0
    or p_title is null or length(btrim(p_title)) not between 1 and 120
    or p_category is null or length(btrim(p_category)) not between 1 and 100
    or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2)
    or p_expense_date is null
    or p_payment_status is null or p_payment_status not in ('paid', 'unpaid')
    or (p_notes is not null and length(btrim(p_notes)) > 500)
    or (p_payment_status = 'paid' and (p_paid_at is null or p_method is null or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')))
    or (p_payment_status = 'unpaid' and (p_payment_due_date is null or p_paid_at is not null or p_method is not null)) then
    raise exception 'Expense details are invalid.' using errcode = '22023';
  end if;
  if not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;

  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = p_institute_id;
  if not found or p_expense_date > v_business_date or (p_paid_at is not null and p_paid_at > v_business_date) then
    raise exception 'Expense and payment dates cannot be after the institute business date.' using errcode = '22023';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'institute_id', p_institute_id, 'branch_id', p_branch_id,
    'title', btrim(p_title), 'category', btrim(p_category),
    'amount', p_amount::numeric(12,2)::text, 'expense_date', p_expense_date::text,
    'payment_status', p_payment_status, 'payment_due_date', p_payment_due_date::text,
    'paid_at', p_paid_at::text, 'method', p_method,
    'notes', nullif(btrim(p_notes), '')
  )::text);

  select e.* into v_existing from public.expenses e
  where e.id = p_expense_id and e.institute_id = p_institute_id for update;
  if found then
    if v_existing.voided_at is not null or v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'The expense request ID was already used for a different or voided entry.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  insert into public.expenses (
    id, institute_id, branch_id, title, category, amount, expense_date, method,
    notes, legacy_data, created_by, request_fingerprint, payment_status, payment_due_date, paid_at
  ) values (
    p_expense_id, p_institute_id, p_branch_id, btrim(p_title), btrim(p_category),
    p_amount::numeric(12,2), p_expense_date, p_method, nullif(btrim(p_notes), ''),
    '{}'::jsonb, v_actor_id, v_fingerprint, p_payment_status, p_payment_due_date, p_paid_at
  ) on conflict (id) do nothing
  returning id into v_expense_id;
  if v_expense_id is not null then return v_expense_id; end if;

  select e.* into v_existing from public.expenses e where e.id = p_expense_id for update;
  if not found or v_existing.institute_id is distinct from p_institute_id
    or v_existing.voided_at is not null or v_existing.request_fingerprint is distinct from v_fingerprint then
    raise exception 'The expense request ID conflicts with another entry.' using errcode = '23505';
  end if;
  return v_existing.id;
end;
$$;

create or replace function public.record_expense_payment(
  p_expense_id text,
  p_paid_at date,
  p_method text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expense public.expenses%rowtype;
  v_business_date date;
begin
  if auth.uid() is null or p_expense_id is null or length(btrim(p_expense_id)) = 0
    or p_paid_at is null or p_method is null
    or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other') then
    raise exception 'Expense payment details are invalid.' using errcode = '22023';
  end if;
  select e.* into v_expense from public.expenses e where e.id = p_expense_id for update;
  if not found
    or not bizbook_private.has_institute_role(v_expense.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_expense.institute_id, v_expense.branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;
  if v_expense.voided_at is not null then
    raise exception 'A voided expense cannot be paid.' using errcode = '23514';
  end if;
  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = v_expense.institute_id;
  if not found or p_paid_at > v_business_date then
    raise exception 'Payment date cannot be after the institute business date.' using errcode = '22023';
  end if;
  if v_expense.payment_status = 'paid' then
    if v_expense.paid_at = p_paid_at and v_expense.method = p_method then return v_expense.id; end if;
    raise exception 'This expense is already recorded as paid.' using errcode = '23505';
  end if;
  update public.expenses
  set payment_status = 'paid', paid_at = p_paid_at, method = p_method
  where id = v_expense.id and institute_id = v_expense.institute_id and payment_status = 'unpaid' and voided_at is null;
  return v_expense.id;
end;
$$;

create or replace function public.expense_month_summary(
  p_institute_id text,
  p_branch_id text,
  p_month_start date
)
returns table(month_total numeric, expense_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'A valid first day of a month is required.' using errcode = '22023';
  end if;
  return query
  select coalesce(sum(e.amount), 0)::numeric, count(*)::bigint
  from public.expenses e
  where e.institute_id = p_institute_id
    and (p_branch_id is null or e.branch_id = p_branch_id)
    and e.voided_at is null
    and e.payment_status = 'paid'
    and e.paid_at >= p_month_start
    and e.paid_at < (p_month_start + interval '1 month')::date;
end;
$$;

create or replace view public.payment_history
with (security_invoker = true)
as
select
  p.id, p.institute_id, p.branch_id,
  case when p.receipt_kind = 'Advance' then 'Advance' else 'Fee' end::text as type,
  p.student_id as person_id, s.name as person_name,
  case when p.receipt_kind = 'Advance' then 'Advance receipt' else 'Fee receipt' end::text as description,
  p.amount, (p.payment_date::timestamp at time zone 'UTC') as paid_at, p.method
from public.payments p
join public.students s on s.id = p.student_id and s.institute_id = p.institute_id
where p.status in ('Paid', 'Partially Refunded', 'Refunded')
union all
select concat(sp.staff_id, ':', sp.payroll_month), sp.institute_id, sp.branch_id,
  'Salary'::text, sp.staff_id, st.name, concat('Salary for ', sp.payroll_month),
  sp.amount, sp.paid_at, sp.method
from public.salary_payments sp
join public.staff st on st.id = sp.staff_id and st.institute_id = sp.institute_id
union all
select e.id, e.institute_id, e.branch_id, 'Expense'::text, e.id, e.title,
  e.category, e.amount, (e.paid_at::timestamp at time zone 'UTC'), e.method
from public.expenses e
where e.voided_at is null and e.payment_status = 'paid';

create or replace view public.financial_activity
with (security_invoker = true)
as
select p.id as source_id, p.institute_id, p.branch_id, 'receipt'::text as source_type,
  case when p.receipt_kind = 'Advance' then 'student_advance_receipt' else 'student_fee_receipt' end::text as category,
  p.amount as amount, 'inflow'::text as direction, p.payment_date::date as activity_date
from public.payments p where p.status in ('Paid', 'Partially Refunded', 'Refunded')
union all
select r.id, r.institute_id, r.branch_id, 'refund'::text, 'student_refund'::text,
  -r.amount, 'outflow'::text, r.completed_at::date
from public.refunds r where r.status = 'Completed'
union all
select concat(sp.staff_id, ':', sp.payroll_month), sp.institute_id, sp.branch_id,
  'salary_payment'::text, 'salary_expense'::text, -sp.amount, 'outflow'::text, sp.paid_at::date
from public.salary_payments sp
union all
select e.id, e.institute_id, e.branch_id, 'expense'::text, 'business_expense'::text,
  -e.amount, 'outflow'::text, e.paid_at
from public.expenses e where e.voided_at is null and e.payment_status = 'paid';

revoke all on function public.record_expense_entry(text, text, text, text, text, numeric, date, text, date, date, text, text)
  from public, anon, service_role;
grant execute on function public.record_expense_entry(text, text, text, text, text, numeric, date, text, date, date, text, text)
  to authenticated;
revoke all on function public.record_expense_payment(text, date, text) from public, anon, service_role;
grant execute on function public.record_expense_payment(text, date, text) to authenticated;

comment on column public.expenses.payment_status is 'Whether this expense obligation has been fully settled; only paid rows appear in cash outflow history.';
comment on column public.expenses.payment_due_date is 'Due date for an unpaid expense, used for the institute overdue expense list.';
comment on column public.expenses.paid_at is 'Institute-local date the full expense amount was actually paid.';
comment on function public.record_expense_entry(text, text, text, text, text, numeric, date, text, date, date, text, text) is
  'Records an expense obligation as unpaid or paid, with idempotent retries and institute/branch authorization.';
comment on function public.record_expense_payment(text, date, text) is
  'Marks one unpaid expense fully paid after recording the actual payment date and method; retries are idempotent.';
