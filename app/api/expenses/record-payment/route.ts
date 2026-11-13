import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const FINANCE_ROLES = ["owner", "administrator", "accountant"] as const;
const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Online", "Other"] as const;
const NO_STORE = { "Cache-Control": "no-store" };
const FIELDS = "id, institute_id, branch_id, title, category, amount, expense_date, method, notes, recurring_rule_id, recurring_due_month, payment_status, payment_due_date, paid_at, voided_at, void_reason, created_at, updated_at";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: "The payment request is invalid." }, 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "The payment request is invalid." }, 400);
  const record = raw as Record<string, unknown>;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  const expenseId = typeof record.expenseId === "string" ? record.expenseId.trim() : "";
  const paidAt = record.paidAt;
  const method = record.method;
  if (!instituteId || instituteId.length > 100 || !expenseId || expenseId.length > 100
    || !validDate(paidAt) || !(METHODS as readonly unknown[]).includes(method)) {
    return json({ error: "Choose a valid expense, payment date, and method." }, 400);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: existing, error: loadError } = await supabase.from("expenses")
      .select("id, branch_id, voided_at")
      .eq("id", expenseId).eq("institute_id", instituteId).maybeSingle();
    if (loadError) return json({ error: "Could not load the expense." }, 503);
    if (!existing || existing.voided_at) return json({ error: "The expense is unavailable or voided." }, 404);
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(existing.branch_id ? { branchId: existing.branch_id } : {}) });
    const { data: savedId, error } = await supabase.rpc("record_expense_payment", {
      p_expense_id: expenseId,
      p_paid_at: paidAt,
      p_method: method as typeof METHODS[number],
    });
    if (error) {
      if (error.code === "42501") return json({ error: "Your institute or branch access does not allow this payment." }, 403);
      if (error.code === "23505") return json({ error: "This expense is already recorded as paid with different details." }, 409);
      if (error.code === "22023") return json({ error: "Choose a payment date that is not in the future." }, 400);
      return json({ error: "Could not record the expense payment." }, 503);
    }
    const { data: expense, error: reloadError } = await supabase.from("expenses").select(FIELDS)
      .eq("id", savedId).eq("institute_id", instituteId).single();
    if (reloadError || !expense) return json({ error: "Payment was recorded but could not be reloaded." }, 503);
    return json({ expense });
  } catch (error) {
    if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
    return json({ error: "The expense payment could not be completed." }, 500);
  }
}
