import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { rupeesToPaise } from "@/lib/supabase/online-payment-core";
import {
  createProviderRefund,
  fetchProviderRefund,
  loadActiveInstitutePaymentCredentials,
  PaymentProviderError,
} from "@/lib/supabase/online-payment-provider";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

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
  if (!testProjectOnly()) return json({ error: "Provider refunds are enabled only on the verified test project." }, 503);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  const refundId = isRecord(input) && typeof input.refundId === "string" ? input.refundId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(refundId)) {
    return json({ error: "A valid refund request reference is required." }, 400);
  }

  try {
    const session = await createSupabaseServerClient();
    const { data: refund, error: refundError } = await session.from("refunds")
      .select("id, institute_id, branch_id, payment_id, amount, status, reason, mode, provider_refund_reference")
      .eq("id", refundId).maybeSingle();
    if (refundError || !refund) return json({ error: "The refund is unavailable in this workspace." }, 404);
    if (refund.mode !== "Online") return json({ error: "This action is only available for provider-backed online refunds." }, 422);
    if (!["Pending", "Processing"].includes(refund.status)) {
      return json({ status: refund.status, message: "This refund is already in a terminal state; no provider request was sent." }, 200);
    }
    await requireInstituteAccess(refund.institute_id, {
      allowedRoles: ["owner", "administrator", "accountant"],
      ...(refund.branch_id ? { branchId: refund.branch_id } : {}),
    });

    const { data: payment, error: paymentError } = await session.from("payments")
      .select("id, mode, status, provider, provider_order_id, provider_payment_id, currency")
      .eq("id", refund.payment_id).eq("institute_id", refund.institute_id).maybeSingle();
    if (paymentError || !payment || payment.mode !== "Online" || !["Paid", "Partially Refunded"].includes(payment.status)
      || (payment.provider !== "razorpay" && payment.provider !== "cashfree")
      || !payment.provider_order_id || !payment.provider_payment_id || payment.currency !== "INR") {
      return json({ error: "The original verified online receipt is not eligible for a provider refund." }, 409);
    }

    const admin = createSupabaseAdminClient();
    const credentials = await loadActiveInstitutePaymentCredentials(admin, refund.institute_id, payment.provider);
    const common = {
      provider: payment.provider,
      credentials,
      localRefundId: refund.id,
      providerPaymentId: payment.provider_payment_id,
      providerOrderId: payment.provider_order_id,
      amount: String(refund.amount),
    } as const;
    const providerRefund = refund.provider_refund_reference
      ? await fetchProviderRefund({ ...common, providerRefundId: refund.provider_refund_reference })
      : await createProviderRefund({ ...common, reason: refund.reason });

    if (!providerRefund) {
      return json({ status: refund.status, message: "The provider has not returned a refund record. The reserved amount remains pending; retry or reconcile before requesting another refund." }, 202);
    }
    if (rupeesToPaise(providerRefund.amount) !== rupeesToPaise(refund.amount)) {
      return json({ error: "The provider refund amount did not match the reserved amount. The refund remains pending for reconciliation." }, 409);
    }
    const { data: recorded, error: recordError } = await admin.rpc("record_online_refund_status", {
      p_refund_id: refund.id,
      p_provider: payment.provider,
      p_provider_refund_reference: providerRefund.providerRefundId,
      p_provider_payment_id: providerRefund.providerPaymentId,
      p_provider_order_id: providerRefund.providerOrderId,
      p_provider_amount: Number(providerRefund.amount),
      p_currency: providerRefund.currency,
      p_status: providerRefund.status === "completed" ? "Completed"
        : providerRefund.status === "failed" ? "Failed"
          : providerRefund.status === "cancelled" ? "Cancelled" : "Processing",
    });
    if (recordError || !isRecord(recorded) || typeof recorded.status !== "string") {
      return json({ error: "The provider refund was verified but its status could not be saved. Check provider status and retry reconciliation." }, 503);
    }
    return json({ status: recorded.status, providerRefundReference: providerRefund.providerRefundId,
      message: recorded.status === "Completed"
        ? "The provider confirmed the refund. The student receipt ledger has been updated."
        : `The provider reports ${String(recorded.status).toLowerCase()}. The reserved amount remains tracked.` },
    recorded.status === "Failed" || recorded.status === "Cancelled" ? 200 : 202);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof PaymentProviderError) {
      return json({ error: error.code === "credentials_unavailable"
        ? "An active test-mode provider connection and server-side Vault access are required."
        : error.code === "provider_rejected"
          ? "The provider rejected the refund request. The reservation remains pending until its status is reconciled."
          : "The provider could not be reached. The reservation remains pending; retry with the same refund reference." },
      error.code === "provider_unavailable" ? 502 : error.code === "provider_rejected" ? 422 : 503);
    }
    return json({ error: "The provider refund could not be completed or confirmed. Check refund history before retrying." }, 503);
  }
}
