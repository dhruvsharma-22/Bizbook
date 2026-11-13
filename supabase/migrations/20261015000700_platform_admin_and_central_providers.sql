-- Platform-level administrators, central provider configuration, and subscription records.
-- No administrator is seeded here. Provision the first platform administrator only through
-- a trusted service-role operation after verifying the target user's Auth UUID.

do $$
begin
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
     or to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') is null then
    raise exception 'Supabase Vault is required before configuring platform providers';
  end if;
end;
$$;

create table public.platform_administrators (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'operator' check (role in ('owner', 'operator', 'support')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.platform_administrators enable row level security;
revoke all on public.platform_administrators from public, anon, authenticated;
grant all on public.platform_administrators to service_role;

create or replace function bizbook_private.is_platform_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_administrators pa
    where pa.user_id = auth.uid()
  );
$$;
revoke all on function bizbook_private.is_platform_administrator() from public, anon;
grant execute on function bizbook_private.is_platform_administrator() to authenticated;

create table public.platform_provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider_scope text not null check (provider_scope in ('payment', 'email', 'whatsapp')),
  provider text not null,
  account_reference text,
  secret_reference text,
  environment text not null default 'test' check (environment = 'test'),
  connection_status text not null default 'pending'
    check (connection_status in ('inactive', 'pending', 'active', 'disabled')),
  last_verified_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_scope, provider),
  check (
    (provider_scope = 'payment' and provider in ('razorpay', 'cashfree')) or
    (provider_scope = 'email' and provider = 'resend') or
    (provider_scope = 'whatsapp' and provider = 'whatsapp_cloud')
  )
);
create index platform_provider_connections_status_idx
  on public.platform_provider_connections (provider_scope, connection_status);
alter table public.platform_provider_connections enable row level security;
create policy platform_provider_connections_select_admin
  on public.platform_provider_connections for select to authenticated
  using (bizbook_private.is_platform_administrator());
revoke all on public.platform_provider_connections from public, anon, authenticated;
grant select (id, provider_scope, provider, account_reference, environment,
              connection_status, last_verified_at, created_at, updated_at)
  on public.platform_provider_connections to authenticated;
grant all on public.platform_provider_connections to service_role;
create trigger platform_provider_connections_updated_at
  before update on public.platform_provider_connections
  for each row execute function bizbook_private.set_updated_at();

create table public.platform_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(details::text) <= 8192)
);
create index platform_admin_audit_events_created_idx
  on public.platform_admin_audit_events (created_at desc);
alter table public.platform_admin_audit_events enable row level security;
create policy platform_admin_audit_events_select_admin
  on public.platform_admin_audit_events for select to authenticated
  using (bizbook_private.is_platform_administrator());
revoke all on public.platform_admin_audit_events from public, anon, authenticated;
grant select on public.platform_admin_audit_events to authenticated;
grant all on public.platform_admin_audit_events to service_role;

create table public.platform_subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  subscription_id uuid,
  invoice_number text not null unique,
  billing_period_start timestamptz not null,
  billing_period_end timestamptz not null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'open' check (status in ('draft', 'open', 'paid', 'past_due', 'void')),
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (billing_period_end >= billing_period_start),
  check (status <> 'paid' or paid_at is not null),
  unique (id, institute_id)
);
create index platform_subscription_invoices_tenant_time_idx
  on public.platform_subscription_invoices (institute_id, created_at desc);
create index platform_subscription_invoices_status_due_idx
  on public.platform_subscription_invoices (status, due_at);
alter table public.platform_subscription_invoices enable row level security;
create policy platform_subscription_invoices_select_admin
  on public.platform_subscription_invoices for select to authenticated
  using (bizbook_private.is_platform_administrator());
create policy platform_subscription_invoices_select_institute_manager
  on public.platform_subscription_invoices for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
revoke all on public.platform_subscription_invoices from public, anon, authenticated;
grant select on public.platform_subscription_invoices to authenticated;
grant all on public.platform_subscription_invoices to service_role;
create trigger platform_subscription_invoices_updated_at
  before update on public.platform_subscription_invoices
  for each row execute function bizbook_private.set_updated_at();

create table public.platform_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  provider text not null check (provider in ('razorpay', 'cashfree')),
  provider_order_id text,
  provider_payment_id text,
  status text not null check (status in ('created', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  verified_at timestamptz,
  idempotency_key text not null unique,
  attempt_number integer not null check (attempt_number > 0),
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_payment_attempts_invoice_tenant_fkey
  foreign key (invoice_id, institute_id)
    references public.platform_subscription_invoices(id, institute_id) on delete restrict
);
create index platform_payment_attempts_invoice_idx
  on public.platform_payment_attempts (invoice_id, created_at desc);
create index platform_payment_attempts_status_idx
  on public.platform_payment_attempts (status, created_at desc);
create unique index platform_payment_attempts_provider_order_unique
  on public.platform_payment_attempts (provider, provider_order_id) where provider_order_id is not null;
create unique index platform_payment_attempts_provider_payment_unique
  on public.platform_payment_attempts (provider, provider_payment_id) where provider_payment_id is not null;
alter table public.platform_payment_attempts enable row level security;
create policy platform_payment_attempts_select_admin
  on public.platform_payment_attempts for select to authenticated
  using (bizbook_private.is_platform_administrator());
create policy platform_payment_attempts_select_institute_manager
  on public.platform_payment_attempts for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
revoke all on public.platform_payment_attempts from public, anon, authenticated;
grant select on public.platform_payment_attempts to authenticated;
grant all on public.platform_payment_attempts to service_role;
create trigger platform_payment_attempts_updated_at
  before update on public.platform_payment_attempts
  for each row execute function bizbook_private.set_updated_at();

create table public.platform_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  description text,
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  annual_price numeric(12,2) not null default 0 check (annual_price >= 0),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  student_limit integer check (student_limit is null or student_limit >= 0),
  staff_limit integer check (staff_limit is null or staff_limit >= 0),
  branch_limit integer check (branch_limit is null or branch_limit >= 0),
  features jsonb not null default '{}'::jsonb,
  is_available boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_subscription_plans enable row level security;
create policy platform_subscription_plans_select_admin
  on public.platform_subscription_plans for select to authenticated
  using (bizbook_private.is_platform_administrator());
create policy platform_subscription_plans_select_available
  on public.platform_subscription_plans for select to authenticated
  using (is_available);
revoke all on public.platform_subscription_plans from public, anon, authenticated;
grant select on public.platform_subscription_plans to authenticated;
grant all on public.platform_subscription_plans to service_role;
create trigger platform_subscription_plans_updated_at
  before update on public.platform_subscription_plans
  for each row execute function bizbook_private.set_updated_at();

create table public.institute_subscriptions (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  plan_id uuid references public.platform_subscription_plans(id) on delete restrict,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled', 'expired')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institute_id),
  unique (id, institute_id),
  check (current_period_end is null or current_period_start is null or current_period_end >= current_period_start)
);
create index institute_subscriptions_status_period_idx
  on public.institute_subscriptions (status, current_period_end);
alter table public.institute_subscriptions enable row level security;
create policy institute_subscriptions_select_admin
  on public.institute_subscriptions for select to authenticated
  using (bizbook_private.is_platform_administrator());
create policy institute_subscriptions_select_institute_manager
  on public.institute_subscriptions for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
revoke all on public.institute_subscriptions from public, anon, authenticated;
grant select on public.institute_subscriptions to authenticated;
grant all on public.institute_subscriptions to service_role;
create trigger institute_subscriptions_updated_at
  before update on public.institute_subscriptions
  for each row execute function bizbook_private.set_updated_at();
alter table public.platform_subscription_invoices
  add constraint platform_subscription_invoices_subscription_id_fkey
  foreign key (subscription_id, institute_id) references public.institute_subscriptions(id, institute_id) on delete restrict;

create table public.platform_subscription_events (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  subscription_id uuid references public.institute_subscriptions(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (octet_length(details::text) <= 8192)
);
create index platform_subscription_events_tenant_time_idx
  on public.platform_subscription_events (institute_id, created_at desc);
alter table public.platform_subscription_events enable row level security;
create policy platform_subscription_events_select_admin
  on public.platform_subscription_events for select to authenticated
  using (bizbook_private.is_platform_administrator());
create policy platform_subscription_events_select_institute_manager
  on public.platform_subscription_events for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
revoke all on public.platform_subscription_events from public, anon, authenticated;
grant select on public.platform_subscription_events to authenticated;
grant all on public.platform_subscription_events to service_role;

create or replace function public.save_platform_provider_credentials(
  p_provider_scope text,
  p_provider text,
  p_account_reference text,
  p_credentials jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret_reference text;
  v_secret_id uuid;
  v_secret_name text;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.is_platform_administrator() then
    raise exception using errcode = '42501', message = 'Platform administrator access is required';
  end if;
  if p_provider_scope is null or p_provider is null
     or p_provider_scope not in ('payment', 'email', 'whatsapp')
     or (p_provider_scope = 'payment' and p_provider not in ('razorpay', 'cashfree'))
     or (p_provider_scope = 'email' and p_provider <> 'resend')
     or (p_provider_scope = 'whatsapp' and p_provider <> 'whatsapp_cloud') then
    raise exception using errcode = '22023', message = 'Unsupported platform provider';
  end if;
  if jsonb_typeof(p_credentials) is distinct from 'object'
     or octet_length(p_credentials::text) > 16384 then
    raise exception using errcode = '22023', message = 'Provider credentials are invalid';
  end if;
  if (p_provider = 'resend' and (
       nullif(btrim(p_credentials ->> 'api_key'), '') is null
       or nullif(btrim(p_credentials ->> 'from_email'), '') is null
       or nullif(btrim(p_credentials ->> 'sender_name'), '') is null
       or nullif(btrim(p_credentials ->> 'webhook_signing_secret'), '') is null))
     or (p_provider = 'resend' and (
       (p_credentials ->> 'from_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       or (p_credentials ->> 'sender_name') ~ '[<>[:cntrl:]]'))
     or (p_provider = 'whatsapp_cloud' and (
       nullif(btrim(p_credentials ->> 'access_token'), '') is null
       or nullif(btrim(p_credentials ->> 'phone_number_id'), '') is null
       or nullif(btrim(p_credentials ->> 'api_version'), '') is null
       or nullif(btrim(p_credentials ->> 'template_name'), '') is null
       or nullif(btrim(p_credentials ->> 'template_language'), '') is null
       or (p_credentials ->> 'phone_number_id') !~ '^[0-9]{5,30}$'
       or (p_credentials ->> 'business_account_id') !~ '^[0-9]{5,30}$'
       or (p_credentials ->> 'api_version') !~ '^v[0-9]+\.[0-9]+$'
       or (p_credentials ->> 'template_name') !~ '^[A-Za-z0-9_-]{1,100}$'
       or (p_credentials ->> 'template_language') !~ '^[A-Za-z0-9_-]{2,20}$'))
     or (p_provider = 'razorpay' and (
       nullif(btrim(p_credentials ->> 'key_id'), '') is null
       or nullif(btrim(p_credentials ->> 'key_secret'), '') is null
       or nullif(btrim(p_credentials ->> 'webhook_secret'), '') is null
       or (p_credentials ->> 'key_id') !~ '^rzp_test_[A-Za-z0-9]+$'))
     or (p_provider = 'cashfree' and (
       nullif(btrim(p_credentials ->> 'client_id'), '') is null
       or nullif(btrim(p_credentials ->> 'client_secret'), '') is null
       or nullif(btrim(p_credentials ->> 'webhook_secret'), '') is null)) then
    raise exception using errcode = '22023', message = 'Required provider credentials are missing';
  end if;

  select c.secret_reference into v_secret_reference
    from public.platform_provider_connections c
   where c.provider_scope = p_provider_scope and c.provider = p_provider
   for update;
  v_secret_name := 'bizbook-platform:' || p_provider_scope || ':' || p_provider || ':' || gen_random_uuid()::text;
  if v_secret_reference is null then
    v_secret_id := vault.create_secret(p_credentials::text, v_secret_name, 'BizBook central provider credentials');
    v_secret_reference := v_secret_id::text;
  else
    perform vault.update_secret(v_secret_reference::uuid, p_credentials::text, v_secret_name, 'BizBook central provider credentials');
  end if;

  insert into public.platform_provider_connections (
    provider_scope, provider, account_reference, secret_reference, environment,
    connection_status, last_verified_at, updated_by
  ) values (
    p_provider_scope, p_provider, nullif(btrim(p_account_reference), ''), v_secret_reference,
    'test', 'pending', null, v_user_id
  ) on conflict (provider_scope, provider) do update set
    account_reference = excluded.account_reference,
    secret_reference = excluded.secret_reference,
    environment = 'test',
    connection_status = 'pending',
    last_verified_at = null,
    updated_by = excluded.updated_by;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'provider_credentials_saved', 'platform_provider', p_provider_scope || ':' || p_provider,
          jsonb_build_object('environment', 'test', 'status', 'pending'));

  return jsonb_build_object('provider_scope', p_provider_scope, 'provider', p_provider,
                            'environment', 'test', 'connection_status', 'pending');
end;
$$;

create or replace function public.get_platform_provider_credentials(
  p_provider_scope text,
  p_provider text,
  p_allow_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_reference text;
  v_credentials jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  select c.secret_reference into v_secret_reference
    from public.platform_provider_connections c
   where c.provider_scope = p_provider_scope and c.provider = p_provider
     and c.environment = 'test'
     and (c.connection_status = 'active' or (p_allow_pending and c.connection_status = 'pending'));
  if v_secret_reference is null then return null; end if;
  select s.decrypted_secret::jsonb into v_credentials
    from vault.decrypted_secrets s where s.id = v_secret_reference::uuid;
  return v_credentials;
end;
$$;

revoke all on function public.save_platform_provider_credentials(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_platform_provider_credentials(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.save_platform_provider_credentials(text, text, text, jsonb) to authenticated;
grant execute on function public.get_platform_provider_credentials(text, text, boolean) to service_role;

-- Stop institute users from replacing the central sender. Existing metadata/secrets are retained,
-- but the reminder job no longer reads them and there is no user-session credential writer.
revoke all on function public.save_notification_provider_credentials(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_notification_provider_credentials(text, text, boolean)
  from public, anon, authenticated, service_role;
comment on function public.save_notification_provider_credentials(text, text, text, jsonb) is
  'Retired by the platform central-sender migration; legacy institute Vault references are retained but are not used for delivery.';
comment on function public.get_notification_provider_credentials(text, text, boolean) is
  'Retired by the platform central-sender migration; service jobs must resolve central sender credentials instead.';

-- Platform administrators can inspect delivery status, but notification_logs only stores a
-- recipient fingerprint; raw email/phone values are not part of this audit surface.
create policy notification_logs_select_platform_admin
  on public.notification_logs for select to authenticated
  using (bizbook_private.is_platform_administrator());

comment on table public.platform_administrators is
  'Platform-level roles provisioned only by trusted service-role operations; no public bootstrap path.';
comment on table public.platform_provider_connections is
  'Central BizBook provider metadata. Credentials are held in Supabase Vault and test mode only.';
comment on function public.get_platform_provider_credentials(text, text, boolean) is
  'Returns central test credentials only to service_role; never callable by browser sessions.';
