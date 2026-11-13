-- Allow BizBook company administrators to manage the private watermark with
-- their signed-in session instead of requiring a service-role key for uploads.
update storage.buckets
   set file_size_limit = 8388608
 where id = 'bizbook-company-brand-assets';

drop policy if exists bizbook_company_brand_assets_admin_select
  on storage.objects;
drop policy if exists bizbook_company_brand_assets_admin_insert
  on storage.objects;
drop policy if exists bizbook_company_brand_assets_admin_update
  on storage.objects;
drop policy if exists bizbook_company_brand_assets_admin_delete
  on storage.objects;

create policy bizbook_company_brand_assets_admin_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'bizbook-company-brand-assets'
    and (
      coalesce(public.get_platform_admin_role(), '') in ('owner', 'operator')
      or exists (
        select 1 from public.platform_fee_receipt_policy p
         where p.id is true and p.watermark_logo_path = storage.objects.name
      )
    )
  );

create policy bizbook_company_brand_assets_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'bizbook-company-brand-assets'
    and name like 'fee-receipt-watermark/%'
    and coalesce(public.get_platform_admin_role(), '') in ('owner', 'operator')
  );

create policy bizbook_company_brand_assets_admin_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'bizbook-company-brand-assets'
    and name like 'fee-receipt-watermark/%'
    and coalesce(public.get_platform_admin_role(), '') in ('owner', 'operator')
  )
  with check (
    bucket_id = 'bizbook-company-brand-assets'
    and name like 'fee-receipt-watermark/%'
    and coalesce(public.get_platform_admin_role(), '') in ('owner', 'operator')
  );

create policy bizbook_company_brand_assets_admin_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'bizbook-company-brand-assets'
    and name like 'fee-receipt-watermark/%'
    and coalesce(public.get_platform_admin_role(), '') in ('owner', 'operator')
  );

create or replace function public.set_platform_fee_receipt_watermark_logo(p_logo_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_path text;
begin
  if auth.role() is distinct from 'authenticated'
     or coalesce(public.get_platform_admin_role(), '') not in ('owner', 'operator') then
    raise exception using errcode = '42501', message = 'Company administrator access is required';
  end if;
  if p_logo_path is not null
     and p_logo_path !~ '^fee-receipt-watermark/[0-9a-f-]{36}\.(png|jpg)$' then
    raise exception using errcode = '22023', message = 'The company watermark path is invalid';
  end if;
  if p_logo_path is not null and not exists (
    select 1 from storage.objects
     where bucket_id = 'bizbook-company-brand-assets'
       and name = p_logo_path
  ) then
    raise exception using errcode = '22023', message = 'The uploaded company watermark could not be found';
  end if;

  select watermark_logo_path into v_old_path
    from public.platform_fee_receipt_policy
   where id is true
   for update;
  if not found then raise exception using errcode = '55000', message = 'Fee receipt policy is not initialized'; end if;

  update public.platform_fee_receipt_policy
     set watermark_logo_path = p_logo_path,
         show_watermark = case when p_logo_path is null then show_watermark else true end,
         updated_by = v_user_id
   where id is true;

  insert into public.platform_admin_audit_events(actor_user_id, action, target_type, target_id, details)
  values (v_user_id,
          case when p_logo_path is null then 'platform_fee_receipt_watermark_logo_removed' else 'platform_fee_receipt_watermark_logo_uploaded' end,
          'platform_fee_receipt_policy', 'global', jsonb_build_object('has_logo', p_logo_path is not null));

  return jsonb_build_object('saved', true, 'replaced_path', v_old_path);
end;
$$;

revoke all on function public.set_platform_fee_receipt_watermark_logo(text)
  from public, anon, service_role;
grant execute on function public.set_platform_fee_receipt_watermark_logo(text)
  to authenticated;
