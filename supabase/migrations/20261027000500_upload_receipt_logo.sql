-- Store the private company logo used as the fee receipt watermark.
alter table public.platform_fee_receipt_policy
  add column watermark_logo_path text;
