import { buildProfitAndLoss } from "./dashboard-summary";
import type { DashboardFinancialSummary } from "./dashboard-summary";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; console.log(`PASS: ${name}`); }
  else { failed += 1; console.log(`FAIL: ${name}\n  expected: ${e}\n  actual:   ${a}`); }
}

function summary(overrides: Partial<DashboardFinancialSummary> = {}): DashboardFinancialSummary {
  return {
    feeReceipts: 0,
    advanceReceipts: 0,
    completedRefunds: 0,
    payrollOutflow: 0,
    businessExpenses: 0,
    outstandingBalance: 0,
    overdueInstallmentCount: 0,
    invalidRows: 0,
    ...overrides,
  };
}

// Collected revenue = fee + advance receipts - completed refunds (advance
// allocations never appear here because they are not receipts).
check("collected revenue subtracts completed refunds only", buildProfitAndLoss(summary({
  feeReceipts: 10000, advanceReceipts: 5000, completedRefunds: 2000,
})).collectedRevenue, 13000);

// Net profit = collected revenue - (payroll + expenses).
check("net profit subtracts payroll and expenses", buildProfitAndLoss(summary({
  feeReceipts: 10000, advanceReceipts: 5000, completedRefunds: 2000,
  payrollOutflow: 3000, businessExpenses: 1500,
} )).netProfit, 13000 - 4500);

// Potential profit = collected + outstanding - expenses.
check("potential profit adds collectible outstanding", buildProfitAndLoss(summary({
  feeReceipts: 10000, advanceReceipts: 0, completedRefunds: 0,
  payrollOutflow: 1000, businessExpenses: 1000, outstandingBalance: 4000,
})).potentialProfit, 10000 + 4000 - 2000);

check("total expenses combines payroll and business expenses", buildProfitAndLoss(summary({
  payrollOutflow: 3000, businessExpenses: 1500,
})).totalExpenses, 4500);

check("empty summary yields zero profit", buildProfitAndLoss(summary()), {
  collectedRevenue: 0, totalExpenses: 0, netProfit: 0, potentialProfit: 0,
});

// A loss is represented as a negative net profit, not clamped to zero.
check("negative net profit is preserved", buildProfitAndLoss(summary({
  feeReceipts: 1000, businessExpenses: 4000,
})).netProfit, -3000);

// Refunds larger than receipts across the month produce negative collected revenue.
check("refunds can exceed receipts", buildProfitAndLoss(summary({
  feeReceipts: 1000, completedRefunds: 2500,
})).collectedRevenue, -1500);

check("profit and loss combines decimal metrics in integer paise", buildProfitAndLoss(summary({
  feeReceipts: 0.1, advanceReceipts: 0.2, completedRefunds: 0.1,
  businessExpenses: 0.1,
})), {
  collectedRevenue: 0.2, totalExpenses: 0.1, netProfit: 0.1, potentialProfit: 0.1,
});

console.log(`\nprofit-summary: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
