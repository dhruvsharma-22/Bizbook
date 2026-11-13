
/**
 * BizBook Brain — Installment Engine
 *
 * Responsibilities:
 * - Calculate installment balances safely.
 * - Validate payment and advance allocations.
 * - Apply ordinary payments without mutating original data.
 * - Apply advance allocations separately.
 * - Preserve legacy installment compatibility.
 *
 * This module does not save data to localStorage or a database.
 */

import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";
import type { Installment } from "./types";

function hasPaymentTracking(installment: Installment): boolean {
  return (
    installment.scheduledAmount !== undefined ||
    installment.paidAmount !== undefined ||
    installment.advanceAppliedAmount !== undefined ||
    installment.amountPaid !== undefined ||
    installment.paid !== undefined ||
    (Array.isArray(installment.payments) && installment.payments.length > 0)
  );
}

function getTrackedPaidPaise(installment: Installment): number {
  const directPaidPaise = toPaise(
    installment.paidAmount ?? installment.amountPaid ?? installment.paid ?? 0
  );
  const paymentsPaidPaise = Array.isArray(installment.payments)
    ? installment.payments.reduce((total, payment) => {
        if (
          String(payment?.status ?? "paid").toLowerCase() !== "paid"
        ) {
          return total;
        }

        const next = total + toPaise(Number(payment?.amount ?? 0));
        if (!Number.isSafeInteger(next)) {
          throw new BizBookError(
            "INVALID_AMOUNT",
            "Installment payment total is too large."
          );
        }
        return next;
      }, 0)
    : 0;

  // Legacy records may store the same payments both as a total and as rows.
  // Use the larger source rather than adding the two representations.
  return Math.max(directPaidPaise, paymentsPaidPaise);
}

/**
 * Returns the amount remaining on an installment.
 *
 * Tracked format:
 * scheduledAmount = original scheduled amount
 * paidAmount = ordinary payments applied
 * advanceAppliedAmount = advance applied
 *
 * Legacy format:
 * If payment tracking fields are absent, amount is the current
 * outstanding balance. Older `amountPaid`, `paid`, and `payments`
 * fields are accepted as tracking aliases. When both a paid total
 * and payment rows exist, the larger representation is used so the
 * same payments are not counted twice.
 */
export function getInstallmentRemaining(
  installment: Installment
): number {
  validateInstallmentAmounts(installment);

  if (installment.status === "Cancelled") {
    return 0;
  }

  if (
    installment.status === "Paid" &&
    !hasPaymentTracking(installment)
  ) {
    return 0;
  }

  const paidPaise = getTrackedPaidPaise(installment);
  const advancePaise = toPaise(
    installment.advanceAppliedAmount ?? 0
  );

  let basePaise: number;

  if (installment.scheduledAmount !== undefined) {
    basePaise = toPaise(installment.scheduledAmount);
  } else if (
    hasPaymentTracking(installment)
  ) {
    // A tracked legacy record uses amount as its original base.
    basePaise = toPaise(installment.amount);
  } else {
    // Untouched legacy record: amount is already outstanding.
    return installment.amount;
  }

  const remainingPaise =
    basePaise - paidPaise - advancePaise;

  if (remainingPaise < 0) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      "Paid and advance-applied amounts exceed the installment amount.",
      { installmentId: installment.id }
    );
  }

  return fromPaise(remainingPaise);
}

/**
 * Calculates the remaining balance across all installments.
 * Cancelled installments contribute zero.
 */
export function getTotalInstallmentRemaining(
  installments: Installment[]
): number {
  const totalPaise = installments.reduce(
    (total, installment) => {
      const remainingPaise = toPaise(
        getInstallmentRemaining(installment)
      );

      const nextTotal = total + remainingPaise;

      if (!Number.isSafeInteger(nextTotal)) {
        throw new BizBookError(
          "INVALID_AMOUNT",
          "Total installment balance is too large."
        );
      }

      return nextTotal;
    },
    0
  );

  return fromPaise(totalPaise);
}

/**
 * Validates that an allocation is positive and does not exceed
 * the installment's current outstanding balance.
 */
export function validateInstallmentAllocation(
  installment: Installment,
  allocationAmount: number
): void {
  const requestedPaise = toPaise(allocationAmount);

  if (requestedPaise <= 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Allocation amount must be greater than zero."
    );
  }

  const remainingPaise = toPaise(
    getInstallmentRemaining(installment)
  );

  if (requestedPaise > remainingPaise) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      "Allocation exceeds the installment's remaining balance.",
      {
        installmentId: installment.id,
        requestedAmount: allocationAmount,
        remainingAmount: fromPaise(remainingPaise),
      }
    );
  }
}

/**
 * Calculates the status after an allocation.
 *
 * Cancellation takes priority over payment completion.
 */
function getUpdatedStatus(
  installment: Installment,
  remainingAmount: number,
  hasAppliedAmount: boolean,
): Installment["status"] {
  if (installment.status === "Cancelled") {
    return "Cancelled";
  }

  if (remainingAmount === 0) {
    return "Paid";
  }

  if (installment.status === "Overdue") {
    return "Overdue";
  }

  if (
    hasAppliedAmount ||
    installment.status === "Partially Paid"
  ) {
    return "Partially Paid";
  }

  return "Pending";
}

/**
 * Applies an ordinary payment to an installment.
 *
 * Legacy records retain amount as their remaining balance.
 * Tracked records retain their original scheduled amount and
 * increment paidAmount.
 *
 * Advance allocations must use applyInstallmentAdvance().
 */
export function applyInstallmentPayment(
  installment: Installment,
  allocationAmount: number
): Installment {
  validateInstallmentAllocation(installment, allocationAmount);

  const remainingBefore = getInstallmentRemaining(installment);

  const remainingAfterPaise =
    toPaise(remainingBefore) - toPaise(allocationAmount);

  const remainingAfter = fromPaise(remainingAfterPaise);

  const isLegacy = !hasPaymentTracking(installment);

  if (isLegacy) {
    return {
      ...installment,
      amount: remainingAfter,
      status: getUpdatedStatus(
        installment,
        remainingAfter,
        remainingAfter < remainingBefore,
      ),
    };
  }

  const scheduledPaise = toPaise(
    installment.scheduledAmount ?? installment.amount
  );

  const updatedPaidPaise =
    getTrackedPaidPaise(installment) +
    toPaise(allocationAmount);

  if (!Number.isSafeInteger(updatedPaidPaise)) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Updated paid amount is too large."
    );
  }

  const updatedInstallment: Installment = {
    ...installment,
    amount: fromPaise(scheduledPaise),
    scheduledAmount: fromPaise(scheduledPaise),
    paidAmount: fromPaise(updatedPaidPaise),
  };

  // Recalculate from tracked values instead of relying only on
  // the previously calculated balance.
  const actualRemaining = getInstallmentRemaining(updatedInstallment);

  return {
    ...updatedInstallment,
    status: getUpdatedStatus(
      installment,
      actualRemaining,
      updatedPaidPaise > 0 ||
        toPaise(updatedInstallment.advanceAppliedAmount ?? 0) > 0,
    ),
  };
}

/**
 * Applies an advance allocation separately from an ordinary payment.
 *
 * For legacy records, amount is the current outstanding balance.
 * That balance becomes the tracked scheduled base when an advance
 * is first applied.
 *
 * This function does not deduct money from the advance receipt
 * or save the updated installment.
 */
export function applyInstallmentAdvance(
  installment: Installment,
  allocationAmount: number
): Installment {
  validateInstallmentAllocation(installment, allocationAmount);

  const isLegacy = !hasPaymentTracking(installment);

  const allocationPaise = toPaise(allocationAmount);

  const scheduledPaise = toPaise(
    installment.scheduledAmount ?? installment.amount
  );

  const currentPaidPaise = getTrackedPaidPaise(installment);

  const currentAdvancePaise = toPaise(
    installment.advanceAppliedAmount ?? 0
  );

  const updatedAdvancePaise =
    currentAdvancePaise + allocationPaise;

  if (!Number.isSafeInteger(updatedAdvancePaise)) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Updated advance allocation is too large."
    );
  }

  const updatedInstallment: Installment = {
    ...installment,
    amount: fromPaise(scheduledPaise),
    scheduledAmount: fromPaise(scheduledPaise),
    paidAmount: isLegacy
      ? 0
      : fromPaise(currentPaidPaise),
    advanceAppliedAmount: fromPaise(updatedAdvancePaise),
  };

  const remainingAfter = getInstallmentRemaining(updatedInstallment);

  return {
    ...updatedInstallment,
    status: getUpdatedStatus(
      installment,
      remainingAfter,
      currentPaidPaise > 0 || updatedAdvancePaise > 0,
    ),
  };
}

/**
 * Validates basic installment amount fields.
 *
 * toPaise performs monetary validation and rejects invalid,
 * negative, or unsafe monetary values.
 */
function validateInstallmentAmounts(
  installment: Installment
): void {
  if (!installment || typeof installment !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Installment information is missing."
    );
  }

  toPaise(installment.amount);

  if (installment.scheduledAmount !== undefined) {
    toPaise(installment.scheduledAmount);
  }

  if (installment.paidAmount !== undefined) {
    toPaise(installment.paidAmount);
  }

  if (installment.advanceAppliedAmount !== undefined) {
    toPaise(installment.advanceAppliedAmount);
  }
}
