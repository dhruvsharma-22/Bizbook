import { cashfreeWebhookEventId, paiseToRupees, sha256Hex } from "./online-payment-core";
import type { PaymentProvider } from "./payment-connection-validation";

export type PaymentWebhookPayload = {
  providerOrderId: string;
  providerPaymentId: string;
  eventType: string;
  rawStatus: string;
  rawAmount: string;
  rawCurrency: string;
  providerEventId: string;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 255): string {
  if (typeof value === "string" && value.trim().length > 0 && value.length <= max) return value.trim();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return "";
}

/** Normalize documented Razorpay and Cashfree webhook envelopes without trusting them as payment proof. */
export function parsePaymentWebhookPayload(
  provider: PaymentProvider,
  payload: unknown,
  requestHeaders: Headers,
  rawBody: string,
): PaymentWebhookPayload | null {
  const root = object(payload);
  if (!root) return null;

  if (provider === "razorpay") {
    const payloadContainer = object(root.payload);
    const paymentContainer = object(payloadContainer?.payment);
    const payment = object(paymentContainer?.entity);
    if (!payment) return null;

    const amountPaise = typeof payment.amount === "number" && Number.isSafeInteger(payment.amount)
      ? payment.amount
      : null;
    return {
      providerOrderId: text(payment.order_id, 200),
      providerPaymentId: text(payment.id, 200),
      eventType: text(root.event, 120),
      rawStatus: text(root.event, 120),
      rawAmount: amountPaise === null ? "" : paiseToRupees(amountPaise) ?? "",
      rawCurrency: text(payment.currency, 8),
      providerEventId: text(requestHeaders.get("x-razorpay-event-id"), 255)
        || `razorpay:${sha256Hex(rawBody)}`,
    };
  }

  const data = object(root.data);
  const order = object(data?.order);
  const payment = object(data?.payment);
  if (!data || !order || !payment) return null;

  return {
    providerOrderId: text(order.order_id, 200),
    providerPaymentId: text(payment.cf_payment_id, 200),
    eventType: text(root.type, 120) || "cashfree_payment_event",
    rawStatus: text(payment.payment_status, 120),
    rawAmount: typeof payment.payment_amount === "number" || typeof payment.payment_amount === "string"
      ? String(payment.payment_amount)
      : "",
    rawCurrency: text(payment.payment_currency, 8) || text(order.order_currency, 8) || "INR",
    providerEventId: text(requestHeaders.get("x-webhook-id"), 255) || cashfreeWebhookEventId(payload),
  };
}
