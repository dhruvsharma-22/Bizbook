
/**
 * BizBook Brain — Salary Engine
 *
 * Responsibilities:
 * - Calculate attendance-based salary.
 * - Support fixed salary without attendance deductions.
 * - Deduct configured amounts for Absent and Leave days.
 * - Ignore attendance before the staff joining date.
 * - Apply positive or negative manual adjustments.
 * - Never return a negative payable salary.
 *
 * This is a pure calculation engine.
 * It does not read or write localStorage or database records.
 */

import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";
import { ATTENDANCE_KEY_SEPARATOR } from "./constants";

import { validateSalaryCalculationInput } from "./validation-engine";

import type {
  AttendanceData,
  AttendanceStatus,
  SalaryCalculationInput,
  SalaryCalculationResult,
} from "./types";

/**
 * Converts a signed rupee amount to signed integer paise.
 *
 * toPaise() accepts non-negative amounts, so a negative
 * adjustment must be converted without passing a negative
 * value into toPaise().
 */
function toSignedPaise(amount: number): number {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount)
  ) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Manual salary adjustment must be a finite number.",
      { amount },
    );
  }

  const absolutePaise = toPaise(Math.abs(amount));
  const signedPaise = amount < 0
    ? -absolutePaise
    : absolutePaise;

  if (!Number.isSafeInteger(signedPaise)) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Manual salary adjustment exceeds the supported amount.",
      { amount },
    );
  }

  return signedPaise;
}

/**
 * Returns the number of days in a YYYY-MM month.
 */
function getDaysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);

  return new Date(year, monthNumber, 0).getDate();
}

/**
 * Returns a YYYY-MM-DD date for the supplied month and day.
 */
function buildDate(
  month: string,
  day: number,
): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

/**
 * Builds the attendance storage key used by BizBook.
 *
 * Existing format:
 * staffId__YYYY-MM-DD
 */
function getAttendanceKey(
  staffId: string,
  date: string,
): string {
  return `${staffId}${ATTENDANCE_KEY_SEPARATOR}${date}`;
}

/**
 * Checks whether a joining date is on or before a date.
 */
function isOnOrAfterJoiningDate(
  date: string,
  joiningDate?: string,
): boolean {
  if (!joiningDate) {
    return true;
  }

  return date >= joiningDate;
}

/**
 * Validates attendance statuses used by the salary engine.
 */
function validateAttendanceStatuses(
  attendance: AttendanceData | undefined,
): void {
  if (attendance === undefined) {
    return;
  }

  if (
    attendance === null ||
    typeof attendance !== "object" ||
    Array.isArray(attendance)
  ) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Attendance data must be a valid record.",
    );
  }

  const validStatuses: AttendanceStatus[] = [
    "Present",
    "Absent",
    "Leave",
    "Holiday",
  ];

  for (const [key, status] of Object.entries(attendance)) {
    if (
      typeof key !== "string" ||
      !validStatuses.includes(status)
    ) {
      throw new BizBookError(
        "INVALID_ATTENDANCE",
        "Attendance contains an invalid status.",
        { key, status },
      );
    }
  }
}

/**
 * Calculates salary for one staff member for one payroll month.
 *
 * Rules:
 * - Fixed mode: no attendance deduction.
 * - AttendanceBased mode: each Absent or Leave day incurs
 *   the configured perDayLeaveCut.
 * - Present and Holiday do not incur deductions.
 * - Attendance before joiningDate is ignored.
 * - Only attendance records for the requested staff and month
 *   are considered.
 * - Positive adjustment increases payable salary.
 * - Negative adjustment decreases payable salary.
 * - Payable salary is floored at zero.
 */
export function calculateSalary(
  input: SalaryCalculationInput,
): SalaryCalculationResult {
  // Validate the input before calculations.
  validateSalaryCalculationInput(input);

  validateAttendanceStatuses(input.attendance);

  const monthlySalaryPaise = toPaise(input.monthlySalary);

  const perDayLeaveCutPaise = toPaise(
    input.perDayLeaveCut ?? 0,
  );

  const manualAdjustmentPaise = toSignedPaise(
    input.manualAdjustment ?? 0,
  );

  let deductionDays = 0;
  let attendanceDeductionPaise = 0;

  const attendance = input.attendance ?? {};

  if (input.mode === "AttendanceBased") {
    const daysInMonth = getDaysInMonth(input.month);

    for (let day = 1; day <= daysInMonth; day++) {
      const date = buildDate(input.month, day);

      // Ignore attendance before the employee joined.
      if (
        !isOnOrAfterJoiningDate(
          date,
          input.joiningDate,
        )
      ) {
        continue;
      }

      const key = getAttendanceKey(
        input.staffId,
        date,
      );

      const status = attendance[key];

      // Missing attendance does not automatically mean Absent.
      if (status === undefined) {
        continue;
      }

      if (status === "Absent" || status === "Leave") {
        deductionDays += 1;

        attendanceDeductionPaise += perDayLeaveCutPaise;

        if (!Number.isSafeInteger(attendanceDeductionPaise)) {
          throw new BizBookError(
            "INVALID_SALARY",
            "Attendance deductions exceed the supported amount.",
            { staffId: input.staffId, month: input.month },
          );
        }
      }
    }
  }

  /**
   * Calculate using integer paise to avoid floating-point
   * arithmetic errors.
   *
   * Do not call toPaise() on rawPayablePaise: it may be
   * negative before the zero floor is applied.
   */
  const rawPayablePaise =
    monthlySalaryPaise -
    attendanceDeductionPaise +
    manualAdjustmentPaise;

  if (!Number.isSafeInteger(rawPayablePaise)) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Calculated salary exceeds the supported amount.",
      { staffId: input.staffId, month: input.month },
    );
  }

  const payableSalaryPaise = Math.max(
    0,
    rawPayablePaise,
  );

  return {
    staffId: input.staffId,
    month: input.month,
    mode: input.mode,
    monthlySalary: fromPaise(monthlySalaryPaise),
    deductionDays,
    perDayLeaveCut: fromPaise(perDayLeaveCutPaise),
    attendanceDeduction: fromPaise(
      attendanceDeductionPaise,
    ),
   manualAdjustment: manualAdjustmentPaise / 100,
    payableSalary: fromPaise(payableSalaryPaise),
  };
}
