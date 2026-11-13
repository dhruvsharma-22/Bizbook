import assert from "node:assert/strict";
import { getRefundableReceiptPaise, matchesRefundReceiptFilter, prepareManualRefundPlan } from "./refund-operations";

assert.equal(matchesRefundReceiptFilter({ mode: "Manual", receipt_kind: "Advance" }, "manual-advance"), true, "manual advance receipts are selectable for manual refunds");
assert.equal(matchesRefundReceiptFilter({ mode: "Online", receipt_kind: "Advance" }, "manual-advance"), false, "online advance receipts are not sent through the manual refund path");
assert.equal(matchesRefundReceiptFilter({ mode: "Manual", receipt_kind: "Fee" }, "manual-advance"), false, "manual fee receipts are excluded from the advance-refund shortcut");
assert.equal(matchesRefundReceiptFilter({ mode: "Online", receipt_kind: "Advance" }, "all"), true, "the general refund view retains online receipts");

const refunds = [
  { amount: 20, status: "Pending" },
  { amount: "5.50", status: "Processing" },
  { amount: 10, status: "Failed" },
];
assert.equal(getRefundableReceiptPaise(100, refunds), 7450, "pending and processing refunds reserve capacity; failed refunds do not");

const plan = prepareManualRefundPlan({
  amount: 35,
  paymentAmount: 100,
  reason: " Fee adjustment ",
  refunds,
  allocations: [{ id: "a-1", amount: 40 }, { id: "a-2", amount: 30 }],
  reservedByAllocationId: new Map([["a-1", 10]]),
});
assert.equal(plan.amount, 35, "requested amount is preserved to the paise");
assert.equal(plan.reason, "Fee adjustment", "reason is trimmed before submission");
assert.deepEqual(plan.allocationBreakdown, [{ payment_allocation_id: "a-1", amount: 30 }, { payment_allocation_id: "a-2", amount: 5 }], "refund breakdown only uses unreserved allocation amounts");

const unallocated = prepareManualRefundPlan({
  amount: 15,
  paymentAmount: 100,
  reason: "Advance return",
  refunds,
  allocations: [],
  reservedByAllocationId: new Map(),
});
assert.deepEqual(unallocated.allocationBreakdown, [], "an unallocated advance refund need not reference installment allocations");

assert.throws(() => prepareManualRefundPlan({ amount: 75.51, paymentAmount: 100, reason: "x", refunds, allocations: [], reservedByAllocationId: new Map() }), /remaining refundable/, "pending refund reservations cap new requests");
assert.throws(() => prepareManualRefundPlan({ amount: 1.239, paymentAmount: 100, reason: "x", refunds: [], allocations: [], reservedByAllocationId: new Map() }), /two decimal places/, "sub-paise refund amounts are rejected");
assert.throws(() => prepareManualRefundPlan({ amount: 1, paymentAmount: 100, reason: "  ", refunds: [], allocations: [], reservedByAllocationId: new Map() }), /refund reason/, "blank refund reasons are rejected");
assert.throws(() => prepareManualRefundPlan({ amount: 1.01, paymentAmount: 1, reason: "x", refunds: [], allocations: [], reservedByAllocationId: new Map() }), /remaining refundable/, "refunds cannot exceed the receipt amount");
assert.throws(() => getRefundableReceiptPaise("100.001", refunds), /invalid monetary precision/, "fractional-paise receipt amounts fail closed");
assert.throws(() => getRefundableReceiptPaise(100, [{ amount: "1.001", status: "Pending" }]), /invalid monetary precision/, "malformed active reservations cannot increase refundable capacity");
assert.throws(() => prepareManualRefundPlan({ amount: 1, paymentAmount: 10, reason: "x", refunds: [], allocations: [{ id: "bad", amount: "2.001" }], reservedByAllocationId: new Map() }), /invalid monetary precision/, "fractional-paise allocation records fail closed");

console.log("Refund workflow tests: 15 assertions passed.");
