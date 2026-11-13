# BizBook legacy browser-data migration

**Status (2026-10-17):** Owner/admin-gated preview and local backup export are implemented. Deliberately limited test-database imports are available for new student profiles with a complete unpaid schedule, staff directory/current compensation with no attendance or salary-payment history, individually reviewed legacy expenses, and recognized institute profile fields into blank database columns only. Receipt, advance, refund, payroll-history, attendance, logo, duplicate reconciliation, and full legacy import remain **incomplete**. This audit did not inspect a user's browser keys or import actual user records.

## Current persistence boundary

Active business screens under `app/`, `components/`, and `hooks/` use Supabase and database authorization. The explicit `/settings/data-import` recovery screen is the only current business-data exception: after an institute-wide owner or administrator clicks Preview or Download, it reads only known legacy keys from that browser. Preview returns sanitized counts and metadata. Download creates a raw local backup containing recognized browser values. Separate explicit import actions can send normalized eligible student rows/unpaid schedules, staff profile/current compensation without history, individually reviewed expenses, or recognized institute profile fields into blank database columns to the authorized test database; raw browser payloads are not stored, and original keys are not changed. The profile importer skips existing values and excludes logos; the expense importer explicitly assigns a destination branch or institute-wide scope and rejects unrecognized or ambiguous fields. Supabase Auth may keep its own session state through supported client storage; that is authentication state, not a business ledger.

The branch/institute selector persists a convenience preference in the authenticated user's RLS-protected `profiles.workspace_preferences` column. Each load revalidates the institute against active memberships and the branch against the currently visible active branch list. A stale or revoked choice falls back to an authorized scope; the preference never grants access.

## Known legacy keys and shapes

The adapter source documents these keys. Their actual browser contents were not inspected; schemas below describe the code-level TypeScript/legacy formats, not verified user data.

| Key | Legacy data type / risk |
|---|---|
| `bizbook-students-staff-v1` | Combined students/staff object. Student rows may contain nested fee/installment/payment aliases and unknown legacy fields. Sensitive identity and financial history. |
| `bizbook-staff-attendance-v1` | Map keyed by `staffId__YYYY-MM-DD` to attendance status. Staff identity and attendance history. |
| `bizbook-fee-receipts-v1` | Fee receipt array. Financial claims are not provider-verified. |
| `bizbook-advance-payments-v1` | Advance receipt array; may overlap with fee/payment aliases and must be counted once. |
| `bizbook-payment-history-v1` | Legacy payment history array; may duplicate `payment-records` or receipt arrays. |
| `bizbook-payment-records-v1` | Legacy payment records; browser status cannot prove an online provider captured funds. |
| `bizbook-salary-payments-v1` | Salary payment array; private staff compensation. |
| `bizbook-other-expenses-v1` | Expense array; may contain manually entered amounts/references. |
| `bizbook-refunds-v1` | Refund array; status does not prove that money was actually returned. |
| `bizbook-business-profile` | Legacy business/institute profile JSON. |
| `bizbook-business-logo` | Legacy logo value, historically stored as a browser data URL/base64 payload. |

Storage keys are declared in `lib/bizbook-brain/constants.ts`, `lib/bizbook-brain/storage-adapter.ts`, and the former `/business/profile` implementation visible in the working-tree diff. The code also defines legacy `bizbook-*` update event names; these events are not persistent records.

## Import state and data-loss boundary

Most legacy data still has unknown institute, branch, duplicate relationships, and financial proof. The selected institute authorizes review but never determines the destination by itself. Student import requires an explicit target branch choice and owner confirmation. It blocks rows with known paid/refund claims, any matched or unlinked payment/refund history, branch IDs that need mapping, invalid exact-paise amounts/dates, duplicate source IDs, or schedules that do not equal the unpaid fee. The limited import does not import money or claim a payment was verified. Do not clear keys or treat a successful build/migration as reconciliation evidence.

## Remaining import and reconciliation requirements

1. Require an authenticated institute owner/administrator; read legacy values in the user's browser and keep them out of logs and analytics.
2. Present sanitized record-level review and require explicit institute, branch, student, and transaction mappings before importing each supported category.
3. Validate every amount from its original decimal representation. Reject fractional paise, impossible dates, invalid statuses, and unsupported fields rather than rounding them silently.
4. Reconcile student/staff identities by explicit mapping, not by name alone. Require a branch mapping when the target record is branch-scoped.
5. Compare overlapping payment, advance, fee receipt, history, and payment-record arrays. Use stable source fingerprints/idempotency keys; deduplicate only after a user-visible match decision. Never convert client-set online `Paid` status into a verified receipt. Import unverifiable legacy amounts as an explicitly identified manual legacy record only when the financial owner confirms its accounting treatment.
6. Treat pending/unverified refunds as pending evidence, not completed outflow. Require a source reference and proof/owner confirmation before recording completion. Do not invent penalty, adjustment, or subscription revenue policy.
7. Send accepted records through server-authorized, institute/branch-checked transaction RPCs that persist an idempotency mapping and audit event atomically. Store rejected-row reasons without raw records or unnecessary personal data.
8. Return a downloadable import summary: read/accepted/rejected/duplicate counts, receipts/refunds/expenses/payroll in integer paise, and source-to-database reconciliation. Re-read the resulting database views and compare them with the confirmed import manifest.
9. Keep the original keys unchanged through review and reconciliation. Clear a specific key only after an export/backup exists, the import is reconciled, and the data owner explicitly accepts the cleanup.

## Required tests before import release

- Wrong-institute and wrong-branch attempts fail at the server/database boundary.
- Identical retries create no duplicates; changed payload under an existing source key is rejected.
- Duplicate receipt aliases count once; advance allocations do not count as new receipts.
- Online legacy statuses remain unverified; pending refunds do not become completed refunds.
- Invalid amounts/dates are rejected; rejected rows are not partially written.
- A rolled-back batch leaves no import or business rows; a committed batch reconciles to the confirmed preview.
- Browser storage remains unchanged after import errors or network failures.

Only new students with entirely unpaid schedules and staff profile/current compensation records without history have transactional database import paths. Financial and historical attendance/payroll categories do not have write importers. No legacy keys have been cleared, and actual user data has not been imported or reconciled.

## Repository import-graph confirmation (2026-10-17)

A source import search across `app/`, `components/`, and `hooks/` found no active application call site for the browser-backed attendance, advance, salary, refund, payment, or expense service modules. Current screens use selected shared Brain calculation helpers and authenticated Supabase workflows. The localStorage adapter remains in the legacy library and Brain regression tests, but is no longer exported from the application-facing Brain barrel. This confirms that current screens are not using it as their active financial database; it does not mean old browser records were imported or removed. Keep the adapter/data-preservation boundary until a controlled, authenticated import and reconciliation workflow is implemented and verified.

## Workspace preference is database-backed (2026-10-17)

Migration `20261017000700_persist_workspace_scope_preferences.sql` stores only the user's selected institute and branch preference in their own profile. The test database verified the column grant, JSON shape, profile RLS, and two-user isolation (**13/13**, transaction rolled back). No browser storage is used for the selection. The value is revalidated against current memberships and branch grants whenever the application loads it.

## Local-only preview and export (2026-10-17; the import continuation below supersedes its import status)

`/settings/data-import` scans the 11 known legacy keys only after an institute-wide owner or administrator explicitly requests a preview. The screen shows key-level counts, observed transaction amounts in paise, date ranges, invalid amounts/dates, repeated transaction IDs, malformed rows, and unverified online-payment/completed-refund claims. The preview helper never returns record values, names, contact details, or IDs. Each source is capped at 8 MiB and the combined scan/export at 24 MiB. The downloadable backup contains raw recognized values, has no verified institute/branch assignment, and is labeled as sensitive; it remains in the browser and is never sent to Supabase.

`lib/legacy-import/preview.test.ts` passes **18 assertions** using synthetic in-memory storage. Full local verification after this addition: `npm test` passed **30 test files** plus BizBook Brain **88/88**; TypeScript passed; full ESLint passed; `npm run build` passed and generated **60 routes**. These checks do not test an actual user's browser data, import, database writes, or reconciliation. No database or provider call was needed for the preview feature.

## Final storage-use scan (2026-10-17)

A repository search across active `app/`, `components/`, and `hooks/` found no screen calling the browser-backed BizBook Brain payment, advance, salary, attendance, refund, or expense services. Persistent institute and financial workflows use their shared Supabase paths. The only application `localStorage` use is the explicit local review/backup and selected student/staff-profile import screen; the legacy adapter/library remains for regression tests. No old key is cleared. No actual user's browser data was read, uploaded, or imported in this audit.

The database remains authoritative for active application screens. The selected student/staff profile import paths do not reconcile remaining historical or financial categories. Do not clear browser storage until those categories have a reviewed, institute/branch-mapped import and reconciliation outcome or the data owner explicitly accepts the loss. No actual user's browser storage was inspected.

## Application persistence API hardening (2026-10-17)

The unreferenced `use-bizbook-refresh.ts` localStorage event hook has been removed. `lib/bizbook-brain/index.ts` no longer re-exports the browser-backed storage adapter or attendance, advance, salary, and expense services. Those source files remain directly available to the historical Brain regression suite; they are not used by active screens. A 25-assertion regression test checks that browser-persistence APIs stay out of the application barrel. `/settings/data-import` supports read-only preview/backup plus the limited confirmed student and staff-profile imports described below; old keys are preserved until full reconciliation or an explicit data-owner decision.

## Limited unpaid-student import (2026-10-17)

- The page now lists eligible and held student rows after an institute-wide owner/administrator chooses Preview. It displays the student/contact fields being sent, requires a target branch selection and explicit confirmation, and limits each run to 100 rows.
- Only new student master records with a complete fee schedule that exactly equals the total fee less admission fee can be imported. Installments begin unpaid. Rows with legacy paid/refund claims, linked or unmapped payment/refund history, duplicate IDs, an unmapped source branch, invalid phone/date/amount values, or inconsistent totals are held for review.
- Migration `20261017001200_safe_legacy_student_import.sql` adds an RLS-protected idempotency mapping table and `import_legacy_student_record`. The authenticated owner/administrator RPC calls `save_student_record` in the same transaction, records only source identity/fingerprint metadata, and writes an audit event. It does not persist the raw browser payload. Retries return the original target, while changed content under the same source key is rejected.
- The migration was dry-run and applied as the only pending change on test project `xabfsqtevwnwtxxkmkvc`. Read-only history confirms **38/38** applied through `20261017001200`. The rollback-only SQL suite passed **16/16** for grants, RLS, tenant/branch permissions, role denial, atomic schedule creation, idempotency, changed-source rejection, audit, and no raw payload storage. Post-run aggregate fixture counts are zero. Test catalog: 35/35 public tables have RLS, 53 policies, 85 validated and zero unvalidated FKs, seven security-invoker views, zero invalid indexes, zero unsafe application definer-function counts. Linked `supabase db lint` passes with no schema errors.
- The local normalizer suite passes **27 assertions** for exact-paise values, schedule reconciliation, linked/unlinked financial history, source branch IDs, paid status claims, duplicate IDs, malformed records, and browser read errors. No actual browser storage was read or imported. Original keys remain unchanged.
- This is not a general legacy migration. Staff, attendance, profile/logo, payroll, expenses, receipts, advances, payment history, refunds, and duplicate reconciliation still have no import path. No authenticated browser journey was run. Do not clear old keys; production remains blocked until these categories and reconciliation are addressed or the data owner makes a documented retention decision.

## Staff profile import follow-up (2026-10-17)

- `/settings/data-import` now previews staff rows separately and supports an explicit, owner/admin-confirmed profile-only import. It maps current directory and compensation settings to one selected institute/branch; it does not import attendance, salary payments, leave balances, or raw browser payloads. Rows with linked attendance/payroll history, invalid exact-paise values, ambiguous IDs, unmapped source branches, or invalid fields are held for review. Original localStorage keys are unchanged.
- Added `20261017001300_safe_legacy_staff_import.sql` with an RLS-protected fingerprint mapping and owner/admin-only `import_legacy_staff_record` transaction RPC. Exact retries return the original staff row, changed source fingerprints fail, branch access is checked in SQL, and the insert creates only the staff profile plus audit metadata.
- Applied this single migration to the authorized test project after verifying both CLI and `.env.local` refs. The rollback-only remote suite passed **17/17** assertions for grants, RLS, authorization, exact retry, changed-source rejection, audit, and absence of attendance/payroll writes. Post-run aggregate fixture counts are zero. Migration history is **39/39** and linked database lint passes.
- Local verification after integration: `npm test` passed **37 test files plus Brain 88/88**, TypeScript, full ESLint, and production build (**65 routes**). No real browser data was inspected or imported.
- This still does not reconcile attendance or salary-payment history. Financial categories, profile/logo mapping, imported-record reconciliation, authenticated browser flow, and production release evidence remain open. Do not clear existing browser keys.

## Reviewed expense import continuation (2026-10-17)

- The page now previews `bizbook-other-expenses-v1` only after the owner/admin requests a scan. The record-level review displays source ID, title, category, amount, date, method, and notes for eligible records. It holds malformed rows, duplicate IDs, invalid amount/date/method, non-INR currency, source branch/institute IDs, status metadata, and any additional unknown field.
- Each batch requires an explicit target branch or institute-wide scope and confirmation that every selected row is a real historical business cost not already posted in the selected institute. Batches are limited to 100. The database checks owner/admin membership, target branch access, institute-local business date, exact cents, and confirmation.
- Migrations `20261017001400_safe_legacy_expense_import.sql` and `20261017001500_bind_expense_import_fingerprint.sql` were applied only to the verified test project. The corrected RPC computes SHA-256 in Postgres from normalized institute, branch, source ID and expense fields; the original caller-fingerprint RPC has no execute privilege for client or service roles. The new RPC atomically creates the expense, source mapping, and audit event. Exact retries return the original row; changed normalized content or destination is rejected. The raw legacy object is not sent to or stored in the database. The local browser key is not changed, and the importer no longer retains the raw object in React preview state.
- The local expense normalizer tests pass. The final remote SQL suite passed **22/22** in a transaction ending with `ROLLBACK`; post-run fixture counts show no synthetic data remains. Test migration history is **41/41** and linked schema lint passes.
- No actual user's browser data was inspected or imported. This path does not reconcile receipts, payment-history aliases, advances, refunds, payroll, attendance, or profile/logo records. It also does not prove that an eligible legacy cost is absent from the ledger; the owner must review/confirm that. Do not clear any source key until import reconciliation is complete or the data owner explicitly accepts cleanup.

## Institute profile import continuation (2026-10-17)

- `/settings/data-import` now offers an owner/admin-confirmed import for recognized institute profile fields only. It fills blank database columns, skips existing values, holds unknown/invalid fields, excludes logos, and preserves source keys. The RPC checks institute-wide owner/admin membership, uses a row lock and idempotent source mapping, computes the fingerprint in PostgreSQL, and audits field names without writing raw browser payloads.
- Added and applied `20261017001600_safe_legacy_business_profile_import.sql` and corrective `20261017001700_fix_legacy_profile_json_validation.sql` only to the verified test project. The rollback-only PostgreSQL suite passed **19/19** and left zero synthetic users, institutes, or import mappings.
- Read-only Management API history reports **43/43** migrations applied; catalog inspection found 38/38 public tables with RLS, 56 policies, 95 validated/zero unvalidated FKs, seven security-invoker views, and no invalid indexes. CLI migration-list/lint currently fail before database inspection with PostgreSQL login `28P01`. Local checks passed: 39 test files plus Brain 88/88, TypeScript, lint, and build (65 routes).
- This is a limited profile-field importer, not logo or financial-history reconciliation. No user's browser storage was inspected/imported and no production project was queried or changed. Production remains **NO-GO**.
