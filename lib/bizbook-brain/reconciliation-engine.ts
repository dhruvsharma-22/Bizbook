
/**
 * BizBook Brain — Reconciliation Engine
 *
 * Diagnostic only: never changes stored financial records.
 *
 * Rules:
 * - Advance allocations are not new cash inflows.
 * - Receipt/history differences are not automatically errors.
 * - Coaching records and BizBook subscription revenue are separate.
 * - Salary and expense records are not student fee collections.
 * - Reconciliation does not invent missing transactions.
 */

import { BizBookError } from "./errors";
import { toPaise } from "./money";
import { getInstallmentRemaining } from "./installment-engine";

import type {
  AdvancePayment,
  PaymentHistoryEntry,
  Student,
} from "./types";

export type ReconciliationSeverity = "Warning" | "Error";

export interface ReconciliationIssue {
  code: string;
  severity: ReconciliationSeverity;
  studentId?: string;
  recordId?: string;
  message: string;
  expectedAmount?: number;
  actualAmount?: number;
}

export interface ReconciliationResult {
  checkedAt: string;
  checkedStudents: number;
  checkedReceipts: number;
  checkedHistoryEntries: number;
  issues: ReconciliationIssue[];
  isBalanced: boolean;
}

export interface ReconciliationInput {
  students: Student[];
  receipts: AdvancePayment[];
  paymentHistory: PaymentHistoryEntry[];
  tolerancePaise?: number;
}

function addIssue(
  issues: ReconciliationIssue[],
  issue: ReconciliationIssue,
): void {
  issues.push(issue);
}

function safePaise(amount: number): number | null {
  try {
    const result = toPaise(amount);

    return Number.isSafeInteger(result) && result >= 0
      ? result
      : null;
  } catch {
    return null;
  }
}

function addPaise(
  current: number,
  next: number,
): number | null {
  const total = current + next;

  return Number.isSafeInteger(total) && total >= 0
    ? total
    : null;
}

function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function isValidDate(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    return false;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp);
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function reconcileFinancialRecords(
  input: ReconciliationInput,
): ReconciliationResult {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Reconciliation input is required.",
    );
  }

  const {
    students,
    receipts,
    paymentHistory,
    tolerancePaise = 0,
  } = input;

  if (
    !Array.isArray(students) ||
    !Array.isArray(receipts) ||
    !Array.isArray(paymentHistory)
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Students, receipts and payment history must be arrays.",
    );
  }

  if (
    !Number.isSafeInteger(tolerancePaise) ||
    tolerancePaise < 0
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "tolerancePaise must be a non-negative safe integer.",
    );
  }

  const issues: ReconciliationIssue[] = [];
  const studentById = new Map<string, Student>();

  // ---------------------------------------------------------
  // STUDENT VALIDATION
  // ---------------------------------------------------------

  for (const student of students) {
    if (
      !student ||
      !isValidId(student.id)
    ) {
      addIssue(issues, {
        code: "INVALID_STUDENT_ID",
        severity: "Error",
        message:
          "A student record has a missing or invalid ID.",
      });

      continue;
    }

    if (studentById.has(student.id)) {
      addIssue(issues, {
        code: "DUPLICATE_STUDENT_ID",
        severity: "Error",
        studentId: student.id,
        recordId: student.id,
        message:
          "Multiple student records use the same ID.",
      });

      continue;
    }

    studentById.set(student.id, student);
  }

  // ---------------------------------------------------------
  // ADVANCE RECEIPT AND ALLOCATION VALIDATION
  // ---------------------------------------------------------

  const receiptIds = new Set<string>();
  const receiptTotals = new Map<string, number>();

  for (const receipt of receipts) {
    if (
      !receipt ||
      !isValidId(receipt.id) ||
      !isValidId(receipt.studentId)
    ) {
      addIssue(issues, {
        code: "INVALID_RECEIPT_IDENTITY",
        severity: "Error",
        message:
          "An advance receipt has invalid identifying fields.",
      });

      continue;
    }

    if (receiptIds.has(receipt.id)) {
      addIssue(issues, {
        code: "DUPLICATE_RECEIPT_ID",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "Multiple receipts use the same receipt ID.",
      });

      // Do not count a duplicate receipt a second time.
      continue;
    }

    receiptIds.add(receipt.id);

    const amountPaise = safePaise(receipt.amount);

    if (amountPaise === null || amountPaise <= 0) {
      addIssue(issues, {
        code: "INVALID_RECEIPT_AMOUNT",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "Receipt amount must be a valid positive amount.",
      });

      continue;
    }

    const student = studentById.get(receipt.studentId);

    if (!student) {
      addIssue(issues, {
        code: "RECEIPT_STUDENT_NOT_FOUND",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "Receipt refers to a student that was not found.",
      });
    }

    if (!isValidDate(receipt.paymentDate)) {
      addIssue(issues, {
        code: "INVALID_RECEIPT_DATE",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message: "Receipt payment date is invalid.",
      });
    }

    const appliedPaise = safePaise(
      receipt.appliedAmount ?? 0,
    );

    const appliedAmountValid =
      appliedPaise !== null &&
      appliedPaise <= amountPaise;

    if (!appliedAmountValid) {
      addIssue(issues, {
        code: "INVALID_RECEIPT_ALLOCATION",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "Applied amount is invalid or exceeds the receipt amount.",
        expectedAmount: receipt.amount,
        actualAmount: receipt.appliedAmount,
      });
    }

    // Validate individual allocation records.
    const allocations = receipt.appliedTo ?? [];
    let allocationTotalPaise = 0;
    let allocationTotalValid = true;

    if (!Array.isArray(allocations)) {
      allocationTotalValid = false;

      addIssue(issues, {
        code: "INVALID_ALLOCATION_LIST",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "Receipt allocations must be an array.",
      });
    } else {
      for (const allocation of allocations) {
        if (!isPlainObject(allocation)) {
          allocationTotalValid = false;

          addIssue(issues, {
            code: "INVALID_ALLOCATION",
            severity: "Error",
            studentId: receipt.studentId,
            recordId: receipt.id,
            message:
              "An advance allocation record is invalid.",
          });

          continue;
        }

        const allocationAmount = allocation.amount;
        const allocationPaise =
          typeof allocationAmount === "number"
            ? safePaise(allocationAmount)
            : null;

        if (
          allocationPaise === null ||
          allocationPaise <= 0
        ) {
          allocationTotalValid = false;

          addIssue(issues, {
            code: "INVALID_ALLOCATION_AMOUNT",
            severity: "Error",
            studentId: receipt.studentId,
            recordId: receipt.id,
            message:
              "Allocation amount must be a valid positive amount.",
          });

          continue;
        }

        const allocationDate = allocation.appliedAt;

        if (!isValidDate(allocationDate)) {
          addIssue(issues, {
            code: "INVALID_ALLOCATION_DATE",
            severity: "Error",
            studentId: receipt.studentId,
            recordId: receipt.id,
            message:
              "Advance allocation date is invalid.",
          });
        }

        const installmentIndex =
          allocation.installmentIndex;

        if (
          typeof installmentIndex !== "number" ||
          !Number.isInteger(installmentIndex) ||
          installmentIndex < 0
        ) {
          allocationTotalValid = false;

          addIssue(issues, {
            code: "INVALID_INSTALLMENT_REFERENCE",
            severity: "Error",
            studentId: receipt.studentId,
            recordId: receipt.id,
            message:
              "Allocation contains an invalid installment index.",
          });

          continue;
        }

        if (
          student &&
          Array.isArray(student.installments) &&
          installmentIndex >= student.installments.length
        ) {
          addIssue(issues, {
            code: "ALLOCATION_INSTALLMENT_NOT_FOUND",
            severity: "Error",
            studentId: receipt.studentId,
            recordId: receipt.id,
            message:
              `Allocation refers to missing installment index ${installmentIndex}.`,
          });
        }

        const nextAllocationTotal = addPaise(
          allocationTotalPaise,
          allocationPaise,
        );

        if (nextAllocationTotal === null) {
          allocationTotalValid = false;

          addIssue(issues, {
            code: "ALLOCATION_TOTAL_OVERFLOW",
            severity: "Error",
            studentId: receipt.studentId,
            recordId: receipt.id,
            message:
              "Allocation total exceeds the safe calculation limit.",
          });

          continue;
        }

        allocationTotalPaise = nextAllocationTotal;
      }
    }

    // The allocation ledger should agree with appliedAmount.
    // This check is skipped if the allocation records themselves
    // could not be safely validated.
    if (
      allocationTotalValid &&
      appliedAmountValid &&
      Math.abs(
        allocationTotalPaise - (appliedPaise as number),
      ) > tolerancePaise
    ) {
      addIssue(issues, {
        code: "ALLOCATION_TOTAL_MISMATCH",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "The allocation records do not match the receipt's applied amount.",
        expectedAmount: receipt.appliedAmount ?? 0,
        actualAmount: allocationTotalPaise / 100,
      });
    }

    // Count the original cash receipt exactly once.
    // Its allocations are not additional cash receipts.
    const current =
      receiptTotals.get(receipt.studentId) ?? 0;

    const next = addPaise(current, amountPaise);

    if (next === null) {
      addIssue(issues, {
        code: "RECEIPT_TOTAL_OVERFLOW",
        severity: "Error",
        studentId: receipt.studentId,
        recordId: receipt.id,
        message:
          "Receipt total exceeds the safe calculation limit.",
      });
    } else {
      receiptTotals.set(receipt.studentId, next);
    }
  }

  // ---------------------------------------------------------
  // PAYMENT HISTORY VALIDATION
  // ---------------------------------------------------------

  const historyIds = new Set<string>();
  const feeHistoryTotals = new Map<string, number>();

  for (const entry of paymentHistory) {
    if (
      !entry ||
      !isValidId(entry.id)
    ) {
      addIssue(issues, {
        code: "INVALID_HISTORY_ID",
        severity: "Error",
        message:
          "A payment-history entry has a missing or invalid ID.",
      });

      continue;
    }

    if (historyIds.has(entry.id)) {
      addIssue(issues, {
        code: "DUPLICATE_HISTORY_ID",
        severity: "Error",
        recordId: entry.id,
        message:
          "Multiple payment-history entries use the same ID.",
      });

      continue;
    }

    historyIds.add(entry.id);

    const amountPaise = safePaise(entry.amount);

    if (amountPaise === null || amountPaise <= 0) {
      addIssue(issues, {
        code: "INVALID_HISTORY_AMOUNT",
        severity: "Error",
        recordId: entry.id,
        message:
          "Payment-history amount must be a valid positive amount.",
      });

      continue;
    }

    // Validate all history types, but only Fee records belong
    // in the student fee diagnostic totals.
    if (entry.type !== "Fee") {
      continue;
    }

    if (!isValidId(entry.personId)) {
      addIssue(issues, {
        code: "FEE_HISTORY_STUDENT_MISSING",
        severity: "Error",
        recordId: entry.id,
        message:
          "Fee history entry has no valid student ID.",
      });

      continue;
    }

    if (!studentById.has(entry.personId)) {
      addIssue(issues, {
        code: "FEE_HISTORY_STUDENT_NOT_FOUND",
        severity: "Error",
        studentId: entry.personId,
        recordId: entry.id,
        message:
          "Fee history refers to a student that was not found.",
      });
    }

    const current =
      feeHistoryTotals.get(entry.personId) ?? 0;

    const next = addPaise(current, amountPaise);

    if (next === null) {
      addIssue(issues, {
        code: "HISTORY_TOTAL_OVERFLOW",
        severity: "Error",
        studentId: entry.personId,
        recordId: entry.id,
        message:
          "Fee history total exceeds the safe calculation limit.",
      });
    } else {
      feeHistoryTotals.set(entry.personId, next);
    }
  }

  // ---------------------------------------------------------
  // RECEIPT / PAYMENT HISTORY DIAGNOSTICS
  // ---------------------------------------------------------

  // Do not directly compare all advance receipts with Fee history.
  // An advance receipt and its later installment application can
  // describe stages of the same money, not two separate inflows.
  //
  // Aggregate differences are not reported as errors without
  // explicit transaction references proving that both collections
  // represent the same transaction population.
  //
  // Totals are intentionally not added together here.

  // ---------------------------------------------------------
  // INSTALLMENT VALIDATION
  // ---------------------------------------------------------

  for (const student of students) {
    if (
      !student ||
      !isValidId(student.id) ||
      !Array.isArray(student.installments)
    ) {
      continue;
    }

    const installmentIds = new Set<string>();

    for (
      let index = 0;
      index < student.installments.length;
      index++
    ) {
      const installment = student.installments[index];

      if (!installment) {
        addIssue(issues, {
          code: "INVALID_INSTALLMENT",
          severity: "Error",
          studentId: student.id,
          message:
            `Installment ${index + 1} is missing or invalid.`,
        });

        continue;
      }

      if (isValidId(installment.id)) {
        if (installmentIds.has(installment.id)) {
          addIssue(issues, {
            code: "DUPLICATE_INSTALLMENT_ID",
            severity: "Error",
            studentId: student.id,
            recordId: installment.id,
            message:
              "Multiple installments for this student use the same ID.",
          });
        } else {
          installmentIds.add(installment.id);
        }
      }

      try {
        const remaining =
          getInstallmentRemaining(installment);

        if (
          !Number.isFinite(remaining) ||
          remaining < 0
        ) {
          addIssue(issues, {
            code: "NEGATIVE_INSTALLMENT_BALANCE",
            severity: "Error",
            studentId: student.id,
            recordId: installment.id,
            message:
              `Installment ${index + 1} has an invalid or negative balance.`,
          });
        }
      } catch (error) {
        addIssue(issues, {
          code: "INVALID_INSTALLMENT",
          severity: "Error",
          studentId: student.id,
          recordId: installment.id,
          message:
            error instanceof Error
              ? error.message
              : `Installment ${index + 1} could not be validated.`,
        });
      }
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    checkedStudents: students.length,
    checkedReceipts: receipts.length,
    checkedHistoryEntries: paymentHistory.length,
    issues,
    isBalanced: issues.length === 0,
  };
}
