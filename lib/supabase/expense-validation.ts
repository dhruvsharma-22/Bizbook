import { parseAmountInputToPaise } from "@/lib/bizbook-brain/money";

export const EXPENSE_METHODS = [
  "Cash",
  "UPI",
  "Bank Transfer",
  "Card",
  "Cheque",
  "Online",
  "Other",
] as const;

export type ExpenseInput = {
  title: string;
  category: string;
  amount: number;
  expenseDate: string;
  method: (typeof EXPENSE_METHODS)[number];
  notes: string | null;
  branchId: string | null;
};

export type ExpenseValidationResult =
  | { ok: true; value: ExpenseInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseExpenseInput(
  raw: unknown,
  businessDate: string,
): ExpenseValidationResult {
  if (!isRecord(raw)) return { ok: false, error: "Expense details are invalid." };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const category = typeof raw.category === "string" ? raw.category.trim() : "";
  const amountInput = typeof raw.amount === "number" && Number.isFinite(raw.amount)
    ? String(raw.amount)
    : typeof raw.amount === "string" ? raw.amount.trim() : "";
  const amountPaise = parseAmountInputToPaise(amountInput);
  const expenseDate = raw.expenseDate;
  const method = raw.method;
  const notes = typeof raw.notes === "string" ? raw.notes.trim() : "";
  const branchId = raw.branchId === null || raw.branchId === undefined
    ? null
    : typeof raw.branchId === "string" ? raw.branchId.trim() : "";

  if (!title || title.length > 120) return { ok: false, error: "Expense title must contain 1 to 120 characters." };
  if (!category || category.length > 100) return { ok: false, error: "Expense category must contain 1 to 100 characters." };
  if (amountPaise === null || amountPaise <= 0) {
    return { ok: false, error: "Enter a positive expense amount with no more than two decimal places." };
  }
  if (!validDate(expenseDate) || !validDate(businessDate) || expenseDate > businessDate) {
    return { ok: false, error: "Choose a valid expense date that is not in the future." };
  }
  if (!(EXPENSE_METHODS as readonly unknown[]).includes(method)) return { ok: false, error: "Choose a supported payment method." };
  if (notes.length > 500) return { ok: false, error: "Expense notes must be 500 characters or fewer." };
  if (branchId !== null && (!branchId || branchId.length > 100)) return { ok: false, error: "Choose a valid branch." };

  return {
    ok: true,
    value: {
      title,
      category,
      amount: amountPaise / 100,
      expenseDate,
      method: method as ExpenseInput["method"],
      notes: notes || null,
      branchId,
    },
  };
}

export function parseVoidExpenseInput(raw: unknown):
  | { ok: true; expenseId: string; reason: string }
  | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Void details are invalid." };
  const expenseId = typeof raw.expenseId === "string" ? raw.expenseId.trim() : "";
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!expenseId || expenseId.length > 100) return { ok: false, error: "Choose a valid expense." };
  if (reason.length < 3 || reason.length > 500) return { ok: false, error: "Enter a void reason from 3 to 500 characters." };
  return { ok: true, expenseId, reason };
}
