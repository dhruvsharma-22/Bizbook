-- Owner-confirmed, idempotent import of explicitly reviewed legacy expense
-- rows. The raw browser payload is never stored in the database.

create unique index expenses_id_institute_uidx
  on public.expenses (id, institute_id);

create table public.legacy_expense_imports (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null,
  branch_id text,
  source_key text not null check (source_key = 'bizbook-other-expenses-v1'),
  source_record_id text not null check (length(btrim(source_record_id)) between 1 and 200),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  expense_id text not null,
  imported_by uuid not null references auth.users(id) on delete restrict,
  imported_at timestamptz not null default now(),
  unique (institute_id, source_key, source_record_id),
  unique (expense_id, institute_id),
  foreign key (institute_id) references public.coaching_institutes(id) on delete restrict,
  foreign key (branch_id, institute_id) references public.branches(id, institute_id) on delete restrict,
  foreign key (expense_id, institute_id) references public.expenses(id, institute_id) on delete restrict
);

create index legacy_expense_imports_institute_time_idx
  on public.legacy_expense_imports (institute_id, imported_at desc);

alter table public.legacy_expense_imports enable row level security;
revoke all on public.legacy_expense_imports from public, anon, authenticated;
grant select on public.legacy_expense_imports to authenticated;

create policy legacy_expense_imports_select_authorized on public.legacy_expense_imports
  for select to authenticated
  using (
    auth.role() = 'authenticated'
    and bizbook_private.has_institute_role(institute_id, array['owner', 'administrator']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id)
  );

create or replace function public.import_legacy_expense_record(
  p_institute_id text,
  p_branch_id text,
  p_source_key text,
  p_source_record_id text,
  p_source_fingerprint text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_expense_date date,
  p_method text,
  p_notes text,
  p_confirm_historical_expense boolean
)
returns table (imported_expense_id text, was_already_imported boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.legacy_expense_imports%rowtype;
  v_expense_id text;
  v_business_date date;
  v_import_id uuid;
begin
  if v_actor_id is null
     or auth.role() is distinct from 'authenticated'
     or not bizbook_private.has_institute_role(p_institute_id, array['owner', 'administrator']::text[])
     or not bizbook_private.can_write_branch(p_institute_id, p_branch_id) then
    raise exception 'Authorized institute administrator access is required.' using errcode = '42501';
  end if;

  if p_confirm_historical_expense is distinct from true
     or p_source_key is distinct from 'bizbook-other-expenses-v1'
     or p_source_record_id is null
     or length(btrim(p_source_record_id)) not between 1 and 200
     or p_source_fingerprint is null
     or p_source_fingerprint !~ '^[0-9a-f]{64}$'
     or p_title is null or length(btrim(p_title)) not between 1 and 120
     or p_category is null or length(btrim(p_category)) not between 1 and 100
     or p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
     or p_amount <> round(p_amount, 2)
     or p_expense_date is null
     or p_method is null or p_method not in ('Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Online', 'Other')
     or (p_notes is not null and length(btrim(p_notes)) > 500) then
    raise exception 'Legacy expense details or confirmation are invalid.' using errcode = '22023';
  end if;

  select (now() at time zone i.time_zone)::date into v_business_date
  from public.coaching_institutes i where i.id = p_institute_id;
  if not found or p_expense_date > v_business_date then
    raise exception 'Expense date cannot be after the institute business date.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_institute_id || chr(31) || p_source_key || chr(31) || p_source_record_id, 0)
  );

  select i.* into v_existing
  from public.legacy_expense_imports i
  where i.institute_id = p_institute_id
    and i.source_key = p_source_key
    and i.source_record_id = p_source_record_id
  for update;
  if found then
    if v_existing.source_fingerprint is distinct from p_source_fingerprint then
      raise exception 'This legacy expense changed after a previous import.' using errcode = '23505';
    end if;
    return query select v_existing.expense_id, true;
    return;
  end if;

  if exists (
    select 1 from public.expenses e
    where e.institute_id = p_institute_id
      and e.legacy_data->>'source_key' = p_source_key
      and e.legacy_data->>'source_record_id' = p_source_record_id
  ) then
    raise exception 'An expense already refers to this legacy source without an import mapping.' using errcode = '23505';
  end if;

  v_expense_id := gen_random_uuid()::text;
  insert into public.expenses (
    id, institute_id, branch_id, title, category, amount, expense_date, method,
    notes, legacy_data, created_by
  ) values (
    v_expense_id, p_institute_id, p_branch_id, btrim(p_title), btrim(p_category),
    p_amount::numeric(12,2), p_expense_date, p_method, nullif(btrim(p_notes), ''),
    jsonb_build_object(
      'source_key', p_source_key,
      'source_record_id', p_source_record_id,
      'import_mode', 'reviewed_legacy_expense'
    ), v_actor_id
  );

  insert into public.legacy_expense_imports (
    institute_id, branch_id, source_key, source_record_id, source_fingerprint, expense_id, imported_by
  ) values (
    p_institute_id, p_branch_id, p_source_key, p_source_record_id, p_source_fingerprint, v_expense_id, v_actor_id
  ) returning id into v_import_id;

  insert into public.audit_logs (
    institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata
  ) values (
    p_institute_id, p_branch_id, 'legacy_expense_import', v_import_id::text, 'INSERT', v_actor_id,
    jsonb_build_object('source_key', p_source_key, 'target_expense_id', v_expense_id, 'import_mode', 'reviewed_legacy_expense')
  );

  return query select v_expense_id, false;
end;
$$;

revoke all on function public.import_legacy_expense_record(text, text, text, text, text, text, text, numeric, date, text, text, boolean)
  from public, anon;
grant execute on function public.import_legacy_expense_record(text, text, text, text, text, text, text, numeric, date, text, text, boolean)
  to authenticated;

comment on table public.legacy_expense_imports is
  'Idempotency and audit metadata for owner-confirmed imports of reviewed legacy expenses; raw source rows are not stored.';
comment on function public.import_legacy_expense_record(text, text, text, text, text, text, text, numeric, date, text, text, boolean) is
  'Atomically imports one explicitly reviewed legacy expense under owner and branch authorization, with an immutable source fingerprint.';
