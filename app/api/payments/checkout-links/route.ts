import { NextResponse } from "next/server";
import { SupabaseAuthorizationError, requireInstituteAccess } from "@/lib/supabase/authorization";
import { createPaymentCheckoutLinkToken } from "@/lib/supabase/payment-checkout-link-token";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function testProjectOnly(): boolean {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

async function parseOrderId(request: Request): Promise<string | null> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_000) return null;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const orderId = (value as Record<string, unknown>).orderId;
  return typeof orderId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(orderId) ? orderId : null;
}

async function authorizeOrder(orderId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: order, error } = await supabase.from("payment_orders")
    .select("id, institute_id, branch_id")
    .eq("id", orderId).maybeSingle();
  if (error || !order) return { error: json({ error: "The payment order is unavailable in this workspace." }, 404) };
  await requireInstituteAccess(order.institute_id, {
    allowedRoles: ["owner", "administrator", "accountant"],
    ...(order.branch_id ? { branchId: order.branch_id } : {}),
  });
  return { supabase, order };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Parent checkout links are available only on the authorized test project." }, 503);
  try {
    const orderId = await parseOrderId(request);
    if (!orderId) return json({ error: "A valid payment order is required." }, 400);
    const access = await authorizeOrder(orderId);
    if (access.error) return access.error;
    const { token, tokenSha256 } = createPaymentCheckoutLinkToken();
    const { data, error } = await access.supabase.rpc("create_payment_checkout_link", {
      p_order_id: orderId,
      p_token_sha256: tokenSha256,
    });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return json({ error: error?.code === "23514"
        ? "Only an active sandbox installment order can be shared."
        : "The secure parent checkout link could not be created." }, error?.code === "42501" ? 403 : 409);
    }
    const expiresAt = (data as Record<string, unknown>).expires_at;
    if (typeof expiresAt !== "string") return json({ error: "The checkout link expiry could not be confirmed." }, 503);
    return json({ token, expiresAt, fragmentPath: `/pay#${token}` }, 201);
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "The secure parent checkout link could not be created." }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectOnly()) return json({ error: "Parent checkout links are available only on the authorized test project." }, 503);
  try {
    const orderId = await parseOrderId(request);
    if (!orderId) return json({ error: "A valid payment order is required." }, 400);
    const access = await authorizeOrder(orderId);
    if (access.error) return access.error;
    const { data, error } = await access.supabase.rpc("revoke_payment_checkout_link", { p_order_id: orderId });
    if (error || typeof data !== "number") {
      return json({ error: "The parent checkout link could not be revoked." }, error?.code === "42501" ? 403 : 503);
    }
    return json({ revoked: data > 0 });
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "The parent checkout link could not be revoked." }, 503);
  }
}
