
/**
 * BizBook Brain — Reminder Templates
 *
 * Generates reminder and payment invoice message content.
 * Does not send messages or persist notification logs.
 *
 * Messages use the coaching institute's name as the sender identity.
 * Reminder scheduling is handled by reminder-engine.ts.
 */

import { BizBookError } from "./errors";
import { formatINR, toPaise } from "./money";

export interface ReminderTemplateData {
  coachingName: string;
  studentName: string;
  courseName?: string;
  installmentNumber: number;
  dueDate: string;
  amountDue: number;
  totalFee: number;
  totalPaid: number;
  outstanding: number;
  paymentLink?: string;
}

export interface PaymentInvoiceTemplateData {
  coachingName: string;
  studentName: string;
  courseName?: string;
  receiptNumber: string;
  paymentDate: string;
  paymentAmount: number;
  paymentMethod: string;
  totalFee: number;
  totalPaid: number;
  outstanding: number;
  remainingInstallments: Array<{
    installmentNumber: number;
    dueDate: string;
    amount: number;
  }>;
}

export interface MessageTemplate {
  subject?: string;
  message: string;
}

function fail(message: string): never {
  throw new BizBookError("VALIDATION_ERROR", message);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${field} is required to generate this message.`);
  }

  return value.trim();
}

function optionalLine(label: string, value?: string): string {
  if (value === undefined || value.trim() === "") {
    return "";
  }

  return `${label}: ${value.trim()}\n`;
}

function validateMoney(
  value: number,
  field: string,
  allowZero = true
): void {
  let amountPaise: number;

  try {
    amountPaise = toPaise(value);
  } catch {
    return fail(`${field} must be a valid monetary amount.`);
  }

  if (amountPaise < 0 || (!allowZero && amountPaise === 0)) {
    return fail(
      `${field} must be ${allowZero ? "non-negative" : "positive"}.`
    );
  }
}

function validateDate(value: string, field: string): string {
  const text = requiredText(value, field);

  // Accept YYYY-MM-DD or a valid timestamp for compatibility.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00.000Z`);

    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== text
    ) {
      return fail(`${field} must be a valid calendar date.`);
    }

    return text;
  }

  if (!Number.isFinite(Date.parse(text))) {
    return fail(`${field} must be a valid date.`);
  }

  return text;
}

function safePaymentLink(link?: string): string {
  if (link === undefined || link.trim() === "") {
    return "";
  }

  try {
    const url = new URL(link.trim());

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return fail("Payment link must use HTTP or HTTPS.");
    }

    if (!url.hostname) {
      return fail("Payment link must contain a valid hostname.");
    }

    return `\nPay securely: ${url.toString()}\n`;
  } catch (error) {
    if (error instanceof BizBookError) {
      throw error;
    }

    return fail("Payment link must be a valid HTTP or HTTPS URL.");
  }
}

/**
 * Generates one of the five scheduled reminders.
 * Does not decide when a reminder should be sent.
 */
export function createReminderTemplate(
  data: ReminderTemplateData,
  reminderNumber: number,
  channel: "Email" | "WhatsApp"
): MessageTemplate {
  if (!data || typeof data !== "object") {
    return fail("Reminder template data is required.");
  }

  const coachingName = requiredText(
    data.coachingName,
    "Coaching name"
  );

  const studentName = requiredText(
    data.studentName,
    "Student name"
  );

  const dueDate = validateDate(data.dueDate, "Due date");

  if (
    !Number.isInteger(reminderNumber) ||
    reminderNumber < 1 ||
    reminderNumber > 5
  ) {
    return fail("Reminder number must be between 1 and 5.");
  }

  if (channel !== "Email" && channel !== "WhatsApp") {
    return fail("Reminder channel must be Email or WhatsApp.");
  }

  if (
    !Number.isInteger(data.installmentNumber) ||
    data.installmentNumber < 1
  ) {
    return fail("Installment number must be a positive integer.");
  }

  validateMoney(data.amountDue, "Amount due");
  validateMoney(data.totalFee, "Total fee");
  validateMoney(data.totalPaid, "Total paid");
  validateMoney(data.outstanding, "Outstanding balance");

  const courseLine = optionalLine("Course", data.courseName);

  const commonMessage =
    `Hello ${studentName},\n\n` +
    `This is reminder ${reminderNumber} of 5 from ${coachingName} ` +
    `regarding your course installment.\n\n` +
    courseLine +
    `Installment: ${data.installmentNumber}\n` +
    `Due date: ${dueDate}\n` +
    `Amount due: ${formatINR(data.amountDue)}\n` +
    `Total course fee: ${formatINR(data.totalFee)}\n` +
    `Total paid: ${formatINR(data.totalPaid)}\n` +
    `Outstanding balance: ${formatINR(data.outstanding)}\n` +
    safePaymentLink(data.paymentLink) +
    `\nIf you have already paid, please contact ${coachingName} with your receipt details.\n\n` +
    `Regards,\n${coachingName}`;

  if (channel === "Email") {
    return {
      subject:
        `Installment ${data.installmentNumber} payment reminder - ${coachingName}`,
      message: commonMessage,
    };
  }

  return { message: commonMessage };
}

/**
 * Generates the payment invoice notification.
 * This is separate from scheduled reminders.
 */
export function createPaymentInvoiceTemplate(
  data: PaymentInvoiceTemplateData
): MessageTemplate {
  if (!data || typeof data !== "object") {
    return fail("Payment invoice template data is required.");
  }

  const coachingName = requiredText(
    data.coachingName,
    "Coaching name"
  );

  const studentName = requiredText(
    data.studentName,
    "Student name"
  );

  const receiptNumber = requiredText(
    data.receiptNumber,
    "Receipt number"
  );

  const paymentDate = validateDate(
    data.paymentDate,
    "Payment date"
  );

  const paymentMethod = requiredText(
    data.paymentMethod,
    "Payment method"
  );

  validateMoney(data.paymentAmount, "Payment amount", false);
  validateMoney(data.totalFee, "Total fee");
  validateMoney(data.totalPaid, "Total paid");
  validateMoney(data.outstanding, "Outstanding balance");

  if (!Array.isArray(data.remainingInstallments)) {
    return fail("Remaining installments must be an array.");
  }

  const installmentLines =
    data.remainingInstallments.length > 0
      ? data.remainingInstallments
          .map((item) => {
            if (
              !Number.isInteger(item.installmentNumber) ||
              item.installmentNumber < 1
            ) {
              return fail(
                "Remaining installment number must be a positive integer."
              );
            }

            const dueDate = validateDate(
              item.dueDate,
              "Installment due date"
            );

            validateMoney(item.amount, "Installment amount");

            return (
              `Installment ${item.installmentNumber}: ` +
              `${formatINR(item.amount)} — due ${dueDate}`
            );
          })
          .join("\n")
      : "No remaining installments.";

  return {
    subject: `Payment receipt ${receiptNumber} - ${coachingName}`,
    message:
      `Hello ${studentName},\n\n` +
      `Your payment has been recorded by ${coachingName}.\n\n` +
      `PAYMENT RECEIPT\n` +
      `Receipt number: ${receiptNumber}\n` +
      `Payment date: ${paymentDate}\n` +
      `Payment amount: ${formatINR(data.paymentAmount)}\n` +
      `Payment method: ${paymentMethod}\n\n` +
      optionalLine("Course", data.courseName) +
      `Total course fee: ${formatINR(data.totalFee)}\n` +
      `Total paid to date: ${formatINR(data.totalPaid)}\n` +
      `Outstanding balance: ${formatINR(data.outstanding)}\n\n` +
      `REMAINING INSTALLMENTS\n${installmentLines}\n\n` +
      `Please keep this message for your records.\n\n` +
      `Regards,\n${coachingName}`,
  };
}
