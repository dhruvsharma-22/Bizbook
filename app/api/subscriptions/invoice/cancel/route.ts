import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  try { return Boolean(origin) && new URL(origin!).origin === new URL(request.url).origin; } catch { return false; }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) {
      return json({ error: "Subscription management is restricted to the authorized test project." }, 503);
    }
  } catch { return json({ error: "Subscription management is not configured for the authorized test project." }, 503); }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 1000) return json({ error: "The request is too large." }, 413);
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
  const invoiceId = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>).invoiceId : null;
  if (typeof invoiceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invoiceId)) {
    return json({ error: "The plan payment reference is invalid." }, 400);
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sign in to manage this plan payment." }, 401);
  const { data, error } = await supabase.rpc("cancel_unstarted_subscription_invoice", { p_invoice_id: invoiceId });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "55000" ? 409 : 503;
    const message = status === 403 ? "Only this institute's owner or administrator can cancel the plan request."
      : status === 404 ? "The plan payment could not be found in this workspace."
        : status === 409 ? "Checkout has already started or this invoice is no longer open. Continue or reconcile that payment before choosing another plan."
          : "The plan request could not be cancelled. Apply the latest subscription migration and retry.";
    return json({ error: message }, status);
  }
  return json({ result: data });
}
