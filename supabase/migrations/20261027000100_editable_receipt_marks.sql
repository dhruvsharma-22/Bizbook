-- Editable title treatments, logo watermark sizing, and a separately colored paid seal.
alter table public.platform_fee_receipt_policy
  add column show_watermark boolean not null default false,
  add column watermark_size_percent smallint not null default 42
    check (watermark_size_percent between 15 and 75),
  add column watermark_opacity_percent smallint not null default 8
    check (watermark_opacity_percent between 3 and 22),
  add column title_bold boolean not null default true,
  add column title_pill boolean not null default false,
  add column show_paid_seal boolean not null default true,
  add column paid_seal_color text not null default '#B91C1C'
    check (paid_seal_color ~ '^#[0-9A-Fa-f]{6}$');

create function public.save_platform_fee_receipt_policy_v3(
  p_delivery_channels jsonb,
  p_template_title text,
  p_accent_color text,
  p_footer_note text,
  p_show_installment_schedule boolean,
  p_show_payment_reference boolean,
  p_show_institute_logo boolean,
  p_show_bizbook_brand_mark boolean,
  p_bizbook_brand_name text,
  p_terms_note text,
  p_show_watermark boolean,
  p_watermark_size_percent smallint,
  p_watermark_opacity_percent smallint,
  p_title_bold boolean,
  p_title_pill boolean,
  p_show_paid_seal boolean,
  p_paid_seal_color text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved jsonb;
  v_user_id uuid := auth.uid();
  v_updated public.platform_fee_receipt_policy%rowtype;
begin
  if auth.role() is distinct from 'authenticated'
     or coalesce(public.get_platform_admin_role(), '') not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = 'Company administrator access is required';
  end if;
  if p_show_watermark is null
     or p_watermark_size_percent is null or p_watermark_size_percent not between 15 and 75
     or p_watermark_opacity_percent is null or p_watermark_opacity_percent not between 3 and 22
     or p_title_bold is null or p_title_pill is null
     or p_show_paid_seal is null
     or p_paid_seal_color is null or p_paid_seal_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception using errcode = '22023', message = 'Watermark, title, or paid seal settings are invalid';
  end if;

  v_saved := public.save_platform_fee_receipt_policy_v2(
    p_delivery_channels, p_template_title, p_accent_color, p_footer_note,
    p_show_installment_schedule, p_show_payment_reference, p_show_institute_logo,
    p_show_bizbook_brand_mark, p_bizbook_brand_name, p_terms_note
  );

  update public.platform_fee_receipt_policy
     set show_watermark = p_show_watermark,
         watermark_size_percent = p_watermark_size_percent,
         watermark_opacity_percent = p_watermark_opacity_percent,
         title_bold = p_title_bold,
         title_pill = p_title_pill,
         show_paid_seal = p_show_paid_seal,
         paid_seal_color = upper(p_paid_seal_color),
         updated_by = v_user_id,
         updated_at = now()
   where id is true
   returning * into v_updated;
  if not found then raise exception using errcode = '55000', message = 'Fee receipt policy is not initialized'; end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_fee_receipt_marks_updated', 'platform_fee_receipt_policy', 'global',
    jsonb_build_object(
      'show_watermark', v_updated.show_watermark,
      'watermark_size_percent', v_updated.watermark_size_percent,
      'watermark_opacity_percent', v_updated.watermark_opacity_percent,
      'title_bold', v_updated.title_bold,
      'title_pill', v_updated.title_pill,
      'show_paid_seal', v_updated.show_paid_seal,
      'paid_seal_color', v_updated.paid_seal_color
    ));

  return v_saved || jsonb_build_object(
    'show_watermark', v_updated.show_watermark,
    'watermark_size_percent', v_updated.watermark_size_percent,
    'watermark_opacity_percent', v_updated.watermark_opacity_percent,
    'title_bold', v_updated.title_bold,
    'title_pill', v_updated.title_pill,
    'show_paid_seal', v_updated.show_paid_seal,
    'paid_seal_color', v_updated.paid_seal_color,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.save_platform_fee_receipt_policy_v3(jsonb, text, text, text, boolean, boolean, boolean, boolean, text, text, boolean, smallint, smallint, boolean, boolean, boolean, text)
  from public, anon, service_role;
grant execute on function public.save_platform_fee_receipt_policy_v3(jsonb, text, text, text, boolean, boolean, boolean, boolean, text, text, boolean, smallint, smallint, boolean, boolean, boolean, text)
  to authenticated;
