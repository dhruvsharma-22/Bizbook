-- Read-only aggregate status check for the authorized BizBook test project.
-- Does not expose user IDs, provider metadata, or business records.
select
  (select count(*) from public.platform_administrators) as platform_admin_count,
  (select count(*) from public.platform_subscription_plans) as plan_count,
  (select count(*) from public.institute_subscriptions) as subscription_count,
  (select count(*) from public.platform_subscription_invoices) as invoice_count,
  (select count(*) from public.platform_payment_attempts) as payment_attempt_count,
  (select count(*) from public.platform_provider_connections) as provider_connection_count,
  (select count(*) from public.platform_admin_audit_events) as platform_audit_event_count;
