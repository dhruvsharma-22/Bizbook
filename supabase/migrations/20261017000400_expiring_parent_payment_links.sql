-- Capability links let a parent use one already-created, test-mode fee order.
-- The database stores only a SHA-256 token digest; raw bearer tokens are returned
-- once to the authenticated institute finance user and must not be logged.

create table public.payment_checkout_links (
  id uuid primary key default gen_random_uuid(),
  institute_id text not null,
  payment_order_id text not null,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, institute_id),
  foreign key (payment_order_id, institute_id)
    references public.payment_orders(id, institute_id) on delete restrict
);

create index payment_checkout_links_order_idx
  on public.payment_checkout_links (institute_id, payment_order_id, expires_at desc);

alter table public.payment_checkout_links enable row level security;
revoke all on public.payment_checkout_links from public, anon, authenticated;

create or replace function public.create_payment_checkout_link(
  p_order_id text,
  p_token_sha256 text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.payment_orders%rowtype;
  v_link_id uuid;
  v_expiry timestamptz := now() + interval '24 hours';
begin
  if auth.role() is distinct from 'authenticated' or v_actor is null then
    raise exception using errcode = '42501', message = 'Authenticated finance access is required';
  end if;
  if p_order_id is null or length(p_order_id) > 64
     or p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Payment link details are invalid';
  end if;

  select o.* into v_order
    from public.payment_orders o
   where o.id = p_order_id
   for update;
  if not found
     or not bizbook_private.has_institute_role(v_order.institute_id, array['owner', 'administrator', 'accountant']::text[])
     or not bizbook_private.can_write_branch(v_order.institute_id, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'Authorized institute finance access is required';
  end if;
  if v_order.receipt_kind is distinct from 'Fee'
     or v_order.installment_id is null
     or v_order.provider_order_id is null
     or v_order.order_status is distinct from 'Pending'
     or not exists (
       select 1 from public.payment_connections c
        where c.institute_id = v_order.institute_id and c.provider = v_order.provider
          and c.environment = 'test' and c.connection_status = 'active'
     ) then
    raise exception using errcode = '23514', message = 'Only an active test-mode installment order can be shared';
  end if;

  update public.payment_checkout_links l
     set revoked_at = now()
   where l.institute_id = v_order.institute_id and l.payment_order_id = v_order.id
     and l.revoked_at is null and l.expires_at > now();

  insert into public.payment_checkout_links (
    institute_id, payment_order_id, token_sha256, expires_at, created_by
  ) values (
    v_order.institute_id, v_order.id, p_token_sha256, v_expiry, v_actor
  ) returning id into v_link_id;

  insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
  values (v_order.institute_id, v_order.branch_id, 'payment_checkout_link', v_link_id::text, 'INSERT', v_actor,
    jsonb_build_object('payment_order_id', v_order.id, 'expires_at', v_expiry, 'status', 'active'));

  return jsonb_build_object('link_id', v_link_id, 'expires_at', v_expiry);
end;
$$;

create or replace function public.revoke_payment_checkout_link(p_order_id text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.payment_orders%rowtype;
  v_count integer;
begin
  if auth.role() is distinct from 'authenticated' or v_actor is null then
    raise exception using errcode = '42501', message = 'Authenticated finance access is required';
  end if;
  select o.* into v_order from public.payment_orders o where o.id = p_order_id for update;
  if not found
     or not bizbook_private.has_institute_role(v_order.institute_id, array['owner', 'administrator', 'accountant']::text[])
     or not bizbook_private.can_write_branch(v_order.institute_id, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'Authorized institute finance access is required';
  end if;

  with revoked as (
    update public.payment_checkout_links l set revoked_at = now()
     where l.institute_id = v_order.institute_id and l.payment_order_id = v_order.id
       and l.revoked_at is null
     returning l.id
  ), logged as (
    insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
    select v_order.institute_id, v_order.branch_id, 'payment_checkout_link', revoked.id::text,
      'UPDATE', v_actor,
      jsonb_build_object('payment_order_id', v_order.id, 'status', 'revoked')
    from revoked
    returning id
  ) select count(*)::integer into v_count from logged;
  return coalesce(v_count, 0);
end;
$$;

create or replace function public.resolve_payment_checkout_link(p_token_sha256 text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Trusted server access is required';
  end if;
  if p_token_sha256 is null or p_token_sha256 !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select jsonb_build_object(
    'link_id', l.id,
    'order_id', o.id,
    'institute_id', o.institute_id,
    'institute_name', i.business_name,
    'provider', o.provider,
    'provider_order_id', o.provider_order_id,
    'amount', o.amount,
    'currency', o.currency,
    'order_status', o.order_status,
    'installment_sequence', si.sequence_number,
    'due_date', si.due_date,
    'expires_at', l.expires_at
  ) into v_result
    from public.payment_checkout_links l
    join public.payment_orders o on o.id = l.payment_order_id and o.institute_id = l.institute_id
    join public.coaching_institutes i on i.id = o.institute_id and i.account_status = 'active'
    join public.student_installments si on si.id = o.installment_id
       and si.institute_id = o.institute_id and si.student_id = o.student_id
    left join public.payment_connections c on c.institute_id = o.institute_id and c.provider = o.provider
   where l.token_sha256 = p_token_sha256
     and l.revoked_at is null
     and l.expires_at > now()
     and o.receipt_kind = 'Fee'
     and o.provider_order_id is not null
     and o.order_status in ('Pending', 'Processing', 'Authorized', 'Captured')
     and (o.order_status = 'Captured' or (c.environment = 'test' and c.connection_status = 'active'))
   limit 1;
  return v_result;
end;
$$;

revoke all on function public.create_payment_checkout_link(text, text) from public, anon;
revoke all on function public.revoke_payment_checkout_link(text) from public, anon;
revoke all on function public.resolve_payment_checkout_link(text) from public, anon, authenticated;
grant execute on function public.create_payment_checkout_link(text, text) to authenticated;
grant execute on function public.revoke_payment_checkout_link(text) to authenticated;
grant execute on function public.resolve_payment_checkout_link(text) to service_role;

-- A provider order can receive more than one successful attempt. The original
-- receipt remains idempotent, but a distinct later capture must be visible for
-- reconciliation instead of being silently treated as the same payment.
do $patch_duplicate_capture$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.process_online_payment_status(text,text,text,text,numeric,text,text,text,text)'::regprocedure
  );
  v_start_marker text := $$  if v_order.order_status = 'Captured' and v_order.payment_id is not null then$$;
  v_next_marker text := $$  if p_provider_status = 'captured' then$$;
  v_start integer;
  v_next integer;
  v_replacement text := $replacement$
  if v_order.order_status = 'Captured' and v_order.payment_id is not null then
    if p_provider_status = 'captured' and p_provider_payment_id is not null
       and p_provider_payment_id is distinct from (
         select p.provider_payment_id from public.payments p
          where p.id = v_order.payment_id and p.institute_id = v_order.institute_id
       ) then
      insert into public.payment_reconciliation_records (
        institute_id, provider, provider_transaction_reference, provider_amount,
        currency, reconciliation_status, notes
      ) values (
        v_order.institute_id, p_provider, p_provider_payment_id,
        greatest(coalesce(p_provider_amount, 0), 0), 'INR',
        case when p_provider_amount is distinct from v_order.amount or p_currency is distinct from v_order.currency
          then 'Amount Mismatch' else 'Unmatched' end,
        'Provider reports a second distinct captured payment for an order already recorded. No additional receipt was automatically posted.'
      ) on conflict (institute_id, provider, provider_transaction_reference) do nothing;
      if v_event_id is not null then
        update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
      end if;
      insert into public.audit_logs (institute_id, branch_id, entity_type, entity_id, action, actor_id, metadata)
      values (v_order.institute_id, v_order.branch_id, 'payment_order', v_order.id, 'UPDATE', v_order.created_by,
        jsonb_build_object('provider', p_provider, 'status', 'reconciliation_required',
          'safe_error_code', 'multiple_provider_captures'));
      return jsonb_build_object('status', 'reconciliation_required', 'duplicate_capture', true);
    end if;
    if v_event_id is not null then
      update public.webhook_events set processing_status = 'Processed', processed_at = now() where id = v_event_id;
    end if;
    return jsonb_build_object('status', 'captured', 'payment_id', v_order.payment_id, 'duplicate', true);
  end if;

$replacement$;
begin
  v_start := pg_catalog.strpos(v_definition, v_start_marker);
  v_next := pg_catalog.strpos(v_definition, v_next_marker);
  if v_start = 0 or v_next <= v_start then
    raise exception 'Online payment finalizer changed; review duplicate-capture patch before applying.';
  end if;
  execute pg_catalog.left(v_definition, v_start - 1)
       || v_replacement
       || pg_catalog.substr(v_definition, v_next);
end;
$patch_duplicate_capture$;

comment on table public.payment_checkout_links is
  'Short-lived parent checkout capabilities. Stores only SHA-256 token digests; access is mediated by authenticated issue/revoke and service-role resolution RPCs.';
