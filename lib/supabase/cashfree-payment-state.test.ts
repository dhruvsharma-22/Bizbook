import assert from "node:assert/strict";
import { chooseCashfreeOrderPayment } from "./cashfree-payment-state";
import type { ProviderPaymentState } from "./online-payment-provider-core";

const payment = (status: ProviderPaymentState["status"], id: string): ProviderPaymentState => ({
  providerOrderId: "order_test", providerPaymentId: id, status, amount: "10.00", currency: "INR",
});

assert.deepEqual(chooseCashfreeOrderPayment([]), { kind: "none" });
assert.equal(chooseCashfreeOrderPayment([payment("pending", "p1")]).kind, "payment");
assert.equal(chooseCashfreeOrderPayment([payment("failed", "f1"), payment("pending", "p1")]).kind, "payment");
assert.deepEqual(chooseCashfreeOrderPayment([payment("captured", "s1")]), { kind: "payment", payment: payment("captured", "s1") });
assert.equal(chooseCashfreeOrderPayment([payment("captured", "s1"), payment("captured", "s2")]).kind, "reconcile");

console.log("Cashfree order payment decision: 5 assertions passed.");
