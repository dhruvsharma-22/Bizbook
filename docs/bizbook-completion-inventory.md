# BizBook completion inventory

Status is based on source inspection and the remote test checks recorded below. A page is not marked complete merely because it renders. Database-backed behavior, authorization, and persistence remain unverified until its migration and workflow have actually run against the test project.

## Current verified status (2026-10-18)

- Test Supabase project: `xabfsqtevwnwtxxkmkvc`; linked history now confirms **54/54** repository migrations applied through `20261018000800_guard_manual_allocations_against_online_reservations.sql`. Manual installment allocations now account for active online order reservations under a shared installment lock. Its focused rollback-only SQL regression suite passed **5/5**, proving manual and online receipts can coexist without exceeding scheduled balance. The prior catalog snapshot reported 38/38 public tables with RLS, 56 policies, 95 validated and zero unvalidated public foreign keys, seven security-invoker views, zero invalid indexes, and no unsafe application `SECURITY DEFINER` routines. Linked schema lint passes with its earlier warnings in legacy routines.
- Email signup/sign-in now use confirmation links; the visible resend countdown is **20 seconds**. Local Supabase Auth uses a **300-second link/token expiry**, but hosted Auth templates, expiry, redirect allow-list, and delivery are not verified. Supabase/provider delivery quotas remain enforced.
- Admission-cancellation SQL suite: **14/14 PASS** on the test project in a transaction ending with `ROLLBACK`. It covers authorization, required reason, pending-order blocking, preservation of receipts/allocations, checkout-link revocation, idempotent retries, and rejection of new payments after cancellation.
- This feature's `npx tsc --noEmit`, targeted ESLint, and `git diff --check` pass. Previously recorded broad local tests, full lint, and build were not repeated in this slice. The prior production dependency audit had zero high findings; the full development/build audit reported nine high findings in `braces@3.0.3`.
- Active business and financial screens use Supabase for persistence. `/settings/data-import` supports review/backup and confirmed limited imports for unpaid student schedules, staff profiles/current compensation without history, reviewed expenses, and recognized institute profile fields into blank columns only. Receipts, advances, refunds, payroll history, attendance history, logos, duplicate reconciliation, and full legacy migration remain incomplete; no browser key has been cleared. Branch records and database restrictions are retained, but branch management and the general branch selector are paused in the client workspace.
- Payment server endpoints include finance-started checkout, expiring public parent links, test-mode refund operations, and subscription invoice sandbox settlement. Provider sandbox verification and authenticated browser checkout/refund/subscription journeys remain unverified. Support inbox is database-backed but has no outbound notifications.
- Latest count-only test query: one platform-admin role row; zero plans, subscriptions, subscription invoices, platform payment attempts, and provider connections. The admin row's identity and signed-in console access remain unverified.
- **Production remains NO-GO.** No production connection or change occurred. Current production schema compatibility, authenticated cross-tenant browser journeys, provider setup/verification, and backup restore are not demonstrated.

The latest source inventory counted **349** non-generated workspace files, including **34** App Router pages, **27** API handlers, and **44** migrations. This is a source manifest and automated-gate review, not a claim that every asset/dependency or every authenticated browser journey was manually inspected.

### Earlier verification snapshot (2026-10-17; superseded by current status above)

- Reconfirmed the CLI reference and `.env.local` host are the authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history is **33/33**, linked schema lint passes, and the current catalog reports 33/33 public tables RLS-enabled, 50 policies, 78 validated FKs, seven `security_invoker` views, zero invalid indexes, one private logo bucket, and four Storage policies.
- Fresh local verification: **29/29** helper/CSV test files plus Brain **88/88**, TypeScript **PASS**, full ESLint **PASS**, production build **PASS** with 59 routes. Production dependency audit: **0 vulnerabilities**. `git diff --check` passed; Git only reported expected LF/CRLF normalization notices.
- The audit remains source/build/SQL based. No authenticated browser E2E, provider sandbox transaction/refund, message delivery, legacy import/reconciliation, production compatibility query, or backup restore was run. Test SQL preference coverage remains rollback-only **13/13** and left no synthetic users.

### Final read-only database and code-gate refresh (2026-10-17)

- Reverified `.env.local` and the Supabase CLI link before remote access; both target test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history is **37/37** through `20261017001100_platform_payment_capture_reference_semantics.sql`.
- Fresh read-only catalog query: **34/34** public tables have RLS, **52** public policies, **81** validated and **0** unvalidated foreign keys, **7/7** public views use `security_invoker`, **0** invalid indexes, **0** application `SECURITY DEFINER` routines callable by `anon` or missing a fixed `search_path`, one private institute-logo bucket, and four Storage policies. Named visibility-test residual counts are zero.
- Fresh `supabase db lint --linked --project-ref xabfsqtevwnwtxxkmkvc`: **PASS**, no schema errors. This supersedes the earlier post-migration `28P01` login error.
- No migration, database write, provider call, payment, message, or production query occurred. Current local gates remain 34 local test files plus Brain 88/88, TypeScript PASS, full ESLint PASS, and build PASS (65 route entries).
- Production remains **NO-GO** pending authenticated browser authorization journeys, actual provider sandbox transactions/webhooks/refunds, verified Platform Admin identity/login, legacy-data import and reconciliation, a fresh approved read-only production compatibility assessment, and demonstrated encrypted backup/restore.
- Manual receipt and expense validation were tightened to use the shared decimal-string-to-paise parser for input and installment balance checks. New/current helper coverage passes manual receipts **10** and expense validation **9/9**; final local run passes all **34** test files plus Brain **88/88**, TypeScript, full ESLint, and build (**65 route entries**). No remote database write or migration was needed.

## Shared report-engine continuation (2026-10-17)

- Dashboard summary and profit/loss calculations now live in `lib/bizbook-brain/financial-summary-engine.ts`; the Supabase reporting adapter re-exports the shared pure functions. Active reports therefore share the Brain's exact-paise aggregation instead of maintaining a second page-level formula.
- The engine rejects malformed precision, unsafe totals, category/direction mismatches, and invalid open-balance rows while preserving visible invalid-row counts. Summary tests pass **8/8** and P&L tests **8/8**.
- Post-change local gates: all **34** local test files PASS plus Brain **88/88**; TypeScript PASS; full ESLint PASS; optimized build PASS with **65 routes**. No database change occurred, so remote SQL suites were not repeated. Production remains **NO-GO**.

## Browser-storage application API removal (2026-10-17)

- Removed the unused browser refresh hook and removed localStorage-backed persistence adapters/services from the application-facing Brain barrel. Kept the underlying legacy source modules available for existing recovery/regression tests and left all browser keys untouched.
- Added `lib/bizbook-brain/application-barrel.test.ts` (**25 assertions**) to prevent browser persistence functions from leaking through the app API. Source scan shows only the explicit local legacy preview/backup page reads browser business data; no active screen writes or clears it.
- Final local gates after this change: all **35** test files PASS plus Brain **88/88**, TypeScript PASS, full ESLint PASS, production build PASS (**65 routes**). Import/reconciliation and actual user browser-data verification remain outstanding; production remains **NO-GO**.

## Route inventory

| Route | Current state | Data source / gap |
| --- | --- | --- |
| `/` | Implemented | Redirects to `/dashboard`. |
| `/dashboard` | Partial | Tenant-scoped monthly financial summaries and student count from shared database views. Institute-wide users open the institute scope; legacy branch-restricted memberships remain limited by RLS. localStorage records are excluded. |
| `/business` | Implemented | Redirects to the database-backed student/staff workspace. |
| `/business/students` | Partial | Shared database workflow handles schedules and staff. Owners/admins can cancel admissions with a required reason; it preserves financial history, blocks unresolved online payments, and revokes parent checkout links. A sidebar shortcut opens this workflow. Existing browser records remain untouched. |
| `/business/attendance` | Partial | Shared database attendance with scoped idempotent upserts and corrections is now the only screen mode; remote integrity/date tests pass. |
| `/business/branches` | Paused | Branch creation and switching are removed from the coaching-center workspace. Existing branch database rows and RLS remain intact. |
| `/business/members` | Implemented, test DB verified | Institute owner/admin invitation and member-management screen. Invites require an existing verified BizBook email, remain pending until that exact account accepts in `/account`, and grant no access when created. New invites are institute-wide; branch selection stays out of the UI. |
| `/account` | Implemented, test DB verified | Signed-in account inbox for email-matched institute invitations plus per-institute Open links. Invitations are accepted individually; database membership and role policies protect each operation. |
| `/member-login` | Retired | Redirects to the standard `/login` page. Institute-specific member-login screens are removed. |
| `/business/members` | Retired | Redirects to `/dashboard`; the Members & Permissions sidebar entry and account/invitation APIs are removed. Membership rows and RLS authorization remain; authenticated users can no longer call the old member-management RPCs. |
| `/business/salary` | Partial | Shared payroll uses the atomic salary RPC and database de-duplication. Authorized staff can record an already-paid offline salary (Cash, UPI, Bank Transfer, Card, Cheque, or Other); this records the method and does not transfer money. Fee receipts link to the shared receipt workflow. |
| `/expenses` | Partial | Shared institute-scoped expense ledger with separate sidebar destinations for recording an expense, setting fixed monthly expenses, and recording expense payments. Unpaid obligations are separate from paid-only cash summaries/history. Migrations `20261018001000` and `20261018001100` are applied to the test database. |
| `/business/profile` | Partial | Institute profile fields persist to Supabase; logo files use a private institute-scoped Storage bucket. |
| `/settings/account` | Compatibility route | Server redirect to the existing Supabase-backed `/business/profile` page; it is not a separate personal-account settings screen. |
| `/login` | Partial | Email/password, signup and passwordless email confirmation links, Google OAuth, phone OTP, and reset calls use Supabase Auth; a validated `/platform-admin` return target is preserved for sign-in. Hosted templates and end-to-end delivery are not verified. |
| `/pay` | Partial, test-only | Public parent installment checkout via a 256-bit bearer capability in the URL fragment. Link expires in 24 hours, can be revoked, and exposes no student/parent contact data. No provider sandbox or browser E2E was run. |
| `/auth/callback` | Partial | PKCE code exchange with same-origin redirect validation. |
| `/account/update-password` | Partial | Authenticated password update. |
| `/setup` | Partial | Creates an institute through the existing authenticated `create_coaching_institute` RPC. |
| `/settings/security` | Partial | Owner/administrator Supabase Auth setup guide with copyable Google and Supabase redirect values; it does not change or verify project Auth settings. |
| `/settings/data-import` | Partial, scoped import | Institute-wide owner/admin-gated preview and local backup export, plus confirmed imports limited to new students with fully unpaid schedules, staff profiles/current compensation without attendance/payroll history, reviewed expense rows, and recognized institute profile fields into blank columns only. Receipts, advances, refunds, payroll history, attendance, logos, and duplicate reconciliation remain incomplete; no browser key is deleted. |
| `/settings/integrations` | Partial | Coaching-center owners/admins manage their institute's test-mode online gateway credentials. Manual cash/UPI/bank/card/cheque receipt entry is under Payments & Collections. Central email/WhatsApp credentials remain separate in company-admin `/platform-admin`. |
| `/settings/subscription` | Partial, test-only checkout | Institute-wide owners/admins can view the assigned plan, invoices, and attempts. Sandbox checkout can start/resume an invoice payment only when a central test provider has passed its explicit sandbox check; invoice settlement is confirmed server-side and audited. SQL settlement suite passes 43/43; no external provider or authenticated browser flow was exercised. |
| `/platform-admin` | Partial, fail-closed | Separate protected **BizBook Company Admin** console for managing subscribed coaching centers, plans, subscriptions, company roles, central providers, audit, and support. It is not part of a coaching center's sidebar/workspace. A platform-admin row exists in the test database, but its identity and authenticated access were not browser-verified. |
| `/support` | Implemented for test use | Authenticated institute members can submit, page through, and follow database-backed support requests; institute membership and ticket visibility are checked by RPC/RLS. Retries are idempotent, with a 10-open-ticket daily limit. No email/WhatsApp notice is sent. Remote SQL suite: 29/29 passed; no authenticated browser journey was run. |
| `/payments/advance` | Partial | Shows advance receipt status/history and remaining balances. The separate post-entry allocation form has been removed; **Record manual advance** opens receipt entry, where an advance can be applied during recording. **Refund a manual advance** opens refunds filtered to manual advance receipts. Existing unallocated advances can no longer be applied later from this page. |
| `/payments/refunds` | Partial, test-mode provider path | Supports manual refunds for fee and advance receipts. Manual completion requires confirmation that money was actually returned. Online requests reserve capacity through database RPCs; server verifies exact provider response before recording status. No provider sandbox refund was run. |
| `/payments/history` | Partial | Lists real scoped payment/refund rows from Supabase with filters and pagination; query helper and database policies are verified on test. The sidebar shows a blinking new-payment dot until Payment History is opened. |
| `/payments/outstanding` | Partial | Reads canonical installment balances with branch scope. Balance-report tests pass. |
| `/payments/overdue` | Partial | Classifies canonical installment balances by institute business date and branch scope. An unpaid admission-fee installment appears as **Due at admission** on its admission date; regular installments become overdue after their due date. The Payments & Collections sidebar section shows the overdue-installment count even when collapsed. |
| `/payments/receipt-records` | Partial | Direct **Record Manual Payment** entry records cash, UPI, bank transfer, card, cheque, or other fee/advance receipts through the idempotent RPC and shows real payment rows. Finance staff can launch checkout or issue/revoke a 24-hour parent link for an outstanding fee installment. Captured receipts still require server-side provider confirmation. No sandbox credentials/transaction was tested. |
| `/payments/penalties` | Deferred; route removed | Late-fee support is postponed. No late-fee ledger or charge exists; the page is not available in the coaching workspace. |
| `/payments/reminders` | Partial | Read-only tenant/branch-scoped notification delivery history; recipient data is omitted. Database schema is verified; it does not send messages and delivery remains inactive. |
| `/reports/financial-summary` | Partial | Reads tenant/branch/month financial summary views and separates fee/advance receipts, completed refunds, payroll, expenses, outstanding balances, and overdue count. Test migration is applied; penalty and BizBook subscription revenue remain excluded because no approved ledger/policy exists. |
| `/reports/profit-loss` | Partial | Uses scoped database summary views and separates collected revenue, outflows, outstanding, and potential profit. This is not a full accrual accounting statement; penalty and subscription revenue remain excluded. |
| `/reports/revenue-expenses` | Partial | Six-month scoped comparison from canonical monthly financial activity; amounts are aggregated in integer paise. |
| `/reports/comparisons` | Partial | Two selected months compared from canonical fee/advance receipts, completed refunds, payroll, and expense totals in the active institute/branch scope. |
| `/reports/collection-forecast` | Partial | Reads open installment balances, buckets by institute-local due date through 90 days, and reports undated installments separately. This is a due-date summary, not a predicted payment model. |
| `/api/cron/reminders` | Implemented, inactive | Resolves only active platform-level sender credentials, checks consent and tenant/branch association, and records idempotent attempts. Database schema is verified; no provider credentials or scheduler are configured and no delivery was tested. |
| `/api/admin/payment-connections/verify` | Implemented, not externally verified | Authenticated owner/admin sandbox check can create an unpaid INR 1 test order; only a real provider response can activate the test connection. This workspace has not called a provider. |
| `/api/admin/notification-connections` and `/verify` | Retired | Return `410 Gone`; institute admins cannot store or check separate notification credentials. Central provider configuration is under `/platform-admin`. |
| `/api/notifications/email` | Preview only | Does not send mail. |
| `/api/notifications/whatsapp` | Preview only | Does not send WhatsApp messages. |
| `/api/payments/create-order` | Partial, test-only backend | Authenticated finance staff can reserve an idempotent order and request a Razorpay test or Cashfree sandbox order. The shared receipt screen now opens provider checkout for a selected installment; it is staff-initiated rather than a public parent portal. |
| `/api/payments/verify` | Partial, test-only backend | Verifies Razorpay checkout signature, fetches provider status server-side, and posts a receipt only after confirmed capture. Requires active test credentials and server-only Vault access. |
| `/api/payments/refunds/submit` | Partial, test-only backend | Submits or refreshes an authorized online refund through server-side provider APIs; the browser cannot mark it complete. No provider sandbox call was run. |
| `/api/payments/webhook` | Partial, test-only backend | Verifies the raw Razorpay webhook signature and processes events idempotently. No live environment is enabled. |
| `/api/webhooks/cashfree` | Partial, test-only backend | Verifies Cashfree timestamp/signature over the raw body and fetches provider status before posting captured payments. |
| `/api/payments/sync` | Partial, test-only backend | Authenticated finance staff can refresh Cashfree status from the provider payment API; multiple successful attempts are held for reconciliation. |
| `/api/payments/checkout-links` | Partial, test-only backend | Finance-role/branch-authorized issue and revoke. Raw token is returned once; only SHA-256 is stored and all changes are audited. |
| `/api/payments/checkout-link/resolve`, `/api/payments/checkout-link/verify` | Partial, test-only backend | Public bearer resolution and verification through service-role-only RPCs. Resolution returns minimal order details and provider checkout session; payment is posted only after provider confirmation. |
| `/api/platform-billing/create-order`, `/api/platform-billing/verify` | Partial, test-only backend | Creates/reuses an idempotent platform subscription invoice attempt, starts sandbox provider checkout, and verifies payment status server-side before atomically settling the invoice. Requires verified central test credentials and the server-only service-role key. No provider call was made. |
| `/api/webhooks/platform/razorpay`, `/api/webhooks/platform/cashfree` | Partial, test-only backend | Verifies provider signatures over the raw request body, fetches provider status, and finalizes subscription payment events idempotently. HTTPS webhook delivery and real provider sandbox signatures have not been exercised. |
| `/api/support`, `/api/platform-admin/support` | Test-project-only database workflows | Institute support CRUD and platform queue/status/reply endpoints use authenticated sessions, server-side test-project guards, validated same-origin mutations, membership/platform-role checked RPCs, RLS, idempotency, and audit events. No outbound notification is implemented. |

## Remaining navigation and account-management gaps

- `/settings/account` is a compatibility redirect to `/business/profile`; there is no separate personal-account preferences screen. Authentication security settings are under `/settings/security`.
- Member and branch-assignment management is available at `/business/members` for institute-wide owners/admins. It requires the target account to already exist and its Supabase Auth UUID; email invitations and account creation remain unimplemented. Parent links are now implemented for test mode, but actual provider verification remains unverified.

## Data and security state

- The Supabase schema and transaction functions are applied to the test database. Student, staff, attendance, payroll, manual receipt, advance allocation, manual refund, expense, branch, and report paths have shared-database workflows. Legacy storage adapters remain for compatibility; business screens use Supabase for persistence.
- Login, password reset, first-institute onboarding, branch management, member roles, and branch-assignment screens are present. Shared branch selection persists as an RLS-protected profile preference and is revalidated against current membership/branch access. Member changes use database authorization functions; the screen never writes membership tables directly.
- The only current screen that reads legacy browser business keys is `/settings/data-import`, after an explicit owner/admin action, for local preview or download. Existing keys are not changed. Controlled database import, duplicate resolution, and reconciliation remain unimplemented.
- The dashboard reads monthly totals from `financial_activity_summary` and `installment_balance_summary`, plus the RLS-filtered active-student count. Fee receipts, advance receipts, completed refunds, payroll, general expenses, and outstanding balances remain separate metrics. The views are applied and verified on test.
- Student/staff, attendance, payroll, manual receipt, advance allocation, manual refund, expense, branch, payment-history, outstanding/overdue, dashboard, profile, and summary-report screens use tenant/branch-scoped shared paths. The Brain's legacy storage adapter remains in the library for compatibility/tests but is no longer called by application screens. No automatic import or merge has run.
- Online payment creation, verification, Razorpay/Cashfree webhooks, Cashfree status refresh, and public parent checkout links exist as server-only test-project routes. Checkout links store only SHA-256 token digests, expire after 24 hours, and can be revoked. SQL suites verify scoped issue/revocation, PII omission, captured-only accounting, and second-capture reconciliation. No provider sandbox request was made.
- The integrations page has an explicit sandbox check for Razorpay and Cashfree. It calls each fixed provider test API to create an unpaid INR 1.00 order; no checkout opens and no payment is attempted. The API order reference is shown, while credentials and checkout tokens are not returned. A successful sandbox check does not activate the saved connection or verify webhooks. No actual provider request has been made in this workspace.
- The payment settings route is restricted to the authorized test project and owner/administrator institute membership. Test credentials are submitted to a same-origin server route, then saved by a Vault function that independently checks institute manager membership; credentials are never returned to the browser. Credential resolution is service-role-only. Saving remains `pending`; an actual provider sandbox check is required before test activation. No such provider check was run here. The payment backend migration is applied and its SQL tests pass; live mode is unavailable.
- Historical note, superseded by the central-sender continuation below: the former institute integration screen accepted Resend/WhatsApp settings and allowed a Resend test-inbox check. Those institute-level notification forms and check routes are now retired; no provider test call was made from this workspace.
- The login screen now calls Supabase Auth for Google OAuth and email/phone OTP. Supabase Auth enforces send limits and code expiry; the UI shows a resend cooldown. End-to-end behavior remains blocked on test Auth provider, SMTP/SMS setup, and a real test account.
- `/settings/security` provides the verified test project's OAuth callback values and Auth setup steps. It does not claim provider status, store Supabase Management API tokens, or change Auth configuration.
- When public Supabase configuration is present, the Proxy checks signed-in session claims and protects application/API routes; production fails closed if that configuration is missing. Database RLS remains the data authorization boundary.
- The reminder runner resolves one active platform-level sender per channel. The database migration is applied, but delivery remains inactive until the provider is verified and credentials, webhook handling, and scheduler are configured.
- Historical note, superseded by the migration follow-up below: test-project access previously returned HTTP 403. The CLI now reads the authorized test project successfully. Production project `cjuneqmohdivjioulyqq` was not accessed during the migration attempt and has not been modified.

## Completion checklist

- [x] Read-only inspect the test project's applied migration history and catalog; **37/37** applied, linked schema lint passes, and the current RLS/FK/view/index/privileged-routine counts are recorded above. The catalog audit does not prove authenticated browser isolation.
- [x] Compare actual test schema with local migration files and review additive migration order; no schema migration was needed for the checkout UI.
- [x] Add login/logout/password reset and first-institute setup; protect configured routes with verified sessions.
- [x] Add Google OAuth, email confirmation-link, and phone OTP Auth flows plus an owner/administrator setup guide; hosted provider configuration and delivery still require Supabase project setup and end-to-end verification.
- [x] Verify the Branches page and branch soft-deactivation against the test project; the corrective migrations and rollback-only security tests are recorded in this inventory.
- [x] Add a database-backed Expenses workflow with server validation, institute/branch checks, retry-safe creation, audited edits, and reasoned soft-voiding; its migrations and SQL tests have been applied/run on the test project.
- [x] Add tenant/branch-scoped database workflows for student/staff, attendance/payroll, payments/receipts/refunds, expenses, reports, and business profile. **Legacy import/reconciliation remains incomplete** and browser records must remain preserved.
- [x] Implement authenticated Razorpay and Cashfree sandbox credential-check paths; mocked request/response behavior is tested. Actual account verification remains pending until test credentials are provided.
- [x] Implement test-only provider order creation, server verification, signed/idempotent webhooks, Cashfree status sync, finance-started installment checkout, public expiring/revocable parent links, provider-backed online refunds, and subscription invoice settlement. Actual provider sandbox verification and authenticated browser journeys remain **NOT RUN**.
- [x] Add owner/administrator provider configuration screens and server-side validation/storage boundaries for payment and notification credentials; credentials remain unverified and cannot enable checkout or delivery.
- [x] Apply and test `20261014000300_secure_payment_provider_credentials.sql` on the authorized test project; Vault functions and privilege assertions passed in the recorded test-project suites.
- [x] Implement public parent checkout links with token hashing, expiry, revocation, minimal public data, and server-confirmed payment status; test-project rollback suites pass. Provider sandbox end-to-end proof and authenticated online-refund/subscription checkout journeys remain outstanding.

## Subscription settlement continuation (2026-10-17)

- Added `20261017000900_platform_subscription_payment_settlement.sql`. After verifying both the CLI link and `.env.local` host as test project `xabfsqtevwnwtxxkmkvc`, a dry run identified only this new migration and it was applied there. Read-only Management-API history and catalog checks confirmed 35 versions applied and the settlement objects present. A later direct-Postgres migration-list attempt failed with cached CLI login-role authentication (`28P01`); the Management-API evidence is the migration-count source for this checkpoint.
- The additive schema provides idempotent payment attempts, tenant-consistent provider event records, RLS/service-role boundaries, exact amount/currency matching, single-unresolved-attempt protection, audit history, duplicate-event idempotency, and reconciliation handling for ambiguous or late/duplicate captures. It does not rewrite existing invoices or business rows.
- `/settings/subscription` now starts or resumes sandbox checkout. `/api/platform-billing/create-order` and `/verify`, plus Razorpay/Cashfree platform billing webhooks, return provider-confirmed payment status and settle invoices only through the database finalizer. Checkout recovery is limited to known attempts; an ambiguous Razorpay order remains blocked for reconciliation.
- The rollback-only remote SQL suite passed **35/35** assertions; linked test-project database lint passed with no schema errors. The suite's synthetic rows were rolled back. No provider request, payment, notification, or production access occurred.
- Before the final UI correction, `npm test` passed **32 local test files** plus Brain **88/88**. After the correction, TypeScript passed, targeted ESLint for the checkout files passed, and `npm run build` passed with **64 routes**. The full test suite was not repeated because the final change only re-enabled the existing-attempt resume button and keyed component state to the attempt.
- The local server-only service-role variable is present but has not been validated against a deployment. No Razorpay/Cashfree test credentials were supplied; provider sandbox order, checkout, webhook, and authenticated browser flows remain unverified. Platform billing is implemented for test mode, not production-ready.

**Production remains NO-GO.** A current read-only production compatibility review, authenticated browser tests, provider sandbox evidence, legacy-data import/reconciliation, first platform-admin login verification, a successful post-migration linked lint, and an encrypted backup/restore rehearsal remain release gates. Production project `cjuneqmohdivjioulyqq` was not accessed or changed.
- [ ] Complete reminder settings, delivery history, provider configuration, and scheduled delivery tests.
- [ ] Add route/component/database isolation tests and supported browser tests at mobile/tablet/desktop widths.
- [ ] Run TypeScript, Brain, lint, build, SQL migrations/tests, and supported end-to-end tests; report actual results.
- [ ] Before production cutover, compare the production schema read-only, take a verified backup, review a migration plan, and obtain explicit approval. Do not apply migrations or switch traffic without that approval.

## Baseline results (2026-10-14)

- `npx tsc --noEmit`: passed.
- `npx tsx lib/bizbook-brain/test-cases.ts`: passed, 88/88.
- `npm run build`: passed; Next.js generated output for 22 pages.

- `npm run lint`: failed with 17 errors and 26 warnings, mainly effect-state updates and existing unused-code warnings.
- `npx supabase migration list --linked`: failed with HTTP 403 account access error before returning migration state.
- `npx supabase test db`: unavailable because no local PostgreSQL server is listening on `127.0.0.1:54322`.

## Current implementation work (2026-10-15)

- `npx tsc --noEmit`: passed after adding the payment integration screen and API route.
- `npx tsx lib/bizbook-brain/test-cases.ts`: passed, 88/88.
- `npx tsx lib/supabase/payment-connection-validation.test.ts`: passed, 6/6. It covers provider selection, required fields, test-only Razorpay key IDs, input limits, and the Cashfree API version value.
- `npx tsx lib/supabase/notification-connection-validation.test.ts`: passed, 5/5. It covers Resend sender validation, optional webhook setup before an endpoint exists, WhatsApp IDs/API version/template settings, and unsupported providers.
- The new migration and its 12 privilege assertions have not run against PostgreSQL. The current Supabase CLI identity's 403 on the test project remains a blocker; Docker remains prohibited and unused.
- `npm run build`: passed after adding the login and integration pages; Next.js generated 31 routes.
- `npm run lint`: failed with 17 existing errors and 26 warnings, matching the recorded baseline. The changed login, integration page, and API routes pass targeted ESLint.
- This configuration slice makes no provider request, payment, email, or WhatsApp delivery. It reports saved credentials as unverified and advises against registering a callback URL.

## Shared expense workflow work (2026-10-15)

- `/expenses` now lets the user choose the unchanged browser ledger or a separate shared institute ledger. The ledgers are not merged, and legacy localStorage keys are not rewritten.
- Added authenticated expense list/create/update/void API operations. Shared creation uses a client-generated idempotency UUID and a SECURITY DEFINER RPC; updates use a role-checked RPC; voids are soft deletes with a required reason. Existing audit triggers record inserts and edits.
- The server validates institute-local business dates, paise precision, amount bounds, payment methods, title/category/notes lengths, same-origin mutations, finance role, and branch access. Client-supplied identity/role flags are not accepted.
- Added migrations `20261015000100_expense_void_operation.sql` and `20261015000200_expense_create_idempotency.sql`, plus pgTAP privilege tests. They are local only and have not run on PostgreSQL because test-project CLI access returns HTTP 403.
- Expense input validation suite: 8 cases. The unit suite does not verify RLS or SQL behavior.
- Latest expense validation run: **PASS**, 8/8. `npx tsc --noEmit`, targeted ESLint, all 88 Brain cases, the 6 payment-input cases, the 5 notification-input cases, and the optimized build also passed after this implementation; the build generated 33 app routes.
- The expense SQL suites, like the Vault and remote financial suites, remain unexecuted because Supabase CLI access fails with HTTP 403 before reaching the verified test database.

## Verification refresh (2026-10-15)

- Verified again that both `supabase/.temp/project-ref` and `NEXT_PUBLIC_SUPABASE_URL` point to the authorized test project `xabfsqtevwnwtxxkmkvc`. No key values were printed.
- `npx tsc --noEmit`: **PASS**.
- `npx tsx lib/bizbook-brain/test-cases.ts`: **PASS**, 88/88.
- `npx tsx lib/supabase/payment-connection-validation.test.ts`: **PASS**, 6/6.
- `npx tsx lib/supabase/notification-connection-validation.test.ts`: **PASS**, 5/5.
- Targeted ESLint on the changed login, security/integration pages, and admin provider routes: **PASS**.
- `npm run build`: **PASS**, Next.js generated the current 32 app routes.
- `npx supabase migration list --linked`: **BLOCKED**, CLI login-role lookup returns HTTP 403 (account lacks required project endpoint privileges).
- `npx supabase db lint --linked`: **BLOCKED** by the same HTTP 403 before database lint begins. It targeted the verified test link only. No Docker or production query was used.
- Full database migration and SQL assertion results remain unverified. The new Vault migration cannot be considered deployed or tested until authorized test-project access is restored.
- Customer payment-order creation, provider-side payment outcome verification, signed payment/delivery webhooks, provider-confirmed refunds, and routine email/WhatsApp delivery are still **not implemented**. Payment workflow routes remain 501; the credential-check actions do not activate provider connections.
- The ordinary business pages listed above still persist to legacy localStorage. They are not yet multi-device, database-backed workflows; no legacy import has been run.

## Dashboard and provider-check implementation (2026-10-15)

- Added local `security_invoker` monthly financial and installment summary views, with authenticated-only SELECT grants, plus institute/branch/month filters on `/dashboard`. The dashboard uses canonical database ledgers and keeps receipts, completed refunds, salary, and expenses in separate metrics.
- Added `dashboard_summary_security.test.sql` (8 pgTAP assertions) and `dashboard-summary.test.ts` (5 local cases). Local summary tests passed 5/5. SQL migration/assertions are blocked from execution by test-project HTTP 403.
- Added an owner/administrator, test-project-only endpoint that creates a synthetic unpaid INR 1 order at the Razorpay or Cashfree test endpoint and validates the returned order state. It never returns a credential or Cashfree session token, and it does not activate the stored connection.
- Added administrator-only notification checks: Resend sends a synthetic test email to the provider's test inbox; WhatsApp reads the configured phone profile using the supplied token. Both return only the operation reference and keep saved settings pending.
- Updated scheduled reminders to resolve active Resend/WhatsApp credentials for the specific institute from the Vault RPC. Shared global environment keys are no longer used, preventing one institute's credentials from being reused for another. Pending connections cannot send.
- `payment-provider-check.test.ts`: **PASS**, 6/6 mocked cases. No provider credentials were supplied and no actual provider API was called.
- `notification-provider-check.test.ts`: **PASS**, 6/6 mocked cases. No provider credentials were supplied and no actual provider API or email was sent.
- Active Vault credential parser tests: **PASS**, 5/5.
- Latest local verification: `npx tsc --noEmit` **PASS**; changed dashboard/provider/reminder targeted ESLint **PASS**; `npm run build` **PASS** (35 routes); Brain tests **PASS** (88/88); expense validation **PASS** (8/8).
- Full `npm run lint`: **FAIL**, 16 errors and 26 warnings remain in legacy pages/components. Changed dashboard/provider files pass targeted lint.
- The local migration directory now has 11 files. Four migrations beyond the earlier seven-migration test comparison baseline remain unapplied/unverified: Vault credentials (`20261014000300`) and local expense/dashboard changes (`20261015000100`–`20261015000300`). The production audit is a historical snapshot and was not refreshed against production.

## Shared student and route-completion work (2026-10-15)

- Added `20261015000400_student_record_operations.sql` and a 37-assertion SQL suite. The migration adds a separate admission-fee installment, preserves legacy JSON, keeps partial payments attached, blocks schedule reductions/removals below retained net paid amounts, blocks branch moves after receipts, and soft-archives without deleting history. Schedule totals are exact to the paise.
- `/business/students` now offers a separate shared test-database mode. Existing browser storage remains available and unchanged; there is no automatic import or merge. Student receipts show actual fee and advance receipts once, less completed refunds; allocations affect installment balances only. The staff tab remains browser-backed.
- Mapping regression tests passed **19/19**; the SQL assertion plan is correctly sized at **37**, but the suite has not run on PostgreSQL. Running it requires the new migration and synthetic remote writes in the test database.
- The shared receipt form records manual receipts only. Fee receipts must allocate to an installment; advance receipts may remain unallocated or apply part of the receipt to one installment. Request keys are reused when retrying unchanged details, and the database RPC independently enforces membership, branch access, amount limits, and idempotency. No online payment is marked paid by this screen. Allocation-plan tests passed **8/8**.
- `/payments/reminders` reads saved tenant/branch delivery logs, `/reports/financial-summary` reads the canonical summary views, and `/payments/penalties` explicitly reports the missing penalty ledger/accounting policy. None claims a send, provider connection, or penalty calculation occurred.
- Added a strict Supabase test-project URL guard shared by provider configuration APIs and these data screens. It requires the exact HTTPS host `xabfsqtevwnwtxxkmkvc.supabase.co`; guard tests passed **8/8**.
- Verified `npx tsc --noEmit` **PASS**, the Brain suite **88/88 PASS**, dashboard summary tests **5/5 PASS**, and the optimized Next build **PASS** with 38 routes. Targeted ESLint for changed screens, mapping, helper, and provider configuration endpoints **PASS**.
- Full `npm run lint` remains **FAIL** with 14 hook-rule errors and 17 warnings in legacy pages/components. Changed files pass targeted lint.
- Before remote lint, both the Supabase CLI link and public URL were checked for test ref `xabfsqtevwnwtxxkmkvc`. `supabase db lint --linked` returned HTTP **403** during login-role initialization, before running database checks. No migration or SQL write was attempted. Production `cjuneqmohdivjioulyqq` was not queried or modified.
- The repository now has **14** migration files. Seven migrations after the earlier seven-migration comparison baseline remain unverified: Vault credentials (`20261014000300`) and `20261015000100` through `20261015000600`.

## Shared advance allocation continuation (2026-10-15)

- `/payments/advance` keeps its existing browser mode and adds an explicit shared mode. It lists actual advance receipt rows and canonical balances, then calls `allocate_advance`; pending/processing refund reservations are reflected by `advance_balances`. No allocation creates a receipt.
- Archived students were hidden in the UI, but the existing database RPC did not reject direct allocation requests for their retained installments. Added `20261015000600_protect_archived_student_allocations.sql` to take a share lock on the student before locking the installment, so an archive update cannot race past the check. Added a regression assertion to the student SQL suite; the plan is now **38** assertions.
- Advance allocation validation tests passed **7/7**; `npx tsc --noEmit` passed. The remote migration and SQL suite remain unexecuted due the test project's HTTP 403 access blocker. Production was not accessed.

## Shared manual refund workflow continuation (2026-10-15)

- Added `/payments/refunds` and a Refund Management navigation entry. It reads tenant/branch-scoped receipts, existing refunds, allocation rows, and refund reservations. The form only creates manual refund requests through `request_refund`; the database reserves pending/processing capacity and the UI labels that state accurately.
- Manual completion is available only for pending/processing manual refund rows and requires an explicit confirmation that money was already returned. No online provider refund can be created or marked completed from this screen. The idempotency UUID is retained for exact retries and the UI checks for an already-created request after an uncertain response.
- Refund planning tests passed **8/8**, covering pending/processing reservations, failed refunds, paise precision, reason validation, and original-allocation capacity. Targeted ESLint passed for the new refund/advance components and helpers. `npx tsc --noEmit` and the optimized build passed; the build generated **39** routes.
- Database behavior remains unverified: the current test-project CLI identity returns HTTP 403. The screen uses existing RPCs; no migration, remote request, or production access was attempted.

## Final migration-readiness audit (2026-10-15)

- Static inventory confirms **14** chronological migration files with no duplicate version prefixes. `20261015000500_penalties_subscriptions_and_integrations.sql` is **0 bytes** and creates none of the features named in it. The seven migrations after the earlier seven-migration test baseline remain unverified against the current test project.
- Supabase catalog-only query and migration-list access both stop at login-role initialization with HTTP **403**, before SQL is sent. The CLI link and public URL still point to test project `xabfsqtevwnwtxxkmkvc`. Production `cjuneqmohdivjioulyqq` was not connected or modified.
- Local source has RLS statements for all 21 core tables, composite tenant/branch foreign keys, tenant/date indexes, security-invoker financial views, and scoped RPCs. This is not evidence that the remote test schema, grants, or policies match.
- Added a separate, read-only test-project payment/refund history mode with institute/branch/student/date/status filters and pagination. It preserves the existing browser receipt-entry flow. The new refund summary keeps pending/processing amounts separate from completed refunds; helper tests passed **6/6**. The shared query is not verified against PostgreSQL.
- Important unfinished features: shared-layout branch switcher and persisted cross-page scope; customer checkout/verification/webhooks (currently HTTP 501); provider-confirmed online refunds; BizBook subscription billing; and a separate protected super-admin area. Business overview, attendance, salary, profile, and legacy student/receipt/advance workflows still rely on browser storage; some have separate, unverified shared modes.

## Central notifications and platform administration (2026-10-15)

- Added local migration `20261015000700_platform_admin_and_central_providers.sql`. It defines a platform-admin role with no seeded administrator, central test-mode provider metadata and Vault references, audit events, plan/subscription/invoice/payment-attempt records, tenant-consistent foreign keys, least-privilege RLS, and a service-role-only central credential resolver. It revokes both institute notification credential save and resolve functions without deleting existing legacy rows. Migration application and SQL assertions remain **BLOCKED** pending remote-write approval; no database write was attempted.
- Added `/platform-admin` and `/api/platform-admin/providers`. The page checks a server-side database role; ordinary institute roles do not authorize it. Saves are same-origin, test-project-only and validated server-side; RPC saves credentials to Vault and returns metadata only. Saved settings remain pending. No provider test request, message, or payment occurs.
- Removed institute-level email/WhatsApp credential forms and retired the corresponding save/check routes with `410 Gone`. The reminder job now resolves the single central sender and fails closed unless it is active. Existing per-institute secret references/data are retained but no longer used by the updated job.
- Added central-provider input validation tests. Remaining super-admin work includes audited institute lifecycle controls, plan create/update APIs, subscription transitions and limit enforcement, invoices/payment attempts, central notification test-send and signed delivery webhooks, platform-wide log/health views, and provider-verified platform billing. No subscription revenue metric is shown or calculated.

## Latest verification update (2026-10-15)

- Read-only test-project access now succeeds. The linked project reference and `.env.local` host are both `xabfsqtevwnwtxxkmkvc.supabase.co`; no credentials were displayed. Migration history shows the first seven versions applied and eight pending: `20261014000300`, `20261015000100`–`20261015000700`.
- Catalog preflight: all 21 core tables exist with RLS enabled; four `security_invoker` financial views exist; no objects from pending `20261014000300` or `20261015000700` are present. Linked schema lint **PASS** applies to the currently deployed test schema only; it does not validate the pending migration SQL.
- The former empty `20261015000500_penalties_subscriptions_and_integrations.sql` is now comment-only and explicitly retained as a no-op; subscription/provider structures are introduced later in `20261015000700`. The penalty ledger remains intentionally absent.
- TypeScript **PASS**; Brain tests **88/88 PASS**; central provider validation **5/5 PASS**; active credential parser **5/5 PASS**; targeted ESLint **PASS**; production build **PASS** (41 routes). Full ESLint **FAIL** with 14 errors and 17 warnings in legacy files.
- The 30-assertion platform migration SQL suite is prepared but **NOT RUN** because its schema is not deployed and it requires test database writes. No migration or persistent SQL change was made; the separate approved financial suite used only rolled-back synthetic writes. No provider call, real email/message, or payment was executed. Production remains untouched.
- All 14 local Supabase helper suites passed (**102 assertions total**) after the central-sender changes; the separate BizBook Brain suite also passed **88/88**. SQL assertions are reported separately and are not counted as run.
- The previously approved remote financial-guard suite ran in one transaction and rolled back: **47/47 PASS**. Read-only synthetic fixture checks returned no collisions before and after, and the migration list was unchanged. This verifies the currently applied first-seven-migration test schema only; it does not verify the eight pending migrations.
- Latest local checks: TypeScript **PASS**; Brain **88/88 PASS**; all 13 Supabase helper test files **PASS** (97 assertions); production build **PASS** (39 routes); targeted lint for the new shared-history component/helper **PASS**; full ESLint **FAIL** (14 errors, 17 warnings). The temporary Node test-runner preload was removed after verification.
- Remote database SQL tests were not run because this audit prohibited database writes and test-project access is blocked. **Production migration readiness: NO-GO.** Restore test-project read access, resolve the empty migration, verify all remote objects and financial/security SQL tests, and close the application gaps before any separately approved production deployment.

## Test migration approval follow-up (2026-10-15)

- Verified both `supabase/.temp/project-ref` and the host in `.env.local` resolve to test project `xabfsqtevwnwtxxkmkvc` before the attempt. No secret values were printed.
- Read-only migration history showed seven versions applied and these eight pending in order: `20261014000300_secure_payment_provider_credentials.sql`, `20261015000100_expense_void_operation.sql`, `20261015000200_expense_create_idempotency.sql`, `20261015000300_dashboard_financial_summaries.sql`, `20261015000400_student_record_operations.sql`, `20261015000500_penalties_subscriptions_and_integrations.sql` (comment-only no-op), `20261015000600_protect_archived_student_allocations.sql`, and `20261015000700_platform_admin_and_central_providers.sql`.
- `supabase db push --dry-run --linked`: **PASS**; it identified exactly those eight migrations.
- Approved `supabase db push --linked`: **BLOCKED** at the first migration's statement 0. Its guard reported `Supabase Vault is required before configuring payment credentials`; no migration was applied. The migration history remained unchanged, and read-only catalog preflight still showed the 140003 credential objects and 150007 platform-admin objects absent. Enable/verify the required Vault objects on the test project before retrying; do not bypass the guard or skip migrations.
- Production project `cjuneqmohdivjioulyqq` was not queried or modified. The financial 47-assertion suite previously passed only against the seven already-applied migrations; it does not verify the eight pending migrations.

## Test migration and finalization update (2026-10-15)

This section supersedes the migration and test status above. Only test project `xabfsqtevwnwtxxkmkvc` was queried or changed; `.env.local` and the Supabase CLI link still point there. Production `cjuneqmohdivjioulyqq` was not connected or modified.

- Found the migration guard mismatch: the installed Supabase Vault functions have trailing optional UUID parameters. Updated the guards in `20261014000300_secure_payment_provider_credentials.sql` and `20261015000700_platform_admin_and_central_providers.sql` to check the actual four- and five-argument signatures. No already-applied migration was edited.
- Applied the eight pending migrations in chronological order: `20261014000300`, `20261015000100`, `20261015000200`, `20261015000300`, `20261015000400`, `20261015000500`, `20261015000600`, `20261015000700`. Read-only migration listing now shows all **15/15** local versions applied remotely. The 15000500 file remains an explicit no-op. No duplicate version prefixes were found.
- Test schema checks: 37 BizBook tables/views, 70 validated foreign keys, 48 public RLS policies, RLS enabled on every public BizBook table, and no invalid indexes or unvalidated constraints. Thirty-five application routines were inventoried; application `SECURITY DEFINER` routines use a fixed `search_path` and are not executable by `anon`. A platform-owned `public.rls_auto_enable()` routine still reports effective `anon` EXECUTE; whether that event-trigger routine is exposed through RPC was not established, so its ACL should be confirmed with Supabase before changing it.
- `supabase db lint --linked --project-ref xabfsqtevwnwtxxkmkvc`: **PASS**, no schema errors.
- `bizbook_financial_guards_remote.test.sql`: **PASS 47/47** against the migrated test project. The SQL uses synthetic fixtures inside a transaction and ends with `ROLLBACK`; a post-run collision check returned no rows.
- Added and ran `platform_admin_central_providers_remote.test.sql`: **PASS 30/30**. The project does not have pgTAP installed, so this adapter uses temporary `pg_temp` assertion helpers; all helpers and result tables were in the same rolled-back transaction. It verified central credential grants, platform RLS, tenant-consistent subscription/payment foreign keys, indexes, and the legacy notification-writer revocation.
- Platform-admin account state is **not provisioned**: the table currently contains zero platform administrators, zero plans, and zero subscriptions. `/platform-admin` now shows a clear fail-closed “access is not provisioned” state. There is no default account or browser bootstrap; a trusted service-role operator must first verify the intended Auth user and provision the role. Institute management and plan/subscription workflows are still not implemented.
- Local tests: all **14** `lib/**/*.test.ts` suites passed (**102 assertions**); BizBook Brain passed **88/88**; `npx tsc --noEmit` passed; targeted ESLint for platform-admin UI/API passed; `npm run build` passed and generated **41** routes. Full `npm run lint` remains **FAIL** with **14 errors and 17 warnings**, predominantly the existing React hook `set-state-in-effect` rule in browser-backed legacy pages.
- Remaining application blockers: payment create-order, verification, and webhook routes still return HTTP 501; Cashfree webhooks, online refunds, subscription payment collection/reconciliation, and provider-confirmed refund completion are unavailable. No external provider requests, real payments, or real messages were sent. Attendance, payroll, business profile, and several payment/student workflows still rely on localStorage or have separate shared modes; there is no reviewed legacy import. A shared branch switcher and complete platform-admin account/subscription operations are absent.

**Production readiness remains NO-GO.** The test migration and database checks now pass, but the platform role is unprovisioned and the missing application workflows and lint failures remain. Production migration/connection requires separate approval and a verified backup/restore plan; this update did not access production.

## Database, Brain, and Platform Admin continuation (2026-10-16)

- Verified the CLI link and `.env.local` URL host as test project `xabfsqtevwnwtxxkmkvc` before queries. `supabase migration list --linked` reports **18/18** local versions applied. This continuation did not reapply migrations. `supabase db lint --linked` passes with no schema errors.
- Five remote suites used transaction-scoped synthetic fixtures and rolled back: financial/tenant/branch guards **47/47**, student records and allocations **38/38**, central provider security **30/30**, platform-admin operations and limits **26/26**, and provider-check authorization/audit **8/8**. Total **149/149**. Post-run aggregate checks report zero student/staff/branch/platform fixture rows.
- Applied test-only migrations `20261015000800_platform_admin_operations_and_limits.sql`, `20261015000900_platform_provider_sandbox_verification.sql`, and `20261015001000_restore_branch_scope_after_suspension.sql`. The last restores the null-branch denial for branch-scoped users while honoring institute suspension. Its financial isolation regression suite passes.
- Platform Admin now has server/database-authorized directory and status changes, admin role management with last-owner protections, first-owner service-role provisioning, plans, subscription assignment, open invoice creation, payment attempt and audit views, and DB trigger enforcement for plan limits. No default admin/browser bootstrap exists. Test database has no platform admin, plan, subscription, invoice, payment-attempt, or provider rows. Provisioning remains gated on a verified Auth user and service-role secret.
- `/business/salary` now offers separate shared payroll read/write backed by tenant/branch RLS and `record_salary_payment`; amount is recomputed server-side and in the SQL RPC, and unique staff/month prevents double payment records. Existing localStorage mode is still the default. Staff management and attendance entry remain browser-backed.
- Verified locally: TypeScript **PASS**; Brain **88/88**; 15 Supabase unit test files **107 assertions PASS**; full ESLint **PASS** with 17 warnings and 0 errors; production build **PASS** (44 generated pages/routes). Changed financial/database screens pass targeted ESLint.
- Unfinished: payment order creation/verification and Razorpay/Cashfree webhook routes are HTTP **501**; no provider credentials or server-only service-role key are configured. No real or sandbox payment/message was attempted. Subscription invoice settlement/reconciliation, provider-confirmed refunds, platform support/health operations, localStorage import, shared attendance/staff CRUD, and unapproved penalty/subscription-revenue policies remain unresolved.
- Production `cjuneqmohdivjioulyqq` was not connected, queried, or modified. Production audit remains the 2026-10-14 snapshot; backup/restore readiness is not demonstrated. Recommendation remains **NO-GO**.

## Final test-project verification (2026-10-16)

- Reverified the CLI link and `.env.local` public URL against test ref `xabfsqtevwnwtxxkmkvc`; no secret values were printed. Read-only migration history confirms **19/19** repository migrations applied. `supabase db lint --linked` passes with no schema errors.
- Reran all five remote SQL suites after migration `20261015001100_attendance_staff_branch_integrity.sql`: financial/tenant/branch guards **48/48**, student operations **38/38**, central provider security **30/30**, platform-admin operations/limits **26/26**, and provider-check authorization/audit **8/8**. **150/150 PASS**. Each file was checked to begin a transaction and end with `ROLLBACK`; all synthetic writes were rolled back.
- The financial suite now specifically confirms attendance rows cannot reference a branch different from the staff member's assigned branch. The additive trigger migration does not backfill or rewrite existing data.
- Production project `cjuneqmohdivjioulyqq` was not accessed. Its compatibility report remains historical; production readiness remains **NO-GO**.

## Shared staff, attendance, and final database checks (2026-10-16)

- Added migration `20261015001200_secure_staff_compensation_reads.sql`: authenticated users can read directory columns, while salary columns are available only through `list_staff_compensation`, which checks active institute finance membership and accessible branches. Payroll API and shared staff UI now use that function. Existing `legacy_data` is not overwritten by edits.
- Added migration `20261015001300_reject_future_attendance.sql`: attendance records after the institute-local business date are rejected by the database. Neither migration rewrites existing business rows.
- `/business/students` now has separate shared-database staff list, create, edit, and archive operations; salary-payment entries remain in Payroll. `/business/attendance` now offers an explicit shared mode with institute/branch/month filters, idempotent attendance upserts, Holiday corrections instead of row deletion, and institute-time-zone date handling. Existing browser/localStorage mode and keys remain available and are not imported or merged.
- Test project preflight verified reference and URL `xabfsqtevwnwtxxkmkvc`. Read-only migration history confirms **21/21** applied; linked database lint reports no schema errors. Seven rollback-only SQL suites passed **163/163** assertions: financial/RLS 48, student operations 38, central provider security 30, platform-admin operations/limits 26, provider-check audit 8, salary-column privacy 9, and future attendance guard 4.
- Final local checks: `npx tsc --noEmit` **PASS**; Brain **88/88 PASS**; 15 Supabase helper suites **107 assertions PASS**; full lint **PASS** (0 errors, 17 warnings); production build **PASS** (44 routes).
- No external provider call, payment, message, or production query/write occurred. Checkout and payment verification/webhooks remain HTTP 501; provider and service-role credentials are not configured. Shared attendance/staff were build- and database-policy-verified, but no signed-in browser E2E was run because the test project has no supplied user session.

Production `cjuneqmohdivjioulyqq` remains untouched. Its compatibility assessment is still the historical 2026-10-14 snapshot; backup restore has not been demonstrated. Recommendation remains **NO-GO** for production connection or migration.

## Shared outstanding and overdue database reports (2026-10-16)

- Added opt-in shared database modes to `/payments/outstanding` and `/payments/overdue`. Both read the canonical `installment_balances` view, apply the selected institute/branch scope, restrict the UI to owner/administrator/accountant memberships, and retain archived students with historical balances. The view is security-invoker and database RLS remains the authorization boundary.
- Overdue classification uses the selected institute's business date and includes partially paid installments with a remaining balance. UI aggregation uses integer paise; it does not reconstruct receipt totals or count advance allocations as new inflows. Existing browser/localStorage mode remains available and unchanged.
- The authorized test project was verified immediately before database checks: CLI project reference and `.env.local` public URL host both resolve to `xabfsqtevwnwtxxkmkvc`. Read-only migration history reports **21/21** repository migrations applied. A catalog-only remote query confirmed the expected `installment_balances` fields. Linked database lint passed with no schema errors; no migration or data write was run in this continuation.
- New balance-report helper tests passed **13/13**. TypeScript passed; BizBook Brain passed **88/88**; all **16** Supabase helper test files passed (**120 assertions**); full ESLint passed with **0 errors and 17 warnings**; production build passed and generated **44 routes**.
- No browser-authenticated end-to-end RLS session was exercised for these new screens. Test-project SQL security suites are recorded above; UI reads rely on the authenticated browser client and the existing RLS policies.
- Remaining blockers for production **GO**: payment create/verify/webhook endpoints still return HTTP **501**; the provider adapter, trusted verification and webhook processing are not implemented yet, and frontend gateway activation is deferred; no provider sandbox was exercised; the first Platform Admin remains unprovisioned; subscription invoice settlement/reconciliation and support/health workflows remain unfinished; no shared global persisted branch selector or reviewed localStorage import exists; production compatibility is still the historical read-only snapshot and backup restore is unproven.

## Shared branch selector continuation (2026-10-16)

- Added a prominent, responsive institute and branch selector to the shared workspace shell and dashboard. It loads active institute memberships and RLS-visible active branches from Supabase, saves the preference under a new user-scoped convenience key, and validates any restored choice against the current authenticated membership and accessible branch list. The stored value does not grant access.
- Institute-wide memberships can select “All accessible branches”; branch-scoped memberships must select an assigned active branch. The selector shows loading, access errors, a retry action, and unsaved-form blockers. Platform Admin remains in its separate protected shell.
- Bound the existing shared student, attendance, payroll, receipt, advance allocation, refund, payment-history, expense, dashboard, and financial-summary filters to the shared selection. Results are hidden and new reads/writes are gated while the local page scope catches up. Database RLS and server-side authorization remain the security boundary. Browser/localStorage modes and legacy keys remain unchanged.
- Changed root metadata from the Next.js starter text to BizBook branding.
- Current focused verification after these changes: `npx tsc --noEmit` **PASS**; targeted ESLint for the touched workspace/shared-data files **PASS**; `npm run build` **PASS**, generating 44 app routes. The workspace branch-access unit suite was already **6/6 PASS** before this continuation and was not repeated, per instruction. No SQL or provider calls were made.
- Limitation: this does not migrate localStorage-only workflows or provide an authenticated browser E2E proof. The shared selector uses a local user-scoped preference, while every database request still depends on database policy enforcement. Browser-backed profile and legacy payment/attendance screens remain separate modes.

Production remains **NO-GO**. Payment create/verify/webhook routes still return HTTP 501, the first platform administrator is unprovisioned, subscription invoice settlement/reconciliation and support/system-health workflows remain incomplete, provider credentials and sandbox verification are absent, legacy import is not implemented, and production backup restoration is unproven.

## Online payment backend continuation (2026-10-16)

- Replaced the four HTTP 501 payment endpoints with test-project-only Razorpay/Cashfree order creation, Razorpay signature and server-status verification, and signed/idempotent webhook handling. Provider secrets are resolved server-side through Vault and never returned to the browser. No frontend checkout was enabled and no provider request or payment was made.
- Added migrations `20261016000100_online_payment_operations.sql`, `20261016000200_online_payment_order_retry_recovery.sql`, and `20261016000300_ignore_stale_payment_events.sql`. They add intent/allocation fields and server-only finalization RPCs, make in-flight idempotent retries return the same intent, and ignore stale pending/authorized events after terminal failure/cancellation. All three migrations are applied to test project `xabfsqtevwnwtxxkmkvc`; the test project has 24/24 local migration versions applied. Production `cjuneqmohdivjioulyqq` was not accessed.
- The rollback-only online-payment SQL suite passed **25/25** assertions on the test database. It verifies RLS role grants, exact fee/advance receipt accounting, allocation reservations, idempotency, captured-only receipts, duplicate-event protection, stale-event handling, reconciliation, and audit records. Synthetic Auth/business fixture counts were zero after the run.
- Local provider adapter tests passed **18/18** mocked assertions; HMAC/signature and amount-core tests passed **17/17**. BizBook Brain passed **88/88**. The branch-selector suite was run this phase and passed **6/6**. These do not substitute for a provider sandbox transaction or authenticated browser E2E.
- At this 2026-10-16 checkpoint, the student/parent checkout UI was not implemented. The parent-link workflow was added later in the 2026-10-17 section. Online refunds and BizBook subscription billing remain unimplemented; a service-role variable name exists locally but its validity is unverified, and provider test credentials are absent. Razorpay order creation timeouts require manual reconciliation before retry, while Cashfree recovery can look up its deterministic order ID.
- Platform Admin still has no first provisioned administrator. Existing institute/plan/subscription assignment, open-invoice, provider settings and role-management operations are database-backed. A read-only health section reports the latest database RPC status/latency, test-project guard, and whether the server-role secret is present (not whether it is valid). Invoice settlement/reconciliation and support requests remain incomplete. No plans or subscriptions are present in the test project.
- Business data remains split between explicit shared-database modes and preserved browser storage. `/business/profile`, the legacy business overview, legacy attendance/payroll/fee/payment/refund workflows, and default student/receipt/advance/history screens still use localStorage. Shared paths exist for several of these, but no reviewed legacy import or reconciliation workflow exists.
- Latest checks for this continuation: TypeScript **PASS**; targeted payment provider tests **PASS**; full lint and production build are reported in the final readiness update. Linked Supabase lint completed without schema errors; its output included an unused-variable warning before the corrective terminal-state migration and will be checked again.

Production remains **NO-GO**: production was not inspected during this continuation, production backup/restore readiness is unproven, no live payment path exists, and the Platform Admin is not provisioned.

## Staff legacy-profile import continuation (2026-10-17)

- `/settings/data-import` now independently previews and imports eligible legacy staff directory profiles/current compensation settings. It requires institute-wide owner/admin access, a target branch choice, and explicit profile-only confirmation. Any linked attendance or salary-payment history, invalid amount/date/contact/configuration, duplicate staff IDs, or unmapped branch is held for review. It never imports attendance, leave balances, or salary-payment transactions, never uploads raw source rows, and never deletes source browser keys.
- Added `20261017001300_safe_legacy_staff_import.sql`, applied as the only pending migration to test project `xabfsqtevwnwtxxkmkvc`. Migration history confirms **39/39** local versions applied; linked database lint reports no schema errors.
- The new rollback-only SQL suite passed **17/17** assertions for mapping-table RLS/grants, owner success, branch and accountant denial, cross-institute visibility, exact retry, changed-source rejection, audit metadata, and no attendance/payroll rows. Aggregate post-run counts for the fixture institute are zero.
- Local verification after page integration: `npm test` **PASS** (37 local files plus Brain **88/88**), TypeScript **PASS**, full ESLint **PASS**, and production build **PASS** (65 routes). No real browser data was inspected or imported.
- This does not complete legacy reconciliation or remove localStorage history. Profile/logo, financial histories, attendance/payroll histories, imports for expenses/refunds/receipts/advances, and a signed-in browser import journey remain open. Production stays **NO-GO**.

## Local persistence retirement (2026-10-16)

- Removed active browser-backed modes from students/staff, attendance, salary, expenses, manual receipt entry, advance allocation, payment history, and outstanding/overdue reports. `/business` now redirects to the shared student/staff workspace. The profile editor now reads/writes `coaching_institutes`; logos use a private Storage bucket with membership-scoped read and manager-only write/delete policies.
- Workspace branch selection is memory-only. Sidebar alerts no longer derive finance state from localStorage.
- Applied test migration `20261016000400_shared_business_profile.sql` after verifying both the linked CLI reference and `.env.local` URL host were `xabfsqtevwnwtxxkmkvc`. Read-only catalog queries confirmed the migration ledger row, `logo_path`, the private 1 MiB image bucket, and all four Storage policies. Production was not accessed.
- Existing browser keys and stored records were not removed or imported. The Brain compatibility adapter remains in `lib/bizbook-brain` but has no application-screen callers. A reviewed per-institute legacy export/import and duplicate-reconciliation flow remains outstanding.
- `npx tsc --noEmit`: **PASS** after the route changes. Supabase `db push` applied only the new profile migration. Migration-list and linked-lint commands could not authenticate to Postgres because `cli_login_postgres` password authentication failed; direct read-only Management API SQL queries confirmed the deployed migration objects.

## Finalization, build repair, purple theme, and reporting pass (2026-10-16)

This section records the finalization pass on the existing working tree. No production project was accessed. Database work targeted the test project `xabfsqtevwnwtxxkmkvc`; the linked CLI reference and the `.env.local` public URL host were both verified before any command.

### Build repair (root cause)

- The production build failed with `Next.js encountered the unstable value 'new Date()' in a Client Component` while prerendering `/business/salary` and `/expenses`. With `cacheComponents: true` in `next.config.ts`, evaluating `new Date()` during the initial render of a client component is rejected by Next 16.
- Added `lib/business-date.ts` with pure, SSR-safe helpers `dateInTimeZone`, `monthInTimeZone`, `safeTimeZone`, and `isValidTimeZone`. These are only called from effects, event handlers, and async callbacks — never during render — and use the selected institute's IANA time zone (default `Asia/Kolkata`).
- `SharedPayrollWorkspace.tsx`: the payroll month now initializes empty and is defaulted in a client effect from the institute time zone; the loader waits for a valid month. `SharedExpensesWorkspace.tsx`: the summary month and form date now default in a client effect and in `beginCreate`, using the institute time zone. No hardcoded fallback date is used.
- The existing synchronous `setState` calls in those components (and in `app/business/profile/page.tsx`) were deferred with the repository's established `void Promise.resolve().then(...)` pattern to clear `react-hooks/set-state-in-effect`.

### Frontend and theme

- Applied a purple brand theme. Replaced every brand navy (`#18375D`, `#102c4c`, `#214c7a`, `#3d638d`, `#315d8a`) and brand red accent (`#d8232a`, `#bd1e24`) with the violet family (`#5B21B6`, `#4C1D95`, `#6D28D9`, `#7C3AED`), converted all `blue`/`indigo`/`cyan` Tailwind utilities to `violet`/`purple`, and updated the shadcn design tokens in `app/globals.css` (`--primary`, `--ring`, `--accent`, `--sidebar-*`, chart palette) to a matching purple scale. Semantic danger (`rose`/`red`) success (`emerald`) and warning (`amber`) colors were intentionally preserved.
- Added `/reports/profit-loss`, a real report derived from `financial_activity_summary` and `installment_balance_summary`: net collected revenue (fee + advance receipts less completed refunds), total expenses (payroll + business expenses), realized net profit, and potential profit (collected + outstanding less expenses). It reuses `buildDashboardFinancialSummary` so no financial calculation is duplicated.
- Removed the remaining sidebar links that resolved to no route (`/reports/revenue-expenses`, `/reports/collection-forecast`, `/reports/comparisons`, `/settings/subscription`, `/settings/account`). Every remaining sidebar destination now resolves to an existing page.

### Student CSV export fix

- Corrected a column misalignment: the header row declared 15 columns (including Parent/Guardian Name) while each data row emitted 14 values, shifting every field after "Gender". The row now includes `parentName`.
- Added spreadsheet formula-injection protection (fields starting with `=`, `+`, `-`, `@`, TAB, or CR are prefixed with `'`).
- Corrected the byte-order-mark: the literal `"\\uFEFF"` string was replaced with a real `"\uFEFF"` escape.
- Extracted `escapeCsvCell`/`toCsv` into `lib/csv.ts` with a new `lib/csv.test.ts` regression suite.

### Verification (this pass, on this working tree)

- `npx tsc --noEmit`: **PASS** (exit 0).
- `npx eslint .`: **PASS** with **0 errors and 8 warnings** (pre-existing unused-variable warnings only).
- `npx tsx lib/bizbook-brain/test-cases.ts`: **88/88 PASS**.
- `npx tsx lib/csv.test.ts`: **12/12 PASS**.
- All **19** `lib/supabase/*.test.ts` helper suites: **PASS** (exit 0).
- `npm run build`: **PASS**, exit 0, **45** routes generated, no prerender errors.
- Test database: `supabase migration list --linked` shows **25/25** local migrations applied with no local/remote drift; `supabase db lint --linked` reports **no schema errors**. The remote SQL assertion suites were not re-run in this pass because this environment has no direct SQL channel (no service-role secret, no local Docker); their earlier recorded results are unchanged.

### Not changed

- No production project was queried, modified, or migrated. No secrets were printed. Existing browser-backed data was not imported or deleted. No financial business rule was altered; the changes are limited to build correctness, SSR-safe date handling, the purple theme, one new read-only report route, sidebar link hygiene, and the CSV export fix.

## Independent browser and security verification (2026-10-16)

Real browser automation was executed with `playwright-core` (installed outside the repository in a temp prefix) driving the system Google Chrome against the production build served on `http://127.0.0.1:3100`. No repository dependency was added and no file in `package.json`/`package-lock.json` was changed for this.

- **Viewports:** desktop 1440x900, tablet 834x1112, mobile 390x844.
- **Routes probed:** `/login`, `/dashboard`, `/business/students`, `/business/salary`, `/business/attendance`, `/expenses`, `/payments/advance`, `/reports/profit-loss`, `/platform-admin`, `/setup`.
- **Observed:** `/login` returns 200 at every viewport; every other listed route returns a **307 redirect to `/login?next=...`** while unauthenticated (correct auth gating). Across all routes and viewports there were **0 console errors, 0 failed network requests, and 0 horizontal overflow** (`scrollWidth == clientWidth`).
- **Login form:** the browser-native `required` validation fires on empty submit; an invalid email + short password submission stays on `/login`. No client error surfaced.
- **Unauthenticated API probes:** `GET /api/expenses` and `GET /api/payroll` return **401** `{"error":"Authentication is required."}`.
- **Integration route probes (fail closed):** `GET /api/cron/reminders` → 401; `POST /api/payments/webhook` → 401 (payload invalid); `POST /api/webhooks/cashfree` → 401 (payload invalid); `POST /api/payments/create-order` → 401; `POST /api/notifications/email` → 401; `GET /api/platform-admin/providers` → 401.
- **Anonymous RLS probes (read-only PostgREST with the publishable key):** the `anon` role receives `42501 permission denied` for **every one of the 16 core tables and all 7 views**, and `42501 permission denied for function` for `save_student_record`, `record_manual_payment`, `allocate_advance`, `request_refund`, `create_coaching_institute`, and `is_platform_administrator`. This independently confirms anonymous tenant data and financial RPCs are not reachable without an authenticated session.
- **Authenticated browser E2E is BLOCKED.** `GET /auth/v1/settings` reports `mailer_autoconfirm: false`; the test project requires email confirmation, no SMTP is configured, and no confirmed test account was supplied. Sign-up therefore cannot yield a usable session, so authenticated pages, forms, payment recording, and RLS tenant-isolation between two institutes could not be exercised. Reproducible steps are recorded in the verification checklist.
- **Live policy enumeration is BLOCKED.** `supabase db dump --linked` fails because it requires Docker, which is unavailable/prohibited. RLS policy expressions were reviewed from the migration source (`20261013000400_bizbook_rls_and_privileges.sql` and later migrations) rather than the live catalog.

Additional financial coverage added this pass: `buildProfitAndLoss` (collected revenue, total expenses, net profit, potential profit) was extracted into `lib/supabase/dashboard-summary.ts` and covered by `lib/supabase/profit-summary.test.ts` (**7/7 PASS**); the profit-loss page now calls it so the report and tests share one formula.

## Database-only business screens and final verification (2026-10-17)

- Active business screens no longer use browser localStorage for business or financial records. `/business` redirects into the shared student workspace; student/staff, attendance, payroll, profile, expenses, receipts, advance allocations, refunds, payment history, outstanding/overdue balances, dashboard, and reports use their shared Supabase workflows. The old Brain storage adapter and legacy service code remain for compatibility/regression tests, but active app routes no longer call them.
- The branch selector's chosen scope is held in memory and revalidated from authenticated memberships/accessible branches; it is no longer persisted in browser storage.
- `/business/profile` now reads/writes institute details in Supabase and stores logos in a private, institute-scoped Storage bucket. Logo file type/size limits are enforced by the screen and bucket. The update reports success only when RLS returns the updated institute row.
- Applied `20261016000400_shared_business_profile.sql` and `20261016000500_grant_institute_logo_path.sql` to test project `xabfsqtevwnwtxxkmkvc`. Read-only linked migration history confirms **26/26** repository migrations applied; linked schema lint passes. A read-only query returned `logo_path_update_granted=true` and `migration_applied=true`.
- Legacy browser data was not deleted, imported, merged, or overwritten. It remains in the browser and the compatibility adapter; no controlled import/reconciliation procedure exists yet, so users should export or preserve any old browser-only records before clearing site data.
- Final local checks after the profile and routing changes: TypeScript **PASS**; full ESLint **PASS** (0 errors, 0 warnings); production build **PASS** (45 generated pages); 20 Supabase helper suites plus CSV tests **PASS** (21 files, 180 assertions); BizBook Brain **88/88 PASS**.
- The final pass did not rerun the remote financial SQL suites or authenticated browser E2E. Authenticated test accounts, SMTP/SMS setup, provider sandbox credentials, and service-role secret were not supplied. No provider payment/message call was made. Production project `cjuneqmohdivjioulyqq` was not accessed.

**Release verdict remains BLOCKED / production NO-GO.** Remaining release-critical work includes a reviewed migration path for legacy browser data, authenticated cross-tenant browser E2E, current production compatibility review, demonstrated backup/restore, first platform-admin provisioning, unfinished subscription settlement/support workflows, and provider sandbox/end-to-end verification. Live payment and notification sending remain unavailable.

## Full audit and final test-project continuation (2026-10-17)

This section supersedes historical migration counts, 501 statuses, localStorage screen-mode notes, and platform-admin account state above.

- The repository inventory contained **268 files** at the start of the prior audit; the three missing report destinations have since been added. The latest build enumerates **48 routes**. Active screens use Supabase for persistent business records; old browser keys remain untouched and no import or cleanup was run. Remaining missing sidebar workflows are subscription/account settings and institute member/branch assignment management.
- Verified test-only migration `20261017000100_restrict_trigger_function_execute.sql` was applied after rechecking both `.env.local` and the CLI link against `xabfsqtevwnwtxxkmkvc`. Read-only history and catalog show **27/27** migrations applied. Schema lint passes.
- Final catalog counts: 30 public tables all with RLS enabled, 48 policies, 72 validated foreign keys, seven `security_invoker` views, zero invalid indexes/unvalidated FKs, zero application `SECURITY DEFINER` routines executable by `anon`, and zero without fixed `search_path`.
- The catalog audit found four privileged trigger functions with inherited `PUBLIC` execution. The new migration revokes public/anonymous access and retains authenticated/service-role grants for attached triggers. No data table was deleted or rewritten. The platform-managed `public.rls_auto_enable()` event-trigger ACL remains unchanged; direct RPC exposure was not established.
- Eight rollback-only remote SQL suites passed **190/190** after the final migration: attendance/date 4, financial/RLS 48, online payments 25, central providers 30, platform operations 28, provider verification audit 8, compensation privacy 9, and student operations 38. The suite now accommodates one pre-existing platform-admin row without deleting or replacing it. Fixture collision check returned no rows after the run.
- Test database aggregate status: one existing platform-admin row and one platform audit event; zero plans, subscriptions, invoices, payment attempts, and provider connections. No user UUID/email or business records were read. The platform-admin identity and authenticated console access remain unverified.
- Shared payroll now calls BizBook Brain `calculateSalary` and rejects fractional paise, malformed attendance, and duplicate staff/date inputs. The database RPC remains the final amount/retry authority. Payroll suite passes 7/7; targeted ESLint and TypeScript pass after this edit.
- All 21 helper/CSV test files passed after the latest code change: **182 checks**; Brain passed **88/88**. Final full ESLint passed with zero errors and warnings; TypeScript passed; optimized build passed with 45 routes. `npm audit --omit=dev` reports zero production dependency vulnerabilities. Full audit still reports nine high findings in development/build tooling through unpatched `braces@3.0.3`; no breaking shadcn major downgrade was applied. Authenticated two-institute browser E2E, real provider sandbox, message delivery, production comparison, and backup restore were not run.
- A test-project server-only service-role secret was present in ignored `.env.local`, then exposed in tool output and removed locally. Rotate/revoke it before configuring a replacement. No provider credentials were present in the platform provider table by aggregate count.
- Production `cjuneqmohdivjioulyqq` was not connected, queried, or modified. The production compatibility report remains historical and backup/restore readiness remains unproven.

**Release verdict: BLOCKED / production NO-GO.** See [full-website-audit.md](full-website-audit.md), [database-promotion-plan.md](database-promotion-plan.md), [legacy-data-migration.md](legacy-data-migration.md), and [production-readiness-report.md](production-readiness-report.md) for exact gates and remaining actions.

## Report route completion (2026-10-17)

- Added `/reports/revenue-expenses`, `/reports/comparisons`, and `/reports/collection-forecast` to the existing report navigation. They read the existing security-invoker summary/balance views and use the selected authorized institute/branch scope; no migration or data write was needed.
- Report helper tests pass **5/5** for exact paise arithmetic, canonical category treatment, month boundaries, 90-day bucket boundaries, and undated installments. The latest run passes **22 helper/CSV suites (187 checks)** and Brain **88/88**; TypeScript, full ESLint, and the optimized build pass. The build enumerates **48 routes**.
- The collection forecast is based on scheduled due dates and current outstanding balances; it does not claim predicted receipts. No authenticated browser E2E was run.

## Platform support and final regression continuation (2026-10-17)

- Added `/support` for institute members and a support inbox section in `/platform-admin`. Both use authenticated, server-side test-project APIs; institute RPCs enforce active membership and ticket visibility, while platform queue/state operations require a database-recognized platform role. The workspace selector provider is enabled on `/support`.
- Added test migrations `20261017000200_platform_support_workflows.sql` and the forward corrective `20261017000300_correct_support_ticket_rate_limit.sql`. The correction preserves the already-applied migration and makes the 10-ticket daily cap atomic, permits idempotent retry at the cap, and rejects the next new ticket. Remote support/RLS/idempotency/audit suite: **29/29 PASS**, transaction rolled back; post-run counts for synthetic Auth users, institutes, tickets, and messages are **0**.
- Rechecked test project `xabfsqtevwnwtxxkmkvc` before writes. Read-only migration history: **29/29 applied**. Database lint: **PASS**. Current catalog: 32 public tables (all RLS), 50 policies, 76 validated foreign keys, 7 `security_invoker` views, no invalid indexes, and no application `SECURITY DEFINER` functions callable by `anon` or missing a fixed search path.
- Full local verification after support UI/API: **23/23 local helper/CSV suites (195 checks) PASS**; Brain **88/88 PASS**; TypeScript **PASS**; full ESLint **PASS**; production build **PASS**, generating **51 routes**.
- Support has no email/WhatsApp notification, response SLA automation, attachment workflow, or authenticated browser E2E evidence. The first platform-admin identity remains uninspected; support inbox operations passed database policy and rollback SQL tests only.
- Production `cjuneqmohdivjioulyqq` was not accessed. Provider sandbox, authenticated cross-tenant browser tests, legacy-data import/reconciliation, current production compatibility, and verified backup restoration remain blockers. **Production remains NO-GO.**

## Subscription visibility and audit continuation (2026-10-17)

- Added a read-only `/settings/subscription` route for institute-wide owners/admins. It shows only the assigned database plan, subscription dates/status, invoices, and safe payment-attempt metadata; it does not enable subscription billing or reconciliation. A missing subscription is shown as missing, not as a fake trial.
- Added `subscription-access.test.ts` (**11/11**) and rollback-only `platform_subscription_visibility_remote.test.sql` (**9/9**). The SQL suite checks two institutes, owner access, cross-tenant denial for subscriptions/invoices/payment attempts, and denial to an accountant and branch-scoped owner. Post-run aggregate residual counts are all **0**.
- Added `schema_catalog_summary_readonly.sql`; current test catalog reports 32/32 public tables with RLS, 50 policies, 76 validated FKs and none unvalidated, seven security-invoker views, zero invalid indexes, zero anonymous-executable application SECURITY DEFINER functions, zero such functions lacking a fixed search path, and one private logo bucket with four storage policies.
- Test migration history remains **29/29 applied**; no schema migration was needed. All ten rollback-only remote suites pass **228/228**. Current local verification passes **24 helper/CSV suites (206 checks)**, Brain **88/88**, TypeScript, full ESLint, and build (**52 routes**).
- The signed-in institute billing page was not browser-tested. Subscription payment collection and settlement remain absent. Production and backup/restore gates remain unchanged; **NO-GO**.

## Member permissions and final audit continuation (2026-10-17)

- `/business/members` uses the existing membership, branch-grant, and deactivation RPCs; no migration or direct membership-table write was added. Access helper tests pass **17/17**.
- Its edit dialog now blocks institute/branch switching until save or dismissal, avoiding a pending permission edit being applied to a newly selected workspace.
- The dedicated test-project SQL suite passed **13/13** inside a transaction ending with `ROLLBACK`. It verified authenticated-only grants, owner/admin role limits, self-change denial, cross-institute branch denial, deactivation, and reactivation. A post-run aggregate query found zero synthetic Auth users. Test migration history remains **29/29**.
- Final local verification: **25/25 helper/CSV suites (223 checks) PASS**, Brain **88/88 PASS**, TypeScript **PASS**, full ESLint **PASS**, production build **PASS** with **53 routes**. `npm audit --omit=dev` reports zero production dependency vulnerabilities; nine development/build-tool findings remain.
- Member management requires an existing Auth UUID; account invitations are not implemented. No signed-in browser E2E was run. Existing legacy browser records remain untouched; controlled import/reconciliation is missing.

**Release remains BLOCKED / production NO-GO.** Authenticated browser isolation, provider sandbox evidence, checkout UI, provider-backed refunds/subscription settlement, legacy reconciliation, current production compatibility, and backup restoration remain outstanding.

## Test-only installment checkout UI continuation (2026-10-17)

- Added a finance-authorized sandbox checkout panel to shared receipt records for an active student's selected fee installment. It sends the exact outstanding amount to the existing authenticated order API; database authorization, balance reservations, and exact allocation checks remain authoritative. Razorpay launches its test checkout and submits the signed response to server verification. Cashfree launches its sandbox SDK and then queries server-side payment status; Cashfree's browser completion/redirect is never treated as proof.
- Added `/api/payments/sync` for authenticated institute finance staff to retrieve Cashfree order payments and post only provider-confirmed captured amounts through the service-role RPC. Ambiguous multiple successful attempts require reconciliation. Added a status retry control when checkout returns pending or redirects.
- Provider adapter tests pass **23/23** and Cashfree result-selection tests pass **5/5**. The complete local helper/CSV suite passes **26 files / 233 checks**; Brain passes **88/88**; TypeScript and full ESLint pass; production build passes with **54 routes**. No provider credentials were available, so no provider API, sandbox checkout, real payment, authenticated browser E2E, or remote database write was performed.
- At this 2026-10-17 checkpoint, the staff-started checkout UI had no public parent link; the subsequent “Parent checkout links and payment capture reconciliation” section records its implementation. Provider sandbox verification remains blocked on real test credentials, a valid server-side service-role configuration, and a signed-in test account. No schema migration was needed at that earlier checkpoint.
- At this checkpoint, a fresh linked migration-list invocation stalled, so 29/29 was the prior known state. The later parent-link verification checked migration history again and confirmed 31/31. Production remained untouched.

**Release remains BLOCKED / production NO-GO.** The implementation is test-only and the provider lifecycle remains unverified against provider sandbox credentials.

## Online provider refund continuation (2026-10-17)

- `/payments/refunds` now supports separate manual and online refund paths. Online requests require the existing authorized test-mode institute connection, reserve refund capacity through `request_online_refund`, and are submitted/reconciled by the authenticated `/api/payments/refunds/submit` endpoint. The endpoint verifies institute/branch finance access, loads credentials server-side from Vault, and persists only a provider response matching the exact payment, order, amount, currency, and refund reference. The client cannot mark an online refund completed.
- Added `20261017000600_online_refund_operations.sql`; it is applied as migration **32/32** on test project `xabfsqtevwnwtxxkmkvc`. Its rollback-only remote SQL suite passed **24/24** assertions for grants, tenant authorization, reservation/idempotency, over-refund prevention, exact provider matching, status transitions, audit events, and receipt accounting. Post-run aggregate fixture counts are zero. Linked schema lint passed.
- The provider adapter uses Razorpay's refund idempotency header and Cashfree's idempotency key; provider status lookup is server-side. Unit checks: payment/refund provider adapter **40 assertions PASS**, refund planning **8/8 PASS**. TypeScript, full ESLint, production build, and `git diff --check` pass; the build enumerated **59 routes**.
- No Razorpay or Cashfree credentials were supplied; no provider API call, sandbox refund, or browser-authenticated E2E was run. Pending refunds require a finance user to explicitly retry/check provider status; refund webhooks and scheduled status reconciliation are not implemented. Provider-backed subscription billing, current production compatibility, and backup/restore demonstration remain outstanding. Production project `cjuneqmohdivjioulyqq` was not accessed.

**Release verdict remains BLOCKED / production NO-GO.** Test database and code paths are verified at the SQL and mocked-adapter levels, but no actual provider refund, authenticated browser journey, production comparison, or restore drill has been demonstrated.

### Razorpay webhook envelope correction (2026-10-17)

- Fixed Razorpay payment webhook parsing to read `payload.payment.entity` and kept Cashfree's `data.payment` / `data.order` parsing. Added unit fixtures for captured/failed Razorpay events, Cashfree, and malformed bodies; **6/6 assertions PASS**. Signature checks continue to use the exact raw request body, and captured events still require provider API status verification before financial finalization.
- Added late-capture-after-failure regression coverage to `online_payment_operations_remote.test.sql`; the verified test project passed **29/29** assertions inside an explicit rollback transaction. Read-only post-run checks found zero synthetic orders, payment rows, or webhook events.
- Refreshed test-only database evidence: **32/32** migrations applied; linked schema lint passes; catalog reports 33/33 public tables RLS-enabled, 50 policies, 78 validated FKs, 7 security-invoker views, zero invalid indexes, and zero unsafe application definer-function counts. No schema migration was added in this correction.
- Final local gate: **29/29** local test files, Brain **88/88**, TypeScript, full ESLint, production build (**59 routes**), and `git diff --check` pass. No provider sandbox or authenticated browser E2E was run. Production was not accessed; release remains **BLOCKED / NO-GO**.
- Fresh `npm audit --omit=dev`: **0 production vulnerabilities**. Full `npm audit`: **9 high findings** in development/build tooling through `braces`; the recommended forced fix downgrades shadcn incompatibly and was not applied. The targeted source-pattern scan only matched a rejection-test fixture prefix, not a credential.

## Local legacy-data recovery preview (2026-10-17)

- Added `/settings/data-import` as an institute-wide owner/admin-gated, local-only preview for the 11 recognized legacy keys and an explicit browser backup download. Preview displays counts, exact-paise observations, date ranges, duplicate IDs, invalid amounts/dates, malformed rows, and unverified payment/refund status claims. It omits raw rows and never uploads or modifies browser records.
- The backup contains sensitive raw values from the recognized keys, has no verified institute/branch mapping, and is labeled accordingly. No actual user browser data was inspected, and no migration/import/reconciliation or key cleanup was run.
- New helper test: **18/18 PASS**. Full local gates: `npm test` **30 test files PASS** plus Brain **88/88**; TypeScript **PASS**; full ESLint **PASS**; production build **PASS** with **60 routes**. No database or provider operation was needed for this feature.

**Current release status remains BLOCKED / production NO-GO.** A controlled import with explicit mapping, atomic idempotent database writes, duplicate resolution, and financial reconciliation is still required; authenticated browser E2E, provider sandbox proof, current production compatibility, and verified backup/restore also remain open.

## Platform-admin privacy and final verification (2026-10-17)

- `/platform-admin` now gives support-role administrators only the support workspace. Operations/provider APIs reject support-role reads; the database role-aware overview returns empty operational data to support; RLS also denies direct access to provider metadata, subscriptions, invoices, attempts, administrative audit events, and global notification delivery metadata. Owners/operators retain authorized access. The exact application boundary is covered by remote rollback-only suites.
- Applied only `20261017000800_isolate_platform_support_data.sql` to the verified test project. Local and remote migration ledgers each contain **34** unique ordered versions through `20261017000800`. Remote suites passed: privacy **22/22**, admin operations **28/28**, support **29/29**.
- Latest local gates: **30 local test files PASS**, Brain **88/88 PASS**, TypeScript **PASS**, full ESLint **PASS**, build **PASS** with **60 routes**. Current post-migration catalog: 33/33 public tables RLS-enabled, 78 validated foreign keys, seven security-invoker views, zero invalid indexes, and zero unsafe application definer-function counts.
- `supabase migration list` and linked database lint currently fail at direct PostgreSQL login with SQLSTATE `28P01`; current lint is not verified after migration 34. The read-only Management-API ledger/catalog queries and transactional remote tests succeeded.

Production remains **NO-GO**. External sandbox evidence, authenticated browser E2E, subscription settlement, legacy-data import/reconciliation, a current production comparison, and verified production backup/restore remain unverified or incomplete. Production was not connected.

## Protected-route configuration gate correction (2026-10-17)

- Removed the development bypass that let protected pages/APIs through without Supabase public configuration. Public sign-in/callback and checkout-link routes remain available; protected routes fail closed with HTTP 503 until configured in all environments.
- Added `lib/supabase/auth-gate.ts` and seven unit assertions for missing/available configuration and public/protected paths.
- Latest local checks: **31 test files PASS**, Brain **88/88 PASS**, TypeScript **PASS**, full ESLint **PASS**, production build **PASS** with **60 routes**, and `git diff --check` **PASS**.
- A source scan found no active business localStorage writes or clears; only the owner/admin local preview/backup page reads browser data. The legacy adapter remains for recovery, so its source code is retained and no user's keys are deleted before a reconciled import. Production dependency audit: **0 vulnerabilities**; complete audit still reports **9 high development/build-tool findings**.
- No database/provider operation was run in this continuation. The post-migration test catalog and rollback-only SQL results remain as previously recorded; direct linked PostgreSQL lint after migration 34 is still unverified. Production is untouched.

Production remains **NO-GO** pending authenticated browser E2E, provider sandbox evidence, subscription settlement/reconciliation, controlled legacy import/reconciliation, current production compatibility, and a verified backup/restore rehearsal.

## Test database read-only revalidation (2026-10-17)

- Verified the CLI link and `.env.local` URL host both match test ref `xabfsqtevwnwtxxkmkvc`; read-only migration history confirms **34/34** local versions applied through `20261017000800`.
- Linked database lint **PASS**. Fresh catalog counts: 33/33 public tables RLS-enabled, 50 policies, 78 validated and zero unvalidated FKs, seven security-invoker views, zero invalid indexes, zero unsafe application definer-function counts, one private logo bucket, and four Storage policies.
- The earlier direct-Postgres authentication error is resolved. No migration or SQL write was performed; production `cjuneqmohdivjioulyqq` was not accessed. Previous remote regression suites are not represented as rerun here.
- Built-app smoke returned **200** for public `/login` and `/pay`; unauthenticated dashboard and platform-admin requests redirected with **307** to sign-in. This does not verify authenticated browser workflows.

Production remains **NO-GO** pending browser E2E, provider sandbox evidence, subscription settlement/reconciliation, legacy import/reconciliation, current production comparison, and demonstrated backup/restore.

## Current source and test-database recheck (2026-10-17)

- Confirmed repository root `C:\Users\Yasvriti\Desktop\bizbook`, branch `master`, 327 non-generated source/config/documentation files, and 191 pre-existing changed/untracked paths. These workspace changes were preserved.
- Static migration review found **37** files, **37** unique 14-digit prefixes in chronological filename order, and no zero-byte files. No `DROP TABLE`, `DROP SCHEMA`, `DROP COLUMN`, or `TRUNCATE` statement was found. `DROP POLICY` statements replace policies; the detected `DELETE` statements are inside scoped branch-access/admin operations.
- Before remote queries, both `supabase/.temp/project-ref` and the `.env.local` URL host matched test project `xabfsqtevwnwtxxkmkvc`. Read-only migration ledger query returned **37/37** through `20261017001100`; aggregate platform counts were one platform-admin row and zero plans, subscriptions, invoices, payment attempts, provider connections, and subscription provider events.
- Fresh read-only test catalog: **34/34** public tables have RLS, **52** public policies, **81** validated and **0** unvalidated foreign keys, **7/7** public views are `security_invoker`, **0** invalid indexes, **0** application SECURITY DEFINER functions executable by `anon` or missing a fixed `search_path`, one private logo bucket, and four Storage policies. Named subscription-visibility fixture residual counts are all zero.
- Source scan found no active application business-data writes or clears to browser storage. The only app-side browser-storage access is the explicit `/settings/data-import` local preview/backup export; the legacy adapter remains unreferenced by active screens for recovery. This is not evidence that users' legacy records were imported or reconciled.
- This recheck did not run SQL writes, migrations, provider calls, or production queries. `supabase db lint` after migrations 010/011 remains **NOT VERIFIED** due the recorded `cli_login_postgres` SQLSTATE `28P01`; Management-API read-only ledger/catalog queries succeeded.

**Production remains NO-GO.** This recheck does not close authenticated browser journeys, provider sandbox verification, legacy import/reconciliation, current production compatibility, backup/restore, or post-migration linked lint.

## Exact-paise input validation correction (2026-10-17)

- Fixed silent rounding in the student fee/admission fee/manual installment/reschedule forms, staff compensation form, and shared payroll API. Inputs now parse from decimal strings into integer paise and reject malformed, negative, over-limit, or more-than-two-decimal amounts before writes.
- The shared Brain `toPaise` conversion now rejects fractional-paise amounts while tolerating ordinary binary floating-point noise for exact cents. Added `lib/bizbook-brain/money-input.test.ts`: **18/18 PASS**. Full `npm test`: **33 local test files PASS** plus Brain **88/88**; `npx tsc --noEmit`, full ESLint, and `npm run build` all **PASS**; build generated 64 routes.
- This was an application-only correction with no database schema/data change. Remote SQL suites were not rerun; production was not accessed.

Production remains **NO-GO** for the separately documented external and release-gate blockers.

## Post-migration test-project verification correction (2026-10-17)

- The prior `cli_login_postgres` SQLSTATE `28P01` blocker is cleared. After verifying the CLI ref and `.env.local` host are both test project `xabfsqtevwnwtxxkmkvc`, linked `supabase db lint --project-ref xabfsqtevwnwtxxkmkvc` **PASS** with no schema errors; read-only migration history reports **37/37** versions through `20261017001100`.
- Fresh read-only catalog counts: 34/34 public tables have RLS, 52 public policies, 81 validated and zero unvalidated foreign keys, seven security-invoker views, zero invalid indexes, zero application `SECURITY DEFINER` routines callable by `anon` or missing a fixed `search_path`, one private logo bucket, and four Storage policies. Aggregate platform counts remain one admin-role row and zero plans, subscriptions, invoices, payment attempts, provider connections, and provider events.
- These are catalog and migration-history checks, not authenticated browser or provider verification. No database write, migration, payment/message call, or production query occurred. Historical post-migration `28P01` entries are superseded by this recheck.

Production remains **NO-GO**; authenticated journeys, sandbox evidence, legacy import/reconciliation, current production comparison, and backup/restore remain open.

## Dependency security status (2026-10-17)

- `npm audit --omit=dev --audit-level=high`: zero production dependency findings.
- Fresh full dependency audit reports nine high findings in the dev/build tree, including transitive `braces`; production-only audit remains at zero. `npm audit fix --dry-run` reported zero changes, and the current advisory/registry list no patched `braces` release. No forced dependency mutation was applied. Track [GitHub Advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [npm braces package](https://www.npmjs.com/package/braces).

## Account route compatibility repair (2026-10-17)

Added `app/settings/account/page.tsx` as a server-side redirect to the existing Supabase-backed `/business/profile` workflow so saved/legacy `/settings/account` URLs no longer produce a missing route. Next.js 16.4 local `redirect()` guidance was checked before implementation. Targeted ESLint and `npx tsc --noEmit` pass; `npm run build` passes and includes `/settings/account` in its route manifest. No database or provider interaction occurred.

## Static internal-route integrity regression (2026-10-17)

Added `lib/routing/internal-routes.test.ts` to resolve literal internal links, router navigations, redirects, and static fetch destinations against the current App Router page/API manifest, including dynamic and catch-all routes. The test passes **5 matcher assertions across 62 route files** with no missing static references. This does not cover route paths assembled only from runtime variables or prove that each page's user workflow works.

## Financial report integrity and current local gate refresh (2026-10-17)

- Dashboard, financial-summary, and profit/loss totals now parse signed database decimal amounts into integer paise, reject malformed precision and signs that conflict with ledger direction, and show an alert when a summary row is excluded. Profit/loss combines values in integer paise using the BizBook Brain converter.
- Subscription invoice copy now accurately describes the existing sandbox-only checkout. A database invoice is settled only after server-verified provider capture; live billing remains disabled.
- Current verification after these changes: `npm test` PASS (34 local test files plus Brain 88/88), `npx tsc --noEmit` PASS, full ESLint PASS (exit 0), and `npm run build` PASS (65 route entries). New dashboard summary cases cover exact paise aggregation, invalid precision, and direction consistency.
- No SQL migration, database write, provider request, or production connection occurred in this code-only update. Last recorded test-project history is 37/37; authenticated browser journeys and external provider sandbox evidence remain unverified. Production remains NO-GO.

## Current finalization status (2026-10-17)

- The authorized test database is at **38/38** repository migrations through `20261017001200_safe_legacy_student_import.sql`. The only migration added in this continuation was applied after test-project preflight; its 16-assertion remote SQL suite passed in a transaction ending with `ROLLBACK`. Post-run aggregate checks found no remaining synthetic fixtures. Fresh catalog: 35/35 public tables RLS-enabled, 53 policies, 85 validated and zero unvalidated foreign keys, seven `security_invoker` views, zero invalid indexes, and passing linked database lint. This evidence applies to the test project only.
- `/settings/data-import` now has a constrained import for new students with entirely unpaid fee schedules. The preview and source rows stay in browser memory; the RPC stores normalized student/schedule data plus source identity/fingerprint and audit metadata, not the raw source payload. The local key is not modified. Student-import helper tests pass **27/27**. No real user's local data was imported, and this is not a general financial migration or reconciliation workflow.
- Latest local gates: `npm test` **PASS** (36 local test files plus Brain **88/88**); `npx tsc --noEmit` **PASS**; `npm run lint` **PASS**; `npm run build` **PASS** (65 route entries); `npm audit --omit=dev --audit-level=high` **PASS**, zero production dependency findings. Fresh full `npm audit --audit-level=high` **FAILS** with nine high findings in the development/build dependency tree, including `braces` (GHSA-vfj7-8cjw-p6xm); npm offers only a breaking forced dependency change and the advisory lists no patched release. Do not force that upgrade without a compatible upstream fix.
- The only active application `localStorage` access found in `app/`, `components/`, and `hooks/` is the explicit legacy preview/backup and student-import screen. Legacy records remain in browser storage, and the historical storage adapter remains only for tests/recovery. Do not clear browser keys before category-by-category import and reconciliation or a documented data-owner retention decision.
- **Credential incident and required action:** a previous environment inspection printed the test project's Supabase service-role credential into assistant tool output. Treat that test credential as compromised. It was not used after discovery; no production credential was read. Its setting has now been removed from local `.env.local` while retaining the test-project URL. Rotate/revoke it in the test Supabase project, then update the server-only deployment secret through the secret manager. Do not paste the replacement into chat, source, screenshots, or logs. Server-role-dependent flows must remain blocked until rotation is complete and the replacement is configured safely.
- A secret-pattern scan of tracked/unignored source found no secret-shaped assignments; `.env.local` contents were never printed. This does not change the required external rotation of the compromised test key.
- Built-app unauthenticated smoke on `127.0.0.1` returned `/login` **200**, `/business/students` and `/platform-admin` **307 to `/login`**, and unauthenticated `GET /api/platform-admin/providers`, `GET /api/expenses`, `POST /api/payments/create-order`, and `POST /api/support` **401**. This verifies only anonymous route boundaries, not signed-in workflows or browser rendering across viewports.
- No authenticated browser E2E or user-specific import was run. No provider sandbox request, payment, or message was made. The platform-admin identity has not been verified in a signed-in session. Production project `cjuneqmohdivjioulyqq` was not queried or modified, and a fresh production compatibility assessment or backup/restore rehearsal was not performed.

**Production recommendation: NO-GO.** Credential rotation, authenticated user journeys, provider sandbox verification, complete legacy reconciliation, current production compatibility, and demonstrated backup/restore remain release gates.

## Razorpay uncertain-order recovery (2026-10-17)

- Fixed the timeout-retry gap for institute installment orders and BizBook subscription invoices. The server now looks up the existing Razorpay order by BizBook's unique receipt, validates the exact local order identity, expected paise amount, INR currency, provider ID, and status, then binds that order to the already reserved database intent. It never sends a second order-create request when the outcome is uncertain. An absent or ambiguous match remains unresolved for retry/reconciliation.
- Initial Razorpay order responses must echo the exact receipt and BizBook metadata; Cashfree readback must match the deterministic order ID, expected INR currency, and requested amount.
- Existing Razorpay orders are read back before checkout data is returned. A provider-paid order routes the UI to server status synchronization. Authenticated finance status sync and token-scoped parent-link status checks list the order's payments, fetch each candidate capture again from Razorpay, and call the existing idempotent database finalizer. Multiple captured attempts are retained for reconciliation; they do not create duplicate student receipts.
- BizBook platform subscription checkout uses the same receipt recovery. A provider-paid attempt can be status-checked through the existing subscription verification route.
- Official endpoint references: [Razorpay Fetch All Orders](https://github.com/razorpay/markdown-docs/blob/master/api/orders/fetch-all.md) documents receipt filtering and the 40-character receipt limit; [Razorpay Payments API](https://github.com/razorpay/markdown-docs/blob/master/api/payments.md) documents fetching payments for one order.
- Mocked adapter tests: **52 assertions PASS**. Current `npm test`: **36 local test files PASS**, Brain **88/88 PASS**. `npx tsc --noEmit`, full `npm run lint`, and `npm run build` pass; build generated **65 route entries**. Targeted ESLint for all changed payment routes/components also passes.
- No provider credentials/API request, payment, message, migration, remote SQL test, or production query/write occurred in this correction. The last verified test history remains **38/38** migrations; these code changes do not alter the database schema. Provider status behavior is mock-tested only. The test service-role credential still requires rotation before server-role paths are live.

Production remains **NO-GO**. Provider sandbox/E2E, authenticated browser journeys, service-role key rotation and secure redeployment, full legacy reconciliation, fresh production compatibility review, and backup/restore evidence remain open.

## Read-only test-project refresh (2026-10-17)

- Rechecked the active CLI reference and `.env.local` host immediately before each database query; both matched authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history is **38/38** with local and remote versions matching through `20261017001200_safe_legacy_student_import.sql`.
- Linked `supabase db lint --project-ref xabfsqtevwnwtxxkmkvc`: **PASS**, no schema errors. A fresh catalog-only aggregate query found **35/35** public tables RLS-enabled, **53** public policies, **0** unvalidated foreign keys, **0** invalid public indexes, **7** security-invoker views, **0** application SECURITY DEFINER functions executable by `anon`, and **0** application SECURITY DEFINER functions without a fixed `search_path`. It found one Storage bucket and four Storage policies.
- Aggregate-only Platform Admin counts: **1** platform-administrator role row and **1** platform audit event; **0** plans, institute subscriptions, invoices, payment attempts, or central provider connections. No admin identity or business rows were read; account access remains unverified.
- The application/browser-storage source scan still finds direct `localStorage` usage in the explicit legacy preview/import/backup UI. Legacy Brain storage adapters/services remain in the library for compatibility tests and recovery; no browser keys were cleared. The unpaid-student importer does not migrate existing financial history.
- This refresh ran SELECT-only catalog/history checks and linked lint. No migration, SQL write, provider request, payment, message, or production query occurred. Production `cjuneqmohdivjioulyqq` remains untouched.

Production remains **NO-GO**. The exposed test service-role key still needs rotation; provider sandbox and signed-in E2E evidence, full legacy reconciliation, fresh production compatibility assessment, and backup/restore proof remain outstanding.

## Owner-created member passwords (2026-10-18)

- Updated Members & Permissions to let an owner/admin add an existing verified BizBook account by email with no password entry; the existing password is never changed. For a new account, the owner enters and confirms an initial password and attests that the member controls that email; BizBook sends no email or OTP during this flow.
- Simplified `/member-login` to email/password or Google for existing Google accounts; new self-signup and email-code paths are hidden there. Forgot-password still uses Supabase Auth email delivery.
- Added `POST /api/institute/members`. It verifies same-origin requests, the exact authorized test-project host, the signed-in user's active institute owner/admin membership, validates the role/password, creates a new Auth user only when no verified email account can be attached, and then grants institute access. If the membership grant fails, it deletes only the Auth user created by that request. Existing account passwords are never reset from this page.
- New account creation remains unavailable until the previously exposed test service-role credential is rotated and a replacement is configured only as a server-side secret. Existing verified accounts can be attached through the authenticated membership RPC without that key. The route is not a production account-provisioning path.
- Password recovery still relies on Supabase Auth email delivery; this change removes email from initial account creation, not from password-reset delivery. No account was created, email/OTP sent, migration applied, or production project accessed in this continuation. Implementation has not yet been exercised in an authenticated browser or against real Supabase Auth.

## Member sign-in and removal update (2026-10-18)

- `/member-login` now keeps the member flow to Google sign-in, email/password, account creation, and password recovery. Email-code and phone-code options are hidden for members. New password accounts can resend the email confirmation link; a Google account avoids BizBook OTP delivery when Google OAuth is configured.
- Email confirmation and password-reset delivery still require a working custom SMTP provider in the hosted Supabase Auth settings. The app cannot make those emails arrive without that provider configuration; no email, password, or OTP was sent in this change. Google OAuth also needs its provider credentials and redirect allow-list configured.
- Owners/authorized administrators can permanently remove a membership from their institute. The database function requires the correct institute role, prevents self-removal and last-active-owner removal, revokes any pending invite, and leaves the Auth account, other institute memberships, financial records, and audit history intact.
- Added `20261018000400_permanent_institute_member_removal.sql` and applied it only to test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history confirms the local and remote versions match through `20261018000400`. No production project was accessed. The new UI flow was not browser-tested and no test suite was run in this update.

## Current audit gate refresh (2026-10-17)

The authorized test project still reports 38/38 matching migrations; linked database lint passes. Fresh read-only catalog aggregates show 35/35 public tables RLS-enabled, 53 policies, zero unvalidated FKs and invalid indexes, seven security-invoker views, and no application SECURITY DEFINER functions callable by `anon` or missing a fixed search path. Platform counts are one administrator role, one admin audit event, and no plans, subscriptions, invoices, payment attempts, or provider records. No identity or business rows were read. Static migration scan finds no invalid, duplicate, empty, or out-of-order files. Production was not accessed.

Fresh dependency audit: production dependency tree has zero high findings; the full development/build tree reports nine high findings rooted in `braces`, with only a breaking forced npm fix offered. No dependency change was made.

## Reviewed legacy-expense import and latest verification (2026-10-17)

- `/settings/data-import` now previews and imports explicitly selected legacy expense rows. It validates amount precision, date, method, duplicate source IDs, currency, known branch/institute metadata, status metadata, and unknown fields. Only eligible rows are shown for selection; each row's normalized fields are visible for owner review. The owner chooses an authorized target branch or institute-wide scope and confirms the expense is real and not already posted.
- Added test migrations `20261017001400_safe_legacy_expense_import.sql` and corrective `20261017001500_bind_expense_import_fingerprint.sql`; all **41/41** local versions now match the authorized test project's history. No earlier migration was rerun. The final RPC computes SHA-256 from normalized fields inside Postgres; the earlier caller-fingerprint RPC has no execute privilege for any client role. Import writes and source mapping/audit are atomic and branch scoped; original keys remain unchanged.
- Remote rollback-only expense import regression: **22/22 PASS** for RLS/grants, old-RPC revocation, server-side fingerprint generation, owner success, exact amount and branch retention, audit/raw-payload boundary, exact retry, changed-field rejection, invalid source/precision, future date, explicit confirmation, branch restriction, accountant denial, and tenant read isolation. Post-run aggregate checks found zero synthetic users, institutes, expense rows, or import mappings.
- After migrations: linked Supabase database lint **PASS**. Catalog counts: **37/37** public tables RLS-enabled, **55** policies, **93** validated/**0** unvalidated FKs, **7/7** security-invoker views, **0** invalid indexes, no application SECURITY DEFINER routines callable by `anon` or missing a fixed search path, one private Storage bucket, and four Storage policies.
- Local final gates: `npm test` **PASS** (38 test files plus Brain **88/88**), TypeScript **PASS**, full ESLint **PASS** with exit 0, and production build **PASS** (65 route entries). Focused expense-import validation and lint pass. `npm audit --audit-level=high` remains **FAIL** with nine high development/build findings through `braces@3.0.3`; no safe nonbreaking fix is offered. Production dependency audit is clean.
- No actual user browser data was imported or cleared. Production project `cjuneqmohdivjioulyqq` was not connected, queried, or changed. Other transaction/history/profile imports, authenticated browser journeys, provider sandbox verification, exposed test service-role key rotation, fresh production compatibility review, and encrypted backup/restore rehearsal remain blockers. **Production remains NO-GO.**

## Institute profile import completion (2026-10-17)

- Added a narrowly scoped institute-profile importer. It recognizes supported profile fields and imports only into blank database columns; existing values are skipped, unknown/invalid values are held for review, logos are excluded, and no source browser keys are modified. The owner/admin must confirm the target institute. The database RPC independently requires an institute-wide owner/admin, locks the target for atomic idempotent retries, stores only field-level mapping metadata, computes the source fingerprint in PostgreSQL, and audits field names without secret/profile values.
- Applied `20261017001600_safe_legacy_business_profile_import.sql` and its forward corrective migration `20261017001700_fix_legacy_profile_json_validation.sql` only to test project `xabfsqtevwnwtxxkmkvc`, after checking the linked ref and `.env.local` host. The corrected rollback-only remote suite passed **19/19**; post-run aggregate checks found zero synthetic users, institutes, or import mappings.
- Read-only Management API history reports **43/43** local migrations applied through `20261017001700`. Latest read-only catalog counts: **38/38** public tables RLS-enabled, **56** policies, **95** validated/zero unvalidated public FKs, seven security-invoker views, zero invalid indexes, and no unsafe application `SECURITY DEFINER` routines. CLI migration-list and `db lint` commands currently fail before SQL inspection with PostgreSQL login error `28P01`; Management API history/catalog reads and the rollback-only SQL test succeeded.
- Local verification: `npm test` **PASS** (39 test files plus Brain **88/88**), `npx tsc --noEmit` **PASS**, full lint **PASS**, and production build **PASS** (65 route entries). No user's browser data was inspected or imported. Production project `cjuneqmohdivjioulyqq` was not accessed.
- Profile import does not complete legacy reconciliation: logos and financial/history categories remain outside this importer. Authenticated browser E2E, provider sandbox tests, service-role credential rotation, fresh production compatibility review, and encrypted backup/restore rehearsal remain outstanding. **Production remains NO-GO.**

## Admission cancellation (2026-10-17)

- Added the shared-database **Cancel admission** action with a required 5–500 character reason. It records the cancellation time/reason and audit event while preserving fee schedules, receipts, allocations, refunds, and balances. It does not waive charges or issue a refund.
- The cancellation RPC is restricted to authenticated institute owners/administrators with branch write access. It serializes against manual and online receipt creation, refuses unresolved online orders, revokes parent checkout links, and allows only identical idempotent retries. Parent-link resolution also rejects archived students.
- Applied `20261017001800_cancel_admission_safely.sql` only to test project `xabfsqtevwnwtxxkmkvc`; linked history confirms 44/44 migrations. The rollback-only remote suite passed **14/14**. Production was not connected or modified.
- Focused TypeScript, targeted ESLint, and `git diff --check` passed. Full build and broad test suite were not repeated for this slice; linked `db lint` was interrupted and is not claimed as verified here. Production remains **NO-GO** for the other blockers listed above.

## Admission navigation, member email, and dashboard branch (2026-10-17)

- Added **My Business → Admission Cancellation**. The sidebar opens `/business/students?workflow=cancel-admission`, switches to the Students tab, and explains the per-student action. The row action now visibly says **Cancel admission**. The existing required-reason and history-preserving database workflow is unchanged.
- Added manager-only database functions to list institute members with email and grant membership by normalized, confirmed email. The operation rejects missing/unconfirmed accounts and applies branch access atomically. The UI no longer asks business owners to enter Supabase UUIDs or displays them. This grants an existing account only; it does not create an Auth account or send an invite.
- Applied `20261017001900_members_by_verified_email.sql` and corrective forward-only `20261017002000_fix_member_directory_email_type.sql` to authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history confirms **46/46** local versions match remote. The email-management rollback-only SQL suite passed **9/9**; local member helper suite passed **20/20**. Post-suite synthetic fixture counts were zero. New routines have a fixed search path and no anon execute grant.
- Dashboard visibly labels the selected branch or “All accessible branches” and does not display stale results while workspace scope is changing. Shared dashboard queries use the validated active scope.
- Late-fee charging is deferred by the product owner. No policy or ledger is configured, and no charge has been posted.
- Refund screens support manual and test-mode provider refund workflows, with server-side status checks. No provider sandbox refund or authenticated browser journey was run, so external refund completion remains unverified.
- Latest local checks: TypeScript **PASS**; focused ESLint for changed screens/helpers **PASS**; production build **PASS** (65 generated route entries); `git diff --check` **PASS**. Production project `cjuneqmohdivjioulyqq` was not queried or modified.

## Coaching-center payment entry and company/client separation (2026-10-17)

- Labeled the tenant app **Coaching Centre Workspace** and the separately protected `/platform-admin` console **BizBook Company Admin**. The company console manages subscribed coaching-center tenants and has no entry in the client sidebar. Institute gateway settings are now labeled **Online payment integrations**.
- Added **Record Manual Payment** directly to the coaching-center Payments & Collections sidebar. The form supports Cash, UPI, Bank Transfer, Card, Cheque, and Other, and records fee or advance receipts through the existing idempotent, branch-authorized database RPC.
- Clarified that **Advance Payments** applies an existing advance receipt. Added **Record new advance**, which opens manual receipt entry with Advance selected; the advance may remain unallocated or be applied to an outstanding installment.
- No schema change or migration was needed. Focused helper checks passed: manual receipt **10 assertions**, advance allocation **8 assertions**; TypeScript, focused ESLint, production build (**65 route entries**), and `git diff --check` passed. No authenticated browser journey or manual receipt write was performed.

## Manual refund for advance receipts (2026-10-17)

- Added a **Refund a manual advance** shortcut from Advance Payments. It opens Refund Management with only refundable manual advance receipts in the selector, while the general refund screen still offers fee, advance, and online receipts.
- Manual advance refunds reserve refundable capacity and remain pending until staff explicitly confirm the money was actually returned. The database's existing refund RPCs remain the authorization and accounting boundary; no migration or database write was needed.
- Added receipt-filter helper coverage; refund workflow tests pass **15 assertions**. TypeScript, focused ESLint, and production build (**65 routes**) pass. No actual refund or authenticated browser journey was run.

## Branch and member email access (2026-10-18)

- Updated the shared workspace header to a compact matte-black style with the selected institute and active branch. Only active, authorized branches are offered; deactivating a branch refreshes the selector and removes that branch from the choices.
- Branch setup now requires an individual branch contact's email. Existing verified users receive the branch assignment through the database; a new person can request an email OTP, create their account during verification, and claim the pending branch invitation. The member form follows the same path for role and branch assignments. A verified account can join another institute using the same email, but adding the same person twice within one institute is blocked; owners should manage or restore that existing membership.
- The invitation is recorded in BizBook but does not send a separate invitation email. The invited person signs in at `/login` with their own email OTP; the owner does not receive or share the code. Access is granted only after that matching email is verified.
- Applied `20261018000100_branch_login_invitations.sql`, corrective `20261018000200_allow_empty_revoked_member_invitations.sql`, and `20261018000300_prevent_duplicate_institute_members.sql` only to test project `xabfsqtevwnwtxxkmkvc`. Production was not accessed. Read-only migration history shows all **49/49** repository versions applied remotely.
- The rollback-only branch/member invitation SQL suite passed **9/9** on the test database, covering pending access before OTP, claim after verification, idempotent claim, duplicate-membership rejection, and invitation revocation when a branch is turned off. Post-test changes rolled back.
- `next typegen` and `npx tsc --noEmit` passed; focused ESLint and `git diff --check` passed. Linked schema lint completed with warnings in the existing profile-import routine and one unused local variable in the invitation routine; no schema errors were reported. The production build passed before the duplicate-membership UI guard was added; that final UI edit passed type checking and focused lint.
- No password is emailed. The invited person requests their own OTP; invitation-email sending and a separate owner OTP challenge are not implemented. Local Auth config sets email OTP expiry to 45 seconds, but the hosted test project's Auth setting and actual email delivery were not verified.

## Member workspace and branch UI simplification (2026-10-18)

- Removed branch switching from the shared header and Branches from the coaching-center sidebar. `/business/branches` now explains that branch management is paused. Existing branch tables, RLS, data, and access grants were kept intact; branch-scoped legacy accounts remain restricted and retain the minimum workspace selector needed to avoid widening their access. Institute-wide users ignore an old saved branch filter and open the full institute scope.
- New member invites are institute-wide and role-based. Owner role choices remain guarded by the database. A new `/member-login?instituteId=…` entry carries the intended institute context; after authentication, the workspace verifies that the account has an active membership (or a matching email invitation that can be claimed) before selecting it. One Supabase Auth identity can have memberships in several institutes, so the same email does not create duplicate accounts or mix institute roles.
- Members use their own email and password, forgot-password reset link, or first-time email-code flow. BizBook does not email passwords. New member access is currently reserved in the database but no separate invitation email is sent; production invite mail needs configured Supabase Auth SMTP and a trusted server-side invite flow. The login link can be copied from Members & Permissions.
- Inactive legacy memberships that retain branch-only scope cannot be reactivated from the simplified screen because the current database reactivation routine clears old branch grants. They remain inactive rather than silently receiving broader institute access.
- Frontend-only changes; no migration or remote database operation was performed in this continuation. Production remains untouched.
- Verification for this UI slice: workspace-scope helper **16/16 assertions PASS**, TypeScript **PASS**, focused ESLint **PASS**, optimized build **PASS** (65 route entries), and `git diff --check` **PASS**. No authenticated browser journey or email delivery was performed.

## Email OTP and member-screen removal (2026-10-18)

- Standard signup and passwordless email sign-in use numeric email codes. Resend cooldown is 20 seconds; local Supabase Auth config sets email and SMS OTP expiry to 300 seconds, and email/SMS resend frequency to 20 seconds. Local signup and sign-in templates render `{{ .Token }}`, not confirmation links. Password recovery still uses its secure reset link. The app adds no OTP request quota beyond the resend cooldown; Supabase/provider quotas still apply.
- The hosted test project's Auth settings and email delivery were not changed or verified from this workspace. Configure hosted Auth to require email confirmation, use `{{ .Token }}` in the confirmation and magic-link templates, set OTP expiry to 300 seconds and resend frequency to 20 seconds, and configure custom SMTP. Supabase's built-in email sender is limited to 2 messages/hour; it is not suitable for production delivery.
- Removed the Members & Permissions UI, member-account creation API, and separate member-login experience. `/business/members` now redirects to `/dashboard`; `/member-login` redirects to `/login`. Membership rows and RLS authorization remain; the old authenticated membership/invitation management RPCs have been disabled.
- Applied test-only migrations `20261018000500_public_institute_login_brand.sql`, `20261018000600_retire_public_member_login_brand.sql`, and `20261018000700_disable_member_management_rpc.sql` after verifying the linked CLI ref and `.env.local` host both matched `xabfsqtevwnwtxxkmkvc`. The latter two migrations revoked now-unused public/member-management RPC privileges. History confirms 53/53 local versions applied. Linked DB lint results are recorded above. No email/OTP was sent, no production project was accessed, and no production setting changed.

## Member account invitations restored (2026-10-18)

- Supersedes the member-screen removal note above. A person first creates and verifies one BizBook Auth account. The institute owner/admin then invites that existing verified email from `/business/members`; the invite is not emailed and does not itself grant access.
- The signed-in member sees each matching institute invitation on `/account`, with its institute name, assigned role, access scope, expiry, and an explicit **Accept institute access** action. They may accept one institute without accepting other invitations. After joining, every normal login lands on `/account`, where an **Open** link for each joined institute selects and opens that workspace. New invites are institute-wide; branch selection stays out of the member screen.
- That account-page link is a workspace entry/selection, not a bearer credential. Database membership and RLS continue to authorize protected requests, so copying a link cannot grant another person access.
- `/business/members` lists current members and pending invitations, lets authorized owners/admins create or revoke invitations, and lets permitted managers remove one institute membership without deleting the user's Auth account or memberships elsewhere. The role guide describes Owner, Administrator, Accountant, and Staff; only an owner may invite Owner/Administrator roles.
- Applied additive migration `20261018000900_in_app_member_access_invitations.sql` only to test project `xabfsqtevwnwtxxkmkvc` after checking the CLI reference and `.env.local` host. A read-only migration-history query confirms version `20261018000900` is present. Its 13-assertion SQL suite passed **13/13** in a rollback transaction; the follow-up fixture check found zero users, institutes, invitations, or memberships left behind.
- Member role helper suite passed **24/24**; `npx tsc --noEmit`, focused ESLint for all changed member/auth/navigation files, and `npm run build` passed (66 routes). Linked database lint had no schema errors; it reported existing warnings in the legacy profile-import routine and the now-private legacy invitation core. No signed-in browser journey or real account signup was run, and hosted OTP/email delivery remains unverified.
- Production project `cjuneqmohdivjioulyqq` was not accessed or modified. Production readiness remains **NO-GO**.

## Dedicated member portal continuation (2026-10-18)

- `/member-login` now provides a member-focused entry screen using the existing BizBook Auth identity. Successful sign-in, email-code verification, signup, or Google callback returns members to `/member`.
- `/member` is a compact member dashboard with an in-app invitation inbox, joined institute cards, and sign-out. It does not show the coaching workspace sidebar. `/account` remains available as a compatibility route.
- Members use the subscription held by their institute; this portal does not ask a member to buy a separate subscription. This UI change does not implement or verify subscription entitlement enforcement.
- Invitations remain in-app only and appear when the matching verified account signs in. No email or other external notification was sent. No database migration was needed; this UI continuation has not been typechecked or browser-tested yet.

## Temporary email confirmation-link flow (2026-10-18)

- Switched email signup and passwordless email sign-in from numeric-code entry to Supabase confirmation/sign-in links, matching the hosted dashboard's current Magic Link template. Links return through `/auth/callback` to the member portal or workspace; phone OTP and password login remain.
- Updated local Auth email templates to use `{{ .ConfirmationURL }}`. This does not change hosted Auth settings. Hosted SMTP delivery remains restricted to eligible project-team addresses until a custom sender is configured, and the deployed `/auth/callback` must be present in the Auth redirect allow-list.
- No email was sent and no hosted setting or database migration was changed. This UI change has not been typechecked or browser-tested yet.

## Admission-fee due date and advance page adjustment (2026-10-18)

- Removed the post-entry **Allocate an existing receipt** form from `/payments/advance`; that page now shows advance receipt status/history and offers manual advance recording and manual refunds. The existing database allocation RPC is retained, and a new advance may still be partly applied during receipt entry. Existing unallocated receipts cannot be applied later from this page.
- Shared overdue classification now includes an unpaid admission-fee installment on its admission date and labels it **Due at admission**. Ordinary installments due today remain outside the overdue list until the following day. Student entry copy now says the admission fee is due on the admission date and that receipt recording happens when collected.
- No database schema or data was changed. Static diff formatting check passed; automated tests, TypeScript, lint, and build were not run for this UI/logic change.

## Sidebar payment indicators (2026-10-18)

- Added a compact red overdue-installment count badge beside Payments & Collections, visible even when the section is collapsed. It uses the selected institute/branch scope and the same institute-local due-date rule as the Overdue page, refreshes every 30 seconds, and is hidden while scope or access is unavailable.
- Added a small blinking red dot beside Payment History when a newer payment record appears. It checks the latest RLS-visible receipt every 30 seconds and clears when Payment History is opened. The seen marker is session-only and stores no payment details.
- No schema changes or payment writes. These UI changes have not been typechecked, linted, or browser-tested.

## Fixed monthly expenses (2026-10-18)

- Added a fixed-monthly expense schedule flow to the shared `/expenses` workspace. Finance users can set a name, category, fixed amount, due day (1–28), starting month, and usual payment method; schedules can be paused without deleting history.
- Unpaid occurrences appear with due/overdue status in the expense screen. They do not affect expense totals until a user confirms the expense was paid and records its payment date and actual method. The resulting expense is posted once to the same institute expense ledger used by summaries and reports.
- Database functions authorize institute/branch finance access, make payment retries idempotent, prevent duplicate payments for the same schedule-month, and allow corrections by reasoned voiding rather than editing recorded monthly payments. Unpaid reminders are not sent as email/SMS.
- Applied migration `20261018001000_fixed_monthly_expenses.sql` to test project `xabfsqtevwnwtxxkmkvc` after verifying the CLI reference and `.env.local` host. Read-only migration history confirms it is applied; no database assertions, TypeScript, lint, browser, or build checks were run for this change. Production project `cjuneqmohdivjioulyqq` was not accessed or modified.

## Unpaid expense recording and settlement (2026-10-18)

- `/expenses` now defaults new entries to **Unpaid**, allowing an institute finance user to record an expense with its incurred date and payment due date before money is paid. The same form also supports an expense already paid.
- Unpaid records appear under due expenses and in the ledger with their status and due date. The separate **Record payment** action requires a confirmation, actual payment date, and method; it records the full amount only. Partial expense payments are not supported.
- Paid expense totals, dashboard/report outflows, and payment history now use the actual paid date and exclude unpaid or voided expenses. Student receipts remain in the student payment ledger and are unaffected.
- Applied `20261018001100_expense_payment_tracking.sql` to test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history confirms all 57 local migrations are applied. No production access occurred. Automated tests, TypeScript, lint, and build were not run for this change.

## Expense sidebar shortcuts (2026-10-18)

- Added separate sidebar links for **Record Expense**, **Fixed Monthly Expenses**, and **Record Expense Payment**, plus the **Expense Ledger**.
- **Fixed Monthly Expenses** shows monthly reminders/schedules and the monthly-reminder form only. It does not offer payment recording.
- **Record Expense Payment** shows due monthly items and previously recorded unpaid expenses, with a separate payment action for each. New expense creation stays under **Record Expense**, and the ledger is separate.
- No database changes were needed. Static diff formatting check only; automated tests, TypeScript, lint, and build were not run.

## Remaining expense database verification (2026-10-19)

- Before any linked database operation, verified both `supabase/.temp/project-ref` and the host in `.env.local` match authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history reports **57/57** repository migrations applied. Production `cjuneqmohdivjioulyqq` was not queried or changed.
- Linked `supabase db lint` completed with **no schema errors**. It still reports warnings in the legacy business-profile import routine and the private legacy member-invitation core; these are not new expense errors.
- Added `expense_obligations_remote.test.sql` for the previously untested fixed-monthly expense, unpaid-entry/settlement, and dashboard-obligation migrations. Its transaction-scoped test passed **36/36** assertions and ended with `ROLLBACK`. The post-run check found **zero** synthetic institute or Auth-user rows.
- This phase did not rerun earlier passing suites, send email, call a payment provider, or access production. It does not verify hosted Auth delivery, provider sandbox flows, authenticated browser journeys, or backup/restore readiness.
