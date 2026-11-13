export type ActiveReminderCredentials =
  | { channel: "Email"; apiKey: string; fromEmail: string; senderName: string }
  | {
      channel: "WhatsApp";
      accessToken: string;
      phoneNumberId: string;
      apiVersion: string;
      templateName: string;
      templateLanguage: string;
    };

export type ActiveFeeReceiptCredentials =
  | Extract<ActiveReminderCredentials, { channel: "Email" }>
  | {
      channel: "WhatsApp";
      accessToken: string;
      phoneNumberId: string;
      apiVersion: string;
      templateName: string;
      templateLanguage: string;
    };

function credentialString(credentials: Record<string, unknown>, name: string): string | null {
  const value = credentials[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 4096 ? trimmed : null;
}

/** Parses only the active credential payload returned by the service-role RPC. */
export function parseActiveReminderCredentials(
  channel: "Email" | "WhatsApp",
  data: unknown,
): ActiveReminderCredentials | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const credentials = data as Record<string, unknown>;

  if (channel === "Email") {
    const apiKey = credentialString(credentials, "api_key");
    const fromEmail = credentialString(credentials, "from_email");
    const senderName = credentialString(credentials, "sender_name") ?? "BizBook";
    if (!apiKey || !fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) return null;
    if (/[<>\r\n]/.test(senderName)) return null;
    return { channel, apiKey, fromEmail, senderName };
  }

  const accessToken = credentialString(credentials, "access_token");
  const phoneNumberId = credentialString(credentials, "phone_number_id");
  const apiVersion = credentialString(credentials, "api_version");
  const templateName = credentialString(credentials, "template_name");
  const templateLanguage = credentialString(credentials, "template_language");
  if (
    !accessToken ||
    !phoneNumberId ||
    !/^\d{5,30}$/.test(phoneNumberId) ||
    !apiVersion ||
    !/^v\d+\.\d+$/.test(apiVersion) ||
    !templateName ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(templateName) ||
    !templateLanguage ||
    !/^[A-Za-z0-9_-]{2,20}$/.test(templateLanguage)
  ) return null;
  return { channel, accessToken, phoneNumberId, apiVersion, templateName, templateLanguage };
}

/** Uses a separate, approved WhatsApp template for BizBook-to-coaching notices. */
export function parseActiveSubscriptionReminderCredentials(
  channel: "Email" | "WhatsApp",
  data: unknown,
): ActiveReminderCredentials | null {
  const base = parseActiveReminderCredentials(channel, data);
  if (!base) return null;
  if (base.channel === "Email") return base;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const credentials = data as Record<string, unknown>;
  const templateName = credentialString(credentials, "subscription_template_name");
  const templateLanguage = credentialString(credentials, "subscription_template_language");
  if (!templateName || !/^[A-Za-z0-9_-]{1,100}$/.test(templateName)
    || !templateLanguage || !/^[A-Za-z0-9_-]{2,20}$/.test(templateLanguage)) return null;
  return { ...base, templateName, templateLanguage };
}

/** Parses the separately configured WhatsApp PDF receipt template and email sender. */
export function parseActiveFeeReceiptCredentials(
  channel: "Email" | "WhatsApp",
  data: unknown,
): ActiveFeeReceiptCredentials | null {
  if (channel === "Email") return parseActiveReminderCredentials(channel, data);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const credentials = data as Record<string, unknown>;
  const accessToken = credentialString(credentials, "access_token");
  const phoneNumberId = credentialString(credentials, "phone_number_id");
  const apiVersion = credentialString(credentials, "api_version");
  const templateName = credentialString(credentials, "receipt_template_name");
  const templateLanguage = credentialString(credentials, "receipt_template_language");
  if (!accessToken || !phoneNumberId || !/^\d{5,30}$/.test(phoneNumberId)
    || !apiVersion || !/^v\d+\.\d+$/.test(apiVersion)
    || !templateName || !/^[A-Za-z0-9_-]{1,100}$/.test(templateName)
    || !templateLanguage || !/^[A-Za-z0-9_-]{2,20}$/.test(templateLanguage)) return null;
  return { channel, accessToken, phoneNumberId, apiVersion, templateName, templateLanguage };
}
