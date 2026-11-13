-- Compact single-page A4 student fee receipts with company-controlled branding and terms.

alter table public.platform_fee_receipt_policy
  add column show_institute_logo boolean not null default true,
  add column show_bizbook_brand_mark boolean not null default true,
  add column bizbook_brand_name text not null default 'BizBook'
    check (char_length(btrim(bizbook_brand_name)) between 1 and 48),
  add column terms_note text not null default 'This receipt confirms payment received. Any remaining installment balance is due by its scheduled date. Please keep this receipt for your records.'
    check (char_length(terms_note) <= 360);

update public.platform_fee_receipt_policy set show_installment_schedule = true where id is true;

create function public.save_platform_fee_receipt_policy_v2(
  p_delivery_channels jsonb,
  p_template_title text,
  p_accent_color text,
  p_footer_note text,
  p_show_installment_schedule boolean,
  p_show_payment_reference boolean,
  p_show_institute_logo boolean,
  p_show_bizbook_brand_mark boolean,
  p_bizbook_brand_name text,
  p_terms_note text
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
  if p_delivery_channels is null or jsonb_typeof(p_delivery_channels) is distinct from 'array' then
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
     or p_show_installment_schedule is null or p_show_payment_reference is null
     or p_show_institute_logo is null or p_show_bizbook_brand_mark is null then
    raise exception using errcode = '22023', message = 'Receipt template settings are invalid';
  end if;
  if p_bizbook_brand_name is null or char_length(btrim(p_bizbook_brand_name)) not between 1 and 48 then
    raise exception using errcode = '22023', message = 'Brand name must be between 1 and 48 characters';
  end if;
  if p_terms_note is null or char_length(p_terms_note) > 360 then
    raise exception using errcode = '22023', message = 'Receipt terms must be 360 characters or fewer';
  end if;

  update public.platform_fee_receipt_policy
     set delivery_channels = p_delivery_channels,
         template_title = btrim(p_template_title),
         accent_color = upper(p_accent_color),
         footer_note = btrim(p_footer_note),
         show_installment_schedule = p_show_installment_schedule,
         show_payment_reference = p_show_payment_reference,
         show_institute_logo = p_show_institute_logo,
         show_bizbook_brand_mark = p_show_bizbook_brand_mark,
         bizbook_brand_name = btrim(p_bizbook_brand_name),
         terms_note = btrim(p_terms_note),
         updated_by = v_user_id
   where id is true
   returning * into v_updated;
  if not found then raise exception using errcode = '55000', message = 'Fee receipt policy is not initialized'; end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_fee_receipt_policy_updated', 'platform_fee_receipt_policy', 'global',
          jsonb_build_object('delivery_channels', v_updated.delivery_channels,
            'template_title', v_updated.template_title, 'accent_color', v_updated.accent_color,
            'show_installment_schedule', v_updated.show_installment_schedule,
            'show_payment_reference', v_updated.show_payment_reference,
            'show_institute_logo', v_updated.show_institute_logo,
            'show_bizbook_brand_mark', v_updated.show_bizbook_brand_mark,
            'bizbook_brand_name', v_updated.bizbook_brand_name));

  return jsonb_build_object(
    'delivery_channels', v_updated.delivery_channels,
    'template_title', v_updated.template_title,
    'accent_color', v_updated.accent_color,
    'footer_note', v_updated.footer_note,
    'show_installment_schedule', v_updated.show_installment_schedule,
    'show_payment_reference', v_updated.show_payment_reference,
    'show_institute_logo', v_updated.show_institute_logo,
    'show_bizbook_brand_mark', v_updated.show_bizbook_brand_mark,
    'bizbook_brand_name', v_updated.bizbook_brand_name,
    'terms_note', v_updated.terms_note,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.save_platform_fee_receipt_policy_v2(jsonb, text, text, text, boolean, boolean, boolean, boolean, text, text)
  from public, anon, service_role;
grant execute on function public.save_platform_fee_receipt_policy_v2(jsonb, text, text, text, boolean, boolean, boolean, boolean, text, text)
  to authenticated;

comment on column public.platform_fee_receipt_policy.terms_note is
  'Company-configured short terms printed on coaching-to-student payment receipts.';
