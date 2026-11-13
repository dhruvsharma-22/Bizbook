import assert from "node:assert/strict";
import { parsePlatformProviderInput } from "./platform-provider-validation";

const cases = [
  {
    name: "accepts central email settings and never accepts a browser-selected live mode",
    run() {
      const result = parsePlatformProviderInput("email", "resend", {
        api_key: "resend-test-key",
        from_email: "billing@example.test",
        sender_name: "BizBook",
        webhook_signing_secret: "webhook-test-secret",
        environment: "production",
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.accountReference, "billing@example.test");
        assert.equal("environment" in result.value, false);
      }
    },
  },
  {
    name: "rejects a sender name that can inject email display syntax",
    run() {
      assert.equal(parsePlatformProviderInput("email", "resend", {
        api_key: "key", from_email: "billing@example.test", sender_name: "BizBook <evil>", webhook_signing_secret: "secret",
      }).ok, false);
    },
  },
  {
    name: "accepts WhatsApp only with valid account identity, version and approved template identifiers",
    run() {
      assert.equal(parsePlatformProviderInput("whatsapp", "whatsapp_cloud", {
        access_token: "access-token",
        phone_number_id: "123456789012345",
        business_account_id: "987654321098765",
        app_secret: "app-secret",
        webhook_verify_token: "verify-token",
        api_version: "v23.0",
        template_name: "fee_due_reminder",
        template_language: "en_US",
      }).ok, true);
    },
  },
  {
    name: "rejects malformed or mismatched provider scope",
    run() {
      assert.equal(parsePlatformProviderInput("whatsapp", "resend", {}).ok, false);
      assert.equal(parsePlatformProviderInput("whatsapp", "whatsapp_cloud", {
        access_token: "access-token", phone_number_id: "abc", business_account_id: "123456789",
        app_secret: "secret", webhook_verify_token: "verify", api_version: "latest",
        template_name: "template", template_language: "en_US",
      }).ok, false);
    },
  },
  {
    name: "rejects missing secrets and oversized request fields",
    run() {
      assert.equal(parsePlatformProviderInput("payment", "razorpay", {
        key_id: "rzp_test_x", key_secret: "", webhook_secret: "secret",
      }).ok, false);
      assert.equal(parsePlatformProviderInput("payment", "cashfree", {
        client_id: "x", client_secret: "x".repeat(4097), webhook_secret: "y",
      }).ok, false);
    },
  },
];

let failed = 0;
for (const test of cases) {
  try { test.run(); console.log(`PASS: ${test.name}`); }
  catch (error) { failed += 1; console.error(`FAIL: ${test.name}`); console.error(error); }
}
console.log(`Platform provider validation tests: ${cases.length - failed}/${cases.length} passed.`);
if (failed) process.exitCode = 1;
