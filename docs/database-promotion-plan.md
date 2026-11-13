# BizBook database promotion plan

**Prepared:** 2026-10-17 (Asia/Calcutta)
**Production decision:** **NO-GO**
**Test project:** `xabfsqtevwnwtxxkmkvc`
**Protected production project:** `cjuneqmohdivjioulyqq` (not accessed during this audit).

## Verified test state

The Supabase CLI link and `.env.local` host were checked against `xabfsqtevwnwtxxkmkvc` before the latest test reads/writes. Read-only history now reports **38/38** repository migrations applied in timestamp order through `20261017001200`. Linked database lint passes. No production target was connected.

Catalog gate summary after the final test migration:

- 35/35 public tables have RLS enabled; 53 RLS policies.
- 85 validated foreign keys, zero unvalidated; zero invalid indexes.
- Seven public views, all `security_invoker`.
- Zero application security-definer routines executable by `anon` or missing a fixed search path.
- The rollback-only platform-subscription settlement suite passes **43/43**. Other remote suites are dated snapshots in this document; they were not all rerun after every later additive migration.

This verifies the current test schema only. It does not establish production compatibility or production data safety.

## Exact test migration order

All versions below are present locally and applied in this order to the authorized test project. The migration version prefixes are unique; there are no duplicate versions or out-of-order entries.

| Order | Migration | Purpose |
|---:|---|---|
| 1 | `20261013000000_bizbook_core_schema.sql` | Core BizBook relations and types |
| 2 | `20261013000100_bizbook_tenant_security.sql` | Tenant membership, scoped functions, and baseline authorization |
| 3 | `20261013000200_bizbook_payment_operations.sql` | Payment/allocation operations |
| 4 | `20261013000300_bizbook_refund_and_payroll_operations.sql` | Refund and payroll operations |
| 5 | `20261013000400_bizbook_rls_and_privileges.sql` | RLS and grants |
| 6 | `20261014000100_branch_administrator_visibility.sql` | Branch visibility policy correction |
| 7 | `20261014000200_branch_scope_and_business_date.sql` | Branch scope and institute-local dates |
| 8 | `20261014000300_secure_payment_provider_credentials.sql` | Vault-backed institute payment secrets |
| 9 | `20261015000100_expense_void_operation.sql` | Audited soft-void operation |
| 10 | `20261015000200_expense_create_idempotency.sql` | Retry-safe expense creation and operations |
| 11 | `20261015000300_dashboard_financial_summaries.sql` | Tenant-scoped financial summary views |
| 12 | `20261015000400_student_record_operations.sql` | Atomic student/schedule create, edit, archive, and allocation safeguards |
| 13 | `20261015000500_penalties_subscriptions_and_integrations.sql` | Explicit comment-only no-op; it creates no ledger or object |
| 14 | `20261015000600_protect_archived_student_allocations.sql` | Reject new allocations to archived students |
| 15 | `20261015000700_platform_admin_and_central_providers.sql` | Platform roles, central provider metadata/Vault, subscriptions and audit tables |
| 16 | `20261015000800_platform_admin_operations_and_limits.sql` | Platform operations, plan limits, first-owner provisioning, subscription assignment |
| 17 | `20261015000900_platform_provider_sandbox_verification.sql` | Trusted provider-check audit state |
| 18 | `20261015001000_restore_branch_scope_after_suspension.sql` | Correct branch-scope authorization after suspension handling |
| 19 | `20261015001100_attendance_staff_branch_integrity.sql` | Keep attendance branch consistent with staff assignment |
| 20 | `20261015001200_secure_staff_compensation_reads.sql` | Restrict salary details to finance roles |
| 21 | `20261015001300_reject_future_attendance.sql` | Reject future attendance dates |
| 22 | `20261016000100_online_payment_operations.sql` | Test-only payment intents, reconciliation, and trusted finalization |
| 23 | `20261016000200_online_payment_order_retry_recovery.sql` | Idempotent retries and provider order recovery |
| 24 | `20261016000300_ignore_stale_payment_events.sql` | Preserve terminal payment states against stale events |
| 25 | `20261016000400_shared_business_profile.sql` | Shared profile data and private logo bucket policies |
| 26 | `20261016000500_grant_institute_logo_path.sql` | Authenticated column grant for scoped logo path updates |
| 27 | `20261017000100_restrict_trigger_function_execute.sql` | Revoke anonymous/public execution from privileged trigger functions |
| 28 | `20261017000200_platform_support_workflows.sql` | Institute support tickets/messages, RLS, idempotency, audit, and platform queue |
| 29 | `20261017000300_correct_support_ticket_rate_limit.sql` | Correct the daily support ticket boundary in a forward-only function replacement |
| 30 | `20261017000400_expiring_parent_payment_links.sql` | Hashed, expiring/revocable public parent payment links and audited issue/revoke |
| 31 | `20261017000500_restore_payment_terminal_event_guard.sql` | Restore stale terminal-event protection after the checkout-link RPC replacement |
| 32 | `20261017000600_online_refund_operations.sql` | Idempotent online refund reservation, provider reconciliation, and trusted completion |
| 33 | `20261017000700_persist_workspace_scope_preferences.sql` | User-scoped workspace selection preference under self-only profile RLS |
| 34 | `20261017000800_isolate_platform_support_data.sql` | Restrict support-role visibility from platform institute, billing, and provider data |
| 35 | `20261017000900_platform_subscription_payment_settlement.sql` | Provider-confirmed invoice settlement and payment event finalization |
| 36 | `20261017001000_guard_competing_platform_subscription_attempts.sql` | Serialize competing subscription payment attempts and late captures |
| 37 | `20261017001100_platform_payment_capture_reference_semantics.sql` | Preserve canonical captured payment references across retries |
| 38 | `20261017001200_safe_legacy_student_import.sql` | Idempotent, owner/branch-authorized import mapping for new unpaid student schedules |

Static migration scan found no migration-time `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or broad business-row deletion. Some migrations replace policies, revoke credentials writers, and define intentional runtime operations (for example, soft archive or administrator removal). Those operations require separate application authorization and are not run merely by applying the schema migration. Do not edit already-applied historical migrations to hide drift.

## Production preflight and compatibility

The available [production compatibility audit](production-compatibility-audit.md) is dated **2026-10-14**. It reported no BizBook application schema in production at that time, but it is historical and was not refreshed in this audit. Do not infer that production is still empty or that this 37-version set is safe to push. A future promotion must:

1. Separately authorize read-only access and reconfirm the production reference and URL without exposing keys.
2. Compare every production migration version and catalog object with this list and produce a reviewed delta. Apply only missing, compatible versions; never push the whole test state blindly.
3. Inspect lock duration, RLS/policy replacement effects, grants, Vault prerequisites, Storage buckets/policies, functions, trigger behavior, and data backfills.
4. Confirm active production application compatibility during every expand step. No destructive contract step belongs in the first release.
5. Obtain explicit approval for any production write. This document does not authorize it.

## Backup and restore gate

**Evidence status: NOT DEMONSTRATED.** No production backup was requested, exported, restored, or validated. Before deployment, the owner must select an available supported Supabase backup/PITR mechanism, capture a recoverable pre-change point, store any dump encrypted in approved storage, and restore it to an isolated project running a compatible PostgreSQL version and required extensions.

The restore rehearsal must verify migration history, row counts and key relationships, Auth/Storage configuration, private logo access, financial receipt/refund/advance reconciliation, RLS policies, and application smoke tests. Record timestamps, project references, checksums where supported, and the operator. Do not place secrets or exported business data in this repository.

## Rollback and recovery

The migration history has no generated down-migration set. Treat migrations as forward-only. For an application defect before data mutation, roll back the application release while the schema remains backward-compatible. For a schema defect, create and review a new corrective migration; do not rewrite applied history or reset the database. If financial data is affected, stop writes and use the tested recovery point only under a separately approved incident plan, followed by reconciliation of transactions created after that point. Never use `db reset`, blanket table deletion, or a full test-database copy as production rollback.

## Post-promotion verification queries

Run only after separate production approval and with the exact target revalidated:

1. Read-only migration history: every expected version applied once; no local/remote mismatch.
2. Catalog counts: public relations, RLS enabled for every application table, policies, validated FKs, indexes valid, all views `security_invoker`, fixed `search_path` on application `SECURITY DEFINER` routines, and no unintended `anon` execution.
3. Storage: private logo bucket, institute path isolation, and authorized profile/logo access.
4. Financial reconciliation: receipts once, allocations not receipts, completed refunds only in outflow, outstanding/advance balances, salaries and expenses against their source rows.
5. Authenticated tests with two independent institutes and multiple roles, including branch restrictions and platform-admin denial for ordinary members.
6. Application error/health checks and provider webhook verification only after external test configuration is approved.

## Decision

**NO-GO for production migration or connection.** Test schema and rollback-only suites pass, but current production compatibility, verified backup/restore, authenticated browser isolation, provider sandbox, checkout UX, provider-backed refunds/subscriptions, and complete legacy reconciliation remain unverified or incomplete.

## Support migration verification update (2026-10-17)

- Migrations 28 and 29 add institute support ticket/thread persistence and correct its daily limit. Both are additive; neither alters financial records or previously applied migrations. The corrective migration uses `CREATE OR REPLACE FUNCTION` with the same signature and retains existing function ACLs.
- Applied in order to test project `xabfsqtevwnwtxxkmkvc` after rechecking the CLI reference and `.env.local` host; history reports **29/29 applied**. `supabase db lint --linked` passes.
- `platform_support_workflows_remote.test.sql` passed **29/29** assertions in an explicit rollback transaction. It tested RLS visibility, authenticated role grants, institute isolation, idempotency, rate limiting, closed-ticket behavior, platform status changes, and audit rows. Synthetic user/institute/ticket/message counts were zero after the suite.
- Current test catalog: 32 public tables with RLS enabled, 50 policies, 76 validated FKs, 7 security-invoker views, zero invalid indexes. No application definer routine is executable by `anon` or missing a fixed search path.
- This plan still does not demonstrate production schema compatibility, backup restore, or production rollback. The support migration is test-only and does not authorize production promotion.

## Revalidation after subscription visibility page (2026-10-17)

- Added the institute-facing `/settings/subscription` read-only page using the existing RLS-protected subscription, plan, invoice, and payment-attempt tables. It does not add or change schema and does not initiate billing.
- Rechecked the test project identity (`xabfsqtevwnwtxxkmkvc`) before remote checks. Migration history remains **29/29 applied** and linked `public` schema lint passes. No migrations were rerun or added in this continuation.
- Reran the nine existing transaction-scoped remote SQL regression suites (**219/219**) and added a two-institute subscription visibility suite (**9/9**); all ten suites pass **228/228**. Each suite has explicit `BEGIN`/`ROLLBACK` boundaries.
- Added `supabase/tests/schema_catalog_summary_readonly.sql`, which returns counts only. Current test catalog: 32/32 public tables RLS-enabled, 50 policies, 76 validated and zero unvalidated FKs, 7 security-invoker views, zero invalid indexes, no application SECURITY DEFINER functions callable by `anon` or missing a fixed search path, one private logo bucket, zero public buckets, and four Storage policies. Synthetic subscription fixture residuals: zero.
- Local final regression: **24 helper/CSV test files, 206 checks PASS**; BizBook Brain **88/88 PASS**; TypeScript, full ESLint, and production build pass; Next.js reports **52 routes**. Production dependency audit: zero; complete development dependency audit: nine high findings.
- Production was not accessed. Authenticated browser use of the new subscription page, provider payment collection, production compatibility, and backup restoration remain unverified; production stays **NO-GO**.
- Dependency gate remains: production dependency audit is clean, but the full development/build-tool audit has nine high findings. `npm audit fix --dry-run` proposed no non-breaking update; forced toolchain downgrades were not applied.

## Member RPC regression check (2026-10-17)

- No migration was added for `/business/members`; it uses the existing authenticated membership and branch-grant RPCs.
- After verifying both `.temp/project-ref` and `.env.local` resolve to test project `xabfsqtevwnwtxxkmkvc`, `member_management_remote.test.sql` passed **13/13** in a transaction ending with `ROLLBACK`. The post-run Auth-user aggregate count was zero. Migration history remains **29/29**.
- Combined remote rollback-only verification is **11 suites / 241 assertions PASS**. This does not change production compatibility or backup/restore status; production remains NO-GO and was not accessed.

## Latest test-project payment migration verification (2026-10-17)

Migrations 30 and 31 are applied only to test project `xabfsqtevwnwtxxkmkvc`; the read-only history check reports 31/31 local versions applied. `supabase db lint --linked` passes. The catalog reports 33/33 public tables with RLS enabled, 50 policies, 78 validated foreign keys, and seven security-invoker views.

The checkout-link SQL suite passed 15/15 and the updated online-payment suite passed 27/27 in explicit rollback transactions. A regression found during the first SQL rerun was corrected with the forward-only migration 31, then the final suite passed, including stale terminal-event and second-capture reconciliation assertions. No other prior remote suite is represented as rerun after these two migrations. Production was not connected; backup/restore is not demonstrated and the decision remains **NO-GO**.

## Test-only status refresh (2026-10-17)

- Verified the linked project and `.env.local` public host as test ref `xabfsqtevwnwtxxkmkvc`; read-only migration history now reports **32/32** repository versions applied. No migration was added or reapplied in this pass.
- Test schema lint passes. Read-only catalog counts: 33/33 public tables have RLS; 50 public policies; 78 validated and zero unvalidated foreign keys; seven security-invoker views; zero invalid indexes; no application `SECURITY DEFINER` routines callable by `anon` or missing a fixed search path; one private institute-logo bucket and four storage policies.
- The online-payment suite passed **29/29** in an explicit rollback transaction after adding a late-capture-after-failure regression. Post-run read-only counts found no synthetic order, payment, or webhook-event residue.
- This remains test-only evidence. Production `cjuneqmohdivjioulyqq` was not queried. The production compatibility report is historical, no recoverable production backup/restore drill is demonstrated, and this document does not authorize promotion. Keep the decision **NO-GO** until current production comparison, backup restoration, rollback review, and all other release gates pass.

## Workspace preference migration (2026-10-17)

- Applied only `20261017000700_persist_workspace_scope_preferences.sql` to verified test project `xabfsqtevwnwtxxkmkvc`. It adds one non-business JSON preference column to `profiles` and grants update only to authenticated users under the existing self-only RLS policy. No business rows were rewritten.
- Read-only migration history confirms **33/33** versions. Linked schema lint passes. `workspace_scope_preferences_remote.test.sql` passed **13/13** assertions using two synthetic Auth users and rolled back; a post-run aggregate check found zero matching Auth users.
- This is test-only evidence. No production target was connected or modified.

## Final read-only revalidation (2026-10-17)

- Verified `supabase/.temp/project-ref` and the `.env.local` Supabase URL host as test project `xabfsqtevwnwtxxkmkvc` before remote commands. Read-only migration listing confirms all **33/33** local versions applied; linked schema lint passes.
- The read-only catalog query reports **33/33** public tables with RLS, 50 policies, 78 validated and zero unvalidated foreign keys, seven public views and all seven `security_invoker`, zero invalid indexes, zero application `SECURITY DEFINER` routines executable by `anon` or missing a fixed `search_path`, one private institute-logo bucket, and four Storage policies.
- No schema writes were run in this revalidation. The workspace-preference SQL suite's prior test-project run was rollback-only (**13/13**) and left zero synthetic Auth users.
- Local release gates freshly pass: `npm test` (29 local test files plus Brain **88/88**), `npx tsc --noEmit`, full ESLint, and `npm run build` (59 routes). These checks do not replace authenticated browser journeys, provider sandbox transactions, production compatibility review, or a verified production backup/restore.
- Production `cjuneqmohdivjioulyqq` was not connected or queried. Production remains **NO-GO**.

## Test-only role privacy correction (2026-10-17)

- Verified target before write: CLI reference and `.env.local` URL host both equal `xabfsqtevwnwtxxkmkvc`. A dry-run identified only `20261017000800_isolate_platform_support_data.sql`; that one additive migration was then applied to the test project.
- The migration removes browser execution of the broad legacy platform overview RPC, adds a role-aware wrapper and caller-role RPC, and narrows support-role RLS visibility. It changes grants/policies only; it does not alter business rows, backfill data, or touch Vault secrets. No destructive table operation or reset was used.
- Test migration evidence: 34 local version files with 34 unique prefixes; read-only remote `supabase_migrations.schema_migrations` query returned 34 versions through `20261017000800`. Remote rollback-only tests passed privacy 22/22, platform operations 28/28, and support 29/29. Post-migration catalog summary: 33/33 public tables with RLS, 78 validated FKs, 0 unvalidated FKs, 7 security-invoker views, 0 invalid indexes, 0 application definer routines executable by `anon` or missing a fixed search path.
- Direct PostgreSQL `supabase migration list` and `supabase db lint` returned `28P01` for `cli_login_postgres` after applying this migration. The linked lint result is **not verified after this change**; the Management-API ledger/catalog queries and SQL tests did succeed.

## Corrective migration rollback plan

There is no down migration. Do not restore the previous broad support-role reads or regrant the legacy overview RPC. If a defect is found, keep the support role fail-closed and issue a reviewed forward corrective migration that preserves the role boundary. Application rollback may use the previous UI/API only if it remains compatible with the safe database wrapper and restricted RLS; otherwise keep the current application version until a compatible correction is deployed. No production promotion or backup step was performed here.

The normal production backup/restore gate remains **NOT DEMONSTRATED**: a verified backup and an isolated restore rehearsal are still required before any separately approved production migration.

## Additional test-only migration (2026-10-17)

- `20261017000900_platform_subscription_payment_settlement.sql` was the only migration in the dry run and the only migration applied in this continuation. Target preflight matched test project `xabfsqtevwnwtxxkmkvc`; the protected production project was not connected.
- Read-only Management-API history/catalog checks reported 35 applied versions and the settlement objects present. The new SQL suite passed 35/35 in a transaction ending with `ROLLBACK`; linked test lint passed. A direct CLI migration-list query later failed with SQLSTATE `28P01` for the cached CLI login role, so the Management-API check is the history evidence recorded here.
- There is no down migration. If settlement logic needs correction, keep the finalizer fail-closed and use a reviewed forward-only migration. Do not mark invoices paid manually to compensate for provider uncertainty; reconcile against the provider first. No existing invoice or payment row was rewritten by this migration.

This does not authorize production promotion. The production project still needs a fresh read-only compatibility comparison, a verified encrypted backup, and a successful isolated restore rehearsal, followed by separate explicit approval.

## Subscription payment concurrency and capture-reference corrections (2026-10-17)

- Added and applied only to test project `xabfsqtevwnwtxxkmkvc` the forward migrations `20261017001000_guard_competing_platform_subscription_attempts.sql` and `20261017001100_platform_payment_capture_reference_semantics.sql`. Each dry run identified only its new migration; the CLI link and `.env.local` URL host matched the approved test ref before each push.
- The first test exposed the late-capture/retry race; its correction serializes finalizers per invoice and prevents settlement while another attempt is unresolved. The next test exposed failure IDs blocking a later capture; the second correction keeps noncaptured provider IDs in event history and preserves the canonical captured ID.
- Current read-only Management-API history reports **37/37** versions through `20261017001100`. The expanded remote SQL suite passed **43/43** in a transaction ending with `ROLLBACK`; post-run aggregate fixture counts are zero. All three settlement RPCs use fixed search paths, deny `anon`, and grant service-role execution.
- `supabase db lint` attempted after these changes but failed to authenticate `cli_login_postgres` with SQLSTATE `28P01`. Post-migration lint is **not verified**, even though the prior schema lint passed before these two migrations. Do not treat the current catalog lint gate as closed.

These test-only fixes do not authorize production promotion. Production remains untouched; fresh production compatibility comparison and a demonstrated backup/restore are still required.

## Latest read-only test-project revalidation (2026-10-17)

- Before connecting, verified both CLI project reference and `.env.local` URL host as test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history reports **34/34** local versions applied through `20261017000800`.
- The former linked PostgreSQL login error (`28P01`) is cleared. `supabase db lint --linked --project-ref xabfsqtevwnwtxxkmkvc` passes without schema errors.
- Count-only catalog query: 33/33 public tables have RLS; 50 public policies; 78 validated and zero unvalidated foreign keys; seven public views and all seven are `security_invoker`; zero invalid indexes; zero application `SECURITY DEFINER` functions callable by `anon` or lacking fixed `search_path`; one private logo bucket and four storage policies.
- Only read-only commands were run in this revalidation. No migration or SQL write was executed, and production was not queried. Existing rollback-only SQL suites are not claimed as rerun in this pass.
- This does not change the promotion decision: production schema compatibility and backup/restore remain unverified; provider sandbox, authenticated browser journeys, subscription settlement, and legacy-data reconciliation remain open. **NO-GO.**

## Latest test-only inventory (2026-10-17)

- Target preflight verified both the Supabase CLI link and `.env.local` URL host as test project `xabfsqtevwnwtxxkmkvc`. Read-only history reports 37 applied repository migrations through `20261017001100`.
- Fresh count-only catalog query reports 34 public tables with RLS enabled on all 34, 52 public policies, 81 validated and zero unvalidated foreign keys, seven `security_invoker` views, zero invalid indexes, zero application `SECURITY DEFINER` routines callable by `anon` or lacking a fixed search path, one private institute-logo bucket, and four Storage policies. Named synthetic visibility-fixture counts are zero.
- Platform table aggregate: one platform-admin role row and zero plans, subscriptions, subscription invoices, payment attempts, provider connections, or subscription provider events. No identity data was read.
- Static scan of the 37 local migration files found no duplicate/out-of-order versions, empty migrations, table/schema/column drops, or truncations. `DROP POLICY` statements replace access policies; scoped deletes occur inside branch-access/admin role operations.
- These checks were read-only. Linked schema lint after the latest migrations remains unverified due direct login SQLSTATE `28P01`. There is no production compatibility query, backup, restore rehearsal, rollback exercise, or authorization to promote these test migrations.

**Promotion remains NO-GO.** Before any separately approved production work: obtain a current read-only production diff, confirm an encrypted supported backup and isolated restore, review exact migration effects against current production records, and run post-migration checks only after approval.

## Safe legacy student import migration (2026-10-17)

- Migration `20261017001200_safe_legacy_student_import.sql` was the only pending migration in the verified test-project dry run and was applied only to test project `xabfsqtevwnwtxxkmkvc`.
- It adds `legacy_student_imports`, with RLS and owner/administrator-only reads, and an authenticated owner/administrator RPC. The RPC creates a new student plus unpaid fee schedule by calling `save_student_record` in the same transaction, records source identity/fingerprint metadata, and adds an audit event. Direct authenticated table writes are revoked. Raw browser payloads are not stored.
- Remote transaction-scoped SQL assertions passed **16/16**. The file ends in `ROLLBACK`; post-run aggregate checks found zero synthetic Auth users, institutes, memberships, students, installments, import mappings, or import audit rows. Read-only migration history is **38/38**. Fresh catalog reports 35/35 public tables with RLS, 53 policies, 85 validated and zero unvalidated FKs, seven security-invoker views, and zero invalid indexes. Linked database lint passes.
- There is no down migration. If the importer has a defect, disable its UI and use a reviewed forward migration to revoke its RPC grant or tighten its checks. Do not delete imported students or their ledger history; use the existing audited archive workflow after checking for financial references. This migration has not imported actual user data.

This test-only migration does not change production scope. The migration set is **not** approved for production: production has not been refreshed against the current schema, no verified backup/restore rehearsal exists, and the feature/importer and user data are not production-verified.

## Current test-project status correction (2026-10-17)

- The previously recorded direct PostgreSQL CLI login failure (`28P01`) is cleared. Before remote access, the CLI reference and `.env.local` host were checked against test project `xabfsqtevwnwtxxkmkvc`.
- Read-only migration history confirms **37/37** local versions through `20261017001100`. `supabase db lint --linked --project-ref xabfsqtevwnwtxxkmkvc` **PASS** with no schema errors.
- Fresh read-only catalog counts: 34/34 public tables with RLS, 52 policies, 81 validated and zero unvalidated FKs, seven security-invoker views, zero invalid indexes, no application SECURITY DEFINER function callable by `anon` or missing fixed `search_path`, one private logo bucket, four Storage policies.
- No migration or persistent database write occurred in this recheck; production was not queried. This supersedes prior notes that post-`20261017001100` lint remained blocked. It does not demonstrate production compatibility, backup/restore, provider verification, or authenticated end-to-end authorization.

**Production promotion remains NO-GO.**

## Final test-project status and promotion decision (2026-10-17)

- The only new migration in this phase, `20261017001200_safe_legacy_student_import.sql`, was applied only to verified test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history reports **38/38** repository versions; linked schema lint passes. Its transaction-scoped SQL suite passed **16/16** and ended with `ROLLBACK`.
- Current read-only catalog counts: 35 public tables, RLS enabled on all 35, 53 policies, 85 validated foreign keys and zero unvalidated constraints, seven `security_invoker` views, and zero invalid indexes. No synthetic import fixtures remained after tests.
- The migration supports only explicit import of new students with wholly unpaid schedules. It creates an idempotency mapping and audit row without storing the raw legacy payload. It does not establish reconciliation for receipts, advances, refunds, expenses, payroll, attendance, staff, or profile data. Existing browser keys remain unchanged.
- **Credential incident:** the test-project service-role credential was exposed in prior assistant tool output and must be considered compromised. Rotate/revoke it at Supabase and update only the server-side deployment secret with the replacement. It was not reused after exposure, and no production credential was read. Production remains uncontacted.
- The compromised setting has now been removed from local `.env.local`; safe verification confirms the URL and CLI link still identify the test project and the service-role setting is absent. The production build passes without that setting, but server-role-dependent runtime paths are unverified and must remain disabled pending rotation.
- Fresh `npm audit --audit-level=high` reports nine high development/build dependency findings; the production-only audit has zero findings. The braces advisory has no patched version listed and npm proposes a breaking forced change. This remains an open build-tooling security item; no force update was made.
- Production promotion remains prohibited until the credential is rotated, a fresh read-only production compatibility diff is reviewed, a supported encrypted backup is captured, and a restore rehearsal succeeds in an isolated environment. Resolve or explicitly risk-accept the development dependency finding before enforcing a zero-high release gate. This report does not authorize production migration or connection.

## Application-only payment recovery change (2026-10-17)

The Razorpay timeout-recovery correction adds no migration and makes no remote database change. Test-project history remains the last verified **38/38** migrations for `xabfsqtevwnwtxxkmkvc`; this continuation did not query the test database. Production project `cjuneqmohdivjioulyqq` was not accessed. Do not add this application-only change to the production migration batch. Provider sandbox validation and normal post-deployment health checks remain required after credential rotation and test setup.

## Safe legacy staff-profile import (2026-10-17)

- `20261017001300_safe_legacy_staff_import.sql` was the only migration in the verified test-project dry run and was applied only to `xabfsqtevwnwtxxkmkvc`. The CLI ref and `.env.local` URL host were checked before the write. Read-only migration history now confirms **39/39** repository versions applied.
- This additive migration introduces the RLS-protected `legacy_staff_imports` fingerprint mapping and an authenticated owner/admin-only atomic RPC for staff profile/current compensation fields. It has a tenant/branch-consistent foreign-key mapping, no direct authenticated mapping writes, fixed `search_path`, and no raw source payload persistence. Existing staff rows are not altered. Attendance and salary-payment history are excluded.
- Its remote SQL suite passed **17/17** assertions in a transaction ending with `ROLLBACK`; read-only fixture aggregates returned zero import, staff, and audit rows after the suite. Linked database lint passed. The fresh read-only catalog reports **36/36** public tables with RLS, **54** policies, **89** validated and zero unvalidated foreign keys, seven security-invoker views, and zero invalid indexes.
- No down migration exists. If the import behavior needs correction, disable the import action and issue a reviewed forward migration to revoke or tighten the RPC. Do not delete imported staff or associated history; use audited archive behavior after checking dependencies. No actual user rows were imported.
- This migration is **not approved for production promotion**. A fresh production compatibility comparison, encrypted backup, isolated restore rehearsal, and separate explicit production approval are still required. Production project `cjuneqmohdivjioulyqq` was not accessed.

## Read-only test-project refresh (2026-10-17)

- Rechecked the active CLI reference and `.env.local` host immediately before each database query; both matched authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history is **38/38** with local and remote versions matching through `20261017001200_safe_legacy_student_import.sql`.
- Linked `supabase db lint --project-ref xabfsqtevwnwtxxkmkvc`: **PASS**, no schema errors. A fresh catalog-only aggregate query found **35/35** public tables RLS-enabled, **53** public policies, **0** unvalidated foreign keys, **0** invalid public indexes, **7** security-invoker views, **0** application SECURITY DEFINER functions executable by `anon`, and **0** application SECURITY DEFINER functions without a fixed `search_path`. It found one Storage bucket and four Storage policies.
- Aggregate-only Platform Admin counts: **1** platform-administrator role row and **1** platform audit event; **0** plans, institute subscriptions, invoices, payment attempts, or central provider connections. No admin identity or business rows were read; account access remains unverified.
- The application/browser-storage source scan still finds direct `localStorage` usage in the explicit legacy preview/import/backup UI. Legacy Brain storage adapters/services remain in the library for compatibility tests and recovery; no browser keys were cleared. The unpaid-student importer does not migrate existing financial history.
- This refresh ran SELECT-only catalog/history checks and linked lint. No migration, SQL write, provider request, payment, message, or production query occurred. Production `cjuneqmohdivjioulyqq` remains untouched.

Production remains **NO-GO**. The exposed test service-role key still needs rotation; provider sandbox and signed-in E2E evidence, full legacy reconciliation, fresh production compatibility assessment, and backup/restore proof remain outstanding.

## Read-only revalidation (2026-10-17)

The authorized test project was rechecked explicitly as `xabfsqtevwnwtxxkmkvc`: local/remote migration versions match **38/38**, and linked database lint passes. The current catalog aggregate shows 35/35 public tables with RLS, 53 policies, zero unvalidated FKs or invalid indexes, seven security-invoker views, and no application SECURITY DEFINER routine callable by `anon` or missing a fixed `search_path`. No production database access or backup/restore rehearsal occurred. This was read-only and adds no migration to the promotion batch.

## Fresh release-gate rerun (2026-10-17)

- Reconfirmed test-only target before database access: CLI ref and `.env.local` host both match `xabfsqtevwnwtxxkmkvc`. Read-only history is **38/38**; linked schema lint reports no errors. This rerun made no test database writes and did not access production.
- Local checks now pass: `npm test` (36 test files plus Brain **88/88**), TypeScript, full ESLint, and production build (65 generated route entries). `npm audit --omit=dev` reports zero production dependency findings; the full dependency audit still reports nine high development/build findings through unpatched `braces@3.0.3`.
- Production promotion remains blocked pending test service-role credential rotation, authenticated browser isolation tests, external sandbox evidence, complete legacy-data reconciliation, a fresh production compatibility assessment, and a verified encrypted backup/restore rehearsal. No production migration is approved or scheduled by this plan.

## Safe legacy-expense import migration (2026-10-17)

- Test target was positively verified before each write: CLI ref `xabfsqtevwnwtxxkmkvc`, `.env.local` host `xabfsqtevwnwtxxkmkvc.supabase.co`. Separate dry runs showed only `20261017001400_safe_legacy_expense_import.sql`, then only `20261017001500_bind_expense_import_fingerprint.sql`; each was applied only to the test project. Read-only migration history now matches **41/41** local versions.
- The migrations add a unique `(expenses.id, expenses.institute_id)` target for a tenant-consistent mapping FK; an RLS-protected `legacy_expense_imports` table and index; and the owner/admin-only verified import RPC. The initial caller-fingerprint RPC is revoked from all client/service roles. The corrected RPC computes SHA-256 itself over normalized values, then atomically creates the expense, mapping, and audit event. It checks institute/branch, date, method, exact amount, and confirmation; exact retries return the same target, while changed normalized fields or branch are rejected. No business rows or browser storage are rewritten.
- Rollback-only SQL regression passed **22/22**; the final test file calls `ROLLBACK`. It verifies old-RPC revocation and server-generated SHA-256 as well as authorization, idempotency, exact amount, and audit. Post-run aggregate queries found no synthetic auth users, institutes, expense records, or mapping rows. Linked test `db lint` passes. Catalog shows 37/37 public tables with RLS, 55 policies, 93 validated/0 unvalidated FKs, 7 security-invoker views, and no invalid public indexes.
- The migration has **not** been reviewed or approved for production. Do not down-migrate or drop the mapping/expense structures after any import. If an implementation defect is found before any production import, disable the RPC with a reviewed forward migration that revokes client execution; preserve all mapped expense history. Production remains NO-GO pending fresh read-only schema comparison, service-role credential rotation, authenticated browser tests, provider sandbox evidence, full legacy reconciliation, encrypted backup/restore rehearsal, and separate explicit production approval.

## Test-only institute profile import migration (2026-10-17)

- Verified `.env.local` host and linked Supabase reference as test project `xabfsqtevwnwtxxkmkvc` before writes. Dry runs showed one pending migration each; applied `20261017001600_safe_legacy_business_profile_import.sql`, then forward correction `20261017001700_fix_legacy_profile_json_validation.sql`. No prior migration was rerun and production was not accessed.
- The profile importer fills blank columns only, preserves existing values and browser keys, excludes logos, and uses an owner/admin-checked transaction RPC with a PostgreSQL-generated fingerprint. The initial remote assertion attempt exposed an unsupported JSON function; it was fixed in the forward migration before final verification. The rollback-only SQL suite passed **19/19**; post-run synthetic fixture counts were zero.
- Management API read-only history reports **43/43** migrations applied. The latest CLI migration-list and `db lint` commands fail before SQL inspection with PostgreSQL login `28P01`; catalog/history reads and the rollback-only SQL suite succeeded, but this refresh does not claim CLI lint passed.
- This migration has **not** been reviewed or approved for production promotion. Production remains **NO-GO** pending fresh read-only compatibility review, service-role rotation, authenticated E2E, provider sandbox verification, full historical reconciliation, and encrypted backup/restore rehearsal.
