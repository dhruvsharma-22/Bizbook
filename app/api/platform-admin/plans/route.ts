import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function testOnly() { try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; } }
function sameOrigin(request: Request) { const origin = request.headers.get("origin"); try { return Boolean(origin) && new URL(origin!).origin === new URL(request.url).origin; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function price(value: unknown): number | undefined { const text = typeof value === "number" ? String(value) : value; if (typeof text !== "string" || !/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) return undefined; const n = Number(text); return Number.isFinite(n) ? n : undefined; }
function nullablePrice(value: unknown): number | null | undefined { return value === null || value === "" ? null : price(value); }
function nullableLimit(value: unknown): number | null | undefined { if (value === null || value === "") return null; return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000 ? value : undefined; }
function date(value: unknown): string | null | undefined { if (value === null || value === "") return null; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined; const d = new Date(`${value}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : undefined; }
function mapError(error: unknown) { if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status); return json({ error: "Company plan management could not be completed." }, 500); }

export async function GET() {
  try {
    if (!testOnly()) return json({ error: "Company plan management is restricted to the authorized test project." }, 503);
    const admin = await requirePlatformAdministrator();
    if (admin.role === "support") return json({ error: "Support access cannot view subscription plans." }, 403);
    const supabase = await createSupabaseServerClient();
    const [plans, subscriptions] = await Promise.all([
      supabase.from("platform_subscription_plans").select("id,name,description,monthly_price,annual_price,monthly_compare_at_price,annual_compare_at_price,available_from,available_until,monthly_duration_days,annual_duration_days,student_limit,staff_limit,branch_limit,features,is_recommended,is_available").order("created_at", { ascending: true }),
      supabase.from("institute_subscriptions").select("plan_id,pending_plan_id,status"),
    ]);
    if (plans.error || subscriptions.error) return json({ error: "Plan and subscription records could not be loaded. Apply the latest subscription management migration." }, 503);
    const counts: Record<string, { active: number; trialing: number; total: number }> = {};
    for (const plan of plans.data ?? []) counts[plan.id] = { active: 0, trialing: 0, total: 0 };
    for (const subscription of subscriptions.data ?? []) {
      const current = subscription.plan_id ? counts[subscription.plan_id] : undefined;
      if (current) { current.total += 1; if (subscription.status === "active") current.active += 1; if (subscription.status === "trialing") current.trialing += 1; }
      if (subscription.pending_plan_id && subscription.pending_plan_id !== subscription.plan_id && counts[subscription.pending_plan_id]) counts[subscription.pending_plan_id].total += 1;
    }
    return json({ plans: plans.data ?? [], subscriptionsByPlan: counts, canEdit: admin.role === "owner" });
  } catch (error) { return mapError(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testOnly()) return json({ error: "Company plan management is restricted to the authorized test project." }, 503);
    const admin = await requirePlatformAdministrator();
    if (admin.role !== "owner") return json({ error: "Only a platform owner can change subscription plans." }, 403);
    const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > 12_000) return json({ error: "The request body is too large." }, 413);
    let input: unknown; try { input = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!isRecord(input)) return json({ error: "The request body is invalid." }, 400);
    const id = input.planId === null || input.planId === "" ? null : typeof input.planId === "string" ? input.planId : undefined;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const description = typeof input.description === "string" ? input.description.trim() : "";
    const monthly = price(input.monthlyPrice), annual = price(input.annualPrice);
    const monthlyCompare = nullablePrice(input.monthlyCompareAtPrice), annualCompare = nullablePrice(input.annualCompareAtPrice);
    const starts = date(input.availableFrom), ends = date(input.availableUntil);
    const monthlyDays = input.monthlyDurationDays, annualDays = input.annualDurationDays;
    const students = nullableLimit(input.studentLimit), staff = nullableLimit(input.staffLimit), branches = nullableLimit(input.branchLimit);
    const features = Array.isArray(input.features) ? input.features.map((v) => typeof v === "string" ? v.trim() : "") : null;
    if (id === undefined || (id && !uuid.test(id)) || name.length < 2 || name.length > 80 || description.length > 500
      || monthly === undefined || monthly <= 0 || annual === undefined || annual <= 0
      || monthlyCompare === undefined || annualCompare === undefined
      || monthlyCompare !== null && monthlyCompare < monthly || annualCompare !== null && annualCompare < annual
      || starts === undefined || ends === undefined || starts && ends && ends < starts
      || !Number.isInteger(monthlyDays) || (monthlyDays as number) < 1 || (monthlyDays as number) > 3660
      || !Number.isInteger(annualDays) || (annualDays as number) < 1 || (annualDays as number) > 3660
      || students === undefined || staff === undefined || branches === undefined
      || features === null || features.length > 20 || features.some((v) => v.length < 1 || v.length > 120)
      || typeof input.isRecommended !== "boolean" || typeof input.isAvailable !== "boolean") {
      return json({ error: "Enter valid plan details, positive prices, service days, limits, and up to 20 features." }, 400);
    }
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("save_platform_subscription_plan_details", {
      p_plan_id: id, p_name: name, p_description: description, p_monthly_price: monthly, p_annual_price: annual,
      p_monthly_compare_at_price: monthlyCompare, p_annual_compare_at_price: annualCompare,
      p_available_from: starts, p_available_until: ends, p_monthly_duration_days: monthlyDays as number,
      p_annual_duration_days: annualDays as number, p_student_limit: students, p_staff_limit: staff, p_branch_limit: branches,
      p_features: features, p_is_recommended: input.isRecommended, p_is_available: input.isAvailable,
    });
    if (error) {
      if (error.code === "42501") return json({ error: "Only a platform owner can change subscription plans." }, 403);
      if (error.code === "23505") return json({ error: "A plan with this name already exists." }, 409);
      if (error.code === "22023") return json({ error: "Plan details or features are invalid." }, 400);
      return json({ error: "The plan could not be saved. Apply the latest subscription management migration." }, 503);
    }
    return json({ planId: data });
  } catch (error) { return mapError(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testOnly()) return json({ error: "Company plan management is restricted to the authorized test project." }, 503);
    const admin = await requirePlatformAdministrator(); if (admin.role !== "owner") return json({ error: "Only a platform owner can delete plans." }, 403);
    const raw = await request.text(); if (new TextEncoder().encode(raw).byteLength > 1000) return json({ error: "The request body is too large." }, 413);
    let input: unknown; try { input = JSON.parse(raw); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!isRecord(input) || typeof input.planId !== "string" || !uuid.test(input.planId)) return json({ error: "Plan ID is invalid." }, 400);
    const supabase = await createSupabaseServerClient(); const { error } = await supabase.rpc("delete_platform_subscription_plan", { p_plan_id: input.planId });
    if (error?.code === "23503") return json({ error: "This plan has subscription or trial history. Turn it off instead of deleting it." }, 409);
    if (error?.code === "42501") return json({ error: "Only a platform owner can delete plans." }, 403);
    if (error) return json({ error: "The plan could not be deleted." }, 503);
    return json({ deleted: true });
  } catch (error) { return mapError(error); }
}
