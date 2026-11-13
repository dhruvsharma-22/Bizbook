import assert from "node:assert/strict";
import { previewLegacyStudentImports } from "./student-import";

function memoryStorage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

const cleanStudent = {
  id: "legacy-student-1",
  name: "Aarav",
  gender: "M",
  parentName: "Parent",
  parentMobile: "9876543210",
  course: "Mathematics",
  totalFee: "100.00",
  admissionFee: "20.00",
  admissionDate: "2026-01-01",
  installments: [{ id: "old-i1", amount: "40.00", dueDate: "2026-02-01", status: "Pending" }, { id: "old-i2", amount: "40.00", dueDate: "2026-03-01" }],
};

const clean = previewLegacyStudentImports(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ students: [cleanStudent], staff: [] }),
}));
assert.equal(clean.issue, null);
assert.equal(clean.candidates.length, 1);
assert.equal(clean.candidates[0].eligible, true);
assert.equal(clean.candidates[0].totalFeePaise, 10_000);
assert.equal(clean.candidates[0].scheduleTotalPaise, 8_000);
assert.equal(clean.candidates[0].installments.length, 2);
assert.equal(clean.candidates[0].student && typeof clean.candidates[0].student === "object" && !Array.isArray(clean.candidates[0].student) ? clean.candidates[0].student.parentEmailOptIn : null, false);
assert.equal(JSON.stringify(clean.candidates[0].student).includes("9876543210"), true);
assert.equal("payments" in (clean.candidates[0].student as Record<string, unknown>), false);

function candidateFor(student: unknown, transactions: Record<string, unknown[]> = {}) {
  const values: Record<string, string> = { "bizbook-students-staff-v1": JSON.stringify({ students: [student] }) };
  for (const [key, rows] of Object.entries(transactions)) values[key] = JSON.stringify(rows);
  return previewLegacyStudentImports(memoryStorage(values)).candidates[0];
}

assert.equal(candidateFor({ ...cleanStudent, collectedAmount: "0.00" }).eligible, true);
assert.match(candidateFor({ ...cleanStudent, collectedAmount: "10.00" }).reason ?? "", /payment or receipt claim/);
assert.match(candidateFor({ ...cleanStudent, installments: [{ amount: 80, paidAmount: 1 }] }).reason ?? "", /schedule total|paid-amount/);
assert.match(candidateFor({ ...cleanStudent, installments: [{ amount: 80, status: "Paid" }] }).reason ?? "", /installment status/);
assert.match(candidateFor({ ...cleanStudent, totalFee: "100.001" }).reason ?? "", /valid INR amounts/);
assert.match(candidateFor({ ...cleanStudent, totalFee: "100", installments: [{ amount: 79.99 }] }).reason ?? "", /exactly equal/);
assert.match(candidateFor({ ...cleanStudent, admissionDate: "2026-02-30" }).reason ?? "", /admission date is invalid/);
assert.match(candidateFor({ ...cleanStudent, parentMobile: "+91 9876543210" }).reason ?? "", /10-digit number/);
assert.match(candidateFor({ ...cleanStudent, branchId: "old-branch" }).reason ?? "", /explicit source-to-target mapping/);
assert.match(candidateFor({ ...cleanStudent, outstandingAmount: 50 }).reason ?? "", /conflicts with a fully unpaid schedule/);
assert.match(candidateFor({ ...cleanStudent }, { "bizbook-fee-receipts-v1": [{ id: "r1", studentId: "legacy-student-1", amount: 1 }] }).reason ?? "", /references this student/);
assert.match(candidateFor({ ...cleanStudent }, { "bizbook-fee-receipts-v1": [{ id: "r1", amount: 1 }] }).reason ?? "", /without a student mapping/);
assert.match(candidateFor({ ...cleanStudent }, { "bizbook-fee-receipts-v1": [{ id: "r1", studentId: "unknown-student", amount: 1 }] }).reason ?? "", /without a student mapping/);
assert.match(candidateFor({ ...cleanStudent }, { "bizbook-refunds-v1": [{ id: "refund-1", amount: 1 }] }).reason ?? "", /without a student mapping/);
assert.match(candidateFor({ ...cleanStudent, payments: [{ amount: 1 }] }).reason ?? "", /Nested payment/);
assert.match(candidateFor({ ...cleanStudent, status: "Paid" }).reason ?? "", /paid or refunded status/);
assert.match(candidateFor({ ...cleanStudent, paymentStatus: "Processing" }).reason ?? "", /payment status needs reconciliation/);
assert.match(candidateFor({ ...cleanStudent, id: "" }).reason ?? "", /stable legacy student ID/);
assert.match(candidateFor({ ...cleanStudent }, { "bizbook-fee-receipts-v1": [null] }).reason ?? "", /without a student mapping/);

const duplicate = previewLegacyStudentImports(memoryStorage({
  "bizbook-students-staff-v1": JSON.stringify({ students: [cleanStudent, cleanStudent] }),
}));
assert.equal(duplicate.candidates.every((candidate) => !candidate.eligible), true);
assert.match(duplicate.candidates[0].reason ?? "", /appears more than once/);

const malformed = previewLegacyStudentImports(memoryStorage({ "bizbook-students-staff-v1": "not-json" }));
assert.match(malformed.issue ?? "", /malformed/);
const readError = previewLegacyStudentImports({ getItem: () => { throw new Error("sensitive storage error"); } });
assert.doesNotMatch(readError.issue ?? "", /sensitive storage error/);
const absent = previewLegacyStudentImports(memoryStorage({}));
assert.equal(absent.candidates.length, 0);
console.log("Legacy student import review: 27 assertions passed.");
