import { NextResponse } from "next/server";
import { PlatformAuthorizationError, requirePlatformAdministrator } from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { isAuthorizedTestProjectUrl } from "@/lib/supabase/workspace-scope";
import { parsePaymentConnectionInput } from "@/lib/supabase/payment-connection-validation";
import { verifySandboxPaymentCredentials } from "@/lib/supabase/payment-provider-check";
import { parseNotificationConnectionInput } from "@/lib/supabase/notification-connection-validation";
import { verifyNotificationProvider } from "@/lib/supabase/notification-provider-check";

const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

function testProjectOnly(): boolean {
  try { return isAuthorizedTestProjectUrl(getSupabasePublicConfig().url); } catch { return false; }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorResponse(error: unknown) {
  if (error instanceof PlatformAuthorizationError) return json({ error: error.message }, error.status);
  return json({ error: "The provider verification request could not be completed." }, 500);
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "The request origin could not be verified." }, 403);
  try {
    if (!testProjectOnly()) return json({ error: "Provider checks are available only on the authorized test project." }, 503);
    const { userId } = await requirePlatformAdministrator();
    const sessionClient = await createSupabaseServerClient();
    const { data: overview, error: overviewError } = await sessionClient.rpc("platform_admin_overview_safe", {
      p_search: null, p_limit: 1, p_offset: 0,
    });
    if (overviewError) return json({ error: "Platform owner permissions could not be verified." }, 503);
    const role = object(overview)?.current_role;
    if (role !== "owner") return json({ error: "Platform owner access is required to verify provider settings." }, 403);

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 2048) return json({ error: "The verification request is too large." }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: "The verification request is invalid." }, 400); }
    const record = object(input);
    if (!record || record.confirmed !== true) return json({ error: "Explicit confirmation is required for a provider test." }, 400);
    const scope = record.providerScope;
    const provider = record.provider;
    const supported = (scope === "payment" && (provider === "razorpay" || provider === "cashfree"))
      || (scope === "email" && provider === "resend")
      || (scope === "whatsapp" && provider === "whatsapp_cloud");
    if (!supported) return json({ error: "This provider is not supported for the requested check." }, 400);

    let admin;
    try { admin = createSupabaseAdminClient(); }
    catch { return json({ error: "Server-side test-project service credentials are required before provider checks can run." }, 503); }
    const { data: credentials, error: credentialsError } = await admin.rpc("get_platform_provider_credentials", {
      p_provider_scope: scope, p_provider: provider, p_allow_pending: true,
    });
    const stored = object(credentials);
    if (credentialsError || !stored) {
      return json({ error: "No readable pending test credentials are available in Supabase Vault." }, 503);
    }
    const providerScope = scope as "payment" | "email" | "whatsapp";
    const providerName = provider as "razorpay" | "cashfree" | "resend" | "whatsapp_cloud";

    let checkType: "unpaid_order_created" | "test_email_accepted" | "phone_profile_read";
    let providerMessage: string;
    if (scope === "payment") {
      const paymentProvider = provider as "razorpay" | "cashfree";
      const parsed = parsePaymentConnectionInput(paymentProvider, paymentProvider === "razorpay"
        ? { keyId: stored.key_id, keySecret: stored.key_secret, webhookSecret: stored.webhook_secret }
        : { clientId: stored.client_id, clientSecret: stored.client_secret, webhookSecret: stored.webhook_secret });
      if (!parsed.ok) return json({ error: "The saved payment test credentials are incomplete or invalid." }, 422);
      const result = await verifySandboxPaymentCredentials(paymentProvider, parsed);
      if (!result.ok) return json({ error: result.message, checkFailed: true }, 502);
      checkType = "unpaid_order_created";
      providerMessage = "The provider accepted a synthetic unpaid INR 1 test order. No checkout was opened and no payment was attempted.";
    } else if (scope === "email") {
      const parsed = parseNotificationConnectionInput("resend", {
        apiKey: stored.api_key, fromEmail: stored.from_email,
        webhookSigningSecret: stored.webhook_signing_secret,
      });
      if (!parsed.ok) return json({ error: "The saved email test credentials are incomplete or invalid." }, 422);
      const result = await verifyNotificationProvider("resend", parsed);
      if (!result.ok) return json({ error: result.message, checkFailed: true }, 502);
      checkType = "test_email_accepted";
      providerMessage = "Resend accepted one test email for its reserved test inbox. This did not verify webhook delivery.";
    } else {
      const parsed = parseNotificationConnectionInput("whatsapp_cloud", {
        accessToken: stored.access_token, phoneNumberId: stored.phone_number_id,
        businessAccountId: stored.business_account_id, appSecret: stored.app_secret,
        webhookVerifyToken: stored.webhook_verify_token, apiVersion: stored.api_version,
        templateName: stored.template_name, templateLanguage: stored.template_language,
      });
      if (!parsed.ok) return json({ error: "The saved WhatsApp test credentials are incomplete or invalid." }, 422);
      const result = await verifyNotificationProvider("whatsapp_cloud", parsed);
      if (!result.ok) return json({ error: result.message, checkFailed: true }, 502);
      checkType = "phone_profile_read";
      providerMessage = "Meta returned the configured phone profile. This read-only check did not send a WhatsApp message.";
    }

    const { data, error } = await admin.rpc("record_platform_provider_sandbox_check", {
      p_provider_scope: providerScope,
      p_provider: providerName,
      p_check_type: checkType,
      p_actor_user_id: userId,
    });
    if (error || !data) {
      return json({ error: "The provider check succeeded, but its audit result could not be saved. The connection remains pending." }, 503);
    }
    return json({ verified: true, configuration: data, message: providerMessage });
  } catch (error) { return errorResponse(error); }
}
