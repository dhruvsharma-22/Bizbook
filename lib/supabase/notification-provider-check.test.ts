import assert from "node:assert/strict";
import { parseNotificationConnectionInput } from "./notification-connection-validation";
import { verifyNotificationProvider } from "./notification-provider-check";

const resend = parseNotificationConnectionInput("resend", {
  apiKey: "re_test_secret",
  fromEmail: "billing@example.test",
  webhookSigningSecret: "webhook-signing-secret",
});
const whatsapp = parseNotificationConnectionInput("whatsapp_cloud", {
  accessToken: "meta-test-token",
  phoneNumberId: "123456789012345",
  businessAccountId: "987654321098765",
  appSecret: "meta-app-secret",
  webhookVerifyToken: "webhook-verify-token",
  apiVersion: "v23.0",
  templateName: "hello_world",
  templateLanguage: "en_US",
});
assert.equal(resend.ok, true);
assert.equal(whatsapp.ok, true);
if (!resend.ok || !whatsapp.ok) throw new Error("Test notification configuration should be valid.");

const cases: Array<{ name: string; run: () => Promise<void> }> = [
  {
    name: "sends Resend's documented synthetic test email only to its delivery test inbox",
    async run() {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const result = await verifyNotificationProvider("resend", resend, async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return Response.json({ id: "email_test_123" });
      }, () => "request-id");
      assert.equal(capturedUrl, "https://api.resend.com/emails");
      assert.equal(capturedInit?.method, "POST");
      assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer re_test_secret");
      assert.equal(new Headers(capturedInit?.headers).get("idempotency-key"), "bizbook-integration-check/request-id");
      assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
        from: "BizBook test <billing@example.test>",
        to: ["delivered@resend.dev"],
        subject: "BizBook email integration test",
        html: "<p>This is an administrator-requested BizBook provider test.</p>",
      });
      assert.deepEqual(result, {
        ok: true,
        provider: "resend",
        providerReference: "email_test_123",
        check: "test_email_accepted",
      });
    },
  },
  {
    name: "checks WhatsApp phone profile with a read-only Meta Graph request",
    async run() {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const result = await verifyNotificationProvider("whatsapp_cloud", whatsapp, async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return Response.json({ id: "123456789012345", display_phone_number: "+1 555 0100", verified_name: "BizBook Test" });
      });
      const url = new URL(capturedUrl);
      assert.equal(url.origin, "https://graph.facebook.com");
      assert.equal(url.pathname, "/v23.0/123456789012345");
      assert.equal(url.searchParams.get("fields"), "id,display_phone_number,verified_name");
      assert.equal(capturedInit?.method, "GET");
      assert.equal(new Headers(capturedInit?.headers).get("authorization"), "Bearer meta-test-token");
      assert.deepEqual(result, {
        ok: true,
        provider: "whatsapp_cloud",
        providerReference: "123456789012345",
        check: "phone_profile_read",
      });
    },
  },
  {
    name: "sanitizes provider authorization failures",
    async run() {
      const result = await verifyNotificationProvider("resend", resend, async () => new Response("secret details", { status: 403 }));
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("secret details"), false);
      if (!result.ok) assert.equal(result.code, "credentials_rejected");
    },
  },
  {
    name: "fails closed if Meta returns a different phone profile",
    async run() {
      const result = await verifyNotificationProvider("whatsapp_cloud", whatsapp, async () => Response.json({
        id: "another-phone-id",
        display_phone_number: "+1 555 0100",
      }));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "provider_rejected");
    },
  },
  {
    name: "does not include credential exception details in failures",
    async run() {
      const result = await verifyNotificationProvider("resend", resend, async () => {
        throw new Error("apiKey=private-value");
      });
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("private-value"), false);
      if (!result.ok) assert.equal(result.code, "provider_unavailable");
    },
  },
  {
    name: "rejects provider mismatch without making a request",
    async run() {
      let called = false;
      const result = await verifyNotificationProvider("whatsapp_cloud", resend, async () => {
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
  console.log(`Notification provider check tests: ${cases.length - failures}/${cases.length} passed.`);
  if (failures > 0) process.exitCode = 1;
}

void main();
