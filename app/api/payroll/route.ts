import { NextResponse } from "next/server";
import { requireInstituteAccess, SupabaseAuthorizationError } from "@/lib/supabase/authorization";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthorizedTestProjectConfigured } from "@/lib/supabase/workspace-scope";
import { calculatePayrollPayable } from "@/lib/supabase/payroll";
import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import type { PaymentMethod } from "@/lib/supabase/database.types";

const FINANCE_ROLES = ["owner", "administrator", "accountant"] as const;
const NO_STORE = { "Cache-Control": "no-store" };
const PAGE_SIZE = 500;
const METHODS: readonly PaymentMethod[] = ["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"];

type AttendanceRow = { staff_id: string; attendance_date: string; status: string };
type SalaryRow = {
  institute_id: string;
  staff_id: string;
  payroll_month: string;
  amount: number | string;
  paid_at: string;
  method: PaymentMethod | null;
  reference: string | null;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function validMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function errorResponse(error: unknown) {
  if (error instanceof SupabaseAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The payroll request could not be completed." }, 500);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 16_384) throw new RangeError("The payroll request is too large.");
  try { return JSON.parse(text) as unknown; } catch { throw new TypeError("The payroll request is invalid."); }
}

async function listPaged<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Could not load payroll records.");
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

export async function GET(request: Request) {
  if (!isAuthorizedTestProjectConfigured()) return json({ error: "Shared payroll is enabled only for the authorized test project." }, 503);
  const url = new URL(request.url);
  const instituteId = url.searchParams.get("instituteId")?.trim() ?? "";
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  const month = url.searchParams.get("month")?.trim() ?? "";
  if (!instituteId || instituteId.length > 100) return json({ error: "Choose an institute." }, 400);
  if (!validMonth(month)) return json({ error: "Choose a valid payroll month." }, 400);

  try {
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(branchId ? { branchId } : {}) });
    const supabase = await createSupabaseServerClient();
    const [yearText, monthText] = month.split("-");
    const monthStart = `${month}-01`;
    const nextMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 1)).toISOString().slice(0, 10);

    const { data: staff, error: staffError } = await supabase.rpc("list_staff_compensation", {
      p_institute_id: instituteId,
      p_branch_id: branchId ?? null,
    });
    if (staffError || !staff) return json({ error: "Could not load finance-authorized staff compensation." }, 503);
    const attendance = await listPaged<AttendanceRow>((from, to) => {
      let query = supabase.from("attendance_records").select("staff_id, attendance_date, status")
        .eq("institute_id", instituteId).gte("attendance_date", monthStart).lt("attendance_date", nextMonth).order("attendance_date").range(from, to);
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    });
    const payments = await listPaged<SalaryRow>((from, to) => {
      let query = supabase.from("salary_payments").select("institute_id, staff_id, payroll_month, amount, paid_at, method, reference")
        .eq("institute_id", instituteId).eq("payroll_month", month).order("staff_id").range(from, to);
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    });
    const attendanceByStaff = new Map<string, AttendanceRow[]>();
    for (const row of attendance) attendanceByStaff.set(row.staff_id, [...(attendanceByStaff.get(row.staff_id) ?? []), row]);
    const paymentsByStaff = new Map(payments.map((payment) => [payment.staff_id, payment]));
    const rows = staff.map((person) => {
      const payable = calculatePayrollPayable(person, attendanceByStaff.get(person.id) ?? [], month);
      const payment = paymentsByStaff.get(person.id);
      return {
        staffId: person.id,
        name: person.name,
        designation: person.designation,
        branchId: person.branch_id,
        monthlySalary: Number(person.monthly_salary),
        payableAmount: payable.amountCents / 100,
        attendanceDeduction: payable.attendanceDeductionCents / 100,
        unpaidDays: payable.unpaidDays,
        payment: payment ? {
          status: "Paid" as const,
          amount: Number(payment.amount),
          paidAt: payment.paid_at,
          method: payment.method,
          reference: payment.reference,
        } : null,
      };
    });
    return json({ month, rows });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  if (!isAuthorizedTestProjectConfigured()) return json({ error: "Shared payroll is enabled only for the authorized test project." }, 503);
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  let raw: unknown;
  try { raw = await readJson(request); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid request." }, error instanceof RangeError ? 413 : 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "The payroll request is invalid." }, 400);
  const record = raw as Record<string, unknown>;
  const instituteId = typeof record.instituteId === "string" ? record.instituteId.trim() : "";
  const staffId = typeof record.staffId === "string" ? record.staffId.trim() : "";
  const branchId = typeof record.branchId === "string" && record.branchId.trim() ? record.branchId.trim() : undefined;
  const month = typeof record.month === "string" ? record.month.trim() : "";
  const reference = typeof record.reference === "string" ? record.reference.trim() : "";
  const method = typeof record.method === "string" ? record.method : "";
  const amountText = typeof record.amount === "string" ? record.amount.trim() : "";
  if (!instituteId || instituteId.length > 100 || !staffId || staffId.length > 100 || !validMonth(month)) return json({ error: "Choose a valid institute, staff member, and payroll month." }, 400);
  if (!METHODS.includes(method as PaymentMethod)) return json({ error: "Choose a supported manual salary payment method." }, 400);
  if (reference.length > 100) return json({ error: "Enter a valid reference." }, 400);
  const amountCents = parseAmountInputToPaise(amountText);
  if (amountCents === null) return json({ error: "Enter a valid salary amount with no more than two decimal places." }, 400);
  if (amountCents <= 0) return json({ error: "Salary payment must be greater than zero." }, 400);

  try {
    await requireInstituteAccess(instituteId, { allowedRoles: FINANCE_ROLES, ...(branchId ? { branchId } : {}) });
    const supabase = await createSupabaseServerClient();
    const { data: staffRows, error: staffError } = await supabase.rpc("list_staff_compensation", {
      p_institute_id: instituteId,
      p_branch_id: branchId ?? null,
    });
    if (staffError || !staffRows) return json({ error: "Could not verify finance-authorized staff compensation." }, 503);
    const staff = staffRows.find((row) => row.id === staffId) ?? null;
    if (!staff) return json({ error: "Staff member is unavailable in the selected branch." }, 404);

    const [yearText, monthText] = month.split("-");
    const monthStart = `${month}-01`;
    const nextMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 1)).toISOString().slice(0, 10);
    let attendanceQuery = supabase.from("attendance_records").select("attendance_date, status")
      .eq("institute_id", instituteId).eq("staff_id", staffId).gte("attendance_date", monthStart).lt("attendance_date", nextMonth);
    attendanceQuery = staff.branch_id ? attendanceQuery.eq("branch_id", staff.branch_id) : attendanceQuery.is("branch_id", null);
    const { data: attendance, error: attendanceError } = await attendanceQuery;
    if (attendanceError) return json({ error: "Could not verify payroll attendance." }, 503);
    const payable = calculatePayrollPayable(staff, attendance ?? [], month);
    if (amountCents !== payable.amountCents) return json({ error: "Salary amount changed. Reload payroll and submit the current payable amount." }, 409);

    const paidAt = new Date().toISOString();
    const { error: paymentError } = await supabase.rpc("record_salary_payment", {
      p_institute_id: instituteId,
      p_branch_id: staff.branch_id,
      p_staff_id: staffId,
      p_payroll_month: month,
      p_amount: amountCents / 100,
      p_paid_at: paidAt,
      p_method: method as PaymentMethod,
      p_reference: reference || null,
      p_notes: null,
      p_manual_adjustment: null,
    });
    if (paymentError) {
      if (paymentError.code === "23505") return json({ error: "A salary payment is already recorded for this staff member and month. No second payment was created.", alreadyRecorded: true }, 409);
      if (paymentError.code === "42501") return json({ error: "Your institute or branch access does not allow this salary payment." }, 403);
      if (paymentError.code === "22023" || paymentError.code === "23514") return json({ error: "The salary details changed or are no longer valid. Reload payroll before retrying." }, 409);
      return json({ error: "Could not record salary payment. Confirm the verified salary RPC is available." }, 503);
    }
    return json({ recorded: true, staffId, payrollMonth: month, amount: amountCents / 100, paidAt, method, reference: reference || null }, 201);
  } catch (error) { return errorResponse(error); }
}
