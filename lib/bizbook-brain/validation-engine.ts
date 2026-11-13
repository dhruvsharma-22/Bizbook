
/**
 * BizBook Brain — Validation Engine
 *
 * Validates business data before processing.
 * This file does not save data or modify stored records.
 */

import { BizBookError } from "./errors";
import { toPaise } from "./money";

import {
  ATTENDANCE_STATUSES,
  DEFAULT_PAYMENT_METHODS,
  INSTALLMENT_STATUSES,
  SALARY_CALCULATION_MODES,
} from "./constants";

import type {
  AttendanceInput,
  AttendanceRecord,
  ExpenseInput,
  ExpenseRecord,
  Installment,
  PaymentMethod,
  SalaryCalculationInput,
  SalaryCalculationMode,
  SalaryPaymentInput,
  StaffMember,
  Student,
} from "./types";

/* =========================================================
   SHARED VALIDATION HELPERS
========================================================= */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Validates a YYYY-MM-DD date without accepting impossible
 * calendar dates such as 2026-02-31.
 */
export function validateDate(
  date: string,
  field = "date"
): void {
  if (typeof date !== "string") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} must be a valid date.`,
      { field, date }
    );
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} must use YYYY-MM-DD format.`,
      { field, date }
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} is not a valid calendar date.`,
      { field, date }
    );
  }
}

/**
 * Validate a YYYY-MM payroll month.
 */
export function validatePayrollMonth(month: string): void {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Payroll month must use YYYY-MM format.",
      { month }
    );
  }
}

/* =========================================================
   AMOUNT VALIDATION
========================================================= */

/**
 * allowZero = false: amount must be greater than zero.
 * allowZero = true: zero is permitted for balances and fees.
 */
export function validateAmount(
  amount: number,
  options: { allowZero?: boolean } = {}
): void {
  const { allowZero = false } = options;

  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    (!allowZero && amount === 0)
  ) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      allowZero
        ? "Amount must be a valid non-negative number."
        : "Amount must be greater than zero.",
      { amount }
    );
  }

  // Ensure the amount can be safely represented in paise.
  toPaise(amount);
}

/* =========================================================
   STUDENT VALIDATION
========================================================= */

export function validateStudent(student: Student): void {
  if (!student || typeof student !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student information is missing."
    );
  }

  if (!isNonEmptyString(student.id)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student ID is required."
    );
  }

  if (!isNonEmptyString(student.name)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Student name is required.",
      { studentId: student.id }
    );
  }

  if (student.totalFee !== undefined) {
    validateAmount(student.totalFee, { allowZero: true });
  }

  if (student.admissionFee !== undefined) {
    validateAmount(student.admissionFee, { allowZero: true });
  }

  if (student.installments !== undefined) {
    if (!Array.isArray(student.installments)) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Student installments must be an array.",
        { studentId: student.id }
      );
    }

    student.installments.forEach((installment, index) => {
      validateInstallment(installment, index);
    });
  }
}

/* =========================================================
   INSTALLMENT VALIDATION
========================================================= */

export function validateInstallment(
  installment: Installment,
  index?: number
): void {
  if (!installment || typeof installment !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Installment information is missing.",
      { index }
    );
  }

  validateAmount(installment.amount, { allowZero: true });

  if (installment.scheduledAmount !== undefined) {
    validateAmount(installment.scheduledAmount, { allowZero: true });
  }

  if (installment.paidAmount !== undefined) {
    validateAmount(installment.paidAmount, { allowZero: true });
  }

  if (installment.advanceAppliedAmount !== undefined) {
    validateAmount(installment.advanceAppliedAmount, { allowZero: true });
  }

  if (
    installment.status !== undefined &&
    !(INSTALLMENT_STATUSES as readonly string[]).includes(
      installment.status
    )
  ) {
    throw new BizBookError(
      "INVALID_STATUS",
      "Installment status is not supported.",
      { index, status: installment.status }
    );
  }

  if (installment.dueDate) {
    validateDate(installment.dueDate, "Installment due date");
  }

  if (installment.paidAt) {
    if (Number.isNaN(Date.parse(installment.paidAt))) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Installment payment date is invalid.",
        { index, paidAt: installment.paidAt }
      );
    }
  }
}

/* =========================================================
   PAYMENT VALIDATION
========================================================= */

export function validatePaymentMethod(
  method: PaymentMethod
): void {
  if (
    !(DEFAULT_PAYMENT_METHODS as readonly string[]).includes(method) &&
    method !== "Cheque"
  ) {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Selected payment method is not supported.",
      { method }
    );
  }
}

/**
 * Validate an installment allocation.
 */
export function validateInstallmentAllocation(
  requestedAmount: number,
  remainingAmount: number
): void {
  validateAmount(requestedAmount);
  validateAmount(remainingAmount, { allowZero: true });

  const requestedPaise = toPaise(requestedAmount);
  const remainingPaise = toPaise(remainingAmount);

  if (requestedPaise > remainingPaise) {
    throw new BizBookError(
      "ALLOCATION_EXCEEDS_BALANCE",
      "Payment allocation exceeds the installment's remaining balance.",
      { requestedAmount, remainingAmount }
    );
  }
}

/* =========================================================
   STAFF VALIDATION
========================================================= */

export function validateStaff(staff: StaffMember): void {
  if (!staff || typeof staff !== "object") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Staff information is missing."
    );
  }

  if (staff.id !== undefined && !isNonEmptyString(staff.id)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Staff ID cannot be empty."
    );
  }

  if (staff.name !== undefined && !isNonEmptyString(staff.name)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Staff name cannot be empty."
    );
  }

  if (staff.monthlySalary !== undefined) {
    validateAmount(staff.monthlySalary, { allowZero: true });
  }

  if (staff.perDayLeaveCut !== undefined) {
    validateAmount(staff.perDayLeaveCut, { allowZero: true });
  }

  if (staff.joiningDate) {
    validateDate(staff.joiningDate, "Joining date");
  }

  if (
    staff.salaryCalculationMode !== undefined &&
    !(SALARY_CALCULATION_MODES as readonly string[]).includes(
      staff.salaryCalculationMode
    )
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Salary calculation mode is not supported.",
      {
        staffId: staff.id,
        mode: staff.salaryCalculationMode,
      }
    );
  }
}

/* =========================================================
   ATTENDANCE VALIDATION
========================================================= */

export function validateAttendanceStatus(
  status: string
): void {
  if (
    !(ATTENDANCE_STATUSES as readonly string[]).includes(status)
  ) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Attendance status is not supported.",
      { status }
    );
  }
}

export function validateAttendanceInput(
  input: AttendanceInput
): void {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Attendance information is missing."
    );
  }

  if (!isNonEmptyString(input.staffId)) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Staff ID is required for attendance."
    );
  }

  validateDate(input.date, "Attendance date");
  validateAttendanceStatus(input.status);

  if (
    input.note !== undefined &&
    typeof input.note !== "string"
  ) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Attendance note must be text."
    );
  }
}

export function validateAttendanceRecord(
  record: AttendanceRecord
): void {
  validateAttendanceInput(record);
}

/* =========================================================
   SALARY VALIDATION
========================================================= */

export function validateSalaryCalculationMode(
  mode: SalaryCalculationMode
): void {
  if (
    !(SALARY_CALCULATION_MODES as readonly string[]).includes(mode)
  ) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Salary calculation mode is not supported.",
      { mode }
    );
  }
}

export function validateSalaryCalculationInput(
  input: SalaryCalculationInput
): void {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "INVALID_SALARY",
      "Salary calculation information is missing."
    );
  }

  if (!isNonEmptyString(input.staffId)) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Staff ID is required for salary calculation."
    );
  }

  validatePayrollMonth(input.month);
  validateAmount(input.monthlySalary, { allowZero: true });
  validateSalaryCalculationMode(input.mode);

  if (input.perDayLeaveCut !== undefined) {
    validateAmount(input.perDayLeaveCut, { allowZero: true });
  }

  if (input.manualAdjustment !== undefined) {
    if (
      typeof input.manualAdjustment !== "number" ||
      !Number.isFinite(input.manualAdjustment)
    ) {
      throw new BizBookError(
        "INVALID_SALARY",
        "Manual salary adjustment must be a valid number.",
        { manualAdjustment: input.manualAdjustment }
      );
    }

    // Negative adjustments are allowed to represent deductions.
    toPaise(Math.abs(input.manualAdjustment));
  }

  if (input.joiningDate) {
    validateDate(input.joiningDate, "Joining date");
  }

  if (input.attendance !== undefined) {
    if (
      typeof input.attendance !== "object" ||
      input.attendance === null ||
      Array.isArray(input.attendance)
    ) {
      throw new BizBookError(
        "INVALID_SALARY",
        "Attendance data must be a record map."
      );
    }

    for (const [key, status] of Object.entries(input.attendance)) {
      if (typeof status !== "string") {
        throw new BizBookError(
          "INVALID_ATTENDANCE",
          "Attendance contains an invalid status value.",
          { key, status }
        );
      }

      validateAttendanceStatus(status);
    }
  }
}

/* =========================================================
   SALARY PAYMENT INPUT VALIDATION
========================================================= */

export function validateSalaryPaymentInput(
  input: SalaryPaymentInput
): void {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "INVALID_SALARY",
      "Salary payment information is missing."
    );
  }

  if (!isNonEmptyString(input.staffId)) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Staff ID is required for a salary payment."
    );
  }

  validatePayrollMonth(input.month);
  validateAmount(input.amount, { allowZero: true });
  validatePaymentMethod(input.method);

  if (Number.isNaN(Date.parse(input.paidAt))) {
    throw new BizBookError(
      "INVALID_SALARY",
      "Salary payment date is invalid.",
      { paidAt: input.paidAt }
    );
  }

  if (input.salaryCalculationMode !== undefined) {
    validateSalaryCalculationMode(input.salaryCalculationMode);
  }

  if (input.attendanceDeduction !== undefined) {
    validateAmount(input.attendanceDeduction, { allowZero: true });
  }

  if (input.manualAdjustment !== undefined) {
    if (
      typeof input.manualAdjustment !== "number" ||
      !Number.isFinite(input.manualAdjustment)
    ) {
      throw new BizBookError(
        "INVALID_SALARY",
        "Manual salary adjustment must be a valid number.",
        { manualAdjustment: input.manualAdjustment }
      );
    }
  }
}

/* =========================================================
   EXPENSE VALIDATION
========================================================= */

export function validateExpenseInput(
  input: ExpenseInput
): void {
  if (!input || typeof input !== "object") {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense information is missing."
    );
  }

  if (!isNonEmptyString(input.title)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense title is required."
    );
  }

  if (!isNonEmptyString(input.category)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense category is required."
    );
  }

  validateAmount(input.amount);
  validateDate(input.date, "Expense date");
  validatePaymentMethod(input.method);

  if (
    input.notes !== undefined &&
    typeof input.notes !== "string"
  ) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense notes must be text."
    );
  }
}

export function validateExpenseRecord(
  expense: ExpenseRecord
): void {
  if (!expense || typeof expense !== "object") {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense record is missing."
    );
  }

  if (!isNonEmptyString(expense.id)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense ID is required."
    );
  }

  validateExpenseInput(expense);
}
