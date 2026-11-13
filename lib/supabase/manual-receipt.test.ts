import assert from "node:assert/strict";
import { prepareManualReceiptPlan } from "./manual-receipt";

const partialFee = prepareManualReceiptPlan("Fee", 40.25, { installmentId: "i-1", outstandingAmount: 100 });
assert.deepEqual(partialFee.allocations, [{ installment_id: "i-1", amount: 40.25 }], "partial fee receipt allocates only its actual amount");
assert.equal(partialFee.unallocatedAmount, 0, "fee receipt is not silently left unallocated");

assert.throws(
  () => prepareManualReceiptPlan("Fee", 10),
  /Choose an installment/,
  "fee receipt requires a target installment",
);
assert.throws(
  () => prepareManualReceiptPlan("Fee", 11, { installmentId: "i-1", outstandingAmount: 10 }),
  /cannot exceed/,
  "fee receipt cannot exceed its installment balance",
);

const generalAdvance = prepareManualReceiptPlan("Advance", 75.5);
assert.deepEqual(generalAdvance.allocations, [], "general advance remains unallocated");
assert.equal(generalAdvance.unallocatedAmount, 75.5, "unallocated advance amount is retained");

const allocatedAdvance = prepareManualReceiptPlan("Advance", 75.5, { installmentId: "i-2", outstandingAmount: 20 });
assert.deepEqual(allocatedAdvance.allocations, [{ installment_id: "i-2", amount: 20 }], "advance allocation is capped at installment balance");
assert.equal(allocatedAdvance.unallocatedAmount, 55.5, "advance remainder remains available after allocation");

assert.throws(
  () => prepareManualReceiptPlan("Advance", 1.239),
  /two decimal places/,
  "amounts finer than a paise are rejected",
);
assert.throws(
  () => prepareManualReceiptPlan("Advance", 1, { installmentId: "i-4", outstandingAmount: 10.001 }),
  /Installment balance.*nearest paise/,
  "a stored installment balance with fractional paise is rejected",
);
assert.throws(
  () => prepareManualReceiptPlan("Advance", 10_000_000_000),
  /two decimal places/,
  "amounts beyond the database numeric(12,2) capacity are rejected",
);
assert.throws(
  () => prepareManualReceiptPlan("Advance", 10, { installmentId: "i-3", outstandingAmount: 0 }),
  /no outstanding balance/,
  "advance cannot be allocated to a closed installment",
);

console.log("Manual receipt allocation tests: 10 assertions passed.");
