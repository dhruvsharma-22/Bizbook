
/**
 * BizBook Brain — Central Error Handling
 *
 * Provides consistent error codes and messages for:
 * payments, installments, balances, attendance, salary,
 * expenses, validation and storage.
 *
 * This file defines errors only. It does not read or write data.
 */

export type BizBookErrorCode =
  /* Financial validation */
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INVALID_PAYMENT"
  | "DUPLICATE_PAYMENT"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_NOT_VERIFIED"
  | "ALLOCATION_EXCEEDS_BALANCE"
  | "ADVANCE_NOT_AVAILABLE"

  /* Student and installment */
  | "STUDENT_NOT_FOUND"
  | "INSTALLMENT_NOT_FOUND"

  /* Staff */
  | "STAFF_NOT_FOUND"

  /* Attendance */
  | "ATTENDANCE_NOT_FOUND"
  | "INVALID_ATTENDANCE"
  | "INVALID_ATTENDANCE_DATE"
  | "DUPLICATE_ATTENDANCE"

  /* Salary */
  | "SALARY_CALCULATION_FAILED"
  | "INVALID_SALARY"
  | "SALARY_PAYMENT_NOT_FOUND"
  | "DUPLICATE_SALARY_PAYMENT"

  /* Expenses */
  | "EXPENSE_NOT_FOUND"
  | "INVALID_EXPENSE"
  | "DUPLICATE_EXPENSE"

  /* General validation and storage */
  | "INVALID_STATUS"
  | "STORAGE_ERROR"
  | "VALIDATION_ERROR"
  | "RECORD_NOT_FOUND"
  | "DUPLICATE_RECORD"
  | "INVALID_OPERATION"
  | "UNKNOWN_ERROR";

/**
 * Standard BizBook Brain error.
 */
export class BizBookError extends Error {
  public readonly code: BizBookErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: BizBookErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);

    this.name = "BizBookError";
    this.code = code;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Checks whether an error belongs to BizBook Brain.
 */
export function isBizBookError(
  error: unknown
): error is BizBookError {
  return error instanceof BizBookError;
}

/**
 * Returns a readable message for an error.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected BizBook error occurred.";
}

/**
 * Creates a standardized validation error.
 */
export function createValidationError(
  message: string,
  details?: Record<string, unknown>
): BizBookError {
  return new BizBookError(
    "VALIDATION_ERROR",
    message,
    details
  );
}

/**
 * Creates a standardized storage error.
 */
export function createStorageError(
  message = "Unable to read or save BizBook data.",
  details?: Record<string, unknown>
): BizBookError {
  return new BizBookError(
    "STORAGE_ERROR",
    message,
    details
  );
}

/**
 * Creates a standardized not-found error.
 */
export function createNotFoundError(
  entity: string,
  id?: string
): BizBookError {
  const normalizedEntity = entity.trim();

  return new BizBookError(
    "RECORD_NOT_FOUND",
    `${normalizedEntity || "Record"} was not found.`,
    id ? { entity: normalizedEntity, id } : {
      entity: normalizedEntity,
    }
  );
}

/**
 * Creates a standardized invalid-operation error.
 */
export function createInvalidOperationError(
  message: string,
  details?: Record<string, unknown>
): BizBookError {
  return new BizBookError(
    "INVALID_OPERATION",
    message,
    details
  );
}
