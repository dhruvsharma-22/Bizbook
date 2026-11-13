-- Keep receipt mark opacity settings under Company Admin control.
alter table public.platform_fee_receipt_policy
  add column paid_seal_opacity_percent smallint not null default 70
    check (paid_seal_opacity_percent between 0 and 100);

alter table public.platform_fee_receipt_policy
  alter column show_watermark set default true;

update public.platform_fee_receipt_policy
   set show_watermark = true
 where id is true;

create function public.save_platform_fee_receipt_policy_v4(
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
  p_paid_seal_color text,
  p_paid_seal_opacity_percent smallint
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
  if p_paid_seal_opacity_percent is null or p_paid_seal_opacity_percent not between 0 and 100 then
    raise exception using errcode = '22023', message = 'Paid seal transparency is invalid';
  end if;

  v_saved := public.save_platform_fee_receipt_policy_v3(
    p_delivery_channels, p_template_title, p_accent_color, p_footer_note,
    p_show_installment_schedule, p_show_payment_reference, p_show_institute_logo,
    p_show_bizbook_brand_mark, p_bizbook_brand_name, p_terms_note,
    p_show_watermark, p_watermark_size_percent, p_watermark_opacity_percent,
    p_title_bold, p_title_pill, p_show_paid_seal, p_paid_seal_color
  );

  update public.platform_fee_receipt_policy
     set paid_seal_opacity_percent = p_paid_seal_opacity_percent,
         updated_by = v_user_id,
         updated_at = now()
   where id is true
   returning * into v_updated;
  if not found then raise exception using errcode = '55000', message = 'Fee receipt policy is not initialized'; end if;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id, 'platform_fee_receipt_seal_opacity_updated', 'platform_fee_receipt_policy', 'global',
    jsonb_build_object('paid_seal_opacity_percent', v_updated.paid_seal_opacity_percent));

  return v_saved || jsonb_build_object(
    'paid_seal_opacity_percent', v_updated.paid_seal_opacity_percent,
    'updated_at', v_updated.updated_at
  );
end;
$$;

revoke all on function public.save_platform_fee_receipt_policy_v4(jsonb, text, text, text, boolean, boolean, boolean, boolean, text, text, boolean, smallint, smallint, boolean, boolean, boolean, text, smallint)
  from public, anon, service_role;
grant execute on function public.save_platform_fee_receipt_policy_v4(jsonb, text, text, text, boolean, boolean, boolean, boolean, text, text, boolean, smallint, smallint, boolean, boolean, boolean, text, smallint)
  to authenticated;
