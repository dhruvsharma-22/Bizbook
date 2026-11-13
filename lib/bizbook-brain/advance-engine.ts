/**
 * BizBook Brain — Advance Engine
 *
 * Responsibilities:
 * - Calculate unapplied advance balances.
 * - Validate advance allocations.
 * - Prepare installment allocations.
 * - Update receipt and installment copies together.
 * - Preserve allocation history.
 *
 * This module does not save records to localStorage or a database.
 */

import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";

import {
  getInstallmentRemaining,
  applyInstallmentAdvance,
} from "./installment-engine";

import { validateAmount } from "./validation-engine";

import type {
  AdvancePayment,
  Installment,
  InstallmentAllocation,
} from "./types";

/**
 * Returns the unapplied balance of one advance receipt.
 */
export function getReceiptAvailableAdvance(
  receipt: AdvancePayment
): number {
  if (!receipt || typeof receipt !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Advance receipt is missing."
    );
  }

  validateAmount(receipt.amount, { allowZero: true });

  const receivedPaise = toPaise(receipt.amount);
  const appliedPaise = toPaise(receipt.appliedAmount ?? 0);

  if (appliedPaise > receivedPaise) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      "Applied advance exceeds the amount received.",
      { receiptId: receipt.id }
    );
  }

  return fromPaise(receivedPaise - appliedPaise);
}

/**
 * Calculates total available advance for one student.
 *
 * Only existing receipt records are counted.
 * Installment status alone is not proof of payment.
 */
export function getStudentAvailableAdvance(
  studentId: string,
  receipts: AdvancePayment[]
): number {
  if (typeof studentId !== "string" || !studentId.trim()) {
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

  let totalPaise = 0;

  for (const receipt of receipts) {
    if (receipt.studentId !== studentId) {
      continue;
    }

    totalPaise += toPaise(getReceiptAvailableAdvance(receipt));

    if (!Number.isSafeInteger(totalPaise)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Total available advance is too large."
      );
    }
  }

  return fromPaise(totalPaise);
}

/**
 * Validates an allocation's installment index.
 */
function validateInstallmentIndex(
  installmentIndex: number
): void {
  if (
    !Number.isSafeInteger(installmentIndex) ||
    installmentIndex < 0
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Installment index must be a non-negative integer.",
      { installmentIndex }
    );
  }
}

/**
 * Validates the allocation timestamp.
 */
function validateAllocationDate(appliedAt: string): void {
  if (
    typeof appliedAt !== "string" ||
    Number.isNaN(Date.parse(appliedAt))
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Allocation timestamp is invalid."
    );
  }
}

/**
 * Prepares an allocation against one installment.
 *
 * This function does not mutate or save either record.
 */
export function prepareAdvanceAllocation(
  receipt: AdvancePayment,
  installment: Installment,
  installmentIndex: number,
  requestedAmount: number
): InstallmentAllocation {
  validateAmount(requestedAmount);
  validateInstallmentIndex(installmentIndex);

  const availablePaise = toPaise(
    getReceiptAvailableAdvance(receipt)
  );

  const requestedPaise = toPaise(requestedAmount);

  if (requestedPaise > availablePaise) {
    throw new BizBookError(
      "ADVANCE_NOT_AVAILABLE",
      "Requested allocation exceeds the available advance.",
      {
        receiptId: receipt.id,
        requestedAmount,
        availableAdvance: fromPaise(availablePaise),
      }
    );
  }

  const remainingPaise = toPaise(
    getInstallmentRemaining(installment)
  );

  if (requestedPaise > remainingPaise) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      "Requested allocation exceeds the installment's remaining balance.",
      {
        installmentId: installment.id,
        requestedAmount,
        remainingAmount: fromPaise(remainingPaise),
      }
    );
  }

  return {
    installmentIndex,
    amount: fromPaise(requestedPaise),
    appliedAt: new Date().toISOString(),
  };
}

/**
 * Returns a copy of a receipt with an allocation applied.
 *
 * Does not save the receipt.
 */
export function applyAllocationToReceipt(
  receipt: AdvancePayment,
  allocation: InstallmentAllocation
): AdvancePayment {
  if (!receipt || typeof receipt !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Advance receipt is missing."
    );
  }

  if (!allocation || typeof allocation !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Allocation information is missing."
    );
  }

  validateInstallmentIndex(allocation.installmentIndex);
  validateAllocationDate(allocation.appliedAt);
  validateAmount(allocation.amount);

  const availablePaise = toPaise(
    getReceiptAvailableAdvance(receipt)
  );

  const allocationPaise = toPaise(allocation.amount);

  if (allocationPaise > availablePaise) {
    throw new BizBookError(
      "ADVANCE_NOT_AVAILABLE",
      "Allocation exceeds the available advance.",
      {
        receiptId: receipt.id,
        allocationAmount: allocation.amount,
        availableAdvance: fromPaise(availablePaise),
      }
    );
  }

  // Protect against accidentally replaying an identical allocation.
  const alreadyApplied = (receipt.appliedTo ?? []).some(
    (existing) =>
      existing.installmentIndex === allocation.installmentIndex &&
      existing.amount === allocation.amount &&
      existing.appliedAt === allocation.appliedAt
  );

  if (alreadyApplied) {
    throw new BizBookError(
      "DUPLICATE_PAYMENT",
      "This allocation has already been recorded.",
      {
        receiptId: receipt.id,
        installmentIndex: allocation.installmentIndex,
      }
    );
  }

  const updatedAppliedPaise =
    toPaise(receipt.appliedAmount ?? 0) + allocationPaise;

  if (!Number.isSafeInteger(updatedAppliedPaise)) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Updated advance allocation is too large."
    );
  }

  return {
    ...receipt,
    appliedAmount: fromPaise(updatedAppliedPaise),
    appliedTo: [
      ...(receipt.appliedTo ?? []),
      { ...allocation },
    ],
  };
}

/**
 * Prepares updated receipt and installment copies together.
 *
 * This function:
 * - Validates the receipt's available advance.
 * - Validates the installment's remaining balance.
 * - Updates the receipt allocation history.
 * - Applies the advance to the installment.
 *
 * It does not persist either record. The caller must save both
 * records safely and handle failures during persistence.
 */
export function applyAdvanceToInstallment(
  receipt: AdvancePayment,
  installment: Installment,
  installmentIndex: number,
  requestedAmount: number
): {
  updatedReceipt: AdvancePayment;
  updatedInstallment: Installment;
  allocation: InstallmentAllocation;
} {
  const allocation = prepareAdvanceAllocation(
    receipt,
    installment,
    installmentIndex,
    requestedAmount
  );

  const updatedReceipt = applyAllocationToReceipt(
    receipt,
    allocation
  );

  const updatedInstallment = applyInstallmentAdvance(
    installment,
    allocation.amount
  );

  return {
    updatedReceipt,
    updatedInstallment,
    allocation,
  };
}