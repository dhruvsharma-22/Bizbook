import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function sameOrigin(request: Request) { try { const origin = request.headers.get("origin"); return Boolean(origin) && new URL(origin!).origin === new URL(request.url).origin; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try { if (!isAuthorizedTestProjectUrl(getSupabasePublicConfig().url)) return json({ error: "Subscription checkout is currently restricted to the authorized test project." }, 503); }
  catch { return json({ error: "Subscription checkout is not configured for the authorized test project." }, 503); }
  const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > 2000) return json({ error: "The request body is too large." }, 413);
  let input: unknown; try { input = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
  if (!isRecord(input) || typeof input.instituteId !== "string" || input.instituteId.length < 1 || input.instituteId.length > 100
      || typeof input.planId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.planId)
      || input.billingCycle !== "monthly" && input.billingCycle !== "annual") return json({ error: "Choose an institute, available plan, and billing cycle." }, 400);
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: "Sign in to purchase a BizBook plan." }, 401);
  const { data, error } = await supabase.rpc("start_subscription_plan_purchase", {
    p_institute_id: input.instituteId, p_plan_id: input.planId, p_billing_cycle: input.billingCycle,
  });
  if (error) {
    if (error.code === "42501") return json({ error: "Only an institute owner or administrator can purchase a subscription." }, 403);
    if (error.code === "P0002") return json({ error: "This plan is not currently available." }, 404);
    if (error.code === "55000") return json({ error: "Complete or resolve the existing plan payment before choosing another plan." }, 409);
    if (error.code === "23514") return json({ error: "This subscription needs Company Admin review before a purchase can be created." }, 409);
    return json({ error: "The plan purchase could not be prepared. Apply the latest subscription management migration." }, 503);
  }
  return json({ result: data });
}
