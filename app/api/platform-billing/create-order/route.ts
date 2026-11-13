import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { createProviderOrder, PaymentProviderError, recoverRazorpayOrder, retrieveProviderCheckout } from "@/lib/supabase/online-payment-provider";
import { loadSandboxCheckedPlatformPaymentCredentials } from "@/lib/supabase/platform-subscription-provider";
import type { PaymentProvider } from "@/lib/supabase/payment-connection-validation";
import { paiseToRupees, rupeesToPaise } from "@/lib/supabase/online-payment-core";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function safeProviderStatus(error: unknown): number {
  return error instanceof PaymentProviderError && error.code === "provider_unavailable" ? 502 : 503;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) {
      return json({ error: "Subscription checkout is enabled only for the authorized test project." }, 503);
    }
  } catch {
    return json({ error: "Subscription checkout is not configured for the authorized test project." }, 503);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!record(input)) return json({ error: "The request body is invalid." }, 400);
  const invoiceId = typeof input.invoiceId === "string" ? input.invoiceId.trim() : "";
  const provider: PaymentProvider | null = input.provider === "razorpay" || input.provider === "cashfree" ? input.provider : null;
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const resumeAttemptId = typeof input.attemptId === "string" ? input.attemptId.trim() : "";
  const resuming = Boolean(resumeAttemptId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)
      || !provider
      || (resuming && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resumeAttemptId))
      || (!resuming && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))) {
    return json({ error: "Plan payment, provider, or retry key is invalid." }, 400);
  }

  try {
    const session = await createSupabaseServerClient();
    const { data: invoice, error: invoiceError } = await session
      .from("platform_subscription_invoices")
      .select("id, institute_id, subscription_id, invoice_number, amount, currency, status")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceError || !invoice) return json({ error: "This plan payment is not available in the current workspace." }, 404);

    const access = await requireInstituteAccess(invoice.institute_id, { allowedRoles: ["owner", "administrator"] });
    if (access.accessScope !== "institute") return json({ error: "Institute-wide owner or administrator access is required for platform billing." }, 403);
    if (invoice.status === "paid") return json({ status: "paid", invoiceId, invoiceNumber: invoice.invoice_number, alreadyPaid: true });
    const amountPaise = rupeesToPaise(invoice.amount);
    if (!invoice.subscription_id || !["open", "past_due"].includes(invoice.status)
        || invoice.currency !== "INR" || amountPaise === null) {
      return json({ error: "This plan payment is not eligible for secure checkout." }, 409);
    }

    let admin;
    try { admin = createSupabaseAdminClient(); }
    catch { return json({ error: "Server-side test-project credentials are required for subscription checkout." }, 503); }
    const credentials = await loadSandboxCheckedPlatformPaymentCredentials(admin, provider);
    let customer: { id: string; name: string; email: string; phone: string } | undefined;
    if (provider === "cashfree") {
      const { data: institute, error: instituteError } = await session
        .from("coaching_institutes")
        .select("business_name, owner_name, email, phone")
        .eq("id", invoice.institute_id)
        .maybeSingle();
      const phone = (institute?.phone ?? "").replace(/[\s()-]/g, "");
      const email = (institute?.email ?? "").trim();
      if (instituteError || !institute || !email.includes("@") || !/^\+?[1-9]\d{7,14}$/.test(phone)) {
        return json({ error: "Cashfree sandbox checkout requires a valid institute billing email and phone. Add them to the institute profile first." }, 422);
      }
      customer = { id: `bizbook-${invoice.institute_id}`.slice(0, 50),
        name: (institute.owner_name || institute.business_name).slice(0, 100), email, phone };
    }

    let attemptValue: unknown;
    let attemptError: { code?: string } | null = null;
    if (resuming) {
      const { data: existing, error } = await session.from("platform_payment_attempts")
        .select("id, invoice_id, institute_id, provider, provider_order_id, status, attempt_number")
        .eq("id", resumeAttemptId)
        .eq("invoice_id", invoice.id)
        .maybeSingle();
      attemptError = error;
      if (error || !existing) return json({ error: "This payment attempt is not available for the selected plan." }, 404);
      if (existing.provider !== provider) return json({ error: "The selected provider does not match the saved payment attempt." }, 409);
      attemptValue = { attempt_id: existing.id, invoice_id: existing.invoice_id, provider: existing.provider,
        provider_order_id: existing.provider_order_id, status: existing.status, attempt_number: existing.attempt_number, created: false };
    } else {
      const result = await admin.rpc("start_platform_subscription_payment_attempt", {
        p_invoice_id: invoice.id,
        p_provider: provider,
        p_idempotency_key: idempotencyKey,
        p_actor_user_id: access.userId,
      });
      attemptValue = result.data;
      attemptError = result.error;
    }
    if (attemptError || !record(attemptValue) || typeof attemptValue.attempt_id !== "string") {
      if (attemptError?.code === "42501") return json({ error: "Institute-wide billing access is not allowed." }, 403);
      if (attemptError?.code === "55000") return json({ error: "An existing payment attempt is unresolved. Contact BizBook support before creating another order." }, 409);
      if (attemptError?.code === "23514" || attemptError?.code === "23505") return json({ error: "The payment or retry key conflicts with the current plan state." }, 409);
      return json({ error: "The plan payment attempt could not be reserved." }, 503);
    }
    const attempt = attemptValue as Record<string, unknown>;
    const attemptId = attempt.attempt_id as string;
    const attemptStatus = typeof attempt.status === "string" ? attempt.status : "created";
    if (attemptStatus === "paid") return json({ status: "paid", invoiceId, attemptId, alreadyPaid: true });
    if (attemptStatus === "reconciliation_required") {
      return json({ status: attemptStatus, error: "This plan has a payment that needs manual reconciliation." }, 409);
    }
    if (attemptStatus === "authorized") {
      return json({ status: attemptStatus, error: "The provider has authorized this payment. Wait for its capture result or contact BizBook support; do not retry checkout." }, 202);
    }
    if (["failed", "cancelled", "refunded"].includes(attemptStatus)) {
      return json({ status: attemptStatus, error: "This payment attempt is terminal. Start a new attempt after reviewing its history." }, 409);
    }

    const localOrderId = `ps${attemptId.replaceAll("-", "")}`;
    let checkout;
    if (typeof attempt.provider_order_id === "string" && attempt.provider_order_id.length > 0) {
      checkout = await retrieveProviderCheckout({ provider, credentials, providerOrderId: attempt.provider_order_id,
        localOrderId, amount: paiseToRupees(amountPaise)! });
    } else if (attempt.created !== true) {
      if (provider === "cashfree") {
        // Cashfree order IDs are deterministic; a timed-out creation can be read back safely.
        checkout = await retrieveProviderCheckout({ provider, credentials, providerOrderId: localOrderId,
          localOrderId, amount: paiseToRupees(amountPaise)! });
      } else {
        // Razorpay creation is not idempotent. Look up the same unique receipt;
        // never send a second create request after an uncertain response.
        checkout = await recoverRazorpayOrder({ credentials, localOrderId, amount: paiseToRupees(amountPaise)! });
        if (!checkout) return json({ status: "unresolved", attemptId,
          error: "No Razorpay order is visible for this attempt yet. Retry recovery later; a second order was not created." }, 409);
      }
      const { error: bindError } = await admin.rpc("bind_platform_subscription_provider_order", {
        p_attempt_id: attemptId,
        p_provider_order_id: checkout.providerOrderId,
      });
      if (bindError) return json({ error: "The existing provider order was found but could not be bound. Reconcile before retrying." }, 503);
    } else {
      checkout = await createProviderOrder({
        provider, credentials, localOrderId, amount: paiseToRupees(amountPaise)!, customer,
      });
      const { error: bindError } = await admin.rpc("bind_platform_subscription_provider_order", {
        p_attempt_id: attemptId,
        p_provider_order_id: checkout.providerOrderId,
      });
      if (bindError) return json({ error: "The provider order was created but its reference could not be saved. Do not pay again; contact BizBook support first." }, 503);
    }

    if (checkout.providerStatus === "paid") {
      return json({ status: "pending", invoiceId, invoiceNumber: invoice.invoice_number, attemptId,
        provider, providerOrderId: checkout.providerOrderId, requiresStatusCheck: true,
        message: "The existing Razorpay order is marked paid. Check provider status before opening checkout again." }, 202);
    }

    return json({
      status: "pending", invoiceId, invoiceNumber: invoice.invoice_number, attemptId,
      provider, providerOrderId: checkout.providerOrderId,
      amount: paiseToRupees(amountPaise), currency: "INR",
      checkout: { ...(checkout.publicKey ? { publicKey: checkout.publicKey } : {}),
        ...(checkout.checkoutSession ? { sessionId: checkout.checkoutSession } : {}) },
    }, attempt.created === true ? 201 : 200);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    if (error instanceof PaymentProviderError) {
      const message = error.code === "credentials_unavailable"
        ? "A sandbox-checked central test provider and server-side Vault access are required."
        : error.code === "provider_unavailable"
          ? "The sandbox provider could not be reached. No payment was recorded."
          : "The sandbox provider rejected the order. No payment was recorded.";
      return json({ error: message, code: error.code }, safeProviderStatus(error));
    }
    return json({ error: "Subscription checkout could not be started. Your plan was not activated." }, 503);
  }
}
