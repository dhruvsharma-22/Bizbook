-- Read-only preflight for the fixed synthetic identifiers used by the
-- financial-guard pgTAP suite. Returns only identifiers that already exist.
select 'auth.users' as fixture_table, id::text as fixture_id
from auth.users
where id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
)
   or email in (
  'bizbook-financial-guards@example.invalid',
  'bizbook-manager-visibility@example.invalid'
)
union all
select 'public.coaching_institutes', id::text
from public.coaching_institutes
where id in ('inactive-branch-institute', 'financial-guard-institute', 'unrelated-institute')
union all
select 'public.branches', id::text
from public.branches
where id in ('inactive-test-branch', 'assigned-active-branch', 'unassigned-active-branch')
union all
select 'public.students', id::text
from public.students
where id in (
  'financial-guard-student', 'unrelated-student', 'branchless-student',
  'assigned-branch-student', 'unassigned-branch-student'
)
union all
select 'public.staff', id::text
from public.staff
where id = 'financial-guard-staff'
union all
select 'public.student_installments', id::text
from public.student_installments
where id in ('unpaid-installment', 'timezone-overdue-installment')
union all
select 'public.payments', id::text
from public.payments
where id in (
  'assigned-branch-payment', 'unassigned-branch-payment', 'manual-today-receipt',
  'ordinary-fee-receipt', 'advance-receipt'
)
union all
select 'public.payment_reconciliation_records', id::text
from public.payment_reconciliation_records
where id in (
  'assigned-branch-reconciliation', 'unassigned-branch-reconciliation',
  'unlinked-branch-reconciliation'
)
union all
select 'public.refunds', id::text
from public.refunds
where id in ('fee-pending-refund', 'fee-over-refund', 'advance-pending-refund')
union all
select 'public.expenses', id::text
from public.expenses
where id = 'today-business-expense'
union all
select 'public.notification_logs', idempotency_key
from public.notification_logs
where idempotency_key = 'financial-guard:unpaid-installment:1:2'
union all
select 'public.salary_payments', staff_id::text || ':' || payroll_month
from public.salary_payments
where staff_id = 'financial-guard-staff' and payroll_month = '2026-10';
