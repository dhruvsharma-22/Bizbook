-- Use the requested forest-green look for the coaching-to-student fee receipt.
alter table public.platform_fee_receipt_policy
  alter column accent_color set default '#166534';

update public.platform_fee_receipt_policy
set accent_color = '#166534',
    updated_at = now()
where id is true;
