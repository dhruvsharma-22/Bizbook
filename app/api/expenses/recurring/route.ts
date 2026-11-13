import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const FINANCE_ROLES = ["owner", "administrator", "accountant"] as const;
const METHODS = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Online", "Other"] as const;
const NO_STORE = { "Cache-Control": "no-store" };

type ExpenseOccurrence = {
  ruleId: string;
  instituteId: string;
  branchId: string | null;
  title: string;
  category: string;
  amount: number;
  defaultMethod: string;
  dueDay: number;
  dueMonth: string;
  dueDate: string;
  ruleActive: boolean;
  notes: string | null;
  status: "overdue" | "due_today" | "upcoming";
  expenseId: string | null;
  canRecord: boolean;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function errorResponse(error: unknown) {
  if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The fixed monthly expense request could not be completed." }, 500);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new RangeError("The fixed monthly expense form is too large.");
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch { throw new TypeError("The fixed monthly expense request is invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("The fixed monthly expense request is invalid.");
  return value as Record<string, unknown>;
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

function monthOf(date: string) { return date.slice(0, 7); }
function monthStart(month: string) { return `${month}-01`; }
function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}
function monthRange(start: string, end: string) {
  const months: string[] = [];
  for (let month = monthOf(start); month <= end; month = nextMonth(month)) months.push(month);
  return months;
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const instituteId = url.searchParams.get("instituteId")?.trim() ?? "";
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  const summaryOnly = url.searchParams.get("summary") === "1";
  if (!instituteId || instituteId.length > 100) return json({ error: "Choose an institute." }, 400);

  try {
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(branchId ? { branchId } : {}) });
    const supabase = await createSupabaseServerClient();
    const { data: institute, error: instituteError } = await supabase.from("coaching_institutes").select("time_zone").eq("id", instituteId).maybeSingle();
    if (instituteError || !institute) return json({ error: "Could not verify the institute business date." }, 503);
    let today: string;
    try { today = businessDate(institute.time_zone); } catch { return json({ error: "The institute time zone is invalid." }, 503); }

    const allRules: Array<{
      id: string; institute_id: string; branch_id: string | null; title: string; category: string;
      amount: number; default_method: string; due_day: number; start_month: string; ends_on: string | null; notes: string | null;
    }> = [];
    let ruleOffset = 0;
    while (true) {
      let rulesQuery = supabase.from("recurring_expense_rules")
        .select("id, institute_id, branch_id, title, category, amount, default_method, due_day, start_month, ends_on, notes")
        .eq("institute_id", instituteId)
        .order("start_month", { ascending: true })
        .range(ruleOffset, ruleOffset + 999);
      if (branchId) rulesQuery = rulesQuery.eq("branch_id", branchId);
      const { data: rules, error: rulesError } = await rulesQuery;
      if (rulesError) return json({ error: "Could not load fixed monthly expenses. Confirm the recurring-expense migration is applied." }, 503);
      allRules.push(...(rules ?? []));
      if ((rules?.length ?? 0) < 1000) break;
      ruleOffset += 1000;
    }

    const occurrences: ExpenseOccurrence[] = [];
    let occurrenceCount = 0;
    const currentMonth = monthOf(today);
    for (const rule of allRules) {
      const lastMonth = rule.ends_on && monthOf(rule.ends_on) < currentMonth ? monthOf(rule.ends_on) : currentMonth;
      if (monthOf(rule.start_month) > lastMonth) continue;
      for (const dueMonth of monthRange(rule.start_month, lastMonth)) {
        const dueDate = `${dueMonth}-${String(rule.due_day).padStart(2, "0")}`;
        if (rule.ends_on && dueDate > rule.ends_on) continue;
        occurrenceCount += 1;
        if (summaryOnly) continue;
        occurrences.push({
          ruleId: rule.id,
          instituteId: rule.institute_id,
          branchId: rule.branch_id,
          title: rule.title,
          category: rule.category,
          amount: Number(rule.amount),
          defaultMethod: rule.default_method,
          dueDay: rule.due_day,
          dueMonth,
          dueDate,
          ruleActive: rule.ends_on === null,
          notes: rule.notes,
          status: dueDate < today ? "overdue" : dueDate === today ? "due_today" : "upcoming",
          expenseId: null,
          canRecord: true,
        });
      }
    }

    // Avoid turning an old, long-running schedule into an unbounded response.
    if (occurrenceCount > 20_000) return json({ error: "There are too many monthly occurrences to display at once. Please contact support." }, 503);

    const ruleIds = [...new Set(allRules.map((rule) => rule.id))];
    const paidByOccurrence = new Map<string, string>();
    for (let index = 0; index < ruleIds.length; index += 100) {
      const ids = ruleIds.slice(index, index + 100);
      let offset = 0;
      while (true) {
        let paymentQuery = supabase.from("expenses")
          .select("id, recurring_rule_id, recurring_due_month")
          .eq("institute_id", instituteId)
          .is("voided_at", null)
          .in("recurring_rule_id", ids)
          .range(offset, offset + 999);
        if (branchId) paymentQuery = paymentQuery.eq("branch_id", branchId);
        const { data: payments, error: paymentsError } = await paymentQuery;
        if (paymentsError) return json({ error: "Could not load monthly payment status." }, 503);
        for (const payment of payments ?? []) {
          if (payment.recurring_rule_id && payment.recurring_due_month) {
            paidByOccurrence.set(`${payment.recurring_rule_id}:${monthOf(payment.recurring_due_month)}`, payment.id);
          }
        }
        if ((payments?.length ?? 0) < 1000) break;
        offset += 1000;
      }
    }

    const withStatus = occurrences.map((occurrence) => {
      const key = `${String(occurrence.ruleId)}:${String(occurrence.dueMonth)}`;
      const expenseId = paidByOccurrence.get(key) ?? null;
      return { ...occurrence, expenseId, status: expenseId ? "paid" : occurrence.status, canRecord: !expenseId };
    }).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.title).localeCompare(String(b.title)));
    const unpaidExpenses: Array<{
      id: string; institute_id: string; branch_id: string | null; title: string; category: string;
      amount: number; expense_date: string; method: string | null; notes: string | null;
      recurring_rule_id: string | null; recurring_due_month: string | null; payment_status: "unpaid";
      payment_due_date: string | null; paid_at: string | null;
    }> = [];
    let unpaidOffset = 0;
    while (true) {
      let unpaidQuery = supabase.from("expenses")
        .select("id, institute_id, branch_id, title, category, amount, expense_date, method, notes, recurring_rule_id, recurring_due_month, payment_status, payment_due_date, paid_at")
        .eq("institute_id", instituteId)
        .eq("payment_status", "unpaid")
        .is("voided_at", null)
        .order("payment_due_date", { ascending: true })
        .range(unpaidOffset, unpaidOffset + 999);
      if (branchId) unpaidQuery = unpaidQuery.eq("branch_id", branchId);
      const { data: page, error: unpaidError } = await unpaidQuery;
      if (unpaidError) return json({ error: "Could not load unpaid expense records." }, 503);
      for (const expense of page ?? []) {
        if (expense.payment_status === "unpaid") unpaidExpenses.push({ ...expense, payment_status: "unpaid" });
      }
      if ((page?.length ?? 0) < 1000) break;
      unpaidOffset += 1000;
    }
    const overdueRecurringCount = summaryOnly
      ? allRules.reduce((count, rule) => {
        const lastMonth = rule.ends_on && monthOf(rule.ends_on) < currentMonth ? monthOf(rule.ends_on) : currentMonth;
        if (monthOf(rule.start_month) > lastMonth) return count;
        return count + monthRange(rule.start_month, lastMonth).filter((dueMonth) => {
          const dueDate = `${dueMonth}-${String(rule.due_day).padStart(2, "0")}`;
          return dueDate < today && (!rule.ends_on || dueDate <= rule.ends_on)
            && !paidByOccurrence.has(`${rule.id}:${dueMonth}`);
        }).length;
      }, 0)
      : withStatus.filter((item) => item.status === "overdue").length;
    if (summaryOnly) {
      const overdueUnpaidCount = unpaidExpenses.filter((expense) => Boolean(expense.payment_due_date && expense.payment_due_date < today)).length;
      return json({ today, overdueCount: overdueRecurringCount + overdueUnpaidCount });
    }
    return json({ today, occurrences: withStatus, overdueCount: overdueRecurringCount, rules: allRules, unpaidExpenses });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let record: Record<string, unknown>;
  try { record = await readJson(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, error instanceof RangeError ? 413 : 400); }
  const action = record.action;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  if (!instituteId || instituteId.length > 100) return json({ error: "Choose an institute." }, 400);

  try {
    const supabase = await createSupabaseServerClient();
    if (action === "create_rule") {
      const requestId = record.requestId;
      const branchId = typeof record.branchId === "string" && record.branchId.trim() ? record.branchId.trim() : null;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const category = typeof record.category === "string" ? record.category.trim() : "";
      const method = record.defaultMethod;
      const dueDay = Number(record.dueDay);
      const amountText = typeof record.amount === "number" ? String(record.amount) : typeof record.amount === "string" ? record.amount.trim() : "";
      const amountPaise = parseAmountInputToPaise(amountText);
      const startMonth = record.startMonth;
      const notes = typeof record.notes === "string" ? record.notes.trim() : "";
      if (!isUuid(requestId) || !title || title.length > 120 || !category || category.length > 100
        || amountPaise === null || amountPaise <= 0 || amountPaise > 999999999999
        || !(METHODS as readonly unknown[]).includes(method) || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28
        || !isMonth(startMonth) || notes.length > 500) {
        return json({ error: "Enter a title, category, fixed amount, payment method, due day from 1 to 28, and valid start month." }, 400);
      }
      await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(branchId ? { branchId } : {}) });
      const { data: ruleId, error } = await supabase.rpc("create_recurring_expense_rule", {
        p_rule_id: requestId,
        p_institute_id: instituteId,
        p_branch_id: branchId,
        p_title: title,
        p_category: category,
        p_amount: Number((amountPaise / 100).toFixed(2)),
        p_default_method: method as typeof METHODS[number],
        p_due_day: dueDay,
        p_start_month: monthStart(startMonth),
        p_notes: notes || null,
      });
      if (error) {
        if (error.code === "42501") return json({ error: "Your institute or branch access does not allow this expense." }, 403);
        if (error.code === "22023") return json({ error: error.message.includes("start") ? "Choose this month or a future month to start the reminder." : "The fixed monthly expense details are invalid." }, 400);
        if (error.code === "23505") return json({ error: "This request ID was already used for different details. Submit again." }, 409);
        return json({ error: "Could not save the fixed monthly reminder. Confirm the recurring-expense migration is applied." }, 503);
      }
      return json({ ruleId }, 201);
    }

    if (action === "record_payment") {
      const ruleId = record.ruleId;
      const dueMonth = record.dueMonth;
      const paymentDate = record.paymentDate;
      const method = record.method;
      const requestId = record.requestId;
      if (!isUuid(ruleId) || !isUuid(requestId) || !isMonth(dueMonth)
        || typeof paymentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)
        || !Number.isFinite(Date.parse(`${paymentDate}T00:00:00.000Z`))
        || new Date(`${paymentDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== paymentDate
        || !(METHODS as readonly unknown[]).includes(method)) return json({ error: "Choose a valid monthly occurrence, payment date, and method." }, 400);
      const { data: rule, error: ruleError } = await supabase.from("recurring_expense_rules").select("id, institute_id, branch_id").eq("id", ruleId).eq("institute_id", instituteId).maybeSingle();
      if (ruleError) return json({ error: "Could not load the fixed monthly expense." }, 503);
      if (!rule) return json({ error: "The fixed monthly expense is unavailable." }, 404);
      await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(rule.branch_id ? { branchId: rule.branch_id } : {}) });
      const { data: expenseId, error } = await supabase.rpc("record_recurring_expense_payment", {
        p_expense_id: requestId,
        p_rule_id: ruleId,
        p_due_month: monthStart(dueMonth),
        p_payment_date: paymentDate,
        p_method: method as typeof METHODS[number],
      });
      if (error) {
        if (error.code === "42501") return json({ error: "Your institute or branch access does not allow this expense." }, 403);
        if (error.code === "23505") return json({ error: "This monthly expense is already recorded as paid, or the retry details do not match." }, 409);
        if (error.code === "22023") return json({ error: "Choose a valid payment date and an occurrence that has started." }, 400);
        if (error.code === "23514") return json({ error: "This occurrence was stopped when the monthly reminder was paused." }, 409);
        return json({ error: "Could not record the monthly expense payment." }, 503);
      }
      const { data: expense, error: reloadError } = await supabase.from("expenses")
        .select("id, institute_id, branch_id, title, category, amount, expense_date, method, notes, recurring_rule_id, recurring_due_month")
        .eq("id", expenseId).eq("institute_id", instituteId).single();
      if (reloadError || !expense) return json({ error: "Payment was recorded but could not be reloaded. Retry with the same request ID." }, 503);
      return json({ expense }, 201);
    }
    return json({ error: "Choose a supported fixed monthly expense action." }, 400);
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let record: Record<string, unknown>;
  try { record = await readJson(request); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, error instanceof RangeError ? 413 : 400); }
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  const ruleId = record.ruleId;
  if (!instituteId || instituteId.length > 100 || !isUuid(ruleId)) return json({ error: "Choose a valid fixed monthly expense." }, 400);
  try {
    const supabase = await createSupabaseServerClient();
    const { data: rule, error: ruleError } = await supabase.from("recurring_expense_rules").select("id, institute_id, branch_id").eq("id", ruleId).eq("institute_id", instituteId).maybeSingle();
    if (ruleError) return json({ error: "Could not load the fixed monthly expense." }, 503);
    if (!rule) return json({ error: "The fixed monthly expense is unavailable." }, 404);
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(rule.branch_id ? { branchId: rule.branch_id } : {}) });
    const { data: endDate, error } = await supabase.rpc("pause_recurring_expense_rule", { p_rule_id: ruleId });
    if (error) {
      if (error.code === "42501") return json({ error: "Your institute or branch access does not allow this expense." }, 403);
      return json({ error: "Could not pause the fixed monthly reminder." }, 503);
    }
    return json({ ruleId, endsOn: endDate });
  } catch (error) { return errorResponse(error); }
}
