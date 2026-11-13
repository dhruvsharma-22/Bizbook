
/**
 * BizBook Brain — Advance Service
 *
 * Responsibilities:
 * 1. Validate the allocation request.
 * 2. Find the student and advance receipt.
 * 3. Validate receipt ownership and installment selection.
 * 4. Apply advance money to the selected installment.
 * 5. Save student and receipt updates through the storage adapter.
 * 6. Return the updated receipt and balances.
 *
 * Important:
 * Applying an existing advance is not a new money inflow.
 * This service does not create a second receipt or income entry.
 */

import { BizBookError } from "./errors";

import {
  BIZBOOK_STORAGE_KEYS,
  readStudentsStaff,
  readAdvancePayments,
  prepareStudentsStaffStorageValue,
  runStorageTransaction,
} from "./storage-adapter";

import {
  applyAdvanceToInstallment,
  getReceiptAvailableAdvance,
} from "./advance-engine";

import {
  getInstallmentRemaining,
} from "./installment-engine";

import {
  validateAmount,
} from "./validation-engine";

import {
  toPaise,
} from "./money";

import type {
  AdvancePayment,
  Installment,
} from "./types";

export interface ApplyAdvanceInput {
  receiptId: string;
  studentId: string;
  installmentIndex: number;
  amount: number;
}

export interface ApplyAdvanceResult {
  receipt: AdvancePayment;
  installment: Installment;
  remainingAdvance: number;
  remainingInstallment: number;
}

/**
 * Applies an existing advance receipt to one installment.
 *
 * installmentIndex is zero-based:
 * 0 = first installment.
 *
 * Both affected records are written through the storage
 * adapter. The adapter attempts rollback if a write fails.
 */
export function applyAdvancePayment(
  input: ApplyAdvanceInput
): ApplyAdvanceResult {
  // --------------------------------------------------
  // 1. Validate request
  // --------------------------------------------------

  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Advance allocation details are required."
    );
  }

  if (
    typeof input.receiptId !== "string" ||
    !input.receiptId.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Advance receipt ID is required."
    );
  }

  if (
    typeof input.studentId !== "string" ||
    !input.studentId.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student ID is required."
    );
  }

  if (
    !Number.isSafeInteger(input.installmentIndex) ||
    input.installmentIndex < 0
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Select a valid installment."
    );
  }

  validateAmount(input.amount);

  const requestedPaise = toPaise(input.amount);

  if (requestedPaise <= 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Advance allocation amount must be greater than zero."
    );
  }

  // --------------------------------------------------
  // 2. Read current data through the adapter
  // --------------------------------------------------

  const studentsStaff = readStudentsStaff();
  const receipts = readAdvancePayments();

  // --------------------------------------------------
  // 3. Find student
  // --------------------------------------------------

  const studentIndex = studentsStaff.students.findIndex(
    (student) => student.id === input.studentId
  );

  if (studentIndex === -1) {
    throw new BizBookError(
      "STUDENT_NOT_FOUND",
      "Student was not found."
    );
  }

  const student = studentsStaff.students[studentIndex];

  // --------------------------------------------------
  // 4. Find advance receipt
  // --------------------------------------------------

  const receiptIndex = receipts.findIndex(
    (receipt) => receipt.id === input.receiptId
  );

  if (receiptIndex === -1) {
    throw new BizBookError(
      "PAYMENT_NOT_FOUND",
      "Advance receipt was not found."
    );
  }

  const receipt = receipts[receiptIndex];

  // --------------------------------------------------
  // 5. Validate receipt ownership
  // --------------------------------------------------

  if (receipt.studentId !== student.id) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "This advance receipt belongs to another student."
    );
  }

  // --------------------------------------------------
  // 6. Validate installment
  // --------------------------------------------------

  if (!Array.isArray(student.installments)) {
    throw new BizBookError(
      "INSTALLMENT_NOT_FOUND",
      "No installment schedule exists for this student."
    );
  }

  const installment =
    student.installments[input.installmentIndex];

  if (!installment) {
    throw new BizBookError(
      "INSTALLMENT_NOT_FOUND",
      "Selected installment was not found."
    );
  }

  if (installment.status === "Cancelled") {
    throw new BizBookError(
      "INVALID_STATUS",
      "Advance cannot be applied to a cancelled installment."
    );
  }

  // --------------------------------------------------
  // 7. Validate available receipt balance
  // --------------------------------------------------

  const availableAdvance =
    getReceiptAvailableAdvance(receipt);

  const availablePaise = toPaise(availableAdvance);

  if (requestedPaise > availablePaise) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      `Only ₹${availableAdvance.toFixed(2)} of this advance receipt is available.`,
      {
        receiptId: receipt.id,
        requestedAmount: input.amount,
        availableAdvance,
      }
    );
  }

  // --------------------------------------------------
  // 8. Prepare updated copies without mutating originals
  // --------------------------------------------------

  const prepared = applyAdvanceToInstallment(
    receipt,
    installment,
    input.installmentIndex,
    input.amount
  );

  const updatedInstallments = [
    ...student.installments,
  ];

  updatedInstallments[input.installmentIndex] =
    prepared.updatedInstallment;

  const updatedStudent = {
    ...student,
    installments: updatedInstallments,
  };

  const updatedStudents = [
    ...studentsStaff.students,
  ];

  updatedStudents[studentIndex] = updatedStudent;

  const updatedStudentsStaff = {
    ...studentsStaff,
    students: updatedStudents,
  };

  const updatedReceipts = [...receipts];

  updatedReceipts[receiptIndex] =
    prepared.updatedReceipt;

  // --------------------------------------------------
  // 9. Persist both records through the adapter
  // --------------------------------------------------

  runStorageTransaction([
    {
      key: BIZBOOK_STORAGE_KEYS.studentsStaff,
      value: prepareStudentsStaffStorageValue(updatedStudentsStaff),
      eventName: "bizbook-students-updated",
    },
    {
      key: BIZBOOK_STORAGE_KEYS.advancePayments,
      value: updatedReceipts,
      eventName: "bizbook-advance-payments-updated",
    },
  ]);

  // --------------------------------------------------
  // 10. Return updated balances
  // --------------------------------------------------

  return {
    receipt: prepared.updatedReceipt,
    installment: prepared.updatedInstallment,
    remainingAdvance: getReceiptAvailableAdvance(
      prepared.updatedReceipt
    ),
    remainingInstallment: getInstallmentRemaining(
      prepared.updatedInstallment
    ),
  };
}
