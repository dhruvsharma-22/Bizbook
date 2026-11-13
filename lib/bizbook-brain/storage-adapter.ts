/**

* BizBook Brain — Storage Adapter

*

* Current storage: browser localStorage

* Future storage: Supabase/PostgreSQL

*

* Responsibilities:

* - Centralize business-data reads and writes.

* - Preserve existing storage keys and data formats.

* - Provide consistent storage errors.

* - Dispatch update events.

* - Coordinate multi-record writes with best-effort rollback.

*

* Business calculations and financial decisions belong

* in Brain engines and services, not in this file.

*/

import { BizBookError } from "./errors";

import {

ADVANCE_PAYMENTS_STORAGE_KEY,

ATTENDANCE_KEY_SEPARATOR,

ATTENDANCE_STORAGE_KEY,

EXPENSES_STORAGE_KEY,

PAYMENT_HISTORY_STORAGE_KEY,

PAYMENT_RECORDS_STORAGE_KEY,

REFUNDS_STORAGE_KEY,

SALARY_PAYMENTS_STORAGE_KEY,

STUDENTS_STAFF_STORAGE_KEY,

} from "./constants";

import type {

AdvancePayment,

FeeReceipt,

StaffMember,

AttendanceData,

ExpenseRecord,

PaymentHistoryEntry,

PaymentRecord,

SalaryPayment,

Student,

StudentsStaffData,

} from "./types";

import type { RefundRecord } from "./refund-engine";

/* =========================================================

EXISTING STORAGE KEYS — PRESERVED

========================================================= */

const FEE_RECEIPTS_STORAGE_KEY = "bizbook-fee-receipts-v1";

export const BIZBOOK_STORAGE_KEYS = {

feeReceipts: FEE_RECEIPTS_STORAGE_KEY,

studentsStaff: STUDENTS_STAFF_STORAGE_KEY,

advancePayments: ADVANCE_PAYMENTS_STORAGE_KEY,

paymentHistory: PAYMENT_HISTORY_STORAGE_KEY,

paymentRecords: PAYMENT_RECORDS_STORAGE_KEY,

salaryPayments: SALARY_PAYMENTS_STORAGE_KEY,

} as const;

export const BIZBOOK_EXPENSES_KEY = EXPENSES_STORAGE_KEY;

export const BIZBOOK_ATTENDANCE_KEY = ATTENDANCE_STORAGE_KEY;

export const BIZBOOK_REFUNDS_KEY = REFUNDS_STORAGE_KEY;

/* =========================================================

STORAGE UTILITIES

========================================================= */

function ensureBrowser(): void {

if (typeof window === "undefined") {

throw new BizBookError(

"STORAGE_ERROR",

"Browser storage is not available on the server."

);

}

}

function isRecord(

value: unknown

): value is Record<string, unknown> {

return (

typeof value === "object" &&

value !== null &&

!Array.isArray(value)

);

}

function readJSON<T>(key: string, fallback: T): T {

ensureBrowser();

try {

const raw = window.localStorage.getItem(key);

if (raw === null) {

return fallback;

}

return JSON.parse(raw) as T;

} catch {

throw new BizBookError(

"STORAGE_ERROR",

`Could not read BizBook data from "${key}".`,

{ key }

);

}

}

function writeJSON<T>(key: string, value: T): void {

ensureBrowser();

try {

const serialized = JSON.stringify(value);

if (serialized === undefined) {

throw new Error("Value cannot be serialized.");

}

window.localStorage.setItem(key, serialized);

} catch {

throw new BizBookError(

"STORAGE_ERROR",

`Could not save BizBook data to "${key}".`,

{ key }

);

}

}

function dispatchUpdate(eventName: string): void {

ensureBrowser();

window.dispatchEvent(new Event(eventName));

}

/* =========================================================

MULTI-RECORD TRANSACTIONS

========================================================= */

export interface StorageTransactionWrite {

key: string;

value: unknown;

eventName?: string;

}

/**

* Coordinates writes across multiple localStorage keys.

*

* This provides best-effort rollback, not true atomicity.

* Use a database transaction after migrating financial

* operations to Supabase/PostgreSQL.

*/

export function runStorageTransaction(

writes: StorageTransactionWrite[]

): void {

ensureBrowser();

if (!Array.isArray(writes) || writes.length === 0) {

throw new BizBookError(

"VALIDATION_ERROR",

"At least one storage write is required."

);

}

const seenKeys = new Set<string>();

const preparedWrites = writes.map((write) => {

if (

!write ||

typeof write !== "object" ||

typeof write.key !== "string" ||

!write.key.trim()

) {

throw new BizBookError(

"VALIDATION_ERROR",

"Every transaction write must have a valid storage key."

);

}

if (seenKeys.has(write.key)) {

throw new BizBookError(

"VALIDATION_ERROR",

`Duplicate storage key in transaction: "${write.key}".`,

{ key: write.key }

);

}

seenKeys.add(write.key);

if (

write.eventName !== undefined &&

(

typeof write.eventName !== "string" ||

!write.eventName.trim()

)

) {

throw new BizBookError(

"VALIDATION_ERROR",

"Storage update event names must be non-empty strings."

);

}

let serialized: string;

try {

const result = JSON.stringify(write.value);

if (result === undefined) {

throw new Error("Value cannot be serialized.");

}

serialized = result;

} catch {

throw new BizBookError(

"VALIDATION_ERROR",

`Value for "${write.key}" cannot be serialized.`,

{ key: write.key }

);

}

return {

key: write.key,

serialized,

eventName: write.eventName,

};

});

// Capture original values before changing any keys.

const previousValues = new Map<string, string | null>();

try {

for (const write of preparedWrites) {

previousValues.set(

write.key,

window.localStorage.getItem(write.key)

);

}

} catch {

throw new BizBookError(

"STORAGE_ERROR",

"Could not capture the original storage values. No transaction writes were attempted."

);

}

try {

for (const write of preparedWrites) {

window.localStorage.setItem(

write.key,

write.serialized

);

}

} catch {

let rollbackFailed = false;

// Restore in reverse order and attempt every restoration.

for (const write of [...preparedWrites].reverse()) {

try {

const previousValue = previousValues.get(write.key);

if (

previousValue === null ||

previousValue === undefined

) {

window.localStorage.removeItem(write.key);

} else {

window.localStorage.setItem(

write.key,

previousValue

);

}

} catch {

rollbackFailed = true;

}

}

if (rollbackFailed) {

// Notify listeners because storage may be inconsistent.

for (const write of preparedWrites) {

if (write.eventName) {

try {

dispatchUpdate(write.eventName);

} catch {

// Preserve the original storage failure.

}

}

}

throw new BizBookError(

"STORAGE_ERROR",

"The storage transaction failed and rollback could not be completed. Check all affected records before retrying.",

{

keys: preparedWrites.map((write) => write.key),

rollbackFailed: true,

}

);

}

throw new BizBookError(

"STORAGE_ERROR",

"The storage transaction failed. The original values were restored.",

{

keys: preparedWrites.map((write) => write.key),

rollbackFailed: false,

}

);

}

// Notify listeners only after every write succeeds.

const dispatchedEvents = new Set<string>();

for (const write of preparedWrites) {

if (

write.eventName &&

!dispatchedEvents.has(write.eventName)

) {

dispatchedEvents.add(write.eventName);

dispatchUpdate(write.eventName);

}

}

}

/* =========================================================

STUDENTS AND STAFF

========================================================= */

export function readStudentsStaff(): StudentsStaffData {

const rawData = readJSON<unknown>(
  BIZBOOK_STORAGE_KEYS.studentsStaff,
  { students: [], staff: [] },
);

if (Array.isArray(rawData)) {
  return { students: rawData as Student[], staff: [] };
}

if (
  isRecord(rawData) &&
  !Array.isArray(rawData.students) &&
  isRecord(rawData.data) &&
  Array.isArray(rawData.data.students)
) {
  const nestedStaff = rawData.data.staff ?? rawData.staff ?? [];
  if (!Array.isArray(nestedStaff)) {
    throw new BizBookError(
      "STORAGE_ERROR",
      "Staff data has an invalid format.",
    );
  }

  return {
    ...rawData,
    students: rawData.data.students as Student[],
    staff: nestedStaff as StaffMember[],
  } as StudentsStaffData;
}

const data = readJSON<StudentsStaffData>(

BIZBOOK_STORAGE_KEYS.studentsStaff,

{

students: [],

staff: [],

}

);

if (

!data ||

!Array.isArray(data.students) ||

data.staff !== undefined && !Array.isArray(data.staff)

) {

throw new BizBookError(

"STORAGE_ERROR",

"Student and staff data has an invalid format."

);

}

return {
  ...data,
  staff: (data.staff ?? []) as StaffMember[],
};

}

/** Returns updated student/staff data in the stored legacy shape. */
export function prepareStudentsStaffStorageValue(
  data: StudentsStaffData,
): unknown {
  if (
    !data ||
    !Array.isArray(data.students) ||
    !Array.isArray(data.staff)
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Invalid student and staff data.",
    );
  }

  const existing = readJSON<unknown>(
    BIZBOOK_STORAGE_KEYS.studentsStaff,
    { students: [], staff: [] },
  );

  if (Array.isArray(existing)) {
    if (data.staff.length > 0) {
      throw new BizBookError(
        "STORAGE_ERROR",
        "This legacy student-only array cannot store staff without an explicit data migration.",
      );
    }
    return data.students;
  }

  if (
    isRecord(existing) &&
    isRecord(existing.data) &&
    Array.isArray(existing.data.students)
  ) {
    const nested: Record<string, unknown> = {
      ...existing.data,
      students: data.students,
    };

    if (Array.isArray(existing.data.staff)) {
      nested.staff = data.staff;
    } else if (Array.isArray(existing.staff)) {
      return {
        ...existing,
        staff: data.staff,
        data: nested,
      };
    } else if (data.staff.length > 0) {
      nested.staff = data.staff;
    }

    return { ...existing, data: nested };
  }

  if (isRecord(existing) && Array.isArray(existing.students)) {
    const updated: Record<string, unknown> = {
      ...existing,
      students: data.students,
    };

    if (Array.isArray(existing.staff) || data.staff.length > 0) {
      updated.staff = data.staff;
    }

    return updated;
  }

  return data;
}

export function saveStudentsStaff(

data: StudentsStaffData

): void {

if (

!data ||

!Array.isArray(data.students) ||

!Array.isArray(data.staff)

) {

throw new BizBookError(

"VALIDATION_ERROR",

"Invalid student and staff data."

);

}

writeJSON(
  BIZBOOK_STORAGE_KEYS.studentsStaff,
  prepareStudentsStaffStorageValue(data),
);

dispatchUpdate("bizbook-students-updated");

}

export function getStudentById(

studentId: string

): Student | undefined {

if (

typeof studentId !== "string" ||

!studentId.trim()

) {

return undefined;

}

return readStudentsStaff().students.find(

(student) => student.id === studentId

);

}

/* =========================================================

ATTENDANCE

========================================================= */

/**

* Existing attendance format:

* {

*   "staffId__YYYY-MM-DD": "Present",

*   "staffId__YYYY-MM-DD": "Absent"

* }

*

* The existing key format is preserved.

*/

export function getAttendanceRecordKey(

staffId: string,

date: string

): string {

if (

typeof staffId !== "string" ||

!staffId.trim() ||

typeof date !== "string" ||

!date.trim()

) {

throw new BizBookError(

"VALIDATION_ERROR",

"A staff ID and attendance date are required.",

{ staffId, date }

);

}

return `${staffId}${ATTENDANCE_KEY_SEPARATOR}${date}`;

}

export function readAttendance(): AttendanceData {

const attendance = readJSON<AttendanceData>(

BIZBOOK_ATTENDANCE_KEY,

{}

);

if (!isRecord(attendance)) {

throw new BizBookError(

"STORAGE_ERROR",

"Attendance data has an invalid format."

);

}

return attendance as AttendanceData;

}

export function saveAttendance(

attendance: AttendanceData

): void {

if (!isRecord(attendance)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Attendance must be a record map."

);

}

writeJSON(BIZBOOK_ATTENDANCE_KEY, attendance);

dispatchUpdate("bizbook-attendance-updated");

}

export function getAttendanceStatus(

staffId: string,

date: string

): AttendanceData[string] | undefined {

const key = getAttendanceRecordKey(staffId, date);

return readAttendance()[key];

}

/* =========================================================

ADVANCE PAYMENTS

========================================================= */

export function readAdvancePayments(): AdvancePayment[] {

const payments = readJSON<AdvancePayment[]>(

BIZBOOK_STORAGE_KEYS.advancePayments,

[]

);

if (!Array.isArray(payments)) {

throw new BizBookError(

"STORAGE_ERROR",

"Advance-payment data has an invalid format."

);

}

return payments;

}

export function saveAdvancePayments(

payments: AdvancePayment[]

): void {

if (!Array.isArray(payments)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Advance payments must be an array."

);

}

writeJSON(

BIZBOOK_STORAGE_KEYS.advancePayments,

payments

);

dispatchUpdate("bizbook-advance-payments-updated");

}

/* =========================================================

ORDINARY FEE RECEIPTS — SEPARATE FROM ADVANCES

========================================================= */

/**
 * Ordinary fee receipts are stored separately from advance receipts.
 * They must never be included in the available-advance balance.
 */
export function readFeeReceipts(): FeeReceipt[] {
  const receipts = readJSON<FeeReceipt[]>(
    BIZBOOK_STORAGE_KEYS.feeReceipts,
    []
  );

  if (!Array.isArray(receipts)) {
    throw new BizBookError(
      "STORAGE_ERROR",
      "Fee-receipt data has an invalid format."
    );
  }

  return receipts;
}

/** Saves ordinary fee receipts only; it does not verify or collect payment. */
export function saveFeeReceipts(receipts: FeeReceipt[]): void {
  if (!Array.isArray(receipts)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Fee receipts must be an array."
    );
  }

  writeJSON(BIZBOOK_STORAGE_KEYS.feeReceipts, receipts);
  dispatchUpdate("bizbook-fee-receipts-updated");
}

/* =========================================================

PAYMENT HISTORY — LEGACY FORMAT PRESERVED

========================================================= */

export function readPaymentHistory(): PaymentHistoryEntry[] {

const history = readJSON<PaymentHistoryEntry[]>(

BIZBOOK_STORAGE_KEYS.paymentHistory,

[]

);

if (!Array.isArray(history)) {

throw new BizBookError(

"STORAGE_ERROR",

"Payment history has an invalid format."

);

}

return history;

}

export function savePaymentHistory(

entries: PaymentHistoryEntry[]

): void {

if (!Array.isArray(entries)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Payment history must be an array."

);

}

writeJSON(

BIZBOOK_STORAGE_KEYS.paymentHistory,

entries

);

dispatchUpdate("bizbook-payments-updated");

}

/* =========================================================

PAYMENT RECORDS — BRAIN FORMAT

========================================================= */

/**

* Payment records are stored separately from legacy payment

* history. Do not automatically duplicate these records into

* payment history or count both as separate receipts.

*/

export function readPaymentRecords(): PaymentRecord[] {

const payments = readJSON<PaymentRecord[]>(

BIZBOOK_STORAGE_KEYS.paymentRecords,

[]

);

if (!Array.isArray(payments)) {

throw new BizBookError(

"STORAGE_ERROR",

"Payment-record data has an invalid format."

);

}

return payments;

}

/**

* Saves prepared payment records.

*

* This function only persists data. It does not verify an

* online payment, contact a provider, or move money.

*/

export function savePaymentRecords(

payments: PaymentRecord[]

): void {

if (!Array.isArray(payments)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Payment records must be an array."

);

}

writeJSON(

BIZBOOK_STORAGE_KEYS.paymentRecords,

payments

);

dispatchUpdate("bizbook-payment-records-updated");

}

/* =========================================================

SALARY PAYMENTS

========================================================= */

/**

* Existing record-map format:

* {

*   "staffId__YYYY-MM": {

*     staffId,

*     month,

*     amount,

*     status,

*     paidAt,

*     method

*   }

* }

*/

export function readSalaryPayments(): Record<

string,

SalaryPayment

> {

const payments = readJSON<

Record<string, SalaryPayment>

>(

BIZBOOK_STORAGE_KEYS.salaryPayments,

{}

);

if (!isRecord(payments)) {

throw new BizBookError(

"STORAGE_ERROR",

"Salary-payment data has an invalid format."

);

}

return payments as Record<string, SalaryPayment>;

}

export function saveSalaryPayments(

payments: Record<string, SalaryPayment>

): void {

if (!isRecord(payments)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Salary payments must be a record map."

);

}

writeJSON(

BIZBOOK_STORAGE_KEYS.salaryPayments,

payments

);

dispatchUpdate("bizbook-salary-payments-updated");

}

/* =========================================================

BUSINESS EXPENSES

========================================================= */

export function readExpenses(): ExpenseRecord[] {

const expenses = readJSON<ExpenseRecord[]>(

BIZBOOK_EXPENSES_KEY,

[]

);

if (!Array.isArray(expenses)) {

throw new BizBookError(

"STORAGE_ERROR",

"Expense data has an invalid format."

);

}

return expenses;

}

export function saveExpenses(

expenses: ExpenseRecord[]

): void {

if (!Array.isArray(expenses)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Expenses must be an array."

);

}

writeJSON(BIZBOOK_EXPENSES_KEY, expenses);

dispatchUpdate("bizbook-expenses-updated");

}

/* =========================================================

REFUNDS

========================================================= */

/**

* Refund records are stored separately from payment history.

* Financial reports must ensure each refund is counted once.

*/

export function readRefunds(): RefundRecord[] {

const refunds = readJSON<RefundRecord[]>(

BIZBOOK_REFUNDS_KEY,

[]

);

if (!Array.isArray(refunds)) {

throw new BizBookError(

"STORAGE_ERROR",

"Refund data has an invalid format."

);

}

return refunds;

}

/**

* Saves refund records only.

*

* This does not send money or confirm a refund with a

* payment provider.

*/

export function saveRefunds(

refunds: RefundRecord[]

): void {

if (!Array.isArray(refunds)) {

throw new BizBookError(

"VALIDATION_ERROR",

"Refunds must be an array."

);

}

writeJSON(BIZBOOK_REFUNDS_KEY, refunds);

dispatchUpdate("bizbook-refunds-updated");

}
