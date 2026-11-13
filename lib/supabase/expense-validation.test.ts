import assert from "node:assert/strict";
import { parseExpenseInput, parseVoidExpenseInput } from "./expense-validation";

const base = {
  title: "Classroom rent",
  category: "Rent",
  amount: 12500.5,
  expenseDate: "2026-10-14",
  method: "Bank Transfer",
  notes: "October rent",
  branchId: "branch-1",
};

const cases: Array<{ name: string; run: () => void }> = [
  { name: "accepts valid two-decimal amounts including binary floating-point fractions", run: () => {
    assert.equal(parseExpenseInput(base, "2026-10-15").ok, true);
    assert.equal(parseExpenseInput({ ...base, amount: 0.29 }, "2026-10-15").ok, true);
    assert.equal(parseExpenseInput({ ...base, amount: ".5" }, "2026-10-15").ok, true);
  } },
  { name: "trims text and maps blank notes to null", run: () => {
    const result = parseExpenseInput({ ...base, title: "  Rent  ", notes: "  " }, "2026-10-15");
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual([result.value.title, result.value.notes], ["Rent", null]);
  } },
  { name: "rejects an amount with fractional paise", run: () => assert.equal(parseExpenseInput({ ...base, amount: 0.001 }, "2026-10-15").ok, false) },
  { name: "rejects malformed and database-overflow expense amounts", run: () => {
    assert.equal(parseExpenseInput({ ...base, amount: "1e3" }, "2026-10-15").ok, false);
    assert.equal(parseExpenseInput({ ...base, amount: "10000000000" }, "2026-10-15").ok, false);
  } },
  { name: "rejects non-decimal numeric strings", run: () => {
    assert.equal(parseExpenseInput({ ...base, amount: "1e3" }, "2026-10-15").ok, false);
    assert.equal(parseExpenseInput({ ...base, amount: "0x10" }, "2026-10-15").ok, false);
  } },
  { name: "rejects zero, negative, and oversized amounts", run: () => {
    for (const amount of [0, -1, 10_000_000_000]) assert.equal(parseExpenseInput({ ...base, amount }, "2026-10-15").ok, false);
  } },
  { name: "rejects future and impossible dates", run: () => {
    assert.equal(parseExpenseInput({ ...base, expenseDate: "2026-10-16" }, "2026-10-15").ok, false);
    assert.equal(parseExpenseInput({ ...base, expenseDate: "2026-02-30" }, "2026-10-15").ok, false);
  } },
  { name: "rejects unsupported payment methods and oversized notes", run: () => {
    assert.equal(parseExpenseInput({ ...base, method: "Crypto" }, "2026-10-15").ok, false);
    assert.equal(parseExpenseInput({ ...base, notes: "x".repeat(501) }, "2026-10-15").ok, false);
  } },
  { name: "requires a useful void reason", run: () => {
    assert.equal(parseVoidExpenseInput({ expenseId: "expense-1", reason: "ok" }).ok, false);
    assert.equal(parseVoidExpenseInput({ expenseId: "expense-1", reason: "Duplicate invoice" }).ok, true);
  } },
];

let failures = 0;
for (const test of cases) {
  try {
    test.run();
    process.stdout.write(`PASS: ${test.name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL: ${test.name}\n${String(error)}\n`);
  }
}
process.stdout.write(`Expense validation tests: ${cases.length - failures}/${cases.length} passed.\n`);
if (failures) process.exitCode = 1;
