-- Finance users can preview the company-owned fee receipt design.
-- The platform policy remains read-only to institutes and its save RPC still
-- requires a BizBook company administrator.
drop policy if exists platform_fee_receipt_policy_select_institute_preview
  on public.platform_fee_receipt_policy;

create policy platform_fee_receipt_policy_select_institute_preview
  on public.platform_fee_receipt_policy for select to authenticated
  using (
    exists (
      select 1
        from public.user_memberships m
       where m.user_id = (select auth.uid())
         and m.is_active
         and m.role in ('owner', 'administrator', 'accountant')
    )
  );

-- Let the same finance users preview the exact private logo configured as the
-- watermark. The row policy above limits this to the single configured asset.
drop policy if exists bizbook_company_brand_assets_select_receipt_preview
  on storage.objects;

create policy bizbook_company_brand_assets_select_receipt_preview
  on storage.objects for select to authenticated
  using (
    bucket_id = 'bizbook-company-brand-assets'
    and exists (
      select 1
        from public.platform_fee_receipt_policy p
       where p.id is true
         and p.watermark_logo_path = storage.objects.name
    )
  );
