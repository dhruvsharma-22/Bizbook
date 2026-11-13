# BizBook Supabase database foundation

## Current application boundary

BizBook Brain and its pages still use browser localStorage. The existing storage keys remain unchanged:

- `bizbook-students-staff-v1`
- `bizbook-staff-attendance-v1`
- `bizbook-advance-payments-v1`
- `bizbook-fee-receipts-v1`
- `bizbook-payment-history-v1`
- `bizbook-payment-records-v1`
- `bizbook-salary-payments-v1`
- `bizbook-other-expenses-v1`
- `bizbook-refunds-v1`
- Business profile and logo: `bizbook-business-profile`, `bizbook-business-logo`

No records were copied, cleared, or rewritten. The schema is additive and is not connected to the UI. Student, staff, institute, installment, payment, allocation, refund, payroll and expense rows have a `legacy_data` JSON column for a later reviewed migration. This does not authorize uploading local data.

The app had no Supabase JS package, login UI, or database storage adapter. The Supabase JS and SSR packages are now installed with typed browser/server clients, a session-refresh Proxy, and a server-side membership check. Payment and Cashfree webhook routes remain placeholders (HTTP 501), and no app page or Brain Engine data path has been connected to Supabase.

The clients expect `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No credential values were displayed or changed. The browser client uses only the publishable key; the service-role client is marked server-only and is not imported by browser code. The Proxy is a pass-through unless both public settings and a Supabase auth cookie are present.

Read-only linked-project inspection on 2026-10-13 found no remote versions of the five local migrations, no base tables in the remote `public` schema, and PostgreSQL 17.11 (matching the local major-version setting). The inspection read migration metadata, the server version, and table names only; it did not read business data or apply schema changes. Credentials were not displayed.

## Tables and relationships

| Table | Purpose |
| --- | --- |
| `profiles` | Supabase Auth profile fields keyed by `auth.users.id`. |
| `coaching_institutes` | Institute identity, existing business-profile fields, and validated IANA time zone. |
| `user_memberships` | One institute role and access scope per authenticated user. Roles are owner, administrator, accountant, and staff. |
| `branches` | Optional institute branches; branch support is schema groundwork because the current UI has no branch manager. |
| `membership_branch_access` | Branch allow-list for branch-scoped memberships. |
| `students` | Student identity, parent contact including optional email, course, admission, fee totals, archive marker, and legacy fields. |
| `staff` | Staff/contact fields, salary policy, joining date, attendance setting, editable payable override, and legacy fields. |
| `attendance_records` | One status per staff member and date, matching the legacy `staffId__YYYY-MM-DD` key. |
| `student_installments` | Normalized schedule rows with a reminder schedule version that increments when the due date changes; no reusable fee-plan table was added because current schedules belong to individual students. |
| `payments` | One canonical row for each actual student receipt, with Fee/Advance classification and provider metadata. |
| `payment_allocations` | Links a receipt to installments. These rows are allocation history, never additional receipts. |
| `refunds` | Refund requests and lifecycle state tied to an original payment. |
| `refund_allocations` | Maps a refund to the original installment allocations it reverses; an unmapped remainder reserves/refunds unused advance. |
| `salary_payments` | One paid salary record per institute, staff member, and payroll month, with salary and attendance calculation snapshots. |
| `expenses` | Canonical business expense entries; voiding preserves the original row and reason. |
| `audit_logs` | Append-only row-change events with actor and entity identifiers; it deliberately avoids copying PII or full row contents. |
| `notification_logs` | Reminder stage, idempotency key, retry state, delivery status, provider reference, and a recipient fingerprint; no message body or raw recipient. |
| `payment_connections` | Non-secret provider account metadata. The secret-manager reference is not selectable by authenticated roles. |
| `payment_orders` | Server-managed provider order lifecycle and idempotency key. |
| `webhook_events` | Server-managed provider event IDs and payload hashes for retry deduplication; raw payloads are not stored. |
| `payment_reconciliation_records` | Server-managed provider transaction reconciliation linked to a BizBook payment. |

Read projections are views, not duplicate ledgers: `installment_balances`, `advance_balances`, `payment_history`, and `financial_activity`. They use invoker security so base-table RLS remains in force.

There is no separate receipt table: a receipt is represented by its payment row, which a future adapter can render in the existing receipt screens. There is no separate advance-receipt table: `payments.receipt_kind` identifies an advance receipt and the balance view derives unused value. This avoids counting a receipt and its allocation twice. Payment history is a view over fee/advance payments, salary payments, and expenses, so the history does not become a second source of income or expense. Current screens remain connected to localStorage.

The Brain reporting code contains a BizBook subscription revenue classification, but this repo has no canonical subscription transaction source or service. Penalties likewise have no canonical transaction source. No tables were added for either category, so neither can currently generate database revenue or expense rows. Business expenses remain expense outflows; salary payments remain salary outflows.

## Financial behavior

- A payment row is the actual inflow and is included once in `financial_activity`.
- Fee and advance allocations never add inflow. Only the unused portion of a paid Advance receipt appears in the advance balance; ordinary Fee receipts cannot be allocated through the advance operation.
- Multiple allocations and partial payments remain separate rows. Installment paid/outstanding values are derived, not cached in several tables.
- Refund requests in Pending or Processing reserve the remaining refundable balance. They do not reduce collections or installment paid amounts. Only Completed refunds reduce net collections; completed refunds mapped to an installment reopen that balance.
- Refund capacity is checked while locking the payment row. Allocation capacity is checked while locking both the receipt and installment.
- Manual salary recording is unique by staff/month and is a dedicated expense source. It is not duplicated into another payment ledger.
- The salary RPC derives attendance deductions from stored Absent/Leave rows after the joining date, honors fixed salary and the stored manual payable override, applies a manual adjustment, and rejects amounts that do not equal the resulting full payable amount. It snapshots the base salary and calculation details.
- The salary page now uses the Brain salary engine, so both local calculations and the database RPC ignore attendance before `joiningDate`. The current page remains localStorage-backed.
- SQL guards reject marking an installment Paid while it has a balance and validate manual payment, salary, and expense dates against each institute's IANA time zone (default `Asia/Kolkata`). Invalid time zones and inactive branch access are rejected. Advance receipts are explicitly typed as `Advance` in the `payment_history` view.
- Expenses are their own source. Voiding preserves the original amount and reason and removes the entry from active expense projections.
- Currency and rupee amounts use INR and `numeric(12,2)`; inputs with fractions smaller than one paisa are rejected by transaction functions.
- `payment_history` shows gross payment records. Reports needing net collections must use `financial_activity`, where completed refunds are negative entries.

## Tenant access and RLS

RLS is enabled for every table created by these migrations. Anonymous roles receive no table grants. Authenticated policies derive the user from `auth.uid()`, then verify an active membership and the permitted institute/branch. Tenant and foreign-key relationships are constrained in PostgreSQL; updates cannot move a record to another institute.

- Owner/administrator: institute settings, branches, membership administration, student/staff maintenance, and financial access.
- Accountant: finance, attendance, installments, expenses, and financial read projections.
- Staff: branch-authorized student/staff reads and attendance work; no direct financial ledger writes.
- Branch-scoped memberships can see shared institute rows and only assigned branch rows; writes require a permitted branch.
- Membership rows have no direct authenticated write policy. Restricted security-definer functions create institutes, grant memberships, and assign branches; callers cannot promote themselves.
- Payment, allocation, refund, salary, provider-order, and webhook tables do not grant direct authenticated ledger writes. Manual receipts, advance allocations, refund requests, manual refund completion, and salary payments go through transaction functions.
- Online payments cannot be inserted or marked paid by an authenticated client. Provider status changes require a trusted server using the service role only after signature/transaction verification. The database cannot itself verify an external provider response.
- Online refunds cannot be completed by the authenticated manual-refund function. A trusted server must wait for provider confirmation before writing a completed status.
- `service_role` bypasses RLS by design. It must stay server-side and must not be sent to a browser.
- Provider credentials are not present in the schema. `payment_connections.secret_reference` is withheld from authenticated column grants and is only a pointer for a future server-side secret manager.

The cross-tenant review checklist for a local Supabase test run is: authenticate as institute A and institute B users; verify both cannot select or mutate each other's rows; verify a branch-limited user cannot read another assigned branch's financial rows; verify membership changes cannot grant self-access; verify direct online payment/refund writes are denied; and verify two concurrent allocation/refund requests cannot exceed the receipt or installment balance. These tests were not executable in this workspace because Docker is unavailable.

## Migrations and types

Created migrations:

1. `supabase/migrations/20261013000000_bizbook_core_schema.sql`
2. `supabase/migrations/20261013000100_bizbook_tenant_security.sql`
3. `supabase/migrations/20261013000200_bizbook_payment_operations.sql`
4. `supabase/migrations/20261013000300_bizbook_refund_and_payroll_operations.sql`
5. `supabase/migrations/20261013000400_bizbook_rls_and_privileges.sql`

`lib/supabase/database.types.ts` mirrors the SQL tables, views, relationships and RPC signatures. It is manually maintained because there is no local Postgres instance from which to generate authoritative output yet. Regenerate and review it after applying migrations locally.

No SQL seed file, localStorage importer, auth UI, provider activation, or migration to the linked remote was added. The existing business and payment pages still use localStorage; the Supabase browser/server clients and authorization helper have no operational page callers. Online payment and Cashfree webhook routes remain HTTP 501 placeholders. Email and WhatsApp preview routes do not send. A fail-closed server reminder runner supports Resend email and approved Meta WhatsApp templates and writes idempotent provider-attempt logs. The existing student forms now have separate email and WhatsApp reminder-consent toggles, both defaulting to false for legacy records; the runner checks the matching explicit opt-in before sending.

The local runtime has no configured Supabase URL/publishable key, service-role key, email sender/provider, WhatsApp Cloud API credentials, or cron secret. The reminder runner expects `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BIZBOOK_CRON_SECRET`, `RESEND_API_KEY`, `BIZBOOK_EMAIL_FROM`, `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_REMINDER_TEMPLATE_NAME`, and `WHATSAPP_TEMPLATE_LANGUAGE` as server-side settings. Meta's approved WhatsApp template must contain five body placeholders in this order: student name, installment number, institute name, due date, outstanding balance. An external scheduler must call `GET /api/cron/reminders` with `Authorization: Bearer <BIZBOOK_CRON_SECRET>`; no provider or scheduler has been activated. Before enabling it, test the migrations and RLS locally and review the import/reconciliation plan. Preserve the localStorage keys and do not retire local data before per-tenant reconciliation.

## Validation and next commands

Validation results from this workspace:

- `npx tsc --noEmit`: passed.
- `npx tsx lib/bizbook-brain/test-cases.ts`: passed, 88/88 cases.
- `npm run build`: passed; Next.js generated output for 22 pages. The cron route is request-time and uses the default Node.js runtime; this Next.js setup rejects `runtime` and `dynamic` segment exports with Cache Components enabled.
- `npm run lint`: failed with 17 errors and 26 warnings. The errors are synchronous state updates inside effects (`react-hooks/set-state-in-effect`); targeted lint also reports four such errors in the business student page, on its load/save/date effects, plus existing unused-code warnings.
- `npx supabase db lint --local` and `npx supabase test db`: unable to run because no local Postgres is listening at `127.0.0.1:54322`; Docker is unavailable, so the migrations, RLS policies, and SQL regression tests have not been executed here.

The Brain suite checks explicit reminder-channel consent and local storage preservation, but it does not exercise the SQL routines or HTTP/provider delivery. The pgTAP suite includes a default-no-consent assertion; no database-specific tests ran.

On a machine with Docker, validate locally first:

```powershell
npx supabase start
npx supabase db lint --local
npx supabase test db
npx tsc --noEmit
npx tsx lib/bizbook-brain/test-cases.ts
```

`supabase start` starts the local Supabase/Postgres service; `db lint --local` requires it. The regression suite in `supabase/tests/bizbook_financial_guards.test.sql` covers inactive branches, paid installment balances, reminder consent defaults and idempotency, future and same-day manual payment/salary/expense dates in the tenant time zone, invalid time zones, and Fee/Advance history classification. Run it with `npx supabase test db` after local Supabase is available.

Do not run a reset to validate this schema; it is destructive to local database contents. Review the migration diff and local results before any remote action. When separately ready to deploy to the linked project, the commands are:

```powershell
npx supabase db push --dry-run
npx supabase db push
```

The dry run previews pending changes; `db push` applies migrations to the linked remote database. Neither command was run for this implementation.

