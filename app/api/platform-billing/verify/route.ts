import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import {
  fetchCashfreeOrderPayments,
  fetchProviderPayment,
  fetchRazorpayOrderPayments,
  PaymentProviderError,
} from "@/lib/supabase/online-payment-provider";
import { verifyRazorpayCheckoutSignature, sha256Hex } from "@/lib/supabase/online-payment-core";
import { chooseCashfreeOrderPayment } from "@/lib/supabase/cashfree-payment-state";
import { loadSandboxCheckedPlatformPaymentCredentials } from "@/lib/supabase/platform-subscription-provider";
import { subscriptionVerificationEventId } from "@/lib/supabase/platform-subscription-payment-core";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) return json({ error: "Subscription payment verification is test-project only." }, 503);
  } catch { return json({ error: "Subscription payment verification is not configured for the authorized test project." }, 503); }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!record(input) || typeof input.attemptId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.attemptId)) {
    return json({ error: "A valid payment attempt is required." }, 400);
  }

  try {
    const session = await createSupabaseServerClient();
    const { data: attempt, error: attemptError } = await session
      .from("platform_payment_attempts")
      .select("id, invoice_id, institute_id, provider, provider_order_id, provider_payment_id, status")
      .eq("id", input.attemptId)
      .maybeSingle();
    if (attemptError || !attempt) return json({ error: "This payment attempt is not available in the current workspace." }, 404);
    const access = await requireInstituteAccess(attempt.institute_id, { allowedRoles: ["owner", "administrator"] });
    if (access.accessScope !== "institute") return json({ error: "Institute-wide billing access is required." }, 403);
    if (!attempt.provider_order_id) return json({ error: "The provider order is not bound to this payment attempt." }, 409);
    if (attempt.status === "paid") return json({ verified: true, status: "paid", attemptId: attempt.id, duplicate: true });
    if (attempt.status === "reconciliation_required") return json({ verified: false, status: attempt.status, error: "This payment needs manual reconciliation." }, 409);

    const admin = createSupabaseAdminClient();
    const credentials = await loadSandboxCheckedPlatformPaymentCredentials(admin, attempt.provider);
    let payments;
    if (attempt.provider === "razorpay") {
      const paymentId = typeof input.paymentId === "string" ? input.paymentId.trim() : "";
      const signature = typeof input.signature === "string" ? input.signature.trim() : "";
      const orderId = typeof input.providerOrderId === "string" ? input.providerOrderId.trim() : "";
      if (paymentId || signature || orderId) {
        if (!paymentId || paymentId.length > 200 || orderId !== attempt.provider_order_id) {
          return json({ error: "The Razorpay checkout references do not match the saved attempt." }, 400);
        }
        if (!verifyRazorpayCheckoutSignature(orderId, paymentId, signature, credentials.key_secret ?? "")) {
          return json({ error: "The Razorpay checkout signature is invalid." }, 401);
        }
        payments = [await fetchProviderPayment({
          provider: "razorpay", credentials, providerOrderId: orderId, providerPaymentId: paymentId,
        })];
      } else {
        // Used after a lost checkout response or uncertain order creation. Only
        // server-fetched captured payments can settle the subscription invoice.
        const attempts = await fetchRazorpayOrderPayments({ credentials, providerOrderId: attempt.provider_order_id });
        const captures = attempts.filter((payment) => payment.status === "captured");
        if (captures.length === 0) return json({ verified: false, status: "pending",
          message: "Razorpay has not reported a captured payment. No invoice was marked paid." }, 202);
        payments = await Promise.all(captures.map((payment) => fetchProviderPayment({ provider: "razorpay", credentials,
          providerOrderId: attempt.provider_order_id!, providerPaymentId: payment.providerPaymentId })));
      }
    } else {
      payments = await fetchCashfreeOrderPayments({ credentials, providerOrderId: attempt.provider_order_id });
    }

    const decision = chooseCashfreeDecision(attempt.provider, payments);
    if (decision.kind === "none") return json({ verified: false, status: "pending", message: "The provider has not reported a payment attempt. No invoice was marked paid." }, 202);
    if (decision.kind === "reconcile") {
      const captures = payments.filter((payment) => payment.status === "captured");
      for (const payment of captures) {
        const eventId = subscriptionVerificationEventId(attempt.provider, payment.providerOrderId, payment.providerPaymentId, payment.status);
        const { data, error } = await admin.rpc("finalize_platform_subscription_payment", {
          p_attempt_id: attempt.id, p_provider_order_id: payment.providerOrderId,
          p_provider_payment_id: payment.providerPaymentId, p_provider_status: "captured",
          p_provider_amount: payment.amount, p_currency: payment.currency, p_provider_event_id: eventId,
          p_event_type: "authenticated_status_reconciliation", p_payload_sha256: null,
        });
        if (error || !record(data)) return json({ error: "Provider captures were found but could not be recorded. Retry reconciliation." }, 503);
      }
      return json({ verified: false, status: "reconciliation_required", error: "The provider reports multiple successful captures for this order. Manual reconciliation is required." }, 409);
    }

    const payment = decision.payment;
    const eventId = subscriptionVerificationEventId(attempt.provider, payment.providerOrderId, payment.providerPaymentId, payment.status);
    const { data: result, error } = await admin.rpc("finalize_platform_subscription_payment", {
      p_attempt_id: attempt.id,
      p_provider_order_id: payment.providerOrderId,
      p_provider_payment_id: payment.providerPaymentId,
      p_provider_status: payment.status,
      p_provider_amount: payment.amount || null,
      p_currency: payment.currency || null,
      p_provider_event_id: eventId,
      p_event_type: "authenticated_provider_status_check",
      p_payload_sha256: sha256Hex(body),
    });
    if (error || !record(result) || typeof result.status !== "string") {
      return json({ error: "Provider status was checked but could not be recorded. Retry verification." }, 503);
    }
    if (result.status === "paid") return json({ verified: true, status: "paid", invoiceId: attempt.invoice_id, attemptId: attempt.id });
    if (result.status === "reconciliation_required") return json({ verified: false, status: result.status, error: "The provider reports a payment that does not reconcile with the invoice." }, 409);
    if (result.status === "duplicate_event") {
      const { data: currentInvoice, error: currentInvoiceError } = await admin
        .from("platform_subscription_invoices")
        .select("status")
        .eq("id", attempt.invoice_id)
        .maybeSingle();
      if (currentInvoiceError || !currentInvoice) return json({ error: "Payment was already seen, but its invoice status could not be confirmed." }, 503);
      return json({ verified: currentInvoice.status === "paid", status: result.status, attemptId: attempt.id });
    }
    return json({ verified: false, status: result.status, message: "The provider has not confirmed capture. No invoice was marked paid." }, result.status === "pending" || result.status === "authorized" ? 202 : 200);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof PaymentProviderError) return json({
      error: error.code === "credentials_unavailable"
        ? "A sandbox-checked central provider and server-side Vault access are required."
        : "The provider status could not be confirmed. No invoice was marked paid.",
    }, error.code === "provider_unavailable" ? 502 : 503);
    return json({ error: "Subscription payment verification is unavailable." }, 503);
  }
}

function chooseCashfreeDecision(
  provider: "razorpay" | "cashfree",
  payments: Awaited<ReturnType<typeof fetchCashfreeOrderPayments>> | Awaited<ReturnType<typeof fetchProviderPayment>>[],
): ReturnType<typeof chooseCashfreeOrderPayment> {
  if (provider === "cashfree") return chooseCashfreeOrderPayment(payments as Awaited<ReturnType<typeof fetchCashfreeOrderPayments>>);
  const razorpayPayments = payments as Awaited<ReturnType<typeof fetchProviderPayment>>[];
  if (!razorpayPayments.length) return { kind: "none" };
  const captures = razorpayPayments.filter((payment) => payment.status === "captured");
  if (captures.length > 1) return { kind: "reconcile" };
  return { kind: "payment", payment: captures[0] ?? razorpayPayments[0] };
}
