
/**
 * BizBook Brain — Reminder Log
 *
 * Creates and validates reminder log records.
 * Does not persist logs or send messages.
 */

import { BizBookError } from "./errors";

import type {
  ReminderChannel,
  ReminderLogEntry,
  ReminderLogStatus,
} from "./reminder-engine";

export interface CreateReminderLogInput {
  id: string;
  studentId: string;
  installmentId: string;
  channel: ReminderChannel;
  reminderNumber: number;
  status: ReminderLogStatus;
  sentAt?: string;
  errorMessage?: string;
}

export interface ReminderLogSummary {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  remainingReminders: number;
  limitReached: boolean;
}

const MAX_REMINDERS = 5;

function fail(message: string): never {
  throw new BizBookError("VALIDATION_ERROR", message);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fail(`${field} is required.`);
  }

  return value.trim();
}

function validateStatus(status: unknown): asserts status is ReminderLogStatus {
  if (
    status !== "Sent" &&
    status !== "Failed" &&
    status !== "Pending"
  ) {
    return fail("Invalid reminder status.");
  }
}

function validateChannel(channel: unknown): asserts channel is ReminderChannel {
  if (channel !== "Email" && channel !== "WhatsApp") {
    return fail("Unsupported reminder channel.");
  }
}

function validateReminderNumber(value: unknown): void {
  if (
    !Number.isInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_REMINDERS
  ) {
    return fail("Reminder number must be between 1 and 5.");
  }
}

function validateTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    return fail("Reminder timestamp is invalid.");
  }

  return value;
}

function validateLog(log: ReminderLogEntry): void {
  if (!log || typeof log !== "object") {
    return fail("Reminder log is required.");
  }

  requireText(log.id, "Reminder log ID");
  requireText(log.studentId, "Student ID");
  requireText(log.installmentId, "Installment ID");
  validateChannel(log.channel);
  validateStatus(log.status);
  validateReminderNumber(log.reminderNumber);
  validateTimestamp(log.sentAt);
}

/**
 * Creates a validated reminder log entry.
 * This function does not persist the entry.
 */
export function createReminderLog(
  input: CreateReminderLogInput
): ReminderLogEntry {
  if (!input || typeof input !== "object") {
    return fail("Reminder log input is required.");
  }

  const id = requireText(input.id, "Reminder log ID");
  const studentId = requireText(input.studentId, "Student ID");
  const installmentId = requireText(
    input.installmentId,
    "Installment ID"
  );

  validateChannel(input.channel);
  validateStatus(input.status);
  validateReminderNumber(input.reminderNumber);

  const sentAt = validateTimestamp(
    input.sentAt ?? new Date().toISOString()
  );

  return {
    id,
    studentId,
    installmentId,
    channel: input.channel,
    reminderNumber: input.reminderNumber,
    status: input.status,
    sentAt,
  };
}

/**
 * Rejects duplicate IDs and duplicate successful reminder numbers.
 * Call before saving a new log entry.
 */
export function validateNewReminderLog(
  newLog: ReminderLogEntry,
  existingLogs: ReminderLogEntry[]
): void {
  validateLog(newLog);

  if (!Array.isArray(existingLogs)) {
    return fail("Existing reminder logs must be an array.");
  }

  for (const log of existingLogs) {
    validateLog(log);
  }

  if (existingLogs.some((log) => log.id === newLog.id)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "This reminder log ID already exists."
    );
  }

  const duplicateSuccessfulReminder = existingLogs.some(
    (log) =>
      log.studentId === newLog.studentId &&
      log.installmentId === newLog.installmentId &&
      log.reminderNumber === newLog.reminderNumber &&
      log.status === "Sent" &&
      newLog.status === "Sent"
  );

  if (duplicateSuccessfulReminder) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "This reminder number has already been sent for the installment."
    );
  }
}

/**
 * Summarizes reminder activity for one installment.
 * Only distinct successful reminder numbers consume the five-reminder limit.
 */
export function summarizeReminderLogs(
  studentId: string,
  installmentId: string,
  logs: ReminderLogEntry[]
): ReminderLogSummary {
  requireText(studentId, "Student ID");
  requireText(installmentId, "Installment ID");

  if (!Array.isArray(logs)) {
    return fail("Reminder logs must be an array.");
  }

  for (const log of logs) {
    validateLog(log);
  }

  const relevant = logs.filter(
    (log) =>
      log.studentId === studentId &&
      log.installmentId === installmentId
  );

  const sentNumbers = new Set(
    relevant
      .filter((log) => log.status === "Sent")
      .map((log) => log.reminderNumber)
  );

  const failed = relevant.filter(
    (log) => log.status === "Failed"
  ).length;

  const pending = relevant.filter(
    (log) => log.status === "Pending"
  ).length;

  const sent = sentNumbers.size;
  const remainingReminders = Math.max(
    0,
    MAX_REMINDERS - sent
  );

  return {
    total: relevant.length,
    sent,
    failed,
    pending,
    remainingReminders,
    limitReached: sent >= MAX_REMINDERS,
  };
}

/**
 * Updates the status of an existing log after a delivery attempt.
 */
export function updateReminderLogStatus(
  log: ReminderLogEntry,
  status: ReminderLogStatus,
  sentAt?: string
): ReminderLogEntry {
  validateLog(log);
  validateStatus(status);

  if (log.status === "Sent") {
    throw new BizBookError(
      "INVALID_STATUS",
      "A successfully sent reminder cannot be changed to another status."
    );
  }

  const timestamp = validateTimestamp(
    sentAt ?? new Date().toISOString()
  );

  return {
    ...log,
    status,
    sentAt: timestamp,
  };
}
