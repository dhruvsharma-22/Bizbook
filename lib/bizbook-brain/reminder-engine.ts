
/**
 * BizBook Brain — Reminder Engine
 *
 * Defines reminder schedules and checks eligibility.
 * Does not send messages or persist logs.
 *
 * Invoice notifications remain separate from reminders.
 */

import { BizBookError } from "./errors";
import type { Installment } from "./types";

export type ReminderChannel = "Email" | "WhatsApp";
export type ReminderScheduleChannel = ReminderChannel | "Both";

export interface ReminderContactPreferences {
  emailOptIn?: boolean;
  whatsappOptIn?: boolean;
}

/** Legacy contact records default to no automated reminder consent. */
export function hasReminderConsent(
  channel: ReminderChannel,
  preferences: ReminderContactPreferences,
): boolean {
  return channel === "Email"
    ? preferences.emailOptIn === true
    : preferences.whatsappOptIn === true;
}

export type ReminderLogStatus = "Sent" | "Failed" | "Pending";

export interface ReminderLogEntry {
  id: string;
  studentId: string;
  installmentId: string;
  channel: ReminderChannel;
  sentAt: string;
  status: ReminderLogStatus;
  reminderNumber: number;
}

export interface ReminderPlanItem {
  reminderNumber: number;
  dayOffset: number;
  channel: ReminderScheduleChannel;
  sendTime: string;
}

export const MAX_REMINDER_STAGES = 5;

export interface ReminderEligibilityInput {
  studentId: string;
  installment: Installment;
  reminderLogs: ReminderLogEntry[];
  today?: string;
  timeZone?: string;
}

export interface ReminderEligibility {
  eligible: boolean;
  reason: string;
  remindersSent: number;
  nextReminderNumber: number | null;
  nextChannel: ReminderScheduleChannel | null;
  remainingReminders: number;
}

export interface InvoiceNotificationInput {
  studentId: string;
  installmentId?: string;
  paymentVerified: boolean;
  paymentSaved: boolean;
}

export interface InvoiceNotificationDecision {
  eligible: boolean;
  channel: "WhatsApp";
  reason: string;
}

export const REMINDER_PLAN: ReminderPlanItem[] = [
  { reminderNumber: 1, dayOffset: -7, channel: "Email", sendTime: "09:00" },
  { reminderNumber: 2, dayOffset: -3, channel: "Email", sendTime: "09:00" },
  { reminderNumber: 3, dayOffset: -1, channel: "WhatsApp", sendTime: "09:00" },
  { reminderNumber: 4, dayOffset: 0, channel: "WhatsApp", sendTime: "09:00" },
  { reminderNumber: 5, dayOffset: 1, channel: "Email", sendTime: "09:00" },
];

const MILLISECONDS_PER_DAY = 86_400_000;

function fail(message: string): never {
  throw new BizBookError("VALIDATION_ERROR", message);
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail("Date must use YYYY-MM-DD format.");
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return fail("A valid calendar date is required.");
  }

  return date;
}

function todayLocal(): string {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/** Formats the calendar date for an instant in a tenant's IANA time zone. */
export function getLocalDateInTimeZone(
  instant: Date,
  timeZone: string,
): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    return fail("A valid instant is required to resolve the local date.");
  }
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    return fail("A valid IANA time zone is required.");
  }

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
  } catch {
    return fail("A valid IANA time zone is required.");
  }

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateReminderLogs(logs: ReminderLogEntry[]): void {
  for (const log of logs) {
    if (
      !log ||
      typeof log.id !== "string" ||
      !log.id.trim() ||
      typeof log.studentId !== "string" ||
      !log.studentId.trim() ||
      typeof log.installmentId !== "string" ||
      !log.installmentId.trim()
    ) {
      return fail("A reminder log has invalid identifying fields.");
    }

    if (
      log.channel !== "Email" &&
      log.channel !== "WhatsApp"
    ) {
      return fail("A reminder log has an invalid channel.");
    }

    if (
      log.status !== "Sent" &&
      log.status !== "Failed" &&
      log.status !== "Pending"
    ) {
      return fail("A reminder log has an invalid status.");
    }

    if (
      !Number.isInteger(log.reminderNumber) ||
      log.reminderNumber < 1 ||
      log.reminderNumber > MAX_REMINDER_STAGES
    ) {
      return fail("A reminder log has an invalid reminder number.");
    }

    if (
      typeof log.sentAt !== "string" ||
      !Number.isFinite(Date.parse(log.sentAt))
    ) {
      return fail("A reminder log has an invalid timestamp.");
    }
  }
}

/**
 * Returns the reminder scheduled for a supplied date.
 * Returns null when no reminder is scheduled that day.
 */
export function getScheduledReminder(
  dueDate: string,
  today?: string,
  timeZone?: string,
  reminderPlan: readonly ReminderPlanItem[] = REMINDER_PLAN,
): ReminderPlanItem | null {
  const due = parseDateOnly(dueDate);
  const current = parseDateOnly(
    today ?? (timeZone ? getLocalDateInTimeZone(new Date(), timeZone) : todayLocal()),
  );

  const dayDifference = Math.round(
    (current.getTime() - due.getTime()) /
      MILLISECONDS_PER_DAY
  );

  return (
    reminderPlan.find(
      (item) => item.dayOffset === dayDifference
    ) ?? null
  );
}

/** Returns every stage scheduled for the supplied local calendar date. */
export function getScheduledReminders(
  dueDate: string,
  today?: string,
  timeZone?: string,
  reminderPlan: readonly ReminderPlanItem[] = REMINDER_PLAN,
): ReminderPlanItem[] {
  const due = parseDateOnly(dueDate);
  const current = parseDateOnly(
    today ?? (timeZone ? getLocalDateInTimeZone(new Date(), timeZone) : todayLocal()),
  );
  const dayDifference = Math.round((current.getTime() - due.getTime()) / MILLISECONDS_PER_DAY);
  return reminderPlan.filter((item) => item.dayOffset === dayDifference);
}

/** Formats the local clock time for an instant in an institute's IANA time zone. */
export function getLocalTimeInTimeZone(instant: Date, timeZone: string): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    return fail("A valid instant is required to resolve the local time.");
  }
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    return fail("A valid IANA time zone is required.");
  }
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant);
  } catch {
    return fail("A valid IANA time zone is required.");
  }
}

/**
 * Checks eligibility for the reminder scheduled TODAY.
 *
 * Missed reminders are not replayed automatically.
 * A successful reminder log prevents sending the same reminder again.
 */
export function checkReminderEligibility(
  input: ReminderEligibilityInput
): ReminderEligibility {
  if (!input || typeof input !== "object") {
    return fail("Reminder eligibility input is required.");
  }

  const { studentId, installment, reminderLogs } = input;
  const today = input.today ?? (
    input.timeZone
      ? getLocalDateInTimeZone(new Date(), input.timeZone)
      : todayLocal()
  );

  parseDateOnly(today);

  if (typeof studentId !== "string" || !studentId.trim()) {
    return fail("Student ID is required.");
  }

  if (!installment || typeof installment !== "object") {
    return fail("Installment information is required.");
  }

  if (
    typeof installment.id !== "string" ||
    !installment.id.trim()
  ) {
    return fail("Installment ID is required.");
  }

  if (!Array.isArray(reminderLogs)) {
    return fail("Reminder logs must be supplied.");
  }

  validateReminderLogs(reminderLogs);

  if (!installment.dueDate) {
    return fail("Installment due date is required.");
  }

  parseDateOnly(installment.dueDate);

  if (
    installment.status === "Paid" ||
    installment.status === "Cancelled"
  ) {
    return {
      eligible: false,
      reason:
        installment.status === "Paid"
          ? "The installment is already paid."
          : "The installment is cancelled.",
      remindersSent: 0,
      nextReminderNumber: null,
      nextChannel: null,
      remainingReminders: 0,
    };
  }

  const relevantLogs = reminderLogs.filter(
    (log) =>
      log.studentId === studentId &&
      log.installmentId === installment.id
  );

  const sentLogs = relevantLogs.filter(
    (log) => log.status === "Sent"
  );

  const sentReminderNumbers = new Set(
    sentLogs.map((log) => log.reminderNumber)
  );

  const remindersSent = sentReminderNumbers.size;
  const remainingReminders =
    REMINDER_PLAN.length - sentReminderNumbers.size;

  const scheduledReminder = getScheduledReminder(
    installment.dueDate,
    today,
    input.timeZone,
  );

  if (!scheduledReminder) {
    return {
      eligible: false,
      reason:
        "No reminder is scheduled for this date. Missed reminders are not replayed automatically.",
      remindersSent,
      nextReminderNumber: null,
      nextChannel: null,
      remainingReminders,
    };
  }

  if (sentReminderNumbers.has(scheduledReminder.reminderNumber)) {
    return {
      eligible: false,
      reason: `Reminder ${scheduledReminder.reminderNumber} has already been sent.`,
      remindersSent,
      nextReminderNumber: scheduledReminder.reminderNumber,
      nextChannel: scheduledReminder.channel,
      remainingReminders,
    };
  }

  return {
    eligible: true,
    reason: `Reminder ${scheduledReminder.reminderNumber} is due.`,
    remindersSent,
    nextReminderNumber: scheduledReminder.reminderNumber,
    nextChannel: scheduledReminder.channel,
    remainingReminders,
  };
}

/**
 * Invoice notifications are separate from the reminder schedule.
 * A notification is eligible only after payment is saved and verified.
 */
export function checkInvoiceNotificationEligibility(
  input: InvoiceNotificationInput
): InvoiceNotificationDecision {
  if (!input || typeof input !== "object") {
    return fail("Invoice notification input is required.");
  }

  if (
    typeof input.studentId !== "string" ||
    !input.studentId.trim()
  ) {
    return fail("Student ID is required.");
  }

  if (!input.paymentSaved) {
    return {
      eligible: false,
      channel: "WhatsApp",
      reason: "Save the payment before sending an invoice.",
    };
  }

  if (!input.paymentVerified) {
    return {
      eligible: false,
      channel: "WhatsApp",
      reason: "Verify the payment before sending an invoice.",
    };
  }

  return {
    eligible: true,
    channel: "WhatsApp",
    reason: "Payment is saved and verified; the invoice can be sent.",
  };
}
