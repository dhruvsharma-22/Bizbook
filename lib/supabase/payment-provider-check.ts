import { randomUUID } from "node:crypto";
import type { PaymentConnectionInputResult } from "./payment-connection-validation";

export type SandboxCheckResult =
  | {
      ok: true;
      providerOrderId: string;
      status: "created";
      amountMinor: 100;
      currency: "INR";
    }
  | {
      ok: false;
      code: "credentials_rejected" | "provider_rejected" | "provider_unavailable";
      message: string;
    };

type FetchLike = typeof fetch;

function rejected(response: Response): SandboxCheckResult {
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "credentials_rejected",
      message: "The provider rejected these sandbox credentials. Check the app ID/key and secret in the provider dashboard.",
    };
  }
  return {
    ok: false,
    code: "provider_rejected",
    message: "The provider did not accept the sandbox order check. Review the sandbox account and try again.",
  };
}

/**
 * Performs a real, server-side sandbox API check by creating an unpaid INR 1
 * order. No checkout/session token is returned and no payment is attempted.
 * Keep this function server-only at its call sites; credentials must never be
 * logged or returned to the browser.
 */
export async function verifySandboxPaymentCredentials(
  provider: "razorpay" | "cashfree",
  parsed: Extract<PaymentConnectionInputResult, { ok: true }>,
  fetcher: FetchLike = fetch,
  createId: () => string = randomUUID,
): Promise<SandboxCheckResult> {
  if (parsed.provider !== provider) {
    return {
      ok: false,
      code: "provider_rejected",
      message: "The provider configuration does not match the requested check.",
    };
  }

  const id = createId().replaceAll("-", "").slice(0, 24);
  const abort = AbortSignal.timeout(10_000);

  try {
    if (provider === "razorpay") {
      const keyId = parsed.credentials.key_id;
      const keySecret = parsed.credentials.key_secret;
      if (!keyId || !keySecret) {
        return { ok: false, code: "provider_rejected", message: "Razorpay sandbox credentials are incomplete." };
      }

      const response = await fetcher("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ amount: 100, currency: "INR", receipt: `bbcfg_${id}` }),
        cache: "no-store",
        redirect: "error",
        signal: abort,
      });
      if (!response.ok) return rejected(response);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") {
        return { ok: false, code: "provider_rejected", message: "The provider returned an unrecognized sandbox response." };
      }
      const order = data as Record<string, unknown>;
      if (
        typeof order.id !== "string" ||
        !order.id.startsWith("order_") ||
        order.status !== "created" ||
        order.amount !== 100 ||
        order.amount_paid !== 0 ||
        order.currency !== "INR"
      ) {
        return { ok: false, code: "provider_rejected", message: "The provider returned an unexpected sandbox order state." };
      }
      return { ok: true, providerOrderId: order.id, status: "created", amountMinor: 100, currency: "INR" };
    }

    const clientId = parsed.credentials.client_id;
    const clientSecret = parsed.credentials.client_secret;
    if (!clientId || !clientSecret) {
      return { ok: false, code: "provider_rejected", message: "Cashfree sandbox credentials are incomplete." };
    }

    const orderId = `bbcfg_${id}`;
    const response = await fetcher("https://sandbox.cashfree.com/pg/orders", {
      method: "POST",
      headers: {
        "x-client-id": clientId,
        "x-client-secret": clientSecret,
        "x-api-version": "2025-01-01",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: 1,
        order_currency: "INR",
        customer_details: {
          customer_id: `bizbook_config_${id}`,
          customer_phone: "9999999999",
        },
      }),
      cache: "no-store",
      redirect: "error",
      signal: abort,
    });
    if (!response.ok) return rejected(response);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") {
      return { ok: false, code: "provider_rejected", message: "The provider returned an unrecognized sandbox response." };
    }
    const order = data as Record<string, unknown>;
    if (
      order.order_id !== orderId ||
      order.order_status !== "ACTIVE" ||
      typeof order.payment_session_id !== "string" ||
      !order.payment_session_id ||
      Number(order.order_amount) !== 1 ||
      order.order_currency !== "INR"
    ) {
      return { ok: false, code: "provider_rejected", message: "The provider returned an unexpected sandbox order state." };
    }
    return { ok: true, providerOrderId: orderId, status: "created", amountMinor: 100, currency: "INR" };
  } catch {
    // Do not include exception/provider response text: it can contain request
    // details. The credentials and provider bodies are never logged.
    return {
      ok: false,
      code: "provider_unavailable",
      message: "The sandbox provider could not be reached or timed out. No successful connection check was recorded.",
    };
  }
}
