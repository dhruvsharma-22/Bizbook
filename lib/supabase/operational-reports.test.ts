import { buildCollectionForecast, buildMonthlyLedgerSummaries, monthRange } from "./operational-reports";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

const months = buildMonthlyLedgerSummaries([
  { activity_month: "2026-09-01", category: "student_fee_receipt", direction: "inflow", amount_total: "100.25" },
  { activity_month: "2026-09-01", category: "student_advance_receipt", direction: "inflow", amount_total: 50 },
  { activity_month: "2026-09-01", category: "student_refund", direction: "outflow", amount_total: "10.10" },
  { activity_month: "2026-09-01", category: "salary_expense", direction: "outflow", amount_total: "20.00" },
  { activity_month: "2026-09-01", category: "business_expense", direction: "outflow", amount_total: 5 },
  { activity_month: "2026-09-01", category: "student_fee_receipt", direction: "inflow", amount_total: "1.001" },
  { activity_month: "2026-09-01", category: "advance_allocation", direction: "inflow", amount_total: 999 },
], ["2026-09", "2026-10"]);
check("monthly summaries use exact paise and canonical categories", months[0], {
  month: "2026-09", feeReceiptsPaise: 10025, advanceReceiptsPaise: 5000,
  completedRefundsPaise: 1010, payrollPaise: 2000, businessExpensesPaise: 500,
  collectedRevenuePaise: 14015, totalExpensesPaise: 2500, netPaise: 11515, invalidRows: 1,
});
check("months with no ledger activity remain explicit zero rows", months[1], {
  month: "2026-10", feeReceiptsPaise: 0, advanceReceiptsPaise: 0,
  completedRefundsPaise: 0, payrollPaise: 0, businessExpensesPaise: 0,
  collectedRevenuePaise: 0, totalExpensesPaise: 0, netPaise: 0, invalidRows: 0,
});
check("month range crosses year boundaries", monthRange("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
check("month range rejects invalid or unbounded input", [monthRange("2026-13", "2027-01").length, monthRange("2024-01", "2026-02").length], [0, 0]);

const forecast = buildCollectionForecast([
  { due_date: "2026-10-16", outstanding_amount: "10.01", balance_status: "Overdue" },
  { due_date: "2026-10-24", outstanding_amount: "20.02", balance_status: "Pending" },
  { due_date: "2026-11-01", outstanding_amount: "30.03", balance_status: "Partially Paid" },
  { due_date: "2026-11-30", outstanding_amount: "40.04", balance_status: "Pending" },
  { due_date: "2027-01-14", outstanding_amount: "50.05", balance_status: "Pending" },
  { due_date: "2027-01-15", outstanding_amount: "60.06", balance_status: "Pending" },
  { due_date: null, outstanding_amount: "70.07", balance_status: "Pending" },
  { due_date: "2026-10-20", outstanding_amount: 999, balance_status: "Paid" },
  { due_date: "2026-10-21", outstanding_amount: "1.001", balance_status: "Pending" },
], "2026-10-17");
check("collection forecast uses business date, exact buckets, and open balances", forecast, {
  overdue: { installmentCount: 1, amountPaise: 1001 },
  dueIn1To7Days: { installmentCount: 1, amountPaise: 2002 },
  dueIn8To30Days: { installmentCount: 1, amountPaise: 3003 },
  dueIn31To60Days: { installmentCount: 1, amountPaise: 4004 },
  dueIn61To90Days: { installmentCount: 2, amountPaise: 11011 },
  dueDateMissing: { installmentCount: 1, amountPaise: 7007 },
  excludedInvalidRows: 1,
});

console.log(`Operational reports: ${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
