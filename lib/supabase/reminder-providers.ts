import "server-only";
import { createSupabaseAdminClient } from "./admin";
import {
  parseActiveReminderCredentials,
  parseActiveSubscriptionReminderCredentials,
  type ActiveReminderCredentials,
} from "./notification-provider-credentials";

export class ReminderProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "ReminderProviderError";
  }
}

export interface ReminderProviderInput {
  idempotencyKey: string;
  studentName: string;
  instituteName: string;
  installmentNumber: number;
  dueDate: string;
  outstanding: number;
}

export interface SubscriptionReminderProviderInput {
  instituteName: string;
  planName: string;
  renewalDate: string;
  amount: number;
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

async function readProviderMessageId(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    const messages = (body as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      const id = (messages[0] as { id?: unknown } | undefined)?.id;
      return typeof id === "string" && id.trim() ? id : null;
    }
    const id = (body as { id?: unknown }).id;
    return typeof id === "string" && id.trim() ? id : null;
  } catch {
    return null;
  }
}

async function postProviderRequest(
  url: string,
  init: RequestInit,
  provider: "resend" | "whatsapp",
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ReminderProviderError(
      "The provider request outcome could not be confirmed.",
      `${provider}_outcome_unknown`,
      false,
      true,
    );
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new ReminderProviderError(
      "The provider rejected the reminder request.",
      `${provider}_http_${response.status}`,
      retryable,
    );
  }

  const messageId = await readProviderMessageId(response);
  if (!messageId) {
    throw new ReminderProviderError(
      "The provider accepted a response without a message reference.",
      `${provider}_reference_missing`,
      false,
      true,
    );
  }
  return messageId;
}

export async function loadActiveReminderProviderCredentials(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  channel: "Email" | "WhatsApp",
): Promise<ActiveReminderCredentials | null> {
  const provider = channel === "Email" ? "resend" : "whatsapp_cloud";
  const { data, error } = await supabase.rpc("get_platform_provider_credentials", {
    p_provider_scope: channel === "Email" ? "email" : "whatsapp",
    p_provider: provider,
    p_allow_pending: false,
  });
  if (error) {
    throw new ReminderProviderError(
      "The central notification provider credentials could not be resolved.",
      "provider_credentials_lookup_failed",
      false,
    );
  }
  return parseActiveReminderCredentials(channel, data);
}

export async function loadActiveSubscriptionReminderProviderCredentials(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  channel: "Email" | "WhatsApp",
): Promise<ActiveReminderCredentials | null> {
  const provider = channel === "Email" ? "resend" : "whatsapp_cloud";
  const { data, error } = await supabase.rpc("get_platform_provider_credentials", {
    p_provider_scope: channel === "Email" ? "email" : "whatsapp",
    p_provider: provider,
    p_allow_pending: false,
  });
  if (error) {
    throw new ReminderProviderError(
      "The central subscription reminder provider credentials could not be resolved.",
      "subscription_provider_credentials_lookup_failed",
      false,
    );
  }
  return parseActiveSubscriptionReminderCredentials(channel, data);
}

export async function sendEmailReminder(
  to: string,
  input: ReminderProviderInput,
  credentials: Extract<ActiveReminderCredentials, { channel: "Email" }>,
): Promise<{ provider: "Resend"; messageReference: string }> {
  const subject = `Installment ${input.installmentNumber} payment reminder - ${input.instituteName}`;
  const text = [
    `Hello ${input.studentName},`,
    "",
    `Installment ${input.installmentNumber} at ${input.instituteName} is due ${input.dueDate}.`,
    `Outstanding balance: ${formatINR(input.outstanding)}.`,
    "",
    `If you have already paid, please contact ${input.instituteName} with your receipt details.`,
  ].join("\n");

  const messageReference = await postProviderRequest(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({ from: `${credentials.senderName} <${credentials.fromEmail}>`, to: [to], subject, text }),
    },
    "resend",
  );

  return { provider: "Resend", messageReference };
}

export async function sendWhatsAppReminder(
  to: string,
  input: ReminderProviderInput,
  credentials: Extract<ActiveReminderCredentials, { channel: "WhatsApp" }>,
): Promise<{ provider: "Meta WhatsApp Cloud API"; messageReference: string }> {
  const messageReference = await postProviderRequest(
    `https://graph.facebook.com/${credentials.apiVersion}/${encodeURIComponent(credentials.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: credentials.templateName,
          language: { code: credentials.templateLanguage },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: input.studentName },
              { type: "text", text: String(input.installmentNumber) },
              { type: "text", text: input.instituteName },
              { type: "text", text: input.dueDate },
              { type: "text", text: formatINR(input.outstanding) },
            ],
          }],
        },
      }),
    },
    "whatsapp",
  );

  return { provider: "Meta WhatsApp Cloud API", messageReference };
}

export async function sendEmailSubscriptionReminder(
  to: string,
  input: SubscriptionReminderProviderInput,
  credentials: Extract<ActiveReminderCredentials, { channel: "Email" }>,
  idempotencyKey: string,
): Promise<{ provider: "Resend"; messageReference: string }> {
  const subject = `BizBook ${input.planName} renewal reminder for ${input.instituteName}`;
  const text = [
    `Hello ${input.instituteName},`,
    "",
    `Your BizBook ${input.planName} access is scheduled to end on ${input.renewalDate}.`,
    `The plan renewal amount is ${formatINR(input.amount)}.`,
    "",
    "Sign in to BizBook and open Plans & Subscription to renew or review your access.",
  ].join("\n");
  const messageReference = await postProviderRequest(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from: `${credentials.senderName} <${credentials.fromEmail}>`, to: [to], subject, text }),
    },
    "resend",
  );
  return { provider: "Resend", messageReference };
}

export async function sendWhatsAppSubscriptionReminder(
  to: string,
  input: SubscriptionReminderProviderInput,
  credentials: Extract<ActiveReminderCredentials, { channel: "WhatsApp" }>,
): Promise<{ provider: "Meta WhatsApp Cloud API"; messageReference: string }> {
  const messageReference = await postProviderRequest(
    `https://graph.facebook.com/${credentials.apiVersion}/${encodeURIComponent(credentials.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: credentials.templateName,
          language: { code: credentials.templateLanguage },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: input.instituteName },
              { type: "text", text: input.planName },
              { type: "text", text: "BizBook" },
              { type: "text", text: input.renewalDate },
              { type: "text", text: formatINR(input.amount) },
            ],
          }],
        },
      }),
    },
    "whatsapp",
  );
  return { provider: "Meta WhatsApp Cloud API", messageReference };
}
