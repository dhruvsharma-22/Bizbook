-- The client generates one opaque request ID per pending submit. A matching retry
-- returns the original expense; reusing that ID for different details is rejected.
alter table public.expenses add column request_fingerprint text;
comment on column public.expenses.request_fingerprint is
  'Server-generated fingerprint for retry-safe expense creation; never supplied as a trusted verification value.';

create or replace function public.record_expense(
  p_expense_id text,
  p_institute_id text,
  p_branch_id text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
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
    or p_title is null or length(btrim(p_title)) = 0 or length(btrim(p_title)) > 120
    or p_category is null or length(btrim(p_category)) = 0 or length(btrim(p_category)) > 100
    or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2)
    or p_expense_date is null
    or p_method is null or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')
    or (p_notes is not null and length(btrim(p_notes)) > 500) then
    raise exception 'Expense details are invalid.' using errcode = '22023';
  end if;
  if not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;

  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i
  where i.id = p_institute_id;
  if not found or p_expense_date > v_business_date then
    raise exception 'Expense date cannot be after the institute business date.' using errcode = '22023';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'institute_id', p_institute_id,
    'branch_id', p_branch_id,
    'title', btrim(p_title),
    'category', btrim(p_category),
    'amount', p_amount::numeric(12,2)::text,
    'expense_date', p_expense_date::text,
    'method', p_method,
    'notes', nullif(btrim(p_notes), '')
  )::text);

  select e.* into v_existing
  from public.expenses e
  where e.id = p_expense_id and e.institute_id = p_institute_id
  for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint then
      raise exception 'The expense request ID was already used for different details.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  insert into public.expenses (
    id, institute_id, branch_id, title, category, amount, expense_date, method,
    notes, legacy_data, created_by, request_fingerprint
  ) values (
    p_expense_id, p_institute_id, p_branch_id, btrim(p_title), btrim(p_category),
    p_amount::numeric(12,2), p_expense_date, p_method, nullif(btrim(p_notes), ''),
    '{}'::jsonb, v_actor_id, v_fingerprint
  ) on conflict (id) do nothing
  returning id into v_expense_id;

  if v_expense_id is not null then return v_expense_id; end if;

  select e.* into v_existing from public.expenses e where e.id = p_expense_id for update;
  if not found or v_existing.institute_id is distinct from p_institute_id
    or v_existing.request_fingerprint is distinct from v_fingerprint then
    raise exception 'The expense request ID conflicts with another expense.' using errcode = '23505';
  end if;
  return v_existing.id;
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
    and e.expense_date >= p_month_start
    and e.expense_date < (p_month_start + interval '1 month')::date;
end;
$$;

create or replace function public.update_expense(
  p_expense_id text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_method text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_expense public.expenses%rowtype;
  v_business_date date;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_expense_id is null or length(btrim(p_expense_id)) = 0
    or p_title is null or length(btrim(p_title)) = 0 or length(btrim(p_title)) > 120
    or p_category is null or length(btrim(p_category)) = 0 or length(btrim(p_category)) > 100
    or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2)
    or p_expense_date is null
    or p_method is null or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')
    or (p_notes is not null and length(btrim(p_notes)) > 500) then
    raise exception 'Expense details are invalid.' using errcode = '22023';
  end if;

  select e.* into v_expense from public.expenses e where e.id = p_expense_id for update;
  if not found
    or not bizbook_private.has_institute_role(v_expense.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_expense.institute_id, v_expense.branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;
  if v_expense.voided_at is not null then
    raise exception 'A voided expense cannot be edited.' using errcode = '23514';
  end if;
  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = v_expense.institute_id;
  if not found or p_expense_date > v_business_date then
    raise exception 'Expense date cannot be after the institute business date.' using errcode = '22023';
  end if;

  if v_expense.title is not distinct from btrim(p_title)
    and v_expense.category is not distinct from btrim(p_category)
    and v_expense.amount is not distinct from p_amount::numeric(12,2)
    and v_expense.expense_date is not distinct from p_expense_date
    and v_expense.method is not distinct from p_method
    and v_expense.notes is not distinct from nullif(btrim(p_notes), '') then
    return;
  end if;

  update public.expenses
  set title = btrim(p_title),
      category = btrim(p_category),
      amount = p_amount::numeric(12,2),
      expense_date = p_expense_date,
      method = p_method,
      notes = nullif(btrim(p_notes), '')
  where id = v_expense.id and institute_id = v_expense.institute_id and voided_at is null;
end;
$$;

-- All client writes now go through functions that enforce business-date and
-- audit rules. The browser still has SELECT-only access for shared expenses.
revoke insert on table public.expenses from authenticated;
revoke insert (institute_id, branch_id, title, category, amount, expense_date, method, notes, legacy_data)
  on table public.expenses from authenticated;
revoke update on table public.expenses from authenticated;
revoke update (branch_id, title, category, amount, expense_date, method, notes, legacy_data)
  on table public.expenses from authenticated;

revoke all on function public.record_expense(text, text, text, text, text, numeric, date, text, text)
  from public, anon, service_role;
grant execute on function public.record_expense(text, text, text, text, text, numeric, date, text, text)
  to authenticated;
revoke all on function public.update_expense(text, text, text, numeric, date, text, text)
  from public, anon, service_role;
grant execute on function public.update_expense(text, text, text, numeric, date, text, text)
  to authenticated;
revoke all on function public.expense_month_summary(text, text, date)
  from public, anon, service_role;
grant execute on function public.expense_month_summary(text, text, date)
  to authenticated;
comment on function public.record_expense(text, text, text, text, text, numeric, date, text, text) is
  'Records one auditable institute expense; matching request retries return the same row and changed requests are rejected.';
comment on function public.update_expense(text, text, text, numeric, date, text, text) is
  'Updates an active expense under institute/branch authorization and business-date rules; the audit trigger records the change.';
comment on function public.expense_month_summary(text, text, date) is
  'Returns exact non-voided expense totals and count for one institute, authorized branch scope, and business month.';
