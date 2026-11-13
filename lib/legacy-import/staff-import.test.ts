import assert from "node:assert/strict";
import { previewLegacyStaffImports } from "./staff-import";

const cleanStaff = {
  id: "legacy-staff-1",
  name: "Meera Sharma",
  gender: "Female",
  mobile: "9876543210",
  whatsapp: "9876543210",
  designation: "Teacher",
  joiningDate: "2025-06-01",
  monthlySalary: "25000.00",
  paymentDate: 5,
  deductionPerDay: "250.00",
  attendanceEnabled: true,
  salaryCalculationMode: "AttendanceBased",
};

function memoryStorage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

function preview(staff: unknown, other: Record<string, unknown> = {}) {
  return previewLegacyStaffImports(memoryStorage({
    "bizbook-students-staff-v1": JSON.stringify({ students: [], staff: [staff] }),
    ...Object.fromEntries(Object.entries(other).map(([key, value]) => [key, JSON.stringify(value)])),
  }));
}

const valid = preview(cleanStaff);
assert.equal(valid.issue, null);
assert.equal(valid.candidates.length, 1);
assert.equal(valid.candidates[0].eligible, true);
assert.equal(valid.candidates[0].monthlySalaryPaise, 2_500_000);
assert.equal(valid.candidates[0].perDayLeaveCutPaise, 25_000);
assert.equal(valid.candidates[0].paymentDay, 5);
assert.equal(valid.candidates[0].attendanceEnabled, true);
assert.equal(valid.candidates[0].salaryCalculationMode, "AttendanceBased");

const nested = previewLegacyStaffImports(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ data: { students: [], staff: [cleanStaff] } }),
}));
assert.equal(nested.candidates[0].eligible, true);
const malformedNested = previewLegacyStaffImports(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ data: { staff: "not-an-array" }, staff: [cleanStaff] }),
}));
assert.match(malformedNested.issue ?? "", /legacy staff field is not an array/);

const noStaff = previewLegacyStaffImports(memoryStorage({ "bizbook-students-staff-v1": JSON.stringify({ students: [] }) }));
assert.equal(noStaff.candidates.length, 0);
assert.equal(noStaff.issue, null);

function blocked(row: unknown, pattern: RegExp, other: Record<string, unknown> = {}) {
  const candidate = preview(row, other).candidates[0];
  assert.equal(candidate.eligible, false);
  assert.match(candidate.reason ?? "", pattern);
}

blocked({ ...cleanStaff, id: "" }, /stable legacy staff ID/);
blocked({ ...cleanStaff, name: " " }, /valid staff name/);
blocked({ ...cleanStaff, designation: "" }, /valid staff designation/);
blocked({ ...cleanStaff, branchId: "legacy-branch" }, /explicit source-to-target mapping/);
blocked({ ...cleanStaff, branch: { id: "legacy-branch" } }, /explicit source-to-target mapping/);
blocked({ ...cleanStaff, monthlySalary: "25000.001" }, /monthly compensation/);
blocked({ ...cleanStaff, monthlySalary: "10000000000.00" }, /monthly compensation/);
blocked({ ...cleanStaff, mobile: "+91 9876543210" }, /mobile must be a 10-digit/);
blocked({ ...cleanStaff, gender: "Unknown" }, /gender value is unsupported/);
blocked({ ...cleanStaff, joiningDate: "2025-02-30" }, /joining date is invalid/);
blocked({ ...cleanStaff, paymentDate: 32 }, /payment day/);
blocked({ ...cleanStaff, deductionPerDay: "1.005" }, /exact-paise/);
blocked({ ...cleanStaff, manualPayableAmount: "25000.001" }, /manual payable setting/);
blocked({ ...cleanStaff, salaryCalculationMode: "Automatic" }, /calculation mode/);
blocked({ ...cleanStaff, attendanceEnabled: true, salaryCalculationMode: "Fixed" }, /attendance flag and salary calculation mode conflict/);
blocked({ ...cleanStaff, paidAmount: "1.00" }, /salary-paid amount/);
blocked({ ...cleanStaff, salaryStatus: "Paid" }, /salary status is not proof/);
blocked({ ...cleanStaff, unpaidLeaveDays: 1 }, /attendance-derived leave/);
blocked({ ...cleanStaff, attendanceHistory: [{ date: "2025-01-01" }] }, /Nested attendance or salary history/);
blocked(cleanStaff, /Attendance or salary-payment history/, {
  "bizbook-staff-attendance-v1": { "legacy-staff-1__2025-02-01": "Present" },
});
blocked(cleanStaff, /Attendance or salary-payment history/, {
  "bizbook-salary-payments-v1": [{ staffId: "legacy-staff-1", amount: 1000 }],
});

const attendanceUnlinked = preview(cleanStaff, {
  "bizbook-staff-attendance-v1": { "unknown-staff__2025-02-01": "Present" },
});
assert.match(attendanceUnlinked.issue ?? "", /not present in the staff directory/);

const invalidAttendanceDate = preview(cleanStaff, {
  "bizbook-staff-attendance-v1": { "legacy-staff-1__2025-02-30": "Present" },
});
assert.match(invalidAttendanceDate.issue ?? "", /unmappable staff or date/);

const invalidAttendanceStatus = preview(cleanStaff, {
  "bizbook-staff-attendance-v1": { "legacy-staff-1__2025-02-01": "Unknown" },
});
assert.match(invalidAttendanceStatus.issue ?? "", /unmappable staff or date/);

const malformedSalaryHistory = preview(cleanStaff, { "bizbook-salary-payments-v1": { row: 1 } });
assert.match(malformedSalaryHistory.issue ?? "", /unsupported shape/);

const unmappedSalaryHistory = preview(cleanStaff, {
  "bizbook-salary-payments-v1": [{ amount: "5000.00" }],
});
assert.match(unmappedSalaryHistory.issue ?? "", /not present in the staff directory/);

const malformedSalaryRow = preview(cleanStaff, { "bizbook-salary-payments-v1": [null] });
assert.match(malformedSalaryRow.issue ?? "", /salary-payment row is malformed/);

const duplicate = previewLegacyStaffImports(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ staff: [cleanStaff, cleanStaff] }),
}));
assert.equal(duplicate.candidates.every((candidate) => !candidate.eligible), true);
assert.match(duplicate.candidates[0].reason ?? "", /appears more than once/);

const malformedSource = previewLegacyStaffImports(memoryStorage({ "bizbook-students-staff-v1": "not-json" }));
assert.match(malformedSource.issue ?? "", /staff source is malformed/);

const malformedField = previewLegacyStaffImports(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ staff: "not-an-array" }),
}));
assert.match(malformedField.issue ?? "", /legacy staff field is not an array/);

const absent = previewLegacyStaffImports(memoryStorage({}));
assert.equal(absent.candidates.length, 0);
assert.equal(absent.issue, null);

const readFailure = previewLegacyStaffImports({ getItem: () => { throw new Error("private storage detail"); } });
assert.doesNotMatch(readFailure.issue ?? "", /private storage detail/);

console.log("Legacy staff import review passed.");
