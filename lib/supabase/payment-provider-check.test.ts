import assert from "node:assert/strict";
import { parsePaymentConnectionInput } from "./payment-connection-validation";
import { verifySandboxPaymentCredentials } from "./payment-provider-check";

const rzp = parsePaymentConnectionInput("razorpay", {
  keyId: "rzp_test_example",
  keySecret: "razorpay-secret",
  webhookSecret: "razorpay-webhook-secret",
});
const cashfree = parsePaymentConnectionInput("cashfree", {
  clientId: "cashfree-sandbox-app",
  clientSecret: "cashfree-secret",
  webhookSecret: "cashfree-webhook-secret",
});
assert.equal(rzp.ok, true);
assert.equal(cashfree.ok, true);

if (!rzp.ok || !cashfree.ok) throw new Error("Test credentials should pass input validation.");

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "creates and validates a one-rupee Razorpay sandbox order server-side",
    async run() {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const result = await verifySandboxPaymentCredentials(
        "razorpay",
        rzp,
        async (input, init) => {
          capturedUrl = String(input);
          capturedInit = init;
          return Response.json({ id: "order_test_1", status: "created", amount: 100, amount_paid: 0, currency: "INR" });
        },
        () => "12345678-1234-1234-1234-123456789abc",
      );
      assert.equal(capturedUrl, "https://api.razorpay.com/v1/orders");
      assert.equal(capturedInit?.method, "POST");
      assert.equal(new Headers(capturedInit?.headers).get("authorization"), `Basic ${Buffer.from("rzp_test_example:razorpay-secret").toString("base64")}`);
      assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
        amount: 100,
        currency: "INR",
        receipt: "bbcfg_123456781234123412341234",
      });
      assert.deepEqual(result, {
        ok: true,
        providerOrderId: "order_test_1",
        status: "created",
        amountMinor: 100,
        currency: "INR",
      });
    },
  },
  {
    name: "creates and validates a Cashfree sandbox order with pinned API version",
    async run() {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const result = await verifySandboxPaymentCredentials(
        "cashfree",
        cashfree,
        async (input, init) => {
          capturedUrl = String(input);
          capturedInit = init;
          return Response.json({
            order_id: "bbcfg_123456781234123412341234",
            order_status: "ACTIVE",
            order_amount: 1,
            order_currency: "INR",
            payment_session_id: "secret-session-must-not-be-returned",
          });
        },
        () => "12345678-1234-1234-1234-123456789abc",
      );
      const headers = new Headers(capturedInit?.headers);
      assert.equal(capturedUrl, "https://sandbox.cashfree.com/pg/orders");
      assert.equal(headers.get("x-client-id"), "cashfree-sandbox-app");
      assert.equal(headers.get("x-client-secret"), "cashfree-secret");
      assert.equal(headers.get("x-api-version"), "2025-01-01");
      assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
        order_id: "bbcfg_123456781234123412341234",
        order_amount: 1,
        order_currency: "INR",
        customer_details: {
          customer_id: "bizbook_config_123456781234123412341234",
          customer_phone: "9999999999",
        },
      });
      assert.deepEqual(result, {
        ok: true,
        providerOrderId: "bbcfg_123456781234123412341234",
        status: "created",
        amountMinor: 100,
        currency: "INR",
      });
      assert.equal(JSON.stringify(result).includes("secret-session"), false);
    },
  },
  {
    name: "sanitizes provider credential rejection without reading its error body",
    async run() {
      let bodyRead = false;
      const response = new Response("provider response contains internal details", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      });
      const originalText = response.text.bind(response);
      const originalJson = response.json.bind(response);
      response.text = async () => {
        bodyRead = true;
        return originalText();
      };
      response.json = async () => {
        bodyRead = true;
        return originalJson();
      };
      const result = await verifySandboxPaymentCredentials("razorpay", rzp, async () => response);
      assert.deepEqual(result, {
        ok: false,
        code: "credentials_rejected",
        message: "The provider rejected these sandbox credentials. Check the app ID/key and secret in the provider dashboard.",
      });
      assert.equal(bodyRead, false);
    },
  },
  {
    name: "fails closed on a malformed successful provider response",
    async run() {
      const result = await verifySandboxPaymentCredentials("cashfree", cashfree, async () => Response.json({
        order_id: "unexpected",
        order_status: "PAID",
        order_amount: 1,
        order_currency: "INR",
        payment_session_id: "session",
      }));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "provider_rejected");
    },
  },
  {
    name: "does not return exception details when a provider request fails",
    async run() {
      const result = await verifySandboxPaymentCredentials("razorpay", rzp, async () => {
        throw new Error("credential=should-not-leak");
      });
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("should-not-leak"), false);
      if (!result.ok) assert.equal(result.code, "provider_unavailable");
    },
  },
  {
    name: "rejects a provider mismatch before making a network request",
    async run() {
      let called = false;
      const result = await verifySandboxPaymentCredentials("cashfree", rzp, async () => {
        called = true;
        return Response.json({});
      });
      assert.equal(called, false);
      assert.equal(result.ok, false);
    },
  },
];

async function main() {
  let failures = 0;
  for (const testCase of cases) {
    try {
      await testCase.run();
      console.log(`PASS: ${testCase.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL: ${testCase.name}`);
      console.error(error);
    }
  }

  console.log(`Payment provider check tests: ${cases.length - failures}/${cases.length} passed.`);
  if (failures > 0) process.exitCode = 1;
}

void main();
