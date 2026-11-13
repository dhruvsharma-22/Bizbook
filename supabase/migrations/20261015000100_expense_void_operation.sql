-- Expenses are corrected through an auditable soft-void operation rather than deletion.
create or replace function public.void_expense(p_expense_id text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_expense public.expenses%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_expense_id is null or length(btrim(p_expense_id)) = 0
    or p_reason is null or length(btrim(p_reason)) < 3 or length(btrim(p_reason)) > 500 then
    raise exception 'A valid expense and void reason are required.' using errcode = '22023';
  end if;

  select e.* into v_expense
  from public.expenses e
  where e.id = p_expense_id
  for update;
  if not found
    or not bizbook_private.has_institute_role(v_expense.institute_id, array['owner', 'administrator', 'accountant']::text[])
    or not bizbook_private.can_write_branch(v_expense.institute_id, v_expense.branch_id) then
    raise exception 'Authorized expense access is required.' using errcode = '42501';
  end if;
  if v_expense.voided_at is not null then
    raise exception 'This expense is already voided.' using errcode = '23514';
  end if;

  update public.expenses
  set voided_at = pg_catalog.now(),
      voided_by = v_actor_id,
      void_reason = btrim(p_reason)
  where id = v_expense.id and institute_id = v_expense.institute_id and voided_at is null;
end;
$$;

revoke all on function public.void_expense(text, text) from public, anon, service_role;
grant execute on function public.void_expense(text, text) to authenticated;
comment on function public.void_expense(text, text) is
  'Soft-voids an expense with a required reason; the existing audit trigger records the update.';
