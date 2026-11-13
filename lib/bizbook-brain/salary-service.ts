
/**
 * BizBook Brain — Salary Service
 *
 * Connects salary calculations to existing storage.
 * Does not write to general payment history, avoiding
 * duplicate salary outflows in financial reporting.
 */

import { BizBookError } from "./errors";
import {
  ATTENDANCE_KEY_SEPARATOR,
} from "./constants";
import {
  readAttendance,
  readSalaryPayments,
  readStudentsStaff,
  saveSalaryPayments,
} from "./storage-adapter";
import { calculateSalary } from "./salary-engine";
import {
  validateSalaryPaymentInput,
} from "./validation-engine";
import type {
  AttendanceData,
  SalaryCalculationInput,
  SalaryCalculationResult,
  SalaryPayment,
  SalaryPaymentInput,
  StaffMember,
} from "./types";

function requireStaff(staffId: string): StaffMember {
  if (typeof staffId !== "string" || !staffId.trim()) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Staff ID is required."
    );
  }

  const staff = readStudentsStaff().staff.find(
    (item) => item.id === staffId
  );

  if (!staff) {
    throw new BizBookError(
      "STAFF_NOT_FOUND",
      "The selected staff member could not be found.",
      { staffId }
    );
  }

  return staff;
}

/**
 * Returns a stable key for one staff member's payroll month.
 */
export function getSalaryPaymentKey(
  staffId: string,
  month: string
): string {
  if (!staffId.trim()) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Staff ID is required."
    );
  }

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payroll month must use YYYY-MM format.",
      { month }
    );
  }

  return `${staffId}${ATTENDANCE_KEY_SEPARATOR}${month}`;
}

/**
 * Builds a salary calculation from saved staff and attendance.
 *
 * Existing staff without a saved mode default to AttendanceBased.
 * Callers can override the mode or provide a manual adjustment.
 */
export function calculateStaffSalary(
  staffId: string,
  month: string,
  options: {
    mode?: SalaryCalculationInput["mode"];
    manualAdjustment?: number;
  } = {}
): SalaryCalculationResult {
  const staff = requireStaff(staffId);

  if (
    typeof staff.monthlySalary !== "number" ||
    !Number.isFinite(staff.monthlySalary)
  ) {
    throw new BizBookError(
      "INVALID_SALARY",
      "The staff member does not have a valid monthly salary.",
      { staffId }
    );
  }

  const attendance: AttendanceData = readAttendance();

  const input: SalaryCalculationInput = {
    staffId,
    month,
    monthlySalary: staff.monthlySalary,
    mode:
      options.mode ??
      staff.salaryCalculationMode ??
      "AttendanceBased",
    perDayLeaveCut: staff.perDayLeaveCut ?? 0,
    attendance,
    joiningDate: staff.joiningDate,
    manualAdjustment: options.manualAdjustment ?? 0,
  };

  return calculateSalary(input);
}

/**
 * Reads the saved salary payment for a staff member and month.
 */
export function getSalaryPayment(
  staffId: string,
  month: string
): SalaryPayment | undefined {
  const key = getSalaryPaymentKey(staffId, month);
  return readSalaryPayments()[key];
}

/**
 * Lists saved salary payments, optionally filtered by month or staff.
 */
export function listSalaryPayments(filters: {
  staffId?: string;
  month?: string;
} = {}): SalaryPayment[] {
  const payments = Object.values(readSalaryPayments());

  return payments.filter((payment) => {
    if (
      filters.staffId &&
      payment.staffId !== filters.staffId
    ) {
      return false;
    }

    if (
      filters.month &&
      payment.month !== filters.month
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Records one salary payment per staff member per month.
 *
 * Duplicate payments are rejected rather than silently
 * overwriting the original record.
 */
export function recordSalaryPayment(
  input: SalaryPaymentInput
): SalaryPayment {
  validateSalaryPaymentInput(input);

  requireStaff(input.staffId);

  const key = getSalaryPaymentKey(input.staffId, input.month);
  const payments = readSalaryPayments();

  if (payments[key]) {
    throw new BizBookError(
      "DUPLICATE_RECORD",
      "A salary payment is already recorded for this staff member and month.",
      {
        staffId: input.staffId,
        month: input.month,
      }
    );
  }

  const payment: SalaryPayment = {
    staffId: input.staffId,
    month: input.month,
    amount: input.amount,
    status: "Paid",
    paidAt: input.paidAt,
    method: input.method,
    ...(input.reference?.trim()
      ? { reference: input.reference.trim() }
      : {}),
    ...(input.notes?.trim()
      ? { notes: input.notes.trim() }
      : {}),
    ...(input.salaryCalculationMode
      ? { salaryCalculationMode: input.salaryCalculationMode }
      : {}),
    ...(input.attendanceDeduction !== undefined
      ? { attendanceDeduction: input.attendanceDeduction }
      : {}),
    ...(input.manualAdjustment !== undefined
      ? { manualAdjustment: input.manualAdjustment }
      : {}),
  };

  // Re-read immediately before saving to reduce accidental
  // overwrites from stale data in the current browser session.
  const latestPayments = readSalaryPayments();

  if (latestPayments[key]) {
    throw new BizBookError(
      "DUPLICATE_RECORD",
      "A salary payment has already been recorded.",
      { staffId: input.staffId, month: input.month }
    );
  }

  saveSalaryPayments({
    ...latestPayments,
    [key]: payment,
  });

  return payment;
}
