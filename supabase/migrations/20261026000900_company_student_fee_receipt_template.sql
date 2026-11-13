-- Company-controlled PDF design and delivery channels for coaching-to-student fee receipts.
-- This policy is separate from BizBook subscription billing and invoices.

create table public.platform_fee_receipt_policy (
  id boolean primary key default true check (id is true),
  delivery_channels jsonb not null default '["WhatsApp"]'::jsonb
    check (jsonb_typeof(delivery_channels) = 'array' and jsonb_array_length(delivery_channels) <= 2),
  template_title text not null default 'Fee Payment Receipt'
    check (char_length(btrim(template_title)) between 1 and 64),
  accent_color text not null default '#5B21B6'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  footer_note text not null default 'Thank you for your payment.'
    check (char_length(footer_note) <= 160),
  show_installment_schedule boolean not null default true,
  show_payment_reference boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.platform_fee_receipt_policy (id) values (true);

alter table public.platform_fee_receipt_policy enable row level security;
create policy platform_fee_receipt_policy_select_admin
  on public.platform_fee_receipt_policy for select to authenticated
  using (bizbook_private.has_platform_role(array['owner', 'operator']::text[]));
revoke all on public.platform_fee_receipt_policy from public, anon, authenticated;
grant select on public.platform_fee_receipt_policy to authenticated;
grant all on public.platform_fee_receipt_policy to service_role;

create trigger platform_fee_receipt_policy_updated_at
  before update on public.platform_fee_receipt_policy
  for each row execute function bizbook_private.set_updated_at();

create or replace function public.save_platform_fee_receipt_policy(
  p_delivery_channels jsonb,
  p_template_title text,
  p_accent_color text,
  p_footer_note text,
  p_show_installment_schedule boolean,
  p_show_payment_reference boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated public.platform_fee_receipt_policy%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or coalesce(public.get_platform_admin_role(), '') not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = 'Company administrator access is required';
  end if;
  if p_delivery_channels is null
     or jsonb_typeof(p_delivery_channels) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Choose WhatsApp, Email, both, or pause receipt delivery';
  end if;
  if jsonb_array_length(p_delivery_channels) > 2 then
    raise exception using errcode = '22023', message = 'Choose WhatsApp, Email, both, or pause receipt delivery';
  end if;
  if exists (
       select 1 from jsonb_array_elements(p_delivery_channels) as channel(value)
       where jsonb_typeof(channel.value) is distinct from 'string'
          or channel.value #>> '{}' not in ('WhatsApp', 'Email')
     )
     or (select count(*) from jsonb_array_elements_text(p_delivery_channels))
        <> (select count(distinct value) from jsonb_array_elements_text(p_delivery_channels)) then
    raise exception using errcode = '22023', message = 'Choose WhatsApp, Email, both, or pause receipt delivery';
  end if;
  if p_template_title is null or char_length(btrim(p_template_title)) not between 1 and 64 then
    raise exception using errcode = '22023', message = 'Receipt title must be between 1 and 64 characters';
  end if;
  if p_accent_color is null or p_accent_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = '22023', message = 'Choose a valid six-digit template color';
  end if;
  if p_footer_note is null or char_length(p_footer_note) > 160
     or p_show_installment_schedule is null or p_show_payment_reference is null then
    raise exception using errcode = '22023', message = 'Receipt template settings are invalid';
  end if;

  update public.platform_fee_receipt_policy
     set delivery_channels = p_delivery_channels,
         template_title = btrim(p_template_title),
         accent_color = upper(p_accent_color),
         footer_note = btrim(p_footer_note),
         show_installment_schedule = p_show_installment_schedule,
         show_payment_reference = p_show_payment_reference,
         updated_by = v_user_id
   where id is true
   returning * into v_updated;
  if not found then raise exception using errcode = '55000', message = 'Fee receipt policy is not initialized'; end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_fee_receipt_policy_updated', 'platform_fee_receipt_policy', 'global',
          jsonb_build_object('delivery_channels', v_updated.delivery_channels,
            'template_title', v_updated.template_title, 'accent_color', v_updated.accent_color,
            'show_installment_schedule', v_updated.show_installment_schedule,
            'show_payment_reference', v_updated.show_payment_reference));

  return jsonb_build_object(
    'delivery_channels', v_updated.delivery_channels,
    'template_title', v_updated.template_title,
    'accent_color', v_updated.accent_color,
    'footer_note', v_updated.footer_note,
    'show_installment_schedule', v_updated.show_installment_schedule,
    'show_payment_reference', v_updated.show_payment_reference,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.save_platform_fee_receipt_policy(jsonb, text, text, text, boolean, boolean)
  from public, anon, service_role;
grant execute on function public.save_platform_fee_receipt_policy(jsonb, text, text, text, boolean, boolean)
  to authenticated;

-- Seed each new paid fee receipt from the current company-wide delivery policy.
create or replace function bizbook_private.enqueue_paid_fee_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt_id text;
  v_receipt_number text;
  v_channels jsonb;
  v_channel text;
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
    select delivery_channels into v_channels
      from public.platform_fee_receipt_policy where id is true;
    for v_channel in select jsonb_array_elements_text(coalesce(v_channels, '[]'::jsonb)) loop
      insert into public.fee_receipt_deliveries (receipt_id, channel)
      values (v_receipt_id, v_channel)
      on conflict (receipt_id, channel) do nothing;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function bizbook_private.enqueue_paid_fee_receipt() from public, anon, authenticated;

comment on table public.platform_fee_receipt_policy is
  'Company Admin controls the PDF template and delivery channels for coaching-to-student fee receipts; separate from BizBook subscription invoices.';
