import {
  installmentLegacyData,
  mapSharedStudent,
  studentLegacyData,
  toStudentRecordInput,
} from "./student-records";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const row = {
  id: "student-a",
  institute_id: "institute-a",
  branch_id: "branch-a",
  name: "Asha",
  gender: "Female" as const,
  parent_name: "Parent",
  parent_email: null,
  parent_email_opt_in: false,
  whatsapp_opt_in: true,
  parent_mobile: "9876543210",
  whatsapp: "9876543210",
  course: "Maths",
  class_name: null,
  admission_date: "2026-10-01",
  total_fee: 1200,
  admission_fee: 200,
  legacy_data: { preferredLanguage: "Hindi", oldImportMarker: { source: "legacy" } },
};

const balances = [
  {
    installment_id: "admission-fee", institute_id: "institute-a", branch_id: "branch-a",
    student_id: "student-a", sequence_number: 0, scheduled_amount: 200, due_date: "2026-10-01",
    scheduled_status: "Partially Paid" as const, paid_amount: 50, outstanding_amount: 150,
    balance_status: "Partially Paid" as const, legacy_data: { kind: "AdmissionFee" },
  },
  {
    installment_id: "installment-2", institute_id: "institute-a", branch_id: "branch-a",
    student_id: "student-a", sequence_number: 2, scheduled_amount: 500, due_date: "2026-11-01",
    scheduled_status: "Pending" as const, paid_amount: 125, outstanding_amount: 375,
    balance_status: "Partially Paid" as const, legacy_data: { originalCycle: "B" },
  },
  {
    installment_id: "installment-1", institute_id: "institute-a", branch_id: "branch-a",
    student_id: "student-a", sequence_number: 1, scheduled_amount: 500, due_date: "2026-10-01",
    scheduled_status: "Paid" as const, paid_amount: 500, outstanding_amount: 0,
    balance_status: "Paid" as const, legacy_data: { originalCycle: "A" },
  },
  {
    installment_id: "cancelled", institute_id: "institute-a", branch_id: "branch-a",
    student_id: "student-a", sequence_number: 3, scheduled_amount: 0, due_date: null,
    scheduled_status: "Cancelled" as const, paid_amount: 0, outstanding_amount: 0,
    balance_status: "Cancelled" as const, legacy_data: {},
  },
  {
    installment_id: "other-student", institute_id: "institute-a", branch_id: "branch-a",
    student_id: "student-b", sequence_number: 1, scheduled_amount: 25, due_date: null,
    scheduled_status: "Pending" as const, paid_amount: 0, outstanding_amount: 25,
    balance_status: "Pending" as const, legacy_data: {},
  },
];

const student = mapSharedStudent(row, balances);
assert(student.preferredLanguage === "Hindi", "unknown student fields survive database mapping");
assert(student.oldImportMarker !== undefined, "nested legacy fields survive database mapping");
assert(student.admissionInstallmentId === "admission-fee", "admission fee has a distinct schedule entry");
assert(student.admissionPaidAmount === 50, "partial admission fee payments remain visible");
assert(student.admissionOutstandingAmount === 150, "admission fee balance remains accurate");
assert(student.admissionStatus === "Partially Paid", "admission fee status reflects partial payment");
assert(student.installments.length === 2, "cancelled and cross-student installments are excluded");
assert(student.installments[0].id === "installment-1", "installments are ordered by sequence");
assert(student.installments[1].paidAmount === 125, "partial paid amount is retained from ledger balance");
assert(student.installments[1].outstandingAmount === 375, "partial outstanding balance is retained");
assert(student.installments[1].status === "Partially Paid", "partial installment state is represented accurately");

const encoded = studentLegacyData({
  ...student,
  newUnknownField: "kept",
  collectedAmount: 700,
  legacyData: { historicFlag: true },
});
assert(encoded.preferredLanguage === "Hindi", "existing legacy fields remain in database payload");
assert(encoded.newUnknownField === "kept", "new unknown student fields remain in database payload");
assert(encoded.historicFlag === true, "an existing legacy_data object is preserved in database payload");
assert(!("collectedAmount" in encoded) && !("admissionPaidAmount" in encoded), "derived financial fields are not persisted into legacy data");

const encodedInstallment = installmentLegacyData({
  id: "i", amount: 100, dueDate: "2026-11-01", status: "Partially Paid",
  paidAmount: 25, outstandingAmount: 75, existingExtra: "kept", legacyData: { importedTag: 7 },
});
assert(encodedInstallment.importedTag === 7 && encodedInstallment.existingExtra === "kept", "unknown installment fields survive edits");

const recordInput = toStudentRecordInput({ ...student, installments: student.installments });
assert(recordInput.installments[0].sequenceNumber === 1, "schedule sequence is explicit and ordered");
assert(recordInput.installments[1].legacyData !== undefined, "nested legacy fields are sent with each installment");
assert((recordInput.student.legacyData as Record<string, unknown>).preferredLanguage === "Hindi", "student legacy payload remains intact");

console.log("Student record mapping tests: 19 assertions passed.");
