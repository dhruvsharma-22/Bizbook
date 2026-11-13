import { summarizePaymentRefunds, type PaymentHistoryRefund } from "./payment-history";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function refund(
  id: string,
  paymentId: string,
  amount: number | string,
  status: PaymentHistoryRefund["status"],
): PaymentHistoryRefund {
  return {
    id,
    payment_id: paymentId,
    amount,
    status,
    mode: "Manual",
    provider_refund_reference: null,
    created_at: "2026-10-15T00:00:00.000Z",
  };
}

const summaries = summarizePaymentRefunds([
  refund("r1", "p1", "10.00", "Pending"),
  refund("r2", "p1", 5, "Processing"),
  refund("r3", "p1", 3, "Completed"),
  refund("r4", "p1", 90, "Failed"),
  refund("r5", "p2", 2, "Cancelled"),
  refund("r6", "p2", Number.NaN, "Completed"),
  refund("r7", "p3", 0.1, "Completed"),
  refund("r8", "p3", 0.2, "Completed"),
  refund("r9", "p3", "0.001", "Completed"),
]);

assert(summaries.get("p1")?.completedAmount === 3, "only completed refunds count as completed returns");
assert(summaries.get("p1")?.pendingAmount === 15, "pending and processing refunds remain separate");
assert(summaries.get("p1")?.refunds.length === 4, "all valid refund statuses remain visible");
assert(summaries.get("p2")?.completedAmount === 0, "cancelled and malformed refunds do not count as completed");
assert(summaries.get("p2")?.refunds.length === 1, "malformed amounts are omitted from display summaries");
assert(summaries.get("p3")?.completedAmount === 0.3, "decimal refund amounts are rounded to paise when summed");
assert(summaries.get("p3")?.refunds.length === 2, "fractional-paise refund rows are excluded from summaries");

console.log("Payment history refund summary tests: 7 assertions passed.");
