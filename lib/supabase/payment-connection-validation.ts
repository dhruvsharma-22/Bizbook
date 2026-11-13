export type PaymentProvider = "razorpay" | "cashfree";

export type StoredPaymentCredentials = Record<string, string>;

export type PaymentConnectionInputResult =
  | {
      ok: true;
      provider: PaymentProvider;
      accountReference: string;
      credentials: StoredPaymentCredentials;
    }
  | { ok: false; error: string };

const MAX_CREDENTIAL_LENGTH = 4096;
const CASHFREE_API_VERSION = "2025-01-01";

function requiredSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= MAX_CREDENTIAL_LENGTH ? clean : null;
}

export function parsePaymentConnectionInput(
  provider: unknown,
  rawCredentials: unknown,
): PaymentConnectionInputResult {
  if (provider !== "razorpay" && provider !== "cashfree") {
    return { ok: false, error: "Choose a supported payment provider." };
  }
  if (!rawCredentials || typeof rawCredentials !== "object" || Array.isArray(rawCredentials)) {
    return { ok: false, error: "Enter the provider's test credentials." };
  }

  const input = rawCredentials as Record<string, unknown>;

  if (provider === "razorpay") {
    const keyId = requiredSecret(input.keyId);
    const keySecret = requiredSecret(input.keySecret);
    const webhookSecret = requiredSecret(input.webhookSecret);
    if (!keyId || !keySecret || !webhookSecret) {
      return { ok: false, error: "Enter the Razorpay test key ID, key secret, and webhook secret." };
    }
    if (!keyId.startsWith("rzp_test_")) {
      return { ok: false, error: "Only Razorpay test-mode key IDs can be saved here." };
    }
    return {
      ok: true,
      provider,
      accountReference: keyId,
      credentials: {
        key_id: keyId,
        key_secret: keySecret,
        webhook_secret: webhookSecret,
      },
    };
  }

  const clientId = requiredSecret(input.clientId);
  const clientSecret = requiredSecret(input.clientSecret);
  const webhookSecret = requiredSecret(input.webhookSecret);
  if (!clientId || !clientSecret || !webhookSecret) {
    return { ok: false, error: "Enter the Cashfree test app ID, client secret, and webhook secret." };
  }
  return {
    ok: true,
    provider,
    accountReference: clientId,
    credentials: {
      client_id: clientId,
      client_secret: clientSecret,
      webhook_secret: webhookSecret,
      api_version: CASHFREE_API_VERSION,
    },
  };
}
