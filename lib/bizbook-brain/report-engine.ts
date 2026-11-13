
/**
 * BizBook Brain — Report Engine
 *
 * Calculates report summaries from existing financial records.
 * Does not create, modify, or persist transactions.
 *
 * Mixed financial model:
 * - Student receipts are counted as received cash.
 * - Allocating an existing advance is not a new inflow.
 * - Salary and business expenses are outflows.
 * - Refunds are outflows.
 * - BizBook subscription income is separate from coaching income.
 *
 * This is an operational cash summary, not a formal accounting
 * or tax report.
 */

import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";
import { getStudentAvailableAdvance } from "./advance-engine";
import { normalizeStudentReceiptRecords } from "./receipt-adapter";

import type {
  PaymentHistoryEntry,
  Student,
  StudentReceiptRecord,
} from "./types";

export interface StudentFeeReport {
  studentId: string;
  studentName: string;
  course: string;
  totalFee: number;
  totalReceived: number;
  outstanding: number;
  availableAdvance: number;
}

export interface FinancialReport {
  generatedAt: string;
  studentCount: number;
  totalFee: number;
  totalReceived: number;
  totalOutstanding: number;
  totalAvailableAdvance: number;
  totalExpenses: number;
  netCashPosition: number;
  paymentCount: number;
  averagePayment: number;
}

export interface ReportExpense {
  id: string;
  amount: number;
  status?: string;
}

export interface ReportRefund {
  id: string;
  amount: number;
  status: string;
}

export interface ReportSubscriptionIncome {
  id: string;
  amount: number;
  status?: string;
}

export interface ExtendedFinancialReport extends FinancialReport {
  totalRefunds: number;
  totalSubscriptionIncome: number;
  coachingNetCashPosition: number;
  bizbookSubscriptionIncome: number;
  combinedNetCashPosition: number;
}

function sumPaise(values: number[]): number {
  let total = 0;

  for (const value of values) {
    const amountPaise = toPaise(value);
    const next = total + amountPaise;

    if (!Number.isSafeInteger(next)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Report total exceeds the supported amount."
      );
    }

    total = next;
  }

  return total;
}

function validateUniqueIds(
  records: Array<{ id?: unknown }>,
  label: string,
): void {
  const seen = new Set<string>();

  for (const record of records) {
    if (!record || typeof record.id !== "string" || !record.id.trim()) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        `${label} contains a record without a valid ID.`,
      );
    }

    if (seen.has(record.id)) {
      throw new BizBookError(
        "DUPLICATE_RECORD",
        `${label} contains a duplicate ID.`,
        { recordId: record.id },
      );
    }

    seen.add(record.id);
  }
}

function getCompletedAmounts(
  records: Array<{ amount: number; status?: string }>
): number[] {
  return records
    .filter(
      (record) =>
        record.status === undefined ||
        record.status.toLowerCase() === "completed" ||
        record.status.toLowerCase() === "paid"
    )
    .map((record) => record.amount);
}

/**
 * Builds a fee report for one student.
 */
export function createStudentFeeReport(
  student: Student,
  receipts: StudentReceiptRecord[]
): StudentFeeReport {
  if (!student || !Array.isArray(receipts)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "A student and receipt array are required."
    );
  }

  const normalizedReceipts = normalizeStudentReceiptRecords(receipts);
  const studentReceipts = normalizedReceipts.filter(
    (receipt) => receipt.studentId === student.id
  );

  const totalReceivedPaise = sumPaise(
    studentReceipts.map((receipt) => receipt.amount)
  );

  const totalFeePaise = toPaise(student.totalFee ?? 0);

  if (totalFeePaise < 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Student total fee cannot be negative."
    );
  }

  const outstandingPaise = Math.max(
    0,
    totalFeePaise - totalReceivedPaise
  );

  return {
    studentId: student.id,
    studentName: student.name,
    course: student.course ?? student.className ?? "",
    totalFee: fromPaise(totalFeePaise),
    totalReceived: fromPaise(totalReceivedPaise),
    outstanding: fromPaise(outstandingPaise),
    availableAdvance: getStudentAvailableAdvance(
      student.id,
      normalizedReceipts
    ),
  };
}

/**
 * Generates the existing operational report.
 *
 * Existing calls with three arguments remain supported.
 * Payment history entries of type "Salary" are treated as expenses.
 *
 * Note: this legacy signature cannot reliably identify whether
 * every receipt is a student fee receipt or an advance receipt.
 * It must not be used as a complete ledger until the application
 * supplies normalized, uniquely identified financial transactions.
 */
export function createFinancialReport(
  students: Student[],
  receipts: StudentReceiptRecord[],
  paymentHistory: PaymentHistoryEntry[]
): FinancialReport {
  if (
    !Array.isArray(students) ||
    !Array.isArray(receipts) ||
    !Array.isArray(paymentHistory)
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Students, receipts and payment history must be arrays."
    );
  }

  validateUniqueIds(
    students.map((student) => ({ id: student?.id })),
    "Students",
  );
  validateUniqueIds(paymentHistory, "Payment history");

  const normalizedReceipts = normalizeStudentReceiptRecords(receipts);
  const studentReports = students.map((student) =>
    createStudentFeeReport(student, normalizedReceipts)
  );

  const totalFeePaise = sumPaise(
    studentReports.map((report) => report.totalFee)
  );

  const totalReceivedPaise = sumPaise(
    studentReports.map((report) => report.totalReceived)
  );

  const totalOutstandingPaise = sumPaise(
    studentReports.map((report) => report.outstanding)
  );

  const totalAvailableAdvancePaise = sumPaise(
    studentReports.map((report) => report.availableAdvance)
  );

  const salaryPayments = paymentHistory.filter(
    (entry) =>
      entry.type === "Salary" &&
      (
        !("status" in entry) ||
        entry.status === "completed" ||
        entry.status === "paid"
      )
  );

  const totalExpensesPaise = sumPaise(
    salaryPayments.map((entry) => entry.amount)
  );

  const paymentCount = normalizedReceipts.length;

  const averagePaymentPaise =
    paymentCount > 0
      ? Math.round(totalReceivedPaise / paymentCount)
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    studentCount: students.length,
    totalFee: fromPaise(totalFeePaise),
    totalReceived: fromPaise(totalReceivedPaise),
    totalOutstanding: fromPaise(totalOutstandingPaise),
    totalAvailableAdvance: fromPaise(totalAvailableAdvancePaise),
    totalExpenses: fromPaise(totalExpensesPaise),
    netCashPosition: fromPaise(
      totalReceivedPaise - totalExpensesPaise
    ),
    paymentCount,
    averagePayment: fromPaise(averagePaymentPaise),
  };
}

/**
 * Generates an expanded cash summary from normalized records.
 *
 * Supply each actual receipt/refund/expense/subscription transaction
 * once. Do not supply an advance allocation as a new receipt.
 *
 * Expenses and refunds reduce coaching cash position.
 * BizBook subscription income remains separately visible.
 */
export function createExtendedFinancialReport(input: {
  students: Student[];
  receipts: StudentReceiptRecord[];
  paymentHistory: PaymentHistoryEntry[];
  expenses?: ReportExpense[];
  refunds?: ReportRefund[];
  subscriptionIncome?: ReportSubscriptionIncome[];
}): ExtendedFinancialReport {
  if (
    !input ||
    !Array.isArray(input.students) ||
    !Array.isArray(input.receipts) ||
    !Array.isArray(input.paymentHistory)
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Valid report input is required."
    );
  }

  const expenses = input.expenses ?? [];
  const refunds = input.refunds ?? [];
  const subscriptionIncome = input.subscriptionIncome ?? [];

  validateUniqueIds(expenses, "Expenses");
  validateUniqueIds(refunds, "Refunds");
  validateUniqueIds(subscriptionIncome, "Subscription income");

  const base = createFinancialReport(
    input.students,
    input.receipts,
    input.paymentHistory
  );

  const additionalExpensePaise = sumPaise(
    getCompletedAmounts(expenses)
  );

  const salaryExpensePaise = toPaise(base.totalExpenses);

  const totalExpensePaise =
    salaryExpensePaise + additionalExpensePaise;

  if (!Number.isSafeInteger(totalExpensePaise)) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Combined expenses exceed the supported amount."
    );
  }

  const completedRefunds = refunds.filter(
    (refund) =>
      refund.status.toLowerCase() === "completed"
  );

  const refundPaise = sumPaise(
    completedRefunds.map((refund) => refund.amount)
  );

  const subscriptionPaise = sumPaise(
    getCompletedAmounts(subscriptionIncome)
  );

  const coachingCashPaise =
    toPaise(base.totalReceived) -
    totalExpensePaise -
    refundPaise;

  return {
    ...base,
    totalExpenses: fromPaise(totalExpensePaise),
    totalRefunds: fromPaise(refundPaise),
    totalSubscriptionIncome: fromPaise(subscriptionPaise),
    coachingNetCashPosition: fromPaise(coachingCashPaise),
    bizbookSubscriptionIncome: fromPaise(subscriptionPaise),
    combinedNetCashPosition: fromPaise(
      coachingCashPaise + subscriptionPaise
    ),
    netCashPosition: fromPaise(coachingCashPaise),
  };
}
