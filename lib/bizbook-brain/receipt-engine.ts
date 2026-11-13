
/**
 * BizBook Brain — Receipt Engine
 *
 * Prepares payment receipts from recorded financial data.
 * Does not save receipts or send notifications.
 *
 * Important:
 * - A receipt is generated only for a recorded/verified payment.
 * - Existing advance allocations are not new cash inflows.
 * - Receipt generation never modifies financial records.
 */

import { BizBookError } from "./errors";
import { formatINR, fromPaise, toPaise } from "./money";
import { canApplyPayment } from "./payment-engine";
import { getInstallmentRemaining } from "./installment-engine";

import type {
  AdvancePayment,
  Installment,
  PaymentRecord,
  Student,
} from "./types";

export interface ReceiptLineItem {
  description: string;
  amount: number;
}

export interface ReceiptInstallment {
  installmentId: string;
  installmentNumber: number;
  dueDate: string | null;
  remainingAmount: number;
  remainingAmountFormatted: string;
  status: "Pending" | "Overdue" | "Paid" | "Cancelled";
}

export interface PaymentReceipt {
  receiptNumber: string;
  paymentId: string;
  studentId: string;
  studentName: string;
  course: string;

  paymentMode: "Manual" | "Online";
  paymentMethod: string;
  paymentStatus: "Paid";

  amount: number;
  formattedAmount: string;
  paymentDate: string;
  providerReference?: string;

  totalFee: number;
  totalFeeFormatted: string;
  totalReceived: number;
  totalReceivedFormatted: string;
  outstanding: number;
  outstandingFormatted: string;
  advanceAvailable: number;
  advanceAvailableFormatted: string;

  lineItems: ReceiptLineItem[];
  remainingInstallments: ReceiptInstallment[];

  generatedAt: string;
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

function sumPaise(amounts: number[]): number {
  let total = 0;

  for (const amount of amounts) {
    const next = total + toPaise(amount);

    if (!Number.isSafeInteger(next)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Receipt total is too large."
      );
    }

    total = next;
  }

  return total;
}

function validateCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function getLocalCalendarDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function resolveInstallmentStatus(
  installment: Installment,
  remainingAmount: number,
  today: string
): ReceiptInstallment["status"] {
  if (installment.status === "Cancelled") {
    return "Cancelled";
  }

  if (remainingAmount === 0) {
    return "Paid";
  }

  if (installment.dueDate) {
    const dueDate = installment.dueDate.slice(0, 10);

    if (
      validateCalendarDate(dueDate) &&
      dueDate < today
    ) {
      return "Overdue";
    }
  }

  return "Pending";
}

/**
 * Creates receipt details from a recorded payment.
 *
 * allReceipts must contain actual recorded receipts, including
 * the payment being receipted when applicable.
 *
 * today may be supplied for deterministic testing.
 */
export function createPaymentReceipt(
  payment: PaymentRecord,
  student: Student,
  allReceipts: AdvancePayment[],
  today?: string
): PaymentReceipt {
  if (!payment || typeof payment !== "object") {
    return fail("A payment record is required.");
  }

  if (!student || typeof student !== "object") {
    return fail("A student record is required.");
  }

  const paymentId = requireText(payment.id, "Payment ID");
  const studentId = requireText(student.id, "Student ID");

  if (payment.studentId !== studentId) {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "Payment does not belong to this student.",
      { paymentId, studentId }
    );
  }

  if (!canApplyPayment(payment)) {
    throw new BizBookError(
      "PAYMENT_NOT_VERIFIED",
      "A receipt can only be generated for a recorded payment.",
      { paymentId, status: payment.status }
    );
  }

  if (!Array.isArray(allReceipts)) {
    return fail("Actual receipt records must be supplied.");
  }

  if (today !== undefined && !validateCalendarDate(today)) {
    return fail("The receipt status date must be a valid YYYY-MM-DD date.");
  }

  const paymentPaise = toPaise(payment.amount);

  if (paymentPaise <= 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Payment amount must be positive."
    );
  }

  const amount = fromPaise(paymentPaise);

  const studentReceipts = allReceipts.filter(
    (receipt) => receipt.studentId === studentId
  );

  for (const receipt of studentReceipts) {
    requireText(receipt.id, "Receipt ID");

    const receivedPaise = toPaise(receipt.amount);
    const appliedPaise = toPaise(receipt.appliedAmount ?? 0);

    if (receivedPaise <= 0) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Receipt amount must be positive.",
        { receiptId: receipt.id }
      );
    }

    if (
      appliedPaise < 0 ||
      appliedPaise > receivedPaise
    ) {
      throw new BizBookError(
        "ALLOCATION_EXCEEDS_BALANCE",
        "Applied amount is invalid or exceeds the receipt amount.",
        { receiptId: receipt.id }
      );
    }
  }

  const totalReceivedPaise = sumPaise(
    studentReceipts.map((receipt) => receipt.amount)
  );

  const totalFeePaise = toPaise(student.totalFee ?? 0);

  if (totalFeePaise < 0) {
    throw new BizBookError(
      "INVALID_AMOUNT",
      "Student total fee cannot be negative."
    );
  }

  const advancePaise = sumPaise(
    studentReceipts.map((receipt) => {
      const received = toPaise(receipt.amount);
      const applied = toPaise(receipt.appliedAmount ?? 0);

      return fromPaise(received - applied);
    })
  );

  const dateForStatus = today ?? getLocalCalendarDate();

  const remainingInstallments: ReceiptInstallment[] = (
    student.installments ?? []
  ).map((installment, index) => {
    const remaining = getInstallmentRemaining(installment);

    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Installment has an invalid remaining balance.",
        { installmentId: installment.id }
      );
    }

    return {
      installmentId:
        installment.id ?? `installment-${index + 1}`,
      installmentNumber: index + 1,
      dueDate: installment.dueDate ?? null,
      remainingAmount: remaining,
      remainingAmountFormatted: formatINR(remaining),
      status: resolveInstallmentStatus(
        installment,
        remaining,
        dateForStatus
      ),
    };
  }).filter(
    (installment) =>
      installment.remainingAmount > 0 &&
      installment.status !== "Cancelled"
  );

  const installmentOutstandingPaise = sumPaise(
    remainingInstallments.map(
      (installment) => installment.remainingAmount
    )
  );

  const outstandingPaise =
    (student.installments?.length ?? 0) > 0
      ? installmentOutstandingPaise
      : Math.max(0, totalFeePaise - totalReceivedPaise);

  const totalFee = fromPaise(totalFeePaise);
  const totalReceived = fromPaise(totalReceivedPaise);
  const outstanding = fromPaise(outstandingPaise);
  const advanceAvailable = fromPaise(advancePaise);

  const paymentDate =
    payment.verifiedAt ?? payment.updatedAt;

  if (
    typeof paymentDate !== "string" ||
    !Number.isFinite(Date.parse(paymentDate))
  ) {
    return fail("Payment date is invalid.");
  }

  return {
    receiptNumber: `BB-${paymentId}`,
    paymentId,
    studentId,
    studentName: requireText(student.name, "Student name"),
    course: student.course ?? student.className ?? "Course",

    paymentMode: payment.mode,
    paymentMethod: payment.method,
    paymentStatus: "Paid",

    amount,
    formattedAmount: formatINR(amount),
    paymentDate,
    providerReference: payment.providerReference,

    totalFee,
    totalFeeFormatted: formatINR(totalFee),
    totalReceived,
    totalReceivedFormatted: formatINR(totalReceived),
    outstanding,
    outstandingFormatted: formatINR(outstanding),
    advanceAvailable,
    advanceAvailableFormatted: formatINR(advanceAvailable),

    lineItems: [
      {
        description: "Fee payment received in this transaction",
        amount,
      },
    ],

    remainingInstallments,

    generatedAt: new Date().toISOString(),
  };
}
