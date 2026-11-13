-- The watermark is the fixed BizBook mark; no uploaded image is stored.
alter table public.platform_fee_receipt_policy
  drop column if exists watermark_logo_path;
