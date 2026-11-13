
import { BizBookError } from "./errors";
import { fromPaise, toPaise } from "./money";

export type AccountingEntryType =
  | "collection"
  | "expense"
  | "refund";

export type AccountingEntryStatus =
  | "completed"
  | "pending"
  | "cancelled";

export type AccountingEntryCategory =
  | "student_fee"
  | "student_advance"
  | "bizbook_subscription"
  | "salary"
  | "business_expense"
  | "refund"
  | "other";

export interface AccountingEntry {
  id: string;
  amount: number;
  type: AccountingEntryType;
  status: AccountingEntryStatus;
  date: string;
  category?: AccountingEntryCategory;
  coachingId?: string;
  referenceId?: string;
}

export interface AccountingSummary {
  totalCollections: number;
  totalExpenses: number;
  totalRefunds: number;
  netProfit: number;
  pendingCollections: number;
}

export interface MixedAccountingSummary extends AccountingSummary {
  studentFeeCollections: number;
  studentAdvanceReceipts: number;
  bizbookSubscriptionRevenue: number;
  salaryExpenses: number;
  businessExpenses: number;
}

const VALID_TYPES: readonly string[] = [
  "collection",
  "expense",
  "refund",
];

const VALID_STATUSES: readonly string[] = [
  "completed",
  "pending",
  "cancelled",
];

const VALID_CATEGORIES: readonly string[] = [
  "student_fee",
  "student_advance",
  "bizbook_subscription",
  "salary",
  "business_expense",
  "refund",
  "other",
];

const EXPECTED_CATEGORY_TYPES: Partial<
  Record<AccountingEntryCategory, AccountingEntryType>
> = {
  student_fee: "collection",
  student_advance: "collection",
  bizbook_subscription: "collection",
  salary: "expense",
  business_expense: "expense",
  refund: "refund",
};

function validateCategoryType(entry: AccountingEntry): void {
  if (entry.category === undefined) {
    return;
  }

  const expected = EXPECTED_CATEGORY_TYPES[entry.category];

  if (expected && entry.type !== expected) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Accounting category does not match the transaction type.",
      {
        entryId: entry.id,
        category: entry.category,
        expectedType: expected,
        actualType: entry.type,
      },
    );
  }
}

function validateAccountingEntries(
  entries: AccountingEntry[],
): void {
  if (!Array.isArray(entries)) {
    throw new BizBookError(
      "VALIDATION_ERROR",
      "Accounting entries must be an array.",
    );
  }

  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      entry.id.trim() === "" ||
      !VALID_TYPES.includes(entry.type) ||
      !VALID_STATUSES.includes(entry.status) ||
      typeof entry.date !== "string" ||
      entry.date.trim() === "" ||
      Number.isNaN(Date.parse(entry.date))
    ) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "An accounting entry has invalid fields.",
      );
    }

    if (seenIds.has(entry.id)) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Duplicate accounting entry ID detected.",
        { entryId: entry.id },
      );
    }

    seenIds.add(entry.id);

    const amountPaise = toPaise(entry.amount);

    if (amountPaise < 0) {
      throw new BizBookError(
        "INVALID_AMOUNT",
        "Accounting entry amounts cannot be negative.",
        {
          entryId: entry.id,
          amount: entry.amount,
        },
      );
    }

    if (
      entry.category !== undefined &&
      !VALID_CATEGORIES.includes(entry.category)
    ) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "An accounting entry has an invalid category.",
        {
          entryId: entry.id,
          category: entry.category,
        },
      );
    }

    validateCategoryType(entry);

    if (
      entry.coachingId !== undefined &&
      (
        typeof entry.coachingId !== "string" ||
        !entry.coachingId.trim()
      )
    ) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Coaching ID must be a non-empty string when supplied.",
        { entryId: entry.id },
      );
    }

    if (
      entry.referenceId !== undefined &&
      (
        typeof entry.referenceId !== "string" ||
        !entry.referenceId.trim()
      )
    ) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Reference ID must be a non-empty string when supplied.",
        { entryId: entry.id },
      );
    }
  }
}

/**
 * Sums matching transactions in paise.
 *
 * The status filter is configurable so completed totals and
 * pending collections can be calculated independently.
 * Cancelled entries are never included.
 */
function sumEntriesPaise(
  entries: AccountingEntry[],
  matches: (entry: AccountingEntry) => boolean,
  status: "completed" | "pending" = "completed",
): number {
  let totalPaise = 0;

  for (const entry of entries) {
    if (entry.status !== status) {
      continue;
    }

    if (!matches(entry)) {
      continue;
    }

    const amountPaise = toPaise(entry.amount);

    if (
      totalPaise >
      Number.MAX_SAFE_INTEGER - amountPaise
    ) {
      throw new BizBookError(
        "VALIDATION_ERROR",
        "Accounting total exceeds the safe numeric limit.",
      );
    }

    totalPaise += amountPaise;
  }

  return totalPaise;
}

function sumCompleted(
  entries: AccountingEntry[],
  type: AccountingEntryType,
): number {
  return sumEntriesPaise(
    entries,
    (entry) => entry.type === type,
    "completed",
  );
}

function sumCompletedCategory(
  entries: AccountingEntry[],
  type: AccountingEntryType,
  category: AccountingEntryCategory,
): number {
  return sumEntriesPaise(
    entries,
    (entry) =>
      entry.type === type &&
      entry.category === category,
    "completed",
  );
}

export function calculateAccountingSummary(
  entries: AccountingEntry[],
): AccountingSummary {
  validateAccountingEntries(entries);

  const collectionsPaise = sumCompleted(
    entries,
    "collection",
  );

  const expensesPaise = sumCompleted(
    entries,
    "expense",
  );

  const refundsPaise = sumCompleted(
    entries,
    "refund",
  );

  // Pending collections are calculated separately.
  // Pending expenses and refunds do not affect completed totals.
  const pendingCollectionsPaise = sumEntriesPaise(
    entries,
    (entry) => entry.type === "collection",
    "pending",
  );

  const netProfitPaise =
    collectionsPaise -
    expensesPaise -
    refundsPaise;

  return {
    totalCollections: fromPaise(collectionsPaise),
    totalExpenses: fromPaise(expensesPaise),
    totalRefunds: fromPaise(refundsPaise),

    // Net profit can legitimately be negative.
    netProfit: netProfitPaise / 100,

    pendingCollections: fromPaise(
      pendingCollectionsPaise,
    ),
  };
}

export function calculateMixedAccountingSummary(
  entries: AccountingEntry[],
): MixedAccountingSummary {
  validateAccountingEntries(entries);

  const summary = calculateAccountingSummary(entries);

  const studentFeePaise = sumCompletedCategory(
    entries,
    "collection",
    "student_fee",
  );

  const studentAdvancePaise = sumCompletedCategory(
    entries,
    "collection",
    "student_advance",
  );

  const subscriptionPaise = sumCompletedCategory(
    entries,
    "collection",
    "bizbook_subscription",
  );

  const salaryPaise = sumCompletedCategory(
    entries,
    "expense",
    "salary",
  );

  const businessExpensePaise = sumCompletedCategory(
    entries,
    "expense",
    "business_expense",
  );

  return {
    ...summary,
    studentFeeCollections: fromPaise(studentFeePaise),
    studentAdvanceReceipts: fromPaise(studentAdvancePaise),
    bizbookSubscriptionRevenue: fromPaise(subscriptionPaise),
    salaryExpenses: fromPaise(salaryPaise),
    businessExpenses: fromPaise(businessExpensePaise),
  };
}
