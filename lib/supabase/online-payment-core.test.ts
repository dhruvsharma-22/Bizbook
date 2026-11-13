import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  cashfreeWebhookEventId,
  paiseToRupees,
  rupeesToPaise,
  verifyCashfreeWebhookSignature,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
} from "./online-payment-core";

const secret = "sandbox-test-secret";
const body = JSON.stringify({ event: "payment.captured", id: "pay_123" });
const orderId = "order_123";
const paymentId = "pay_123";
const checkoutSignature = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
const razorpayWebhookSignature = createHmac("sha256", secret).update(body).digest("hex");
const timestamp = "1760000000000";
const cashfreeWebhookSignature = createHmac("sha256", secret).update(`${timestamp}${body}`).digest("base64");

assert.equal(verifyRazorpayCheckoutSignature(orderId, paymentId, checkoutSignature, secret), true);
assert.equal(verifyRazorpayCheckoutSignature(orderId, paymentId, `${checkoutSignature.slice(0, -1)}0`, secret), false);
assert.equal(verifyRazorpayCheckoutSignature(orderId, paymentId, checkoutSignature.toUpperCase(), secret), true);
assert.equal(verifyRazorpayWebhookSignature(body, razorpayWebhookSignature, secret), true);
assert.equal(verifyRazorpayWebhookSignature(`${body} `, razorpayWebhookSignature, secret), false);
assert.equal(verifyCashfreeWebhookSignature(body, timestamp, cashfreeWebhookSignature, secret), true);
assert.equal(verifyCashfreeWebhookSignature(body, "not-a-timestamp", cashfreeWebhookSignature, secret), false);
assert.equal(verifyCashfreeWebhookSignature(body, timestamp, cashfreeWebhookSignature, "wrong"), false);
assert.equal(rupeesToPaise("0.01"), 1);
assert.equal(rupeesToPaise("125.4"), 12540);
assert.equal(rupeesToPaise("1.005"), null);
assert.equal(rupeesToPaise("-1.00"), null);
assert.equal(rupeesToPaise("10000000000.00"), null);
assert.equal(paiseToRupees(12540), "125.40");
assert.equal(paiseToRupees(1), "0.01");
const payload = { data: { order: { order_id: "local-order" }, payment: { cf_payment_id: 123, payment_status: "SUCCESS" } } };
assert.equal(cashfreeWebhookEventId(payload), cashfreeWebhookEventId(structuredClone(payload)));
assert.notEqual(cashfreeWebhookEventId(payload), cashfreeWebhookEventId({ data: { ...payload.data, payment: { cf_payment_id: 123, payment_status: "FAILED" } } }));

console.log("Online payment verification core: 17 assertions passed.");
