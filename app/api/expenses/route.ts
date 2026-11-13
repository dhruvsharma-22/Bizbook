import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseExpenseInput } from "@/lib/supabase/expense-validation";

const FINANCE_ROLES = ["owner", "administrator", "accountant"] as const;
const SELECT_FIELDS = "id, institute_id, branch_id, title, category, amount, expense_date, method, notes, recurring_rule_id, recurring_due_month, payment_status, payment_due_date, paid_at, voided_at, void_reason, created_at, updated_at";
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function errorResponse(error: unknown) {
  if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The expense request could not be completed." }, 500);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new RangeError("The expense form is too large.");
  try { return JSON.parse(text) as unknown; } catch { throw new TypeError("The expense request is invalid."); }
}

function businessDate(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) throw new Error("Could not determine the institute business date.");
  return `${year}-${month}-${day}`;
}

async function getTimeZone(instituteId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("coaching_institutes").select("time_zone").eq("id", instituteId).maybeSingle();
  if (error || !data) throw new Error("Could not verify the institute business date.");
  return data.time_zone;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const instituteId = url.searchParams.get("instituteId")?.trim() ?? "";
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  const month = url.searchParams.get("month")?.trim() ?? "";
  const offsetText = url.searchParams.get("offset") ?? "0";
  const offset = Number(offsetText);
  if (!instituteId || instituteId.length > 100) return json({ error: "Choose an institute." }, 400);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "Choose a valid summary month." }, 400);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return json({ error: "The expense page offset is invalid." }, 400);
  try {
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(branchId ? { branchId } : {}) });
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("expenses").select(SELECT_FIELDS, { count: "exact" }).eq("institute_id", instituteId).is("voided_at", null).order("expense_date", { ascending: false }).order("created_at", { ascending: false }).range(offset, offset + 499);
    if (branchId) query = query.eq("branch_id", branchId);
    const [expensesResult, summaryResult] = await Promise.all([
      query,
      supabase.rpc("expense_month_summary", {
        p_institute_id: instituteId,
        p_branch_id: branchId ?? null,
        p_month_start: `${month}-01`,
      }),
    ]);
    const { data, error, count } = expensesResult;
    if (error) return json({ error: "Could not load shared expenses." }, 503);
    if (summaryResult.error || !summaryResult.data?.[0]) return json({ error: "Could not load the shared expense summary. Confirm the expense migration is applied." }, 503);
    return json({
      expenses: data ?? [],
      totalCount: count ?? 0,
      offset,
      hasMore: (count ?? 0) > offset + (data?.length ?? 0),
      summary: {
        monthTotal: Number(summaryResult.data[0].month_total),
        expenseCount: Number(summaryResult.data[0].expense_count),
      },
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let raw: unknown;
  try { raw = await readJson(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, error instanceof RangeError ? 413 : 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "The expense request is invalid." }, 400);
  const record = raw as Record<string, unknown>;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  const branchId = typeof record.branchId === "string" && record.branchId.trim() ? record.branchId.trim() : undefined;
  const requestId = typeof record.requestId === "string" ? record.requestId.trim() : "";
  if (!instituteId || instituteId.length > 100) return json({ error: "Choose an institute." }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return json({ error: "The expense request ID is invalid." }, 400);
  try {
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(branchId ? { branchId } : {}) });
    const timezone = await getTimeZone(instituteId);
    let date: string;
    try { date = businessDate(timezone); } catch { return json({ error: "The institute time zone is invalid." }, 503); }
    const paymentStatus = record.paymentStatus === "unpaid" ? "unpaid" : record.paymentStatus === "paid" || record.paymentStatus === undefined ? "paid" : "invalid";
    if (paymentStatus === "invalid") return json({ error: "Choose whether this expense has been paid." }, 400);
    const rawPaidAt = typeof record.paidAt === "string" ? record.paidAt.trim() : "";
    const rawDueDate = typeof record.paymentDueDate === "string" ? record.paymentDueDate.trim() : "";
    const methodForValidation = paymentStatus === "unpaid" ? "Other" : record.method;
    const parsed = parseExpenseInput({ ...record, method: methodForValidation, branchId: branchId ?? null }, date);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
      && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
    if (paymentStatus === "unpaid" && !validDate(rawDueDate)) return json({ error: "Choose a due date for an unpaid expense." }, 400);
    const paidAt = paymentStatus === "paid" ? (rawPaidAt || parsed.value.expenseDate) : null;
    if (paidAt && (!validDate(paidAt) || paidAt > date)) return json({ error: "Choose a valid payment date that is not in the future." }, 400);
    const supabase = await createSupabaseServerClient();
    const { data: expenseId, error: recordError } = await supabase.rpc("record_expense_entry", {
      p_expense_id: requestId,
      p_institute_id: instituteId,
      p_branch_id: parsed.value.branchId,
      p_title: parsed.value.title,
      p_category: parsed.value.category,
      p_amount: parsed.value.amount,
      p_expense_date: parsed.value.expenseDate,
      p_payment_status: paymentStatus,
      p_payment_due_date: paymentStatus === "unpaid" ? rawDueDate : null,
      p_paid_at: paidAt,
      p_method: paymentStatus === "paid" ? parsed.value.method : null,
      p_notes: parsed.value.notes,
    });
    if (recordError) {
      if (recordError.code === "23505") return json({ error: "This expense request ID was reused with different details. Submit again to create a new expense." }, 409);
      if (recordError.code === "42501") return json({ error: "Your institute or branch access does not allow this expense." }, 403);
      return json({ error: "Could not save the shared expense. Confirm the expense migration is applied." }, 503);
    }
    if (!expenseId) return json({ error: "The expense transaction returned no record." }, 503);
    const { data, error } = await supabase.from("expenses").select(SELECT_FIELDS).eq("id", expenseId).eq("institute_id", instituteId).single();
    if (error || !data) return json({ error: "The expense was recorded but could not be reloaded. Retry with the same request." }, 503);
    return json({ expense: data }, 201);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let raw: unknown;
  try { raw = await readJson(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, error instanceof RangeError ? 413 : 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "The expense request is invalid." }, 400);
  const record = raw as Record<string, unknown>;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  const expenseId = typeof record.expenseId === "string" ? record.expenseId.trim() : "";
  if (!instituteId || instituteId.length > 100 || !expenseId || expenseId.length > 100) return json({ error: "Choose a valid expense." }, 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: existing, error: findError } = await supabase.from("expenses").select("id, institute_id, branch_id, voided_at, recurring_rule_id, payment_status").eq("id", expenseId).eq("institute_id", instituteId).maybeSingle();
    if (findError) return json({ error: "Could not load the shared expense." }, 503);
    if (!existing || existing.voided_at) return json({ error: "The expense is unavailable or already voided." }, 404);
    if (existing.recurring_rule_id) return json({ error: "Fixed monthly payments cannot be edited. Void the record with a reason if it was entered incorrectly." }, 409);
    if (existing.payment_status === "unpaid") return json({ error: "Record payment before editing this expense." }, 409);
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(existing.branch_id ? { branchId: existing.branch_id } : {}) });
    const timezone = await getTimeZone(instituteId);
    let date: string;
    try { date = businessDate(timezone); } catch { return json({ error: "The institute time zone is invalid." }, 503); }
    const parsed = parseExpenseInput({ ...record, branchId: existing.branch_id }, date);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { error: updateError } = await supabase.rpc("update_expense", {
      p_expense_id: expenseId,
      p_title: parsed.value.title,
      p_category: parsed.value.category,
      p_amount: parsed.value.amount,
      p_expense_date: parsed.value.expenseDate,
      p_method: parsed.value.method,
      p_notes: parsed.value.notes,
    });
    if (updateError) {
      if (updateError.code === "42501") return json({ error: "Your institute or branch access does not allow this expense." }, 403);
      if (updateError.code === "23514") return json({ error: "A voided expense cannot be edited." }, 409);
      if (updateError.code === "22023") return json({ error: "Expense details are invalid for the institute business date." }, 400);
      return json({ error: "Could not update the shared expense. Confirm the expense migration is applied." }, 503);
    }
    const { data, error } = await supabase.from("expenses").select(SELECT_FIELDS).eq("id", expenseId).eq("institute_id", instituteId).maybeSingle();
    if (error || !data) return json({ error: "The expense was updated but could not be reloaded." }, 503);
    return json({ expense: data });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let raw: unknown;
  try { raw = await readJson(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, error instanceof RangeError ? 413 : 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "The void request is invalid." }, 400);
  const record = raw as Record<string, unknown>;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  const expenseId = typeof record.expenseId === "string" ? record.expenseId.trim() : "";
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!instituteId || instituteId.length > 100 || !expenseId || expenseId.length > 100 || reason.length < 3 || reason.length > 500) return json({ error: "Choose an expense and enter a void reason from 3 to 500 characters." }, 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: existing, error: findError } = await supabase.from("expenses").select("id, branch_id, voided_at").eq("id", expenseId).eq("institute_id", instituteId).maybeSingle();
    if (findError) return json({ error: "Could not load the shared expense." }, 503);
    if (!existing || existing.voided_at) return json({ error: "The expense is unavailable or already voided." }, 404);
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(existing.branch_id ? { branchId: existing.branch_id } : {}) });
    const { error } = await supabase.rpc("void_expense", { p_expense_id: expenseId, p_reason: reason });
    if (error) return json({ error: "Expense voiding is unavailable until the audited void migration is applied." }, 503);
    return json({ success: true, voided: true });
  } catch (error) { return errorResponse(error); }
}
