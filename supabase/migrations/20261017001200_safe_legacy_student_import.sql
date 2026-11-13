-- Idempotent, tenant/branch-authorized import of student master records with
-- unpaid schedules only. Source browser payloads are never persisted here.

create table public.legacy_student_imports (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null,
  branch_id text,
  source_key text not null check (source_key = 'bizbook-students-staff-v1'),
  source_record_id text not null check (length(btrim(source_record_id)) between 1 and 200),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  student_id text not null,
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  unique (institute_id, source_key, source_record_id),
  unique (student_id, institute_id),
  foreign key (institute_id) references public.coaching_institutes(id) on delete restrict,
  foreign key (branch_id, institute_id) references public.branches(id, institute_id) on delete restrict,
  foreign key (student_id, institute_id) references public.students(id, institute_id) on delete restrict
);

create index legacy_student_imports_institute_time_idx
  on public.legacy_student_imports (institute_id, imported_at desc);

alter table public.legacy_student_imports enable row level security;
revoke all on public.legacy_student_imports from public, anon, authenticated;
grant select on public.legacy_student_imports to authenticated;

create policy legacy_student_imports_select_authorized on public.legacy_student_imports
  for select to authenticated
  using (
    auth.role() = 'authenticated'
    and bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id)
  );

create or replace function public.import_legacy_student_record(
  p_institute_id text,
  p_branch_id text,
  p_source_key text,
  p_source_record_id text,
  p_source_fingerprint text,
  p_student_id text,
  p_student jsonb,
  p_installments jsonb,
  p_confirm_unpaid_schedule boolean
)
returns table (imported_student_id text, was_already_imported boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.legacy_student_imports%rowtype;
  v_import_id uuid;
  v_saved_student_id text;
begin
  if v_actor_id is null
     or auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized institute administrator access is required.' using errcode = '42501';
  end if;
  if p_confirm_unpaid_schedule is distinct from true
     or p_source_key is distinct from 'bizbook-students-staff-v1'
     or p_source_record_id is null
     or length(btrim(p_source_record_id)) not between 1 and 200
     or p_source_fingerprint is null
     or p_source_fingerprint !~ '^[0-9a-f]{64}$'
     or p_student_id is null
     or p_student_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or jsonb_typeof(p_student) is distinct from 'object'
     or jsonb_typeof(p_installments) is distinct from 'array' then
    raise exception 'Legacy student import details or confirmation are invalid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_installments) > 120 then
    raise exception 'Legacy student import details or confirmation are invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_institute_id || chr(31) || p_source_key || chr(31) || p_source_record_id, 0)
  );

  select i.* into v_existing
  from public.legacy_student_imports i
  where i.institute_id = p_institute_id
    and i.source_key = p_source_key
    and i.source_record_id = p_source_record_id
  for update;
  if found then
    if v_existing.source_fingerprint is distinct from p_source_fingerprint then
      raise exception 'This legacy source record changed after a previous import.' using errcode = '23505';
    end if;
    return query select v_existing.student_id, true;
    return;
  end if;

  if exists (select 1 from public.students s where s.id = p_student_id) then
    raise exception 'The generated student ID is already in use.' using errcode = '23505';
  end if;

  v_saved_student_id := public.save_student_record(
    p_institute_id,
    p_branch_id,
    p_student_id,
    p_student,
    p_installments
  );

  insert into public.legacy_student_imports (
    institute_id, branch_id, source_key, source_record_id, source_fingerprint,
    student_id, imported_by
  ) values (
    p_institute_id, p_branch_id, p_source_key, p_source_record_id, p_source_fingerprint,
    v_saved_student_id, v_actor_id
  ) returning id into v_import_id;

  insert into public.audit_logs (
    institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata
  ) values (
    p_institute_id, p_branch_id, 'legacy_student_import', v_import_id::text, 'INSERT', v_actor_id,
    jsonb_build_object('source_key', p_source_key, 'target_student_id', v_saved_student_id)
  );

  return query select v_saved_student_id, false;
end;
$$;

revoke all on function public.import_legacy_student_record(text, text, text, text, text, text, jsonb, jsonb, boolean)
  from public, anon;
grant execute on function public.import_legacy_student_record(text, text, text, text, text, text, jsonb, jsonb, boolean)
  to authenticated;

comment on table public.legacy_student_imports is
  'Idempotency and audit metadata for owner-confirmed imports of new legacy student profiles with unpaid schedules; raw browser records are not stored.';
comment on function public.import_legacy_student_record(text, text, text, text, text, text, jsonb, jsonb, boolean) is
  'Atomically imports one new student and its unpaid schedule, records a source fingerprint, and returns the same target on exact retries.';
