import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  try {
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) return json({ error: "The request origin could not be verified." }, 403);
  } catch { return json({ error: "The request origin could not be verified." }, 403); }
  try {
    if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) return json({ error: "Receipt delivery controls are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role !== "owner") return json({ error: "Only a platform owner can change receipt delivery." }, 403);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 2_000) return json({ error: "The request is too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
    const value = input as Record<string, unknown>;
    if ((value.providerScope !== "email" && value.providerScope !== "whatsapp") || typeof value.enabled !== "boolean") {
      return json({ error: "Choose a valid receipt channel and enabled state." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("set_platform_receipt_delivery_enabled", {
      p_provider_scope: value.providerScope,
      p_enabled: value.enabled,
    });
    if (error?.code === "42501") return json({ error: "Platform owner access is required." }, 403);
    if (error) return json({ error: error.message.includes("template") || error.message.includes("sender") || error.message.includes("Verify")
      ? error.message
      : "Receipt delivery settings could not be updated. Verify the test sender and receipt template first." }, 409);
    return json({ updated: true, configuration: data });
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "Receipt delivery settings could not be updated." }, 500);
  }
}
