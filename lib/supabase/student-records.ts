type UnknownRecord = Record<string, unknown>;

export type StudentBalanceRow = {
  installment_id: string;
  institute_id: string;
  branch_id: string | null;
  student_id: string;
  sequence_number: number;
  scheduled_amount: number | string;
  due_date: string | null;
  scheduled_status: "Pending" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";
  paid_amount: number | string;
  outstanding_amount: number | string;
  balance_status: "Pending" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";
  legacy_data?: unknown;
};

export type StudentReceiptBalanceRow = {
  institute_id: string;
  branch_id: string | null;
  student_id: string;
  receipt_count: number;
  receipt_total: number | string;
  completed_refund_total: number | string;
  net_receipts: number | string;
};

export type SharedStudentRow = {
  id: string;
  institute_id: string;
  branch_id: string | null;
  name: string;
  gender: "Male" | "Female" | "Other" | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_email_opt_in: boolean;
  whatsapp_opt_in: boolean;
  email_receipt_opt_in?: boolean;
  whatsapp_receipt_opt_in?: boolean;
  parent_mobile: string | null;
  whatsapp: string | null;
  course: string | null;
  class_name: string | null;
  admission_date: string | null;
  total_fee: number | string;
  admission_fee: number | string;
  legacy_data: unknown;
};

export type SharedStudentInstallment = {
  id: string;
  amount: number;
  dueDate: string;
  status: "Pending" | "Paid" | "Partially Paid";
  paidAmount: number;
  outstandingAmount: number;
  legacyData: UnknownRecord;
};

export type SharedStudent = UnknownRecord & {
  id: string;
  instituteId: string;
  branchId: string | null;
  name: string;
  gender: "Male" | "Female" | "Other";
  parentName: string;
  parentEmail: string;
  parentEmailOptIn: boolean;
  whatsappOptIn: boolean;
  emailReceiptOptIn?: boolean;
  whatsappReceiptOptIn?: boolean;
  parentMobile: string;
  whatsapp: string;
  course: string;
  className: string;
  admissionDate: string;
  admissionFee: number;
  admissionInstallmentId: string | null;
  admissionPaidAmount: number;
  admissionOutstandingAmount: number;
  admissionStatus: "Pending" | "Paid" | "Partially Paid" | "Overdue";
  totalFee: number;
  installments: SharedStudentInstallment[];
};

const STUDENT_COLUMNS = new Set([
  "id", "instituteId", "branchId", "name", "gender", "parentName", "parentEmail",
  "parentEmailOptIn", "whatsappOptIn", "emailReceiptOptIn", "whatsappReceiptOptIn", "parentMobile", "whatsapp", "course",
  "className", "admissionDate", "admissionFee", "totalFee", "installments",
  "admissionInstallmentId", "admissionPaidAmount", "admissionOutstandingAmount",
  "admissionStatus", "collectedAmount", "receiptCount", "legacyData", "legacy_data",
  "archivedAt", "archived_at", "createdAt", "updatedAt",
]);

const INSTALLMENT_COLUMNS = new Set([
  "id", "amount", "scheduledAmount", "scheduled_amount", "dueDate", "due_date",
  "status", "paidAmount", "paid_amount", "outstandingAmount", "outstanding_amount",
  "legacyData", "legacy_data", "studentId", "student_id", "instituteId", "institute_id",
  "branchId", "branch_id", "sequenceNumber", "sequence_number", "scheduledStatus",
  "scheduled_status", "balanceStatus", "balance_status",
]);

function objectValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function amountValue(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function mapSharedStudent(
  row: SharedStudentRow,
  balances: readonly StudentBalanceRow[],
): SharedStudent {
  const legacy = objectValue(row.legacy_data);
  const studentBalances = balances
    .filter((item) => item.student_id === row.id && item.institute_id === row.institute_id)
    .filter((item) => item.balance_status !== "Cancelled")
    .sort((left, right) => left.sequence_number - right.sequence_number);
  const admissionBalance = studentBalances.find((item) => item.sequence_number === 0);
  const installments = studentBalances
    .filter((item) => item.sequence_number > 0)
    .map((item) => {
      const paidAmount = amountValue(item.paid_amount);
      const outstandingAmount = amountValue(item.outstanding_amount);
      return {
        ...objectValue(item.legacy_data),
        id: item.installment_id,
        amount: amountValue(item.scheduled_amount),
        dueDate: item.due_date ?? "",
        status: outstandingAmount <= 0
          ? "Paid" as const
          : paidAmount > 0
            ? "Partially Paid" as const
            : "Pending" as const,
        paidAmount,
        outstandingAmount,
        legacyData: objectValue(item.legacy_data),
      };
    });

  return {
    ...legacy,
    id: row.id,
    instituteId: row.institute_id,
    branchId: row.branch_id,
    name: row.name,
    gender: row.gender ?? "Other",
    parentName: row.parent_name ?? "",
    parentEmail: row.parent_email ?? "",
    parentEmailOptIn: row.parent_email_opt_in === true,
    whatsappOptIn: row.whatsapp_opt_in === true,
    emailReceiptOptIn: row.email_receipt_opt_in === true,
    whatsappReceiptOptIn: row.whatsapp_receipt_opt_in === true,
    parentMobile: row.parent_mobile ?? "",
    whatsapp: row.whatsapp ?? "",
    course: row.course ?? "",
    className: row.class_name ?? "",
    admissionDate: row.admission_date ?? "",
    admissionFee: amountValue(row.admission_fee),
    admissionInstallmentId: admissionBalance?.installment_id ?? null,
    admissionPaidAmount: admissionBalance ? amountValue(admissionBalance.paid_amount) : 0,
    admissionOutstandingAmount: admissionBalance
      ? amountValue(admissionBalance.outstanding_amount)
      : amountValue(row.admission_fee),
    admissionStatus: admissionBalance?.balance_status === "Paid"
      ? "Paid"
      : admissionBalance?.balance_status === "Partially Paid"
        ? "Partially Paid"
        : admissionBalance?.balance_status === "Overdue"
          ? "Overdue"
          : "Pending",
    totalFee: amountValue(row.total_fee),
    installments,
  };
}

export function studentLegacyData(student: UnknownRecord): UnknownRecord {
  const legacy = objectValue(student.legacyData ?? student.legacy_data);
  const unknownFields = Object.fromEntries(
    Object.entries(student).filter(([key]) => !STUDENT_COLUMNS.has(key)),
  );
  return { ...legacy, ...unknownFields };
}

export function installmentLegacyData(installment: UnknownRecord): UnknownRecord {
  const legacy = objectValue(installment.legacyData ?? installment.legacy_data);
  const unknownFields = Object.fromEntries(
    Object.entries(installment).filter(([key]) => !INSTALLMENT_COLUMNS.has(key)),
  );
  return { ...legacy, ...unknownFields };
}

export function toStudentRecordInput(student: SharedStudent): {
  student: UnknownRecord;
  installments: Array<UnknownRecord>;
} {
  return {
    student: {
      name: student.name,
      gender: student.gender,
      parentName: student.parentName,
      parentEmail: student.parentEmail,
      parentEmailOptIn: student.parentEmailOptIn,
      whatsappOptIn: student.whatsappOptIn,
      emailReceiptOptIn: student.emailReceiptOptIn === true,
      whatsappReceiptOptIn: student.whatsappReceiptOptIn === true,
      parentMobile: student.parentMobile,
      whatsapp: student.whatsapp,
      course: student.course,
      className: student.className,
      admissionDate: student.admissionDate || null,
      admissionFee: student.admissionFee,
      totalFee: student.totalFee,
      legacyData: studentLegacyData(student),
    },
    installments: student.installments.map((installment, index) => ({
      id: installment.id,
      sequenceNumber: index + 1,
      amount: installment.amount,
      dueDate: installment.dueDate || null,
      legacyData: installmentLegacyData(installment),
    })),
  };
}

