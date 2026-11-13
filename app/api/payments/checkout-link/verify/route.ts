import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chooseCashfreeOrderPayment } from "@/lib/supabase/cashfree-payment-state";
import { hashPaymentCheckoutLinkToken } from "@/lib/supabase/payment-checkout-link-token";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { verifyRazorpayCheckoutSignature } from "@/lib/supabase/online-payment-core";
import {
  fetchCashfreeOrderPayments,
  fetchProviderPayment,
  fetchRazorpayOrderPayments,
  loadActiveInstitutePaymentCredentials,
  PaymentProviderError,
} from "@/lib/supabase/online-payment-provider";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function testProjectOnly(): boolean {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : "";
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Parent payment verification is available only on the authorized test project." }, 503);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  const record = asRecord(input);
  if (!record) return json({ error: "The request body is invalid." }, 400);
  const tokenSha256 = hashPaymentCheckoutLinkToken(record.token);
  if (!tokenSha256) return json({ error: "This payment link is invalid or expired." }, 404);

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("resolve_payment_checkout_link", { p_token_sha256: tokenSha256 });
    const link = asRecord(data);
    if (error || !link || typeof link.institute_id !== "string") {
      return json({ error: "This payment link is invalid, expired, or revoked." }, 404);
    }
    if (link.order_status === "Captured") return json({ verified: true, status: "captured", duplicate: true });
    if (!["Pending", "Processing", "Authorized"].includes(String(link.order_status))) {
      return json({ verified: false, status: "unavailable", message: "This order is no longer payable." }, 409);
    }
    const provider = link.provider;
    const providerOrderId = text(link.provider_order_id, 200);
    if ((provider !== "razorpay" && provider !== "cashfree") || !providerOrderId) {
      return json({ error: "The provider order is unavailable." }, 409);
    }
    const credentials = await loadActiveInstitutePaymentCredentials(admin, link.institute_id, provider);
    let payments;
    if (provider === "razorpay") {
      const paymentId = text(record.paymentId, 200);
      const signature = text(record.signature, 256);
      if (paymentId || signature) {
        if (!paymentId || !signature) return json({ error: "Razorpay's signed checkout response is incomplete." }, 400);
        if (!verifyRazorpayCheckoutSignature(providerOrderId, paymentId, signature, credentials.key_secret ?? "")) {
          return json({ error: "The Razorpay checkout signature is invalid." }, 401);
        }
        payments = [await fetchProviderPayment({ provider, credentials, providerOrderId, providerPaymentId: paymentId })];
      } else {
        const attempts = await fetchRazorpayOrderPayments({ credentials, providerOrderId });
        const captures = attempts.filter((attempt) => attempt.status === "captured");
        if (captures.length === 0) return json({ verified: false, status: "pending",
          message: "Razorpay has not reported a captured payment. No receipt was posted." }, 202);
        payments = await Promise.all(captures.map((capture) => fetchProviderPayment({ provider, credentials,
          providerOrderId, providerPaymentId: capture.providerPaymentId })));
      }
    } else {
      const cashfreePayments = await fetchCashfreeOrderPayments({ credentials, providerOrderId });
      const decision = chooseCashfreeOrderPayment(cashfreePayments);
      if (decision.kind === "reconcile") {
        return json({ verified: false, status: "reconciliation_required", message: "Cashfree reports multiple successful attempts. The institute must reconcile them before posting a receipt." }, 409);
      }
      if (decision.kind === "none") {
        return json({ verified: false, status: "pending", message: "The provider has not confirmed a payment. No receipt was posted." }, 202);
      }
      payments = [decision.payment];
    }

    const captures = payments.filter((attempt) => attempt.status === "captured");
    if (captures.length > 1) {
      for (const capture of captures) {
        const { error: reconciliationError } = await admin.rpc("process_online_payment_status", {
          p_provider: provider, p_provider_order_id: capture.providerOrderId,
          p_provider_payment_id: capture.providerPaymentId, p_provider_status: capture.status,
          p_provider_amount: Number(capture.amount), p_currency: capture.currency,
          p_provider_event_id: null, p_event_type: "public_checkout_status_reconciliation", p_payload_sha256: null,
        });
        if (reconciliationError) return json({ error: "Provider captures were found but could not be recorded. Retry status verification." }, 503);
      }
      return json({ verified: false, status: "reconciliation_required",
        message: `${provider === "razorpay" ? "Razorpay" : "Cashfree"} reports multiple captured attempts. The institute must reconcile them before this link can confirm a receipt.` }, 409);
    }
    const payment = captures[0] ?? payments[0];

    const { data: outcomeData, error: processError } = await admin.rpc("process_online_payment_status", {
      p_provider: provider,
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: payment.providerPaymentId,
      p_provider_status: payment.status,
      p_provider_amount: Number(payment.amount),
      p_currency: payment.currency,
      p_provider_event_id: null,
      p_event_type: null,
      p_payload_sha256: null,
    });
    const outcome = asRecord(outcomeData);
    if (processError || !outcome) return json({ error: "Provider status was checked but could not be recorded. Retry status verification." }, 503);
    if (outcome.status === "captured") return json({ verified: true, status: "captured" });
    if (outcome.status === "reconciliation_required") {
      return json({ verified: false, status: outcome.status, message: "The captured provider payment needs institute reconciliation; no student receipt was posted." }, 409);
    }
    return json({ verified: false, status: outcome.status, message: "The provider has not confirmed a captured payment. No receipt was posted." }, 202);
  } catch (error) {
    if (error instanceof PaymentProviderError) return json({ error: error.code === "credentials_unavailable"
      ? "The test provider connection is unavailable. Contact the institute."
      : "The provider status could not be confirmed. No receipt was posted." }, error.code === "provider_unavailable" ? 502 : 503);
    return json({ error: "Payment verification is unavailable. Contact the institute." }, 503);
  }
}
