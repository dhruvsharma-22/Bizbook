import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import {
  fetchProviderPayment,
  loadActiveInstitutePaymentCredentials,
  PaymentProviderError,
} from "@/lib/supabase/online-payment-provider";
import { verifyRazorpayCheckoutSignature } from "@/lib/supabase/online-payment-core";
import { dispatchFeeReceiptForPayment } from "@/lib/supabase/payment-receipts";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function testProjectOnly(): boolean {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, max = 200): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Payment verification is enabled only on the verified test project." }, 503);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 8_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!record(input)) return json({ error: "The request body is invalid." }, 400);
  const orderId = text(input.orderId, 100);
  const paymentId = text(input.paymentId, 200);
  const signature = text(input.signature, 256);
  if (!orderId || !paymentId) return json({ error: "The stored order and provider payment references are required." }, 400);

  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: order, error: orderError } = await sessionClient
      .from("payment_orders")
      .select("id, institute_id, branch_id, provider, provider_order_id, order_status, payment_id")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) return json({ error: "The payment order is unavailable in this workspace." }, 404);
    await requireInstituteAccess(order.institute_id, {
      allowedRoles: ["owner", "administrator", "accountant"],
      ...(order.branch_id ? { branchId: order.branch_id } : {}),
    });
    if (!order.provider_order_id) return json({ error: "The provider order reference has not been saved." }, 409);
    const capturedPaymentId = order.payment_id;
    if (order.order_status === "Captured" && capturedPaymentId) {
      after(async () => { try { await dispatchFeeReceiptForPayment(capturedPaymentId); } catch { /* The durable receipt queue remains available for retry. */ } });
      return json({ verified: true, status: "captured", paymentId: capturedPaymentId, duplicate: true });
    }

    const adminClient = createSupabaseAdminClient();
    const credentials = await loadActiveInstitutePaymentCredentials(adminClient, order.institute_id, order.provider);
    if (order.provider === "razorpay" && !verifyRazorpayCheckoutSignature(
      order.provider_order_id, paymentId, signature, credentials.key_secret ?? "",
    )) {
      return json({ error: "The Razorpay checkout signature is invalid." }, 401);
    }
    const providerPayment = await fetchProviderPayment({
      provider: order.provider,
      credentials,
      providerOrderId: order.provider_order_id,
      providerPaymentId: paymentId,
    });
    const { data: outcome, error: processError } = await adminClient.rpc("process_online_payment_status", {
      p_provider: order.provider,
      p_provider_order_id: providerPayment.providerOrderId,
      p_provider_payment_id: providerPayment.providerPaymentId,
      p_provider_status: providerPayment.status,
      p_provider_amount: Number(providerPayment.amount),
      p_currency: providerPayment.currency,
      p_provider_event_id: null,
      p_event_type: null,
      p_payload_sha256: null,
    });
    if (processError || !record(outcome)) return json({ error: "Provider status was checked but could not be recorded. Retry verification." }, 503);
    if (outcome.status === "reconciliation_required") {
      return json({ verified: false, status: "reconciliation_required", error: "The provider reports a captured payment that needs reconciliation before it can be posted to the student ledger." }, 409);
    }
    if (outcome.status === "captured") {
      if (typeof outcome.payment_id === "string") {
        after(async () => { try { await dispatchFeeReceiptForPayment(outcome.payment_id as string); } catch { /* Do not undo a provider-verified payment if messaging is unavailable. */ } });
      }
      return json({ verified: true, status: "captured", paymentId: outcome.payment_id });
    }
    return json({ verified: false, status: outcome.status, message: "The provider has not confirmed a captured payment. No receipt was posted." }, 202);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof PaymentProviderError) {
      return json({ error: error.code === "credentials_unavailable"
        ? "A verified test provider connection and server-side Vault access are required."
        : "The provider status could not be confirmed. No receipt was posted.", code: error.code },
      error.code === "provider_unavailable" ? 502 : 503);
    }
    return json({ error: "Payment verification is unavailable." }, 503);
  }
}
