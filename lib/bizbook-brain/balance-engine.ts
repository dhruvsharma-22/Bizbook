
/**
 * BizBook Brain — Balance Engine
 *
 * Calculates student-level fee balances.
 * This file does not save or modify payment records.
 *
 * Rules:
 * - Recorded receipts determine total received.
 * - Installments determine outstanding when a schedule exists.
 * - Unapplied advance is reported separately.
 * - Applying an advance must not create another receipt.
 */

import { BizBookError } from "./errors";
import {
  fromPaise,
  toPaise,
} from "./money";

import {
  getTotalInstallmentRemaining,
} from "./installment-engine";

import {
  validateAmount,
} from "./validation-engine";
import { normalizeStudentReceiptRecords } from "./receipt-adapter";

import type {
  AdvancePayment,
  PaymentSummary,
  Student,
  StudentReceiptRecord,
} from "./types";

/**
 * Calculates outstanding from the student's installment schedule.
 */
export function calculateInstallmentOutstanding(
  student: Student
): number {
  if (!student || typeof student !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student record is required."
    );
  }

  if (!Array.isArray(student.installments)) {
    return 0;
  }

  return getTotalInstallmentRemaining(student.installments);
}

/**
 * Validates a receipt before using it in balance calculations.
 */
function validateReceipt(receipt: AdvancePayment): void {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    typeof receipt.id !== "string" ||
    !receipt.id.trim() ||
    typeof receipt.studentId !== "string" ||
    !receipt.studentId.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "An advance receipt has invalid identifying information."
    );
  }

  validateAmount(receipt.amount, { allowZero: true });

  const receivedPaise = toPaise(receipt.amount);
  const appliedPaise = toPaise(receipt.appliedAmount ?? 0);

  if (appliedPaise > receivedPaise) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      "Applied amount exceeds the receipt amount.",
      { receiptId: receipt.id }
    );
  }
}

/**
 * Calculates the unapplied balance of recorded receipts
 * belonging to one student.
 */
export function calculateAvailableAdvance(
  studentId: string,
  receipts: StudentReceiptRecord[]
): number {
  if (
    typeof studentId !== "string" ||
    !studentId.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student ID is required."
    );
  }

  if (!Array.isArray(receipts)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Advance receipts must be an array."
    );
  }

  const normalizedReceipts = normalizeStudentReceiptRecords(receipts);
  let availablePaise = 0;

  for (const receipt of normalizedReceipts) {
    validateReceipt(receipt);

    if (receipt.studentId !== studentId) {
      continue;
    }

    const receivedPaise = toPaise(receipt.amount);
    const appliedPaise = toPaise(receipt.appliedAmount ?? 0);

    availablePaise += receivedPaise - appliedPaise;

    if (!Number.isSafeInteger(availablePaise)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Available advance is too large to calculate safely."
      );
    }
  }

  return fromPaise(availablePaise);
}

/**
 * Calculates the student's fee summary.
 *
 * totalReceived:
 * Sum of recorded advance receipt amounts supplied to this
 * function. It is not inferred from installment status.
 *
 * totalOutstanding:
 * Remaining installment balance when a schedule exists;
 * otherwise, total fee minus recorded receipts, floored at zero.
 *
 * advanceAvailable:
 * Unapplied amount from the supplied receipt records.
 *
 * Important:
 * totalOutstanding and advanceAvailable are separate figures.
 * Do not subtract advanceAvailable again from an installment
 * balance that already reflects advance allocations.
 */
export function calculateStudentBalance(
  student: Student,
  receipts: StudentReceiptRecord[]
): PaymentSummary {
  if (
    !student ||
    typeof student !== "object" ||
    typeof student.id !== "string" ||
    !student.id.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "A valid student record is required."
    );
  }

  if (!Array.isArray(receipts)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Advance receipts must be an array."
    );
  }

  if (
    typeof student.totalFee !== "number" ||
    !Number.isFinite(student.totalFee) ||
    student.totalFee < 0
  ) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Student total fee is missing or invalid.",
      { studentId: student.id }
    );
  }

  validateAmount(student.totalFee, { allowZero: true });

  const normalizedReceipts = normalizeStudentReceiptRecords(receipts);

  // Validate all supplied receipts, then select this student's.
  for (const receipt of normalizedReceipts) {
    validateReceipt(receipt);
  }

  const studentReceipts = normalizedReceipts.filter(
    (receipt) => receipt.studentId === student.id
  );

  const totalFeePaise = toPaise(student.totalFee);

  let totalReceivedPaise = 0;

  for (const receipt of studentReceipts) {
    totalReceivedPaise += toPaise(receipt.amount);

    if (!Number.isSafeInteger(totalReceivedPaise)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Total received amount is too large."
      );
    }
  }

  const hasInstallments =
    Array.isArray(student.installments) &&
    student.installments.length > 0;

  const outstandingPaise = hasInstallments
    ? toPaise(calculateInstallmentOutstanding(student))
    : Math.max(0, totalFeePaise - totalReceivedPaise);

  const advanceAvailable = calculateAvailableAdvance(
    student.id,
    studentReceipts
  );

  return {
    totalFee: fromPaise(totalFeePaise),
    totalReceived: fromPaise(totalReceivedPaise),
    totalOutstanding: fromPaise(outstandingPaise),
    advanceAvailable,
  };
}
