
/**
 * BizBook Brain — Payment Engine
 *
 * Responsibilities:
 * - Prepare payment records.
 * - Validate manual and online payment rules.
 * - Enforce valid payment status transitions.
 * - Keep monetary comparisons in integer paise.
 *
 * This engine does not persist records, authenticate staff,
 * or verify payment-provider signatures.
 *
 * Online payment verification must be initiated only after
 * a trusted server verifies the provider response/webhook.
 */

import { BizBookError } from "./errors";
import { toPaise, fromPaise } from "./money";
import {
  validateAmount,
  validatePaymentMethod,
} from "./validation-engine";

import type {
  PaymentMethod,
  PaymentMode,
  PaymentRecord,
  PaymentStatus,
} from "./types";

export interface CreatePaymentInput {
  id: string;
  studentId: string;
  amount: number;
  method: PaymentMethod;
  mode: PaymentMode;
  createdAt?: string;
  providerReference?: string;
}

export interface VerifyOnlinePaymentInput {
  paymentId: string;
  providerReference: string;
  verifiedAmount: number;
  verified: boolean;
  verifiedAt?: string;
}

export interface RecordOfflinePaymentInput {
  payment: CreatePaymentInput;
  recordedBy: string;
  reference?: string;
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} is required.`,
      { field }
    );
  }
}

function validateTimestamp(
  value: unknown,
  field: string
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} must be a valid date/time.`,
      { field }
    );
  }
}

/**
 * Creates a Pending payment record.
 *
 * Online payments must be verified by a trusted server.
 * Manual payments require a separate explicit recording action.
 */
export function createPayment(
  input: CreatePaymentInput
): PaymentRecord {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payment details are required."
    );
  }

  requireText(input.id, "Payment ID");
  requireText(input.studentId, "Student ID");

  validateAmount(input.amount);
  validatePaymentMethod(input.method);

  if (input.mode !== "Online" && input.mode !== "Manual") {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Payment mode must be Online or Manual."
    );
  }

  if (input.mode === "Online" && input.method !== "Online") {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Online mode must use the Online payment method."
    );
  }

  if (input.mode === "Manual" && input.method === "Online") {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Manual mode cannot use the Online payment method."
    );
  }

  if (input.createdAt !== undefined) {
    validateTimestamp(input.createdAt, "Creation timestamp");
  }

  if (input.providerReference !== undefined) {
    requireText(input.providerReference, "Provider reference");
  }

  const now = new Date().toISOString();

  return {
    id: input.id.trim(),
    studentId: input.studentId.trim(),
    amount: fromPaise(toPaise(input.amount)),
    method: input.method,
    mode: input.mode,
    status: "Pending",
    providerReference: input.providerReference?.trim(),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Records a manual/offline payment as Paid.
 *
 * The caller must authenticate the staff member and verify
 * authorization before invoking this function.
 */
export function recordOfflinePayment(
  input: RecordOfflinePaymentInput
): PaymentRecord {
  if (!input || typeof input !== "object" || !input.payment) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Offline payment details are required."
    );
  }

  const { payment, recordedBy, reference } = input;

  requireText(recordedBy, "Staff member");

  if (payment.mode !== "Manual") {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Only manual-mode payments can be recorded offline."
    );
  }

  if (reference !== undefined) {
    requireText(reference, "Payment reference");
  }

  const pending = createPayment(payment);
  const now = new Date().toISOString();

  return {
    ...pending,
    status: "Paid",
    providerReference:
      reference?.trim() ?? pending.providerReference,
    updatedAt: now,
  };
}

/**
 * Marks an online payment as Paid only after a trusted
 * verification process confirms the payment.
 *
 * The caller must verify provider signature/webhook,
 * payment identity, currency, amount, and merchant account.
 * Client-supplied `verified: true` is not proof of payment.
 */
export function verifyOnlinePayment(
  _payment: PaymentRecord,
  _input: VerifyOnlinePaymentInput
): PaymentRecord {
  void _payment;
  void _input;
  throw new BizBookError(
    "PAYMENT_NOT_VERIFIED",
    "This shared payment engine cannot verify provider outcomes. Online payments remain pending until a trusted server-side provider integration is configured.",
  );
}

/**
 * Checks whether a payment is eligible to be applied
 * to a student's fee balance.
 */
export function canApplyPayment(
  payment: PaymentRecord
): boolean {
  if (!payment || payment.status !== "Paid") {
    return false;
  }

  // There is no trusted server-side provider verifier in this application yet.
  // A browser-controlled record can forge both `status` and `verifiedAt`, so
  // neither field is sufficient to authorize an online collection.
  if (payment.mode === "Online") {
    return false;
  }

  return true;
}

/**
 * Returns the amount in integer paise.
 */
export function getPaymentAmountPaise(
  payment: PaymentRecord
): number {
  return toPaise(payment.amount);
}

/**
 * Validates payment status transitions.
 */
export function validatePaymentStatus(
  currentStatus: PaymentStatus,
  nextStatus: PaymentStatus
): void {
  const allowedTransitions: Record<
    PaymentStatus,
    PaymentStatus[]
  > = {
    Pending: ["Processing", "Paid", "Failed", "Cancelled"],
    Processing: ["Paid", "Failed", "Cancelled"],
    Paid: ["Refunded", "Partially Refunded"],
    Failed: ["Pending"],
    Cancelled: [],
    Refunded: [],
    "Partially Refunded": ["Refunded"],
  };

  if (
    currentStatus !== nextStatus &&
    !allowedTransitions[currentStatus].includes(nextStatus)
  ) {
    throw new BizBookError(
      "INVALID_STATUS",
      `Payment cannot transition from ${currentStatus} to ${nextStatus}.`,
      { currentStatus, nextStatus }
    );
  }
}
