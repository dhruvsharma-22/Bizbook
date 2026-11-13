
/**
 * BizBook Brain — Shared Constants
 *
 * Central location for common financial and business settings.
 * Constants only: no processing and no storage operations.
 */

/* =========================================================
   CURRENCY CONFIGURATION
========================================================= */

export const CURRENCY_CODE = "INR";
export const CURRENCY_LOCALE = "en-IN";
export const PAISE_PER_RUPEE = 100;

/* =========================================================
   PAYMENT CONFIGURATION
========================================================= */

export const MINIMUM_PAYMENT_PAISE = 1;

export const DEFAULT_PAYMENT_METHODS = [
  "Cash",
  "UPI",
  "Bank Transfer",
  "Card",
  "Online",
  "Other",
] as const;

export const INSTALLMENT_STATUSES = [
  "Pending",
  "Partially Paid",
  "Paid",
  "Overdue",
  "Cancelled",
] as const;

export const PAYMENT_STATUSES = [
  "Pending",
  "Processing",
  "Paid",
  "Failed",
  "Cancelled",
  "Refunded",
  "Partially Refunded",
] as const;

export const PAYMENT_MODES = [
  "Manual",
  "Online",
] as const;

/* =========================================================
   ATTENDANCE CONFIGURATION
========================================================= */

/**
 * Keep these values compatible with the attendance page.
 */
export const ATTENDANCE_STATUSES = [
  "Present",
  "Absent",
  "Leave",
  "Holiday",
] as const;

/**
 * Existing attendance storage key.
 * Do not rename without a migration plan.
 */
export const ATTENDANCE_STORAGE_KEY =
  "bizbook-staff-attendance-v1";

/**
 * Existing attendance record key format:
 * staffId__YYYY-MM-DD
 */
export const ATTENDANCE_KEY_SEPARATOR = "__";

/* =========================================================
   SALARY CONFIGURATION
========================================================= */

/**
 * AttendanceBased:
 * Eligible attendance deductions can reduce payable salary.
 *
 * Fixed:
 * Attendance does not determine salary deductions.
 */
export const SALARY_CALCULATION_MODES = [
  "AttendanceBased",
  "Fixed",
] as const;

/**
 * Existing salary storage key.
 */
export const SALARY_PAYMENTS_STORAGE_KEY =
  "bizbook-salary-payments-v1";

/* =========================================================
   EXPENSE CONFIGURATION
========================================================= */

/**
 * Existing expense storage key.
 */
export const EXPENSES_STORAGE_KEY =
  "bizbook-other-expenses-v1";

/* =========================================================
   REFUND CONFIGURATION
========================================================= */

/**
 * Dedicated storage key for refund records.
 * Existing keys are preserved.
 */
export const REFUNDS_STORAGE_KEY =
  "bizbook-refunds-v1";

/* =========================================================
   STUDENT AND STAFF CONFIGURATION
========================================================= */

/**
 * Existing combined student/staff storage key.
 */
export const STUDENTS_STAFF_STORAGE_KEY =
  "bizbook-students-staff-v1";

/* =========================================================
   ADVANCE AND PAYMENT HISTORY CONFIGURATION
========================================================= */

export const ADVANCE_PAYMENTS_STORAGE_KEY =
  "bizbook-advance-payments-v1";

export const PAYMENT_HISTORY_STORAGE_KEY =
  "bizbook-payment-history-v1";

/**
 * Dedicated storage key for payment records.
 *
 * Payment records track payment identity and verification.
 * Payment-history entries remain a separate data structure.
 */
export const PAYMENT_RECORDS_STORAGE_KEY =
  "bizbook-payment-records-v1";

/* =========================================================
   REMINDER CONFIGURATION
========================================================= */

export const MAX_REMINDERS_PER_INSTALLMENT = 5;

export const REMINDER_CHANNELS = [
  "Email",
  "WhatsApp",
] as const;

/* =========================================================
   RECEIPT AND INVOICE CONFIGURATION
========================================================= */

export const DEFAULT_RECEIPT_PREFIX = "BB-REC";
export const DEFAULT_INVOICE_PREFIX = "BB-INV";

/* =========================================================
   FINANCIAL CALCULATION CONFIGURATION
========================================================= */

export const DEFAULT_MONEY_TOLERANCE_PAISE = 1;

/* =========================================================
   IMPORTANT
========================================================= */

/**
 * These constants define shared application rules.
 *
 * They do not replace:
 * - Data validation
 * - Payment verification
 * - Authorization
 * - Duplicate-payment protection
 * - Server-side database constraints
 */
