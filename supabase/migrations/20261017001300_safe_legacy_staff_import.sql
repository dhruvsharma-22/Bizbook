-- Idempotent, owner-authorized staff-directory import. Attendance and payroll
-- history are explicitly excluded and the source browser payload is not stored.

create table public.legacy_staff_imports (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null,
  branch_id text,
  source_key text not null check (source_key = 'bizbook-students-staff-v1'),
  source_record_id text not null check (length(btrim(source_record_id)) between 1 and 200),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  staff_id text not null,
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  unique (institute_id, source_key, source_record_id),
  unique (staff_id, institute_id),
  foreign key (institute_id) references public.coaching_institutes(id) on delete restrict,
  foreign key (branch_id, institute_id) references public.branches(id, institute_id) on delete restrict,
  foreign key (staff_id, institute_id) references public.staff(id, institute_id) on delete restrict
);

create index legacy_staff_imports_institute_time_idx
  on public.legacy_staff_imports (institute_id, imported_at desc);

alter table public.legacy_staff_imports enable row level security;
revoke all on public.legacy_staff_imports from public, anon, authenticated;
grant select on public.legacy_staff_imports to authenticated;

create policy legacy_staff_imports_select_authorized on public.legacy_staff_imports
  for select to authenticated
  using (
    auth.role() = 'authenticated'
    and bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id)
  );

create or replace function public.import_legacy_staff_record(
  p_institute_id text,
  p_branch_id text,
  p_source_key text,
  p_source_record_id text,
  p_source_fingerprint text,
  p_staff_id text,
  p_name text,
  p_gender text,
  p_mobile text,
  p_whatsapp text,
  p_designation text,
  p_joining_date date,
  p_monthly_salary numeric,
  p_payment_day smallint,
  p_per_day_leave_cut numeric,
  p_manual_payable_amount numeric,
  p_salary_calculation_mode text,
  p_attendance_enabled boolean,
  p_confirm_profile_only boolean
)
returns table (imported_staff_id text, was_already_imported boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.legacy_staff_imports%rowtype;
  v_import_id uuid;
begin
  if v_actor_id is null
     or auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized institute administrator access is required.' using errcode = '42501';
  end if;

  if p_confirm_profile_only is distinct from true
     or p_source_key is distinct from 'bizbook-students-staff-v1'
     or p_source_record_id is null
     or length(btrim(p_source_record_id)) not between 1 and 200
     or p_source_fingerprint is null
     or p_source_fingerprint !~ '^[0-9a-f]{64}$'
     or p_staff_id is null
     or p_staff_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_name is null or length(btrim(p_name)) not between 1 and 100
     or (p_gender is not null and p_gender not in ('Male', 'Female', 'Other'))
     or (p_mobile is not null and p_mobile !~ '^[0-9]{10}$')
     or (p_whatsapp is not null and p_whatsapp !~ '^[0-9]{10}$')
     or (p_designation is not null and length(p_designation) > 100)
     or p_monthly_salary is null or p_monthly_salary < 0 or p_monthly_salary > 9999999999.99
     or p_monthly_salary <> round(p_monthly_salary, 2)
     or p_per_day_leave_cut is null or p_per_day_leave_cut < 0 or p_per_day_leave_cut > 9999999999.99
     or p_per_day_leave_cut <> round(p_per_day_leave_cut, 2)
     or (p_manual_payable_amount is not null and (
       p_manual_payable_amount < 0 or p_manual_payable_amount > 9999999999.99
       or p_manual_payable_amount <> round(p_manual_payable_amount, 2)
     ))
     or (p_payment_day is not null and p_payment_day not between 1 and 31)
     or p_salary_calculation_mode not in ('AttendanceBased', 'Fixed')
     or p_attendance_enabled is null
     or ((p_salary_calculation_mode = 'Fixed') <> (not p_attendance_enabled)) then
    raise exception 'Legacy staff import details or confirmation are invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_institute_id || chr(31) || p_source_key || chr(31) || p_source_record_id, 0)
  );

  select i.* into v_existing
  from public.legacy_staff_imports i
  where i.institute_id = p_institute_id
    and i.source_key = p_source_key
    and i.source_record_id = p_source_record_id
  for update;
  if found then
    if v_existing.source_fingerprint is distinct from p_source_fingerprint then
      raise exception 'This legacy source record changed after a previous import.' using errcode = '23505';
    end if;
    return query select v_existing.staff_id, true;
    return;
  end if;

  if exists (select 1 from public.staff s where s.id = p_staff_id) then
    raise exception 'The generated staff ID is already in use.' using errcode = '23505';
  end if;

  insert into public.staff (
    id, institute_id, branch_id, name, gender, mobile, whatsapp, designation, joining_date,
    monthly_salary, payment_day, per_day_leave_cut, manual_payable_amount,
    salary_calculation_mode, attendance_enabled, legacy_data, created_by
  ) values (
    p_staff_id, p_institute_id, p_branch_id, btrim(p_name), p_gender, p_mobile, p_whatsapp,
    nullif(btrim(p_designation), ''), p_joining_date, p_monthly_salary, p_payment_day,
    p_per_day_leave_cut, p_manual_payable_amount, p_salary_calculation_mode, p_attendance_enabled,
    jsonb_build_object('imported_from', 'legacy-browser', 'source_record_id', p_source_record_id, 'import_mode', 'profile_only'),
    v_actor_id
  );

  insert into public.legacy_staff_imports (
    institute_id, branch_id, source_key, source_record_id, source_fingerprint, staff_id, imported_by
  ) values (
    p_institute_id, p_branch_id, p_source_key, p_source_record_id, p_source_fingerprint, p_staff_id, v_actor_id
  ) returning id into v_import_id;

  insert into public.audit_logs (
    institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata
  ) values (
    p_institute_id, p_branch_id, 'legacy_staff_import', v_import_id::text, 'INSERT', v_actor_id,
    jsonb_build_object('source_key', p_source_key, 'target_staff_id', p_staff_id, 'import_mode', 'profile_only')
  );

  return query select p_staff_id, false;
end;
$$;

revoke all on function public.import_legacy_staff_record(text, text, text, text, text, text, text, text, text, text, text, date, numeric, smallint, numeric, numeric, text, boolean, boolean)
  from public, anon;
grant execute on function public.import_legacy_staff_record(text, text, text, text, text, text, text, text, text, text, text, date, numeric, smallint, numeric, numeric, text, boolean, boolean)
  to authenticated;

comment on table public.legacy_staff_imports is
  'Idempotency and audit metadata for owner-confirmed profile-only imports of legacy staff; raw source rows are not stored.';
comment on function public.import_legacy_staff_record(text, text, text, text, text, text, text, text, text, text, text, date, numeric, smallint, numeric, numeric, text, boolean, boolean) is
  'Atomically imports one staff profile and current compensation configuration. Attendance and salary-payment history are excluded.';
