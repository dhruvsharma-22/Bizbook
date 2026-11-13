export const SUPPORT_CATEGORIES = ["account", "billing", "payments", "data", "other"] as const;
export const SUPPORT_STATUSES = ["open", "in_progress", "waiting_on_customer", "resolved", "closed"] as const;
export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type SupportCategory = typeof SUPPORT_CATEGORIES[number];
export type SupportStatus = typeof SUPPORT_STATUSES[number];
export type SupportPriority = typeof SUPPORT_PRIORITIES[number];

export type SupportTicketInput = {
  instituteId: string;
  category: SupportCategory;
  subject: string;
  message: string;
  idempotencyKey: string;
};

export type SupportReplyInput = {
  ticketId: string;
  message: string;
  idempotencyKey: string;
};

export type SupportStateInput = {
  ticketId: string;
  status: SupportStatus;
  priority: SupportPriority;
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length >= min && result.length <= max ? result : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function parseSupportTicketInput(value: unknown): SupportTicketInput | null {
  if (!isRecord(value)) return null;
  const instituteId = boundedText(value.instituteId, 1, 100);
  const subject = boundedText(value.subject, 5, 120);
  const message = boundedText(value.message, 20, 4000);
  const category = SUPPORT_CATEGORIES.find((candidate) => candidate === value.category);
  if (!instituteId || !subject || !message || !category || !isUuid(value.idempotencyKey)) return null;
  return { instituteId, category, subject, message, idempotencyKey: value.idempotencyKey };
}

export function parseSupportReplyInput(value: unknown): SupportReplyInput | null {
  if (!isRecord(value)) return null;
  const message = boundedText(value.message, 1, 4000);
  if (!isUuid(value.ticketId) || !message || !isUuid(value.idempotencyKey)) return null;
  return { ticketId: value.ticketId, message, idempotencyKey: value.idempotencyKey };
}

export function parseSupportStateInput(value: unknown): SupportStateInput | null {
  if (!isRecord(value)) return null;
  const status = SUPPORT_STATUSES.find((candidate) => candidate === value.status);
  const priority = SUPPORT_PRIORITIES.find((candidate) => candidate === value.priority);
  if (!isUuid(value.ticketId) || !status || !priority) return null;
  return { ticketId: value.ticketId, status, priority };
}
