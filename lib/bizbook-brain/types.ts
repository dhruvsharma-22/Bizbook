
/**
 * BizBook Brain — Shared Data Types
 *
 * Defines common data structures used across BizBook.
 * Types only: no business processing or storage operations.
 */

/* =========================================================
   PAYMENT TYPES
========================================================= */

export type PaymentMethod =
  | "Cash"
  | "UPI"
  | "Bank Transfer"
  | "Card"
  | "Cheque"
  | "Online"
  | "Other";

export type InstallmentStatus =
  | "Pending"
  | "Partially Paid"
  | "Paid"
  | "Overdue"
  | "Cancelled";

export type PaymentStatus =
  | "Pending"
  | "Processing"
  | "Paid"
  | "Failed"
  | "Cancelled"
  | "Refunded"
  | "Partially Refunded";

export type PaymentMode = "Manual" | "Online";

/* =========================================================
   STUDENT AND INSTALLMENT TYPES
========================================================= */

export interface Installment {
  id?: string;
  amount: number;
  scheduledAmount?: number;
  dueDate?: string;
  status?: InstallmentStatus;
  paidAmount?: number;
  advanceAppliedAmount?: number;
  paidAt?: string;
  /** Legacy installment payment fields retained by older screens. */
  amountPaid?: number;
  paid?: number;
  payments?: { amount?: number; status?: string }[];
}

export interface Student {
  id: string;
  coachingId?: string;
  name: string;
  course?: string;
  parentEmail?: string;
  parentEmailOptIn?: boolean;
  whatsappOptIn?: boolean;
  className?: string;
  totalFee?: number;
  admissionFee?: number;
  installments?: Installment[];

  /** Preserve existing application-specific fields. */
  [key: string]: unknown;
}

/* =========================================================
   STAFF TYPES
========================================================= */

/**
 * Salary calculation policy for a staff member.
 *
 * AttendanceBased:
 * Monthly salary can be reduced by eligible unpaid
 * absence/leave deductions.
 *
 * Fixed:
 * Monthly salary is not reduced based on attendance.
 */
export type SalaryCalculationMode =
  | "AttendanceBased"
  | "Fixed";

export interface StaffMember {
  id?: string;
  coachingId?: string;
  name?: string;
  designation?: string;
  monthlySalary?: number;
  joiningDate?: string;
  perDayLeaveCut?: number;

  /**
   * Optional for backward compatibility.
   * Existing staff without this field must be handled
   * using an explicit application-level default.
   */
  salaryCalculationMode?: SalaryCalculationMode;

  [key: string]: unknown;
}

export interface StudentsStaffData {
  students: Student[];
  staff: StaffMember[];

  /** Preserve application-specific fields on the stored root object. */
  [key: string]: unknown;
}

/* =========================================================
   ATTENDANCE TYPES
========================================================= */

export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "Leave"
  | "Holiday";

/**
 * One attendance entry for one staff member on one date.
 *
 * The existing storage key format remains:
 * staffId__YYYY-MM-DD
 */
export interface AttendanceRecord {
  staffId: string;
  date: string;
  status: AttendanceStatus;
  updatedAt?: string;
  note?: string;
}

/**
 * Existing attendance storage shape:
 *
 * {
 *   "staffId__YYYY-MM-DD": "Present",
 *   "staffId__YYYY-MM-DD": "Absent"
 * }
 *
 * Status values remain strings to preserve compatibility
 * with the current attendance page and stored data.
 */
export type AttendanceData = Record<string, AttendanceStatus>;

/**
 * Input for marking or changing staff attendance.
 */
export interface AttendanceInput {
  staffId: string;
  date: string;
  status: AttendanceStatus;
  note?: string;
}

/**
 * Attendance totals for a staff member within a period.
 */
export interface AttendanceSummary {
  staffId: string;
  startDate: string;
  endDate: string;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  holidayDays: number;
  recordedDays: number;
}

/* =========================================================
   SALARY CALCULATION TYPES
========================================================= */

/**
 * Input used to calculate a staff member's salary.
 *
 * Attendance-based mode uses eligible unpaid days and
 * perDayLeaveCut.
 *
 * Fixed mode does not deduct salary based on attendance.
 */
export interface SalaryCalculationInput {
  staffId: string;
  month: string;
  monthlySalary: number;
  mode: SalaryCalculationMode;
  perDayLeaveCut?: number;
  attendance?: AttendanceData;
  joiningDate?: string;
  manualAdjustment?: number;
}

/**
 * Result returned by the salary calculation engine.
 */
export interface SalaryCalculationResult {
  staffId: string;
  month: string;
  mode: SalaryCalculationMode;
  monthlySalary: number;
  deductionDays: number;
  perDayLeaveCut: number;
  attendanceDeduction: number;
  manualAdjustment: number;
  payableSalary: number;
}

/* =========================================================
   INSTALLMENT AND ADVANCE TYPES
========================================================= */

export interface InstallmentAllocation {
  installmentIndex: number;
  amount: number;
  appliedAt: string;
}

/**
 * Money received from a student as an advance payment.
 *
 * Only the unused portion of this payment contributes
 * to the student's available advance balance.
 *
 * Allocating an advance to installments does not create
 * a second receipt or a second income entry.
 */
export interface AdvancePayment {
  id: string;
  coachingId?: string;
  studentId: string;
  studentName: string;
  course?: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  createdAt: string;
  appliedAmount?: number;
  appliedTo?: InstallmentAllocation[];
}

/* =========================================================
   FEE RECEIPT TYPES
========================================================= */

/**
 * A receipt for an ordinary student fee payment.
 *
 * Kept separate from AdvancePayment so an ordinary fee
 * receipt is not mistaken for an available advance balance.
 *
 * paymentRecordId links the receipt to its corresponding
 * payment record for reconciliation and duplicate checks.
 */
export interface FeeReceipt {
  id: string;
  coachingId?: string;
  studentId: string;
  studentName: string;
  course?: string;
  amount: number;
  paymentDate: string;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  createdAt: string;
  paymentRecordId: string;
}

/** A persisted student receipt in either current storage format. */
export type StudentReceiptRecord = AdvancePayment | FeeReceipt;

/* =========================================================
   PAYMENT HISTORY AND PAYMENT RECORDS
========================================================= */

export interface PaymentHistoryEntry {
  id: string;
  coachingId?: string;
  type: "Fee" | "Salary" | "Expense";
  personId: string;
  personName: string;
  description: string;
  amount: number;
  paidAt: string;
  method?: PaymentMethod;
}

export interface PaymentRecord {
  id: string;
  coachingId?: string;
  studentId: string;
  amount: number;
  currency?: "INR";
  provider?: "razorpay" | "cashfree";
  providerOrderId?: string;
  method: PaymentMethod;
  mode: PaymentMode;
  status: PaymentStatus;
  providerReference?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  totalFee: number;
  totalReceived: number;
  totalOutstanding: number;
  advanceAvailable: number;
}

/* =========================================================
   ERROR TYPES
========================================================= */

export interface BizBookErrorDetails {
  code: string;
  message: string;
  field?: string;
}

/* =========================================================
   SALARY PAYMENT RECORDS
========================================================= */

export interface SalaryPayment {
  staffId: string;
  month: string;
  amount: number;
  status: "Paid";
  paidAt: string;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;

  /** Optional historical calculation details. */
  salaryCalculationMode?: SalaryCalculationMode;
  attendanceDeduction?: number;
  manualAdjustment?: number;
}

export interface SalaryPaymentInput {
  staffId: string;
  month: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  salaryCalculationMode?: SalaryCalculationMode;
  attendanceDeduction?: number;
  manualAdjustment?: number;
}

/* =========================================================
   EXPENSE TYPES
========================================================= */

export interface ExpenseRecord {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  notes?: string;
  createdAt: string;
}

export interface ExpenseInput {
  title: string;
  category: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  notes?: string;
}
