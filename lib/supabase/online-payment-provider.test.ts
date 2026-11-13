import assert from "node:assert/strict";
import {
  createProviderOrder,
  createProviderRefund,
  fetchCashfreeOrderPayments,
  fetchRazorpayOrderPayments,
  fetchProviderRefund,
  fetchProviderPayment,
  PaymentProviderError,
  recoverRazorpayOrder,
  retrieveProviderCheckout,
  type ProviderCredentials,
} from "./online-payment-provider-core";

const razorpay: ProviderCredentials = {
  key_id: "rzp_test_sample",
  key_secret: "unit-test-secret",
  webhook_secret: "unit-test-webhook",
};
const cashfree: ProviderCredentials = {
  client_id: "sandbox-app",
  client_secret: "unit-test-secret",
  webhook_secret: "unit-test-webhook",
};

async function run() {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const razorpayOrder = await createProviderOrder({
    provider: "razorpay",
    credentials: razorpay,
    localOrderId: "local_order_123",
    amount: "101.09",
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({ id: "order_test123", amount: 10109, amount_paid: 0, currency: "INR", status: "created",
        receipt: "bb_local_order_123", notes: { bizbook_order_id: "local_order_123" } }), { status: 200 });
    },
  });
  assert.equal(requestedUrl, "https://api.razorpay.com/v1/orders");
  assert.equal(razorpayOrder.providerOrderId, "order_test123");
  assert.equal(razorpayOrder.publicKey, razorpay.key_id);
  assert.equal("key_secret" in razorpayOrder, false);
  assert.equal((JSON.parse(String(requestedInit?.body)) as { amount: number }).amount, 10109);
  assert.equal((JSON.parse(String(requestedInit?.body)) as { receipt: string }).receipt, "bb_local_order_123");

  const recoveredRazorpayOrder = await recoverRazorpayOrder({
    credentials: razorpay,
    localOrderId: "local_order_123",
    amount: "101.09",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ entity: "collection", items: [{ id: "order_test123",
        receipt: "bb_local_order_123", amount: 10109, amount_paid: 0, currency: "INR", status: "created",
        notes: { bizbook_order_id: "local_order_123" } }] }), { status: 200 });
    },
  });
  assert.match(requestedUrl, /\/v1\/orders\?receipt=bb_local_order_123&count=100$/);
  assert.deepEqual(recoveredRazorpayOrder, { providerOrderId: "order_test123", publicKey: razorpay.key_id, providerStatus: "created" });

  const inspectedRazorpayOrder = await retrieveProviderCheckout({
    provider: "razorpay", credentials: razorpay, providerOrderId: "order_test123",
    localOrderId: "local_order_123", amount: "101.09",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ id: "order_test123", receipt: "bb_local_order_123",
        amount: 10109, amount_paid: 10109, currency: "INR", status: "paid",
        notes: { bizbook_order_id: "local_order_123" } }), { status: 200 });
    },
  });
  assert.equal(requestedUrl, "https://api.razorpay.com/v1/orders/order_test123");
  assert.equal(inspectedRazorpayOrder.providerStatus, "paid", "existing orders are re-read before exposing checkout data");

  const missingRazorpayOrder = await recoverRazorpayOrder({
    credentials: razorpay, localOrderId: "local_order_123", amount: "101.09",
    fetcher: async () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
  });
  assert.equal(missingRazorpayOrder, null, "no provider order means retry later, not create a duplicate");

  await assert.rejects(() => recoverRazorpayOrder({
    credentials: razorpay, localOrderId: "local_order_123", amount: "101.09",
    fetcher: async () => new Response(JSON.stringify({ items: [{ id: "order_test123",
      receipt: "bb_local_order_123", amount: 10108, amount_paid: 0, currency: "INR", status: "created",
      notes: { bizbook_order_id: "local_order_123" } }] }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_rejected");

  await assert.rejects(() => recoverRazorpayOrder({
    credentials: razorpay, localOrderId: "local_order_123", amount: "101.09",
    fetcher: async () => new Response(JSON.stringify({ items: [{ id: "order_test123",
      receipt: "bb_local_order_123", amount: 10109, amount_paid: 0, currency: "INR", status: "created",
      notes: { bizbook_order_id: "another_order" } }] }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_rejected");

  await assert.rejects(() => recoverRazorpayOrder({
    credentials: razorpay, localOrderId: "local_order_123", amount: "101.09",
    fetcher: async () => new Response(JSON.stringify({ items: [1, 2].map(() => ({ id: "order_test123",
      receipt: "bb_local_order_123", amount: 10109, amount_paid: 0, currency: "INR", status: "created",
      notes: { bizbook_order_id: "local_order_123" } })) }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_rejected");

  const razorpayAttempts = await fetchRazorpayOrderPayments({
    credentials: razorpay, providerOrderId: "order_test123",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ items: [
        { id: "pay_captured", order_id: "order_test123", amount: 10109, currency: "INR", status: "captured", captured: true },
        { id: "pay_failed", order_id: "order_test123", amount: 10109, currency: "INR", status: "failed", captured: false },
        { id: "pay_wrong_order", order_id: "order_other", amount: 10109, currency: "INR", status: "captured", captured: true },
        { id: "pay_untrusted", order_id: "order_test123", amount: 10109, currency: "INR", status: "captured", captured: false },
      ] }), { status: 200 });
    },
  });
  assert.match(requestedUrl, /\/v1\/orders\/order_test123\/payments$/);
  assert.deepEqual(razorpayAttempts.map((payment) => [payment.providerPaymentId, payment.status]), [
    ["pay_captured", "captured"], ["pay_failed", "failed"],
  ]);

  const cashfreeOrder = await createProviderOrder({
    provider: "cashfree",
    credentials: cashfree,
    localOrderId: "local_order_456",
    amount: "20.50",
    customer: { id: "student-id", name: "Parent", email: "parent@example.test", phone: "9876543210" },
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({
        order_id: "local_order_456", order_status: "ACTIVE", order_amount: 20.5,
        order_currency: "INR", payment_session_id: "session-for-checkout",
      }), { status: 200 });
    },
  });
  assert.equal(requestedUrl, "https://sandbox.cashfree.com/pg/orders");
  assert.equal(new Headers(requestedInit?.headers).get("x-api-version"), "2025-01-01");
  assert.equal(cashfreeOrder.checkoutSession, "session-for-checkout");
  assert.equal("client_secret" in cashfreeOrder, false);
  assert.equal((JSON.parse(String(requestedInit?.body)) as { order_amount: number }).order_amount, 20.5);

  const cashfreePayment = await fetchProviderPayment({
    provider: "cashfree",
    credentials: cashfree,
    providerOrderId: "local_order_456",
    providerPaymentId: "987654",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify([{
        order_id: "local_order_456", cf_payment_id: 987654, payment_status: "SUCCESS",
        payment_amount: 20.5, payment_currency: "INR",
      }]), { status: 200 });
    },
  });
  assert.match(requestedUrl, /\/pg\/orders\/local_order_456\/payments$/);
  assert.equal(cashfreePayment.status, "captured");
  assert.equal(cashfreePayment.amount, "20.5");
  assert.equal(cashfreePayment.currency, "INR");

  const cashfreeOrderPayments = await fetchCashfreeOrderPayments({
    credentials: cashfree,
    providerOrderId: "local_order_456",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify([
        { order_id: "local_order_456", cf_payment_id: 987654, payment_status: "SUCCESS", payment_amount: 20.5, payment_currency: "INR" },
        { order_id: "local_order_456", cf_payment_id: 987655, payment_status: "PENDING", payment_amount: 20.5, payment_currency: "INR" },
        { order_id: "other_order", cf_payment_id: 987656, payment_status: "SUCCESS", payment_amount: 20.5, payment_currency: "INR" },
        { order_id: "local_order_456", cf_payment_id: 987657, payment_status: "UNKNOWN", payment_amount: 20.5, payment_currency: "INR" },
      ]), { status: 200 });
    },
  });
  assert.match(requestedUrl, /\/pg\/orders\/local_order_456\/payments$/);
  assert.deepEqual(cashfreeOrderPayments.map((payment) => [payment.providerPaymentId, payment.status]), [
    ["987654", "captured"], ["987655", "pending"],
  ]);
  assert.equal(cashfreeOrderPayments[0].amount, "20.50");
  assert.equal(cashfreeOrderPayments[0].currency, "INR");

  const razorpayPayment = await fetchProviderPayment({
    provider: "razorpay",
    credentials: razorpay,
    providerOrderId: "order_test123",
    providerPaymentId: "pay_test123",
    fetcher: async () => new Response(JSON.stringify({
      id: "pay_test123", order_id: "order_test123", status: "captured",
      captured: true, amount: 10109, currency: "INR",
    }), { status: 200 }),
  });
  assert.equal(razorpayPayment.status, "captured");
  assert.equal(razorpayPayment.amount, "101.09");

  const retrieved = await retrieveProviderCheckout({
    provider: "cashfree",
    credentials: cashfree,
    providerOrderId: "local_order_456",
    fetcher: async () => new Response(JSON.stringify({
      order_id: "local_order_456", payment_session_id: "retrieved-session", order_currency: "INR", order_amount: 20.5,
    }), { status: 200 }),
  });
  assert.equal(retrieved.checkoutSession, "retrieved-session");

  await assert.rejects(() => retrieveProviderCheckout({
    provider: "cashfree", credentials: cashfree, providerOrderId: "local_order_456", amount: "20.51",
    fetcher: async () => new Response(JSON.stringify({
      order_id: "local_order_456", payment_session_id: "retrieved-session", order_currency: "INR", order_amount: 20.5,
    }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_rejected");

  const refundId = "550e8400-e29b-41d4-a716-446655440000";
  let refundRequestCount = 0;
  let razorpayRefundKey = "";
  const razorpayRefund = await createProviderRefund({
    provider: "razorpay", credentials: razorpay, localRefundId: refundId,
    providerPaymentId: "pay_test123", providerOrderId: "order_test123", amount: "10.25", reason: "Duplicate fee",
    fetcher: async (input, init) => {
      refundRequestCount += 1;
      requestedUrl = String(input);
      requestedInit = init;
      razorpayRefundKey = new Headers(init?.headers).get("X-Refund-Idempotency") ?? "";
      return new Response(JSON.stringify({ id: "rfnd_test123", payment_id: "pay_test123", amount: 1025,
        currency: "INR", receipt: `bb_${refundId.replaceAll("-", "")}`, status: "pending" }), { status: 200 });
    },
  });
  assert.equal(requestedUrl, "https://api.razorpay.com/v1/payments/pay_test123/refund");
  assert.equal(razorpayRefundKey, refundId);
  assert.equal((JSON.parse(String(requestedInit?.body)) as { amount: number }).amount, 1025);
  assert.equal(razorpayRefund.status, "processing");
  assert.equal(razorpayRefund.providerRefundId, "rfnd_test123");
  assert.equal(refundRequestCount, 1);

  const cashfreeRefund = await createProviderRefund({
    provider: "cashfree", credentials: cashfree, localRefundId: refundId,
    providerPaymentId: "987654", providerOrderId: "local_order_456", amount: "20.50", reason: "Fee adjustment",
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({ cf_refund_id: "cf_refund_test", cf_payment_id: "987654",
        refund_id: `bb${refundId.replaceAll("-", "")}`, order_id: "local_order_456", refund_amount: 20.5,
        refund_currency: "INR", refund_status: "SUCCESS" }), { status: 200 });
    },
  });
  assert.equal(requestedUrl, "https://sandbox.cashfree.com/pg/orders/local_order_456/refunds");
  assert.equal(new Headers(requestedInit?.headers).get("x-idempotency-key"), refundId);
  assert.equal(cashfreeRefund.status, "completed");
  assert.equal(cashfreeRefund.amount, "20.50");
  assert.notEqual((JSON.parse(String(requestedInit?.body)) as { refund_note: string }).refund_note, "SUCCESS");

  const fetchedRefund = await fetchProviderRefund({
    provider: "cashfree", credentials: cashfree, localRefundId: refundId,
    providerPaymentId: "987654", providerOrderId: "local_order_456", providerRefundId: "cf_refund_test",
    amount: "20.50",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ cf_refund_id: "cf_refund_test", cf_payment_id: "987654",
        refund_id: `bb${refundId.replaceAll("-", "")}`, order_id: "local_order_456", refund_amount: 20.5,
        refund_currency: "INR", refund_status: "PENDING" }), { status: 200 });
    },
  });
  assert.equal(requestedUrl, `https://sandbox.cashfree.com/pg/orders/local_order_456/refunds/bb${refundId.replaceAll("-", "")}`);
  assert.equal(fetchedRefund?.status, "processing");

  const fetchedRazorpayRefund = await fetchProviderRefund({
    provider: "razorpay", credentials: razorpay, localRefundId: refundId,
    providerPaymentId: "pay_test123", providerOrderId: "order_test123", providerRefundId: "rfnd_test123",
    amount: "10.25",
    fetcher: async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ id: "rfnd_test123", payment_id: "pay_test123", amount: 1025,
        currency: "INR", status: "failed" }), { status: 200 });
    },
  });
  assert.match(requestedUrl, /\/payments\/pay_test123\/refunds\/rfnd_test123$/);
  assert.equal(fetchedRazorpayRefund?.status, "failed");

  await assert.rejects(() => createProviderOrder({
    provider: "razorpay",
    credentials: razorpay,
    localOrderId: "local_order_999",
    amount: "10.00",
    fetcher: async () => new Response(JSON.stringify({ id: "order_wrong", amount: 999, amount_paid: 0, currency: "INR", status: "created" }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_unavailable");
  await assert.rejects(() => createProviderOrder({
    provider: "cashfree",
    credentials: cashfree,
    localOrderId: "local_order_777",
    amount: "10.00",
    customer: { id: "s", name: "Parent", email: "p@example.test", phone: "123" },
    fetcher: async () => { throw new Error("network detail must not escape"); },
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_rejected");
  await assert.rejects(() => fetchProviderPayment({
    provider: "razorpay",
    credentials: razorpay,
    providerOrderId: "order_expected",
    providerPaymentId: "pay_expected",
    fetcher: async () => new Response(JSON.stringify({
      id: "pay_expected", order_id: "order_other", status: "captured", captured: true, amount: 1000, currency: "INR",
    }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_rejected");

  await assert.rejects(() => fetchCashfreeOrderPayments({
    credentials: cashfree,
    providerOrderId: "local_order_456",
    fetcher: async () => new Response(JSON.stringify({ error: "invalid" }), { status: 200 }),
  }), (error: unknown) => error instanceof PaymentProviderError && error.code === "provider_unavailable");

  console.log("Online payment provider adapter: 52 assertions passed.");
}

void run();
