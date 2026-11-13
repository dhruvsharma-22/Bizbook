-- Keep staff directory reads available while limiting compensation details to finance roles.
revoke select on public.staff from public, anon, authenticated;
grant select (
  id, institute_id, branch_id, name, gender, mobile, whatsapp, designation,
  joining_date, salary_calculation_mode, attendance_enabled, archived_at,
  legacy_data, created_at, updated_at
) on public.staff to authenticated;

create or replace function public.list_staff_compensation(
  p_institute_id text,
  p_branch_id text default null
)
returns table (
  id text,
  institute_id text,
  branch_id text,
  name text,
  designation text,
  joining_date date,
  monthly_salary numeric,
  payment_day smallint,
  per_day_leave_cut numeric,
  manual_payable_amount numeric,
  salary_calculation_mode text,
  attendance_enabled boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_institute_id is null
     or not bizbook_private.has_institute_role(
       p_institute_id,
       array['owner', 'administrator', 'accountant']::text[]
     )
     or not exists (
       select 1 from public.coaching_institutes i
       where i.id = p_institute_id and i.account_status = 'active'
     ) then
    raise exception 'Finance access is required to read staff compensation.'
      using errcode = '42501';
  end if;

  if p_branch_id is not null
     and not bizbook_private.can_access_branch(p_institute_id, p_branch_id) then
    raise exception 'Branch access is required to read staff compensation.'
      using errcode = '42501';
  end if;

  return query
    select s.id, s.institute_id, s.branch_id, s.name, s.designation,
      s.joining_date, s.monthly_salary, s.payment_day, s.per_day_leave_cut,
      s.manual_payable_amount, s.salary_calculation_mode, s.attendance_enabled
    from public.staff s
    where s.institute_id = p_institute_id
      and s.archived_at is null
      and (p_branch_id is null or s.branch_id = p_branch_id)
      and bizbook_private.can_access_branch(s.institute_id, s.branch_id)
    order by s.name, s.id;
end;
$$;

revoke all on function public.list_staff_compensation(text, text) from public, anon;
grant execute on function public.list_staff_compensation(text, text) to authenticated;

comment on function public.list_staff_compensation(text, text)
  is 'Returns staff salary settings only for active institute finance members with branch-scoped access.';
