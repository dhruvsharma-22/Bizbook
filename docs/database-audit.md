# BizBook database audit

## Scope and connection

This pass was limited to Supabase migrations, database objects, RLS, privileges, and SQL behavior. No frontend files were changed during this pass. No production connection or write was attempted.

- The CLI link and the host in `.env.local` both identify test project `xabfsqtevwnwtxxkmkvc`. The secret value in `.env.local` was not displayed.
- Production project `cjuneqmohdivjioulyqq` was not accessed.
- Read-only catalog queries succeeded against the test project. The post-apply CLI migration-list command failed database-password authentication; a linked read-only query verified remote migration history.
- Supabase remote server reports PostgreSQL 17.11. The repository local config targets PostgreSQL 17.

## Remote schema inventory

The live public schema contains 21 tables:

- Tenancy and identity: `coaching_institutes`, `profiles`, `user_memberships`, `branches`, `membership_branch_access`.
- Students and operations: `students`, `student_installments`, `staff`, `attendance_records`.
- Financial records: `payments`, `payment_allocations`, `refunds`, `refund_allocations`, `salary_payments`, `expenses`.
- Auditing and provider operations: `audit_logs`, `notification_logs`, `payment_connections`, `payment_orders`, `payment_reconciliation_records`, `webhook_events`.

It also contains four views: `installment_balances`, `advance_balances`, `payment_history`, and `financial_activity`. All four are `security_invoker` views. No materialized views or sequences were found.

The live catalog reports 21 primary keys, 22 unique constraints, 56 foreign keys, and 82 check constraints. All 59 indexes are valid. Monetary columns use `numeric(12,2)`. Composite foreign keys tie students, branches, installments, payments, refunds, allocations, payroll, and reconciliation records to the same institute. Salary rows use `(institute_id, staff_id, payroll_month)` as their primary key.

RLS is enabled on all 21 tables; `FORCE ROW LEVEL SECURITY` is off. The `anon` role has no public-table or view `SELECT` grant. Authenticated users receive column-scoped writes for ordinary institute, student, staff, attendance, installment, branch, and expense records, subject to RLS. Payment, allocation, refund, payroll, webhook, audit, and notification records have no authenticated write grants; their mutations use privileged operations or trusted server processing.

The catalog contains 23 application-schema routines, including 18 `SECURITY DEFINER` routines. The 17 BizBook security-definer routines use an empty `search_path` and are not executable by `anon`. A separate `public.rls_auto_enable()` routine is owned by `postgres`, uses `search_path=pg_catalog`, and is bound to the `ensure_rls` DDL event trigger. Its catalog ACL is the default `PUBLIC` execute ACL; this platform-managed event-trigger function was left unchanged. Verify its API exposure with the Supabase platform before considering any ACL change.

The remote inventory query files are under [`supabase/audit`](../supabase/audit/). They read catalog metadata only and do not query business rows.

## Migrations reviewed

| Migration | Purpose and live evidence |
|---|---|
| `20261013000000_bizbook_core_schema.sql` | Creates the tenant, student, payroll, payment, refund, expense, audit, reminder, provider, and reconciliation schema; constraints, indexes, and financial views. The corresponding 21 tables and four views are present remotely. |
| `20261013000100_bizbook_tenant_security.sql` | Membership/branch helpers, privileged membership operations, audit and integrity triggers. Remote helper definitions inspected use `SECURITY DEFINER SET search_path TO ''`. |
| `20261013000200_bizbook_payment_operations.sql` | Manual receipts and advance allocation RPCs. Remote routine signatures and security settings are present; the full remote bodies were not exhaustively diffed against local SQL. |
| `20261013000300_bizbook_refund_and_payroll_operations.sql` | Refund requests/completion, salary recording, expense voiding. Remote routine signatures and security settings are present; the full remote bodies were not exhaustively diffed against local SQL. |
| `20261013000400_bizbook_rls_and_privileges.sql` | RLS policies, column-level grants, and service-role grants. Remote RLS is enabled across all 21 tables; the relevant live policies and column grants were inspected. |
| `20261014000100_branch_administrator_visibility.sql` | Intended to let institute managers see inactive branches. Its version was in remote history, but its policy change was absent from the live catalog before the corrective 20261014000200 migration. |
| `20261014000200_branch_scope_and_business_date.sql` | Applied to the approved test project after dry-run and review. It corrects branch-scope access, reconciliation visibility, and institute-local overdue dates. No business rows were rewritten. |

All seven local migration versions are recorded in the test project's remote migration history. The linked history query verified `20261014000200`; the CLI `migration list --linked` command could not authenticate with its database login after the migration, so history was verified through the linked read-only query instead. Production was not accessed.

Linked remote lint passed after the migration with no schema errors in the live bizbook_private, extensions, or public schemas. Local SQL lint and the Docker-backed pgTAP runner were not used.

## Confirmed findings and verified corrections

### High: branch-scoped access to institute-wide rows

Before the migration, `bizbook_private.can_access_branch(institute_id, NULL)` returned true for every active membership, including `access_scope='branches'`. Many SELECT policies use this helper, so a branch-scoped member could read records with a null `branch_id`. The migration now permits null-branch rows only to institute-scope members, while preserving active-branch and assigned-branch checks for non-null IDs. The post-migration assertion and live function definition verified the correction.

### High: inactive branch visibility migration drift

Remote history marks `20261014000100` applied, but before this correction the actual `branches_select_accessible` policy was still `can_access_branch(institute_id, id)`. The helper rejects inactive branches, so institute managers could not see inactive branch rows. The migration now alters the SELECT policy in place to use the existing `can_manage_institute` check OR the branch-access helper; branch-scoped users remain limited to active branches explicitly assigned to them. The post-migration assertion and policy definition verified the correction.

### High: branch finance users can read unrelated reconciliation rows

The live `reconciliation_select_finance` policy checked only institute finance role. Reconciliation rows link to an optional payment, and the table has no `branch_id`; a branch-scoped accountant could see other branches' and unlinked reconciliation rows. The migration now allows institute-scope finance users to see institute-wide rows and otherwise requires a linked payment in an accessible branch. The post-migration assertion and policy definition verified the correction.

### Medium: overdue status uses the database session date

The live `installment_balances` view compared `due_date` with `CURRENT_DATE`, which can differ from the institute's local business date. The migration keeps the same columns and accounting formulas, but compares against `(now() AT TIME ZONE coaching_institutes.time_zone)::date`. The post-migration assertion and live view definition verified the correction.

### Open model/configuration gaps

- The schema has `payments.receipt_kind` values `Fee` and `Advance`, but no separate penalty ledger or penalty type. Penalty receipts cannot be independently classified in these migrations.
- No BizBook subscription revenue ledger/table was found. Subscription revenue classification is outside this database model.
- The database requires `verified_at` for an online payment to have a paid/refunded status and authenticated users cannot write payments directly. The database does not verify provider signatures or provider status itself; trusted server code and provider configuration must be reviewed separately. This audit does not claim production payment verification.
- Salary is represented once in `salary_payments` and appears once in the history/activity views. The database cannot identify a salary copied separately into `expenses`; application writers must not create a second salary expense row.
- The platform `rls_auto_enable` event-trigger function has a default PUBLIC execute ACL. It is platform-managed and not changed here; its Data API exposure remains to be confirmed.

## Financial integrity review

- Receipts are sourced from `payments` once. `payment_allocations` are not rows in `financial_activity` or `payment_history`.
- `advance_balances` derives available credit from paid advance receipts minus allocations and the remaining amounts of pending, processing, or completed refunds.
- `installment_balances` derives paid amounts from qualifying payment allocations and subtracts only completed refund allocations. Pending refunds do not reduce collections or installment paid amounts.
- `request_refund` locks the payment and includes pending/processing/completed refunds in the over-refund limit. `complete_manual_refund` completes only a pending/processing manual refund and then updates payment status. Online refund completion must come from provider-confirmed server processing.
- `financial_activity` includes fee/advance receipts, completed refunds, salary rows, and non-voided expenses. Salary and expense entries are outflows; voided expenses are excluded.
- `payment_history` includes receipts, salary rows, and non-voided expenses. Existing tests preserve Fee and Advance classifications.
- The 47-assertion regression suite checks partial allocations, no duplicate receipt inflow, advance availability, pending/completed refunds, salary and expense classification, and the timezone fix. Penalties and subscription revenue remain unrepresentable in the current schema.

## Test evidence

| Test/check | Status | Evidence |
|---|---|---|
| Verify project target | **PASS** | `supabase/.temp/project-ref` and the sanitized `.env.local` host both identify test project `xabfsqtevwnwtxxkmkvc`. Production `cjuneqmohdivjioulyqq` was not accessed. |
| Verify migration history | **PASS** | Linked read-only query of `supabase_migrations.schema_migrations` returned all seven migrations, including `20261014000200_branch_scope_and_business_date`. |
| `supabase migration list --linked` | **BLOCKED** | The CLI failed with PostgreSQL `28P01` (`password authentication failed for user cli_login_postgres`); migration history was verified through the linked read-only query instead. |
| Read remote catalog inventory | **PASS** | Read-only catalog queries returned schema/table/view/policy/routine/grant metadata; no business rows were queried. |
| Verify live branch helper/policies/view | **PASS** | The post-migration catalog shows institute-only access for null-branch rows, manager visibility for inactive branches, branch-scoped reconciliation through accessible payments, and institute-local dates in `installment_balances`. |
| Verify application routine hardening | **PASS** | 17 BizBook security-definer routines use empty search_path and are not executable by anon; the separate event-trigger function is documented above. |
| Check remote column grants | **PASS** | Authenticated column-level writes match narrow migration grants; anon has no table/view SELECT grant. |
| Remote schema lint after migration | **PASS** | `npx supabase db lint --linked` completed against the verified test project: no schema errors found in bizbook_private, extensions, or public. |
| Remote transaction rollback probe | **PASS** | A synthetic temporary table and row created within a linked multi-statement transaction were absent immediately after ROLLBACK. |
| Synthetic fixture preflight and cleanup | **PASS** | The collision query returned no rows before and after the run. The adapted suite's transaction ended with `ROLLBACK`; no fixture records remain. |
| Adapted remote financial regression suite after migration | **PASS** | All 47 assertions passed (`# assertions=47 failed=0`), including the five previously failing branch-scope, reconciliation, inactive-branch, and local-date cases, plus receipts, advances, partial payments, refunds, salary, expenses, reminders, and date validation. |
| supabase test db --linked | **BLOCKED** | The CLI returned DockerRunError for the missing Docker engine before connecting to the database. It was not retried because Docker use is prohibited. |
| Direct remote pgTAP via db query | **BLOCKED** | The test project has no pgtap extension/functions. The attempt failed at plan(47) before fixture inserts; the subsequent fixture precheck was empty. |
| Local lint and pgTAP | **BLOCKED** | Earlier local attempts could not connect to 127.0.0.1:54322. They were not retried after the instruction to avoid Docker. |
| Linked migration dry-run | **PASS** | npx supabase db push --linked --dry-run reported only 20261014000200_branch_scope_and_business_date.sql; it made no remote changes. |
| Apply corrective migration to test project | **PASS** | The user approved `20261014000200_branch_scope_and_business_date.sql`; linked `db push` applied only that version. No business rows were rewritten. Remote migration history and post-apply tests verified it. |

The first adapted-suite invocation was blocked before database execution by the CLI telemetry file being outside the filesystem sandbox. After filesystem escalation, the same approved command ran successfully. The adapted suite uses transaction-scoped temporary assertion helpers because pgTAP is not installed remotely. It preserves the original 47 assertion expressions and rolls the synthetic fixtures and helpers back together.

## Production compatibility plan

1. The corrective migration is applied and verified on test project `xabfsqtevwnwtxxkmkvc`.
2. Keep production `cjuneqmohdivjioulyqq` untouched. A separate read-only production inventory and independently reviewed rollout plan are required before any production change.

## Status

**Test-project database audit and correction complete.** The approved migration is applied to the test project; post-apply linked lint passed, all 47 remote assertions passed, migration history includes the version, and the fixture check is empty. Production was not accessed. Production behavior and provider-side payment verification remain unverified; schema-model gaps for penalties and BizBook subscription revenue remain open.
