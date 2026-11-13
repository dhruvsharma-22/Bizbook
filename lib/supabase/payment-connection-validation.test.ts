import assert from "node:assert/strict";
import { parsePaymentConnectionInput } from "./payment-connection-validation";

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: "accepts Razorpay test credentials and produces a private storage payload",
    run() {
      const result = parsePaymentConnectionInput("razorpay", {
        keyId: "rzp_test_example",
        keySecret: "razorpay-test-secret",
        webhookSecret: "razorpay-webhook-secret",
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.accountReference, "rzp_test_example");
        assert.equal(result.credentials.key_secret, "razorpay-test-secret");
      }
    },
  },
  {
    name: "rejects Razorpay live key IDs",
    run() {
      const result = parsePaymentConnectionInput("razorpay", {
        keyId: "rzp_live_example",
        keySecret: "credential",
        webhookSecret: "webhook",
      });
      assert.equal(result.ok, false);
    },
  },
  {
    name: "requires webhook verification material for Razorpay",
    run() {
      const result = parsePaymentConnectionInput("razorpay", {
        keyId: "rzp_test_example",
        keySecret: "credential",
        webhookSecret: " ",
      });
      assert.equal(result.ok, false);
    },
  },
  {
    name: "requires Cashfree sandbox app and webhook secrets",
    run() {
      const result = parsePaymentConnectionInput("cashfree", {
        clientId: "sandbox-app-id",
        clientSecret: "sandbox-client-secret",
        webhookSecret: "sandbox-webhook-secret",
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.credentials.api_version, "2025-01-01");
    },
  },
  {
    name: "rejects missing and oversized credential values",
    run() {
      assert.equal(parsePaymentConnectionInput("cashfree", {}).ok, false);
      assert.equal(parsePaymentConnectionInput("cashfree", {
        clientId: "a".repeat(4097),
        clientSecret: "secret",
        webhookSecret: "webhook",
      }).ok, false);
    },
  },
  {
    name: "rejects unsupported provider names",
    run() {
      assert.equal(parsePaymentConnectionInput("provider-x", {}).ok, false);
    },
  },
];

let failures = 0;
for (const testCase of cases) {
  try {
    testCase.run();
    console.log(`PASS: ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${testCase.name}`);
    console.error(error);
  }
}

console.log(`Payment configuration tests: ${cases.length - failures}/${cases.length} passed.`);
if (failures > 0) process.exitCode = 1;
