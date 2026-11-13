import assert from "node:assert/strict";
import { prepareAdvanceAllocation } from "./advance-allocation";

const partial = prepareAdvanceAllocation(25.5, 100, 80);
assert.deepEqual(partial, {
  amount: 25.5,
  remainingAdvance: 74.5,
  remainingInstallment: 54.5,
}, "partial advance allocation preserves both resulting balances");

assert.throws(() => prepareAdvanceAllocation(0, 10, 10), /positive amount/, "zero allocations are rejected");
assert.throws(() => prepareAdvanceAllocation(1.239, 10, 10), /two decimal places/, "sub-paise allocations are rejected");
assert.throws(() => prepareAdvanceAllocation(10.01, 10, 20), /available advance balance/, "pending refund reservations can cap available advance");
assert.throws(() => prepareAdvanceAllocation(20.01, 30, 20), /installment outstanding balance/, "installment balance caps the allocation");
assert.throws(() => prepareAdvanceAllocation(1, 0, 20), /no amount available/, "fully allocated or refund-reserved receipts cannot be used");
assert.throws(() => prepareAdvanceAllocation(1, 10, 0), /no outstanding balance/, "closed installments cannot receive allocations");
assert.throws(() => prepareAdvanceAllocation(1, 10.001, 20), /invalid monetary precision/, "fractional-paise stored balances fail closed");

console.log("Advance allocation validation tests: 8 assertions passed.");
