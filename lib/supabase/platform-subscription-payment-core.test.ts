import assert from "node:assert/strict";
import {
  isSandboxCheckedPlatformPaymentConnection,
  normalizeSubscriptionProviderStatus,
  subscriptionVerificationEventId,
} from "./platform-subscription-payment-core";

assert.equal(isSandboxCheckedPlatformPaymentConnection({
  provider_scope: "payment", provider: "razorpay", environment: "test",
  connection_status: "pending", last_verified_at: "2026-10-17T00:00:00Z",
}), true);
assert.equal(isSandboxCheckedPlatformPaymentConnection({
  provider_scope: "payment", provider: "cashfree", environment: "test",
  connection_status: "pending", last_verified_at: null,
}), false);
assert.equal(isSandboxCheckedPlatformPaymentConnection({
  provider_scope: "payment", provider: "razorpay", environment: "live",
  connection_status: "active", last_verified_at: "2026-10-17T00:00:00Z",
}), false);
assert.equal(isSandboxCheckedPlatformPaymentConnection({
  provider_scope: "payment", provider: "razorpay", environment: "test",
  connection_status: "active", last_verified_at: "2026-10-17T00:00:00Z",
}), false);

assert.equal(normalizeSubscriptionProviderStatus("razorpay", "payment.captured", ""), "captured");
assert.equal(normalizeSubscriptionProviderStatus("razorpay", "payment.authorized", ""), "authorized");
assert.equal(normalizeSubscriptionProviderStatus("razorpay", "payment.failed", ""), "failed");
assert.equal(normalizeSubscriptionProviderStatus("razorpay", "payment.cancelled", ""), "cancelled");
assert.equal(normalizeSubscriptionProviderStatus("razorpay", "unknown", ""), null);
assert.equal(normalizeSubscriptionProviderStatus("cashfree", "PAYMENT_SUCCESS_WEBHOOK", "PENDING"), "captured");
assert.equal(normalizeSubscriptionProviderStatus("cashfree", "unknown", "SUCCESS"), "captured");
assert.equal(normalizeSubscriptionProviderStatus("cashfree", "unknown", "FAILED"), "failed");
assert.equal(normalizeSubscriptionProviderStatus("cashfree", "unknown", "USER_DROPPED"), "cancelled");
assert.equal(normalizeSubscriptionProviderStatus("cashfree", "unknown", "PENDING"), "pending");
assert.equal(normalizeSubscriptionProviderStatus("cashfree", "unknown", "AUTHORIZED"), null);

const first = subscriptionVerificationEventId("cashfree", "order_a", "payment_b", "SUCCESS");
assert.equal(first, subscriptionVerificationEventId("cashfree", "order_a", "payment_b", "SUCCESS"));
assert.notEqual(first, subscriptionVerificationEventId("cashfree", "order_a", "payment_b", "FAILED"));
assert.match(first, /^verify-cashfree-[a-f0-9]{64}$/);

process.stdout.write("Platform subscription payment core: 18 assertions passed.\n");
