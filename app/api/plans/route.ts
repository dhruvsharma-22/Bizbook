import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasCurrentPlanShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.monthly_price === "number"
    && typeof value.annual_price === "number"
    && typeof value.monthly_duration_days === "number"
    && typeof value.annual_duration_days === "number"
    && typeof value.can_purchase === "boolean"
    && (value.availability_status === "upcoming" || value.availability_status === "available" || value.availability_status === "expired");
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_public_subscription_plans");
  if (error) {
    const catalogNotDeployed = error.code === "PGRST202" || error.code === "42883";
    return NextResponse.json({
      error: catalogNotDeployed
        ? "The subscription catalog migration is not applied to this database yet. Apply the pending plan migrations, then retry."
        : "The subscription catalog could not be reached. Retry in a moment.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!Array.isArray(data) || data.some((plan) => !hasCurrentPlanShape(plan))) {
    return NextResponse.json({
      error: "The plan catalog is missing its latest billing-day fields. Apply all pending subscription migrations, then retry.",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ plans: data }, { headers: { "Cache-Control": "no-store" } });
}
