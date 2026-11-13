import "server-only";

import { createSupabaseAdminClient } from "./admin";
import { getSupabasePublicConfig } from "./config";
import { isAuthorizedTestProjectUrl } from "./workspace-scope";
import {
  paiseToRupees,
  rupeesToPaise,
  sha256Hex,
  verifyCashfreeWebhookSignature,
  verifyRazorpayWebhookSignature,
} from "./online-payment-core";
import { parsePaymentWebhookPayload } from "./payment-webhook-payload";
import {
  fetchProviderPayment,
  loadActiveInstitutePaymentCredentials,
  PaymentProviderError,
  type ProviderPaymentState,
} from "./online-payment-provider";
import type { PaymentProvider } from "./payment-connection-validation";

export type WebhookResult =
  | { ok: true; status: "captured"; paymentId?: string }
  | { ok: true; status: "pending" | "authorized" | "failed" | "cancelled" | "duplicate_event" | "reconciliation_required" | "unmatched_provider_order" }
  | { ok: false; httpStatus: 401 | 413 | 503; message: string };

function providerStatus(value: string, provider: PaymentProvider): ProviderPaymentState["status"] | null {
  if (provider === "razorpay") {
    if (value === "payment.captured") return "captured";
    if (value === "payment.authorized") return "authorized";
    if (value === "payment.failed") return "failed";
    if (value === "payment.cancelled") return "cancelled";
    return null;
  }
  if (value === "SUCCESS" || value === "PAYMENT_SUCCESS_WEBHOOK") return "captured";
  if (value === "FAILED" || value === "PAYMENT_FAILED_WEBHOOK") return "failed";
  if (value === "USER_DROPPED" || value === "PAYMENT_USER_DROPPED_WEBHOOK") return "cancelled";
  if (value === "PENDING" || value === "PAYMENT_PENDING_WEBHOOK") return "pending";
  return null;
}

export async function processProviderWebhook(
  provider: PaymentProvider,
  rawBody: string,
  requestHeaders: Headers,
): Promise<WebhookResult> {
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
    return { ok: false, httpStatus: 413, message: "The webhook body is too large." };
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return { ok: false, httpStatus: 401, message: "The webhook payload is invalid." }; }
  const parsed = parsePaymentWebhookPayload(provider, payload, requestHeaders, rawBody);
  if (!parsed) {
    return { ok: false, httpStatus: 401, message: "The webhook payload is invalid." };
  }
  const { providerOrderId, providerPaymentId, rawStatus, rawAmount, rawCurrency, eventType, providerEventId } = parsed;
  const normalizedStatus = providerStatus(rawStatus, provider);
  if (!providerOrderId || !providerPaymentId) return { ok: false, httpStatus: 401, message: "The webhook payment reference is invalid." };

  try {
    if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) {
      return { ok: false, httpStatus: 503, message: "Payment webhooks are enabled only on the authorized test project." };
    }
    const admin = createSupabaseAdminClient();
    const { data: storedOrder, error: orderError } = await admin
      .from("payment_orders")
      .select("id, institute_id, provider_order_id, order_status")
      .eq("provider", provider)
      .eq("provider_order_id", providerOrderId)
      .maybeSingle();
    if (orderError) return { ok: false, httpStatus: 503, message: "The payment order could not be checked." };
    if (!storedOrder) return { ok: true, status: "unmatched_provider_order" };

    const credentials = await loadActiveInstitutePaymentCredentials(admin, storedOrder.institute_id, provider);
    if (provider === "razorpay") {
      const signature = requestHeaders.get("x-razorpay-signature") ?? "";
      if (!verifyRazorpayWebhookSignature(rawBody, signature, credentials.webhook_secret ?? "")) {
        return { ok: false, httpStatus: 401, message: "The Razorpay webhook signature is invalid." };
      }
    } else {
      const signature = requestHeaders.get("x-webhook-signature") ?? "";
      const timestamp = requestHeaders.get("x-webhook-timestamp") ?? "";
      if (!verifyCashfreeWebhookSignature(rawBody, timestamp, signature, credentials.webhook_secret ?? "")) {
        return { ok: false, httpStatus: 401, message: "The Cashfree webhook signature is invalid." };
      }
    }

    // Unknown signed events are acknowledged without altering the financial ledger.
    if (!normalizedStatus) return { ok: true, status: "pending" };
    let verifiedStatus = normalizedStatus;
    let amount = rawAmount;
    let currency = rawCurrency;
    if (normalizedStatus === "captured") {
      const providerPayment = await fetchProviderPayment({ provider, credentials, providerOrderId, providerPaymentId });
      verifiedStatus = providerPayment.status;
      amount = providerPayment.amount;
      currency = providerPayment.currency;
    }
    const amountPaise = amount ? rupeesToPaise(amount) : null;
    const { data: result, error } = await admin.rpc("process_online_payment_status", {
      p_provider: provider,
      p_provider_order_id: providerOrderId,
      p_provider_payment_id: providerPaymentId || null,
      p_provider_status: verifiedStatus,
      p_provider_amount: amountPaise === null ? null : Number(paiseToRupees(amountPaise)),
      p_currency: currency || null,
      p_provider_event_id: providerEventId,
      p_event_type: eventType || "provider_payment_event",
      p_payload_sha256: sha256Hex(rawBody),
    });
    if (error || !result || typeof result !== "object" || Array.isArray(result)) {
      return { ok: false, httpStatus: 503, message: "The verified provider event could not be recorded. The provider may retry it." };
    }
    const status = (result as Record<string, unknown>).status;
    const paymentId = (result as Record<string, unknown>).payment_id;
    if (status === "captured" && typeof paymentId === "string") return { ok: true, status: "captured", paymentId };
    if (status === "captured" || status === "pending" || status === "authorized" || status === "failed"
        || status === "cancelled" || status === "duplicate_event" || status === "reconciliation_required"
        || status === "unmatched_provider_order") return { ok: true, status };
    return { ok: false, httpStatus: 503, message: "The verified provider event returned an unknown result." };
  } catch (error) {
    if (error instanceof PaymentProviderError && error.code === "provider_unavailable") {
      return { ok: false, httpStatus: 503, message: "Provider status verification is unavailable. The event was not marked paid." };
    }
    return { ok: false, httpStatus: 503, message: "Webhook processing is unavailable. No unverified payment was posted." };
  }
}
