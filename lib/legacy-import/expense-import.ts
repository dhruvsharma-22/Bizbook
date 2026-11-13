import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";
import type { PaymentMethod } from "@/lib/bizbook-brain/types";
import { MAX_LEGACY_SOURCE_BYTES } from "./preview";

type UnknownRecord = Record<string, unknown>;
type StorageReader = Pick<Storage, "getItem">;

export const LEGACY_EXPENSE_SOURCE_KEY = "bizbook-other-expenses-v1";
const MAX_EXPENSE_PAISE = 999_999_999_999;
const METHODS = new Set<PaymentMethod>(["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Online", "Other"]);
const SUPPORTED_FIELDS = new Set([
  "id", "expenseId", "expense_id", "title", "name", "description", "expenseName", "expense_name",
  "category", "expenseCategory", "expense_category", "type", "amount", "expenseAmount", "expense_amount",
  "date", "expenseDate", "expense_date", "method", "paymentMethod", "payment_method", "notes", "note",
  "createdAt", "created_at", "currency", "currencyCode", "currency_code",
]);

export type LegacyExpenseImportCandidate = {
  sourceRecordId: string;
  title: string;
  category: string;
  amountPaise: number;
  expenseDate: string;
  method: PaymentMethod | null;
  notes: string | null;
  eligible: boolean;
  reason: string | null;
};

export type LegacyExpenseImportPreview = {
  candidates: LegacyExpenseImportCandidate[];
  issue: string | null;
};

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

function dateValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const date = text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (text.length !== 10 && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function hasNonEmptyField(row: UnknownRecord, keys: readonly string[]): boolean {
  return keys.some((key) => row[key] !== undefined && row[key] !== null && row[key] !== "");
}

function isPaymentMethod(value: string): value is PaymentMethod {
  return METHODS.has(value as PaymentMethod);
}

function makeCandidate(value: unknown, index: number): LegacyExpenseImportCandidate {
  const row = isRecord(value) ? value : {};
  const sourceRecordId = stringValue(row, ["id", "expenseId", "expense_id"]);
  const title = stringValue(row, ["title", "name", "description", "expenseName", "expense_name"]);
  const category = stringValue(row, ["category", "expenseCategory", "expense_category", "type"]);
  const rawAmount = row.amount ?? row.expenseAmount ?? row.expense_amount;
  const amountPaise = typeof rawAmount === "number" || typeof rawAmount === "string"
    ? parseAmountInputToPaise(String(rawAmount))
    : null;
  const rawDate = row.date ?? row.expenseDate ?? row.expense_date;
  const expenseDate = dateValue(rawDate);
  const method = stringValue(row, ["method", "paymentMethod", "payment_method"]);
  const notesValue = row.notes ?? row.note ?? null;
  const reason = (message: string): LegacyExpenseImportCandidate => ({
    sourceRecordId: sourceRecordId || `row-${index + 1}`,
    title: title || "Unnamed legacy expense",
    category,
    amountPaise: amountPaise ?? 0,
    expenseDate: expenseDate ?? "",
    method: isPaymentMethod(method) ? method : null,
    notes: typeof notesValue === "string" ? notesValue.trim() || null : null,
    eligible: false,
    reason: message,
  });

  if (!isRecord(value)) return reason("This legacy expense row is not an object.");
  if (!sourceRecordId || sourceRecordId.length > 200) return reason("A stable legacy expense ID is required.");
  if (!title || title.length > 120) return reason("A valid expense title is required.");
  if (!category || category.length > 100) return reason("A valid expense category is required.");
  if (amountPaise === null || amountPaise <= 0 || amountPaise > MAX_EXPENSE_PAISE) {
    return reason("Enter a positive amount with exact paise precision within the database limit.");
  }
  if (!expenseDate) return reason("A valid expense date is required; creation time is not used as the expense date.");
  if (!isPaymentMethod(method)) return reason("A supported payment method is required.");
  if (notesValue !== null && typeof notesValue !== "string") return reason("Expense notes have an unsupported value.");
  if (typeof notesValue === "string" && notesValue.trim().length > 500) return reason("Expense notes must be 500 characters or fewer.");
  if (hasNonEmptyField(row, ["branchId", "branch_id", "branch"])) return reason("The source branch needs an explicit source-to-target mapping before import.");
  if (hasNonEmptyField(row, ["instituteId", "institute_id", "coachingId", "coaching_id"])) return reason("The source institute needs an explicit source-to-target mapping before import.");
  if (hasNonEmptyField(row, ["status", "paymentStatus", "payment_status"])) return reason("This legacy row has status metadata; review its accounting treatment before import.");
  if (hasNonEmptyField(row, ["currency", "currencyCode", "currency_code"])) {
    const currency = stringValue(row, ["currency", "currencyCode", "currency_code"]).toUpperCase();
    if (currency !== "INR") return reason("Only INR legacy expenses can be imported into this ledger.");
  }
  const unsupportedFields = Object.keys(row).filter((key) => !SUPPORTED_FIELDS.has(key));
  if (unsupportedFields.length) return reason("This legacy row has additional fields that need accounting review before import.");
  return {
    sourceRecordId, title, category, amountPaise, expenseDate, method,
    notes: typeof notesValue === "string" ? notesValue.trim() || null : null,
    eligible: true,
    reason: null,
  };
}

/** Reviews expense rows locally; it does not infer a branch or upload raw source rows. */
export function previewLegacyExpenseImports(storage: StorageReader): LegacyExpenseImportPreview {
  let raw: string | null;
  try { raw = storage.getItem(LEGACY_EXPENSE_SOURCE_KEY); }
  catch { return { candidates: [], issue: "Browser expense data could not be read. Nothing was changed." }; }
  if (raw === null) return { candidates: [], issue: null };
  if (new TextEncoder().encode(raw).byteLength > MAX_LEGACY_SOURCE_BYTES) {
    return { candidates: [], issue: "The expense source exceeds the supported review size. Nothing was changed." };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { return { candidates: [], issue: "The expense source is malformed. Original browser data was left unchanged." }; }
  if (!Array.isArray(parsed)) return { candidates: [], issue: "The legacy expense source is not an array; no records were imported." };
  const candidates = parsed.map(makeCandidate);
  const idCounts = new Map<string, number>();
  for (const candidate of candidates) idCounts.set(candidate.sourceRecordId, (idCounts.get(candidate.sourceRecordId) ?? 0) + 1);
  return {
    candidates: candidates.map((candidate) => idCounts.get(candidate.sourceRecordId)! > 1
      ? { ...candidate, eligible: false, reason: "This legacy expense ID appears more than once." }
      : candidate),
    issue: null,
  };
}
