import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import { MAX_LEGACY_SOURCE_BYTES } from "./preview";

type UnknownRecord = Record<string, unknown>;

const PEOPLE_SOURCE_KEY = "bizbook-students-staff-v1";
const ATTENDANCE_SOURCE_KEY = "bizbook-staff-attendance-v1";
const SALARY_SOURCE_KEY = "bizbook-salary-payments-v1";
const MAX_COMPENSATION_PAISE = 999_999_999_999;

export type LegacyStaffImportCandidate = {
  sourceRecordId: string;
  name: string;
  gender: "Male" | "Female" | "Other" | null;
  mobile: string | null;
  whatsapp: string | null;
  designation: string;
  joiningDate: string | null;
  monthlySalaryPaise: number;
  paymentDay: number | null;
  perDayLeaveCutPaise: number;
  manualPayablePaise: number | null;
  salaryCalculationMode: "AttendanceBased" | "Fixed";
  attendanceEnabled: boolean;
  originalRecord: UnknownRecord;
  eligible: boolean;
  reason: string | null;
};

export type LegacyStaffImportPreview = {
  candidates: LegacyStaffImportCandidate[];
  issue: string | null;
};

type StorageReader = Pick<Storage, "getItem">;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(row: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function amountPaise(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const paise = parseAmountInputToPaise(String(value));
  return paise !== null && paise <= MAX_COMPENSATION_PAISE ? paise : null;
}

function dateValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function extractStaff(value: unknown): { rows: unknown[]; issue: string | null } {
  if (!isRecord(value)) return { rows: [], issue: "The students/staff value is not a supported object." };
  const nested = isRecord(value.data) && value.data.staff !== undefined ? value.data : value;
  if (nested.staff === undefined) return { rows: [], issue: null };
  if (!Array.isArray(nested.staff)) return { rows: [], issue: "The legacy staff field is not an array; no records were imported." };
  return { rows: nested.staff, issue: null };
}

function inspectHistory(storage: StorageReader, knownStaffIds: Set<string>): {
  staffIdsWithHistory: Set<string>;
  issue: string | null;
} {
  const staffIdsWithHistory = new Set<string>();
  let attendanceRaw: string | null;
  let salaryRaw: string | null;
  try {
    attendanceRaw = storage.getItem(ATTENDANCE_SOURCE_KEY);
    salaryRaw = storage.getItem(SALARY_SOURCE_KEY);
  } catch {
    return { staffIdsWithHistory, issue: "Staff attendance or salary history could not be read safely." };
  }

  if (attendanceRaw !== null) {
    if (new TextEncoder().encode(attendanceRaw).byteLength > MAX_LEGACY_SOURCE_BYTES) {
      return { staffIdsWithHistory, issue: "The attendance source exceeds the supported review size." };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(attendanceRaw) as unknown; }
    catch { return { staffIdsWithHistory, issue: "The attendance source is malformed." }; }
    if (!isRecord(parsed)) return { staffIdsWithHistory, issue: "The attendance source has an unsupported shape." };
    const statuses = new Set(["Present", "Absent", "Leave", "Holiday"]);
    for (const [key, status] of Object.entries(parsed)) {
      const splitAt = key.lastIndexOf("__");
      if (splitAt <= 0 || !dateValue(key.slice(splitAt + 2)) || !statuses.has(String(status))) {
        return { staffIdsWithHistory, issue: "Attendance contains an unmappable staff or date entry." };
      }
      const staffId = key.slice(0, splitAt);
      if (!knownStaffIds.has(staffId)) {
        return { staffIdsWithHistory, issue: "Attendance refers to a staff ID that is not present in the staff directory." };
      }
      staffIdsWithHistory.add(staffId);
    }
  }

  if (salaryRaw !== null) {
    if (new TextEncoder().encode(salaryRaw).byteLength > MAX_LEGACY_SOURCE_BYTES) {
      return { staffIdsWithHistory, issue: "The salary-payment source exceeds the supported review size." };
    }
    let parsed: unknown;
    try { parsed = JSON.parse(salaryRaw) as unknown; }
    catch { return { staffIdsWithHistory, issue: "The salary-payment source is malformed." }; }
    if (!Array.isArray(parsed)) return { staffIdsWithHistory, issue: "The salary-payment source has an unsupported shape." };
    for (const row of parsed) {
      if (!isRecord(row)) return { staffIdsWithHistory, issue: "A salary-payment row is malformed." };
      const staffId = stringValue(row, ["staffId", "staff_id", "employeeId", "employee_id"]);
      if (!staffId || !knownStaffIds.has(staffId)) {
        return { staffIdsWithHistory, issue: "Salary history refers to a staff ID that is not present in the staff directory." };
      }
      staffIdsWithHistory.add(staffId);
    }
  }
  return { staffIdsWithHistory, issue: null };
}

function makeCandidate(value: unknown, historyIds: Set<string>, index: number): LegacyStaffImportCandidate {
  const row = isRecord(value) ? value : {};
  const sourceRecordId = stringValue(row, ["id", "staffId", "staff_id", "employeeId", "employee_id"]);
  const name = stringValue(row, ["name", "staffName", "staff_name", "fullName", "full_name"]);
  const designation = stringValue(row, ["designation", "role", "jobTitle", "job_title"]);
  const reason = (message: string): LegacyStaffImportCandidate => ({
    sourceRecordId: sourceRecordId || `row-${index + 1}`,
    name: name || "Unnamed legacy staff row",
    gender: null,
    mobile: null,
    whatsapp: null,
    designation,
    joiningDate: null,
    monthlySalaryPaise: 0,
    paymentDay: null,
    perDayLeaveCutPaise: 0,
    manualPayablePaise: null,
    salaryCalculationMode: "AttendanceBased",
    attendanceEnabled: true,
    originalRecord: row,
    eligible: false,
    reason: message,
  });

  if (!isRecord(value)) return reason("This legacy staff row is not an object.");
  if (!sourceRecordId || sourceRecordId.length > 200) return reason("A stable legacy staff ID is required.");
  if (name.length < 1 || name.length > 100) return reason("A valid staff name is required.");
  if (!designation || designation.length > 100) return reason("A valid staff designation is required.");
  const hasSourceBranch = ["branchId", "branch_id", "branch"].some((key) =>
    row[key] !== undefined && row[key] !== null && row[key] !== "",
  );
  if (hasSourceBranch) return reason("The legacy branch needs an explicit source-to-target mapping before import.");
  if (historyIds.has(sourceRecordId)) return reason("Attendance or salary-payment history exists; reconcile it before importing this staff member.");

  for (const key of ["attendance", "attendanceHistory", "attendance_history", "salaryPayments", "salary_payments", "payments", "transactions"]) {
    const history = row[key];
    if (history !== undefined && history !== null && (!Array.isArray(history) || history.length > 0)) {
      return reason("Nested attendance or salary history must be mapped before importing this staff member.");
    }
  }
  const unpaidLeaveDays = row.unpaidLeaveDays ?? row.unpaid_leave_days;
  if (unpaidLeaveDays !== undefined && unpaidLeaveDays !== null && Number(unpaidLeaveDays) !== 0) {
    return reason("The legacy row includes attendance-derived leave; map its attendance history before import.");
  }
  const paidAmount = row.paidAmount ?? row.paid_amount;
  if (paidAmount !== undefined && paidAmount !== null && paidAmount !== "") {
    const paidPaise = amountPaise(paidAmount);
    if (paidPaise === null || paidPaise !== 0) return reason("A legacy salary-paid amount requires transaction reconciliation.");
  }
  const salaryStatus = stringValue(row, ["salaryStatus", "salary_status"]).toLowerCase();
  if (salaryStatus && !["pending", "unpaid", "not paid"].includes(salaryStatus)) {
    return reason("A legacy salary status is not proof of a salary payment.");
  }

  const salaryValue = row.monthlySalary ?? row.monthly_salary;
  const monthlySalaryPaise = amountPaise(salaryValue);
  if (monthlySalaryPaise === null) return reason("A valid current monthly compensation setting with paise precision is required.");

  const genderText = stringValue(row, ["gender"]).toLowerCase();
  const gender = !genderText ? null : ["male", "m"].includes(genderText) ? "Male"
    : ["female", "f"].includes(genderText) ? "Female"
      : ["other", "o"].includes(genderText) ? "Other" : null;
  if (genderText && !gender) return reason("The legacy gender value is unsupported.");

  const optionalPhone = (keys: readonly string[], label: string): { value: string | null; issue: string | null } => {
    const raw = row[keys[0]] ?? row[keys[1]];
    if (raw === undefined || raw === null || raw === "") return { value: null, issue: null };
    if (typeof raw !== "string" || !/^\d{10}$/.test(raw.trim())) return { value: null, issue: `The ${label} must be a 10-digit number or blank.` };
    return { value: raw.trim(), issue: null };
  };
  const mobile = optionalPhone(["mobile", "phone"], "mobile");
  if (mobile.issue) return reason(mobile.issue);
  const whatsapp = optionalPhone(["whatsapp", "whatsApp"], "WhatsApp number");
  if (whatsapp.issue) return reason(whatsapp.issue);

  const joiningValue = row.joiningDate ?? row.joining_date ?? null;
  const joiningDate = dateValue(joiningValue);
  if (joiningValue !== null && joiningValue !== "" && joiningDate === null) return reason("The joining date is invalid; expected YYYY-MM-DD.");
  const deductionValue = row.deductionPerDay ?? row.perDayLeaveCut ?? row.per_day_leave_cut ?? "0";
  const perDayLeaveCutPaise = amountPaise(deductionValue);
  if (perDayLeaveCutPaise === null) return reason("The per-day leave deduction is not a valid exact-paise amount.");
  const manualValue = row.manualPayableAmount ?? row.manual_payable_amount;
  const manualPayablePaise = manualValue === undefined || manualValue === null || manualValue === ""
    ? null : amountPaise(manualValue);
  if (manualValue !== undefined && manualValue !== null && manualValue !== "" && manualPayablePaise === null) {
    return reason("The manual payable setting is not a valid exact-paise amount.");
  }
  const paymentDayValue = row.paymentDate ?? row.paymentDay ?? row.payment_day;
  let paymentDay: number | null = null;
  if (paymentDayValue !== undefined && paymentDayValue !== null && paymentDayValue !== "") {
    const text = String(paymentDayValue).trim();
    if (!/^(?:[1-9]|[12]\d|3[01])$/.test(text)) return reason("The salary payment day must be a number between 1 and 31.");
    paymentDay = Number(text);
  }
  const attendanceValue = row.attendanceEnabled ?? row.attendance_enabled;
  if (attendanceValue !== undefined && typeof attendanceValue !== "boolean") return reason("The attendance calculation setting is invalid.");
  const attendanceEnabled = typeof attendanceValue === "boolean" ? attendanceValue : true;
  const modeValue = row.salaryCalculationMode ?? row.salary_calculation_mode;
  const mode = modeValue === undefined || modeValue === null || modeValue === ""
    ? attendanceEnabled ? "AttendanceBased" : "Fixed"
    : modeValue;
  if (mode !== "AttendanceBased" && mode !== "Fixed") return reason("The salary calculation mode is unsupported.");
  if ((mode === "Fixed") !== !attendanceEnabled) return reason("The attendance flag and salary calculation mode conflict.");

  return {
    sourceRecordId, name, gender, mobile: mobile.value, whatsapp: whatsapp.value, designation,
    joiningDate, monthlySalaryPaise, paymentDay, perDayLeaveCutPaise, manualPayablePaise,
    salaryCalculationMode: mode, attendanceEnabled, originalRecord: row, eligible: true, reason: null,
  };
}

/** Imports only staff directory/current compensation settings without attendance or salary history. */
export function previewLegacyStaffImports(storage: StorageReader): LegacyStaffImportPreview {
  let raw: string | null;
  try { raw = storage.getItem(PEOPLE_SOURCE_KEY); }
  catch { return { candidates: [], issue: "Browser staff data could not be read. No data was changed." }; }
  if (raw === null) return { candidates: [], issue: null };
  if (new TextEncoder().encode(raw).byteLength > MAX_LEGACY_SOURCE_BYTES) {
    return { candidates: [], issue: "The staff source exceeds the supported review size. No data was changed." };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { return { candidates: [], issue: "The staff source is malformed. The original browser value was left unchanged." }; }
  const extracted = extractStaff(parsed);
  if (extracted.issue) return { candidates: [], issue: extracted.issue };
  const knownIds = new Set(extracted.rows.filter(isRecord).map((row) => stringValue(row, ["id", "staffId", "staff_id", "employeeId", "employee_id"])));
  const history = inspectHistory(storage, knownIds);
  if (history.issue) return { candidates: [], issue: history.issue };
  const candidates = extracted.rows.map((row, index) => makeCandidate(row, history.staffIdsWithHistory, index));
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.sourceRecordId, (counts.get(candidate.sourceRecordId) ?? 0) + 1);
  return {
    candidates: candidates.map((candidate) => counts.get(candidate.sourceRecordId)! > 1
      ? { ...candidate, eligible: false, reason: "This legacy staff ID appears more than once." }
      : candidate),
    issue: null,
  };
}

export function legacyStaffRecordFingerprintInput(candidate: LegacyStaffImportCandidate): string {
  return JSON.stringify(candidate.originalRecord);
}
