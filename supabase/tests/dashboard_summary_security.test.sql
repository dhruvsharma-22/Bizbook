begin;
select plan(8);

select has_view('public', 'financial_activity_summary', 'monthly financial activity summary exists');
select has_view('public', 'installment_balance_summary', 'installment balance summary exists');
select ok(
  has_table_privilege('authenticated', 'public.financial_activity_summary', 'SELECT'),
  'authenticated users can query the financial summary through RLS'
);
select ok(
  not has_table_privilege('anon', 'public.financial_activity_summary', 'SELECT'),
  'anonymous users cannot query financial summaries'
);
select ok(
  (select reloptions @> array['security_invoker=true']
   from pg_class where oid = 'public.financial_activity_summary'::regclass),
  'financial summary runs with the caller security context'
);
select ok(
  has_table_privilege('authenticated', 'public.installment_balance_summary', 'SELECT'),
  'authenticated users can query installment balances through RLS'
);
select ok(
  not has_table_privilege('anon', 'public.installment_balance_summary', 'SELECT'),
  'anonymous users cannot query installment summaries'
);
select ok(
  (select reloptions @> array['security_invoker=true']
   from pg_class where oid = 'public.installment_balance_summary'::regclass),
  'installment summary runs with the caller security context'
);

select * from finish();
rollback;
