-- Attendance affects payroll, so attendance rows must use the staff member's branch.
-- Validate future writes without rewriting or deleting existing attendance.

create or replace function bizbook_private.ensure_attendance_staff_branch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_branch_id text;
begin
  select s.branch_id into v_staff_branch_id
  from public.staff as s
  where s.id = new.staff_id and s.institute_id = new.institute_id
  for key share;

  if not found then
    raise exception 'Attendance staff member is unavailable.' using errcode = '23503';
  end if;
  if v_staff_branch_id is distinct from new.branch_id then
    raise exception 'Attendance branch must match the staff member branch.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function bizbook_private.ensure_attendance_staff_branch() from public, anon, authenticated;

create trigger attendance_staff_branch_guard
before insert or update of institute_id, branch_id, staff_id on public.attendance_records
for each row execute function bizbook_private.ensure_attendance_staff_branch();

comment on function bizbook_private.ensure_attendance_staff_branch()
  is 'Prevents attendance from being assigned to a branch different from the staff member branch; payroll consumes attendance by staff and month.';
