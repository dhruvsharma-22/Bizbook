
/**
 * BizBook Brain — Expense Engine
 *
 * Pure expense calculations.
 * No localStorage, database, or UI dependencies.
 */

import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";
import { validateExpenseRecord } from "./validation-engine";
import type { ExpenseRecord } from "./types";

export interface ExpenseSummary {
  totalAmount: number;
  totalRecords: number;
  categoryTotals: Record<string, number>;
  paymentMethodTotals: Record<string, number>;
}

/**
 * Validates a list of expense records and rejects duplicate IDs.
 */
export function validateExpenseRecords(
  expenses: ExpenseRecord[]
): void {
  if (!Array.isArray(expenses)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expenses must be provided as a list."
    );
  }

  const ids = new Set<string>();

  for (const expense of expenses) {
    validateExpenseRecord(expense);

    if (ids.has(expense.id)) {
      throw new BizBookError(
        "DUPLICATE_RECORD",
        "Duplicate expense ID found.",
        { expenseId: expense.id }
      );
    }

    ids.add(expense.id);
  }
}

/**
 * Calculates expense totals.
 *
 * Every expense is counted once. Salary payments should not
 * be passed into this function as ordinary expense records.
 */
export function summarizeExpenses(
  expenses: ExpenseRecord[]
): ExpenseSummary {
  validateExpenseRecords(expenses);

  let totalPaise = 0;
  const categoryPaise: Record<string, number> = {};
  const methodPaise: Record<string, number> = {};

  for (const expense of expenses) {
    const amountPaise = toPaise(expense.amount);

    totalPaise += amountPaise;

    if (!Number.isSafeInteger(totalPaise)) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Total expenses exceed the supported amount."
      );
    }

    const category = expense.category.trim();
    const method = expense.method;

    categoryPaise[category] =
      (categoryPaise[category] ?? 0) + amountPaise;

    methodPaise[method] =
      (methodPaise[method] ?? 0) + amountPaise;

    if (
      !Number.isSafeInteger(categoryPaise[category]) ||
      !Number.isSafeInteger(methodPaise[method])
    ) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "An expense subtotal exceeds the supported amount."
      );
    }
  }

  const convertTotals = (
    totals: Record<string, number>
  ): Record<string, number> =>
    Object.fromEntries(
      Object.entries(totals).map(([key, value]) => [
        key,
        fromPaise(value),
      ])
    );

  return {
    totalAmount: fromPaise(totalPaise),
    totalRecords: expenses.length,
    categoryTotals: convertTotals(categoryPaise),
    paymentMethodTotals: convertTotals(methodPaise),
  };
}

/**
 * Returns expenses within an inclusive date range.
 */
export function filterExpensesByDate(
  expenses: ExpenseRecord[],
  startDate: string,
  endDate: string
): ExpenseRecord[] {
  validateExpenseRecords(expenses);
  validateDateRange(startDate, endDate);

  return expenses.filter(
    (expense) =>
      expense.date >= startDate &&
      expense.date <= endDate
  );
}

/**
 * Returns expenses for a given category.
 */
export function filterExpensesByCategory(
  expenses: ExpenseRecord[],
  category: string
): ExpenseRecord[] {
  validateExpenseRecords(expenses);

  const normalizedCategory = category.trim().toLowerCase();

  if (!normalizedCategory) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense category is required."
    );
  }

  return expenses.filter(
    (expense) =>
      expense.category.trim().toLowerCase() === normalizedCategory
  );
}

function validateDateRange(
  startDate: string,
  endDate: string
): void {
  validateDateOnly(startDate);
  validateDateOnly(endDate);

  if (startDate > endDate) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Start date cannot be after end date.",
      { startDate, endDate }
    );
  }
}

function validateDateOnly(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Date must use YYYY-MM-DD format.",
      { date }
    );
  }

  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Date is not a valid calendar date.",
      { date }
    );
  }
}
