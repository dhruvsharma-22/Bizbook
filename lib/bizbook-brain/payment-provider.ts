
/**
 * BizBook Brain — Payment Provider
 *
 * Responsibilities:
 * - Define a common interface for payment providers.
 * - Validate payment-order and verification inputs.
 * - Describe provider-neutral, tenant-scoped adapter contracts.
 *
 * Security rules:
 * - Real provider signatures and webhooks must be verified
 *   on a trusted server, never in browser-only code.
 */

import { BizBookError } from "./errors";
import { toPaise, fromPaise } from "./money";

export type PaymentProviderId = "razorpay" | "cashfree";
export type PaymentProviderMode = "test" | "live";
export type ProviderConnectionStatus =
  | "not_connected"
  | "pending"
  | "connected"
  | "error"
  | "disabled";

/** Server-side metadata only; this stores a reference, never a secret value. */
export interface TenantPaymentProviderConnection {
  id: string;
  coachingId: string;
  provider: PaymentProviderId;
  status: ProviderConnectionStatus;
  mode: PaymentProviderMode;
  providerAccountReference?: string;
  credentialSecretReference: string;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Safe connection fields suitable for a client status response. */
export type TenantPaymentProviderConnectionView = Omit<
  TenantPaymentProviderConnection,
  "credentialSecretReference"
>;

export function toPublicTenantPaymentProviderConnection(
  connection: TenantPaymentProviderConnection,
): TenantPaymentProviderConnectionView {
  return {
    id: connection.id,
    coachingId: connection.coachingId,
    provider: connection.provider,
    status: connection.status,
    mode: connection.mode,
    ...(connection.providerAccountReference
      ? { providerAccountReference: connection.providerAccountReference }
      : {}),
    configVersion: connection.configVersion,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

/** Must be resolved from an authenticated server session and stored connection. */
export interface TenantPaymentContext {
  coachingId: string;
  connectionId: string;
  provider: PaymentProviderId;
  mode: PaymentProviderMode;
  providerAccountReference?: string;
}

/** Checks tenant consistency after the server resolves authorization and connection. */
export function validateTenantPaymentContext(
  context: TenantPaymentContext,
  requestedCoachingId: string,
): void {
  if (!context || typeof context !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "An authorized tenant payment context is required.",
    );
  }

  requireText(context.coachingId, "Authorized coaching ID");
  requireText(context.connectionId, "Provider connection ID");
  requireText(requestedCoachingId, "Requested coaching ID");

  if (context.coachingId !== requestedCoachingId) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Requested coaching ID does not match the authorized provider connection.",
    );
  }

  if (
    context.provider !== "razorpay" &&
    context.provider !== "cashfree"
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payment provider is not supported.",
    );
  }

  if (context.mode !== "test" && context.mode !== "live") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payment provider mode is not supported.",
    );
  }
}

export interface CreateProviderOrderInput {
  paymentId: string;
  amount: number;
  currency?: "INR";
  studentId: string;
  coachingId: string;
}

export interface ProviderOrder {
  provider: string;
  orderId: string;
  paymentId: string;
  amount: number;
  currency: "INR";
  status: "CREATED" | "SIMULATED";
  checkoutUrl?: string;
  createdAt: string;
}

export interface ProviderVerificationInput {
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  amount: number;
  currency: "INR";
  signature?: string;
}

export interface ProviderVerificationResult {
  verified: boolean;
  provider: string;
  orderId: string;
  paymentId: string;
  providerPaymentId: string;
  amount: number;
  currency: "INR";
  verifiedAt?: string;
  message: string;
}

export interface PaymentProvider {
  readonly name: string;

  createOrder(
    input: CreateProviderOrderInput
  ): Promise<ProviderOrder>;

  verifyPayment(
    input: ProviderVerificationInput
  ): Promise<ProviderVerificationResult>;
}

export interface ProviderRefundInput {
  refundId: string;
  paymentId: string;
  providerPaymentId: string;
  amount: number;
  currency: "INR";
  idempotencyKey: string;
}

export interface ProviderRefundResult {
  provider: PaymentProviderId;
  refundId: string;
  paymentId: string;
  providerRefundReference: string;
  amount: number;
  currency: "INR";
  status: "PENDING" | "CONFIRMED" | "FAILED";
  confirmedAt?: string;
}

export interface ProviderWebhookInput {
  rawBody: string;
  headers: Readonly<Record<string, string>>;
}

export interface VerifiedProviderEvent {
  eventId: string;
  provider: PaymentProviderId;
  coachingId: string;
  kind: "payment" | "refund";
  paymentId: string;
  providerReference: string;
  amount: number;
  currency: "INR";
  status: "confirmed" | "failed" | "pending";
  occurredAt: string;
}

/** Future server adapter contract. It must receive tenant context resolved by the server. */
export interface TenantPaymentProviderAdapter {
  readonly provider: PaymentProviderId;
  createOrder(
    context: TenantPaymentContext,
    input: CreateProviderOrderInput,
  ): Promise<ProviderOrder>;
  verifyPayment(
    context: TenantPaymentContext,
    input: ProviderVerificationInput,
  ): Promise<ProviderVerificationResult>;
  requestRefund(
    context: TenantPaymentContext,
    input: ProviderRefundInput,
  ): Promise<ProviderRefundResult>;
  verifyRefund(
    context: TenantPaymentContext,
    input: {
      refundId: string;
      paymentId: string;
      providerRefundReference: string;
    },
  ): Promise<ProviderRefundResult>;
  verifyWebhook(
    context: TenantPaymentContext,
    input: ProviderWebhookInput,
  ): Promise<VerifiedProviderEvent>;
}

/* =========================================================
   VALIDATION
========================================================= */

function requireText(
  value: unknown,
  field: string
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} is required.`,
      { field }
    );
  }
}

function validatePositiveAmount(amount: unknown): number {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Payment amount must be greater than zero."
    );
  }

  // Convert through the shared money utility so invalid
  // precision and unsafe currency values are rejected.
  return fromPaise(toPaise(amount));
}

export function validateProviderOrderInput(
  input: CreateProviderOrderInput
): void {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payment order details are required."
    );
  }

  requireText(input.paymentId, "Payment ID");
  requireText(input.studentId, "Student ID");
  requireText(input.coachingId, "Coaching ID");

  validatePositiveAmount(input.amount);

  if (
    input.currency !== undefined &&
    input.currency !== "INR"
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Only INR currency is supported."
    );
  }
}

export function validateProviderVerificationInput(
  input: ProviderVerificationInput
): void {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payment verification details are required."
    );
  }

  requireText(input.orderId, "Provider order ID");
  requireText(input.paymentId, "Payment ID");
  requireText(
    input.providerPaymentId,
    "Provider payment ID"
  );

  validatePositiveAmount(input.amount);

  if (input.currency !== "INR") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Only INR currency is supported for payment verification.",
    );
  }

  if (
    input.signature !== undefined &&
    typeof input.signature !== "string"
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payment signature must be a string."
    );
  }
}
