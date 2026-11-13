import assert from "node:assert/strict";
import * as brain from "./index";

const browserPersistenceExports = [
  "readStudentsStaff", "saveStudentsStaff",
  "readAttendance", "saveAttendance",
  "readAdvancePayments", "saveAdvancePayments",
  "readFeeReceipts", "saveFeeReceipts",
  "readPaymentHistory", "savePaymentHistory",
  "readPaymentRecords", "savePaymentRecords",
  "readSalaryPayments", "saveSalaryPayments",
  "readExpenses", "saveExpenses",
  "readRefunds", "saveRefunds",
  "applyAdvancePayment", "markAttendance", "recordSalaryPayment", "createExpense",
];

for (const name of browserPersistenceExports) {
  assert.equal(name in brain, false, `application Brain barrel must not export legacy persistence API ${name}`);
}

assert.equal(typeof brain.buildDashboardFinancialSummary, "function");
assert.equal(typeof brain.buildProfitAndLoss, "function");
assert.equal(typeof brain.calculateSalary, "function");

console.log(`Application Brain barrel: ${browserPersistenceExports.length + 3} assertions passed.`);
