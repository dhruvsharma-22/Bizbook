import assert from "node:assert/strict";
import { calculatePayrollPayable } from "./payroll";

const tests = [
  {
    name: "attendance deductions are counted once in exact paise",
    run() {
      const result = calculatePayrollPayable({
        monthly_salary: 25000,
        manual_payable_amount: null,
        per_day_leave_cut: 500.25,
        salary_calculation_mode: "AttendanceBased",
        attendance_enabled: true,
        joining_date: "2026-01-01",
      }, [
        { attendance_date: "2026-10-02", status: "Absent" },
        { attendance_date: "2026-10-03", status: "Leave" },
        { attendance_date: "2026-10-04", status: "Present" },
      ], "2026-10");
      assert.deepEqual(result, { amountCents: 2399950, attendanceDeductionCents: 100050, unpaidDays: 2 });
    },
  },
  {
    name: "records before joining date do not reduce payroll",
    run() {
      const result = calculatePayrollPayable({
        monthly_salary: 10000,
        manual_payable_amount: null,
        per_day_leave_cut: 100,
        salary_calculation_mode: "AttendanceBased",
        attendance_enabled: true,
        joining_date: "2026-10-15",
      }, [
        { attendance_date: "2026-10-14", status: "Absent" },
        { attendance_date: "2026-10-15", status: "Absent" },
      ], "2026-10");
      assert.deepEqual(result, { amountCents: 990000, attendanceDeductionCents: 10000, unpaidDays: 1 });
    },
  },
  {
    name: "manual payable amount overrides salary and attendance calculation",
    run() {
      const result = calculatePayrollPayable({
        monthly_salary: 20000,
        manual_payable_amount: 12345.67,
        per_day_leave_cut: 500,
        salary_calculation_mode: "AttendanceBased",
        attendance_enabled: true,
        joining_date: null,
      }, [{ attendance_date: "2026-10-01", status: "Absent" }], "2026-10");
      assert.deepEqual(result, { amountCents: 1234567, attendanceDeductionCents: 0, unpaidDays: 0 });
    },
  },
  {
    name: "fixed or attendance-disabled staff do not receive attendance deductions",
    run() {
      for (const staff of [
        { monthly_salary: 1000, manual_payable_amount: null, per_day_leave_cut: 100, salary_calculation_mode: "Fixed" as const, attendance_enabled: true, joining_date: null },
        { monthly_salary: 1000, manual_payable_amount: null, per_day_leave_cut: 100, salary_calculation_mode: "AttendanceBased" as const, attendance_enabled: false, joining_date: null },
      ]) {
        assert.deepEqual(calculatePayrollPayable(staff, [{ attendance_date: "2026-10-01", status: "Leave" }], "2026-10"), {
          amountCents: 100000, attendanceDeductionCents: 0, unpaidDays: 0,
        });
      }
    },
  },
  {
    name: "payable cannot fall below zero and invalid month is rejected",
    run() {
      assert.equal(calculatePayrollPayable({
        monthly_salary: 50, manual_payable_amount: null, per_day_leave_cut: 100,
        salary_calculation_mode: "AttendanceBased", attendance_enabled: true, joining_date: null,
      }, [{ attendance_date: "2026-10-01", status: "Absent" }], "2026-10").amountCents, 0);
      assert.throws(() => calculatePayrollPayable({
        monthly_salary: 1, manual_payable_amount: null, per_day_leave_cut: 0,
        salary_calculation_mode: "Fixed", attendance_enabled: false, joining_date: null,
      }, [], "2026-13"));
    },
  },
  {
    name: "shared payroll uses the BizBook Brain calculation and rejects fractional paise",
    run() {
      assert.equal(calculatePayrollPayable({
        id: "staff-1",
        monthly_salary: "10000.00",
        manual_payable_amount: null,
        per_day_leave_cut: "100.25",
        salary_calculation_mode: "AttendanceBased",
        attendance_enabled: true,
        joining_date: null,
      }, [{ attendance_date: "2026-10-01", status: "Absent" }], "2026-10").amountCents, 989975);
      assert.throws(() => calculatePayrollPayable({
        monthly_salary: "100.001",
        manual_payable_amount: null,
        per_day_leave_cut: "0",
        salary_calculation_mode: "Fixed",
        attendance_enabled: false,
        joining_date: null,
      }, [], "2026-10"), /fractional paise/);
    },
  },
  {
    name: "shared payroll rejects malformed attendance instead of omitting deductions",
    run() {
      assert.throws(() => calculatePayrollPayable({
        monthly_salary: 10000,
        manual_payable_amount: null,
        per_day_leave_cut: 100,
        salary_calculation_mode: "AttendanceBased",
        attendance_enabled: true,
        joining_date: null,
      }, [{ attendance_date: "2026-10-01", status: "Unpaid" }], "2026-10"), /unsupported status/);
      assert.throws(() => calculatePayrollPayable({
        monthly_salary: 10000,
        manual_payable_amount: null,
        per_day_leave_cut: 100,
        salary_calculation_mode: "AttendanceBased",
        attendance_enabled: true,
        joining_date: null,
      }, [
        { attendance_date: "2026-10-01", status: "Absent" },
        { attendance_date: "2026-10-01", status: "Leave" },
      ], "2026-10"), /duplicate staff date/);
    },
  },
];

let failed = 0;
for (const test of tests) {
  try { test.run(); console.log(`PASS: ${test.name}`); }
  catch (error) { failed += 1; console.error(`FAIL: ${test.name}`); console.error(error); }
}
console.log(`Payroll calculation tests: ${tests.length - failed}/${tests.length} passed.`);
if (failed) process.exitCode = 1;
