/**
 * Read-only compatibility helpers for the two persisted receipt formats.
 *
 * FeeReceipt rows are ordinary collected fee payments. They are projected
 * into the legacy receipt-engine shape only for calculations and display;
 * marking the full amount applied keeps them out of available advances.
 */

import { BizBookError } from "./errors";
import type {
  AdvancePayment,
  FeeReceipt,
  StudentReceiptRecord,
} from "./types";

export function isFeeReceiptRecord(
  receipt: StudentReceiptRecord,
): receipt is FeeReceipt {
  return (
    typeof receipt === "object" &&
    receipt !== null &&
    "paymentRecordId" in receipt &&
    typeof receipt.paymentRecordId === "string"
  );
}

export function feeReceiptAsAdvancePayment(
  receipt: FeeReceipt,
): AdvancePayment {
  return {
    ...receipt,
    appliedAmount: receipt.amount,
    appliedTo: [],
  };
}

/**
 * Combines legacy advance receipts and ordinary fee receipts for read-only
 * calculations. If the same payment is present in both formats, the legacy
 * row wins so its receipt number and allocation history remain visible.
 */
export function normalizeStudentReceiptRecords(
  records: StudentReceiptRecord[],
): AdvancePayment[] {
  if (!Array.isArray(records)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student receipt records must be an array.",
    );
  }

  const advances = records.filter(
    (receipt): receipt is AdvancePayment =>
      !isFeeReceiptRecord(receipt),
  );
  const feeReceipts = records.filter(isFeeReceiptRecord);
  const seenAdvanceIds = new Set<string>();

  for (const receipt of advances) {
    if (seenAdvanceIds.has(receipt.id)) {
      throw new BizBookError(
        "DUPLICATE_RECORD",
        "Duplicate advance receipt IDs were supplied.",
        { receiptId: receipt.id },
      );
    }
    seenAdvanceIds.add(receipt.id);
  }

  const seenFeePaymentIds = new Set<string>();
  const normalized = [...advances];

  for (const receipt of feeReceipts) {
    if (
      seenFeePaymentIds.has(receipt.paymentRecordId) ||
      seenFeePaymentIds.has(receipt.id)
    ) {
      throw new BizBookError(
        "DUPLICATE_RECORD",
        "Duplicate fee receipt payment IDs were supplied.",
        { paymentRecordId: receipt.paymentRecordId },
      );
    }

    seenFeePaymentIds.add(receipt.paymentRecordId);
    seenFeePaymentIds.add(receipt.id);

    if (
      seenAdvanceIds.has(receipt.id) ||
      seenAdvanceIds.has(receipt.paymentRecordId)
    ) {
      continue;
    }

    normalized.push(feeReceiptAsAdvancePayment(receipt));
  }

  return normalized;
}
