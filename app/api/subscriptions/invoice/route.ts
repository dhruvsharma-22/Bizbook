import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 4_000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "The request body is invalid." }, 400);
  const instituteId = (input as Record<string, unknown>).instituteId;
  if (typeof instituteId !== "string" || !instituteId.trim() || instituteId.length > 100) return json({ error: "Institute selection is invalid." }, 400);

  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sign in to request a subscription invoice." }, 401);
  const { data, error } = await supabase.rpc("create_self_service_subscription_invoice", { p_institute_id: instituteId });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "23514" || error.code === "22023" ? 409 : 503;
    const message = status === 403 ? "Only an institute owner or administrator can request a plan invoice."
      : status === 409 ? "This subscription cannot create an invoice right now. Contact BizBook support if this continues."
        : status === 404 ? "The selected plan is unavailable." : "A subscription invoice could not be created.";
    return json({ error: message }, status);
  }
  return json({ result: data });
}
