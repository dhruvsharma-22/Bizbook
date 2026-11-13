import { toPaise } from "./money";

export type FinancialActivitySummaryRow = {
  category: string;
  direction: string;
  amount_total: number | string;
};

export type InstallmentBalanceSummaryRow = {
  balance_status: string;
  installment_count: number | string;
  outstanding_amount_total: number | string;
};

export type DashboardFinancialSummary = {
  feeReceipts: number;
  advanceReceipts: number;
  completedRefunds: number;
  payrollOutflow: number;
  businessExpenses: number;
  outstandingBalance: number;
  overdueInstallmentCount: number;
  invalidRows: number;
};

export type ProfitAndLoss = {
  /** Fee + advance receipts less completed refunds. */
  collectedRevenue: number;
  /** Payroll plus business expenses. */
  totalExpenses: number;
  /** Collected revenue minus total expenses. */
  netProfit: number;
  /** Collected revenue plus collectible outstanding, minus total expenses. */
  potentialProfit: number;
};

export type ExpenseObligationSummaryRow = {
  recorded_month_total: number | string;
  unpaid_total: number | string;
  unpaid_count: number | string;
};

export type ExpenseObligationSummary = {
  /** All non-void expense records dated in the selected month, paid or unpaid. */
  recordedMonthTotal: number;
  /** All currently unpaid, non-void expense records in the authorized scope. */
  unpaidTotal: number;
  unpaidCount: number;
  invalidRows: number;
};

type ParsedPaise = { paise: number; negative: boolean };

function parseSignedPaise(value: number | string): ParsedPaise | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const paise = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(paise) ? { paise, negative } : null;
}

function addPaise(current: number, amount: number): number | null {
  const result = current + amount;
  return Number.isSafeInteger(result) ? result : null;
}

function countValue(value: number | string): number | null {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : null;
}

/** Aggregate canonical database summary rows in integer paise. Allocations are not receipts. */
export function buildDashboardFinancialSummary(
  activityRows: FinancialActivitySummaryRow[],
  balanceRows: InstallmentBalanceSummaryRow[],
): DashboardFinancialSummary {
  const totals = {
    feeReceipts: 0,
    advanceReceipts: 0,
    completedRefunds: 0,
    payrollOutflow: 0,
    businessExpenses: 0,
    outstandingBalance: 0,
    overdueInstallmentCount: 0,
    invalidRows: 0,
  };

  for (const row of activityRows) {
    const metric = row.category === "student_fee_receipt" ? ["feeReceipts", "inflow"] as const
      : row.category === "student_advance_receipt" ? ["advanceReceipts", "inflow"] as const
        : row.category === "student_refund" ? ["completedRefunds", "outflow"] as const
          : row.category === "salary_expense" ? ["payrollOutflow", "outflow"] as const
            : row.category === "business_expense" ? ["businessExpenses", "outflow"] as const
              : null;
    if (!metric) continue;

    const parsed = parseSignedPaise(row.amount_total);
    const directionMatches = parsed
      && row.direction === metric[1]
      && (parsed.paise === 0 || (metric[1] === "inflow" ? !parsed.negative : parsed.negative));
    const next = directionMatches ? addPaise(totals[metric[0]], parsed.paise) : null;
    if (next === null) totals.invalidRows += 1;
    else totals[metric[0]] = next;
  }

  for (const row of balanceRows) {
    if (!["Pending", "Partially Paid", "Overdue"].includes(row.balance_status)) continue;
    const outstanding = parseSignedPaise(row.outstanding_amount_total);
    const count = row.balance_status === "Overdue" ? countValue(row.installment_count) : 0;
    if (!outstanding || (outstanding.negative && outstanding.paise > 0) || count === null) {
      totals.invalidRows += 1;
      continue;
    }
    const nextBalance = addPaise(totals.outstandingBalance, outstanding.paise);
    const nextCount = row.balance_status === "Overdue"
      ? totals.overdueInstallmentCount + count
      : totals.overdueInstallmentCount;
    if (nextBalance === null || !Number.isSafeInteger(nextCount)) {
      totals.invalidRows += 1;
      continue;
    }
    totals.outstandingBalance = nextBalance;
    totals.overdueInstallmentCount = nextCount;
  }

  return {
    feeReceipts: totals.feeReceipts / 100,
    advanceReceipts: totals.advanceReceipts / 100,
    completedRefunds: totals.completedRefunds / 100,
    payrollOutflow: totals.payrollOutflow / 100,
    businessExpenses: totals.businessExpenses / 100,
    outstandingBalance: totals.outstandingBalance / 100,
    overdueInstallmentCount: totals.overdueInstallmentCount,
    invalidRows: totals.invalidRows,
  };
}

/** Validate database expense-obligation totals with exact integer-paise arithmetic. */
export function buildExpenseObligationSummary(
  rows: ExpenseObligationSummaryRow[],
): ExpenseObligationSummary {
  const totals = { recordedMonthPaise: 0, unpaidPaise: 0, unpaidCount: 0, invalidRows: 0 };

  for (const row of rows) {
    const recorded = parseSignedPaise(row.recorded_month_total);
    const unpaid = parseSignedPaise(row.unpaid_total);
    const count = countValue(row.unpaid_count);
    if (!recorded || recorded.negative || !unpaid || unpaid.negative || count === null) {
      totals.invalidRows += 1;
      continue;
    }
    const recordedNext = addPaise(totals.recordedMonthPaise, recorded.paise);
    const unpaidNext = addPaise(totals.unpaidPaise, unpaid.paise);
    const countNext = totals.unpaidCount + count;
    if (recordedNext === null || unpaidNext === null || !Number.isSafeInteger(countNext)) {
      totals.invalidRows += 1;
      continue;
    }
    totals.recordedMonthPaise = recordedNext;
    totals.unpaidPaise = unpaidNext;
    totals.unpaidCount = countNext;
  }

  return {
    recordedMonthTotal: totals.recordedMonthPaise / 100,
    unpaidTotal: totals.unpaidPaise / 100,
    unpaidCount: totals.unpaidCount,
    invalidRows: totals.invalidRows,
  };
}

/** Shared operational P&L formulas for canonical dashboard totals. */
export function buildProfitAndLoss(summary: DashboardFinancialSummary): ProfitAndLoss {
  const collectedPaise = toPaise(summary.feeReceipts)
    + toPaise(summary.advanceReceipts)
    - toPaise(summary.completedRefunds);
  const expensesPaise = toPaise(summary.payrollOutflow)
    + toPaise(summary.businessExpenses);
  const netPaise = collectedPaise - expensesPaise;
  const potentialPaise = collectedPaise + toPaise(summary.outstandingBalance) - expensesPaise;
  if (![collectedPaise, expensesPaise, netPaise, potentialPaise].every(Number.isSafeInteger)) {
    throw new Error("Financial summary exceeds safe paise precision.");
  }
  return {
    collectedRevenue: collectedPaise / 100,
    totalExpenses: expensesPaise / 100,
    netProfit: netPaise / 100,
    potentialProfit: potentialPaise / 100,
  };
}
