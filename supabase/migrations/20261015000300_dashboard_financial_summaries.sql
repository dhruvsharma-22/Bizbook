-- Tenant- and branch-aware, read-only dashboard summaries. These views aggregate
-- canonical ledgers; they do not create a second financial source of truth.

create view public.financial_activity_summary
with (security_invoker = true)
as
select
  institute_id,
  branch_id,
  date_trunc('month', activity_date::timestamp)::date as activity_month,
  category,
  direction,
  count(*)::bigint as record_count,
  sum(amount)::numeric as amount_total
from public.financial_activity
where activity_date is not null
group by
  institute_id,
  branch_id,
  date_trunc('month', activity_date::timestamp)::date,
  category,
  direction;

create view public.installment_balance_summary
with (security_invoker = true)
as
select
  institute_id,
  branch_id,
  balance_status,
  count(*)::bigint as installment_count,
  sum(paid_amount)::numeric as paid_amount_total,
  sum(outstanding_amount)::numeric as outstanding_amount_total
from public.installment_balances
group by institute_id, branch_id, balance_status;

revoke all on public.financial_activity_summary, public.installment_balance_summary
  from public, anon;
grant select on public.financial_activity_summary, public.installment_balance_summary
  to authenticated;

comment on view public.financial_activity_summary is
  'Monthly aggregate over canonical financial_activity; fee/advance receipts appear once, only completed refunds reduce collections, and salary/expenses remain distinct categories.';
comment on view public.installment_balance_summary is
  'Branch-scoped aggregate over canonical installment_balances; paid and outstanding amounts follow the same refund-aware balance calculation.';
