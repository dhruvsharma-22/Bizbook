import { after, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { chooseCashfreeOrderPayment } from "@/lib/supabase/cashfree-payment-state";
import {
  fetchCashfreeOrderPayments,
  fetchProviderPayment,
  fetchRazorpayOrderPayments,
  loadActiveInstitutePaymentCredentials,
  PaymentProviderError,
  type ProviderPaymentState,
} from "@/lib/supabase/online-payment-provider";
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

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Payment status checks are enabled only on the verified test project." }, 503);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
  const orderId = (input as Record<string, unknown>).orderId;
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(orderId)) {
    return json({ error: "A valid payment order reference is required." }, 400);
  }

  try {
    const session = await createSupabaseServerClient();
    const { data: order, error: orderError } = await session.from("payment_orders")
      .select("id, institute_id, branch_id, provider, provider_order_id, order_status, payment_id")
      .eq("id", orderId).maybeSingle();
    if (orderError || !order) return json({ error: "The payment order is unavailable in this workspace." }, 404);
    await requireInstituteAccess(order.institute_id, {
      allowedRoles: ["owner", "administrator", "accountant"],
      ...(order.branch_id ? { branchId: order.branch_id } : {}),
    });
    const capturedPaymentId = order.payment_id;
    if (order.order_status === "Captured" && capturedPaymentId) {
      after(async () => { try { await dispatchFeeReceiptForPayment(capturedPaymentId); } catch { /* The durable receipt queue remains available for retry. */ } });
      return json({ status: "captured", paymentId: capturedPaymentId, duplicate: true });
    }
    if (order.provider !== "cashfree" && order.provider !== "razorpay") return json({ error: "This payment provider cannot be synchronized." }, 422);
    if (!order.provider_order_id) return json({ error: "The provider order reference is not available." }, 409);

    const admin = createSupabaseAdminClient();
    const provider = order.provider;
    const credentials = await loadActiveInstitutePaymentCredentials(admin, order.institute_id, provider);
    let outcome: ProviderPaymentState;
    if (provider === "cashfree") {
      const payments = await fetchCashfreeOrderPayments({ credentials, providerOrderId: order.provider_order_id });
      const decision = chooseCashfreeOrderPayment(payments);
      if (decision.kind === "reconcile") {
        return json({ status: "reconciliation_required", error: "Cashfree reports multiple successful attempts for this order. No receipt was automatically posted; an administrator must reconcile the provider account." }, 409);
      }
      if (decision.kind === "none") return json({ status: "pending", message: "Cashfree has not reported a payment attempt. No receipt was posted." }, 202);
      outcome = decision.payment;
    } else {
      const payments = await fetchRazorpayOrderPayments({ credentials, providerOrderId: order.provider_order_id });
      const captures = payments.filter((payment) => payment.status === "captured");
      const verifiedCaptures: ProviderPaymentState[] = [];
      for (const captured of captures) {
        const verified = await fetchProviderPayment({ provider, credentials,
          providerOrderId: order.provider_order_id, providerPaymentId: captured.providerPaymentId });
        if (verified.status === "captured") verifiedCaptures.push(verified);
      }
      if (verifiedCaptures.length > 1) {
        // Record every provider-confirmed capture through the idempotent finalizer.
        // The first may settle the order; subsequent distinct captures become
        // reconciliation records instead of duplicate student receipts.
        for (const verified of verifiedCaptures) {
          const { error } = await admin.rpc("process_online_payment_status", {
            p_provider: provider, p_provider_order_id: verified.providerOrderId,
            p_provider_payment_id: verified.providerPaymentId, p_provider_status: verified.status,
            p_provider_amount: Number(verified.amount), p_currency: verified.currency,
            p_provider_event_id: null, p_event_type: "authenticated_status_reconciliation", p_payload_sha256: null,
          });
          if (error) return json({ error: "Provider captures were found but could not be recorded. Retry reconciliation." }, 503);
        }
        return json({ status: "reconciliation_required", error: "Razorpay reports multiple captured attempts. No duplicate receipt was posted; review the provider captures in payment reconciliation." }, 409);
      }
      if (verifiedCaptures.length === 0) return json({ status: "pending", message: "Razorpay has not reported a captured payment. No receipt was posted." }, 202);
      outcome = verifiedCaptures[0];
    }

    const { data: result, error } = await admin.rpc("process_online_payment_status", {
      p_provider: provider,
      p_provider_order_id: outcome.providerOrderId,
      p_provider_payment_id: outcome.providerPaymentId,
      p_provider_status: outcome.status,
      p_provider_amount: Number(outcome.amount),
      p_currency: outcome.currency,
      p_provider_event_id: null,
      p_event_type: null,
      p_payload_sha256: null,
    });
    if (error || !result || typeof result !== "object" || Array.isArray(result)) {
      return json({ error: "Cashfree status was checked but could not be recorded. Retry the status check." }, 503);
    }
    const status = (result as Record<string, unknown>).status;
    if (status === "captured") {
      const capturedPaymentId = (result as Record<string, unknown>).payment_id;
      if (typeof capturedPaymentId === "string") {
        after(async () => { try { await dispatchFeeReceiptForPayment(capturedPaymentId); } catch { /* Keep verified payment success independent of notification delivery. */ } });
      }
      return json({ status, paymentId: capturedPaymentId });
    }
    if (status === "reconciliation_required") return json({ status, error: `${provider === "cashfree" ? "Cashfree" : "Razorpay"} reported success, but the amount or installment balance did not reconcile. No student receipt was posted.` }, 409);
    if (status === "pending" || status === "authorized" || status === "failed" || status === "cancelled") {
      return json({ status, message: status === "failed" || status === "cancelled"
        ? `${provider === "cashfree" ? "Cashfree" : "Razorpay"} reports the attempt as ${status}. No receipt was posted.`
        : `${provider === "cashfree" ? "Cashfree" : "Razorpay"} has not confirmed a captured payment. No receipt was posted.` }, status === "pending" ? 202 : 200);
    }
    return json({ error: "Cashfree returned an unsupported payment status." }, 503);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof PaymentProviderError) return json({
      error: error.code === "credentials_unavailable"
        ? "A verified sandbox connection and server-side Vault access are required."
        : "Provider payment status could not be checked. No receipt was posted.",
    }, error.code === "provider_unavailable" ? 502 : 503);
    return json({ error: "Payment status is unavailable." }, 503);
  }
}
