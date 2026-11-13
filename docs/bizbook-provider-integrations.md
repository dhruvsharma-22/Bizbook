# BizBook provider integration setup

**Current state (2026-10-18):** `/platform-admin` and the authorized test database include platform-admin authorization, institute/plan/subscription operations, database-enforced limits, support workflows, central provider settings, and role-scoped support privacy. Test-project migration history confirms **54/54** local versions applied through `20261018000800_guard_manual_allocations_against_online_reservations.sql`. Manual installment allocations and active online checkout reservations now share a database guard; the focused rollback-only SQL regression suite passed **5/5**. Test-only payment order creation, server verification, signed webhooks, parent checkout links, status sync, online refunds, and subscription invoice settlement are implemented; no provider sandbox transaction, refund, subscription charge, or routine message delivery was run. Saved settings do not mean a provider is connected. A restricted, unpaid-student-only legacy import is also implemented and tested; it is not a general financial reconciliation process. Standard signup/sign-in email codes are configured locally for 20-second resend and 5-minute expiry, but hosted Auth/SMTP settings remain unverified. Member-management screens and RPC grants have been retired; membership records remain for tenant authorization.

The canonical dashboard and profit/loss arithmetic now run through the shared BizBook Brain financial-summary engine. The Supabase module is a thin adapter; category/direction consistency and exact-paise aggregation are regression-tested.

Older dated sections below preserve prior checkpoints. The latest provider, database, and release status is summarized here and in the final updates at the end of this guide.

## Authentication email links

Signup confirmation and passwordless email sign-in now use one-time links. Local Supabase templates use `{{ .ConfirmationURL }}`, and the app routes the returned Auth session to the member portal or workspace. Configure the hosted project separately: enable email confirmations, use `{{ .ConfirmationURL }}` in both confirmation and magic-link templates, set link/token expiry to 300 seconds, and allow the deployed app's `/auth/callback` URL in Auth redirect settings. The page waits 20 seconds before allowing a resend. Hosted SMTP and delivery have not been verified. Supabase's default sender is restricted to project-team addresses and two emails per hour, so this is a limited temporary path. Password recovery continues to use a secure reset link.

## Payment gateway admin screen

Open **Account Settings → Payment Integrations** while signed in as an institute owner or administrator for the existing institute payment gateway configuration. Reminder sender credentials have been removed from this screen. Platform payment and central notification configuration lives at `/platform-admin` and requires a separately provisioned platform administrator. All platform settings are test-only and remain `pending` after save.

The application currently requires:

- `.env.local` to remain connected to test project `xabfsqtevwnwtxxkmkvc`.
- The test project reports all 37 repository migrations applied through `20261017001100`. Linked test-project schema lint passes with no errors. Recent catalog counts and the scope of that evidence are recorded in `docs/production-readiness-report.md`; no production migration was run.
- The test-project Vault extension and its functions, checked by the migration before it creates credential RPCs.
- Trusted payment verification, refunds, reminders, webhook processing, public link resolution, and credential resolution require a valid server-only service-role key. The prior test key was exposed in tool output and has been removed from local `.env.local`; it must be rotated/revoked before any replacement is configured through a server-side secret manager. Do not reuse it or expose a replacement with a `NEXT_PUBLIC_` prefix. Saving credentials from the admin page itself uses the user's authenticated session and owner/administrator-checked SQL functions, not the service-role key.

Do not paste provider credentials into chat, source files, browser localStorage, screenshots, or logs. Enter them only in the admin screen after the test migration is applied, and do not enter live provider credentials into the test project.

## Razorpay

The screen requires a Razorpay test key ID with the `rzp_test_` prefix, key secret, and webhook secret. The server-only test implementation creates orders, verifies checkout signatures, fetches payment status, and validates raw-body webhooks. It is not activated by saving settings; explicit provider sandbox verification must succeed. Do not register a callback until credentials and the published HTTPS webhook URL are configured. An ambiguous order-creation timeout remains reserved for reconciliation, and the current Razorpay adapter does not automatically look it up by local reference. See [Razorpay test integration](https://razorpay.com/docs/server-integration/python/test-app/) and [Fetch Order API](https://razorpay.com/docs/api/orders/fetch-with-id/?preferred-country=SG).

Later setup required: a Razorpay account with test mode enabled; generated test keys; an approved live merchant account/KYC before any live collection; webhook configuration after BizBook publishes a verified HTTPS endpoint; and a successful real provider credential check before the status can change from pending.

## Cashfree Payments

The screen requires the sandbox app ID, client secret, and webhook secret. The server-side implementation fixes API version `2025-01-01`, uses the Cashfree sandbox host, creates orders, fetches payment status, and validates signed raw-body webhook events. A browser redirect is never proof of payment. The deterministic local order ID allows a retry to retrieve an existing Cashfree order after an uncertain create response. No provider request has been made in this workspace. See [Cashfree Checkout](https://www.cashfree.com/devstudio/preview/pg/web/inlineCheckout) and [Cashfree API reference](https://www.cashfree.com/docs/api-reference/payments/latest/international-payments/global-collections/endpoints).

Later setup required: a Cashfree account with sandbox app credentials; webhook secret and event subscription after the HTTPS endpoint is ready; and account/KYC approval before any live collection.

## Google OAuth, email links, and phone OTP

These are Supabase Auth project-level settings, not institute payment connections. The sign-in screen calls Supabase Auth for Google OAuth, email confirmation/sign-in links, and phone OTP; the PKCE callback is present. Hosted link delivery has not been verified end to end. Keep provider credentials in Supabase Auth settings; do not put a Supabase Management API token in the browser or an institute record.

Later setup required:

- Google Cloud OAuth client ID/secret and matching authorized origins/redirect URLs. Configure the Google provider in the test Supabase project and add the app callback to Supabase's redirect allow list. See [Supabase Google sign-in setup](https://supabase.com/docs/guides/auth/social-login/auth-google) and [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- A verified SMTP sender is required for reliable delivery to general member addresses. Supabase's default sender is limited to project-team addresses and two emails per hour. Hosted templates must contain `{{ .ConfirmationURL }}` for the current temporary link flow. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp) and [Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
- A supported SMS provider account, sender configuration, country-specific approval, and Auth rate limits/CAPTCHA before phone OTP. India-specific TRAI/DLT requirements may apply. See [Supabase phone sign-in](https://supabase.com/docs/guides/auth/phone-login?showSmsProvider=Twilio).

No OAuth, email, or SMS connection status is shown as active by BizBook unless an actual provider-backed verification is added.

### Email link expiration

Local Supabase email link/token expiry is set to **300 seconds** in `supabase/config.toml`. This local setting does not update the hosted test project. Hosted Auth link expiry and redirect allow-list must be checked in Supabase Dashboard. Phone OTP expiry remains controlled by Supabase Auth/provider configuration. No hosted Auth setting was changed from this workspace.

## WhatsApp Business and application email

The reminder runner now resolves active credentials from one platform-level provider record per channel; it no longer resolves credentials per institute. The institute-level credential save and verification routes return `410 Gone`, and the existing integration screen points institute administrators to central platform administration. The applied SQL migration stores central credentials in Vault, exposes only metadata under RLS, audits changes without recording secrets, and disables the legacy institute credential writer while retaining existing legacy rows. Provider delivery remains unavailable until credentials, consented recipients, a verified sender/template, and a scheduler are configured and tested.

Later setup requires a WhatsApp Business Platform account, Meta app, approved company business phone number, access token, approved templates and recipient opt-in. Email requires a Resend account, verified BizBook sender/domain and webhook signing secret. A provider test-check action exists, but no actual provider request or delivery was run here. Routine delivery and delivery webhooks remain unverified. Provider setup remains separate from Supabase Auth email delivery and student receipt accounting.

Platform administrator UUIDs have no default account and no browser bootstrap path. Provisioning uses a trusted service-role operation after verifying the intended Auth user UUID. One role row exists in the test database, but its identity and signed-in panel access were not inspected or browser-tested. Institute directory/status, role changes, plan management, subscription assignment, open invoice creation, audit history, support operations, and student/staff/branch plan limits are implemented in the panel and test database. Subscription invoice settlement code and SQL verification are implemented for test mode; no external provider sandbox or authenticated browser journey has verified it. A local service-role key was used for a test-only aggregate read before its exposure was discovered; it was then removed from `.env.local` and must be rotated. No production credential was involved.

## Online payment verification status (historical checkpoint, superseded below)

The four backend routes are implemented only for the test project. Test database migrations `20261016000100` through `20261016000300` are applied; the rollback-only online-payment suite passed **25/25** assertions. Local provider adapter tests passed **18/18**, signature/amount tests **17/17**, and Brain tests **88/88**. No provider sandbox credentials or server-only service-role key are configured, and no provider sandbox call, authenticated browser checkout, live payment, or message send was made. No checkout UI is connected, and there is no parent identity flow.

Captured-only receipt posting is atomic and verified against the test database. Fee receipts are counted once; advance receipts are one inflow and any allocation is a separate credit to one installment. Duplicate webhook event IDs cannot create a second receipt. Stale pending/authorized events cannot reopen failed or cancelled orders. Test-mode online refunds and platform subscription settlement were implemented later and have rollback-only SQL coverage; neither has provider sandbox evidence.

## Go-live boundary

Before any live provider setup: complete the application workflows, apply and verify the relevant migration on the authorized test project, run provider sandbox contract tests, verify signatures and idempotency, test failures and retries, and complete the provider's KYC/account approval. Production Supabase deployment and connection remain a separately approved operation. No provider is considered connected based only on credentials being saved.

## Platform subscription invoice checkout (2026-10-17)

The subscription page now supports sandbox-only checkout of an open BizBook subscription invoice when the central test provider has a successful explicit sandbox check. Server routes create/reuse an idempotent invoice attempt, verify provider status, and accept signed Razorpay/Cashfree webhooks. The database finalizer settles an invoice only for a provider-confirmed captured payment with exact order, amount, and currency. Duplicate events are idempotent; uncertain or duplicate captures require reconciliation. This workflow was tested with rollback-only SQL assertions (**35/35**) and mocked/local gates, but no actual provider request or authenticated browser payment was performed.

For later sandbox verification, supply only test credentials in `/platform-admin` (Razorpay test key ID, key secret, webhook secret; or Cashfree sandbox app ID, client secret, webhook secret). The exposed test `SUPABASE_SERVICE_ROLE_KEY` was removed from local `.env.local`; rotate/revoke it before configuring a replacement in the deployment secret manager. Do not use any service-role-dependent sandbox flow until that is complete. Configure the provider's HTTPS webhook URLs after deploying the test application:

- `<test HTTPS app origin>/api/webhooks/platform/razorpay`
- `<test HTTPS app origin>/api/webhooks/platform/cashfree`

Use only provider sandbox credentials and the authorized test project. Run the existing provider sandbox verification and then an authenticated invoice checkout plus signed webhook/status reconciliation. A saved credential or passing database test does not mean the provider is connected. Production remains **NO-GO** until a current production compatibility review and verified backup/restore are completed and separately approved.

## Online refund status update (2026-10-17)

Provider-backed refunds use the existing test-only institute connections. The flow reserves capacity in the database first, submits the operation server-side with a stable idempotency key, and updates the receipt ledger only after the provider returns a matching refund reference, payment/order, INR amount, and status. Saved configuration alone does not activate this path. The UI also requires an explicit confirmation before submitting to the provider sandbox.

Razorpay requests use `X-Refund-Idempotency` with the local refund UUID and then fetch the specific refund to reconcile status. Cashfree uses `x-idempotency-key` with its UUID and merchant refund ID, then fetches that refund by the original order. See [Razorpay idempotent refund requests](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent), [Cashfree create refund](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund), and [Cashfree get refund](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/get-refund).

The code and rollback-only SQL suite are verified on the test project, but no provider test credentials or sandbox refund were available. Pending refunds are reconciled when a finance user checks them in the UI; refund webhooks and background polling are not implemented. Production remains **NO-GO** until provider sandbox and authenticated browser E2E, current production compatibility review, and backup/restore evidence are complete.

## Parent checkout link update (2026-10-17)

Finance staff can issue or revoke a 24-hour `/pay#<token>` link for an outstanding fee installment. The random bearer token is returned once; only its SHA-256 digest is stored, and public resolution omits student/parent contact details. The public endpoint uses the service-role-only RPC and payment is recorded only after provider confirmation. Test-project migrations 30 and 31 and rollback-only checkout/payment SQL assertions passed. No Razorpay or Cashfree sandbox credential was supplied, so the provider journey and authenticated browser experience remain unverified. Treat generated links as unusable until the deployment's service-role configuration and provider test credentials are verified.

## Historical audit checkpoint (superseded by current test-project status below)

At this earlier checkpoint, the test database had 27/27 migrations applied. Later sections supersede the migration count and feature status. No production activity is authorized by this guide.

## Current test-project status (2026-10-17; supersedes earlier counts)

Test project `xabfsqtevwnwtxxkmkvc` has **38/38** local migrations applied and linked schema lint passes. Latest catalog evidence is 35/35 public tables with RLS, 53 policies, 85 validated foreign keys, seven security-invoker views, zero invalid indexes, one private logo bucket, and four Storage policies. The latest safe student-import SQL suite passed **16/16** rollback-only assertions; no synthetic fixtures remained afterward. Prior workspace, payment/refund, and checkout-link suite results are recorded in the dated audit sections and completion inventory.

The test database currently contains one platform-admin role row and one platform audit event, but zero plans, institute subscriptions, invoices, payment attempts, or provider connections. Only aggregate counts were inspected; the admin identity was not read, and matching authenticated access to `/platform-admin` was not tested. Do not bootstrap or replace that role based on this report.

Razorpay/Cashfree test-only order, verify, webhook, status-sync, and refund backend routes are implemented. Finance staff can start sandbox checkout for an installment or issue a short-lived public parent link. No provider sandbox transaction was made in this workspace. Subscription invoice checkout and settlement code are implemented in test mode but lack provider sandbox evidence; routine WhatsApp/email delivery remains inactive. These code paths must not be presented as operational provider connections.

`SUPABASE_SERVICE_ROLE_KEY` is currently absent from local `.env.local` because the prior test value was exposed and removed. Rotate/revoke that credential in the test project before configuring a replacement only through the server-side deployment secret manager. Test Auth providers, SMTP/SMS, Google OAuth, provider KYC, sender domains/templates/consent, webhook callback URLs, and hosting scheduler still need owner setup and end-to-end verification.

Production project `cjuneqmohdivjioulyqq` was not queried or modified. Its compatibility assessment remains the historical 2026-10-14 snapshot; production backup/restore is unproven. Recommendation remains **NO-GO**.

## Finance-staff sandbox checkout update (2026-10-17)

The shared receipt screen now offers a staff-initiated sandbox checkout for an active student's selected fee installment. The order is reserved through the existing tenant/branch-checked SQL function. Razorpay Test checkout output is verified by the existing signature and provider-status API. Cashfree Sandbox completion triggers a server-side order-payment lookup; redirects and SDK callbacks are never accepted as proof of payment. `/api/payments/sync` supports Cashfree status retry for authorized institute finance staff and fails to reconciliation when more than one successful attempt is reported.

No provider credentials were supplied, so no external provider API or checkout transaction was run. Public parent checkout links are now implemented for test mode, but no provider sandbox or authenticated browser journey was run. Provider-confirmed refunds and subscription settlement code have no provider sandbox verification. The test-project-only service-role path is not verified against real deployment secrets. Provider adapter tests pass 23/23, Cashfree outcome-selection tests pass 5/5, all local helper/CSV tests pass 26 files / 233 checks, Brain passes 88/88, TypeScript/full ESLint pass, and the latest build generated 54 routes.

No schema change was made in this update. The test project and `.env.local` host were verified as `xabfsqtevwnwtxxkmkvc`; a fresh CLI migration-list query stalled without a result, so 29/29 remains the last successful migration-history evidence. Production was not accessed. **Production remains NO-GO.**

## Earlier verification update (superseded by the online payment status below)

- At this earlier checkpoint, read-only migration listing confirmed **18/18** versions and five rollback-only remote suites passed **149/149** assertions. Three online-payment migrations were applied afterward; the current ledger has 24/24.
- Payroll now has an explicit shared-database mode backed by `staff`, `attendance_records`, and the existing atomic `record_salary_payment` RPC. The route is restricted to the exact test-project host, requires a finance role and server-verified institute/branch scope, recomputes the payable amount, and relies on the database's unique staff/month key to prevent duplicate salary records. Browser payroll remains a separate existing mode; attendance entry and staff setup remain browser-backed.
- At that earlier checkpoint the four online-payment endpoints were still **501**. Their current status and remaining limits are recorded in “Online payment verification status” below.
- The test project has zero platform administrators and zero configured providers. The panel intentionally denies access until a verified Auth user is provisioned through the server-side test-only process. Provider credentials remain `pending` after save and are not shown as connected without a real check.
- Local verification: TypeScript, Brain (**88/88**), all 15 Supabase helper test files (**107 assertions**), full lint (**0 errors, 17 warnings**), and production build (**PASS**, 44 generated app routes). Production was not queried or modified; the compatibility audit remains a historical read-only snapshot and production deployment remains **NO-GO**.

## Test database recheck (2026-10-16)

The test CLI link and `.env.local` host were verified as `xabfsqtevwnwtxxkmkvc`. All **19/19** repository migrations are applied in order, including the additive `20261015001100_attendance_staff_branch_integrity.sql`. Linked database lint passed with no schema errors. After that migration, the five rollback-only SQL suites passed **150/150** assertions: financial/RLS 48, student operations 38, central provider security 30, platform-admin operations/limits 26, and provider-check authorization/audit 8. No production connection or provider call was made. Online payments and provider-confirmed refunds remain unavailable; no credential or provider is represented as connected based on configuration alone.

## Final test-only schema/security update (2026-10-16)

The authorized test project `xabfsqtevwnwtxxkmkvc` has **21/21** repository migrations applied and passes linked schema lint. The latest security migrations restrict direct staff compensation-column reads to a finance-role-checked RPC and reject future-dated attendance using the institute time zone. Seven rollback-only remote SQL suites pass **163/163** assertions, including those boundaries. Shared staff management and attendance entry are available as separate database modes on `/business/students` and `/business/attendance`; browser storage is preserved and is not silently imported. No test credentials or business fixtures were left by these suites. Production `cjuneqmohdivjioulyqq` was not accessed; production compatibility and backup/restore readiness are not established.

## Provider webhook review (2026-10-17)

Razorpay's documented payment webhook envelope is `payload.payment.entity`; BizBook now normalizes that shape and keeps signature verification over the unmodified request body. Cashfree's existing `data.payment` / `data.order` envelope is covered separately. Parser tests pass **6/6**, and the rollback-only online-payment SQL suite passes **29/29**, including late captured payment after an earlier failure. No provider request or sandbox transaction was performed. Configure only the Razorpay payment events the handler supports (`payment.authorized`, `payment.captured`, `payment.failed`) after credentials and a reachable HTTPS test endpoint are configured; an event sample and supported event list are in [Razorpay's payment webhook reference](https://razorpay.com/docs/webhooks/payments). This code-level correction is not external verification or production activation.

## Latest platform-admin and test database check (2026-10-17)

The support role now sees only the support workspace. A server authorization guard, role-aware overview function, direct-table RLS policies, and the operations/provider APIs prevent support-role access to institute directory, provider metadata, subscriptions, invoices, payment attempts, administrative audit events, and global notification delivery metadata. Owners/operators retain the intended operational access. The test project passed the new role privacy suite (**22/22**) plus platform operations (**28/28**) and support (**29/29**) rollback-only suites.

The migration ledger was checked through the read-only Supabase Management-API query and returned **34** entries through `20261017000800`; the 34 local files have unique chronological version prefixes. A post-migration catalog query reported 33/33 public tables with RLS, 78 validated foreign keys, seven security-invoker views, and zero invalid indexes. Direct-Postgres migration-list and schema-lint commands returned SQLSTATE `28P01`; the post-migration linked lint is not verified. No production query, migration, provider request, payment, or message was performed.

Platform subscription test-mode checkout, settlement, and invoice reconciliation code are implemented and SQL-tested, but provider sandbox verification remains unperformed. Provider checks require real test credentials, a rotated server-only service-role key, and a signed-in test account. Authenticated browser E2E, current production compatibility, and backup/restore verification remain outstanding. **Production remains NO-GO.**

## Current integration status correction (2026-10-17)

- `/pay` public parent checkout, authenticated staff-started installment checkout, test-mode online refund submission/status refresh, and subscription invoice checkout/settlement code now exist. Test-project rollback-only SQL assertions cover the corresponding database controls; local mocked tests cover provider adapters. These are not provider-verified: no sandbox credentials/API calls, test transactions/refunds, signed delivery, or authenticated browser E2E were run.
- Platform-admin access remains dependent on the existing database role row; its identity and login were not verified. Provider connection settings remain inactive/pending until a real test-mode provider check passes. No real message or payment was sent.
- Test database reports 38/38 migrations and linked lint PASS. Production remains untouched and NO-GO pending external setup, authenticated E2E, full legacy-data reconciliation, current production compatibility review, and verified backup/restore.

## Current provider and test status correction (2026-10-17)

The latest recorded test-project history is 38/38 migrations through `20261017001200`; linked database lint and the read-only catalog recheck pass. The rollback-only student-import suite is 16/16, and the platform subscription settlement suite is 43/43. Subscription invoice sandbox checkout and settlement handlers exist, but no provider API call, sandbox charge, signed provider webhook delivery, or authenticated browser journey was performed. They are not verified provider connections. The unpaid-student-only import does not reconcile financial history. Local tests pass 36 files plus Brain 88/88, TypeScript/full ESLint pass, and production build emits 65 route entries. The exposed test service-role setting was removed from local `.env.local`; rotation is still required. Production remains NO-GO.

## Razorpay order recovery update (2026-10-17)

Razorpay's official Orders API supports filtering orders by `receipt`; its documentation specifies that receipts are unique and at most 40 characters. Its Payments API also exposes payments for a given order. BizBook now uses these read endpoints to recover the original order after an uncertain create response, validate its local identity and amount, and check captured attempts before any receipt or subscription settlement is finalized. A retry never creates a second Razorpay order. The adapter has **52 mocked assertions**, including exact Cashfree order readback validation; no provider sandbox request was made.

`npm test` passes all **36 local test files** plus Brain **88/88**; TypeScript, full lint, and build pass (**65 route entries**). Provider runtime verification remains blocked until test credentials are configured and the exposed test service-role credential is rotated and replaced only in the deployment secret manager. Production remains untouched and **NO-GO**.

## Read-only test-project refresh (2026-10-17)

- Rechecked the active CLI reference and `.env.local` host immediately before each database query; both matched authorized test project `xabfsqtevwnwtxxkmkvc`. Read-only migration history is **38/38** with local and remote versions matching through `20261017001200_safe_legacy_student_import.sql`.
- Linked `supabase db lint --project-ref xabfsqtevwnwtxxkmkvc`: **PASS**, no schema errors. A fresh catalog-only aggregate query found **35/35** public tables RLS-enabled, **53** public policies, **0** unvalidated foreign keys, **0** invalid public indexes, **7** security-invoker views, **0** application SECURITY DEFINER functions executable by `anon`, and **0** application SECURITY DEFINER functions without a fixed `search_path`. It found one Storage bucket and four Storage policies.
- Aggregate-only Platform Admin counts: **1** platform-administrator role row and **1** platform audit event; **0** plans, institute subscriptions, invoices, payment attempts, or central provider connections. No admin identity or business rows were read; account access remains unverified.
- The application/browser-storage source scan still finds direct `localStorage` usage in the explicit legacy preview/import/backup UI. Legacy Brain storage adapters/services remain in the library for compatibility tests and recovery; no browser keys were cleared. The unpaid-student importer does not migrate existing financial history.
- This refresh ran SELECT-only catalog/history checks and linked lint. No migration, SQL write, provider request, payment, message, or production query occurred. Production `cjuneqmohdivjioulyqq` remains untouched.

Production remains **NO-GO**. The exposed test service-role key still needs rotation; provider sandbox and signed-in E2E evidence, full legacy reconciliation, fresh production compatibility assessment, and backup/restore proof remain outstanding.
