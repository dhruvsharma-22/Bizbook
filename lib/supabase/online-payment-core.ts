import { createHmac, createHash, timingSafeEqual } from "node:crypto";

function safeEqualHex(expected: string, actual: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(expected) || !/^[a-f\d]{64}$/i.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function safeEqualBase64(expected: string, actual: string): boolean {
  if (!/^[A-Za-z\d+/]+={0,2}$/.test(actual)) return false;
  const expectedBytes = Buffer.from(expected, "base64");
  const actualBytes = Buffer.from(actual, "base64");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function verifyRazorpayCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string,
): boolean {
  if (!orderId || !paymentId || !secret) return false;
  const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqualHex(expected, signature);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return safeEqualHex(expected, signature);
}

export function verifyCashfreeWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): boolean {
  if (!rawBody || !/^\d{1,20}$/.test(timestamp) || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}${rawBody}`, "utf8").digest("base64");
  return safeEqualBase64(expected, signature);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Converts a decimal amount without relying on floating point multiplication. */
export function rupeesToPaise(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [rupees, fraction = ""] = raw.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

export function paiseToRupees(paise: unknown): string | null {
  if (typeof paise !== "number" || !Number.isSafeInteger(paise) || paise < 0) return null;
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

export function cashfreeWebhookEventId(payload: unknown): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const root = payload as Record<string, unknown>;
    const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? root.data as Record<string, unknown>
      : {};
    const order = data.order && typeof data.order === "object" && !Array.isArray(data.order)
      ? data.order as Record<string, unknown>
      : {};
    const payment = data.payment && typeof data.payment === "object" && !Array.isArray(data.payment)
      ? data.payment as Record<string, unknown>
      : {};
    const orderId = typeof order.order_id === "string" ? order.order_id : "";
    const paymentId = typeof payment.cf_payment_id === "string" || typeof payment.cf_payment_id === "number"
      ? String(payment.cf_payment_id)
      : "";
    const status = typeof payment.payment_status === "string" ? payment.payment_status : "";
    if (orderId && paymentId && status) return `cashfree:${sha256Hex(`${orderId}|${paymentId}|${status}`)}`;
  }
  return `cashfree:${sha256Hex(JSON.stringify(payload))}`;
}
