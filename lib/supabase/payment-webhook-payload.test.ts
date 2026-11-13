import assert from "node:assert/strict";
import { cashfreeWebhookEventId } from "./online-payment-core";
import { parsePaymentWebhookPayload } from "./payment-webhook-payload";

const rawRazorpayBody = JSON.stringify({
  entity: "event",
  account_id: "acc_test",
  event: "payment.captured",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_test_123",
        entity: "payment",
        amount: 499900,
        currency: "INR",
        status: "captured",
        order_id: "order_test_123",
        captured: true,
      },
    },
  },
});
const razorpay = parsePaymentWebhookPayload(
  "razorpay",
  JSON.parse(rawRazorpayBody),
  new Headers({ "x-razorpay-event-id": "evt_test_123" }),
  rawRazorpayBody,
);
assert.deepEqual(razorpay, {
  providerOrderId: "order_test_123",
  providerPaymentId: "pay_test_123",
  eventType: "payment.captured",
  rawStatus: "payment.captured",
  rawAmount: "4999.00",
  rawCurrency: "INR",
  providerEventId: "evt_test_123",
});

const cashfreePayload = {
  type: "PAYMENT_SUCCESS_WEBHOOK",
  data: {
    order: { order_id: "cf_order_123", order_currency: "INR" },
    payment: {
      cf_payment_id: 987654321,
      payment_status: "SUCCESS",
      payment_amount: 125.5,
      payment_currency: "INR",
    },
  },
};
const cashfree = parsePaymentWebhookPayload("cashfree", cashfreePayload, new Headers(), JSON.stringify(cashfreePayload));
assert.deepEqual(cashfree, {
  providerOrderId: "cf_order_123",
  providerPaymentId: "987654321",
  eventType: "PAYMENT_SUCCESS_WEBHOOK",
  rawStatus: "SUCCESS",
  rawAmount: "125.5",
  rawCurrency: "INR",
  providerEventId: cashfreeWebhookEventId(cashfreePayload),
});
assert.ok(cashfree?.providerEventId.startsWith("cashfree:"));
const failedPayload = {
  entity: "event",
  event: "payment.failed",
  payload: { payment: { entity: { id: "pay_failed_1", order_id: "order_test_123", amount: 499900, currency: "INR" } } },
};
assert.equal(parsePaymentWebhookPayload("razorpay", failedPayload, new Headers(), JSON.stringify(failedPayload))?.rawStatus, "payment.failed");
assert.equal(parsePaymentWebhookPayload("razorpay", { event: "payment.captured", data: { payment: {} } }, new Headers(), "{}"), null);
assert.equal(parsePaymentWebhookPayload("cashfree", { type: "PAYMENT_SUCCESS_WEBHOOK", payload: {} }, new Headers(), "{}"), null);

console.log("Payment webhook envelope parsing: 6 assertions passed.");
