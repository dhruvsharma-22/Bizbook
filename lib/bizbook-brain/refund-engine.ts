
/**
 * BizBook Brain — Refund Engine
 *
 * Validates refund requests and prepares refund records.
 * Does not issue money, save records, or call a payment provider.
 *
 * Refund processing and persistence belong in a service.
 */

import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";
import { validateAmount } from "./validation-engine";

import type { PaymentRecord } from "./types";

export type RefundStatus =
  | "Pending"
  | "Processing"
  | "Completed"
  | "Failed"
  | "Cancelled";

export interface RefundRecord {
  id: string;
  paymentId: string;
  studentId: string;
  amount: number;
  status: RefundStatus;
  reason: string;
  mode: "Manual" | "Online";
  providerRefundReference?: string;
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRefundInput {
  id: string;
  payment: PaymentRecord;
  amount: number;
  reason: string;
  requestedBy: string;
  previousRefunds: RefundRecord[];
}

const REFUND_RESERVED_STATUSES: readonly RefundStatus[] = [
  "Pending",
  "Processing",
  "Completed",
];

/* =========================================================
   VALIDATION
========================================================= */

function requireText(
  value: unknown,
  field: string
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} is required.`,
      { field }
    );
  }
}

function validateRefundRecord(
  refund: RefundRecord
): void {
  if (
    !refund ||
    typeof refund !== "object"
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Refund record is required."
    );
  }

  requireText(refund.id, "Refund ID");
  requireText(refund.paymentId, "Payment ID");
  requireText(refund.studentId, "Student ID");
  requireText(refund.reason, "Refund reason");
  requireText(refund.requestedBy, "Requester");

  validateAmount(refund.amount);

  if (
    ![
      "Pending",
      "Processing",
      "Completed",
      "Failed",
      "Cancelled",
    ].includes(refund.status)
  ) {
    throw new BizBookError(
      "INVALID_STATUS",
      "Refund status is invalid.",
      { refundId: refund.id, status: refund.status }
    );
  }

  if (
    refund.mode !== "Manual" &&
    refund.mode !== "Online"
  ) {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Refund mode must be Manual or Online.",
      { refundId: refund.id }
    );
  }

  if (
    typeof refund.createdAt !== "string" ||
    Number.isNaN(Date.parse(refund.createdAt)) ||
    typeof refund.updatedAt !== "string" ||
    Number.isNaN(Date.parse(refund.updatedAt))
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Refund timestamps are invalid.",
      { refundId: refund.id }
    );
  }
}

function validatePaymentForRefund(
  payment: PaymentRecord
): void {
  if (
    !payment ||
    typeof payment !== "object"
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Original payment record is required."
    );
  }

  requireText(payment.id, "Payment ID");
  requireText(payment.studentId, "Student ID");
  validateAmount(payment.amount);

  if (
    payment.mode !== "Manual" &&
    payment.mode !== "Online"
  ) {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Original payment mode is invalid."
    );
  }
}

/* =========================================================
   REFUND BALANCES
========================================================= */

/**
 * Calculates completed and in-progress refunds.
 *
 * Pending and Processing refunds reserve funds so multiple
 * requests cannot exceed the original payment amount.
 */
export function getReservedRefundAmount(
  paymentId: string,
  refunds: RefundRecord[]
): number {
  requireText(paymentId, "Payment ID");

  if (!Array.isArray(refunds)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Refund records must be an array."
    );
  }

  let totalPaise = 0;

  for (const refund of refunds) {
    validateRefundRecord(refund);

    if (refund.paymentId !== paymentId) {
      continue;
    }

    if (
      !REFUND_RESERVED_STATUSES.includes(refund.status)
    ) {
      continue;
    }

    totalPaise += toPaise(refund.amount);

    if (!Number.isSafeInteger(totalPaise)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Total refund amount is too large."
      );
    }
  }

  return fromPaise(totalPaise);
}

/**
 * Calculates the remaining refundable amount.
 *
 * Only paid or partially refunded payments can be refunded.
 */
export function getRefundableAmount(
  payment: PaymentRecord,
  refunds: RefundRecord[]
): number {
  validatePaymentForRefund(payment);

  if (
    payment.status !== "Paid" &&
    payment.status !== "Partially Refunded"
  ) {
    return 0;
  }

  const paidPaise = toPaise(payment.amount);

  const reservedPaise = toPaise(
    getReservedRefundAmount(payment.id, refunds)
  );

  if (reservedPaise > paidPaise) {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Existing refunds exceed the original payment amount.",
      { paymentId: payment.id }
    );
  }

  return fromPaise(paidPaise - reservedPaise);
}

/* =========================================================
   CREATE REFUND REQUEST
========================================================= */

/**
 * Validates a refund request and prepares a Pending record.
 *
 * This function does not issue a refund or persist records.
 * The service must enforce authorization and duplicate safety.
 */
export function createRefundRequest(
  input: CreateRefundInput
): RefundRecord {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Refund request details are required."
    );
  }

  const {
    id,
    payment,
    amount,
    reason,
    requestedBy,
    previousRefunds,
  } = input;

  requireText(id, "Refund ID");
  requireText(reason, "Refund reason");
  requireText(requestedBy, "Requester");

  validatePaymentForRefund(payment);

  if (!Array.isArray(previousRefunds)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Previous refund records must be supplied."
    );
  }

  for (const refund of previousRefunds) {
    validateRefundRecord(refund);
  }

  if (previousRefunds.some((refund) => refund.id === id)) {
    throw new BizBookError(
      "DUPLICATE_PAYMENT",
      "This refund ID already exists.",
      { refundId: id }
    );
  }

  validateAmount(amount);

  const requestedPaise = toPaise(amount);

  if (requestedPaise <= 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Refund amount must be greater than zero."
    );
  }

  const refundablePaise = toPaise(
    getRefundableAmount(payment, previousRefunds)
  );

  if (requestedPaise > refundablePaise) {
    throw new BizBookError(
      "INSUFFICIENT_BALANCE",
      "Refund exceeds the amount available to refund.",
      {
        requestedAmount: amount,
        refundableAmount: fromPaise(refundablePaise),
      }
    );
  }

  const now = new Date().toISOString();

  return {
    id: id.trim(),
    paymentId: payment.id,
    studentId: payment.studentId,
    amount: fromPaise(requestedPaise),
    status: "Pending",
    reason: reason.trim(),
    mode: payment.mode,
    requestedBy: requestedBy.trim(),
    createdAt: now,
    updatedAt: now,
  };
}
