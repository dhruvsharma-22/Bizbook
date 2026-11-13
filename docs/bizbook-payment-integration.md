# BizBook Brain and payment integration status

## Current architecture

**Current release status (2026-10-17):** Test-only Razorpay/Cashfree order creation, signature/status verification, signed webhooks, Cashfree status sync, expiring parent checkout links, and provider-refund operations are implemented. Parent links are hashed, expire after 24 hours, can be revoked, and expose minimal checkout data. The latest recorded test project history has 37/37 migrations applied; the latest recorded rollback-only SQL suites passed checkout links 15/15, online payments 29/29, and online refunds 24/24. No provider sandbox transaction/refund or authenticated browser checkout was performed. Subscription checkout and settlement code are test-only and unverified; production readiness remains blocked.

`lib/bizbook-brain/` contains provider-independent TypeScript functions for money validation, student balances, installments, advance receipts and allocations, payment/refund state, expenses, payroll, attendance, accounting, reminders, invoices, reporting, reconciliation, and audit records. The engines are mostly pure calculations. Legacy browser storage adapters remain in the library for compatibility tests, but active application routes use authenticated Supabase workflows for persistent business data. Legacy browser records have not been imported, reconciled, or deleted.

Legacy records may still exist under these established browser keys:

- `bizbook-students-staff-v1`
- `bizbook-advance-payments-v1`
- `bizbook-payment-history-v1`
- `bizbook-salary-payments-v1`
- `bizbook-fee-receipts-v1` for ordinary fee receipts introduced by the Brain flow

The Brain storage adapter and the payment pages accept legacy root-array and object/nested student/staff layouts. The Outstanding and Overdue pages now use the shared installment balance helper, including legacy `amountPaid`, `paid`, and `payments` fields. Updates preserve unknown object fields. A student-only root-array layout cannot accept a staff addition without a deliberate migration, so the adapter refuses that write instead of dropping records.

Ordinary fee receipts and advance receipts are normalized into one receipt view by stable receipt/payment identity. Fee receipts are fully applied receipts; they do not become available advance. Advance allocations reduce the installment balance and available advance, but do not create another inflow. Installments retain separate `paidAmount` and `advanceAppliedAmount` tracking, and legacy `Paid` rows without tracking fields remain closed to new payments.

Salary payment storage and payment-history mirrors have separate operational purposes. The extended report test checks that a salary and its mirrored expense/history representation contribute one outflow. General business expenses remain separate. Platform subscription billing is accounted separately from an institute financial report. No penalty transaction category/source or approved accounting policy was found. The legacy record-based report-engine has no page caller; canonical database reports now use the shared pure financial-summary-engine.

Refund requests reserve refundable balance while Pending or Processing. Failed and Cancelled requests release that reservation. Only Completed refunds affect net collections/profit calculations. Manual completion requires an authorized staff action and explicit confirmation that money was returned. Test-mode online refunds are submitted by the server with a stable idempotency key and update the ledger only after provider confirmation; this path has not been exercised against a provider sandbox.

## Payment and tenant boundary

The provider-neutral contract in `payment-provider.ts` models coaching ID, provider (`razorpay` or `cashfree`), test/live mode, connection status, non-secret account metadata, and a server-side credential reference. The public connection mapper uses an explicit allowlist and omits the credential reference. Contract types cover order creation, payment verification, refunds, refund verification, and webhook events. `MockPaymentProvider` is isolated in `payment-provider.test-adapter.ts` and is not exported from the production Brain barrel.

This contract is used by the server-side provider adapters. Payment connection metadata is tenant-scoped; credentials are stored in Vault and resolved only through trusted server paths. Authenticated routes derive institute, branch, student, installment, and amount permissions from database membership/RPC checks. A `coachingId` received from a browser is never treated as authorization. All online payment routes are restricted to the authorized test project until a separate production release is approved.

Institute payment-provider settings now exist under Account Settings â†’ Payment Integrations, and central notification/provider configuration is separate under `/platform-admin`. The payment settings page saves credentials server-side through Vault but does not enable a provider until a real sandbox check succeeds.

The preserved legacy Brain payment service still fails closed for online payments: client-supplied `status: "Paid"` or `verifiedAt` cannot create an eligible receipt. The active application uses the authenticated server workflow and service-role-only finalization RPC. Provider refund references from the browser are not trusted; the server fetches and validates provider status before completing a test refund.

## Existing API routes

| Route | Current behavior |
| --- | --- |
| `POST /api/payments/create-order` | Test-project-only server order creation with authenticated finance authorization, idempotent local intents, and reserved installment capacity. |
| `POST /api/payments/verify` | Razorpay signature validation followed by a server-side payment fetch; only provider-confirmed capture can post a receipt. |
| `POST /api/payments/webhook` | Raw-body Razorpay signature validation, duplicate-event handling, and server-side capture verification. |
| `POST /api/webhooks/cashfree` | Raw-body/timestamp Cashfree signature validation, duplicate-event handling, and server-side capture verification. |
| `POST /api/payments/sync` | Authenticated finance-scoped Cashfree order-status refresh from the provider API; ambiguous multiple successes require reconciliation. |
| `POST /api/payments/refunds/submit` | Test-only online refund submission/status refresh with exact provider/reference/amount validation and stable idempotency. |
| `POST /api/payments/checkout-links` | Finance-authorized parent link issue/revoke; the raw token is returned once and only its digest is stored. |
| `GET /api/payments/checkout-link/resolve`, `POST /api/payments/checkout-link/verify` | Public capability-link resolution with minimal data and provider-confirmed payment finalization. |
| `POST /api/notifications/email` | Returns an email preview marked simulated; sends nothing. Logs only static channel/status metadata. |
| `POST /api/notifications/whatsapp` | Returns a WhatsApp preview marked simulated; sends nothing. Logs only static channel/status metadata. |
| `GET /api/cron/reminders` | Server-only scheduled runner. Sends only on an exact tenant-local reminder stage, uses an idempotent log key, and fails closed without a cron secret, service-role key, and the stage's provider credentials. No hosting scheduler is configured. |

Payment endpoints use database authorization and transactional persistence on the authorized test project. A finance-authorized screen now launches Razorpay Test or Cashfree Sandbox checkout for a selected fee installment. The route guard rejects non-test projects. No provider sandbox request or transaction was made; this workflow is not provider-verified or production-enabled. Email/WhatsApp preview endpoints remain separate from the reminder runner and do not send. The runner is inactive without its central credentials, approved WhatsApp template, and hosting scheduler.

## Implemented controls and remaining checks

- The order, verification, webhook, refund, checkout-link, credential, and reconciliation paths derive tenant and branch access from authenticated sessions and database functions. Browser-selected IDs, amounts, redirects, or statuses are not accepted as proof of authorization or payment.
- Provider credentials are stored through Vault-backed operations and are not returned to the browser. Only test credentials may be used by the current project guard; a provider configuration remains pending until an actual provider-backed check succeeds.
- Payment capture and refund finalization use idempotent database functions. Signed webhook handlers validate raw request bodies, and finalization checks provider identity, order/payment reference, amount, currency, status, and event uniqueness.
- The canonical dashboard/report views keep student receipts, advance allocations, completed refunds, payroll, and expenses distinct. BizBook subscription payments and penalties are excluded because their accounting flows/policies are not complete.
- Local adapter and SQL regression tests pass, but no provider sandbox checkout, refund, webhook delivery, or authenticated browser journey has been executed. Those are still required before enabling provider use.
- Decide the merchant model (institute-owned gateway accounts versus platform/marketplace account) and complete provider KYC, account approval, HTTPS webhook setup, and credentials through the appropriate secure settings. Standard Razorpay/Cashfree gateway keys do not imply marketplace or split-settlement support. See [Razorpay Route](https://razorpay.com/route/) and [Razorpay OAuth terms](https://razorpay.com/oauth-tncs/).

### Provider-specific preparation

- **Razorpay:** Current official integration guidance creates each order server-side, returns the order ID to Checkout, verifies the checkout signature on the server, and checks the captured payment status; use test keys before live keys. Webhooks should be primary for asynchronous updates, with API fetch for critical immediate confirmation. See [Razorpay server integration](https://razorpay.com/docs/server-integration/python/test-app/). If BizBook needs platform-led linked accounts or split settlements, confirm Route eligibility, consent, and onboarding with Razorpay before designing that flow; standard gateway credentials alone do not implement Route.
- **Cashfree:** Current Dev Studio flow creates the order server-side, returns a payment session to checkout, and fetches payment status from the server. Webhooks require signature verification using the provider signature, timestamp, and original request body. Use environment-matched sandbox or production credentials and the current API version. See [Cashfree checkout flow](https://www.cashfree.com/devstudio/preview/pg/web/inlineCheckout) and [Cashfree webhook verification](https://www.cashfree.com/devstudio/preview/pg/tools/webhookVerification).

## Remaining readiness issues

- **Critical for customer payment use:** Finance staff can issue a public, expiring parent checkout link; the routes are test-project-only. No provider sandbox transaction or authenticated browser E2E has been run. Do not enable collections yet.
- **High:** Existing browser-local business data has not been imported or reconciled into Supabase. Preserve those records until a controlled, institute-scoped import and verification process exists.
- **High:** Subscription checkout, settlement finalization, and signed provider webhook code exist in test mode, but no provider sandbox charge or authenticated browser journey verified them. Existing subscription plans, assignments, invoices, and payment-attempt records do not prove funds were received.
- **High:** No provider sandbox transaction/refund or authenticated checkout journey has been run. Test credentials, a signed-in finance test user, and valid deployment secrets are required to verify these paths.
- **High:** The server reminder route is implemented but inactive until valid server credentials, consented recipients, an approved WhatsApp template or verified email sender, webhook configuration where needed, and a hosting scheduler are configured and tested. `/payments/reminders` shows saved attempts; it does not send messages.
- **Medium:** Legacy browser data has not been imported or reconciled. Existing keys and adapter code remain preserved; the active screens use Supabase. Import needs explicit institute/branch/student mapping and owner decisions for unverified payment/refund claims.
- **Medium:** Penalty ledger and its calculation/waiver/reversal policy are undefined; the application correctly does not record penalty charges.

**Readiness:** suitable for local testing of offline/manual flows and Brain calculations only. Not ready for staging or production payment processing.

## Implementation checkpoint (historical; superseded by final status below)

The online payment API routes no longer return 501. Test-project-only Razorpay/Cashfree order creation, provider-side confirmation, signed webhook verification, idempotent event handling, and captured-only receipt posting are implemented and covered by mocked/local tests plus rollback-only PostgreSQL assertions. A finance-authorized installment checkout UI and expiring/revocable parent payment links now exist. No provider sandbox transaction has verified operation.

The shared payroll API now uses BizBook Brain's `calculateSalary` engine; the database RPC independently recomputes and stores salary transactionally. Legacy browser storage adapters remain in the library for compatibility, but active screens use Supabase. Legacy data import and financial reconciliation are not implemented.

At that checkpoint, test project `xabfsqtevwnwtxxkmkvc` had **27/27** migrations applied. Later documentation records 29/29 and eleven rollback-only SQL suites. No external payment-provider API, actual sandbox transaction, email, or WhatsApp message was run. No provider is connected based on configuration alone. Online refunds and subscription checkout/settlement/reconciliation remain unavailable. Production `cjuneqmohdivjioulyqq` was not accessed; production readiness remains **NO-GO**.

## Online payment backend checkpoint (historical; superseded by later updates)

The four payment routes above are implemented for the test project and no longer return HTTP 501. Razorpay orders use server-side test API calls and expose only the public key/order reference; Cashfree uses the fixed sandbox endpoint and returns its checkout session capability. The online payment migrations add intent allocation data, exact amount/currency checks, database reservations, audit/reconciliation records, and atomic captured-only receipt finalization. Razorpay webhooks validate the raw body with the configured secret; Cashfree validates the timestamp/signature over the raw body. Both reject client-asserted success and deduplicate provider events.

Test project `xabfsqtevwnwtxxkmkvc` has the new migrations applied. The transaction-wrapped remote online-payment suite passed **25/25** assertions; local payment core tests passed **17/17**, the mocked provider adapter passed **18/18**, and the BizBook Brain passed **88/88**. These checks did not make any provider API request. A stale pending event after a failed/cancelled order is ignored; confirmed capture remains eligible for safe posting or reconciliation.

Recovery is deliberately conservative. A Cashfree retry can fetch its order by the deterministic local order ID. Razorpay does not expose an order lookup by this stored local reference in the implemented adapter, so an ambiguous order-creation timeout stays reserved and requires operator reconciliation; the retry path will not create another order. Subscription billing, provider-backed refunds, and parent-facing checkout UI were implemented later for test mode. Authenticated browser E2E remains unverified. No production provider is configured or enabled.

## Finance-authorized sandbox checkout checkpoint (historical; parent links and refunds are described below)

The shared receipt screen opens test checkout for the selected outstanding fee installment. It uses the amount read from the shared balance, while the order RPC independently validates finance role, branch, installment identity, exact paise amount, and available reserved balance. Razorpay checkout responses go through server signature and status verification. Cashfree SDK completion triggers `/api/payments/sync`, which fetches order payments server-side; browser return/callback data alone is never payment evidence. Multiple Cashfree successes are held for manual reconciliation, and successful receipt finalization is atomic.

Local checks at that checkpoint: provider adapter **23/23**, Cashfree order outcome selection **5/5**, helper/CSV tests **26 files / 233 checks**, Brain **88/88**, TypeScript, full ESLint, production build **54 routes**. There are no provider credentials, so no external provider call or sandbox payment was run. No authenticated browser checkout was run. The parent-link feature was added afterward; provider-backed refunds and subscription payment flow remain absent.

No database schema change was added. Test project and `.env.local` target were verified as `xabfsqtevwnwtxxkmkvc`; the current read-only migration-list request stalled, so 29/29 remains the prior verified migration count. Production remained untouched. **Production remains NO-GO.**

## Parent checkout link checkpoint (2026-10-17; superseded by final status below)

Added `/pay` and the finance-authorized link issue/revoke workflow. The bearer token is 256-bit random data delivered only once in the URL fragment; the database stores only its SHA-256 digest, limits it to 24 hours, and records issue/revoke audit events without the token. The public resolver returns minimal order details and does not return student/parent contact information. Server-side verification confirms provider status before any receipt is posted. A second distinct successful capture for an already-captured order is routed to reconciliation rather than creating a duplicate receipt.

Migrations `20261017000400` and `20261017000500` were applied only to test project `xabfsqtevwnwtxxkmkvc`; read-only migration history is 31/31 and linked database lint passes. Checkout-link SQL assertions passed 15/15 and online-payment SQL assertions passed 27/27, both in rollback transactions. Token/public-route tests passed 18/18 and provider/state tests 28/28. TypeScript, full ESLint, and production build pass. No provider API request, sandbox payment, authenticated browser E2E, or production access occurred. Public checkout remains unverified until a valid deployment service-role secret, test credentials, and signed-in finance user are available. Provider-backed refunds and subscription billing remain unavailable; production remains NO-GO.

## Online refund continuation (2026-10-17)

`/payments/refunds` now supports provider-backed test refunds as well as its existing manual workflow. The UI first creates an authorized, idempotent reservation and requires explicit confirmation before submitting to a provider. `/api/payments/refunds/submit` is test-project-only, checks the signed-in user's institute and branch finance access, resolves active test credentials server-side, and either submits the refund or fetches its existing provider status. Only a provider response that matches the original payment/order, exact INR amount, and stable refund reference can update the database. Pending and in-flight refunds continue reserving capacity; only provider-confirmed completion reduces collections.

Test project `xabfsqtevwnwtxxkmkvc` now has **32/32** repository migrations applied. New `20261017000600_online_refund_operations.sql` passed **24/24** transaction-rolled-back SQL assertions; linked schema lint passes. Mocked adapter coverage is included in the **40-assertion** online payment/refund provider suite; refund planning tests pass **8/8**. No provider credentials were supplied, no provider API call or sandbox refund was run, and no authenticated browser E2E was performed. Provider refund callbacks and scheduled reconciliation are not yet implemented; a finance user can refresh status from the refund history.

The adapter follows [Razorpay's idempotent normal refund API](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent), [Cashfree's create-refund API](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund), and [Cashfree's get-refund API](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/get-refund). This does not establish provider connectivity or make production ready. Production remains **NO-GO** pending provider sandbox E2E, authenticated tenant-isolation E2E, current production compatibility review, and a demonstrated backup/restore.

## Payment webhook payload check (2026-10-17)

The Razorpay webhook handler now parses the documented `payload.payment.entity` envelope; Cashfree continues to use `data.payment` and `data.order`. A dedicated parser suite passes **6/6** cases. The payment SQL suite, including late capture after a prior failure, passes **29/29** in a rollback transaction on the authorized test project. Test provider credentials and an authenticated browser session were not available, so no sandbox transaction or live webhook delivery has been verified. Production remains **NO-GO**.

## Current platform billing and provider-refund correction (2026-10-17)

Earlier “Remaining readiness issues” bullets above predate the latest test-mode implementations. The current source includes institute subscription checkout and signed Razorpay/Cashfree billing webhooks; the database settlement suite passes **43/43** in a rollback transaction. It also includes a test-only provider refund submit/status path; its SQL suite passes **24/24** in a rollback transaction. These describe implemented workflows and test-project assertions only. No provider API call, sandbox payment/refund, authenticated browser flow, or live operation has been performed, so neither path is provider-verified or production-enabled. BizBook subscription receipts are still excluded from institute financial summaries because they are platform billing, not institute collections.

Current test-project read-only migration history is **37/37** through `20261017001100`; linked database lint passes with no schema errors after the prior cached-login error was cleared. The current security catalog and remaining production gates are recorded in `docs/production-readiness-report.md`. Production remains **NO-GO**.

## Current financial and subscription status correction (2026-10-17)

Test-only subscription invoice checkout and settlement code is implemented, with signed provider webhook and server status-verification paths. The platform subscription settlement SQL suite is recorded as 43/43 rollback-only assertions on the test project. No provider sandbox charge, signed live-delivery event, or authenticated checkout journey was run, so do not call billing operational. Dashboard/report totals now use strict integer-paise aggregation and exclude/report malformed or direction-inconsistent aggregate rows. Current local suite passes 34 files plus Brain 88/88; TypeScript, full ESLint, and build pass (65 route entries). No production access occurred.
## Razorpay timeout recovery (2026-10-17)

A retry of an existing Razorpay intent now queries the provider using the same unique receipt sent on initial order creation. The server accepts only one exact matching order with the expected BizBook metadata, amount in paise, INR currency, and a supported order state. A missing or ambiguous result stays reserved and does not cause a second create request. Existing provider-paid orders are directed to status reconciliation instead of reopening checkout.

Authenticated institute status sync and token-scoped parent-link checks fetch the Razorpay order payment list, re-fetch candidate captures by payment ID, and submit verified outcomes through the idempotent database finalizer. Multiple successful attempts are routed to reconciliation. The platform subscription create flow uses the same receipt recovery and status-check path.

The provider adapter is mock-tested (**51 assertions**); no Razorpay sandbox request or payment was made. See [Razorpay Fetch All Orders](https://github.com/razorpay/markdown-docs/blob/master/api/orders/fetch-all.md) and [Razorpay Payments API](https://github.com/razorpay/markdown-docs/blob/master/api/payments.md). Test credentials and a rotated server-only service-role key are still required for runtime verification. No production access occurred.

### Recovery verification count correction (2026-10-17)

The following adapter test run supersedes the earlier 51-assertion figure above: **52 mocked assertions pass**, including exact Cashfree order amount/currency checks and Razorpay receipt metadata validation. No provider sandbox request was made.
