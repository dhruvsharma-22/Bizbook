-- BizBook database foundation.
-- Additive only: this migration does not import or modify browser localStorage data.

create schema if not exists bizbook_private;
revoke all on schema bizbook_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.coaching_institutes (
  id text primary key default gen_random_uuid()::text,
  business_name text not null check (length(btrim(business_name)) between 1 and 100),
  owner_name text,
  phone text,
  whatsapp text,
  email text,
  website text,
  address text,
  city text,
  state text,
  pincode text,
  gstin text,
  time_zone text not null default 'Asia/Kolkata',
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_name)
);

create table public.user_memberships (
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'administrator', 'accountant', 'staff')),
  access_scope text not null default 'institute' check (access_scope in ('institute', 'branches')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institute_id, user_id)
);

create table public.branches (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id),
  unique (institute_id, name)
);

create table public.membership_branch_access (
  institute_id text not null,
  user_id uuid not null,
  branch_id text not null,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (institute_id, user_id, branch_id),
  foreign key (institute_id, user_id)
    references public.user_memberships(institute_id, user_id) on delete cascade,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create table public.students (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  branch_id text,
  name text not null check (length(btrim(name)) > 0),
  gender text check (gender is null or gender in ('Male', 'Female', 'Other')),
  parent_name text,
  parent_email text,
  parent_email_opt_in boolean not null default false,
  whatsapp_opt_in boolean not null default false,
  parent_mobile text,
  whatsapp text,
  course text,
  class_name text,
  admission_date date,
  total_fee numeric(12,2) not null default 0 check (total_fee >= 0),
  admission_fee numeric(12,2) not null default 0 check (admission_fee >= 0),
  archived_at timestamptz,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id),
  unique (id, institute_id, branch_id),
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create table public.staff (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  branch_id text,
  name text not null check (length(btrim(name)) > 0),
  gender text check (gender is null or gender in ('Male', 'Female', 'Other')),
  mobile text,
  whatsapp text,
  designation text,
  joining_date date,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  payment_day smallint check (payment_day is null or payment_day between 1 and 31),
  per_day_leave_cut numeric(12,2) not null default 0 check (per_day_leave_cut >= 0),
  manual_payable_amount numeric(12,2) check (manual_payable_amount is null or manual_payable_amount >= 0),
  salary_calculation_mode text not null default 'AttendanceBased'
    check (salary_calculation_mode in ('AttendanceBased', 'Fixed')),
  attendance_enabled boolean not null default true,
  archived_at timestamptz,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id),
  unique (id, institute_id, branch_id),
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create table public.attendance_records (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  branch_id text,
  staff_id text not null,
  attendance_date date not null,
  status text not null check (status in ('Present', 'Absent', 'Leave', 'Holiday')),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institute_id, staff_id, attendance_date),
  foreign key (staff_id, institute_id)
    references public.staff(id, institute_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

-- Installment schedules are stored once here. Amount paid and outstanding are derived below.
create table public.student_installments (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  branch_id text,
  student_id text not null,
  sequence_number integer not null check (sequence_number > 0),
  scheduled_amount numeric(12,2) not null check (scheduled_amount > 0),
  due_date date,
  status text not null default 'Pending'
    check (status in ('Pending', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled')),
  reminder_schedule_version integer not null default 1 check (reminder_schedule_version > 0),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id),
  unique (id, institute_id, student_id),
  unique (institute_id, student_id, sequence_number),
  foreign key (student_id, institute_id)
    references public.students(id, institute_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create table public.payments (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  branch_id text,
  student_id text not null,
  receipt_kind text not null check (receipt_kind in ('Fee', 'Advance')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  payment_date date not null,
  method text not null check (method in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')),
  mode text not null check (mode in ('Manual', 'Online')),
  status text not null default 'Pending'
    check (status in ('Pending', 'Processing', 'Paid', 'Failed', 'Cancelled', 'Refunded', 'Partially Refunded')),
  provider text check (provider is null or provider in ('razorpay', 'cashfree')),
  provider_order_id text,
  provider_payment_id text,
  provider_reference text,
  verified_at timestamptz,
  idempotency_key text,
  request_fingerprint text,
  note text,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id, student_id),
  unique (id, institute_id),
  foreign key (student_id, institute_id)
    references public.students(id, institute_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict,
  check (mode <> 'Online' or provider is not null),
  check (
    mode <> 'Online'
    or status not in ('Paid', 'Refunded', 'Partially Refunded')
    or verified_at is not null
  )
);

create unique index payments_idempotency_key_unique
  on public.payments (institute_id, idempotency_key)
  where idempotency_key is not null;
create unique index payments_provider_payment_unique
  on public.payments (provider, provider_payment_id)
  where provider is not null and provider_payment_id is not null;

-- Allocation rows never create a second cash receipt. Every receipt is counted from payments once.
create table public.payment_allocations (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  payment_id text not null,
  student_id text not null,
  installment_id text not null,
  allocation_kind text not null check (allocation_kind in ('Fee', 'Advance')),
  amount numeric(12,2) not null check (amount > 0),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  allocated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, institute_id, payment_id),
  foreign key (payment_id, institute_id, student_id)
    references public.payments(id, institute_id, student_id) on delete restrict,
  foreign key (installment_id, institute_id, student_id)
    references public.student_installments(id, institute_id, student_id) on delete restrict
);

create table public.refunds (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  branch_id text,
  payment_id text not null,
  student_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'Pending'
    check (status in ('Pending', 'Processing', 'Completed', 'Failed', 'Cancelled')),
  reason text not null check (length(btrim(reason)) > 0),
  mode text not null check (mode in ('Manual', 'Online')),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  provider_refund_reference text,
  requested_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id, payment_id),
  foreign key (payment_id, institute_id, student_id)
    references public.payments(id, institute_id, student_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict,
  check (status <> 'Completed' or completed_at is not null),
  check (status <> 'Completed' or mode <> 'Online' or provider_refund_reference is not null)
);

-- A completed refund reverses its original installment allocations. Any remaining portion
-- consumes unallocated advance balance. Pending/processing rows reserve capacity only.
create table public.refund_allocations (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  refund_id text not null,
  payment_id text not null,
  payment_allocation_id text not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  foreign key (refund_id, institute_id, payment_id)
    references public.refunds(id, institute_id, payment_id) on delete restrict,
  foreign key (payment_allocation_id, institute_id, payment_id)
    references public.payment_allocations(id, institute_id, payment_id) on delete restrict
);

create table public.salary_payments (
  institute_id text not null,
  branch_id text,
  staff_id text not null,
  payroll_month text not null check (payroll_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  base_salary numeric(12,2) not null check (base_salary >= 0),
  manual_payable_amount numeric(12,2) check (manual_payable_amount is null or manual_payable_amount >= 0),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'Paid' check (status = 'Paid'),
  paid_at timestamptz not null,
  method text check (method is null or method in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')),
  reference text,
  notes text,
  salary_calculation_mode text check (salary_calculation_mode is null or salary_calculation_mode in ('AttendanceBased', 'Fixed')),
  attendance_deduction numeric(12,2) check (attendance_deduction is null or attendance_deduction >= 0),
  manual_adjustment numeric(12,2),
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (institute_id, staff_id, payroll_month),
  foreign key (staff_id, institute_id)
    references public.staff(id, institute_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create table public.expenses (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  branch_id text,
  title text not null check (length(btrim(title)) > 0),
  category text not null check (length(btrim(category)) > 0),
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null,
  method text not null check (method in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')),
  notes text,
  legacy_data jsonb not null default '{}'::jsonb check (jsonb_typeof(legacy_data) = 'object'),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict,
  check (voided_at is null or void_reason is not null)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  branch_id text,
  entity_type text not null,
  entity_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create table public.notification_logs (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  branch_id text,
  channel text not null check (channel in ('Email', 'WhatsApp')),
  event_type text not null,
  delivery_status text not null check (delivery_status in ('Queued', 'Processing', 'Sent', 'Delivered', 'Failed', 'Unknown', 'Skipped')),
  provider text,
  provider_message_reference text,
  recipient_fingerprint text,
  reminder_installment_id text,
  reminder_number smallint check (reminder_number is null or reminder_number between 1 and 5),
  reminder_schedule_version integer check (reminder_schedule_version is null or reminder_schedule_version > 0),
  reminder_due_date date,
  idempotency_key text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retryable boolean not null default true,
  next_attempt_at timestamptz,
  last_error_code text,
  sent_at timestamptz,
  attempted_by uuid references auth.users(id) on delete set null,
  attempted_at timestamptz not null default now(),
  foreign key (reminder_installment_id, institute_id)
    references public.student_installments(id, institute_id) on delete restrict,
  check (
    (reminder_installment_id is null and reminder_number is null and reminder_schedule_version is null
      and reminder_due_date is null and idempotency_key is null)
    or (reminder_installment_id is not null and reminder_number is not null
      and reminder_schedule_version is not null and reminder_due_date is not null
      and idempotency_key is not null)
  ),
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create unique index notification_logs_reminder_stage_unique
  on public.notification_logs (institute_id, reminder_installment_id, reminder_number, reminder_schedule_version)
  where reminder_installment_id is not null;

-- Provider credentials remain outside PostgreSQL. secret_reference is only a server-side
-- secret-manager lookup key; never put a credential value in this column.
create table public.payment_connections (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  provider text not null check (provider in ('razorpay', 'cashfree')),
  merchant_account_reference text,
  secret_reference text,
  environment text not null default 'test' check (environment in ('test', 'production')),
  connection_status text not null default 'inactive' check (connection_status in ('inactive', 'pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institute_id, provider)
);

create table public.payment_orders (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  branch_id text,
  student_id text not null,
  provider text not null check (provider in ('razorpay', 'cashfree')),
  provider_order_id text,
  idempotency_key text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  order_status text not null default 'Pending' check (order_status in ('Pending', 'Processing', 'Authorized', 'Captured', 'Failed', 'Cancelled', 'Expired')),
  payment_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, institute_id),
  unique (institute_id, idempotency_key),
  unique (provider, provider_order_id),
  foreign key (student_id, institute_id)
    references public.students(id, institute_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict,
  foreign key (payment_id, institute_id, student_id)
    references public.payments(id, institute_id, student_id) on delete restrict
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  provider text not null check (provider in ('razorpay', 'cashfree')),
  provider_event_id text not null,
  event_type text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  processing_status text not null default 'Received' check (processing_status in ('Received', 'Processing', 'Processed', 'Failed', 'Ignored')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create table public.payment_reconciliation_records (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  provider text not null check (provider in ('razorpay', 'cashfree')),
  payment_id text,
  provider_transaction_reference text not null,
  provider_amount numeric(12,2) not null check (provider_amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  reconciliation_status text not null check (reconciliation_status in ('Matched', 'Unmatched', 'Amount Mismatch', 'Reference Mismatch', 'Ignored')),
  reconciled_at timestamptz not null default now(),
  reconciled_by uuid references auth.users(id) on delete set null,
  notes text,
  unique (institute_id, provider, provider_transaction_reference),
  foreign key (payment_id, institute_id)
    references public.payments(id, institute_id) on delete restrict
);

create index students_institute_branch_name_idx on public.students (institute_id, branch_id, name);
create index staff_institute_branch_name_idx on public.staff (institute_id, branch_id, name);
create index attendance_institute_staff_date_idx on public.attendance_records (institute_id, staff_id, attendance_date desc);
create index installments_institute_student_due_idx on public.student_installments (institute_id, student_id, due_date, sequence_number);
create index installments_due_status_idx on public.student_installments (institute_id, due_date, status) where status <> 'Cancelled';
create index payments_institute_student_date_idx on public.payments (institute_id, student_id, payment_date desc);
create index payments_institute_status_date_idx on public.payments (institute_id, status, payment_date desc);
create index payment_allocations_installment_idx on public.payment_allocations (institute_id, installment_id);
create index refunds_payment_status_idx on public.refunds (institute_id, payment_id, status);
create index salary_payments_institute_month_idx on public.salary_payments (institute_id, payroll_month desc);
create index expenses_institute_date_idx on public.expenses (institute_id, branch_id, expense_date desc) where voided_at is null;
create index audit_logs_institute_time_idx on public.audit_logs (institute_id, occurred_at desc);
create index payment_orders_institute_status_idx on public.payment_orders (institute_id, order_status, created_at desc);

-- These views derive financial balances and activity from canonical records. Allocations do not
-- appear as receipts. Pending refunds reserve refundable capacity but only completed refunds
-- change net collections or installment paid amounts.
create view public.installment_balances
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
    when i.due_date is not null and i.due_date < current_date then 'Overdue'
    else 'Pending'
  end as balance_status
from public.student_installments i
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

create view public.advance_balances
with (security_invoker = true)
as
select
  p.id as payment_id,
  p.institute_id,
  p.branch_id,
  p.student_id,
  p.receipt_kind,
  p.amount as received_amount,
  greatest(0::numeric, p.amount - coalesce(a.allocated_amount, 0) - coalesce(r.unallocated_refunds, 0))::numeric(12,2) as available_advance
from public.payments p
left join lateral (
  select sum(pa.amount) as allocated_amount
  from public.payment_allocations pa
  where pa.institute_id = p.institute_id and pa.payment_id = p.id
) a on true
left join lateral (
  select sum(refund_remaining.amount) as unallocated_refunds
  from (
    select greatest(0::numeric, rf.amount - coalesce(sum(ra.amount), 0)) as amount
    from public.refunds rf
    left join public.refund_allocations ra
      on ra.refund_id = rf.id and ra.institute_id = rf.institute_id and ra.payment_id = rf.payment_id
    where rf.institute_id = p.institute_id
      and rf.payment_id = p.id
      and rf.status in ('Pending', 'Processing', 'Completed')
    group by rf.id, rf.amount
  ) refund_remaining
) r on true
where p.receipt_kind = 'Advance'
  and p.status in ('Paid', 'Partially Refunded', 'Refunded');

create view public.payment_history
with (security_invoker = true)
as
select
  p.id,
  p.institute_id,
  p.branch_id,
  case when p.receipt_kind = 'Advance' then 'Advance' else 'Fee' end::text as type,
  p.student_id as person_id,
  s.name as person_name,
  case when p.receipt_kind = 'Advance' then 'Advance receipt' else 'Fee receipt' end::text as description,
  p.amount,
  (p.payment_date::timestamp at time zone 'UTC') as paid_at,
  p.method
from public.payments p
join public.students s on s.id = p.student_id and s.institute_id = p.institute_id
where p.status in ('Paid', 'Partially Refunded', 'Refunded')
union all
select
  concat(sp.staff_id, ':', sp.payroll_month), sp.institute_id, sp.branch_id,
  'Salary'::text, sp.staff_id, st.name, concat('Salary for ', sp.payroll_month),
  sp.amount, sp.paid_at, sp.method
from public.salary_payments sp
join public.staff st on st.id = sp.staff_id and st.institute_id = sp.institute_id
union all
select
  e.id, e.institute_id, e.branch_id, 'Expense'::text, e.id, e.title,
  e.category, e.amount, (e.expense_date::timestamp at time zone 'UTC'), e.method
from public.expenses e
where e.voided_at is null;

create view public.financial_activity
with (security_invoker = true)
as
select
  p.id as source_id, p.institute_id, p.branch_id, 'receipt'::text as source_type,
  case when p.receipt_kind = 'Advance' then 'student_advance_receipt' else 'student_fee_receipt' end::text as category,
  p.amount as amount, 'inflow'::text as direction, p.payment_date::date as activity_date
from public.payments p
where p.status in ('Paid', 'Partially Refunded', 'Refunded')
union all
select
  r.id, r.institute_id, r.branch_id, 'refund'::text, 'student_refund'::text,
  -r.amount, 'outflow'::text, r.completed_at::date
from public.refunds r
where r.status = 'Completed'
union all
select
  concat(sp.staff_id, ':', sp.payroll_month), sp.institute_id, sp.branch_id,
  'salary_payment'::text, 'salary_expense'::text, -sp.amount, 'outflow'::text, sp.paid_at::date
from public.salary_payments sp
union all
select
  e.id, e.institute_id, e.branch_id, 'expense'::text, 'business_expense'::text,
  -e.amount, 'outflow'::text, e.expense_date
from public.expenses e
where e.voided_at is null;

comment on table public.students is 'Known student fields are normalized; legacy_data retains unknown application fields during a future reviewed migration.';
comment on table public.staff is 'Known staff and salary-policy fields are normalized; legacy_data preserves unmodeled legacy properties.';
comment on table public.payments is 'One row per actual receipt. Payment allocations are not additional receipts or cash inflows.';
comment on table public.payment_allocations is 'Allocation ledger only; never sum these rows as new receipts.';
comment on table public.refunds is 'Pending and processing refunds reserve refundable capacity; only completed refunds reduce net collections.';
comment on table public.salary_payments is 'One paid salary record per staff member and payroll month; do not duplicate in generic payment history.';
comment on table public.payment_connections is 'Contains non-secret provider metadata and an optional secret-manager reference only; never store provider credentials here.';
comment on view public.payment_history is 'Read-only activity projection from fee/advance receipts, salary payments and expenses; it is not an additional ledger.';
comment on view public.financial_activity is 'Canonical reporting projection. Receipts are counted once; advance allocations are excluded; completed refunds reduce net collections.';
