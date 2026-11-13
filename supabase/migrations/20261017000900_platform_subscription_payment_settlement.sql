-- Test-only subscription invoice payment lifecycle. Provider callbacks and webhooks
-- must resolve credentials and verify provider state before invoking the finalizer.

alter table public.platform_payment_attempts
  add column initiated_by uuid references auth.users(id) on delete set null;

alter table public.platform_payment_attempts
  drop constraint if exists platform_payment_attempts_status_check;
alter table public.platform_payment_attempts
  add constraint platform_payment_attempts_status_check
  check (status in ('created', 'pending', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'reconciliation_required'));

alter table public.platform_payment_attempts
  add constraint platform_payment_attempts_id_invoice_institute_unique
  unique (id, invoice_id, institute_id);

create table public.platform_subscription_payment_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  invoice_id uuid not null,
  institute_id text not null,
  provider text not null check (provider in ('razorpay', 'cashfree')),
  provider_event_id text not null check (length(provider_event_id) between 1 and 255),
  provider_order_id text not null check (length(provider_order_id) between 1 and 200),
  provider_payment_id text check (provider_payment_id is null or length(provider_payment_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 120),
  observed_status text not null check (observed_status in ('pending', 'authorized', 'captured', 'failed', 'cancelled')),
  result_status text not null check (result_status in ('pending', 'authorized', 'paid', 'failed', 'cancelled', 'reconciliation_required', 'duplicate_event')),
  payload_sha256 text check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  constraint platform_subscription_payment_events_attempt_tenant_fkey
    foreign key (attempt_id, invoice_id, institute_id)
    references public.platform_payment_attempts(id, invoice_id, institute_id) on delete restrict,
  constraint platform_subscription_payment_events_invoice_tenant_fkey
    foreign key (invoice_id, institute_id)
    references public.platform_subscription_invoices(id, institute_id) on delete restrict,
  constraint platform_subscription_payment_events_provider_event_unique
    unique (provider, provider_event_id)
);

create index platform_subscription_payment_events_invoice_time_idx
  on public.platform_subscription_payment_events (invoice_id, created_at desc);
create index platform_subscription_payment_events_attempt_time_idx
  on public.platform_subscription_payment_events (attempt_id, created_at desc);

alter table public.platform_subscription_payment_events enable row level security;
create policy platform_subscription_payment_events_select_platform_operator
  on public.platform_subscription_payment_events for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));
create policy platform_subscription_payment_events_select_institute_manager
  on public.platform_subscription_payment_events for select to authenticated
  using (bizbook_private.can_manage_institute(institute_id));
revoke all on public.platform_subscription_payment_events from public, anon, authenticated;
grant select on public.platform_subscription_payment_events to authenticated;
grant all on public.platform_subscription_payment_events to service_role;

create or replace function public.start_platform_subscription_payment_attempt(
  p_invoice_id uuid,
  p_provider text,
  p_idempotency_key text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.platform_subscription_invoices%rowtype;
  v_attempt public.platform_payment_attempts%rowtype;
  v_attempt_number integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_provider is null or p_provider not in ('razorpay', 'cashfree')
     or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'Payment attempt fields are invalid';
  end if;
  if not exists (
    select 1
      from public.user_memberships m
      join public.coaching_institutes i on i.id = m.institute_id
      join public.platform_subscription_invoices inv on inv.institute_id = i.id
     where inv.id = p_invoice_id
       and m.user_id = p_actor_user_id
       and m.is_active
       and m.access_scope = 'institute'
       and m.role in ('owner', 'administrator')
       and i.account_status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Institute-wide owner or administrator access is required';
  end if;

  -- Return an identical prior request even after its invoice has been paid.
  select * into v_attempt
    from public.platform_payment_attempts
   where idempotency_key = p_idempotency_key;
  if found then
    if v_attempt.invoice_id <> p_invoice_id or v_attempt.provider <> p_provider
       or v_attempt.initiated_by is distinct from p_actor_user_id then
      raise exception using errcode = '23505', message = 'The idempotency key was used for different payment details';
    end if;
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'invoice_id', v_attempt.invoice_id,
      'provider', v_attempt.provider, 'provider_order_id', v_attempt.provider_order_id,
      'status', v_attempt.status, 'attempt_number', v_attempt.attempt_number,
      'created', false
    );
  end if;

  select * into v_invoice
    from public.platform_subscription_invoices
   where id = p_invoice_id
   for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice was not found'; end if;
  if v_invoice.status not in ('open', 'past_due') or v_invoice.currency <> 'INR' or v_invoice.amount <= 0 then
    raise exception using errcode = '23514', message = 'This invoice is not payable online';
  end if;

  -- The invoice lock serializes new attempts for this invoice; recheck the key
  -- in case a concurrent request inserted the same idempotency value.
  select * into v_attempt
    from public.platform_payment_attempts
   where idempotency_key = p_idempotency_key;
  if found then
    if v_attempt.invoice_id <> p_invoice_id or v_attempt.provider <> p_provider
       or v_attempt.initiated_by is distinct from p_actor_user_id then
      raise exception using errcode = '23505', message = 'The idempotency key was used for different payment details';
    end if;
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'invoice_id', v_attempt.invoice_id,
      'provider', v_attempt.provider, 'provider_order_id', v_attempt.provider_order_id,
      'status', v_attempt.status, 'attempt_number', v_attempt.attempt_number,
      'created', false
    );
  end if;

  -- Do not create a second payable order while a prior attempt is still
  -- unresolved. Exact retries returned above; terminal failed/cancelled
  -- attempts may be retried with a new idempotency key.
  if exists (
    select 1 from public.platform_payment_attempts a
     where a.invoice_id = p_invoice_id
       and a.status in ('created', 'pending', 'authorized', 'reconciliation_required')
  ) then
    raise exception using errcode = '55000', message = 'An existing subscription payment attempt must be reconciled first';
  end if;

  select coalesce(max(a.attempt_number), 0) + 1 into v_attempt_number
    from public.platform_payment_attempts a
   where a.invoice_id = p_invoice_id;
  insert into public.platform_payment_attempts(
    invoice_id, institute_id, provider, status, idempotency_key, attempt_number, initiated_by
  ) values (
    v_invoice.id, v_invoice.institute_id, p_provider, 'created',
    p_idempotency_key, v_attempt_number, p_actor_user_id
  ) returning * into v_attempt;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (p_actor_user_id, 'subscription_payment_attempt_created', 'subscription_invoice',
          v_invoice.id::text, jsonb_build_object('provider', p_provider, 'attempt_id', v_attempt.id));

  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'invoice_id', v_attempt.invoice_id,
    'provider', v_attempt.provider, 'provider_order_id', v_attempt.provider_order_id,
    'status', v_attempt.status, 'attempt_number', v_attempt.attempt_number,
    'amount', v_invoice.amount, 'currency', v_invoice.currency, 'created', true
  );
end;
$$;

create or replace function public.bind_platform_subscription_provider_order(
  p_attempt_id uuid,
  p_provider_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_attempt public.platform_payment_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_attempt_id is null or p_provider_order_id is null
     or length(p_provider_order_id) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'Provider order reference is invalid';
  end if;
  select * into v_attempt from public.platform_payment_attempts where id = p_attempt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payment attempt was not found'; end if;
  if v_attempt.provider_order_id is not null and v_attempt.provider_order_id <> p_provider_order_id then
    raise exception using errcode = '23505', message = 'Payment attempt is already bound to another provider order';
  end if;
  if v_attempt.status not in ('created', 'pending') then
    raise exception using errcode = '23514', message = 'Payment attempt is no longer awaiting a provider order';
  end if;
  update public.platform_payment_attempts
     set provider_order_id = p_provider_order_id, status = 'pending', safe_error_code = null
   where id = p_attempt_id
   returning * into v_attempt;
  return jsonb_build_object('attempt_id', v_attempt.id, 'provider_order_id', v_attempt.provider_order_id,
                            'status', v_attempt.status);
end;
$$;

create or replace function public.finalize_platform_subscription_payment(
  p_attempt_id uuid,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_provider_amount numeric,
  p_currency text,
  p_provider_event_id text,
  p_event_type text,
  p_payload_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.platform_payment_attempts%rowtype;
  v_invoice public.platform_subscription_invoices%rowtype;
  v_subscription public.institute_subscriptions%rowtype;
  v_invoice_snapshot public.platform_subscription_invoices%rowtype;
  v_result_status text;
  v_subscription_status text;
  v_should_activate boolean := false;
  v_old_status text;
  v_duplicate_provider_payment boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_attempt_id is null or p_provider_order_id is null
     or length(p_provider_order_id) not between 1 and 200
     or p_provider_status is null or p_provider_status not in ('captured', 'pending', 'authorized', 'failed', 'cancelled')
     or p_provider_event_id is null or length(p_provider_event_id) not between 1 and 255
     or p_event_type is null or length(p_event_type) not between 1 and 120
     or (p_payload_sha256 is not null and p_payload_sha256 !~ '^[a-f0-9]{64}$') then
    raise exception using errcode = '22023', message = 'Provider payment result is invalid';
  end if;
  if p_provider_status = 'captured'
     and (p_provider_payment_id is null or length(p_provider_payment_id) not between 1 and 200
          or p_provider_amount is null or p_provider_amount <= 0 or p_currency is distinct from 'INR') then
    raise exception using errcode = '22023', message = 'Captured payment details are invalid';
  end if;

  select * into v_attempt from public.platform_payment_attempts where id = p_attempt_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Payment attempt was not found'; end if;
  if v_attempt.provider_order_id is distinct from p_provider_order_id then
    raise exception using errcode = '23514', message = 'Provider order does not match the saved attempt';
  end if;
  if exists (
    select 1 from public.platform_subscription_payment_events e
     where e.provider = v_attempt.provider and e.provider_event_id = p_provider_event_id
  ) then
    return jsonb_build_object('status', 'duplicate_event', 'attempt_id', v_attempt.id,
                              'invoice_id', v_attempt.invoice_id);
  end if;

  -- Lock subscription before invoice, matching invoice issuance's lock order.
  select * into v_invoice_snapshot from public.platform_subscription_invoices
   where id = v_attempt.invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice was not found'; end if;
  if v_invoice_snapshot.subscription_id is not null then
    select * into v_subscription from public.institute_subscriptions
     where id = v_invoice_snapshot.subscription_id and institute_id = v_attempt.institute_id
     for update;
  end if;
  select * into v_invoice from public.platform_subscription_invoices
   where id = v_attempt.invoice_id for update;
  if v_invoice.institute_id <> v_attempt.institute_id
     or v_invoice.subscription_id is distinct from v_invoice_snapshot.subscription_id then
    raise exception using errcode = '23514', message = 'Invoice ownership changed during reconciliation';
  end if;

  v_old_status := v_attempt.status;
  v_result_status := p_provider_status;
  if v_attempt.status = 'paid' then
    if p_provider_status = 'captured' and v_attempt.provider_payment_id = p_provider_payment_id then
      v_result_status := 'duplicate_event';
    elsif p_provider_status = 'captured' then
      -- A second capture on one provider order is recorded for reconciliation;
      -- retain the first verified payment reference on the attempt row.
      v_result_status := 'reconciliation_required';
    else
      -- Late pending/failure events cannot downgrade an already verified capture.
      v_result_status := 'paid';
    end if;
  elsif p_provider_status = 'captured' then
    if v_invoice.status not in ('open', 'past_due') then
      v_result_status := 'reconciliation_required';
    elsif v_invoice.amount <> p_provider_amount or v_invoice.currency <> p_currency then
      v_result_status := 'reconciliation_required';
    elsif v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id <> p_provider_payment_id then
      v_result_status := 'reconciliation_required';
    elsif exists (
      select 1 from public.platform_payment_attempts other
       where other.provider = v_attempt.provider
         and other.provider_payment_id = p_provider_payment_id
         and other.id <> v_attempt.id
    ) then
      v_result_status := 'reconciliation_required';
      v_duplicate_provider_payment := true;
    elsif v_invoice.subscription_id is null or v_subscription.id is null then
      v_result_status := 'reconciliation_required';
    elsif v_invoice.status = 'paid' then
      v_result_status := 'reconciliation_required';
    else
      v_result_status := 'paid';
      v_should_activate := v_subscription.status in ('trialing', 'active', 'past_due');
    end if;
  elsif v_attempt.status in ('failed', 'cancelled') and p_provider_status in ('pending', 'authorized') then
    -- Stale non-terminal provider events cannot reopen a terminal attempt.
    v_result_status := v_attempt.status;
  elsif v_attempt.status = 'reconciliation_required' then
    v_result_status := 'reconciliation_required';
  end if;

  if v_result_status in ('pending', 'authorized', 'failed', 'cancelled') then
    update public.platform_payment_attempts
       set status = v_result_status,
           provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
           safe_error_code = case when v_result_status = 'failed' then 'provider_reported_failure' else null end,
           verified_at = case when v_result_status in ('failed', 'cancelled') then now() else verified_at end
     where id = v_attempt.id;
  elsif v_result_status = 'paid' then
    update public.platform_payment_attempts
       set status = 'paid', provider_payment_id = p_provider_payment_id,
           safe_error_code = null, verified_at = now()
     where id = v_attempt.id;
    update public.platform_subscription_invoices
       set status = 'paid', paid_at = now()
     where id = v_invoice.id;
    if v_should_activate then
      update public.institute_subscriptions
         set status = 'active', current_period_start = v_invoice.billing_period_start,
             current_period_end = v_invoice.billing_period_end, grace_period_ends_at = null
       where id = v_subscription.id and institute_id = v_invoice.institute_id;
      v_subscription_status := 'active';
    else
      v_subscription_status := v_subscription.status;
    end if;
  elsif v_result_status = 'reconciliation_required' then
    update public.platform_payment_attempts
       set status = 'reconciliation_required',
           provider_payment_id = case when v_duplicate_provider_payment then provider_payment_id
                                      else coalesce(provider_payment_id, p_provider_payment_id) end,
           safe_error_code = case
             when v_invoice.amount <> coalesce(p_provider_amount, -1) then 'amount_mismatch'
             when v_invoice.currency <> coalesce(p_currency, '') then 'currency_mismatch'
             when v_invoice.status = 'paid' then 'invoice_already_paid'
             else 'payment_requires_manual_reconciliation'
           end,
           verified_at = now()
     where id = v_attempt.id;
  end if;

  insert into public.platform_subscription_payment_events(
    attempt_id, invoice_id, institute_id, provider, provider_event_id,
    provider_order_id, provider_payment_id, event_type, observed_status,
    result_status, payload_sha256
  ) values (
    v_attempt.id, v_attempt.invoice_id, v_attempt.institute_id, v_attempt.provider,
    p_provider_event_id, p_provider_order_id, p_provider_payment_id, p_event_type,
    p_provider_status, v_result_status, p_payload_sha256
  );

  if v_result_status <> v_old_status and v_result_status <> 'duplicate_event' then
    insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
    values (null, 'subscription_payment_' || v_result_status, 'subscription_payment_attempt', v_attempt.id::text,
            jsonb_build_object('invoice_id', v_invoice.id, 'provider', v_attempt.provider,
                               'event_type', p_event_type, 'provider_payment_id', p_provider_payment_id));
    insert into public.platform_subscription_events(
      institute_id, subscription_id, actor_user_id, event_type, reason, details
    ) values (
      v_invoice.institute_id, v_invoice.subscription_id, null, 'subscription_payment_' || v_result_status,
      null, jsonb_build_object('invoice_id', v_invoice.id, 'attempt_id', v_attempt.id,
                               'provider', v_attempt.provider, 'event_type', p_event_type)
    );
  end if;

  return jsonb_build_object('status', v_result_status, 'attempt_id', v_attempt.id,
                            'invoice_id', v_invoice.id, 'subscription_status', v_subscription_status);
end;
$$;

revoke all on function public.start_platform_subscription_payment_attempt(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.bind_platform_subscription_provider_order(uuid, text)
  from public, anon, authenticated;
revoke all on function public.finalize_platform_subscription_payment(uuid, text, text, text, numeric, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_platform_subscription_payment_attempt(uuid, text, text, uuid) to service_role;
grant execute on function public.bind_platform_subscription_provider_order(uuid, text) to service_role;
grant execute on function public.finalize_platform_subscription_payment(uuid, text, text, text, numeric, text, text, text, text) to service_role;

comment on table public.platform_subscription_payment_events is
  'Sanitized, idempotent provider event history for BizBook subscription invoices; raw webhook bodies and secrets are never stored.';
comment on function public.finalize_platform_subscription_payment(uuid, text, text, text, numeric, text, text, text, text) is
  'Service-role-only settlement after a trusted server verifies provider signature and fetches the actual provider payment state.';
