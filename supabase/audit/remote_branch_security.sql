-- Read-only live verification of the branch policies and relevant helper/view.
select jsonb_pretty(jsonb_build_object(
  'branch_policy', (
    select jsonb_build_object('using', qual, 'with_check', with_check)
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'branches' and policyname = 'branches_select_accessible'
  ),
  'reconciliation_policy', (
    select jsonb_build_object('using', qual, 'with_check', with_check)
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'payment_reconciliation_records' and policyname = 'reconciliation_select_finance'
  ),
  'can_access_branch', (
    select pg_catalog.pg_get_functiondef(p.oid)
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'bizbook_private' and p.proname = 'can_access_branch'
  ),
  'installment_balances', (
    select pg_catalog.pg_get_viewdef(c.oid, true)
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'installment_balances'
  )
)) as branch_security;
