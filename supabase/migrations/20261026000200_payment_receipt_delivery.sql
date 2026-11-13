-- Durable, channel-specific delivery records for verified fee receipts.
-- Existing receipts are not backfilled: only payments recorded after this migration
-- produce automatic messages.

alter table public.students
  add column if not exists whatsapp_receipt_opt_in boolean not null default false,
  add column if not exists email_receipt_opt_in boolean not null default false;

grant update (whatsapp_receipt_opt_in, email_receipt_opt_in)
  on public.students to authenticated;

alter table public.platform_provider_connections
  add column if not exists receipt_delivery_enabled boolean not null default false;
grant select (receipt_delivery_enabled)
  on public.platform_provider_connections to authenticated;

create table public.fee_receipts (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null,
  branch_id text,
  student_id text not null,
  payment_id text not null unique,
  receipt_number text not null unique,
  created_at timestamptz not null default now(),
  unique (id, institute_id, branch_id),
  foreign key (payment_id, institute_id, student_id)
    references public.payments(id, institute_id, student_id) on delete restrict,
  foreign key (branch_id, institute_id)
    references public.branches(id, institute_id) on delete restrict
);

create index fee_receipts_scope_created_idx
  on public.fee_receipts (institute_id, branch_id, created_at desc);

create table public.fee_receipt_deliveries (
  id text primary key default gen_random_uuid()::text,
  receipt_id text not null references public.fee_receipts(id) on delete restrict,
  channel text not null check (channel in ('WhatsApp', 'Email')),
  delivery_status text not null default 'Queued'
    check (delivery_status in ('Queued', 'Processing', 'Sent', 'Failed', 'Unknown', 'Skipped')),
  provider text,
  provider_message_reference text,
  recipient_fingerprint text
    check (recipient_fingerprint is null or recipient_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null default gen_random_uuid()::text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  retryable boolean not null default true,
  next_attempt_at timestamptz,
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'),
  attempted_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (receipt_id, channel)
);

create index fee_receipt_deliveries_queue_idx
  on public.fee_receipt_deliveries (delivery_status, next_attempt_at, created_at)
  where delivery_status in ('Queued', 'Failed');

alter table public.fee_receipts enable row level security;
create policy fee_receipts_select_finance
  on public.fee_receipts for select to authenticated
  using (
    bizbook_private.has_institute_role(institute_id, array['owner', 'administrator', 'accountant']::text[])
    and bizbook_private.can_access_branch(institute_id, branch_id)
  );
revoke all on public.fee_receipts from public, anon, authenticated;
grant select on public.fee_receipts to authenticated;
grant all on public.fee_receipts to service_role;

alter table public.fee_receipt_deliveries enable row level security;
create policy fee_receipt_deliveries_select_finance
  on public.fee_receipt_deliveries for select to authenticated
  using (exists (
    select 1 from public.fee_receipts r
     where r.id = receipt_id
       and bizbook_private.has_institute_role(r.institute_id, array['owner', 'administrator', 'accountant']::text[])
       and bizbook_private.can_access_branch(r.institute_id, r.branch_id)
  ));
revoke all on public.fee_receipt_deliveries from public, anon, authenticated;
grant select on public.fee_receipt_deliveries to authenticated;
grant all on public.fee_receipt_deliveries to service_role;

create trigger fee_receipts_tenant_immutable
  before update on public.fee_receipts
  for each row execute function bizbook_private.prevent_institute_transfer();

create or replace function bizbook_private.enqueue_paid_fee_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt_id text;
  v_receipt_number text;
begin
  if new.receipt_kind <> 'Fee'
     or new.status <> 'Paid'
     or new.created_by is null
     or (new.mode = 'Online' and new.verified_at is null) then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'Paid' then
    return new;
  end if;

  v_receipt_number := 'BBR-' || to_char(new.payment_date, 'YYYYMMDD') || '-'
    || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.fee_receipts (
    institute_id, branch_id, student_id, payment_id, receipt_number
  ) values (
    new.institute_id, new.branch_id, new.student_id, new.id, v_receipt_number
  ) on conflict (payment_id) do nothing
  returning id into v_receipt_id;

  if v_receipt_id is not null then
    insert into public.fee_receipt_deliveries (receipt_id, channel)
    values (v_receipt_id, 'WhatsApp')
    on conflict (receipt_id, channel) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function bizbook_private.enqueue_paid_fee_receipt() from public, anon, authenticated;

create trigger enqueue_paid_fee_receipt
  after insert or update of status on public.payments
  for each row execute function bizbook_private.enqueue_paid_fee_receipt();

create or replace function public.set_platform_receipt_delivery_enabled(
  p_provider_scope text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_provider text;
  v_secret_reference text;
  v_last_verified_at timestamptz;
  v_connection_status text;
  v_credentials jsonb;
begin
  if auth.role() is distinct from 'authenticated'
     or v_user_id is null
     or not exists (
       select 1 from public.platform_administrators
        where user_id = v_user_id and role = 'owner'
     ) then
    raise exception using errcode = '42501', message = 'Platform owner access is required';
  end if;
  if p_provider_scope not in ('whatsapp', 'email') or p_enabled is null then
    raise exception using errcode = '22023', message = 'Receipt delivery channel is invalid';
  end if;
  v_provider := case when p_provider_scope = 'whatsapp' then 'whatsapp_cloud' else 'resend' end;

  select c.secret_reference, c.last_verified_at, c.connection_status
    into v_secret_reference, v_last_verified_at, v_connection_status
    from public.platform_provider_connections c
   where c.provider_scope = p_provider_scope
     and c.provider = v_provider
     and c.environment = 'test'
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Save and verify the selected sender settings first';
  end if;

  if p_enabled then
    if v_connection_status <> 'pending' or v_last_verified_at is null or v_secret_reference is null then
      raise exception using errcode = '55000', message = 'Verify the test sender before enabling receipt delivery';
    end if;
    select s.decrypted_secret::jsonb into v_credentials
      from vault.decrypted_secrets s where s.id = v_secret_reference::uuid;
    if p_provider_scope = 'whatsapp' and (
      nullif(btrim(v_credentials ->> 'receipt_template_name'), '') is null
      or nullif(btrim(v_credentials ->> 'receipt_template_language'), '') is null
      or (v_credentials ->> 'receipt_template_name') !~ '^[A-Za-z0-9_-]{1,100}$'
      or (v_credentials ->> 'receipt_template_language') !~ '^[A-Za-z0-9_-]{2,20}$'
    ) then
      raise exception using errcode = '22023', message = 'Add the approved PDF receipt template name and language first';
    end if;
    if p_provider_scope = 'email' and (
      nullif(btrim(v_credentials ->> 'api_key'), '') is null
      or nullif(btrim(v_credentials ->> 'from_email'), '') is null
    ) then
      raise exception using errcode = '22023', message = 'Save a verified email sender first';
    end if;
  end if;

  update public.platform_provider_connections
     set receipt_delivery_enabled = p_enabled,
         updated_by = v_user_id
   where provider_scope = p_provider_scope and provider = v_provider;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (
    v_user_id,
    case when p_enabled then 'fee_receipt_delivery_enabled' else 'fee_receipt_delivery_disabled' end,
    'platform_provider', p_provider_scope || ':' || v_provider,
    jsonb_build_object('enabled', p_enabled, 'environment', 'test')
  );
  return jsonb_build_object('enabled', p_enabled, 'channel', p_provider_scope, 'environment', 'test');
end;
$$;
revoke all on function public.set_platform_receipt_delivery_enabled(text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.set_platform_receipt_delivery_enabled(text, boolean) to authenticated;

comment on table public.fee_receipts is
  'One durable printable receipt per newly recorded paid student fee payment; excludes advances and legacy backfills.';
comment on table public.fee_receipt_deliveries is
  'Idempotent WhatsApp/email receipt delivery outbox. Stores a recipient fingerprint and safe status only, never a raw contact value.';
