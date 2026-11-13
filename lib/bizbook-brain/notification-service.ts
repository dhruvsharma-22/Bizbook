
/**
 * BizBook Brain — Notification Service
 *
 * Client-side helpers for calling BizBook notification preview routes.
 *
 * Current behavior:
 * - Requests previews from local API routes.
 * - Does not send real emails or WhatsApp messages.
 * - Does not persist reminder logs.
 * - Does not verify payments.
 *
 * A production messaging integration must use server-side
 * credentials and provider delivery status.
 */

import { BizBookError } from "./errors";

export type NotificationChannel = "WhatsApp" | "Email";

export interface NotificationRequest {
  to: string;
  coachingName: string;
  studentName: string;
  message: string;
  subject?: string;
}

export interface NotificationResult {
  success: boolean;
  simulated?: boolean;
  message?: string;
}

function fail(message: string): never {
  throw new BizBookError("VALIDATION_ERROR", message);
}

function getEndpoint(channel: NotificationChannel): string {
  switch (channel) {
    case "WhatsApp":
      return "/api/notifications/whatsapp";
    case "Email":
      return "/api/notifications/email";
    default:
      return fail("Unsupported notification channel.");
  }
}

function validateRequest(
  channel: NotificationChannel,
  request: NotificationRequest
): void {
  if (!request || typeof request !== "object") {
    return fail("Notification request is required.");
  }

  if (
    typeof request.to !== "string" ||
    !request.to.trim()
  ) {
    return fail("Recipient address or phone number is required.");
  }

  if (
    typeof request.coachingName !== "string" ||
    !request.coachingName.trim() ||
    typeof request.studentName !== "string" ||
    !request.studentName.trim()
  ) {
    return fail("Coaching name and student name are required.");
  }

  if (
    typeof request.message !== "string" ||
    !request.message.trim()
  ) {
    return fail("Message content is required.");
  }

  if (
    request.subject !== undefined &&
    typeof request.subject !== "string"
  ) {
    return fail("Email subject must be text.");
  }

  if (
    channel === "Email" &&
    request.subject !== undefined &&
    !request.subject.trim()
  ) {
    return fail("Email subject cannot be empty.");
  }
}

/**
 * Requests a notification preview from the local API.
 *
 * Call this from a browser event handler or client-side service.
 * The endpoint is expected to simulate delivery only.
 */
export async function previewNotification(
  channel: NotificationChannel,
  request: NotificationRequest
): Promise<NotificationResult> {
  if (channel !== "Email" && channel !== "WhatsApp") {
    return fail("Unsupported notification channel.");
  }

  validateRequest(channel, request);

  if (typeof window === "undefined") {
    throw new BizBookError(
      "INVALID_OPERATION",
      "Notification previews must be requested from the browser."
    );
  }

  let response: Response;

  try {
    response = await fetch(getEndpoint(channel), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: request.to.trim(),
        coachingName: request.coachingName.trim(),
        studentName: request.studentName.trim(),
        message: request.message,
        ...(request.subject !== undefined
          ? { subject: request.subject.trim() }
          : {}),
      }),
    });
  } catch {
    throw new BizBookError(
      "INVALID_OPERATION",
      "Could not reach the notification preview service."
    );
  }

  let result: NotificationResult;

  try {
    result = (await response.json()) as NotificationResult;
  } catch {
    throw new BizBookError(
      "INVALID_OPERATION",
      "The notification preview service returned an invalid response."
    );
  }

  if (
    !response.ok ||
    !result ||
    result.success !== true
  ) {
    throw new BizBookError(
      "INVALID_OPERATION",
      result?.message ??
        `Notification preview failed (${response.status}).`
    );
  }

  return result;
}

/**
 * Generates an email preview.
 */
export function previewEmail(
  request: NotificationRequest
): Promise<NotificationResult> {
  return previewNotification("Email", request);
}

/**
 * Generates a WhatsApp preview.
 */
export function previewWhatsApp(
  request: NotificationRequest
): Promise<NotificationResult> {
  return previewNotification("WhatsApp", request);
}
