export type NotificationProvider = "resend" | "whatsapp_cloud";

export type NotificationCredentials = Record<string, string>;

export type NotificationConnectionInputResult =
  | {
      ok: true;
      provider: NotificationProvider;
      accountReference: string;
      credentials: NotificationCredentials;
    }
  | { ok: false; error: string };

const MAX_CREDENTIAL_LENGTH = 4096;

function required(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= MAX_CREDENTIAL_LENGTH ? clean : null;
}

export function parseNotificationConnectionInput(
  provider: unknown,
  rawCredentials: unknown,
): NotificationConnectionInputResult {
  if (provider !== "resend" && provider !== "whatsapp_cloud") {
    return { ok: false, error: "Choose a supported notification provider." };
  }
  if (!rawCredentials || typeof rawCredentials !== "object" || Array.isArray(rawCredentials)) {
    return { ok: false, error: "Enter the provider configuration." };
  }

  const input = rawCredentials as Record<string, unknown>;
  if (provider === "resend") {
    const apiKey = required(input.apiKey);
    const fromEmail = required(input.fromEmail);
    const webhookSigningSecret = typeof input.webhookSigningSecret === "string" ? input.webhookSigningSecret.trim() : "";
    if (!apiKey || !fromEmail || webhookSigningSecret.length > MAX_CREDENTIAL_LENGTH) {
      return { ok: false, error: "Enter the Resend API key and sender email; check the optional webhook secret length." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      return { ok: false, error: "Enter a valid sender email address." };
    }
    return {
      ok: true,
      provider,
      accountReference: fromEmail,
      credentials: {
        api_key: apiKey,
        from_email: fromEmail,
        webhook_signing_secret: webhookSigningSecret,
      },
    };
  }

  const accessToken = required(input.accessToken);
  const phoneNumberId = required(input.phoneNumberId);
  const businessAccountId = required(input.businessAccountId);
  const appSecret = required(input.appSecret);
  const webhookVerifyToken = required(input.webhookVerifyToken);
  const apiVersion = required(input.apiVersion);
  const templateName = required(input.templateName);
  const templateLanguage = required(input.templateLanguage);
  if (!accessToken || !phoneNumberId || !businessAccountId || !appSecret || !webhookVerifyToken || !apiVersion || !templateName || !templateLanguage) {
    return { ok: false, error: "Complete all WhatsApp Business API and webhook settings." };
  }
  if (!/^\d{5,30}$/.test(phoneNumberId) || !/^\d{5,30}$/.test(businessAccountId)) {
    return { ok: false, error: "Enter the numeric WhatsApp phone number ID and business account ID." };
  }
  if (!/^v\d+\.\d+$/.test(apiVersion)) {
    return { ok: false, error: "Enter the Meta Graph API version in vNN.N format." };
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(templateName) || !/^[A-Za-z0-9_-]{2,20}$/.test(templateLanguage)) {
    return { ok: false, error: "Check the approved WhatsApp template name and language code." };
  }

  return {
    ok: true,
    provider,
    accountReference: phoneNumberId,
    credentials: {
      access_token: accessToken,
      phone_number_id: phoneNumberId,
      business_account_id: businessAccountId,
      app_secret: appSecret,
      webhook_verify_token: webhookVerifyToken,
      api_version: apiVersion,
      template_name: templateName,
      template_language: templateLanguage,
    },
  };
}
