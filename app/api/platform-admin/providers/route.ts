import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { parsePlatformProviderInput } from "@/lib/supabase/platform-provider-validation";

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

function errorResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The platform settings request could not be completed." }, 500);
}

export async function GET() {
  try {
    if (!testProjectOnly()) return json({ error: "Platform settings are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") {
      return json({ error: "Support administrators cannot view provider configuration." }, 403);
    }
    const supabase = await createSupabaseServerClient();
    const { data: overview, error: overviewError } = await supabase.rpc("platform_admin_overview_safe", {
      p_search: null, p_limit: 1, p_offset: 0,
    });
    if (overviewError || !overview || typeof overview !== "object" || Array.isArray(overview)) {
      return json({ error: "Platform administrator permissions could not be loaded." }, 503);
    }
    const { data, error } = await supabase
      .from("platform_provider_connections")
      .select("id, provider_scope, provider, account_reference, environment, connection_status, last_verified_at, receipt_delivery_enabled, updated_at")
      .order("provider_scope");
    if (error) return json({ error: "Central provider settings are unavailable. The test migration may not be applied." }, 503);
    return json({ connections: data ?? [], canConfigureProviders: overview.current_role === "owner" });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Platform settings are available only on the authorized test project." }, 503);
    await requirePlatformAdministrator();

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 16_384) return json({ error: "The configuration is too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
    const record = input as Record<string, unknown>;
    const parsed = parsePlatformProviderInput(record.providerScope, record.provider, record.credentials);
    if (!parsed.ok) return json({ error: parsed.error }, 400);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_platform_provider_credentials", {
      p_provider_scope: parsed.value.providerScope,
      p_provider: parsed.value.provider,
      p_account_reference: parsed.value.accountReference,
      p_credentials: parsed.value.credentials,
    });
    if (error?.code === "42501") return json({ error: "Platform owner access is required to change provider credentials." }, 403);
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return json({ error: "Secure Vault storage is unavailable. No provider was activated." }, 503);
    }
    return json({ saved: true, configuration: data }, 201);
  } catch (error) { return errorResponse(error); }
}
