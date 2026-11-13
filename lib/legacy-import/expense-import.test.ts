import assert from "node:assert/strict";
import {
  previewLegacyExpenseImports,
  LEGACY_EXPENSE_SOURCE_KEY,
} from "./expense-import";

const validExpense = {
  id: "legacy-expense-001",
  title: "Electricity bill",
  category: "Utilities",
  amount: "1250.75",
  date: "2025-06-01",
  method: "UPI",
  notes: "June invoice",
  createdAt: "2025-06-02T08:30:00.000Z",
};

function storage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null };
}

function preview(rows: unknown) {
  return previewLegacyExpenseImports(storage({ [LEGACY_EXPENSE_SOURCE_KEY]: JSON.stringify(rows) }));
}

const clean = preview([validExpense]);
assert.equal(clean.issue, null);
assert.equal(clean.candidates.length, 1);
assert.equal(clean.candidates[0].eligible, true);
assert.equal(clean.candidates[0].amountPaise, 125_075);
assert.equal(clean.candidates[0].expenseDate, "2025-06-01");
assert.equal(clean.candidates[0].notes, "June invoice");
assert.equal("originalRecord" in clean.candidates[0], false);

const alias = preview([{
  expense_id: "legacy-expense-alias",
  description: "Cleaning supplies",
  type: "Office",
  expense_amount: "0.01",
  expense_date: "2025-06-02T12:00:00+05:30",
  payment_method: "Cash",
  note: "",
  currency_code: "INR",
}]);
assert.equal(alias.candidates[0].eligible, true);
assert.equal(alias.candidates[0].amountPaise, 1);
assert.equal(alias.candidates[0].expenseDate, "2025-06-02");
assert.equal(alias.candidates[0].notes, null);

function held(row: unknown, message: RegExp) {
  const candidate = preview([row]).candidates[0];
  assert.equal(candidate.eligible, false);
  assert.match(candidate.reason ?? "", message);
}

held({ ...validExpense, id: "" }, /stable legacy expense ID/);
held({ ...validExpense, title: " " }, /valid expense title/);
held({ ...validExpense, category: "" }, /valid expense category/);
held({ ...validExpense, amount: "0" }, /positive amount/);
held({ ...validExpense, amount: "1.005" }, /exact paise precision/);
held({ ...validExpense, amount: "10000000000.00" }, /database limit/);
held({ ...validExpense, date: "2025-02-30" }, /valid expense date/);
held({ ...validExpense, date: "" , createdAt: "2025-06-01T00:00:00Z" }, /creation time is not used/);
held({ ...validExpense, method: "Crypto" }, /supported payment method/);
held({ ...validExpense, notes: 42 }, /notes have an unsupported value/);
held({ ...validExpense, notes: "x".repeat(501) }, /500 characters/);
held({ ...validExpense, branchId: "old-branch" }, /explicit source-to-target mapping/);
held({ ...validExpense, institute_id: "old-institute" }, /explicit source-to-target mapping/);
held({ ...validExpense, status: "Paid" }, /status metadata/);
held({ ...validExpense, currency: "USD" }, /Only INR/);
held({ ...validExpense, receiptId: "legacy-receipt" }, /additional fields/);

const duplicateIds = preview([validExpense, { ...validExpense, amount: "7.00" }]);
assert.equal(duplicateIds.candidates.every((candidate) => !candidate.eligible), true);
assert.match(duplicateIds.candidates[0].reason ?? "", /appears more than once/);

assert.equal(previewLegacyExpenseImports(storage({})).candidates.length, 0);
assert.match(previewLegacyExpenseImports(storage({ [LEGACY_EXPENSE_SOURCE_KEY]: "not-json" })).issue ?? "", /malformed/);
assert.match(previewLegacyExpenseImports(storage({ [LEGACY_EXPENSE_SOURCE_KEY]: "{}" })).issue ?? "", /not an array/);
assert.equal(preview([null]).candidates[0].eligible, false);
assert.match(
  previewLegacyExpenseImports({ getItem: () => { throw new Error("private storage detail"); } }).issue ?? "",
  /could not be read/,
);

console.log("Legacy expense import review passed.");
