-- Keep booked expense obligations visible without treating unpaid items as cash outflow.
create or replace function public.expense_dashboard_summary(
  p_institute_id text,
  p_branch_id text,
  p_month_start date
)
returns table(recorded_month_total numeric, unpaid_total numeric, unpaid_count bigint)
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
  select
    coalesce(sum(e.amount) filter (
      where e.expense_date >= p_month_start
        and e.expense_date < (p_month_start + interval '1 month')::date
    ), 0)::numeric,
    coalesce(sum(e.amount) filter (where e.payment_status = 'unpaid'), 0)::numeric,
    count(*) filter (where e.payment_status = 'unpaid')
  from public.expenses e
  where e.institute_id = p_institute_id
    and (p_branch_id is null or e.branch_id = p_branch_id)
    and e.voided_at is null;
end;
$$;

revoke all on function public.expense_dashboard_summary(text, text, date) from public, anon, service_role;
grant execute on function public.expense_dashboard_summary(text, text, date) to authenticated;

comment on function public.expense_dashboard_summary(text, text, date) is
  'Returns booked expense amounts for a month and current unpaid obligations separately; reminder rules are not booked expenses and unpaid amounts are not cash outflow.';
