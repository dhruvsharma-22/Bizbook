begin;
select plan(6);

select has_function('public', 'void_expense', array['text', 'text'], 'expense void function exists');
select ok((select prosecdef from pg_proc where oid = 'public.void_expense(text,text)'::regprocedure), 'expense void function uses SECURITY DEFINER');
select ok((select proconfig @> array['search_path='] from pg_proc where oid = 'public.void_expense(text,text)'::regprocedure), 'expense void function pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.void_expense(text,text)', 'EXECUTE'), 'anonymous role cannot void expenses');
select ok(has_function_privilege('authenticated', 'public.void_expense(text,text)', 'EXECUTE'), 'authenticated role can invoke guarded void function');

set local role authenticated;
select throws_ok(
  $$select public.void_expense('missing-expense-id', 'Duplicate test record')$$,
  '42501',
  'Authorized expense access is required.',
  'function rejects callers without an authorized financial membership'
);
reset role;

select * from finish();
rollback;
