
/**
 * BizBook Brain — Invoice Engine
 *
 * Creates an invoice summary from the current student fee structure
 * and existing confirmed receipt records.
 *
 * This engine does not save invoices, create payments, or send messages.
 * Advance allocation is not a new cash inflow.
 */

import { BizBookError } from "./errors";
import { formatINR, toPaise, fromPaise } from "./money";
import { getInstallmentRemaining } from "./installment-engine";
import { normalizeStudentReceiptRecords } from "./receipt-adapter";

import type {
  Installment,
  Student,
  StudentReceiptRecord,
} from "./types";

export interface InvoiceInstallment {
  id: string;
  number: number;
  dueDate: string | null;
  scheduledAmount: number;
  paidAmount: number;
  advanceAppliedAmount: number;
  remainingAmount: number;
  formattedScheduledAmount: string;
  formattedPaidAmount: string;
  formattedRemainingAmount: string;
  status: "Pending" | "Overdue" | "Paid" | "Cancelled";
}

export interface FeeInvoice {
  invoiceNumber: string;
  studentId: string;
  studentName: string;
  course: string;
  generatedAt: string;
  totalFee: number;
  totalReceived: number;
  outstanding: number;
  advanceAvailable: number;
  totalFeeFormatted: string;
  totalReceivedFormatted: string;
  outstandingFormatted: string;
  advanceAvailableFormatted: string;
  installments: InvoiceInstallment[];
}

export interface CreateFeeInvoiceOptions {
  invoiceNumber?: string;
  generatedAt?: string;
  today?: string;
}

function fail(message: string): never {
  throw new BizBookError("VALIDATION_ERROR", message);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function sumPaise(values: number[]): number {
  let total = 0;

  for (const value of values) {
    const next = total + toPaise(value);

    if (!Number.isSafeInteger(next)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Invoice total exceeds the supported amount."
      );
    }

    total = next;
  }

  return total;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getInstallmentStatus(
  installment: Installment,
  remainingPaise: number,
  dueDate: string | undefined,
  today: string
): InvoiceInstallment["status"] {
  if (installment.status === "Cancelled") {
    return "Cancelled";
  }

  if (remainingPaise === 0) {
    return "Paid";
  }

  if (installment.status === "Overdue") {
    return "Overdue";
  }

  if (dueDate) {
    const dateOnly = dueDate.slice(0, 10);

    if (isValidDateOnly(dateOnly) && dateOnly < today) {
      return "Overdue";
    }
  }

  return "Pending";
}

/**
 * Creates an invoice summary without persisting any data.
 *
 * Only pass receipts representing actual confirmed receipts.
 */
export function createFeeInvoice(
  student: Student,
  receipts: StudentReceiptRecord[],
  options: CreateFeeInvoiceOptions = {}
): FeeInvoice {
  if (
    !student ||
    typeof student !== "object" ||
    typeof student.id !== "string" ||
    !student.id.trim()
  ) {
    return fail("A valid student is required to create an invoice.");
  }

  if (!Array.isArray(receipts)) {
    return fail("Payment receipts must be provided as an array.");
  }

  if (!options || typeof options !== "object") {
    return fail("Invoice options must be an object.");
  }

  const today = options.today ?? getDateOnly(new Date());

  if (!isValidDateOnly(today)) {
    return fail("Invoice date must be a valid YYYY-MM-DD date.");
  }

  const totalFeePaise = toPaise(student.totalFee ?? 0);

  if (totalFeePaise < 0) {
    return fail("Student total fee cannot be negative.");
  }

  const normalizedReceipts = normalizeStudentReceiptRecords(receipts);
  const studentReceipts = normalizedReceipts.filter(
    (receipt) => receipt.studentId === student.id
  );

  const receiptIds = new Set<string>();

  for (const receipt of studentReceipts) {
    requireText(receipt.id, "Receipt ID");

    if (receiptIds.has(receipt.id)) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Duplicate receipt ID found for this student.",
        { receiptId: receipt.id }
      );
    }

    receiptIds.add(receipt.id);

    const amountPaise = toPaise(receipt.amount);
    const appliedPaise = toPaise(receipt.appliedAmount ?? 0);

    if (amountPaise <= 0) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Receipt amount must be positive.",
        { receiptId: receipt.id }
      );
    }

    if (appliedPaise < 0 || appliedPaise > amountPaise) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        `Receipt ${receipt.id} has an invalid applied amount.`
      );
    }
  }

  const totalReceivedPaise = sumPaise(
    studentReceipts.map((receipt) => receipt.amount)
  );

  const advanceAvailablePaise = sumPaise(
    studentReceipts.map((receipt) => {
      const received = toPaise(receipt.amount);
      const applied = toPaise(receipt.appliedAmount ?? 0);

      return fromPaise(received - applied);
    })
  );

  const installments: InvoiceInstallment[] = (
    student.installments ?? []
  ).map((installment, index) => {
    const remaining = getInstallmentRemaining(installment);
    const remainingPaise = toPaise(remaining);

    const scheduledPaise = toPaise(
      installment.scheduledAmount ?? installment.amount
    );

    const paidPaise = toPaise(installment.paidAmount ?? 0);
    const advanceAppliedPaise = toPaise(
      installment.advanceAppliedAmount ?? 0
    );

    if (
      scheduledPaise < 0 ||
      paidPaise < 0 ||
      advanceAppliedPaise < 0 ||
      remainingPaise < 0
    ) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Installment contains a negative monetary value.",
        { installmentId: installment.id }
      );
    }

    if (
      installment.dueDate &&
      !isValidDateOnly(installment.dueDate.slice(0, 10))
    ) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Installment due date is invalid.",
        { installmentId: installment.id }
      );
    }

    return {
      id: installment.id ?? `${student.id}-installment-${index + 1}`,
      number: index + 1,
      dueDate: installment.dueDate ?? null,
      scheduledAmount: fromPaise(scheduledPaise),
      paidAmount: fromPaise(paidPaise),
      advanceAppliedAmount: fromPaise(advanceAppliedPaise),
      remainingAmount: fromPaise(remainingPaise),
      formattedScheduledAmount: formatINR(fromPaise(scheduledPaise)),
      formattedPaidAmount: formatINR(fromPaise(paidPaise)),
      formattedRemainingAmount: formatINR(fromPaise(remainingPaise)),
      status: getInstallmentStatus(
        installment,
        remainingPaise,
        installment.dueDate,
        today
      ),
    };
  });

  const hasInstallments = installments.length > 0;

  const installmentOutstandingPaise = sumPaise(
    installments
      .filter((item) => item.status !== "Cancelled")
      .map((item) => item.remainingAmount)
  );

  const outstandingPaise = hasInstallments
    ? installmentOutstandingPaise
    : Math.max(0, totalFeePaise - totalReceivedPaise);

  const invoiceNumber =
    options.invoiceNumber === undefined
      ? `INV-${student.id}-${Date.now().toString(36).toUpperCase()}`
      : requireText(options.invoiceNumber, "Invoice number");

  const generatedAt =
    options.generatedAt ?? new Date().toISOString();

  if (!Number.isFinite(Date.parse(generatedAt))) {
    return fail("Invoice generation timestamp is invalid.");
  }

  const studentName = requireText(student.name, "Student name");
  const course =
    student.course ?? student.className ?? "Course not specified";

  return {
    invoiceNumber,
    studentId: student.id,
    studentName,
    course,
    generatedAt,
    totalFee: fromPaise(totalFeePaise),
    totalReceived: fromPaise(totalReceivedPaise),
    outstanding: fromPaise(outstandingPaise),
    advanceAvailable: fromPaise(advanceAvailablePaise),
    totalFeeFormatted: formatINR(fromPaise(totalFeePaise)),
    totalReceivedFormatted: formatINR(fromPaise(totalReceivedPaise)),
    outstandingFormatted: formatINR(fromPaise(outstandingPaise)),
    advanceAvailableFormatted: formatINR(
      fromPaise(advanceAvailablePaise)
    ),
    installments,
  };
}
