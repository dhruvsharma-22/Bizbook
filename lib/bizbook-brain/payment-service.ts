/**
 * BizBook Brain — Payment Service
 *
 * Connects payment-engine, receipt-engine and storage-adapter.
 *
 * Responsibilities:
 * - Record offline payments.
 * - Create pending online payments.
 * - Keep online payments pending until trusted server verification is
 *   available.
 * - Prevent duplicate payment IDs.
 * - Create one ordinary fee receipt per payment.
 * - Keep ordinary fee receipts separate from advance receipts.
 * - Save related records through the existing best-effort transaction helper.
 *
 * IMPORTANT:
 * This browser-storage service cannot verify payment-provider outcomes.
 * Online payments remain pending until a server-side provider integration
 * is configured.
 */

import { BizBookError } from "./errors";

import {
  createPayment,
  recordOfflinePayment,
} from "./payment-engine";

import { createPaymentReceipt } from "./receipt-engine";
import {
  normalizeStudentReceiptRecords,
} from "./receipt-adapter";

import {
  BIZBOOK_STORAGE_KEYS,
  getStudentById,
  readAdvancePayments,
  readFeeReceipts,
  readPaymentHistory,
  readPaymentRecords,
  runStorageTransaction,
} from "./storage-adapter";

import type {
  AdvancePayment,
  FeeReceipt,
  PaymentHistoryEntry,
  PaymentMethod,
  PaymentRecord,
} from "./types";

import type {
  CreatePaymentInput,
  VerifyOnlinePaymentInput,
} from "./payment-engine";

import type { PaymentReceipt } from "./receipt-engine";

export interface RecordOfflinePaymentServiceInput {
  payment: Omit<CreatePaymentInput, "mode"> & {
    mode?: "Manual";
  };
  recordedBy: string;
  reference?: string;
}

export interface CreateOnlinePaymentServiceInput {
  payment: Omit<CreatePaymentInput, "mode" | "method"> & {
    mode?: "Online";
    method?: "Online";
  };
}

export type VerifyOnlinePaymentServiceInput =
  VerifyOnlinePaymentInput;

export interface RecordedPaymentResult {
  payment: PaymentRecord;
  receipt: PaymentReceipt;
  receiptRecord: FeeReceipt;
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BizBookError(
      "VALIDATION_ERROR",
      `${field} is required.`,
      { field }
    );
  }
}

function requireBrowserStorage(): void {
  if (typeof window === "undefined") {
    throw new BizBookError(
      "STORAGE_ERROR",
      "Payment storage is only available in the browser."
    );
  }
}

function getExistingPayment(paymentId: string): PaymentRecord | undefined {
  return readPaymentRecords().find((payment) => payment.id === paymentId);
}

function requireStudent(studentId: string) {
  requireText(studentId, "Student ID");
  const student = getStudentById(studentId);

  if (!student) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "The selected student was not found.",
      { studentId }
    );
  }

  return student;
}

/** Creates the ordinary fee receipt record, stored separately from advances. */
function createFeeReceiptRecord(
  payment: PaymentRecord,
  student: ReturnType<typeof requireStudent>
): FeeReceipt {
  const recordedAt = payment.verifiedAt ?? payment.updatedAt;

  return {
    id: payment.id,
    studentId: student.id,
    studentName: student.name,
    course: student.course ?? student.className ?? "Course",
    amount: payment.amount,
    paymentDate: recordedAt,
    method: payment.method as PaymentMethod,
    reference: payment.providerReference,
    note: `Fee payment recorded by BizBook Brain (${payment.mode}).`,
    createdAt: payment.createdAt,
    paymentRecordId: payment.id,
  };
}

function getReceiptEngineRecords(
  advancePayments: AdvancePayment[],
  feeReceipts: FeeReceipt[]
): AdvancePayment[] {
  return normalizeStudentReceiptRecords([
    ...advancePayments,
    ...feeReceipts,
  ]);
}

/** Stores the paid payment, ordinary receipt and history without double-counting. */
function persistPaidPayment(payment: PaymentRecord): RecordedPaymentResult {
  requireBrowserStorage();

  if (payment.status !== "Paid") {
    throw new BizBookError(
      "PAYMENT_NOT_VERIFIED",
      "Only a paid payment can be recorded as a receipt.",
      { paymentId: payment.id, status: payment.status }
    );
  }

  const existingPayment = getExistingPayment(payment.id);
  if (existingPayment?.status === "Paid") {
    throw new BizBookError(
      "DUPLICATE_PAYMENT",
      "This payment has already been recorded.",
      { paymentId: payment.id }
    );
  }

  const student = requireStudent(payment.studentId);
  const payments = readPaymentRecords();
  const advancePayments = readAdvancePayments();
  const feeReceipts = readFeeReceipts();
  const history = readPaymentHistory();

  if (
    advancePayments.some((receipt) => receipt.id === payment.id) ||
    feeReceipts.some((receipt) => receipt.id === payment.id)
  ) {
    throw new BizBookError(
      "DUPLICATE_PAYMENT",
      "A receipt already exists for this payment.",
      { paymentId: payment.id }
    );
  }

  const receiptRecord = createFeeReceiptRecord(payment, student);
  const updatedFeeReceipts = [...feeReceipts, receiptRecord];
  const receiptEngineRecords = getReceiptEngineRecords(
    advancePayments,
    updatedFeeReceipts
  );
  const receipt = createPaymentReceipt(payment, student, receiptEngineRecords);

  const historyEntry: PaymentHistoryEntry = {
    id: payment.id,
    type: "Fee",
    personId: student.id,
    personName: student.name,
    description: `Fee payment — ${payment.mode}`,
    amount: payment.amount,
    paidAt: payment.verifiedAt ?? payment.updatedAt,
    method: payment.method,
  };

  const updatedPayments = existingPayment
    ? payments.map((item) => (item.id === payment.id ? payment : item))
    : [...payments, payment];

  const updatedHistory = history.some((entry) => entry.id === payment.id)
    ? history
    : [historyEntry, ...history];

  runStorageTransaction([
    {
      key: BIZBOOK_STORAGE_KEYS.paymentRecords,
      value: updatedPayments,
      eventName: "bizbook-payment-records-updated",
    },
    {
      key: BIZBOOK_STORAGE_KEYS.feeReceipts,
      value: updatedFeeReceipts,
      eventName: "bizbook-fee-receipts-updated",
    },
    {
      key: BIZBOOK_STORAGE_KEYS.paymentHistory,
      value: updatedHistory,
      eventName: "bizbook-payments-updated",
    },
  ]);

  return { payment, receipt, receiptRecord };
}

/** Creates a pending online payment. It does not mean money was received. */
export function createOnlinePayment(
  input: CreateOnlinePaymentServiceInput
): PaymentRecord {
  requireBrowserStorage();
  requireStudent(input.payment.studentId);
  requireText(input.payment.id, "Payment ID");

  if (getExistingPayment(input.payment.id)) {
    throw new BizBookError(
      "DUPLICATE_PAYMENT",
      "This payment ID already exists.",
      { paymentId: input.payment.id }
    );
  }

  const payment = createPayment({
    ...input.payment,
    mode: "Online",
    method: "Online",
  });

  runStorageTransaction([
    {
      key: BIZBOOK_STORAGE_KEYS.paymentRecords,
      value: [...readPaymentRecords(), payment],
      eventName: "bizbook-payment-records-updated",
    },
  ]);

  return payment;
}

/** Records an offline/manual payment confirmed as received by authorized staff. */
export function recordOfflinePaymentService(
  input: RecordOfflinePaymentServiceInput
): RecordedPaymentResult {
  requireBrowserStorage();
  requireStudent(input.payment.studentId);
  requireText(input.payment.id, "Payment ID");
  requireText(input.recordedBy, "Staff identity");

  if (getExistingPayment(input.payment.id)) {
    throw new BizBookError(
      "DUPLICATE_PAYMENT",
      "This payment ID already exists.",
      { paymentId: input.payment.id }
    );
  }

  const payment = recordOfflinePayment({
    payment: { ...input.payment, mode: "Manual" },
    recordedBy: input.recordedBy,
    reference: input.reference,
  });

  return persistPaidPayment(payment);
}

/**
 * Fails closed until server-side provider verification and persistence are
 * configured. Client-supplied verification fields are never authoritative.
 */
export function verifyOnlinePaymentService(
  _input: VerifyOnlinePaymentServiceInput
): never {
  void _input;
  throw new BizBookError(
    "PAYMENT_NOT_VERIFIED",
    "Online payments cannot be marked paid by this browser-only service. A configured server-side provider verification flow is required."
  );
}

/** Returns a stored payment by ID. */
export function getPaymentById(paymentId: string): PaymentRecord | undefined {
  requireBrowserStorage();
  requireText(paymentId, "Payment ID");
  return getExistingPayment(paymentId);
}

/** Lists recorded payments, optionally filtered by student. */
export function listPayments(studentId?: string): PaymentRecord[] {
  requireBrowserStorage();
  const payments = readPaymentRecords();

  if (!studentId) return payments;
  return payments.filter((payment) => payment.studentId === studentId);
}

/** Returns receipt details for a recorded payment. */
export function getPaymentReceipt(paymentId: string): PaymentReceipt {
  requireBrowserStorage();
  requireText(paymentId, "Payment ID");

  const payment = getExistingPayment(paymentId);
  if (!payment) {
    throw new BizBookError(
      "INVALID_PAYMENT",
      "The payment record was not found.",
      { paymentId }
    );
  }

  if (payment.status !== "Paid") {
    throw new BizBookError(
      "PAYMENT_NOT_VERIFIED",
      "A receipt is available only after payment is recorded.",
      { paymentId, status: payment.status }
    );
  }

  const student = requireStudent(payment.studentId);
  const advancePayments = readAdvancePayments();
  const feeReceipts = readFeeReceipts();
  const hasAdvanceReceipt = advancePayments.some(
    (receipt) => receipt.id === payment.id
  );
  const hasFeeReceipt = feeReceipts.some(
    (receipt) => receipt.id === payment.id || receipt.paymentRecordId === payment.id
  );

  if (!hasAdvanceReceipt && !hasFeeReceipt) {
    throw new BizBookError(
      "STORAGE_ERROR",
      "The recorded payment has no matching receipt record.",
      { paymentId }
    );
  }

  return createPaymentReceipt(
    payment,
    student,
    getReceiptEngineRecords(advancePayments, feeReceipts)
  );
}
