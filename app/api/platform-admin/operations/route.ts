import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 && result.length <= max ? result : null;
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === "") return null;
  return text(value, max) ?? undefined;
}

function isoDate(value: unknown, optional = false): string | null | undefined {
  if (optional && (value === null || value === "")) return null;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function errorResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The platform operation could not be completed." }, 500);
}

function rpcError(error: { code?: string } | null) {
  if (error?.code === "42501") return 403;
  if (error?.code === "P0002") return 404;
  if (error?.code === "23505") return 409;
  if (error?.code === "23514") return 409;
  if (error?.code === "22023") return 400;
  return 503;
}

export async function GET(request: Request) {
  try {
    if (!testProjectOnly()) return json({ error: "Platform operations are available only on the authorized test project." }, 503);
    const administrator = await requirePlatformAdministrator();
    if (administrator.role === "support") {
      return json({ error: "Support administrators cannot view platform institute or billing records." }, 403);
    }
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100) || null;
    const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
    const offset = Number.isSafeInteger(offsetRaw) && offsetRaw >= 0 ? Math.min(offsetRaw, 50_000) : 0;
    const supabase = await createSupabaseServerClient();
    const startedAt = performance.now();
    const { data, error } = await supabase.rpc("platform_admin_overview_safe", {
      p_search: search,
      p_limit: 100,
      p_offset: offset,
    });
    if (error) return json({ error: "Platform directory and billing data could not be loaded." }, rpcError(error));
    const overview = data && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null;
    const instituteRows = overview && Array.isArray(overview.institutes) ? overview.institutes : null;
    if (!overview || !instituteRows) return json({ error: "Platform directory data is incomplete." }, 503);
    const instituteIds = instituteRows.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string"
      ? [(item as Record<string, unknown>).id as string] : []);
    let accessByInstitute = new Map<string, boolean>();
    let complimentaryAccessAvailable = true;
    if (instituteIds.length) {
      const { data: subscriptions, error: subscriptionsError } = await supabase
        .from("institute_subscriptions")
        .select("institute_id, free_access_enabled")
        .in("institute_id", instituteIds);
      if (subscriptionsError) {
        const missingAccessColumn = subscriptionsError.code === "42703" || subscriptionsError.code === "PGRST204";
        if (!missingAccessColumn) return json({ error: "Complimentary access status could not be loaded." }, rpcError(subscriptionsError));
        complimentaryAccessAvailable = false;
      } else {
        accessByInstitute = new Map((subscriptions ?? []).map((item) => [item.institute_id, item.free_access_enabled]));
      }
    }
    const enrichedOverview = {
      ...overview,
      institutes: instituteRows.map((item) => item && typeof item === "object" && !Array.isArray(item)
        ? { ...(item as Record<string, unknown>), free_access_enabled: accessByInstitute.get(String((item as Record<string, unknown>).id)) ?? false }
        : item),
    };
    return json({
      overview: enrichedOverview,
      capabilities: { complimentaryAccess: complimentaryAccessAvailable },
      diagnostics: {
        database: "available",
        projectGuard: "verified_test_project",
        serviceRoleKeyPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
        overviewRpcLatencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Platform operations are available only on the authorized test project." }, 503);
    await requirePlatformAdministrator();
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 16_384) return json({ error: "The request body is too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: "The request body is invalid." }, 400); }
    if (!isRecord(input)) return json({ error: "The request body is invalid." }, 400);
    const supabase = await createSupabaseServerClient();

    if (input.action === "set_free_access") {
      const instituteId = text(input.instituteId, 100);
      const reason = text(input.reason, 1000);
      if (!instituteId || typeof input.enabled !== "boolean" || !reason) {
        return json({ error: "Institute, free access selection, and confirmation reason are required." }, 400);
      }
      const { data, error } = await supabase.rpc("set_platform_institute_free_access", {
        p_institute_id: instituteId,
        p_enabled: input.enabled,
        p_reason: reason,
      });
      if (error) return json({ error: "Complimentary access could not be changed." }, rpcError(error));
      return json({ result: { subscriptionId: data, freeAccessEnabled: input.enabled } });
    }

    if (input.action === "set_institute_status") {
      const instituteId = text(input.instituteId, 100);
      const status = input.status === "active" || input.status === "suspended" ? input.status : null;
      const reason = nullableText(input.reason, 1000);
      if (!instituteId || !status || reason === undefined) return json({ error: "Institute status fields are invalid." }, 400);
      const { data, error } = await supabase.rpc("set_platform_institute_status", {
        p_institute_id: instituteId, p_status: status, p_reason: reason,
      });
      if (error) return json({ error: "Institute status could not be changed." }, rpcError(error));
      return json({ result: data });
    }

    if (input.action === "assign_subscription") {
      const instituteId = text(input.instituteId, 100);
      const planId = input.planId === null || input.planId === "" ? null : text(input.planId, 64);
      const statusValues = ["trialing", "active", "past_due", "suspended", "cancelled", "expired"] as const;
      const billingValues = ["monthly", "annual"] as const;
      const status = statusValues.find((item) => item === input.status);
      const billingCycle = billingValues.find((item) => item === input.billingCycle);
      const trialEndsAt = isoDate(input.trialEndsAt, true);
      const periodStart = isoDate(input.periodStart, true);
      const periodEnd = isoDate(input.periodEnd, true);
      const graceEndsAt = isoDate(input.gracePeriodEndsAt, true);
      const reason = text(input.reason, 1000);
      if (!instituteId || (input.planId !== null && input.planId !== "" && !planId) || !status || !billingCycle
          || trialEndsAt === undefined || periodStart === undefined || periodEnd === undefined || graceEndsAt === undefined || !reason) {
        return json({ error: "Subscription fields and a reason for this manual change are required." }, 400);
      }
      const { data, error } = await supabase.rpc("assign_platform_subscription_with_reason", {
        p_institute_id: instituteId, p_plan_id: planId, p_status: status, p_billing_cycle: billingCycle,
        p_trial_ends_at: trialEndsAt, p_period_start: periodStart,
        p_period_end: periodEnd, p_grace_period_ends_at: graceEndsAt, p_reason: reason,
      });
      if (error) return json({ error: "Subscription assignment could not be saved." }, rpcError(error));
      return json({ result: { subscriptionId: data } });
    }

    if (input.action === "issue_invoice") {
      const instituteId = text(input.instituteId, 100);
      const invoiceNumber = text(input.invoiceNumber, 64);
      const periodStart = isoDate(input.periodStart);
      const periodEnd = isoDate(input.periodEnd);
      const dueAt = isoDate(input.dueAt, true);
      if (!instituteId || !invoiceNumber || !periodStart || !periodEnd || dueAt === undefined) {
        return json({ error: "Invoice fields are invalid." }, 400);
      }
      const { data, error } = await supabase.rpc("issue_platform_subscription_invoice", {
        p_institute_id: instituteId, p_invoice_number: invoiceNumber,
        p_period_start: periodStart, p_period_end: periodEnd, p_due_at: dueAt,
      });
      if (error) return json({ error: "Subscription invoice could not be issued." }, rpcError(error));
      return json({ result: data });
    }

    if (input.action === "set_admin_role") {
      const userId = text(input.userId, 64);
      const role = input.role === "owner" || input.role === "operator" || input.role === "support" ? input.role : null;
      if (!userId || !role) return json({ error: "Platform administrator role fields are invalid." }, 400);
      const { error } = await supabase.rpc("set_platform_admin_role", { p_user_id: userId, p_role: role });
      if (error) return json({ error: "Platform administrator role could not be changed." }, rpcError(error));
      return json({ saved: true });
    }

    if (input.action === "remove_admin") {
      const userId = text(input.userId, 64);
      if (!userId) return json({ error: "Platform administrator ID is invalid." }, 400);
      const { error } = await supabase.rpc("remove_platform_admin", { p_user_id: userId });
      if (error) return json({ error: "Platform administrator could not be removed." }, rpcError(error));
      return json({ saved: true });
    }

    return json({ error: "This platform operation is not supported." }, 400);
  } catch (error) { return errorResponse(error); }
}
