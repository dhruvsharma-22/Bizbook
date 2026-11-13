import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { hashPaymentCheckoutLinkToken } from "@/lib/supabase/payment-checkout-link-token";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { paiseToRupees, rupeesToPaise } from "@/lib/supabase/online-payment-core";
import { loadActiveInstitutePaymentCredentials, PaymentProviderError, retrieveProviderCheckout } from "@/lib/supabase/online-payment-provider";
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

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Parent checkout is available only on the authorized test project." }, 503);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
  const tokenSha256 = hashPaymentCheckoutLinkToken((input as Record<string, unknown>).token);
  if (!tokenSha256) return json({ error: "This payment link is invalid or expired." }, 404);

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("resolve_payment_checkout_link", { p_token_sha256: tokenSha256 });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return json({ error: "This payment link is invalid, expired, or revoked." }, 404);
    }
    const link = data as Record<string, unknown>;
    const provider = link.provider;
    const status = link.order_status;
    const amountPaise = rupeesToPaise(link.amount as number | string);
    if ((provider !== "razorpay" && provider !== "cashfree")
        || typeof link.order_id !== "string" || typeof link.institute_id !== "string"
        || typeof link.institute_name !== "string" || !amountPaise
        || link.currency !== "INR" || typeof status !== "string") {
      return json({ error: "Payment details are unavailable. Contact the institute." }, 503);
    }
    const safeDetails = {
      instituteName: link.institute_name,
      provider,
      amount: paiseToRupees(amountPaise),
      currency: "INR",
      installmentSequence: typeof link.installment_sequence === "number" ? link.installment_sequence : null,
      dueDate: typeof link.due_date === "string" ? link.due_date : null,
      expiresAt: typeof link.expires_at === "string" ? link.expires_at : null,
      status,
    };
    if (status === "Captured") return json({ ...safeDetails, status: "Captured" });
    if (!["Pending", "Processing", "Authorized"].includes(status)
        || typeof link.provider_order_id !== "string") {
      return json({ ...safeDetails, status: "Unavailable" });
    }
    const credentials = await loadActiveInstitutePaymentCredentials(admin, link.institute_id, provider);
    const checkout = await retrieveProviderCheckout({ provider, credentials, providerOrderId: link.provider_order_id,
      localOrderId: link.order_id, amount: paiseToRupees(amountPaise)! });
    if (checkout.providerStatus === "paid") {
      return json({ ...safeDetails, status: "Pending", message: "The provider reports this order as paid. The institute is reconciling its verified payment status." }, 202);
    }
    const amountMinor = amountPaise;
    return json({
      ...safeDetails,
      checkout: {
        providerOrderId: checkout.providerOrderId,
        ...(checkout.publicKey ? { publicKey: checkout.publicKey } : {}),
        ...(checkout.checkoutSession ? { sessionId: checkout.checkoutSession } : {}),
        amountMinor,
      },
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return json({ error: error.code === "credentials_unavailable"
        ? "The test provider connection is unavailable. Contact the institute."
        : "The provider checkout could not be loaded. No payment was attempted." },
      error.code === "provider_unavailable" ? 502 : 503);
    }
    return json({ error: "Payment details are unavailable. Contact the institute." }, 503);
  }
}
