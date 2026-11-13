import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { parsePaymentConnectionInput } from "@/lib/supabase/payment-connection-validation";
import { verifySandboxPaymentCredentials } from "@/lib/supabase/payment-provider-check";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: RESPONSE_HEADERS });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function testProjectIsConfigured(): boolean {
  try {
    return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url);
  } catch {
    return false;
  }
}

function errorResponse(error: unknown) {
  if (error instanceof SupabaseAuthorizationError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: "The request could not be completed." }, 500);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  if (!testProjectIsConfigured()) {
    return json({ error: "Provider checks are available only from the verified test project." }, 503);
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 16_384) {
    return json({ error: "The credential form is too large." }, 413);
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return json({ error: "The request body is invalid." }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json({ error: "The request body is invalid." }, 400);
  }

  const record = input as Record<string, unknown>;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  if (!instituteId || instituteId.length > 100) return json({ error: "Choose an institute." }, 400);
  const parsed = parsePaymentConnectionInput(record.provider, record.credentials);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  try {
    const access = await requireInstituteAccess(instituteId, { allowedRoles: ["owner", "administrator"] });
    const result = await verifySandboxPaymentCredentials(parsed.provider, parsed);
    if (!result.ok) {
      return json({ verified: false, code: result.code, error: result.message }, result.code === "provider_unavailable" ? 502 : 422);
    }
    const sessionClient = await createSupabaseServerClient();
    const { error: saveError } = await sessionClient.rpc("save_payment_connection_credentials", {
      p_institute_id: instituteId,
      p_provider: parsed.provider,
      p_merchant_account_reference: parsed.accountReference,
      p_credentials: parsed.credentials,
    });
    if (saveError) {
      return json({
        verified: true,
        activated: false,
        connectionStatus: "pending",
        error: "The sandbox API check passed, but the credentials could not be stored in Vault. The connection remains pending.",
      }, 503);
    }
    try {
      const adminClient = createSupabaseAdminClient();
      const { error: activationError } = await adminClient.rpc("activate_payment_connection_after_sandbox_check", {
        p_institute_id: instituteId,
        p_provider: parsed.provider,
        p_actor_user_id: access.userId,
        p_provider_order_reference: result.providerOrderId,
      });
      if (activationError) {
        return json({
          verified: true,
          activated: false,
          connectionStatus: "pending",
          error: "The sandbox API check passed and credentials were stored, but trusted server activation is unavailable. The connection remains pending.",
        }, 200);
      }
    } catch {
      return json({
        verified: true,
        activated: false,
        connectionStatus: "pending",
        error: "The sandbox API check passed and credentials were stored, but the server-only activation credential is missing. The connection remains pending.",
      }, 200);
    }
    return json({
      verified: true,
      activated: true,
      provider: parsed.provider,
      environment: "test",
      connectionStatus: "active",
      orderStatus: result.status,
      providerOrderId: result.providerOrderId,
      amount: "1.00",
      currency: result.currency,
      paymentAttempted: false,
      webhookVerified: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
