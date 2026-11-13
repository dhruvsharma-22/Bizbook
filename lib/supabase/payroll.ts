import { ATTENDANCE_KEY_SEPARATOR } from "@/lib/bizbook-brain/constants";
import { calculateSalary } from "@/lib/bizbook-brain/salary-engine";
import { validateDate } from "@/lib/bizbook-brain/validation-engine";
import type { AttendanceData, AttendanceStatus } from "@/lib/bizbook-brain/types";

export type PayrollAttendance = { attendance_date: string; status: string };
export type PayrollStaff = {
  id?: string;
  monthly_salary: number | string;
  manual_payable_amount: number | string | null;
  per_day_leave_cut: number | string;
  salary_calculation_mode: "AttendanceBased" | "Fixed";
  attendance_enabled: boolean;
  joining_date: string | null;
};

const ATTENDANCE_STATUSES = new Set<AttendanceStatus>(["Present", "Absent", "Leave", "Holiday"]);

/**
 * Parse a database money value into integer paise without rounding.
 * PostgreSQL numeric columns arrive as decimal strings; numeric JS values
 * are accepted only when their string form has at most two decimal places.
 */
function decimalToPaise(value: number | string | null): number | null {
  if (value === null) return null;
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Payroll amounts must be non-negative rupee values with no fractional paise.");
  }
  const [rupees, fraction = ""] = text.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) {
    throw new Error("Payroll amount exceeds the supported exact paise range.");
  }
  return paise;
}

export function calculatePayrollPayable(
  staff: PayrollStaff,
  attendance: readonly PayrollAttendance[],
  payrollMonth: string,
): { amountCents: number; attendanceDeductionCents: number; unpaidDays: number } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payrollMonth)) {
    throw new Error("Payroll month must use YYYY-MM format.");
  }

  const monthlySalaryPaise = decimalToPaise(staff.monthly_salary);
  const perDayLeaveCutPaise = decimalToPaise(staff.per_day_leave_cut);
  const manualPayablePaise = decimalToPaise(staff.manual_payable_amount);
  if (monthlySalaryPaise === null || perDayLeaveCutPaise === null) {
    throw new Error("Payroll salary and leave deduction are required.");
  }

  const attendanceByDate: AttendanceData = {};
  for (const item of attendance) {
    validateDate(item.attendance_date, "Attendance date");
    if (!ATTENDANCE_STATUSES.has(item.status as AttendanceStatus)) {
      throw new Error("Payroll attendance contains an unsupported status.");
    }
    const key = `${staff.id ?? "payroll"}${ATTENDANCE_KEY_SEPARATOR}${item.attendance_date}`;
    if (attendanceByDate[key] !== undefined) {
      throw new Error("Payroll attendance contains a duplicate staff date.");
    }
    attendanceByDate[key] = item.status as AttendanceStatus;
  }

  const attendanceBased = manualPayablePaise === null
    && staff.attendance_enabled
    && staff.salary_calculation_mode === "AttendanceBased";
  const basePaise = manualPayablePaise ?? monthlySalaryPaise;
  const result = calculateSalary({
    staffId: staff.id ?? "payroll",
    month: payrollMonth,
    mode: attendanceBased ? "AttendanceBased" : "Fixed",
    monthlySalary: basePaise / 100,
    perDayLeaveCut: attendanceBased ? perDayLeaveCutPaise / 100 : 0,
    joiningDate: staff.joining_date ?? undefined,
    attendance: attendanceByDate,
  });

  const amountPaise = decimalToPaise(result.payableSalary);
  const deductionPaise = decimalToPaise(result.attendanceDeduction);
  if (amountPaise === null || deductionPaise === null) {
    throw new Error("The payroll engine returned an invalid amount.");
  }
  return {
    amountCents: amountPaise,
    attendanceDeductionCents: deductionPaise,
    unpaidDays: result.deductionDays,
  };
}
