
/**
 * BizBook Brain — Central Entry Point
 *
 * Active website flows import shared business rules from this file and persist
 * through authenticated Supabase services. Browser-backed legacy adapters are
 * intentionally not re-exported from the application-facing entry point.
 *
 * This file only re-exports functionality.
 * Financial operations belong in services and engines.
 */

// Core types, constants and errors
export * from "./types";
export * from "./constants";
export * from "./errors";

// Money utilities
export * from "./money";

// Validation engine
// Allocation validation is exported from installment-engine
// to avoid duplicate exports.
export {
  validateAmount,
  validateStudent,
  validateInstallment,
  validatePaymentMethod,
  validateDate,
  validatePayrollMonth,
  validateStaff,
  validateAttendanceStatus,
  validateAttendanceInput,
  validateAttendanceRecord,
  validateSalaryCalculationMode,
  validateSalaryCalculationInput,
  validateSalaryPaymentInput,
  validateExpenseInput,
  validateExpenseRecord,
} from "./validation-engine";

// Installment engine
export {
  getInstallmentRemaining,
  getTotalInstallmentRemaining,
  validateInstallmentAllocation,
  applyInstallmentPayment,
  applyInstallmentAdvance,
} from "./installment-engine";

// Payment and advance engines/services
export * from "./payment-engine";
export * from "./advance-engine";

// Balances and accounting
export * from "./balance-engine";
export * from "./accounting-engine";

// Refunds, reconciliation and audit
export * from "./refund-engine";
export * from "./reconciliation-engine";
export * from "./audit-engine";

// Reports, receipts and invoices
export * from "./report-engine";
export * from "./financial-summary-engine";
export * from "./receipt-engine";
export * from "./receipt-adapter";
export * from "./invoice-engine";

// Reminders and notifications
export * from "./reminder-engine";
export * from "./reminder-templates";
export * from "./reminder-log";
export * from "./notification-service";

// Payment provider abstraction
export * from "./payment-provider";
export * from "./salary-engine";
export * from "./expense-engine";
