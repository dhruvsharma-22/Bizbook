-- Future absences must not reduce salary before the institute's business date.
create or replace function bizbook_private.prevent_future_attendance()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_time_zone text; v_business_date date;
begin
  select i.time_zone into v_time_zone
  from public.coaching_institutes i
  where i.id = new.institute_id;
  if not found then
    raise exception 'Attendance institute is unavailable.' using errcode = '23503';
  end if;
  v_business_date := (now() at time zone v_time_zone)::date;
  if new.attendance_date > v_business_date then
    raise exception 'Future attendance cannot be recorded.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function bizbook_private.prevent_future_attendance() from public, anon, authenticated;
create trigger attendance_business_date_guard
before insert or update of institute_id, attendance_date on public.attendance_records
for each row execute function bizbook_private.prevent_future_attendance();

comment on function bizbook_private.prevent_future_attendance()
  is 'Rejects attendance dates after the institute-local business date so future records cannot reduce payroll.';
