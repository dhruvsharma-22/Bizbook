create table public.recurring_expense_rules (
  id uuid primary key,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  branch_id text,
  title text not null check (length(btrim(title)) between 1 and 120),
  category text not null check (length(btrim(category)) between 1 and 100),
  amount numeric(12,2) not null check (amount > 0),
  default_method text not null check (default_method in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')),
  due_day smallint not null check (due_day between 1 and 28),
  start_month date not null check (start_month = date_trunc('month', start_month)::date),
  ends_on date,
  notes text check (notes is null or length(btrim(notes)) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id),
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

comment on table public.recurring_expense_rules is
  'Fixed monthly expense reminders. A rule is not an expense until a payment is recorded.';

alter table public.expenses
  add column recurring_rule_id uuid,
  add column recurring_due_month date,
  add constraint expenses_recurring_metadata_pair check (
    (recurring_rule_id is null) = (recurring_due_month is null)
  ),
  add constraint expenses_recurring_due_month_start check (
    recurring_due_month is null or recurring_due_month = date_trunc('month', recurring_due_month)::date
  ),
  add constraint expenses_recurring_rule_institute_fkey
    foreign key (recurring_rule_id, institute_id)
    references public.recurring_expense_rules(id, institute_id) on delete restrict;

create unique index expenses_one_active_payment_per_recurring_month
  on public.expenses (recurring_rule_id, recurring_due_month)
  where recurring_rule_id is not null and voided_at is null;
create index recurring_expense_rules_scope_idx
  on public.recurring_expense_rules (institute_id, branch_id, start_month)
  where ends_on is null;
create index expenses_recurring_rule_idx
  on public.expenses (recurring_rule_id, recurring_due_month)
  where recurring_rule_id is not null and voided_at is null;

alter table public.recurring_expense_rules enable row level security;
create policy recurring_expense_rules_select_finance
  on public.recurring_expense_rules for select to authenticated
  using (
    bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id)
  );
grant select on public.recurring_expense_rules to authenticated;
revoke insert, update, delete on public.recurring_expense_rules from authenticated;
revoke all on public.recurring_expense_rules from anon, public;

create trigger recurring_expense_rules_updated_at before update on public.recurring_expense_rules
  for each row execute function bizbook_private.set_updated_at();
create trigger recurring_expense_rules_tenant_immutable before update on public.recurring_expense_rules
  for each row execute function bizbook_private.prevent_institute_transfer();
create trigger recurring_expense_rules_audit after insert or update or delete on public.recurring_expense_rules
  for each row execute function bizbook_private.audit_row_change();

create or replace function bizbook_private.protect_recorded_recurring_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.recurring_rule_id is not null and (
    new.institute_id is distinct from old.institute_id
    or new.branch_id is distinct from old.branch_id
    or new.title is distinct from old.title
    or new.category is distinct from old.category
    or new.amount is distinct from old.amount
    or new.expense_date is distinct from old.expense_date
    or new.method is distinct from old.method
    or new.notes is distinct from old.notes
    or new.recurring_rule_id is distinct from old.recurring_rule_id
    or new.recurring_due_month is distinct from old.recurring_due_month
  ) then
    raise exception 'A recorded fixed monthly payment cannot be edited; void it with a reason instead.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger expenses_protect_recorded_recurring_expense
  before update on public.expenses
  for each row execute function bizbook_private.protect_recorded_recurring_expense();

create or replace function public.create_recurring_expense_rule(
  p_rule_id uuid,
  p_institute_id text,
  p_branch_id text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_default_method text,
  p_due_day integer,
  p_start_month date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_business_date date;
  v_existing public.recurring_expense_rules%rowtype;
  v_rule_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_rule_id is null or p_institute_id is null or length(btrim(p_institute_id)) = 0
    or p_title is null or length(btrim(p_title)) not between 1 and 120
    or p_category is null or length(btrim(p_category)) not between 1 and 100
    or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2)
    or p_default_method is null or p_default_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')
    or p_due_day is null or p_due_day not between 1 and 28
    or p_start_month is null or p_start_month <> date_trunc('month', p_start_month)::date
    or (p_notes is not null and length(btrim(p_notes)) > 500) then
    raise exception 'Fixed monthly expense details are invalid.' using errcode = '22023';
  end if;
  if not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;

  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = p_institute_id;
  if not found or p_start_month < date_trunc('month', v_business_date)::date then
    raise exception 'A fixed monthly expense must start this month or later.' using errcode = '22023';
  end if;

  insert into public.recurring_expense_rules (
    id, institute_id, branch_id, title, category, amount, default_method,
    due_day, start_month, notes, created_by
  ) values (
    p_rule_id, p_institute_id, p_branch_id, btrim(p_title), btrim(p_category),
    p_amount::numeric(12,2), p_default_method, p_due_day::smallint,
    p_start_month, nullif(btrim(p_notes), ''), v_actor_id
  ) on conflict (id) do nothing
  returning id into v_rule_id;

  if v_rule_id is not null then return v_rule_id; end if;

  select r.* into v_existing from public.recurring_expense_rules r
  where r.id = p_rule_id for update;
  if not found or v_existing.institute_id is distinct from p_institute_id
    or v_existing.branch_id is distinct from p_branch_id
    or v_existing.title is distinct from btrim(p_title)
    or v_existing.category is distinct from btrim(p_category)
    or v_existing.amount is distinct from p_amount::numeric(12,2)
    or v_existing.default_method is distinct from p_default_method
    or v_existing.due_day is distinct from p_due_day::smallint
    or v_existing.start_month is distinct from p_start_month
    or v_existing.notes is distinct from nullif(btrim(p_notes), '') then
    raise exception 'The fixed monthly expense request ID conflicts with another request.' using errcode = '23505';
  end if;
  return v_existing.id;
end;
$$;

create or replace function public.record_recurring_expense_payment(
  p_expense_id text,
  p_rule_id uuid,
  p_due_month date,
  p_payment_date date,
  p_method text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_rule public.recurring_expense_rules%rowtype;
  v_existing public.expenses%rowtype;
  v_business_date date;
  v_due_date date;
  v_fingerprint text;
  v_expense_id text;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_expense_id is null or p_expense_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_rule_id is null or p_due_month is null
    or p_due_month <> date_trunc('month', p_due_month)::date
    or p_payment_date is null
    or p_method is null or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other') then
    raise exception 'Fixed monthly expense payment details are invalid.' using errcode = '22023';
  end if;

  select r.* into v_rule from public.recurring_expense_rules r where r.id = p_rule_id for update;
  if not found then
    raise exception 'The fixed monthly expense is unavailable.' using errcode = '42501';
  end if;
  if not bizbook_private.has_institute_role(v_rule.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_rule.institute_id, v_rule.branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;

  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = v_rule.institute_id;
  if not found or p_payment_date > v_business_date then
    raise exception 'Payment date cannot be after the institute business date.' using errcode = '22023';
  end if;
  if p_due_month < v_rule.start_month
    or p_due_month > date_trunc('month', v_business_date)::date then
    raise exception 'Choose a monthly expense occurrence that has started.' using errcode = '22023';
  end if;
  v_due_date := p_due_month + (v_rule.due_day - 1);
  if v_rule.ends_on is not null and v_due_date > v_rule.ends_on then
    raise exception 'This occurrence was cancelled when the monthly expense was paused.' using errcode = '23514';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'rule_id', p_rule_id,
    'due_month', p_due_month::text,
    'payment_date', p_payment_date::text,
    'method', p_method
  )::text);

  select e.* into v_existing from public.expenses e
  where e.id = p_expense_id and e.institute_id = v_rule.institute_id for update;
  if found then
    if v_existing.voided_at is not null
      or v_existing.request_fingerprint is distinct from v_fingerprint
      or v_existing.recurring_rule_id is distinct from p_rule_id
      or v_existing.recurring_due_month is distinct from p_due_month then
      raise exception 'The expense request ID was already used for another payment.' using errcode = '23505';
    end if;
    return v_existing.id;
  end if;

  if exists (
    select 1 from public.expenses e
    where e.recurring_rule_id = p_rule_id
      and e.recurring_due_month = p_due_month
      and e.voided_at is null
  ) then
    raise exception 'This monthly expense has already been recorded as paid.' using errcode = '23505';
  end if;

  insert into public.expenses (
    id, institute_id, branch_id, title, category, amount, expense_date, method,
    notes, legacy_data, created_by, request_fingerprint, recurring_rule_id, recurring_due_month
  ) values (
    p_expense_id, v_rule.institute_id, v_rule.branch_id, v_rule.title, v_rule.category,
    v_rule.amount, p_payment_date, p_method,
    'Fixed monthly expense payment for ' || to_char(p_due_month, 'YYYY-MM') || '.',
    '{}'::jsonb, v_actor_id, v_fingerprint, p_rule_id, p_due_month
  ) returning id into v_expense_id;

  return v_expense_id;
end;
$$;

create or replace function public.pause_recurring_expense_rule(p_rule_id uuid)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule public.recurring_expense_rules%rowtype;
  v_business_date date;
begin
  if auth.uid() is null or p_rule_id is null then
    raise exception 'Authentication and a monthly expense are required.' using errcode = '42501';
  end if;
  select r.* into v_rule from public.recurring_expense_rules r where r.id = p_rule_id for update;
  if not found then
    raise exception 'The fixed monthly expense is unavailable.' using errcode = '42501';
  end if;
  if not bizbook_private.has_institute_role(v_rule.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_rule.institute_id, v_rule.branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;
  if v_rule.ends_on is not null then return v_rule.ends_on; end if;

  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = v_rule.institute_id;
  if not found then
    raise exception 'The institute business date is unavailable.' using errcode = '22023';
  end if;
  update public.recurring_expense_rules set ends_on = v_business_date where id = p_rule_id;
  return v_business_date;
end;
$$;

revoke all on function public.create_recurring_expense_rule(uuid, text, text, text, text, numeric, text, integer, date, text)
  from public, anon, service_role;
grant execute on function public.create_recurring_expense_rule(uuid, text, text, text, text, numeric, text, integer, date, text)
  to authenticated;
revoke all on function public.record_recurring_expense_payment(text, uuid, date, date, text)
  from public, anon, service_role;
grant execute on function public.record_recurring_expense_payment(text, uuid, date, date, text)
  to authenticated;
revoke all on function public.pause_recurring_expense_rule(uuid)
  from public, anon, service_role;
grant execute on function public.pause_recurring_expense_rule(uuid)
  to authenticated;
revoke all on function bizbook_private.protect_recorded_recurring_expense() from public, anon, authenticated, service_role;

comment on function public.create_recurring_expense_rule(uuid, text, text, text, text, numeric, text, integer, date, text) is
  'Creates an authorized fixed monthly expense reminder. It does not create a ledger expense until payment is recorded.';
comment on function public.record_recurring_expense_payment(text, uuid, date, date, text) is
  'Atomically records one actual expense for a fixed monthly occurrence with idempotent retry and duplicate-period protection.';
comment on function public.pause_recurring_expense_rule(uuid) is
  'Stops future fixed monthly expense reminders while retaining due occurrences and audit history.';
