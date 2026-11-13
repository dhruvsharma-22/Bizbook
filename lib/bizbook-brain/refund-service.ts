
/**
 * BizBook Brain — Refund Service
 *
 * Persists refund records and manages refund statuses.
 *
 * Important:
 * - Creating a refund does not send money.
 * - Completing a manual refund requires confirmation by
 *   authorized staff outside this service.
 * - Online refunds require verified payment-provider
 *   integration and trusted provider confirmation.
 * - A provider reference alone does not prove a refund
 *   has actually completed.
 * - Refunds must be counted only once in financial reports.
 */

import { BizBookError } from "./errors";

import {
  readRefunds,
  saveRefunds,
} from "./storage-adapter";

import {
  createRefundRequest,
  getRefundableAmount,
} from "./refund-engine";

import type {
  CreateRefundInput,
  RefundRecord,
  RefundStatus,
} from "./refund-engine";

/* =========================================================
   REFUND STATUS CONFIGURATION
========================================================= */

const VALID_STATUSES: readonly RefundStatus[] = [
  "Pending",
  "Processing",
  "Completed",
  "Failed",
  "Cancelled",
];

const TERMINAL_STATUSES: readonly RefundStatus[] = [
  "Completed",
  "Failed",
  "Cancelled",
];

/* =========================================================
   VALIDATION HELPERS
========================================================= */

function requireText(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} is required.`,
      { field },
    );
  }
}

function validateStatus(status: RefundStatus): void {
  if (
    typeof status !== "string" ||
    !VALID_STATUSES.includes(status)
  ) {
    throw new BizBookError(
      "INVALID_STATUS",
      "Refund status is invalid.",
      { status },
    );
  }
}

function validateRefundRecords(
  refunds: RefundRecord[],
): void {
  const seenIds = new Set<string>();

  for (const refund of refunds) {
    if (
      !refund ||
      typeof refund !== "object" ||
      typeof refund.id !== "string" ||
      !refund.id.trim()
    ) {
      throw new BizBookError(
        "STORAGE_ERROR",
        "A saved refund record has an invalid ID.",
      );
    }

    if (seenIds.has(refund.id)) {
      throw new BizBookError(
        "DUPLICATE_RECORD",
        "Duplicate refund IDs exist in storage.",
        { refundId: refund.id },
      );
    }

    seenIds.add(refund.id);
  }
}

/* =========================================================
   LIST REFUNDS
========================================================= */

/**
 * Returns saved refund records.
 *
 * Optional filters:
 * - paymentId
 * - studentId
 * - status
 */
export function listRefunds(
  filters: {
    paymentId?: string;
    studentId?: string;
    status?: RefundStatus;
  } = {},
): RefundRecord[] {
  if (
    !filters ||
    typeof filters !== "object" ||
    Array.isArray(filters)
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Refund filters must be an object.",
    );
  }

  if (filters.paymentId !== undefined) {
    requireText(filters.paymentId, "Payment ID");
  }

  if (filters.studentId !== undefined) {
    requireText(filters.studentId, "Student ID");
  }

  if (filters.status !== undefined) {
    validateStatus(filters.status);
  }

  let refunds = readRefunds();

  validateRefundRecords(refunds);

  if (filters.paymentId !== undefined) {
    refunds = refunds.filter(
      (refund) => refund.paymentId === filters.paymentId,
    );
  }

  if (filters.studentId !== undefined) {
    refunds = refunds.filter(
      (refund) => refund.studentId === filters.studentId,
    );
  }

  if (filters.status !== undefined) {
    refunds = refunds.filter(
      (refund) => refund.status === filters.status,
    );
  }

  return refunds;
}

/* =========================================================
   GET REFUND BY ID
========================================================= */

/**
 * Finds one refund by ID.
 *
 * Returns null when no matching refund exists.
 */
export function getRefundById(
  refundId: string,
): RefundRecord | null {
  requireText(refundId, "Refund ID");

  const refunds = readRefunds();

  validateRefundRecords(refunds);

  return (
    refunds.find(
      (refund) => refund.id === refundId,
    ) ?? null
  );
}

/* =========================================================
   CREATE REFUND
========================================================= */

/**
 * Creates and saves a refund request.
 *
 * The refund engine validates the refundable balance.
 * The service checks stored IDs to prevent duplicate
 * records within the current browser storage.
 *
 * This operation does not issue a refund or contact
 * a payment provider.
 */
export function createRefund(
  input: CreateRefundInput,
): RefundRecord {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Refund request details are required.",
    );
  }

  requireText(input.id, "Refund ID");

  const refunds = readRefunds();

  validateRefundRecords(refunds);

  if (
    refunds.some(
      (refund) => refund.id === input.id,
    )
  ) {
    throw new BizBookError(
      "DUPLICATE_RECORD",
      "A refund with this ID already exists.",
      { refundId: input.id },
    );
  }

  // Use stored refund records as the source of truth.
  // Do not trust a caller-supplied previousRefunds array.
  const refund = createRefundRequest({
    ...input,
    previousRefunds: refunds,
  });

  saveRefunds([
    ...refunds,
    refund,
  ]);

  return refund;
}

/* =========================================================
   UPDATE REFUND STATUS
========================================================= */

/**
 * Updates a refund's status.
 *
 * Important:
 * - This function does not issue money.
 * - It does not verify a provider transaction.
 * - A provider refund reference is not proof of completion.
 * - The caller must only request Completed after trusted
 *   confirmation from an authorized workflow.
 *
 * Terminal statuses cannot be changed by this function.
 */
export function updateRefundStatus(
  refundId: string,
  status: RefundStatus,
  providerRefundReference?: string,
): RefundRecord {
  requireText(refundId, "Refund ID");
  validateStatus(status);

  if (
    providerRefundReference !== undefined &&
    (
      typeof providerRefundReference !== "string" ||
      !providerRefundReference.trim()
    )
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Provider refund reference cannot be blank.",
    );
  }

  const refunds = readRefunds();

  validateRefundRecords(refunds);

  const index = refunds.findIndex(
    (refund) => refund.id === refundId,
  );

  if (index === -1) {
    throw new BizBookError(
      "RECORD_NOT_FOUND",
      "Refund record was not found.",
      { refundId },
    );
  }

  const existing = refunds[index];

  if (!existing) {
    throw new BizBookError(
      "RECORD_NOT_FOUND",
      "Refund record was not found.",
      { refundId },
    );
  }

  // Do not permit changes to a terminal record.
  if (
    TERMINAL_STATUSES.includes(existing.status)
  ) {
    throw new BizBookError(
      "INVALID_STATUS",
      "A completed, failed, or cancelled refund cannot be changed.",
      {
        refundId,
        currentStatus: existing.status,
      },
    );
  }

  // This browser/localStorage service has no way to validate a provider
  // response. A client-supplied reference cannot confirm an online refund.
  if (
    existing.mode === "Online" &&
    status === "Completed"
  ) {
    throw new BizBookError(
      "PAYMENT_NOT_VERIFIED",
      "An online refund cannot be marked completed without trusted server-side provider confirmation.",
      { refundId },
    );
  }

  const updated: RefundRecord = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    ...(providerRefundReference !== undefined
      ? {
          providerRefundReference:
            providerRefundReference.trim(),
        }
      : {}),
  };

  const nextRefunds = [...refunds];

  nextRefunds[index] = updated;

  saveRefunds(nextRefunds);

  return updated;
}

/* =========================================================
   REMAINING REFUNDABLE AMOUNT
========================================================= */

/**
 * Calculates the remaining refundable amount from the
 * payment record and persisted refund records.
 *
 * Pending, Processing, and Completed refunds are reserved
 * according to refund-engine rules.
 *
 * This calculation does not move money.
 */
export function getRemainingRefundableAmount(
  payment: Parameters<typeof getRefundableAmount>[0],
): number {
  const refunds = readRefunds();

  validateRefundRecords(refunds);

  return getRefundableAmount(
    payment,
    refunds,
  );
}
