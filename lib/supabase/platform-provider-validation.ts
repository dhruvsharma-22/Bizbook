export type PlatformProviderScope = "payment" | "email" | "whatsapp";
export type PlatformProvider = "razorpay" | "cashfree" | "resend" | "whatsapp_cloud";

export type PlatformProviderInput = {
  providerScope: PlatformProviderScope;
  provider: PlatformProvider;
  accountReference: string | null;
  credentials: Record<string, string>;
};

export type PlatformProviderParseResult =
  | { ok: true; value: PlatformProviderInput }
  | { ok: false; error: string };

function cleanString(value: unknown, max = 4096): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parsePlatformProviderInput(scopeValue: unknown, providerValue: unknown, value: unknown): PlatformProviderParseResult {
  const providerScope = cleanString(scopeValue, 20);
  const provider = cleanString(providerValue, 30);
  const record = asRecord(value);
  if (!record || !providerScope || !provider) return { ok: false, error: "Provider configuration is invalid." };

  const validPair = (providerScope === "payment" && (provider === "razorpay" || provider === "cashfree"))
    || (providerScope === "email" && provider === "resend")
    || (providerScope === "whatsapp" && provider === "whatsapp_cloud");
  if (!validPair) return { ok: false, error: "This provider is not supported for the selected service." };

  let fields: string[];
  let accountReference: string | null = null;
  if (provider === "razorpay") {
    fields = ["key_id", "key_secret", "webhook_secret"];
    accountReference = cleanString(record.account_reference, 160);
  } else if (provider === "cashfree") {
    fields = ["client_id", "client_secret", "webhook_secret"];
    accountReference = cleanString(record.account_reference, 160);
  } else if (provider === "resend") {
    fields = ["api_key", "from_email", "sender_name", "webhook_signing_secret"];
    accountReference = cleanString(record.from_email, 254);
    const fromEmail = cleanString(record.from_email, 254);
    if (!fromEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
      return { ok: false, error: "Enter a valid verified sender email." };
    }
    if (!cleanString(record.sender_name, 100) || /[<>\r\n]/.test(cleanString(record.sender_name, 100) ?? "")) {
      return { ok: false, error: "Enter a valid sender name." };
    }
  } else {
    fields = ["access_token", "phone_number_id", "business_account_id", "app_secret", "webhook_verify_token", "api_version", "template_name", "template_language"];
    accountReference = cleanString(record.phone_number_id, 64);
    if (!/^\d{5,30}$/.test(cleanString(record.phone_number_id, 64) ?? "")
      || !/^\d{5,30}$/.test(cleanString(record.business_account_id, 64) ?? "")
      || !/^v\d+\.\d+$/.test(cleanString(record.api_version, 30) ?? "")
      || !/^[A-Za-z0-9_-]{1,100}$/.test(cleanString(record.template_name, 100) ?? "")
      || !/^[A-Za-z0-9_-]{2,20}$/.test(cleanString(record.template_language, 20) ?? "")) {
      return { ok: false, error: "WhatsApp account or template settings are invalid." };
    }
  }

  if (provider === "whatsapp_cloud") {
    const receiptTemplateName = cleanString(record.receipt_template_name, 100);
    const receiptTemplateLanguage = cleanString(record.receipt_template_language, 20);
    if ((receiptTemplateName && !receiptTemplateLanguage) || (!receiptTemplateName && receiptTemplateLanguage)) {
      return { ok: false, error: "Enter both the approved PDF receipt template name and language, or leave both blank." };
    }
    if (receiptTemplateName && (!/^[A-Za-z0-9_-]{1,100}$/.test(receiptTemplateName)
      || !/^[A-Za-z0-9_-]{2,20}$/.test(receiptTemplateLanguage ?? ""))) {
      return { ok: false, error: "The PDF receipt template name or language is invalid." };
    }
    fields.push("receipt_template_name", "receipt_template_language");

    const subscriptionTemplateName = cleanString(record.subscription_template_name, 100);
    const subscriptionTemplateLanguage = cleanString(record.subscription_template_language, 20);
    if ((subscriptionTemplateName && !subscriptionTemplateLanguage) || (!subscriptionTemplateName && subscriptionTemplateLanguage)) {
      return { ok: false, error: "Enter both the approved BizBook subscription reminder template name and language, or leave both blank." };
    }
    if (subscriptionTemplateName && (!/^[A-Za-z0-9_-]{1,100}$/.test(subscriptionTemplateName)
      || !/^[A-Za-z0-9_-]{2,20}$/.test(subscriptionTemplateLanguage ?? ""))) {
      return { ok: false, error: "The BizBook subscription template name or language is invalid." };
    }
    fields.push("subscription_template_name", "subscription_template_language");
  }

  const credentials: Record<string, string> = {};
  for (const field of fields) {
    const raw = record[field];
    const trimmed = cleanString(raw, field.includes("secret") || field.includes("token") || field.includes("key") ? 4096 : 254);
    const optionalTemplateField = field.startsWith("receipt_template_") || field.startsWith("subscription_template_");
    if (!trimmed && !optionalTemplateField) return { ok: false, error: `The ${field.replaceAll("_", " ")} field is required.` };
    if (trimmed) credentials[field] = trimmed;
  }
  return {
    ok: true,
    value: {
      providerScope: providerScope as PlatformProviderScope,
      provider: provider as PlatformProvider,
      accountReference,
      credentials,
    },
  };
}
