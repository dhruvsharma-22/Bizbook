
/**
 * BizBook Brain — Expense Service
 *
 * Handles expense records using the shared storage adapter.
 * Does not write to payment history, preventing duplicate
 * expense entries in financial reports.
 */

import { BizBookError } from "./errors";
import {
  readExpenses,
  saveExpenses,
} from "./storage-adapter";
import {
  validateExpenseInput,
  validateExpenseRecord,
} from "./validation-engine";
import {
  filterExpensesByDate,
  filterExpensesByCategory,
  summarizeExpenses,
} from "./expense-engine";
import type {
  ExpenseInput,
  ExpenseRecord,
} from "./types";

function createExpenseId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `expense-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function validateExpenseId(expenseId: string): void {
  if (
    typeof expenseId !== "string" ||
    !expenseId.trim()
  ) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Expense ID is required.",
    );
  }
}

/**
 * Creates and saves an expense record.
 */
export function createExpense(
  input: ExpenseInput,
): ExpenseRecord {
  validateExpenseInput(input);

  const expenses = readExpenses();

  // Validate saved records before adding another record.
  if (!Array.isArray(expenses)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Saved expenses are not in a valid format.",
    );
  }

  for (const existing of expenses) {
    validateExpenseRecord(existing);
  }

  const expense: ExpenseRecord = {
    ...input,
    id: createExpenseId(),
    createdAt: createTimestamp(),
  };

  validateExpenseRecord(expense);

  if (expenses.some((item) => item.id === expense.id)) {
    throw new BizBookError(
      "DUPLICATE_RECORD",
      "An expense with this ID already exists.",
      { expenseId: expense.id },
    );
  }

  saveExpenses([...expenses, expense]);

  return expense;
}

/**
 * Returns expenses with optional date and category filters.
 */
export function listExpenses(
  filters: {
    startDate?: string;
    endDate?: string;
    category?: string;
  } = {},
): ExpenseRecord[] {
  let expenses = readExpenses();

  if (!Array.isArray(expenses)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Saved expenses are not in a valid format.",
    );
  }

  if (filters.startDate || filters.endDate) {
    const startDate =
      filters.startDate ?? "0001-01-01";
    const endDate =
      filters.endDate ?? "9999-12-31";

    expenses = filterExpensesByDate(
      expenses,
      startDate,
      endDate,
    );
  }

  if (filters.category !== undefined) {
    expenses = filterExpensesByCategory(
      expenses,
      filters.category,
    );
  }

  return expenses;
}

/**
 * Updates an existing expense while preserving its ID
 * and original creation timestamp.
 */
export function updateExpense(
  expenseId: string,
  changes: ExpenseInput,
): ExpenseRecord {
  validateExpenseId(expenseId);
  validateExpenseInput(changes);

  const expenses = readExpenses();

  if (!Array.isArray(expenses)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Saved expenses are not in a valid format.",
    );
  }

  const index = expenses.findIndex(
    (expense) => expense.id === expenseId,
  );

  if (index === -1) {
    throw new BizBookError(
      "RECORD_NOT_FOUND",
      "Expense record was not found.",
      { expenseId },
    );
  }

  const existing = expenses[index];

  // Validate the saved record before changing it.
  validateExpenseRecord(existing);

  const updated: ExpenseRecord = {
    ...existing,
    ...changes,
    id: existing.id,
    createdAt: existing.createdAt,
  };

  validateExpenseRecord(updated);

  const nextExpenses = [...expenses];
  nextExpenses[index] = updated;

  saveExpenses(nextExpenses);

  return updated;
}

/**
 * Deletes an expense by ID.
 */
export function deleteExpense(
  expenseId: string,
): void {
  validateExpenseId(expenseId);

  const expenses = readExpenses();

  if (!Array.isArray(expenses)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Saved expenses are not in a valid format.",
    );
  }

  const index = expenses.findIndex(
    (expense) => expense.id === expenseId,
  );

  if (index === -1) {
    throw new BizBookError(
      "RECORD_NOT_FOUND",
      "Expense record was not found.",
      { expenseId },
    );
  }

  // Validate the target before deleting it.
  validateExpenseRecord(expenses[index]);

  const remaining = expenses.filter(
    (expense) => expense.id !== expenseId,
  );

  saveExpenses(remaining);
}

/**
 * Returns the summary of saved expenses.
 */
export function getExpenseSummary(): ReturnType<
  typeof summarizeExpenses
> {
  const expenses = readExpenses();

  if (!Array.isArray(expenses)) {
    throw new BizBookError(
      "INVALID_EXPENSE",
      "Saved expenses are not in a valid format.",
    );
  }

  return summarizeExpenses(expenses);
}
