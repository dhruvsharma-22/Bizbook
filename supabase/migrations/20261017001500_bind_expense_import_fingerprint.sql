-- The first test-only importer accepted a caller-provided fingerprint. Retire
-- that RPC and bind idempotency to the exact normalized fields inside Postgres.
revoke all on function public.import_legacy_expense_record(text, text, text, text, text, text, text, numeric, date, text, text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.import_legacy_expense_record_verified(
  p_institute_id text,
  p_branch_id text,
  p_source_key text,
  p_source_record_id text,
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
  v_source_fingerprint text;
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

  v_source_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object(
      'institute_id', p_institute_id,
      'branch_id', p_branch_id,
      'source_key', p_source_key,
      'source_record_id', p_source_record_id,
      'title', btrim(p_title),
      'category', btrim(p_category),
      'amount', p_amount::numeric(12,2)::text,
      'expense_date', p_expense_date::text,
      'method', p_method,
      'notes', nullif(btrim(p_notes), '')
    )::text,
    'sha256'
  ), 'hex');

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
    if v_existing.source_fingerprint is distinct from v_source_fingerprint then
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
    p_institute_id, p_branch_id, p_source_key, p_source_record_id, v_source_fingerprint, v_expense_id, v_actor_id
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

revoke all on function public.import_legacy_expense_record_verified(text, text, text, text, text, text, numeric, date, text, text, boolean)
  from public, anon, service_role;
grant execute on function public.import_legacy_expense_record_verified(text, text, text, text, text, text, numeric, date, text, text, boolean)
  to authenticated;

comment on function public.import_legacy_expense_record_verified(text, text, text, text, text, text, numeric, date, text, text, boolean) is
  'Atomically imports a reviewed legacy expense; the server hashes the exact normalized values to bind source idempotency.';

notify pgrst, 'reload schema';
