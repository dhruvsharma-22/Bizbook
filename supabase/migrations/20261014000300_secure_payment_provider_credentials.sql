-- Payment provider credentials are entered by an institute owner/administrator,
-- then encrypted by Supabase Vault. Institute managers can call a narrow save
-- function that rechecks their membership; only the trusted server role can
-- resolve credentials for provider requests.

do $$
begin
  if to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('vault.create_secret(text,text,text,uuid)') is null
     or to_regprocedure('vault.update_secret(uuid,text,text,text,uuid)') is null then
    raise exception 'Supabase Vault is required before configuring payment credentials';
  end if;
end;
$$;

comment on column public.payment_connections.secret_reference is
  'UUID reference to encrypted Supabase Vault data; never contains a provider credential.';

create table public.notification_provider_connections (
  id text primary key default gen_random_uuid()::text,
  institute_id text not null references public.coaching_institutes(id) on delete restrict,
  provider text not null check (provider in ('resend', 'whatsapp_cloud')),
  account_reference text,
  secret_reference text,
  environment text not null default 'test' check (environment in ('test', 'production')),
  connection_status text not null default 'inactive'
    check (connection_status in ('inactive', 'pending', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institute_id, provider)
);

alter table public.notification_provider_connections enable row level security;
create policy notification_provider_connections_select_manager
  on public.notification_provider_connections for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
revoke all on table public.notification_provider_connections from public, anon, authenticated;
grant select (id, institute_id, provider, account_reference, environment, connection_status, created_at, updated_at)
  on public.notification_provider_connections to authenticated;
grant all on table public.notification_provider_connections to service_role;
comment on column public.notification_provider_connections.secret_reference is
  'UUID reference to encrypted Supabase Vault data; never contains a provider credential.';
create trigger notification_provider_connections_updated_at
  before update on public.notification_provider_connections
  for each row execute function bizbook_private.set_updated_at();

create or replace function public.save_payment_connection_credentials(
  p_institute_id text,
  p_provider text,
  p_merchant_account_reference text,
  p_credentials jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_reference text;
  v_secret_id uuid;
  v_secret_name text;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception using errcode = '42501', message = 'Institute administrator access is required';
  end if;
  if p_provider is null or p_provider not in ('razorpay', 'cashfree') then
    raise exception using errcode = '22023', message = 'Unsupported payment provider';
  end if;
  if jsonb_typeof(p_credentials) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Provider credentials must be an object';
  end if;
  if octet_length(p_credentials::text) > 16384 then
    raise exception using errcode = '22023', message = 'Provider credentials are too large';
  end if;
  if p_provider = 'razorpay' and (
    nullif(btrim(p_credentials ->> 'key_id'), '') is null
    or nullif(btrim(p_credentials ->> 'key_secret'), '') is null
    or nullif(btrim(p_credentials ->> 'webhook_secret'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'Razorpay test credentials are incomplete';
  end if;
  if p_provider = 'cashfree' and (
    nullif(btrim(p_credentials ->> 'client_id'), '') is null
    or nullif(btrim(p_credentials ->> 'client_secret'), '') is null
    or nullif(btrim(p_credentials ->> 'webhook_secret'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'Cashfree test credentials are incomplete';
  end if;

  select pc.secret_reference
    into v_secret_reference
    from public.payment_connections as pc
   where pc.institute_id = p_institute_id
     and pc.provider = p_provider
   for update;

  v_secret_name := 'bizbook-payment:' || p_institute_id || ':' || p_provider || ':' || gen_random_uuid()::text;

  if v_secret_reference is null then
    v_secret_id := vault.create_secret(
      p_credentials::text,
      v_secret_name,
      'BizBook test credentials for ' || p_provider
    );
    v_secret_reference := v_secret_id::text;
  else
    perform vault.update_secret(
      v_secret_reference::uuid,
      p_credentials::text,
      v_secret_name,
      'BizBook test credentials for ' || p_provider
    );
  end if;

  insert into public.payment_connections (
    institute_id,
    provider,
    merchant_account_reference,
    secret_reference,
    environment,
    connection_status
  ) values (
    p_institute_id,
    p_provider,
    nullif(btrim(p_merchant_account_reference), ''),
    v_secret_reference,
    'test',
    'pending'
  )
  on conflict (institute_id, provider) do update
    set merchant_account_reference = excluded.merchant_account_reference,
        secret_reference = excluded.secret_reference,
        environment = 'test',
        connection_status = 'pending';

  return jsonb_build_object(
    'provider', p_provider,
    'environment', 'test',
    'connection_status', 'pending',
    'secret_saved', true
  );
end;
$$;

create or replace function public.get_payment_connection_credentials(
  p_institute_id text,
  p_provider text
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
  if p_provider is null or p_provider not in ('razorpay', 'cashfree') then
    raise exception using errcode = '22023', message = 'Unsupported payment provider';
  end if;

  select pc.secret_reference
    into v_secret_reference
    from public.payment_connections as pc
   where pc.institute_id = p_institute_id
     and pc.provider = p_provider
     and pc.environment = 'test'
     and pc.connection_status = 'active';

  if v_secret_reference is null then
    return null;
  end if;

  select ds.decrypted_secret::jsonb
    into v_credentials
    from vault.decrypted_secrets as ds
   where ds.id = v_secret_reference::uuid;

  return v_credentials;
end;
$$;

create or replace function public.save_notification_provider_credentials(
  p_institute_id text,
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
  v_secret_reference text;
  v_secret_id uuid;
  v_secret_name text;
begin
  if auth.role() is distinct from 'authenticated'
     or not bizbook_private.can_manage_institute(p_institute_id) then
    raise exception using errcode = '42501', message = 'Institute administrator access is required';
  end if;
  if p_provider is null or p_provider not in ('resend', 'whatsapp_cloud') then
    raise exception using errcode = '22023', message = 'Unsupported notification provider';
  end if;
  if jsonb_typeof(p_credentials) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Provider credentials must be an object';
  end if;
  if p_provider = 'resend' and (
    nullif(btrim(p_credentials ->> 'api_key'), '') is null
    or nullif(btrim(p_credentials ->> 'from_email'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'Email provider credentials are incomplete';
  end if;
  if p_provider = 'whatsapp_cloud' and (
    nullif(btrim(p_credentials ->> 'access_token'), '') is null
    or nullif(btrim(p_credentials ->> 'phone_number_id'), '') is null
    or nullif(btrim(p_credentials ->> 'business_account_id'), '') is null
    or nullif(btrim(p_credentials ->> 'app_secret'), '') is null
    or nullif(btrim(p_credentials ->> 'webhook_verify_token'), '') is null
    or nullif(btrim(p_credentials ->> 'api_version'), '') is null
    or nullif(btrim(p_credentials ->> 'template_name'), '') is null
    or nullif(btrim(p_credentials ->> 'template_language'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'WhatsApp provider credentials are incomplete';
  end if;
  if p_provider = 'resend' and (p_credentials ->> 'from_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Email sender address is invalid';
  end if;
  if p_provider = 'whatsapp_cloud' and (
    (p_credentials ->> 'phone_number_id') !~ '^[0-9]{5,30}$'
    or (p_credentials ->> 'business_account_id') !~ '^[0-9]{5,30}$'
    or (p_credentials ->> 'api_version') !~ '^v[0-9]+\.[0-9]+$'
    or (p_credentials ->> 'template_name') !~ '^[A-Za-z0-9_-]{1,100}$'
    or (p_credentials ->> 'template_language') !~ '^[A-Za-z0-9_-]{2,20}$'
  ) then
    raise exception using errcode = '22023', message = 'WhatsApp provider settings are invalid';
  end if;

  select pc.secret_reference
    into v_secret_reference
    from public.notification_provider_connections as pc
   where pc.institute_id = p_institute_id
     and pc.provider = p_provider
   for update;

  v_secret_name := 'bizbook-notification:' || p_institute_id || ':' || p_provider || ':' || gen_random_uuid()::text;
  if v_secret_reference is null then
    v_secret_id := vault.create_secret(
      p_credentials::text,
      v_secret_name,
      'BizBook test configuration for ' || p_provider
    );
    v_secret_reference := v_secret_id::text;
  else
    perform vault.update_secret(
      v_secret_reference::uuid,
      p_credentials::text,
      v_secret_name,
      'BizBook test configuration for ' || p_provider
    );
  end if;

  insert into public.notification_provider_connections (
    institute_id, provider, account_reference, secret_reference, environment, connection_status
  ) values (
    p_institute_id, p_provider, nullif(btrim(p_account_reference), ''), v_secret_reference, 'test', 'pending'
  )
  on conflict (institute_id, provider) do update
    set account_reference = excluded.account_reference,
        secret_reference = excluded.secret_reference,
        environment = 'test',
        connection_status = 'pending';

  return jsonb_build_object(
    'provider', p_provider,
    'environment', 'test',
    'connection_status', 'pending',
    'secret_saved', true
  );
end;
$$;

create or replace function public.get_notification_provider_credentials(
  p_institute_id text,
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
  if p_provider is null or p_provider not in ('resend', 'whatsapp_cloud') then
    raise exception using errcode = '22023', message = 'Unsupported notification provider';
  end if;

  select pc.secret_reference
    into v_secret_reference
    from public.notification_provider_connections as pc
   where pc.institute_id = p_institute_id
     and pc.provider = p_provider
     and pc.environment = 'test'
     and (pc.connection_status = 'active' or (p_allow_pending and pc.connection_status = 'pending'));

  if v_secret_reference is null then return null; end if;

  select ds.decrypted_secret::jsonb
    into v_credentials
    from vault.decrypted_secrets as ds
   where ds.id = v_secret_reference::uuid;
  return v_credentials;
end;
$$;

revoke all on function public.save_payment_connection_credentials(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_payment_connection_credentials(text, text)
  from public, anon, authenticated;
grant execute on function public.save_payment_connection_credentials(text, text, text, jsonb)
  to authenticated;
grant execute on function public.get_payment_connection_credentials(text, text)
  to service_role;
revoke all on function public.save_notification_provider_credentials(text, text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.get_notification_provider_credentials(text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.save_notification_provider_credentials(text, text, text, jsonb)
  to authenticated;
grant execute on function public.get_notification_provider_credentials(text, text, boolean)
  to service_role;

comment on function public.save_payment_connection_credentials(text, text, text, jsonb) is
  'Allows an institute owner/administrator to store test-mode credentials in Vault; returns metadata only.';
comment on function public.get_payment_connection_credentials(text, text) is
  'Resolves active test-mode payment credentials for trusted server-side use only.';
comment on function public.save_notification_provider_credentials(text, text, text, jsonb) is
  'Allows an institute owner/administrator to store test configuration in Vault; returns metadata only.';
comment on function public.get_notification_provider_credentials(text, text, boolean) is
  'Resolves active notification credentials, or pending credentials for trusted verification only.';
