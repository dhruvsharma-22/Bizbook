import assert from "node:assert/strict";
import { parseNotificationConnectionInput } from "./notification-connection-validation";

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "accepts Resend setup without a webhook secret before an endpoint exists",
    run() {
      const result = parseNotificationConnectionInput("resend", {
        apiKey: "resend-test-key",
        fromEmail: "billing@example.test",
        webhookSigningSecret: "",
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.accountReference, "billing@example.test");
        assert.equal(result.credentials.webhook_signing_secret, "");
      }
    },
  },
  {
    name: "rejects invalid Resend sender addresses",
    run() {
      assert.equal(parseNotificationConnectionInput("resend", {
        apiKey: "key",
        fromEmail: "not-an-email",
      }).ok, false);
    },
  },
  {
    name: "accepts fully specified WhatsApp test configuration",
    run() {
      const result = parseNotificationConnectionInput("whatsapp_cloud", {
        accessToken: "test-access-token",
        phoneNumberId: "123456789012345",
        businessAccountId: "123456789012345",
        appSecret: "test-app-secret",
        webhookVerifyToken: "chosen-verify-token",
        apiVersion: "v23.0",
        templateName: "fee_due_reminder",
        templateLanguage: "en_US",
      });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.credentials.api_version, "v23.0");
    },
  },
  {
    name: "rejects malformed WhatsApp IDs and Graph API versions",
    run() {
      const base = {
        accessToken: "token",
        phoneNumberId: "12345",
        businessAccountId: "67890",
        appSecret: "secret",
        webhookVerifyToken: "verify",
        apiVersion: "latest",
        templateName: "fee_due_reminder",
        templateLanguage: "en_US",
      };
      assert.equal(parseNotificationConnectionInput("whatsapp_cloud", base).ok, false);
      assert.equal(parseNotificationConnectionInput("whatsapp_cloud", { ...base, apiVersion: "v23.0", phoneNumberId: "abc" }).ok, false);
    },
  },
  {
    name: "rejects unsupported notification providers",
    run() {
      assert.equal(parseNotificationConnectionInput("sms-provider", {}).ok, false);
    },
  },
];

let failures = 0;
for (const test of tests) {
  try {
    test.run();
    console.log(`PASS: ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${test.name}`);
    console.error(error);
  }
}

console.log(`Notification configuration tests: ${tests.length - failures}/${tests.length} passed.`);
if (failures > 0) process.exitCode = 1;
