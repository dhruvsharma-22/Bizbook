
/**
 * BizBook Brain — Attendance Service
 *
 * Responsibilities:
 * - Mark and update staff attendance.
 * - Read attendance records.
 * - Calculate attendance summaries for a date range.
 * - Validate staff existence and attendance inputs.
 *
 * Uses the existing storage adapter and preserves the
 * current staffId__YYYY-MM-DD attendance storage format.
 *
 * This service does not modify the UI or create new storage keys.
 */

import { BizBookError } from "./errors";
import {
  getAttendanceRecordKey,
  readAttendance,
  readStudentsStaff,
  saveAttendance,
} from "./storage-adapter";
import {
  validateAttendanceInput,
  validateDate,
} from "./validation-engine";
import type {
  AttendanceData,
  AttendanceInput,
  AttendanceStatus,
  AttendanceSummary,
} from "./types";

/**
 * Ensures that the supplied staff member exists.
 */
function ensureStaffExists(staffId: string): void {
  if (typeof staffId !== "string" || !staffId.trim()) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Staff ID is required."
    );
  }

  const data = readStudentsStaff();

  const staffExists = data.staff.some(
    (staff) => staff.id === staffId
  );

  if (!staffExists) {
    throw new BizBookError(
      "STAFF_NOT_FOUND",
      "The selected staff member does not exist.",
      { staffId }
    );
  }
}

/**
 * Validates a date range using the existing date validator.
 */
function validateDateRange(
  startDate: string,
  endDate: string
): void {
  validateDate(startDate, "Start date");
  validateDate(endDate, "End date");

  // YYYY-MM-DD dates can be compared lexicographically.
  if (startDate > endDate) {
    throw new BizBookError(
      "INVALID_ATTENDANCE_DATE",
      "Start date cannot be after end date.",
      { startDate, endDate }
    );
  }
}

/**
 * Marks attendance for a staff member.
 *
 * A record already present for the staff member and date
 * cannot be overwritten by this operation.
 */
export function markAttendance(
  input: AttendanceInput
): AttendanceData {
  validateAttendanceInput(input);
  ensureStaffExists(input.staffId);

  const key = getAttendanceRecordKey(
    input.staffId,
    input.date
  );

  const attendance = readAttendance();

  if (Object.prototype.hasOwnProperty.call(attendance, key)) {
    throw new BizBookError(
      "DUPLICATE_ATTENDANCE",
      "Attendance has already been recorded for this staff member and date.",
      {
        staffId: input.staffId,
        date: input.date,
      }
    );
  }

  const updatedAttendance: AttendanceData = {
    ...attendance,
    [key]: input.status,
  };

  saveAttendance(updatedAttendance);

  return updatedAttendance;
}

/**
 * Updates an existing attendance record.
 *
 * Use markAttendance() to create a new record.
 */
export function updateAttendance(
  input: AttendanceInput
): AttendanceData {
  validateAttendanceInput(input);
  ensureStaffExists(input.staffId);

  const key = getAttendanceRecordKey(
    input.staffId,
    input.date
  );

  const attendance = readAttendance();

  if (!Object.prototype.hasOwnProperty.call(attendance, key)) {
    throw new BizBookError(
      "ATTENDANCE_NOT_FOUND",
      "No attendance record exists for this staff member and date.",
      {
        staffId: input.staffId,
        date: input.date,
      }
    );
  }

  const updatedAttendance: AttendanceData = {
    ...attendance,
    [key]: input.status,
  };

  saveAttendance(updatedAttendance);

  return updatedAttendance;
}

/**
 * Records attendance when the caller does not need to
 * distinguish between creating and updating a record.
 *
 * Existing records are updated; otherwise a new record is created.
 */
export function setAttendance(
  input: AttendanceInput
): AttendanceData {
  validateAttendanceInput(input);
  ensureStaffExists(input.staffId);

  const key = getAttendanceRecordKey(
    input.staffId,
    input.date
  );

  const attendance = readAttendance();

  const updatedAttendance: AttendanceData = {
    ...attendance,
    [key]: input.status,
  };

  saveAttendance(updatedAttendance);

  return updatedAttendance;
}

/**
 * Gets attendance for one staff member on one date.
 *
 * Returns undefined when no record exists.
 */
export function getAttendance(
  staffId: string,
  date: string
): AttendanceStatus | undefined {
  if (typeof staffId !== "string" || !staffId.trim()) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Staff ID is required."
    );
  }

  validateDate(date, "Attendance date");
  ensureStaffExists(staffId);

  const key = getAttendanceRecordKey(staffId, date);

  return readAttendance()[key];
}

/**
 * Gets all attendance records for a staff member within
 * an inclusive date range.
 */
export function getStaffAttendance(
  staffId: string,
  startDate: string,
  endDate: string
): Record<string, AttendanceStatus> {
  if (typeof staffId !== "string" || !staffId.trim()) {
    throw new BizBookError(
      "INVALID_ATTENDANCE",
      "Staff ID is required."
    );
  }

  validateDateRange(startDate, endDate);
  ensureStaffExists(staffId);

  const attendance = readAttendance();
  const prefix = `${staffId}__`;
  const result: Record<string, AttendanceStatus> = {};

  for (const [key, status] of Object.entries(attendance)) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const date = key.slice(prefix.length);

    // Ignore malformed or out-of-range keys.
    if (
      date.length !== 10 ||
      date < startDate ||
      date > endDate
    ) {
      continue;
    }

    result[date] = status;
  }

  return result;
}

/**
 * Gets all attendance entries recorded for one date.
 *
 * The result is keyed by staff ID.
 */
export function getAttendanceForDate(
  date: string
): Record<string, AttendanceStatus> {
  validateDate(date, "Attendance date");

  const attendance = readAttendance();
  const suffix = `__${date}`;
  const result: Record<string, AttendanceStatus> = {};

  for (const [key, status] of Object.entries(attendance)) {
    if (!key.endsWith(suffix)) {
      continue;
    }

    const staffId = key.slice(0, -suffix.length);

    if (staffId) {
      result[staffId] = status;
    }
  }

  return result;
}

/**
 * Calculates recorded attendance totals for one staff member.
 *
 * Only dates with stored attendance records are counted.
 * Missing dates are not automatically classified as absent.
 */
export function getAttendanceSummary(
  staffId: string,
  startDate: string,
  endDate: string
): AttendanceSummary {
  const records = getStaffAttendance(
    staffId,
    startDate,
    endDate
  );

  const summary: AttendanceSummary = {
    staffId,
    startDate,
    endDate,
    presentDays: 0,
    absentDays: 0,
    leaveDays: 0,
    holidayDays: 0,
    recordedDays: 0,
  };

  for (const status of Object.values(records)) {
    summary.recordedDays += 1;

    switch (status) {
      case "Present":
        summary.presentDays += 1;
        break;

      case "Absent":
        summary.absentDays += 1;
        break;

      case "Leave":
        summary.leaveDays += 1;
        break;

      case "Holiday":
        summary.holidayDays += 1;
        break;
    }
  }

  return summary;
}
