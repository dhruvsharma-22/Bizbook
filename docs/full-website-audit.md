# BizBook full website audit

**Audit date:** 2026-10-17 (Asia/Calcutta)
**Verdict:** **BLOCKED / production NO-GO**
**Protected production project:** `cjuneqmohdivjioulyqq` was not connected, queried, or changed.
**Authorized test project:** `xabfsqtevwnwtxxkmkvc`.

## Scope and method

The repository root was confirmed as `C:\Users\Yasvriti\Desktop\bizbook`, on branch `master`. The working tree contains pre-existing user changes; none were reset or discarded. The current non-generated workspace enumeration covers 335 files: `app` (65), `components` (47), `hooks` (1), `lib` (115), `supabase` (77), `docs` (10), `public` (5), `scripts` (2), and root-level files/configuration (13). This includes 34 page files, 28 API route files, and 38 migrations. Generated dependencies and build output were excluded. This is a current source manifest and automated-gate review, not a claim that every asset/dependency or every authenticated browser journey was manually inspected. The latest rerun passed `npm test` (36 local test files plus Brain 88/88), `npx tsc --noEmit`, full ESLint, and `npm run build` (65 route entries).

This was a source and automated-gate audit, not an authenticated browser journey across every screen. No real user account, provider credentials, external sandbox payment, message delivery, or production database was used.

## Platform billing update (2026-10-17)

The final continuation added test-only subscription invoice payment settlement using migration `20261017000900_platform_subscription_payment_settlement.sql`. The migration was applied only to the verified test project; its rollback-only SQL suite passed **35/35**, linked test database lint passed, and read-only Management-API checks confirmed 35 applied versions and the new objects. Subscription checkout and signed Razorpay/Cashfree webhooks are implemented but externally unverified. No real or sandbox provider call was made. After the final checkout-resume fix, TypeScript and targeted ESLint passed and the optimized build generated **64 routes**; `npm test` had passed 32 helper suites and Brain 88/88 before that UI-only fix and was not repeated.

The audit still does not cover an authenticated browser journey for every route or prove production compatibility. Provider sandbox credentials, authenticated tenant/branch E2E, controlled local-data import/reconciliation, current read-only production comparison, platform-admin identity/login verification, and encrypted backup/restore remain open. Production was not accessed; decision remains **BLOCKED / NO-GO**.

## Subscription payment race correction (2026-10-17)

The first rollback-only settlement run found a retry/late-capture race. After forward migration `20261017001000`, an expanded test found that a failed attempt's provider payment ID could block a later successful capture. Forward migration `20261017001100` corrected the canonical captured-reference semantics. Both are applied only to test project `xabfsqtevwnwtxxkmkvc`; the expanded SQL suite now passes **43/43** and rolls back all fixtures. Read-only history confirms **37/37** migrations; synthetic Auth users, subscription attempts, and provider events count zero. The three SECURITY DEFINER settlement RPCs have empty/fixed search paths, no `anon` execute, and service-role execute.

`supabase db lint` after these two migrations could not authenticate its PostgreSQL login role (`28P01`), so that specific post-migration lint gate remains unverified. No whole-catalog refresh, real provider transaction, authenticated browser E2E, or production access was performed. Production remains **NO-GO**.

## Route and workflow inventory

### Screens

| Route | Current behavior and evidence | Status |
|---|---|---|
| `/`, `/_not-found` | Root routes to the workspace; standard not-found handling builds. | PASS |
| `/login`, `/auth/callback`, `/account/update-password`, `/setup` | Supabase Auth actions, PKCE callback, password update, and institute setup RPC are implemented. Provider configuration and signed-in browser journeys were not run. | PARTIAL |
| `/pay` | Public test-only installment checkout reached through a 256-bit bearer token in the URL fragment. It shows the institute, installment sequence, due date, and amount without student/parent contact details. Link expiry/revocation and captured-only verification are database-backed. No provider sandbox transaction or browser E2E was run. | PARTIAL |
| `/dashboard`, `/reports/financial-summary`, `/reports/profit-loss` | Read scoped Supabase financial views and student counts. Summary totals distinguish receipts, completed refunds, payroll, business expenses, outstanding, and overdue. No penalty or BizBook subscription income is invented. | PARTIAL |
| `/reports/revenue-expenses`, `/reports/comparisons`, `/reports/collection-forecast` | Newly implemented scoped queries over canonical security-invoker ledger/balance views. Monthly aggregation uses integer paise; forecast buckets open installment balances by institute-local due date. Helper suite passes 5/5; no authenticated browser journey was run. | PARTIAL |
| `/business` | Redirects to the students/staff workspace. | PASS |
| `/business/students` | Database-backed student and staff records, installment schedule edits, archive, staff CRUD, and history-preserving behavior. Remote student SQL suite passes. | PARTIAL |
| `/business/attendance` | Database-backed attendance with institute time zone, branch guard, idempotent upsert, corrections, and future-date rejection. Remote suites pass. | PARTIAL |
| `/business/branches` | Database-backed branch management and soft deactivation/reactivation. RLS and branch suites pass. | PARTIAL |
| `/business/members` | Institute-wide owners/admins manage existing Auth memberships, role, scope, and active branch grants through existing protected database RPCs. Account creation/invites and an authenticated browser journey remain unavailable. | PARTIAL |
| `/business/salary` | Shared payroll calls the BizBook Brain salary engine, then writes through the atomic database RPC that independently recomputes and de-duplicates the salary record. | PARTIAL |
| `/business/profile` | Institute profile is saved to Supabase; logo upload uses a private institute-scoped bucket. Policies, grants, and test migration were checked. Authenticated browser upload was not run. | PARTIAL |
| `/expenses` | Shared database expense list/create/edit/soft-void with role, branch, date, amount, idempotency, and reason checks. Remote financial suite passes. | PARTIAL |
| `/payments/advance`, `/payments/receipt-records` | Existing receipts and allocations are database-backed; allocations do not create receipts. Manual fee/advance entry uses an idempotent RPC. | PARTIAL |
| `/payments/history`, `/payments/outstanding`, `/payments/overdue` | Real scoped payment/refund rows and canonical installment balances, with filters/pagination and branch scope. | PARTIAL |
| `/payments/refunds` | Manual and test-mode provider refund paths. Manual completion requires confirmation that money was returned; online completion is accepted only after the server verifies the provider response. No sandbox refund was performed. | PARTIAL |
| `/payments/reminders` | Read-only delivery history. It does not send messages. | PARTIAL |
| `/payments/penalties` | Deferred by product decision; the route and navigation entry have been removed. No late-fee ledger or charge exists. | DEFERRED |
| `/settings/integrations` | Institute payment configuration; values remain pending until real test-provider verification. No provider check was made. | PARTIAL |
| `/settings/subscription` | Institute-wide owner/admin view of assigned plan, invoices, and attempts. Test-only invoice checkout can start/resume a Razorpay/Cashfree attempt and settles only after server verification; no provider sandbox charge was run. | PARTIAL |
| `/settings/security` | Auth provider setup guide; it does not verify or mutate Supabase Auth project settings. | PARTIAL |
| `/settings/data-import` | Institute-wide owner/admin-gated preview/backup plus limited confirmed imports of new students with fully unpaid schedules, staff profile/current compensation without history, explicitly reviewed legacy expenses, and recognized institute profile fields into blank columns only. Receipts, advances, refunds, payroll history, attendance, logos, and duplicate reconciliation remain incomplete; no browser key is cleared. | PARTIAL |
| `/platform-admin` | Separate server-authorized console for institute status, platform roles, plans, subscription assignment, open invoices, provider metadata, audit/payment-attempt views, limits, and the new support inbox. Support status, priority, and replies are DB-backed and audited. One test-project platform-admin row exists, but its identity was not inspected and authenticated browser access was not tested. Provider settlement/reconciliation remain unfinished. | PARTIAL, authorization not browser-verified |
| `/support` | Authenticated institute support tickets, replies, statuses, request history, and idempotent submission through server API/database RPCs; no outbound notifications. Remote SQL security/idempotency suite passes 29/29, but signed-in browser workflow was not run. | PARTIAL |

### API routes

| Route group | Current state |
|---|---|
| `/api/payments/create-order`, `/api/payments/verify`, `/api/payments/sync`, `/api/payments/webhook`, `/api/webhooks/cashfree`, `/api/payments/refunds/submit` | Test-project-only order, capture, webhook, status-refresh, and refund workflows. Captured receipts/refunds require server-side provider verification and database finalization. No provider sandbox transaction is verified. |
| `/api/payments/checkout-links`, `/api/payments/checkout-link/resolve`, `/api/payments/checkout-link/verify` | Finance-authorized link issue/revoke and public resolve/verify. The raw token is returned once, stored only as SHA-256, expires after 24 hours, and is revocable. Public resolution omits student/parent PII. SQL and local token/route tests pass. |
| `/api/admin/payment-connections` and `/verify` | Authenticated institute-admin credential configuration and explicit sandbox check. No external check was run; saving credentials alone does not activate a provider. |
| `/api/platform-admin/providers`, `/verify`, `/api/platform-admin/operations` | Server/database-authorized platform provider and operations actions. Provider verification state is not inferred from a save. |
| `/api/support`, `/api/platform-admin/support` | Test-project-only support create/list/reply/status APIs; same-origin mutation guards, database membership/platform role checks, RLS, idempotency, and administrative audit. No email/WhatsApp delivery is wired. |
| `/api/cron/reminders` | Consent-checked, tenant/branch-scoped delivery attempt runner using central credentials. Inactive without verified provider settings and scheduler configuration. No message was sent. |
| `/api/notifications/email`, `/api/notifications/whatsapp` | Preview only; no delivery. |
| `/api/admin/notification-connections` and `/verify` | Retired with `410 Gone`; notification senders are centrally configured. |
| `/api/expenses`, `/api/payroll` | Authenticated, same-origin protected database workflows with server authorization and database transaction checks. |

`/settings/account` now redirects to the existing Supabase-backed `/business/profile` route; it is a compatibility alias, not a separate personal-account preferences screen. Member and branch-assignment management exists at `/business/members`; the target user must already have an Auth UUID because invites/account creation are not implemented.

## Supabase test database

The CLI project reference and `.env.local` URL host were confirmed as `xabfsqtevwnwtxxkmkvc` before each database operation. The original production reference was not used. Earlier 33/33 and 37/37 history entries in this section are historical snapshots; the latest read-only history is **38/38** in unique chronological order through `20261017001200_safe_legacy_student_import.sql`. Linked schema lint passes. No reset or historical migration rewrite was run.

After the migration, read-only catalog checks reported:

- 33 public tables; all 33 have RLS enabled.
- 50 public RLS policies.
- 78 validated public foreign keys; zero unvalidated.
- Seven public views; all seven use `security_invoker`.
- Zero invalid public indexes.
- Zero application `SECURITY DEFINER` functions callable by `anon`; zero without a fixed `search_path`.
- The platform-managed `public.rls_auto_enable()` event-trigger routine retains default platform ACL/effective public execution. It is attached only to DDL event tags; ordinary direct RPC exposure was not established. Its ACL was not changed.

Fresh revalidation on 2026-10-17 reconfirmed migration history **33/33**, schema lint **PASS**, and the same catalog counts. `npm test` passed all **29** local test files plus Brain **88/88**; `npx tsc --noEmit`, full ESLint, and `npm run build` passed (59 routes). `npm audit --omit=dev` reported **0 vulnerabilities**. A scoped source-pattern scan found one `rzp_live_` match in the payment-input rejection test (`rzp_live_example`), not a credential; it found no service-role assignment or JWT-shaped secret. This is not a history-wide secret scan.

The catalog check initially found four application trigger functions inheriting `PUBLIC` execution. The new additive migration revoked anonymous/public access while retaining authenticated/service-role execution for attached triggers. The updated Platform Admin SQL regression suite verifies the ACLs and plan-limit triggers. All migration and SQL test activity targeted the test project only.

## Data and financial integrity

Current business and financial records use Supabase. Direct `localStorage` access in `app/`, `components/`, and `hooks/` is limited to the explicitly requested `/settings/data-import` preview/backup and selected unpaid-student import actions. The import only creates new student records with complete, fully unpaid schedules; it does not import or reconcile payment, refund, payroll, expense, staff, attendance, or profile histories. The former BizBook Brain storage adapter and browser services remain in `lib/bizbook-brain` for isolated compatibility/regression tests, not as the active financial repository. No user's browser values were inspected in this audit; no actual records were imported, merged, or deleted.

Shared payroll now calls `calculateSalary` from BizBook Brain. It rejects fractional-paise amounts, invalid attendance statuses/dates, and duplicate staff/date rows. The SQL salary RPC independently recomputes the result and enforces a unique staff/month record. Student receipts, installment allocation, advance allocation, refunds, online captured receipts, expenses, and summaries are backed by canonical database functions/views. Penalties and platform subscription revenue remain excluded pending approved policy/ledger support.

## Provider and Platform Admin status

- Razorpay and Cashfree test backends exist, including order retry handling, server verification, HMAC checks, webhook idempotency, Cashfree order-status refresh, and a test-only parent link flow. The link stores only a SHA-256 digest and expires after 24 hours. No real provider sandbox credentials or transaction were supplied; operational integration is **not verified**.
- Online refund reservation, provider submission, and status reconciliation code exists in test mode and has rollback-only SQL coverage, but no provider sandbox refund was executed. BizBook subscription invoice checkout, settlement, and reconciliation code also exists in test mode with rollback-only SQL coverage; no provider sandbox payment or authenticated browser journey was run.
- WhatsApp/email central configuration and reminder job architecture exist, but no active provider connection, delivery test, signed delivery webhook, or scheduled delivery is verified.
- The test database has one platform-admin role row and one platform audit event; it has zero plans, subscriptions, invoices, payment attempts, and central provider connections. Only aggregate counts were read. The role owner was not identified. Do not provision or replace an admin based on this audit.
- A test-project service-role secret was previously present in ignored `.env.local`, exposed in tool output, and then removed locally. Rotate/revoke it before configuring a replacement. No production credential was read.

## Verification results

| Check | Result |
|---|---|
| Current `npm test` | **PASS**, 36 local test files plus BizBook Brain **88/88** |
| Built-app route smoke | **PASS**, 33 page routes returned a page response or expected auth redirect; seven protected API requests returned **401** without a session |
| New focused local tests | **PASS**, 18 assertions for bearer-token handling and the exact public-route allowlist |
| Local legacy preview helper | **PASS**, 18 assertions using synthetic in-memory browser storage; no real browser values were read |
| Provider adapter/status tests | **PASS**, 40 payment/refund adapter assertions and 5 Cashfree status-selection assertions |
| BizBook Brain tests | **PASS**, 88/88 |
| Latest rollback-only remote SQL suites | **PASS**, parent-link security 15/15, online-payment accounting 29/29, and online refunds 24/24; each starts a transaction and rolls back |
| Synthetic fixture collision check | **PASS**, no matching rows after suites |
| Test project `supabase db lint --linked` | **PASS**, no schema errors |
| Test project migration history | **PASS**, 38/38 local migrations applied |
| TypeScript | **PASS**, latest workspace rerun |
| Full ESLint | **PASS**, latest workspace rerun, exit 0 |
| Production build | **PASS**, Next.js 16.4.0, 65 generated route entries |
| Operational report helper tests | **PASS**, 5/5 |
| Subscription access/status helper tests | **PASS**, 11/11 |
| Subscription RLS SQL test | **PASS**, 9/9 across two institutes, owners, accountant, and branch-scoped owner |
| Workspace preference RLS SQL test | **PASS**, 13/13 with two temporary authenticated users; transaction rolled back and left zero test users |
| Production dependency audit | **PASS**, `npm audit --omit=dev` reports zero vulnerabilities |
| Full dependency audit | **FAIL**, nine high findings in development/build tooling through `braces@3.0.3`; upstream has not published a patched release. npm's proposed `shadcn@1.0.0` downgrade is breaking and was not applied. |
| Authenticated browser E2E / two real test identities | **NOT RUN**; no supplied signed-in browser session or browser E2E harness was available. SQL suites use transaction-scoped synthetic fixtures/claims instead. |
| Provider sandbox transaction, real email/WhatsApp delivery | **NOT RUN**; no provider credentials were supplied. |
| Production compatibility query, backup restore | **NOT RUN**; production is protected and its existing assessment is historical. |

The high dependency advisory is tracked as a development/build-tooling exception; no vulnerable package is in the production dependency tree. `npm audit fix --dry-run` reported no non-breaking package changes; eliminating the remaining findings would require breaking downgrades, so the development toolchain cannot be described as vulnerability-free yet.

## Release decision

**BLOCKED / production NO-GO.** Test database schema and the latest payment/refund rollback-only suites pass, and local tests, TypeScript, lint, and build pass. Release cannot be approved because authenticated browser isolation/journeys, provider sandbox execution, subscription settlement/reconciliation, legacy import/reconciliation, a current read-only production schema comparison, and verified production backup restoration remain outstanding. No production connection or write was performed.

See [production-readiness-report.md](production-readiness-report.md), [database-promotion-plan.md](database-promotion-plan.md), and [legacy-data-migration.md](legacy-data-migration.md).

### Report routes added after the initial inventory

`/reports/revenue-expenses`, `/reports/comparisons`, and `/reports/collection-forecast` now use the existing branch-scoped security-invoker views. They compute ledger totals in integer paise. Collection forecast buckets open installment balances by institute-local due date, including undated balances separately; it does not claim those balances will be collected. Their helper tests pass 5/5.

### Platform support workflow continuation (2026-10-17)

- Added `/support` for institute ticket submission/history/replies and a protected support inbox inside `/platform-admin`. Server routes use authenticated Supabase sessions, reject non-test project URLs, validate same-origin mutations, and call database RPCs. RLS and RPC authorization limit institute views to permitted memberships and global queue/status changes to platform administrators.
- Test-only migrations `20261017000200_platform_support_workflows.sql` and `20261017000300_correct_support_ticket_rate_limit.sql` add ticket/message tables, constraints, indexes, RLS, idempotent create/reply, a concurrency-safe daily limit, status/priority tracking, and audit events. The second migration corrected the 10-open-request boundary without editing the already-applied migration.
- Support SQL regression suite: **29/29 PASS** using synthetic identities in one rollback transaction. It covers grants, RLS, wrong-institute denial, ticket/reply idempotency, the 10-ticket limit, closed-ticket behavior, platform role checks, status changes, and audit rows. Post-run aggregate checks found zero synthetic users, institutes, tickets, or messages.
- Read-only test catalog refresh: **32/32 public tables have RLS, 50 policies, 76 validated FKs, 7 security-invoker views, 0 invalid indexes, 0 application definer functions callable by anon, 0 application definer functions missing a fixed search path**. Migration history shows **29/29** applied; test-project database lint passes.
- Final local checks: **23/23 helper/CSV suites (195 checks), Brain 88/88, TypeScript, full ESLint, and production build PASS**; build generates **51 routes**. No authenticated browser E2E was run for support. The workflow does not send email/WhatsApp and has no attachment/SLA automation.
- Production `cjuneqmohdivjioulyqq` remains untouched. Production backup restoration, current production compatibility, provider sandbox operations, subscription settlement, online refunds, and legacy-data reconciliation remain unverified/incomplete. **Production remains NO-GO.**

### Subscription visibility and final revalidation (2026-10-17)

- Added `/settings/subscription` to show only database-backed plan, subscription, invoice, and payment-attempt records. Institute-wide owners and administrators are allowed by the UI gate and existing database RLS; accountants and branch-scoped members receive a permission state. Provider IDs and credential references are not displayed. The page explicitly reports that subscription checkout/settlement is unavailable and never infers a plan when no row exists.
- No database migration was needed. Test project reference and `.env.local` host were rechecked as `xabfsqtevwnwtxxkmkvc`; migration history remains **29/29** and `supabase db lint --linked --project-ref xabfsqtevwnwtxxkmkvc` passes.
- All nine existing rollback-only SQL suites were rerun on the current test schema and passed (**219/219**). Added and ran `platform_subscription_visibility_remote.test.sql` (**9/9**) to prove two-institute isolation for subscription, invoice, and payment-attempt reads, available-plan visibility, and denial to accountants and branch-scoped owners. Every suite begins with `BEGIN` and ends with `ROLLBACK`; total is **228/228**.
- Final local regression after the new route: **24/24 helper/CSV suites, 206 checks PASS**; Brain **88/88 PASS**; TypeScript and full ESLint **PASS**; production build **PASS**, generating **52 routes**. The new subscription access/status helper suite passes **11/11**.
- A reusable read-only catalog summary (`schema_catalog_summary_readonly.sql`) was run against the same test project: **32/32** public tables have RLS; 50 public policies; 76 validated and zero unvalidated foreign keys; seven security-invoker views; zero invalid indexes; zero application SECURITY DEFINER functions callable by `anon` or missing a fixed search path; one private institute-logo bucket, zero public buckets, and four Storage policies. Aggregate counts for the new synthetic subscription test fixtures are all zero after rollback.
- No authenticated browser session, real provider sandbox transaction, payment, or message delivery was available. Production remains unqueried and unchanged; backups/restores are unproven, so **production remains NO-GO**.

### Institute member permissions (2026-10-17)

- Added `/business/members` and a sidebar entry. Institute-wide owners/admins can add an existing Auth UUID, adjust allowed role/scope, assign active branches, reactivate, or deactivate membership. All writes call the existing `grant_institute_membership`, `set_membership_branch_access`, and `deactivate_institute_membership` functions; no membership-table DML or schema migration was added.
- Database functions remain authoritative for role escalation, self-change, branch membership, ownership, and last-owner protection. The screen does not create Auth users, send invitations, or reveal profile/contact details. Role/scope changes that clear old branch assignments require confirmation; multi-RPC partial assignment failures are reported and reloaded from the database.
- The open edit dialog uses the shared workspace blocker so changing institute/branch scope cannot retarget an unsaved permission edit.
- Member helper tests pass **17/17**. The complete local helper/CSV suite is **25 suites / 223 checks**; TypeScript, full ESLint, and the final build pass, with 53 routes generated.
- Added and ran `member_management_remote.test.sql`: **13/13 PASS** in a transaction ending with `ROLLBACK`. It verifies the exact membership/grant/deactivation RPCs used by the screen. A post-run aggregate query found zero synthetic Auth users.
- Test migration history remains **29/29**; no schema change was needed. The screen has no signed-in browser E2E verification. Production was not accessed.

### Finance-staff sandbox installment checkout (2026-10-17)

- Added checkout controls to the shared receipt screen. An owner, administrator, or accountant selects an active student and an outstanding fee installment; the existing authenticated create-order endpoint reserves the installment balance and checks amount/branch in the database. The screen does not accept an arbitrary checkout amount.
- Razorpay uses its documented test checkout, then submits the response to the existing server route for signature verification and provider-side status fetch. Cashfree uses its sandbox JS SDK; its completion callback triggers a server-side order-payment query. A Cashfree return or browser callback is not treated as payment confirmation. Only the trusted financial RPC may post a captured receipt.
- Added `/api/payments/sync` for finance-authorized Cashfree status refresh. Multiple successful attempts for one order require manual reconciliation. Pending results remain pending, and status retries reuse the existing order rather than silently creating another.
- No migration was required or applied. Provider adapter mocks pass **23/23**, Cashfree order-result selection **5/5**, all local helper/CSV tests **26 files / 233 checks**, Brain **88/88**, TypeScript, full ESLint, and build **54 routes**.
- No provider credentials or transaction were available, so no actual provider API was called and checkout was not browser-tested. This is staff-initiated sandbox checkout, not a public student/parent payment page. Provider-verified refunds and platform subscription checkout are still absent.
- Test ref and `.env.local` host were checked as `xabfsqtevwnwtxxkmkvc`; an additional linked migration-history command did not return a result, so current remote migration history was not reverified in this continuation. The previously verified 29/29 test-project migrations are not represented as a new check here. Production was not accessed.

**Current release decision remains BLOCKED / production NO-GO.** Provider credentials and sandbox proof, authenticated browser journeys, refund/subscription settlement, legacy-data reconciliation, current production comparison, and backup restore remain outstanding.

### Parent checkout links and payment capture reconciliation (2026-10-17)

- Added `/pay` as a public, test-only parent installment checkout. Finance staff create a link from the selected installment; the browser receives a random 256-bit token once and copies a URL-fragment link. The database stores only SHA-256, sets a 24-hour expiry, supports revocation, audits issue/revoke, and exposes resolution only through the service-role RPC. Public resolution does not return student or parent contact data.
- Added migrations `20261017000400_expiring_parent_payment_links.sql` and `20261017000500_restore_payment_terminal_event_guard.sql`. The first payment SQL rerun exposed two regressions in stale terminal events; the forward corrective migration restored that guard. The final rollback-only suites passed **15/15** checkout-link assertions and **27/27** online-payment assertions. They verify role/RLS boundaries, link expiry/revocation, PII omission, idempotency, second-capture reconciliation, and stale events.
- Revalidated test reference and `.env.local` host as `xabfsqtevwnwtxxkmkvc`; read-only history reports **31/31** applied. Database lint passes. The current catalog summary reports **33/33** public tables RLS-enabled, 50 policies, 78 validated FKs, seven security-invoker views, no invalid indexes, and no application SECURITY DEFINER functions executable by `anon` or missing a fixed search path. Rollback suites left zero synthetic checkout/payment fixtures.
- Token/public-route unit tests pass **18/18**; provider adapter **23/23** and Cashfree state selector **5/5** pass. TypeScript, full ESLint, and production build pass. No payment-provider API was called; there are no provider sandbox credentials and no authenticated browser E2E was available.
- The newly implemented parent link is not operationally verified until a signed-in finance user and actual provider sandbox credentials exercise it. Production compatibility, production backup/restore, online refunds, platform subscription settlement, and legacy-data import remain unverified or incomplete. Production stayed untouched; **NO-GO**.

## Payment webhook payload correction and final audit pass (2026-10-17)

- This continuation supersedes earlier lines that described provider-backed online refunds as absent: the test-only refund reservation/submit/status path exists under `/payments/refunds` and `/api/payments/refunds/submit`, with migration 32/32 and 24 rollback-only SQL assertions recorded in the readiness/integration reports. It remains externally unverified because no provider credentials or sandbox refund were available.
- Final source review found the Razorpay webhook handler was reading `data.payment`; Razorpay's documented payment webhook envelope is `payload.payment.entity`. This made valid Razorpay events fail before signature validation. Added a provider-specific normalizer and fixtures for captured and failed Razorpay events, Cashfree payment events, and malformed envelopes. Raw request bodies are still used for signature verification, and capture still requires a server-side provider status fetch before a receipt is posted. See [Razorpay payment webhook samples](https://razorpay.com/docs/webhooks/payments).
- Expanded the rollback-only online-payment SQL suite for the documented sequence where a Razorpay `payment.failed` webhook can be followed by a late `payment.captured` webhook. The current database function permits only the provider-confirmed captured event to post; stale pending events remain ignored. Test project `xabfsqtevwnwtxxkmkvc` passed **29/29** assertions and post-run counts for synthetic orders, provider payments, and webhook events were **0**.
- Reverified the test CLI reference and `.env.local` host, then read-only migration history showed **32/32** applied. Linked database lint passed. The read-only catalog summary reported **33/33** public tables with RLS, 50 policies, 78 validated foreign keys, 7 security-invoker views, 0 invalid indexes, 0 application definer routines callable by `anon` or missing a fixed search path, and one private storage bucket with four policies.
- All **29** `lib/**/*.test.ts` files passed, BizBook Brain **88/88**, TypeScript, full ESLint, and production build **59 routes**. `git diff --check` exited successfully; Git emitted line-ending normalization notices only.
- Fresh dependency audit: `npm audit --omit=dev` reports **0 production dependency vulnerabilities**. Full `npm audit` still reports **9 high development/build-tool findings** through `braces` in the shadcn/fast-glob and ESLint toolchain; the suggested forced fix downgrades shadcn across a breaking version boundary and was not applied.
- A limited source-pattern secret scan found only the deliberate `rzp_live_` invalid-input test fixture; no credential value was printed. This is a targeted pattern check, not a substitute for repository-history secret scanning.
- No new migration was needed. No provider sandbox request, real payment/refund/message, authenticated browser E2E, or production query/write was run. Existing localStorage adapter modules remain preserved for legacy recovery, and controlled import/reconciliation is still unimplemented. Production compatibility is historical and backup/restore has not been demonstrated; **production remains NO-GO**.
- Added the cross-platform `npm test` runner. It executes all **29** `lib/**/*.test.ts` files and the Brain suite in sequence. The final `npm test`, TypeScript, full ESLint, and production build all passed after this change; the build enumerated 59 routes.

## Local legacy-data preview continuation (2026-10-17)

- Added `/settings/data-import` as an explicit institute-wide owner/admin-only local review path. It scans the 11 recognized legacy keys only on user action and presents sanitized counts/amount/date/duplicate/status-claim metadata. It never sends raw records to the server or mutates browser storage.
- Added an explicit local JSON backup download with source-size limits and a clear note that the values have no verified institute or branch mapping. The file contains sensitive raw legacy values, so this is a recovery export and is not an import.
- New preview helper suite passes **18/18** assertions on synthetic in-memory storage. Full `npm test`: **30 test files PASS** plus Brain **88/88**. TypeScript and full ESLint pass; optimized production build passes with **60 routes**. Git whitespace checks are recorded after documentation edits.
- No user's browser keys were read during this audit. No migration, database write/query, import, provider call, payment, message, or production access was part of this continuation. Import mapping, atomic database commit, duplicate resolution, and reconciliation remain incomplete; production remains **NO-GO**.

## Platform-admin role privacy correction (2026-10-17)

- Source review found that support-role administrators could reach institute, billing, provider, and audit metadata through a broad overview RPC and direct table RLS policies, even though the UI hid those sections. The operations and provider APIs and page now enforce the support-only scope; the database returns an empty overview for support and limits operational-table RLS to platform owners/operators. Global delivery-log metadata is also restricted to owners/operators while institute-manager tenant access remains intact.
- Added `20261017000800_isolate_platform_support_data.sql` and `platform_admin_role_privacy_remote.test.sql`. Verified the exact test project ref and `.env.local` host before the write. Dry-run showed one migration; only that additive migration was applied to test project `xabfsqtevwnwtxxkmkvc`. Production was not connected.
- Remote rollback-only tests after the migration: role privacy **22/22**, platform-admin operations **28/28**, and support workflows **29/29**. The role-privacy suite explicitly set the database role to `authenticated` and checked both safe RPC output and direct RLS table reads. All three scripts end in `ROLLBACK`.
- The read-only test ledger contains **34** versions through `20261017000800`, matching the 34 unique local migration prefixes. The post-migration catalog reports **33/33** public tables with RLS, 50 policies, 78 validated and zero unvalidated foreign keys, seven security-invoker views, zero invalid indexes, and zero application definer functions executable by `anon` or missing a fixed search path.
- Fresh local gates: `npm test` **30 test files PASS** plus Brain **88/88**; TypeScript **PASS**; full ESLint **PASS**; production build **PASS**, 60 routes. `git diff --check` passed; Git emitted line-ending normalization notices only.
- Post-migration `supabase migration list` and `supabase db lint` could not open the direct PostgreSQL connection (`cli_login_postgres`, SQLSTATE `28P01`). The Management-API migration-ledger/catalog queries and remote SQL tests succeeded. A current linked-schema lint result after this migration is therefore **NOT VERIFIED**.

**Release remains BLOCKED / production NO-GO.** No authenticated browser E2E, provider sandbox payment/refund/message, production schema comparison, or verified production backup/restore has been demonstrated. Legacy browser records have not been imported or reconciled, and subscription settlement/reconciliation is not implemented.

### Protected-route configuration fail-closed correction (2026-10-17)

- Removed the development-only bypass that allowed protected routes through when Supabase public configuration was missing. Public sign-in/callback and checkout-link routes remain reachable to explain or resolve their public flows; protected routes now return HTTP 503 until Supabase is configured, in every environment.
- Extracted the auth-gate decision into `lib/supabase/auth-gate.ts` and added seven policy assertions covering public routes, protected pages/APIs, and configured session checks.
- Verification after the correction: `npm test` **31 local test files PASS** plus Brain **88/88**; TypeScript **PASS**; full ESLint **PASS**; optimized production build **PASS**, 60 routes; `git diff --check` **PASS** (line-ending normalization notices only).
- A fresh active-source search found no business `localStorage` writes or clears; the only app-side browser-storage access is the explicit local legacy preview/backup screen. Legacy adapter code and tests remain for data recovery, and old user keys are not removed without import/reconciliation.
- Fresh `npm audit --omit=dev`: **0 vulnerabilities**. Full `npm audit` still reports **9 high development/build-tool findings** through `braces`; npm's forced fix downgrades shadcn across a breaking version boundary and was not applied.
- No database or provider operation was run. The test project's latest previously recorded schema/catalog and rollback-only suites remain as documented above; direct linked PostgreSQL lint is still not verified after migration 34. Production remained untouched.

**Decision remains BLOCKED / production NO-GO.** Authenticated browser journeys, real provider sandbox evidence, subscription settlement/reconciliation, controlled legacy import/reconciliation, current production compatibility, and backup/restore proof remain outstanding.

### Test database read-only revalidation (2026-10-17)

- Before database commands, verified the CLI reference and `.env.local` host both identify test project `xabfsqtevwnwtxxkmkvc`. Read-only `supabase migration list` now succeeds and confirms **34/34** local migration versions applied through `20261017000800`.
- `supabase db lint --linked`: **PASS**, no schema errors. The existing count-only catalog query freshly reports 33/33 public tables with RLS, 50 public policies, 78 validated and zero unvalidated foreign keys, seven public views (all security-invoker), zero invalid indexes, zero application definer functions callable by `anon` or missing a fixed search path, and one private logo bucket with four policies. Prior rollback-test fixture residual counts remain zero.
- This revalidation ran read-only migration/catalog/lint commands only; no migration or SQL write was run. It supersedes the previous `28P01` linked-lint blocker. Production remains unqueried and untouched.
- The same continuation's local gates remain green: 31 test files plus Brain **88/88**, TypeScript, full ESLint, and optimized build (**60 routes**). Full dependency audit still has nine high development/build-tool findings; production dependencies report zero.
- Built-app smoke on localhost returned **200** for `/login` and `/pay`; unauthenticated `/dashboard` and `/platform-admin` returned **307** to `/login` with the requested `next` path. This verifies only public-route serving and the unauthenticated Proxy redirect, not a signed-in browser journey.

**Release remains BLOCKED / production NO-GO.** Passing test-project catalog and lint checks do not resolve authenticated browser E2E, provider sandbox proof, subscription settlement/reconciliation, legacy import/reconciliation, current production comparison, or backup/restore rehearsal.

## Current source and database recheck (2026-10-17)

- Repository recheck: 327 non-generated files across the application, tests, Supabase, documentation, assets, and root configuration; branch `master`; 191 pre-existing changed/untracked paths preserved. Generated dependency internals were excluded from the source inventory.
- Reviewed all migration filenames and scanned migration SQL for destructive DDL/DML patterns: **37** migration files, unique chronological versions, no zero-byte files, no table/schema/column drops or truncations. Detected deletes are inside scoped branch-access/admin operations; policy drops replace access policies.
- Verified the exact test ref and URL host before remote reads. The read-only test ledger reports 37 migrations through `20261017001100`; catalog counts are 34/34 public tables RLS-enabled, 52 policies, 81 validated FKs and zero unvalidated, seven security-invoker views, no invalid indexes, no application definer routines callable by `anon` or missing fixed search paths, one private logo bucket and four Storage policies.
- Current aggregate platform counts show one admin-role row and zero plans, subscriptions, invoices, payment attempts, provider connections, and provider payment events. Counts do not identify the admin or prove login access.
- Active-source browser-storage scan found no business-data writes or clears. Reads are confined to the explicit local preview/export screen; retained adapter code is not called by current screens. No legacy record has been imported, mapped, or reconciled.
- This was a read-only recheck. The current post-migration linked PostgreSQL lint is not verified because `cli_login_postgres` returned SQLSTATE `28P01`; read-only Management-API ledger/catalog queries succeeded. Production remains untouched.

**Production release remains NO-GO** until the documented external, authenticated-E2E, import/reconciliation, production-compatibility, backup/restore, and linked-lint gates are closed.

## Reviewed legacy expense import and verification (2026-10-17)

- `/settings/data-import` now locally previews `bizbook-other-expenses-v1` after the owner/admin explicitly scans. It displays each eligible row's title, category, exact-paise amount, expense date, method, and notes. Ambiguous status, source branch/institute, non-INR currency, unknown fields, invalid precision/date, repeated IDs, and malformed rows are held for review. Each import requires an explicit target branch or institute-wide choice and confirmation that it is a real cost not already posted.
- Added `20261017001400_safe_legacy_expense_import.sql`, then caught and corrected a caller-supplied fingerprint issue before any real import. Forward migration `20261017001500_bind_expense_import_fingerprint.sql` revokes every client role from the original RPC and adds `import_legacy_expense_record_verified`; Postgres now computes SHA-256 over the normalized tenant, branch, source identity, amount, date, method, and text fields. The new RPC atomically writes the expense, immutable mapping, and audit event, and rejects retries if any normalized field or destination changes. Raw browser payloads are not stored; source localStorage keys remain unchanged.
- Verified CLI ref and `.env.local` host as test project `xabfsqtevwnwtxxkmkvc`; each dry run listed exactly one new migration before applying it only to test. Migration history now matches **41/41** local versions. Linked `db lint` passes. Final rollback-only SQL regression suite passed **22/22**, including the server-generated fingerprint and old-RPC revocation; post-run synthetic fixture counts are all zero. Catalog aggregate: **37/37** public tables RLS-enabled, **55** public policies, **93** validated and **0** unvalidated FKs, seven security-invoker views, zero invalid indexes, zero application definer routines callable by `anon` or without fixed search paths, one private Storage bucket and four Storage policies.
- Local `npm test`: **38 test files PASS** plus BizBook Brain **88/88**; `npx tsc --noEmit`: **PASS**; full ESLint: **PASS** (exit 0); `npm run build`: **PASS** (65 route entries). Focused expense import review test, TypeScript, and ESLint also pass.
- `npm audit --audit-level=high`: **FAIL**, nine high development/build-tree findings through `braces@3.0.3`; the available forced npm fix downgrades shadcn across a breaking version. Production-only audit remains zero findings. No dependency changes were made.
- No real browser records, external provider, payment, email, or WhatsApp action was used. Production project `cjuneqmohdivjioulyqq` was not connected, queried, or changed. Receipts, advances, payment history, refunds, payroll history, attendance, and profile/logo still lack complete import/reconciliation. Authenticated browser journeys, provider sandbox, fresh production diff, service-role credential rotation, and backup/restore rehearsal remain open.

**Production remains NO-GO.**

## Financial amount precision repair (2026-10-17)

- Source review found student fee and installment forms rounding sub-paise values before persistence; the staff editor also rounded compensation values, and the payroll endpoint converted request strings through floating point.
- Added a shared exact decimal-string-to-paise parser with the `numeric(12,2)` bound. Student admission/course fees, manual installment schedules, installment rescheduling, staff salaries/deductions/manual payable values, and the payroll API now reject unsupported precision before saving. The Brain's shared `toPaise` conversion now rejects sub-paise values while allowing floating-point representation noise around exact cents.
- Regression coverage: amount/parser cases **18/18 PASS**; all local suites **33 test files PASS**, BizBook Brain **88/88 PASS**, TypeScript **PASS**, full ESLint **PASS**, optimized production build **PASS** (64 routes).
- No database migration was needed and no database write/provider request/production access occurred in this code correction. Remote SQL suites remain the previously recorded evidence, not rerun evidence.

This repair improves financial input correctness; it does not close the independent release blockers. **Production remains NO-GO.**

## Current post-migration test-project verification (2026-10-17)

- Verified the CLI link and `.env.local` URL host against test ref `xabfsqtevwnwtxxkmkvc`. The read-only migration ledger reports **37/37** versions through `20261017001100`.
- Linked test-project database lint now **PASS** with no schema errors. This supersedes earlier `cli_login_postgres` SQLSTATE `28P01` entries.
- Read-only catalog: 34/34 public tables RLS-enabled, 52 public policies, 81 validated and zero unvalidated foreign keys, seven `security_invoker` views, zero invalid indexes, and zero application definer routines callable by `anon` or lacking fixed search paths; one private logo bucket and four Storage policies.
- No remote write, migration, provider call, or production query occurred. This does not provide authenticated browser E2E, provider sandbox evidence, production compatibility, backup/restore, or legacy reconciliation.

**Production remains NO-GO.**

## Dependency security check (2026-10-17)

- Production dependency audit: `npm audit --omit=dev --audit-level=high` **PASS**, zero findings.
- Full development dependency audit: **FAIL**, nine high findings in the shadcn/ESLint build-tool dependency tree, rooted in transitive `braces`. The latest `npm audit fix --dry-run` reports zero package changes; npm's suggested fixes for most findings cross breaking downgrade/major boundaries, while the GitHub advisory and current npm package listing show no patched `braces` release ([GitHub Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [npm braces package](https://www.npmjs.com/package/braces)). No forced update was made.
- Keep this as an open build-tooling security item and retry the dependency audit after upstream publishes a compatible fix.

## Account route compatibility repair (2026-10-17)

Added `/settings/account` as a server redirect to the existing Supabase-backed `/business/profile` route. Targeted ESLint and TypeScript pass; the production build passes and enumerates the new route. This is an alias to institute profile, not a distinct personal-account settings module. No database/provider call was made and no test suite was repeated because business/database logic did not change.

## Static route-integrity check (2026-10-17)

Added an automated route-reference test for literal internal links, redirects, router navigations, and API fetch paths. It passed five matcher assertions and scanned 62 Next route files with zero missing static destinations. Runtime-composed URLs and authenticated page behavior are outside this check.

## Financial reporting correction and final local gates (2026-10-17)

Static source review found dashboard summary aggregation using floating-point rupees and treating any negative amount as positive regardless of its ledger direction. Replaced it with strict signed decimal-to-paise parsing, safe integer aggregation, invalid-row counts and visible warnings on dashboard, financial summary, and profit/loss pages. Profit/loss now adds and subtracts integer paise through the shared BizBook Brain converter. Also corrected subscription page text that incorrectly claimed sandbox checkout was unavailable.

Verification after the correction: the complete local test runner passes 34 helper/CSV/routing files plus Brain 88/88; TypeScript passes; full ESLint passes with exit 0; production build passes with 65 route entries. New assertions cover repeated decimal sums, fractional-paise rejection, sign/direction mismatch, and exact profit/loss totals. No SQL or provider operation was run because this change does not alter database behavior. Previously recorded remote test-project results remain separate evidence and were not rerun in this phase. Production was not accessed; release remains NO-GO.

## Final test-project catalog refresh (2026-10-17)

- Before linked reads, verified the CLI reference and `.env.local` host both identify test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history reports **37/37** local versions applied through `20261017001100`.
- Refreshed the read-only catalog: **34/34** public tables have RLS, **52** public policies, **81** validated and **0** unvalidated FKs, **7/7** public views use `security_invoker`, **0** invalid indexes, **0** application `SECURITY DEFINER` routines callable by `anon` or missing a fixed `search_path`, one private institute-logo bucket, and four Storage policies. Named rollback-fixture residuals remain zero.
- Linked test-project `db lint` **PASS**, no schema errors. Earlier `cli_login_postgres` SQLSTATE `28P01` is superseded.
- This was read-only. No migration, SQL write, external provider call, payment/message, or production connection occurred. The provider sandbox, authenticated browser journeys, production compatibility review, controlled legacy-data reconciliation, and encrypted backup/restore remain open; production is **NO-GO**.
- A final financial-validator follow-up replaced round-after-validation logic in manual receipt and expense helpers with exact decimal-to-paise parsing, including validation of the selected installment balance. Final local verification passes all **34** test files plus Brain **88/88**, TypeScript, full ESLint, and the 65-route production build; the new manual-receipt and expense suites pass **10** and **9/9** assertions respectively. No schema change or remote write was needed.

## BizBook Brain report integration correction (2026-10-17)

Moved the tested canonical dashboard aggregation and profit/loss formulas into `lib/bizbook-brain/financial-summary-engine.ts`. Supabase reporting now re-exports the Brain functions and keeps only currency formatting in its adapter. The engine validates category/direction agreement, signed amounts, exact paise, integer overflow, and open installment balances. Regression results: dashboard summary **8/8**, profit/loss **8/8**, all local tests **34 files PASS** plus Brain **88/88**, TypeScript **PASS**, full ESLint **PASS**, production build **PASS** (65 routes). No database migration/write or provider call was needed. Production remains **NO-GO**.

## Browser persistence API removal (2026-10-17)

Removed the unreferenced browser-storage refresh hook and removed legacy localStorage storage/service modules from the application-facing Brain barrel. The old modules remain directly available to the isolated Brain regression tests; stored browser keys are not deleted. Active application browser-storage access remains limited to the user-triggered local legacy preview/backup. Added a 25-assertion barrel test to prevent those persistence APIs from being re-exported. Full suite passes **35 local files** plus Brain **88/88**, TypeScript, full ESLint, and production build (**65 routes**). Import/reconciliation is still unimplemented; production remains **NO-GO**.

## Final audit status (2026-10-17)

- Repository local checks: `npm test` **PASS** (36 local test files and Brain **88/88**), TypeScript **PASS**, full ESLint **PASS**, production build **PASS** (65 route entries), production-dependency audit **PASS** with zero findings.
- Test database: verified target `xabfsqtevwnwtxxkmkvc`; migration history **38/38** through `20261017001200`; linked database lint passes. The new student-import migration's remote transaction suite passed **16/16** and rolled back. Catalog checks found all 35 public tables RLS-enabled, 53 policies, 85 validated FKs, seven security-invoker views, and no invalid indexes.
- Active UI localStorage reads are only in the explicit local backup/preview and student-import screen. The importer covers new students with fully unpaid schedules only. It does not migrate/reconcile existing receipts, advances, refunds, payroll, expenses, staff, attendance, profile, or transaction history; no real browser data was imported or cleared.
- An earlier environment inspection exposed the **test** Supabase service-role credential in assistant tool output. Treat it as compromised and rotate/revoke it in the test project, then replace it only in the server-side secret manager. It was not used after discovery; no production credential was read. No secret value is reproduced here.
- After removing that setting locally, a built-app smoke on loopback returned `/login` 200, protected business and platform-admin pages 307 to login, and four unauthenticated API requests 401. This proves unauthenticated boundaries only; authenticated business journeys and viewport/browser testing remain unverified.
- No provider sandbox payment/message, authenticated browser E2E, fresh production comparison, or backup/restore drill was performed. Production was not queried or modified.
- Fresh `npm audit --audit-level=high` reports nine high findings in the development/build dependency tree, including `braces` [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). The advisory currently lists no patched version; npm's forced fix would introduce a breaking dependency change. `npm audit --omit=dev --audit-level=high` reports zero production dependency findings. No forced update was made.

**Final recommendation: production NO-GO.** Rotation, authenticated access checks, provider sandbox evidence, category-complete legacy reconciliation, a fresh read-only production compatibility review, and verified encrypted backup/restore are outstanding.

## Razorpay uncertain-create recovery (2026-10-17)

The previous payment audit noted that Razorpay's non-idempotent order-create timeout could leave an intent reserved without a saved provider reference. This is now handled by looking up Razorpay orders with BizBook's unique `receipt`, validating provider order ID, BizBook note, exact INR paise amount, and order state, then binding the original order. If no unambiguous provider order exists, the application leaves the intent reserved and does not create another order. Initial Razorpay create responses must echo the same receipt/metadata; Cashfree order readback verifies deterministic ID, INR currency, and amount. Existing orders are read back before checkout; provider-paid orders can be reconciled via server-fetched order payments and the existing idempotent database finalizer. Parent checkout status checks are token-scoped. Multiple captures go to reconciliation.

The Razorpay/Cashfree adapter suite passes **52** mocked assertions. Full local tests pass (36 test files plus Brain **88/88**), TypeScript, full lint, and production build pass (**65 route entries**). No actual provider call, database write/migration, remote SQL assertion, or production access occurred. Production remains **NO-GO**; see the readiness report for outstanding external, authenticated E2E, credential-rotation, production-compatibility, and backup/restore gates.

## Read-only test-project refresh (2026-10-17)

- Rechecked the active CLI reference and `.env.local` host immediately before each database query; both matched authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history is **38/38** with local and remote versions matching through `20261017001200_safe_legacy_student_import.sql`.
- Linked `supabase db lint --project-ref xabfsqtevwnwtxxkmkvc`: **PASS**, no schema errors. A fresh catalog-only aggregate query found **35/35** public tables RLS-enabled, **53** public policies, **0** unvalidated foreign keys, **0** invalid public indexes, **7** security-invoker views, **0** application SECURITY DEFINER functions executable by `anon`, and **0** application SECURITY DEFINER functions without a fixed `search_path`. It found one Storage bucket and four Storage policies.
- Aggregate-only Platform Admin counts: **1** platform-administrator role row and **1** platform audit event; **0** plans, institute subscriptions, invoices, payment attempts, or central provider connections. No admin identity or business rows were read; account access remains unverified.
- The application/browser-storage source scan still finds direct `localStorage` usage in the explicit legacy preview/import/backup UI. Legacy Brain storage adapters/services remain in the library for compatibility tests and recovery; no browser keys were cleared. The unpaid-student importer does not migrate existing financial history.
- This refresh ran SELECT-only catalog/history checks and linked lint. No migration, SQL write, provider request, payment, message, or production query occurred. Production `cjuneqmohdivjioulyqq` remains untouched.

Production remains **NO-GO**. The exposed test service-role key still needs rotation; provider sandbox and signed-in E2E evidence, full legacy reconciliation, fresh production compatibility assessment, and backup/restore proof remain outstanding.

The fresh local gate rerun in this audit passed all **36** local test files plus Brain **88/88**, TypeScript, full ESLint, and the production build. `npm audit --omit=dev` is clean; the full development/build audit still fails on nine high findings through `braces@3.0.3`, which has no patched release listed by the upstream advisory. A value-free check confirmed that `SUPABASE_SERVICE_ROLE_KEY` is absent from both `.env.local` and the current process environment; server-role-dependent workflows remain unavailable until the compromised test credential is rotated and safely replaced. No schema or external-provider writes were made during that rerun.

## Safe staff profile import and latest gates (2026-10-17)

- `/settings/data-import` now includes a reviewed staff profile/current compensation import. It blocks profiles with attendance or payroll history, shows imported compensation settings for review, requires branch selection and explicit profile-only confirmation, and leaves source keys unchanged.
- Applied only the additive `20261017001300_safe_legacy_staff_import.sql` migration to the preflight-verified test project. History is **39/39**. The remote transaction suite passed **17/17** and rolled back all synthetic fixtures. Read-only catalog counts: **36/36** public tables RLS-enabled, **54** policies, **89** validated/**0** unvalidated FKs, **7** security-invoker views, **0** invalid indexes, and no application definer functions callable by `anon` or missing fixed search paths. Linked database lint passes.
- Final local gates after implementation: `npm test` **PASS** (37 local files plus Brain **88/88**), TypeScript **PASS**, full ESLint **PASS**, and `npm run build` **PASS** (65 routes). No real browser records were examined or imported.
- Production remains **NO-GO**: external sandbox evidence, authenticated browser journeys, test service-role credential rotation, complete legacy/financial reconciliation, current production compatibility review, and encrypted backup/restore proof remain outstanding. Production project `cjuneqmohdivjioulyqq` was not queried or modified.

## Institute profile import and current test results (2026-10-17)

- Added a controlled institute-profile import to `/settings/data-import`: only recognized fields are eligible, destination columns must be blank, existing values are skipped, unknown/invalid fields are held, and logos are excluded. The owner/admin confirms the target; SQL independently enforces institute-wide owner/admin authority, atomic idempotency, and a PostgreSQL-generated fingerprint. Audit metadata contains field names only; raw browser data and source keys are not written or cleared.
- Applied `20261017001600_safe_legacy_business_profile_import.sql` and forward correction `20261017001700_fix_legacy_profile_json_validation.sql` only to the authorized test project after verifying its reference. The corrected rollback-only remote SQL suite passed **19/19** and left zero synthetic users, institutes, or import mappings.
- Read-only Management API history reports **43/43** migrations applied. Catalog aggregates: 38/38 public tables with RLS, 56 policies, 95 validated/zero unvalidated FKs, seven security-invoker views, zero invalid indexes, and no unsafe application `SECURITY DEFINER` routines. Supabase CLI migration-list and `db lint` fail before database inspection with PostgreSQL login `28P01`; these command failures do not invalidate the successful Management API reads or SQL suite, but linked lint is not claimed for this refresh.
- Local gates passed: `npm test` (39 files plus Brain 88/88), TypeScript, full lint, and production build (65 route entries). No actual browser records were read/imported and production `cjuneqmohdivjioulyqq` was not accessed.
- This does not establish complete legacy financial reconciliation, authenticated browser E2E, provider sandbox behavior, service-role credential rotation, production compatibility, or backup/restore. **Production remains NO-GO.**
