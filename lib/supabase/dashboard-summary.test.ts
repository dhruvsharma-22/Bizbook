import assert from "node:assert/strict";
import { buildDashboardFinancialSummary } from "./dashboard-summary";

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: "counts canonical fee and advance receipts once and excludes unrelated allocation categories",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "student_fee_receipt", direction: "inflow", amount_total: "1250.00" },
        { category: "student_advance_receipt", direction: "inflow", amount_total: 800 },
        { category: "advance_allocation", direction: "inflow", amount_total: 800 },
      ], []);
      assert.equal(summary.feeReceipts, 1250);
      assert.equal(summary.advanceReceipts, 800);
    },
  },
  {
    name: "includes only canonical completed refunds and keeps them separate from receipts",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "student_refund", direction: "outflow", amount_total: "-75.50" },
        { category: "pending_refund", direction: "outflow", amount_total: 20 },
      ], []);
      assert.equal(summary.completedRefunds, 75.5);
    },
  },
  {
    name: "reports salary and business expense outflows separately to avoid adding salary twice",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "salary_expense", direction: "outflow", amount_total: -900 },
        { category: "business_expense", direction: "outflow", amount_total: -125 },
      ], []);
      assert.equal(summary.payrollOutflow, 900);
      assert.equal(summary.businessExpenses, 125);
    },
  },
  {
    name: "sums only open installment balances and counts overdue installments",
    run() {
      const summary = buildDashboardFinancialSummary([], [
        { balance_status: "Pending", installment_count: 2, outstanding_amount_total: "100" },
        { balance_status: "Partially Paid", installment_count: 1, outstanding_amount_total: 50 },
        { balance_status: "Overdue", installment_count: 3, outstanding_amount_total: 75 },
        { balance_status: "Paid", installment_count: 4, outstanding_amount_total: 0 },
        { balance_status: "Cancelled", installment_count: 2, outstanding_amount_total: 400 },
      ]);
      assert.equal(summary.outstandingBalance, 225);
      assert.equal(summary.overdueInstallmentCount, 3);
    },
  },
  {
    name: "ignores malformed values instead of producing NaN metrics",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "student_fee_receipt", direction: "inflow", amount_total: "unknown" },
      ], [
        { balance_status: "Overdue", installment_count: "bad", outstanding_amount_total: "bad" },
      ]);
      assert.equal(summary.feeReceipts, 0);
      assert.equal(summary.outstandingBalance, 0);
      assert.equal(summary.overdueInstallmentCount, 0);
      assert.equal(summary.invalidRows, 2);
    },
  },
  {
    name: "sums repeated decimal amounts in integer paise without floating point drift",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "student_fee_receipt", direction: "inflow", amount_total: "0.10" },
        { category: "student_fee_receipt", direction: "inflow", amount_total: "0.20" },
        { category: "student_refund", direction: "outflow", amount_total: "-0.10" },
      ], []);
      assert.equal(summary.feeReceipts, 0.3);
      assert.equal(summary.completedRefunds, 0.1);
      assert.equal(summary.invalidRows, 0);
    },
  },
  {
    name: "rejects fractional-paise values and amounts with the wrong ledger direction",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "student_fee_receipt", direction: "inflow", amount_total: "1.001" },
        { category: "student_advance_receipt", direction: "inflow", amount_total: "-12.00" },
        { category: "business_expense", direction: "outflow", amount_total: "12.00" },
      ], []);
      assert.equal(summary.feeReceipts, 0);
      assert.equal(summary.advanceReceipts, 0);
      assert.equal(summary.businessExpenses, 0);
      assert.equal(summary.invalidRows, 3);
    },
  },
  {
    name: "rejects a category whose declared ledger direction conflicts with its canonical direction",
    run() {
      const summary = buildDashboardFinancialSummary([
        { category: "student_fee_receipt", direction: "outflow", amount_total: "12.00" },
        { category: "business_expense", direction: "inflow", amount_total: "-4.00" },
      ], []);
      assert.equal(summary.feeReceipts, 0);
      assert.equal(summary.businessExpenses, 0);
      assert.equal(summary.invalidRows, 2);
    },
  },
];

let failures = 0;
for (const testCase of cases) {
  try {
    testCase.run();
    console.log(`PASS: ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${testCase.name}`);
    console.error(error);
  }
}

console.log(`Dashboard summary tests: ${cases.length - failures}/${cases.length} passed.`);
if (failures > 0) process.exitCode = 1;
