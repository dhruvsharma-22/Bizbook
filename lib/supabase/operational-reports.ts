export type ActivitySummaryInput = {
  activity_month?: string | null;
  category: string;
  direction: string;
  amount_total: number | string;
};

export type InstallmentForecastInput = {
  due_date: string | null;
  outstanding_amount: number | string;
  balance_status: string;
};

export type MonthlyLedgerSummary = {
  month: string;
  feeReceiptsPaise: number;
  advanceReceiptsPaise: number;
  completedRefundsPaise: number;
  payrollPaise: number;
  businessExpensesPaise: number;
  collectedRevenuePaise: number;
  totalExpensesPaise: number;
  netPaise: number;
  invalidRows: number;
};

export type ForecastBucket = {
  installmentCount: number;
  amountPaise: number;
};

export type CollectionForecast = {
  overdue: ForecastBucket;
  dueIn1To7Days: ForecastBucket;
  dueIn8To30Days: ForecastBucket;
  dueIn31To60Days: ForecastBucket;
  dueIn61To90Days: ForecastBucket;
  dueDateMissing: ForecastBucket;
  excludedInvalidRows: number;
};

function toPaise(value: number | string): number | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const paise = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(paise) ? paise : null;
}

function safeAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error("Report amount exceeds safe integer precision.");
  return sum;
}

function emptyMonth(month: string): MonthlyLedgerSummary {
  return {
    month,
    feeReceiptsPaise: 0,
    advanceReceiptsPaise: 0,
    completedRefundsPaise: 0,
    payrollPaise: 0,
    businessExpensesPaise: 0,
    collectedRevenuePaise: 0,
    totalExpensesPaise: 0,
    netPaise: 0,
    invalidRows: 0,
  };
}

/**
 * Aggregates only rows from the canonical monthly financial view. All monetary
 * totals use integer paise; receipt allocations are absent from that view.
 */
export function buildMonthlyLedgerSummaries(
  rows: readonly ActivitySummaryInput[],
  months: readonly string[],
): MonthlyLedgerSummary[] {
  const summaries = new Map(months.map((month) => [month, emptyMonth(month)]));

  for (const row of rows) {
    if (!row.activity_month) continue;
    const month = row.activity_month.slice(0, 7);
    const summary = summaries.get(month);
    if (!summary) continue;
    const amount = toPaise(row.amount_total);
    if (amount === null) {
      summary.invalidRows += 1;
      continue;
    }
    if (row.direction === "inflow" && row.category === "student_fee_receipt") {
      summary.feeReceiptsPaise = safeAdd(summary.feeReceiptsPaise, amount);
    } else if (row.direction === "inflow" && row.category === "student_advance_receipt") {
      summary.advanceReceiptsPaise = safeAdd(summary.advanceReceiptsPaise, amount);
    } else if (row.direction === "outflow" && row.category === "student_refund") {
      summary.completedRefundsPaise = safeAdd(summary.completedRefundsPaise, amount);
    } else if (row.direction === "outflow" && row.category === "salary_expense") {
      summary.payrollPaise = safeAdd(summary.payrollPaise, amount);
    } else if (row.direction === "outflow" && row.category === "business_expense") {
      summary.businessExpensesPaise = safeAdd(summary.businessExpensesPaise, amount);
    }
  }

  return months.map((month) => {
    const summary = summaries.get(month)!;
    summary.collectedRevenuePaise = safeAdd(
      safeAdd(summary.feeReceiptsPaise, summary.advanceReceiptsPaise),
      -summary.completedRefundsPaise,
    );
    summary.totalExpensesPaise = safeAdd(summary.payrollPaise, summary.businessExpensesPaise);
    summary.netPaise = safeAdd(summary.collectedRevenuePaise, -summary.totalExpensesPaise);
    return summary;
  });
}

function dayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (date.toISOString().slice(0, 10) !== value) return null;
  return timestamp / 86_400_000;
}

function emptyBucket(): ForecastBucket {
  return { installmentCount: 0, amountPaise: 0 };
}

function addForecastRow(bucket: ForecastBucket, amountPaise: number) {
  bucket.installmentCount += 1;
  bucket.amountPaise = safeAdd(bucket.amountPaise, amountPaise);
}

/** Classifies open installment balances against the institute-local calendar date. */
export function buildCollectionForecast(
  rows: readonly InstallmentForecastInput[],
  today: string,
): CollectionForecast {
  const todayNumber = dayNumber(today);
  if (todayNumber === null) throw new Error("A valid institute business date is required.");

  const result: CollectionForecast = {
    overdue: emptyBucket(),
    dueIn1To7Days: emptyBucket(),
    dueIn8To30Days: emptyBucket(),
    dueIn31To60Days: emptyBucket(),
    dueIn61To90Days: emptyBucket(),
    dueDateMissing: emptyBucket(),
    excludedInvalidRows: 0,
  };

  for (const row of rows) {
    if (!["Pending", "Partially Paid", "Overdue"].includes(row.balance_status)) continue;
    const amount = toPaise(row.outstanding_amount);
    if (amount === null || amount === 0) {
      result.excludedInvalidRows += 1;
      continue;
    }
    if (!row.due_date) {
      addForecastRow(result.dueDateMissing, amount);
      continue;
    }
    const due = dayNumber(row.due_date);
    if (due === null) {
      result.excludedInvalidRows += 1;
      continue;
    }
    const daysUntilDue = due - todayNumber;
    if (daysUntilDue <= 0) addForecastRow(result.overdue, amount);
    else if (daysUntilDue <= 7) addForecastRow(result.dueIn1To7Days, amount);
    else if (daysUntilDue <= 30) addForecastRow(result.dueIn8To30Days, amount);
    else if (daysUntilDue <= 60) addForecastRow(result.dueIn31To60Days, amount);
    else if (daysUntilDue <= 90) addForecastRow(result.dueIn61To90Days, amount);
  }

  return result;
}

/** Returns a validated ascending YYYY-MM range, useful for ledger queries. */
export function monthRange(startMonth: string, endMonth: string): string[] {
  const parse = (value: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
    const [year, month] = value.split("-").map(Number);
    return year * 12 + month - 1;
  };
  const start = parse(startMonth);
  const end = parse(endMonth);
  if (start === null || end === null || end < start || end - start > 23) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const monthIndex = start + index;
    return `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, "0")}`;
  });
}
