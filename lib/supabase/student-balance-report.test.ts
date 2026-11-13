import assert from "node:assert/strict";
import {
  dateInTimeZone,
  groupStudentBalances,
  moneyToMinorUnits,
  type BalanceReportInstallment,
  type BalanceReportStudent,
} from "./student-balance-report";

const students: BalanceReportStudent[] = [
  { id: "s1", name: "Asha", course: "Math", archived_at: null },
  { id: "s2", name: "Bela", course: null, archived_at: "2026-01-01T00:00:00Z" },
];
const balance = (patch: Partial<BalanceReportInstallment>): BalanceReportInstallment => ({
  installment_id: "i1", student_id: "s1", branch_id: "b1", sequence_number: 1,
  scheduled_amount: "100.00", paid_amount: "25.50", outstanding_amount: "74.50",
  due_date: "2026-10-10", scheduled_status: "Partially Paid", ...patch,
});

assert.equal(moneyToMinorUnits("123.45"), 12345);
assert.equal(moneyToMinorUnits(0.1), 10);
assert.equal(moneyToMinorUnits("1.001"), null);
assert.equal(moneyToMinorUnits("-1.00"), null);

const partialOutstanding = groupStudentBalances(students, [balance({})], "outstanding", "2026-10-16");
assert.equal(partialOutstanding[0]?.installments[0]?.outstandingMinor, 7450);
assert.equal(partialOutstanding[0]?.installments[0]?.paidMinor, 2550);

const partialOverdue = groupStudentBalances(students, [balance({})], "overdue", "2026-10-16");
assert.equal(partialOverdue[0]?.installments[0]?.daysOverdue, 6);

assert.equal(groupStudentBalances(students, [balance({ due_date: "2026-10-16" })], "overdue", "2026-10-16").length, 0);
assert.equal(groupStudentBalances(students, [balance({ due_date: null })], "overdue", "2026-10-16").length, 0);
assert.equal(groupStudentBalances(students, [balance({ scheduled_status: "Cancelled" })], "outstanding", "2026-10-16").length, 0);
assert.equal(groupStudentBalances(students, [balance({ outstanding_amount: "0.00" })], "outstanding", "2026-10-16").length, 0);

const archived = groupStudentBalances(students, [balance({ student_id: "s2", installment_id: "i2" })], "outstanding", "2026-10-16");
assert.equal(archived[0]?.archived, true);
assert.equal(archived[0]?.course, "Student fee");

const ordered = groupStudentBalances(students, [
  balance({ installment_id: "later", sequence_number: 2, due_date: "2026-10-20" }),
  balance({ installment_id: "earlier", due_date: "2026-10-01" }),
], "outstanding", "2026-10-16");
assert.deepEqual(ordered[0]?.installments.map((item) => item.id), ["earlier", "later"]);
assert.equal(ordered[0]?.totalMinor, 14900);

assert.equal(dateInTimeZone(new Date("2026-10-15T19:00:00.000Z"), "Asia/Kolkata"), "2026-10-16");

console.log("Student balance report: 13 assertions passed");
