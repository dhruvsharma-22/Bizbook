begin;
select plan(20);

select has_function('public', 'record_expense', array['text', 'text', 'text', 'text', 'text', 'numeric', 'date', 'text', 'text'], 'expense create function exists');
select ok((select prosecdef from pg_proc where oid = 'public.record_expense(text,text,text,text,text,numeric,date,text,text)'::regprocedure), 'expense create function uses SECURITY DEFINER');
select ok((select proconfig @> array['search_path='] from pg_proc where oid = 'public.record_expense(text,text,text,text,text,numeric,date,text,text)'::regprocedure), 'expense create function pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.record_expense(text,text,text,text,text,numeric,date,text,text)', 'EXECUTE'), 'anonymous role cannot create expenses');
select ok(has_function_privilege('authenticated', 'public.record_expense(text,text,text,text,text,numeric,date,text,text)', 'EXECUTE'), 'authenticated role can invoke the guarded function');
select ok(not has_column_privilege('authenticated', 'public.expenses', 'title', 'INSERT'), 'authenticated clients cannot bypass the guarded create function');
select has_function('public', 'update_expense', array['text', 'text', 'text', 'numeric', 'date', 'text', 'text'], 'expense update function exists');
select ok((select prosecdef from pg_proc where oid = 'public.update_expense(text,text,text,numeric,date,text,text)'::regprocedure), 'expense update function uses SECURITY DEFINER');
select ok((select proconfig @> array['search_path='] from pg_proc where oid = 'public.update_expense(text,text,text,numeric,date,text,text)'::regprocedure), 'expense update function pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.update_expense(text,text,text,numeric,date,text,text)', 'EXECUTE'), 'anonymous role cannot update expenses');
select ok(has_function_privilege('authenticated', 'public.update_expense(text,text,text,numeric,date,text,text)', 'EXECUTE'), 'authenticated role can invoke the guarded update function');
select ok(not has_column_privilege('authenticated', 'public.expenses', 'title', 'UPDATE'), 'authenticated clients cannot bypass the guarded update function');
select has_function('public', 'expense_month_summary', array['text', 'text', 'date'], 'monthly summary function exists');
select ok(not (select prosecdef from pg_proc where oid = 'public.expense_month_summary(text,text,date)'::regprocedure), 'monthly summary runs as the caller and respects RLS');
select ok((select proconfig @> array['search_path='] from pg_proc where oid = 'public.expense_month_summary(text,text,date)'::regprocedure), 'monthly summary pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.expense_month_summary(text,text,date)', 'EXECUTE'), 'anonymous role cannot inspect expense summaries');
select ok(has_function_privilege('authenticated', 'public.expense_month_summary(text,text,date)', 'EXECUTE'), 'authenticated role can invoke the RLS-protected summary');

set local role authenticated;
select throws_ok(
  $$select public.record_expense('00000000-0000-0000-0000-000000000001', 'missing-institute', null, 'Rent', 'Rent', 100, current_date, 'Cash', null)$$,
  '42501',
  'Authentication is required.',
  'function rejects missing authenticated identity'
);
select throws_ok(
  $$select public.update_expense('missing-expense-id', 'Rent', 'Rent', 100, current_date, 'Cash', null)$$,
  '42501',
  'Authentication is required.',
  'update function rejects missing authenticated identity'
);
select throws_ok(
  $$select * from public.expense_month_summary('missing-institute', null, date_trunc('month', current_date)::date)$$,
  '42501',
  'Authorized expense access is required.',
  'summary function rejects unauthenticated aggregation'
);
reset role;

select * from finish();
rollback;
