import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { parsePaymentConnectionInput } from "@/lib/supabase/payment-connection-validation";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: RESPONSE_HEADERS });
}

function isTestProjectConfigured(): boolean {
  try {
    const { url } = getSupabasePublicConfig();
    return isAuthorizedTestProjectUrl(url);
  } catch {
    return false;
  }
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

function errorResponse(error: unknown) {
  if (error instanceof SupabaseAuthorizationError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: "The request could not be completed." }, 500);
}

export async function GET(request: Request) {
  if (!isTestProjectConfigured()) {
    return json({ error: "Payment configuration is available only on the verified test project." }, 503);
  }

  const instituteId = new URL(request.url).searchParams.get("instituteId")?.trim();
  if (!instituteId || instituteId.length > 100) {
    return json({ error: "Choose an institute." }, 400);
  }

  try {
    await requireInstituteAccess(instituteId, { allowedRoles: ["owner", "administrator"] });
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("payment_connections")
      .select("id, provider, merchant_account_reference, environment, connection_status, updated_at")
      .eq("institute_id", instituteId)
      .order("provider");

    if (error) return json({ error: "Could not load payment connection status." }, 503);
    return json({ connections: data ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return json({ error: "The request origin could not be verified." }, 403);
  }
  if (!isTestProjectConfigured()) {
    return json({ error: "Payment configuration is available only on the verified test project." }, 503);
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
  if (!instituteId || instituteId.length > 100) {
    return json({ error: "Choose an institute." }, 400);
  }
  const parsed = parsePaymentConnectionInput(record.provider, record.credentials);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  try {
    await requireInstituteAccess(instituteId, { allowedRoles: ["owner", "administrator"] });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("save_payment_connection_credentials", {
      p_institute_id: instituteId,
      p_provider: parsed.provider,
      p_merchant_account_reference: parsed.accountReference,
      p_credentials: parsed.credentials,
    });

    if (error) {
      // Keep provider credentials out of logs and responses. The SQL function
      // independently verifies the authenticated owner/administrator role.
      return json({ error: "Secure credential storage is unavailable. Confirm the test database migration is applied." }, 503);
    }

    return json({
      provider: parsed.provider,
      environment: "test",
      connectionStatus: "pending",
      secretSaved: true,
      verified: false,
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
