# BizBook production compatibility audit

**Audit date:** 2026-10-14 (Asia/Kolkata)  
**Status:** Read-only production inspection completed. No production writes were run.

## Scope and safeguards

- Supabase project listing verified reference `cjuneqmohdivjioulyqq`, project name `Money-Management`, region `ap-northeast-2`, status `ACTIVE_HEALTHY`, and PostgreSQL `17.11.0.003` before database queries.
- Production queries used the explicit project reference with reviewed `SELECT`-only catalog SQL. Aggregate counts were used for Auth and Storage; no user, payment, or other business rows were read.
- No migration, repair, DDL, DML, reset, or Docker command was run against production.
- `supabase/.temp/project-ref` and the `.env.local` Supabase URL still point to test project `xabfsqtevwnwtxxkmkvc`. Neither was changed.
- Workspace changes were preserved. This report is the only file created for this assessment.

## Verified production findings

The production database is PostgreSQL 17.11. The catalog lists the managed schemas `auth`, `extensions`, `graphql`, `graphql_public`, `public`, `realtime`, `storage`, and `vault`; it contains no `bizbook_private` schema or other custom schema.

| Area | Production result |
|---|---|
| BizBook tables and columns | No public tables or partitioned tables; therefore no BizBook columns were found. |
| Indexes and constraints | No public BizBook indexes or constraints. |
| Views | No public views or materialized views. |
| Policies and table grants | No public RLS policies, table grants, or column grants were returned. There are no public BizBook tables to protect. |
| Functions | The only application-visible routine found is the platform function `public.rls_auto_enable()`; no BizBook routines were found. |
| Table triggers and sequences | No public user-table triggers or sequences were found. |
| Migration history | `supabase_migrations.schema_migrations` does not exist (`42P01` on the read-only history query; `to_regclass` returned null). No migration versions can be read from production. |
| Existing database data | `auth.users` count: 0. `storage.objects` count: 0. No custom relations or BizBook financial tables were found. |

`public.rls_auto_enable()` is a PostgreSQL event-trigger function owned by `postgres`, marked `SECURITY DEFINER`, with `search_path=pg_catalog` and default/null ACL. `anon` has effective `EXECUTE` privilege. It is attached to the enabled `ensure_rls` event trigger for `CREATE TABLE`, `CREATE TABLE AS`, and `SELECT INTO`. Its body attempts to enable RLS on newly created public tables and logs exceptions. Whether the Supabase Data API exposes this event-trigger routine as an RPC is not established here; do not change its platform-managed ACL without platform confirmation.

## Comparison with the corrected test database

The comparison baseline is the previously completed [test database audit](database-audit.md). It recorded all seven repository migrations on test project `xabfsqtevwnwtxxkmkvc`, 21 public tables, four `security_invoker` financial views, 59 valid indexes, RLS on all 21 tables, and a passing 47-assertion financial/security regression suite after `20261014000200_branch_scope_and_business_date.sql`.

Production has none of those BizBook objects. This means all expected BizBook columns, constraints, indexes, views, functions, policies, and grants present in the test schema are absent from production. The production catalog shows no substantive partial BizBook schema. Because the migration-history table is absent, the production migration ledger itself cannot distinguish “never applied” from “history removed”; for planning, treat all seven versions as unapplied and require confirmation before rollout.

A fresh same-session query of the test project was attempted with its explicit project reference, but the active Supabase CLI identity received `403` (“does not have the necessary privileges to access this endpoint”). The test-side figures above therefore rely on the prior verified audit; no attempt was made to bypass the access control. PostgreSQL major versions match (17); the tested report also recorded PostgreSQL 17.11.

| Repository migration | Production catalog evidence | Planning status |
|---|---|---|
| `20261013000000_bizbook_core_schema.sql` | No BizBook tables, views, indexes, or constraints | Treat as unapplied |
| `20261013000100_bizbook_tenant_security.sql` | No `bizbook_private` schema or tenant/branch helpers | Treat as unapplied |
| `20261013000200_bizbook_payment_operations.sql` | No payment tables or receipt/allocation routines | Treat as unapplied |
| `20261013000300_bizbook_refund_and_payroll_operations.sql` | No refund, salary, or expense tables/routines | Treat as unapplied |
| `20261013000400_bizbook_rls_and_privileges.sql` | No BizBook tables, policies, or table/column grants | Treat as unapplied |
| `20261014000100_branch_administrator_visibility.sql` | No branches table or branch policy | Treat as unapplied |
| `20261014000200_branch_scope_and_business_date.sql` | No branch helper/policies or `installment_balances` view | Treat as unapplied |

## Data dependencies and compatibility risks

- No student, installment, payment, advance allocation, refund, expense, payroll, branch, or tenant records exist in the inspected production relational schema. There are no discovered database row conflicts or data backfills to prepare.
- Auth and Storage counts are both zero, so no existing Auth-user or Storage-object dependency was found. External systems and localStorage/legacy browser data were not inspected and will not be migrated by these SQL files.
- The production event trigger is enabled and will run during table creation. Verify RLS is enabled on every new public table after migration; the migration set also defines explicit RLS and policies.
- `20261014000100_branch_administrator_visibility.sql` drops and recreates a policy after the core RLS migration creates it. On the inspected empty schema there is no existing BizBook policy customization to overwrite, but preserve this order and review the exact migration before any apply.
- `20261014000200_branch_scope_and_business_date.sql` uses `ALTER POLICY` and replaces the helper and `installment_balances` view. It depends on the policies, helper functions, tables, and view created by earlier migrations. Do not apply it alone.
- The absence of BizBook tables means production currently cannot provide the tested receipt, installment, refund, expense, payroll, branch-scope, or tenant-isolation behavior. The test suite’s financial results do not verify production behavior.

## Proposed migration plan (not executed)

1. Before any deployment, obtain a verified production backup or point-in-time recovery point; confirm retention and a successful restore to an isolated project. Do not assume backup coverage from the empty table inventory.
2. Reconfirm the project reference, name, and region immediately before an approved change. Keep `.env.local` on the test project.
3. Resolve the absent migration-history table with the project owner and Supabase migration workflow. Do not use migration repair. Confirm whether the project is intentionally fresh and whether a migration ledger should be initialized by the normal migration runner.
4. Review all 12 current repository migrations and their dependencies. The original seven versions run through `20261014000200`; the five later files are listed in the post-snapshot section below. Test and validate every pending migration against the authorized test database first. Apply to production only after separate explicit approval, in chronological order, without skipping prerequisites.
5. After an approved deployment of the full current set, verify the ledger, expected 22 public BizBook tables and seven views, columns/types, constraints, valid indexes, function definitions and `search_path`, RLS on every public table, policy expressions, grants, table triggers, and the `ensure_rls` event trigger. Rerun financial assertions on the test project; use read-only production checks for schema and aggregate results unless production test writes are separately approved.

### Rollback limitations

The migration set has no verified production rollback scripts. The corrective migration contains no business-row DML, but the initial schema migrations create many objects and production data could be entered after deployment. Do not drop/reset the schema or repair history to roll back. Prefer a reviewed forward corrective migration; otherwise restore the pre-change backup under an approved recovery plan. Inspect actual catalog state before retrying any failed migration.

## Remaining financial and security issues

- Provider-side payment verification and refund confirmation are not established by database state alone. `verified_at` is not proof of a provider check; trusted server code and provider configuration need separate review.
- The test schema has no separate penalty ledger/type and no BizBook subscription-revenue ledger/table.
- Salary is counted once in the tested salary view, but an application writer could still duplicate it as an expense; the database model does not reconcile those two records.
- The platform `rls_auto_enable()` function has effective `anon` execution. Its API exposure and platform-managed purpose remain unresolved; do not alter its ACL based solely on this catalog result.
- Test-only branch and tenant isolation assertions do not establish production authorization behavior until the schema is deployed and separately verified.

## Check results

| Check | Status | Evidence |
|---|---|---|
| Verify production ref and region | **PASS** | Project list returned `cjuneqmohdivjioulyqq`, `Money-Management`, `ap-northeast-2`, `ACTIVE_HEALTHY`. |
| Production catalog inventory | **PASS** | Explicit-ref read-only inventory returned no public tables/views/policies/triggers/sequences and only the platform RLS routine. |
| Production migration history | **BLOCKED** | `supabase_migrations.schema_migrations` is absent (`42P01`); no production migration versions are recorded in an accessible ledger. |
| Production Auth/Storage dependency counts | **PASS** | Read-only aggregates returned 0 Auth users and 0 Storage objects. |
| Production platform RLS function/event trigger | **PASS** | Definition, owner, `SECURITY DEFINER`, `search_path`, effective anon execution, and enabled `ensure_rls` tags were inspected. |
| Fresh test-project inventory | **BLOCKED** | Current CLI identity received `403` for test project `xabfsqtevwnwtxxkmkvc`; comparison uses its prior verified audit report. |
| Production changes | **NOT RUN** | No production write, migration, repair, push, data mutation, environment change, or Docker use occurred. |

**Stop point:** Read-only assessment and plan only. No production change is authorized by this report; obtain separate explicit approval before any production write.

## Local migration files added after this snapshot

This report is the read-only production snapshot from 2026-10-14 and has not been refreshed. No production connection or write was made during subsequent application work. Since the snapshot, the repository has added five local migrations beyond the original seven-migration comparison baseline:

- `20261014000300_secure_payment_provider_credentials.sql`
- `20261015000100_expense_void_operation.sql`
- `20261015000200_expense_create_idempotency.sql`
- `20261015000300_dashboard_financial_summaries.sql`
- `20261015000400_student_record_operations.sql`

These migrations were not part of the original production comparison and are not confirmed present in production. The snapshot found no BizBook tables or custom schema objects, so treat them as unapplied for planning, then recheck the live catalog before any separately approved deployment. The summary views depend on the base financial views; the student operation migration depends on the core student, installment, payment, refund, and branch-security objects; expense changes depend on the initial `expenses` table and security helpers; provider credential storage requires Supabase Vault. This workspace did not apply them to production; their current live presence is unknown without a fresh read-only query.

The later application continuation added tenant/branch-scoped student record and manual receipt workflows, plus read-only reminder/financial-summary screens. At that time the test-project CLI returned HTTP 403; that blocker was later resolved. The production report below remains a historical snapshot.

## Test baseline update; production not reconnected (2026-10-15)

The test project is `xabfsqtevwnwtxxkmkvc`. Its Vault preflight guards were corrected to match the installed Vault function signatures, and migrations `20261014000300` through `20261015000700` were applied in order. The test migration ledger now matches all 15 local migration versions. Test-side schema lint passed; the rolled-back financial suite passed 47/47 and the platform-admin security suite passed 30/30. Read-only catalog checks found all public BizBook tables protected by RLS, 70 validated foreign keys, and no invalid indexes or unvalidated constraints. The platform administrator, plan, and subscription tables contain zero rows.

This is a test-project update only. Production project `cjuneqmohdivjioulyqq` was not connected or queried during this continuation, and its previous 2026-10-14 findings have not been revalidated. Based on the prior empty production catalog, plan for the newer migrations to be absent, but treat their current production state as **unverified** until a separate approved read-only assessment. No production change is authorized by this report.

## Test-only verification update (2026-10-16)

The production inventory above remains the **2026-10-14 read-only snapshot** and was not refreshed in this continuation. Production project `cjuneqmohdivjioulyqq` was not connected or queried. For the separate test project only, the CLI link and `.env.local` host were verified as `xabfsqtevwnwtxxkmkvc`; all **18/18** repository migrations are now present in its migration ledger. Linked database lint passes. The financial/RLS, student operations, central provider security, platform-admin operations/limits, and trusted provider-check suites passed **149/149** rollback-only assertions. No fixture rows remained in the tested student, staff, branch, platform-admin, plan, subscription, invoice, payment-attempt, provider, or platform audit/event tables.

These test-project results do not establish production schema compatibility. The prior production report found no BizBook schema or migration ledger; current production migration state remains unverified until a separately approved read-only assessment. Production write approval, verified backup/PITR restore, reviewed migration plan, and post-change verification are still required. Production readiness remains **NO-GO**.

## Test-only verification update (2026-10-16, final recheck)

No production connection was made. On test project `xabfsqtevwnwtxxkmkvc`, the CLI link and `.env.local` host were verified before remote commands. Read-only migration history confirms **19/19** repository versions applied. Linked schema lint reports no errors. The five rollback-only SQL suites passed **150/150** assertions after migration `20261015001100_attendance_staff_branch_integrity.sql`: financial/RLS 48, student operations 38, central provider security 30, platform-admin operations/limits 26, and provider-check audit 8. Each suite was verified to run between `BEGIN` and `ROLLBACK`.

This does not refresh the production snapshot or prove production compatibility. Production `cjuneqmohdivjioulyqq` remains untouched. A fresh approved read-only production compatibility assessment, verified backup/PITR restore, and separate production deployment approval remain prerequisites; recommendation remains **NO-GO**.

## Final test-only verification update (2026-10-16)

The production snapshot remains unchanged; project `cjuneqmohdivjioulyqq` was not connected. On test project `xabfsqtevwnwtxxkmkvc`, the verified migration ledger is now **21/21** and linked lint reports no schema errors. Seven rollback-only SQL suites passed **163/163** assertions after migrations `20261015001200_secure_staff_compensation_reads.sql` and `20261015001300_reject_future_attendance.sql`. These verify financial/RLS behavior, student operations, central providers, platform operations/limits, provider-check audit, finance-only compensation access, and the future-attendance rejection. No persistent synthetic fixture rows were intentionally created; each test transaction ends in `ROLLBACK`.

These test results do not refresh or prove compatibility with production. Production's current schema/migration state, backup restoration, and production RLS compatibility remain unverified beyond the historical read-only 2026-10-14 audit. Recommendation remains **NO-GO** pending a separately approved fresh read-only production assessment, demonstrated backup/PITR restore, and separate deployment approval.

## Test database update; production remains protected (2026-10-17)

This is not a new production assessment. Production project `cjuneqmohdivjioulyqq` was not connected, queried, or modified. The last production catalog findings remain the **2026-10-14 historical snapshot** and must not be assumed current.

The authorized test project `xabfsqtevwnwtxxkmkvc` was confirmed before the only migration write. Migration `20261017000100_restrict_trigger_function_execute.sql` was added and applied after 26 existing versions; the read-only migration history then showed **27/27** applied. Test catalog summary reports 30 public tables all protected by RLS, 48 policies, 72 validated FKs, seven `security_invoker` views, no invalid indexes, no app `SECURITY DEFINER` routines executable by `anon`, and fixed `search_path` on those routines. Eight rollback-only suites pass **190/190**. Test schema lint passes.

One platform-admin row and one platform audit event exist in the test database; only aggregate counts were inspected. There are zero plans, subscriptions, invoices, payment attempts, and central provider connections. This test state says nothing about production.

Production compatibility still needs a separately approved current read-only inventory. A verified production backup and isolated restore rehearsal have not been demonstrated. Production migration/connection recommendation: **NO-GO**.
