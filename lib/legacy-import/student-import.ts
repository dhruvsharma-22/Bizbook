import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import { LEGACY_SOURCES, MAX_LEGACY_SOURCE_BYTES } from "./preview";

type UnknownRecord = Record<string, unknown>;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json | undefined };

const STUDENT_SOURCE_KEY = "bizbook-students-staff-v1";
const FINANCIAL_KEYS = [
  "bizbook-fee-receipts-v1",
  "bizbook-advance-payments-v1",
  "bizbook-payment-history-v1",
  "bizbook-payment-records-v1",
  "bizbook-refunds-v1",
] as const;

export type LegacyStudentImportCandidate = {
  sourceRecordId: string;
  name: string;
  parentName: string;
  parentEmail: string;
  parentMobile: string;
  whatsapp: string;
  course: string;
  totalFeePaise: number;
  scheduleTotalPaise: number;
  student: Json;
  installments: Json[];
  originalRecord: UnknownRecord;
  eligible: boolean;
  reason: string | null;
};

export type LegacyStudentImportPreview = {
  candidates: LegacyStudentImportCandidate[];
  issue: string | null;
};

type StorageReader = Pick<Storage, "getItem">;

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function strictPaise(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  return parseAmountInputToPaise(String(value));
}

function strictDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === text ? text : null;
}

function extractStudents(value: unknown): { rows: unknown[]; issue: string | null } {
  if (Array.isArray(value)) return { rows: value, issue: null };
  if (!record(value)) return { rows: [], issue: "The students/staff value is not a supported object." };
  if (value.students !== undefined && !Array.isArray(value.students)) {
    return { rows: [], issue: "The legacy students field is not an array; no records were imported." };
  }
  return { rows: Array.isArray(value.students) ? value.students : [], issue: null };
}

function referencedStudentId(value: UnknownRecord): string {
  const direct = firstString(value, ["studentId", "student_id", "studentID", "learnerId", "learner_id"]);
  if (direct) return direct;
  if (record(value.student)) return firstString(value.student, ["id", "studentId", "student_id"]);
  return "";
}

function inspectRelatedFinancialHistory(storage: StorageReader): {
  referencedStudentIds: Set<string>;
  unlinkedCount: number;
  issue: string | null;
} {
  const referencedStudentIds = new Set<string>();
  let unlinkedCount = 0;
  for (const key of FINANCIAL_KEYS) {
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      return { referencedStudentIds, unlinkedCount, issue: "Financial legacy history could not be read safely." };
    }
    if (raw === null) continue;
    if (new TextEncoder().encode(raw).byteLength > MAX_LEGACY_SOURCE_BYTES) {
      return { referencedStudentIds, unlinkedCount, issue: "A financial legacy source exceeds the supported review size." };
    }
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { referencedStudentIds, unlinkedCount, issue: "A financial legacy source is malformed; student import is blocked." };
    }
    if (!Array.isArray(value)) {
      return { referencedStudentIds, unlinkedCount, issue: "A financial legacy source is not a supported array." };
    }
    for (const row of value) {
      if (!record(row)) {
        unlinkedCount += 1;
        continue;
      }
      const studentId = referencedStudentId(row);
      if (studentId) referencedStudentIds.add(studentId);
      else unlinkedCount += 1;
    }
  }
  return { referencedStudentIds, unlinkedCount, issue: null };
}

function financialClaimIssue(student: UnknownRecord): string | null {
  const paidFields = [
    "collectedAmount", "totalCollected", "paidAmount", "totalPaid", "feePaid", "admissionPaidAmount",
    "receiptCount", "totalReceived", "receivedAmount", "advanceAmount", "refundedAmount",
  ];
  for (const key of paidFields) {
    if (student[key] === undefined || student[key] === null || student[key] === "") continue;
    const value = strictPaise(student[key]);
    if (value === null) return "A legacy paid/receipt field has an invalid amount.";
    if (value !== 0) return "This student has a legacy payment or receipt claim that needs reconciliation first.";
  }
  for (const key of ["payments", "receipts", "paymentHistory", "feeReceipts", "advancePayments", "refunds", "transactions"]) {
    const value = student[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value) || value.length > 0) return "Nested payment, receipt, advance, or refund history needs reconciliation first.";
  }
  const status = firstString(student, ["status", "paymentStatus", "payment_status", "admissionStatus", "admission_status"]).toLowerCase();
  if (["paid", "partially paid", "partially_paid", "refunded", "partially refunded"].includes(status)) {
    return "A legacy paid or refunded status is not proof of a verified balance.";
  }
  const paymentStatus = firstString(student, ["paymentStatus", "payment_status"]).toLowerCase();
  if (paymentStatus && !["pending", "unpaid", "not paid"].includes(paymentStatus)) {
    return "A legacy payment status needs reconciliation before importing this student.";
  }
  return null;
}

function makeCandidate(
  value: unknown,
  index: number,
  referencedStudentIds: Set<string>,
  hasUnlinkedFinancialHistory: boolean,
): LegacyStudentImportCandidate {
  const student = record(value) ? value : {};
  const sourceRecordId = firstString(student, ["id", "studentId", "student_id"]);
  const name = firstString(student, ["name", "studentName"]);
  const course = firstString(student, ["course", "courseName"]);
  const parentName = firstString(student, ["parentName", "parent_name", "guardianName", "guardian_name"]);
  const parentEmail = firstString(student, ["parentEmail", "parent_email"]);
  const parentMobile = firstString(student, ["parentMobile", "parent_mobile", "mobile"]);
  const whatsapp = firstString(student, ["whatsapp", "parentWhatsapp", "parent_whatsapp"]);
  const block = (reason: string): LegacyStudentImportCandidate => ({
    sourceRecordId: sourceRecordId || `row-${index + 1}`,
    name: name || "Unnamed legacy row",
    parentName,
    parentEmail,
    parentMobile,
    whatsapp,
    course,
    totalFeePaise: 0,
    scheduleTotalPaise: 0,
    student: null,
    installments: [],
    originalRecord: student,
    eligible: false,
    reason,
  });

  if (!record(value)) return block("This legacy row is not an object.");
  if (!sourceRecordId || sourceRecordId.length > 100) return block("A stable legacy student ID is required.");
  if (!name || name.length > 100) return block("A valid student name is required.");
  if (!course || course.length > 200) return block("A valid course is required.");
  if (firstString(student, ["branchId", "branch_id", "branch"])) return block("The legacy branch needs an explicit source-to-target mapping before import.");
  if (hasUnlinkedFinancialHistory) return block("Financial history exists without a student mapping; map that history before importing students.");
  if (referencedStudentIds.has(sourceRecordId)) return block("A legacy receipt or refund references this student; reconcile it before importing the student.");
  const claimIssue = financialClaimIssue(student);
  if (claimIssue) return block(claimIssue);

  const totalFeePaise = strictPaise(student.totalFee ?? student.total_fee);
  const admissionFeePaise = student.admissionFee === undefined && student.admission_fee === undefined
    ? 0
    : strictPaise(student.admissionFee ?? student.admission_fee);
  if (totalFeePaise === null || totalFeePaise <= 0 || admissionFeePaise === null || admissionFeePaise < 0 || admissionFeePaise > totalFeePaise) {
    return block("Total fee and admission fee must be valid INR amounts with paise precision.");
  }
  for (const key of ["outstandingAmount", "outstanding_amount", "remainingBalance", "remaining_balance"]) {
    if (student[key] === undefined || student[key] === null || student[key] === "") continue;
    const outstandingPaise = strictPaise(student[key]);
    if (outstandingPaise === null || outstandingPaise !== totalFeePaise) return block("The legacy outstanding balance conflicts with a fully unpaid schedule.");
  }

  const installmentRows = student.installments ?? student.installmentSchedule ?? student.installment_schedule;
  if (installmentRows !== undefined && !Array.isArray(installmentRows)) return block("The installment schedule is not an array.");
  const rows = Array.isArray(installmentRows) ? installmentRows : [];
  if (rows.length > 120) return block("The schedule exceeds the supported 120 installments.");
  const targetInstallments: Json[] = [];
  let scheduleTotalPaise = 0;
  for (const [sequence, row] of rows.entries()) {
    if (!record(row)) return block("An installment row is malformed.");
    const amountPaise = strictPaise(row.amount ?? row.scheduledAmount ?? row.scheduled_amount);
    if (amountPaise === null || amountPaise <= 0) return block("Every scheduled installment must have a positive exact-paise amount.");
    const dueDateValue = row.dueDate ?? row.due_date ?? null;
    const dueDate = strictDate(dueDateValue);
    if (dueDateValue !== null && dueDateValue !== "" && dueDate === null) return block("An installment due date is invalid; expected YYYY-MM-DD.");
    const installmentStatus = firstString(row, ["status", "balanceStatus", "balance_status"]).toLowerCase();
    if (installmentStatus && !["pending", "overdue"].includes(installmentStatus)) {
      return block("A paid, partial, cancelled, or unknown installment status needs reconciliation first.");
    }
    for (const key of ["paidAmount", "paid_amount", "collectedAmount", "collected_amount"]) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
        const paidPaise = strictPaise(row[key]);
        if (paidPaise === null || paidPaise !== 0) return block("An installment has a paid-amount claim that needs reconciliation first.");
      }
    }
    for (const key of ["payments", "receipts", "paymentHistory", "feeReceipts", "advancePayments", "refunds", "transactions"]) {
      if (row[key] !== undefined && row[key] !== null && (!Array.isArray(row[key]) || row[key].length > 0)) {
        return block("An installment contains payment history that needs reconciliation first.");
      }
    }
    scheduleTotalPaise += amountPaise;
    if (!Number.isSafeInteger(scheduleTotalPaise)) return block("The installment schedule total is too large.");
    targetInstallments.push({
      sequenceNumber: sequence + 1,
      amount: amountPaise / 100,
      dueDate,
      legacyData: { sourceKey: STUDENT_SOURCE_KEY, sourceRecordId },
    });
  }
  if (scheduleTotalPaise !== totalFeePaise - admissionFeePaise) {
    return block("Installments must exactly equal the fee remaining after the admission fee.");
  }

  const genderText = firstString(student, ["gender"]).toLowerCase();
  const gender = genderText === "male" || genderText === "m" ? "Male"
    : genderText === "female" || genderText === "f" ? "Female" : "Other";
  if (!parentName || parentName.length > 100) return block("A valid parent or guardian name is required.");
  if (parentEmail && (parentEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail))) return block("The parent email address is invalid.");
  if (parentMobile && !/^\d{10}$/.test(parentMobile)) return block("The parent mobile must be a 10-digit number; map it explicitly before import.");
  if (whatsapp && !/^\d{10}$/.test(whatsapp)) return block("The WhatsApp number must be a 10-digit number; map it explicitly before import.");
  const admissionDateValue = student.admissionDate ?? student.admission_date ?? null;
  const admissionDate = strictDate(admissionDateValue);
  if (admissionDateValue !== null && admissionDateValue !== "" && admissionDate === null) return block("The admission date is invalid; expected YYYY-MM-DD.");

  const normalizedStudent: Json = {
    name,
    gender,
    parentName,
    parentEmail: parentEmail || null,
    parentEmailOptIn: false,
    whatsappOptIn: false,
    parentMobile: parentMobile || null,
    whatsapp: whatsapp || null,
    course,
    className: firstString(student, ["className", "class_name"]) || null,
    admissionDate,
    admissionFee: admissionFeePaise / 100,
    totalFee: totalFeePaise / 100,
    legacyData: { importedFrom: "legacy-browser", sourceKey: STUDENT_SOURCE_KEY, sourceRecordId },
  };
  return {
    sourceRecordId, name, parentName, parentEmail, parentMobile, whatsapp, course, totalFeePaise, scheduleTotalPaise,
    student: normalizedStudent, installments: targetInstallments,
    originalRecord: student,
    eligible: true,
    reason: null,
  };
}

/**
 * Finds only new student master records with a complete unpaid fee schedule.
 * No legacy financial values are carried into the target payload.
 */
export function previewLegacyStudentImports(storage: StorageReader): LegacyStudentImportPreview {
  let raw: string | null;
  try {
    raw = storage.getItem(STUDENT_SOURCE_KEY);
  } catch {
    return { candidates: [], issue: "Browser storage could not be read. No data was changed." };
  }
  if (raw === null) return { candidates: [], issue: null };
  if (new TextEncoder().encode(raw).byteLength > MAX_LEGACY_SOURCE_BYTES) {
    return { candidates: [], issue: "The student source exceeds the supported review size. No data was changed." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { candidates: [], issue: "The student source is malformed. The original browser value was left unchanged." };
  }
  const extracted = extractStudents(parsed);
  if (extracted.issue) return { candidates: [], issue: extracted.issue };
  const related = inspectRelatedFinancialHistory(storage);
  if (related.issue) return { candidates: [], issue: related.issue };
  const knownStudentIds = new Set(extracted.rows.filter(record).map((row) => firstString(row, ["id", "studentId", "student_id"])));
  const hasUnlinkedFinancialHistory = related.unlinkedCount > 0
    || [...related.referencedStudentIds].some((sourceStudentId) => !knownStudentIds.has(sourceStudentId));
  const candidates = extracted.rows.map((row, index) => makeCandidate(
    row, index, related.referencedStudentIds, hasUnlinkedFinancialHistory,
  ));
  const duplicateIds = new Set<string>();
  const idCounts = new Map<string, number>();
  for (const candidate of candidates) idCounts.set(candidate.sourceRecordId, (idCounts.get(candidate.sourceRecordId) ?? 0) + 1);
  for (const candidate of candidates) if (idCounts.get(candidate.sourceRecordId) && idCounts.get(candidate.sourceRecordId)! > 1) duplicateIds.add(candidate.sourceRecordId);
  return {
    candidates: candidates.map((candidate) => duplicateIds.has(candidate.sourceRecordId)
      ? { ...candidate, eligible: false, reason: "This legacy student ID appears more than once." }
      : candidate),
    issue: null,
  };
}

/** Only used by the import UI; the raw legacy value stays in browser memory. */
export function legacyStudentRecordFingerprintInput(candidate: LegacyStudentImportCandidate): string {
  return JSON.stringify(candidate.originalRecord);
}

export function legacyStudentSourceKey(): string {
  return LEGACY_SOURCES[0].key;
}
