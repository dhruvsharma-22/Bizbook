import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { paiseToRupees, rupeesToPaise } from "@/lib/supabase/online-payment-core";
import {
  createProviderOrder,
  recoverRazorpayOrder,
  loadActiveInstitutePaymentCredentials,
  PaymentProviderError,
  retrieveProviderCheckout,
} from "@/lib/supabase/online-payment-provider";

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

function text(value: unknown, max = 128): string {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function providerFailureStatus(error: unknown): number {
  if (error instanceof SupabaseAuthorizationError) return error.status;
  if (error instanceof PaymentProviderError) {
    return error.code === "provider_unavailable" ? 502 : 503;
  }
  return 503;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Online orders are enabled only on the verified test project." }, 503);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 12_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!record(input)) return json({ error: "The request body is invalid." }, 400);

  const instituteId = text(input.instituteId, 100);
  const requestedBranchId = input.branchId === null || input.branchId === "" ? null : text(input.branchId, 100);
  const studentId = text(input.studentId, 100);
  const provider = input.provider === "razorpay" || input.provider === "cashfree" ? input.provider : null;
  const receiptKind = input.receiptKind === "Fee" || input.receiptKind === "Advance" ? input.receiptKind : null;
  const amountPaise = rupeesToPaise(input.amount);
  const installmentId = input.installmentId === null || input.installmentId === "" ? null : text(input.installmentId, 100);
  const allocationPaise = input.allocationAmount === undefined
    ? receiptKind === "Fee" ? amountPaise : installmentId ? null : 0
    : input.allocationAmount === 0 || input.allocationAmount === "0" ? 0 : rupeesToPaise(input.allocationAmount);
  const idempotencyKey = text(input.idempotencyKey, 128);
  if (!instituteId || !studentId || !provider || !receiptKind || !amountPaise
      || (input.branchId !== undefined && input.branchId !== null && input.branchId !== "" && !requestedBranchId)
      || (input.installmentId !== undefined && input.installmentId !== null && input.installmentId !== "" && !installmentId)
      || allocationPaise === null || !idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
    return json({ error: "Payment order fields are invalid." }, 400);
  }
  if ((receiptKind === "Fee" && (!installmentId || allocationPaise !== amountPaise))
      || (receiptKind === "Advance" && (allocationPaise > amountPaise || (installmentId && allocationPaise <= 0) || (!installmentId && allocationPaise !== 0)))) {
    return json({ error: "Fee orders must target an installment; advance allocation must be explicit and within the receipt amount." }, 400);
  }

  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: student, error: studentError } = await sessionClient
      .from("students")
      .select("id, name, parent_name, parent_email, parent_mobile, branch_id")
      .eq("id", studentId)
      .eq("institute_id", instituteId)
      .is("archived_at", null)
      .maybeSingle();
    if (studentError || !student) return json({ error: "The active student could not be found in this workspace." }, 404);
    if (requestedBranchId !== null && requestedBranchId !== student.branch_id) {
      return json({ error: "The selected branch does not match the student's assigned branch." }, 403);
    }
    const branchId = student.branch_id;
    await requireInstituteAccess(instituteId, {
      allowedRoles: ["owner", "administrator", "accountant"],
      ...(branchId ? { branchId } : {}),
    });

    let customer: { id: string; name: string; email: string; phone: string } | undefined;
    if (provider === "cashfree") {
      const phone = (student.parent_mobile ?? "").replace(/[\s()-]/g, "");
      const email = (student.parent_email ?? "").trim();
      if (!email || !/^\+?[1-9]\d{7,14}$/.test(phone)) {
        return json({ error: "Cashfree requires a valid parent email and phone on the student record." }, 422);
      }
      customer = { id: student.id, name: (student.parent_name || student.name).slice(0, 100), email, phone };
    }

    // Resolve Vault credentials before making a database intent or provider request.
    const adminClient = createSupabaseAdminClient();
    const credentials = await loadActiveInstitutePaymentCredentials(adminClient, instituteId, provider);
    const { data: intent, error: intentError } = await sessionClient.rpc("create_online_payment_order_intent", {
      p_institute_id: instituteId,
      p_branch_id: branchId,
      p_student_id: student.id,
      p_provider: provider,
      p_receipt_kind: receiptKind,
      p_amount: Number(paiseToRupees(amountPaise)),
      p_installment_id: installmentId,
      p_allocation_amount: Number(paiseToRupees(allocationPaise)),
      p_idempotency_key: idempotencyKey,
    });
    if (intentError || !record(intent) || typeof intent.order_id !== "string") {
      return json({ error: intentError?.code === "23514" ? "The installment no longer has enough unreserved balance." : "The payment order could not be reserved." }, intentError?.code === "23514" ? 409 : 503);
    }
    const localOrderId = intent.order_id;
    if (intent.order_status === "Captured" || intent.order_status === "Failed" || intent.order_status === "Cancelled") {
      return json({ orderId: localOrderId, provider, status: intent.order_status }, 200);
    }

    let checkout;
    if (intent.created === false) {
      if (typeof intent.provider_order_id === "string") {
        checkout = await retrieveProviderCheckout({ provider, credentials, providerOrderId: intent.provider_order_id,
          localOrderId, amount: paiseToRupees(amountPaise)! });
      } else if (provider === "cashfree") {
        // Cashfree uses the local intent ID as its provider order ID, so an
        // uncertain response can be recovered without creating another order.
        checkout = await retrieveProviderCheckout({ provider, credentials, providerOrderId: localOrderId });
        const { error: bindError } = await adminClient.rpc("bind_online_provider_order", {
          p_order_id: localOrderId,
          p_provider_order_id: checkout.providerOrderId,
        });
        if (bindError) return json({ error: "The existing provider order was found, but its reference could not be saved. Retry or reconcile this order before creating another." }, 503);
      } else {
        // Razorpay order creation is not idempotent. Recover a timed-out create
        // with its unique receipt and never issue a second POST for this intent.
        checkout = await recoverRazorpayOrder({ credentials, localOrderId, amount: paiseToRupees(amountPaise)! });
        if (!checkout) return json({ orderId: localOrderId, status: "Processing",
          error: "No Razorpay order is visible for this request yet. Retry status recovery later; a second order was not created." }, 409);
        const { error: bindError } = await adminClient.rpc("bind_online_provider_order", {
          p_order_id: localOrderId, p_provider_order_id: checkout.providerOrderId,
        });
        if (bindError) return json({ error: "The existing Razorpay order was found, but its reference could not be saved. Retry recovery before creating another order." }, 503);
      }
    } else {
      try {
        checkout = await createProviderOrder({
          provider, credentials, localOrderId, amount: paiseToRupees(amountPaise)!, customer,
        });
      } catch (error) {
        // Keep the reservation after every unsuccessful response. Even an
        // apparent rejection may follow a provider-side timeout or duplicate
        // receipt; only a later provider reconciliation may release it.
        throw error;
      }
      const { error: bindError } = await adminClient.rpc("bind_online_provider_order", {
        p_order_id: localOrderId, p_provider_order_id: checkout.providerOrderId,
      });
      if (bindError) return json({ error: "The provider order was created, but its reference could not be saved. Retry or reconcile this order before creating another." }, 503);
    }

    if (checkout.providerStatus === "paid") {
      return json({ orderId: localOrderId, provider, status: "Pending", retryStatusCheck: true,
        message: "The existing Razorpay order is marked paid. Check provider status before opening checkout again." }, 202);
    }

    return json({
      orderId: localOrderId,
      provider,
      providerOrderId: checkout.providerOrderId,
      status: "Pending",
      amount: paiseToRupees(amountPaise),
      currency: "INR",
      checkout: {
        ...(checkout.publicKey ? { publicKey: checkout.publicKey } : {}),
        ...(checkout.checkoutSession ? { sessionId: checkout.checkoutSession } : {}),
      },
    }, 201);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof PaymentProviderError) {
      const message = error.code === "credentials_unavailable"
        ? "A verified test provider connection and server-side Vault access are required."
        : error.code === "provider_unavailable"
          ? "The payment provider could not be reached. No payment was recorded."
          : "The payment provider rejected the order request. No payment was recorded.";
      return json({ error: message, code: error.code }, providerFailureStatus(error));
    }
    return json({ error: "The online payment order could not be completed." }, 503);
  }
}
