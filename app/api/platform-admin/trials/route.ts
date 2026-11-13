import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
function testOnly() { try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; } }
function sameOrigin(request: Request) { try { const origin = request.headers.get("origin"); return Boolean(origin) && new URL(origin!).origin === new URL(request.url).origin; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

export async function GET() {
  try {
    if (!testOnly()) return json({ error: "Trial configuration is restricted to the authorized test project." }, 503);
    const admin = await requirePlatformAdministrator();
    if (admin.role === "support") return json({ error: "Support access cannot view trial settings." }, 403);
    const supabase = await createSupabaseServerClient();
    const [{ data, error }, { data: plans, error: plansError }] = await Promise.all([
      supabase.rpc("get_platform_subscription_trial_config"),
      supabase.from("platform_subscription_plans").select("id,name,is_available,features,student_limit,staff_limit,branch_limit").order("name"),
    ]);
    if (error || plansError) return json({ error: "Trial settings could not be loaded. Apply the latest subscription management migration." }, 503);
    return json({ config: data, plans: plans ?? [], canEdit: admin.role === "owner" });
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "Trial configuration could not be loaded." }, 500);
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testOnly()) return json({ error: "Trial configuration is restricted to the authorized test project." }, 503);
    const admin = await requirePlatformAdministrator();
    if (admin.role !== "owner") return json({ error: "Only a platform owner can change trial settings." }, 403);
    const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > 2000) return json({ error: "The request body is too large." }, 413);
    let input: unknown; try { input = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!isRecord(input) || typeof input.enabled !== "boolean" || typeof input.durationDays !== "number"
      || !Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 365
      || typeof input.forNewAccounts !== "boolean"
      || !(input.planId === null || input.planId === "" || typeof input.planId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.planId))) {
      return json({ error: "Choose a valid trial length and plan." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_platform_subscription_trial_config", {
      p_enabled: input.enabled, p_duration_days: input.durationDays, p_plan_id: typeof input.planId === "string" ? input.planId : null,
      p_for_new_accounts: input.forNewAccounts,
    });
    if (error) {
      if (error.code === "42501") return json({ error: "Only a platform owner can change trial settings." }, 403);
      if (error.code === "22023") return json({ error: "When trials are enabled, choose an available plan and a duration from 1 to 365 days." }, 400);
      return json({ error: "Trial settings could not be saved. Apply the latest subscription management migration." }, 503);
    }
    return json({ config: data });
  } catch (error) {
    if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "Trial settings could not be saved." }, 500);
  }
}
