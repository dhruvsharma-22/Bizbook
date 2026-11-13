import { sha256Hex } from "./online-payment-core";

export type SubscriptionPaymentProvider = "razorpay" | "cashfree";

export function isSandboxCheckedPlatformPaymentConnection(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.provider_scope === "payment"
    && (row.provider === "razorpay" || row.provider === "cashfree")
    && row.environment === "test"
    && row.connection_status === "pending"
    && typeof row.last_verified_at === "string"
    && !Number.isNaN(Date.parse(row.last_verified_at));
}

export function normalizeSubscriptionProviderStatus(
  provider: SubscriptionPaymentProvider,
  eventType: string,
  providerStatus: string,
): "captured" | "pending" | "authorized" | "failed" | "cancelled" | null {
  if (provider === "razorpay") {
    if (eventType === "payment.captured") return "captured";
    if (eventType === "payment.authorized") return "authorized";
    if (eventType === "payment.failed") return "failed";
    if (eventType === "payment.cancelled") return "cancelled";
    return null;
  }
  if (providerStatus === "SUCCESS" || eventType === "PAYMENT_SUCCESS_WEBHOOK") return "captured";
  if (providerStatus === "FAILED" || eventType === "PAYMENT_FAILED_WEBHOOK") return "failed";
  if (providerStatus === "USER_DROPPED" || eventType === "PAYMENT_USER_DROPPED_WEBHOOK") return "cancelled";
  if (providerStatus === "PENDING" || eventType === "PAYMENT_PENDING_WEBHOOK") return "pending";
  return null;
}

export function subscriptionVerificationEventId(
  provider: SubscriptionPaymentProvider,
  orderId: string,
  paymentId: string,
  status: string,
): string {
  return `verify-${provider}-${sha256Hex(`${orderId}|${paymentId}|${status}`)}`;
}
