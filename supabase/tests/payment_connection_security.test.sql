begin;

select plan(12);

select ok(
  to_regprocedure('public.save_payment_connection_credentials(text,text,text,jsonb)') is not null,
  'credential save function exists'
);
select ok(
  to_regprocedure('public.get_payment_connection_credentials(text,text)') is not null,
  'credential resolver exists'
);
select ok(
  to_regprocedure('public.save_notification_provider_credentials(text,text,text,jsonb)') is not null,
  'notification credential save function exists'
);
select ok(
  to_regprocedure('public.get_notification_provider_credentials(text,text,boolean)') is not null,
  'notification credential resolver exists'
);
select ok(
  not has_function_privilege('anon', 'public.save_payment_connection_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'anonymous role cannot save credentials'
);
select ok(
  has_function_privilege('authenticated', 'public.save_payment_connection_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'authenticated role can call the membership-checked save function'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_payment_connection_credentials(text,text)', 'EXECUTE'),
  'authenticated role cannot resolve credentials'
);
select ok(
  has_function_privilege('service_role', 'public.get_payment_connection_credentials(text,text)', 'EXECUTE'),
  'trusted server role can resolve credentials'
);
select ok(
  not has_function_privilege('anon', 'public.save_notification_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'anonymous role cannot save notification credentials'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_notification_provider_credentials(text,text,text,jsonb)', 'EXECUTE'),
  'institute users cannot replace the central notification sender'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_notification_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'authenticated role cannot resolve notification credentials'
);
select ok(
  not has_function_privilege('service_role', 'public.get_notification_provider_credentials(text,text,boolean)', 'EXECUTE'),
  'trusted server jobs cannot resolve retired institute-scoped sender credentials'
);

select * from finish();
rollback;
