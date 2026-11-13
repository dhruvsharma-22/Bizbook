import assert from "node:assert/strict";
import { parseActiveReminderCredentials } from "./notification-provider-credentials";

const cases: Array<{ name: string; run: () => void }> = [
  {
    name: "parses complete active Resend credentials without leaking unrecognized fields",
    run() {
      const result = parseActiveReminderCredentials("Email", {
        api_key: "resend-secret",
        from_email: "billing@example.test",
        webhook_signing_secret: "webhook-secret",
        unexpected_field: "ignored",
      });
      assert.deepEqual(result, {
        channel: "Email",
        apiKey: "resend-secret",
        fromEmail: "billing@example.test",
        senderName: "BizBook",
      });
      assert.equal(JSON.stringify(result).includes("webhook-secret"), false);
    },
  },
  {
    name: "parses complete Meta credentials required for configured template reminders",
    run() {
      assert.deepEqual(parseActiveReminderCredentials("WhatsApp", {
        access_token: "access-token",
        phone_number_id: "123456789012345",
        business_account_id: "987654321098765",
        app_secret: "app-secret",
        webhook_verify_token: "verify-token",
        api_version: "v23.0",
        template_name: "payment_due_reminder",
        template_language: "en_US",
      }), {
        channel: "WhatsApp",
        accessToken: "access-token",
        phoneNumberId: "123456789012345",
        apiVersion: "v23.0",
        templateName: "payment_due_reminder",
        templateLanguage: "en_US",
      });
    },
  },
  {
    name: "returns unavailable for null or unexpected stored credential payloads",
    run() {
      assert.equal(parseActiveReminderCredentials("Email", null), null);
      assert.equal(parseActiveReminderCredentials("Email", ["credential"]), null);
      assert.equal(parseActiveReminderCredentials("WhatsApp", "credential"), null);
    },
  },
  {
    name: "rejects incomplete and malformed provider credentials",
    run() {
      assert.equal(parseActiveReminderCredentials("Email", { api_key: "key", from_email: "bad-address" }), null);
      assert.equal(parseActiveReminderCredentials("WhatsApp", {
        access_token: "token",
        phone_number_id: "bad-id",
        api_version: "v1.0",
        template_name: "template",
        template_language: "en_US",
      }), null);
      assert.equal(parseActiveReminderCredentials("WhatsApp", {
        access_token: "token",
        phone_number_id: "123456789012345",
        api_version: "https://example.test",
        template_name: "template",
        template_language: "en_US",
      }), null);
    },
  },
  {
    name: "rejects oversized credential values before provider requests",
    run() {
      assert.equal(parseActiveReminderCredentials("Email", {
        api_key: "x".repeat(4097),
        from_email: "billing@example.test",
      }), null);
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
console.log(`Notification credential tests: ${cases.length - failures}/${cases.length} passed.`);
if (failures > 0) process.exitCode = 1;
