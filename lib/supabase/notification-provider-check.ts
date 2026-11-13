import { randomUUID } from "node:crypto";
import type { NotificationConnectionInputResult } from "./notification-connection-validation";

export type NotificationCheckResult =
  | { ok: true; provider: "resend"; providerReference: string; check: "test_email_accepted" }
  | { ok: true; provider: "whatsapp_cloud"; providerReference: string; check: "phone_profile_read" }
  | {
      ok: false;
      code: "credentials_rejected" | "provider_rejected" | "provider_unavailable";
      message: string;
    };

type FetchLike = typeof fetch;

function rejected(response: Response): NotificationCheckResult {
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "credentials_rejected",
      message: "The provider rejected these credentials or the token lacks the required permission.",
    };
  }
  return {
    ok: false,
    code: "provider_rejected",
    message: "The provider did not accept this configuration check. Review the provider settings and try again.",
  };
}

/**
 * Resend uses its documented test inbox; WhatsApp uses a read-only phone
 * profile lookup. This verifies only the API operation performed, not webhook
 * delivery or production readiness. Credentials stay server-side.
 */
export async function verifyNotificationProvider(
  provider: "resend" | "whatsapp_cloud",
  parsed: Extract<NotificationConnectionInputResult, { ok: true }>,
  fetcher: FetchLike = fetch,
  createId: () => string = randomUUID,
): Promise<NotificationCheckResult> {
  if (parsed.provider !== provider) {
    return {
      ok: false,
      code: "provider_rejected",
      message: "The provider configuration does not match the requested check.",
    };
  }

  try {
    if (provider === "resend") {
      const apiKey = parsed.credentials.api_key;
      const fromEmail = parsed.credentials.from_email;
      if (!apiKey || !fromEmail) {
        return { ok: false, code: "provider_rejected", message: "Resend configuration is incomplete." };
      }
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": `bizbook-integration-check/${createId()}`,
        },
        body: JSON.stringify({
          from: `BizBook test <${fromEmail}>`,
          to: ["delivered@resend.dev"],
          subject: "BizBook email integration test",
          html: "<p>This is an administrator-requested BizBook provider test.</p>",
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return rejected(response);
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || typeof (data as Record<string, unknown>).id !== "string") {
        return { ok: false, code: "provider_rejected", message: "Resend returned an unrecognized test email response." };
      }
      return {
        ok: true,
        provider: "resend",
        providerReference: (data as Record<string, string>).id,
        check: "test_email_accepted",
      };
    }

    const accessToken = parsed.credentials.access_token;
    const phoneNumberId = parsed.credentials.phone_number_id;
    const apiVersion = parsed.credentials.api_version;
    if (!accessToken || !phoneNumberId || !apiVersion) {
      return { ok: false, code: "provider_rejected", message: "WhatsApp configuration is incomplete." };
    }
    const profileUrl = new URL(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}`);
    profileUrl.searchParams.set("fields", "id,display_phone_number,verified_name");
    const response = await fetcher(profileUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return rejected(response);
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      (data as Record<string, unknown>).id !== phoneNumberId ||
      typeof (data as Record<string, unknown>).display_phone_number !== "string"
    ) {
      return { ok: false, code: "provider_rejected", message: "Meta returned an unexpected phone profile response." };
    }
    return {
      ok: true,
      provider: "whatsapp_cloud",
      providerReference: phoneNumberId,
      check: "phone_profile_read",
    };
  } catch {
    return {
      ok: false,
      code: "provider_unavailable",
      message: "The notification provider could not be reached or timed out. No successful check was recorded.",
    };
  }
}
