import "server-only";

import { createSupabaseAdminClient } from "./admin";
import { getSupabasePublicConfig } from "./config";
import { isAuthorizedTestProjectUrl } from "./workspace-scope";
import { parsePaymentWebhookPayload } from "./payment-webhook-payload";
import {
  fetchCashfreeOrderPayments,
  fetchProviderPayment,
  PaymentProviderError,
  type ProviderPaymentState,
} from "./online-payment-provider";
import { verifyCashfreeWebhookSignature, verifyRazorpayWebhookSignature, sha256Hex } from "./online-payment-core";
import { loadSandboxCheckedPlatformPaymentCredentials } from "./platform-subscription-provider";
import { normalizeSubscriptionProviderStatus, type SubscriptionPaymentProvider } from "./platform-subscription-payment-core";

export type PlatformSubscriptionWebhookResult =
  | { ok: true; status: string }
  | { ok: false; status: 400 | 401 | 413 | 503; message: string };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function processPlatformSubscriptionWebhook(
  provider: SubscriptionPaymentProvider,
  rawBody: string,
  requestHeaders: Headers,
): Promise<PlatformSubscriptionWebhookResult> {
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
    return { ok: false, status: 413, message: "The webhook body is too large." };
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch {
    return { ok: false, status: 400, message: "The webhook payload is invalid." };
  }
  const parsed = parsePaymentWebhookPayload(provider, payload, requestHeaders, rawBody);
  if (!parsed?.providerOrderId || !parsed.providerPaymentId || !parsed.providerEventId) {
    return { ok: false, status: 400, message: "The webhook payment reference is invalid." };
  }

  try {
    if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) {
      return { ok: false, status: 503, message: "Platform subscription webhooks are test-project only." };
    }
    const admin = createSupabaseAdminClient();
    const credentials = await loadSandboxCheckedPlatformPaymentCredentials(admin, provider);
    if (provider === "razorpay") {
      const signature = requestHeaders.get("x-razorpay-signature") ?? "";
      if (!verifyRazorpayWebhookSignature(rawBody, signature, credentials.webhook_secret ?? "")) {
        return { ok: false, status: 401, message: "The Razorpay webhook signature is invalid." };
      }
    } else {
      const signature = requestHeaders.get("x-webhook-signature") ?? "";
      const timestamp = requestHeaders.get("x-webhook-timestamp") ?? "";
      if (!verifyCashfreeWebhookSignature(rawBody, timestamp, signature, credentials.webhook_secret ?? "")) {
        return { ok: false, status: 401, message: "The Cashfree webhook signature is invalid." };
      }
    }

    const { data: attempt, error: attemptError } = await admin
      .from("platform_payment_attempts")
      .select("id, provider_order_id, provider_payment_id, status")
      .eq("provider", provider)
      .eq("provider_order_id", parsed.providerOrderId)
      .maybeSingle();
    if (attemptError) return { ok: false, status: 503, message: "The subscription payment attempt could not be checked." };
    // A provider may deliver immediately after order creation, before the server
    // has persisted the provider order reference. Ask it to retry instead of
    // acknowledging and losing a potentially valid payment event.
    if (!attempt) return { ok: false, status: 503, message: "The subscription order is not recorded yet. Retry the webhook." };

    const normalizedWebhookStatus = normalizeSubscriptionProviderStatus(provider, parsed.eventType, parsed.rawStatus);
    if (!normalizedWebhookStatus) return { ok: true, status: "ignored_signed_event" };

    let providerPayment: ProviderPaymentState;
    if (provider === "razorpay") {
      providerPayment = await fetchProviderPayment({
        provider, credentials, providerOrderId: parsed.providerOrderId, providerPaymentId: parsed.providerPaymentId,
      });
    } else {
      const payments = await fetchCashfreeOrderPayments({ credentials, providerOrderId: parsed.providerOrderId });
      const match = payments.find((payment) => payment.providerPaymentId === parsed.providerPaymentId);
      if (!match) return { ok: false, status: 503, message: "Cashfree has not returned this payment yet. Retry the webhook." };
      providerPayment = match;
    }

    // Provider state, fetched server-side, wins over the signed event's status text.
    const { data: result, error } = await admin.rpc("finalize_platform_subscription_payment", {
      p_attempt_id: attempt.id,
      p_provider_order_id: providerPayment.providerOrderId,
      p_provider_payment_id: providerPayment.providerPaymentId,
      p_provider_status: providerPayment.status,
      p_provider_amount: providerPayment.amount || null,
      p_currency: providerPayment.currency || null,
      p_provider_event_id: parsed.providerEventId,
      p_event_type: parsed.eventType.slice(0, 120) || "provider_payment_event",
      p_payload_sha256: sha256Hex(rawBody),
    });
    const row = object(result);
    if (error || !row || typeof row.status !== "string") {
      return { ok: false, status: 503, message: "The verified payment event could not be recorded. The provider may retry it." };
    }
    return { ok: true, status: row.status };
  } catch (error) {
    if (error instanceof PaymentProviderError && error.code === "provider_rejected") {
      return { ok: false, status: 401, message: "The payment event does not match the provider's recorded payment." };
    }
    return { ok: false, status: 503, message: "Subscription payment webhook processing is unavailable." };
  }
}
